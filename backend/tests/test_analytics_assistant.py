import datetime as dt
from decimal import Decimal
from types import SimpleNamespace
from typing import Any, Callable, List
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from google.genai import types
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.assistant import rate_limiter
from app.models.budget import Budget
from app.models.receipt import Receipt, ReceiptItem
from app.services.analytics import month_range, parse_month
from app.services.assistant_tools import ToolContext, execute_tool

TODAY = dt.date(2026, 11, 15)


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.api.analytics.today", lambda: TODAY)
    monkeypatch.setattr("app.api.assistant.today", lambda: TODAY)
    rate_limiter.reset()


def _user_id(client: TestClient) -> int:
    return client.get("/api/v1/auth/me").json()["id"]


def _add_receipt(db: Session, user_id: int, date: str, merchant: str, items: List[tuple]) -> Receipt:
    receipt = Receipt(
        user_id=user_id,
        merchant=merchant,
        date=dt.date.fromisoformat(date),
        total_amount=sum(Decimal(str(p)) for _, p, _ in items),
        items=[ReceiptItem(name=n, price=Decimal(str(p)), quantity=Decimal(1), category=c) for n, p, c in items],
    )
    db.add(receipt)
    db.commit()
    return receipt


@pytest.fixture
def seeded(client: TestClient, db_session: Session) -> int:
    uid = _user_id(client)
    _add_receipt(db_session, uid, "2026-09-10", "Migros", [("Tam Yağlı SÜT 1L", 45.5, "Gıda"), ("Deterjan", 120, "Temizlik")])
    _add_receipt(db_session, uid, "2026-10-05", "BİM", [("Ekmek", 15, "Gıda"), ("Filtre Kahve", 200, "İçecek")])
    _add_receipt(db_session, uid, "2026-11-03", "Migros Jet", [("Süt", 50, "Gıda"), ("Kahve Kapsül", 300, "İçecek")])
    _add_receipt(db_session, uid, "2026-11-10", "Starbucks", [("Latte", 110, "Restoran & Kafe")])
    return uid


# --- Analiz yardımcıları ---

def test_parse_month() -> None:
    assert parse_month(None, TODAY).key == "2026-11"
    rng = parse_month("2028-02", TODAY)
    assert (rng.start, rng.end, rng.label) == (dt.date(2028, 2, 1), dt.date(2028, 2, 29), "Şub 2028")
    with pytest.raises(ValueError):
        parse_month("2026-13", TODAY)
    with pytest.raises(ValueError):
        parse_month("kasım", TODAY)
    assert month_range(2026, 12).end == dt.date(2026, 12, 31)


def test_trend_endpoint_fills_empty_months(client: TestClient, seeded: int) -> None:
    trend = client.get("/api/v1/analytics/trend", params={"months": 4}).json()
    assert [p["month"] for p in trend] == ["2026-08", "2026-09", "2026-10", "2026-11"]
    assert [p["total"] for p in trend] == [0.0, 165.5, 215.0, 460.0]
    assert trend[-1]["label"] == "Kas 2026"
    assert trend[-1]["receipt_count"] == 2
    # Yıl sınırını geçen trend
    long = client.get("/api/v1/analytics/trend", params={"months": 12}).json()
    assert long[0]["month"] == "2025-12"
    assert client.get("/api/v1/analytics/trend", params={"months": 99}).status_code == 422


# --- Bütçeler ---

def test_budget_lifecycle_and_states(client: TestClient, seeded: int) -> None:
    res = client.post("/api/v1/budgets", json={"monthly_limit": 500})
    assert res.status_code == 201, res.text
    overall = res.json()["budgets"][0]
    assert overall["category"] is None
    assert overall["spent"] == 460.0  # Kasım fişleri
    assert overall["state"] == "warning"  # %92
    assert overall["percent"] == 92.0
    # 15 günde 460 harcandı -> 30 günlük ay sonu tahmini 920
    assert overall["projected"] == 920.0

    res = client.post("/api/v1/budgets", json={"category": "içecek", "monthly_limit": 250})
    assert res.status_code == 201
    drinks = next(b for b in res.json()["budgets"] if b["category"] == "içecek")
    assert drinks["spent"] == 300.0  # Türkçe büyük/küçük harf farkına rağmen eşleşir
    assert drinks["state"] == "exceeded"
    assert drinks["remaining"] == -50.0

    # Aynı kategori (farklı yazımla) ve ikinci genel bütçe reddedilir
    assert client.post("/api/v1/budgets", json={"category": "İÇECEK", "monthly_limit": 100}).status_code == 409
    assert client.post("/api/v1/budgets", json={"category": "  ", "monthly_limit": 100}).status_code == 409
    assert client.post("/api/v1/budgets", json={"monthly_limit": 0}).status_code == 422

    gida = client.post("/api/v1/budgets", json={"category": "Gıda", "monthly_limit": 1000}).json()
    gida_row = next(b for b in gida["budgets"] if b["category"] == "Gıda")
    assert gida_row["state"] == "ok"
    assert gida_row["spent"] == 50.0

    # Geçmiş ay: tahmin = harcanan
    october = client.get("/api/v1/budgets", params={"month": "2026-10"}).json()
    assert october["label"] == "Eki 2026"
    oct_overall = next(b for b in october["budgets"] if b["category"] is None)
    assert oct_overall["spent"] == oct_overall["projected"] == 215.0
    assert client.get("/api/v1/budgets", params={"month": "2026/10"}).status_code == 422

    updated = client.put(f"/api/v1/budgets/{overall['id']}", json={"monthly_limit": 1000}).json()
    assert next(b for b in updated["budgets"] if b["category"] is None)["state"] == "ok"
    assert client.delete(f"/api/v1/budgets/{overall['id']}").status_code == 204
    assert len(client.get("/api/v1/budgets").json()["budgets"]) == 2


