"""Aylık harcama raporu: tamamen kural tabanlı (yapay zeka kullanmaz, kota yemez, rakamlar tutarlıdır).

Rapor; seçilen ayın toplamını önceki ayla karşılaştırır, kategori ve işyeri kırılımı, en büyük harcamalar,
abonelik zamları ve bütçe durumunu içerir; bunlardan Türkçe "öne çıkanlar" cümleleri üretir.
"""
import datetime as dt
from decimal import ROUND_HALF_UP, Decimal
from typing import Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.receipt import Receipt
from app.models.subscription import Subscription, SubscriptionPriceChange
from app.models.transaction import Transaction
from app.services.analytics import (
    MonthRange,
    _bank,
    budget_status,
    money,
    month_range,
    spending_summary,
)
from app.services.subscription_logic import monthly_equivalent

ZERO = Decimal("0.00")
TR_MONTHS_FULL = [
    "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
    "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
]
# Kategori artışı "öne çıkan" sayılması için en az bu kadar artmalı
CATEGORY_JUMP_RATIO = Decimal("0.25")
CATEGORY_JUMP_MIN_TL = Decimal("100")


def previous_month(rng: MonthRange) -> MonthRange:
    year, month = rng.start.year, rng.start.month - 1
    if month == 0:
        year, month = year - 1, 12
    return month_range(year, month)


def default_report_month(today: dt.date) -> MonthRange:
    """Varsayılan rapor: tamamlanmış son ay (ayın ilk günlerinde geçen ayın raporu ilgi çeker)."""
    return previous_month(month_range(today.year, today.month))


def full_label(rng: MonthRange) -> str:
    return f"{TR_MONTHS_FULL[rng.start.month - 1]} {rng.start.year}"


def tl(value: Decimal) -> str:
    """1234.5 -> '1.234,50 ₺' (rapor cümleleri için)."""
    q = money(value)
    sign = "-" if q < 0 else ""
    whole, frac = f"{abs(q):.2f}".split(".")
    groups = []
    while whole:
        groups.insert(0, whole[-3:])
        whole = whole[:-3]
    return f"{sign}{'.'.join(groups)},{frac} ₺"


