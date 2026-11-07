from datetime import datetime, timezone
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.receipt import Receipt
    from app.models.subscription import Subscription


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    receipts: Mapped[List["Receipt"]] = relationship(
        "Receipt",
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    subscriptions: Mapped[List["Subscription"]] = relationship(
        "Subscription",
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
