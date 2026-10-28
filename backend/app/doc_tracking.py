"""Theo doi luot xem ho so: HMAC nonce, GeoIP, cooldown, Telegram dispatch.

Luong:
1. Khi render /s/{token}: sinh HMAC nonce (60s TTL, 1 lan) nhung vao HTML.
2. Browser goi ipwho.is / Cloudflare trace lay IP/Geo that, gui POST /api/doc-telemetry
   kem nonce + fingerprint.
3. Backend verify nonce, check cooldown (10 min/IP/doc), luu document_views,
   ban Telegram neu document_tracking.enabled va chua het han.
4. Fallback: khi /api/share/{token}/download hoac /view duoc goi truc tiep
   (khong qua JS), ghi 1 view tu X-Forwarded-For/X-Real-IP.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings
from .db import Document, DocumentTracking, DocumentView, get_session

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# HMAC Nonce (One-Time, 60s TTL)
# ---------------------------------------------------------------------------
_NONCE_TTL = 60  # seconds
_used_nonces: dict[str, float] = {}  # nonce_hex -> expiry timestamp
_nonce_lock = threading.Lock()
_NONCE_CLEANUP_INTERVAL = 300  # purge stale entries every 5 min
_last_cleanup = 0.0


def _nonce_secret(settings: Settings) -> str:
    return "doctrack:" + settings.effective_jwt_secret()


def generate_nonce(
    settings: Settings,
    *,
    share_token: str = "",
    document_id: int = 0,
    user_agent: str = "",
) -> str:
    """Sinh HMAC-SHA256 nonce gan vao HTML, het han sau 60s, dung 1 lan."""
    ts = int(time.time())
    ts_window = ts // _NONCE_TTL  # 60-second bucket
    ua_hash = hashlib.sha256(user_agent.encode()).hexdigest()[:16]
    payload = f"{share_token}:{document_id}:{ts_window}:{ua_hash}"
    mac = hmac.new(
        _nonce_secret(settings).encode(), payload.encode(), hashlib.sha256
    ).hexdigest()
    # nonce = mac:ts (ts cho phep backend biet thoi gian tao)
    return f"{mac}:{ts}"


def verify_nonce(
    settings: Settings,
    nonce: str,
    *,
    share_token: str = "",
    document_id: int = 0,
    user_agent: str = "",
) -> bool:
    """Verify nonce: dung HMAC, chua het han, chua dung."""
    parts = nonce.split(":", 1)
    if len(parts) != 2:
        return False
    mac_given, ts_str = parts
    try:
        ts = int(ts_str)
    except ValueError:
        return False

    now = time.time()
    if now - ts > _NONCE_TTL:
        return False  # het han

    # Replay check
    with _nonce_lock:
        _maybe_cleanup(now)
        if nonce in _used_nonces:
            return False
        _used_nonces[nonce] = now + _NONCE_TTL + 10  # keep a bit longer

    # Verify HMAC
    ts_window = ts // _NONCE_TTL
    ua_hash = hashlib.sha256(user_agent.encode()).hexdigest()[:16]
    payload = f"{share_token}:{document_id}:{ts_window}:{ua_hash}"
    expected = hmac.new(
        _nonce_secret(settings).encode(), payload.encode(), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(mac_given, expected)


def _maybe_cleanup(now: float) -> None:
    global _last_cleanup
    if now - _last_cleanup < _NONCE_CLEANUP_INTERVAL:
        return
    _last_cleanup = now
    stale = [k for k, exp in _used_nonces.items() if exp < now]
    for k in stale:
        del _used_nonces[k]


# ---------------------------------------------------------------------------
# Cooldown: 10 min per (IP, document_id) for Telegram notifications
# Max 3 Telegram messages per 10 min per IP (across all docs)
# ---------------------------------------------------------------------------
_COOLDOWN_SECONDS = 600  # 10 min
_MAX_NOTIFS_PER_IP = 3
_cooldown_cache: dict[str, float] = {}  # "ip:doc_id:action_bucket" -> last_notified_ts
_ip_notif_counts: dict[str, list[float]] = {}  # ip -> [timestamps of recent notifs]
_cooldown_lock = threading.Lock()


def _should_notify(ip: str, document_id: int, action: str) -> bool:
    """Return True if this view should trigger a Telegram notification.

    Rules:
    - Same IP+doc 'view' action: cooldown 10 min
    - download/neac: always notify (but still rate-limited to 3/10min per IP)
    - Max 3 notifications per IP per 10 min
    """
    now = time.time()
    with _cooldown_lock:
        # Rate limit: max 3 per IP per 10 min
        timestamps = _ip_notif_counts.get(ip, [])
        timestamps = [t for t in timestamps if now - t < _COOLDOWN_SECONDS]
        if len(timestamps) >= _MAX_NOTIFS_PER_IP:
            return False

        # For 'view' action: cooldown per IP+doc
        if action == "view":
            key = f"{ip}:{document_id}:view"
            last = _cooldown_cache.get(key, 0)
            if now - last < _COOLDOWN_SECONDS:
                return False
            _cooldown_cache[key] = now

        # Record notification
        timestamps.append(now)
        _ip_notif_counts[ip] = timestamps
        return True


# ---------------------------------------------------------------------------
# Record view + dispatch Telegram
# ---------------------------------------------------------------------------
_notify_executor: ThreadPoolExecutor | None = None


def record_view(
    db: Session,
    settings: Settings,
    *,
    document_id: int,
    action: str = "view",
    ip: str = "",
    city: str = "",
    region: str = "",
    isp: str = "",
    country_code: str = "",
    device_type: str = "",
    user_agent_hash: str = "",
    fingerprint_hash: str = "",
    source: str = "",
    nonce: str = "",
) -> DocumentView:
    """Luu 1 luot xem vao document_views. Bat Telegram neu can."""
    view = DocumentView(
        document_id=document_id,
        action=action,
        ip=ip,
        city=city,
        region=region,
        isp=isp,
        country_code=country_code,
        device_type=device_type,
        user_agent_hash=user_agent_hash,
        fingerprint_hash=fingerprint_hash,
        source=source,
        nonce=nonce,
        notified=False,
    )
    db.add(view)

    # Check tracking config
    tracking = db.scalar(
        select(DocumentTracking).where(
            DocumentTracking.document_id == document_id,
            DocumentTracking.enabled.is_(True),
        )
    )
    should_tg = False
    if tracking:
        # Check if not expired
        if tracking.expires_at is None or datetime.utcnow() <= tracking.expires_at:
            if _should_notify(ip, document_id, action):
                should_tg = True
                view.notified = True

    db.commit()
    db.refresh(view)

    if should_tg:
        doc = db.get(Document, document_id)
        _enqueue_telegram(settings, view, doc, tracking)

    return view


def _enqueue_telegram(
    settings: Settings,
    view: DocumentView,
    doc: Document | None,
    tracking: DocumentTracking | None,
) -> None:
    global _notify_executor
    if not settings.telegram_enabled or not settings.telegram_bot_token:
        return
    if _notify_executor is None:
        _notify_executor = ThreadPoolExecutor(
            max_workers=2, thread_name_prefix="doctrack-tg"
        )
    _notify_executor.submit(
        _send_telegram_alert, settings, view.id, doc, tracking
    )


def _send_telegram_alert(
    settings: Settings,
    view_id: int,
    doc: Document | None,
    tracking: DocumentTracking | None,
) -> None:
    from .telegram import TelegramClient, TelegramError, admin_chat_ids

    gen = get_session()
    db = next(gen)
    try:
        chat_ids = admin_chat_ids(db)
        if not chat_ids:
            return
        view = db.get(DocumentView, view_id)
        if not view:
            return

        action_label = {
            "view": "👁 <b>Đang xem</b>",
            "download": "⬇️ <b>Tải xuống</b>",
            "neac": "🏛️ <b>Thẩm định NEAC</b>",
        }.get(view.action, f"📄 <b>{view.action}</b>")

        filename = doc.filename if doc else f"Document #{view.document_id}"
        customer_name = ""
        if doc and doc.customer:
            customer_name = doc.customer.name

        lines = [
            f"{action_label} hồ sơ",
            f"📄 <b>{_esc(filename)}</b>",
        ]
        if customer_name:
            lines.append(f"🏢 {_esc(customer_name)}")
        if tracking and (tracking.note or tracking.milestone_date):
            note_parts = []
            if tracking.milestone_date:
                note_parts.append(tracking.milestone_date)
            if tracking.note:
                note_parts.append(tracking.note)
            lines.append(f"📌 {_esc(' · '.join(note_parts))}")

        lines.append("")
        if view.ip:
            lines.append(f"🌐 IP: <b>{_esc(view.ip)}</b>")
        geo_parts = []
        if view.city:
            geo_parts.append(view.city)
        if view.region:
            geo_parts.append(view.region)
        if view.isp:
            geo_parts.append(view.isp)
        device_icon = "📱" if view.device_type == "mobile" else "🖥️"
        device_label = view.device_type.capitalize() if view.device_type else "Unknown"
        if geo_parts:
            lines.append(f"📍 {_esc(' · '.join(geo_parts))} · {device_icon} {device_label}")
        else:
            lines.append(f"{device_icon} {device_label}")

        vn_time = view.created_at.strftime("%H:%M:%S %d/%m/%Y") if view.created_at else ""
        lines.append(f"⏰ {vn_time}")
        lines.append("")
        ksp_url = settings.public_base_url.rstrip("/")
        lines.append(f"🔗 <a href=\"{ksp_url}/theo-doi-xem\">Mở thống kê KSP</a>")

        body = "\n".join(lines)
        client = TelegramClient(settings)
        try:
            for cid in chat_ids:
                try:
                    client.send_message(cid, body, parse_mode="HTML")
                except TelegramError:
                    continue
        finally:
            client.close()
    except Exception:
        logger.exception("Failed to send doc-tracking Telegram alert")
    finally:
        gen.close()


def _esc(text: str) -> str:
    """Escape HTML for Telegram."""
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


# ---------------------------------------------------------------------------
# Fallback: server-side view from download/view endpoints
# ---------------------------------------------------------------------------
def record_server_side_view(
    db: Session,
    settings: Settings,
    *,
    document_id: int,
    action: str,
    request_headers: dict[str, str],
    source: str = "",
) -> DocumentView | None:
    """Ghi 1 luot xem tu server-side (khi client khong chay JS telemetry)."""
    ip = (
        request_headers.get("x-forwarded-for", "").split(",")[0].strip()
        or request_headers.get("x-real-ip", "")
        or ""
    )
    ua = request_headers.get("user-agent", "")
    ua_hash = hashlib.sha256(ua.encode()).hexdigest()[:16]
    device = "mobile" if _is_mobile(ua) else "desktop"

    return record_view(
        db,
        settings,
        document_id=document_id,
        action=action,
        ip=ip,
        device_type=device,
        user_agent_hash=ua_hash,
        source=source,
    )


def _is_mobile(ua: str) -> bool:
    ua_lower = ua.lower()
    return any(k in ua_lower for k in ("mobile", "android", "iphone", "ipad"))
