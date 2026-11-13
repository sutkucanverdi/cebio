"""Kişisel enflasyon / fiyat takibi.

Kullanıcının fişlerinde birden fazla kez aldığı ürünlerin BİRİM fiyatını zaman içinde izler:
"Süt 6 ayda %38 zamlandı" gibi, kullanıcının kendi sepetine göre kişisel bir enflasyon göstergesi üretir.
Tamamen kural tabanlıdır; yapay zeka kotası kullanmaz.
"""
import datetime as dt
from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal
from typing import Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.receipt import Receipt, ReceiptItem
from app.services.subscription_catalog import normalize_text

CENT = Decimal("0.01")
# Aynı ürün en az bu kadar FARKLI günde alınmış olmalı ki fiyat değişimi anlamlı olsun
MIN_DISTINCT_DAYS = 2
# Fiş okuma hatalarından kaynaklanan uçuk değişimleri (ör. adet/kg karışması) gösterme
MAX_ABS_CHANGE_PCT = Decimal("400")


def _unit_price(item: ReceiptItem) -> Optional[Decimal]:
    if item.unit_price is not None and item.unit_price > 0:
        return Decimal(item.unit_price)
    qty = Decimal(item.quantity or 1)
    if item.price and qty > 0:
        return (Decimal(item.price) / qty).quantize(CENT, rounding=ROUND_HALF_UP)
    return None


def _pct(old: Decimal, new: Decimal) -> Optional[float]:
    if old <= 0:
        return None
    return float(((new - old) / old * 100).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def _rows(db: Session, user_id: int, since: Optional[dt.date] = None):
    stmt = (
        select(ReceiptItem, Receipt.date, Receipt.merchant)
        .join(Receipt, ReceiptItem.receipt_id == Receipt.id)
        .where(Receipt.user_id == user_id)
        .order_by(Receipt.date, Receipt.id)
    )
    if since:
        stmt = stmt.where(Receipt.date >= since)
    return db.execute(stmt).all()


def price_history(db: Session, user_id: int, query: str) -> dict:
    """Adı `query` içeren ürünlerin tarihsel birim fiyatları."""
    wanted = normalize_text(query)
    points: List[dict] = []
    for item, date, merchant in _rows(db, user_id):
        if wanted and wanted in normalize_text(item.name):
            price = _unit_price(item)
            if price is not None:
                points.append(
                    {"date": date, "merchant": merchant, "name": item.name, "unit_price": price.quantize(CENT)}
                )
    first = points[0]["unit_price"] if points else None
    last = points[-1]["unit_price"] if points else None
    return {
        "query": query,
        "points": points,
        "first_price": first,
        "last_price": last,
        "change_pct": _pct(first, last) if first is not None and last is not None and len(points) > 1 else None,
    }


def price_watch(db: Session, user_id: int, months: int = 12, limit: int = 20) -> dict:
    """Tekrar alınan ürünlerin ilk ve son birim fiyatı + kişisel sepet enflasyonu.

    Sepet enflasyonu: her ürünün değişimi, o ürüne yapılan toplam harcamayla ağırlıklandırılır
    (çok alınan ürünlerin zammı daha çok hissedilir).
    """
    today = dt.date.today()
    since = _months_ago(today, months)

    groups: Dict[str, List[dict]] = defaultdict(list)
    for item, date, merchant in _rows(db, user_id, since):
        price = _unit_price(item)
        key = normalize_text(item.name)
        if price is None or not key:
            continue
        groups[key].append(
            {"date": date, "merchant": merchant, "name": item.name, "price": price, "spent": Decimal(item.price or 0)}
        )

    items: List[dict] = []
    weighted_sum = Decimal("0")
    weight_total = Decimal("0")
    for entries in groups.values():
        days = {e["date"] for e in entries}
        if len(days) < MIN_DISTINCT_DAYS:
            continue
        first, last = entries[0], entries[-1]
        change = _pct(first["price"], last["price"])
        if change is None or abs(Decimal(str(change))) > MAX_ABS_CHANGE_PCT:
            continue
        spent = sum((e["spent"] for e in entries), Decimal("0"))
        items.append(
            {
                "name": last["name"],
                "purchases": len(entries),
                "first_date": first["date"],
                "first_price": first["price"].quantize(CENT),
                "last_date": last["date"],
                "last_price": last["price"].quantize(CENT),
                "change_pct": change,
                "total_spent": spent.quantize(CENT),
            }
        )
        weighted_sum += Decimal(str(change)) * spent
        weight_total += spent

    items.sort(key=lambda x: (abs(x["change_pct"]), x["purchases"]), reverse=True)
    basket = (
        float((weighted_sum / weight_total).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))
        if weight_total > 0
        else None
    )
    return {
        "since": since,
        "tracked_items": len(items),
        "basket_change_pct": basket,
        "items": items[:limit],
    }


def _months_ago(today: dt.date, months: int) -> dt.date:
    year, month = today.year, today.month - months
    while month <= 0:
        month += 12
        year -= 1
    return dt.date(year, month, 1)
