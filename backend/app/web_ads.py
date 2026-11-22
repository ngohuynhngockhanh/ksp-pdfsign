"""Business logic for iNut Website Ads Analytics & Lead Capture."""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import crypto, public_training, telegram
from .config import Settings
from .db import (
    Customer,
    Document,
    TrainingPublicQuery,
    TrainingPublicSession,
    WebAdEvent,
    WebLead,
    get_session,
)
from .inventory import normalize_name

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants & Canonical Product / Pricing Catalog (synced with inut-website)
# ---------------------------------------------------------------------------
ALLOWED_EVENT_TYPES = frozenset({
    "pageview",
    "view_price",
    "select_sku",
    "apply_coupon",
    "click_call",
    "click_zalo",
    "submit_lead",
})

ALLOWED_LEAD_STATUSES = frozenset({
    "new",
    "contacted",
    "quoted",
    "won",
    "lost",
})

RETAIL_MULTIPLIER = 1.25

SKU_CATALOG: dict[str, dict[str, Any]] = {
    "INUT-SC-DL10": {
        "code": "INUT-SC-DL10",
        "name": "iNut Smartcity: Data Logger V1",
        "product_key": "datalogger",
        "dvt": "Bộ",
        "base_price": 3_750_000,
        "retail_price": round(3_750_000 * RETAIL_MULTIPLIER),
    },
    "INUT-SC-DL11": {
        "code": "INUT-SC-DL11",
        "name": "iNut Smartcity: Data Logger V1.1",
        "product_key": "datalogger",
        "dvt": "Bộ",
        "base_price": 5_000_000,
        "retail_price": round(5_000_000 * RETAIL_MULTIPLIER),
    },
    "INUT-SC-DL20": {
        "code": "INUT-SC-DL20",
        "name": "iNut Smartcity: Data Logger V2",
        "product_key": "datalogger",
        "dvt": "Bộ",
        "base_price": 7_000_000,
        "retail_price": round(7_000_000 * RETAIL_MULTIPLIER),
    },
    "INUT-SC-R4WF": {
        "code": "INUT-SC-R4WF",
        "name": "iNut Smartcity: RS485 WIFI",
        "product_key": "rs485",
        "dvt": "Bộ",
        "base_price": 1_800_000,
        "retail_price": round(1_800_000 * RETAIL_MULTIPLIER),
    },
    "INUT-SC-R4WF4G": {
        "code": "INUT-SC-R4WF4G",
        "name": "iNut Smartcity: RS485 WIFI/4G",
        "product_key": "rs485",
        "dvt": "Bộ",
        "base_price": 2_525_000,
        "retail_price": round(2_525_000 * RETAIL_MULTIPLIER),
    },
}

DEFAULT_SKU_BY_PRODUCT: dict[str, str] = {
    "datalogger": "INUT-SC-DL11",
    "rs485": "INUT-SC-R4WF4G",
}

COUPON_DISCOUNTS: dict[str, float] = {
    "INUTNEWBIE": 20.0,
    "FBADS20": 20.0,
    "GGADS20": 20.0,
    "ZALO20": 20.0,
}

_PHONE_EXTRACT_RE = re.compile(r"\+?\d[\d\s().-]{6,18}\d")

# ---------------------------------------------------------------------------
# Telegram Cooldown & Background Executor
# ---------------------------------------------------------------------------
_CLICK_COOLDOWN_SECONDS = 600  # 10 min per (visitor_id, event_type, page_path)
_click_cooldown_cache: dict[str, float] = {}
_click_cooldown_lock = threading.Lock()
_tg_executor: ThreadPoolExecutor | None = None
_tg_executor_lock = threading.Lock()


def reset_click_cooldowns_for_tests() -> None:
    """Clear in-memory click alert cooldown cache (used by tests)."""
    with _click_cooldown_lock:
        _click_cooldown_cache.clear()


def take_click_alert_slot(
    visitor_id: str,
    event_type: str,
    page_path: str,
    *,
    now: float | None = None,
) -> bool:
    """Allow at most 1 Telegram alert per 10 min for (visitor_id, event_type, page_path)."""
    current = time.monotonic() if now is None else now
    key = f"{visitor_id}:{event_type}:{page_path}"
    with _click_cooldown_lock:
        stale = [k for k, ts in _click_cooldown_cache.items() if current - ts >= _CLICK_COOLDOWN_SECONDS]
        for k in stale:
            _click_cooldown_cache.pop(k, None)
        last = _click_cooldown_cache.get(key)
        if last is not None and current - last < _CLICK_COOLDOWN_SECONDS:
            return False
        _click_cooldown_cache[key] = current
        return True


def _get_tg_executor() -> ThreadPoolExecutor:
    global _tg_executor
    with _tg_executor_lock:
        if _tg_executor is None:
            _tg_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="webads-tg")
        return _tg_executor


# ---------------------------------------------------------------------------
# Sanitizers, Phone Normalization & Pricing Helpers
# ---------------------------------------------------------------------------
def _clean_str(value: Any, max_len: int) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        value = str(value)
    return value.strip()[:max_len]


