"""Telegram Bot API integration for KSP account linking and notifications."""
from __future__ import annotations

import hashlib
import json
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlsplit

import httpx
from sqlalchemy import select

from .config import Settings
from .db import FacebookMessage, TelegramConnection, TelegramLink, User, get_session

_BOT_TOKEN_RE = re.compile(r"^\d{6,20}:[A-Za-z0-9_-]{20,256}$")
_LINK_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{20,128}$")
_CHAT_ID_RE = re.compile(r"^-?\d{1,32}$")
_BOT_USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{5,64}$")
_poller_lock = threading.Lock()
_poller_started = False
_notify_executor = None
_notify_state_lock = threading.Lock()
_notify_debounce_until: dict[str, float] = {}
_NOTIFY_DEBOUNCE_SECONDS = 10 * 60
_tax_sync_executor = None
_tax_sync_executor_lock = threading.Lock()


class TelegramError(RuntimeError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _validate_api_base(value: str) -> str:
    parsed = urlsplit(str(value or "").strip())
    if parsed.scheme == "https" and parsed.hostname == "api.telegram.org" and parsed.path in {"", "/"}:
        return value.rstrip("/")
    if parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"} and parsed.path in {"", "/"}:
        return value.rstrip("/")
    raise TelegramError("TELEGRAM_API_BASE_URL khong hop le")


def _validate_settings(settings: Settings) -> tuple[str, str]:
    token = str(settings.telegram_bot_token or "").strip()
    username = str(settings.telegram_bot_username or "").strip().lstrip("@")
    if not token:
        raise TelegramError("TELEGRAM_BOT_TOKEN chua duoc cau hinh")
    if not _BOT_TOKEN_RE.fullmatch(token):
        raise TelegramError("TELEGRAM_BOT_TOKEN khong hop le")
    if not _BOT_USERNAME_RE.fullmatch(username):
        raise TelegramError("TELEGRAM_BOT_USERNAME khong hop le")
    _validate_api_base(settings.telegram_api_base_url)
    return token, username


def is_configured(settings: Settings) -> bool:
    if not settings.telegram_enabled or not settings.telegram_bot_token:
        return False
    try:
        _validate_settings(settings)
        return True
    except TelegramError:
        return False


class TelegramClient:
    """Small Bot API client; token is kept out of query strings and errors."""

    def __init__(self, settings: Settings, *, transport: httpx.BaseTransport | None = None) -> None:
        token, _ = _validate_settings(settings)
        self._token = token
        self._base = _validate_api_base(settings.telegram_api_base_url)
        self._timeout = max(5.0, float(settings.facebook_timeout))
        self._http = httpx.Client(timeout=self._timeout, transport=transport)

    def close(self) -> None:
        self._http.close()

    def call(self, method: str, payload: dict[str, Any] | None = None, *, timeout: float | None = None) -> Any:
        if not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_]{1,63}", method):
            raise TelegramError("Telegram method khong hop le")
        url = f"{self._base}/bot{self._token}/{method}"
        try:
            response = self._http.post(url, json=payload or {}, timeout=timeout or self._timeout)
            response.raise_for_status()
            body = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise TelegramError("Khong ket noi duoc Telegram Bot API") from exc
        if not isinstance(body, dict) or body.get("ok") is not True:
            description = str(body.get("description", "Telegram tu choi yeu cau")) if isinstance(body, dict) else "Telegram tra ve du lieu khong hop le"
            raise TelegramError(description[:240])
        return body.get("result")

    def send_message(self, chat_id: str, text: str) -> dict[str, Any]:
        chat = str(chat_id or "").strip()
        if not _CHAT_ID_RE.fullmatch(chat):
            raise TelegramError("Telegram chat id khong hop le")
        message = str(text or "").strip()
        if not message:
            raise TelegramError("Noi dung Telegram dang trong")
        result = self.call("sendMessage", {"chat_id": chat, "text": message[:4096], "disable_web_page_preview": True})
        return result if isinstance(result, dict) else {}

    def send_document(self, chat_id: str, content: bytes, filename: str, caption: str = "") -> dict[str, Any]:
        chat = str(chat_id or "").strip()
        if not _CHAT_ID_RE.fullmatch(chat):
            raise TelegramError("Telegram chat id khong hop le")
        raw = bytes(content or b"")
        if not raw or len(raw) > 2 * 1024 * 1024:
            raise TelegramError("Tai lieu Telegram khong hop le")
        name = re.sub(r"[^A-Za-z0-9._-]+", "_", str(filename or "captcha.svg"))[:120] or "captcha.svg"
        url = f"{self._base}/bot{self._token}/sendDocument"
        try:
            response = self._http.post(
                url,
                data={"chat_id": chat, "caption": str(caption or "")[:1024]},
                files={"document": (name, raw, "image/svg+xml")},
                timeout=self._timeout,
            )
            response.raise_for_status()
            body = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise TelegramError("Khong gui duoc CAPTCHA qua Telegram") from exc
        if not isinstance(body, dict) or body.get("ok") is not True:
            description = str(body.get("description", "Telegram tu choi tai lieu")) if isinstance(body, dict) else "Telegram tra ve du lieu khong hop le"
            raise TelegramError(description[:240])
        result = body.get("result")
        return result if isinstance(result, dict) else {}

    def get_updates(self, offset: int | None, timeout: int) -> list[dict[str, Any]]:
        payload: dict[str, Any] = {"timeout": max(1, min(int(timeout), 50)), "allowed_updates": ["message"]}
        if offset is not None:
            payload["offset"] = offset
        result = self.call("getUpdates", payload, timeout=max(10.0, payload["timeout"] + 10.0))
        return result if isinstance(result, list) else []


