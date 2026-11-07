import datetime as dt
import logging
from collections import defaultdict
from decimal import Decimal
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.routes import to_money
from app.core.config import settings
from app.core.database import get_db
from app.models.subscription import Subscription, SubscriptionPriceChange
from app.models.user import User
from app.schemas.subscription import (
    CatalogEntry,
    CategoryTotal,
    CurrencyTotal,
    DetectionResponse,
    PriceChangeResponse,
    SubscriptionCreate,
    SubscriptionResponse,
    SubscriptionStatus,
    SubscriptionSummary,
    SubscriptionUpdate,
)
from app.services.ai_errors import is_quota_error, quota_exceeded
from app.services.receipt_parser import ReceiptParseError
from app.services.statement_parser import statement_parser_service
from app.services.subscription_catalog import CATALOG, match_catalog, normalize_text
from app.services.subscription_detector import detect_subscriptions
from app.services.subscription_logic import monthly_equivalent, roll_forward, yearly_equivalent

logger = logging.getLogger("cebio")

router = APIRouter(prefix="/api/v1/subscriptions", tags=["Subscriptions"])

BILLABLE_STATUSES = {SubscriptionStatus.active.value, SubscriptionStatus.trial.value}
PRICE_INCREASE_WINDOW_DAYS = 90

STATEMENT_MIME_BY_EXT = {
    ".pdf": "application/pdf",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}
STATEMENT_MIMES = set(STATEMENT_MIME_BY_EXT.values()) | {"application/vnd.ms-excel"}


def today() -> dt.date:
    return dt.date.today()


# --- Yardımcılar ---

def to_response(sub: Subscription, ref_date: dt.date) -> SubscriptionResponse:
    last_change = sub.price_changes[0] if sub.price_changes else None
    return SubscriptionResponse(
        id=sub.id,
        name=sub.name,
        amount=sub.amount,
        currency=sub.currency,
        billing_cycle=sub.billing_cycle,
        next_billing_date=sub.next_billing_date,
        category=sub.category,
        status=sub.status,
        trial_ends_at=sub.trial_ends_at,
        cancel_url=sub.cancel_url,
        notes=sub.notes,
        created_at=sub.created_at,
        monthly_equivalent=monthly_equivalent(sub.amount, sub.billing_cycle),
        days_until_next=(sub.next_billing_date - ref_date).days,
        last_price_change=PriceChangeResponse.model_validate(last_change) if last_change else None,
    )


def refresh_due_dates(db: Session, subs: List[Subscription], ref_date: dt.date) -> None:
    """Geçmişte kalan ödeme tarihlerini ileri taşır, süresi biten denemeleri aktife çevirir."""
    changed = False
    for sub in subs:
        if sub.status == SubscriptionStatus.trial.value and sub.trial_ends_at and sub.trial_ends_at < ref_date:
            sub.status = SubscriptionStatus.active.value
            changed = True
        if sub.status in BILLABLE_STATUSES and sub.next_billing_date < ref_date:
            sub.next_billing_date = roll_forward(sub.next_billing_date, sub.billing_cycle, ref_date)
            changed = True
    if changed:
        db.commit()


def load_user_subscriptions(db: Session, user: User) -> List[Subscription]:
    subs = list(
        db.scalars(
            select(Subscription)
            .where(Subscription.user_id == user.id)
            .order_by(Subscription.next_billing_date, Subscription.id)
        ).all()
    )
    refresh_due_dates(db, subs, today())
    return subs


def get_owned_subscription(db: Session, user: User, subscription_id: int) -> Subscription:
    sub = db.scalars(
        select(Subscription).where(Subscription.id == subscription_id, Subscription.user_id == user.id)
    ).first()
    if not sub:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Abonelik bulunamadı.")
    return sub


