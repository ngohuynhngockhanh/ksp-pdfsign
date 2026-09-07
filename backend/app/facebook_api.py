"""Meta Messenger webhook endpoints."""
from __future__ import annotations

import hashlib
import hmac
import json

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from . import facebook, telegram
from .config import get_settings
from .db import FacebookMessage, get_session

router = APIRouter(prefix="/webhooks/facebook", tags=["facebook"])


@router.get("", response_class=PlainTextResponse)
async def facebook_verify(request: Request):
    settings = get_settings()
    if not settings.facebook_enabled or not settings.facebook_verify_token:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Facebook webhook chua duoc cau hinh")
    params = request.query_params
    if (
        params.get("hub.mode") != "subscribe"
        or not hmac.compare_digest(params.get("hub.verify_token", ""), settings.facebook_verify_token)
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Facebook verification token khong hop le")
    challenge = params.get("hub.challenge", "")
    if not challenge or len(challenge) > 256:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Facebook challenge khong hop le")
    return challenge


@router.post("")
async def facebook_events(request: Request):
    settings = get_settings()
    if not settings.facebook_enabled or not settings.facebook_app_secret:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Facebook webhook chua duoc cau hinh")
    body = await request.body()
    if len(body) > 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Facebook event qua lon")
    if not _valid_signature(body, request.headers.get("x-hub-signature-256", ""), settings.facebook_app_secret):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Facebook signature khong hop le")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Facebook payload khong hop le") from exc
    if not isinstance(payload, dict) or payload.get("object") != "page":
        return {"ok": True, "accepted": 0}

    accepted = 0
    for entry in payload.get("entry", []):
        if not isinstance(entry, dict):
            continue
        page_id = str(entry.get("id", "")).strip()
        if page_id != settings.facebook_page_id:
            continue
        events = entry.get("messaging", [])
        if not isinstance(events, list):
            continue
        for event in events:
            if not isinstance(event, dict):
                continue
            message = event.get("message")
            if not isinstance(message, dict) or message.get("is_echo"):
                continue
            psid = str((event.get("sender") or {}).get("id", "")).strip()
            sender_name = str((event.get("sender") or {}).get("name", "")).strip()[:255]
            message_id = str(message.get("mid", "")).strip()
            text = str(message.get("text", "")).strip()
            if not psid or not message_id or len(psid) > 128 or len(message_id) > 255:
                continue
            if not text and message.get("attachments"):
                text = "Khách gửi một tệp đính kèm. Hãy hỏi lại nhu cầu bằng văn bản."
            if not text:
                continue
            text = text[:2000]
            if _record_inbound(page_id, psid, message_id, text, sender_name):
                telegram.enqueue_messenger_notification(page_id, sender_name, text, message_id, settings, psid=psid)
                enqueue_message(page_id, psid, message_id, text)
                accepted += 1
    return {"ok": True, "accepted": accepted}


def enqueue_message(page_id: str, psid: str, message_id: str, text: str) -> None:
    facebook.enqueue_message(page_id, psid, message_id, text)


def _valid_signature(body: bytes, provided: str, secret: str) -> bool:
    if not provided.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, provided[7:])


def _record_inbound(page_id: str, psid: str, message_id: str, text: str, sender_name: str = "") -> bool:
    generator = get_session()
    db = next(generator)
    try:
        if db.scalar(select(FacebookMessage).where(FacebookMessage.message_id == message_id)):
            return False
        db.add(FacebookMessage(
            page_id=page_id,
            psid=psid,
            sender_name=sender_name,
            message_id=message_id,
            text=text,
        ))
        db.commit()
        return True
    except IntegrityError:
        db.rollback()
        return False
    finally:
        generator.close()
