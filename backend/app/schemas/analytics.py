from decimal import Decimal
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from app.schemas.receipt import Money


class TrendPoint(BaseModel):
    month: str = Field(description="YYYY-MM")
    label: str = Field(description="Örn: Kas 2026")
    total: Money
    receipt_count: int


class BudgetCreate(BaseModel):
    category: Optional[str] = Field(
        default=None, max_length=100, description="Boş bırakılırsa tüm harcamalar için genel bütçe"
    )
    monthly_limit: Decimal = Field(..., gt=0, description="Aylık limit (₺)")

    @field_validator("category")
    @classmethod
    def _blank_to_none(cls, value: Optional[str]) -> Optional[str]:
        return value.strip() if value and value.strip() else None


class BudgetUpdate(BaseModel):
    monthly_limit: Decimal = Field(..., gt=0)


class BudgetStatus(BaseModel):
    id: int
    category: Optional[str]
    monthly_limit: Money
    spent: Money
    remaining: Money
    percent: float
    projected: Money = Field(description="Bu hızla devam ederse ay sonu tahmini")
    state: Literal["ok", "warning", "exceeded"]
    month: str


class BudgetStatusResponse(BaseModel):
    month: str
    label: str
    budgets: List[BudgetStatus]
