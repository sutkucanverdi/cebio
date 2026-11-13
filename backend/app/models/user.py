from datetime import datetime, timezone
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.ai_report import AIReport
    from app.models.budget import Budget
    from app.models.receipt import Receipt
    from app.models.subscription import Subscription
    from app.models.transaction import StatementImport


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    # KVKK açık rıza / kullanım koşulları onayı (hangi metin sürümü, ne zaman)
    terms_version: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    terms_accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # Yapay zeka (Google Gemini) ile veri paylaşımı için AYRI ve geri alınabilir açık rıza.
    # None ise fiş/ekstre tarama ve asistan kullanılamaz (App Store 5.1.2(i), KVKK m.5 ve m.9).
    ai_consent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # Arayüz dili; e-postalar ve asistan cevapları bu dilde üretilir
    locale: Mapped[str] = mapped_column(String(5), nullable=False, default="tr", server_default="tr")
    # Bu tarihten önce verilmiş oturumlar (JWT) geçersizdir; şifre sıfırlanınca güncellenir
    password_changed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # Premium bitiş zamanı; None veya geçmişte ise kullanıcı ücretsiz plandadır
    premium_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # Premium'u neyin verdiği: revenuecat (mağaza aboneliği), promo, admin
    plan_source: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
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
    budgets: Mapped[List["Budget"]] = relationship(
        "Budget",
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    ai_reports: Mapped[List["AIReport"]] = relationship(
        "AIReport",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    statement_imports: Mapped[List["StatementImport"]] = relationship(
        "StatementImport",
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
