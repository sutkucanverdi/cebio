import datetime as dt
from decimal import Decimal
from typing import Callable, List
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.receipt import Receipt, ReceiptItem
from app.models.transaction import StatementImport, Transaction
from app.schemas.subscription import ParsedStatement, StatementTransaction
from app.services.assistant_tools import ToolContext, execute_tool
from app.services.statement_import import display_merchant

PARSER = "app.api.uploads.statement_parser_service.parse_statement"
TODAY = dt.date(2026, 11, 15)


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch: pytest.MonkeyPatch) -> None:
    for mod in ("app.api.statements", "app.api.subscriptions", "app.api.analytics"):
        monkeypatch.setattr(f"{mod}.today", lambda: TODAY)


def tx(date: str, description: str, amount: float, category: str = "Diğer", currency: str = "TRY") -> StatementTransaction:
    return StatementTransaction(date=date, description=description, amount=amount, currency=currency, category=category)


STATEMENT = [
    tx("2026-11-02", "MIGROS SANAL MARKET ISTANBUL", 812.40, "Gıda"),
    tx("2026-11-03", "SHELL PETROL KADIKOY", 1500.00, "ulaşım"),  # küçük harf kategori normalize edilir
    tx("2026-11-05", "STARBUCKS BAGDAT CAD", 110.00, "Restoran & Kafe"),
    tx("2026-11-05", "STARBUCKS BAGDAT CAD", 110.00, "Restoran & Kafe"),  # aynı gün aynı işlem 2 kez
    tx("2026-10-12", "NETFLIX.COM", 229.99, "Abonelik"),
    tx("2026-11-12", "NETFLIX.COM", 229.99, "Abonelik"),
    tx("2026-11-07", "AMAZON AWS", 20.00, "Diğer", "USD"),
    tx("okunamadı", "BOZUK SATIR", 10.0),
    tx("2026-11-08", "TUHAF KATEGORI", 50.0, "Uzay Turizmi"),
]


def _preview(client: TestClient, rows: List[StatementTransaction] = STATEMENT) -> dict:
    with patch(PARSER, return_value=ParsedStatement(transactions=rows)):
        res = client.post("/api/v1/statements/preview", files={"file": ("kasim.csv", b"x", "text/csv")})
    assert res.status_code == 200, res.text
    return res.json()


def _import(client: TestClient, rows: List[dict], filename: str = "kasim.csv") -> dict:
    payload = {
        "filename": filename,
        "rows": [
            {k: r[k] for k in ("date", "description", "amount", "currency", "category")} for r in rows
        ],
    }
    res = client.post("/api/v1/statements/import", json=payload)
    assert res.status_code == 201, res.text
    return res.json()


def _user_id(client: TestClient) -> int:
    return client.get("/api/v1/auth/me").json()["id"]


def _add_receipt(db: Session, user_id: int, date: str, merchant: str, total: float, category: str = "Gıda") -> Receipt:
    receipt = Receipt(
        user_id=user_id,
        merchant=merchant,
        date=dt.date.fromisoformat(date),
        total_amount=Decimal(str(total)),
        items=[ReceiptItem(name="Ürün", price=Decimal(str(total)), quantity=Decimal(1), category=category)],
    )
    db.add(receipt)
    db.commit()
    return receipt


# --- Yardımcılar ---

def test_display_merchant() -> None:
    assert display_merchant("MIGROS SANAL MARKET ISTANBUL TR 1234") == "Migros Market"
    assert display_merchant("NETFLIX.COM 866-579") == "Netflix"
    assert display_merchant("123 456") == "123 456"


# --- Önizleme ---

def test_preview_parses_and_flags_rows(client: TestClient, db_session: Session) -> None:
    _add_receipt(db_session, _user_id(client), "2026-11-04", "Shell", 1500.00, "Ulaşım")  # 1 gün sonra fişi var

    data = _preview(client)
    assert data["transactions_found"] == 8  # bozuk tarihli satır atlandı
    assert data["new_count"] == 8
    rows = data["rows"]
    assert [r["date"] for r in rows] == sorted(r["date"] for r in rows)  # tarihe göre sıralı

    shell = next(r for r in rows if "SHELL" in r["description"])
    assert shell["category"] == "Ulaşım"
    assert shell["matched_receipt"]["merchant"] == "Shell"
    assert next(r for r in rows if r["description"] == "TUHAF KATEGORI")["category"] == "Diğer"
    assert next(r for r in rows if "MIGROS" in r["description"])["merchant"] == "Migros Market"

    # Aynı ekstrede abonelik de bulunur
    assert [c["name"] for c in data["subscription_candidates"]] == ["Netflix"]

    # Önizleme hiçbir şey kaydetmez
    assert db_session.scalars(select(Transaction)).all() == []


