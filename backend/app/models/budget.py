from datetime import datetime, timezone
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.receipt import MONEY

if TYPE_CHECKING:
    from app.models.user import User


class Budget(Base):
    """Aylık harcama limiti. category NULL ise tüm fiş harcamaları için genel bütçedir.

    Kullanıcı başına kategori başına tek bütçe kuralı uygulama katmanında korunur
    (SQL'de NULL değerler UNIQUE kısıtında birbirine eşit sayılmadığı için).
    """

    __tablename__ = "budgets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    monthly_limit: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user: Mapped["User"] = relationship("User", back_populates="budgets")
