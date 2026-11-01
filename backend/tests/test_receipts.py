import sys
from pathlib import Path
from typing import Generator
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

# backend/ dizinini sys.path'e ekle (hem kök dizinden hem backend dizininden pytest çalıştırılabilsin)
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.receipt import ReceiptItem  # noqa: E402
from app.schemas.receipt import ParsedReceipt, ParsedReceiptItem  # noqa: E402


# Bellek içi (in-memory) izole SQLite test veritabanı
TEST_ENGINE = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(
    bind=TEST_ENGINE,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
)


@pytest.fixture(autouse=True)
def setup_test_db() -> Generator[None, None, None]:
    Base.metadata.create_all(bind=TEST_ENGINE)
    yield
    Base.metadata.drop_all(bind=TEST_ENGINE)


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db_session: Session) -> Generator[TestClient, None, None]:
    def override_get_db() -> Generator[Session, None, None]:
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _make_mock_receipt(
    merchant: str = "Migros Ticaret A.Ş.",
    date: str = "2026-11-01",
    total_amount: float = 250.50,
    items: list[ParsedReceiptItem] | None = None,
) -> ParsedReceipt:
    if items is None:
        items = [
            ParsedReceiptItem(name="Tam Yağlı Süt 1L", price=45.50, category="Gıda"),
            ParsedReceiptItem(name="Filtre Kahve 250g", price=155.00, category="İçecek"),
            ParsedReceiptItem(name="Bulaşık Deterjanı", price=50.00, category="Temizlik"),
        ]
    return ParsedReceipt(
        merchant=merchant,
        date=date,
        total_amount=total_amount,
        items=items,
    )


def test_upload_receipt_success_and_extension_fallback(client: TestClient) -> None:
    mock_parsed = _make_mock_receipt()

    with patch(
        "app.api.routes.receipt_parser_service.parse_receipt_image",
        return_value=mock_parsed,
    ) as mock_parse:
        # Fallback testi: content_type application/octet-stream ama uzantı .webp
        response = client.post(
            "/api/v1/receipts/upload",
            files={"file": ("market_fisi.webp", b"fake-image-bytes", "application/octet-stream")},
        )

    assert response.status_code == 201
    mock_parse.assert_called_once_with(
        image_bytes=b"fake-image-bytes",
        mime_type="image/webp",
    )

    data = response.json()
    assert data["id"] == 1
    assert data["merchant"] == "Migros Ticaret A.Ş."
    assert data["date"] == "2026-11-01"
    assert data["total_amount"] == 250.50
    assert len(data["items"]) == 3
    assert data["items"][0]["name"] == "Tam Yağlı Süt 1L"
    assert data["items"][0]["category"] == "Gıda"


