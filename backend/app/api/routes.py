import datetime as dt
import logging
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path
from typing import List, Optional, Union

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.receipt import Receipt, ReceiptItem
from app.models.user import User
from app.schemas.receipt import (
    CategoryBreakdown,
    PriceHistoryResponse,
    PriceWatchResponse,
    ReceiptResponse,
    ReceiptSummaryResponse,
    ReceiptUpdate,
)
from app.services.billing import ensure_quota, record_usage
from app.services.price_watch import price_history, price_watch
from app.services.ai_errors import is_quota_error, quota_exceeded
from app.services.receipt_parser import ReceiptParseError, receipt_parser_service

logger = logging.getLogger("cebio")

router = APIRouter(prefix="/api/v1/receipts", tags=["Receipts"])

ALLOWED_MIME_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
}

EXTENSION_TO_MIME = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}

CENT = Decimal("0.01")
MILLI = Decimal("0.001")
ONE = Decimal("1")

Number = Union[float, int, str, Decimal, None]


# --- Yardımcılar ---

def to_money(value: Number) -> Decimal:
    """Herhangi bir sayısal değeri 2 haneli Decimal tutara çevirir (float hatasız)."""
    try:
        return Decimal(str(value if value is not None else 0)).quantize(CENT, rounding=ROUND_HALF_UP)
    except InvalidOperation:
        return Decimal("0.00")


def to_quantity(value: Number) -> Decimal:
    try:
        qty = Decimal(str(value)).quantize(MILLI, rounding=ROUND_HALF_UP) if value is not None else ONE
    except InvalidOperation:
        return ONE
    return qty if qty > 0 else ONE


def parse_receipt_date(raw: str) -> dt.date:
    """Gemini'den gelen tarih metnini date'e çevirir; okunamazsa bugünü kullanır."""
    try:
        return dt.date.fromisoformat((raw or "").strip()[:10])
    except ValueError:
        logger.info("Fiş tarihi okunamadı (%r); bugünün tarihi kullanılıyor.", raw)
        return dt.date.today()


def build_item(
    name: str,
    price: Number,
    quantity: Number,
    unit_price: Number,
    category: str,
) -> ReceiptItem:
    qty = to_quantity(quantity)
    line_price = to_money(price)
    unit = to_money(unit_price) if unit_price is not None else to_money(line_price / qty)
    return ReceiptItem(
        name=name.strip(),
        price=line_price,
        quantity=qty,
        unit_price=unit,
        category=(category or "").strip() or "Diğer",
    )


def resolve_image_mime_type(file: UploadFile) -> str:
    """
    Dosyanın MIME tipini doğrular ve standartlaştırır.
    content_type boş, 'application/octet-stream' veya tanımsız ise dosya uzantısına bakar.
    """
    raw_content_type = (file.content_type or "").strip().lower()

    if raw_content_type in ALLOWED_MIME_TYPES:
        return "image/jpeg" if raw_content_type == "image/jpg" else raw_content_type

    ext: Optional[str] = Path(file.filename or "").suffix.lower() if file.filename else None
    if ext and ext in EXTENSION_TO_MIME:
        return EXTENSION_TO_MIME[ext]

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Desteklenmeyen dosya formatı. Lütfen JPEG (.jpg/.jpeg), PNG (.png) veya WEBP (.webp) yükleyin.",
    )


def get_owned_receipt(db: Session, user: User, receipt_id: int) -> Receipt:
    receipt = db.scalars(
        select(Receipt).where(Receipt.id == receipt_id, Receipt.user_id == user.id)
    ).first()
    if not receipt:
        # Başka kullanıcıya ait fişler için de 404 döneriz (varlığı sızdırılmasın).
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"ID={receipt_id} olan fiş bulunamadı.",
        )
    return receipt


