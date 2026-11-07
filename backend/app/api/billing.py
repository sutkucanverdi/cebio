import datetime as dt
import hmac
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.user import User
from app.services.billing import _aware, grant_premium, plan_status

logger = logging.getLogger("cebio")

router = APIRouter(prefix="/api/v1/billing", tags=["Billing"])

# Erişimi başlatan / uzatan RevenueCat olayları
GRANT_EVENTS = {
    "INITIAL_PURCHASE",
    "RENEWAL",
    "PRODUCT_CHANGE",
    "UNCANCELLATION",
    "NON_RENEWING_PURCHASE",
    "SUBSCRIPTION_EXTENDED",
    "TEMPORARY_ENTITLEMENT_GRANT",
}
# Erişimi bitiren olay. CANCELLATION / BILLING_ISSUE erişimi hemen kesmez; dönem sonunda EXPIRATION gelir.
EXPIRE_EVENTS = {"EXPIRATION"}


class FeatureUsage(BaseModel):
    feature: str
    label: str
    used: int
    limit: int


class PlanStatusResponse(BaseModel):
    plan: str
    premium_until: Optional[datetime] = None
    plan_source: Optional[str] = None
    period: str
    resets_on: dt.date
    features: List[FeatureUsage]


@router.get("/status", response_model=PlanStatusResponse, summary="Plan ve bu ayki kullanım")
def get_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PlanStatusResponse:
    return PlanStatusResponse(**plan_status(db, current_user))


def _find_user(db: Session, event: Dict[str, Any]) -> Optional[User]:
    """Uygulama RevenueCat'e kullanıcıyı kendi ID'mizle tanıtır (Purchases.logIn(String(user.id)))."""
    candidates = [event.get("app_user_id"), event.get("original_app_user_id"), *(event.get("aliases") or [])]
    for value in candidates:
        if value is not None and str(value).isdigit():
            user = db.get(User, int(value))
            if user:
                return user
    return None


def _ms_to_dt(value: Any) -> Optional[datetime]:
    try:
        return datetime.fromtimestamp(int(value) / 1000, tz=timezone.utc)
    except (TypeError, ValueError, OverflowError, OSError):
        return None


@router.post(
    "/revenuecat-webhook",
    summary="RevenueCat abonelik olayları (Google Play / App Store)",
    include_in_schema=False,
)
async def revenuecat_webhook(
    request: Request,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> dict:
    secret = settings.REVENUECAT_WEBHOOK_SECRET
    if not secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Webhook yapılandırılmamış.")
    provided = (authorization or "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(provided.encode(), secret.encode()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Yetkisiz.")

    try:
        body = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Geçersiz JSON.") from exc
    event = body.get("event") if isinstance(body, dict) else None
    if not isinstance(event, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="event alanı eksik.")

    event_type = str(event.get("type", ""))
    if event_type == "TEST":
        return {"status": "ok"}

    user = _find_user(db, event)
    if user is None:
        # 200 dönülür ki RevenueCat aynı olayı sonsuza kadar tekrar göndermesin
        logger.warning("RevenueCat olayı için kullanıcı bulunamadı: type=%s", event_type)
        return {"status": "ignored"}

    expiration = _ms_to_dt(event.get("expiration_at_ms"))
    if event_type in GRANT_EVENTS and expiration is not None:
        current = _aware(user.premium_until)
        # Sıra dışı gelen eski bir olay daha uzun süreyi kısaltmasın
        if current is None or expiration > current or user.plan_source != "revenuecat":
            grant_premium(db, user, expiration, "revenuecat")
        logger.info("Premium güncellendi: user_id=%s, type=%s", user.id, event_type)
        return {"status": "ok"}

    if event_type in EXPIRE_EVENTS:
        if user.plan_source == "revenuecat":
            grant_premium(db, user, expiration or datetime.now(timezone.utc), "revenuecat")
        logger.info("Premium sona erdi: user_id=%s", user.id)
        return {"status": "ok"}

    return {"status": "ignored"}
