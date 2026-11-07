"""Ekstre işlemlerini önizleme ve içe aktarma.

- Mükerrer koruma: her işlem için (tarih, tutar, sadeleştirilmiş açıklama, aynı gün içindeki sıra) üzerinden
  bir parmak izi üretilir; aynı ekstre ikinci kez yüklense de işlemler tekrar eklenmez.
- Fiş eşleştirme: aynı tutarda ve ±3 gün içinde kayıtlı bir fiş varsa işlem o fişle eşleştirilir ve
  toplamlarda iki kez sayılmaz (fiş ürün ürün daha ayrıntılı olduğu için fiş esas alınır).
"""
import datetime as dt
import hashlib
from collections import Counter
from decimal import ROUND_HALF_UP, Decimal
from typing import Dict, Iterable, List, Optional, Sequence, Set

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.receipt import Receipt
from app.models.transaction import StatementImport, Transaction
from app.schemas.statement import ImportResult, MatchedReceipt, PreviewRow, StatementRow
from app.services.categories import normalize_category
from app.services.subscription_catalog import match_catalog, normalize_text
from app.services.subscription_detector import merchant_key

CENT = Decimal("0.01")
RECEIPT_MATCH_DAYS = 3


def money(value: Decimal | float) -> Decimal:
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


def display_merchant(description: str) -> str:
    """'MIGROS SANAL MARKET ISTANBUL TR 1234' -> 'Migros Sanal Market'; katalogdaki servislerde resmi ad."""
    item = match_catalog(description)
    if item:
        return item["name"]
    key = merchant_key(description)
    if key:
        return " ".join(word.capitalize() for word in key.split())[:120]
    return description.strip()[:120] or "Bilinmeyen"


def fingerprints(rows: Sequence[StatementRow]) -> List[str]:
    """Satır başına parmak izi. Aynı gün aynı yerde aynı tutarda iki işlem varsa sıra numarasıyla ayrışır."""
    seen: Counter = Counter()
    result = []
    for row in rows:
        base = f"{row.date.isoformat()}|{money(row.amount)}|{row.currency}|{normalize_text(row.description)}"
        seen[base] += 1
        result.append(hashlib.sha256(f"{base}|{seen[base]}".encode("utf-8")).hexdigest())
    return result


def _existing_fingerprints(db: Session, user_id: int, candidates: Iterable[str]) -> Set[str]:
    values = list(set(candidates))
    found: Set[str] = set()
    # SQLite'ın parametre sınırına takılmamak için parçalar halinde sorgula
    for i in range(0, len(values), 500):
        chunk = values[i : i + 500]
        found.update(
            db.scalars(
                select(Transaction.fingerprint).where(
                    Transaction.user_id == user_id, Transaction.fingerprint.in_(chunk)
                )
            ).all()
        )
    return found


class ReceiptMatcher:
    """Kullanıcının fişleri arasında tutar + tarih yakınlığına göre eşleşme arar; bir fiş yalnızca bir kez eşleşir."""

    def __init__(self, db: Session, user_id: int, rows: Sequence[StatementRow]) -> None:
        self.by_amount: Dict[Decimal, List[Receipt]] = {}
        self.used: Set[int] = set()
        if not rows:
            return
        start = min(r.date for r in rows) - dt.timedelta(days=RECEIPT_MATCH_DAYS)
        end = max(r.date for r in rows) + dt.timedelta(days=RECEIPT_MATCH_DAYS)
        receipts = db.scalars(
            select(Receipt).where(Receipt.user_id == user_id, Receipt.date >= start, Receipt.date <= end)
        ).all()
        for receipt in receipts:
            self.by_amount.setdefault(money(receipt.total_amount), []).append(receipt)
        # Zaten bir banka işlemiyle eşleşmiş fişler tekrar eşleşmesin
        receipt_ids = [r.id for r in receipts]
        if receipt_ids:
            self.used.update(
                rid
                for rid in db.scalars(
                    select(Transaction.matched_receipt_id).where(
                        Transaction.user_id == user_id, Transaction.matched_receipt_id.in_(receipt_ids)
                    )
                ).all()
                if rid is not None
            )

    def match(self, row: StatementRow) -> Optional[Receipt]:
        if row.currency != "TRY":
            return None
        best: Optional[Receipt] = None
        for receipt in self.by_amount.get(money(row.amount), []):
            if receipt.id in self.used:
                continue
            gap = abs((receipt.date - row.date).days)
            if gap <= RECEIPT_MATCH_DAYS and (best is None or gap < abs((best.date - row.date).days)):
                best = receipt
        if best is not None:
            self.used.add(best.id)
        return best


def build_preview(db: Session, user_id: int, rows: Sequence[StatementRow]) -> List[PreviewRow]:
    prints = fingerprints(rows)
    existing = _existing_fingerprints(db, user_id, prints)
    matcher = ReceiptMatcher(db, user_id, rows)
    preview = []
    for row, fp in zip(rows, prints):
        already = fp in existing
        receipt = None if already else matcher.match(row)
        preview.append(
            PreviewRow(
                date=row.date,
                description=row.description,
                merchant=display_merchant(row.description),
                amount=money(row.amount),
                currency=row.currency,
                category=normalize_category(row.category),
                already_imported=already,
                matched_receipt=(
                    MatchedReceipt(id=receipt.id, merchant=receipt.merchant, date=receipt.date) if receipt else None
                ),
            )
        )
    return preview


def import_rows(db: Session, user_id: int, filename: str, rows: Sequence[StatementRow]) -> ImportResult:
    prints = fingerprints(rows)
    existing = _existing_fingerprints(db, user_id, prints)
    fresh = [(row, fp) for row, fp in zip(rows, prints) if fp not in existing]
    skipped = len(rows) - len(fresh)
    if not fresh:
        return ImportResult(import_id=None, imported=0, skipped_duplicates=skipped, matched_receipts=0)

    statement = StatementImport(
        user_id=user_id,
        filename=(filename or "ekstre").strip()[:255] or "ekstre",
        period_start=min(r.date for r, _ in fresh),
        period_end=max(r.date for r, _ in fresh),
    )
    db.add(statement)
    db.flush()

    matcher = ReceiptMatcher(db, user_id, [r for r, _ in fresh])
    matched = 0
    for row, fp in fresh:
        receipt = matcher.match(row)
        matched += receipt is not None
        db.add(
            Transaction(
                user_id=user_id,
                import_id=statement.id,
                date=row.date,
                description=row.description.strip()[:255],
                merchant=display_merchant(row.description),
                amount=money(row.amount),
                currency=row.currency,
                category=normalize_category(row.category),
                fingerprint=fp,
                matched_receipt_id=receipt.id if receipt else None,
            )
        )
    db.commit()
    return ImportResult(import_id=statement.id, imported=len(fresh), skipped_duplicates=skipped, matched_receipts=matched)
