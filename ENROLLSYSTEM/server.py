"""
Enrollment System - Local Development Server
Run: python server.py
"""

import base64
import http.server
import json
import os
import random
import re
import smtplib
import socketserver
import threading
import time
import uuid
import webbrowser
from datetime import datetime
from email import encoders
from email.mime.image import MIMEImage
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, unquote, urlparse
from urllib.request import Request, urlopen

from shared.services.email_templates import (
    APPLICANT_EMAIL_VERSION,
    build_admission_rejection_email,
    build_applicant_confirmation_email,
    build_forgot_password_email,
    build_subject_enrollment_confirmation_email,
)
from shared.services.admission_schedules import resolve_subject_schedule_details
from shared.services.storage import (
    find_local_document,
    load_admission_file_content,
    public_enrollment_photo_url,
    resolve_document_view_url,
    upload_admission_files_to_supabase,
    upload_admission_document,
    upload_enrollment_photo,
)
from shared.validation.admission import validate_admission_fields, validate_admission_files
from shared.services.brand import (
    DEFAULT_SCHOOL_NAME,
    display_school_name,
    email_brand_name,
    scrub_legacy_brand_text,
)

PORT = 8000
ROOT = Path(__file__).parent
UPLOADS_DIR = ROOT / "uploads" / "admissions"
LOCAL_ADMISSIONS_FILE = ROOT / "data" / "admissions.json"
LOCAL_FEEDBACK_FILE = ROOT / "data" / "student-feedback.json"


def load_env():
    env = {}
    candidates = [ROOT / ".env"]
    desktop = Path.home() / "OneDrive" / "Desktop"
    for admin_root in (
        desktop / "Enrollment-System-Admin" / "ENROLLSYSTEM-ADMIN",
        desktop / "Enrollment systemproject" / "ENROLLSYSTEM-ADMIN",
        ROOT.parent / "ENROLLSYSTEM-ADMIN",
    ):
        candidates.append(admin_root / ".env")
    env_path = next((p for p in candidates if p.exists()), None)
    if not env_path:
        return env, None

    raw = env_path.read_text(encoding="utf-8-sig")
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        if " #" in value:
            value = value.split(" #", 1)[0].strip()
        env[key.strip()] = value
    return env, env_path


def normalize_gmail_password(password):
    return re.sub(r"\s+", "", password or "")


ENV, ENV_SOURCE = load_env()
SUPABASE_URL = ENV.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_PUBLISHABLE_KEY = ENV.get("SUPABASE_PUBLISHABLE_KEY", "")
SUPABASE_SECRET_KEY = ENV.get("SUPABASE_SECRET_KEY", "")
GMAIL_USER = ENV.get("GMAIL_USER", "").strip().lower()
GMAIL_APP_PASSWORD = normalize_gmail_password(ENV.get("GMAIL_APP_PASSWORD", ""))
ADMIN_EMAIL = (ENV.get("ADMIN_EMAIL") or GMAIL_USER).strip().lower()
SCHOOL_NAME = display_school_name(ENV.get("SCHOOL_NAME", "Enrollment Management System"))
PAYMONGO_SECRET_KEY = ENV.get("PAYMONGO_SECRET_KEY", "")
ENROLLMENT_FEE = float(ENV.get("ENROLLMENT_FEE", "2500"))
GCASH_MERCHANT_NAME = display_school_name(ENV.get("GCASH_MERCHANT_NAME", SCHOOL_NAME))
GCASH_MERCHANT_NUMBER = ENV.get("GCASH_MERCHANT_NUMBER", "0945 661 0582")
GCASH_QR_IMAGE = ENV.get("GCASH_QR_IMAGE", "assets/gcash-qr.png")
ADMIN_PORTAL_URL = ENV.get("ADMIN_PORTAL_URL", "http://localhost:8001").rstrip("/")

PAYMENT_SESSIONS_FILE = ROOT / "data" / "payment_sessions.json"
REQUIRED_DOCS = {
    "form_138": "Original Copy of Form 138 (Report Card) signed by the Principal",
    "form_137": "Original Copy of Form 137",
    "good_moral": "Original Copy of Certificate of Good Moral Character",
    "birth_certificate": "Photocopy of Birth Certificate issued by PSA",
    "high_school_diploma": "High School Diploma",
}


def build_full_address(fields):
    parts = [
        fields.get("houseNumber", "").strip(),
        fields.get("street", "").strip(),
        fields.get("barangay", "").strip(),
        fields.get("city", "").strip(),
        fields.get("province", "").strip(),
    ]
    full = ", ".join(part for part in parts if part)
    return full or fields.get("address", "").strip()


def load_payment_sessions():
    if not PAYMENT_SESSIONS_FILE.exists():
        return {}
    try:
        return json.loads(PAYMENT_SESSIONS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def save_payment_sessions(sessions):
    PAYMENT_SESSIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PAYMENT_SESSIONS_FILE.write_text(json.dumps(sessions, indent=2), encoding="utf-8")


def get_base_url(handler):
    host = handler.headers.get("Host", f"localhost:{PORT}")
    return f"http://{host}"


def create_paymongo_checkout(handler, session_id, amount_php):
    amount_centavos = int(round(amount_php * 100))
    base_url = get_base_url(handler)
    payload = {
        "data": {
            "attributes": {
                "send_email_receipt": False,
                "show_description": True,
                "show_line_items": True,
                "line_items": [{
                    "currency": "PHP",
                    "amount": amount_centavos,
                    "name": f"{SCHOOL_NAME} — Enrollment Fee",
                    "quantity": 1,
                }],
                "payment_method_types": ["gcash"],
                "success_url": f"{base_url}/payment-success.html?session_id={session_id}",
                "cancel_url": f"{base_url}/enroll.html?payment=cancelled",
                "description": f"{SCHOOL_NAME} Enrollment Fee",
            }
        }
    }
    auth = base64.b64encode(f"{PAYMONGO_SECRET_KEY}:".encode()).decode()
    request = Request(
        "https://api.paymongo.com/v1/checkout_sessions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Basic {auth}",
        },
        method="POST",
    )
    with urlopen(request, timeout=30) as response:
        data = json.loads(response.read().decode("utf-8"))

    attrs = data["data"]["attributes"]
    checkout_url = attrs.get("checkout_url")
    paymongo_id = data["data"]["id"]
    return checkout_url, paymongo_id


def fetch_paymongo_session(paymongo_session_id):
    auth = base64.b64encode(f"{PAYMONGO_SECRET_KEY}:".encode()).decode()
    request = Request(
        f"https://api.paymongo.com/v1/checkout_sessions/{paymongo_session_id}",
        headers={"Authorization": f"Basic {auth}"},
        method="GET",
    )
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def handle_create_gcash_payment(handler):
    body = read_json_body(handler)
    session_id = str(uuid.uuid4())
    amount = ENROLLMENT_FEE
    sessions = load_payment_sessions()

    if PAYMONGO_SECRET_KEY:
        try:
            checkout_url, paymongo_id = create_paymongo_checkout(handler, session_id, amount)
            sessions[session_id] = {
                "mode": "paymongo",
                "status": "pending",
                "amount": amount,
                "paymongoId": paymongo_id,
                "reference": None,
                "createdAt": datetime.now().isoformat(),
            }
            save_payment_sessions(sessions)
            json_response(handler, 200, {
                "success": True,
                "mode": "paymongo",
                "sessionId": session_id,
                "checkoutUrl": checkout_url,
                "amount": amount,
            })
            return
        except (HTTPError, URLError, KeyError, ValueError) as err:
            detail = str(err)
            if isinstance(err, HTTPError):
                detail = err.read().decode("utf-8", errors="ignore")
            json_response(handler, 500, {
                "success": False,
                "error": f"PayMongo error: {detail}",
            })
            return

    sessions[session_id] = {
        "mode": "demo",
        "status": "pending",
        "amount": amount,
        "reference": None,
        "createdAt": datetime.now().isoformat(),
    }
    save_payment_sessions(sessions)
    json_response(handler, 200, {
        "success": True,
        "mode": "demo",
        "sessionId": session_id,
        "amount": amount,
    })


def handle_verify_gcash_payment(handler, session_id):
    if not session_id:
        json_response(handler, 400, {"success": False, "error": "Session ID required"})
        return

    sessions = load_payment_sessions()
    session = sessions.get(session_id)
    if not session:
        json_response(handler, 404, {"success": False, "error": "Payment session not found"})
        return

    if session.get("mode") == "paymongo" and session.get("status") != "paid":
        paymongo_id = session.get("paymongoId")
        if paymongo_id and PAYMONGO_SECRET_KEY:
            try:
                data = fetch_paymongo_session(paymongo_id)
                attrs = data.get("data", {}).get("attributes", {})
                payments = attrs.get("payments") or []
                paid = attrs.get("status") == "paid" or any(
                    p.get("attributes", {}).get("status") == "paid" for p in payments
                )
                if paid:
                    reference = None
                    if payments:
                        reference = payments[0].get("attributes", {}).get("source", {}).get("id")
                    session["status"] = "paid"
                    session["reference"] = reference or f"PM-{paymongo_id[-8:].upper()}"
                    session["paidAt"] = datetime.now().isoformat()
                    sessions[session_id] = session
                    save_payment_sessions(sessions)
            except (HTTPError, URLError, KeyError):
                pass

    paid = session.get("status") == "paid"
    json_response(handler, 200, {
        "success": True,
        "paid": paid,
        "reference": session.get("reference"),
        "amount": session.get("amount"),
        "sessionId": session_id,
    })


def handle_complete_demo_gcash_payment(handler):
    body = read_json_body(handler)
    session_id = body.get("sessionId")
    mobile = body.get("mobileNumber", "")

    if not session_id:
        json_response(handler, 400, {"success": False, "error": "Session ID required"})
        return

    sessions = load_payment_sessions()
    session = sessions.get(session_id)
    if not session:
        json_response(handler, 404, {"success": False, "error": "Payment session not found"})
        return

    reference = f"GCASH-{datetime.now().strftime('%Y%m%d')}-{mobile[-4:]}"
    session["status"] = "paid"
    session["reference"] = reference
    session["mobile"] = mobile
    session["paidAt"] = datetime.now().isoformat()
    sessions[session_id] = session
    save_payment_sessions(sessions)

    json_response(handler, 200, {
        "success": True,
        "paid": True,
        "reference": reference,
        "amount": session.get("amount"),
        "sessionId": session_id,
    })


def handle_gcash_config(handler):
    json_response(handler, 200, {
        "success": True,
        "merchantName": GCASH_MERCHANT_NAME,
        "merchantNumber": GCASH_MERCHANT_NUMBER,
        "qrImage": GCASH_QR_IMAGE,
        "amount": ENROLLMENT_FEE,
        "schoolName": SCHOOL_NAME,
    })


def build_config_js():
    enabled = bool(SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY)
    config = {
        "url": SUPABASE_URL,
        "publishableKey": SUPABASE_PUBLISHABLE_KEY,
        "enabled": enabled,
        "enrollmentFee": ENROLLMENT_FEE,
        "adminPortalUrl": ADMIN_PORTAL_URL,
    }
    return "window.SUPABASE_CONFIG = " + json.dumps(config) + ";\n"


def json_response(handler, status, payload):
    content = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(content)))
    handler.end_headers()
    handler.wfile.write(content)


def read_json_body(handler):
    length = int(handler.headers.get("Content-Length", 0))
    if length <= 0:
        return {}
    raw = handler.rfile.read(length)
    return json.loads(raw.decode("utf-8"))


def parse_multipart_form(handler):
    content_type = handler.headers.get("Content-Type", "")
    if "multipart/form-data" not in content_type:
        return None

    boundary_match = re.search(r"boundary=(.+)", content_type)
    if not boundary_match:
        return None

    boundary = boundary_match.group(1).strip().strip('"')
    length = int(handler.headers.get("Content-Length", 0))
    body = handler.rfile.read(length)

    parts = body.split(f"--{boundary}".encode())
    fields = {}
    files = {}

    for part in parts:
        if not part or part in (b"--\r\n", b"--"):
            continue
        if b"\r\n\r\n" not in part:
            continue

        header_block, content = part.split(b"\r\n\r\n", 1)
        content = content.rstrip(b"\r\n")
        if not content:
            continue

        header_text = header_block.decode("utf-8", errors="ignore")
        name_match = re.search(r'name="([^"]+)"', header_text)
        if not name_match:
            continue

        name = name_match.group(1)
        filename_match = re.search(r'filename="([^"]*)"', header_text)

        if filename_match and filename_match.group(1):
            files[name] = {
                "filename": filename_match.group(1),
                "content": content,
            }
        else:
            fields[name] = content.decode("utf-8", errors="ignore")

    return {"fields": fields, "files": files}


def supabase_configured():
    return bool(SUPABASE_URL and (SUPABASE_SECRET_KEY or SUPABASE_PUBLISHABLE_KEY))


def parse_supabase_error(error):
    if not error:
        return "Unknown Supabase error"
    try:
        data = json.loads(error)
        message = data.get("message") or data.get("error") or data.get("hint")
        if message:
            return str(message)
    except (json.JSONDecodeError, TypeError):
        pass
    return str(error)[:500]


def friendly_user_error(message, fallback="Something went wrong. Please try again or contact the registrar office."):
    """Return a safe message for end users — never expose DB or setup instructions."""
    if not message:
        return fallback
    text = str(message).strip()
    if not text:
        return fallback
    lower = text.lower()
    blocked = (
        "supabase", "sql editor", ".sql", "run supabase", "re-run",
        "migration", "service_role", "publishable", ".env",
        "postgresql", "permission denied", "rpc ", "schema ",
        "column ", "violates", "foreign key", "does not exist",
        "failed to fetch", "typeerror", "pgrst", "rest/v1",
        "enrollment-workflow", "schedule-sync", "fix-student-login",
        "fix-approve-review", "faculty-strands-rooms",
    )
    if any(token in lower for token in blocked):
        return fallback
    if len(text) > 280:
        return fallback
    return text


def supabase_rpc(function_name, params=None, use_secret=True, timeout=6):
    if not SUPABASE_URL:
        return None, "Supabase URL is not configured"

    key = SUPABASE_SECRET_KEY if use_secret and SUPABASE_SECRET_KEY else SUPABASE_PUBLISHABLE_KEY
    if not key:
        return None, "Supabase API key is not configured"

    url = f"{SUPABASE_URL}/rest/v1/rpc/{function_name}"
    payload = json.dumps(params or {}).encode("utf-8")
    request = Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "apikey": key,
            "Authorization": f"Bearer {key}",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return (json.loads(raw) if raw else {}), None
    except HTTPError as err:
        detail = err.read().decode("utf-8", errors="ignore")
        return None, detail or err.reason
    except URLError as err:
        return None, str(err.reason)


DEFAULT_FACULTY = {
    "faculty_id": "FAC-2026-0001",
    "last_name": "DELA CRUZ",
    "first_name": "JUAN",
    "middle_name": "MARTINEZ",
    "role": "Registrar",
    "department": "Registrar Office",
    "password": "faculty123",
    "is_active": True,
}


def supabase_rest_get(table, query_string, use_secret=True, timeout=6):
    if not SUPABASE_URL:
        return None, "Supabase URL is not configured"

    key = SUPABASE_SECRET_KEY if use_secret and SUPABASE_SECRET_KEY else SUPABASE_PUBLISHABLE_KEY
    if not key:
        return None, "Supabase API key is not configured"

    url = f"{SUPABASE_URL}/rest/v1/{table}?{query_string}"
    request = Request(
        url,
        headers={
            "Content-Type": "application/json",
            "apikey": key,
            "Authorization": f"Bearer {key}",
        },
        method="GET",
    )

    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
            return (json.loads(raw) if raw else []), None
    except HTTPError as err:
        detail = err.read().decode("utf-8", errors="ignore")
        return None, detail or err.reason
    except URLError as err:
        return None, str(err.reason)


def supabase_rest_upsert(table, rows, on_conflict):
    if not SUPABASE_URL:
        return None, "Supabase URL is not configured"

    key = SUPABASE_SECRET_KEY or SUPABASE_PUBLISHABLE_KEY
    if not key:
        return None, "Supabase API key is not configured"

    url = f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={on_conflict}"
    payload = json.dumps(rows if isinstance(rows, list) else [rows]).encode("utf-8")
    request = Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
            return (json.loads(raw) if raw else {"success": True}), None
    except HTTPError as err:
        detail = err.read().decode("utf-8", errors="ignore")
        return None, detail or err.reason
    except URLError as err:
        return None, str(err.reason)


def supabase_rest_patch(table, query_string, payload):
    if not SUPABASE_URL:
        return None, "Supabase URL is not configured"

    key = SUPABASE_SECRET_KEY or SUPABASE_PUBLISHABLE_KEY
    if not key:
        return None, "Supabase API key is not configured"

    url = f"{SUPABASE_URL}/rest/v1/{table}?{query_string}"
    body = json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Prefer": "return=minimal",
        },
        method="PATCH",
    )
    try:
        with urlopen(request, timeout=15) as response:
            return {"success": True}, None
    except HTTPError as err:
        detail = err.read().decode("utf-8", errors="ignore")
        return None, detail or err.reason
    except URLError as err:
        return None, str(err.reason)


def supabase_rest_delete(table, query_string):
    if not SUPABASE_URL:
        return None, "Supabase URL is not configured"

    key = SUPABASE_SECRET_KEY or SUPABASE_PUBLISHABLE_KEY
    if not key:
        return None, "Supabase API key is not configured"

    url = f"{SUPABASE_URL}/rest/v1/{table}?{query_string}"
    request = Request(
        url,
        headers={
            "Content-Type": "application/json",
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Prefer": "return=minimal",
        },
        method="DELETE",
    )
    try:
        with urlopen(request, timeout=15) as response:
            return {"success": True}, None
    except HTTPError as err:
        detail = err.read().decode("utf-8", errors="ignore")
        return None, detail or err.reason
    except URLError as err:
        return None, str(err.reason)


def seed_default_faculty():
    if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
        return False, "Skipped — add SUPABASE_SECRET_KEY to .env for auto-seed"

    result, error = supabase_rpc("seed_default_faculty", use_secret=True)
    if not error and result and result.get("success"):
        return True, None

    result, error = supabase_rest_upsert("faculty", DEFAULT_FACULTY, "faculty_id")
    if not error:
        return True, None

    if error and "password" in error and "schema cache" in error:
        return False, "Run supabase/seed-faculty.sql in Supabase SQL Editor first"
    return False, error or "Faculty seed failed"


def handle_seed_faculty(handler):
    ok, error = seed_default_faculty()
    if ok:
        json_response(handler, 200, {
            "success": True,
            "facultyId": DEFAULT_FACULTY["faculty_id"],
            "message": "Default faculty account saved to Supabase.",
        })
    else:
        json_response(handler, 500, {"success": False, "error": error})


def local_faculty_login(faculty_id, password):
    if (
        faculty_id == DEFAULT_FACULTY["faculty_id"]
        and password == DEFAULT_FACULTY["password"]
    ):
        return {
            "id": DEFAULT_FACULTY["faculty_id"],
            "lastName": DEFAULT_FACULTY["last_name"],
            "firstName": DEFAULT_FACULTY["first_name"],
            "middleName": DEFAULT_FACULTY["middle_name"],
            "role": DEFAULT_FACULTY["role"],
            "department": DEFAULT_FACULTY["department"],
            "lastLogin": datetime.now().strftime("%b %d, %Y %I:%M %p"),
        }
    return None


def handle_faculty_login(handler):
    try:
        body = read_json_body(handler)
    except json.JSONDecodeError:
        json_response(handler, 400, {"success": False, "error": "Invalid request body."})
        return

    faculty_id = (body.get("facultyId") or "").strip().upper()
    password = body.get("password") or ""

    if not faculty_id or not password:
        json_response(handler, 400, {"success": False, "error": "Faculty ID and password are required."})
        return

    faculty = None

    if SUPABASE_URL and (SUPABASE_SECRET_KEY or SUPABASE_PUBLISHABLE_KEY):
        result, error = supabase_rpc("authenticate_faculty", {
            "p_faculty_id": faculty_id,
            "p_password": password,
        })
        if not error and isinstance(result, dict) and result.get("id"):
            faculty = result

    if not faculty:
        faculty = local_faculty_login(faculty_id, password)

    if faculty:
        json_response(handler, 200, {"success": True, "faculty": faculty})
        return

    json_response(handler, 401, {"success": False, "error": "Invalid Faculty ID or password."})


def build_student_session_from_admission(app):
    birthdate = str(app.get("birthdate") or "2000-01-01")[:10]
    year, month, day = birthdate.split("-")
    strand_code = app.get("strandCode") or app.get("strand") or "STEM"
    return {
        "id": app.get("student_id_generated"),
        "lastName": (app.get("lastName") or "").upper(),
        "firstName": (app.get("firstName") or "").upper(),
        "middleName": app.get("middleName") or "",
        "birthMonth": str(int(month)),
        "birthDay": str(int(day)),
        "birthYear": str(int(year)),
        "gradeLevel": app.get("gradeLevel") or "Grade 11",
        "strand": strand_code,
        "strandFull": strand_code,
        "section": "",
        "track": "Academic",
        "admissionStatus": "New",
        "scholasticStatus": "Regular",
        "schoolYear": "2026-2027",
        "semester": "First Semester",
        "voucherQualified": False,
    }


def local_student_login(student_id, birth_month, birth_day, birth_year, password):
    student_id = (student_id or "").strip().upper()
    password = (password or "").strip()
    if not student_id or not password:
        return None

    for app in load_local_admissions():
        if (app.get("status") or "").lower() != "approved":
            continue
        sid = (app.get("student_id_generated") or "").strip().upper()
        if sid != student_id:
            continue
        temp_password = (app.get("temp_password") or app.get("tempPassword") or "").strip()
        portal_password = (app.get("portal_password") or app.get("portalPassword") or "").strip()
        stored_password = portal_password or temp_password
        if stored_password != password:
            continue
        birthdate = str(app.get("birthdate") or "")[:10]
        if birthdate and (birth_month or birth_day or birth_year):
            try:
                y, m, d = [int(part) for part in birthdate.split("-")]
                if int(birth_year) != y or int(birth_month) != m or int(birth_day) != d:
                    continue
            except (TypeError, ValueError):
                continue
        session = build_student_session_from_admission(app)
        session["mustChangePassword"] = (not portal_password) or portal_password == temp_password
        return session
    return None


