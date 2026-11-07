import datetime as dt
import logging
from decimal import Decimal, InvalidOperation
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.subscriptions import mark_already_tracked
from app.api.uploads import parse_statement_or_http, read_statement_upload
from app.core.database import get_db
from app.models.transaction import StatementImport, Transaction
from app.models.user import User
from app.schemas.statement import (
    ImportRequest,
    ImportResult,
    StatementImportResponse,
    StatementPreview,
    StatementRow,
    TransactionResponse,
    TransactionUpdate,
)
from app.schemas.subscription import StatementTransaction
from app.services.analytics import matches, same_category
from app.services.statement_import import build_preview, import_rows
from app.services.subscription_detector import detect_subscriptions

logger = logging.getLogger("cebio")

router = APIRouter(prefix="/api/v1", tags=["Bank Statements"])


def today() -> dt.date:
    return dt.date.today()


def to_rows(parsed: List[StatementTransaction]) -> List[StatementRow]:
    """Gemini çıktısını doğrulanmış satırlara çevirir; tarihi/tutarı okunamayan satırları atlar."""
    rows = []
    for tx in parsed:
        try:
            amount = Decimal(str(tx.amount))
            rows.append(
                StatementRow(
                    date=dt.date.fromisoformat((tx.date or "").strip()[:10]),
                    description=(tx.description or "").strip()[:255] or "Bilinmeyen işlem",
                    amount=amount,
                    currency=(tx.currency or "TRY").strip()[:3] or "TRY",
                    category=tx.category or "Diğer",
                )
            )
        except (ValueError, InvalidOperation, ValidationError):
            logger.info("Ekstre satırı atlandı: %r", tx)
    rows.sort(key=lambda r: r.date)
    return rows


@router.post(
    "/statements/preview",
    response_model=StatementPreview,
    summary="Ekstreyi oku ve içe aktarma önizlemesi göster",
    description="Hiçbir şey kaydedilmez. Mükerrer işlemleri, fişle eşleşenleri ve olası abonelikleri işaretler.",
)
async def preview_statement(
    file: UploadFile = File(..., description="Ekstre dosyası (PDF, CSV, TXT, JPEG, PNG, WEBP)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StatementPreview:
    data, mime = await read_statement_upload(file)
    parsed = await parse_statement_or_http(data, mime, current_user.id)

    rows = to_rows(parsed.transactions)
    preview = build_preview(db, current_user.id, rows)
    candidates = detect_subscriptions(parsed.transactions, today())
    mark_already_tracked(db, current_user, candidates)

    return StatementPreview(
        transactions_found=len(rows),
        new_count=sum(1 for r in preview if not r.already_imported),
        rows=preview,
        subscription_candidates=candidates,
    )


@router.post(
    "/statements/import",
    response_model=ImportResult,
    status_code=status.HTTP_201_CREATED,
    summary="Onaylanan ekstre satırlarını harcama olarak kaydet",
)
def import_statement(
    payload: ImportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ImportResult:
    return import_rows(db, current_user.id, payload.filename, payload.rows)


@router.get("/statements", response_model=List[StatementImportResponse], summary="İçe aktarılan ekstreler")
def list_imports(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[StatementImportResponse]:
    rows = db.execute(
        select(
            StatementImport,
            func.count(Transaction.id),
            func.coalesce(func.sum(Transaction.amount), 0),
        )
        .outerjoin(Transaction, Transaction.import_id == StatementImport.id)
        .where(StatementImport.user_id == current_user.id)
        .group_by(StatementImport.id)
        .order_by(StatementImport.created_at.desc(), StatementImport.id.desc())
    ).all()
    return [
        StatementImportResponse(
            id=imp.id,
            filename=imp.filename,
            period_start=imp.period_start,
            period_end=imp.period_end,
            created_at=imp.created_at,
            transaction_count=int(count),
            total=Decimal(str(total)).quantize(Decimal("0.01")),
        )
        for imp, count, total in rows
    ]


@router.delete(
    "/statements/{import_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="İçe aktarmayı geri al (ekstre ve tüm işlemleri silinir)",
)
def delete_import(
    import_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    imp = db.scalars(
        select(StatementImport).where(StatementImport.id == import_id, StatementImport.user_id == current_user.id)
    ).first()
    if not imp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ekstre bulunamadı.")
    db.delete(imp)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/transactions", response_model=List[TransactionResponse], summary="Banka/kart harcamalarını listele")
def list_transactions(
    start_date: Optional[dt.date] = Query(None),
    end_date: Optional[dt.date] = Query(None),
    category: Optional[str] = Query(None, max_length=100),
    q: Optional[str] = Query(None, max_length=100, description="İşyeri/açıklamada arama"),
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[Transaction]:
    stmt = select(Transaction).where(Transaction.user_id == current_user.id)
    if start_date:
        stmt = stmt.where(Transaction.date >= start_date)
    if end_date:
        stmt = stmt.where(Transaction.date <= end_date)
    items = db.scalars(stmt.order_by(Transaction.date.desc(), Transaction.id.desc())).all()
    # Türkçe karakterlere duyarsız filtreleme Python tarafında yapılır (SQLite ILIKE yalnızca ASCII)
    result = [
        t
        for t in items
        if same_category(t.category, category) and (matches(t.merchant, q) or matches(t.description, q))
    ]
    return result[:limit]


def _owned_transaction(db: Session, user: User, transaction_id: int) -> Transaction:
    tx = db.scalars(
        select(Transaction).where(Transaction.id == transaction_id, Transaction.user_id == user.id)
    ).first()
    if not tx:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="İşlem bulunamadı.")
    return tx


@router.patch("/transactions/{transaction_id}", response_model=TransactionResponse, summary="İşlem kategorisini değiştir")
def update_transaction(
    transaction_id: int,
    payload: TransactionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Transaction:
    tx = _owned_transaction(db, current_user, transaction_id)
    tx.category = payload.category
    db.commit()
    db.refresh(tx)
    return tx


@router.delete("/transactions/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT, summary="İşlemi sil")
def delete_transaction(
    transaction_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    tx = _owned_transaction(db, current_user, transaction_id)
    db.delete(tx)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