def pct_change(current: Decimal, previous: Decimal) -> Optional[float]:
    if previous <= 0:
        return None
    return float(((current - previous) / previous * 100).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def pct_text(part: Decimal, whole: Decimal) -> str:
    """Metinde gösterilecek tam sayı yüzde; gerçek orandan TEK seferde (yukarı) yuvarlanır.

    pct_change'in 0,1'e yuvarlanmış değerini tekrar yuvarlamak %81,48'i %82 yapıyordu (çift yuvarlama).
    """
    if whole == 0:
        return "0"
    return str(int((abs(part) / whole * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)))


def _top_expenses(db: Session, user_id: int, rng: MonthRange, limit: int = 5) -> List[dict]:
    receipts = db.scalars(
        select(Receipt).where(Receipt.user_id == user_id, Receipt.date >= rng.start, Receipt.date <= rng.end)
    ).all()
    items = [
        {"date": r.date, "merchant": r.merchant, "amount": money(r.total_amount), "source": "receipt"}
        for r in receipts
    ]
    items += [
        {"date": t.date, "merchant": t.merchant, "amount": money(t.amount), "source": "bank"}
        for t in _bank(db, user_id, rng.start, rng.end)
    ]
    items.sort(key=lambda x: x["amount"], reverse=True)
    return items[:limit]


def _subscription_section(db: Session, user_id: int, rng: MonthRange) -> dict:
    subs = db.scalars(select(Subscription).where(Subscription.user_id == user_id)).all()
    active_try = [s for s in subs if s.status == "active" and s.currency == "TRY"]
    monthly_fixed = sum((monthly_equivalent(s.amount, s.billing_cycle) for s in active_try), ZERO)

    sub_ids = [s.id for s in subs]
    names = {s.id: s.name for s in subs}
    increases = []
    if sub_ids:
        changes = db.scalars(
            select(SubscriptionPriceChange).where(
                SubscriptionPriceChange.subscription_id.in_(sub_ids),
                SubscriptionPriceChange.changed_at >= rng.start,
                SubscriptionPriceChange.changed_at <= rng.end,
            )
        ).all()
        increases = [
            {
                "name": names[c.subscription_id],
                "old_amount": money(c.old_amount),
                "new_amount": money(c.new_amount),
                "changed_at": c.changed_at,
            }
            for c in changes
            if c.new_amount > c.old_amount
        ]

    new_subs = [
        s.name
        for s in subs
        if s.created_at and rng.start <= s.created_at.date() <= rng.end
    ]
    return {
        "active_count": len([s for s in subs if s.status in ("active", "trial")]),
        "monthly_fixed_try": money(monthly_fixed),
        "price_increases": increases,
        "new_subscriptions": new_subs,
    }


def _category_rows(current: List[dict], previous: List[dict]) -> List[dict]:
    prev_map: Dict[str, Decimal] = {c["category"]: money(c["total"]) for c in previous}
    rows = []
    for c in current:
        total = money(c["total"])
        prev = prev_map.get(c["category"], ZERO)
        rows.append(
            {
                "category": c["category"],
                "total": total,
                "previous_total": prev,
                "change_pct": pct_change(total, prev),
            }
        )
    return rows


def build_insights(report: dict) -> List[str]:
    """Raporu kısa, önem sırasına göre Türkçe cümlelere çevirir."""
    total: Decimal = report["total"]
    prev: Decimal = report["previous_total"]
    label = report["label"]
    out: List[str] = []

    if total <= 0:
        out.append(f"{label} için kayıtlı harcama yok. Fiş tarayarak veya ekstre yükleyerek başlayabilirsin.")
        return out

    change = report["change_pct"]
    if change is not None:
        diff = total - prev
        if abs(change) < 3:
            out.append(f"Harcaman geçen ayla hemen hemen aynı: {tl(total)}.")
        elif change > 0:
            out.append(f"Harcaman geçen aya göre %{pct_text(diff, prev)} arttı ({tl(prev)} → {tl(total)}).")
        else:
            out.append(
                f"Harcaman geçen aya göre %{pct_text(diff, prev)} azaldı ({tl(prev)} → {tl(total)}). Tebrikler!"
            )
    else:
        out.append(f"{label} toplam harcaman {tl(total)}.")

    cats = report["by_category"]
    if cats:
        top = cats[0]
        out.append(
            f"En çok {top['category']} kategorisine harcadın: {tl(top['total'])} "
            f"(toplamdaki payı %{pct_text(top['total'], total)})."
        )

        jumps = [
            c
            for c in cats
            if c["previous_total"] > 0
            and c["total"] - c["previous_total"] >= CATEGORY_JUMP_MIN_TL
            and c["total"] >= c["previous_total"] * (1 + CATEGORY_JUMP_RATIO)
        ]
        if jumps:
            biggest = max(jumps, key=lambda c: c["total"] - c["previous_total"])
            out.append(
                f"{biggest['category']} harcaman "
                f"%{pct_text(biggest['total'] - biggest['previous_total'], biggest['previous_total'])} arttı "
                f"({tl(biggest['previous_total'])} → {tl(biggest['total'])})."
            )

    for b in report["budgets"]:
        name = b["category"] or "Genel"
        if b["state"] == "exceeded":
            out.append(f"{name} bütçeni {tl(-b['remaining'])} aştın (limit {tl(b['monthly_limit'])}).")
        elif b["state"] == "warning":
            out.append(f"{name} bütçesinde kullanım %{pct_text(b['spent'], b['monthly_limit'])} oldu, sınıra yaklaştın.")

    for inc in report["subscriptions"]["price_increases"]:
        out.append(f"{inc['name']} zam yaptı: {tl(inc['old_amount'])} → {tl(inc['new_amount'])}.")

    fixed: Decimal = report["subscriptions"]["monthly_fixed_try"]
    if fixed > 0:
        out.append(
            f"Aboneliklerin ayda {tl(fixed)} tutuyor (bu ayki harcamaya oranı %{pct_text(fixed, total)})."
        )

    return out


def monthly_report(db: Session, user_id: int, rng: MonthRange, today: dt.date) -> dict:
    prev_rng = previous_month(rng)
    current = spending_summary(db, user_id, rng.start, rng.end)
    previous = spending_summary(db, user_id, prev_rng.start, prev_rng.end)

    is_current = rng.start <= today <= rng.end
    days = (min(today, rng.end) - rng.start).days + 1 if is_current else (rng.end - rng.start).days + 1
    total = money(current["total"])

    report = {
        "month": rng.key,
        "label": full_label(rng),
        "is_complete": today > rng.end,
        "total": total,
        "receipts_total": money(current["receipts_total"]),
        "bank_total": money(current["bank_total"]),
        "previous_month": prev_rng.key,
        "previous_label": full_label(prev_rng),
        "previous_total": money(previous["total"]),
        "change_pct": pct_change(total, money(previous["total"])),
        "daily_average": money(total / days) if days > 0 else ZERO,
        "receipt_count": current["receipt_count"],
        "bank_transaction_count": current["bank_transaction_count"],
        "by_category": _category_rows(current["by_category"], previous["by_category"])[:8],
        "top_merchants": [
            {"merchant": m["merchant"], "total": money(m["total"]), "count": m["count"]}
            for m in current["top_merchants"][:5]
        ],
        "top_expenses": _top_expenses(db, user_id, rng),
        "subscriptions": _subscription_section(db, user_id, rng),
        "budgets": budget_status(db, user_id, rng, today),
    }
    report["insights"] = build_insights(report)
    return report


def months_with_data(db: Session, user_id: int) -> List[str]:
    """Rapor seçicisinde gösterilecek, harcaması olan aylar (yeniden eskiye)."""
    keys = set()
    for d in db.scalars(select(Receipt.date).where(Receipt.user_id == user_id)).all():
        keys.add(f"{d.year:04d}-{d.month:02d}")
    for d in db.scalars(select(Transaction.date).where(Transaction.user_id == user_id)).all():
        keys.add(f"{d.year:04d}-{d.month:02d}")
    return sorted(keys, reverse=True)
