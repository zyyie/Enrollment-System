"""Gmail SMTP email utility — shared by admission review and notifications."""

from __future__ import annotations

import re
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from shared.config.env import ENV


def normalize_gmail_password(password: str) -> str:
    return re.sub(r"\s+", "", password or "")


GMAIL_USER = ENV.get("GMAIL_USER", "").strip().lower()
GMAIL_APP_PASSWORD = normalize_gmail_password(ENV.get("GMAIL_APP_PASSWORD", ""))
ADMIN_EMAIL = (ENV.get("ADMIN_EMAIL") or GMAIL_USER).strip().lower()
SCHOOL_NAME = ENV.get("SCHOOL_NAME", "Geranova Senior High School")


def gmail_configured() -> bool:
    return bool(GMAIL_USER and GMAIL_APP_PASSWORD)


def mask_email(email: str) -> str:
    if not email or "@" not in email:
        return email or ""
    local, domain = email.split("@", 1)
    if len(local) <= 2:
        return f"{local[0]}***@{domain}"
    return f"{local[:2]}***@{domain}"


def send_email(to_address: str, subject: str, html_body: str, text_body: str | None = None) -> tuple[bool, str]:
    if not gmail_configured():
        return False, "Gmail is not configured"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{SCHOOL_NAME} <{GMAIL_USER}>"
    msg["To"] = to_address

    if text_body:
        msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=20) as smtp:
            smtp.login(GMAIL_USER, GMAIL_APP_PASSWORD)
            smtp.sendmail(GMAIL_USER, [to_address], msg.as_string())
        return True, ""
    except smtplib.SMTPException as err:
        return False, str(err)