def _clean_locale(value: Any) -> str:
    loc = _clean_str(value, 10).lower()
    if loc.startswith("en"):
        return "en"
    if loc.startswith("vi"):
        return "vi"
    return loc or "vi"


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _esc(text: str) -> str:
    return (
        str(text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _fmt_vnd(amount: float | int) -> str:
    return f"{int(round(float(amount))):,}".replace(",", ".")


def normalize_lead_phone(value: str) -> str:
    """Normalize VN phones via public_training.normalize_phone; fallback to 8-15 digits."""
    raw = str(value or "").strip()
    if not raw:
        raise ValueError("Số điện thoại không hợp lệ")
    try:
        return public_training.normalize_phone(raw)
    except ValueError:
        digits = re.sub(r"\D", "", raw)
        if 8 <= len(digits) <= 15:
            return f"+{digits}" if raw.startswith("+") else digits
        raise ValueError("Số điện thoại không hợp lệ")


def phone_digits(phone: str) -> str:
    return re.sub(r"\D", "", str(phone or ""))


def phone_last4(phone: str) -> str:
    digits = phone_digits(phone)
    return digits[-4:] if len(digits) >= 4 else digits


def infer_product_key(product_key: str = "", sku: str = "", page_path: str = "") -> str:
    pk = _clean_str(product_key, 64).lower()
    if pk:
        return pk
    sku_norm = _clean_str(sku, 64).upper()
    if sku_norm in SKU_CATALOG:
        return str(SKU_CATALOG[sku_norm]["product_key"])
    path_lower = _clean_str(page_path, 500).lower()
    if "datalogger" in path_lower:
        return "datalogger"
    if "rs485" in path_lower:
        return "rs485"
    if "billiard" in path_lower:
        return "billiard"
    return ""


def compute_sku_pricing(
    sku: str,
    *,
    quantity: int = 1,
    coupon_code: str = "",
    discount_percent: float = 0.0,
) -> dict[str, Any] | None:
    """Compute canonical SKU retail, coupon, and volume-tier pricing."""
    code = _clean_str(sku, 64).upper()
    spec = SKU_CATALOG.get(code)
    if not spec:
        return None
    qty = max(1, min(int(quantity or 1), 10000))
    coupon = _clean_str(coupon_code, 64).upper()
    if not coupon:
        eff_discount = 0.0
    elif coupon in COUPON_DISCOUNTS:
        eff_discount = COUPON_DISCOUNTS[coupon]
    else:
        eff_discount = max(0.0, min(float(discount_percent or 0.0), 100.0))

    retail = int(spec["retail_price"])
    after_coupon = round(retail * (1.0 - eff_discount / 100.0)) if eff_discount > 0 else retail
    volume_pct = 5.0 if qty >= 3 else 0.0
    unit_price = round(after_coupon * (1.0 - volume_pct / 100.0)) if volume_pct > 0 else after_coupon
    subtotal = int(unit_price * qty)
    vat = round(subtotal * 0.10)
    return {
        "sku": code,
        "sku_name": spec["name"],
        "product_key": spec["product_key"],
        "dvt": spec["dvt"],
        "base_price": int(spec["base_price"]),
        "retail_price": retail,
        "coupon_code": coupon,
        "discount_percent": eff_discount,
        "volume_discount_percent": volume_pct,
        "unit_price": int(unit_price),
        "subtotal_vnd": subtotal,
        "vat_vnd": int(vat),
        "total_vnd": int(subtotal + vat),
        "is_dealer_tier": qty >= 10,
    }


# ---------------------------------------------------------------------------
# Cross-table Matching (Customer & TrainingPublicSession)
# ---------------------------------------------------------------------------
def find_matching_training_session(db: Session, phone_hash: str) -> TrainingPublicSession | None:
    if not phone_hash:
        return None
    return db.scalar(
        select(TrainingPublicSession)
        .where(TrainingPublicSession.phone_hash == phone_hash)
        .order_by(TrainingPublicSession.last_seen_at.desc(), TrainingPublicSession.id.desc())
    )


def count_training_queries(db: Session, training_session_id: int | None) -> int:
    if not training_session_id:
        return 0
    return int(
        db.scalar(
            select(func.count(TrainingPublicQuery.id)).where(
                TrainingPublicQuery.session_id == training_session_id
            )
        )
        or 0
    )


def _contact_matches_phone(contact: str, target_phone: str) -> bool:
    if not contact or not target_phone:
        return False
    target_digits = phone_digits(target_phone)
    for match in _PHONE_EXTRACT_RE.finditer(contact):
        candidate_raw = match.group(0)
        try:
            candidate_norm = normalize_lead_phone(candidate_raw)
        except ValueError:
            continue
        if candidate_norm == target_phone or phone_digits(candidate_norm) == target_digits:
            return True
    return False


def find_matching_customer(
    db: Session,
    *,
    phone: str = "",
    email: str = "",
    company: str = "",
    name: str = "",
    include_name: bool = False,
) -> Customer | None:
    """Match an existing Customer by phone, email, and optionally normalized name/company."""
    norm_email = _clean_str(email, 255).lower()
    norm_phone = ""
    if phone:
        try:
            norm_phone = normalize_lead_phone(phone)
        except ValueError:
            norm_phone = ""

    customers = list(db.scalars(select(Customer).order_by(Customer.id.asc())))

    if norm_phone:
        for customer in customers:
            if _contact_matches_phone(customer.contact or "", norm_phone):
                return customer

    if norm_email:
        for customer in customers:
            if (customer.email or "").strip().lower() == norm_email:
                return customer

    if include_name:
        target_name = normalize_name(_clean_str(company, 255) or _clean_str(name, 255))
        if target_name:
            for customer in customers:
                if normalize_name(customer.name or "") == target_name:
                    return customer

    return None


# ---------------------------------------------------------------------------
# Event Ingestion & Lead Capture
# ---------------------------------------------------------------------------
def record_ad_event(
    db: Session,
    settings: Settings,
    payload: dict[str, Any],
) -> WebAdEvent:
    visitor_id = _clean_str(payload.get("visitor_id"), 128)
    if not visitor_id:
        raise ValueError("visitor_id không hợp lệ")

    event_type = _clean_str(payload.get("event_type"), 32)
    if event_type not in ALLOWED_EVENT_TYPES:
        raise ValueError("event_type không hợp lệ")

    page_path = _clean_str(payload.get("page_path"), 500)
    if not page_path:
        raise ValueError("page_path không hợp lệ")

    sku_raw = _clean_str(payload.get("sku"), 64)
    sku = sku_raw.upper() if sku_raw.upper() in SKU_CATALOG else sku_raw
    product_key = infer_product_key(
        _clean_str(payload.get("product_key"), 64),
        sku,
        page_path,
    )
    coupon = _clean_str(payload.get("coupon"), 64).upper()

    meta_obj = payload.get("meta")
    if isinstance(meta_obj, dict):
        meta_json = json.dumps(meta_obj, ensure_ascii=False)[:4000]
    else:
        meta_json = "{}"

    event = WebAdEvent(
        visitor_id=visitor_id,
        session_id=_clean_str(payload.get("session_id"), 128),
        event_type=event_type,
        page_path=page_path,
        product_key=product_key,
        sku=sku,
        coupon=coupon,
        utm_source=_clean_str(payload.get("utm_source"), 128),
        utm_medium=_clean_str(payload.get("utm_medium"), 128),
        utm_campaign=_clean_str(payload.get("utm_campaign"), 256),
        utm_content=_clean_str(payload.get("utm_content"), 256),
        utm_term=_clean_str(payload.get("utm_term"), 256),
        gclid=_clean_str(payload.get("gclid"), 256),
        fbclid=_clean_str(payload.get("fbclid"), 256),
        referrer=_clean_str(payload.get("referrer"), 1000),
        locale=_clean_locale(payload.get("locale")),
        client_ip=_clean_str(payload.get("client_ip"), 64),
        user_agent=_clean_str(payload.get("user_agent"), 500),
        meta_json=meta_json,
        notified=False,
    )
    db.add(event)

    should_alert = False
    if event_type in {"click_call", "click_zalo"}:
        if take_click_alert_slot(visitor_id, event_type, page_path):
            should_alert = True
            event.notified = True

    db.commit()
    db.refresh(event)

    if should_alert:
        dispatch_click_alert(settings, event.id)

    return event


def _first_or_last_attr(events: list[WebAdEvent], attr: str) -> str:
    """Prefer latest non-empty attribution value; fallback to earliest."""
    for ev in reversed(events):
        val = getattr(ev, attr, "") or ""
        if val:
            return val
    return ""


def record_web_lead(
    db: Session,
    settings: Settings,
    payload: dict[str, Any],
) -> tuple[WebLead, int]:
    name = _clean_str(payload.get("name"), 255)
    if not name:
        raise ValueError("Họ tên không được để trống")

    phone = normalize_lead_phone(str(payload.get("phone", "")))
    p_hash = crypto.fingerprint(phone)
    p_cipher = crypto.encrypt(phone)
    p_last4 = phone_last4(phone)

    visitor_id = _clean_str(payload.get("visitor_id"), 128)
    email = _clean_str(payload.get("email"), 255)
    company = _clean_str(payload.get("company"), 255)
    page_path = _clean_str(payload.get("page_path"), 500)

    sku_raw = _clean_str(payload.get("sku"), 64)
    sku = sku_raw.upper() if sku_raw.upper() in SKU_CATALOG else sku_raw

    try:
        quantity = int(payload.get("quantity") or 1)
    except (TypeError, ValueError):
        quantity = 1
    quantity = max(1, min(quantity, 10000))

    coupon_code = _clean_str(payload.get("coupon_code"), 64).upper()
    try:
        discount_percent = float(payload.get("discount_percent") or 0.0)
    except (TypeError, ValueError):
        discount_percent = 0.0
    discount_percent = max(0.0, min(discount_percent, 100.0))

    try:
        quoted_price_vnd = float(payload.get("quoted_price_vnd") or 0.0)
    except (TypeError, ValueError):
        quoted_price_vnd = 0.0
    quoted_price_vnd = max(0.0, quoted_price_vnd)

    utm_source = _clean_str(payload.get("utm_source"), 128)
    utm_medium = _clean_str(payload.get("utm_medium"), 128)
    utm_campaign = _clean_str(payload.get("utm_campaign"), 256)
    utm_content = _clean_str(payload.get("utm_content"), 256)
    utm_term = _clean_str(payload.get("utm_term"), 256)
    gclid = _clean_str(payload.get("gclid"), 256)
    fbclid = _clean_str(payload.get("fbclid"), 256)
    referrer = _clean_str(payload.get("referrer"), 1000)

    visit_count = 0
    price_view_count = 0
    prior_events: list[WebAdEvent] = []
    if visitor_id:
        prior_events = list(
            db.scalars(
                select(WebAdEvent)
                .where(WebAdEvent.visitor_id == visitor_id)
                .order_by(WebAdEvent.created_at.asc(), WebAdEvent.id.asc())
            )
        )
        visit_count = sum(1 for ev in prior_events if ev.event_type == "pageview")
        price_view_count = sum(1 for ev in prior_events if ev.event_type == "view_price")
        if prior_events:
            utm_source = utm_source or _first_or_last_attr(prior_events, "utm_source")
            utm_medium = utm_medium or _first_or_last_attr(prior_events, "utm_medium")
            utm_campaign = utm_campaign or _first_or_last_attr(prior_events, "utm_campaign")
            utm_content = utm_content or _first_or_last_attr(prior_events, "utm_content")
            utm_term = utm_term or _first_or_last_attr(prior_events, "utm_term")
            gclid = gclid or _first_or_last_attr(prior_events, "gclid")
            fbclid = fbclid or _first_or_last_attr(prior_events, "fbclid")
            referrer = referrer or _first_or_last_attr(prior_events, "referrer")
            page_path = page_path or _first_or_last_attr(prior_events, "page_path")
            if not sku:
                sku_events = [ev.sku for ev in prior_events if ev.sku]
                if sku_events:
                    sku = sku_events[-1]
            if not coupon_code:
                coupon_events = [ev.coupon for ev in prior_events if ev.coupon]
                if coupon_events:
                    coupon_code = coupon_events[-1].upper()

    product_key = infer_product_key(_clean_str(payload.get("product_key"), 64), sku, page_path)
    product_name = _clean_str(payload.get("product_name"), 255)

    pricing = compute_sku_pricing(
        sku,
        quantity=quantity,
        coupon_code=coupon_code,
        discount_percent=discount_percent,
    )
    if pricing:
        sku = pricing["sku"]
        product_key = product_key or pricing["product_key"]
        product_name = product_name or pricing["sku_name"]
        discount_percent = pricing["discount_percent"]
        if quoted_price_vnd <= 0:
            quoted_price_vnd = float(pricing["subtotal_vnd"])
    elif not coupon_code:
        discount_percent = 0.0
    elif coupon_code in COUPON_DISCOUNTS:
        discount_percent = COUPON_DISCOUNTS[coupon_code]

    training_session = find_matching_training_session(db, p_hash)
    training_session_id = training_session.id if training_session else None
    training_query_count = count_training_queries(db, training_session_id)

    customer = find_matching_customer(db, phone=phone, email=email, include_name=False)
    customer_id = customer.id if customer else None

    lead = WebLead(
        visitor_id=visitor_id,
        name=name,
        phone_ciphertext=p_cipher,
        phone_hash=p_hash,
        phone_last4=p_last4,
        email=email,
        company=company,
        product_key=product_key,
        product_name=product_name,
        sku=sku,
        quantity=quantity,
        coupon_code=coupon_code,
        discount_percent=discount_percent,
        quoted_price_vnd=quoted_price_vnd,
        device_info=_clean_str(payload.get("device_info"), 500),
        need=_clean_str(payload.get("need"), 500),
        message=_clean_str(payload.get("message"), 4000),
        page_path=page_path,
        locale=_clean_locale(payload.get("locale")),
        utm_source=utm_source,
        utm_medium=utm_medium,
        utm_campaign=utm_campaign,
        utm_content=utm_content,
        utm_term=utm_term,
        gclid=gclid,
        fbclid=fbclid,
        referrer=referrer,
        client_ip=_clean_str(payload.get("client_ip"), 64),
        user_agent=_clean_str(payload.get("user_agent"), 500),
        visit_count=visit_count,
        price_view_count=price_view_count,
        training_session_id=training_session_id,
        customer_id=customer_id,
        status="new",
        notified=True,
    )
    db.add(lead)
    db.flush()

    if visitor_id:
        db.add(
            WebAdEvent(
                visitor_id=visitor_id,
                event_type="submit_lead",
                page_path=page_path or "/",
                product_key=product_key,
                sku=sku,
                coupon=coupon_code,
                utm_source=utm_source,
                utm_medium=utm_medium,
                utm_campaign=utm_campaign,
                utm_content=utm_content,
                utm_term=utm_term,
                gclid=gclid,
                fbclid=fbclid,
                referrer=referrer,
                locale=lead.locale,
                client_ip=lead.client_ip,
                user_agent=lead.user_agent,
                meta_json=json.dumps({"lead_id": lead.id}, ensure_ascii=False),
                notified=False,
            )
        )

    db.commit()
    db.refresh(lead)

    dispatch_lead_alert(settings, lead.id, training_query_count=training_query_count)
    return lead, training_query_count


# ---------------------------------------------------------------------------
# Telegram Formatting & Best-Effort Dispatch
# ---------------------------------------------------------------------------
def format_click_telegram_message(event: WebAdEvent, *, public_base_url: str) -> str:
    icon = "📞" if event.event_type == "click_call" else "💬"
    label = "Bấm gọi hotline" if event.event_type == "click_call" else "Bấm chat Zalo"
    lines = [
        f"{icon} <b>Khách Ads {label}</b>",
        f"📄 Trang: <code>{_esc(event.page_path)}</code>",
    ]
    if event.product_key or event.sku:
        parts = [p for p in (event.product_key, event.sku) if p]
        lines.append(f"📦 Sản phẩm: <b>{_esc(' · '.join(parts))}</b>")
    if event.coupon:
        lines.append(f"🏷️ Mã giảm giá: <code>{_esc(event.coupon)}</code>")
    if event.utm_campaign or event.utm_source:
        utm_parts = [p for p in (event.utm_source, event.utm_medium, event.utm_campaign) if p]
        lines.append(f"🎯 Nguồn Ads: {_esc(' / '.join(utm_parts))}")
    base = public_base_url.rstrip("/")
    lines.append(f'🔗 <a href="{base}/web-ads">Mở thống kê Ads &amp; Leads KSP</a>')
    return "\n".join(lines)


def format_lead_telegram_message(
    lead: WebLead,
    *,
    phone: str,
    training_query_count: int,
    public_base_url: str,
) -> str:
    zalo_digits = phone_digits(phone)
    lines = [
        f"🔥 <b>Lead mới từ Website iNut (#{lead.id})</b>",
        f"👤 <b>{_esc(lead.name)}</b>" + (f" · {_esc(lead.company)}" if lead.company else ""),
        f"📱 SĐT: <b>{_esc(phone)}</b> (••••••{_esc(lead.phone_last4)})"
        + (f' · <a href="https://zalo.me/{zalo_digits}">Zalo</a>' if zalo_digits else ""),
    ]
    if lead.email:
        lines.append(f"✉️ Email: {_esc(lead.email)}")

    prod_parts = [p for p in (lead.product_name or lead.product_key, lead.sku) if p]
    if prod_parts:
        qty_text = f" × {lead.quantity}" if lead.quantity else ""
        lines.append(f"📦 Quan tâm: <b>{_esc(' · '.join(prod_parts))}{qty_text}</b>")

    price_parts = []
    if lead.quoted_price_vnd and lead.quoted_price_vnd > 0:
        price_parts.append(f"Tạm tính: <b>{_fmt_vnd(lead.quoted_price_vnd)}đ</b>")
    if lead.coupon_code:
        disc = f" (-{int(lead.discount_percent)}%)" if lead.discount_percent else ""
        price_parts.append(f"Mã: <code>{_esc(lead.coupon_code)}</code>{disc}")
    if price_parts:
        lines.append("💰 " + " · ".join(price_parts))

    if lead.device_info:
        lines.append(f"⚙️ Thiết bị: {_esc(lead.device_info[:250])}")
    if lead.need:
        lines.append(f"🧭 Nhu cầu: {_esc(lead.need[:250])}")
    if lead.message:
        lines.append(f"📝 Ghi chú: {_esc(lead.message[:350])}")

    utm_parts = [p for p in (lead.utm_source, lead.utm_medium, lead.utm_campaign) if p]
    if utm_parts:
        lines.append(f"🎯 Chiến dịch: {_esc(' / '.join(utm_parts))}")
    elif lead.page_path:
        lines.append(f"📄 Trang: <code>{_esc(lead.page_path)}</code>")

    signals = [f"👁 Xem bảng giá: <b>{lead.price_view_count}</b> lượt (tổng truy cập: {lead.visit_count})"]
    if training_query_count > 0:
        signals.append(f"🤖 Đã chat AI Widget: <b>{training_query_count}</b> câu hỏi")
    if lead.customer_id:
        signals.append(f"🏢 Trùng KH CRM #{lead.customer_id}")
    lines.append(" · ".join(signals))

    base = public_base_url.rstrip("/")
    lines.append(f'🔗 <a href="{base}/web-ads">Mở chi tiết Lead trên KSP</a>')
    return "\n".join(lines)


def send_telegram_html(db: Session, settings: Settings, html_text: str) -> int:
    """Send HTML message to all linked admin Telegram chats. Never raises."""
    if not telegram.is_configured(settings):
        return 0
    chat_ids = telegram.admin_chat_ids(db)
    if not chat_ids:
        return 0
    delivered = 0
    client = telegram.TelegramClient(settings)
    try:
        for cid in chat_ids:
            try:
                client.send_message(cid, html_text, parse_mode="HTML")
                delivered += 1
            except telegram.TelegramError:
                continue
    except Exception:
        logger.exception("WebAds Telegram send error")
    finally:
        client.close()
    return delivered


def _send_click_alert_worker(settings: Settings, event_id: int) -> None:
    gen = get_session()
    db = next(gen)
    try:
        event = db.get(WebAdEvent, event_id)
        if not event:
            return
        body = format_click_telegram_message(event, public_base_url=settings.public_base_url)
        send_telegram_html(db, settings, body)
    except Exception:
        logger.exception("Failed to send WebAds click Telegram alert")
    finally:
        gen.close()


def _send_lead_alert_worker(settings: Settings, lead_id: int, training_query_count: int) -> None:
    gen = get_session()
    db = next(gen)
    try:
        lead = db.get(WebLead, lead_id)
        if not lead:
            return
        phone = crypto.decrypt(lead.phone_ciphertext) or public_training.mask_phone(lead.phone_last4)
        body = format_lead_telegram_message(
            lead,
            phone=phone,
            training_query_count=training_query_count,
            public_base_url=settings.public_base_url,
        )
        send_telegram_html(db, settings, body)
    except Exception:
        logger.exception("Failed to send WebAds lead Telegram alert")
    finally:
        gen.close()


def dispatch_click_alert(settings: Settings, event_id: int) -> None:
    if not telegram.is_configured(settings):
        return
    try:
        _get_tg_executor().submit(_send_click_alert_worker, settings, event_id)
    except Exception:
        logger.exception("Could not enqueue WebAds click Telegram alert")


def dispatch_lead_alert(settings: Settings, lead_id: int, *, training_query_count: int = 0) -> None:
    if not telegram.is_configured(settings):
        return
    try:
        _get_tg_executor().submit(_send_lead_alert_worker, settings, lead_id, training_query_count)
    except Exception:
        logger.exception("Could not enqueue WebAds lead Telegram alert")


# ---------------------------------------------------------------------------
# Serialization Helpers
# ---------------------------------------------------------------------------
def _extract_answer_text(answer_json: str, settings: Settings) -> str:
    try:
        raw = json.loads(answer_json or "{}")
    except ValueError:
        return ""
    value: Any = raw
    for _ in range(3):
        if isinstance(value, dict) and "answer" in value:
            value = value["answer"]
        else:
            break
    if isinstance(value, str):
        return public_training.rewrite_public_text(value, settings)
    return ""


def serialize_lead(
    lead: WebLead,
    *,
    mask_phone: bool = False,
    training_query_count: int = 0,
    customer_name: str | None = None,
    include_client_meta: bool = False,
) -> dict[str, Any]:
    decrypted = crypto.decrypt(lead.phone_ciphertext)
    masked = public_training.mask_phone(decrypted or lead.phone_last4)
    phone_value = masked if mask_phone else (decrypted or masked)
    data: dict[str, Any] = {
        "id": lead.id,
        "visitor_id": lead.visitor_id,
        "name": lead.name,
        "phone": phone_value,
        "phone_masked": masked,
        "phone_last4": lead.phone_last4,
        "email": lead.email,
        "company": lead.company,
        "product_key": lead.product_key,
        "product_name": lead.product_name,
        "sku": lead.sku,
        "quantity": lead.quantity,
        "coupon_code": lead.coupon_code,
        "discount_percent": lead.discount_percent,
        "quoted_price_vnd": lead.quoted_price_vnd,
        "device_info": lead.device_info,
        "need": lead.need,
        "message": lead.message,
        "page_path": lead.page_path,
        "locale": lead.locale,
        "utm_source": lead.utm_source,
        "utm_medium": lead.utm_medium,
        "utm_campaign": lead.utm_campaign,
        "utm_content": lead.utm_content,
        "utm_term": lead.utm_term,
        "gclid": lead.gclid,
        "fbclid": lead.fbclid,
        "referrer": lead.referrer,
        "visit_count": lead.visit_count,
        "price_view_count": lead.price_view_count,
        "training_session_id": lead.training_session_id,
        "training_query_count": training_query_count,
        "customer_id": lead.customer_id,
        "customer_name": customer_name,
        "quote_document_id": lead.quote_document_id,
        "status": lead.status,
        "note": lead.note,
        "created_at": _iso(lead.created_at),
        "updated_at": _iso(lead.updated_at),
    }
    if include_client_meta:
        data["client_ip"] = lead.client_ip
        data["user_agent"] = lead.user_agent
    return data


def serialize_event(event: WebAdEvent) -> dict[str, Any]:
    try:
        meta = json.loads(event.meta_json or "{}")
        if not isinstance(meta, dict):
            meta = {}
    except ValueError:
        meta = {}
    return {
        "id": event.id,
        "event_type": event.event_type,
        "page_path": event.page_path,
        "product_key": event.product_key,
        "sku": event.sku,
        "coupon": event.coupon,
        "utm_source": event.utm_source,
        "utm_medium": event.utm_medium,
        "utm_campaign": event.utm_campaign,
        "referrer": event.referrer,
        "locale": event.locale,
        "meta": meta,
        "created_at": _iso(event.created_at),
    }


def serialize_training_query(row: TrainingPublicQuery, settings: Settings) -> dict[str, Any]:
    return {
        "id": row.id,
        "job_id": row.job_id,
        "question": row.question,
        "answer_text": _extract_answer_text(row.answer_json, settings),
        "status": row.status,
        "created_at": _iso(row.created_at),
        "completed_at": _iso(row.completed_at),
    }


# ---------------------------------------------------------------------------
# Funnel Analytics / Overview & Daily Digest
# ---------------------------------------------------------------------------
def _pct(num: int, den: int) -> float:
    return round((num / den) * 100.0, 2) if den > 0 else 0.0


def build_overview(
    db: Session,
    *,
    days: int = 30,
    product_key: str = "",
    utm_campaign: str = "",
) -> dict[str, Any]:
    days = max(1, min(int(days or 30), 365))
    now_naive = _utc_now_naive()
    since = now_naive - timedelta(days=days)

    pk_filter = _clean_str(product_key, 64).lower()
    camp_filter = _clean_str(utm_campaign, 256)

    all_events = list(
        db.scalars(
            select(WebAdEvent).where(WebAdEvent.created_at >= since)
        )
    )
    all_leads = list(
        db.scalars(
            select(WebLead).where(WebLead.created_at >= since)
        )
    )

    available_products = sorted({
        *(ev.product_key for ev in all_events if ev.product_key),
        *(ld.product_key for ld in all_leads if ld.product_key),
    })
    available_campaigns = sorted({
        *(ev.utm_campaign for ev in all_events if ev.utm_campaign),
        *(ld.utm_campaign for ld in all_leads if ld.utm_campaign),
    })

    events = [
        ev for ev in all_events
        if (not pk_filter or (ev.product_key or "").lower() == pk_filter)
        and (not camp_filter or (ev.utm_campaign or "") == camp_filter)
    ]
    leads = [
        ld for ld in all_leads
        if (not pk_filter or (ld.product_key or "").lower() == pk_filter)
        and (not camp_filter or (ld.utm_campaign or "") == camp_filter)
    ]

    pageviews = 0
    price_views = 0
    sku_selects = 0
    coupon_applies = 0
    call_clicks = 0
    zalo_clicks = 0
    unique_visitors_set: set[str] = set()

    # Campaign buckets keyed by (utm_campaign, utm_source)
    camp_buckets: dict[tuple[str, str], dict[str, Any]] = {}
    # Page buckets keyed by page_path
    page_buckets: dict[str, dict[str, Any]] = {}
    # SKU buckets keyed by sku
    sku_buckets: dict[str, dict[str, Any]] = {}
    # Daily buckets keyed by YYYY-MM-DD
    daily_buckets: dict[str, dict[str, Any]] = {}

    today_date = now_naive.date()
    for offset in range(days - 1, -1, -1):
        day_str = (today_date - timedelta(days=offset)).isoformat()
        daily_buckets[day_str] = {
            "date": day_str,
            "pageviews": 0,
            "visitors": set(),
            "price_views": 0,
            "call_clicks": 0,
            "zalo_clicks": 0,
            "leads": 0,
        }

    def _get_camp(camp: str, src: str, med: str = "") -> dict[str, Any]:
        c_key = (camp or "(direct)", src or "(direct)")
        bucket = camp_buckets.get(c_key)
        if bucket is None:
            bucket = {
                "utm_campaign": c_key[0],
                "utm_source": c_key[1],
                "utm_medium": med or "",
                "pageviews": 0,
                "visitors": set(),
                "price_views": 0,
                "call_clicks": 0,
                "zalo_clicks": 0,
                "leads": 0,
            }
            camp_buckets[c_key] = bucket
        elif med and not bucket["utm_medium"]:
            bucket["utm_medium"] = med
        return bucket

    def _get_page(path: str, pk: str = "") -> dict[str, Any]:
        p_key = path or "/"
        bucket = page_buckets.get(p_key)
        if bucket is None:
            bucket = {
                "page_path": p_key,
                "product_key": pk or "",
                "pageviews": 0,
                "visitors": set(),
                "price_views": 0,
                "call_clicks": 0,
                "zalo_clicks": 0,
                "leads": 0,
            }
            page_buckets[p_key] = bucket
        elif pk and not bucket["product_key"]:
            bucket["product_key"] = pk
        return bucket

    def _get_sku(sku_code: str, pk: str = "") -> dict[str, Any]:
        s_key = sku_code.upper() if sku_code.upper() in SKU_CATALOG else sku_code
        spec = SKU_CATALOG.get(s_key)
        bucket = sku_buckets.get(s_key)
        if bucket is None:
            bucket = {
                "sku": s_key,
                "sku_name": spec["name"] if spec else s_key,
                "product_key": spec["product_key"] if spec else pk,
                "sku_selects": 0,
                "leads": 0,
                "total_quantity": 0,
                "estimated_revenue_vnd": 0.0,
            }
            sku_buckets[s_key] = bucket
        return bucket

    for ev in events:
        if ev.visitor_id:
            unique_visitors_set.add(ev.visitor_id)
        cb = _get_camp(ev.utm_campaign, ev.utm_source, ev.utm_medium)
        pb = _get_page(ev.page_path, ev.product_key)
        day_key = (ev.created_at.date() if ev.created_at else today_date).isoformat()
        dbucket = daily_buckets.get(day_key)

        if ev.visitor_id:
            cb["visitors"].add(ev.visitor_id)
            pb["visitors"].add(ev.visitor_id)
            if dbucket is not None:
                dbucket["visitors"].add(ev.visitor_id)

        if ev.event_type == "pageview":
            pageviews += 1
            cb["pageviews"] += 1
            pb["pageviews"] += 1
            if dbucket is not None:
                dbucket["pageviews"] += 1
        elif ev.event_type == "view_price":
            price_views += 1
            cb["price_views"] += 1
            pb["price_views"] += 1
            if dbucket is not None:
                dbucket["price_views"] += 1
        elif ev.event_type == "select_sku":
            sku_selects += 1
            if ev.sku:
                _get_sku(ev.sku, ev.product_key)["sku_selects"] += 1
        elif ev.event_type == "apply_coupon":
            coupon_applies += 1
        elif ev.event_type == "click_call":
            call_clicks += 1
            cb["call_clicks"] += 1
            pb["call_clicks"] += 1
            if dbucket is not None:
                dbucket["call_clicks"] += 1
        elif ev.event_type == "click_zalo":
            zalo_clicks += 1
            cb["zalo_clicks"] += 1
            pb["zalo_clicks"] += 1
            if dbucket is not None:
                dbucket["zalo_clicks"] += 1

    for ld in leads:
        if ld.visitor_id:
            unique_visitors_set.add(ld.visitor_id)
        cb = _get_camp(ld.utm_campaign, ld.utm_source, ld.utm_medium)
        cb["leads"] += 1
        if ld.visitor_id:
            cb["visitors"].add(ld.visitor_id)

        pb = _get_page(ld.page_path or "/", ld.product_key)
        pb["leads"] += 1
        if ld.visitor_id:
            pb["visitors"].add(ld.visitor_id)

        day_key = (ld.created_at.date() if ld.created_at else today_date).isoformat()
        dbucket = daily_buckets.get(day_key)
        if dbucket is not None:
            dbucket["leads"] += 1
            if ld.visitor_id:
                dbucket["visitors"].add(ld.visitor_id)

        if ld.sku:
            sb = _get_sku(ld.sku, ld.product_key)
            sb["leads"] += 1
            sb["total_quantity"] += max(1, int(ld.quantity or 1))
            sb["estimated_revenue_vnd"] += float(ld.quoted_price_vnd or 0.0)

    leads_count = len(leads)

    by_campaign = [
        {
            "utm_campaign": b["utm_campaign"],
            "utm_source": b["utm_source"],
            "utm_medium": b["utm_medium"],
            "pageviews": b["pageviews"],
            "unique_visitors": len(b["visitors"]),
            "price_views": b["price_views"],
            "call_clicks": b["call_clicks"],
            "zalo_clicks": b["zalo_clicks"],
            "leads": b["leads"],
            "conversion_rate": _pct(b["leads"], b["pageviews"]),
        }
        for b in camp_buckets.values()
    ]
    by_campaign.sort(key=lambda r: (r["leads"], r["pageviews"], r["price_views"]), reverse=True)

    by_page = [
        {
            "page_path": b["page_path"],
            "product_key": b["product_key"],
            "pageviews": b["pageviews"],
            "unique_visitors": len(b["visitors"]),
            "price_views": b["price_views"],
            "call_clicks": b["call_clicks"],
            "zalo_clicks": b["zalo_clicks"],
            "leads": b["leads"],
            "visit_to_price_rate": _pct(b["price_views"], b["pageviews"]),
            "visit_to_lead_rate": _pct(b["leads"], b["pageviews"]),
        }
        for b in page_buckets.values()
    ]
    by_page.sort(key=lambda r: (r["pageviews"], r["leads"]), reverse=True)

    by_sku = [
        {
            "sku": b["sku"],
            "sku_name": b["sku_name"],
            "product_key": b["product_key"],
            "sku_selects": b["sku_selects"],
            "leads": b["leads"],
            "total_quantity": b["total_quantity"],
            "estimated_revenue_vnd": round(b["estimated_revenue_vnd"]),
        }
        for b in sku_buckets.values()
    ]
    by_sku.sort(key=lambda r: (r["leads"], r["sku_selects"], r["estimated_revenue_vnd"]), reverse=True)

    daily = [
        {
            "date": b["date"],
            "pageviews": b["pageviews"],
            "unique_visitors": len(b["visitors"]),
            "price_views": b["price_views"],
            "call_clicks": b["call_clicks"],
            "zalo_clicks": b["zalo_clicks"],
            "leads": b["leads"],
        }
        for b in daily_buckets.values()
    ]

    return {
        "days": days,
        "totals": {
            "pageviews": pageviews,
            "unique_visitors": len(unique_visitors_set),
            "price_views": price_views,
            "sku_selects": sku_selects,
            "coupon_applies": coupon_applies,
            "call_clicks": call_clicks,
            "zalo_clicks": zalo_clicks,
            "leads": leads_count,
            "visit_to_price_rate": _pct(price_views, pageviews),
            "price_to_lead_rate": _pct(leads_count, price_views),
            "visit_to_lead_rate": _pct(leads_count, pageviews),
        },
        "by_campaign": by_campaign,
        "by_page": by_page,
        "by_sku": by_sku,
        "daily": daily,
        "filters": {
            "product_keys": available_products,
            "utm_campaigns": available_campaigns,
        },
    }


def format_daily_digest_message(overview: dict[str, Any], *, public_base_url: str) -> str:
    days = overview["days"]
    t = overview["totals"]
    header = "Báo cáo phễu Ads & Leads (24h qua)" if days == 1 else f"Báo cáo phễu Ads & Leads ({days} ngày qua)"
    lines = [
        f"📊 <b>{_esc(header)}</b>",
        "",
        f"• Lượt xem: <b>{t['pageviews']}</b> ({t['unique_visitors']} khách duy nhất)",
        f"• Xem bảng giá: <b>{t['price_views']}</b> ({t['visit_to_price_rate']}% Visit→Price)",
        f"• Chọn SKU: <b>{t['sku_selects']}</b> · Gọi: <b>{t['call_clicks']}</b> · Zalo: <b>{t['zalo_clicks']}</b>",
        f"• Lead gửi form: <b>{t['leads']}</b> (Price→Lead: {t['price_to_lead_rate']}% · Visit→Lead: {t['visit_to_lead_rate']}%)",
    ]
    top_campaigns = overview.get("by_campaign", [])[:5]
    if top_campaigns:
        lines.append("")
        lines.append("🎯 <b>Top chiến dịch:</b>")
        for c in top_campaigns:
            lines.append(
                f"  - {_esc(c['utm_campaign'])} ({_esc(c['utm_source'])}): "
                f"{c['pageviews']} xem · {c['price_views']} giá · <b>{c['leads']} lead</b> ({c['conversion_rate']}%)"
            )
    top_skus = overview.get("by_sku", [])[:5]
    if top_skus:
        lines.append("")
        lines.append("📦 <b>Nhu cầu theo SKU:</b>")
        for s in top_skus:
            rev = f" · ~{_fmt_vnd(s['estimated_revenue_vnd'])}đ" if s["estimated_revenue_vnd"] else ""
            lines.append(
                f"  - <code>{_esc(s['sku'])}</code>: {s['sku_selects']} chọn · "
                f"<b>{s['leads']} lead</b> (SL {s['total_quantity']}{rev})"
            )
    base = public_base_url.rstrip("/")
    lines.append("")
    lines.append(f'🔗 <a href="{base}/web-ads">Mở Dashboard Ads &amp; Leads KSP</a>')
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# CRM Customer Creation & Draft Quote Prefill
# ---------------------------------------------------------------------------
def create_or_link_customer_from_lead(db: Session, lead: WebLead) -> tuple[Customer, bool]:
    """Create a Customer record for lead or link to existing by id/phone/email/name."""
    if lead.customer_id:
        existing = db.get(Customer, lead.customer_id)
        if existing is not None:
            return existing, False

    phone = crypto.decrypt(lead.phone_ciphertext)
    existing = find_matching_customer(
        db,
        phone=phone,
        email=lead.email,
        company=lead.company,
        name=lead.name,
        include_name=True,
    )
    if existing is not None:
        lead.customer_id = existing.id
        lead.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(lead)
        return existing, False

    display_name = lead.company.strip() or lead.name.strip() or f"Khách Website #{lead.id}"
    if lead.company.strip() and lead.name.strip() and phone:
        contact = f"{lead.name.strip()} - {phone}"
    elif lead.company.strip() and lead.name.strip():
        contact = lead.name.strip()
    else:
        contact = phone or lead.name.strip()

    note_parts = [f"Lead từ Website Ads (#{lead.id})"]
    if lead.utm_campaign:
        note_parts.append(f"Chiến dịch: {lead.utm_campaign}")
    if lead.sku:
        note_parts.append(f"SKU: {lead.sku}")

    customer = Customer(
        name=display_name[:255],
        tax_code="",
        contact=contact[:255],
        address="",
        email=(lead.email or "")[:255],
        note=" · ".join(note_parts)[:1000],
    )
    db.add(customer)
    db.flush()

    lead.customer_id = customer.id
    lead.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(customer)
    db.refresh(lead)
    return customer, True


def build_draft_quote_from_lead(db: Session, lead: WebLead) -> dict[str, Any]:
    """Build a ready-to-use CreateQuote prefill payload using canonical SKU prices & discounts."""
    phone = crypto.decrypt(lead.phone_ciphertext)
    customer = db.get(Customer, lead.customer_id) if lead.customer_id else None

    customer_name = (
        (customer.name if customer and customer.name else "")
        or lead.company.strip()
        or lead.name.strip()
    )
    customer_contact = (
        (customer.contact if customer and customer.contact else "")
        or (f"{lead.name.strip()} - {phone}" if lead.name.strip() and phone else phone or lead.name.strip())
    )
    customer_email = (customer.email if customer and customer.email else "") or lead.email.strip()
    customer_address = customer.address if customer else ""
    customer_tax_code = customer.tax_code if customer else ""

    qty = max(1, int(lead.quantity or 1))
    effective_sku = lead.sku.strip().upper() if lead.sku else ""
    if effective_sku not in SKU_CATALOG and not effective_sku:
        effective_sku = DEFAULT_SKU_BY_PRODUCT.get((lead.product_key or "").lower(), "")

    pricing = compute_sku_pricing(
        effective_sku,
        quantity=qty,
        coupon_code=lead.coupon_code,
        discount_percent=lead.discount_percent,
    )

    if pricing:
        item_name = f"{pricing['sku_name']} ({pricing['sku']})"
        unit_price = pricing["unit_price"]
        dvt = pricing["dvt"]
        coupon_code = pricing["coupon_code"]
        discount_pct = pricing["discount_percent"]
        volume_pct = pricing["volume_discount_percent"]
        subtotal = pricing["subtotal_vnd"]
        vat = pricing["vat_vnd"]
        total = pricing["total_vnd"]
        is_dealer = pricing["is_dealer_tier"]
    else:
        item_name = lead.product_name.strip() or "Thiết bị / Giải pháp iNut IoT"
        if lead.sku:
            item_name = f"{item_name} ({lead.sku})"
        unit_price = round(float(lead.quoted_price_vnd) / qty) if lead.quoted_price_vnd > 0 else 0
        dvt = "Bộ"
        coupon_code = lead.coupon_code.strip().upper()
        discount_pct = float(lead.discount_percent or 0.0)
        volume_pct = 5.0 if qty >= 3 else 0.0
        subtotal = int(unit_price * qty)
        vat = round(subtotal * 0.10)
        total = int(subtotal + vat)
        is_dealer = qty >= 10

    note_lines: list[str] = [f"Báo giá từ Website Lead #{lead.id} ({lead.name})"]
    if coupon_code:
        disc_str = f" (-{int(discount_pct)}%)" if discount_pct > 0 else ""
        note_lines.append(f"Áp dụng mã ưu đãi: {coupon_code}{disc_str}")
    if volume_pct > 0:
        tier_label = "Chiết khấu dự án / Đại lý SI (>=10 bộ, áp dụng -5% nền + thương lượng riêng)" if is_dealer else f"Chiết khấu số lượng >=3 bộ (-{int(volume_pct)}%)"
        note_lines.append(tier_label)
    if lead.device_info:
        note_lines.append(f"Thiết bị kết nối: {lead.device_info}")
    if lead.need:
        note_lines.append(f"Nhu cầu: {lead.need}")
    if lead.message:
        note_lines.append(f"Ghi chú khách: {lead.message}")

    return {
        "lead_id": lead.id,
        "customer_id": lead.customer_id,
        "customer_name": customer_name,
        "customer_contact": customer_contact,
        "customer_phone": phone,
        "customer_email": customer_email,
        "customer_address": customer_address,
        "customer_tax_code": customer_tax_code,
        "sku": pricing["sku"] if pricing else lead.sku,
        "coupon_code": coupon_code,
        "discount_percent": discount_pct,
        "volume_discount_percent": volume_pct,
        "items": [
            {
                "ten": item_name,
                "dvt": dvt,
                "so_luong": qty,
                "don_gia": unit_price,
                "thue_suat": 10,
            }
        ],
        "subtotal_vnd": subtotal,
        "vat_vnd": vat,
        "total_vnd": total,
        "note": "\n".join(note_lines),
    }


def list_leads_with_counts(
    db: Session,
    *,
    status_filter: str = "",
    product_key: str = "",
    utm_campaign: str = "",
    q: str = "",
    limit: int = 50,
    offset: int = 0,
    mask_phone: bool = False,
) -> tuple[int, list[dict[str, Any]]]:
    stmt = select(WebLead)
    if status_filter:
        stmt = stmt.where(WebLead.status == status_filter)
    if product_key:
        stmt = stmt.where(func.lower(WebLead.product_key) == product_key.lower())
    if utm_campaign:
        stmt = stmt.where(WebLead.utm_campaign == utm_campaign)

    rows = list(db.scalars(stmt.order_by(WebLead.created_at.desc(), WebLead.id.desc())))

    search = _clean_str(q, 200).lower()
    if search:
        search_digits = phone_digits(search)
        search_phone_hash = ""
        if len(search_digits) >= 8:
            try:
                search_phone_hash = crypto.fingerprint(normalize_lead_phone(search))
            except ValueError:
                search_phone_hash = ""

        filtered: list[WebLead] = []
        for row in rows:
            haystack = " ".join(
                [
                    row.name or "",
                    row.company or "",
                    row.email or "",
                    row.phone_last4 or "",
                    row.sku or "",
                    row.product_name or "",
                    row.product_key or "",
                    row.device_info or "",
                    row.need or "",
                    row.message or "",
                    row.utm_campaign or "",
                    row.utm_source or "",
                    row.coupon_code or "",
                    row.note or "",
                ]
            ).lower()
            matched = search in haystack
            if not matched and search_phone_hash and row.phone_hash == search_phone_hash:
                matched = True
            if not matched and len(search_digits) >= 4:
                dec = crypto.decrypt(row.phone_ciphertext)
                if search_digits in phone_digits(dec):
                    matched = True
            if matched:
                filtered.append(row)
        rows = filtered

    total = len(rows)
    page_rows = rows[offset : offset + limit]

    # Batch fetch training query counts & customer names
    ts_ids = {r.training_session_id for r in page_rows if r.training_session_id}
    tq_counts: dict[int, int] = {}
    if ts_ids:
        for sid, cnt in db.execute(
            select(TrainingPublicQuery.session_id, func.count(TrainingPublicQuery.id))
            .where(TrainingPublicQuery.session_id.in_(ts_ids))
            .group_by(TrainingPublicQuery.session_id)
        ):
            tq_counts[int(sid)] = int(cnt)

    cust_ids = {r.customer_id for r in page_rows if r.customer_id}
    cust_names: dict[int, str] = {}
    if cust_ids:
        for cid, cname in db.execute(
            select(Customer.id, Customer.name).where(Customer.id.in_(cust_ids))
        ):
            cust_names[int(cid)] = str(cname)

    items = [
        serialize_lead(
            row,
            mask_phone=mask_phone,
            training_query_count=tq_counts.get(row.training_session_id or 0, 0),
            customer_name=cust_names.get(row.customer_id or 0),
        )
        for row in page_rows
    ]
    return total, items


def get_lead_detail(
    db: Session,
    settings: Settings,
    lead: WebLead,
    *,
    mask_phone: bool = False,
) -> dict[str, Any]:
    customer_name = None
    if lead.customer_id:
        c = db.get(Customer, lead.customer_id)
        customer_name = c.name if c else None

    events_desc: list[WebAdEvent] = []
    if lead.visitor_id:
        events_desc = list(
            db.scalars(
                select(WebAdEvent)
                .where(WebAdEvent.visitor_id == lead.visitor_id)
                .order_by(WebAdEvent.created_at.desc(), WebAdEvent.id.desc())
                .limit(50)
            )
        )
    events_timeline = list(reversed(events_desc))

    training_queries: list[TrainingPublicQuery] = []
    if lead.training_session_id:
        training_queries = list(
            db.scalars(
                select(TrainingPublicQuery)
                .where(TrainingPublicQuery.session_id == lead.training_session_id)
                .order_by(TrainingPublicQuery.created_at.desc(), TrainingPublicQuery.id.desc())
                .limit(50)
            )
        )

    base = serialize_lead(
        lead,
        mask_phone=mask_phone,
        training_query_count=count_training_queries(db, lead.training_session_id),
        customer_name=customer_name,
        include_client_meta=True,
    )
    base["events"] = [serialize_event(ev) for ev in events_timeline]
    base["training_queries"] = [serialize_training_query(q, settings) for q in training_queries]
    return base
