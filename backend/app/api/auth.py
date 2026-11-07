import logging

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.security import create_access_token, hash_password, verify_password
from app.models.receipt import Receipt
from app.models.user import User
from app.schemas.auth import LoginRequest, TokenResponse, UserCreate, UserResponse

logger = logging.getLogger("cebio")

router = APIRouter(prefix="/api/v1/auth", tags=["Auth"])

_INVALID_LOGIN = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="E-posta veya şifre hatalı.",
    headers={"WWW-Authenticate": "Bearer"},
)


def _token_response(user: User) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(user.id),
        user=UserResponse.model_validate(user),
    )


def _authenticate(db: Session, email: str, password: str) -> User:
    user = db.scalars(select(User).where(User.email == email.strip().lower())).first()
    if user is None or not verify_password(password, user.password_hash):
        raise _INVALID_LOGIN
    return user


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Yeni hesap oluştur",
)
def register(payload: UserCreate, db: Session = Depends(get_db)) -> TokenResponse:
    email = payload.email.strip().lower()
    if db.scalars(select(User).where(User.email == email)).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Bu e-posta adresiyle kayıtlı bir hesap zaten var.",
        )

    is_first_user = db.scalar(select(func.count(User.id))) == 0

    user = User(
        email=email,
        password_hash=hash_password(payload.password),
        full_name=(payload.full_name or "").strip() or None,
    )
    db.add(user)
    db.flush()

    if is_first_user:
        # Kullanıcı sistemi öncesinde kaydedilmiş (sahipsiz) fişleri ilk hesaba devret.
        claimed = db.execute(
            update(Receipt).where(Receipt.user_id.is_(None)).values(user_id=user.id)
        ).rowcount
        if claimed:
            logger.info("İlk kullanıcıya %s adet eski fiş devredildi.", claimed)

    db.commit()
    db.refresh(user)
    return _token_response(user)


@router.post("/login", response_model=TokenResponse, summary="E-posta ve şifre ile giriş yap")
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    return _token_response(_authenticate(db, payload.email, payload.password))


@router.post(
    "/token",
    response_model=TokenResponse,
    summary="OAuth2 form girişi (Swagger 'Authorize' butonu için)",
    include_in_schema=True,
)
def login_form(
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
) -> TokenResponse:
    return _token_response(_authenticate(db, form.username, form.password))


@router.get("/me", response_model=UserResponse, summary="Giriş yapmış kullanıcının bilgileri")
def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user


@router.delete(
    "/me",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Hesabı ve tüm verileri kalıcı olarak sil",
    description="KVKK ve App Store gereği: kullanıcı hesabını ve ona ait tüm fişleri siler.",
)
def delete_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    db.delete(current_user)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