def create_connect_link(db, user_id: int, settings: Settings) -> dict[str, Any]:
    """Create a short-lived opaque token; only its hash is persisted."""
    _, username = _validate_settings(settings)
    raw_token = secrets.token_urlsafe(24)
    expires_at = _now() + timedelta(seconds=max(60, min(settings.telegram_connect_ttl_seconds, 3600)))
    db.query(TelegramLink).filter(TelegramLink.user_id == user_id, TelegramLink.used_at.is_(None)).update(
        {TelegramLink.revoked: True}, synchronize_session=False
    )
    db.add(TelegramLink(token_hash=_hash_token(raw_token), user_id=user_id, expires_at=expires_at))
    db.commit()
    return {
        "url": f"https://t.me/{username}?start={raw_token}",
        "expires_at": expires_at.isoformat(),
    }


def connection_status(db, user_id: int) -> dict[str, Any]:
    row = db.scalar(select(TelegramConnection).where(TelegramConnection.user_id == user_id, TelegramConnection.status == "active"))
    if not row:
        return {"connected": False, "username": "", "display_name": "", "connected_at": None}
    return {
        "connected": True,
        "username": row.username,
        "display_name": row.display_name,
        "connected_at": row.connected_at.isoformat() if row.connected_at else None,
    }


def admin_chat_ids(db) -> list[str]:
    rows = db.scalars(
        select(TelegramConnection)
        .join(User)
        .where(TelegramConnection.status == "active", User.role == "admin")
    )
    return [row.chat_id for row in rows if _CHAT_ID_RE.fullmatch(str(row.chat_id or ""))]


def send_tax_captcha(settings: Settings, db, svg: str, caption: str) -> int:
    """Send a one-time tax CAPTCHA to linked admin chats; return successful deliveries."""
    chats = admin_chat_ids(db)
    if not chats or not is_configured(settings):
        return 0
    delivered = 0
    client = TelegramClient(settings)
    try:
        for chat_id in chats:
            try:
                client.send_document(chat_id, str(svg).encode("utf-8"), "tax-captcha.svg", caption)
                delivered += 1
            except TelegramError:
                continue
    finally:
        client.close()
    return delivered


def revoke_connection(db, user_id: int) -> bool:
    row = db.scalar(select(TelegramConnection).where(TelegramConnection.user_id == user_id, TelegramConnection.status == "active"))
    if not row:
        return False
    row.status = "revoked"
    row.revoked_at = _now()
    db.commit()
    return True


