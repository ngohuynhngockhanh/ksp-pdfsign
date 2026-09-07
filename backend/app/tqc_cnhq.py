"""TQC CNHQ connector and local model-search index.

The public TQC API intentionally exposes exact certificate lookup only. Model,
manufacturer, and applicant searches therefore use records that were supplied
by a user or returned by an official exact lookup.
"""

from __future__ import annotations

import base64
import csv
import hashlib
import io
import json
import re
import threading
import time
from datetime import date, datetime, timezone
from typing import Any, Iterable
from urllib.parse import parse_qs, quote, urlsplit
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .db import TqcCertificate
from .standards import _strip_accents

TQC_PUBLIC_QR_HOSTS = {"data-cnhq.tqc.gov.vn"}
_CERTIFICATE_RE = re.compile(r"^[A-Za-z0-9]{6,120}$")
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
_RATE_LIMIT_LOCK = threading.Lock()
_RATE_LIMIT_WINDOWS: dict[str, tuple[float, int]] = {}
_VIETNAM_TIMEZONE = ZoneInfo("Asia/Ho_Chi_Minh")


class TqcCnhqError(RuntimeError):
    """Safe domain error for TQC lookup failures."""

    def __init__(self, message: str, *, code: str = "tqc_error", status: int = 0):
        super().__init__(message)
        self.code = code
        self.status = status


def _text(value: Any, limit: int = 2000) -> str:
    return _CONTROL_RE.sub("", str(value or "")).strip()[:limit]


def normalize_certificate_no(value: Any) -> str:
    text = _text(value, 120).replace(" ", "")
    if not text or not _CERTIFICATE_RE.fullmatch(text):
        raise TqcCnhqError("Số GCN không hợp lệ", code="invalid_certificate_no", status=422)
    return text.upper()


def _parse_regulations(value: Any) -> list[str]:
    if isinstance(value, list):
        return [_text(item, 255) for item in value if _text(item, 255)]
    text = _text(value, 4000)
    if not text:
        return []
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return [_text(item, 255) for item in parsed if _text(item, 255)]
    except (TypeError, ValueError):
        pass
    return [_text(item, 255) for item in text.split(",") if _text(item, 255)]


def _parse_date(value: Any) -> datetime | None:
    text = _text(value, 80)
    if not text:
        return None
    normalized = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S"):
            try:
                parsed = datetime.strptime(text, fmt)
                break
            except ValueError:
                parsed = None
        if parsed is None:
            return None
    return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc)


def _vietnam_calendar_date(value: Any) -> date | None:
    text = _text(value, 80)
    parsed = _parse_date(text)
    if parsed is None:
        return None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return parsed.date()
    return parsed.astimezone(_VIETNAM_TIMEZONE).date()


def _derived_status(source_status: str, expiry_date: str) -> str:
    source = _strip_accents(source_status).lower()
    if any(word in source for word in ("huy", "thu hoi", "vo hieu")):
        return "cancelled"
    expiry = _vietnam_calendar_date(expiry_date)
    if expiry and expiry < datetime.now(_VIETNAM_TIMEZONE).date():
        return "expired"
    if "con hieu luc" in source:
        return "active"
    if "het hieu luc" in source:
        return "expired"
    return "unknown"