def test_preview_rejects_bad_files(client: TestClient) -> None:
    assert client.post("/api/v1/statements/preview", files={"file": ("x.exe", b"MZ", "application/x-msdownload")}).status_code == 400
    with patch(PARSER, side_effect=RuntimeError("GIZLI")):
        res = client.post("/api/v1/statements/preview", files={"file": ("e.pdf", b"%PDF", "application/pdf")})
    assert res.status_code == 502 and "GIZLI" not in res.text


# --- İçe aktarma ---

def test_import_dedup_and_receipt_matching(client: TestClient, db_session: Session) -> None:
    receipt = _add_receipt(db_session, _user_id(client), "2026-11-04", "Shell", 1500.00, "Ulaşım")
    rows = _preview(client)["rows"]

    result = _import(client, rows)
    assert result["imported"] == 8
    assert result["skipped_duplicates"] == 0
    assert result["matched_receipts"] == 1

    saved = db_session.scalars(select(Transaction)).all()
    assert len(saved) == 8
    assert sum(1 for t in saved if t.merchant == "Starbucks Bagdat Cad") == 2  # aynı gün iki kahve korunur
    assert next(t for t in saved if t.matched_receipt_id).matched_receipt_id == receipt.id

    # Aynı ekstre ikinci kez: önizlemede "zaten içe aktarıldı", içe aktarmada atlanır
    again = _preview(client)
    assert again["new_count"] == 0
    assert all(r["already_imported"] for r in again["rows"])
    second = _import(client, rows)
    assert second == {"import_id": None, "imported": 0, "skipped_duplicates": 8, "matched_receipts": 0}

    # Ekstre listesinde dönem, adet ve toplam
    imports = client.get("/api/v1/statements").json()
    assert len(imports) == 1
    assert imports[0]["transaction_count"] == 8
    assert imports[0]["period_start"] == "2026-10-12" and imports[0]["period_end"] == "2026-11-12"


def test_import_validation(client: TestClient) -> None:
    base = {"date": "2026-11-01", "description": "X", "amount": 10, "currency": "TRY", "category": "Gıda"}
    assert client.post("/api/v1/statements/import", json={"rows": []}).status_code == 422
    assert client.post("/api/v1/statements/import", json={"rows": [{**base, "amount": 0}]}).status_code == 422
    assert client.post("/api/v1/statements/import", json={"rows": [{**base, "currency": "T1"}]}).status_code == 422
    too_many = {"rows": [base] * 2001}
    assert client.post("/api/v1/statements/import", json=too_many).status_code == 422


def test_delete_import_undoes_everything(client: TestClient, db_session: Session) -> None:
    import_id = _import(client, _preview(client)["rows"])["import_id"]
    assert client.delete(f"/api/v1/statements/{import_id}").status_code == 204
    db_session.expire_all()
    assert db_session.scalars(select(Transaction)).all() == []
    assert db_session.scalars(select(StatementImport)).all() == []
    assert client.delete(f"/api/v1/statements/{import_id}").status_code == 404
    # Geri alındıktan sonra aynı ekstre yeniden içe aktarılabilir
    assert _import(client, _preview(client)["rows"])["imported"] == 8


# --- İşlem listesi / düzenleme ---

def test_transactions_list_update_delete(client: TestClient) -> None:
    _import(client, _preview(client)["rows"])

    assert len(client.get("/api/v1/transactions").json()) == 8
    assert len(client.get("/api/v1/transactions", params={"q": "mıgros"}).json()) == 1  # Türkçe harf duyarsız
    assert len(client.get("/api/v1/transactions", params={"category": "restoran & kafe"}).json()) == 2
    nov = client.get("/api/v1/transactions", params={"start_date": "2026-11-01", "end_date": "2026-11-05"}).json()
    assert len(nov) == 4

    migros = client.get("/api/v1/transactions", params={"q": "migros"}).json()[0]
    upd = client.patch(f"/api/v1/transactions/{migros['id']}", json={"category": "ev & yaşam"})
    assert upd.status_code == 200 and upd.json()["category"] == "Ev & Yaşam"

    assert client.delete(f"/api/v1/transactions/{migros['id']}").status_code == 204
    assert len(client.get("/api/v1/transactions").json()) == 7


