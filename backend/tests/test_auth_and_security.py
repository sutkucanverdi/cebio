from typing import Callable
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.receipt import Receipt, ReceiptItem
from app.schemas.receipt import ParsedReceipt, ParsedReceiptItem

PARSER = "app.api.routes.receipt_parser_service.parse_receipt_image"


def _parsed(merchant: str = "Migros", date: str = "2026-11-01", total: float = 100.0) -> ParsedReceipt:
    return ParsedReceipt(
        merchant=merchant,
        date=date,
        total_amount=total,
        items=[ParsedReceiptItem(name="Ürün", price=total, category="Gıda")],
    )


def _upload(client: TestClient, parsed: ParsedReceipt) -> dict:
    with patch(PARSER, return_value=parsed):
        res = client.post("/api/v1/receipts/upload", files={"file": ("f.jpg", b"img", "image/jpeg")})
    assert res.status_code == 201, res.text
    return res.json()


# --- Kimlik doğrulama ---

def test_register_login_me(anon_client: TestClient) -> None:
    res = anon_client.post(
        "/api/v1/auth/register",
        json={"email": "Ali@Example.com", "password": "uzun-sifre-1", "full_name": "Ali"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["token_type"] == "bearer"
    assert body["user"]["email"] == "ali@example.com"  # küçük harfe normalize edilir

    dup = anon_client.post("/api/v1/auth/register", json={"email": "ali@example.com", "password": "baska-sifre-1"})
    assert dup.status_code == 409

    bad = anon_client.post("/api/v1/auth/login", json={"email": "ali@example.com", "password": "yanlis-sifre"})
    assert bad.status_code == 401

    ok = anon_client.post("/api/v1/auth/login", json={"email": "ALI@example.com", "password": "uzun-sifre-1"})
    assert ok.status_code == 200
    token = ok.json()["access_token"]

    me = anon_client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["full_name"] == "Ali"


def test_oauth2_form_token_endpoint(anon_client: TestClient, register: Callable[..., str]) -> None:
    register("form@example.com", "form-sifre-12")
    res = anon_client.post(
        "/api/v1/auth/token",
        data={"username": "form@example.com", "password": "form-sifre-12"},
    )
    assert res.status_code == 200
    assert res.json()["access_token"]


def test_short_password_rejected(anon_client: TestClient) -> None:
    res = anon_client.post("/api/v1/auth/register", json={"email": "a@example.com", "password": "kisa"})
    assert res.status_code == 422


def test_receipt_endpoints_require_auth(anon_client: TestClient) -> None:
    assert anon_client.get("/api/v1/receipts").status_code == 401
    assert anon_client.get("/api/v1/receipts/summary").status_code == 401
    assert anon_client.delete("/api/v1/receipts/1").status_code == 401
    bad_token = anon_client.get("/api/v1/receipts", headers={"Authorization": "Bearer sahte.token.degeri"})
    assert bad_token.status_code == 401


def test_users_cannot_see_each_others_receipts(
    anon_client: TestClient, register: Callable[..., str]
) -> None:
    token_a = register("a@example.com", "sifre-a-1234")
    token_b = register("b@example.com", "sifre-b-1234")
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}

    with patch(PARSER, return_value=_parsed("A Market", total=50.0)):
        receipt_a = anon_client.post(
            "/api/v1/receipts/upload",
            files={"file": ("f.jpg", b"img", "image/jpeg")},
            headers=headers_a,
        ).json()

    assert len(anon_client.get("/api/v1/receipts", headers=headers_a).json()) == 1
    assert anon_client.get("/api/v1/receipts", headers=headers_b).json() == []
    assert anon_client.get("/api/v1/receipts/summary", headers=headers_b).json()["total_receipts"] == 0

    rid = receipt_a["id"]
    assert anon_client.get(f"/api/v1/receipts/{rid}", headers=headers_b).status_code == 404
    assert anon_client.delete(f"/api/v1/receipts/{rid}", headers=headers_b).status_code == 404
    put = anon_client.put(
        f"/api/v1/receipts/{rid}",
        json={"merchant": "Hack", "date": "2026-11-01", "total_amount": 1, "items": []},
        headers=headers_b,
    )
    assert put.status_code == 404
    # A'nın fişi hâlâ yerinde
    assert anon_client.get(f"/api/v1/receipts/{rid}", headers=headers_a).json()["merchant"] == "A Market"


def test_delete_account_removes_all_data(client: TestClient, db_session: Session) -> None:
    _upload(client, _parsed())
    assert db_session.scalars(select(Receipt)).all()

    assert client.delete("/api/v1/auth/me").status_code == 204
    db_session.expire_all()
    assert db_session.scalars(select(Receipt)).all() == []
    assert db_session.scalars(select(ReceiptItem)).all() == []
    assert client.get("/api/v1/auth/me").status_code == 401


def test_first_user_claims_legacy_receipts(
    anon_client: TestClient, register: Callable[..., str], db_session: Session
) -> None:
    # Kullanıcı sistemi öncesinden kalan sahipsiz fiş
    db_session.add(Receipt(merchant="Eski Fiş", date=__import__("datetime").date(2026, 1, 1), total_amount=10))
    db_session.commit()

    token_first = register("ilk@example.com", "ilk-sifre-123")
    token_second = register("ikinci@example.com", "ikinci-sifre-1")

    first = anon_client.get("/api/v1/receipts", headers={"Authorization": f"Bearer {token_first}"}).json()
    second = anon_client.get("/api/v1/receipts", headers={"Authorization": f"Bearer {token_second}"}).json()
    assert [r["merchant"] for r in first] == ["Eski Fiş"]
    assert second == []


# --- Yükleme korumaları ---

def test_upload_too_large_returns_413(client: TestClient, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(settings, "MAX_UPLOAD_MB", 1)
    big = b"x" * (1024 * 1024 + 1)
    with patch(PARSER) as mock_parse:
        res = client.post("/api/v1/receipts/upload", files={"file": ("big.jpg", big, "image/jpeg")})
    assert res.status_code == 413
    mock_parse.assert_not_called()


def test_upload_empty_file_returns_400(client: TestClient) -> None:
    res = client.post("/api/v1/receipts/upload", files={"file": ("bos.jpg", b"", "image/jpeg")})
    assert res.status_code == 400


def test_parser_internal_error_is_not_leaked(client: TestClient) -> None:
    with patch(PARSER, side_effect=RuntimeError("api_key=SIR-GIZLI internal stack")):
        res = client.post("/api/v1/receipts/upload", files={"file": ("f.jpg", b"img", "image/jpeg")})
    assert res.status_code == 502
    assert "SIR-GIZLI" not in res.text


def test_invalid_parsed_date_falls_back_to_today(client: TestClient) -> None:
    import datetime as dt

    data = _upload(client, _parsed(date="okunamadı"))
    assert data["date"] == dt.date.today().isoformat()


# --- Para hassasiyeti ve özet filtreleri ---

def test_money_is_exact_decimal(client: TestClient) -> None:
    parsed = ParsedReceipt(
        merchant="Kuruş Market",
        date="2026-11-01",
        total_amount=0.3,
        items=[
            ParsedReceiptItem(name="A", price=0.1, category="Gıda"),
            ParsedReceiptItem(name="B", price=0.2, category="Gıda"),
        ],
    )
    _upload(client, parsed)
    summary = client.get("/api/v1/receipts/summary").json()
    assert summary["total_amount"] == 0.3
    assert summary["category_breakdown"][0]["total_amount"] == 0.3  # float'ta 0.30000000000000004 olurdu
    # JSON'da tutarlar string değil sayı olarak döner (frontend sözleşmesi)
    assert isinstance(summary["total_amount"], float)


def test_summary_respects_date_and_merchant_filters(client: TestClient) -> None:
    _upload(client, _parsed("Migros", "2026-10-01", 100.0))
    _upload(client, _parsed("BİM", "2026-10-15", 40.0))
    _upload(client, _parsed("Migros", "2026-11-01", 60.0))

    october = client.get(
        "/api/v1/receipts/summary", params={"start_date": "2026-10-01", "end_date": "2026-10-31"}
    ).json()
    assert october["total_receipts"] == 2
    assert october["total_amount"] == 140.0

    migros = client.get("/api/v1/receipts/summary", params={"merchant": "migros"}).json()
    assert migros["total_receipts"] == 2
    assert migros["total_amount"] == 160.0

    bad_date = client.get("/api/v1/receipts/summary", params={"start_date": "31-10-2026"})
    assert bad_date.status_code == 422


def test_receipts_sorted_by_date_desc(client: TestClient) -> None:
    _upload(client, _parsed("Eski", "2026-01-01"))
    _upload(client, _parsed("Yeni", "2026-12-01"))
    _upload(client, _parsed("Orta", "2026-06-01"))
    merchants = [r["merchant"] for r in client.get("/api/v1/receipts").json()]
    assert merchants == ["Yeni", "Orta", "Eski"]
