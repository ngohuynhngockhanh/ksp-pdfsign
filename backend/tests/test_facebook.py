from __future__ import annotations

import hashlib
import hmac
import json

import httpx


def _settings(monkeypatch, **values):
    defaults = {
        "facebook_enabled": True,
        "facebook_page_id": "100063494173321",
        "facebook_verify_token": "verify-token-for-tests",
        "facebook_app_secret": "app-secret-for-tests",
        "facebook_page_access_token": "page-token-for-tests",
    }
    defaults.update(values)
    for key, value in defaults.items():
        monkeypatch.setenv(key.upper(), str(value))
    from app.config import get_settings

    get_settings.cache_clear()


def _signed(payload: dict, secret: str) -> tuple[bytes, dict[str, str]]:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    digest = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return body, {"X-Hub-Signature-256": f"sha256={digest}"}


def _event(mid: str = "mid.1", text: str = "Xin chào") -> dict:
    return {
        "object": "page",
        "entry": [{
            "id": "100063494173321",
            "messaging": [{
                "sender": {"id": "psid.1"},
                "recipient": {"id": "100063494173321"},
                "timestamp": 1720000000000,
                "message": {"mid": mid, "text": text},
            }],
        }],
    }


def test_facebook_webhook_verification_and_rejection(client, monkeypatch):
    _settings(monkeypatch)

    verified = client.get(
        "/webhooks/facebook",
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": "verify-token-for-tests",
            "hub.challenge": "challenge-123",
        },
    )
    assert verified.status_code == 200
    assert verified.text == "challenge-123"

    rejected = client.get(
        "/webhooks/facebook",
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": "wrong",
            "hub.challenge": "challenge-123",
        },
    )
    assert rejected.status_code == 403


def test_facebook_webhook_checks_signature_and_deduplicates(client, monkeypatch):
    _settings(monkeypatch)
    queued: list[tuple[str, str, str]] = []
    from app import facebook_api

    monkeypatch.setattr(
        facebook_api,
        "enqueue_message",
        lambda page_id, psid, mid, text: queued.append((page_id, psid, mid, text)),
    )
    payload = _event()
    body, headers = _signed(payload, "app-secret-for-tests")

    first = client.post("/webhooks/facebook", content=body, headers=headers)
    assert first.status_code == 200
    assert first.json()["accepted"] == 1
    assert queued == [("100063494173321", "psid.1", "mid.1", "Xin chào")]

    duplicate = client.post("/webhooks/facebook", content=body, headers=headers)
    assert duplicate.status_code == 200
    assert duplicate.json()["accepted"] == 0
    assert len(queued) == 1

    bad = client.post(
        "/webhooks/facebook",
        content=json.dumps(payload).encode(),
        headers={"X-Hub-Signature-256": "sha256=bad"},
    )
    assert bad.status_code == 403


def test_messenger_client_uses_bearer_and_redacts_token(monkeypatch):
    from app.facebook import MessengerClient

    bearer_value = "fixture-page-credential"
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"message_id": "out.1"})

    client = MessengerClient(
        bearer_value,
        graph_base_url="http://127.0.0.1:8099",
        graph_version="v23.0",
        transport=httpx.MockTransport(handler),
    )
    result = client.send_text("100063494173321", "psid.1", "Chào bạn")
    assert result["message_id"] == "out.1"
    assert requests[0].url.path == "/v23.0/100063494173321/messages"
    assert requests[0].headers["Authorization"] == f"Bearer {bearer_value}"
    assert bearer_value not in str(requests[0].url)


def test_messenger_client_error_does_not_expose_token():
    from app.facebook import FacebookError, MessengerClient

    bearer_value = "fixture-page-credential"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, request=request, text="provider failure")

    client = MessengerClient(
        bearer_value,
        graph_base_url="http://127.0.0.1:8099",
        transport=httpx.MockTransport(handler),
    )
    try:
        client.send_text("100063494173321", "psid.1", "Chào bạn")
    except FacebookError as exc:
        assert bearer_value not in str(exc)
    else:
        raise AssertionError("expected FacebookError")
    finally:
        client.close()


def test_messenger_client_reads_profile_name():
    from app.facebook import MessengerClient

    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["authorization"] = request.headers.get("authorization")
        return httpx.Response(200, json={"id": "psid.1", "name": "Nguyễn Văn A"})

    client = MessengerClient(
        "page-token-for-tests",
        graph_base_url="http://127.0.0.1:8099",
        transport=httpx.MockTransport(handler),
    )
    try:
        assert client.get_profile_name("psid.1") == "Nguyễn Văn A"
        assert "fields=name" in str(seen["url"])
        assert seen["authorization"] == "Bearer page-token-for-tests"
    finally:
        client.close()


def test_facebook_worker_uses_history_and_stores_outbound_reply(client, monkeypatch):
    _settings(monkeypatch)
    from app import facebook, facebook_api
    from app.db import FacebookMessage, get_session

    assert facebook_api._record_inbound("100063494173321", "psid.1", "mid.worker", "Cần module A76")
    captured: dict[str, str] = {}

    def fake_ask(settings, question, session_id="", personal_context=""):
        captured.update(question=question, session_id=session_id, personal_context=personal_context)
        return {"answer": {"answer": "Mình sẽ tư vấn module phù hợp.", "sourceBasis": "documentation-only"}}

    sent: list[tuple[str, str, str]] = []

    class FakeMessenger:
        def __init__(self, *args, **kwargs):
            pass

        def send_text(self, page_id, psid, text):
            sent.append((page_id, psid, text))
            return {"message_id": "out.worker"}

        def close(self):
            pass

    monkeypatch.setattr(facebook.training, "ask", fake_ask)
    monkeypatch.setattr(facebook, "MessengerClient", FakeMessenger)
    facebook.process_message("100063494173321", "psid.1", "mid.worker", "Cần module A76")

    assert captured["session_id"] == "facebook-100063494173321-psid.1"
    assert "Cần module A76" in captured["personal_context"]
    assert sent == [("100063494173321", "psid.1", "Mình sẽ tư vấn module phù hợp.")]

    generator = get_session()
    db = next(generator)
    inbound = db.query(FacebookMessage).filter_by(message_id="mid.worker").one()
    outbound = db.query(FacebookMessage).filter_by(direction="outbound").one()
    assert inbound.status == "replied"
    assert outbound.reply_to_id == inbound.id
    generator.close()


def test_admin_can_jump_into_named_facebook_conversation(client):
    from app import db as dbmod, facebook_api
    from app.db import FacebookMessage

    assert facebook_api._record_inbound(
        "100063494173321", "psid.named", "mid.named", "Xin chào", "Nguyễn Văn A"
    )
    generator = dbmod.get_session()
    db = next(generator)
    db.add(FacebookMessage(
        page_id="100063494173321",
        psid="psid.named",
        direction="outbound",
        text="Chào bạn, iNut đây.",
        status="sent",
    ))
    db.commit()
    generator.close()

    client.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})
    conversations = client.get("/api/facebook/conversations")
    assert conversations.status_code == 200
    item = next(row for row in conversations.json()["items"] if row["psid"] == "psid.named")
    assert item["name"] == "Nguyễn Văn A"
    history = client.get("/api/facebook/conversations/100063494173321/psid.named")
    assert history.status_code == 200
    assert [row["text"] for row in history.json()["items"]] == ["Xin chào", "Chào bạn, iNut đây."]
    client.post("/api/logout")