def normalize_certificate(
    raw: dict[str, Any],
    *,
    fetched_at: datetime | None = None,
    source_url: str = "",
    verification_status: str = "verified_live",
) -> dict[str, Any]:
    certificate_no = normalize_certificate_no(raw.get("so_giay_chung_nhan"))
    issue_date = _text(raw.get("ngay_cap_giay_chung_nhan"), 80)
    expiry_date = _text(raw.get("ngay_het_han"), 80)
    source_status = _text(raw.get("tinh_trang_giay_chung_nhan"), 100)
    tax_code = _text(raw.get("tax_code") or raw.get("ma_so_thue") or raw.get("mst"), 32)
    regulations = _parse_regulations(raw.get("quy_chuan_ky_thuat"))
    checked_at = fetched_at or datetime.now(timezone.utc)
    return {
        "certificate_no": certificate_no,
        "tax_code": tax_code,
        "issue_date": issue_date,
        "expiry_date": expiry_date,
        "applicant_name": _text(raw.get("don_vi_nop_ho_so_vn"), 500),
        "product_name": _text(raw.get("ten_san_pham_vn"), 1000),
        "model": _text(raw.get("ky_hieu"), 255),
        "manufacturer": _text(raw.get("ten_hang_san_xuat_vn"), 500),
        "factory_name": _text(raw.get("nha_may_san_xuat"), 500),
        "factory_address": _text(raw.get("dia_chi_noi_san_xuat"), 1000),
        "technical_regulations": regulations,
        "certification_method": _text(raw.get("phuong_thuc"), 100),
        "serial_form_no": _text(raw.get("so_serial_phoi_giay"), 255),
        "source_status": source_status,
        "derived_status": _derived_status(source_status, expiry_date),
        "provenance": {
            "verification_status": verification_status,
            "source_url": _text(source_url, 1000),
            "checked_at": checked_at.isoformat(),
        },
        "raw": raw,
    }


def _derive_key_and_iv(password: bytes, salt: bytes, key_len: int = 32, iv_len: int = 16) -> tuple[bytes, bytes]:
    output = b""
    previous = b""
    while len(output) < key_len + iv_len:
        previous = hashlib.md5(previous + password + salt).digest()
        output += previous
    return output[:key_len], output[key_len : key_len + iv_len]


def _decrypt_cryptojs_aes(value: str, password: str = "tqc_K2p9x") -> str | None:
    """Decode CryptoJS AES passphrase output used by TQC's public QR page."""
    try:
        encoded = value.replace("-", "+").replace("_", "/")
        encoded += "=" * (-len(encoded) % 4)
        payload = base64.b64decode(encoded)
        if not payload.startswith(b"Salted__"):
            return None
        salt = payload[8:16]
        key, iv = _derive_key_and_iv(password.encode(), salt)
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

        decryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
        plain = decryptor.update(payload[16:]) + decryptor.finalize()
        pad = plain[-1]
        if not 1 <= pad <= 16 or plain[-pad:] != bytes([pad]) * pad:
            return None
        return plain[:-pad].decode("utf-8").strip()
    except (ValueError, TypeError, UnicodeDecodeError):
        return None


def decode_qr_input(value: Any) -> str | None:
    """Extract a certificate number from a TQC QR URL, payload, or plain number."""
    text = _text(value, 2000)
    if not text:
        return None
    parsed = urlsplit(text)
    if parsed.scheme and parsed.hostname:
        if parsed.hostname.lower() not in TQC_PUBLIC_QR_HOSTS:
            return None
        text = parse_qs(parsed.query).get("q", [""])[0]
    candidate = text
    if not _CERTIFICATE_RE.fullmatch(candidate):
        candidate = _decrypt_cryptojs_aes(candidate) or ""
    if not candidate or not _CERTIFICATE_RE.fullmatch(candidate):
        return None
    return candidate.upper()


