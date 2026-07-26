"""
Enrollment System - Local Development Server
Run: python server.py
"""

import base64
import http.server
import json
import os
import re
import smtplib
import socketserver
import threading
import uuid
import webbrowser
from datetime import datetime
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import unquote
from urllib.request import Request, urlopen

PORT = 8000
ROOT = Path(__file__).parent
UPLOADS_DIR = ROOT / "uploads" / "admissions"
LOCAL_ADMISSIONS_FILE = ROOT / "data" / "admissions.json"


def load_env():
    env = {}
    env_path = ROOT / ".env"
    if not env_path.exists():
        return env

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
    return env


def normalize_gmail_password(password):
    return re.sub(r"\s+", "", password or "")


ENV = load_env()
SUPABASE_URL = ENV.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_PUBLISHABLE_KEY = ENV.get("SUPABASE_PUBLISHABLE_KEY", "")
SUPABASE_SECRET_KEY = ENV.get("SUPABASE_SECRET_KEY", "")
GMAIL_USER = ENV.get("GMAIL_USER", "").strip().lower()
GMAIL_APP_PASSWORD = normalize_gmail_password(ENV.get("GMAIL_APP_PASSWORD", ""))
ADMIN_EMAIL = (ENV.get("ADMIN_EMAIL") or GMAIL_USER).strip().lower()
SCHOOL_NAME = ENV.get("SCHOOL_NAME", "Geranova Senior High School")
PAYMONGO_SECRET_KEY = ENV.get("PAYMONGO_SECRET_KEY", "")
ENROLLMENT_FEE = float(ENV.get("ENROLLMENT_FEE", "2500"))
GCASH_MERCHANT_NAME = ENV.get("GCASH_MERCHANT_NAME", SCHOOL_NAME)
GCASH_MERCHANT_NUMBER = ENV.get("GCASH_MERCHANT_NUMBER", "09XX XXX XXXX")
GCASH_QR_IMAGE = ENV.get("GCASH_QR_IMAGE", "assets/gcash-qr.svg")
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
    strand_code = app.get("strandCode") or app.get("strand") or "GAS"
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
        stored_password = (app.get("temp_password") or app.get("tempPassword") or "").strip()
        if stored_password != password:
            continue
        birthdate = str(app.get("birthdate") or "")[:10]
        if birthdate:
            try:
                y, m, d = [int(part) for part in birthdate.split("-")]
                if int(birth_year) != y or int(birth_month) != m or int(birth_day) != d:
                    continue
            except (TypeError, ValueError):
                continue
        return build_student_session_from_admission(app)
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

    strand_code = app.get("strandCode") or app.get("strand") or "GAS"
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

    if not student_id or not password or not birth_month or not birth_day or not birth_year:
        json_response(handler, 400, {
            "success": False,
            "error": "Student ID, birthdate, and password are required.",
        })
        return

    student = None

    if supabase_configured():
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

    if student:
        json_response(handler, 200, {"success": True, "student": student})
        return

    json_response(handler, 401, {
        "success": False,
        "error": "Invalid Student ID, birthdate, or password.",
        "hint": (
            "Use the exact Student ID and Temporary Password from your approval email. "
            "Birthdate must match your enrollment form. "
            "If login still fails, run supabase/fix-student-login.sql in Supabase SQL Editor."
        ) if supabase_configured() else None,
    })


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
    }

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
            "url": f"/{path.lstrip('/')}" if path else None,
            "uploaded": bool(path),
        })
    gcash_path = record.get("gcashProofPath")
    if record.get("paymentMode") == "gcash" and gcash_path:
        gcash_path = str(gcash_path).replace("\\", "/")
        doc_list.append({
            "key": "gcash_proof",
            "label": "GCash Payment Receipt",
            "path": gcash_path,
            "url": f"/{gcash_path.lstrip('/')}",
            "uploaded": True,
        })
    bank_path = record.get("bankProofPath")
    if record.get("paymentMode") == "bank" and bank_path:
        bank_path = str(bank_path).replace("\\", "/")
        doc_list.append({
            "key": "bank_proof",
            "label": "Bank Payment Receipt",
            "path": bank_path,
            "url": f"/{bank_path.lstrip('/')}",
            "uploaded": True,
        })
    created = record.get("createdAt") or record.get("created_at") or ""
    student_name = format_applicant_name(record) or record.get("student") or ""
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
        "contactNumber": record.get("contactNumber", ""),
        "email": record.get("email", ""),
        "gradeLevel": record.get("gradeLevel") or record.get("grade", ""),
        "strandCode": record.get("strandCode") or record.get("strand", ""),
        "admissionType": record.get("admissionType", "new"),
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
        "totalStrands": 5,
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
            for code in ("STEM", "ABM", "HUMSS", "GAS", "ICT", "COOKERY", "EIM")
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

    return {
        "totalStudents": approved_count,
        "totalStrands": 5,
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
            for code in ("STEM", "ABM", "HUMSS", "GAS", "ICT", "COOKERY", "EIM")
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


def send_email(to_addr, subject, html_body, attachments=None):
    to_addr = (to_addr or "").strip()
    if not to_addr:
        return False, "Missing recipient email address"

    if not GMAIL_USER or not GMAIL_APP_PASSWORD:
        print(f"[Email skipped - Gmail not configured] To: {to_addr} | {subject}")
        return False, "Gmail is not configured in .env (GMAIL_USER + GMAIL_APP_PASSWORD)"

    msg = MIMEMultipart()
    msg["From"] = f"{SCHOOL_NAME} <{GMAIL_USER}>"
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg.attach(MIMEText(html_body, "html"))

    for attachment in attachments or []:
        path = ROOT / attachment["path"]
        if not path.exists():
            continue
        part = MIMEBase("application", "octet-stream")
        part.set_payload(path.read_bytes())
        encoders.encode_base64(part)
        part.add_header(
            "Content-Disposition",
            f'attachment; filename="{attachment.get("name", path.name)}"',
        )
        msg.attach(part)

    errors = []
    for method_name, send_fn in (
        ("SMTP_SSL:465", _send_via_smtp_ssl),
        ("STARTTLS:587", _send_via_starttls),
    ):
        try:
            send_fn(msg)
            print(f"[Email sent via {method_name}] To: {to_addr} | {subject}")
            return True, None
        except Exception as err:
            errors.append(f"{method_name}: {err}")
            print(f"[Email error via {method_name}] {err}")

    return False, " | ".join(errors)


def dispatch_submission_emails(app_data, doc_paths, gcash_proof_path, app_number):
    """Send confirmation emails in the background so submit responds immediately."""

    def _worker():
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
            print(f"[Email background admin] sent={ok} error={err}")

        ok, err = send_email(
            app_data["email"],
            f"Application Received — {SCHOOL_NAME}",
            build_applicant_confirmation_email(app_data),
        )
        print(f"[Email background applicant] sent={ok} error={err}")

    threading.Thread(target=_worker, daemon=True).start()


def _send_via_smtp_ssl(msg):
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as server:
        server.login(GMAIL_USER, GMAIL_APP_PASSWORD)
        server.send_message(msg)


def _send_via_starttls(msg):
    with smtplib.SMTP("smtp.gmail.com", 587, timeout=30) as server:
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(GMAIL_USER, GMAIL_APP_PASSWORD)
        server.send_message(msg)


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
      <h2 style="color:#1a3a6b;">New Admission Application — {SCHOOL_NAME}</h2>
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


def build_applicant_confirmation_email(app_data):
    return f"""
    <div style="font-family:Arial,sans-serif;max-width:640px;">
      <h2 style="color:#1a3a6b;">Application Received — {SCHOOL_NAME}</h2>
      <p>Dear {app_data.get('firstName')},</p>
      <p>We received your enrollment application.</p>
      <p><strong>Application No:</strong> {app_data.get('applicationNumber')}</p>
      <p>Our registrar will review your documents. Once approved, your <strong>Student ID</strong>
      and login password will be sent to this email.</p>
      <p>Thank you,<br>{SCHOOL_NAME}</p>
    </div>
    """


def build_approval_email(result):
    return f"""
    <div style="font-family:Arial,sans-serif;max-width:640px;">
      <h2 style="color:#1a3a6b;">Admission Approved — {SCHOOL_NAME}</h2>
      <p>Dear {result.get('firstName')},</p>
      <p>Congratulations! Your enrollment application has been <strong>approved</strong>.</p>
      <p><strong>Application No:</strong> {result.get('applicationNumber')}</p>
      <p><strong>Your Student ID:</strong> {result.get('studentId')}</p>
      <p><strong>Temporary Password:</strong> {result.get('tempPassword')}</p>
      <p><strong>Sign in with:</strong></p>
      <ul>
        <li>Student ID (exactly as shown above)</li>
        <li>Your birthdate from the enrollment form</li>
        <li>Temporary Password (case-sensitive, e.g. Shs1234)</li>
      </ul>
      <p>Use these at the student login page of the enrollment portal.</p>
      <p>Thank you,<br>{SCHOOL_NAME}</p>
    </div>
    """


def build_rejection_email(result, reason):
    return f"""
    <div style="font-family:Arial,sans-serif;max-width:640px;">
      <h2 style="color:#1a3a6b;">Admission Update — {SCHOOL_NAME}</h2>
      <p>Dear {result.get('firstName')},</p>
      <p>Your enrollment application ({result.get('applicationNumber')}) was not approved at this time.</p>
      {f'<p><strong>Reason:</strong> {reason}</p>' if reason else ''}
      <p>For questions, please contact the registrar office.</p>
      <p>Thank you,<br>{SCHOOL_NAME}</p>
    </div>
    """


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
            "gradeLevel", "paymentMode"
        )
        if not fields.get(key, "").strip()
    ]
    if missing_fields:
        json_response(handler, 400, {
            "success": False,
            "error": f"Missing required fields: {', '.join(missing_fields)}",
        })
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

    application_id = str(uuid.uuid4())
    doc_paths = save_uploaded_files(application_id, files)
    gcash_proof_path = doc_paths.get("gcash_proof")
    bank_proof_path = doc_paths.get("bank_proof")

    gcash_ref = fields.get("gcashReference", "").strip()

    full_address = build_full_address(fields)

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
    }

    app_number = None
    supabase_id = application_id

    if supabase_configured():
        result, error = supabase_rpc(
            "submit_admission_application",
            {"p_payload": payload},
            timeout=15,
        )
        if error:
            print(f"[Supabase error] submit_admission_application: {error}")
            json_response(handler, 500, {
                "success": False,
                "error": "Failed to save application to Supabase.",
                "details": parse_supabase_error(error),
                "hint": (
                    "Open Supabase SQL Editor and run "
                    "supabase/supabase-primary-migration.sql, then restart the server."
                ),
            })
            return

        app_number = result.get("applicationNumber")
        supabase_id = result.get("applicationId", application_id)
        print(f"[Supabase] Saved admission {app_number}")
    else:
        records = load_local_admissions()
        app_number = generate_local_app_number(records)
        upsert_local_admission(application_id, app_number, payload, fields, "pending")
        print("[Info] Supabase not configured — saved to local data/admissions.json")

    app_data = {**payload, "applicationNumber": app_number, "strandCode": fields.get("strandCode", "")}

    dispatch_submission_emails(app_data, doc_paths, gcash_proof_path, app_number)

    json_response(handler, 200, {
        "success": True,
        "applicationNumber": app_number,
        "applicationId": supabase_id,
        "storage": "supabase" if supabase_configured() else "local",
        "emailsQueued": True,
    })


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
                "error": "Application not found in Supabase.",
                "hint": (
                    "Refresh the review list and open the application again. "
                    "If this keeps happening, run supabase/fix-approve-review.sql in Supabase SQL Editor."
                ),
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
                "error": "Failed to process review in Supabase.",
                "details": parse_supabase_error(error),
                "hint": (
                    "Run supabase/fix-approve-review.sql in Supabase SQL Editor "
                    "(adds missing students columns + fixes review RPC), then restart the server."
                ),
            })
            return

        email_ok = False
        email_err = None
        if action == "approve":
            email_ok, email_err = send_email(
                result["email"],
                f"Admission Approved — {SCHOOL_NAME}",
                build_approval_email(result),
            )
        else:
            email_ok, email_err = send_email(
                result["email"],
                f"Admission Update — {SCHOOL_NAME}",
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
        ok, err = send_email(app["email"], f"Admission Approved — {SCHOOL_NAME}", build_approval_email(result))
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
        ok, err = send_email(app["email"], f"Admission Update — {SCHOOL_NAME}", build_rejection_email(result, reason))
        result["emailSent"] = ok
        if err:
            result["emailError"] = err

    json_response(handler, 200, result)


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
    ENROLLMENT_SUBJECTS_DEMO,
    REQUIRED_SUBJECTS_PER_TERM,
    filter_demo_subjects_by_strand,
)