def apply_fields(sub: Subscription, payload: SubscriptionCreate | SubscriptionUpdate) -> None:
    sub.name = payload.name.strip()
    sub.currency = payload.currency
    sub.billing_cycle = payload.billing_cycle.value
    sub.next_billing_date = payload.next_billing_date
    sub.category = payload.category.strip()
    sub.status = payload.status.value
    sub.trial_ends_at = payload.trial_ends_at
    sub.cancel_url = payload.cancel_url
    sub.notes = (payload.notes or "").strip() or None


def _sorted_totals(totals: Dict[str, Decimal]) -> List[CurrencyTotal]:
    # TRY her zaman başta
    return [
        CurrencyTotal(currency=cur, amount=to_money(amount))
        for cur, amount in sorted(totals.items(), key=lambda kv: (kv[0] != "TRY", kv[0]))
    ]


# --- Uç noktalar ---

@router.get("/catalog", response_model=List[CatalogEntry], summary="Hazır abonelik kataloğu")
def get_catalog(_: User = Depends(get_current_user)) -> List[CatalogEntry]:
    return [
        CatalogEntry(
            key=item["key"],
            name=item["name"],
            category=item["category"],
            default_cycle=item["default_cycle"],
            cancel_url=item["cancel_url"],
        )
        for item in CATALOG
    ]


