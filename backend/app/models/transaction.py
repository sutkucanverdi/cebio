import datetime as dt
from datetime import datetime, timezone
from decimal import Decimal
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.receipt import MONEY

if TYPE_CHECKING:
    from app.models.user import User


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class StatementImport(Base):
    """Bir ekstre yüklemesi. Silindiğinde ona ait tüm işlemler de silinir (içe aktarmayı geri alma).

    Ekstre dosyasının kendisi saklanmaz; yalnızca kullanıcının onayladığı satırlar Transaction olarak kaydedilir.
    """

    __tablename__ = "statement_imports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    period_start: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    period_end: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="statement_imports")
    transactions: Mapped[List["Transaction"]] = relationship(
        "Transaction", back_populates="statement_import", cascade="all, delete-orphan", passive_deletes=True
    )


class Transaction(Base):
    """Banka/kart ekstresinden içe aktarılan tek bir harcama."""

    __tablename__ = "transactions"
    __table_args__ = (UniqueConstraint("user_id", "fingerprint", name="uq_transactions_user_fingerprint"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    import_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("statement_imports.id", ondelete="CASCADE"), nullable=False, index=True
    )
    date: Mapped[dt.date] = mapped_column(Date, nullable=False, index=True)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    merchant: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="TRY", server_default="TRY")
    category: Mapped[str] = mapped_column(String(100), nullable=False, default="Diğer", index=True)
    # Aynı ekstre tekrar yüklenince aynı işlemin ikinci kez eklenmesini önler
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    # Bu harcamanın fişi zaten kayıtlıysa: toplamlarda iki kez sayılmaz (fiş daha ayrıntılıdır)
    matched_receipt_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("receipts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    statement_import: Mapped["StatementImport"] = relationship("StatementImport", back_populates="transactions")
