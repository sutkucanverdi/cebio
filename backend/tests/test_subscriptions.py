import datetime as dt
from decimal import Decimal
from typing import Callable
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.subscription import Subscription, SubscriptionPriceChange
from app.schemas.subscription import ParsedStatement, StatementTransaction
from app.services.subscription_catalog import match_catalog, normalize_text
from app.services.subscription_detector import detect_subscriptions, merchant_key
from app.services.subscription_logic import (
    add_cycle,
    add_months,
    monthly_equivalent,
    roll_forward,
    yearly_equivalent,
)

TODAY = dt.date(2026, 11, 7)
PARSER = "app.api.subscriptions.statement_parser_service.parse_statement"


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.api.subscriptions.today", lambda: TODAY)


def _sub(**overrides) -> dict:  # type: ignore[no-untyped-def]
    body = {
        "name": "Netflix",
        "amount": 229.99,
        "currency": "TRY",
        "billing_cycle": "monthly",
        "next_billing_date": "2026-11-20",
        "category": "Dizi & Film",
    }
    body.update(overrides)
    return body


def tx(date: str, description: str, amount: float, currency: str = "TRY") -> StatementTransaction:
    return StatementTransaction(date=date, description=description, amount=amount, currency=currency)


# --- Tarih / tutar hesapları ---

def test_add_months_clamps_to_month_end_and_keeps_anchor() -> None:
    assert add_months(dt.date(2026, 1, 31), 1) == dt.date(2026, 2, 28)
    assert add_months(dt.date(2028, 1, 31), 1) == dt.date(2028, 2, 29)  # artık yıl
    # 28 Şubat'tan sonra asıl ödeme günü (31) korunur
    assert add_months(dt.date(2026, 2, 28), 1, anchor_day=31) == dt.date(2026, 3, 31)
    assert add_months(dt.date(2026, 11, 15), 3) == dt.date(2027, 2, 15)
    assert add_cycle(dt.date(2026, 11, 1), "weekly") == dt.date(2026, 11, 8)
    assert add_cycle(dt.date(2026, 11, 1), "yearly") == dt.date(2027, 11, 1)


def test_roll_forward_moves_past_dates_to_today_or_later() -> None:
    assert roll_forward(dt.date(2026, 8, 31), "monthly", TODAY) == dt.date(2026, 11, 30)
    assert roll_forward(dt.date(2026, 11, 7), "monthly", TODAY) == TODAY  # bugün ödeme günü
    assert roll_forward(dt.date(2026, 12, 1), "monthly", TODAY) == dt.date(2026, 12, 1)
    assert roll_forward(dt.date(2026, 10, 1), "weekly", TODAY) == dt.date(2026, 11, 12)


def test_monthly_and_yearly_equivalents() -> None:
    assert monthly_equivalent(Decimal("1200"), "yearly") == Decimal("100.00")
    assert monthly_equivalent(Decimal("300"), "quarterly") == Decimal("100.00")
    assert monthly_equivalent(Decimal("60"), "weekly") == Decimal("260.00")
    assert yearly_equivalent(Decimal("999.99"), "yearly") == Decimal("999.99")
    assert yearly_equivalent(Decimal("100"), "monthly") == Decimal("1200.00")


# --- Katalog eşleştirme ---

def test_catalog_matching_is_robust_to_bank_formatting() -> None:
    assert normalize_text("Netflix.com İstanbul*TR") == "NETFLIX COM ISTANBUL TR"
    assert match_catalog("NETFLIX.COM 866-579-7172 CA")["key"] == "netflix"  # type: ignore[index]
    assert match_catalog("SPOTİFY P1A2B3 STOCKHOLM")["key"] == "spotify"  # type: ignore[index]
    assert match_catalog("APPLE.COM/BILL ITUNES.COM")["key"] == "icloud"  # type: ignore[index]
    assert match_catalog("Google YouTube Premium")["key"] == "youtube_premium"  # type: ignore[index]
    # Kelime sınırı: 'PSN' kısaltması başka kelimelerin içinde eşleşmemeli
    assert match_catalog("PSNTEKSTIL MAGAZA") is None
    assert match_catalog("MIGROS SANAL MARKET") is None


