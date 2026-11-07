import datetime as dt
from decimal import Decimal
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.receipt import Money
from app.schemas.subscription import SubscriptionCandidate
from app.services.categories import normalize_category

MAX_IMPORT_ROWS = 2000


class StatementRow(BaseModel):
    """Önizlemede gösterilen ve kullanıcı onayıyla içe aktarılan tek işlem."""

    date: dt.date
    description: str = Field(..., min_length=1, max_length=255)
    amount: Decimal = Field(..., gt=0)
    currency: str = Field(default="TRY", min_length=3, max_length=3)
    category: str = Field(default="Diğer", max_length=100)

    @field_validator("currency")
    @classmethod
    def _upper(cls, value: str) -> str:
        value = value.strip().upper()
        if not value.isalpha():
            raise ValueError("Para birimi 3 harfli olmalı (Örn: TRY).")
        return value

    @field_validator("category")
    @classmethod
    def _known_category(cls, value: str) -> str:
        return normalize_category(value)


class MatchedReceipt(BaseModel):
    id: int
    merchant: str
    date: dt.date


class PreviewRow(BaseModel):
    date: dt.date
    description: str
    merchant: str
    amount: Money
    currency: str
    category: str
    already_imported: bool = False
    matched_receipt: Optional[MatchedReceipt] = None


class StatementPreview(BaseModel):
    transactions_found: int
    new_count: int
    rows: List[PreviewRow]
    subscription_candidates: List[SubscriptionCandidate]


class ImportRequest(BaseModel):
    filename: str = Field(default="ekstre", max_length=255)
    rows: List[StatementRow] = Field(..., min_length=1, max_length=MAX_IMPORT_ROWS)


class ImportResult(BaseModel):
    import_id: Optional[int]
    imported: int
    skipped_duplicates: int
    matched_receipts: int


class StatementImportResponse(BaseModel):
    id: int
    filename: str
    period_start: Optional[dt.date]
    period_end: Optional[dt.date]
    created_at: dt.datetime
    transaction_count: int
    total: Money


class TransactionResponse(BaseModel):
    id: int
    import_id: int
    date: dt.date
    description: str
    merchant: str
    amount: Money
    currency: str
    category: str
    matched_receipt_id: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


class TransactionUpdate(BaseModel):
    category: str = Field(..., min_length=1, max_length=100)

    @field_validator("category")
    @classmethod
    def _known_category(cls, value: str) -> str:
        return normalize_category(value)
