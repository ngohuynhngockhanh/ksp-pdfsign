"""Scoped Service API Keys (SHA-256 hashed) for ecosystem Email & Telegram relay."""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import ServiceApiKey

KEY_PREFIX_TAG = "ksp_svc_"
ALLOWED_SCOPES: tuple[str, ...] = ("mail:send", "telegram:send", "ci:publish")
DEFAULT_SCOPES: tuple[str, ...] = ("mail:send", "telegram:send")
_LAST_USED_TOUCH_INTERVAL_SEC = 60.0


def _now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def hash_service_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def normalize_scopes(scopes: list[str] | tuple[str, ...] | None) -> list[str]:
    if not scopes:
        return list(DEFAULT_SCOPES)
    out: list[str] = []
    seen: set[str] = set()
    for s in scopes:
        val = str(s or "").strip().lower()
        if val in ALLOWED_SCOPES and val not in seen:
            seen.add(val)
            out.append(val)
    if not out:
        raise ValueError(f"Scope không hợp lệ. Chỉ chấp nhận: {', '.join(ALLOWED_SCOPES)}")
    return out


def parse_scopes(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [s.strip().lower() for s in str(raw).split(",") if s.strip()]


def serialize_service_key(row: ServiceApiKey) -> dict[str, Any]:
    return {
        "id": row.id,
        "name": row.name,
        "key_prefix": row.key_prefix,
        "scopes": parse_scopes(row.scopes),
        "is_active": bool(row.is_active and row.revoked_at is None),
        "created_by": row.created_by,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "last_used_at": row.last_used_at.isoformat() if row.last_used_at else None,
        "revoked_at": row.revoked_at.isoformat() if row.revoked_at else None,
    }


def create_service_key(
    db: Session,
    name: str,
    scopes: list[str] | None = None,
    created_by: str = "admin",
) -> tuple[ServiceApiKey, str]:
    clean_name = str(name or "").strip()[:120]
    if not clean_name:
        raise ValueError("Tên ứng dụng / dịch vụ không được để trống")
    norm_scopes = normalize_scopes(scopes)

    raw_key = f"{KEY_PREFIX_TAG}{secrets.token_urlsafe(32)}"
    key_prefix = f"{raw_key[:16]}..."
    key_hash = hash_service_key(raw_key)

    row = ServiceApiKey(
        name=clean_name,
        key_prefix=key_prefix,
        key_hash=key_hash,
        scopes=",".join(norm_scopes),
        is_active=True,
        created_by=str(created_by or "admin")[:64],
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row, raw_key


def list_service_keys(db: Session) -> list[dict[str, Any]]:
    rows = db.scalars(select(ServiceApiKey).order_by(ServiceApiKey.id.desc())).all()
    return [serialize_service_key(r) for r in rows]


def revoke_service_key(db: Session, key_id: int) -> ServiceApiKey | None:
    row = db.get(ServiceApiKey, key_id)
    if row is None:
        return None
    if row.is_active or row.revoked_at is None:
        row.is_active = False
        row.revoked_at = _now_naive()
        db.commit()
        db.refresh(row)
    return row


def extract_service_key(request: Request) -> str:
    """Extract a `ksp_svc_*` service API key from X-API-Key or Authorization: Bearer."""
    x_key = (request.headers.get("x-api-key") or "").strip()
    if x_key.startswith(KEY_PREFIX_TAG):
        return x_key
    auth = (request.headers.get("authorization") or "").strip()
    if auth.startswith("Bearer "):
        tok = auth[7:].strip()
        if tok.startswith(KEY_PREFIX_TAG):
            return tok
    return ""


def authenticate_service_key(
    request: Request,
    db: Session,
    required_scope: str,
) -> ServiceApiKey | None:
    """Verify a scoped Service API Key against active SHA-256 hashes in SQLite."""
    raw = extract_service_key(request)
    if not raw or len(raw) < len(KEY_PREFIX_TAG) + 16:
        return None
    digest = hash_service_key(raw)
    row = db.scalar(
        select(ServiceApiKey).where(
            ServiceApiKey.key_hash == digest,
            ServiceApiKey.is_active.is_(True),
            ServiceApiKey.revoked_at.is_(None),
        )
    )
    if row is None or not hmac.compare_digest(row.key_hash, digest):
        return None
    scopes = parse_scopes(row.scopes)
    if required_scope.strip().lower() not in scopes:
        return None

    now = _now_naive()
    if row.last_used_at is None or (now - row.last_used_at).total_seconds() >= _LAST_USED_TOUCH_INTERVAL_SEC:
        try:
            row.last_used_at = now
            db.commit()
        except Exception:
            db.rollback()
    return row
