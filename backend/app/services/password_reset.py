"""Şifre sıfırlama: e-postayla gönderilen 6 haneli, tek kullanımlık, kısa ömürlü kod.

Güvenlik kuralları:
- Kod veritabanında düz metin tutulmaz; JWT_SECRET anahtarlı HMAC'i saklanır (6 hane düz SHA ile saniyede kırılırdı).
- Kullanıcı başına aynı anda tek geçerli kod vardır; yeni kod eskisini geçersiz kılar.
- Yanlış denemeler sayılır, sınıra ulaşan kod iptal edilir.
- Şifre değişince `password_changed_at` güncellenir ve daha önce verilmiş tüm oturumlar geçersiz olur.
"""
import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import as_utc, hash_password
from app.models.password_reset import PasswordResetCode
from app.models.user import User
from app.services import email as email_service

logger = logging.getLogger("cebio")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def generate_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_code(user_id: int, code: str) -> str:
    message = f"password-reset:{user_id}:{code}".encode("utf-8")
    return hmac.new(settings.JWT_SECRET.encode("utf-8"), message, hashlib.sha256).hexdigest()


def create_reset_code(db: Session, user: User) -> str:
    """Eski kodları iptal edip yeni bir kod üretir; düz metin kodu yalnızca e-posta için döner."""
    now = utcnow()
    db.execute(
        update(PasswordResetCode)
        .where(PasswordResetCode.user_id == user.id, PasswordResetCode.used_at.is_(None))
        .values(used_at=now)
    )
    code = generate_code()
    db.add(
        PasswordResetCode(
            user_id=user.id,
            code_hash=hash_code(user.id, code),
            expires_at=now + timedelta(minutes=settings.PASSWORD_RESET_CODE_MINUTES),
        )
    )
    db.commit()
    return code


def reset_password(db: Session, email: str, code: str, new_password: str) -> bool:
    """Kod doğruysa şifreyi değiştirir. Hangi adımda başarısız olduğu bilerek dışarı söylenmez."""
    user = db.scalars(select(User).where(User.email == email.strip().lower())).first()
    if user is None:
        return False

    row = db.scalars(
        select(PasswordResetCode)
        .where(PasswordResetCode.user_id == user.id, PasswordResetCode.used_at.is_(None))
        .order_by(PasswordResetCode.id.desc())
        .with_for_update()
    ).first()
    now = utcnow()
    if row is None or as_utc(row.expires_at) <= now:
        db.rollback()
        return False

    if not hmac.compare_digest(row.code_hash, hash_code(user.id, code)):
        row.attempts += 1
        if row.attempts >= settings.PASSWORD_RESET_MAX_ATTEMPTS:
            row.used_at = now
        db.commit()
        return False

    row.used_at = now
    user.password_hash = hash_password(new_password)
    user.password_changed_at = now
    db.commit()
    return True


def send_reset_email(to: str, code: str) -> None:
    """Arka planda çalışır; hata fırlatmaz ki kullanıcıya hesabın var olup olmadığı belli olmasın."""
    if not email_service.is_configured():
        if settings.DEBUG:
            # Yalnızca geliştirmede: SMTP kurulana kadar kod sunucu çıktısında görünür
            logger.warning("[GELISTIRME] Sifre sifirlama kodu: %s (SMTP ayarli degil, e-posta gonderilmedi)", code)
        else:
            logger.error("SMTP yapılandırılmamış; şifre sıfırlama e-postası gönderilemedi.")
        return

    minutes = settings.PASSWORD_RESET_CODE_MINUTES
    text = (
        "Merhaba,\n\n"
        f"Cebio şifre sıfırlama kodunuz: {code}\n\n"
        f"Kod {minutes} dakika geçerlidir ve yalnızca bir kez kullanılabilir.\n"
        "Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz; şifreniz değişmez.\n\n"
        "Cebio"
    )
    try:
        email_service.send_email(to, f"Cebio şifre sıfırlama kodunuz: {code}", text)
    except Exception:
        logger.exception("Şifre sıfırlama e-postası gönderilemedi.")
