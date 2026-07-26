"""Server-side role guard for API route protection."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Callable

from .auth_tokens import validate_token


class RouteAccess(str, Enum):
    PUBLIC = "public"
    FACULTY = "faculty"
    STUDENT = "student"


# Admin-only routes (faculty session required)
FACULTY_ROUTES = {
    "/api/admission/pending",
    "/api/admission/history",
    "/api/admission/detail",
    "/api/admission/review",
    "/api/faculty/dashboard",
    "/api/setup/seed-faculty",
    "/api/email/test",
    "/api/scheduling/config",
    "/api/scheduling/generate",
    "/api/scheduling/validate",
    "/api/scheduling/apply",
}

# Student-only routes
STUDENT_ROUTES = {
    "/api/enrollment/submit",
}

# Routes that accept faculty OR student with query/body ownership checks elsewhere
SHARED_READ_ROUTES = {
    "/api/enrollment/offerings",
}


def _normalize_path(path: str) -> str:
    base = path.split("?", 1)[0].rstrip("/")
    if base.startswith("/api/admission/detail/"):
        return "/api/admission/detail"
    return base or "/"


def get_route_access(path: str) -> RouteAccess:
    normalized = _normalize_path(path)
    if normalized in FACULTY_ROUTES:
        return RouteAccess.FACULTY
    if normalized in STUDENT_ROUTES:
        return RouteAccess.STUDENT
    return RouteAccess.PUBLIC


def get_request_auth(handler) -> dict | None:
    auth_header = handler.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return validate_token(auth_header[7:].strip())
    legacy = handler.headers.get("X-EMS-Access-Token", "").strip()
    if legacy:
        return validate_token(legacy)
    return None


def check_route_access(handler, path: str, json_response: Callable) -> tuple[bool, dict | None]:
    access = get_route_access(path)
    auth = get_request_auth(handler)

    if access == RouteAccess.PUBLIC:
        return True, auth

    if access == RouteAccess.FACULTY:
        if not auth or auth.get("role") != "faculty":
            json_response(handler, 403, {
                "success": False,
                "error": "Faculty access required.",
                "code": "FORBIDDEN_FACULTY",
            })
            return False, None
        return True, auth

    if access == RouteAccess.STUDENT:
        if not auth or auth.get("role") != "student":
            json_response(handler, 403, {
                "success": False,
                "error": "Student access required.",
                "code": "FORBIDDEN_STUDENT",
            })
            return False, None
        return True, auth

    return True, auth
