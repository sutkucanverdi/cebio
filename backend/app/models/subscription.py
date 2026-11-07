import datetime as dt
from datetime import datetime, timezone
from decimal import Decimal
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.receipt import MONEY

if TYPE_CHECKING:
    from app.models.user import User


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="TRY", server_default="TRY")
    # weekly | monthly | quarterly | yearly
    billing_cycle: Mapped[str] = mapped_column(String(16), nullable=False, default="monthly")
    next_billing_date: Mapped[dt.date] = mapped_column(Date, nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(100), nullable=False, default="Diğer")
    # active | trial | paused | cancelled
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", index=True)
    trial_ends_at: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    cancel_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    user: Mapped["User"] = relationship("User", back_populates="subscriptions")
    price_changes: Mapped[List["SubscriptionPriceChange"]] = relationship(
        "SubscriptionPriceChange",
        back_populates="subscription",
        cascade="all, delete-orphan",
        order_by="SubscriptionPriceChange.changed_at.desc(), SubscriptionPriceChange.id.desc()",
        lazy="selectin",
    )


class SubscriptionPriceChange(Base):
    """Abonelik ücretindeki her değişiklik (zam takibi için)."""

    __tablename__ = "subscription_price_changes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    subscription_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("subscriptions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    old_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    new_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    changed_at: Mapped[dt.date] = mapped_column(Date, nullable=False)

    subscription: Mapped["Subscription"] = relationship("Subscription", back_populates="price_changes")
