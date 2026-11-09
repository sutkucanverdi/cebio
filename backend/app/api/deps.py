from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import as_utc, decode_access_token
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")

_CREDENTIALS_ERROR = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Oturum geçersiz veya süresi dolmuş. Lütfen tekrar giriş yapın.",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    claims = decode_access_token(token)
    if claims is None:
        raise _CREDENTIALS_ERROR
    user_id, issued_at = claims
    user = db.get(User, user_id)
    if user is None:
        raise _CREDENTIALS_ERROR
    # Şifre değiştiyse ondan önce açılmış oturumlar geçersizdir (çalınan token'lar da düşer)
    if user.password_changed_at and issued_at < int(as_utc(user.password_changed_at).timestamp()):
        raise _CREDENTIALS_ERROR
    return user
