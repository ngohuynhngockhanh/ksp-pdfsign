from __future__ import annotations

from urllib.parse import parse_qs, urlsplit

import pytest


def _enable(monkeypatch):
    monkeypatch.setenv("TELEGRAM_ENABLED", "true")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123456789:A" + "b" * 30)
    monkeypatch.setenv("TELEGRAM_BOT_USERNAME", "Webinut_bot")
    from app import telegram
    monkeypatch.setattr(telegram, "start_poller", lambda settings: None)
    from app.config import get_settings
    get_settings.cache_clear()


def _login(client):
    response = client.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})
    assert response.status_code == 200


def test_telegram_link_is_single_use_and_binds_admin(client, monkeypatch):
    _enable(monkeypatch)
    _login(client)

    created = client.post("/api/telegram/connect")
    assert created.status_code == 200, created.text
    link = created.json()
    token = parse_qs(urlsplit(link["url"]).query)["start"][0]
    assert token not in link["url"].split("?start=", 1)[0]

    from app import db as dbmod
    from app import telegram

    gen = dbmod.get_session(); db = next(gen)
    try:
        user = telegram.consume_start_token(db, token, "987654321", "khanh", "Ngô Khánh")
        assert user.username == "admin"
        assert telegram.connection_status(db, user.id)["connected"] is True
        with pytest.raises(telegram.TelegramError):
            telegram.consume_start_token(db, token, "987654321", "khanh", "Ngô Khánh")
    finally:
        gen.close()

    status = client.get("/api/telegram/status")
    assert status.status_code == 200
    assert status.json()["connected"] is True


def test_telegram_connect_requires_server_configuration(client, monkeypatch):
    monkeypatch.setenv("TELEGRAM_ENABLED", "false")
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    from app.config import get_settings
    get_settings.cache_clear()
    _login(client)

    status = client.get("/api/telegram/status")
    assert status.status_code == 200
    assert status.json()["enabled"] is False
    assert client.post("/api/telegram/connect").status_code == 503


def test_telegram_client_keeps_bot_token_out_of_url(monkeypatch):
    import httpx
    from app.config import Settings
    from app.telegram import TelegramClient

    token = "123456789:" + "z" * 30
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"ok": True, "result": {"message_id": 1}})

    settings = Settings(telegram_enabled=True, telegram_bot_token=token)
    client = TelegramClient(settings, transport=httpx.MockTransport(handler))
    try:
        client.send_message("123456789", "Xin chào")
    finally:
        client.close()
    assert token in str(requests[0].url)
    # The Bot API necessarily carries its credential in the path; application errors
    # and database values must never persist it.
    assert token not in requests[0].content.decode("utf-8")


def test_telegram_client_sends_captcha_as_document(monkeypatch):
    import httpx
    from app.config import Settings
    from app.telegram import TelegramClient

    token = "123456789:" + "q" * 30
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"ok": True, "result": {"message_id": 2}})

    settings = Settings(telegram_enabled=True, telegram_bot_token=token)
    client = TelegramClient(settings, transport=httpx.MockTransport(handler))
    try:
        client.send_document("987654321", b"<svg></svg>", "tax-captcha.svg", "Nhập mã CAPTCHA")
    finally:
        client.close()

    assert "/sendDocument" in str(requests[0].url)
    assert b"tax-captcha.svg" in requests[0].content
    assert b"<svg></svg>" in requests[0].content
    assert token not in requests[0].content.decode("utf-8")


def test_messenger_notification_debounce_is_per_customer():
    from app import telegram

    with telegram._notify_state_lock:
        telegram._notify_debounce_until.clear()
    assert telegram._take_notification_slot("page:customer-a", now=100.0) is True
    assert telegram._take_notification_slot("page:customer-a", now=200.0) is False
    # A new message extends the quiet window from the latest message.
    assert telegram._notify_debounce_until["page:customer-a"] == 800.0
    assert telegram._take_notification_slot("page:customer-b", now=200.0) is True
    assert telegram._take_notification_slot("page:customer-a", now=801.0) is True


def test_tax_captcha_reply_is_admin_only_and_resumes_job(monkeypatch):
    from app import crypto, tax, tax_ops, telegram
    from app.config import Settings
    from app.db import AppSetting, Base, JobRun, TelegramConnection, User
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, expire_on_commit=False)()
    admin = User(username="admin", password_hash="x", role="admin")
    db.add(admin)
    db.flush()
    db.add(TelegramConnection(user_id=admin.id, chat_id="987654321", status="active"))
    db.add(JobRun(kind="tax_sync", period_from="2026-07-01", period_to="2026-08-31"))
    db.add_all([
        AppSetting(key="tax_mst", value="4401053694"),
        AppSetting(key="tax_password_enc", value="enc:" + crypto.encrypt("secret-password")),
        AppSetting(key="tax_pending_ckey", value=crypto.encrypt("challenge-key")),
        AppSetting(key="tax_pending_run_id", value="1"),
        AppSetting(key="tax_pending_created_at", value=telegram._now().isoformat()),
    ])
    db.commit()

    sent: list[str] = []

    class FakeClient:
        def __init__(self, *_args, **_kwargs):
            pass

        def send_message(self, _chat_id, text):
            sent.append(text)
            return {}

        def close(self):
            pass

    class FakeExecutor:
        def __init__(self):
            self.jobs = []

        def submit(self, *args):
            self.jobs.append(args)

    executor = FakeExecutor()
    monkeypatch.setattr(telegram, "get_session", lambda: (item for item in [db]))
    monkeypatch.setattr(telegram, "TelegramClient", FakeClient)
    monkeypatch.setattr(telegram, "_tax_executor", lambda: executor)
    monkeypatch.setattr(tax, "authenticate", lambda mst, password, ckey, cvalue: "new-session-token")

    settings = Settings(
        telegram_enabled=True,
        telegram_bot_token="123456789:" + "a" * 30,
        telegram_bot_username="Webinut_bot",
    )
    assert telegram._handle_tax_captcha_reply(settings, "not-linked", "AB12") is False
    assert telegram._handle_tax_captcha_reply(settings, "987654321", "AB12") is True

    token_row = db.get(AppSetting, "tax_token_enc")
    assert token_row is not None
    assert crypto.decrypt(token_row.value) == "new-session-token"
    assert tax_ops.pending_tax_captcha(db) is None
    assert executor.jobs and executor.jobs[0][-1] == 1
    assert any("Đã gia hạn" in message for message in sent)
