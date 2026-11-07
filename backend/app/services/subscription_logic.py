"""Abonelik tarih ve tutar hesapları (veritabanından bağımsız, saf fonksiyonlar)."""
import calendar
import datetime as dt
from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")

# Bir dönemin aylık karşılığı için çarpan
MONTHLY_FACTOR = {
    "weekly": Decimal(52) / Decimal(12),
    "monthly": Decimal(1),
    "quarterly": Decimal(1) / Decimal(3),
    "yearly": Decimal(1) / Decimal(12),
}

_MONTHS_IN_CYCLE = {"monthly": 1, "quarterly": 3, "yearly": 12}


def add_months(date: dt.date, months: int, anchor_day: int | None = None) -> dt.date:
    """Ay ekler; hedef ayda o gün yoksa ayın son gününe sabitlenir (31 Ocak + 1 ay = 28/29 Şubat).

    anchor_day verilirse (aboneliğin asıl ödeme günü) uygun aylarda o güne geri dönülür,
    böylece 31'inde ödenen bir abonelik Şubat'tan sonra 28'ine kaymış olarak kalmaz.
    """
    month_index = date.month - 1 + months
    year = date.year + month_index // 12
    month = month_index % 12 + 1
    day = anchor_day or date.day
    return dt.date(year, month, min(day, calendar.monthrange(year, month)[1]))


def add_cycle(date: dt.date, cycle: str, anchor_day: int | None = None) -> dt.date:
    if cycle == "weekly":
        return date + dt.timedelta(days=7)
    return add_months(date, _MONTHS_IN_CYCLE.get(cycle, 1), anchor_day)


def roll_forward(next_date: dt.date, cycle: str, today: dt.date) -> dt.date:
    """Geçmişte kalmış bir ödeme tarihini, bugün veya sonrasına gelene kadar ileri taşır."""
    anchor = next_date.day
    result = next_date
    # Çok eski tarihlerde sonsuz döngüye karşı güvenlik sınırı (~20 yıl haftalık)
    for _ in range(1100):
        if result >= today:
            return result
        result = add_cycle(result, cycle, anchor)
    return result


def monthly_equivalent(amount: Decimal, cycle: str) -> Decimal:
    return (Decimal(amount) * MONTHLY_FACTOR.get(cycle, Decimal(1))).quantize(CENT, rounding=ROUND_HALF_UP)


YEARLY_FACTOR = {"weekly": 52, "monthly": 12, "quarterly": 4, "yearly": 1}


def yearly_equivalent(amount: Decimal, cycle: str) -> Decimal:
    # Aylık yuvarlanmış değer * 12 yerine doğrudan çarpılır (999,99 yıllık -> 999,96 olmasın).
    return (Decimal(amount) * YEARLY_FACTOR.get(cycle, 12)).quantize(CENT, rounding=ROUND_HALF_UP)
