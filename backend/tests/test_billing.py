from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.assistant import rate_limiter
from app.core.config import settings
from app.models.usage import UsageCounter
from app.models.user import User
from app.schemas.receipt import ParsedReceipt, ParsedReceiptItem
from app.schemas.subscription import ParsedStatement, StatementTransaction
from app.services.billing import current_period, grant_premium
from tests.conftest import TestingSessionLocal

RECEIPT_PARSER = "app.api.routes.receipt_parser_service.parse_receipt_image"
STATEMENT_PARSER = "app.api.uploads.statement_parser_service.parse_statement"
ASSISTANT = "app.api.assistant.assistant_service._generate"
WEBHOOK = "/api/v1/billing/revenuecat-webhook"
SECRET = "rc-test-secret-123"


@pytest.fixture(autouse=True)
def small_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "FREE_RECEIPT_SCANS_PER_MONTH", 2)
    monkeypatch.setattr(settings, "FREE_STATEMENT_SCANS_PER_MONTH", 1)
    monkeypatch.setattr(settings, "FREE_ASSISTANT_QUESTIONS_PER_MONTH", 1)
    monkeypatch.setattr(settings, "PREMIUM_RECEIPT_SCANS_PER_MONTH", 5)
    rate_limiter.reset()


def _parsed() -> ParsedReceipt:
    return ParsedReceipt(
        merchant="Market", date="2026-11-01", total_amount=10, items=[ParsedReceiptItem(name="X", price=10, category="Gıda")]
    )


def _upload(client: TestClient) -> Any:
    return client.post("/api/v1/receipts/upload", files={"file": ("f.jpg", b"img", "image/jpeg")})


def _user(db: Session) -> User:
    return db.scalars(select(User)).first()  # type: ignore[return-value]


def _status(client: TestClient) -> dict:
    data = client.get("/api/v1/billing/status").json()
    return {f["feature"]: (f["used"], f["limit"]) for f in data["features"]} | {"plan": data["plan"]}


# --- Kotalar ---

def test_free_receipt_limit(client: TestClient) -> None:
    with patch(RECEIPT_PARSER, return_value=_parsed()) as parser:
        assert _upload(client).status_code == 201
        assert _upload(client).status_code == 201
        blocked = _upload(client)
    assert blocked.status_code == 402
    assert "Ücretsiz planda ayda 2 fiş tarama" in blocked.json()["detail"]
    assert blocked.headers["X-Cebio-Limit"] == "receipt_scan"
    assert parser.call_count == 2  # limit dolunca Gemini'ye hiç gidilmez
    assert _status(client)["receipt_scan"] == (2, 2)


def test_failed_ai_calls_do_not_consume_quota(client: TestClient) -> None:
    with patch(RECEIPT_PARSER, side_effect=RuntimeError("gemini down")):
        assert _upload(client).status_code == 502
        assert _upload(client).status_code == 502
        assert _upload(client).status_code == 502
    assert _status(client)["receipt_scan"] == (0, 2)
    with patch(RECEIPT_PARSER, return_value=_parsed()):
        assert _upload(client).status_code == 201


def test_premium_raises_limits_and_expires(client: TestClient, db_session: Session) -> None:
    grant_premium(db_session, _user(db_session), datetime.now(timezone.utc) + timedelta(days=30), "promo")
    status = client.get("/api/v1/billing/status").json()
    assert status["plan"] == "premium" and status["plan_source"] == "promo"
    with patch(RECEIPT_PARSER, return_value=_parsed()):
        for _ in range(5):
            assert _upload(client).status_code == 201
        premium_block = _upload(client)
    assert premium_block.status_code == 402
    assert "Limit her ayın başında yenilenir" in premium_block.json()["detail"]

    # Süresi dolan premium ücretsiz plana döner
    grant_premium(db_session, _user(db_session), datetime.now(timezone.utc) - timedelta(minutes=1), "promo")
    assert _status(client)["plan"] == "free"


def test_usage_resets_each_month(client: TestClient, db_session: Session) -> None:
    user = _user(db_session)
    db_session.add(UsageCounter(user_id=user.id, period="2020-01", feature="receipt_scan", count=99))
    db_session.commit()
    assert _status(client)["receipt_scan"] == (0, 2)
    with patch(RECEIPT_PARSER, return_value=_parsed()):
        assert _upload(client).status_code == 201
    row = db_session.scalars(
        select(UsageCounter).where(UsageCounter.period == current_period(), UsageCounter.feature == "receipt_scan")
    ).one()
    assert row.count == 1


def test_statement_scans_share_one_quota(client: TestClient) -> None:
    parsed = ParsedStatement(transactions=[StatementTransaction(date="2026-11-01", description="MIGROS", amount=10)])
    with patch(STATEMENT_PARSER, return_value=parsed):
        ok = client.post("/api/v1/statements/preview", files={"file": ("e.csv", b"x", "text/csv")})
        blocked = client.post("/api/v1/subscriptions/detect", files={"file": ("e.csv", b"x", "text/csv")})
    assert ok.status_code == 200
    assert blocked.status_code == 402 and "ekstre analizi" in blocked.json()["detail"]
    # İçe aktarma (yapay zeka kullanmaz) limitten etkilenmez
    row = {"date": "2026-11-01", "description": "MIGROS", "amount": 10, "currency": "TRY", "category": "Gıda"}
    assert client.post("/api/v1/statements/import", json={"rows": [row]}).status_code == 201


