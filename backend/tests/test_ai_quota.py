"""Gemini kotası dolduğunda (429) kullanıcıya anlamlı ve sızıntısız mesaj gösterilir."""
from unittest.mock import patch

from fastapi.testclient import TestClient
from google.genai import errors as genai_errors

from app.api.assistant import rate_limiter
from app.services.ai_errors import QUOTA_MESSAGE


def _quota_error() -> genai_errors.ClientError:
    return genai_errors.ClientError(
        429,
        {"error": {"code": 429, "message": "Quota exceeded ... GIZLI-PROJE-ID", "status": "RESOURCE_EXHAUSTED"}},
    )


def _assert_quota_response(res) -> None:  # type: ignore[no-untyped-def]
    assert res.status_code == 429
    assert res.json()["detail"] == QUOTA_MESSAGE
    assert "GIZLI-PROJE-ID" not in res.text


def test_receipt_upload_quota(client: TestClient) -> None:
    with patch("app.api.routes.receipt_parser_service.parse_receipt_image", side_effect=_quota_error()):
        res = client.post("/api/v1/receipts/upload", files={"file": ("f.jpg", b"img", "image/jpeg")})
    _assert_quota_response(res)


def test_statement_detect_quota(client: TestClient) -> None:
    with patch("app.api.subscriptions.statement_parser_service.parse_statement", side_effect=_quota_error()):
        res = client.post("/api/v1/subscriptions/detect", files={"file": ("e.pdf", b"%PDF", "application/pdf")})
    _assert_quota_response(res)


def test_assistant_quota(client: TestClient) -> None:
    rate_limiter.reset()
    with patch("app.api.assistant.assistant_service._generate", side_effect=_quota_error()):
        res = client.post("/api/v1/assistant/chat", json={"messages": [{"role": "user", "content": "selam"}]})
    _assert_quota_response(res)


def test_other_gemini_errors_still_502(client: TestClient) -> None:
    server_error = genai_errors.ServerError(503, {"error": {"code": 503, "message": "overloaded"}})
    with patch("app.api.routes.receipt_parser_service.parse_receipt_image", side_effect=server_error):
        res = client.post("/api/v1/receipts/upload", files={"file": ("f.jpg", b"img", "image/jpeg")})
    assert res.status_code == 502
