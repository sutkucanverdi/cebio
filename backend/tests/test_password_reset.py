import logging
import time
from datetime import timedelta
from typing import Callable, Optional
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import reset_request_limiter
from app.core.config import settings
from app.models.password_reset import PasswordResetCode
from app.services import password_reset as service
from app.services.password_reset import send_reset_email, utcnow

EMAIL = "utku@example.com"
OLD_PASSWORD = "gizli-sifre-123"
NEW_PASSWORD = "yepyeni-sifre-456"
SENDER = "app.api.auth.send_reset_email"
FORGOT = "/api/v1/auth/forgot-password"
RESET = "/api/v1/auth/reset-password"
GENERIC = "Bu e-posta adresi kayıtlıysa sıfırlama kodu gönderildi."


@pytest.fixture(autouse=True)
def clean_limiter() -> None:
    reset_request_limiter.reset()


def _request_code(client: TestClient, email: str = EMAIL) -> Optional[str]:
    with patch(SENDER) as sender:
        res = client.post(FORGOT, json={"email": email})
    assert res.status_code == 200
    assert res.json()["message"] == GENERIC
    return sender.call_args.args[1] if sender.called else None


def _reset(client: TestClient, code: str, password: str = NEW_PASSWORD, email: str = EMAIL):  # type: ignore[no-untyped-def]
    return client.post(RESET, json={"email": email, "code": code, "new_password": password})


def _login(client: TestClient, password: str, email: str = EMAIL) -> int:
    return client.post("/api/v1/auth/login", json={"email": email, "password": password}).status_code


def _wrong(code: str) -> str:
    return "000000" if code != "000000" else "111111"


def test_full_reset_flow(anon_client: TestClient, register: Callable[..., str]) -> None:
    register(EMAIL, OLD_PASSWORD)
    code = _request_code(anon_client)
    assert code is not None and len(code) == 6 and code.isdigit()

    res = _reset(anon_client, code)
    assert res.status_code == 200
    assert _login(anon_client, OLD_PASSWORD) == 401
    assert _login(anon_client, NEW_PASSWORD) == 200


def test_reset_invalidates_existing_sessions_but_not_new_ones(anon_client: TestClient, register: Callable[..., str]) -> None:
    old_token = register(EMAIL, OLD_PASSWORD)
    headers = {"Authorization": f"Bearer {old_token}"}
    assert anon_client.get("/api/v1/auth/me", headers=headers).status_code == 200

    time.sleep(1.1)  # JWT iat saniye hassasiyetinde
    code = _request_code(anon_client)
    assert _reset(anon_client, code).status_code == 200  # type: ignore[arg-type]
    assert anon_client.get("/api/v1/auth/me", headers=headers).status_code == 401

    fresh = anon_client.post("/api/v1/auth/login", json={"email": EMAIL, "password": NEW_PASSWORD}).json()["access_token"]
    assert anon_client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {fresh}"}).status_code == 200


def test_unknown_email_gets_same_answer_and_no_mail(anon_client: TestClient) -> None:
    assert _request_code(anon_client, "yok@example.com") is None
    res = _reset(anon_client, "123456", email="yok@example.com")
    assert res.status_code == 400 and res.json()["detail"] == "Kod hatalı veya süresi dolmuş."


def test_code_is_single_use(anon_client: TestClient, register: Callable[..., str]) -> None:
    register(EMAIL, OLD_PASSWORD)
    code = _request_code(anon_client)
    assert _reset(anon_client, code).status_code == 200  # type: ignore[arg-type]
    assert _reset(anon_client, code, "baska-bir-sifre-7").status_code == 400  # type: ignore[arg-type]
    assert _login(anon_client, NEW_PASSWORD) == 200


def test_too_many_wrong_attempts_kill_code(anon_client: TestClient, register: Callable[..., str]) -> None:
    register(EMAIL, OLD_PASSWORD)
    code = _request_code(anon_client)
    for _ in range(settings.PASSWORD_RESET_MAX_ATTEMPTS):
        assert _reset(anon_client, _wrong(code)).status_code == 400  # type: ignore[arg-type]
    # Doğru kod bile artık çalışmaz
    assert _reset(anon_client, code).status_code == 400  # type: ignore[arg-type]
    assert _login(anon_client, OLD_PASSWORD) == 200


