import logging

from alembic import command
from alembic.config import Config

from app.core.config import BASE_DIR, settings

logger = logging.getLogger("cebio")


def alembic_config() -> Config:
    cfg = Config(str(BASE_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BASE_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", settings.DATABASE_URL.replace("%", "%%"))
    cfg.attributes["skip_logging"] = True
    return cfg


def run_migrations() -> None:
    """Veritabanını en güncel Alembic revizyonuna yükseltir."""
    logger.info("Veritabanı migration'ları uygulanıyor...")
    command.upgrade(alembic_config(), "head")
