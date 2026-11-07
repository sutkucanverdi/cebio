from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class UsageCounter(Base):
    """Kullanıcının bir ayda bir yapay zeka özelliğini kaç kez kullandığı (plan limitleri için)."""

    __tablename__ = "usage_counters"
    __table_args__ = (UniqueConstraint("user_id", "period", "feature", name="uq_usage_user_period_feature"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    period: Mapped[str] = mapped_column(String(7), nullable=False)  # 2026-11
    feature: Mapped[str] = mapped_column(String(32), nullable=False)  # receipt_scan | statement_scan | assistant
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