def consume_start_token(db, raw_token: str, chat_id: str, username: str = "", display_name: str = "") -> User:
    token = str(raw_token or "").strip()
    chat = str(chat_id or "").strip()
    if not _LINK_TOKEN_RE.fullmatch(token) or not _CHAT_ID_RE.fullmatch(chat):
        raise TelegramError("Link ket noi khong hop le")
    row = db.scalar(select(TelegramLink).where(TelegramLink.token_hash == _hash_token(token)))
    now = _now()
    if not row or row.revoked or row.used_at is not None or row.expires_at.replace(tzinfo=timezone.utc) < now:
        raise TelegramError("Link ket noi da het han hoac da duoc su dung")
    existing_chat = db.scalar(select(TelegramConnection).where(TelegramConnection.chat_id == chat))
    if existing_chat and existing_chat.user_id != row.user_id:
        existing_chat.status = "revoked"
        existing_chat.revoked_at = now
        # Keep the historical row without colliding with the unique active chat id.
        existing_chat.chat_id = f"revoked-{existing_chat.id}-{int(now.timestamp())}"
    connection = db.scalar(select(TelegramConnection).where(TelegramConnection.user_id == row.user_id))
    if connection:
        connection.chat_id = chat
        connection.username = str(username or "")[:255]
        connection.display_name = str(display_name or "")[:255]
        connection.status = "active"
        connection.connected_at = now
        connection.revoked_at = None
    else:
        db.add(TelegramConnection(
            user_id=row.user_id,
            chat_id=chat,
            username=str(username or "")[:255],
            display_name=str(display_name or "")[:255],
            connected_at=now,
        ))
    row.used_at = now
    db.commit()
    return row.user


def _handle_update(settings: Settings, update: dict[str, Any]) -> None:
    message = update.get("message") if isinstance(update, dict) else None
    if not isinstance(message, dict):
        return
    chat = message.get("chat") or {}
    sender = message.get("from") or {}
    chat_id = str(chat.get("id", "")).strip()
    text = str(message.get("text", "")).strip()
    if not chat_id or not text:
        return
    if not text.startswith("/"):
        _handle_tax_captcha_reply(settings, chat_id, text)
        return
    command, _, argument = text.partition(" ")
    command = command.split("@", 1)[0].lower()
    client = TelegramClient(settings)
    try:
        if command == "/start" and argument.strip():
            gen = get_session(); db = next(gen)
            try:
                user = consume_start_token(db, argument.strip(), chat_id, str(sender.get("username", "")), " ".join(filter(None, [str(sender.get("first_name", "")), str(sender.get("last_name", ""))])))
                client.send_message(chat_id, f"Đã kết nối Telegram với tài khoản KSP {user.username}. Bạn sẽ nhận thông báo Messenger mới tại đây.")
            except TelegramError as exc:
                client.send_message(chat_id, f"Không thể kết nối KSP: {exc}")
            finally:
                gen.close()
        elif command == "/status":
            client.send_message(chat_id, "Telegram đã sẵn sàng. Bạn có thể tạo link kết nối mới trong KSP nếu cần.")
        elif command == "/disconnect":
            gen = get_session(); db = next(gen)
            try:
                row = db.scalar(select(TelegramConnection).where(TelegramConnection.chat_id == chat_id, TelegramConnection.status == "active"))
                if row:
                    row.status = "revoked"; row.revoked_at = _now(); db.commit()
                client.send_message(chat_id, "Đã ngắt kết nối Telegram khỏi KSP.")
            finally:
                gen.close()
    finally:
        client.close()


def _tax_executor():
    global _tax_sync_executor
    with _tax_sync_executor_lock:
        if _tax_sync_executor is None:
            from concurrent.futures import ThreadPoolExecutor
            _tax_sync_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="tax-sync")
        return _tax_sync_executor