def handle_enrollment_offerings(handler):
    query = handler.path.split("?", 1)[1] if "?" in handler.path else ""
    student_id = ""
    strand_code = "GAS"
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
                "error": "Failed to load subject offerings.",
                "details": parse_supabase_error(error),
            })
            return
        offerings = result if isinstance(result, list) else []
        json_response(handler, 200, {
            "success": True,
            "data": offerings,
            "source": "supabase",
        })
        return

    json_response(handler, 200, {
        "success": True,
        "data": filter_demo_subjects_by_strand(strand_code, grade_level, semester_code),
        "source": "demo",
    })


def handle_enrollment_submit(handler):
    try:
        body = read_json_body(handler)
    except json.JSONDecodeError:
        json_response(handler, 400, {"success": False, "error": "Invalid request body"})
        return

    student_id = (body.get("studentId") or "").strip().upper()
    subjects = body.get("subjects") or []

    if not student_id:
        json_response(handler, 400, {"success": False, "error": "studentId is required"})
        return
    if not isinstance(subjects, list) or not subjects:
        json_response(handler, 400, {"success": False, "error": "Select at least one subject"})
        return

    if supabase_configured():
        result, error = supabase_rpc("submit_student_enrollment", {
            "p_student_id": student_id,
            "p_subjects": subjects,
        }, timeout=15)
        if error:
            err_text = parse_supabase_error(error) or "Enrollment validation failed."
            hint = None
            if any(token in err_text.lower() for token in ("strand", "subject", "schedule", "enrollment is")):
                hint = "You can only enroll in core subjects and subjects for your assigned strand."
            elif "does not exist" in err_text.lower() or "column" in err_text.lower():
                hint = "Run supabase/enrollment-workflow.sql in Supabase SQL Editor, then try again."
            payload = {"success": False, "error": err_text}
            if hint:
                payload["hint"] = hint
            json_response(handler, 400, payload)
            return
        json_response(handler, 200, {"success": True, **(result or {})})
        return

    json_response(handler, 503, {
        "success": False,
        "error": "Supabase is not configured. Subject enrollment requires database connection.",
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
        result, error = supabase_rpc("get_student_enrollment_access", {
            "p_student_id": student_id,
        }, timeout=10)
        if error:
            json_response(handler, 500, {"success": False, "error": parse_supabase_error(error)})
            return
        json_response(handler, 200, {"success": True, "data": result or {}})
        return
    json_response(handler, 200, {"success": True, "data": {"canEnroll": True, "enrollmentOpen": True}})


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
            json_response(handler, 500, {"success": False, "error": parse_supabase_error(error)})
            return
        json_response(handler, 200, {"success": True, "data": result if isinstance(result, list) else []})
        return
    from enrollment_curriculum import ENROLLMENT_SUBJECTS_DEMO
    json_response(handler, 200, {"success": True, "data": [], "source": "demo"})


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

        if path == "/api/payment/gcash/config":
            handle_gcash_config(self)
            return

        if path == "/api/health":
            handle_health_check(self)
            return

        if path == "/api/enrollment/offerings":
            handle_enrollment_offerings(self)
            return

        if path == "/api/enrollment/access":
            handle_enrollment_access(self)
            return

        if path == "/api/student/grades":
            handle_student_grades(self)
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

        if path == "/api/enrollment/submit":
            handle_enrollment_submit(self)
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
    for _ in range(10):
        try:
            httpd = socketserver.TCPServer(("", port), Handler)
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
    print("  Geranova EMS — STUDENT PORTAL ONLY")
    print("=" * 50)
    print(f"\n  Server running at: {url}")
    print(f"  Login page:        {url}/login.html")
    print(f"  Enroll Now:        {url}/enroll.html")
    print(f"\n  Supabase:          {supabase_status}")
    print(f"  Gmail:             {gmail_status}")
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