def test_merchant_key_strips_noise() -> None:
    assert merchant_key("GOLD'S GYM 4421 ISTANBUL TR") == "GOLD GYM"
    assert merchant_key("Fitness Club *Online Ödeme 12345") == "FITNESS CLUB"


# --- Abonelik tespiti ---

def test_detects_catalog_subscription_with_price_increase() -> None:
    result = detect_subscriptions(
        [
            tx("2026-08-12", "NETFLIX.COM", 189.99),
            tx("2026-09-12", "NETFLIX.COM", 189.99),
            tx("2026-10-12", "NETFLIX.COM 866-579", 229.99),
            tx("2026-10-03", "MIGROS", 812.40),
        ],
        TODAY,
    )
    netflix = next(c for c in result if c.name == "Netflix")
    assert netflix.billing_cycle.value == "monthly"
    assert netflix.confidence == "high"
    assert netflix.amount == Decimal("229.99")
    assert netflix.previous_amount == Decimal("189.99")
    assert netflix.next_billing_date == dt.date(2026, 11, 12)
    assert netflix.category == "Dizi & Film"
    assert netflix.occurrences == 3


def test_detects_unknown_recurring_merchant() -> None:
    result = detect_subscriptions(
        [
            tx("2026-09-05", "FITNESS CLUB KADIKOY", 1500.0),
            tx("2026-10-05", "FITNESS CLUB KADIKOY", 1500.0),
        ],
        TODAY,
    )
    assert len(result) == 1
    assert result[0].name == "Fitness Club Kadikoy"
    assert result[0].confidence == "medium"
    assert result[0].next_billing_date == dt.date(2026, 12, 5)


def test_ignores_irregular_grocery_spending() -> None:
    result = detect_subscriptions(
        [
            tx("2026-08-03", "MIGROS SANAL MARKET", 812.40),
            tx("2026-09-02", "MIGROS SANAL MARKET", 455.10),
            tx("2026-10-04", "MIGROS SANAL MARKET", 1290.75),
            tx("2026-10-05", "SHELL PETROL", 1500.0),
            tx("2026-10-20", "SHELL PETROL", 1400.0),
        ],
        TODAY,
    )
    assert result == []


def test_single_catalog_charge_is_low_confidence_and_weekly_detected() -> None:
    result = detect_subscriptions(
        [
            tx("2026-10-20", "SPOTIFY AB", 99.0),
            tx("2026-10-01", "HAFTALIK GAZETE ABONE", 50.0),
            tx("2026-10-08", "HAFTALIK GAZETE ABONE", 50.0),
            tx("2026-10-15", "HAFTALIK GAZETE ABONE", 50.0),
        ],
        TODAY,
    )
    by_name = {c.name: c for c in result}
    assert by_name["Spotify"].confidence == "low"
    assert by_name["Spotify"].billing_cycle.value == "monthly"
    weekly = by_name["Haftalik Gazete Abone"]
    assert weekly.billing_cycle.value == "weekly"
    assert weekly.confidence == "high"
    # Yüksek güvenli aday listede önce gelir
    assert result[0].confidence == "high"


def test_stale_unknown_merchant_and_currency_are_handled() -> None:
    result = detect_subscriptions(
        [
            # 4 ay önce bitmiş bilinmeyen tekrarlayan ödeme -> muhtemelen iptal edilmiş
            tx("2026-05-01", "ESKI DERGI", 40.0),
            tx("2026-06-01", "ESKI DERGI", 40.0),
            tx("2026-10-25", "MARKET", 100.0),
            # Dolar ile ödenen abonelik
            tx("2026-09-14", "OPENAI *CHATGPT SUBSCR", 20.0, "USD"),
            tx("2026-10-14", "OPENAI *CHATGPT SUBSCR", 20.0, "USD"),
        ],
        TODAY,
    )
    names = [c.name for c in result]
    assert "Eski Dergi" not in names
    chatgpt = next(c for c in result if c.name == "ChatGPT Plus")
    assert chatgpt.currency == "USD"


# --- API ---

