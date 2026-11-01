from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.receipt import Receipt, ReceiptItem
from app.schemas.receipt import (
    CategoryBreakdown,
    ReceiptResponse,
    ReceiptSummaryResponse,
)
from app.services.receipt_parser import receipt_parser_service

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


def resolve_image_mime_type(file: UploadFile) -> str:
    """
    Dosyanın MIME tipini doğrular ve standartlaştırır.
    content_type boş, 'application/octet-stream' veya tanımsız ise dosya uzantısına (.jpg, .jpeg, .png, .webp) bakar.
    """
    raw_content_type = (file.content_type or "").strip().lower()

    if raw_content_type in ALLOWED_MIME_TYPES:
        return "image/jpeg" if raw_content_type == "image/jpg" else raw_content_type

    # Fallback: dosya uzantısından kontrol et
    ext: Optional[str] = Path(file.filename or "").suffix.lower() if file.filename else None
    if ext and ext in EXTENSION_TO_MIME:
        return EXTENSION_TO_MIME[ext]

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(
            f"Desteklenmeyen dosya formatı (content_type='{raw_content_type}', filename='{file.filename}'). "
            "Lütfen JPEG (.jpg/.jpeg), PNG (.png) veya WEBP (.webp) yükleyin."
        ),
    )


@router.post(
    "/upload",
    response_model=ReceiptResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Fiş fotoğrafı yükle ve ayrıştır",
    description="Yüklenen fiş görselini Google Gemini ile analiz eder, ürünleri SQLite veritabanına kaydeder ve sonucu döner.",
)
async def upload_receipt(
    file: UploadFile = File(..., description="Analiz edilecek fiş görseli (JPEG, PNG, WEBP)"),
    db: Session = Depends(get_db),
) -> Receipt:
    resolved_mime_type = resolve_image_mime_type(file)

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Yüklenen dosya boş.",
        )

    try:
        parsed_data = receipt_parser_service.parse_receipt_image(
            image_bytes=image_bytes,
            mime_type=resolved_mime_type,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Fiş ayrıştırma servisi hatası: {str(exc)}",
        ) from exc

    receipt = Receipt(
        merchant=parsed_data.merchant,
        date=parsed_data.date,
        total_amount=parsed_data.total_amount,
        items=[
            ReceiptItem(
                name=item.name,
                price=item.price,
                quantity=item.quantity if item.quantity and item.quantity > 0 else 1.0,
                unit_price=item.unit_price,
                category=item.category,
            )
            for item in parsed_data.items
        ],
    )

    db.add(receipt)
    db.commit()
    db.refresh(receipt)

    return receipt


@router.get(
    "/summary",
    response_model=ReceiptSummaryResponse,
    summary="Harcama ve kategori özetini getir",
    description="Tüm fişler üzerindeki toplam fiş sayısını, genel harcama tutarını ve kategori bazlı harcama kırılımını döner.",
)
def get_receipts_summary(db: Session = Depends(get_db)) -> ReceiptSummaryResponse:
    totals_stmt = select(
        func.count(Receipt.id),
        func.coalesce(func.sum(Receipt.total_amount), 0.0),
    )
    total_receipts, total_amount = db.execute(totals_stmt).one()

    category_stmt = (
        select(
            ReceiptItem.category,
            func.coalesce(func.sum(ReceiptItem.price), 0.0).label("total_amount"),
            func.coalesce(func.sum(ReceiptItem.quantity), 0.0).label("item_count"),
        )
        .group_by(ReceiptItem.category)
        .order_by(func.sum(ReceiptItem.price).desc())
    )
    category_rows = db.execute(category_stmt).all()

    breakdown = [
        CategoryBreakdown(
            category=row.category,
            total_amount=round(float(row.total_amount), 2),
            item_count=int(row.item_count),
        )
        for row in category_rows
    ]

    return ReceiptSummaryResponse(
        total_receipts=int(total_receipts),
        total_amount=round(float(total_amount), 2),
        category_breakdown=breakdown,
    )


@router.get(
    "",
    response_model=List[ReceiptResponse],
    summary="Kaydedilen tüm fişleri listele ve filtrele",
    description="Kaydedilen fişleri mağaza adına (küçük/büyük harf duyarsız) ve tarih aralığına (YYYY-MM-DD) göre filtreleyerek listeler.",
)
def list_receipts(
    merchant: Optional[str] = Query(
        None,
        description="Mağaza/market adına göre küçük-büyük harf duyarsız arama",
    ),
    start_date: Optional[str] = Query(
        None,
        description="Başlangıç tarihi filtresi (YYYY-MM-DD, dahil)",
    ),
    end_date: Optional[str] = Query(
        None,
        description="Bitiş tarihi filtresi (YYYY-MM-DD, dahil)",
    ),
    db: Session = Depends(get_db),
) -> List[Receipt]:
    stmt = select(Receipt)

    if merchant:
        stmt = stmt.where(Receipt.merchant.ilike(f"%{merchant.strip()}%"))
    if start_date:
        stmt = stmt.where(Receipt.date >= start_date.strip())
    if end_date:
        stmt = stmt.where(Receipt.date <= end_date.strip())

    stmt = stmt.order_by(Receipt.id.desc())
    return list(db.scalars(stmt).all())


@router.get(
    "/{receipt_id}",
    response_model=ReceiptResponse,
    summary="Tekil fiş detayını getir",
)
def get_receipt(receipt_id: int, db: Session = Depends(get_db)) -> Receipt:
    stmt = select(Receipt).where(Receipt.id == receipt_id)
    receipt = db.scalars(stmt).first()
    if not receipt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"ID={receipt_id} olan fiş bulunamadı.",
        )
    return receipt


@router.delete(
    "/{receipt_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Fişi ve alt ürünlerini sil",
    description="Belirtilen ID'ye sahip fişi ve ona bağlı tüm ürünleri veritabanından siler.",
)
def delete_receipt(receipt_id: int, db: Session = Depends(get_db)) -> Response:
    stmt = select(Receipt).where(Receipt.id == receipt_id)
    receipt = db.scalars(stmt).first()
    if not receipt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"ID={receipt_id} olan fiş bulunamadı.",
        )

    db.delete(receipt)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