def apply_receipt_filters(
    stmt: Select,
    merchant: Optional[str],
    start_date: Optional[dt.date],
    end_date: Optional[dt.date],
) -> Select:
    if merchant and merchant.strip():
        stmt = stmt.where(Receipt.merchant.ilike(f"%{merchant.strip()}%"))
    if start_date:
        stmt = stmt.where(Receipt.date >= start_date)
    if end_date:
        stmt = stmt.where(Receipt.date <= end_date)
    return stmt


# --- Uç noktalar ---

@router.post(
    "/upload",
    response_model=ReceiptResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Fiş fotoğrafı yükle ve ayrıştır",
    description="Yüklenen fiş görselini Google Gemini ile analiz eder, ürünleri kaydeder ve sonucu döner.",
)
async def upload_receipt(
    file: UploadFile = File(..., description="Analiz edilecek fiş görseli (JPEG, PNG, WEBP)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Receipt:
    resolved_mime_type = resolve_image_mime_type(file)

    max_bytes = settings.max_upload_bytes
    image_bytes = await file.read(max_bytes + 1)
    if not image_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Yüklenen dosya boş.")
    if len(image_bytes) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Dosya çok büyük. En fazla {settings.MAX_UPLOAD_MB} MB yükleyebilirsiniz.",
        )

    ensure_quota(db, current_user, "receipt_scan")

    try:
        parsed_data = await receipt_parser_service.parse_receipt_image(
            image_bytes=image_bytes,
            mime_type=resolved_mime_type,
        )
    except ReceiptParseError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    except Exception as exc:
        if is_quota_error(exc):
            logger.warning("Gemini kotası doldu (user_id=%s)", current_user.id)
            raise quota_exceeded() from exc
        # İç hata detayları kullanıcıya sızdırılmaz, sadece loglanır.
        logger.exception("Fiş ayrıştırma servisi hatası (user_id=%s)", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Fiş analiz servisine şu anda ulaşılamıyor. Lütfen biraz sonra tekrar deneyin.",
        ) from exc

    receipt = Receipt(
        user_id=current_user.id,
        merchant=parsed_data.merchant.strip() or "Bilinmeyen İşletme",
        date=parse_receipt_date(parsed_data.date),
        total_amount=to_money(parsed_data.total_amount),
        items=[
            build_item(item.name, item.price, item.quantity, item.unit_price, item.category)
            for item in parsed_data.items
            if item.name and item.name.strip()
        ],
    )

    db.add(receipt)
    db.commit()
    db.refresh(receipt)
    record_usage(db, current_user, "receipt_scan")
    return receipt


@router.get(
    "/summary",
    response_model=ReceiptSummaryResponse,
    summary="Harcama ve kategori özetini getir",
    description="Filtrelere (mağaza, tarih aralığı) uyan fişlerin toplamını ve kategori kırılımını döner.",
)
def get_receipts_summary(
    merchant: Optional[str] = Query(None, description="Mağaza adına göre arama"),
    start_date: Optional[dt.date] = Query(None, description="Başlangıç tarihi (YYYY-MM-DD, dahil)"),
    end_date: Optional[dt.date] = Query(None, description="Bitiş tarihi (YYYY-MM-DD, dahil)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ReceiptSummaryResponse:
    receipt_ids = apply_receipt_filters(
        select(Receipt.id).where(Receipt.user_id == current_user.id),
        merchant,
        start_date,
        end_date,
    ).scalar_subquery()

    total_receipts, total_amount = db.execute(
        select(func.count(Receipt.id), func.coalesce(func.sum(Receipt.total_amount), 0)).where(
            Receipt.id.in_(receipt_ids)
        )
    ).one()

    category_rows = db.execute(
        select(
            ReceiptItem.category,
            func.coalesce(func.sum(ReceiptItem.price), 0).label("total_amount"),
            func.coalesce(func.sum(ReceiptItem.quantity), 0).label("item_count"),
        )
        .where(ReceiptItem.receipt_id.in_(receipt_ids))
        .group_by(ReceiptItem.category)
        .order_by(func.sum(ReceiptItem.price).desc())
    ).all()

    return ReceiptSummaryResponse(
        total_receipts=int(total_receipts),
        total_amount=to_money(total_amount),
        category_breakdown=[
            CategoryBreakdown(
                category=row.category,
                total_amount=to_money(row.total_amount),
                item_count=float(to_quantity(row.item_count)) if row.item_count else 0.0,
            )
            for row in category_rows
        ],
    )


@router.get(
    "",
    response_model=List[ReceiptResponse],
    summary="Fişleri listele ve filtrele",
    description="Fişleri mağaza adına, ürün kategorisine ve tarih aralığına göre filtreleyerek listeler.",
)
def list_receipts(
    merchant: Optional[str] = Query(None, description="Mağaza adına göre büyük/küçük harf duyarsız arama"),
    category: Optional[str] = Query(None, description="Ürün kategorisine göre filtreleme (Örn: Gıda)"),
    start_date: Optional[dt.date] = Query(None, description="Başlangıç tarihi (YYYY-MM-DD, dahil)"),
    end_date: Optional[dt.date] = Query(None, description="Bitiş tarihi (YYYY-MM-DD, dahil)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[Receipt]:
    stmt = apply_receipt_filters(
        select(Receipt).where(Receipt.user_id == current_user.id),
        merchant,
        start_date,
        end_date,
    )
    if category and category.strip():
        stmt = stmt.where(Receipt.items.any(ReceiptItem.category.ilike(category.strip())))

    stmt = stmt.order_by(Receipt.date.desc(), Receipt.id.desc())
    return list(db.scalars(stmt).all())


@router.post(
    "",
    response_model=ReceiptResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Fişi elle ekle (yapay zeka kullanmaz, limit yemez)",
)
def create_receipt(
    payload: ReceiptUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Receipt:
    receipt = Receipt(
        user_id=current_user.id,
        merchant=payload.merchant.strip(),
        date=payload.date,
        total_amount=to_money(payload.total_amount),
        items=[
            build_item(item.name, item.price, item.quantity, item.unit_price, item.category)
            for item in payload.items
        ],
    )
    db.add(receipt)
    db.commit()
    db.refresh(receipt)
    return receipt


@router.get(
    "/price-watch",
    response_model=PriceWatchResponse,
    summary="Kişisel enflasyon: tekrar alınan ürünlerin fiyat değişimi",
)
def get_price_watch(
    months: int = Query(12, ge=1, le=36),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return price_watch(db, current_user.id, months=months)


@router.get(
    "/price-history",
    response_model=PriceHistoryResponse,
    summary="Bir ürünün fişlerdeki birim fiyat geçmişi",
)
def get_price_history(
    q: str = Query(..., min_length=2, max_length=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return price_history(db, current_user.id, q)


@router.get("/{receipt_id}", response_model=ReceiptResponse, summary="Tekil fiş detayını getir")
def get_receipt(
    receipt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Receipt:
    return get_owned_receipt(db, current_user, receipt_id)


@router.put(
    "/{receipt_id}",
    response_model=ReceiptResponse,
    summary="Fişi ve ürünlerini güncelle",
)
def update_receipt(
    receipt_id: int,
    payload: ReceiptUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Receipt:
    receipt = get_owned_receipt(db, current_user, receipt_id)

    receipt.merchant = payload.merchant.strip()
    receipt.date = payload.date
    receipt.total_amount = to_money(payload.total_amount)
    receipt.items = [
        build_item(item.name, item.price, item.quantity, item.unit_price, item.category)
        for item in payload.items
    ]

    db.commit()
    db.refresh(receipt)
    return receipt


@router.delete(
    "/{receipt_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Fişi ve alt ürünlerini sil",
)
def delete_receipt(
    receipt_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    receipt = get_owned_receipt(db, current_user, receipt_id)
    db.delete(receipt)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
