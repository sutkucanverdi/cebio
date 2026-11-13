"""Mağaza/KVKK uyumu ve yeni özellikler: ayrı yapay zeka rızası, dil, yapay zeka cevabı bildirme,
elle fiş ekleme ve kişisel enflasyon (fiyat takibi)."""
import datetime as dt
from typing import Callable

from fastapi.testclient import TestClient

from app.core.i18n import parse_accept_language, translate
from app.models.ai_report import AIReport


def _auth(client: TestClient, token: str) -> None:
    client.headers.update({"Authorization": f"Bearer {token}"})


def test_ai_consent_is_optional_at_signup_and_blocks_ai(anon_client: TestClient, register: Callable[..., str]) -> None:
    _auth(anon_client, register(ai_consent=False))
    me = anon_client.get("/api/v1/auth/me").json()
    assert me["ai_consent_at"] is None

    # Rıza yokken yapay zeka uç noktaları veriyi hiç göndermeden 403 döner
    res = anon_client.post("/api/v1/assistant/chat", json={"messages": [{"role": "user", "content": "Selam"}]})
    assert res.status_code == 403
    assert res.headers.get("X-Cebio-Consent") == "ai"

    res = anon_client.post(
        "/api/v1/receipts/upload", files={"file": ("f.jpg", b"\xff\xd8\xff data", "image/jpeg")}
    )
    assert res.status_code == 403

    # Rıza verilir, sonra geri alınır
    me = anon_client.patch("/api/v1/auth/me", json={"ai_consent": True}).json()
    assert me["ai_consent_at"] is not None
    me = anon_client.patch("/api/v1/auth/me", json={"ai_consent": False}).json()
    assert me["ai_consent_at"] is None


def test_preferences_locale_and_name(client: TestClient) -> None:
    me = client.patch("/api/v1/auth/me", json={"locale": "en", "full_name": "  Utku  "}).json()
    assert me["locale"] == "en"
    assert me["full_name"] == "Utku"
    assert client.patch("/api/v1/auth/me", json={"locale": "de"}).status_code == 422


def test_errors_are_translated_by_accept_language(anon_client: TestClient, register: Callable[..., str]) -> None:
    register()
    bad = {"email": "utku@example.com", "password": "yanlis-sifre"}
    tr = anon_client.post("/api/v1/auth/login", json=bad)
    en = anon_client.post("/api/v1/auth/login", json=bad, headers={"Accept-Language": "en-US,en;q=0.9"})
    assert tr.json()["detail"] == "E-posta veya şifre hatalı."
    assert en.json()["detail"] == "Incorrect email or password."


def test_i18n_helpers() -> None:
    assert parse_accept_language("en-GB,en;q=0.9,tr;q=0.8") == "en"
    assert parse_accept_language("tr-TR,tr;q=0.9,en;q=0.5") == "tr"
    assert parse_accept_language("de-DE") == "tr"
    assert parse_accept_language(None) == "tr"
    assert translate("Dosya çok büyük. En fazla 10 MB yükleyebilirsiniz.", "en") == (
        "The file is too large. You can upload at most 10 MB."
    )
    assert translate('"Gıda" kategorisi için zaten bir bütçe var. Mevcut bütçeyi düzenleyin.', "en") == (
        'A budget for the "Groceries" category already exists. Edit the existing budget instead.'
    )
    assert translate("Bilinmeyen mesaj", "en") == "Bilinmeyen mesaj"


def test_report_ai_reply(client: TestClient, db_session) -> None:  # type: ignore[no-untyped-def]
    res = client.post("/api/v1/assistant/report", json={"reason": "wrong", "content": "Yanlış cevap", "note": "rakam hatalı"})
    assert res.status_code == 201
    row = db_session.query(AIReport).one()
    assert (row.reason, row.content, row.note) == ("wrong", "Yanlış cevap", "rakam hatalı")
    assert client.post("/api/v1/assistant/report", json={"reason": "spam", "content": "x"}).status_code == 422


def test_reports_are_deleted_with_account(client: TestClient, db_session) -> None:  # type: ignore[no-untyped-def]
    client.post("/api/v1/assistant/report", json={"reason": "offensive", "content": "kötü"})
    assert client.delete("/api/v1/auth/me").status_code == 204
    db_session.expire_all()
    assert db_session.query(AIReport).count() == 0


def _manual(client: TestClient, date: str, price: float, name: str = "Süt 1L", qty: float = 1) -> None:
    res = client.post(
        "/api/v1/receipts",
        json={
            "merchant": "Market",
            "date": date,
            "total_amount": price * qty,
            "items": [{"name": name, "price": price * qty, "quantity": qty, "category": "Gıda"}],
        },
    )
    assert res.status_code == 201, res.text


def test_manual_receipt_does_not_use_ai_quota(anon_client: TestClient, register: Callable[..., str]) -> None:
    _auth(anon_client, register(ai_consent=False))
    _manual(anon_client, "2026-11-02", 40)
    receipts = anon_client.get("/api/v1/receipts").json()
    assert len(receipts) == 1 and receipts[0]["items"][0]["category"] == "Gıda"
    usage = anon_client.get("/api/v1/billing/status").json()["features"]
    assert all(f["used"] == 0 for f in usage)


def test_price_watch_and_history(client: TestClient) -> None:
    today = dt.date.today()
    early = (today - dt.timedelta(days=90)).isoformat()
    late = (today - dt.timedelta(days=5)).isoformat()
    _manual(client, early, 30)
    _manual(client, late, 39, name="SÜT 1L", qty=2)  # birim fiyat 39 -> %30 artış
    _manual(client, late, 100, name="Tek seferlik ürün")

    watch = client.get("/api/v1/receipts/price-watch").json()
    assert watch["tracked_items"] == 1
    item = watch["items"][0]
    assert (item["first_price"], item["last_price"], item["change_pct"]) == (30.0, 39.0, 30.0)
    assert watch["basket_change_pct"] == 30.0

    history = client.get("/api/v1/receipts/price-history", params={"q": "süt"}).json()
    assert [p["unit_price"] for p in history["points"]] == [30.0, 39.0]
    assert history["change_pct"] == 30.0


def test_monthly_report_in_english(client: TestClient) -> None:
    _manual(client, "2026-10-03", 120)
    res = client.get("/api/v1/reports/monthly", params={"month": "2026-10"}, headers={"Accept-Language": "en"})
    body = res.json()
    assert body["label"] == "October 2026"
    assert any("Groceries" in s for s in body["insights"])