def test_statements_are_isolated(anon_client: TestClient, register: Callable[..., str], db_session: Session) -> None:
    a = {"Authorization": f"Bearer {register('a@example.com', 'sifre-a-1234')}"}
    b = {"Authorization": f"Bearer {register('b@example.com', 'sifre-b-1234')}"}
    row = {"date": "2026-11-01", "description": "MIGROS", "amount": 100, "currency": "TRY", "category": "Gıda"}
    import_id = anon_client.post("/api/v1/statements/import", json={"rows": [row]}, headers=a).json()["import_id"]
    tid = anon_client.get("/api/v1/transactions", headers=a).json()[0]["id"]

    assert anon_client.get("/api/v1/transactions", headers=b).json() == []
    assert anon_client.get("/api/v1/statements", headers=b).json() == []
    assert anon_client.patch(f"/api/v1/transactions/{tid}", json={"category": "Gıda"}, headers=b).status_code == 404
    assert anon_client.delete(f"/api/v1/transactions/{tid}", headers=b).status_code == 404
    assert anon_client.delete(f"/api/v1/statements/{import_id}", headers=b).status_code == 404
    # B aynı satırı kendi hesabına ekleyebilir (parmak izi kullanıcıya özel)
    assert anon_client.post("/api/v1/statements/import", json={"rows": [row]}, headers=b).json()["imported"] == 1
    assert anon_client.get("/api/v1/transactions").status_code == 401

    # Hesap silinince ekstreler ve işlemler de silinir
    assert anon_client.delete("/api/v1/auth/me", headers=a).status_code == 204
    db_session.expire_all()
    assert len(db_session.scalars(select(Transaction)).all()) == 1


# --- Analizlere dahil olma ---

def test_bank_spending_flows_into_analytics(client: TestClient, db_session: Session) -> None:
    uid = _user_id(client)
    _add_receipt(db_session, uid, "2026-11-04", "Shell", 1500.00, "Ulaşım")
    _add_receipt(db_session, uid, "2026-11-10", "BİM", 200.00, "Gıda")
    _import(client, _preview(client)["rows"])

    # Kasım banka (fişle eşleşen Shell ve USD hariç): 812,40 + 110 + 110 + 229,99 + 50 = 1312,39
    # Kasım fişler: 1500 + 200 = 1700
    trend = client.get("/api/v1/analytics/trend", params={"months": 2}).json()
    nov = trend[-1]
    assert nov["receipts_total"] == 1700.0
    assert nov["bank_total"] == 1312.39
    assert nov["total"] == 3012.39
    assert trend[0]["bank_total"] == 229.99  # Ekim Netflix

    client.post("/api/v1/budgets", json={"monthly_limit": 5000})
    client.post("/api/v1/budgets", json={"category": "Gıda", "monthly_limit": 1000})
    budgets = {b["category"]: b for b in client.get("/api/v1/budgets").json()["budgets"]}
    assert budgets[None]["spent"] == 3012.39
    assert budgets["Gıda"]["spent"] == 1012.4  # BİM fişi 200 + Migros ekstre 812,40
    assert budgets["Gıda"]["state"] == "exceeded"

    ctx = ToolContext(db=db_session, user_id=uid, today=TODAY)
    summary = execute_tool(ctx, "get_spending_summary", {"start_date": "2026-11-01", "end_date": "2026-11-30"})
    assert summary["total"] == 3012.39
    assert summary["receipts_total"] == 1700.0 and summary["bank_total"] == 1312.39
    assert summary["bank_transaction_count"] == 5

    market = execute_tool(ctx, "get_spending_summary", {"category": "gıda", "start_date": "2026-11-01"})
    assert market["total"] == 1012.4

    starbucks = execute_tool(ctx, "search_bank_transactions", {"query": "starbucks"})
    assert starbucks["match_count"] == 2 and starbucks["total"] == 220.0
    abonelik = execute_tool(ctx, "search_bank_transactions", {"category": "Abonelik", "start_date": "2026-11-01"})
    assert abonelik["total"] == 229.99
    assert "error" in execute_tool(ctx, "search_bank_transactions", {"start_date": "dün"})


def test_receipt_summary_endpoint_stays_receipts_only(client: TestClient) -> None:
    """Fişler sekmesindeki özet kartları yalnızca fişleri gösterir (banka toplamı trend/bütçe/asistanda)."""
    _import(client, _preview(client)["rows"])
    assert client.get("/api/v1/receipts/summary").json()["total_amount"] == 0.0