def test_expired_code_rejected(anon_client: TestClient, register: Callable[..., str], db_session: Session) -> None:
    register(EMAIL, OLD_PASSWORD)
    code = _request_code(anon_client)
    row = db_session.scalars(select(PasswordResetCode)).one()
    row.expires_at = utcnow() - timedelta(seconds=1)
    db_session.commit()
    assert _reset(anon_client, code).status_code == 400  # type: ignore[arg-type]


def test_new_code_invalidates_previous(anon_client: TestClient, register: Callable[..., str]) -> None:
    register(EMAIL, OLD_PASSWORD)
    first = _request_code(anon_client)
    second = _request_code(anon_client)
    if first != second:
        assert _reset(anon_client, first).status_code == 400  # type: ignore[arg-type]
    assert _reset(anon_client, second).status_code == 200  # type: ignore[arg-type]


def test_request_rate_limit_is_silent(anon_client: TestClient, register: Callable[..., str]) -> None:
    register(EMAIL, OLD_PASSWORD)
    for _ in range(settings.PASSWORD_RESET_REQUESTS_PER_WINDOW):
        assert _request_code(anon_client) is not None
    assert _request_code(anon_client) is None  # aynı cevap, ama e-posta gitmez


def test_code_not_stored_in_plaintext(anon_client: TestClient, register: Callable[..., str], db_session: Session) -> None:
    register(EMAIL, OLD_PASSWORD)
    code = _request_code(anon_client)
    row = db_session.scalars(select(PasswordResetCode)).one()
    assert code not in row.code_hash and len(row.code_hash) == 64


def test_code_of_one_user_does_not_work_for_another(anon_client: TestClient, register: Callable[..., str]) -> None:
    register(EMAIL, OLD_PASSWORD)
    register("b@example.com", "b-sifresi-12345")
    code = _request_code(anon_client)
    _request_code(anon_client, "b@example.com")
    if service.hash_code(1, code) != service.hash_code(2, code):  # type: ignore[arg-type]
        assert _reset(anon_client, code, email="b@example.com").status_code == 400  # type: ignore[arg-type]
    assert _login(anon_client, "b-sifresi-12345", "b@example.com") == 200


def test_validation(anon_client: TestClient) -> None:
    assert anon_client.post(FORGOT, json={"email": "gecersiz"}).status_code == 422
    assert _reset(anon_client, "12345").status_code == 422
    assert _reset(anon_client, "abcdef").status_code == 422
    assert _reset(anon_client, "123456", "kisa").status_code == 422
    assert _reset(anon_client, "123456", "ş" * 40).status_code == 422  # 80 bayt > bcrypt sınırı


def test_account_deletion_removes_codes(client: TestClient, db_session: Session) -> None:
    _request_code(client)
    assert client.delete("/api/v1/auth/me").status_code == 204
    db_session.expire_all()
    assert db_session.scalars(select(PasswordResetCode)).all() == []


# --- E-posta gönderimi ---

def test_email_sent_via_smtp(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(settings, "SMTP_FROM", "Cebio <noreply@example.com>")
    monkeypatch.setattr(settings, "SMTP_USERNAME", "kullanici")
    monkeypatch.setattr(settings, "SMTP_PASSWORD", "sir")
    server = MagicMock()
    server.__enter__.return_value = server
    with patch("app.services.email.smtplib.SMTP", return_value=server):
        send_reset_email(EMAIL, "123456")
    server.starttls.assert_called_once()
    server.login.assert_called_once_with("kullanici", "sir")
    message = server.send_message.call_args.args[0]
    assert message["To"] == EMAIL
    assert "123456" in message.get_content()


def test_smtp_failure_does_not_raise(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(settings, "SMTP_FROM", "x@example.com")
    with patch("app.services.email.smtplib.SMTP", side_effect=OSError("baglanti yok")):
        send_reset_email(EMAIL, "123456")  # istisna fırlatmamalı


def test_code_logged_only_in_debug(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    monkeypatch.setattr(settings, "SMTP_HOST", "")
    with caplog.at_level(logging.WARNING, logger="cebio"):
        monkeypatch.setattr(settings, "DEBUG", True)
        send_reset_email(EMAIL, "654321")
        assert "654321" in caplog.text
        caplog.clear()
        monkeypatch.setattr(settings, "DEBUG", False)
        send_reset_email(EMAIL, "654321")
        assert "654321" not in caplog.text
