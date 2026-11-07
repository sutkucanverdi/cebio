import datetime as dt
from decimal import Decimal
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.receipt import Money


class BillingCycle(str, Enum):
    weekly = "weekly"
    monthly = "monthly"
    quarterly = "quarterly"
    yearly = "yearly"


class SubscriptionStatus(str, Enum):
    active = "active"
    trial = "trial"
    paused = "paused"
    cancelled = "cancelled"


class _SubscriptionFields(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    amount: Decimal = Field(..., ge=0, description="Dönem başına ücret")
    currency: str = Field(default="TRY", min_length=3, max_length=3)
    billing_cycle: BillingCycle = BillingCycle.monthly
    next_billing_date: dt.date
    category: str = Field(default="Diğer", min_length=1, max_length=100)
    status: SubscriptionStatus = SubscriptionStatus.active
    trial_ends_at: Optional[dt.date] = None
    cancel_url: Optional[str] = Field(default=None, max_length=500)
    notes: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("currency")
    @classmethod
    def _upper_currency(cls, value: str) -> str:
        value = value.strip().upper()
        if not value.isalpha():
            raise ValueError("Para birimi 3 harfli olmalı (Örn: TRY, USD).")
        return value

    @field_validator("cancel_url")
    @classmethod
    def _http_url(cls, value: Optional[str]) -> Optional[str]:
        if value is None or not value.strip():
            return None
        value = value.strip()
        # javascript: gibi şemalar link olarak gösterileceği için yalnızca http(s) kabul edilir.
        if not value.lower().startswith(("https://", "http://")):
            raise ValueError("İptal linki http:// veya https:// ile başlamalı.")
        return value


class SubscriptionCreate(_SubscriptionFields):
    pass


class SubscriptionUpdate(_SubscriptionFields):
    pass


class PriceChangeResponse(BaseModel):
    old_amount: Money
    new_amount: Money
    changed_at: dt.date

    model_config = ConfigDict(from_attributes=True)


class SubscriptionResponse(BaseModel):
    id: int
    name: str
    amount: Money
    currency: str
    billing_cycle: BillingCycle
    next_billing_date: dt.date
    category: str
    status: SubscriptionStatus
    trial_ends_at: Optional[dt.date] = None
    cancel_url: Optional[str] = None
    notes: Optional[str] = None
    created_at: dt.datetime

    # Hesaplanan alanlar
    monthly_equivalent: Money
    days_until_next: int
    last_price_change: Optional[PriceChangeResponse] = None


class CurrencyTotal(BaseModel):
    currency: str
    amount: Money


class CategoryTotal(BaseModel):
    category: str
    monthly_amount: Money
    count: int


class SubscriptionSummary(BaseModel):
    active_count: int
    monthly_totals: List[CurrencyTotal]
    yearly_totals: List[CurrencyTotal]
    by_category: List[CategoryTotal] = Field(description="Yalnızca TRY abonelikler, aylık karşılık")
    upcoming: List[SubscriptionResponse] = Field(description="Önümüzdeki günlerde yenilenecekler")
    trials_ending: List[SubscriptionResponse] = Field(description="Deneme süresi yakında bitecekler")
    recent_price_increases: List[SubscriptionResponse] = Field(description="Son 90 günde zamlananlar")


class CatalogEntry(BaseModel):
    key: str
    name: str
    category: str
    default_cycle: BillingCycle
    cancel_url: Optional[str] = None


# --- Ekstreden tespit ---

class StatementTransaction(BaseModel):
    """Gemini'nin banka/kart ekstresinden çıkardığı tek bir harcama satırı."""

    date: str = Field(..., description="İşlem tarihi, YYYY-MM-DD")
    description: str = Field(..., description="İşlem açıklaması / üye işyeri adı (ekstrede yazdığı gibi)")
    amount: float = Field(..., description="Harcama tutarı, pozitif sayı")
    currency: str = Field(default="TRY", description="Para birimi kodu, Örn: TRY, USD, EUR")


class ParsedStatement(BaseModel):
    transactions: List[StatementTransaction] = Field(
        default_factory=list,
        description="Ekstredeki tüm harcama (borç) işlemleri; iadeler, ödemeler ve gelen paralar hariç",
    )


class SubscriptionCandidate(BaseModel):
    name: str
    amount: Money
    currency: str
    billing_cycle: BillingCycle
    category: str
    last_charge_date: dt.date
    next_billing_date: dt.date
    occurrences: int
    confidence: str = Field(description="high | medium | low")
    previous_amount: Optional[Money] = Field(default=None, description="Fiyat değiştiyse ilk görülen tutar")
    cancel_url: Optional[str] = None
    already_tracked: bool = False
    matched_descriptions: List[str] = Field(default_factory=list)


class DetectionResponse(BaseModel):
    transactions_found: int
    candidates: List[SubscriptionCandidate]
