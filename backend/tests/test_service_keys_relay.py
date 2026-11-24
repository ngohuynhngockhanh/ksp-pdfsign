"""Tests for scoped Service API Keys + Email attachment & Telegram relay endpoints."""
from __future__ import annotations

import base64
from fastapi.testclient import TestClient

from app import main as main_mod
from app import tax_ops, telegram
from app.config import get_settings
from app.db import AuditLog, ServiceApiKey, get_session


def _anon() -> TestClient:
    return TestClient(main_mod.app)


def _login_admin(client: TestClient) -> None:
    s = get_settings()
    r = client.post(
        "/api/login",
        json={"username": s.app_admin_username, "password": s.app_admin_password},
    )
    assert r.status_code == 200, r.text


def test_service_key_crud_scopes_and_revocation(client, monkeypatch):
    anon = _anon()
    # Unauthenticated access to service-keys CRUD must fail with 401
    assert anon.get("/api/service-keys").status_code == 401
    assert anon.post("/api/service-keys", json={"name": "hack"}).status_code == 401

    _login_admin(client)

    # Create a full-scope key for inut-solar-hub
    res = client.post(
        "/api/service-keys",
        json={"name": "inut-solar-hub", "scopes": ["mail:send", "telegram:send"]},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    raw_key = body["api_key"]
    key_id = body["key"]["id"]
    assert raw_key.startswith("ksp_svc_")
    assert body["key"]["is_active"] is True
    assert set(body["key"]["scopes"]) == {"mail:send", "telegram:send"}

    # Listing keys MUST NOT expose the raw secret key or key_hash
    lst = client.get("/api/service-keys")
    assert lst.status_code == 200
    assert raw_key not in lst.text
    assert "key_hash" not in lst.text

    # DB MUST store SHA-256 hash only, never raw key
    gen = get_session()
    db = next(gen)
    try:
        row = db.get(ServiceApiKey, key_id)
        assert row is not None
        assert row.key_hash != raw_key
        assert len(row.key_hash) == 64
    finally:
        gen.close()

    # Mail relay with PDF + XLSX base64 attachments succeeds via Service API Key
    captured_mail: list[dict] = []

    def fake_send_custom_email(db_sess, **kw):
        captured_mail.append(kw)
        return True

    monkeypatch.setattr(tax_ops, "send_custom_email", fake_send_custom_email)
    pdf_bytes = b"%PDF-1.4 sample solar monthly report"
    xlsx_bytes = b"PK\x03\x04samplexlsx"
    r_mail = anon.post(
        "/api/mail/send",
        headers={"Authorization": f"Bearer {raw_key}"},
        json={
            "to": "ops@inut.vn",
            "subject": "[iNut Solar] Báo cáo tháng 11",
            "body": "Plain summary",
            "html": "<p>HTML summary</p>",
            "attachments": [
                {
                    "filename": "report_11_2026.pdf",
                    "content_type": "application/pdf",
                    "content_b64": base64.b64encode(pdf_bytes).decode("ascii"),
                },
                {
                    "filename": "settlement.xlsx",
                    "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "content_b64": base64.b64encode(xlsx_bytes).decode("ascii"),
                },
            ],
        },
    )
    assert r_mail.status_code == 200, r_mail.text
    assert r_mail.json()["attachments_count"] == 2
    assert len(captured_mail) == 1
    atts = captured_mail[0]["attachments"]
    assert len(atts) == 2
    assert atts[0] == ("report_11_2026.pdf", "application/pdf", pdf_bytes)
    assert atts[1][2] == xlsx_bytes

    # Telegram relay succeeds via Service API Key (X-API-Key header) with parse_mode=HTML & speak_tts=False
    tg_sent: list[tuple] = []

    class FakeTGClient:
        def __init__(self, settings):
            pass

        def send_message(self, chat_id, text, *, speak_tts=True, parse_mode=""):
            tg_sent.append((chat_id, text, speak_tts, parse_mode))
            return {"message_id": 42}

        def close(self):
            pass

    monkeypatch.setattr(telegram, "is_configured", lambda _s: True)
    monkeypatch.setattr(telegram, "admin_chat_ids", lambda _db: ["123456789"])
    monkeypatch.setattr(telegram, "TelegramClient", FakeTGClient)

    r_tg = anon.post(
        "/api/telegram/send",
        headers={"X-API-Key": raw_key},
        json={"message": "<b>[iNut Solar]</b> Alert OK", "parse_mode": "HTML", "speak_tts": False},
    )
    assert r_tg.status_code == 200, r_tg.text
    assert r_tg.json()["delivered_count"] == 1
    assert tg_sent == [("123456789", "<b>[iNut Solar]</b> Alert OK", False, "HTML")]

    # Explicit chat_id override also works
    r_tg2 = anon.post(
        "/api/telegram/send",
        headers={"Authorization": f"Bearer {raw_key}"},
        json={"message": "Group ping", "chat_id": "-100999888", "parse_mode": "HTML", "speak_tts": False},
    )
    assert r_tg2.status_code == 200, r_tg2.text
    assert tg_sent[-1][0] == "-100999888"

    # Mail-only scoped key MUST be rejected on /api/telegram/send (401)
    r_mail_only = client.post(
        "/api/service-keys",
        json={"name": "mail-only-app", "scopes": ["mail:send"]},
    )
    assert r_mail_only.status_code == 200
    mail_only_key = r_mail_only.json()["api_key"]
    assert anon.post(
        "/api/telegram/send",
        headers={"Authorization": f"Bearer {mail_only_key}"},
        json={"message": "should fail"},
    ).status_code == 401
    assert anon.post(
        "/api/mail/send",
        headers={"Authorization": f"Bearer {mail_only_key}"},
        json={"to": "ops@inut.vn", "subject": "OK", "body": "Hi"},
    ).status_code == 200

    # Revoking the key immediately blocks both /api/mail/send and /api/telegram/send
    r_rev = client.delete(f"/api/service-keys/{key_id}")
    assert r_rev.status_code == 200
    assert r_rev.json()["key"]["is_active"] is False

    assert anon.post(
        "/api/mail/send",
        headers={"Authorization": f"Bearer {raw_key}"},
        json={"to": "ops@inut.vn", "subject": "Blocked", "body": "No"},
    ).status_code == 401
    assert anon.post(
        "/api/telegram/send",
        headers={"Authorization": f"Bearer {raw_key}"},
        json={"message": "Blocked"},
    ).status_code == 401

    # Verify audit records exist for key creation, revocation, mail & telegram sends
    gen = get_session()
    db = next(gen)
    try:
        actions = {a.action for a in db.query(AuditLog).all()}
        assert "service_key_create" in actions
        assert "service_key_revoke" in actions
        assert "mail_send" in actions
        assert "telegram_send" in actions
    finally:
        gen.close()


def test_mail_send_rejects_invalid_base64_and_too_many_attachments(client, monkeypatch):
    _login_admin(client)
    monkeypatch.setattr(tax_ops, "send_custom_email", lambda *a, **kw: True)

    r_bad = client.post(
        "/api/mail/send",
        json={
            "to": "ops@inut.vn",
            "subject": "Bad b64",
            "body": "Test",
            "attachments": [{"filename": "bad.pdf", "content_type": "application/pdf", "content_b64": "!!!not-base64!!!"}],
        },
    )
    assert r_bad.status_code == 400

    too_many = [
        {"filename": f"f{i}.txt", "content_type": "text/plain", "content_b64": base64.b64encode(b"hi").decode("ascii")}
        for i in range(6)
    ]
    r_many = client.post(
        "/api/mail/send",
        json={"to": "ops@inut.vn", "subject": "Too many", "body": "Test", "attachments": too_many},
    )
    assert r_many.status_code == 400
