from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.receipt import ReceiptItem
from app.schemas.receipt import ParsedReceipt, ParsedReceiptItem


def _make_mock_receipt(
    merchant: str = "Migros Ticaret A.Ş.",
    date: str = "2026-11-01",
    total_amount: float = 250.50,
    items: list[ParsedReceiptItem] | None = None,
) -> ParsedReceipt:
    if items is None:
        items = [
            ParsedReceiptItem(name="Tam Yağlı Süt 1L", price=45.50, quantity=1.0, unit_price=45.50, category="Gıda"),
            ParsedReceiptItem(name="Filtre Kahve 250g", price=400.00, quantity=2.0, unit_price=200.00, category="İçecek"),
            ParsedReceiptItem(name="Bulaşık Deterjanı", price=50.00, quantity=1.0, unit_price=50.00, category="Temizlik"),
        ]
    return ParsedReceipt(
        merchant=merchant,
        date=date,
        total_amount=total_amount,
        items=items,
    )


def test_upload_receipt_success_and_extension_fallback(client: TestClient) -> None:
    mock_parsed = _make_mock_receipt(total_amount=495.50)

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
    assert data["total_amount"] == 495.50
    assert len(data["items"]) == 3
    assert data["items"][0]["name"] == "Tam Yağlı Süt 1L"
    assert data["items"][0]["category"] == "Gıda"
    assert data["items"][1]["name"] == "Filtre Kahve 250g"
    assert data["items"][1]["quantity"] == 2.0
    assert data["items"][1]["unit_price"] == 200.00
    assert data["items"][1]["price"] == 400.00


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


def test_update_receipt(client: TestClient) -> None:
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

    update_payload = {
        "merchant": "Macrocenter",
        "date": "2026-11-02",
        "total_amount": 320.0,
        "items": [
            {
                "name": "Organik Kahve",
                "quantity": 2.0,
                "unit_price": 160.0,
                "price": 320.0,
                "category": "İçecek",
            }
        ],
    }

    put_res = client.put(f"/api/v1/receipts/{receipt_id}", json=update_payload)
    assert put_res.status_code == 200
    updated = put_res.json()
    assert updated["merchant"] == "Macrocenter"
    assert updated["date"] == "2026-11-02"
    assert updated["total_amount"] == 320.0
    assert len(updated["items"]) == 1
    assert updated["items"][0]["name"] == "Organik Kahve"
    assert updated["items"][0]["quantity"] == 2.0
    assert updated["items"][0]["unit_price"] == 160.0

    not_found_res = client.put("/api/v1/receipts/9999", json=update_payload)
    assert not_found_res.status_code == 404
