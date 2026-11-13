"""Ücretsiz/Premium plan ve aylık yapay zeka kullanım limitleri.

Akış: uç nokta işlemden ÖNCE `ensure_quota` ile limiti kontrol eder, yapay zeka çağrısı BAŞARILI olursa
`record_usage` ile sayacı artırır. Böylece başarısız (Gemini hatası, okunamayan fiş) denemeler hak yemez.
"""
import datetime as dt
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Literal, Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.usage import UsageCounter
from app.models.user import User

Feature = Literal["receipt_scan", "statement_scan", "assistant"]
FEATURES: List[Feature] = ["receipt_scan", "statement_scan", "assistant"]

FEATURE_LABELS: Dict[str, str] = {
    "receipt_scan": "fiş tarama",
    "statement_scan": "ekstre analizi",
    "assistant": "asistan sorusu",
}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def current_period(now: Optional[datetime] = None) -> str:
    now = now or utcnow()
    return f"{now.year:04d}-{now.month:02d}"


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    """SQLite timezone bilgisini kaybedebilir; karşılaştırma için UTC'ye sabitle."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def is_premium(user: User, now: Optional[datetime] = None) -> bool:
    until = _aware(user.premium_until)
    return until is not None and until > (now or utcnow())


def limits_for(user: User) -> Dict[str, int]:
    if is_premium(user):
        return {
            "receipt_scan": settings.PREMIUM_RECEIPT_SCANS_PER_MONTH,
            "statement_scan": settings.PREMIUM_STATEMENT_SCANS_PER_MONTH,
            "assistant": settings.PREMIUM_ASSISTANT_QUESTIONS_PER_MONTH,
        }
    return {
        "receipt_scan": settings.FREE_RECEIPT_SCANS_PER_MONTH,
        "statement_scan": settings.FREE_STATEMENT_SCANS_PER_MONTH,
        "assistant": settings.FREE_ASSISTANT_QUESTIONS_PER_MONTH,
    }


def _counter(db: Session, user_id: int, period: str, feature: str) -> Optional[UsageCounter]:
    return db.scalars(
        select(UsageCounter).where(
            UsageCounter.user_id == user_id, UsageCounter.period == period, UsageCounter.feature == feature
        )
    ).first()


def usage_for(db: Session, user: User, period: Optional[str] = None) -> Dict[str, int]:
    period = period or current_period()
    rows = db.scalars(
        select(UsageCounter).where(UsageCounter.user_id == user.id, UsageCounter.period == period)
    ).all()
    used = {f: 0 for f in FEATURES}
    for row in rows:
        if row.feature in used:
            used[row.feature] = row.count
    return used


AI_CONSENT_MESSAGE = (
    "Yapay zeka özelliklerini kullanmak için önce verilerinin yapay zeka servisine (Google Gemini) "
    "aktarılmasına izin vermelisin."
)


def ensure_ai_consent(user: User) -> None:
    """Kullanıcı yapay zeka aktarımına açık rıza vermediyse 403 döner (veri Gemini'ye HİÇ gönderilmez)."""
    if user.ai_consent_at is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=AI_CONSENT_MESSAGE,
            headers={"X-Cebio-Consent": "ai"},
        )


def ensure_quota(db: Session, user: User, feature: Feature) -> None:
    """Önce yapay zeka rızasını, sonra limiti kontrol eder.

    Rıza yoksa 403, limit dolmuşsa 402 (Payment Required) döner; mesajlar kullanıcıya gösterilmeye uygundur.
    """
    ensure_ai_consent(user)
    limit = limits_for(user)[feature]
    used = usage_for(db, user)[feature]
    if used < limit:
        return
    label = FEATURE_LABELS[feature]
    if is_premium(user):
        detail = (
            f"Bu ayki {label} limitinize ({limit}) ulaştınız. Limit her ayın başında yenilenir."
        )
    else:
        detail = (
            f"Ücretsiz planda ayda {limit} {label} hakkınız var ve bu ay hepsini kullandınız. "
            "Premium'a geçerek limitinizi artırabilir ya da gelecek ayı bekleyebilirsiniz."
        )
    raise HTTPException(
        status_code=status.HTTP_402_PAYMENT_REQUIRED,
        detail=detail,
        headers={"X-Cebio-Limit": feature},
    )


def record_usage(db: Session, user: User, feature: Feature, amount: int = 1) -> None:
    period = current_period()
    row = _counter(db, user.id, period, feature)
    if row is None:
        row = UsageCounter(user_id=user.id, period=period, feature=feature, count=0)
        db.add(row)
        try:
            db.flush()
        except IntegrityError:
            # Aynı anda gelen iki istekten biri satırı önce oluşturduysa onu kullan
            db.rollback()
            row = _counter(db, user.id, period, feature)
            assert row is not None
    row.count += amount
    db.commit()


@dataclass
class FeatureStatus:
    feature: str
    label: str
    used: int
    limit: int


def plan_status(db: Session, user: User) -> dict:
    premium = is_premium(user)
    used = usage_for(db, user)
    limits = limits_for(user)
    now = utcnow()
    next_month = dt.date(now.year + (now.month == 12), now.month % 12 + 1, 1)
    return {
        "plan": "premium" if premium else "free",
        "premium_until": _aware(user.premium_until) if premium else None,
        "plan_source": user.plan_source if premium else None,
        "period": current_period(now),
        "resets_on": next_month,
        "features": [
            FeatureStatus(feature=f, label=FEATURE_LABELS[f], used=used[f], limit=limits[f]).__dict__
            for f in FEATURES
        ],
    }


def grant_premium(db: Session, user: User, until: datetime, source: str) -> None:
    user.premium_until = until
    user.plan_source = source
    db.commit()
