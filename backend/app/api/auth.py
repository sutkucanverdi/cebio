import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import RateLimiter
from app.core.security import create_access_token, hash_password, verify_password
from app.models.receipt import Receipt
from app.models.user import User
from app.schemas.auth import (
    ForgotPasswordRequest,
    LoginRequest,
    MessageResponse,
    ResetPasswordRequest,
    TokenResponse,
    UserCreate,
    UserResponse,
)
from app.services.password_reset import create_reset_code, reset_password, send_reset_email

logger = logging.getLogger("cebio")

router = APIRouter(prefix="/api/v1/auth", tags=["Auth"])

reset_request_limiter = RateLimiter(settings.PASSWORD_RESET_REQUESTS_PER_WINDOW, settings.PASSWORD_RESET_WINDOW_SECONDS)

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
        terms_version=settings.TERMS_VERSION,
        terms_accepted_at=datetime.now(timezone.utc),
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


@router.post(
    "/forgot-password",
    response_model=MessageResponse,
    summary="Şifre sıfırlama kodu gönder",
    description="Hesabın var olup olmadığını açığa çıkarmamak için her durumda aynı cevabı döner.",
)
def forgot_password(
    payload: ForgotPasswordRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> MessageResponse:
    user = db.scalars(select(User).where(User.email == payload.email.strip().lower())).first()
    # Limit yalnızca var olan hesaplar için tutulur; rastgele adreslerle bellek şişirilemez
    if user is not None and reset_request_limiter.allow(user.id):
        code = create_reset_code(db, user)
        background_tasks.add_task(send_reset_email, user.email, code)
    return MessageResponse(message="Bu e-posta adresi kayıtlıysa sıfırlama kodu gönderildi.")


@router.post("/reset-password", response_model=MessageResponse, summary="Kodla yeni şifre belirle")
def reset_password_endpoint(payload: ResetPasswordRequest, db: Session = Depends(get_db)) -> MessageResponse:
    if not reset_password(db, payload.email, payload.code, payload.new_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Kod hatalı veya süresi dolmuş.")
    return MessageResponse(message="Şifreniz değiştirildi. Yeni şifrenizle giriş yapabilirsiniz.")


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
