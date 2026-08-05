"""Bảo vệ gateway công khai giữa iNut website và Hermes Training."""
from __future__ import annotations

import hashlib
import hmac
import re
import threading
import time
from typing import Any

from fastapi import HTTPException, Request, status

from .config import Settings
from .crypto import fingerprint
from .training import unsafe_question_reason

_NONCES: dict[str, float] = {}
_NONCE_LOCK = threading.Lock()
_NONCE_TTL_SECONDS = 180
_MAX_BODY_BYTES = 32 * 1024
_MIN_SECRET_LENGTH = 32
_PHONE_RE = re.compile(r"^(?:0|84)(?:3|5|7|8|9)\d{8}$")
_INTERNAL_HOST_RE = re.compile(
    r"https?://(?:ksp-pdf-signer\.p2p\.inut\.io\.vn|localhost(?::\d+)?|127\.0\.0\.1(?::\d+)?)",
    re.IGNORECASE,
)


def normalize_phone(value: str) -> str:
    compact = re.sub(r"[\s().-]", "", value.strip())
    if compact.startswith("+84"):
        compact = "0" + compact[3:]
    elif compact.startswith("84"):
        compact = "0" + compact[2:]
    if not _PHONE_RE.fullmatch(compact):
        raise ValueError("Số điện thoại không hợp lệ")
    return compact


def validate_question(value: str) -> str:
    question = value.strip()
    if not question or len(question.encode("utf-8")) > 2000:
        raise ValueError("Câu hỏi phải từ 1 đến 2000 ký tự")
    if unsafe_question_reason(question):
        raise ValueError("Training chỉ hỗ trợ tra cứu có nguồn")
    return question


def mask_phone(phone: str) -> str:
    return f"••••••{phone[-4:]}" if len(phone) >= 4 else "••••"


def public_training_token_hash(token: str) -> str:
    return fingerprint(token)


def _canonical(method: str, path: str, timestamp: str, nonce: str, body: bytes) -> bytes:
    digest = hashlib.sha256(body).hexdigest()
    return f"{method.upper()}\n{path}\n{timestamp}\n{nonce}\n{digest}".encode("utf-8")


def _request_path(request: Request) -> str:
    query = request.url.query
    return request.url.path + (f"?{query}" if query else "")


def _cleanup_nonces(now: float) -> None:
    expired = [nonce for nonce, seen_at in _NONCES.items() if now - seen_at > _NONCE_TTL_SECONDS]
    for nonce in expired:
        _NONCES.pop(nonce, None)


async def require_internal_signature(request: Request, settings: Settings) -> bytes:
    """Xác thực BFF bằng HMAC và chống replay trước khi đọc JSON."""
    if not settings.public_training_enabled or len(settings.public_training_hmac_secret) < _MIN_SECRET_LENGTH:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Trợ lý tạm thời chưa khả dụng")
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            declared_length = int(content_length)
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Content-Length không hợp lệ") from exc
        if declared_length < 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Content-Length không hợp lệ")
        if declared_length > _MAX_BODY_BYTES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Yêu cầu quá lớn")
    body = await request.body()
    if len(body) > _MAX_BODY_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Yêu cầu quá lớn")
    client_id = request.headers.get("x-inut-training-client", "")
    timestamp = request.headers.get("x-inut-training-timestamp", "")
    nonce = request.headers.get("x-inut-training-nonce", "")
    provided = request.headers.get("x-inut-training-signature", "")
    if client_id != settings.public_training_client_id or not timestamp or not nonce or not provided:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Yêu cầu nội bộ không hợp lệ")
    try:
        timestamp_value = int(timestamp)
    except ValueError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Yêu cầu nội bộ không hợp lệ") from exc
    now = int(time.time())
    if abs(now - timestamp_value) > 120:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Yêu cầu nội bộ đã hết hạn")
    expected = hmac.new(
        settings.public_training_hmac_secret.encode("utf-8"),
        _canonical(request.method, _request_path(request), timestamp, nonce, body),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, provided):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Yêu cầu nội bộ không hợp lệ")
    with _NONCE_LOCK:
        _cleanup_nonces(float(now))
        if nonce in _NONCES:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Yêu cầu nội bộ đã được dùng")
        _NONCES[nonce] = float(now)
    return body


def rewrite_public_text(value: str, settings: Settings | None = None) -> str:
    """Không để hostname nội bộ hoặc URL local lọt ra trình duyệt."""
    if not value:
        return value
    def replace_host(match: re.Match[str]) -> str:
        return "https://inut.vn"

    output = _INTERNAL_HOST_RE.sub(replace_host, value)
    output = output.replace("/training/help", "/help").replace("/training", "/help")
    if settings:
        base = settings.training_base_url.rstrip("/")
        if base:
            output = output.replace(base, "https://inut.vn/help")
    return output


def sanitize_public_value(value: Any, settings: Settings | None = None) -> Any:
    if isinstance(value, str):
        return rewrite_public_text(value, settings)
    if isinstance(value, list):
        return [sanitize_public_value(item, settings) for item in value]
    if isinstance(value, dict):
        return {str(key): sanitize_public_value(item, settings) for key, item in value.items()}
    return value


def sanitize_public_result(result: dict[str, Any], settings: Settings) -> dict[str, Any]:
    return sanitize_public_value(result, settings)