def get_supabase_strand_id(code):
    if not code or not SUPABASE_URL:
        return None
    data, error = supabase_rest_get(
        "strands",
        f"code=eq.{code}&select=id&limit=1",
        use_secret=True,
    )
    if error or not isinstance(data, list) or not data:
        return None
    return data[0].get("id")


def sync_student_to_supabase(app, student_id, temp_password):
    if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
        return False, "Supabase secret key not configured"

    strand_code = app.get("strandCode") or app.get("strand") or "STEM"
    strand_id = app.get("strandId") or get_supabase_strand_id(strand_code)
    admission_type = (app.get("admissionType") or "new").lower()
    if admission_type not in ("new", "continuing", "transferee", "returnee"):
        admission_type = "new"

    row = {
        "student_id": student_id,
        "last_name": app.get("lastName", ""),
        "first_name": app.get("firstName", ""),
        "middle_name": app.get("middleName"),
        "birthdate": str(app.get("birthdate") or "2000-01-01")[:10],
        "password": temp_password,
        "gender": app.get("gender"),
        "address": app.get("address"),
        "contact_number": app.get("contactNumber"),
        "admission_type": admission_type,
        "admission_status": "approved",
        "grade_level": app.get("gradeLevel") or "Grade 11",
        "scholastic_status": "Regular",
        "track": "Academic",
        "is_active": True,
    }
    if strand_id:
        row["strand_id"] = strand_id

    _, error = supabase_rest_upsert("students", row, "student_id")
    if error:
        return False, error
    return True, None


def sync_approved_student_credentials(result, app_detail=None):
    """Keep students.password in sync with the temp password emailed on approval."""
    student_id = (
        result.get("studentId")
        or result.get("student_id")
        or (app_detail or {}).get("studentId")
        or (app_detail or {}).get("student_id_generated")
        or ""
    ).strip().upper()
    temp_password = (
        result.get("tempPassword")
        or result.get("temp_password")
        or (app_detail or {}).get("tempPassword")
        or (app_detail or {}).get("temp_password")
        or ""
    ).strip()
    if not student_id or not temp_password:
        print("[Student sync] Skipped — missing studentId or tempPassword from approval result")
        return False, "Missing studentId or tempPassword"

    detail = app_detail or {}
    app = {
        "lastName": result.get("lastName") or detail.get("lastName") or detail.get("last_name") or "",
        "firstName": result.get("firstName") or detail.get("firstName") or detail.get("first_name") or "",
        "middleName": result.get("middleName") or detail.get("middleName") or detail.get("middle_name") or "",
        "birthdate": detail.get("birthdate") or result.get("birthdate"),
        "gender": detail.get("gender"),
        "address": detail.get("address"),
        "contactNumber": detail.get("contactNumber") or detail.get("contact_number"),
        "strandCode": detail.get("strandCode") or detail.get("strand") or detail.get("strand_code"),
        "strandId": detail.get("strandId") or detail.get("strand_id"),
        "gradeLevel": detail.get("gradeLevel") or detail.get("grade_level"),
        "admissionType": detail.get("admissionType") or detail.get("admission_type") or "new",
    }
    ok, err = sync_student_to_supabase(app, student_id, temp_password)
    if ok:
        print(f"[Student sync] Credentials synced for {student_id}")
    else:
        print(f"[Student sync] Failed for {student_id}: {err}")
    return ok, err


def birthdate_matches(stored, birth_month, birth_day, birth_year):
    """Match birthdate when provided; skip check when month/day/year are all 0/empty."""
    try:
        if not birth_month and not birth_day and not birth_year:
            return True
        if not stored:
            return False
        parts = str(stored)[:10].split("-")
        if len(parts) != 3:
            return False
        y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
        return (
            y == int(birth_year)
            and m == int(birth_month)
            and d == int(birth_day)
        )
    except (TypeError, ValueError):
        return False


# Student login lockout: 3 failed attempts → 30 second cooldown (per IP + Student ID).
_STUDENT_LOGIN_LOCKOUTS = {}
_STUDENT_LOGIN_MAX_FAILS = 3
_STUDENT_LOGIN_LOCK_SEC = 30


