"""Tích hợp LIO Signer API (https://signer.liotech.vn) — Ký số PDF từ xa của HKD Công nghệ LIO (CAS CERT / CMC-CA).

Hỗ trợ:
1. Gửi hồ sơ PDF từ Kho hồ sơ vận hành sang LIO Signer (`POST /v1/sessions`) kèm `Idempotency-Key`.
2. Tự động nhận diện vị trí ký qua chữ ẩn `[[LIO_SIGN]]` (`marker`), họ tên `HUỲNH ĐỨC NHÂM` (`anchor_name`), hoặc tọa độ chỉ định.
3. Worker chạy ngầm định kỳ (mặc định 20 giây/lần) gọi `status_polling_url` cho các hồ sơ đang ở trạng thái `pending` / `waiting_approval`.
4. Khi chuyển sang `signed`: tự động tải file PDF đã ký về kho lưu trữ `storage`, cập nhật bản chính & bản đã ký (`signed_upload_id`), đồng bộ NAS và bắn thông báo Telegram.
5. Hỗ trợ thêm cổng nhận Webhook (`POST /api/lio-signer/webhook`) xác thực chữ ký HMAC-SHA256 trên raw body.
6. Gửi lại bản hợp đồng đã đủ chữ ký hai bên về LIO (`POST /v1/sessions/{session_id}/countersigned`) trong vòng 7 ngày.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import nas, storage, telegram
from .config import Settings, get_settings
from .db import Document, TelegramConnection, User, get_session
from .security_utils import safe_http_get, validate_outbound_url

logger = logging.getLogger(__name__)

_worker_started = False
_worker_lock = threading.Lock()

ACTIVE_LIO_STATUSES = ("pending", "waiting_approval", "processing")
TERMINAL_LIO_STATUSES = ("signed", "rejected", "failed", "expired")


MAX_COUNTERSIGNED_PDF_BYTES = 20 * 1024 * 1024  # 20 MiB theo mục 7 tài liệu LIO Signer API

COUNTERSIGNED_ERROR_MESSAGES: dict[str, str] = {
    "NO_OWNER_SIGNATURE": "File không có chữ ký số nào của LIO",
    "NOT_FROM_THIS_SESSION": "Phần LIO đã ký không khớp file của phiên này (lưu ý phải ký nối tiếp trực tiếp lên file PDF tải về từ LIO, không in/quét hoặc lưu xuất lại PDF mới trước khi ký)",
    "OWNER_SIGNATURE_INVALID": "Chữ ký số của LIO trong file không còn hợp lệ",
    "NO_NEW_SIGNATURE": "Chưa có chữ ký số mới của bên bạn (iNut) sau chữ ký của LIO",
    "SIGNATURE_INVALID": "Chữ ký số mới thêm vào không hợp lệ",
    "UNSIGNED_CHANGES": "File PDF bị chỉnh sửa sau chữ ký cuối cùng",
    "TOO_MANY_SIGNATURES": "File có quá 20 ô chữ ký",
    "WINDOW_CLOSED": "Đã quá hạn 7 ngày kể từ khi tạo phiên ký LIO (hãy tạo phiên mới)",
    "FILE_TOO_LARGE": "Tệp PDF vượt quá giới hạn 20 MiB",
    "NOT_FOUND": "Không tìm thấy phiên ký trên LIO (hoặc phiên đã quá hạn và bị xoá)",
    "RATE_LIMITED": "Gửi quá nhanh (vượt giới hạn 30 request/phút)",
}

class LioSignerError(RuntimeError):
    """Lỗi giao tiếp hoặc nghiệp vụ từ LIO Signer API."""

    def __init__(self, message: str, status_code: int = 400, error_code: str = "LIO_ERROR"):
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _lio_allowed_hosts(settings: Settings) -> tuple[str, ...]:
    host = (urlsplit(settings.lio_signer_base_url or "").hostname or "").lower().rstrip(".")
    return (host,) if host else ("signer.liotech.vn",)


def _validate_lio_url(url: str, settings: Settings, label: str = "URL LIO Signer") -> str:
    allowed = _lio_allowed_hosts(settings)
    try:
        return validate_outbound_url(url, allowed_hosts=allowed)
    except ValueError as exc:
        raise LioSignerError(f"{label} không hợp lệ hoặc ngoài tên miền LIO Signer", 400, "INVALID_URL") from exc


def _notify_admins_telegram(db: Session, settings: Settings, text: str) -> None:
    """Gửi thông báo Telegram tới các tài khoản admin đang kết nối."""
    if not settings.telegram_enabled or not settings.telegram_bot_token or not settings.telegram_notify_enabled:
        return
    try:
        rows = list(
            db.scalars(
                select(TelegramConnection)
                .join(User, User.id == TelegramConnection.user_id)
                .where(TelegramConnection.status == "active", User.role == "admin")
            )
        )
        if not rows:
            return
        client = telegram.TelegramClient(settings)
        try:
            for conn in rows:
                if conn.chat_id:
                    client.send_message(conn.chat_id, text, parse_mode="HTML")
        finally:
            client.close()
    except Exception as exc:
        logger.warning("Không gửi được thông báo Telegram LIO Signer: %s", exc)


def check_health(settings: Settings) -> dict[str, Any]:
    """Kiểm tra cấu hình và kết nối tới LIO Signer (/healthz)."""
    base = settings.lio_signer_base_url.rstrip("/")
    configured = bool(settings.lio_signer_enabled and settings.lio_signer_api_key.strip())
    reachable = False
    health_data: dict[str, Any] = {}
    error_msg = ""
    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.get(f"{base}/healthz", headers={"User-Agent": "inut-ksp-pdfsign/1.0"})
            if r.status_code == 200:
                reachable = True
                health_data = r.json() if r.content else {"ok": True}
            else:
                error_msg = f"HTTP {r.status_code}"
    except Exception as exc:
        error_msg = str(exc)

    return {
        "enabled": bool(settings.lio_signer_enabled),
        "configured": configured,
        "base_url": base,
        "webhook_configured": bool(settings.lio_signer_webhook_url.strip()),
        "poll_interval_seconds": settings.lio_signer_poll_interval_seconds,
        "reachable": reachable,
        "health": health_data,
        "error": error_msg,
    }


def submit_document(
    db: Session,
    settings: Settings,
    d: Document,
    *,
    force_new: bool = False,
    signature_pos: dict[str, Any] | None = None,
) -> Document:
    """Gửi một hồ sơ PDF lên LIO Signer (POST /v1/sessions) và lưu thông tin phiên ký."""
    if not settings.lio_signer_enabled:
        raise LioSignerError("Tính năng LIO Signer đang tắt trong cấu hình", 400, "DISABLED")
    api_key = settings.lio_signer_api_key.strip()
    if not api_key:
        raise LioSignerError("Chưa cấu hình LIO_SIGNER_API_KEY trên máy chủ", 400, "MISSING_API_KEY")

    found = storage.find_doc_path(d.doc_id)
    if not found:
        raise LioSignerError("Không tìm thấy tệp gốc trong kho hồ sơ", 404, "FILE_NOT_FOUND")
    fpath, suffix = found
    raw_bytes = fpath.read_bytes()
    if suffix.lower() != ".pdf" or not raw_bytes.startswith(b"%PDF"):
        raise LioSignerError("LIO Signer chỉ hỗ trợ ký số trên tệp PDF (.pdf)", 400, "NOT_PDF")

    # Nếu đang có phiên chờ duyệt và không yêu cầu tạo phiên mới -> chỉ poll cập nhật trạng thái
    if (
        not force_new
        and d.lio_session_id
        and d.lio_polling_url
        and d.lio_status in ACTIVE_LIO_STATUSES
    ):
        return poll_document(db, settings, d, notify_telegram=True)

    idem_key = f"inut-doc-{d.id}-{d.doc_id[:16]}"
    if force_new or d.lio_status in TERMINAL_LIO_STATUSES:
        idem_key = f"{idem_key}-{int(time.time())}"
    idem_key = idem_key[:128]

    file_item: dict[str, Any] = {
        "filename": d.filename if d.filename.lower().endswith(".pdf") else f"{d.filename}.pdf",
        "content": base64.b64encode(raw_bytes).decode("ascii"),
    }
    if signature_pos:
        file_item["signature"] = signature_pos

    payload: dict[str, Any] = {"files": [file_item]}
    if settings.lio_signer_webhook_url.strip():
        payload["webhook"] = settings.lio_signer_webhook_url.strip()

    base = settings.lio_signer_base_url.rstrip("/")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Idempotency-Key": idem_key,
        "User-Agent": "inut-ksp-pdfsign/1.0",
    }

    try:
        with httpx.Client(timeout=settings.lio_signer_timeout) as client:
            resp = client.post(f"{base}/v1/sessions", json=payload, headers=headers)
    except Exception as exc:
        raise LioSignerError(f"Không kết nối được tới LIO Signer: {exc}", 502, "NETWORK_ERROR") from exc

    if resp.status_code not in (200, 201):
        err_code = f"HTTP_{resp.status_code}"
        err_msg = f"LIO Signer trả lỗi HTTP {resp.status_code}"
        try:
            j = resp.json()
            err_code = j.get("error") or err_code
            detail_msg = j.get("message") or ""
            details = j.get("details")
            if isinstance(details, list) and details:
                first_err = details[0].get("error") or ""
                err_msg = f"{err_code}: {detail_msg} ({first_err})"
            elif detail_msg:
                err_msg = f"{err_code}: {detail_msg}"
        except Exception:
            pass
        status_out = 400 if 400 <= resp.status_code < 500 else 502
        raise LioSignerError(err_msg, status_out, err_code)

    data = resp.json()
    files_out = data.get("files") or []
    first_file = files_out[0] if files_out else {}

    d.lio_session_id = data.get("session_id") or ""
    d.lio_status = "pending"
    d.lio_polling_url = data.get("status_polling_url") or ""
    d.lio_file_url = first_file.get("url") or ""
    d.lio_expires_at = data.get("expires_at") or ""
    d.lio_requested_at = _now()
    d.lio_signed_at = ""
    d.lio_reason = ""
    d.lio_countersigned_status = ""
    d.lio_countersigned_file_id = ""
    d.lio_countersigned_error = ""
    d.lio_countersigned_signatures_json = "[]"
    db.commit()
    db.refresh(d)

    # Poll ngay 1 nhịp để lấy placement_method (marker / anchor_name) và trạng thái waiting_approval
    try:
        d = poll_document(db, settings, d, notify_telegram=True)
    except Exception as exc:
        logger.warning("Poll đầu tiên sau khi tạo phiên LIO %s gặp lỗi nhẹ: %s", d.lio_session_id, exc)

    return d


def _apply_signed_pdf_bytes(
    db: Session,
    settings: Settings,
    d: Document,
    signed_bytes: bytes,
    *,
    signed_at_str: str = "",
    placement_method: str = "",
    notify_telegram: bool = True,
) -> Document:
    """Lưu mảng byte PDF đã được LIO ký số vào kho hồ sơ, cập nhật trạng thái và đồng bộ NAS."""
    if not signed_bytes.startswith(b"%PDF"):
        raise LioSignerError("Tệp tải về từ LIO Signer không phải PDF hợp lệ", 502, "INVALID_SIGNED_PDF")

    new_doc_id = storage.save_upload(signed_bytes, suffix=".pdf")
    d.doc_id = new_doc_id
    d.signed_upload_id = new_doc_id
    clean_name = d.filename if d.filename.lower().endswith(".pdf") else f"{d.filename}.pdf"
    d.signed_upload_name = clean_name if clean_name.lower().startswith("da-ky") else f"da-ky-lio-{clean_name}"
    d.signed_upload_at = datetime.utcnow()
    d.signed = True
    if "HUỲNH ĐỨC NHÂM" not in (d.signer_name or "").upper():
        d.signer_name = (
            f"{d.signer_name} · HUỲNH ĐỨC NHÂM (HKD LIO)"
            if (d.signer_name or "").strip()
            else "HUỲNH ĐỨC NHÂM (HKD CÔNG NGHỆ LIO)"
        )
    d.lio_status = "signed"
    if signed_at_str:
        d.lio_signed_at = signed_at_str
    elif not d.lio_signed_at:
        d.lio_signed_at = _now().isoformat()
    if placement_method:
        d.lio_placement_method = placement_method
    d.lio_reason = ""
    db.commit()
    db.refresh(d)

    # Sao lưu NAS (best-effort)
    if settings.nas_enabled:
        try:
            cust_name = d.customer.name if d.customer else ""
            nas.sync_document(settings, db, d)
            nas.sync_extra_file(settings, cust_name, "da-ky", d.signed_upload_name, signed_bytes)
            db.refresh(d)
        except Exception as exc:
            logger.warning("Đồng bộ NAS cho hồ sơ đã ký LIO #%s thất bại: %s", d.id, exc)

    if notify_telegram:
        msg = (
            f"🖊 <b>[LIO SIGNER] ĐÃ KÝ SỐ HOÀN TẤT</b>\n"
            f"• Hồ sơ: <b>{d.filename}</b> (#{d.id})\n"
            f"• Người ký: <b>HUỲNH ĐỨC NHÂM (HKD Công nghệ LIO — CAS CERT)</b>\n"
            f"• Phiên ký: <code>{d.lio_session_id}</code>\n"
            f"• Vị trí đặt dấu: <code>{d.lio_placement_method or 'auto'}</code>\n"
            f"• Thời điểm ký: <code>{d.lio_signed_at}</code>"
        )
        _notify_admins_telegram(db, settings, msg)

    return d


def poll_document(
    db: Session,
    settings: Settings,
    d: Document,
    *,
    notify_telegram: bool = True,
) -> Document:
    """Hỏi trạng thái phiên ký qua status_polling_url và tự động tải PDF nếu đã ký xong."""
    if not d.lio_polling_url:
        raise LioSignerError("Hồ sơ này chưa có phiên ký LIO để kiểm tra", 400, "NO_SESSION")

    prev_status = d.lio_status or ""
    allowed_hosts = _lio_allowed_hosts(settings)
    polling_url = _validate_lio_url(d.lio_polling_url, settings, "status_polling_url")
    try:
        resp = safe_http_get(
            polling_url,
            allowed_hosts=allowed_hosts,
            headers={"User-Agent": "inut-ksp-pdfsign/1.0"},
            timeout=settings.lio_signer_timeout,
        )
    except ValueError as exc:
        raise LioSignerError("URL kiểm tra trạng thái LIO Signer không hợp lệ", 400, "INVALID_URL") from exc
    except Exception as exc:
        raise LioSignerError(f"Lỗi kết nối khi kiểm tra trạng thái LIO Signer: {exc}", 502, "POLL_NETWORK_ERROR") from exc

    if resp.status_code == 404:
        d.lio_status = "expired"
        d.lio_reason = "session_expired_or_not_found"
        db.commit()
        db.refresh(d)
        return d

    if resp.status_code != 200:
        raise LioSignerError(f"LIO Signer trả mã HTTP {resp.status_code} khi hỏi trạng thái", 502, "POLL_HTTP_ERROR")

    data = resp.json()
    if data.get("expires_at"):
        d.lio_expires_at = data["expires_at"]
    files_list = data.get("files") or []
    f_info = files_list[0] if files_list else {}

    new_status = f_info.get("status") or data.get("status") or d.lio_status
    placement = f_info.get("placement_method") or d.lio_placement_method or ""
    reason = f_info.get("reason") or ""
    signed_at_str = f_info.get("signed_at") or d.lio_signed_at or ""
    file_url = f_info.get("url") or d.lio_file_url or ""

    d.lio_status = new_status
    if placement:
        d.lio_placement_method = placement
    d.lio_reason = reason
    if signed_at_str:
        d.lio_signed_at = signed_at_str
    if file_url:
        d.lio_file_url = _validate_lio_url(file_url, settings, "file_url")

    if new_status == "signed":
        # Nếu vừa chuyển sang signed hoặc chưa lưu bản đã ký -> tải ngay file PDF đã ký về kho
        already_saved = prev_status == "signed" and bool(d.signed_upload_id) and storage.exists(d.doc_id)
        if not already_saved:
            if not d.lio_file_url:
                raise LioSignerError("Phiên báo đã ký nhưng thiếu URL tải file", 502, "MISSING_FILE_URL")
            validated_file_url = _validate_lio_url(d.lio_file_url, settings, "file_url")
            try:
                fresp = safe_http_get(
                    validated_file_url,
                    allowed_hosts=allowed_hosts,
                    headers={"User-Agent": "inut-ksp-pdfsign/1.0"},
                    timeout=settings.lio_signer_timeout,
                    max_bytes=MAX_COUNTERSIGNED_PDF_BYTES,
                )
            except ValueError as exc:
                raise LioSignerError("URL tải PDF LIO Signer không hợp lệ", 400, "INVALID_URL") from exc
            if fresp.status_code == 200 and fresp.content.startswith(b"%PDF"):
                return _apply_signed_pdf_bytes(
                    db,
                    settings,
                    d,
                    fresp.content,
                    signed_at_str=signed_at_str,
                    placement_method=placement,
                    notify_telegram=notify_telegram,
                )
            raise LioSignerError(f"Không tải được PDF đã ký (HTTP {fresp.status_code})", 502, "DOWNLOAD_FAILED")

    db.commit()
    db.refresh(d)

    if new_status in ("rejected", "failed", "expired") and prev_status != new_status and notify_telegram:
        msg = (
            f"⚠️ <b>[LIO SIGNER] PHIÊN KÝ KHÔNG THÀNH CÔNG ({new_status.upper()})</b>\n"
            f"• Hồ sơ: <b>{d.filename}</b> (#{d.id})\n"
            f"• Phiên ký: <code>{d.lio_session_id}</code>\n"
            f"• Lý do: <code>{d.lio_reason or new_status}</code>"
        )
        _notify_admins_telegram(db, settings, msg)

    return d


def bind_existing_session(
    db: Session,
    settings: Settings,
    d: Document,
    *,
    session_id: str,
    polling_url: str,
    file_url: str = "",
    expires_at: str = "",
    notify_telegram: bool = True,
) -> Document:
    """Gắn một phiên ký LIO đã tạo sẵn vào hồ sơ và đồng bộ trạng thái/tải file đã ký."""
    validated_polling = _validate_lio_url(polling_url.strip(), settings, "polling_url")
    validated_file = _validate_lio_url(file_url.strip(), settings, "file_url") if file_url.strip() else ""
    d.lio_session_id = session_id.strip()
    d.lio_polling_url = validated_polling
    if validated_file:
        d.lio_file_url = validated_file
    if expires_at.strip():
        d.lio_expires_at = expires_at.strip()
    if not d.lio_requested_at:
        d.lio_requested_at = _now()
    if not d.lio_status:
        d.lio_status = "pending"
    db.commit()
    db.refresh(d)
    return poll_document(db, settings, d, notify_telegram=notify_telegram)



def submit_countersigned_document(
    db: Session,
    settings: Settings,
    d: Document,
    *,
    pdf_bytes: bytes | None = None,
    filename: str | None = None,
    notify_telegram: bool = True,
) -> Document:
    """Gửi bản PDF đã đủ chữ ký hai bên về LIO (POST /v1/sessions/{session_id}/countersigned)."""
    if not settings.lio_signer_enabled:
        raise LioSignerError("Tính năng LIO Signer đang tắt trong cấu hình", 400, "DISABLED")
    api_key = settings.lio_signer_api_key.strip()
    if not api_key:
        raise LioSignerError("Chưa cấu hình LIO_SIGNER_API_KEY trên máy chủ", 400, "MISSING_API_KEY")

    session_id = (d.lio_session_id or "").strip()
    if not session_id:
        raise LioSignerError(
            "Hồ sơ này chưa có phiên ký LIO (session_id) để gửi bản ký hai bên",
            400,
            "NO_SESSION",
        )

    raw_bytes = pdf_bytes
    if raw_bytes is None:
        if d.signed_upload_id and storage.exists(d.signed_upload_id):
            raw_bytes = storage.read_doc(d.signed_upload_id)
        elif d.doc_id and storage.exists(d.doc_id):
            raw_bytes = storage.read_doc(d.doc_id)
        else:
            raise LioSignerError("Không tìm thấy tệp PDF đã ký trong kho hồ sơ", 404, "FILE_NOT_FOUND")

    if not raw_bytes.startswith(b"%PDF"):
        raise LioSignerError("Tệp gửi đi không phải PDF hợp lệ", 400, "NOT_PDF")
    if len(raw_bytes) > MAX_COUNTERSIGNED_PDF_BYTES:
        raise LioSignerError("Tệp PDF vượt quá giới hạn 20 MiB của LIO Signer", 413, "FILE_TOO_LARGE")

    fname = (filename or d.signed_upload_name or d.filename or f"da-ky-hai-ben-{d.id}.pdf").strip()
    if not fname.lower().endswith(".pdf"):
        fname = f"{fname}.pdf"

    base = settings.lio_signer_base_url.rstrip("/")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "User-Agent": "inut-ksp-pdfsign/1.0",
    }
    payload = {
        "filename": fname,
        "content": base64.b64encode(raw_bytes).decode("ascii"),
    }

    try:
        with httpx.Client(timeout=max(settings.lio_signer_timeout, 120.0)) as client:
            resp = client.post(
                f"{base}/v1/sessions/{session_id}/countersigned",
                json=payload,
                headers=headers,
            )
    except Exception as exc:
        raise LioSignerError(f"Không kết nối được tới LIO Signer: {exc}", 502, "NETWORK_ERROR") from exc

    if resp.status_code != 200:
        err_code = f"HTTP_{resp.status_code}"
        detail_msg = ""
        try:
            j = resp.json()
            err_code = j.get("error") or err_code
            detail_msg = j.get("message") or ""
        except Exception:
            pass
        vi_hint = COUNTERSIGNED_ERROR_MESSAGES.get(err_code, "")
        if vi_hint and detail_msg:
            err_msg = f"{err_code}: {vi_hint} ({detail_msg})"
        elif vi_hint:
            err_msg = f"{err_code}: {vi_hint}"
        elif detail_msg:
            err_msg = f"{err_code}: {detail_msg}"
        else:
            err_msg = f"LIO Signer trả lỗi HTTP {resp.status_code} ({err_code})"

        d.lio_countersigned_status = "failed"
        d.lio_countersigned_error = err_msg[:255]
        db.commit()
        db.refresh(d)

        status_out = resp.status_code if 400 <= resp.status_code < 500 else 502
        raise LioSignerError(err_msg, status_out, err_code)

    data = resp.json()
    file_id = (data.get("file_id") or "").strip()
    received_at = (data.get("received_at") or "").strip() or _now().isoformat()
    replaced = bool(data.get("replaced"))
    signatures = data.get("signatures") if isinstance(data.get("signatures"), list) else []

    d.lio_countersigned_status = "sent"
    d.lio_countersigned_at = received_at
    d.lio_countersigned_file_id = file_id
    d.lio_countersigned_error = ""
    d.lio_countersigned_signatures_json = json.dumps(signatures, ensure_ascii=False)

    # Cập nhật tên người ký từ danh sách chữ ký được LIO xác nhận
    for sig in signatures:
        signer_label = (sig.get("signer") or "").strip()
        if signer_label and signer_label.upper() not in (d.signer_name or "").upper():
            d.signer_name = f"{d.signer_name} · {signer_label}" if (d.signer_name or "").strip() else signer_label

    db.commit()
    db.refresh(d)

    if notify_telegram:
        sig_lines = []
        for s in signatures:
            s_name = s.get("signer") or "?"
            s_ser = s.get("serial") or ""
            s_ok = "✓" if s.get("valid", True) else "✗"
            sig_lines.append(f"{s_name} ({s_ser[:10]}… {s_ok})" if s_ser else f"{s_name} ({s_ok})")
        sig_summary = " | ".join(sig_lines) if sig_lines else "Đã xác nhận đủ chữ ký 2 bên"
        msg = (
            f"🤝 <b>[LIO SIGNER] ĐÃ GỬI BẢN KÝ HAI BÊN VỀ LIO</b>\n"
            f"• Hồ sơ: <b>{d.filename}</b> (#{d.id})\n"
            f"• Phiên ký: <code>{d.lio_session_id}</code> · File: <code>{file_id or 'ok'}</code>"
            f"{' (thay thế bản cũ)' if replaced else ''}\n"
            f"• Thời điểm LIO nhận: <code>{received_at}</code>\n"
            f"• Chữ ký ({len(signatures)}): <code>{sig_summary}</code>"
        )
        _notify_admins_telegram(db, settings, msg)

    return d

def verify_webhook_signature(
    secret_hex: str,
    timestamp_header: str,
    signature_header: str,
    raw_body: bytes,
    *,
    max_skew_seconds: int = 300,
) -> bool:
    """Xác thực chữ ký HMAC-SHA256 của Webhook LIO Signer trên raw body."""
    if not secret_hex or not timestamp_header or not signature_header:
        return False
    try:
        ts_int = int(timestamp_header.strip())
    except ValueError:
        return False
    if abs(time.time() - ts_int) > max_skew_seconds:
        return False
    try:
        key_bytes = bytes.fromhex(secret_hex.strip())
    except ValueError:
        return False
    mac = hmac.new(key_bytes, timestamp_header.strip().encode("ascii") + b"." + raw_body, hashlib.sha256).hexdigest()
    expected = f"sha256={mac}"
    return hmac.compare_digest(signature_header.strip(), expected)


def process_webhook_event(
    db: Session,
    settings: Settings,
    delivery_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Xử lý sự kiện webhook (file.signed / file.failed / session.completed) từ LIO Signer."""
    session_id = (payload.get("session_id") or "").strip()
    event = (payload.get("event") or "").strip()
    if not session_id:
        return {"ok": False, "reason": "missing_session_id"}

    d = db.scalar(select(Document).where(Document.lio_session_id == session_id))
    if not d:
        return {"ok": True, "ignored": "session_not_found"}

    if delivery_id and d.lio_last_delivery_id == delivery_id:
        return {"ok": True, "duplicate": True, "document_id": d.id}

    if delivery_id:
        d.lio_last_delivery_id = delivery_id
    if payload.get("url"):
        d.lio_file_url = _validate_lio_url(str(payload["url"]), settings, "webhook file_url")
    db.commit()

    if d.lio_polling_url:
        poll_document(db, settings, d, notify_telegram=True)
    elif event == "file.signed" and d.lio_file_url:
        validated_file_url = _validate_lio_url(d.lio_file_url, settings, "file_url")
        fresp = safe_http_get(
            validated_file_url,
            allowed_hosts=_lio_allowed_hosts(settings),
            headers={"User-Agent": "inut-ksp-pdfsign/1.0"},
            timeout=settings.lio_signer_timeout,
            max_bytes=MAX_COUNTERSIGNED_PDF_BYTES,
        )
        if fresp.status_code == 200 and fresp.content.startswith(b"%PDF"):
            _apply_signed_pdf_bytes(
                db,
                settings,
                d,
                fresp.content,
                signed_at_str=payload.get("occurred_at") or "",
                notify_telegram=True,
            )
    elif event == "file.failed":
        d.lio_status = payload.get("status") or "failed"
        d.lio_reason = payload.get("reason") or "webhook_failed"
        db.commit()

    return {"ok": True, "document_id": d.id, "lio_status": d.lio_status}


