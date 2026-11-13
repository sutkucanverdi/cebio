from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AIReport(Base):
    """Kullanıcının uygunsuz/yanlış bulduğu yapay zeka cevabı (Google Play Yapay Zeka İçeriği politikası).

    Raporlar moderasyon ve komut (prompt) iyileştirmesi için incelenir: `python -m app.cli ai-reports`.
    """

    __tablename__ = "ai_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    feature: Mapped[str] = mapped_column(String(32), nullable=False, default="assistant")
    reason: Mapped[str] = mapped_column(String(32), nullable=False)  # offensive | wrong | harmful | other
    content: Mapped[str] = mapped_column(Text, nullable=False)  # raporlanan yapay zeka cevabı
    note: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