def test_upload_receipt_invalid_format(client: TestClient) -> None:
    response = client.post(
        "/api/v1/receipts/upload",
        files={"file": ("belge.pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert response.status_code == 400
    assert "Desteklenmeyen dosya formatı" in response.json()["detail"]


def test_list_receipts_and_filters(client: TestClient) -> None:
    receipt_1 = _make_mock_receipt(
        merchant="Migros Jet",
        date="2026-10-15",
        total_amount=120.0,
        items=[ParsedReceiptItem(name="Ekmek", price=20.0, category="Gıda")],
    )
    receipt_2 = _make_mock_receipt(
        merchant="BİM Birleşik Mağazalar",
        date="2026-10-25",
        total_amount=300.0,
        items=[ParsedReceiptItem(name="Peynir", price=150.0, category="Gıda")],
    )
    receipt_3 = _make_mock_receipt(
        merchant="Starbucks Coffee",
        date="2026-11-01",
        total_amount=95.0,
        items=[ParsedReceiptItem(name="Latte", price=95.0, category="İçecek")],
    )

    with patch(
        "app.api.routes.receipt_parser_service.parse_receipt_image",
        side_effect=[receipt_1, receipt_2, receipt_3],
    ):
        for idx in range(3):
            res = client.post(
                "/api/v1/receipts/upload",
                files={"file": (f"r{idx}.jpg", b"img", "image/jpg")},
            )
            assert res.status_code == 201

    # 1. Tüm fişleri listele
    all_res = client.get("/api/v1/receipts")
    assert all_res.status_code == 200
    assert len(all_res.json()) == 3

    # 2. Merchant filtresi (küçük/büyük harf duyarsız)
    merchant_res = client.get("/api/v1/receipts", params={"merchant": "migros"})
    assert merchant_res.status_code == 200
    merchant_list = merchant_res.json()
    assert len(merchant_list) == 1
    assert merchant_list[0]["merchant"] == "Migros Jet"

    # 3. Tarih aralığı filtresi (start_date & end_date)
    date_res = client.get(
        "/api/v1/receipts",
        params={"start_date": "2026-10-20", "end_date": "2026-10-31"},
    )
    assert date_res.status_code == 200
    date_list = date_res.json()
    assert len(date_list) == 1
    assert date_list[0]["merchant"] == "BİM Birleşik Mağazalar"


def test_receipts_summary(client: TestClient) -> None:
    receipt_1 = _make_mock_receipt(
        merchant="Market A",
        date="2026-10-10",
        total_amount=100.0,
        items=[
            ParsedReceiptItem(name="Elma", price=40.0, category="Gıda"),
            ParsedReceiptItem(name="Su", price=60.0, category="İçecek"),
        ],
    )
    receipt_2 = _make_mock_receipt(
        merchant="Market B",
        date="2026-10-12",
        total_amount=200.0,
        items=[
            ParsedReceiptItem(name="Et", price=150.0, category="Gıda"),
            ParsedReceiptItem(name="Sabun", price=50.0, category="Temizlik"),
        ],
    )

    with patch(
        "app.api.routes.receipt_parser_service.parse_receipt_image",
        side_effect=[receipt_1, receipt_2],
    ):
        client.post("/api/v1/receipts/upload", files={"file": ("1.png", b"1", "image/png")})
        client.post("/api/v1/receipts/upload", files={"file": ("2.png", b"2", "image/png")})

    summary_res = client.get("/api/v1/receipts/summary")
    assert summary_res.status_code == 200
    summary = summary_res.json()

    assert summary["total_receipts"] == 2
    assert summary["total_amount"] == 300.0

    breakdown = {item["category"]: item for item in summary["category_breakdown"]}
    assert breakdown["Gıda"]["total_amount"] == 190.0
    assert breakdown["Gıda"]["item_count"] == 2
    assert breakdown["İçecek"]["total_amount"] == 60.0
    assert breakdown["İçecek"]["item_count"] == 1
    assert breakdown["Temizlik"]["total_amount"] == 50.0
    assert breakdown["Temizlik"]["item_count"] == 1


def test_delete_receipt_and_cascade_items(client: TestClient, db_session: Session) -> None:
    mock_parsed = _make_mock_receipt()

    with patch(
        "app.api.routes.receipt_parser_service.parse_receipt_image",
        return_value=mock_parsed,
    ):
        upload_res = client.post(
            "/api/v1/receipts/upload",
            files={"file": ("fis.jpeg", b"data", "image/jpeg")},
        )
    assert upload_res.status_code == 201
    receipt_id = upload_res.json()["id"]

    # Silme işlemi (204 No Content)
    del_res = client.delete(f"/api/v1/receipts/{receipt_id}")
    assert del_res.status_code == 204
    assert del_res.content == b""

    # Silinen fişi tekrar çekmeye çalışınca 404 dönmeli
    get_res = client.get(f"/api/v1/receipts/{receipt_id}")
    assert get_res.status_code == 404

    # Tekrar silmeye çalışınca 404 dönmeli
    del_again_res = client.delete(f"/api/v1/receipts/{receipt_id}")
    assert del_again_res.status_code == 404

    # Alt kalemlerin (ReceiptItem) cascade olarak silindiğini doğrula
    remaining_items = db_session.scalars(
        select(ReceiptItem).where(ReceiptItem.receipt_id == receipt_id)
    ).all()
    assert len(remaining_items) == 0
