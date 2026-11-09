from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

import bcrypt
import jwt

from app.core.config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=settings.BCRYPT_ROUNDS)).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    encoded = password.encode("utf-8")
    if len(encoded) > 72:
        return False
    try:
        return bcrypt.checkpw(encoded, password_hash.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(user_id: int, expires_minutes: Optional[int] = None) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=expires_minutes or settings.JWT_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "iat": now, "exp": expire}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> Optional[Tuple[int, int]]:
    """Geçerli bir token ise (kullanıcı ID, verildiği zaman) döner, aksi halde None."""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        return int(payload["sub"]), int(payload["iat"])
    except (jwt.PyJWTError, KeyError, ValueError, TypeError):
        return None


def as_utc(value: datetime) -> datetime:
    """SQLite saat dilimi bilgisini kaybedebilir; karşılaştırma için UTC'ye sabitler."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