def test_assistant_quota(client: TestClient) -> None:
    class _Resp:
        function_calls = None
        text = "tamam"
        candidates: list = []

    async def ok(contents, config):  # type: ignore[no-untyped-def]
        return _Resp()

    body = {"messages": [{"role": "user", "content": "selam"}]}
    with patch(ASSISTANT, side_effect=RuntimeError("down")):
        assert client.post("/api/v1/assistant/chat", json=body).status_code == 502
    with patch(ASSISTANT, side_effect=ok):
        assert client.post("/api/v1/assistant/chat", json=body).status_code == 200
        assert client.post("/api/v1/assistant/chat", json=body).status_code == 402
    assert _status(client)["assistant"] == (1, 1)


def test_status_endpoint_shape(client: TestClient, anon_client: TestClient) -> None:
    data = client.get("/api/v1/billing/status").json()
    assert data["plan"] == "free"
    assert data["premium_until"] is None
    assert [f["feature"] for f in data["features"]] == ["receipt_scan", "statement_scan", "assistant"]
    assert data["resets_on"] > data["period"]
    anon_client.headers.pop("Authorization", None)
    assert anon_client.get("/api/v1/billing/status").status_code == 401


def test_account_deletion_removes_usage(client: TestClient, db_session: Session) -> None:
    with patch(RECEIPT_PARSER, return_value=_parsed()):
        _upload(client)
    assert client.delete("/api/v1/auth/me").status_code == 204
    db_session.expire_all()
    assert db_session.scalars(select(UsageCounter)).all() == []


# --- RevenueCat webhook ---

def _event(user_id: Any, event_type: str, days: float = 30) -> dict:
    exp = datetime.now(timezone.utc) + timedelta(days=days)
    return {"event": {"type": event_type, "app_user_id": str(user_id), "expiration_at_ms": int(exp.timestamp() * 1000)}}


def test_webhook_requires_configured_secret(client: TestClient, monkeypatch: pytest.MonkeyPatch, db_session: Session) -> None:
    uid = _user(db_session).id
    monkeypatch.setattr(settings, "REVENUECAT_WEBHOOK_SECRET", "")
    assert client.post(WEBHOOK, json=_event(uid, "INITIAL_PURCHASE")).status_code == 503

    monkeypatch.setattr(settings, "REVENUECAT_WEBHOOK_SECRET", SECRET)
    assert client.post(WEBHOOK, json=_event(uid, "INITIAL_PURCHASE"), headers={"Authorization": "yanlis"}).status_code == 401
    assert client.post(WEBHOOK, json=_event(uid, "INITIAL_PURCHASE")).status_code == 401
    assert _status(client)["plan"] == "free"


def test_webhook_lifecycle(client: TestClient, monkeypatch: pytest.MonkeyPatch, db_session: Session) -> None:
    monkeypatch.setattr(settings, "REVENUECAT_WEBHOOK_SECRET", SECRET)
    auth = {"Authorization": f"Bearer {SECRET}"}
    uid = _user(db_session).id

    assert client.post(WEBHOOK, json={"event": {"type": "TEST"}}, headers=auth).json() == {"status": "ok"}
    assert client.post(WEBHOOK, json=_event(999999, "INITIAL_PURCHASE"), headers=auth).json() == {"status": "ignored"}
    assert client.post(WEBHOOK, json={"yok": 1}, headers=auth).status_code == 400

    assert client.post(WEBHOOK, json=_event(uid, "INITIAL_PURCHASE", 30), headers=auth).json() == {"status": "ok"}
    status = client.get("/api/v1/billing/status").json()
    assert status["plan"] == "premium" and status["plan_source"] == "revenuecat"
    first_until = status["premium_until"]

    # Sıra dışı gelen daha eski bir yenileme olayı süreyi kısaltmaz
    client.post(WEBHOOK, json=_event(uid, "RENEWAL", 5), headers=auth)
    assert client.get("/api/v1/billing/status").json()["premium_until"] == first_until

    # İptal erişimi hemen kesmez
    client.post(WEBHOOK, json=_event(uid, "CANCELLATION", 30), headers=auth)
    assert _status(client)["plan"] == "premium"

    # Dönem bitince (EXPIRATION) ücretsiz plana döner
    client.post(WEBHOOK, json=_event(uid, "EXPIRATION", -0.001), headers=auth)
    assert _status(client)["plan"] == "free"


def test_webhook_expiration_does_not_revoke_promo(client: TestClient, monkeypatch: pytest.MonkeyPatch, db_session: Session) -> None:
    monkeypatch.setattr(settings, "REVENUECAT_WEBHOOK_SECRET", SECRET)
    user = _user(db_session)
    grant_premium(db_session, user, datetime.now(timezone.utc) + timedelta(days=60), "promo")
    client.post(WEBHOOK, json=_event(user.id, "EXPIRATION", -1), headers={"Authorization": SECRET})
    assert _status(client)["plan"] == "premium"


# --- Yönetim komutu ---

def test_cli_grant_and_revoke(client: TestClient, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture) -> None:
    import app.cli as cli

    monkeypatch.setattr(cli, "SessionLocal", TestingSessionLocal)
    monkeypatch.setattr(cli, "run_migrations", lambda: None)
    email = client.get("/api/v1/auth/me").json()["email"]

    cli.main(["grant-premium", email, "--days", "7"])
    assert "premium" in capsys.readouterr().out
    assert _status(client)["plan"] == "premium"

    cli.main(["revoke-premium", email])
    assert _status(client)["plan"] == "free"

    with pytest.raises(SystemExit):
        cli.main(["grant-premium", "yok@example.com"])