def test_budgets_are_isolated(anon_client: TestClient, register: Callable[..., str], db_session: Session) -> None:
    a = {"Authorization": f"Bearer {register('a@example.com', 'sifre-a-1234')}"}
    b = {"Authorization": f"Bearer {register('b@example.com', 'sifre-b-1234')}"}
    bid = anon_client.post("/api/v1/budgets", json={"monthly_limit": 100}, headers=a).json()["budgets"][0]["id"]
    assert anon_client.get("/api/v1/budgets", headers=b).json()["budgets"] == []
    assert anon_client.put(f"/api/v1/budgets/{bid}", json={"monthly_limit": 1}, headers=b).status_code == 404
    assert anon_client.delete(f"/api/v1/budgets/{bid}", headers=b).status_code == 404
    assert anon_client.get("/api/v1/budgets").status_code == 401
    # Hesap silinince bütçe de silinir
    assert anon_client.delete("/api/v1/auth/me", headers=a).status_code == 204
    db_session.expire_all()
    assert db_session.scalars(select(Budget)).all() == []


# --- Asistan araçları ---

def test_tools_return_correct_numbers(client: TestClient, db_session: Session, seeded: int) -> None:
    ctx = ToolContext(db=db_session, user_id=seeded, today=TODAY)

    nov = execute_tool(ctx, "get_spending_summary", {"start_date": "2026-11-01", "end_date": "2026-11-30"})
    assert nov["total"] == 460.0
    assert nov["receipt_count"] == 2
    assert nov["top_merchants"][0] == {"merchant": "Migros Jet", "total": 350.0, "count": 1}

    gida = execute_tool(ctx, "get_spending_summary", {"category": "gıda"})
    assert gida["total"] == 110.5  # yalnızca Gıda satırları, fiş toplamları değil
    assert gida["receipt_count"] == 3

    migros = execute_tool(ctx, "get_spending_summary", {"merchant": "migros"})
    assert migros["total"] == 515.5

    sut = execute_tool(ctx, "search_purchased_items", {"query": "süt"})
    assert sut["match_count"] == 2  # 'SÜT' ve 'Süt' ikisi de bulunur
    assert sut["total"] == 95.5
    kahve = execute_tool(ctx, "search_purchased_items", {"query": "kahve", "start_date": "2026-11-01"})
    assert kahve["match_count"] == 1

    trend = execute_tool(ctx, "get_monthly_trend", {"months": 3})
    assert [m["total"] for m in trend["months"]] == [165.5, 215.0, 460.0]

    recent = execute_tool(ctx, "list_recent_receipts", {"limit": 2})
    assert [r["merchant"] for r in recent["receipts"]] == ["Starbucks", "Migros Jet"]

    budgets = execute_tool(ctx, "get_budget_status", {})
    assert budgets["budgets"] == [] and budgets["note"]


def test_tools_handle_bad_input_without_crashing(db_session: Session, client: TestClient) -> None:
    ctx = ToolContext(db=db_session, user_id=_user_id(client), today=TODAY)
    assert "error" in execute_tool(ctx, "drop_database", {})
    assert "error" in execute_tool(ctx, "get_spending_summary", {"start_date": "dün"})
    assert "error" in execute_tool(ctx, "search_purchased_items", {"query": ""})
    assert "error" in execute_tool(ctx, "get_budget_status", {"month": "13-2026"})
    # Hatalı sayı parametresi varsayılana düşer
    assert len(execute_tool(ctx, "get_monthly_trend", {"months": "çok"})["months"]) == 6


