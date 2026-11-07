import datetime as dt
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.schemas.analytics import BudgetStatus
from app.schemas.receipt import Money
from app.services.analytics import parse_month
from app.services.reports import default_report_month, monthly_report, months_with_data

router = APIRouter(prefix="/api/v1/reports", tags=["Reports"])


def today() -> dt.date:
    return dt.date.today()


class CategoryChange(BaseModel):
    category: str
    total: Money
    previous_total: Money
    change_pct: Optional[float]


class MerchantTotal(BaseModel):
    merchant: str
    total: Money
    count: int


class Expense(BaseModel):
    date: dt.date
    merchant: str
    amount: Money
    source: Literal["receipt", "bank"]


class PriceIncrease(BaseModel):
    name: str
    old_amount: Money
    new_amount: Money
    changed_at: dt.date


class SubscriptionSection(BaseModel):
    active_count: int
    monthly_fixed_try: Money
    price_increases: List[PriceIncrease]
    new_subscriptions: List[str]


class MonthlyReport(BaseModel):
    month: str
    label: str
    is_complete: bool
    total: Money
    receipts_total: Money
    bank_total: Money
    previous_month: str
    previous_label: str
    previous_total: Money
    change_pct: Optional[float]
    daily_average: Money
    receipt_count: int
    bank_transaction_count: int
    by_category: List[CategoryChange]
    top_merchants: List[MerchantTotal]
    top_expenses: List[Expense]
    subscriptions: SubscriptionSection
    budgets: List[BudgetStatus]
    insights: List[str]


@router.get("/months", response_model=List[str], summary="Harcaması olan aylar (rapor seçici için)")
def list_months(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[str]:
    return months_with_data(db, current_user.id)


@router.get("/monthly", response_model=MonthlyReport, summary="Aylık harcama raporu")
def get_monthly_report(
    month: Optional[str] = Query(None, description="YYYY-MM; boşsa tamamlanmış son ay"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MonthlyReport:
    ref = today()
    try:
        rng = parse_month(month, ref) if month else default_report_month(ref)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    return MonthlyReport(**monthly_report(db, current_user.id, rng, ref))