def _student_login_client_key(handler, student_id: str) -> str:
    forwarded = (handler.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
    ip = forwarded or (handler.client_address[0] if handler.client_address else "unknown")
    return f"{ip}|{(student_id or '').strip().upper()}"


def _student_login_lock_status(key: str) -> tuple:
    """Returns (locked, seconds_remaining, fail_count)."""
    now = time.time()
    entry = _STUDENT_LOGIN_LOCKOUTS.get(key) or {}
    locked_until = float(entry.get("locked_until") or 0)
    fails = int(entry.get("fails") or 0)
    if locked_until > now:
        return True, int(max(1, round(locked_until - now))), fails
    if locked_until and locked_until <= now:
        _STUDENT_LOGIN_LOCKOUTS[key] = {"fails": 0, "locked_until": 0}
        return False, 0, 0
    return False, 0, fails


def _record_student_login_failure(key: str) -> dict:
    now = time.time()
    entry = _STUDENT_LOGIN_LOCKOUTS.get(key) or {"fails": 0, "locked_until": 0}
    if float(entry.get("locked_until") or 0) > now:
        remaining = int(max(1, round(float(entry["locked_until"]) - now)))
        return {
            "locked": True,
            "failedAttempts": int(entry.get("fails") or 0),
            "retryAfterSec": remaining,
            "lockUntil": int(float(entry["locked_until"]) * 1000),
        }
    fails = int(entry.get("fails") or 0) + 1
    locked_until = 0.0
    if fails >= _STUDENT_LOGIN_MAX_FAILS:
        locked_until = now + _STUDENT_LOGIN_LOCK_SEC
        fails = _STUDENT_LOGIN_MAX_FAILS
    _STUDENT_LOGIN_LOCKOUTS[key] = {"fails": fails, "locked_until": locked_until}
    return {
        "locked": locked_until > 0,
        "failedAttempts": fails,
        "retryAfterSec": int(_STUDENT_LOGIN_LOCK_SEC) if locked_until else 0,
        "lockUntil": int(locked_until * 1000) if locked_until else None,
    }


def _clear_student_login_lockout(key: str) -> None:
    _STUDENT_LOGIN_LOCKOUTS.pop(key, None)


def _fetch_current_term_rest():
    sem_rows, error = supabase_rest_get(
        "semesters",
        "is_current=eq.true&select=name,code,enrollment_open,school_years(label)&limit=1",
        use_secret=True,
        timeout=8,
    )
    if error or not sem_rows:
        return {
            "schoolYear": "2026-2027",
            "semester": "First Semester",
            "semesterCode": "1st",
            "enrollmentOpen": False,
        }
    sem = sem_rows[0]
    sy = sem.get("school_years") if isinstance(sem.get("school_years"), dict) else {}
    code = (sem.get("code") or "1st").strip().lower()
    return {
        "schoolYear": sy.get("label") or "2026-2027",
        "semester": sem.get("name") or ("Second Semester" if code == "2nd" else "First Semester"),
        "semesterCode": code if code in ("1st", "2nd") else "1st",
        "enrollmentOpen": bool(sem.get("enrollment_open")),
    }


def build_student_session_from_supabase_row(row, strand_code=None, strand_name=None):
    birthdate = str(row.get("birthdate") or "2000-01-01")[:10]
    year, month, day = birthdate.split("-")
    strands = row.get("strands") if isinstance(row.get("strands"), dict) else {}
    code = strand_code or strands.get("code") or "STEM"
    name = strand_name or strands.get("name") or code
    sections = row.get("sections") if isinstance(row.get("sections"), dict) else {}
    term = _fetch_current_term_rest()
    return {
        "id": row.get("student_id"),
        "supabaseId": row.get("id"),
        "lastName": row.get("last_name") or "",
        "firstName": row.get("first_name") or "",
        "middleName": row.get("middle_name") or "",
        "birthMonth": str(int(month)),
        "birthDay": str(int(day)),
        "birthYear": str(int(year)),
        "gradeLevel": row.get("grade_level") or "Grade 11",
        "strand": code,
        "strandFull": name,
        "section": sections.get("name") or "",
        "track": row.get("track") or "Academic",
        "admissionStatus": row.get("admission_status") or "approved",
        "scholasticStatus": row.get("scholastic_status") or "Regular",
        "accountStatus": row.get("account_status") or "active",
        "progressionStatus": row.get("progression_status") or "in_progress",
        "grade11Completed": bool(row.get("grade11_completed")),
        "schoolYear": term["schoolYear"],
        "semester": term["semester"],
        "semesterCode": term["semesterCode"],
        "enrollmentOpen": term["enrollmentOpen"],
        "voucherQualified": bool(row.get("voucher_qualified")),
    }


def supabase_student_auth_fallback(student_id, birth_month, birth_day, birth_year, password):
    """REST fallback when authenticate_student RPC is outdated or returns null."""
    if not supabase_configured():
        return None

    student_id = (student_id or "").strip().upper()
    password = (password or "").strip()
    if not student_id or not password:
        return None

    from urllib.parse import quote

    students, err = supabase_rest_get(
        "students",
        f"student_id=eq.{quote(student_id)}&select=*,strands(code,name),sections(name)",
        use_secret=True,
        timeout=10,
    )
    admissions, err2 = supabase_rest_get(
        "admission_applications",
        (
            f"status=eq.approved&student_id_generated=eq.{quote(student_id)}"
            "&select=*,strands(code,name)"
        ),
        use_secret=True,
        timeout=10,
    )
    admission_list = admissions if isinstance(admissions, list) else []
    stale_student_row = None

    if isinstance(students, list):
        for row in students:
            stored_password = (row.get("password") or "").strip()
            if stored_password != password:
                # Recover only when the student row has no password yet.
                # A custom password must not be overwritten by the emailed temporary password.
                if not stored_password:
                    stale_student_row = row
                continue
            if not birthdate_matches(row.get("birthdate"), birth_month, birth_day, birth_year):
                continue
            if row.get("is_active") is False:
                continue
            status = (row.get("account_status") or "active").lower()
            if status == "frozen":
                return {
                    "error": "ACCOUNT_FROZEN",
                    "message": (
                        "Your account has been frozen due to non-enrollment during "
                        "the official registration period. Please contact the registrar's office."
                    ),
                }
            if status == "inactive":
                return {
                    "error": "ACCOUNT_INACTIVE",
                    "message": "Your account is inactive. Please contact the registrar's office.",
                }
            return build_student_session_from_supabase_row(row)

    for app in admission_list:
        stored_password = (app.get("temp_password") or "").strip()
        if stored_password != password:
            continue
        if not birthdate_matches(app.get("birthdate"), birth_month, birth_day, birth_year):
            continue
        strands = app.get("strands") if isinstance(app.get("strands"), dict) else {}
        session = build_student_session_from_admission({
            **app,
            "student_id_generated": app.get("student_id_generated"),
            "lastName": app.get("last_name"),
            "firstName": app.get("first_name"),
            "middleName": app.get("middle_name"),
            "strandCode": strands.get("code") or "STEM",
            "strand": strands.get("code") or "STEM",
            "gradeLevel": app.get("grade_level"),
        })
        sync_student_to_supabase(
            {
                **app,
                "lastName": app.get("last_name"),
                "firstName": app.get("first_name"),
                "middleName": app.get("middle_name"),
                "strandCode": strands.get("code") or "STEM",
                "strandId": app.get("strand_id"),
                "birthdate": app.get("birthdate"),
                "gender": app.get("gender"),
                "address": app.get("address"),
                "contactNumber": app.get("contact_number"),
                "admissionType": app.get("admission_type"),
                "gradeLevel": app.get("grade_level"),
            },
            student_id,
            stored_password,
        )
        return session

    if stale_student_row and admission_list:
        for app in admission_list:
            stored_password = (app.get("temp_password") or "").strip()
            if stored_password != password:
                continue
            sync_student_to_supabase(
                {
                    **app,
                    "lastName": app.get("last_name"),
                    "firstName": app.get("first_name"),
                    "middleName": app.get("middle_name"),
                    "strandCode": (app.get("strands") or {}).get("code") or "STEM",
                    "strandId": app.get("strand_id"),
                    "birthdate": app.get("birthdate"),
                    "gender": app.get("gender"),
                    "address": app.get("address"),
                    "contactNumber": app.get("contact_number"),
                    "admissionType": app.get("admission_type"),
                    "gradeLevel": app.get("grade_level"),
                },
                student_id,
                stored_password,
            )
            return build_student_session_from_supabase_row(stale_student_row)

    return None


def handle_student_login(handler):
    try:
        body = read_json_body(handler)
    except json.JSONDecodeError:
        json_response(handler, 400, {"success": False, "error": "Invalid request body."})
        return

    student_id = (body.get("studentId") or "").strip().upper()
    password = (body.get("password") or "").strip()
    try:
        birth_month = int(body.get("birthMonth") or 0)
        birth_day = int(body.get("birthDay") or 0)
        birth_year = int(body.get("birthYear") or 0)
    except (TypeError, ValueError):
        birth_month = birth_day = birth_year = 0

    if not student_id or not password:
        json_response(handler, 400, {
            "success": False,
            "error": "Student ID and password are required.",
        })
        return

    lock_key = _student_login_client_key(handler, student_id)
    locked, remaining, _fails = _student_login_lock_status(lock_key)
    if locked:
        json_response(handler, 429, {
            "success": False,
            "error": f"Too many failed attempts. Try again in {remaining}s.",
            "code": "LOGIN_LOCKED",
            "retryAfterSec": remaining,
            "lockUntil": int((time.time() + remaining) * 1000),
            "failedAttempts": _STUDENT_LOGIN_MAX_FAILS,
        })
        return

    student = None

    if supabase_configured():
        # Prefer password-only REST auth (birthdate no longer required on login).
        student = supabase_student_auth_fallback(
            student_id, birth_month, birth_day, birth_year, password,
        )
        if isinstance(student, dict) and student.get("error") == "ACCOUNT_FROZEN":
            json_response(handler, 403, {
                "success": False,
                "error": student.get("message") or "Account frozen.",
                "code": "ACCOUNT_FROZEN",
            })
            return
        if isinstance(student, dict) and student.get("error") == "ACCOUNT_INACTIVE":
            json_response(handler, 403, {
                "success": False,
                "error": student.get("message") or "Account inactive.",
                "code": "ACCOUNT_INACTIVE",
            })
            return
        if not student and (birth_month and birth_day and birth_year):
        result, error = supabase_rpc("authenticate_student", {
            "p_student_id": student_id,
            "p_birth_month": birth_month,
            "p_birth_day": birth_day,
            "p_birth_year": birth_year,
            "p_password": password,
        }, timeout=10)
        if error:
            print(f"[Supabase auth error] {parse_supabase_error(error)}")
            elif isinstance(result, dict) and result.get("error") == "ACCOUNT_FROZEN":
                json_response(handler, 403, {
                    "success": False,
                    "error": result.get("message") or "Account frozen.",
                    "code": "ACCOUNT_FROZEN",
                })
                return
            elif isinstance(result, dict) and result.get("error") == "ACCOUNT_INACTIVE":
                json_response(handler, 403, {
                    "success": False,
                    "error": result.get("message") or "Account inactive.",
                    "code": "ACCOUNT_INACTIVE",
                })
                return
        elif isinstance(result, dict) and result.get("id"):
            student = result

    if not student and not supabase_configured():
        student = local_student_login(student_id, birth_month, birth_day, birth_year, password)

    if student and not (isinstance(student, dict) and student.get("error")):
        _clear_student_login_lockout(lock_key)
        mark_must_change_password(student, password)
        attach_student_profile_photo(student)
        json_response(handler, 200, {"success": True, "student": student})
        return

    lock_info = _record_student_login_failure(lock_key)
    if lock_info.get("locked"):
        json_response(handler, 429, {
            "success": False,
            "error": f"Too many failed attempts. Try again in {lock_info['retryAfterSec']}s.",
            "code": "LOGIN_LOCKED",
            "retryAfterSec": lock_info["retryAfterSec"],
            "lockUntil": lock_info.get("lockUntil"),
            "failedAttempts": lock_info.get("failedAttempts"),
        })
        return

    json_response(handler, 401, {
        "success": False,
        "error": "Invalid Student ID or password.",
        "failedAttempts": lock_info.get("failedAttempts"),
        "hint": (
            "Use the exact Student ID and Temporary Password from your approval email. "
            "If you still cannot sign in, contact the registrar office."
        ) if supabase_configured() else None,
    })


def lookup_student_temp_passwords(student_id):
    student_id = (student_id or "").strip().upper()
    temps = []
    if not student_id:
        return temps
    if supabase_configured():
        rows, _err = supabase_rest_get(
            "admission_applications",
            f"student_id_generated=eq.{quote(student_id)}&select=temp_password&limit=5",
            use_secret=True,
            timeout=8,
        )
        if isinstance(rows, list):
            for row in rows:
                temp = (row.get("temp_password") or "").strip()
                if temp:
                    temps.append(temp)
        return temps
    for app in load_local_admissions():
        sid = (app.get("student_id_generated") or "").strip().upper()
        if sid != student_id:
            continue
        temp = (app.get("temp_password") or app.get("tempPassword") or "").strip()
        if temp:
            temps.append(temp)
    return temps


def mark_must_change_password(student, password):
    if not isinstance(student, dict) or not student.get("id"):
        return student
    pwd = (password or "").strip()
    temps = lookup_student_temp_passwords(student.get("id"))
    if temps:
        student["mustChangePassword"] = any(pwd == temp for temp in temps)
    elif "mustChangePassword" not in student:
        student["mustChangePassword"] = False
    return student


def validate_new_student_password(current_password, new_password, confirm_password):
    current_password = (current_password or "").strip()
    new_password = (new_password or "").strip()
    confirm_password = (confirm_password or "").strip()
    if len(new_password) < 8:
        return "New password must be at least 8 characters."
    if not re.search(r"[A-Za-z]", new_password) or not re.search(r"\d", new_password):
        return "New password must include at least one letter and one number."
    if new_password == current_password:
        return "Choose a password different from your current password."
    if new_password != confirm_password:
        return "New password and confirmation do not match."
    return None


def handle_student_change_password(handler):
    try:
        body = read_json_body(handler)
    except json.JSONDecodeError:
        json_response(handler, 400, {"success": False, "error": "Invalid request body."})
        return

    student_id = (body.get("studentId") or "").strip().upper()
    current_password = (body.get("currentPassword") or "").strip()
    new_password = (body.get("newPassword") or "").strip()
    confirm_password = (body.get("confirmPassword") or "").strip()

    if not student_id or not current_password or not new_password:
        json_response(handler, 400, {
            "success": False,
            "error": "Student ID, current password, and new password are required.",
        })
        return

    error = validate_new_student_password(current_password, new_password, confirm_password)
    if error:
        json_response(handler, 400, {"success": False, "error": error})
        return

    if supabase_configured():
        rows, err = supabase_rest_get(
            "students",
            f"student_id=eq.{quote(student_id)}&select=id,password,account_status,is_active&limit=1",
            use_secret=True,
            timeout=10,
        )
        if err or not isinstance(rows, list) or not rows:
            json_response(handler, 401, {"success": False, "error": "Current password is incorrect."})
            return
        row = rows[0]
        if (row.get("password") or "").strip() != current_password:
            json_response(handler, 401, {"success": False, "error": "Current password is incorrect."})
            return
        if row.get("is_active") is False:
            json_response(handler, 403, {"success": False, "error": "Account inactive."})
            return
        _, patch_err = supabase_rest_patch(
            "students",
            f"student_id=eq.{quote(student_id)}",
            {"password": new_password, "updated_at": datetime.now().isoformat()},
        )
        if patch_err:
            json_response(handler, 500, {
                "success": False,
                "error": "Could not update password. Please try again.",
            })
            return
        json_response(handler, 200, {"success": True})
        return

    records = load_local_admissions()
    updated = False
    for record in records:
        sid = (record.get("student_id_generated") or "").strip().upper()
        if sid != student_id:
            continue
        temp_password = (record.get("temp_password") or record.get("tempPassword") or "").strip()
        portal_password = (record.get("portal_password") or record.get("portalPassword") or "").strip()
        stored = portal_password or temp_password
        if stored != current_password:
            continue
        record["portal_password"] = new_password
        record["portalPassword"] = new_password
        updated = True
        break
    if not updated:
        json_response(handler, 401, {"success": False, "error": "Current password is incorrect."})
        return
    save_local_admissions(records)
    json_response(handler, 200, {"success": True})


FORGOT_PASSWORD_SUCCESS_MSG = (
    "If your email is registered with the school, you will receive a new password shortly. "
    "Check your inbox and spam folder."
)


def is_valid_email(email):
    return bool(re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", (email or "").strip()))


def generate_student_temp_password():
    return f"Shs{random.randint(0, 9999):04d}"


def lookup_approved_student_by_email(email):
    normalized = email.strip().lower()
    if not normalized:
        return None

    if supabase_configured():
        encoded = quote(normalized)
        data, error = supabase_rest_get(
            "admission_applications",
            f"email=eq.{encoded}&status=eq.approved&student_id_generated=not.is.null"
            f"&select=id,first_name,last_name,student_id_generated,email,application_number"
            f"&order=reviewed_at.desc&limit=1",
            use_secret=True,
        )
        if not error and isinstance(data, list) and data:
            row = data[0]
            return {
                "admissionId": row.get("id"),
                "firstName": row.get("first_name") or "",
                "lastName": row.get("last_name") or "",
                "studentId": (row.get("student_id_generated") or "").strip().upper(),
                "email": (row.get("email") or normalized).strip().lower(),
                "applicationNumber": row.get("application_number") or "",
            }
        if error:
            print(f"[Forgot password lookup error] {parse_supabase_error(error)}")

    for record in load_local_admissions():
        rec_email = (record.get("email") or "").strip().lower()
        if rec_email != normalized:
            continue
        if (record.get("status") or "").lower() != "approved":
            continue
        student_id = (
            record.get("student_id_generated")
            or record.get("studentId")
            or ""
        ).strip().upper()
        if not student_id:
            continue
        return {
            "admissionId": record.get("id"),
            "firstName": record.get("firstName") or record.get("first_name") or "",
            "lastName": record.get("lastName") or record.get("last_name") or "",
            "studentId": student_id,
            "email": rec_email,
            "applicationNumber": record.get("applicationNumber") or record.get("application_number") or "",
        }
    return None


def apply_student_password_reset(student_info, new_password):
    student_id = student_info["studentId"]
    admission_id = student_info.get("admissionId")

    if supabase_configured():
        sid = quote(student_id)
        _, student_err = supabase_rest_patch(
            "students",
            f"student_id=eq.{sid}",
            {"password": new_password, "updated_at": datetime.now().isoformat()},
        )
        if student_err:
            print(f"[Forgot password] students patch: {parse_supabase_error(student_err)}")

        if admission_id:
            aid = quote(str(admission_id))
            adm_query = f"id=eq.{aid}"
        else:
            adm_query = f"student_id_generated=eq.{sid}&status=eq.approved"
        _, adm_err = supabase_rest_patch(
            "admission_applications",
            adm_query,
            {"temp_password": new_password, "updated_at": datetime.now().isoformat()},
        )
        if adm_err:
            print(f"[Forgot password] admission patch: {parse_supabase_error(adm_err)}")
        return not (student_err and adm_err)

    records = load_local_admissions()
    idx = find_local_admission_index(
        records,
        admission_id,
        student_info.get("applicationNumber"),
    )
    if idx is not None:
        records[idx]["temp_password"] = new_password
        save_local_admissions(records)
        return True
    return False


def handle_student_forgot_password(handler):
    try:
        body = read_json_body(handler)
    except json.JSONDecodeError:
        json_response(handler, 400, {"success": False, "error": "Invalid request body."})
        return

    email = (body.get("email") or "").strip().lower()
    if not email or not is_valid_email(email):
        json_response(handler, 400, {
            "success": False,
            "error": "Please enter a valid email address.",
        })
        return

    student_info = lookup_approved_student_by_email(email)
    if not student_info:
        json_response(handler, 200, {"success": True, "message": FORGOT_PASSWORD_SUCCESS_MSG})
        return

    new_password = generate_student_temp_password()
    apply_student_password_reset(student_info, new_password)

    ok, err = send_email(
        student_info["email"],
        f"Password Reset — {SCHOOL_NAME}",
        build_forgot_password_email(
            student_info.get("firstName") or "Student",
            student_info["studentId"],
            new_password,
            SCHOOL_NAME,
        ),
    )
    if not ok:
        print(f"[Forgot password email failed] {err}")

    json_response(handler, 200, {"success": True, "message": FORGOT_PASSWORD_SUCCESS_MSG})


def load_local_admissions():
    if not LOCAL_ADMISSIONS_FILE.exists():
        return []
    try:
        return json.loads(LOCAL_ADMISSIONS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []


def save_local_admissions(records):
    LOCAL_ADMISSIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    LOCAL_ADMISSIONS_FILE.write_text(json.dumps(records, indent=2), encoding="utf-8")


def upsert_local_admission(application_id, app_number, payload, fields, status="pending"):
    """Keep a local copy so the admin portal always sees new enrollments."""
    records = load_local_admissions()
    record = {
        "id": application_id,
        "applicationNumber": app_number,
        "status": status,
        "tempPassword": None,
        "student_id_generated": None,
        **payload,
        "strandCode": fields.get("strandCode", payload.get("strandCode", "")),
        "createdAt": datetime.now().isoformat(),
    }
    idx = find_local_admission_index(records, application_id, app_number)
    if idx is not None:
        existing = records[idx]
        record["createdAt"] = existing.get("createdAt") or record["createdAt"]
        records[idx] = {**existing, **record}
    else:
        records.append(record)
    save_local_admissions(records)
    return record


def find_local_admission_index(records, application_id, app_number=None):
    target_id = str(application_id or "").strip()
    target_no = str(app_number or application_id or "").strip()
    for i, record in enumerate(records):
        record_id = str(record.get("id") or "").strip()
        record_no = str(record.get("applicationNumber") or "").strip()
        if target_id and record_id == target_id:
            return i
        if target_no and record_no == target_no:
            return i
    return None


def documents_list_to_dict(documents):
    if isinstance(documents, dict):
        return documents
    result = {}
    for doc in documents or []:
        if isinstance(doc, dict) and doc.get("key") and doc.get("path"):
            result[doc["key"]] = doc["path"]
    return result


def sync_admission_detail_to_local(detail):
    """Materialize a remote/cached admission detail into local admissions.json."""
    normalized = normalize_admission_input(detail)
    records = load_local_admissions()
    app_id = normalized.get("id")
    app_number = normalized.get("applicationNumber")
    idx = find_local_admission_index(records, app_id, app_number)

    record = {
        "id": app_id,
        "applicationNumber": app_number,
        "status": (normalized.get("status") or "pending").lower(),
        "lastName": normalized.get("lastName", ""),
        "firstName": normalized.get("firstName", ""),
        "middleName": normalized.get("middleName", ""),
        "birthdate": normalized.get("birthdate", ""),
        "gender": normalized.get("gender", ""),
        "address": normalized.get("address", ""),
        "contactNumber": normalized.get("contactNumber", ""),
        "email": normalized.get("email", ""),
        "gradeLevel": normalized.get("gradeLevel", ""),
        "strandCode": normalized.get("strandCode", ""),
        "strandId": normalized.get("strandId", ""),
        "admissionType": normalized.get("admissionType", "new"),
        "paymentMode": normalized.get("paymentMode", "cashier"),
        "bankCode": normalized.get("bankCode", ""),
        "bankReference": normalized.get("bankReference", ""),
        "bankSenderName": normalized.get("bankSenderName", ""),
        "bankProofPath": normalized.get("bankProofPath", ""),
        "gcashReference": normalized.get("gcashReference", ""),
        "gcashSenderName": normalized.get("gcashSenderName", ""),
        "gcashProofPath": normalized.get("gcashProofPath", ""),
        "paymentStatus": normalized.get("paymentStatus", ""),
        "paymentAmount": normalized.get("paymentAmount", ""),
        "documents": documents_list_to_dict(detail.get("documents")),
        "docForm138Path": normalized.get("docForm138Path"),
        "docForm137Path": normalized.get("docForm137Path"),
        "docGoodMoralPath": normalized.get("docGoodMoralPath"),
        "docBirthCertificatePath": normalized.get("docBirthCertificatePath"),
        "docHighSchoolDiplomaPath": normalized.get("docHighSchoolDiplomaPath"),
        "student_id_generated": normalized.get("student_id_generated"),
        "reviewed_at": normalized.get("reviewed_at"),
        "rejection_reason": normalized.get("rejection_reason"),
        "createdAt": normalized.get("createdAt") or datetime.now().isoformat(),
    }

    if idx is not None:
        existing = records[idx]
        record["createdAt"] = existing.get("createdAt") or record["createdAt"]
        records[idx] = {**existing, **record}
    else:
        records.append(record)
    save_local_admissions(records)
    return records[idx if idx is not None else -1], records


def ensure_pending_admission_for_review(application_id):
    records = load_local_admissions()
    idx = find_local_admission_index(records, application_id)
    if idx is not None:
        app = records[idx]
        if (app.get("status") or "pending").lower() == "pending":
            return idx, app, records

    detail = get_admission_by_id(application_id)
    if not detail:
        return None, None, records
    if (detail.get("status") or "pending").lower() != "pending":
        return None, None, records

    app, records = sync_admission_detail_to_local(detail)
    idx = find_local_admission_index(records, application_id, app.get("applicationNumber"))
    return idx, records[idx], records


def update_local_admission_review(app, records, action, reason=None, student_id=None, temp_password=None):
    idx = find_local_admission_index(records, app.get("id"), app.get("applicationNumber"))
    if idx is None:
        return app

    reviewed_at = datetime.now().isoformat()
    if action == "approve":
        records[idx]["status"] = "approved"
        records[idx]["student_id_generated"] = student_id
        records[idx]["temp_password"] = temp_password
        records[idx]["reviewed_at"] = reviewed_at
    else:
        records[idx]["status"] = "rejected"
        records[idx]["rejection_reason"] = reason
        records[idx]["reviewed_at"] = reviewed_at

    save_local_admissions(records)
    return records[idx]


def format_applicant_name(record):
    return f"{record.get('lastName', '')}, {record.get('firstName', '')} {record.get('middleName', '')}".strip()


def normalize_admission_input(record):
    """Normalize camelCase/snake_case admission records from local JSON or Supabase."""
    if not record:
        return {}

    def pick(*keys):
        for key in keys:
            val = record.get(key)
            if val is not None and str(val).strip() != "":
                return val
        return ""

    address = pick("address")
    if not address:
        address = build_full_address({
            "houseNumber": pick("houseNumber", "addr_house_number", "addrHouseNumber"),
            "street": pick("street", "addr_street", "addrStreet"),
            "barangay": pick("barangay", "addr_barangay", "addrBarangay"),
            "city": pick("city", "addr_city", "addrCity"),
            "province": pick("province", "addr_province", "addrProvince"),
        })

    birthdate = pick("birthdate", "birth_date")
    if birthdate:
        birthdate = str(birthdate)[:10]

    created = pick("createdAt", "created_at", "submittedAt")
    payment_amount = pick("paymentAmount", "payment_amount")
    if payment_amount != "":
        payment_amount = str(payment_amount)

    documents = record.get("documents") or {}
    if isinstance(documents, str):
        try:
            documents = json.loads(documents)
        except (json.JSONDecodeError, TypeError):
            documents = {}
    if not isinstance(documents, dict):
        documents = {}

    normalized = {
        "id": pick("id"),
        "applicationNumber": pick("applicationNumber", "application_number"),
        "lastName": pick("lastName", "last_name"),
        "firstName": pick("firstName", "first_name"),
        "middleName": pick("middleName", "middle_name"),
        "birthdate": birthdate,
        "gender": pick("gender"),
        "address": address,
        "contactNumber": pick("contactNumber", "contact_number"),
        "email": pick("email"),
        "gradeLevel": pick("gradeLevel", "grade_level", "grade"),
        "strandCode": pick("strandCode", "strand"),
        "admissionType": pick("admissionType", "admission_type") or "new",
        "previousSchool": pick("previousSchool", "previous_school"),
        "paymentMode": pick("paymentMode", "payment_mode") or "cashier",
        "bankCode": pick("bankCode", "bank_code"),
        "bankReference": pick("bankReference", "bank_reference"),
        "bankSenderName": pick("bankSenderName", "bank_sender_name"),
        "bankProofPath": pick("bankProofPath", "bank_proof_path"),
        "gcashReference": pick("gcashReference", "gcash_reference"),
        "gcashSenderName": pick("gcashSenderName", "gcash_sender_name"),
        "gcashProofPath": pick("gcashProofPath", "gcash_proof_path"),
        "paymentStatus": pick("paymentStatus", "payment_status"),
        "paymentAmount": payment_amount,
        "status": (pick("status") or "pending").lower(),
        "createdAt": created,
        "student_id_generated": pick("student_id_generated", "studentId", "student_id_generated"),
        "reviewed_at": pick("reviewed_at", "reviewedAt"),
        "rejection_reason": pick("rejection_reason", "rejectionReason"),
        "documents": documents,
        "docForm138Path": pick("docForm138Path", "doc_form_138_path"),
        "docForm137Path": pick("docForm137Path", "doc_form_137_path"),
        "docGoodMoralPath": pick("docGoodMoralPath", "doc_good_moral_path"),
        "docBirthCertificatePath": pick("docBirthCertificatePath", "doc_birth_certificate_path"),
        "docHighSchoolDiplomaPath": pick("docHighSchoolDiplomaPath", "doc_high_school_diploma_path"),
        "profilePhotoUploadPath": pick(
            "profilePhotoUploadPath",
            "profile_photo_upload_path",
        ),
        "profilePhotoCameraPath": pick(
            "profilePhotoCameraPath",
            "profile_photo_camera_path",
        ),
        "preferredSubjectSchedules": record.get("preferredSubjectSchedules")
        or record.get("preferred_subject_schedules")
        or {},
        "subjectScheduleDetails": record.get("subjectScheduleDetails")
        or record.get("subject_schedule_details")
        or [],
        "houseNumber": pick("houseNumber", "addr_house_number", "addrHouseNumber"),
        "street": pick("street", "addr_street", "addrStreet"),
        "barangay": pick("barangay", "addr_barangay", "addrBarangay"),
        "city": pick("city", "addr_city", "addrCity"),
        "province": pick("province", "addr_province", "addrProvince"),
    }

    if not normalized["profilePhotoUploadPath"]:
        normalized["profilePhotoUploadPath"] = documents.get("profile_upload") or ""
    if not normalized["profilePhotoCameraPath"]:
        normalized["profilePhotoCameraPath"] = documents.get("profile_camera") or ""

    for doc_key, path_key in (
        ("form_138", "docForm138Path"),
        ("form_137", "docForm137Path"),
        ("good_moral", "docGoodMoralPath"),
        ("birth_certificate", "docBirthCertificatePath"),
        ("high_school_diploma", "docHighSchoolDiplomaPath"),
    ):
        if not documents.get(doc_key) and normalized.get(path_key):
            documents[doc_key] = normalized[path_key]

    normalized["documents"] = documents
    return normalized


def merge_admission_fields(base, update):
    result = dict(base or {})
    for key, value in (update or {}).items():
        if value is None:
            continue
        if isinstance(value, str) and value.strip() in ("", "—"):
            continue
        if key not in result or result[key] in (None, "", "—"):
            result[key] = value
        elif key == "documents" and isinstance(value, dict):
            merged_docs = dict(result.get("documents") or {})
            merged_docs.update({k: v for k, v in value.items() if v})
            result["documents"] = merged_docs
    return result


def build_admission_detail(record):
    record = normalize_admission_input(record)
    documents = record.get("documents") or {}
    doc_list = []
    for key, label in REQUIRED_DOCS.items():
        path = documents.get(key)
        if path:
            path = str(path).replace("\\", "/")
        doc_list.append({
            "key": key,
            "label": label,
            "path": path,
            "url": document_view_url(path),
            "uploaded": bool(path),
        })
    gcash_path = record.get("gcashProofPath")
    if record.get("paymentMode") == "gcash" and gcash_path:
        gcash_path = str(gcash_path).replace("\\", "/")
        doc_list.append({
            "key": "gcash_proof",
            "label": "GCash Payment Receipt",
            "path": gcash_path,
            "url": document_view_url(gcash_path),
            "uploaded": True,
        })
    bank_path = record.get("bankProofPath")
    if record.get("paymentMode") == "bank" and bank_path:
        bank_path = str(bank_path).replace("\\", "/")
        doc_list.append({
            "key": "bank_proof",
            "label": "Bank Payment Receipt",
            "path": bank_path,
            "url": document_view_url(bank_path),
            "uploaded": True,
        })
    created = record.get("createdAt") or record.get("created_at") or ""
    student_name = format_applicant_name(record) or record.get("student") or ""

    profile_upload = record.get("profilePhotoUploadPath") or documents.get("profile_upload")
    profile_camera = record.get("profilePhotoCameraPath") or documents.get("profile_camera")
    profile_path = profile_upload or profile_camera

    schedule_details = resolve_subject_schedule_details(
        record,
        rest_get_fn=supabase_rest_get if supabase_configured() else None,
    )

    return {
        "id": record.get("id"),
        "applicationNumber": record.get("applicationNumber"),
        "status": (record.get("status") or "pending").lower(),
        "student": student_name,
        "lastName": record.get("lastName", ""),
        "firstName": record.get("firstName", ""),
        "middleName": record.get("middleName", ""),
        "birthdate": record.get("birthdate", ""),
        "gender": record.get("gender", ""),
        "address": record.get("address", ""),
        "houseNumber": record.get("houseNumber", ""),
        "street": record.get("street", ""),
        "barangay": record.get("barangay", ""),
        "city": record.get("city", ""),
        "province": record.get("province", ""),
        "contactNumber": record.get("contactNumber", ""),
        "email": record.get("email", ""),
        "gradeLevel": record.get("gradeLevel") or record.get("grade", ""),
        "strandCode": record.get("strandCode") or record.get("strand", ""),
        "admissionType": record.get("admissionType", "new"),
        "previousSchool": record.get("previousSchool", ""),
        "paymentMode": record.get("paymentMode", "cashier"),
        "bankCode": record.get("bankCode", ""),
        "bankReference": record.get("bankReference", ""),
        "bankSenderName": record.get("bankSenderName", ""),
        "gcashReference": record.get("gcashReference", ""),
        "gcashSenderName": record.get("gcashSenderName", ""),
        "paymentStatus": record.get("paymentStatus", ""),
        "paymentAmount": record.get("paymentAmount", ""),
        "submittedAt": created,
        "date": created[:10] if created else "",
        "documents": doc_list,
        "profilePhotoUploadPath": profile_upload,
        "profilePhotoCameraPath": profile_camera,
        "profilePhotoUrl": document_view_url(profile_path),
        "preferredSubjectSchedules": record.get("preferredSubjectSchedules") or {},
        "subjectScheduleDetails": schedule_details,
        "studentId": record.get("student_id_generated") or record.get("studentId"),
        "reviewedAt": record.get("reviewed_at"),
        "rejectionReason": record.get("rejection_reason"),
    }


def normalize_local_admission(record):
    detail = build_admission_detail(record)
    detail["strand"] = detail.get("strandCode") or "—"
    detail["grade"] = detail.get("gradeLevel") or "—"
    detail["source"] = "local"
    return detail


def fetch_supabase_pending_admissions():
    if not supabase_configured():
        return []
    data, error = supabase_rpc("get_pending_admissions", timeout=10)
    if error or not data:
        if error:
            print(f"[Supabase] get_pending_admissions: {parse_supabase_error(error)}")
        return []
    if not isinstance(data, list):
        return []
    return [
        {**normalize_local_admission(item), "source": "supabase"}
        if isinstance(item, dict) else item
        for item in data
    ]


def fetch_supabase_admission_history():
    if not supabase_configured():
        return []
    data, error = supabase_rpc("get_admission_history", timeout=10)
    if error or not data:
        if error:
            print(f"[Supabase] get_admission_history: {parse_supabase_error(error)}")
        return []
    return data if isinstance(data, list) else []


def merge_admission_records(remote_items, local_items):
    merged = {}
    for item in local_items + remote_items:
        key = item.get("id") or item.get("applicationNumber")
        if not key:
            continue
        if key in merged:
            merged[key] = merge_admission_fields(merged[key], item)
        else:
            merged[key] = item

    by_app_no = {}
    for item in merged.values():
        app_no = item.get("applicationNumber")
        if app_no and app_no in by_app_no:
            by_app_no[app_no] = merge_admission_fields(by_app_no[app_no], item)
        elif app_no:
            by_app_no[app_no] = item

    if by_app_no:
        final = {}
        for item in merged.values():
            app_no = item.get("applicationNumber")
            key = item.get("id") or app_no
            final[key] = by_app_no.get(app_no, item) if app_no else item
        return list(final.values())

    return list(merged.values())


def get_all_pending_admissions(include_remote=True):
    if supabase_configured():
        return fetch_supabase_pending_admissions()
    return [
        normalize_local_admission(r)
        for r in load_local_admissions()
        if (r.get("status") or "pending").lower() == "pending"
    ]


def get_all_admission_history(include_remote=True):
    if supabase_configured():
        return fetch_supabase_admission_history()
    return [
        {
            "id": r.get("applicationNumber") or r.get("id"),
            "applicationId": r.get("id"),
            "student": format_applicant_name(r),
            "studentId": r.get("student_id_generated") or "—",
            "strand": r.get("strandCode") or "—",
            "grade": r.get("gradeLevel") or "—",
            "status": (r.get("status") or "pending").capitalize(),
            "date": (r.get("reviewed_at") or r.get("createdAt") or "")[:10],
            "email": r.get("email", ""),
            "applicationNumber": r.get("applicationNumber"),
        }
        for r in load_local_admissions()
        if (r.get("status") or "pending").lower() in ("approved", "rejected")
    ]


def build_local_dashboard_payload():
    """Fast dashboard using local files only — no Supabase wait."""
    local_records = load_local_admissions()
    pending = [
        normalize_local_admission(r)
        for r in local_records
        if (r.get("status") or "pending").lower() == "pending"
    ]
    history = [
        {
            "id": r.get("applicationNumber") or r.get("id"),
            "applicationId": r.get("id"),
            "student": format_applicant_name(r),
            "studentId": r.get("student_id_generated") or "—",
            "strand": r.get("strandCode") or "—",
            "grade": r.get("gradeLevel") or "—",
            "status": (r.get("status") or "pending").capitalize(),
            "date": (r.get("reviewed_at") or r.get("createdAt") or "")[:10],
            "email": r.get("email", ""),
            "applicationNumber": r.get("applicationNumber"),
        }
        for r in local_records
        if (r.get("status") or "pending").lower() in ("approved", "rejected")
    ]

    approved_count = sum(1 for r in local_records if (r.get("status") or "").lower() == "approved")
    rejected_count = sum(1 for r in local_records if (r.get("status") or "").lower() == "rejected")
    pending_count = len(pending)

    strand_counts = {}
    for record in local_records + pending:
        code = record.get("strand") or record.get("strandCode") or "—"
        if code and code != "—":
            strand_counts[code] = strand_counts.get(code, 0) + 1

    recent_activity = []
    for app in pending:
        recent_activity.append({
            "id": app.get("id"),
            "type": "admission",
            "student": app.get("student"),
            "strand": f"{app.get('strand', '—')} · {app.get('grade', '—')}",
            "subject": app.get("applicationNumber") or "New Admission",
            "date": app.get("date") or "—",
            "status": "Pending",
        })
    for item in sorted(history, key=lambda x: x.get("date") or "", reverse=True)[:8]:
        recent_activity.append({
            "id": item.get("applicationId") or item.get("id"),
            "type": "admission",
            "student": item.get("student"),
            "strand": f"{item.get('strand', '—')} · {item.get('grade', '—')}",
            "subject": item.get("applicationNumber") or item.get("id") or "Admission",
            "date": item.get("date") or "—",
            "status": item.get("status") or "Processed",
        })

    return {
        "totalStudents": max(approved_count, 1 if approved_count else 0),
        "totalStrands": len(ENROLLMENT_STRANDS),
        "pendingEnrollments": pending_count,
        "pendingAdmissionCount": pending_count,
        "totalAdmissions": len(local_records),
        "enrollmentStats": {
            "approved": approved_count,
            "pending": pending_count,
            "rejected": rejected_count,
        },
        "recentActivity": recent_activity[:10],
        "pendingAdmissions": pending,
        "strandDistribution": [
            {
                "name": code,
                "grade": "Grade 11 & 12",
                "applicants": strand_counts.get(code, 0),
            }
            for code in ENROLLMENT_STRANDS
        ],
        "pendingRequests": [
            {
                "id": app.get("id"),
                "student": app.get("student"),
                "studentId": app.get("applicationNumber") or app.get("id"),
                "strand": app.get("strand"),
                "grade": app.get("grade"),
                "email": app.get("email"),
            }
            for app in pending
        ],
    }


def build_supabase_dashboard_payload():
    pending = fetch_supabase_pending_admissions()
    history = fetch_supabase_admission_history()

    approved_count = sum(1 for h in history if (h.get("status") or "").lower() == "approved")
    rejected_count = sum(1 for h in history if (h.get("status") or "").lower() == "rejected")
    pending_count = len(pending)

    strand_counts = {}
    for record in pending + history:
        code = record.get("strand") or record.get("strandCode") or "—"
        if code and code != "—":
            strand_counts[code] = strand_counts.get(code, 0) + 1

    recent_activity = []
    for app in pending:
        recent_activity.append({
            "id": app.get("id"),
            "type": "admission",
            "student": app.get("student"),
            "strand": f"{app.get('strand', '—')} · {app.get('grade', '—')}",
            "subject": app.get("applicationNumber") or "New Admission",
            "date": app.get("date") or "—",
            "status": "Pending",
        })
    for item in sorted(history, key=lambda x: x.get("date") or "", reverse=True)[:8]:
        recent_activity.append({
            "id": item.get("applicationId") or item.get("id"),
            "type": "admission",
            "student": item.get("student"),
            "strand": f"{item.get('strand', '—')} · {item.get('grade', '—')}",
            "subject": item.get("applicationNumber") or item.get("id") or "Admission",
            "date": item.get("date") or "—",
            "status": item.get("status") or "Processed",
        })

    strand_codes = ENROLLMENT_STRANDS

    return {
        "totalStudents": approved_count,
        "totalStrands": len(strand_codes),
        "pendingEnrollments": pending_count,
        "pendingAdmissionCount": pending_count,
        "totalAdmissions": approved_count + pending_count + rejected_count,
        "enrollmentStats": {
            "approved": approved_count,
            "pending": pending_count,
            "rejected": rejected_count,
        },
        "recentActivity": recent_activity[:10],
        "pendingAdmissions": pending,
        "storage": "supabase",
        "strandDistribution": [
            {
                "name": code,
                "grade": "Grade 11 & 12",
                "applicants": strand_counts.get(code, 0),
            }
            for code in ENROLLMENT_STRANDS
        ],
        "pendingRequests": [
            {
                "id": app.get("id"),
                "student": app.get("student"),
                "studentId": app.get("applicationNumber") or app.get("id"),
                "strand": app.get("strand"),
                "grade": app.get("grade"),
                "email": app.get("email"),
            }
            for app in pending
        ],
    }


def build_faculty_dashboard_payload(include_remote=True):
    if supabase_configured():
        return build_supabase_dashboard_payload()
    return build_local_dashboard_payload()


def handle_faculty_dashboard(handler):
    payload = build_faculty_dashboard_payload()
    json_response(handler, 200, {"success": True, "data": payload})


def generate_local_app_number(records):
    year = datetime.now().strftime("%Y")
    count = len(records) + 1
    return f"APP-{year}-{count:05d}"


def generate_local_student_id(records):
    year = datetime.now().strftime("%Y")
    existing = [r.get("student_id_generated") for r in records if r.get("student_id_generated")]
    max_seq = 145
    for sid in existing:
        try:
            seq = int(sid.split("-")[1])
            max_seq = max(max_seq, seq)
        except (IndexError, ValueError):
            pass
    return f"{year}-{max_seq + 1:05d}-SHS-0"


def save_uploaded_files(application_id, files):
    app_dir = UPLOADS_DIR / application_id
    app_dir.mkdir(parents=True, exist_ok=True)
    saved = {}

    for field, info in files.items():
        filename = Path(info["filename"]).name
        safe_name = re.sub(r"[^\w.\-]", "_", filename) or f"{field}.bin"
        target = app_dir / f"{field}_{safe_name}"
        target.write_bytes(info["content"])
        saved[field] = str(target.relative_to(ROOT)).replace("\\", "/")

    return saved


def persist_admission_documents(application_id, files):
    local_paths = save_uploaded_files(application_id, files)
    return local_paths, local_paths


def patch_admission_document_paths(application_id, doc_paths):
    if not supabase_configured() or not application_id:
        return
    profile_path = doc_paths.get("profile_upload") or doc_paths.get("profile_camera")
    payload = {
        "doc_form_138_path": doc_paths.get("form_138"),
        "doc_form_137_path": doc_paths.get("form_137"),
        "doc_good_moral_path": doc_paths.get("good_moral"),
        "doc_birth_certificate_path": doc_paths.get("birth_certificate"),
        "doc_high_school_diploma_path": doc_paths.get("high_school_diploma"),
        "gcash_proof_path": doc_paths.get("gcash_proof"),
        "bank_proof_path": doc_paths.get("bank_proof"),
        "profile_photo_upload_path": profile_path,
        "profile_photo_camera_path": profile_path,
        "documents": doc_paths,
    }
    _, error = supabase_rest_patch(
        "admission_applications",
        f"id=eq.{application_id}",
        payload,
    )
    if error:
        print(f"[Supabase patch doc paths] {error}")


def run_admission_post_submit(application_id, files, local_doc_paths, app_data, gcash_proof_path, app_number):
    """Send confirmation emails first, then upload documents to Supabase storage."""
    try:
        _send_submission_emails(app_data, local_doc_paths, gcash_proof_path, app_number, files)
        except Exception as err:
        print(f"[Email post-submit] Failed to send confirmation emails: {err}")
        import traceback
        traceback.print_exc()

    try:
        if supabase_configured() and SUPABASE_SECRET_KEY:
            stored_paths = upload_admission_files_to_supabase(
                SUPABASE_URL,
                SUPABASE_SECRET_KEY,
                application_id,
                files,
                local_doc_paths,
            )
            patch_admission_document_paths(application_id, stored_paths)
    except Exception as err:
        print(f"[Storage post-submit] Upload failed (application saved): {err}")
        import traceback
        traceback.print_exc()


def enrich_app_data_with_profile_photo_urls(app_data, doc_paths, files=None):
    """Prepare profile photo for email using CID inline attachment (Gmail-safe)."""
    import mimetypes

    from shared.services.email_templates import PROFILE_PHOTO_CID

    enriched = dict(app_data or {})
    image_ext = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
    content = None
    filename = "profile.jpg"

    if files:
        primary = files.get("profile_upload") or files.get("profile_photo") or files.get("profile_camera")
        if primary and primary.get("content"):
            content = primary["content"]
            filename = primary.get("filename") or filename

    if content is None:
        path = (doc_paths or {}).get("profile_upload") or enriched.get("profilePhotoUploadPath")
        local_file = find_local_document(path, admission_file_roots())
        if local_file and local_file.suffix.lower() in image_ext:
            content = local_file.read_bytes()
            filename = local_file.name

    if content:
        enriched["profilePhotoInlineCid"] = PROFILE_PHOTO_CID
        enriched["profilePhotoInlineContent"] = content
        enriched["profilePhotoFilename"] = filename
        enriched["profilePhotoInlineMime"] = mimetypes.guess_type(filename)[0] or "image/jpeg"
    return enriched


def _profile_photo_inline_attachment(app_data: dict) -> dict | None:
    content = app_data.get("profilePhotoInlineContent")
    cid = app_data.get("profilePhotoInlineCid")
    if not content or not cid:
        return None
    filename = app_data.get("profilePhotoFilename") or "profile.jpg"
    return {
        "content": content,
        "name": filename,
        "mime": app_data.get("profilePhotoInlineMime") or "image/jpeg",
        "inline_cid": cid,
        "inline_only": True,
    }


def _send_submission_emails(app_data, doc_paths, gcash_proof_path, app_number, files=None):
    import importlib
    from shared.services import email_templates as email_mod

    importlib.reload(email_mod)
    email_app_data = enrich_app_data_with_profile_photo_urls(app_data, doc_paths, files)
    html_body = email_mod.build_applicant_confirmation_email(email_app_data, SCHOOL_NAME)
    has_summary = "Personal Information" in html_body
    print(
        f"[Email applicant template] version={email_mod.APPLICANT_EMAIL_VERSION} "
        f"full_summary={has_summary} to={app_data.get('email')}"
    )
    inline_attachments = []
    photo_attachment = _profile_photo_inline_attachment(email_app_data)
    if photo_attachment:
        inline_attachments.append(photo_attachment)
        print(f"[Email applicant] inline profile photo cid={photo_attachment['inline_cid']}")
    ok, err = send_email(
        app_data["email"],
        f"Application Received — {app_number} — {SCHOOL_NAME}",
        html_body,
        inline_attachments,
    )
    print(f"[Email applicant] sent={ok} error={err}")

    time.sleep(3.0)

        attachments = [{"path": path, "name": Path(path).name} for path in doc_paths.values()]
        if gcash_proof_path and gcash_proof_path not in doc_paths.values():
            attachments.append({"path": gcash_proof_path, "name": Path(gcash_proof_path).name})
        bank_proof_path = doc_paths.get("bank_proof")
        if bank_proof_path and bank_proof_path not in doc_paths.values():
            attachments.append({"path": bank_proof_path, "name": Path(bank_proof_path).name})

        admin_target = ADMIN_EMAIL or GMAIL_USER
        if admin_target:
            ok, err = send_email(
                admin_target,
                f"[{SCHOOL_NAME}] New Admission — {app_number}",
                build_admin_submission_email(app_data, doc_paths),
                attachments,
            )
        print(f"[Email admin] sent={ok} error={err}")


def dispatch_submission_emails(app_data, doc_paths, gcash_proof_path, app_number):
    """Send confirmation emails in the background so submit responds immediately."""
    def _worker():
        try:
            _send_submission_emails(app_data, doc_paths, gcash_proof_path, app_number)
        except Exception as err:
            print(f"[Email background] Failed: {err}")
            import traceback
            traceback.print_exc()

    threading.Thread(target=_worker, daemon=True).start()


def admission_file_roots():
    return [ROOT]


def document_view_url(path):
    return resolve_document_view_url(path, supabase_url=SUPABASE_URL)


def _profile_path_from_record(record):
    if not isinstance(record, dict):
        return None
    documents = record.get("documents") or {}
    if isinstance(documents, str):
        try:
            documents = json.loads(documents)
        except (json.JSONDecodeError, TypeError):
            documents = {}
    if not isinstance(documents, dict):
        documents = {}
    for key in (
        "profilePhotoUploadPath",
        "profile_photo_upload_path",
        "profilePhotoCameraPath",
        "profile_photo_camera_path",
        "profile_upload",
        "profile_camera",
    ):
        value = record.get(key) if key in record else documents.get(key)
        if value and str(value).strip():
            return str(value).strip()
    return None


def resolve_student_profile_photo_url(student_id):
    sid = str(student_id or "").strip().upper()
    if not sid:
        return None

    if supabase_configured():
        from urllib.parse import quote

        rows, _ = supabase_rest_get(
            "admission_applications",
            (
                f"student_id_generated=eq.{quote(sid)}&status=eq.approved"
                "&select=profile_photo_upload_path,profile_photo_camera_path,documents"
                "&order=reviewed_at.desc&limit=1"
            ),
            use_secret=True,
            timeout=10,
        )
        if isinstance(rows, list) and rows:
            path = _profile_path_from_record(rows[0])
            if path:
                return document_view_url(path)

    for app in load_local_admissions():
        if (app.get("status") or "").lower() != "approved":
            continue
        if str(app.get("student_id_generated") or "").strip().upper() != sid:
            continue
        path = _profile_path_from_record(app)
        if path:
            return document_view_url(path)

    return None


def attach_student_profile_photo(student):
    if not isinstance(student, dict):
        return student
    photo_url = resolve_student_profile_photo_url(student.get("id"))
    if photo_url:
        student["profilePhotoUrl"] = photo_url
    return student


def handle_student_profile_photo(handler):
    query = handler.path.split("?", 1)[1] if "?" in handler.path else ""
    student_id = ""
    for part in query.split("&"):
        if part.startswith("id=") or part.startswith("studentId="):
            student_id = unquote(part.split("=", 1)[1])
            break

    photo_url = resolve_student_profile_photo_url(student_id)
    if not photo_url:
        json_response(handler, 404, {"success": False, "error": "Profile photo not found"})
        return

    json_response(handler, 200, {"success": True, "url": photo_url})


def handle_admission_file(handler):
    import mimetypes

    query = handler.path.split("?", 1)[1] if "?" in handler.path else ""
    file_path = ""
    for part in query.split("&"):
        if part.startswith("path="):
            file_path = unquote(part.split("=", 1)[1])
            break

    if not file_path:
        json_response(handler, 400, {"success": False, "error": "Missing file path"})
        return

    content, filename, local_file = load_admission_file_content(
        file_path,
        local_roots=admission_file_roots(),
        supabase_url=SUPABASE_URL,
        secret_key=SUPABASE_SECRET_KEY,
    )
    if content is None:
        handler.send_error(404, "File not found")
        return

    if local_file:
        mime, _ = mimetypes.guess_type(str(local_file))
        download_name = local_file.name
    else:
        mime, _ = mimetypes.guess_type(filename or file_path)
        download_name = filename or Path(file_path).name

    handler.send_response(200)
    handler.send_header("Content-Type", mime or "application/octet-stream")
    handler.send_header("Content-Length", str(len(content)))
    handler.send_header("Content-Disposition", f'inline; filename="{download_name}"')
    handler.end_headers()
    handler.wfile.write(content)


def _email_school_name():
    fresh = load_env()[0].get("SCHOOL_NAME")
    return email_brand_name(fresh or SCHOOL_NAME)


def send_email(to_addr, subject, html_body, attachments=None):
    to_addr = (to_addr or "").strip()
    if not to_addr:
        return False, "Missing recipient email address"

    if not GMAIL_USER or not GMAIL_APP_PASSWORD:
        print(f"[Email skipped - Gmail not configured] To: {to_addr} | {subject}")
        return False, "Gmail is not configured in .env (GMAIL_USER + GMAIL_APP_PASSWORD)"

    attachment_list = list(attachments or [])
    inline_items = [item for item in attachment_list if item.get("inline_cid")]
    other_items = [item for item in attachment_list if not item.get("inline_cid")]

    if inline_items:
        msg = MIMEMultipart("mixed")
        related = MIMEMultipart("related")
        related.attach(MIMEText(html_body, "html"))
        for attachment in inline_items:
            filename = attachment.get("name", "inline.jpg")
            data = attachment.get("content")
            if data is None:
                path = ROOT / attachment["path"]
                if not path.exists():
                    print(f"[Email inline attachment missing] {attachment.get('path')}")
                    continue
                data = path.read_bytes()
                filename = attachment.get("name", path.name)
            subtype = "jpeg"
            if filename.lower().endswith(".png"):
                subtype = "png"
            elif filename.lower().endswith(".gif"):
                subtype = "gif"
            elif filename.lower().endswith(".webp"):
                subtype = "webp"
            inline_part = MIMEImage(data, _subtype=subtype)
            inline_part.add_header("Content-ID", f"<{attachment['inline_cid']}>")
            inline_part.add_header("Content-Disposition", "inline", filename=filename)
            related.attach(inline_part)
        msg.attach(related)
    else:
        msg = MIMEMultipart()
        msg.attach(MIMEText(html_body, "html"))

    msg["From"] = formataddr((DEFAULT_SCHOOL_NAME, GMAIL_USER))
    msg["To"] = to_addr
    msg["Subject"] = scrub_legacy_brand_text(subject)
    print(f"[Email] From display name: {DEFAULT_SCHOOL_NAME!r} | To: {to_addr} | {msg['Subject'][:80]}")
    domain = GMAIL_USER.split("@", 1)[-1] if "@" in GMAIL_USER else "localhost"
    message_id = f"{uuid.uuid4().hex}@{domain}"
    msg["Message-ID"] = f"<{message_id}>"
    msg["X-Entity-Ref-ID"] = message_id

    for attachment in other_items:
        filename = attachment.get("name", "attachment")
        if attachment.get("content") is not None:
            data = attachment["content"]
        else:
            path = ROOT / attachment["path"]
            if not path.exists():
                print(f"[Email attachment missing] {attachment.get('path')}")
                continue
            data = path.read_bytes()
            filename = attachment.get("name", path.name)

        lower_name = filename.lower()
        if "registration" in lower_name and lower_name.endswith((".html", ".htm")):
            print(
                f"[Email] BLOCKED legacy HTML registration attachment ({filename}). "
                "Restart the server and approve again to send Registration_Certificate_*.pdf."
            )
            continue

        if filename.lower().endswith(".pdf") or attachment.get("mime") == "application/pdf":
            part = MIMEBase("application", "pdf")
            part.set_payload(data)
            encoders.encode_base64(part)
            part.add_header("Content-Disposition", "attachment", filename=filename)
            msg.attach(part)
            continue

        if str(attachment.get("mime", "")).startswith("image/") or filename.lower().endswith((".png", ".jpg", ".jpeg", ".gif", ".webp")):
            subtype = "png"
            if filename.lower().endswith((".jpg", ".jpeg")):
                subtype = "jpeg"
            elif "." in filename:
                subtype = filename.rsplit(".", 1)[-1].lower()
                if subtype == "jpg":
                    subtype = "jpeg"
            inline_cid = attachment.get("inline_cid")
            if inline_cid:
                inline_part = MIMEImage(data, _subtype=subtype)
                inline_part.add_header("Content-ID", f"<{inline_cid}>")
                inline_part.add_header("Content-Disposition", "inline", filename=filename)
                msg.attach(inline_part)
                if not attachment.get("inline_only"):
                    attach_part = MIMEImage(data, _subtype=subtype)
                    attach_part.add_header("Content-Disposition", "attachment", filename=filename)
                    msg.attach(attach_part)
                continue
            part = MIMEImage(data, _subtype=subtype)
            part.add_header("Content-Disposition", "attachment", filename=filename)
            msg.attach(part)
            continue

        if filename.lower().endswith((".html", ".htm")) or attachment.get("mime") == "text/html":
            part = MIMEText(data.decode("utf-8") if isinstance(data, bytes) else data, "html", "utf-8")
            part.add_header("Content-Disposition", f'attachment; filename="{filename}"')
            msg.attach(part)
            continue

        part = MIMEBase("application", "octet-stream")
        part.set_payload(data)
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", f'attachment; filename="{filename}"')
        msg.attach(part)

    errors = []
    method, err = _deliver_smtp_message(msg, to_addr)
    if method:
        print(f"[Email sent via {method}] To: {to_addr} | {subject}")
        return True, None
    if err:
        print(f"[Email error] {err}")
    return False, err or " | ".join(errors)


_smtp_send_lock = threading.Lock()


def _deliver_smtp_message(msg, to_addr):
    """Serialize once, send with lock + retries to avoid Gmail 'Server not connected' drops."""
    recipients = [addr.strip() for addr in str(to_addr or "").split(",") if addr.strip()]
    if not recipients:
        return None, "Missing recipient email address"

    payload = msg.as_string()
    from_addr = GMAIL_USER
    errors = []

    def send_ssl():
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=60) as server:
            server.login(GMAIL_USER, GMAIL_APP_PASSWORD)
            server.sendmail(from_addr, recipients, payload)

    def send_tls():
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=60) as server:
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(GMAIL_USER, GMAIL_APP_PASSWORD)
            server.sendmail(from_addr, recipients, payload)

    with _smtp_send_lock:
        for attempt in range(1, 4):
            for label, sender in (("SMTP_SSL:465", send_ssl), ("STARTTLS:587", send_tls)):
                try:
                    sender()
                    return label, None
                except Exception as err:
                    errors.append(f"{label}(try{attempt}): {err}")
            if attempt < 3:
                time.sleep(attempt * 0.75)

    return None, " | ".join(errors[-6:])


def _send_via_smtp_ssl(msg):
    method, err = _deliver_smtp_message(msg, msg.get("To", ""))
    if err:
        raise RuntimeError(err)


def _send_via_starttls(msg):
    method, err = _deliver_smtp_message(msg, msg.get("To", ""))
    if err:
        raise RuntimeError(err)


def gmail_configured():
    return bool(GMAIL_USER and GMAIL_APP_PASSWORD)


def mask_email(email):
    if not email or "@" not in email:
        return None
    local, domain = email.split("@", 1)
    if len(local) <= 2:
        masked_local = local[0] + "*"
    else:
        masked_local = local[0] + ("*" * (len(local) - 2)) + local[-1]
    return f"{masked_local}@{domain}"


def build_admin_submission_email(app_data, doc_paths):
    docs_html = "".join(
        f"<li><strong>{REQUIRED_DOCS.get(key, key)}</strong></li>"
        for key in REQUIRED_DOCS
        if key in doc_paths
    )
    payment = app_data.get("paymentMode", "")
    if payment == "gcash":
        payment_detail = (
            f"GCash — Ref: {app_data.get('gcashReference', 'N/A')} · "
            f"Sender: {app_data.get('gcashSenderName', 'N/A')} · "
            f"PHP {app_data.get('paymentAmount', ENROLLMENT_FEE)}"
        )
    elif payment == "bank":
        bank_names = {"bpi": "BPI", "unionbank": "UnionBank"}
        bank_label = bank_names.get(app_data.get("bankCode", ""), app_data.get("bankCode", "Bank"))
        payment_detail = (
            f"{bank_label} — Ref: {app_data.get('bankReference', 'N/A')} · "
            f"Sender: {app_data.get('bankSenderName', 'N/A')} · "
            f"PHP {app_data.get('paymentAmount', ENROLLMENT_FEE)}"
        )
    else:
        payment_detail = "Pay in person at the Cashier"

    return f"""
    <div style="font-family:Arial,sans-serif;max-width:640px;">
      <h2 style="color:#1a3a6b;">New Admission Application — {_email_school_name()}</h2>
      <p><strong>Application No:</strong> {app_data.get('applicationNumber')}</p>
      <p><strong>Name:</strong> {app_data.get('lastName')}, {app_data.get('firstName')} {app_data.get('middleName', '')}</p>
      <p><strong>Email:</strong> {app_data.get('email')}</p>
      <p><strong>Contact:</strong> {app_data.get('contactNumber')}</p>
      <p><strong>Grade Level:</strong> {app_data.get('gradeLevel')}</p>
      <p><strong>Strand:</strong> {app_data.get('strandCode', 'N/A')}</p>
      <p><strong>Payment:</strong> {payment_detail}</p>
      <h3>Submitted Documents</h3>
      <ul>{docs_html}</ul>
      <p>Please review this application in the Faculty Portal.</p>
    </div>
    """


def fetch_student_contact(student_id):
    if not supabase_configured():
        return None
    sid = quote(student_id.strip().upper())
    data, error = supabase_rest_get(
        "students",
        f"student_id=eq.{sid}&select=email,first_name,last_name,middle_name,student_id&limit=1",
    )
    if error or not isinstance(data, list) or not data:
        return None
    return data[0]


def dispatch_subject_enrollment_email(student_id, total_units=None):
    """Send subject enrollment confirmation in the background."""

    def _worker():
        contact = fetch_student_contact(student_id)
        if not contact or not contact.get("email"):
            print(f"[Email skipped] No email on file for student {student_id}")
            return
        ok, err = send_email(
            contact["email"],
            f"Enrollment Submission Received — {SCHOOL_NAME}",
            build_subject_enrollment_confirmation_email(
                contact, SCHOOL_NAME, total_units=total_units,
            ),
        )
        print(f"[Email background subject enrollment] sent={ok} error={err}")

    threading.Thread(target=_worker, daemon=True).start()


def build_approval_email(result, app_detail=None):
    from shared.services.registration_form import build_approval_email_html, prepare_form_data

    form_data = prepare_form_data(
        result,
        app_detail,
        rest_get_fn=supabase_rest_get if supabase_configured() else None,
    )
    return build_approval_email_html(result, form_data, SCHOOL_NAME)


def send_admission_credentials_email(result, app_detail=None):
    """Send Student ID + temp password after admission approval — no Registration Form."""
    from shared.services.email_templates import build_admission_approval_email

    merged = {**(app_detail or {}), **(result or {})}
    email = (merged.get("email") or "").strip().lower()
    if not email:
        return False, "Student email address not found."

    form_data = {
        "firstName": merged.get("firstName") or merged.get("first_name"),
        "studentId": merged.get("studentId") or merged.get("student_id_generated"),
        "tempPassword": merged.get("tempPassword") or merged.get("temp_password"),
        "applicationNumber": merged.get("applicationNumber") or merged.get("application_number"),
    }
    app_number = form_data.get("applicationNumber") or "Application"
    brand = _email_school_name()
    subject = f"Enrollment Approved — {app_number} — {brand}"
    try:
        html_body = build_admission_approval_email(result, form_data, brand)
    except Exception as err:
        print(f"[Email approval] Template error: {err}")
        return False, f"Could not build approval email: {err}"

    ok, err = send_email(email, subject, html_body)
    if ok:
        print(f"[Email approval] Sent to {email} | {app_number} | student={form_data.get('studentId')}")
    else:
        print(f"[Email approval] FAILED to {email} | {app_number} | {err}")
    return ok, err


def send_admission_approval_email(result, app_detail=None):
    """Deprecated alias — credentials only; Registration Form is sent after payment approval."""
    return send_admission_credentials_email(result, app_detail)


def build_rejection_email(result, reason):
    return build_admission_rejection_email(result, reason, SCHOOL_NAME)


def handle_admission_submit(handler):
    parsed = parse_multipart_form(handler)
    if not parsed:
        json_response(handler, 400, {"success": False, "error": "Invalid form data"})
        return

    fields = parsed["fields"]
    files = parsed["files"]

    missing_fields = [
        key for key in (
            "lastName", "firstName", "birthdate", "email", "contactNumber",
            "gender", "gradeLevel", "paymentMode"
        )
        if not fields.get(key, "").strip()
    ]
    if missing_fields:
        json_response(handler, 400, {
            "success": False,
            "error": f"Missing required fields: {', '.join(missing_fields)}",
        })
        return

    field_error = validate_admission_fields(fields)
    if field_error:
        json_response(handler, 400, {"success": False, "error": field_error})
        return

    if not fields.get("strandCode", fields.get("strandId", "")).strip():
        json_response(handler, 400, {"success": False, "error": "Preferred strand is required."})
        return

    address_fields = ("houseNumber", "street", "barangay", "city", "province")
    if not all(fields.get(key, "").strip() for key in address_fields):
        json_response(handler, 400, {"success": False, "error": "Please complete all address fields."})
        return

    if not fields.get("previousSchool", "").strip():
        json_response(handler, 400, {"success": False, "error": "Previous school is required."})
        return

    missing_docs = [key for key in REQUIRED_DOCS if key not in files]
    if missing_docs:
        json_response(handler, 400, {
            "success": False,
            "error": "Please upload all required documents.",
            "missingDocuments": missing_docs,
        })
        return

    if "profile_upload" not in files and "profile_camera" not in files and "profile_photo" not in files:
        json_response(handler, 400, {
            "success": False,
            "error": "Please upload or take your profile photo (Step 4).",
        })
        return

    primary_profile = files.get("profile_photo") or files.get("profile_camera") or files.get("profile_upload")
    if primary_profile:
        files["profile_upload"] = primary_profile
    files.pop("profile_photo", None)
    files.pop("profile_camera", None)

    if fields.get("paymentMode") == "gcash":
        if not fields.get("gcashReference", "").strip():
            json_response(handler, 400, {"success": False, "error": "GCash reference number is required."})
            return
        if not fields.get("gcashSenderName", "").strip():
            json_response(handler, 400, {"success": False, "error": "GCash sender name is required."})
            return
        if not fields.get("paymentAmount", "").strip():
            json_response(handler, 400, {"success": False, "error": "Payment amount is required."})
            return
        if "gcash_proof" not in files:
            json_response(handler, 400, {"success": False, "error": "Please upload your GCash payment receipt."})
            return

    if fields.get("paymentMode") == "bank":
        if not fields.get("bankCode", "").strip():
            json_response(handler, 400, {"success": False, "error": "Bank selection is required."})
            return
        if not fields.get("bankReference", "").strip():
            json_response(handler, 400, {"success": False, "error": "Bank reference number is required."})
            return
        if not fields.get("bankSenderName", "").strip():
            json_response(handler, 400, {"success": False, "error": "Bank account holder name is required."})
            return
        if not fields.get("paymentAmount", "").strip():
            json_response(handler, 400, {"success": False, "error": "Payment amount is required."})
            return
        if "bank_proof" not in files:
            json_response(handler, 400, {"success": False, "error": "Please upload your bank payment receipt."})
            return

    file_error = validate_admission_files(files, payment_mode=fields.get("paymentMode", ""))
    if file_error:
        json_response(handler, 400, {"success": False, "error": file_error})
            return

    application_id = str(uuid.uuid4())
    doc_paths, local_doc_paths = persist_admission_documents(application_id, files)
    gcash_proof_path = doc_paths.get("gcash_proof")
    bank_proof_path = doc_paths.get("bank_proof")

    gcash_ref = fields.get("gcashReference", "").strip()

    full_address = build_full_address(fields)

    subject_schedules = {}
    subject_schedule_details = []
    raw_schedules = fields.get("subjectSchedules", "").strip()
    raw_schedule_details = fields.get("subjectScheduleDetails", "").strip()
    if raw_schedules:
        try:
            subject_schedules = json.loads(raw_schedules)
            if not isinstance(subject_schedules, dict):
                subject_schedules = {}
        except json.JSONDecodeError:
            subject_schedules = {}
    if raw_schedule_details:
        try:
            subject_schedule_details = json.loads(raw_schedule_details)
            if not isinstance(subject_schedule_details, list):
                subject_schedule_details = []
        except json.JSONDecodeError:
            subject_schedule_details = []

    document_file_names = {}
    profile_photo_file_names = {}
    raw_doc_names = fields.get("documentFileNames", "").strip()
    raw_photo_names = fields.get("profilePhotoFileNames", "").strip()
    if raw_doc_names:
        try:
            document_file_names = json.loads(raw_doc_names)
            if not isinstance(document_file_names, dict):
                document_file_names = {}
        except json.JSONDecodeError:
            document_file_names = {}
    if raw_photo_names:
        try:
            profile_photo_file_names = json.loads(raw_photo_names)
            if not isinstance(profile_photo_file_names, dict):
                profile_photo_file_names = {}
        except json.JSONDecodeError:
            profile_photo_file_names = {}

    payload = {
        "lastName": fields["lastName"].strip(),
        "firstName": fields["firstName"].strip(),
        "middleName": fields.get("middleName", "").strip(),
        "birthdate": fields["birthdate"].strip(),
        "gender": fields.get("gender", "").strip(),
        "houseNumber": fields.get("houseNumber", "").strip(),
        "street": fields.get("street", "").strip(),
        "barangay": fields.get("barangay", "").strip(),
        "city": fields.get("city", "").strip(),
        "province": fields.get("province", "").strip(),
        "address": full_address,
        "contactNumber": fields["contactNumber"].strip(),
        "email": fields["email"].strip().lower(),
        "gradeLevel": fields["gradeLevel"].strip(),
        "strandCode": fields.get("strandCode", fields.get("strandId", "")).strip(),
        "strandId": "",
        "admissionType": fields.get("admissionType", "new").strip() or "new",
        "previousSchool": fields.get("previousSchool", "").strip(),
        "paymentMode": fields["paymentMode"].strip(),
        "bankCode": fields.get("bankCode", "").strip(),
        "bankReference": fields.get("bankReference", "").strip(),
        "bankSenderName": fields.get("bankSenderName", "").strip(),
        "bankProofPath": bank_proof_path,
        "gcashReference": gcash_ref,
        "gcashSenderName": fields.get("gcashSenderName", "").strip(),
        "gcashProofPath": gcash_proof_path,
        "paymentStatus": fields.get("paymentStatus", "submitted").strip() or "submitted",
        "paymentAmount": fields.get("paymentAmount", str(ENROLLMENT_FEE)).strip(),
        "documents": doc_paths,
        "docForm138Path": doc_paths.get("form_138"),
        "docForm137Path": doc_paths.get("form_137"),
        "docGoodMoralPath": doc_paths.get("good_moral"),
        "docBirthCertificatePath": doc_paths.get("birth_certificate"),
        "docHighSchoolDiplomaPath": doc_paths.get("high_school_diploma"),
        "profilePhotoUploadPath": doc_paths.get("profile_upload"),
        "profilePhotoCameraPath": doc_paths.get("profile_upload"),
        "subjectSchedules": subject_schedules,
        "subjectScheduleDetails": subject_schedule_details,
        "documentFileNames": document_file_names,
        "profilePhotoFileNames": profile_photo_file_names,
        "gcashProofFileName": fields.get("gcashProofFileName", "").strip(),
        "bankProofFileName": fields.get("bankProofFileName", "").strip(),
    }

    app_number = None
    supabase_id = application_id

    if not supabase_configured():
        json_response(handler, 503, {
            "success": False,
            "error": "Applications must be saved to Supabase. Configure SUPABASE_URL and keys in .env — local file storage is disabled.",
        })
        return

        result, error = supabase_rpc(
            "submit_admission_application",
            {"p_payload": payload},
            timeout=15,
        )
        if error:
        detail = parse_supabase_error(error)
        print(f"[Supabase error] submit_admission_application: {detail}")
        print(f"[Supabase raw error] {error[:800] if error else ''}")
            json_response(handler, 500, {
                "success": False,
            "error": "We could not save your application right now. Please try again in a few minutes or contact the registrar office.",
                "hint": (
                "Database needs updating: open Supabase → SQL Editor, run "
                "ENROLLSYSTEM/supabase/fix-admission-submit.sql, then submit again."
                ),
            "details": detail,
            })
            return

        app_number = result.get("applicationNumber")
        supabase_id = result.get("applicationId", application_id)
        print(f"[Supabase] Saved admission {app_number}")

    app_data = {**payload, "applicationNumber": app_number, "strandCode": fields.get("strandCode", "")}

    response = {
        "success": True,
        "applicationNumber": app_number,
        "applicationId": supabase_id,
        "storage": "supabase",
        "emailsQueued": gmail_configured(),
    }
    if not gmail_configured():
        response["emailWarning"] = (
            "Your application was saved successfully. A confirmation email could not be sent at this time. "
            "Please contact the Registrar's Office if you do not receive an update within a few business days."
        )
    json_response(handler, 200, response)

    threading.Thread(
        target=run_admission_post_submit,
        args=(supabase_id, files, local_doc_paths, app_data, gcash_proof_path, app_number),
        daemon=True,
    ).start()


def handle_admission_review(handler):
    body = read_json_body(handler)
    application_id = body.get("applicationId")
    action = (body.get("action") or "").lower()
    faculty_id = body.get("facultyId", "")
    reason = body.get("reason")

    if not application_id or action not in ("approve", "reject"):
        json_response(handler, 400, {"success": False, "error": "Invalid request"})
        return

    if supabase_configured():
        detail = get_admission_by_id(application_id)
        if not detail:
            json_response(handler, 404, {
                "success": False,
                "error": "Application not found. Refresh the list and try again.",
            })
            return
        if (detail.get("status") or "pending").lower() != "pending":
            json_response(handler, 404, {
                "success": False,
                "error": "Application already processed.",
            })
            return

        review_id = detail.get("id") or application_id
        result, error = supabase_rpc("review_admission_application", {
            "p_application_id": review_id,
            "p_faculty_id": faculty_id,
            "p_action": action,
            "p_reason": reason,
        }, timeout=15)

        if error or not isinstance(result, dict) or not result.get("email"):
            print(f"[Supabase review error] {error}")
            json_response(handler, 500, {
                "success": False,
                "error": "We could not process this application right now. Please try again or contact the registrar office.",
            })
            return

        email_ok = False
        email_err = None
        if action == "approve":
            sync_approved_student_credentials(result, detail)
            email_ok, email_err = send_admission_credentials_email(result, detail)
        else:
            email_ok, email_err = send_email(
                result["email"],
                f"Admission Update — {result.get('applicationNumber') or 'Application'} — {SCHOOL_NAME}",
                build_rejection_email(result, reason),
            )
        result["success"] = True
        result["emailSent"] = email_ok
        if email_err:
            result["emailError"] = email_err
        json_response(handler, 200, result)
        return

    idx, app, records = ensure_pending_admission_for_review(application_id)
    if app is None:
        json_response(handler, 404, {"success": False, "error": "Application not found or already processed"})
        return

    if action == "approve":
        student_id = generate_local_student_id(records)
        temp_password = f"Shs{datetime.now().strftime('%m%d')}"
        update_local_admission_review(app, records, "approve", student_id=student_id, temp_password=temp_password)
        result = {
            "success": True,
            "status": "approved",
            "studentId": student_id,
            "tempPassword": temp_password,
            "email": app["email"],
            "firstName": app["firstName"],
            "applicationNumber": app.get("applicationNumber"),
        }
        sync_approved_student_credentials(result, app)
        ok, err = send_admission_credentials_email(result, app)
        result["emailSent"] = ok
        if err:
            result["emailError"] = err
    else:
        update_local_admission_review(app, records, "reject", reason=reason)
        result = {
            "success": True,
            "status": "rejected",
            "email": app["email"],
            "firstName": app["firstName"],
            "applicationNumber": app.get("applicationNumber"),
        }
        ok, err = send_email(
            app["email"],
            f"Admission Update — {app.get('applicationNumber') or result.get('applicationNumber') or 'Application'} — {SCHOOL_NAME}",
            build_rejection_email(result, reason),
        )
        result["emailSent"] = ok
        if err:
            result["emailError"] = err

    json_response(handler, 200, result)


def find_admission_by_student_id(student_id):
    sid = str(student_id or "").strip().upper()
    if not sid or not supabase_configured():
        return None

    rows, error = supabase_rest_get(
        "admission_applications",
        (
            f"student_id_generated=eq.{sid}&status=eq.approved"
            "&select=application_number&order=reviewed_at.desc&limit=1"
        ),
        use_secret=True,
    )
    if error or not rows:
        return None

    app_number = rows[0].get("application_number")
    if not app_number:
        return None
    return get_admission_by_id(app_number)


def handle_serve_registration_certificate(handler, student_id: str) -> bool:
    from shared.services.registration_form import (
        COR_PDF_LAYOUT_VERSION,
        build_registration_certificate_for_student,
        write_registration_certificate_http,
    )

    detail = find_admission_by_student_id(student_id)
    if not detail:
        return False

    if supabase_configured():
        pay_info, _ = supabase_rpc("get_student_payment_status", {
            "p_student_id": student_id,
        }, timeout=10)
        if isinstance(pay_info, dict):
            payments = pay_info.get("payments") or []
            if isinstance(payments, list) and payments:
                current = payments[0] if isinstance(payments[0], dict) else {}
                if current.get("schoolYear"):
                    detail["schoolYear"] = current["schoolYear"]
                if current.get("semester"):
                    detail["semester"] = current["semester"]

    pdf_bytes = build_registration_certificate_for_student(
        student_id,
        SCHOOL_NAME,
        admission_detail=detail,
        rest_get_fn=supabase_rest_get if supabase_configured() else None,
    )
    if not pdf_bytes:
        return False

    write_registration_certificate_http(handler, pdf_bytes, student_id, inline=True)
    print(f"[COR] Served dynamic PDF ({COR_PDF_LAYOUT_VERSION}) for {student_id}")
    return True


def find_supabase_admission(application_id):
    """Look up an admission in Supabase by UUID or application number."""
    target = str(application_id or "").strip()
    if not target or not supabase_configured():
        return None

    result, error = supabase_rpc("get_admission_detail", {
        "p_application_id": target,
    }, timeout=10)
    if not error and isinstance(result, dict) and result.get("id"):
        return result

    if error:
        print(f"[Supabase] get_admission_detail({target}): {parse_supabase_error(error)}")

    for item in fetch_supabase_pending_admissions():
        item_id = str(item.get("id") or "")
        item_no = str(item.get("applicationNumber") or "")
        if target in (item_id, item_no):
            return item

    for item in fetch_supabase_admission_history():
        item_id = str(item.get("applicationId") or item.get("id") or "")
        item_no = str(item.get("applicationNumber") or "")
        if target in (item_id, item_no):
            return item

    return None


def get_admission_by_id(application_id):
    if not application_id:
        return None

    if supabase_configured():
        record = find_supabase_admission(application_id)
        if record:
            return build_admission_detail(record)
        return None

    for record in load_local_admissions():
        if record.get("id") == application_id or record.get("applicationNumber") == application_id:
            return build_admission_detail(record)

    return None


def handle_get_admission_detail(handler):
    query = handler.path.split("?", 1)[1] if "?" in handler.path else ""
    app_id = ""
    for part in query.split("&"):
        if part.startswith("id="):
            app_id = unquote(part.split("=", 1)[1])
    if not app_id:
        json_response(handler, 400, {"success": False, "error": "Missing application id"})
        return
    detail = get_admission_by_id(app_id)
    if not detail:
        json_response(handler, 404, {"success": False, "error": "Application not found"})
        return
    json_response(handler, 200, {"success": True, "data": detail})


def handle_get_pending_admissions(handler):
    pending = get_all_pending_admissions()
    json_response(handler, 200, {"success": True, "data": pending})


def handle_get_admission_history(handler):
    history = get_all_admission_history()
    json_response(handler, 200, {"success": True, "data": history})


def handle_health_check(handler):
    supabase_ready = supabase_configured()
    gmail_ready = gmail_configured()
    json_response(handler, 200, {
        "success": True,
        "supabaseConfigured": supabase_ready,
        "supabaseUrl": SUPABASE_URL or None,
        "hasSecretKey": bool(SUPABASE_SECRET_KEY),
        "hasPublishableKey": bool(SUPABASE_PUBLISHABLE_KEY),
        "gmailConfigured": gmail_ready,
        "gmailUser": mask_email(GMAIL_USER) if gmail_ready else None,
        "adminEmail": mask_email(ADMIN_EMAIL) if ADMIN_EMAIL else None,
        "message": (
            "Supabase is configured. Admissions save to Supabase only."
            if supabase_ready
            else "SUPABASE_URL is missing in .env — data saves to local file only (data/admissions.json)."
        ),
        "gmailMessage": (
            "Gmail is configured. Enrollment emails will be sent."
            if gmail_ready
            else "Gmail is not configured — add GMAIL_USER and GMAIL_APP_PASSWORD to .env, then restart server."
        ),
        "portal": "student",
        "adminPortalUrl": ADMIN_PORTAL_URL,
    })


from enrollment_curriculum import (
    ENROLLMENT_STRANDS,
    ENROLLMENT_SUBJECTS_DEMO,
    REQUIRED_SUBJECTS_PER_TERM,
    filter_demo_subjects_by_strand,
    format_section_name,
    subjects_for_term,
)


def canonical_section_names(strand_code: str, grade_level: str) -> set[str]:
    strand = str(strand_code or "").upper()
    grade = str(grade_level or "Grade 12")
    if not strand:
        return set()
    return {
        format_section_name(strand, grade, "A").upper(),
        format_section_name(strand, grade, "B").upper(),
    }


def is_canonical_section(section_name: str, strand_code: str, grade_level: str) -> bool:
    name = str(section_name or "").strip().upper()
    if not name:
        return False
    return name in canonical_section_names(strand_code, grade_level)


def filter_offerings_canonical_sections(offerings: list) -> list:
    """Keep only canonical virtue section schedules — drop legacy ICT 11-A rows."""
    filtered: list = []
    for subject in offerings or []:
        if not isinstance(subject, dict):
            continue
        strand = str(subject.get("strandCode") or subject.get("strand") or "").upper()
        grade = str(subject.get("gradeLevel") or "Grade 12")
        schedules = [
            row for row in (subject.get("schedules") or [])
            if isinstance(row, dict)
            and is_canonical_section(row.get("section"), strand, grade)
        ]
        if not schedules:
            continue
        filtered.append({**subject, "schedules": schedules})
    return filtered


def rpc_function_missing(error_text: str) -> bool:
    return "PGRST202" in (error_text or "") or "get_admission_offerings" in (error_text or "")


def subject_offering_type(subject: dict) -> str:
    code = str(subject.get("code") or "")
    if subject.get("strand_id") is None and code.startswith("G") and "-A" in code:
        return "applied"
    if subject.get("strand_id") is None:
        return "core"
    return "specialized"


def fetch_admission_offerings_rest(
    strand_code: str,
    grade_level: str,
    semester_code: str = "1st",
) -> tuple[list[dict], str | None]:
    """Load admission offerings via REST when get_admission_offerings RPC is not deployed."""
    strand_code = strand_code.strip().upper()
    grade_level = grade_level.strip()
    semester_code = (semester_code or "1st").strip()

    strands, err = supabase_rest_get(
        "strands",
        f"code=eq.{quote(strand_code)}&select=id,code&limit=1",
        use_secret=True,
        timeout=12,
    )
    if err:
        return [], err
    if not strands:
        return [], None

    strand_id = strands[0]["id"]
    strand_label = strands[0].get("code") or strand_code

    semesters, err = supabase_rest_get(
        "semesters",
        "is_current=eq.true&select=id,code&limit=1",
        use_secret=True,
        timeout=12,
    )
    if err:
        return [], err
    if not semesters:
        return [], "No active semester configured in Supabase."

    semester_id = semesters[0]["id"]

    sections, err = supabase_rest_get(
        "sections",
        (
            f"strand_id=eq.{strand_id}"
            f"&grade_level=eq.{quote(grade_level)}"
            "&select=id,name"
        ),
        use_secret=True,
        timeout=12,
    )
    if err:
        return [], err

    section_ids = [row["id"] for row in (sections or []) if row.get("id")]
    section_names = {row["id"]: row.get("name") or "" for row in (sections or [])}
    if not section_ids:
        return [], None

    section_filter = ",".join(section_ids)
    schedules, err = supabase_rest_get(
        "class_schedules",
        (
            f"semester_id=eq.{semester_id}"
            f"&section_id=in.({section_filter})"
            "&is_active=eq.true"
            "&select=id,subject_id,section_id,schedule_label,max_slots,enrolled_count"
        ),
        use_secret=True,
        timeout=15,
    )
    if err:
        return [], err

    schedules_by_subject: dict[str, list[dict]] = {}
    for row in schedules or []:
        subject_id = row.get("subject_id")
        section_id = row.get("section_id")
        if not subject_id or not section_id:
            continue
        max_slots = int(row.get("max_slots") or 40)
        enrolled = int(row.get("enrolled_count") or 0)
        schedules_by_subject.setdefault(subject_id, []).append({
            "id": row.get("id"),
            "slots": max(max_slots - enrolled, 0),
            "section": section_names.get(section_id, ""),
            "dayTime": row.get("schedule_label") or "TBA",
        })

    if not schedules_by_subject:
        return [], None

    subjects, err = supabase_rest_get(
        "subjects",
        (
            f"grade_level=eq.{quote(grade_level)}"
            "&is_active=eq.true"
            "&select=id,code,name,lec_hours,lab_hours,units,semester_code,strand_id,strands(code)"
        ),
        use_secret=True,
        timeout=15,
    )
    if err:
        return [], err

    offerings: list[dict] = []
    for subject in subjects or []:
        subject_id = subject.get("id")
        code = str(subject.get("code") or "")
        if not subject_id or not re.match(r"^(G11|G12)-", code):
            continue
        if subject_id not in schedules_by_subject:
            continue

        sub_strand_id = subject.get("strand_id")
        sub_semester = subject.get("semester_code")
        if not sub_semester or sub_semester != semester_code:
            continue
        if sub_strand_id not in (None, strand_id):
            continue

        strand_meta = subject.get("strands") or {}
        offerings.append({
            "code": subject.get("code"),
            "description": subject.get("name"),
            "lec": subject.get("lec_hours"),
            "lab": subject.get("lab_hours"),
            "units": subject.get("units"),
            "gradeLevel": grade_level,
            "semester": sub_semester or semester_code,
            "type": subject_offering_type(subject),
            "strandCode": strand_meta.get("code") if isinstance(strand_meta, dict) else strand_label,
            "schedules": sorted(
                schedules_by_subject[subject_id],
                key=lambda item: (item.get("section") or "", item.get("dayTime") or ""),
            ),
        })

    offerings.sort(key=lambda item: item.get("code") or "")
    return filter_offerings_canonical_sections(offerings), None


def load_admission_offerings(
    strand_code: str,
    grade_level: str,
    semester_code: str = "1st",
) -> tuple[list[dict], str, str | None]:
    """Try Supabase RPC first, then REST fallback."""
    strand_code = strand_code.strip().upper()
    grade_level = grade_level.strip()
    semester_code = (semester_code or "1st").strip()

    result, error = supabase_rpc("get_admission_offerings", {
        "p_strand_code": strand_code,
        "p_grade_level": grade_level,
        "p_semester_code": semester_code,
        }, timeout=20)

    if not error and isinstance(result, list) and result:
        return filter_offerings_canonical_sections(result), "supabase", None

    rest_offerings, rest_error = fetch_admission_offerings_rest(
        strand_code,
        grade_level,
        semester_code,
    )
    if rest_offerings:
        return rest_offerings, "supabase_rest", None

    if error and not rpc_function_missing(error):
        return [], "failed", error
    if rest_error:
        return [], "failed", rest_error
        if error:
        return [], "failed", error
    return [], "failed", None


def handle_admission_offerings(handler):
    query = handler.path.split("?", 1)[1] if "?" in handler.path else ""
    strand_code = "ICT"
    grade_level = "Grade 11"
    semester_code = "1st"
    for part in query.split("&"):
        if part.startswith("strandCode="):
            strand_code = unquote(part.split("=", 1)[1])
        elif part.startswith("gradeLevel="):
            grade_level = unquote(part.split("=", 1)[1])
        elif part.startswith("semesterCode="):
            semester_code = unquote(part.split("=", 1)[1])

    if not supabase_configured():
        json_response(handler, 503, {
            "success": False,
            "error": "Database is not configured. Set SUPABASE_URL and keys in .env.",
            "hint": (
                "Copy .env from your main PC into ENROLLSYSTEM/.env (see .env.example), "
                "then run python server.py on this laptop — do not open enroll.html as a file."
            ),
        })
        return

    offerings, source, load_error = load_admission_offerings(
        strand_code,
        grade_level,
        semester_code.strip() or "1st",
    )

    if load_error and not offerings:
        json_response(handler, 500, {
            "success": False,
            "error": "Failed to load admission schedules from Supabase.",
            "details": parse_supabase_error(load_error),
            "hint": "Restart the student server (python server.py) and hard-refresh the page (Ctrl+Shift+R).",
        })
        return

    if not offerings:
        json_response(handler, 404, {
            "success": False,
            "error": "No published schedules found for this strand and grade.",
            "hint": "Admin must Apply + Publish AI schedules in Auto Schedule for the same grade level (e.g. Grade 11 for Grade 11 applicants).",
        })
        return

    json_response(handler, 200, {
        "success": True,
        "data": offerings,
        "source": source,
    })


def handle_enrollment_offerings(handler):
    query = handler.path.split("?", 1)[1] if "?" in handler.path else ""
    student_id = ""
    strand_code = "STEM"
    grade_level = "Grade 12"
    semester_code = "1st"
    for part in query.split("&"):
        if part.startswith("studentId="):
            student_id = unquote(part.split("=", 1)[1])
        elif part.startswith("strandCode="):
            strand_code = unquote(part.split("=", 1)[1])
        elif part.startswith("gradeLevel="):
            grade_level = unquote(part.split("=", 1)[1])
        elif part.startswith("semesterCode="):
            semester_code = unquote(part.split("=", 1)[1])

    if not student_id:
        json_response(handler, 400, {"success": False, "error": "studentId is required"})
        return

    if supabase_configured():
        result, error = supabase_rpc("get_enrollment_offerings", {
            "p_student_id": student_id.strip().upper(),
        }, timeout=10)
        if error:
            json_response(handler, 500, {
                "success": False,
                "error": "Failed to load subject offerings from Supabase.",
                "details": parse_supabase_error(error),
            })
            return
        offerings = filter_offerings_canonical_sections(
            result if isinstance(result, list) else []
        )
        json_response(handler, 200, {
            "success": True,
            "data": offerings,
            "source": "supabase",
        })
        return

    json_response(handler, 503, {
        "success": False,
        "error": "Supabase is not configured. Local demo schedules are disabled.",
    })


def decode_data_url_image(data_url):
    if not data_url or not isinstance(data_url, str):
        return None, None
    match = re.match(r"^data:(image/[\w+.-]+);base64,(.+)$", data_url.strip(), re.I | re.S)
    if not match:
        return None, None
    mime = match.group(1).lower()
    ext = "jpg" if "jpeg" in mime else "png" if "png" in mime else "webp" if "webp" in mime else "jpg"
    try:
        return base64.b64decode(match.group(2)), ext
    except (ValueError, TypeError):
        return None, None


def handle_enrollment_photos_get(handler):
    query = handler.path.split("?", 1)[-1] if "?" in handler.path else ""
    student_id = None
    for part in query.split("&"):
        if part.startswith("studentId="):
            student_id = unquote(part.split("=", 1)[1]).strip().upper()
    if not student_id:
        json_response(handler, 400, {"success": False, "error": "studentId required"})
        return

    if supabase_configured():
        result, error = supabase_rpc("get_student_enrollment_photos", {
            "p_student_id": student_id,
        }, timeout=10)
        if error:
            json_response(handler, 500, {"success": False, "error": friendly_user_error(parse_supabase_error(error))})
            return
        data = result or {}
        for key in ("uploadPath", "cameraPath"):
            path = data.get(key)
            if path:
                data[key.replace("Path", "Url")] = public_enrollment_photo_url(SUPABASE_URL, path)
        json_response(handler, 200, {"success": True, "data": data})
        return

    json_response(handler, 200, {"success": True, "data": {"uploadDone": False, "cameraDone": False, "photosReady": False}})


def handle_enrollment_photos_save(handler):
    try:
        body = read_json_body(handler)
    except json.JSONDecodeError:
        json_response(handler, 400, {"success": False, "error": "Invalid request body"})
        return

    student_id = (body.get("studentId") or "").strip().upper()
    photo_type = (body.get("photoType") or body.get("type") or "").strip().lower()
    data_url = body.get("dataUrl") or body.get("image")

    if not student_id or photo_type not in ("upload", "camera"):
        json_response(handler, 400, {"success": False, "error": "studentId and photoType (upload|camera) are required"})
        return

    content, ext = decode_data_url_image(data_url)
    if not content:
        json_response(handler, 400, {"success": False, "error": "Invalid image data"})
        return

    if not supabase_configured():
        json_response(handler, 503, {"success": False, "error": "Supabase is not configured"})
        return

    filename = f"{photo_type}_{datetime.now().strftime('%Y%m%d%H%M%S')}.{ext}"
    object_path, upload_error = upload_enrollment_photo(
        SUPABASE_URL, SUPABASE_SECRET_KEY, student_id, photo_type, filename, content,
    )
    if upload_error or not object_path:
        json_response(handler, 500, {"success": False, "error": upload_error or "Failed to upload photo"})
        return

    result, error = supabase_rpc("save_student_enrollment_photos", {
        "p_student_id": student_id,
        "p_photo_type": photo_type,
        "p_object_path": object_path,
    }, timeout=10)
    if error:
        json_response(handler, 500, {"success": False, "error": friendly_user_error(parse_supabase_error(error))})
        return

    data = result or {}
    for key in ("uploadPath", "cameraPath"):
        path = data.get(key)
        if path:
            data[key.replace("Path", "Url")] = public_enrollment_photo_url(SUPABASE_URL, path)
    json_response(handler, 200, {"success": True, "data": data})


def fetch_student_strand_code(student_id: str) -> tuple[str, str, str | None]:
    rows, err = supabase_rest_get(
        "students",
        f"student_id=eq.{quote(student_id)}&select=id,grade_level,strands(code)",
        use_secret=True,
        timeout=10,
    )
    if err or not rows:
        return "STEM", "Grade 11", None
    row = rows[0]
    strand = "STEM"
    strands = row.get("strands")
    if isinstance(strands, dict):
        strand = str(strands.get("code") or "STEM").upper()
    return strand, str(row.get("grade_level") or "Grade 11"), row.get("id")


def enrollment_matches_current_term(
    strand_code: str,
    grade_level: str,
    semester_code: str,
    enrollment_subjects: list,
) -> bool:
    if not enrollment_subjects:
        return False
    allowed = {item["code"] for item in subjects_for_term(strand_code, grade_level, semester_code)}
    codes = [str(subj.get("code") or "").strip() for subj in enrollment_subjects if subj.get("code")]
    if not codes:
        return False
    return all(code in allowed for code in codes)


def _term_semester_code(term: dict) -> str:
    code = str(term.get("semesterCode") or "").strip().lower()
    if code in ("1st", "2nd"):
        return code
    name = str(term.get("semester") or "").lower()
    if "second" in name or "2nd" in name:
        return "2nd"
    return "1st"


def _find_matching_semester(strand_code: str, grade_level: str, subjects: list) -> str | None:
    for sem_code in ("1st", "2nd"):
        if enrollment_matches_current_term(strand_code, grade_level, sem_code, subjects):
            return sem_code
    return None


def adjust_student_grades_payload(student_id: str, payload: dict) -> dict:
    if not isinstance(payload, dict):
        return payload

    terms = payload.get("terms") or []
    if isinstance(terms, str):
        try:
            terms = json.loads(terms)
        except json.JSONDecodeError:
            terms = []

    access, _ = supabase_rpc("get_student_enrollment_access", {"p_student_id": student_id}, timeout=10)
    current_sem = str((access or {}).get("semesterCode") or "1st")
    strand, grade, _ = fetch_student_strand_code(student_id)

    past_terms = []
    current_term = None
    for term in terms:
        if not isinstance(term, dict):
            continue
        sem_code = _term_semester_code(term)
        subjects = term.get("subjects") or []
        if not subjects:
            continue

        if sem_code == current_sem:
            if enrollment_matches_current_term(strand, grade, sem_code, subjects):
                current_term = term
                continue
            matched_sem = _find_matching_semester(strand, grade, subjects)
            if matched_sem and matched_sem != current_sem:
                past_terms.append({
                    **term,
                    "semesterCode": matched_sem,
                    "semester": "First Semester" if matched_sem == "1st" else "Second Semester",
                })
                continue
            # One extra subject outside the catalog must not hide the whole term.
            current_term = term
            continue

        past_terms.append(term)

    valid_terms = past_terms[:]
    if current_term:
        valid_terms.append(current_term)

    status = payload.get("enrollmentStatus") or "none"
    not_enrolled_message = (
        "You have not enrolled for this semester yet. Go to Enrollment to select your subjects."
    )

    if current_term:
        return {**payload, "terms": valid_terms, "enrollmentStatus": status}

    if past_terms:
        return {
            "enrollmentStatus": "past_only",
            "message": not_enrolled_message,
            "terms": past_terms,
        }

    if status in ("enrolled", "approved", "pending"):
        return {
            "enrollmentStatus": "none",
            "message": not_enrolled_message,
            "terms": [],
        }

    return {**payload, "terms": valid_terms}


def adjust_enrollment_access_for_invalid_record(student_id: str, access: dict) -> dict:
    if not access or access.get("canEnroll"):
        return access or {}
    status = access.get("currentEnrollmentStatus")
    if status not in ("pending", "approved", "enrolled"):
        return access
    enrollment, err = supabase_rpc("get_student_enrollment", {"p_student_id": student_id}, timeout=10)
    if err or not enrollment or not enrollment.get("subjects"):
        return access
    strand, grade, _ = fetch_student_strand_code(student_id)
    sem_code = str(access.get("semesterCode") or "1st")
    subjects = enrollment.get("subjects") or []
    if enrollment_matches_current_term(strand, grade, sem_code, subjects):
        return access
    matched_sem = _find_matching_semester(strand, grade, subjects)
    if not matched_sem or matched_sem == sem_code:
        return access
    sem_name = access.get("semesterName") or ("2nd Semester" if sem_code == "2nd" else "1st Semester")
    return {
        **access,
        "canEnroll": True,
        "invalidPreviousEnrollment": True,
        "currentEnrollmentStatus": None,
        "reason": f"You may enroll for {sem_name} ({grade}).",
    }


def delete_pending_enrollment_record(enrollment_id: str) -> str | None:
    if not enrollment_id or not supabase_configured():
        return None
    eid = quote(str(enrollment_id))
    _, err = supabase_rest_delete("enrollment_payments", f"enrollment_id=eq.{eid}")
    if err:
        print(f"[Enrollment rollback] payment delete: {err}")
    _, err = supabase_rest_delete("enrollment_subjects", f"enrollment_id=eq.{eid}")
    if err:
        return err
    _, err = supabase_rest_delete("enrollments", f"id=eq.{eid}")
    return err


def clear_invalid_current_enrollment(student_id: str) -> str | None:
    access, err = supabase_rpc("get_student_enrollment_access", {"p_student_id": student_id}, timeout=10)
    if err:
        return err
    access = adjust_enrollment_access_for_invalid_record(student_id, access or {})
    if not access.get("invalidPreviousEnrollment"):
        return None
    _, _, student_uuid = fetch_student_strand_code(student_id)
    if not student_uuid:
        return "Student not found"
    sem_rows, err = supabase_rest_get(
        "semesters",
        "is_current=eq.true&select=id",
        use_secret=True,
        timeout=10,
    )
    if err or not sem_rows:
        return err or "No active semester configured"
    semester_id = sem_rows[0]["id"]
    enroll_rows, err = supabase_rest_get(
        "enrollments",
        f"student_id=eq.{quote(str(student_uuid))}&semester_id=eq.{quote(str(semester_id))}&select=id",
        use_secret=True,
        timeout=10,
    )
    if err or not enroll_rows:
        return err
    enrollment_id = enroll_rows[0]["id"]
    _, err = supabase_rest_delete(
        "enrollment_subjects",
        f"enrollment_id=eq.{quote(str(enrollment_id))}",
    )
    if err:
        return err
    _, err = supabase_rest_delete(
        "enrollments",
        f"id=eq.{quote(str(enrollment_id))}",
    )
    return err


LIFECYCLE_STAGES = [
    ("g11_1st", "Grade 11", "1st", "Grade 11 — 1st Semester"),
    ("g11_2nd", "Grade 11", "2nd", "Grade 11 — 2nd Semester"),
    ("g12_1st", "Grade 12", "1st", "Grade 12 — 1st Semester"),
    ("g12_2nd", "Grade 12", "2nd", "Grade 12 — 2nd Semester"),
]


def _lifecycle_stage_matches(stage_key: str, grade_level: str, semester_code: str) -> bool:
    for key, grade, sem, _ in LIFECYCLE_STAGES:
        if key == stage_key:
            return grade == grade_level and sem == semester_code
    return False


def _payment_status_via_student_rpc(student_uuid: str, enrollment_id: str) -> str | None:
    """enrollment_payments is not readable by the API key; the payment RPC is."""
    rows, err = supabase_rest_get(
        "students",
        f"id=eq.{quote(str(student_uuid))}&select=student_id&limit=1",
        use_secret=True,
        timeout=10,
    )
    if err or not rows or not rows[0].get("student_id"):
        return None
    result, rpc_err = supabase_rpc(
        "get_student_payment_status",
        {"p_student_id": rows[0]["student_id"]},
        timeout=15,
    )
    if rpc_err or not isinstance(result, dict):
        return None
    for payment in result.get("payments") or []:
        if str(payment.get("enrollmentId") or "") == str(enrollment_id):
            return payment.get("status") or None
    return None


def _fetch_stage_enrollment_rest(student_uuid: str, grade_level: str, semester_code: str) -> dict | None:
    enroll_rows, err = supabase_rest_get(
        "enrollments",
        (
            f"student_id=eq.{quote(str(student_uuid))}"
            f"&select=id,status,created_at,semester_id,semesters(code)"
            f"&order=created_at.desc"
        ),
        use_secret=True,
        timeout=12,
    )
    if err or not enroll_rows:
        return None

    status_rank = {"enrolled": 0, "approved": 1, "pending": 2, "rejected": 9}
    candidates = []
    for row in enroll_rows:
        sem = row.get("semesters") or {}
        if str(sem.get("code") or "") != semester_code:
            continue
        enrollment_id = row.get("id")
        if not enrollment_id:
            continue
        es_rows, _ = supabase_rest_get(
            "enrollment_subjects",
            (
                f"enrollment_id=eq.{quote(str(enrollment_id))}"
                "&select=id,subjects(grade_level),student_grades(final_grade,grade_status)"
            ),
            use_secret=True,
            timeout=12,
        )
        if not es_rows:
            continue
        if not any(
            (es.get("subjects") or {}).get("grade_level") == grade_level
            for es in es_rows
        ):
            continue
        total = len(es_rows)
        graded = 0
        failed = 0
        for es in es_rows:
            grades = es.get("student_grades")
            if isinstance(grades, list):
                grade_row = grades[0] if grades else {}
            elif isinstance(grades, dict):
                grade_row = grades
            else:
                grade_row = {}
            final_grade = grade_row.get("final_grade")
            grade_status = grade_row.get("grade_status")
            if final_grade is not None and grade_status not in (None, "incomplete"):
                graded += 1
            if grade_status == "failed":
                failed += 1
        pay_rows, pay_err = supabase_rest_get(
            "enrollment_payments",
            f"enrollment_id=eq.{quote(str(enrollment_id))}&select=status",
            use_secret=True,
            timeout=10,
        )
        if pay_rows:
            payment_status = pay_rows[0].get("status") or "unpaid"
        elif pay_err:
            payment_status = _payment_status_via_student_rpc(student_uuid, enrollment_id) or "unpaid"
        else:
            payment_status = "unpaid"
        candidates.append({
            "enrollment_id": enrollment_id,
            "enrollment_status": row.get("status"),
            "payment_status": payment_status,
            "total_subjects": total,
            "graded_subjects": graded,
            "failed_subjects": failed,
            "rank": status_rank.get(str(row.get("status") or ""), 5),
        })

    if not candidates:
        return None
    candidates.sort(key=lambda item: item["rank"])
    return candidates[0]


def _is_stage_complete_rest(student_uuid: str, grade_level: str, semester_code: str) -> bool:
    row = _fetch_stage_enrollment_rest(student_uuid, grade_level, semester_code)
    if not row:
        return False
    if row.get("enrollment_status") != "enrolled":
        return False
    if row.get("payment_status") != "approved":
        return False
    total = int(row.get("total_subjects") or 0)
    graded = int(row.get("graded_subjects") or 0)
    failed = int(row.get("failed_subjects") or 0)
    return total > 0 and graded >= total and failed == 0


def _student_has_g11_history_rest(student_uuid: str) -> bool:
    rows, err = supabase_rest_get(
        "students",
        f"id=eq.{quote(str(student_uuid))}&select=grade11_completed",
        use_secret=True,
        timeout=10,
    )
    if not err and rows and rows[0].get("grade11_completed"):
        return True
    return (
        _fetch_stage_enrollment_rest(student_uuid, "Grade 11", "1st") is not None
        or _fetch_stage_enrollment_rest(student_uuid, "Grade 11", "2nd") is not None
    )


def get_lifecycle_state_rest(student_id: str) -> dict:
    rows, err = supabase_rest_get(
        "students",
        f"student_id=eq.{quote(student_id)}&select=id,grade_level,progression_status",
        use_secret=True,
        timeout=10,
    )
    if err or not rows:
        return {
            "found": False,
            "lifecycleStage": None,
            "nextStage": "g11_1st",
            "nextStageLabel": "Grade 11 — 1st Semester",
            "completedStages": [],
            "isCompleted": False,
        }

    student_uuid = rows[0]["id"]
    progression = str(rows[0].get("progression_status") or "in_progress")
    grade_level = str(rows[0].get("grade_level") or "Grade 11")
    direct_g12 = grade_level == "Grade 12" and not _student_has_g11_history_rest(student_uuid)
    applicable_stages = LIFECYCLE_STAGES[2:] if direct_g12 else LIFECYCLE_STAGES
    required_count = len(applicable_stages)

    if progression == "graduated":
        return {
            "found": True,
            "lifecycleStage": "completed",
            "nextStage": None,
            "nextStageLabel": "Grade 12 — 2nd Semester Completed",
            "completedStages": [s[0] for s in LIFECYCLE_STAGES],
            "isCompleted": True,
            "progressionStatus": progression,
            "gradeLevel": grade_level,
        }

    completed = []
    next_stage = None
    next_label = None
    blocked_reason = None

    for idx, (stage_key, stage_grade, stage_sem, stage_label) in enumerate(applicable_stages):
        if _is_stage_complete_rest(student_uuid, stage_grade, stage_sem):
            completed.append(stage_key)
            continue

        row = _fetch_stage_enrollment_rest(student_uuid, stage_grade, stage_sem)
        next_stage = stage_key
        next_label = stage_label

        if row is None:
            if stage_key.startswith("g12_") and progression == "retained_g11" and not direct_g12:
                blocked_reason = (
                    "You have unresolved failing grades in Grade 11. "
                    "Grade 12 enrollment is not available. Please contact the registrar."
                )
                next_stage = None
            elif idx > 0:
                prev = applicable_stages[idx - 1]
                if not _is_stage_complete_rest(student_uuid, prev[1], prev[2]):
                    blocked_reason = (
                        f"Complete {prev[3]} (enrollment, payment approval, and grades) "
                        f"before enrolling in {stage_label}."
                    )
            break

        status = row.get("enrollment_status")
        if status in ("pending", "approved"):
            blocked_reason = f"Your {stage_label} enrollment is pending approval. Please wait for the administrator."
            break
        if status == "enrolled" and row.get("payment_status") != "approved":
            blocked_reason = (
                f"Complete payment approval for {stage_label} before proceeding. Go to Payment / Accounts."
            )
            break
        if status == "enrolled" and int(row.get("graded_subjects") or 0) < int(row.get("total_subjects") or 0):
            blocked_reason = (
                f"Your {stage_label} grades are not complete yet. "
                "Enrollment for the next term unlocks after grades are posted."
            )
            break
        if status == "enrolled" and int(row.get("failed_subjects") or 0) > 0:
            blocked_reason = (
                f"You have failing grades in {stage_label}. Please contact the registrar before enrolling in the next term."
            )
            break
        break

    if next_stage is None and len(completed) >= required_count:
        return {
            "found": True,
            "lifecycleStage": "completed",
            "nextStage": None,
            "nextStageLabel": "Grade 12 — 2nd Semester Completed",
            "completedStages": completed,
            "isCompleted": True,
            "progressionStatus": "graduated",
            "gradeLevel": grade_level,
        }

    return {
        "found": True,
        "lifecycleStage": next_stage or LIFECYCLE_STAGES[-1][0],
        "nextStage": next_stage,
        "nextStageLabel": next_label or LIFECYCLE_STAGES[-1][3],
        "completedStages": completed,
        "isCompleted": False,
        "blockedReason": blocked_reason,
        "progressionStatus": progression,
        "gradeLevel": grade_level,
    }


def _current_enrollment_payment_status(student_uuid, grade_level, semester_code, current_status):
    if current_status != "enrolled":
        return None
    stage = _fetch_stage_enrollment_rest(student_uuid, grade_level, semester_code)
    if not stage:
        return None
    return stage.get("payment_status")


def fetch_enrollment_access_rest(student_id: str) -> dict:
    lifecycle = get_lifecycle_state_rest(student_id)
    rows, err = supabase_rest_get(
        "students",
        f"student_id=eq.{quote(student_id)}&select=id,grade_level,account_status,progression_status",
        use_secret=True,
        timeout=10,
    )
    if err or not rows:
        return {"canEnroll": False, "reason": "Student not found."}

    student = rows[0]
    student_uuid = student["id"]
    grade_level = str(student.get("grade_level") or "Grade 11")
    account_status = str(student.get("account_status") or "active")
    progression = str(student.get("progression_status") or "in_progress")

    sem_rows, _ = supabase_rest_get(
        "semesters",
        "is_current=eq.true&select=name,code,enrollment_open,target_grade_level",
        use_secret=True,
        timeout=10,
    )
    sem = sem_rows[0] if sem_rows else {}
    semester_name = sem.get("name") or "this term"
    semester_code = str(sem.get("code") or "1st")
    enrollment_open = bool(sem.get("enrollment_open"))
    target_grade = sem.get("target_grade_level")

    current_rows, _ = supabase_rest_get(
        "enrollments",
        (
            f"student_id=eq.{quote(str(student_uuid))}"
            f"&select=status,semesters!inner(is_current)"
            f"&semesters.is_current=eq.true"
            f"&order=created_at.desc&limit=1"
        ),
        use_secret=True,
        timeout=10,
    )
    current_status = current_rows[0].get("status") if current_rows else None
    next_semester = "2nd Semester" if semester_code == "1st" else "the next school year (1st Semester)"
    next_stage = lifecycle.get("nextStage")

    stage_grade = grade_level
    stage_sem = semester_code
    if next_stage:
        for key, grade, sem, _ in LIFECYCLE_STAGES:
            if key == next_stage:
                stage_grade = grade
                stage_sem = sem
                break

    can_enroll = False
    reason = ""
    is_completed = bool(lifecycle.get("isCompleted"))
    blocked = lifecycle.get("blockedReason")

    if is_completed or progression == "graduated":
        reason = (
            "You have completed the supported enrollment lifecycle (Grade 12 — 2nd Semester). "
            "No further enrollment is available."
        )
    elif account_status == "frozen":
        reason = "Your account has been frozen due to non-enrollment during the official registration period. Please contact the registrar's office."
    elif account_status == "inactive":
        reason = "Your account is inactive. Please contact the registrar's office."
    elif not enrollment_open:
        reason = f"Enrollment is currently closed for {semester_name}. Please wait for the registrar to open the registration period."
    elif current_status == "rejected":
        current_status = None

    if not reason:
        if current_status in ("pending", "approved"):
            if next_stage and _lifecycle_stage_matches(next_stage, grade_level, semester_code):
                reason = (
                    f"Your {lifecycle.get('nextStageLabel') or semester_name} enrollment is pending approval. "
                    "Please wait for the administrator."
                )
            else:
                reason = (
                    f"You have an enrollment submission for {semester_name} ({grade_level}) "
                    "that must be resolved first. Please contact the registrar."
                )
        elif current_status == "enrolled":
            if _is_stage_complete_rest(student_uuid, grade_level, semester_code):
                reason = (
                    f"You have completed {semester_name} ({grade_level}). "
                    f"Enrollment for {next_semester} will open when the registrar enables it."
                )
            elif blocked:
                reason = blocked
            else:
                reason = f"You are already enrolled for {semester_name} ({grade_level})."
        elif blocked:
            reason = blocked
        elif not next_stage:
            reason = "Enrollment is not available for your current academic stage. Please contact the registrar."
        elif not _lifecycle_stage_matches(next_stage, stage_grade, stage_sem):
            reason = (
                f"Your next enrollment stage is {lifecycle.get('nextStageLabel')}. "
                "The registrar must open that term before you can enroll."
            )
        elif target_grade and target_grade != stage_grade:
            reason = (
                f"Enrollment is open for {target_grade} only. "
                f"Your next required stage is {lifecycle.get('nextStageLabel')}."
            )
        elif semester_code != stage_sem:
            reason = (
                f"Enrollment is open for {semester_name}. "
                f"Your next required stage is {lifecycle.get('nextStageLabel')}."
            )
        elif progression == "retained_g11" and str(next_stage).startswith("g12_"):
            reason = (
                "You have unresolved failing grades in Grade 11. "
                "Grade 12 enrollment is not available until requirements are fulfilled. Please contact the registrar."
            )
        elif (
            str(next_stage).startswith("g12_")
            and progression not in ("eligible_g12", "graduated")
            and grade_level != "Grade 12"
            and not _is_stage_complete_rest(student_uuid, "Grade 11", "2nd")
        ):
            reason = (
                f"Complete Grade 11 — 2nd Semester and become eligible for Grade 12 "
                f"before enrolling in {lifecycle.get('nextStageLabel')}."
            )
        elif target_grade and target_grade != stage_grade and not (
            progression == "eligible_g12" and str(next_stage).startswith("g12_")
        ):
            reason = f"Enrollment is open for {target_grade} only. Your next stage is {lifecycle.get('nextStageLabel')}."
        else:
            can_enroll = True
            reason = f"You may enroll for {lifecycle.get('nextStageLabel')}."

    return {
        "canEnroll": can_enroll,
        "reason": reason,
        "enrollmentOpen": enrollment_open,
        "accountStatus": account_status,
        "progressionStatus": progression,
        "gradeLevel": grade_level,
        "targetGradeLevel": target_grade,
        "currentEnrollmentStatus": current_status,
        "semesterName": semester_name,
        "semesterCode": semester_code,
        "nextSemesterLabel": next_semester,
        "lifecycleStage": lifecycle.get("lifecycleStage"),
        "nextStage": lifecycle.get("nextStage"),
        "nextStageLabel": lifecycle.get("nextStageLabel"),
        "completedStages": lifecycle.get("completedStages") or [],
        "isLifecycleCompleted": is_completed,
        "paymentStatus": _current_enrollment_payment_status(student_uuid, grade_level, semester_code, current_status),
    }


def enrich_enrollment_access_with_lifecycle(student_id: str, access: dict) -> dict:
    """Reconcile RPC access with REST lifecycle so Enrollment Period + eligibility stay aligned."""
    if not isinstance(access, dict):
        access = {}
    rest = fetch_enrollment_access_rest(student_id)
    # REST enforces current-term window + stage eligibility (authoritative for canEnroll).
    merged = {**access, **rest}
    if rest.get("blockedReason") or rest.get("reason"):
        merged["reason"] = rest.get("reason") or access.get("reason")
    merged["canEnroll"] = bool(rest.get("canEnroll"))
    return merged


def record_enrollment_payment_at_submit(enrollment_id, payment_fields, gcash_proof_path=None):
    if not supabase_configured() or not enrollment_id:
        return "Supabase not configured"

    mode = str(payment_fields.get("paymentMode") or "cashier").strip().lower()
    if mode not in ("gcash", "cashier", "bank"):
        mode = "cashier"

    try:
        amount_paid = float(payment_fields.get("paymentAmount") or ENROLLMENT_FEE)
    except (TypeError, ValueError):
        amount_paid = ENROLLMENT_FEE

    result, error = supabase_rpc("record_enrollment_payment_submit", {
        "p_enrollment_id": str(enrollment_id),
        "p_payment_mode": mode,
        "p_amount_paid": amount_paid if mode == "gcash" else 0,
        "p_gcash_reference": payment_fields.get("gcashReference") or "",
        "p_gcash_sender_name": payment_fields.get("gcashSenderName") or "",
        "p_gcash_proof_path": gcash_proof_path or "",
    }, timeout=15)

    if error:
        notes_parts = []
        if mode == "gcash":
            ref = str(payment_fields.get("gcashReference") or "").strip()
            sender = str(payment_fields.get("gcashSenderName") or "").strip()
            if ref:
                notes_parts.append(f"GCash Ref: {ref}")
            if sender:
                notes_parts.append(f"Sender: {sender}")
            if gcash_proof_path:
                notes_parts.append(f"Receipt: {gcash_proof_path}")
        payload = {
            "enrollment_id": str(enrollment_id),
            "assessment_amount": ENROLLMENT_FEE,
            "amount_paid": amount_paid if mode == "gcash" else 0,
            "status": "pending" if mode == "gcash" else "unpaid",
            "payment_mode": mode,
            "notes": " · ".join(notes_parts) if notes_parts else None,
        }
        _, rest_error = supabase_rest_upsert("enrollment_payments", payload, "enrollment_id")
        return rest_error or parse_supabase_error(error)

    return None if result else "Payment record was not saved"


def ensure_enrollment_photos_for_submit(student_id: str) -> str | None:
    """Copy admission profile photos to enrollment photos when Steps 1–2 were skipped in the UI."""
    if not supabase_configured():
        return None

    photos, err = supabase_rpc("get_student_enrollment_photos", {
        "p_student_id": student_id,
    }, timeout=10)
    if not err and isinstance(photos, dict) and photos.get("photosReady"):
        return None

    sid = quote(student_id.strip().upper())
    apps, app_err = supabase_rest_get(
        "admission_applications",
        f"student_id_generated=eq.{sid}&status=eq.approved"
        f"&select=profile_photo_upload_path,profile_photo_camera_path,documents"
        f"&order=reviewed_at.desc&limit=1",
        use_secret=True,
        timeout=10,
    )
    if app_err or not apps:
        return None

    app = apps[0]
    docs = app.get("documents") if isinstance(app.get("documents"), dict) else {}
    upload_path = (app.get("profile_photo_upload_path") or docs.get("profile_upload") or "").strip()
    camera_path = (app.get("profile_photo_camera_path") or docs.get("profile_camera") or "").strip()
    if upload_path and not camera_path:
        camera_path = upload_path
    elif camera_path and not upload_path:
        upload_path = camera_path
    if not upload_path or not camera_path:
        return None

    for photo_type, path in (("upload", upload_path), ("camera", camera_path)):
        _, save_err = supabase_rpc("save_student_enrollment_photos", {
            "p_student_id": student_id,
            "p_photo_type": photo_type,
            "p_object_path": path,
        }, timeout=10)
        if save_err:
            return parse_supabase_error(save_err)

    return None


def handle_enrollment_submit(handler):
    parsed = parse_multipart_form(handler)
    files = {}
    payment_fields = {}

    if parsed:
        fields = parsed.get("fields") or {}
        files = parsed.get("files") or {}
        student_id = (fields.get("studentId") or "").strip().upper()
        try:
            subjects = json.loads(fields.get("subjects") or "[]")
        except json.JSONDecodeError:
            json_response(handler, 400, {"success": False, "error": "Invalid subjects payload"})
            return
        payment_fields = {
            "paymentMode": (fields.get("paymentMode") or "cashier").strip().lower(),
            "gcashReference": (fields.get("gcashReference") or "").strip(),
            "gcashSenderName": (fields.get("gcashSenderName") or "").strip(),
            "paymentAmount": (fields.get("paymentAmount") or str(ENROLLMENT_FEE)).strip(),
        }
    else:
    try:
        body = read_json_body(handler)
    except json.JSONDecodeError:
        json_response(handler, 400, {"success": False, "error": "Invalid request body"})
        return

    student_id = (body.get("studentId") or "").strip().upper()
    subjects = body.get("subjects") or []
        payment_fields = {
            "paymentMode": (body.get("paymentMode") or "cashier").strip().lower(),
            "gcashReference": (body.get("gcashReference") or "").strip(),
            "gcashSenderName": (body.get("gcashSenderName") or "").strip(),
            "paymentAmount": str(body.get("paymentAmount") or ENROLLMENT_FEE).strip(),
        }

    if not student_id:
        json_response(handler, 400, {"success": False, "error": "studentId is required"})
        return
    if not isinstance(subjects, list) or not subjects:
        json_response(handler, 400, {"success": False, "error": "Select at least one subject"})
        return

    payment_mode = payment_fields.get("paymentMode") or "cashier"
    if payment_mode == "gcash":
        if not payment_fields.get("gcashReference"):
            json_response(handler, 400, {"success": False, "error": "GCash reference number is required."})
            return
        if not payment_fields.get("gcashSenderName"):
            json_response(handler, 400, {"success": False, "error": "GCash sender name is required."})
            return
        if not payment_fields.get("paymentAmount"):
            json_response(handler, 400, {"success": False, "error": "Payment amount is required."})
            return
        if "gcash_proof" not in files:
            json_response(handler, 400, {"success": False, "error": "Please upload your GCash payment receipt."})
            return
        file_error = validate_admission_files(files, payment_mode=payment_mode)
        if file_error:
            json_response(handler, 400, {"success": False, "error": file_error})
        return

    if supabase_configured():
        access = fetch_enrollment_access_rest(student_id)
        access = adjust_enrollment_access_for_invalid_record(student_id, access)
        if not access.get("canEnroll"):
            json_response(handler, 400, {
                "success": False,
                "error": access.get("reason") or "Enrollment is not available for your current stage.",
            })
            return
        clear_error = clear_invalid_current_enrollment(student_id)
        if clear_error:
            json_response(handler, 500, {"success": False, "error": friendly_user_error(clear_error)})
            return
        photo_error = ensure_enrollment_photos_for_submit(student_id)
        if photo_error:
            json_response(handler, 500, {"success": False, "error": friendly_user_error(photo_error)})
            return
        result, error = supabase_rpc("submit_student_enrollment", {
            "p_student_id": student_id,
            "p_subjects": subjects,
        }, timeout=15)
        if error:
            err_text = friendly_user_error(
                parse_supabase_error(error),
                "Enrollment could not be submitted. Please try again or contact the registrar office.",
            )
            hint = None
            raw = (parse_supabase_error(error) or "").lower()
            if any(token in raw for token in ("strand", "subject", "schedule", "enrollment is")):
                hint = "You can only enroll in core subjects and subjects for your assigned strand."
            elif "invalid schedule" in raw:
                hint = "The selected schedule is no longer available. Refresh the page and choose again."
            payload = {"success": False, "error": err_text}
            if hint:
                payload["hint"] = hint
            json_response(handler, 400, payload)
            return

        enrollment_id = (result or {}).get("enrollmentId")
        gcash_proof_path = None
        if enrollment_id and payment_mode == "gcash" and files.get("gcash_proof"):
            proof_file = files["gcash_proof"]
            if supabase_configured() and SUPABASE_SECRET_KEY:
                object_path, upload_error = upload_admission_document(
                    SUPABASE_URL,
                    SUPABASE_SECRET_KEY,
                    str(enrollment_id),
                    "gcash_proof",
                    proof_file.get("filename") or "gcash_receipt.jpg",
                    proof_file.get("content") or b"",
                )
                if object_path:
                    gcash_proof_path = object_path
                elif upload_error:
                    print(f"[Enrollment GCash upload] {upload_error}")
            if not gcash_proof_path:
                doc_paths = save_uploaded_files(str(enrollment_id), {"gcash_proof": proof_file})
                gcash_proof_path = doc_paths.get("gcash_proof")

        if enrollment_id:
            pay_error = record_enrollment_payment_at_submit(enrollment_id, payment_fields, gcash_proof_path)
            if pay_error:
                print(f"[Enrollment payment record] {pay_error}")
                delete_pending_enrollment_record(enrollment_id)
                json_response(handler, 500, {
                "success": False,
                    "error": "Enrollment could not be completed because payment details were not saved. Please try again. If this continues, run enrollment-payment-submit.sql in Supabase.",
                    "enrollmentId": enrollment_id,
            })
            return

        dispatch_subject_enrollment_email(
            student_id,
            total_units=(result or {}).get("totalUnits"),
        )
        json_response(handler, 200, {"success": True, **(result or {})})
        return

    json_response(handler, 503, {
        "success": False,
        "error": "Enrollment is temporarily unavailable. Please try again later or contact the registrar office.",
    })


def handle_enrollment_access(handler):
    query = handler.path.split("?", 1)[-1] if "?" in handler.path else ""
    student_id = None
    for part in query.split("&"):
        if part.startswith("studentId="):
            student_id = unquote(part.split("=", 1)[1]).strip().upper()
    if not student_id:
        json_response(handler, 400, {"success": False, "error": "studentId required"})
        return
    if supabase_configured():
        # Authoritative path: Enrollment Period (open term) + lifecycle eligibility.
        data = fetch_enrollment_access_rest(student_id)
        data = adjust_enrollment_access_for_invalid_record(student_id, data)
        json_response(handler, 200, {"success": True, "data": data})
        return
    json_response(handler, 200, {"success": True, "data": {"canEnroll": True, "enrollmentOpen": True}})


def _load_old_student_row(student_id: str):
    sid = quote((student_id or "").strip().upper())
    rows, error = supabase_rest_get(
        "students",
        (
            f"student_id=eq.{sid}"
            "&select=id,student_id,last_name,first_name,middle_name,birthdate,gender,"
            "address,contact_number,grade_level,track,admission_type,admission_status,"
            "scholastic_status,account_status,progression_status,grade11_completed,"
            "voucher_qualified,strands(code,name),sections(name)"
            "&limit=1"
        ),
        use_secret=True,
        timeout=12,
    )
    if error or not rows:
        return None, error
    return rows[0], None


def _load_old_student_email(student_id: str) -> str:
    sid = quote((student_id or "").strip().upper())
    apps, _ = supabase_rest_get(
        "admission_applications",
        (
            f"student_id_generated=eq.{sid}"
            "&select=email&order=reviewed_at.desc.nullslast,created_at.desc&limit=1"
        ),
        use_secret=True,
        timeout=10,
    )
    if apps and isinstance(apps, list):
        return (apps[0].get("email") or "").strip()
    return ""


def handle_old_student_verify(handler):
    """Verify existing Student ID + birthdate for Old Student Grade 12 enrollment."""
    try:
        body = read_json_body(handler)
    except json.JSONDecodeError:
        json_response(handler, 400, {"success": False, "error": "Invalid request body."})
        return

    student_id = (body.get("studentId") or "").strip().upper()
    try:
        birth_month = int(body.get("birthMonth") or 0)
        birth_day = int(body.get("birthDay") or 0)
        birth_year = int(body.get("birthYear") or 0)
    except (TypeError, ValueError):
        birth_month = birth_day = birth_year = 0

    if not student_id or not birth_month or not birth_day or not birth_year:
        json_response(handler, 400, {
            "success": False,
            "error": "Student ID and birthdate are required to verify your existing school record.",
        })
        return

    if not supabase_configured():
        json_response(handler, 503, {
            "success": False,
            "error": "Database is not configured. Set SUPABASE_URL and keys in .env.",
        })
        return

    row, error = _load_old_student_row(student_id)
    if error:
        json_response(handler, 500, {
            "success": False,
            "error": friendly_user_error(parse_supabase_error(error)),
        })
        return
    if not row:
        json_response(handler, 404, {
            "success": False,
            "error": "No existing student record found for that Student ID. Old Student enrollment is only for previously enrolled students of this school.",
        })
        return

    if not birthdate_matches(row.get("birthdate"), birth_month, birth_day, birth_year):
        json_response(handler, 401, {
            "success": False,
            "error": "Student ID and birthdate do not match our records.",
        })
        return

    account_status = (row.get("account_status") or "active").strip().lower()
    if account_status == "frozen":
        json_response(handler, 403, {
            "success": False,
            "error": "Your account has been frozen. Please contact the registrar's office.",
            "code": "ACCOUNT_FROZEN",
        })
        return
    if account_status == "inactive":
        json_response(handler, 403, {
            "success": False,
            "error": "Your account is inactive. Please contact the registrar's office.",
            "code": "ACCOUNT_INACTIVE",
        })
        return

    access = fetch_enrollment_access_rest(student_id)
    access = adjust_enrollment_access_for_invalid_record(student_id, access)
    next_stage = str(access.get("nextStage") or "")
    is_g12_stage = next_stage in ("g12_1st", "g12_2nd")

    if access.get("isLifecycleCompleted") or access.get("progressionStatus") == "graduated":
        json_response(handler, 403, {
            "success": False,
            "error": access.get("reason") or (
                "You have completed Grade 12 — 2nd Semester. No further SHS enrollment is available."
            ),
            "access": access,
        })
        return

    if not is_g12_stage:
        json_response(handler, 403, {
            "success": False,
            "error": access.get("reason") or (
                f"Your next required stage is {access.get('nextStageLabel') or 'not Grade 12'}. "
                "Complete the previous semester before Grade 12 enrollment."
            ),
            "access": access,
        })
        return

    if not access.get("canEnroll"):
        json_response(handler, 403, {
            "success": False,
            "error": access.get("reason") or (
                "You are eligible for Grade 12 progression, but enrollment is not open for your next stage yet. "
                "Wait for the registrar to open the Enrollment Period."
            ),
            "access": access,
            "eligibleButClosed": True,
        })
        return

    student = build_student_session_from_supabase_row(row)
    student["email"] = _load_old_student_email(student_id)
    student["gender"] = row.get("gender") or ""
    student["address"] = row.get("address") or ""
    student["contactNumber"] = row.get("contact_number") or ""
    student["admissionType"] = "returnee"
    student["oldStudentReturnee"] = True
    student["enrollmentStage"] = next_stage
    student["enrollmentStageLabel"] = access.get("nextStageLabel") or "Grade 12"
    # System-determined grade/semester (not student-chosen)
    if next_stage == "g12_2nd":
        student["gradeLevel"] = "Grade 12"
        student["semesterCode"] = "2nd"
        student["semester"] = "Second Semester"
    else:
        student["gradeLevel"] = "Grade 12"
        student["semesterCode"] = "1st"
        student["semester"] = "First Semester"
    attach_student_profile_photo(student)

    json_response(handler, 200, {
        "success": True,
        "student": student,
        "access": access,
        "profile": {
            "studentId": student["id"],
            "lastName": student["lastName"],
            "firstName": student["firstName"],
            "middleName": student["middleName"],
            "birthdate": str(row.get("birthdate") or "")[:10],
            "gender": student.get("gender") or "",
            "address": student.get("address") or "",
            "contactNumber": student.get("contactNumber") or "",
            "email": student.get("email") or "",
            "gradeLevel": student["gradeLevel"],
            "semesterCode": student["semesterCode"],
            "semester": student["semester"],
            "strand": student.get("strand") or "",
            "strandFull": student.get("strandFull") or "",
            "section": student.get("section") or "",
            "track": student.get("track") or "Academic",
            "enrollmentStage": next_stage,
            "enrollmentStageLabel": student["enrollmentStageLabel"],
        },
    })


def handle_old_student_update_profile(handler):
    """Update editable fields on the SAME existing student record (Old Student G12 flow)."""
    try:
        body = read_json_body(handler)
    except json.JSONDecodeError:
        json_response(handler, 400, {"success": False, "error": "Invalid request body."})
        return

    student_id = (body.get("studentId") or "").strip().upper()
    try:
        birth_month = int(body.get("birthMonth") or 0)
        birth_day = int(body.get("birthDay") or 0)
        birth_year = int(body.get("birthYear") or 0)
    except (TypeError, ValueError):
        birth_month = birth_day = birth_year = 0

    if not student_id or not birth_month or not birth_day or not birth_year:
        json_response(handler, 400, {"success": False, "error": "Student ID and birthdate are required."})
        return

    if not supabase_configured():
        json_response(handler, 503, {"success": False, "error": "Database is not configured."})
        return

    row, error = _load_old_student_row(student_id)
    if error or not row:
        json_response(handler, 404, {"success": False, "error": "Existing student record not found."})
        return
    if not birthdate_matches(row.get("birthdate"), birth_month, birth_day, birth_year):
        json_response(handler, 401, {"success": False, "error": "Student ID and birthdate do not match."})
        return

    access = fetch_enrollment_access_rest(student_id)
    access = adjust_enrollment_access_for_invalid_record(student_id, access)
    if str(access.get("nextStage") or "") not in ("g12_1st", "g12_2nd") or not access.get("canEnroll"):
        json_response(handler, 403, {
            "success": False,
            "error": access.get("reason") or "You are not eligible to update and enroll for Grade 12 right now.",
        })
        return

    payload = {}
    for src, col in (
        ("lastName", "last_name"),
        ("firstName", "first_name"),
        ("middleName", "middle_name"),
        ("gender", "gender"),
        ("address", "address"),
        ("contactNumber", "contact_number"),
    ):
        if src in body and body.get(src) is not None:
            payload[col] = str(body.get(src) or "").strip()

    if not payload.get("last_name") or not payload.get("first_name"):
        json_response(handler, 400, {"success": False, "error": "First name and last name are required."})
        return

    payload["updated_at"] = datetime.utcnow().isoformat() + "Z"
    # Keep identity + academic progression fields — never invent a new student id/grade here.
    _, patch_err = supabase_rest_patch(
        "students",
        f"id=eq.{row['id']}",
        payload,
    )
    if patch_err:
        json_response(handler, 500, {
            "success": False,
            "error": friendly_user_error(parse_supabase_error(patch_err)),
        })
        return

    email = (body.get("email") or "").strip().lower()
    if email and is_valid_email(email):
        apps, _ = supabase_rest_get(
            "admission_applications",
            f"student_id_generated=eq.{quote(student_id)}&select=id&order=created_at.desc&limit=1",
            use_secret=True,
            timeout=8,
        )
        if apps:
            supabase_rest_patch(
                "admission_applications",
                f"id=eq.{apps[0]['id']}",
                {"email": email},
            )

    refreshed, _ = _load_old_student_row(student_id)
    student = build_student_session_from_supabase_row(refreshed or row)
    student["email"] = email or _load_old_student_email(student_id)
    student["gender"] = (refreshed or row).get("gender") or ""
    student["address"] = (refreshed or row).get("address") or ""
    student["contactNumber"] = (refreshed or row).get("contact_number") or ""
    student["admissionType"] = "returnee"
    student["oldStudentReturnee"] = True
    student["enrollmentStage"] = access.get("nextStage")
    student["enrollmentStageLabel"] = access.get("nextStageLabel")
    if access.get("nextStage") == "g12_2nd":
        student["gradeLevel"] = "Grade 12"
        student["semesterCode"] = "2nd"
        student["semester"] = "Second Semester"
    else:
        student["gradeLevel"] = "Grade 12"
        student["semesterCode"] = "1st"
        student["semester"] = "First Semester"
    attach_student_profile_photo(student)

    json_response(handler, 200, {"success": True, "student": student})


def handle_student_grades(handler):
    query = handler.path.split("?", 1)[-1] if "?" in handler.path else ""
    student_id = None
    for part in query.split("&"):
        if part.startswith("studentId="):
            student_id = unquote(part.split("=", 1)[1]).strip().upper()
    if not student_id:
        json_response(handler, 400, {"success": False, "error": "studentId required"})
        return
    if supabase_configured():
        result, error = supabase_rpc("get_student_grades", {"p_student_id": student_id}, timeout=15)
        if error:
            json_response(handler, 500, {"success": False, "error": friendly_user_error(parse_supabase_error(error))})
            return
        data = result if isinstance(result, dict) else {
            "enrollmentStatus": "unknown",
            "terms": result if isinstance(result, list) else [],
        }
        json_response(handler, 200, {
            "success": True,
            "data": adjust_student_grades_payload(student_id, data),
        })
        return
    json_response(handler, 200, {
        "success": True,
        "data": {
            "enrollmentStatus": "none",
            "message": "Grades are available after you enroll for this semester.",
            "terms": [],
        },
    })


def handle_student_payment(handler):
    query = handler.path.split("?", 1)[-1] if "?" in handler.path else ""
    student_id = None
    for part in query.split("&"):
        if part.startswith("studentId="):
            student_id = unquote(part.split("=", 1)[1]).strip().upper()
    if not student_id:
        json_response(handler, 400, {"success": False, "error": "studentId required"})
        return
    if not supabase_configured():
        json_response(handler, 503, {"success": False, "error": "Supabase not configured"})
        return
    result, error = supabase_rpc("get_student_payment_status", {"p_student_id": student_id}, timeout=15)
    if error:
        json_response(handler, 500, {"success": False, "error": friendly_user_error(parse_supabase_error(error))})
        return
    json_response(handler, 200, {"success": True, "data": result if isinstance(result, dict) else {}})


def handle_student_notifications(handler):
    query = handler.path.split("?", 1)[-1] if "?" in handler.path else ""
    student_id = None
    for part in query.split("&"):
        if part.startswith("studentId="):
            student_id = unquote(part.split("=", 1)[1]).strip().upper()
    if not student_id:
        json_response(handler, 400, {"success": False, "error": "studentId required"})
        return
    if supabase_configured():
        result, error = supabase_rpc("get_student_notifications", {"p_student_id": student_id}, timeout=10)
        if error:
            json_response(handler, 500, {"success": False, "error": friendly_user_error(parse_supabase_error(error))})
            return
        json_response(handler, 200, {"success": True, "data": result if isinstance(result, list) else []})
        return
    json_response(handler, 200, {"success": True, "data": []})


def handle_student_schedule(handler):
    query = handler.path.split("?", 1)[-1] if "?" in handler.path else ""
    student_id = None
    for part in query.split("&"):
        if part.startswith("studentId="):
            student_id = unquote(part.split("=", 1)[1]).strip().upper()
    if not student_id:
        json_response(handler, 400, {"success": False, "error": "studentId required"})
        return
    if supabase_configured():
        result, error = supabase_rpc("get_student_strand_schedule", {"p_student_id": student_id}, timeout=15)
        if error:
            json_response(handler, 500, {"success": False, "error": friendly_user_error(parse_supabase_error(error))})
            return
        json_response(handler, 200, {
            "success": True,
            "data": result if isinstance(result, dict) else {"enrollmentStatus": "unknown", "schedule": result if isinstance(result, list) else []},
        })
        return
    json_response(handler, 200, {
        "success": True,
        "data": {
            "enrollmentStatus": "none",
            "message": "Schedule is available after you enroll and the registrar publishes your class schedule.",
            "schedule": [],
        },
    })


def handle_student_feedback(handler):
    body = read_json_body(handler)
    student_id = str(body.get("studentId") or "").strip().upper()
    subject = str(body.get("subject") or "").strip()
    message = str(body.get("message") or "").strip()

    if not student_id or not subject or not message:
        json_response(handler, 400, {"success": False, "error": "studentId, subject, and message are required"})
        return

    entry = {
        "id": f"FB-{datetime.now().strftime('%Y%m%d%H%M%S')}",
        "studentId": student_id,
        "subject": subject,
        "message": message,
        "submittedAt": datetime.now().isoformat(),
    }

    LOCAL_FEEDBACK_FILE.parent.mkdir(parents=True, exist_ok=True)
    records = []
    if LOCAL_FEEDBACK_FILE.exists():
        try:
            records = json.loads(LOCAL_FEEDBACK_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            records = []
    if not isinstance(records, list):
        records = []
    records.insert(0, entry)
    LOCAL_FEEDBACK_FILE.write_text(json.dumps(records, indent=2), encoding="utf-8")

    json_response(handler, 200, {
        "success": True,
        "message": "Thank you. Your feedback has been submitted to the registrar office.",
    })


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def do_GET(self):
        path = unquote(self.path.split("?", 1)[0])

        if path.startswith("/admin/") or path == "/admin":
            self.send_error(404, "Admin portal is on ENROLLSYSTEM-ADMIN (port 8001)")
            return

        if path in ("/", "/index.html"):
            self.send_response(302)
            self.send_header("Location", "/login.html")
            self.end_headers()
            return

        if path == "/js/config.js" or path.endswith("/js/config.js"):
            content = build_config_js().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return

        if path == "/api/admission/file":
            handle_admission_file(self)
            return

        if path == "/api/payment/gcash/config":
            handle_gcash_config(self)
            return

        if path == "/api/health":
            handle_health_check(self)
            return

        if path == "/api/admission/offerings":
            handle_admission_offerings(self)
            return

        if path == "/api/enrollment/offerings":
            handle_enrollment_offerings(self)
            return

        if path == "/api/enrollment/access":
            handle_enrollment_access(self)
            return

        if path == "/api/enrollment/photos":
            handle_enrollment_photos_get(self)
            return

        if path == "/api/student/grades":
            handle_student_grades(self)
            return

        if path == "/api/student/payment":
            handle_student_payment(self)
            return

        if path == "/api/student/notifications":
            handle_student_notifications(self)
            return

        if path == "/api/student/schedule":
            handle_student_schedule(self)
            return

        if (
            path.startswith("/uploads/registration-forms/")
            and path.endswith("_Registration_Certificate.pdf")
        ):
            filename = path.rsplit("/", 1)[-1]
            student_id = filename.replace("_Registration_Certificate.pdf", "")
            if handle_serve_registration_certificate(self, student_id):
                return

        if path == "/api/student/registration-certificate":
            query = parse_qs(urlparse(self.path).query)
            student_id = (query.get("id") or [""])[0].strip()
            if student_id and handle_serve_registration_certificate(self, student_id):
                return
            json_response(self, 404, {"success": False, "error": "Registration certificate not found"})
            return

        if path == "/api/student/profile-photo":
            handle_student_profile_photo(self)
            return

        if path == "/api/payment/gcash/verify":
            query = self.path.split("?", 1)[1] if "?" in self.path else ""
            session_id = ""
            for part in query.split("&"):
                if part.startswith("sessionId="):
                    session_id = unquote(part.split("=", 1)[1])
            handle_verify_gcash_payment(self, session_id)
            return

        super().do_GET()

    def do_POST(self):
        path = unquote(self.path.split("?", 1)[0])

        if path.startswith("/admin/") or path.startswith("/api/scheduling/") or path.startswith("/api/auth/faculty"):
            self.send_error(404, "Admin portal is on ENROLLSYSTEM-ADMIN (port 8001)")
            return

        if path == "/api/admission/submit":
            handle_admission_submit(self)
            return

        if path == "/api/auth/student":
            handle_student_login(self)
            return

        if path == "/api/student/forgot-password":
            handle_student_forgot_password(self)
            return

        if path == "/api/student/change-password":
            handle_student_change_password(self)
            return

        if path == "/api/enrollment/old-student/verify":
            handle_old_student_verify(self)
            return

        if path == "/api/enrollment/old-student/update-profile":
            handle_old_student_update_profile(self)
            return

        if path == "/api/enrollment/submit":
            handle_enrollment_submit(self)
            return

        if path == "/api/enrollment/photos":
            handle_enrollment_photos_save(self)
            return

        if path == "/api/student/feedback":
            handle_student_feedback(self)
            return

        if path == "/api/payment/gcash/create":
            handle_create_gcash_payment(self)
            return

        if path == "/api/payment/gcash/complete":
            handle_complete_demo_gcash_payment(self)
            return

        self.send_error(404, "Not Found")


def main():
    os.chdir(ROOT)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

    port = PORT
    httpd = None
    class ThreadingHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
        daemon_threads = True
        allow_reuse_address = True

    for _ in range(10):
        try:
            httpd = ThreadingHTTPServer(("", port), Handler)
            break
        except OSError:
            port += 1
    if httpd is None:
        raise RuntimeError("Could not find an available port.")

    url = f"http://localhost:{port}"
    supabase_status = "Connected" if SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY else "Not configured (.env missing URL or key)"
    gmail_status = "Configured" if gmail_configured() else "Not configured (add GMAIL_USER + GMAIL_APP_PASSWORD to .env)"
    if gmail_configured():
        print(f"  Gmail sender:      {mask_email(GMAIL_USER)}")
        print(f"  Admin inbox:       {mask_email(ADMIN_EMAIL)}")

    print("=" * 50)
    print("  EMS — STUDENT PORTAL ONLY")
    print("=" * 50)
    print(f"\n  Server running at: {url}")
    print(f"  Login page:        {url}/login.html")
    print(f"  Enroll Now:        {url}/enroll.html")
    print(f"\n  Supabase:          {supabase_status}")
    if ENV_SOURCE:
        print(f"  Env file:          {ENV_SOURCE}")
    elif not supabase_configured():
        print("  Env file:          missing — copy ENROLLSYSTEM/.env from your main laptop")
    print(f"  Gmail:             {gmail_status}")
    print(f"  Applicant email:   {APPLICANT_EMAIL_VERSION} (full enrollment summary)")
    print(f"  GCash Payment:     QR Code mode")
    print(f"  Enrollment fee:    PHP {ENROLLMENT_FEE:,.2f}")
    if not GMAIL_USER:
        print("  Add GMAIL_USER and GMAIL_APP_PASSWORD to .env for email notifications.")
    print("\n  --- STUDENT DEMO ACCOUNT ---")
    print("  Student ID:  2026-00145-SHS-0")
    print("  Birthdate:   March 15, 2009")
    print("  Password:    student123")
    print("\n  Admin portal:      http://localhost:8001/login.html")
    print("  (Run ENROLLSYSTEM-ADMIN separately — python main.py)")
    print("\n  Press Ctrl+C to stop the server.\n")
    print("=" * 50)
    open_path = os.environ.get("EMS_OPEN_URL", "/login.html")
    if not open_path.startswith("/"):
        open_path = "/" + open_path
    try:
        webbrowser.open(f"{url}{open_path}")
    except Exception:
        pass
    httpd.serve_forever()


if __name__ == "__main__":
    main()