def test_subscription_tool(client: TestClient, db_session: Session) -> None:
    client.post(
        "/api/v1/subscriptions",
        json={"name": "Netflix", "amount": 229.99, "billing_cycle": "monthly", "next_billing_date": "2026-11-20"},
    )
    ctx = ToolContext(db=db_session, user_id=_user_id(client), today=TODAY)
    result = execute_tool(ctx, "get_subscriptions", {})
    assert result["count"] == 1
    assert result["subscriptions"][0]["yearly_equivalent"] == 2759.88
    assert execute_tool(ctx, "get_subscriptions", {"status": "paused"})["count"] == 0


# --- Asistan sohbet döngüsü ---

def _call_response(name: str, args: dict) -> Any:
    call = types.FunctionCall(name=name, args=args)
    return SimpleNamespace(
        function_calls=[call],
        text=None,
        candidates=[SimpleNamespace(content=types.Content(role="model", parts=[types.Part(function_call=call)]))],
    )


def _text_response(text: str) -> Any:
    return SimpleNamespace(function_calls=None, text=text, candidates=[])


def test_chat_runs_tools_and_returns_answer(client: TestClient, seeded: int) -> None:
    seen_contents: List[list] = []

    async def fake_generate(contents, config):  # type: ignore[no-untyped-def]
        seen_contents.append(list(contents))
        if len(seen_contents) == 1:
            # Model önce aracı çağırır
            assert "2026-11-15" in config.system_instruction
            assert {fd.name for fd in config.tools[0].function_declarations} >= {"get_spending_summary"}
            return _call_response("get_spending_summary", {"start_date": "2026-11-01", "end_date": "2026-11-30"})
        # Araç sonucu modele geri gönderilmiş olmalı
        tool_part = contents[-1].parts[0]
        assert tool_part.function_response.name == "get_spending_summary"
        assert tool_part.function_response.response["result"]["total"] == 460.0
        return _text_response("Bu ay toplam **460,00 ₺** harcadınız.")

    with patch("app.api.assistant.assistant_service._generate", side_effect=fake_generate):
        res = client.post(
            "/api/v1/assistant/chat",
            json={
                "messages": [
                    {"role": "user", "content": "Merhaba"},
                    {"role": "assistant", "content": "Merhaba! Size nasıl yardımcı olabilirim?"},
                    {"role": "user", "content": "Bu ay ne kadar harcadım?"},
                ]
            },
        )
    assert res.status_code == 200, res.text
    assert res.json() == {"reply": "Bu ay toplam **460,00 ₺** harcadınız.", "tools_used": ["get_spending_summary"]}
    # Geçmiş doğru rollerle gönderildi
    assert [c.role for c in seen_contents[0]] == ["user", "model", "user"]


def test_chat_stops_after_too_many_tool_rounds(client: TestClient) -> None:
    async def always_tool(contents, config):  # type: ignore[no-untyped-def]
        return _call_response("get_monthly_trend", {"months": 1})

    with patch("app.api.assistant.assistant_service._generate", side_effect=always_tool):
        res = client.post("/api/v1/assistant/chat", json={"messages": [{"role": "user", "content": "?"}]})
    assert res.status_code == 200
    assert "çok fazla adım" in res.json()["reply"]
    assert len(res.json()["tools_used"]) == 6


def test_chat_validation_rate_limit_and_errors(client: TestClient, anon_client: TestClient, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    url = "/api/v1/assistant/chat"
    assert client.post(url, json={"messages": []}).status_code == 422
    assert client.post(url, json={"messages": [{"role": "assistant", "content": "x"}]}).status_code == 422
    assert client.post(url, json={"messages": [{"role": "user", "content": "x" * 2001}]}).status_code == 422
    too_many = [{"role": "user", "content": "x"}] * 21
    assert client.post(url, json={"messages": too_many}).status_code == 422

    with patch("app.api.assistant.assistant_service._generate", side_effect=RuntimeError("API_KEY=SIR")):
        err = client.post(url, json={"messages": [{"role": "user", "content": "selam"}]})
    assert err.status_code == 502
    assert "SIR" not in err.text

    monkeypatch.setattr(rate_limiter, "max_requests", 2)
    rate_limiter.reset()

    async def ok(contents, config):  # type: ignore[no-untyped-def]
        return _text_response("tamam")

    with patch("app.api.assistant.assistant_service._generate", side_effect=ok):
        codes = [client.post(url, json={"messages": [{"role": "user", "content": "s"}]}).status_code for _ in range(3)]
    assert codes == [200, 200, 429]

    anon_client.headers.pop("Authorization", None)
    assert anon_client.post(url, json={"messages": [{"role": "user", "content": "s"}]}).status_code == 401
