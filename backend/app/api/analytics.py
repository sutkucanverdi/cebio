import datetime as dt
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.routes import to_money
from app.core.database import get_db
from app.models.budget import Budget
from app.models.user import User
from app.schemas.analytics import (
    BudgetCreate,
    BudgetStatus,
    BudgetStatusResponse,
    BudgetUpdate,
    TrendPoint,
)
from app.services.analytics import budget_status, monthly_trend, parse_month
from app.services.subscription_catalog import normalize_text

router = APIRouter(prefix="/api/v1", tags=["Analytics & Budgets"])

MAX_BUDGETS = 30


def today() -> dt.date:
    return dt.date.today()


def _status_for(db: Session, user: User, month: Optional[str]) -> BudgetStatusResponse:
    try:
        rng = parse_month(month, today())
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    return BudgetStatusResponse(
        month=rng.key,
        label=rng.label,
        budgets=[BudgetStatus(**b) for b in budget_status(db, user.id, rng, today())],
    )


@router.get("/analytics/trend", response_model=List[TrendPoint], summary="Aylık harcama trendi")
def get_trend(
    months: int = Query(6, ge=1, le=24),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> List[TrendPoint]:
    return [TrendPoint(**p) for p in monthly_trend(db, current_user.id, months, today())]


@router.get("/budgets", response_model=BudgetStatusResponse, summary="Bütçeler ve bu ayki durumları")
def list_budgets(
    month: Optional[str] = Query(None, description="YYYY-MM; boşsa bu ay"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BudgetStatusResponse:
    return _status_for(db, current_user, month)


@router.post(
    "/budgets",
    response_model=BudgetStatusResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Bütçe ekle (kategori başına bir tane)",
)
def create_budget(
    payload: BudgetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BudgetStatusResponse:
    existing = list(db.scalars(select(Budget).where(Budget.user_id == current_user.id)).all())
    if len(existing) >= MAX_BUDGETS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="En fazla 30 bütçe ekleyebilirsiniz.")

    wanted = normalize_text(payload.category) if payload.category else None
    for budget in existing:
        current = normalize_text(budget.category) if budget.category else None
        if current == wanted:
            what = f'"{budget.category}" kategorisi' if budget.category else "Genel harcama"
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"{what} için zaten bir bütçe var. Mevcut bütçeyi düzenleyin.",
            )

    db.add(Budget(user_id=current_user.id, category=payload.category, monthly_limit=to_money(payload.monthly_limit)))
    db.commit()
    return _status_for(db, current_user, None)


@router.put("/budgets/{budget_id}", response_model=BudgetStatusResponse, summary="Bütçe limitini güncelle")
def update_budget(
    budget_id: int,
    payload: BudgetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BudgetStatusResponse:
    budget = db.scalars(select(Budget).where(Budget.id == budget_id, Budget.user_id == current_user.id)).first()
    if not budget:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bütçe bulunamadı.")
    budget.monthly_limit = to_money(payload.monthly_limit)
    db.commit()
    return _status_for(db, current_user, None)


@router.delete("/budgets/{budget_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Bütçeyi sil")
def delete_budget(
    budget_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    budget = db.scalars(select(Budget).where(Budget.id == budget_id, Budget.user_id == current_user.id)).first()
    if not budget:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bütçe bulunamadı.")
    db.delete(budget)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
