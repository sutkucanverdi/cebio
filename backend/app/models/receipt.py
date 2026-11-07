import datetime as dt
from datetime import datetime, timezone
from decimal import Decimal
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.user import User

# Para tutarları float yerine sabit hassasiyetli ondalık olarak tutulur (0.1 + 0.2 != 0.3 sorunu olmasın).
MONEY = Numeric(12, 2, asdecimal=True)
QUANTITY = Numeric(12, 3, asdecimal=True)


class Receipt(Base):
    __tablename__ = "receipts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    # Eski (kullanıcı sistemi öncesi) kayıtlar için veritabanında NULL olabilir;
    # yeni kayıtların hepsi bir kullanıcıya bağlanır ve sorgular her zaman user_id ile filtrelenir.
    user_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    merchant: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    date: Mapped[dt.date] = mapped_column(Date, nullable=False, index=True)
    total_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user: Mapped[Optional["User"]] = relationship("User", back_populates="receipts")
    items: Mapped[List["ReceiptItem"]] = relationship(
        "ReceiptItem",
        back_populates="receipt",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class ReceiptItem(Base):
    __tablename__ = "receipt_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    receipt_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("receipts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    price: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    quantity: Mapped[Decimal] = mapped_column(
        QUANTITY, nullable=False, default=Decimal("1"), server_default="1"
    )
    unit_price: Mapped[Optional[Decimal]] = mapped_column(MONEY, nullable=True)
    category: Mapped[str] = mapped_column(String(100), nullable=False, index=True)

    receipt: Mapped["Receipt"] = relationship("Receipt", back_populates="items")
