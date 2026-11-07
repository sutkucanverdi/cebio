import datetime as dt
from decimal import Decimal
from typing import Callable, List, Tuple

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.budget import Budget
from app.models.receipt import Receipt, ReceiptItem
from app.models.subscription import Subscription, SubscriptionPriceChange
from app.models.transaction import StatementImport, Transaction
from app.services.assistant_tools import ToolContext, execute_tool
from app.services.reports import tl

TODAY = dt.date(2026, 12, 5)


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.api.reports.today", lambda: TODAY)


def _uid(client: TestClient) -> int:
    return client.get("/api/v1/auth/me").json()["id"]


def _receipt(db: Session, uid: int, date: str, merchant: str, items: List[Tuple[str, float, str]]) -> Receipt:
    r = Receipt(
        user_id=uid,
        merchant=merchant,
        date=dt.date.fromisoformat(date),
        total_amount=sum(Decimal(str(p)) for _, p, _ in items),
        items=[ReceiptItem(name=n, price=Decimal(str(p)), quantity=Decimal(1), category=c) for n, p, c in items],
    )
    db.add(r)
    db.commit()
    return r


def _bank(db: Session, uid: int, rows: List[Tuple[str, str, float, str]], matched_receipt: int | None = None) -> None:
    imp = StatementImport(user_id=uid, filename="ekstre.csv")
    db.add(imp)
    db.flush()
    for i, (date, merchant, amount, category) in enumerate(rows):
        db.add(
            Transaction(
                user_id=uid,
                import_id=imp.id,
                date=dt.date.fromisoformat(date),
                description=merchant.upper(),
                merchant=merchant,
                amount=Decimal(str(amount)),
                currency="TRY",
                category=category,
                fingerprint=f"fp-{imp.id}-{i}",
                matched_receipt_id=matched_receipt,
            )
        )
    db.commit()


@pytest.fixture
def seeded(client: TestClient, db_session: Session) -> int:
    uid = _uid(client)
    # Ekim: 1.200 ₺
    _receipt(db_session, uid, "2026-10-05", "Migros", [("Market", 1000, "Gıda")])
    _receipt(db_session, uid, "2026-10-20", "Kahveci", [("Latte", 200, "Restoran & Kafe")])
    # Kasım: fiş 800 + banka 1.500 + 400 = 2.700 ₺
    migros = _receipt(db_session, uid, "2026-11-03", "Migros", [("Market", 800, "Gıda")])
    _bank(db_session, uid, [("2026-11-10", "Shell", 1500, "Ulaşım"), ("2026-11-15", "Starbucks", 400, "Restoran & Kafe")])
    # Fişle eşleşen banka işlemi iki kez sayılmaz
    _bank(db_session, uid, [("2026-11-04", "Migros", 800, "Gıda")], matched_receipt=migros.id)

    netflix = Subscription(
        user_id=uid, name="Netflix", amount=Decimal("229.99"), billing_cycle="monthly",
        next_billing_date=dt.date(2026, 12, 12), category="Dizi & Film", status="active",
    )
    db_session.add(netflix)
    db_session.flush()
    db_session.add(SubscriptionPriceChange(
        subscription_id=netflix.id, old_amount=Decimal("189.99"), new_amount=Decimal("229.99"),
        changed_at=dt.date(2026, 11, 10),
    ))
    db_session.add(Budget(user_id=uid, category="Gıda", monthly_limit=Decimal("700")))
    db_session.commit()
    return uid


def test_tl_formatting() -> None:
    assert tl(Decimal("1234.5")) == "1.234,50 ₺"
    assert tl(Decimal("0")) == "0,00 ₺"
    assert tl(Decimal("1234567.891")) == "1.234.567,89 ₺"
    assert tl(Decimal("-100")) == "-100,00 ₺"


def test_default_report_is_last_complete_month(client: TestClient, seeded: int) -> None:
    r = client.get("/api/v1/reports/monthly").json()
    assert r["month"] == "2026-11" and r["label"] == "Kasım 2026" and r["is_complete"] is True
    assert r["previous_label"] == "Ekim 2026"

    assert r["total"] == 2700.0
    assert r["receipts_total"] == 800.0 and r["bank_total"] == 1900.0
    assert r["previous_total"] == 1200.0
    assert r["change_pct"] == 125.0
    assert r["daily_average"] == 90.0  # 2700 / 30 gün

    cats = {c["category"]: c for c in r["by_category"]}
    assert r["by_category"][0]["category"] == "Ulaşım"
    assert cats["Restoran & Kafe"] == {"category": "Restoran & Kafe", "total": 400.0, "previous_total": 200.0, "change_pct": 100.0}
    assert cats["Ulaşım"]["change_pct"] is None  # geçen ay yoktu

    assert [e["merchant"] for e in r["top_expenses"]] == ["Shell", "Migros", "Starbucks"]
    assert [e["source"] for e in r["top_expenses"]] == ["bank", "receipt", "bank"]

    subs = r["subscriptions"]
    assert subs["monthly_fixed_try"] == 229.99
    assert subs["price_increases"][0]["name"] == "Netflix"
    gida = next(b for b in r["budgets"] if b["category"] == "Gıda")
    assert gida["state"] == "exceeded" and gida["spent"] == 800.0


