"""SMTP ile e-posta gönderimi (Gmail, Brevo, Resend, Amazon SES vb. SMTP sunan her servisle çalışır)."""
import logging
import smtplib
from email.message import EmailMessage

from app.core.config import settings

logger = logging.getLogger("cebio")

SMTP_TIMEOUT_SECONDS = 15


def is_configured() -> bool:
    return bool(settings.SMTP_HOST and settings.SMTP_FROM)


def send_email(to: str, subject: str, text: str) -> None:
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.SMTP_FROM
    message["To"] = to
    message.set_content(text)

    if settings.SMTP_USE_SSL:
        server: smtplib.SMTP = smtplib.SMTP_SSL(
            settings.SMTP_HOST, settings.SMTP_PORT, timeout=SMTP_TIMEOUT_SECONDS
        )
    else:
        server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=SMTP_TIMEOUT_SECONDS)

    with server:
        if not settings.SMTP_USE_SSL:
            server.starttls()
        if settings.SMTP_USERNAME:
            server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        server.send_message(message)
