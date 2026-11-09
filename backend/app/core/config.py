import logging
from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent.parent

logger = logging.getLogger("cebio")

# Yalnızca DEBUG modunda kullanılan sabit geliştirme anahtarı. Production'da asla kullanılmaz.
_DEV_JWT_SECRET = "cebio-dev-only-insecure-secret-change-me"


class Settings(BaseSettings):
    APP_NAME: str = "Cebio API"
    APP_VERSION: str = "0.2.0"
    DEBUG: bool = True

    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-3.5-flash-lite"

    DATABASE_URL: str = f"sqlite:///{BASE_DIR / 'cebio.db'}"
    CORS_ORIGINS: str = "*"
    # Uygulama açılırken Alembic migration'larını otomatik uygula (production'da deploy adımında da yapılabilir).
    AUTO_MIGRATE: bool = True

    # Kimlik doğrulama (JWT)
    JWT_SECRET: str = ""
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 gün
    # bcrypt maliyet faktörü (production için 12; testlerde hız için düşürülür)
    BCRYPT_ROUNDS: int = 12

    # Yasal metinlerin geçerli sürümü (metin değişince artırın; onay kaydına yazılır)
    TERMS_VERSION: str = "2026-11.2"

    # Yükleme limitleri
    MAX_UPLOAD_MB: int = 10

    # AI asistan: kullanıcı başına pencere içinde en fazla kaç soru
    ASSISTANT_RATE_LIMIT: int = 30
    ASSISTANT_RATE_WINDOW_SECONDS: int = 600

    # Plan limitleri (aylık, yapay zeka kullanan işlemler). Premium limitleri adil kullanım tavanıdır.
    FREE_RECEIPT_SCANS_PER_MONTH: int = 15
    FREE_STATEMENT_SCANS_PER_MONTH: int = 2
    FREE_ASSISTANT_QUESTIONS_PER_MONTH: int = 30
    PREMIUM_RECEIPT_SCANS_PER_MONTH: int = 200
    PREMIUM_STATEMENT_SCANS_PER_MONTH: int = 20
    PREMIUM_ASSISTANT_QUESTIONS_PER_MONTH: int = 300

    # Şifre sıfırlama
    PASSWORD_RESET_CODE_MINUTES: int = 15
    PASSWORD_RESET_MAX_ATTEMPTS: int = 5
    PASSWORD_RESET_REQUESTS_PER_WINDOW: int = 3
    PASSWORD_RESET_WINDOW_SECONDS: int = 900

    # E-posta (SMTP). SMTP_HOST boşsa DEBUG modunda kod sunucu çıktısına yazılır, e-posta gönderilmez.
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""
    SMTP_USE_SSL: bool = False

    # RevenueCat (Google Play / App Store abonelikleri) webhook doğrulama anahtarı
    REVENUECAT_WEBHOOK_SECRET: str = ""

    model_config = SettingsConfigDict(
        env_file=(BASE_DIR / ".env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @model_validator(mode="after")
    def _finalize(self) -> "Settings":
        # Göreli SQLite yolunu (sqlite:///./cebio.db) çalışma dizinine değil backend/ dizinine sabitle.
        # Aksi halde uvicorn'u farklı klasörden başlatınca ikinci, boş bir veritabanı oluşuyordu.
        prefix = "sqlite:///"
        if self.DATABASE_URL.startswith(prefix) and not self.DATABASE_URL.startswith("sqlite:////"):
            raw_path = self.DATABASE_URL[len(prefix):]
            if raw_path and raw_path != ":memory:" and not Path(raw_path).is_absolute():
                self.DATABASE_URL = f"{prefix}{(BASE_DIR / raw_path).resolve().as_posix()}"

        if not self.JWT_SECRET:
            if not self.DEBUG:
                raise ValueError("JWT_SECRET tanımlanmamış. Production ortamında zorunludur.")
            logger.warning("JWT_SECRET tanımlı değil; DEBUG için güvensiz geliştirme anahtarı kullanılıyor.")
            self.JWT_SECRET = _DEV_JWT_SECRET
        return self

    @property
    def cors_origins_list(self) -> List[str]:
        if self.CORS_ORIGINS.strip() == "*":
            return ["*"]
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.MAX_UPLOAD_MB * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
