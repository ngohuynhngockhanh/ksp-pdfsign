"""FastAPI router for iNut Website Ads Analytics & Lead Capture."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from . import audit, public_training, web_ads
from .auth import CurrentUser, require_admin
from .config import Settings, get_settings
from .db import Customer, Document, WebLead, get_session

router = APIRouter(tags=["web-ads"])


def _parse_internal_json(body: bytes) -> dict[str, Any]:
    try:
        parsed = json.loads(body or b"{}")
    except (TypeError, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Dữ liệu yêu cầu không hợp lệ") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Dữ liệu yêu cầu không hợp lệ")
    return parsed


def _audit(db: Session, user: CurrentUser, action: str, target: str = "", detail: str = "") -> None:
    audit.record(db, user.username, user.role, user.ip, action, target, detail)


# ---------------------------------------------------------------------------
# 1. Internal HMAC-Authenticated Endpoints (called by inut-website BFF)
# ---------------------------------------------------------------------------
@router.post("/internal/web-ads/events", status_code=status.HTTP_201_CREATED)
async def internal_web_ads_event_create(
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    raw_body = await public_training.require_internal_signature(request, settings)
    payload = _parse_internal_json(raw_body)
    try:
        event = web_ads.record_ad_event(db, settings, payload)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return {"ok": True, "event_id": event.id}


@router.post("/internal/web-ads/leads", status_code=status.HTTP_201_CREATED)
async def internal_web_ads_lead_create(
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    raw_body = await public_training.require_internal_signature(request, settings)
    payload = _parse_internal_json(raw_body)
    try:
        lead, _ = web_ads.record_web_lead(db, settings, payload)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return {
        "ok": True,
        "lead_id": lead.id,
        "matched_customer_id": lead.customer_id,
        "matched_training_session_id": lead.training_session_id,
    }


# ---------------------------------------------------------------------------
# 2. Admin Endpoints (authenticated KSP admins, matching /api/training/public-leads)
# ---------------------------------------------------------------------------
@router.get("/api/web-ads/overview")
def admin_web_ads_overview(
    days: int = Query(30, ge=1, le=365),
    product_key: str = Query(""),
    utm_campaign: str = Query(""),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    return web_ads.build_overview(
        db,
        days=days,
        product_key=product_key,
        utm_campaign=utm_campaign,
    )


@router.get("/api/web-ads/leads")
def admin_web_ads_leads_list(
    status_filter: str = Query("", alias="status"),
    product_key: str = Query(""),
    utm_campaign: str = Query(""),
    q: str = Query(""),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    mask_phone: bool = Query(False),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    if status_filter and status_filter not in web_ads.ALLOWED_LEAD_STATUSES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Trạng thái lead không hợp lệ")
    total, items = web_ads.list_leads_with_counts(
        db,
        status_filter=status_filter,
        product_key=product_key,
        utm_campaign=utm_campaign,
        q=q,
        limit=limit,
        offset=offset,
        mask_phone=mask_phone,
    )
    _audit(db, user, "web_ads_leads_list", str(total))
    return {"total": total, "limit": limit, "offset": offset, "items": items}


@router.get("/api/web-ads/leads/{lead_id}")
def admin_web_ads_lead_detail(
    lead_id: int,
    mask_phone: bool = Query(False),
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    lead = db.get(WebLead, lead_id)
    if lead is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy lead")
    _audit(db, user, "web_ads_lead_view", str(lead_id))
    return web_ads.get_lead_detail(db, settings, lead, mask_phone=mask_phone)


class WebLeadPatchIn(BaseModel):
    status: str | None = None
    note: str | None = Field(default=None, max_length=5000)
    sku: str | None = Field(default=None, max_length=64)
    quantity: int | None = Field(default=None, ge=1, le=10000)
    quoted_price_vnd: float | None = Field(default=None, ge=0)
    customer_id: int | None = None
    quote_document_id: int | None = None


@router.patch("/api/web-ads/leads/{lead_id}")
def admin_web_ads_lead_update(
    lead_id: int,
    body: WebLeadPatchIn,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    lead = db.get(WebLead, lead_id)
    if lead is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy lead")

    fields = body.model_fields_set
    if "status" in fields and body.status is not None:
        if body.status not in web_ads.ALLOWED_LEAD_STATUSES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Trạng thái lead không hợp lệ")
        lead.status = body.status

    if "note" in fields and body.note is not None:
        lead.note = body.note.strip()

    if "sku" in fields and body.sku is not None:
        sku_clean = body.sku.strip()
        sku_upper = sku_clean.upper()
        lead.sku = sku_upper if sku_upper in web_ads.SKU_CATALOG else sku_clean
        if lead.sku in web_ads.SKU_CATALOG:
            spec = web_ads.SKU_CATALOG[lead.sku]
            lead.product_key = spec["product_key"]
            lead.product_name = spec["name"]

    if "quantity" in fields and body.quantity is not None:
        lead.quantity = body.quantity

    if "quoted_price_vnd" in fields and body.quoted_price_vnd is not None:
        lead.quoted_price_vnd = float(body.quoted_price_vnd)

    if "customer_id" in fields:
        if body.customer_id is None:
            lead.customer_id = None
        else:
            if db.get(Customer, body.customer_id) is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy khách hàng")
            lead.customer_id = body.customer_id

    if "quote_document_id" in fields:
        if body.quote_document_id is None:
            lead.quote_document_id = None
        else:
            if db.get(Document, body.quote_document_id) is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy hồ sơ báo giá")
            lead.quote_document_id = body.quote_document_id

    lead.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(lead)
    _audit(db, user, "web_ads_lead_update", str(lead_id), lead.status)

    customer_name = None
    if lead.customer_id:
        c = db.get(Customer, lead.customer_id)
        customer_name = c.name if c else None
    return web_ads.serialize_lead(
        lead,
        training_query_count=web_ads.count_training_queries(db, lead.training_session_id),
        customer_name=customer_name,
    )


@router.delete("/api/web-ads/leads/{lead_id}")
def admin_web_ads_lead_delete(
    lead_id: int,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    lead = db.get(WebLead, lead_id)
    if lead is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy lead")
    db.delete(lead)
    db.commit()
    _audit(db, user, "web_ads_lead_delete", str(lead_id))
    return {"ok": True, "deleted_id": lead_id}


@router.post("/api/web-ads/leads/{lead_id}/create-customer")
def admin_web_ads_lead_create_customer(
    lead_id: int,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    lead = db.get(WebLead, lead_id)
    if lead is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy lead")
    customer, created = web_ads.create_or_link_customer_from_lead(db, lead)
    _audit(
        db,
        user,
        "web_ads_lead_create_customer",
        str(lead_id),
        f"customer_id={customer.id} created={created}",
    )
    return {
        "ok": True,
        "customer_id": customer.id,
        "created": created,
        "customer": {
            "id": customer.id,
            "name": customer.name,
            "tax_code": customer.tax_code,
            "contact": customer.contact,
            "address": customer.address,
            "email": customer.email,
            "note": customer.note,
        },
    }


@router.post("/api/web-ads/leads/{lead_id}/draft-quote")
def admin_web_ads_lead_draft_quote(
    lead_id: int,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    lead = db.get(WebLead, lead_id)
    if lead is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy lead")
    _audit(db, user, "web_ads_lead_draft_quote", str(lead_id))
    return web_ads.build_draft_quote_from_lead(db, lead)


class DailyDigestIn(BaseModel):
    days: int | None = Field(default=None, ge=1, le=90)


@router.post("/api/web-ads/daily-digest")
def admin_web_ads_daily_digest(
    days: int = Query(1, ge=1, le=90),
    body: DailyDigestIn | None = Body(default=None),
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    effective_days = body.days if (body and body.days is not None) else days
    overview = web_ads.build_overview(db, days=effective_days)
    message = web_ads.format_daily_digest_message(overview, public_base_url=settings.public_base_url)
    delivered = web_ads.send_telegram_html(db, settings, message)
    _audit(db, user, "web_ads_daily_digest", str(effective_days), f"delivered={delivered}")
    return {
        "ok": True,
        "sent": delivered > 0,
        "delivered_count": delivered,
        "summary": {
            "days": effective_days,
            "totals": overview["totals"],
            "top_campaigns": overview["by_campaign"][:5],
            "top_skus": overview["by_sku"][:5],
            "message": message,
        },
    }