def test_insights_text(client: TestClient, seeded: int) -> None:
    insights = client.get("/api/v1/reports/monthly").json()["insights"]
    assert insights == [
        "Harcaman geçen aya göre %125 arttı (1.200,00 ₺ → 2.700,00 ₺).",
        "En çok Ulaşım kategorisine harcadın: 1.500,00 ₺ (toplamdaki payı %56).",
        "Restoran & Kafe harcaman %100 arttı (200,00 ₺ → 400,00 ₺).",
        "Gıda bütçeni 100,00 ₺ aştın (limit 700,00 ₺).",
        "Netflix zam yaptı: 189,99 ₺ → 229,99 ₺.",
        "Aboneliklerin ayda 229,99 ₺ tutuyor (bu ayki harcamaya oranı %9).",
    ]


def test_previous_month_report_and_decrease(client: TestClient, seeded: int, db_session: Session) -> None:
    oct_report = client.get("/api/v1/reports/monthly", params={"month": "2026-10"}).json()
    assert oct_report["total"] == 1200.0
    assert oct_report["previous_total"] == 0.0 and oct_report["change_pct"] is None
    assert oct_report["insights"][0] == "Ekim 2026 toplam harcaman 1.200,00 ₺."

    # Aralık: henüz devam eden ay, harcama azaldı
    _receipt(db_session, seeded, "2026-12-02", "BİM", [("Ekmek", 500, "Gıda")])
    dec = client.get("/api/v1/reports/monthly", params={"month": "2026-12"}).json()
    assert dec["is_complete"] is False
    assert dec["daily_average"] == 100.0  # 5 günde 500 ₺
    assert dec["insights"][0] == "Harcaman geçen aya göre %81 azaldı (2.700,00 ₺ → 500,00 ₺). Tebrikler!"


def test_empty_and_flat_months(client: TestClient, db_session: Session) -> None:
    empty = client.get("/api/v1/reports/monthly", params={"month": "2026-06"}).json()
    assert empty["total"] == 0.0
    assert empty["insights"] == ["Haziran 2026 için kayıtlı harcama yok. Fiş tarayarak veya ekstre yükleyerek başlayabilirsin."]

    uid = _uid(client)
    _receipt(db_session, uid, "2026-08-10", "A", [("x", 1000, "Gıda")])
    _receipt(db_session, uid, "2026-09-10", "A", [("x", 1010, "Gıda")])
    flat = client.get("/api/v1/reports/monthly", params={"month": "2026-09"}).json()
    assert flat["insights"][0] == "Harcaman geçen ayla hemen hemen aynı: 1.010,00 ₺."


def test_months_endpoint_validation_and_isolation(
    client: TestClient, seeded: int, anon_client: TestClient, register: Callable[..., str]
) -> None:
    assert client.get("/api/v1/reports/months").json() == ["2026-11", "2026-10"]
    assert client.get("/api/v1/reports/monthly", params={"month": "2026-13"}).status_code == 422

    other = {"Authorization": f"Bearer {register('b@example.com', 'sifre-b-1234')}"}
    assert anon_client.get("/api/v1/reports/months", headers=other).json() == []
    assert anon_client.get("/api/v1/reports/monthly", headers=other).json()["total"] == 0.0


def test_assistant_report_tool(db_session: Session, seeded: int) -> None:
    ctx = ToolContext(db=db_session, user_id=seeded, today=TODAY)
    report = execute_tool(ctx, "get_monthly_report", {})
    assert report["month"] == "2026-11" and report["total"] == 2700.0
    assert len(report["top_expenses"]) == 3
    assert execute_tool(ctx, "get_monthly_report", {"month": "2026-10"})["total"] == 1200.0
    assert "error" in execute_tool(ctx, "get_monthly_report", {"month": "kasım"})


def test_budget_warning_insight(client: TestClient, db_session: Session) -> None:
    uid = _uid(client)
    _receipt(db_session, uid, "2026-11-10", "A", [("x", 900, "Gıda")])
    db_session.add(Budget(user_id=uid, category=None, monthly_limit=Decimal("1000")))
    db_session.commit()
    insights = client.get("/api/v1/reports/monthly").json()["insights"]
    assert "Genel bütçesinde kullanım %90 oldu, sınıra yaklaştın." in insights
