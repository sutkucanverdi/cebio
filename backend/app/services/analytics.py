"""Harcama analizleri: hem REST API hem de AI asistanın araçları bu fonksiyonları kullanır.

Tüm fonksiyonlar user_id ile sınırlıdır; bir kullanıcının verisi asla başkasına sızmaz.
Metin eşleştirmeleri (ürün adı, kategori, mağaza) Python tarafında Türkçe karakterlere
duyarsız yapılır, çünkü SQLite'ın ILIKE'ı yalnızca ASCII harflerde büyük/küçük harf ayırt etmez.
"""
import calendar
import datetime as dt
from collections import defaultdict
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.budget import Budget
from app.models.receipt import Receipt
from app.models.transaction import Transaction
from app.core.i18n import get_locale
from app.services.subscription_catalog import normalize_text

CENT = Decimal("0.01")
ZERO = Decimal("0.00")
TR_MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"]
EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

WARNING_RATIO = Decimal("0.8")


def money(value: Decimal | float | int | None) -> Decimal:
    return Decimal(str(value or 0)).quantize(CENT, rounding=ROUND_HALF_UP)


def matches(text: str, needle: Optional[str]) -> bool:
    if not needle or not needle.strip():
        return True
    return normalize_text(needle) in normalize_text(text)


def same_category(category: str, wanted: Optional[str]) -> bool:
    if not wanted or not wanted.strip():
        return True
    return normalize_text(category) == normalize_text(wanted)


@dataclass(frozen=True)
class MonthRange:
    key: str  # 2026-11
    label: str  # Kas 2026
    start: dt.date
    end: dt.date


def month_range(year: int, month: int) -> MonthRange:
    last_day = calendar.monthrange(year, month)[1]
    return MonthRange(
        key=f"{year:04d}-{month:02d}",
        label=f"{(EN_MONTHS if get_locale() == 'en' else TR_MONTHS)[month - 1]} {year}",
        start=dt.date(year, month, 1),
        end=dt.date(year, month, last_day),
    )


def parse_month(value: Optional[str], today: dt.date) -> MonthRange:
    """'2026-11' biçimindeki ayı çözer; boşsa içinde bulunulan ay."""
    if value:
        try:
            year, month = (int(part) for part in value.strip()[:7].split("-"))
            if 1 <= month <= 12 and 2000 <= year <= 2100:
                return month_range(year, month)
        except ValueError:
            pass
        raise ValueError("Ay 'YYYY-AA' biçiminde olmalı (Örn: 2026-11).")
    return month_range(today.year, today.month)


def _receipts(
    db: Session,
    user_id: int,
    start: Optional[dt.date] = None,
    end: Optional[dt.date] = None,
) -> List[Receipt]:
    stmt = select(Receipt).where(Receipt.user_id == user_id)
    if start:
        stmt = stmt.where(Receipt.date >= start)
    if end:
        stmt = stmt.where(Receipt.date <= end)
    return list(db.scalars(stmt.order_by(Receipt.date.desc(), Receipt.id.desc())).all())


def _bank(
    db: Session,
    user_id: int,
    start: Optional[dt.date] = None,
    end: Optional[dt.date] = None,
) -> List[Transaction]:
    """Toplamlara katılan banka/kart harcamaları: TL olanlar ve fişle eşleşmemiş olanlar.

    Fişle eşleşen işlem zaten fiş olarak (ürün ürün) sayıldığı için iki kez sayılmaz.
    """
    stmt = select(Transaction).where(
        Transaction.user_id == user_id,
        Transaction.matched_receipt_id.is_(None),
        Transaction.currency == "TRY",
    )
    if start:
        stmt = stmt.where(Transaction.date >= start)
    if end:
        stmt = stmt.where(Transaction.date <= end)
    return list(db.scalars(stmt.order_by(Transaction.date.desc(), Transaction.id.desc())).all())