def _send_tax_sync_result(settings: Settings, chat_id: str, run_id: int) -> None:
    gen = get_session(); db = next(gen)
    try:
        from . import tax_ops
        run = tax_ops.resume_tax_sync(db, run_id)
        stats = json.loads(run.stats or "{}")
        imported = stats.get("import") or {}
        message = (
            f"Đồng bộ thuế {run.status}. Mua vào: cổng {stats.get('mua_cong', 0)}, "
            f"thiếu {len(stats.get('missing_mua') or [])}."
        )
        if imported:
            message += f" Đã nạp nháp {imported.get('imported', 0)} HĐ."
    except Exception as exc:  # noqa: BLE001
        message = f"Đồng bộ thuế không hoàn tất: {type(exc).__name__}. Kiểm tra KSP để xem chi tiết."
    finally:
        gen.close()
    client = TelegramClient(settings)
    try:
        client.send_message(chat_id, message)
    except TelegramError:
        pass
    finally:
        client.close()


def _handle_tax_captcha_reply(settings: Settings, chat_id: str, value: str) -> bool:
    """Accept a CAPTCHA only from a linked admin chat; never ask an LLM to solve it."""
    gen = get_session(); db = next(gen)
    try:
        connection = db.scalar(
            select(TelegramConnection)
            .join(User)
            .where(
                TelegramConnection.chat_id == chat_id,
                TelegramConnection.status == "active",
                User.role == "admin",
            )
        )
        if connection is None:
            return False
        from . import tax, tax_ops
        pending = tax_ops.pending_tax_captcha(db)
        if not pending:
            return False
        cvalue = str(value or "").strip()
        client = TelegramClient(settings)
        try:
            if not re.fullmatch(r"[A-Za-z0-9]{4,12}", cvalue):
                client.send_message(chat_id, "Mã CAPTCHA chỉ gồm 4–12 ký tự chữ/số. Vui lòng nhập lại.")
                return True
            mst, password = tax_ops.stored_tax_credentials(db)
            if not mst or not password:
                client.send_message(chat_id, "KSP chưa có MST/mật khẩu cổng thuế đã lưu; hãy cấu hình trong Đồng bộ thuế.")
                return True
            try:
                token = tax.authenticate(mst, password, pending["ckey"], cvalue)
            except tax.TaxError:
                tax_ops.clear_tax_captcha(db)
                client.send_message(chat_id, "Mã CAPTCHA không đúng hoặc đã hết hạn. KSP sẽ lấy ảnh mới.")
                try:
                    tax_ops.request_tax_captcha(db, settings, pending["run_id"])
                except Exception:
                    pass
                return True
            except Exception:
                client.send_message(chat_id, "Không kết nối được cổng thuế để xác thực. Vui lòng thử lại mã này sau.")
                return True
            tax_ops.store_tax_token(db, token)
            tax_ops.clear_tax_captcha(db)
            client.send_message(chat_id, "Đã gia hạn phiên cổng thuế. Đang đồng bộ tiếp, mình sẽ báo kết quả sau.")
            if pending["run_id"]:
                _tax_executor().submit(_send_tax_sync_result, settings, chat_id, pending["run_id"])
            return True
        finally:
            client.close()
    finally:
        gen.close()


def _poll(settings: Settings) -> None:
    offset: int | None = None
    while True:
        try:
            client = TelegramClient(settings)
            try:
                for update in client.get_updates(offset, settings.telegram_poll_timeout):
                    if isinstance(update, dict) and isinstance(update.get("update_id"), int):
                        offset = update["update_id"] + 1
                    try:
                        _handle_update(settings, update)
                    except Exception:
                        # One malformed update must not stop polling the bot.
                        continue
            finally:
                client.close()
        except Exception:
            time.sleep(5)


def start_poller(settings: Settings) -> None:
    global _poller_started
    if not settings.telegram_enabled or not settings.telegram_bot_token:
        return
    with _poller_lock:
        if _poller_started:
            return
        _poller_started = True
        threading.Thread(target=_poll, args=(settings,), name="telegram-bot-poller", daemon=True).start()


def _notification_key(page_id: str, psid: str, message_id: str) -> str:
    return f"{page_id}:{psid or message_id}"


def _take_notification_slot(key: str, now: float | None = None) -> bool:
    """Allow the first alert, then suppress/extend alerts for this customer."""
    current = time.monotonic() if now is None else now
    with _notify_state_lock:
        for old_key, deadline in list(_notify_debounce_until.items()):
            if deadline <= current:
                _notify_debounce_until.pop(old_key, None)
        deadline = _notify_debounce_until.get(key, 0.0)
        _notify_debounce_until[key] = current + _NOTIFY_DEBOUNCE_SECONDS
        return deadline <= current


