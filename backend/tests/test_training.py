from __future__ import annotations

import datetime
import json

import httpx
import pytest

from app import training
from app.config import Settings


def _settings(**overrides) -> Settings:
    values = {
        "training_base_url": "http://training.internal:8090",
        "training_password": "service-secret",
        "training_timeout": 10,
    }
    values.update(overrides)
    return Settings(**values)


def test_search_returns_upstream_results(monkeypatch):
    def fake_get(url, **kwargs):
        request = httpx.Request("GET", url, params=kwargs["params"])
        return httpx.Response(200, request=request, json={"data": {"results": [{"title": "FRPC"}]}})

    monkeypatch.setattr(httpx, "get", fake_get)
    assert training.search(_settings(), " cài frpc lỗi giờ sao ") == [{"title": "FRPC"}]


def test_archived_help_is_fetched_from_training_service(monkeypatch):
    def fake_get(url, **kwargs):
        return httpx.Response(200, request=httpx.Request("GET", url), content=b"<html>archived</html>")

    monkeypatch.setattr(httpx, "get", fake_get)
    assert training.archived_help(_settings()) == b"<html>archived</html>"


def test_ask_logs_in_server_side_and_never_returns_password(monkeypatch):
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/api/auth/login":
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(200, json={"data": {"answer": "Kiểm tra log FRPC", "videoEvidence": []}})

    monkeypatch.setattr(training, "_transport", lambda: httpx.MockTransport(handler))
    result = training.ask(_settings(), "cài frpc lỗi giờ sao", "crm-session")

    assert result["answer"] == "Kiểm tra log FRPC"
    assert len(requests) == 2
    assert json.loads(requests[0].content)["password"] == "service-secret"
    assert b"service-secret" not in requests[1].content
    assert "service-secret" not in json.dumps(result)


def test_invalid_training_inputs_fail_before_network():
    with pytest.raises(training.TrainingError):
        training.search(_settings(), "")
    with pytest.raises(training.TrainingError):
        training.ask(_settings(training_password=""), "hello")


def test_training_api_requires_admin(client):
    assert client.get("/api/training/search?q=frpc").status_code == 401
    assert client.post("/api/training/ask", json={"question": "frpc"}).status_code == 401
    assert client.post("/api/training/share", json={"question": "frpc", "answer": {}}).status_code == 401


def test_training_access_can_be_granted_per_customer_account(client, monkeypatch):
    from app import db as dbmod
    from app.db import User
    from app.security import hash_password

    generator = dbmod.get_session()
    db = next(generator)
    denied = User(username="training_denied", password_hash=hash_password("matkhau12345"), role="customer")
    allowed = User(username="training_allowed", password_hash=hash_password("matkhau12345"), role="customer", training_access=True)
    db.add_all([denied, allowed])
    db.commit()
    denied_id = denied.id
    generator.close()

    client.post("/api/login", json={"username": "training_denied", "password": "matkhau12345"})
    assert client.get("/api/training/search?q=frpc").status_code == 403
    client.post("/api/logout")

    client.post("/api/login", json={"username": "training_allowed", "password": "matkhau12345"})
    monkeypatch.setattr(training, "search", lambda settings, query: [{"title": "FRPC"}])
    assert client.get("/api/training/search?q=frpc").status_code == 200
    client.post("/api/logout")

    client.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})
    changed = client.patch(f"/api/users/{denied_id}/training-access", json={"enabled": True})
    assert changed.status_code == 200
    assert changed.json()["training_access"] is True


def test_public_training_share_escapes_content_and_filters_unsafe_links(client):
    from app import db as dbmod
    from app.db import TrainingShare

    generator = dbmod.get_session()
    db = next(generator)
    share = TrainingShare(
        **{"token": "safe-public-token"},
        question='<script>alert("q")</script>',
        answer_json=json.dumps({
            "answer": '<img src=x onerror="alert(1)">',
            "generalGuidance": "Kiểm tra cấu hình.",
            "documentationEvidence": [
                {"title": "Help FRPC", "url": "https://inut.vn/help#frpc", "quote": "Nguồn hợp lệ"},
                {"title": "Xấu", "url": "javascript:alert(1)", "quote": "Không được hiện"},
                "du lieu loi",
            ],
        }),
        expires_at=datetime.datetime.utcnow() + datetime.timedelta(days=1),
    )
    db.add(share)
    db.commit()
    generator.close()

    response = client.get("/t/safe-public-token")
    assert response.status_code == 200
    assert "&lt;script&gt;" in response.text
    assert "&lt;img" in response.text
    assert "https://inut.vn/help#frpc" in response.text
    assert "javascript:" not in response.text


def test_expired_training_share_returns_410(client):
    from app import db as dbmod
    from app.db import TrainingShare

    generator = dbmod.get_session()
    db = next(generator)
    db.add(TrainingShare(
        **{"token": "expired-training-token"},
        question="FRPC",
        answer_json="{}",
        expires_at=datetime.datetime.utcnow() - datetime.timedelta(seconds=1),
    ))
    db.commit()
    generator.close()

    assert client.get("/t/expired-training-token").status_code == 410