def spending_summary(
    db: Session,
    user_id: int,
    start: Optional[dt.date] = None,
    end: Optional[dt.date] = None,
    category: Optional[str] = None,
    merchant: Optional[str] = None,
) -> dict:
    """Tarih aralığındaki toplam harcama (fişler + banka/kart işlemleri), kategori ve işyeri kırılımı.

    Kategori verilirse fişlerde yalnızca o kategorideki ürün satırları toplanır (fiş toplamı değil),
    böylece 'markete ne kadar' sorusu doğru cevaplanır.
    """
    receipts = [r for r in _receipts(db, user_id, start, end) if matches(r.merchant, merchant)]

    by_category: Dict[str, Dict[str, Decimal]] = defaultdict(lambda: {"total": ZERO, "quantity": ZERO})
    by_merchant: Dict[str, Dict[str, Decimal]] = defaultdict(lambda: {"total": ZERO, "count": ZERO})
    total = ZERO
    receipts_total = ZERO
    receipt_count = 0

    for receipt in receipts:
        if category:
            items = [i for i in receipt.items if same_category(i.category, category)]
            if not items:
                continue
            amount = sum((money(i.price) for i in items), ZERO)
        else:
            items = receipt.items
            amount = money(receipt.total_amount)

        total += amount
        receipts_total += amount
        receipt_count += 1
        by_merchant[receipt.merchant]["total"] += amount
        by_merchant[receipt.merchant]["count"] += 1
        for item in items:
            by_category[item.category]["total"] += money(item.price)
            by_category[item.category]["quantity"] += Decimal(str(item.quantity or 1))

    bank_total = ZERO
    transaction_count = 0
    for tx in _bank(db, user_id, start, end):
        if merchant and not (matches(tx.merchant, merchant) or matches(tx.description, merchant)):
            continue
        if not same_category(tx.category, category):
            continue
        amount = money(tx.amount)
        total += amount
        bank_total += amount
        transaction_count += 1
        by_merchant[tx.merchant]["total"] += amount
        by_merchant[tx.merchant]["count"] += 1
        by_category[tx.category]["total"] += amount
        by_category[tx.category]["quantity"] += 1

    return {
        "start_date": start.isoformat() if start else None,
        "end_date": end.isoformat() if end else None,
        "category_filter": category or None,
        "merchant_filter": merchant or None,
        "total": total,
        "receipts_total": receipts_total,
        "bank_total": bank_total,
        "receipt_count": receipt_count,
        "bank_transaction_count": transaction_count,
        "by_category": sorted(
            (
                {"category": cat, "total": v["total"], "item_count": float(v["quantity"])}
                for cat, v in by_category.items()
            ),
            key=lambda x: x["total"],
            reverse=True,
        ),
        "top_merchants": sorted(
            (
                {"merchant": m, "total": v["total"], "count": int(v["count"])}
                for m, v in by_merchant.items()
            ),
            key=lambda x: x["total"],
            reverse=True,
        )[:10],
    }


def monthly_trend(db: Session, user_id: int, months: int, today: dt.date) -> List[dict]:
    """Son N ayın (içinde bulunulan ay dahil) harcaması: fişler + banka/kart; boş aylar 0 ile gelir."""
    months = max(1, min(months, 24))
    ranges: List[MonthRange] = []
    year, month = today.year, today.month
    for _ in range(months):
        ranges.append(month_range(year, month))
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    ranges.reverse()

    receipts_totals: Dict[str, Decimal] = {r.key: ZERO for r in ranges}
    bank_totals: Dict[str, Decimal] = {r.key: ZERO for r in ranges}
    counts: Dict[str, int] = {r.key: 0 for r in ranges}
    for receipt in _receipts(db, user_id, ranges[0].start, ranges[-1].end):
        key = f"{receipt.date.year:04d}-{receipt.date.month:02d}"
        if key in receipts_totals:
            receipts_totals[key] += money(receipt.total_amount)
            counts[key] += 1
    for tx in _bank(db, user_id, ranges[0].start, ranges[-1].end):
        key = f"{tx.date.year:04d}-{tx.date.month:02d}"
        if key in bank_totals:
            bank_totals[key] += money(tx.amount)

    return [
        {
            "month": r.key,
            "label": r.label,
            "total": receipts_totals[r.key] + bank_totals[r.key],
            "receipts_total": receipts_totals[r.key],
            "bank_total": bank_totals[r.key],
            "receipt_count": counts[r.key],
        }
        for r in ranges
    ]