@router.get("/summary", response_model=SubscriptionSummary, summary="Aylık/yıllık sabit gider özeti")
def get_summary(
    days: int = Query(7, ge=1, le=60, description="Kaç gün içindeki yenilemeler 'yaklaşan' sayılsın"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SubscriptionSummary:
    ref = today()
    subs = load_user_subscriptions(db, current_user)
    horizon = ref + dt.timedelta(days=days)

    monthly: Dict[str, Decimal] = defaultdict(Decimal)
    yearly: Dict[str, Decimal] = defaultdict(Decimal)
    by_category: Dict[str, List[Decimal]] = defaultdict(list)
    upcoming, trials_ending, increases = [], [], []

    for sub in subs:
        if sub.status == SubscriptionStatus.active.value:
            monthly[sub.currency] += monthly_equivalent(sub.amount, sub.billing_cycle)
            yearly[sub.currency] += yearly_equivalent(sub.amount, sub.billing_cycle)
            if sub.currency == "TRY":
                by_category[sub.category].append(monthly_equivalent(sub.amount, sub.billing_cycle))

        if sub.status in BILLABLE_STATUSES and sub.next_billing_date <= horizon:
            upcoming.append(to_response(sub, ref))

        if (
            sub.status == SubscriptionStatus.trial.value
            and sub.trial_ends_at
            and ref <= sub.trial_ends_at <= horizon
        ):
            trials_ending.append(to_response(sub, ref))

        last = sub.price_changes[0] if sub.price_changes else None
        if (
            sub.status in BILLABLE_STATUSES
            and last
            and last.new_amount > last.old_amount
            and (ref - last.changed_at).days <= PRICE_INCREASE_WINDOW_DAYS
        ):
            increases.append(to_response(sub, ref))

    categories = sorted(
        (
            CategoryTotal(category=cat, monthly_amount=to_money(sum(values, Decimal(0))), count=len(values))
            for cat, values in by_category.items()
        ),
        key=lambda c: c.monthly_amount,
        reverse=True,
    )

    return SubscriptionSummary(
        active_count=sum(1 for s in subs if s.status in BILLABLE_STATUSES),
        monthly_totals=_sorted_totals(monthly),
        yearly_totals=_sorted_totals(yearly),
        by_category=categories,
        upcoming=upcoming,
        trials_ending=trials_ending,
        recent_price_increases=increases,
    )


@router.post(
    "/detect",
    response_model=DetectionResponse,
    summary="Banka/kart ekstresinden abonelikleri tespit et",
    description="PDF, CSV veya ekran görüntüsü olarak yüklenen ekstredeki tekrarlayan ödemeleri bulur. "
    "Hiçbir şey kaydedilmez; kullanıcı onayladığı adayları ayrıca ekler.",
)
async def detect_from_statement(
    file: UploadFile = File(..., description="Ekstre dosyası (PDF, CSV, TXT, JPEG, PNG, WEBP)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DetectionResponse:
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    ext = Path(file.filename or "").suffix.lower()
    mime: Optional[str] = STATEMENT_MIME_BY_EXT.get(ext)
    if mime is None and content_type in STATEMENT_MIMES:
        mime = "text/csv" if content_type == "application/vnd.ms-excel" else content_type
    if mime is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Desteklenmeyen dosya. Lütfen ekstreyi PDF, CSV veya ekran görüntüsü olarak yükleyin.",
        )

    max_bytes = settings.max_upload_bytes
    data = await file.read(max_bytes + 1)
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Yüklenen dosya boş.")
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Dosya çok büyük. En fazla {settings.MAX_UPLOAD_MB} MB yükleyebilirsiniz.",
        )

    try:
        parsed = await statement_parser_service.parse_statement(data, mime)
    except ReceiptParseError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    except Exception as exc:
        if is_quota_error(exc):
            logger.warning("Gemini kotası doldu (user_id=%s)", current_user.id)
            raise quota_exceeded() from exc
        logger.exception("Ekstre ayrıştırma hatası (user_id=%s)", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Ekstre analiz servisine şu anda ulaşılamıyor. Lütfen biraz sonra tekrar deneyin.",
        ) from exc

    candidates = detect_subscriptions(parsed.transactions, today())

    existing = load_user_subscriptions(db, current_user)
    tracked_keys = set()
    for sub in existing:
        if sub.status == SubscriptionStatus.cancelled.value:
            continue
        item = match_catalog(sub.name)
        tracked_keys.add(item["key"] if item else normalize_text(sub.name))
    for cand in candidates:
        item = match_catalog(cand.name)
        cand.already_tracked = (item["key"] if item else normalize_text(cand.name)) in tracked_keys

    return DetectionResponse(transactions_found=len(parsed.transactions), candidates=candidates)


@router.get("", response_model=List[SubscriptionResponse], summary="Abonelikleri listele")
def list_subscriptions(
    status_filter: Optional[SubscriptionStatus] = Query(None, alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[SubscriptionResponse]:
    ref = today()
    subs = load_user_subscriptions(db, current_user)
    if status_filter:
        subs = [s for s in subs if s.status == status_filter.value]
    return [to_response(s, ref) for s in subs]


@router.post(
    "",
    response_model=SubscriptionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Yeni abonelik ekle",
)
def create_subscription(
    payload: SubscriptionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SubscriptionResponse:
    sub = Subscription(user_id=current_user.id, amount=to_money(payload.amount))
    apply_fields(sub, payload)
    db.add(sub)
    db.commit()
    db.refresh(sub)
    refresh_due_dates(db, [sub], today())
    return to_response(sub, today())


@router.get("/{subscription_id}", response_model=SubscriptionResponse, summary="Tekil abonelik")
def get_subscription(
    subscription_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SubscriptionResponse:
    sub = get_owned_subscription(db, current_user, subscription_id)
    refresh_due_dates(db, [sub], today())
    return to_response(sub, today())


@router.put(
    "/{subscription_id}",
    response_model=SubscriptionResponse,
    summary="Aboneliği güncelle (ücret değişikliği zam geçmişine yazılır)",
)
def update_subscription(
    subscription_id: int,
    payload: SubscriptionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SubscriptionResponse:
    sub = get_owned_subscription(db, current_user, subscription_id)
    new_amount = to_money(payload.amount)
    if new_amount != to_money(sub.amount):
        sub.price_changes.insert(
            0,
            SubscriptionPriceChange(old_amount=to_money(sub.amount), new_amount=new_amount, changed_at=today()),
        )
        sub.amount = new_amount
    apply_fields(sub, payload)
    db.commit()
    db.refresh(sub)
    refresh_due_dates(db, [sub], today())
    return to_response(sub, today())


@router.delete(
    "/{subscription_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Aboneliği sil",
)
def delete_subscription(
    subscription_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    sub = get_owned_subscription(db, current_user, subscription_id)
    db.delete(sub)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
