"""Ekstre işlemlerinden tekrarlayan ödemeleri (abonelikleri) bulan deterministik algoritma.

Gemini yalnızca ekstreyi satırlara çevirir; "bu bir abonelik mi?" kararı burada,
test edilebilir ve açıklanabilir kurallarla verilir:

1. İşlemler satıcıya göre gruplanır (katalogdaki bir servisse katalog anahtarı, değilse
   açıklamanın sadeleştirilmiş ilk kelimeleri).
2. Grup içindeki ödemeler arasındaki gün farkının medyanı bir döneme oturuyorsa
   (haftalık / aylık / 3 aylık / yıllık) ve tutarlar istikrarlıysa (ya da tek bir zam
   adımı varsa) aday olarak işaretlenir.
3. Katalogdaki bilinen servisler tek bir ödemeyle bile düşük güvenle önerilir.
"""
import datetime as dt
from collections import defaultdict
from decimal import Decimal
from statistics import median
from typing import Dict, Iterable, List, Optional, Tuple

from app.schemas.subscription import BillingCycle, StatementTransaction, SubscriptionCandidate
from app.services.subscription_catalog import CatalogItem, match_catalog, normalize_text
from app.services.subscription_logic import add_cycle, roll_forward

# (cycle, min_gün, max_gün, nominal_gün)
CYCLE_RANGES: List[Tuple[str, int, int, int]] = [
    ("weekly", 5, 9, 7),
    ("monthly", 25, 38, 30),
    ("quarterly", 80, 100, 91),
    ("yearly", 340, 390, 365),
]
NOMINAL_DAYS = {cycle: nominal for cycle, _, _, nominal in CYCLE_RANGES}

# Satıcı anahtarı oluştururken atılan, ayırt edici olmayan kelimeler
NOISE_TOKENS = {
    "TR", "TUR", "TURKEY", "TURKIYE", "ISTANBUL", "IST", "ANKARA", "IZMIR", "BURSA", "ANTALYA",
    "COM", "WWW", "HTTP", "HTTPS", "NET", "ORG", "POS", "SANAL", "INTERNET", "ODEME", "ISLEM",
    "KREDI", "KARTI", "KART", "AS", "A", "S", "LTD", "STI", "TIC", "SAN", "VE", "ONLINE",
    "IRL", "IE", "US", "USA", "NL", "GB", "LU", "PAYMENT", "BILL", "HELP",
}
MAX_KEY_TOKENS = 3

CONFIDENCE_ORDER = {"high": 0, "medium": 1, "low": 2}


def merchant_key(description: str) -> str:
    tokens = [
        t for t in normalize_text(description).split()
        if not t.isdigit() and t not in NOISE_TOKENS and not any(ch.isdigit() for ch in t) and len(t) > 1
    ]
    return " ".join(tokens[:MAX_KEY_TOKENS])


def classify_interval(days: float) -> Optional[str]:
    for cycle, low, high, _ in CYCLE_RANGES:
        if low <= days <= high:
            return cycle
    return None


def _parse_date(raw: str) -> Optional[dt.date]:
    try:
        return dt.date.fromisoformat((raw or "").strip()[:10])
    except ValueError:
        return None


def _amounts_look_recurring(amounts: List[Decimal]) -> bool:
    """Tutarlar sabitse ya da en fazla bir kez artmışsa (zam) tekrarlayan ödeme kabul edilir."""
    low, high = min(amounts), max(amounts)
    if low <= 0:
        return False
    if high / low <= Decimal("1.10"):
        return True
    changes = 0
    for prev, cur in zip(amounts, amounts[1:]):
        if abs(cur - prev) / prev > Decimal("0.02"):
            if cur < prev:
                return False  # fiyat düşüşü + dalgalanma: büyük ihtimalle market vb.
            changes += 1
    return changes <= 1


def _display_name(key: str) -> str:
    return " ".join(word.capitalize() for word in key.split()) or "Bilinmeyen Abonelik"


def detect_subscriptions(
    transactions: Iterable[StatementTransaction],
    today: dt.date,
) -> List[SubscriptionCandidate]:
    groups: Dict[Tuple[str, str], List[Tuple[dt.date, Decimal, str]]] = defaultdict(list)
    catalog_by_key: Dict[str, CatalogItem] = {}
    latest_date: Optional[dt.date] = None

    for tx in transactions:
        when = _parse_date(tx.date)
        if when is None or tx.amount is None or tx.amount <= 0:
            continue
        amount = Decimal(str(tx.amount)).quantize(Decimal("0.01"))
        item = match_catalog(tx.description)
        if item:
            key = f"catalog:{item['key']}"
            catalog_by_key[key] = item
        else:
            key = merchant_key(tx.description)
            if not key:
                continue
        currency = (tx.currency or "TRY").strip().upper()[:3] or "TRY"
        groups[(key, currency)].append((when, amount, tx.description.strip()))
        latest_date = max(latest_date or when, when)

    if latest_date is None:
        return []

    candidates: List[SubscriptionCandidate] = []
    for (key, currency), entries in groups.items():
        entries.sort(key=lambda e: e[0])
        catalog_item = catalog_by_key.get(key)
        dates = [e[0] for e in entries]
        amounts = [e[1] for e in entries]

        cycle: Optional[str] = None
        confidence = "low"

        intervals = [(b - a).days for a, b in zip(dates, dates[1:]) if (b - a).days > 0]
        if intervals:
            cycle = classify_interval(median(intervals))
            if cycle:
                consistent = all(classify_interval(i) == cycle for i in intervals)
                if not _amounts_look_recurring(amounts):
                    if not catalog_item:
                        continue
                    consistent = False
                if len(intervals) >= 2 and consistent:
                    confidence = "high"
                elif consistent:
                    confidence = "medium"

        if cycle is None:
            if not catalog_item:
                continue  # tekrar etmeyen, bilinmeyen satıcı: abonelik değil
            cycle = catalog_item["default_cycle"]
            confidence = "low"

        last_date = dates[-1]
        # Ekstrenin son tarihine göre iki dönemden uzun süredir ödenmiyorsa muhtemelen iptal edilmiş.
        if (latest_date - last_date).days > 2 * NOMINAL_DAYS[cycle] + 10 and not catalog_item:
            continue

        latest_amount = amounts[-1]
        first_amount = amounts[0]
        previous_amount = (
            first_amount if abs(latest_amount - first_amount) / first_amount > Decimal("0.01") else None
        )

        next_date = roll_forward(add_cycle(last_date, cycle), cycle, today)

        candidates.append(
            SubscriptionCandidate(
                name=catalog_item["name"] if catalog_item else _display_name(key),
                amount=latest_amount,
                currency=currency,
                billing_cycle=BillingCycle(cycle),
                category=catalog_item["category"] if catalog_item else "Diğer",
                last_charge_date=last_date,
                next_billing_date=next_date,
                occurrences=len(entries),
                confidence=confidence,
                previous_amount=previous_amount,
                cancel_url=catalog_item["cancel_url"] if catalog_item else None,
                matched_descriptions=sorted({e[2] for e in entries})[:5],
            )
        )

    candidates.sort(key=lambda c: (CONFIDENCE_ORDER[c.confidence], -c.amount))
    return candidates