def search_items(
    db: Session,
    user_id: int,
    query: str,
    start: Optional[dt.date] = None,
    end: Optional[dt.date] = None,
    limit: int = 20,
) -> dict:
    """Ürün adında arama (Örn: 'kahve', 'süt'); eşleşen satırların toplamını da döner."""
    found = []
    total = ZERO
    for receipt in _receipts(db, user_id, start, end):
        for item in receipt.items:
            if matches(item.name, query):
                total += money(item.price)
                found.append(
                    {
                        "date": receipt.date.isoformat(),
                        "merchant": receipt.merchant,
                        "name": item.name,
                        "quantity": float(item.quantity or 1),
                        "price": money(item.price),
                        "category": item.category,
                    }
                )
    return {"query": query, "match_count": len(found), "total": total, "items": found[: max(1, min(limit, 50))]}


def search_transactions(
    db: Session,
    user_id: int,
    query: Optional[str] = None,
    start: Optional[dt.date] = None,
    end: Optional[dt.date] = None,
    category: Optional[str] = None,
    limit: int = 20,
) -> dict:
    """Banka/kart işlemlerinde işyeri/açıklama ve kategoriye göre arama; eşleşenlerin toplamını döner."""
    found = []
    total = ZERO
    for tx in _bank(db, user_id, start, end):
        if query and not (matches(tx.merchant, query) or matches(tx.description, query)):
            continue
        if not same_category(tx.category, category):
            continue
        total += money(tx.amount)
        found.append(
            {
                "date": tx.date.isoformat(),
                "merchant": tx.merchant,
                "description": tx.description,
                "amount": money(tx.amount),
                "category": tx.category,
            }
        )
    return {
        "query": query,
        "category": category,
        "match_count": len(found),
        "total": total,
        "transactions": found[: max(1, min(limit, 50))],
    }


def list_receipts_brief(
    db: Session,
    user_id: int,
    start: Optional[dt.date] = None,
    end: Optional[dt.date] = None,
    merchant: Optional[str] = None,
    limit: int = 10,
) -> List[dict]:
    result = []
    for receipt in _receipts(db, user_id, start, end):
        if not matches(receipt.merchant, merchant):
            continue
        result.append(
            {
                "id": receipt.id,
                "date": receipt.date.isoformat(),
                "merchant": receipt.merchant,
                "total": money(receipt.total_amount),
                "item_count": len(receipt.items),
            }
        )
        if len(result) >= max(1, min(limit, 50)):
            break
    return result


def budget_status(db: Session, user_id: int, month: MonthRange, today: dt.date) -> List[dict]:
    """Her bütçe için o ay harcanan (fişler + banka/kart), kalan, yüzde ve ay sonu tahmini."""
    budgets = list(
        db.scalars(select(Budget).where(Budget.user_id == user_id).order_by(Budget.category.is_not(None), Budget.category)).all()
    )
    if not budgets:
        return []

    receipts = _receipts(db, user_id, month.start, month.end)
    overall_spent = sum((money(r.total_amount) for r in receipts), ZERO)
    category_spent: Dict[str, Decimal] = defaultdict(Decimal)
    for receipt in receipts:
        for item in receipt.items:
            category_spent[normalize_text(item.category)] += money(item.price)
    for tx in _bank(db, user_id, month.start, month.end):
        overall_spent += money(tx.amount)
        category_spent[normalize_text(tx.category)] += money(tx.amount)

    days_in_month = (month.end - month.start).days + 1
    is_current = month.start <= today <= month.end
    days_elapsed = (today - month.start).days + 1 if is_current else days_in_month

    result = []
    for budget in budgets:
        spent = overall_spent if budget.category is None else money(category_spent.get(normalize_text(budget.category), ZERO))
        limit = money(budget.monthly_limit)
        ratio = (spent / limit) if limit > 0 else Decimal(0)
        projected = money(spent / days_elapsed * days_in_month) if is_current and days_elapsed > 0 else spent
        if spent > limit:
            state = "exceeded"
        elif ratio >= WARNING_RATIO:
            state = "warning"
        else:
            state = "ok"
        result.append(
            {
                "id": budget.id,
                "category": budget.category,
                "monthly_limit": limit,
                "spent": money(spent),
                "remaining": money(limit - spent),
                "percent": float((ratio * 100).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)),
                "projected": projected,
                "state": state,
                "month": month.key,
            }
        )
    return result