class TqcCnhqClient:
    """Small synchronous client for the public TQC exact lookup API."""

    def __init__(
        self,
        *,
        base_url: str | None = None,
        api_key: str = "",
        timeout: float | None = None,
        rate_limit_per_minute: int | None = None,
        wait_on_rate_limit: bool = False,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        settings = get_settings()
        self.base_url = (base_url or settings.tqc_cnhq_base_url).rstrip("/")
        self.api_key = _text(api_key or settings.tqc_cnhq_api_key, 500)
        self.timeout = float(timeout or settings.tqc_cnhq_timeout)
        self.rate_limit_per_minute = max(1, int(rate_limit_per_minute or settings.tqc_cnhq_rate_limit_per_minute))
        self.wait_on_rate_limit = bool(wait_on_rate_limit)
        self._http = httpx.Client(timeout=self.timeout, transport=transport)

    def close(self) -> None:
        self._http.close()

    def _throttle(self) -> None:
        while True:
            now = time.monotonic()
            with _RATE_LIMIT_LOCK:
                started, calls = _RATE_LIMIT_WINDOWS.get(self.base_url, (now, 0))
                if now - started >= 60:
                    started, calls = now, 0
                if calls < self.rate_limit_per_minute:
                    _RATE_LIMIT_WINDOWS[self.base_url] = (started, calls + 1)
                    return
                if not self.wait_on_rate_limit:
                    raise TqcCnhqError("Đã chạm giới hạn gọi API TQC trong phút hiện tại", code="rate_limited", status=429)
                wait_seconds = max(0.01, 60 - (now - started))
            time.sleep(wait_seconds)

    def lookup(self, certificate_no: str) -> dict[str, Any] | None:
        normalized = normalize_certificate_no(certificate_no)
        path = f"/api/search/{quote(normalized, safe='')}"
        url = f"{self.base_url}{path}"
        headers = {"accept": "application/json"}
        if self.api_key:
            headers["x-api-key"] = self.api_key
        for attempt in range(3):
            self._throttle()
            try:
                response = self._http.get(url, headers=headers)
            except httpx.HTTPError as exc:
                if attempt < 2:
                    time.sleep(0.15 * (attempt + 1))
                    continue
                raise TqcCnhqError("Không kết nối được API TQC", code="upstream_unavailable") from exc
            if response.status_code == 200:
                try:
                    payload = response.json()
                except ValueError as exc:
                    raise TqcCnhqError(
                        "API TQC trả dữ liệu không hợp lệ",
                        code="invalid_upstream_response",
                        status=502,
                    ) from exc
                if isinstance(payload, dict) and payload.get("success") and isinstance(payload.get("data"), dict):
                    return normalize_certificate(
                        payload["data"],
                        source_url=url,
                        verification_status="verified_live",
                    )
                if isinstance(payload, dict) and payload.get("error") == "NOT_FOUND":
                    return None
                raise TqcCnhqError("API TQC trả dữ liệu không hợp lệ", code="invalid_upstream_response", status=502)
            if response.status_code == 401:
                raise TqcCnhqError("API TQC yêu cầu API key cho route này", code="api_key_rejected", status=401)
            if response.status_code == 429 or response.status_code >= 500:
                if attempt < 2:
                    time.sleep(0.15 * (attempt + 1))
                    continue
                raise TqcCnhqError("API TQC đang giới hạn hoặc tạm thời lỗi", code="upstream_retryable", status=response.status_code)
            raise TqcCnhqError("API TQC từ chối yêu cầu", code="upstream_rejected", status=response.status_code)
        raise TqcCnhqError("Không thể hoàn tất tra cứu TQC", code="upstream_unavailable")


def _norm(value: Any) -> str:
    return re.sub(r"\s+", " ", _strip_accents(_text(value, 2000))).strip()


def certificate_to_dict(
    row: TqcCertificate,
    *,
    verification_status: str | None = None,
) -> dict[str, Any]:
    derived_status = _derived_status(row.source_status, row.expiry_date)
    return {
        "certificate_no": row.certificate_no,
        "tax_code": getattr(row, "tax_code", "") or "",
        "issue_date": row.issue_date,
        "expiry_date": row.expiry_date,
        "applicant_name": row.applicant_name,
        "product_name": row.product_name,
        "model": row.model,
        "manufacturer": row.manufacturer,
        "factory_name": row.factory_name,
        "factory_address": row.factory_address,
        "technical_regulations": json.loads(row.technical_regulations_json or "[]"),
        "certification_method": row.certification_method,
        "serial_form_no": row.serial_form_no,
        "source_status": row.source_status,
        "derived_status": derived_status,
        "provenance": {
            "verification_status": verification_status or row.verification_status,
            "source_url": row.source_url,
            "checked_at": row.last_verified_at.isoformat() if row.last_verified_at else None,
        },
    }


def upsert_certificate(
    db: Session,
    raw: dict[str, Any],
    *,
    verification_status: str = "verified_cached",
    source_url: str = "",
    fetched_at: datetime | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    normalized = normalize_certificate(
        raw,
        fetched_at=fetched_at,
        source_url=source_url,
        verification_status=verification_status,
    )
    cert_no = normalized["certificate_no"]
    row = db.scalar(select(TqcCertificate).where(TqcCertificate.certificate_no == cert_no))
    if row is None:
        row = TqcCertificate(certificate_no=cert_no)
        db.add(row)
    row.certificate_no_norm = _norm(cert_no)
    row.tax_code = normalized.get("tax_code") or getattr(row, "tax_code", "") or ""
    row.tax_code_norm = _norm(row.tax_code)
    row.issue_date = normalized["issue_date"]
    row.expiry_date = normalized["expiry_date"]
    row.applicant_name = normalized["applicant_name"]
    row.applicant_norm = _norm(row.applicant_name)
    row.product_name = normalized["product_name"]
    row.product_norm = _norm(row.product_name)
    row.model = normalized["model"]
    row.model_norm = _norm(row.model)
    row.manufacturer = normalized["manufacturer"]
    row.manufacturer_norm = _norm(row.manufacturer)
    row.factory_name = normalized["factory_name"]
    row.factory_address = normalized["factory_address"]
    row.technical_regulations_json = json.dumps(normalized["technical_regulations"], ensure_ascii=False)
    row.certification_method = normalized["certification_method"]
    row.serial_form_no = normalized["serial_form_no"]
    row.source_status = normalized["source_status"]
    row.derived_status = normalized["derived_status"]
    row.verification_status = verification_status
    row.source_url = source_url or row.source_url
    row.raw_json = json.dumps(raw, ensure_ascii=False)
    row.last_verified_at = fetched_at or datetime.now(timezone.utc)
    if commit:
        db.commit()
    else:
        db.flush()
    return certificate_to_dict(row, verification_status=verification_status)


def search_index(
    db: Session,
    *,
    q: str = "",
    model: str = "",
    manufacturer: str = "",
    applicant: str = "",
    certificate_no: str = "",
    status: str = "",
    valid_on: str = "",
    page: int = 1,
    page_size: int = 20,
) -> dict[str, Any]:
    page = max(1, int(page))
    page_size = min(100, max(1, int(page_size)))
    status_changed = False
    for indexed in db.scalars(select(TqcCertificate)):
        current_status = _derived_status(indexed.source_status, indexed.expiry_date)
        if indexed.derived_status != current_status:
            indexed.derived_status = current_status
            status_changed = True
    if status_changed:
        db.commit()
    stmt = select(TqcCertificate)
    terms = []
    if q:
        needle = f"%{_norm(q)}%"
        terms.append(or_(
            TqcCertificate.certificate_no_norm.ilike(needle),
            TqcCertificate.model_norm.ilike(needle),
            TqcCertificate.manufacturer_norm.ilike(needle),
            TqcCertificate.applicant_norm.ilike(needle),
            TqcCertificate.product_norm.ilike(needle),
        ))
    for field, value in (
        (TqcCertificate.model_norm, model),
        (TqcCertificate.manufacturer_norm, manufacturer),
        (TqcCertificate.applicant_norm, applicant),
        (TqcCertificate.certificate_no_norm, certificate_no),
    ):
        if value:
            terms.append(field.ilike(f"%{_norm(value)}%"))
    if status:
        terms.append(TqcCertificate.derived_status == _text(status, 30).lower())
    if valid_on:
        parsed_valid_on = _parse_date(valid_on)
        if parsed_valid_on is None or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", valid_on):
            raise TqcCnhqError("valid_on phải có dạng YYYY-MM-DD", code="invalid_valid_on", status=422)
        terms.extend((
            func.date(TqcCertificate.issue_date, "+7 hours") <= valid_on,
            func.date(TqcCertificate.expiry_date, "+7 hours") >= valid_on,
            TqcCertificate.derived_status != "cancelled",
        ))
    if terms:
        stmt = stmt.where(*terms)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(TqcCertificate.updated_at.desc(), TqcCertificate.certificate_no.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    latest = db.scalar(select(func.max(TqcCertificate.updated_at)))
    return {
        "items": [certificate_to_dict(row, verification_status="verified_cached") for row in rows],
        "total": int(total),
        "page": page,
        "page_size": page_size,
        "search_scope": "local_index",
        "index_last_updated_at": latest.isoformat() if latest else None,
    }


def parse_import_csv(content: str, *, max_rows: int = 500) -> list[dict[str, str]]:
    if len(content.encode("utf-8")) > 5 * 1024 * 1024:
        raise TqcCnhqError("CSV vượt quá giới hạn 5 MB", code="import_too_large", status=413)
    reader = csv.DictReader(io.StringIO(content))
    rows: list[dict[str, str]] = []
    seen: set[str] = set()
    for index, raw in enumerate(reader, start=2):
        if index > max_rows + 1:
            raise TqcCnhqError("CSV vượt quá giới hạn số dòng", code="import_too_large", status=413)
        cert = _text(raw.get("certificate_no") or raw.get("so_giay_chung_nhan"), 120)
        qr = _text(raw.get("qr_url") or raw.get("qr_payload"), 2000)
        if not cert and not qr:
            continue
        key = f"cert:{cert.upper()}" if cert else f"qr:{qr}"
        if key in seen:
            continue
        seen.add(key)
        rows.append({"certificate_no": cert, "qr_input": qr})
    return rows


def import_entries(
    db: Session,
    entries: Iterable[dict[str, Any]],
    *,
    client: TqcCnhqClient,
    refresh_existing: bool = False,
    max_entries: int = 100,
    commit: bool = True,
) -> dict[str, Any]:
    entries = list(entries)
    if len(entries) > max_entries:
        raise TqcCnhqError(f"Mỗi lần import tối đa {max_entries} entry", code="import_too_large", status=413)
    results: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, entry in enumerate(entries):
        try:
            cert_no = normalize_certificate_no(entry.get("certificate_no")) if entry.get("certificate_no") else decode_qr_input(entry.get("qr_input"))
            if not cert_no:
                raise TqcCnhqError("Không đọc được số GCN từ entry", code="invalid_qr_input", status=422)
            if cert_no in seen:
                continue
            seen.add(cert_no)
            existing = db.scalar(select(TqcCertificate).where(TqcCertificate.certificate_no == cert_no))
            if existing and not refresh_existing:
                results.append({"certificate_no": cert_no, "status": "cached"})
                continue
            record = client.lookup(cert_no)
            if record is None:
                results.append({"certificate_no": cert_no, "status": "not_found_live"})
                continue
            results.append(upsert_certificate(
                db,
                record["raw"],
                verification_status="verified_live",
                source_url=record["provenance"]["source_url"],
                commit=commit,
            ) | {"status": "verified_live"})
        except TqcCnhqError as exc:
            errors.append({"index": index, "code": exc.code, "message": str(exc)})
        except Exception as exc:  # pragma: no cover - defensive boundary
            db.rollback()
            errors.append({"index": index, "code": "import_failed", "message": str(exc)[:300]})
    return {
        "requested": len(entries),
        "processed": len(results),
        "verified": sum(1 for row in results if row.get("status") == "verified_live"),
        "cached": sum(1 for row in results if row.get("status") == "cached"),
        "not_found": sum(1 for row in results if row.get("status") == "not_found_live"),
        "errors": errors,
        "items": results,
    }


def get_client(settings: Settings | None = None, *, wait_on_rate_limit: bool = False) -> TqcCnhqClient:
    settings = settings or get_settings()
    return TqcCnhqClient(
        base_url=settings.tqc_cnhq_base_url,
        api_key=settings.tqc_cnhq_api_key,
        timeout=settings.tqc_cnhq_timeout,
        rate_limit_per_minute=settings.tqc_cnhq_rate_limit_per_minute,
        wait_on_rate_limit=wait_on_rate_limit,
    )