def enqueue_messenger_notification(
    page_id: str,
    sender_name: str,
    text: str,
    message_id: str,
    settings: Settings,
    *,
    psid: str = "",
) -> None:
    if not settings.telegram_enabled or not settings.telegram_notify_enabled or not settings.telegram_bot_token:
        return
    if not _take_notification_slot(_notification_key(page_id, psid, message_id)):
        return
    # Import lazily so normal webhook startup does not allocate an executor when disabled.
    global _notify_executor
    if _notify_executor is None:
        from concurrent.futures import ThreadPoolExecutor
        _notify_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="telegram-notify")
    _notify_executor.submit(_send_messenger_notification, page_id, psid, sender_name, text, message_id, settings)


def _send_messenger_notification(
    page_id: str,
    psid: str,
    sender_name: str,
    text: str,
    message_id: str,
    settings: Settings,
) -> None:
    gen = get_session(); db = next(gen)
    try:
        inbound = db.scalar(select(FacebookMessage).where(FacebookMessage.message_id == message_id))
        if inbound is not None:
            psid = psid or inbound.psid
            sender_name = sender_name or inbound.sender_name
            text = text or inbound.text
        latest = None
        if psid:
            latest = db.scalar(
                select(FacebookMessage)
                .where(FacebookMessage.page_id == page_id, FacebookMessage.psid == psid, FacebookMessage.direction == "inbound")
                .order_by(FacebookMessage.created_at.desc(), FacebookMessage.id.desc())
            )
            if latest is not None:
                sender_name = latest.sender_name or sender_name
                text = latest.text or text
        # Webhook payloads often omit the display name. A best-effort Graph lookup
        # keeps the Telegram card useful without delaying the webhook response.
        if not sender_name and psid and settings.facebook_page_access_token:
            try:
                from .facebook import MessengerClient
                messenger = MessengerClient(
                    settings.facebook_page_access_token,
                    graph_base_url=settings.facebook_graph_base_url,
                    graph_version=settings.facebook_graph_version,
                    timeout=settings.facebook_timeout,
                )
                try:
                    sender_name = messenger.get_profile_name(psid)
                finally:
                    messenger.close()
                if sender_name and latest is not None:
                    latest.sender_name = sender_name[:255]
                    db.commit()
            except Exception:
                db.rollback()
        rows = list(db.scalars(select(TelegramConnection).join(User).where(TelegramConnection.status == "active", User.role == "admin")))
        if not rows:
            return
        preview = " ".join(str(text or "").split())[:700]
        sender = str(sender_name or "Khách Facebook (chưa lấy được tên)").strip()[:255]
        page_name = str(settings.facebook_page_name or "Facebook Page").strip()[:255]
        page_link = f"https://www.facebook.com/{page_id}"
        customer_link = f"https://www.facebook.com/messages/t/{psid}" if psid else "Chưa có link cuộc trò chuyện"
        business_link = f"https://business.facebook.com/latest/inbox/all?asset_id={page_id}&selected_item_id={psid}" if psid else ""
        ksp_link = settings.public_base_url.rstrip("/") + "/messenger"
        lines = [
            "Tin nhắn Messenger mới",
            f"Trang: {page_name}",
            f"Page ID: {page_id}",
            f"Mở trang: {page_link}",
            "",
            f"Khách Facebook: {sender}",
            f"PSID: {psid or 'không có'}",
            f"Mở cuộc trò chuyện: {customer_link}",
        ]
        if business_link:
            lines.append(f"Mở Business Inbox: {business_link}")
        lines.extend(["", f"Tin nhắn: {preview or '(không có nội dung văn bản)' }", "", f"Mở KSP: {ksp_link}"])
        body = "\n".join(lines)
        client = TelegramClient(settings)
        try:
            for row in rows:
                try:
                    client.send_message(row.chat_id, body)
                except TelegramError:
                    continue
        finally:
            client.close()
    finally:
        gen.close()