def test_subscription_crud(client: TestClient) -> None:
    created = client.post("/api/v1/subscriptions", json=_sub())
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["amount"] == 229.99
    assert body["monthly_equivalent"] == 229.99
    assert body["days_until_next"] == 13
    sid = body["id"]

    assert len(client.get("/api/v1/subscriptions").json()) == 1
    assert client.get(f"/api/v1/subscriptions/{sid}").json()["name"] == "Netflix"

    updated = client.put(f"/api/v1/subscriptions/{sid}", json=_sub(status="paused", notes="Yaz boyunca durdur"))
    assert updated.status_code == 200
    assert updated.json()["status"] == "paused"
    assert updated.json()["last_price_change"] is None  # tutar değişmedi

    assert len(client.get("/api/v1/subscriptions", params={"status": "paused"}).json()) == 1
    assert client.get("/api/v1/subscriptions", params={"status": "active"}).json() == []

    assert client.delete(f"/api/v1/subscriptions/{sid}").status_code == 204
    assert client.get(f"/api/v1/subscriptions/{sid}").status_code == 404


def test_validation_rejects_bad_input(client: TestClient) -> None:
    assert client.post("/api/v1/subscriptions", json=_sub(cancel_url="javascript:alert(1)")).status_code == 422
    assert client.post("/api/v1/subscriptions", json=_sub(billing_cycle="daily")).status_code == 422
    assert client.post("/api/v1/subscriptions", json=_sub(amount=-5)).status_code == 422
    assert client.post("/api/v1/subscriptions", json=_sub(currency="T1")).status_code == 422
    ok = client.post("/api/v1/subscriptions", json=_sub(currency="usd", cancel_url=" https://x.com/cancel "))
    assert ok.status_code == 201
    assert ok.json()["currency"] == "USD"
    assert ok.json()["cancel_url"] == "https://x.com/cancel"


def test_past_billing_date_is_rolled_forward(client: TestClient) -> None:
    body = client.post("/api/v1/subscriptions", json=_sub(next_billing_date="2026-08-31")).json()
    assert body["next_billing_date"] == "2026-11-30"
    assert body["days_until_next"] == 23


def test_price_change_is_recorded(client: TestClient, db_session: Session) -> None:
    sid = client.post("/api/v1/subscriptions", json=_sub(amount=189.99)).json()["id"]
    res = client.put(f"/api/v1/subscriptions/{sid}", json=_sub(amount=229.99)).json()
    assert res["last_price_change"] == {"old_amount": 189.99, "new_amount": 229.99, "changed_at": "2026-11-07"}

    summary = client.get("/api/v1/subscriptions/summary").json()
    assert [s["id"] for s in summary["recent_price_increases"]] == [sid]

    changes = db_session.scalars(select(SubscriptionPriceChange)).all()
    assert len(changes) == 1


def test_summary_totals_upcoming_and_trials(client: TestClient) -> None:
    client.post("/api/v1/subscriptions", json=_sub(name="Netflix", amount=200, next_billing_date="2026-11-10"))
    client.post(
        "/api/v1/subscriptions",
        json=_sub(name="Microsoft 365", amount=1200, billing_cycle="yearly", next_billing_date="2027-03-01",
                  category="Yazılım"),
    )
    client.post(
        "/api/v1/subscriptions",
        json=_sub(name="ChatGPT Plus", amount=20, currency="USD", next_billing_date="2026-11-25", category="Yazılım"),
    )
    client.post("/api/v1/subscriptions", json=_sub(name="Durdurulan", amount=999, status="paused"))
    client.post(
        "/api/v1/subscriptions",
        json=_sub(name="Disney+", amount=150, status="trial", trial_ends_at="2026-11-12",
                  next_billing_date="2026-11-12"),
    )

    s = client.get("/api/v1/subscriptions/summary").json()
    assert s["active_count"] == 4  # aktif + deneme; durdurulan hariç
    assert s["monthly_totals"] == [{"currency": "TRY", "amount": 300.0}, {"currency": "USD", "amount": 20.0}]
    assert s["yearly_totals"][0] == {"currency": "TRY", "amount": 3600.0}
    assert {c["category"]: c["monthly_amount"] for c in s["by_category"]} == {"Dizi & Film": 200.0, "Yazılım": 100.0}
    assert sorted(x["name"] for x in s["upcoming"]) == ["Disney+", "Netflix"]
    assert [x["name"] for x in s["trials_ending"]] == ["Disney+"]