def poll_all_pending_documents(db: Session, settings: Settings) -> int:
    """Quét và cập nhật trạng thái cho toàn bộ hồ sơ đang chờ LIO duyệt ký."""
    if not settings.lio_signer_enabled:
        return 0
    pending_docs = list(
        db.scalars(
            select(Document).where(
                Document.lio_status.in_(ACTIVE_LIO_STATUSES),
                Document.lio_polling_url != "",
            )
        )
    )
    count = 0
    for d in pending_docs:
        try:
            poll_document(db, settings, d, notify_telegram=True)
            count += 1
        except Exception as exc:
            logger.warning("Lỗi poll phiên LIO %s của hồ sơ #%s: %s", d.lio_session_id, d.id, exc)
    return count


def start_lio_signer_worker(settings: Settings) -> None:
    """Khởi chạy background thread định kỳ poll các phiên ký LIO đang chờ duyệt."""
    global _worker_started
    with _worker_lock:
        if _worker_started:
            return
        _worker_started = True

    def _loop() -> None:
        logger.info("LioSignerWorker started (interval=%ss)", settings.lio_signer_poll_interval_seconds)
        while True:
            interval = max(10, int(getattr(settings, "lio_signer_poll_interval_seconds", 20) or 20))
            try:
                cur_settings = get_settings()
                for db in get_session():
                    poll_all_pending_documents(db, cur_settings)
            except Exception as exc:
                logger.warning("Lỗi vòng lặp LioSignerWorker: %s", exc)
            time.sleep(interval)

    t = threading.Thread(target=_loop, daemon=True, name="LioSignerWorker")
    t.start()
