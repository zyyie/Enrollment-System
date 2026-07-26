"""In-memory API access tokens (role-scoped server sessions)."""

from __future__ import annotations

import secrets
import time
from threading import Lock
from typing import Any

TOKEN_TTL_SECONDS = 8 * 60 * 60

_store: dict[str, dict[str, Any]] = {}
_lock = Lock()


def issue_token(role: str, user_id: str, profile: dict | None = None) -> str:
    token = secrets.token_urlsafe(32)
    payload = {
        "role": role,
        "user_id": (user_id or "").strip().upper(),
        "profile": profile or {},
        "expires_at": time.time() + TOKEN_TTL_SECONDS,
    }
    with _lock:
        _store[token] = payload
    return token


def validate_token(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    with _lock:
        payload = _store.get(token)
        if not payload:
            return None
        if payload["expires_at"] < time.time():
            del _store[token]
            return None
        return dict(payload)


def revoke_token(token: str | None) -> None:
    if not token:
        return
    with _lock:
        _store.pop(token, None)