def test_expired_trial_becomes_active(client: TestClient) -> None:
    sid = client.post(
        "/api/v1/subscriptions",
        json=_sub(status="trial", trial_ends_at="2026-11-01", next_billing_date="2026-11-01"),
    ).json()["id"]
    sub = client.get(f"/api/v1/subscriptions/{sid}").json()
    assert sub["status"] == "active"
    assert sub["next_billing_date"] == "2026-12-01"


def test_subscriptions_are_isolated_between_users(
    anon_client: TestClient, register: Callable[..., str]
) -> None:
    a = {"Authorization": f"Bearer {register('a@example.com', 'sifre-a-1234')}"}
    b = {"Authorization": f"Bearer {register('b@example.com', 'sifre-b-1234')}"}
    sid = anon_client.post("/api/v1/subscriptions", json=_sub(), headers=a).json()["id"]

    assert anon_client.get("/api/v1/subscriptions", headers=b).json() == []
    assert anon_client.get(f"/api/v1/subscriptions/{sid}", headers=b).status_code == 404
    assert anon_client.put(f"/api/v1/subscriptions/{sid}", json=_sub(), headers=b).status_code == 404
    assert anon_client.delete(f"/api/v1/subscriptions/{sid}", headers=b).status_code == 404
    assert anon_client.get("/api/v1/subscriptions/summary", headers=b).json()["active_count"] == 0
    assert anon_client.get("/api/v1/subscriptions").status_code == 401


def test_deleting_account_removes_subscriptions(client: TestClient, db_session: Session) -> None:
    sid = client.post("/api/v1/subscriptions", json=_sub(amount=100)).json()["id"]
    client.put(f"/api/v1/subscriptions/{sid}", json=_sub(amount=120))
    assert client.delete("/api/v1/auth/me").status_code == 204
    db_session.expire_all()
    assert db_session.scalars(select(Subscription)).all() == []
    assert db_session.scalars(select(SubscriptionPriceChange)).all() == []


def test_catalog_endpoint(client: TestClient) -> None:
    catalog = client.get("/api/v1/subscriptions/catalog").json()
    keys = {c["key"] for c in catalog}
    assert {"netflix", "spotify", "youtube_premium"} <= keys
    assert all("patterns" not in c for c in catalog)


def test_detect_endpoint_marks_already_tracked(client: TestClient) -> None:
    client.post("/api/v1/subscriptions", json=_sub(name="Netflix"))
    parsed = ParsedStatement(
        transactions=[
            tx("2026-09-12", "NETFLIX.COM", 229.99),
            tx("2026-10-12", "NETFLIX.COM", 229.99),
            tx("2026-09-20", "SPOTIFY", 99.0),
            tx("2026-10-20", "SPOTIFY", 99.0),
        ]
    )
    with patch(PARSER, return_value=parsed) as mock_parse:
        res = client.post(
            "/api/v1/subscriptions/detect",
            files={"file": ("ekstre.csv", "tarih;aciklama;tutar".encode(), "text/csv")},
        )
    assert res.status_code == 200, res.text
    mock_parse.assert_called_once()
    assert mock_parse.call_args.args[1] == "text/csv"
    body = res.json()
    assert body["transactions_found"] == 4
    tracked = {c["name"]: c["already_tracked"] for c in body["candidates"]}
    assert tracked == {"Netflix": True, "Spotify": False}
    # Tespit hiçbir şey kaydetmez
    assert len(client.get("/api/v1/subscriptions").json()) == 1


def test_detect_endpoint_rejects_bad_files_and_hides_errors(client: TestClient) -> None:
    bad = client.post("/api/v1/subscriptions/detect", files={"file": ("x.exe", b"MZ", "application/octet-stream")})
    assert bad.status_code == 400
    empty = client.post("/api/v1/subscriptions/detect", files={"file": ("e.pdf", b"", "application/pdf")})
    assert empty.status_code == 400
    with patch(PARSER, side_effect=RuntimeError("SIR-GIZLI")):
        err = client.post("/api/v1/subscriptions/detect", files={"file": ("e.pdf", b"%PDF", "application/pdf")})
    assert err.status_code == 502
    assert "SIR-GIZLI" not in err.text
