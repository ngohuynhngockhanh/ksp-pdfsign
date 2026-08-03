from __future__ import annotations

import hashlib
import hmac
import json
import time


def _canonical(method: str, path: str, timestamp: str, nonce: str, body: bytes) -> bytes:
    digest = hashlib.sha256(body).hexdigest()
    return f"{method.upper()}\n{path}\n{timestamp}\n{nonce}\n{digest}".encode()


TEST_SECRET = "public-secret-1234567890-abcdef12"


def _signed(client, method: str, path: str, payload=None, secret: str = TEST_SECRET, nonce: str | None = None):
    body = b"" if payload is None else json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    timestamp = str(int(time.time()))
    nonce = nonce or f"nonce-{timestamp}-{id(body)}"
    signature = hmac.new(secret.encode(), _canonical(method, path, timestamp, nonce, body), hashlib.sha256).hexdigest()
    headers = {
        "X-iNut-Training-Client": "inut-website",
        "X-iNut-Training-Timestamp": timestamp,
        "X-iNut-Training-Nonce": nonce,
        "X-iNut-Training-Signature": signature,
        "Content-Type": "application/json",
    }
    return client.request(method, path, content=body, headers=headers)


def _configure(monkeypatch):
    monkeypatch.setenv("PUBLIC_TRAINING_HMAC_SECRET", TEST_SECRET)
    monkeypatch.setenv("PUBLIC_TRAINING_ENABLED", "true")
    from app.config import get_settings

    get_settings.cache_clear()


def test_public_session_requires_hmac_and_stores_phone_encrypted(client, monkeypatch):
    _configure(monkeypatch)
    rejected = client.post("/internal/public-training/sessions", json={"phone": "0912345678", "consent": True})
    assert rejected.status_code == 401

    created = _signed(client, "POST", "/internal/public-training/sessions", {
        "phone": "0912345678", "locale": "vi", "consent": True, "websitePath": "/vi/news",
    })
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["sessionToken"]
    assert body["phoneLast4"] == "5678"
    assert "0912345678" not in created.text

    from app.db import TrainingPublicSession, get_session

    gen = get_session()
    db = next(gen)
    row = db.get(TrainingPublicSession, body["sessionId"])
    assert row is not None
    assert row.phone_ciphertext and row.phone_hash and row.phone_last4 == "5678"
    assert "0912345678" not in row.phone_ciphertext
    gen.close()


def test_public_session_can_be_restored_without_revealing_phone(client, monkeypatch):
    _configure(monkeypatch)
    created = _signed(client, "POST", "/internal/public-training/sessions", {
        "phone": "0912345678", "locale": "vi", "consent": True,
    })
    session = created.json()

    restored = _signed(
        client,
        "GET",
        f"/internal/public-training/sessions?sessionToken={session['sessionToken']}",
    )

    assert restored.status_code == 200, restored.text
    assert restored.json() == {
        "sessionId": session["sessionId"],
        "phoneLast4": "5678",
        "locale": "vi",
    }
    assert "0912345678" not in restored.text


def test_public_session_rejects_invalid_consent_phone_and_replay(client, monkeypatch):
    _configure(monkeypatch)
    invalid_phone = _signed(client, "POST", "/internal/public-training/sessions", {
        "phone": "123", "locale": "vi", "consent": True,
    })
    assert invalid_phone.status_code == 400

    invalid_consent = _signed(client, "POST", "/internal/public-training/sessions", {
        "phone": "0912345678", "locale": "vi", "consent": False,
    })
    assert invalid_consent.status_code == 400

    nonce = "replay-fixed"
    first = _signed(client, "POST", "/internal/public-training/sessions", {
        "phone": "0912345678", "locale": "vi", "consent": True,
    }, nonce=nonce)
    second = _signed(client, "POST", "/internal/public-training/sessions", {
        "phone": "0912345678", "locale": "vi", "consent": True,
    }, nonce=nonce)
    assert first.status_code == 201
    assert second.status_code == 401


def test_public_training_rejects_malformed_content_length(client, monkeypatch):
    _configure(monkeypatch)
    response = client.post(
        "/internal/public-training/sessions",
        content=b"{}",
        headers={"Content-Length": "not-a-number"},
    )
    assert response.status_code == 400


def test_public_question_is_scoped_to_session_and_sanitizes_internal_urls(client, monkeypatch):
    _configure(monkeypatch)
    session = _signed(client, "POST", "/internal/public-training/sessions", {
        "phone": "0912345678", "locale": "vi", "consent": True,
    }).json()

    from app import public_training_jobs

    monkeypatch.setattr(public_training_jobs, "start", lambda **kwargs: kwargs["job_id"])
    question = _signed(client, "POST", "/internal/public-training/questions", {
        "sessionToken": session["sessionToken"], "question": "FRPC là gì?", "locale": "vi",
    })
    assert question.status_code == 202, question.text
    job_id = question.json()["jobId"]

    from app import public_training_jobs as jobs

    monkeypatch.setattr(jobs, "get", lambda **kwargs: {
        "status": "done",
        "stage": "Hoàn tất",
        "result": {
            "sessionId": "hermes-session",
            "answer": {
                "answer": "Xem https://ksp-pdf-signer.p2p.inut.io.vn/training/help#frpc",
                "documentationEvidence": [{
                    "title": "FRPC", "url": "https://ksp-pdf-signer.p2p.inut.io.vn/training/help#frpc",
                }],
            },
        },
    })
    status = _signed(client, "GET", f"/internal/public-training/questions/{job_id}?sessionToken={session['sessionToken']}")
    assert status.status_code == 200
    text = status.text
    assert "ksp-pdf-signer.p2p.inut.io.vn" not in text
    assert "https://inut.vn/help#frpc" in text

    wrong_session = _signed(client, "GET", f"/internal/public-training/questions/{job_id}?sessionToken=wrong")
    assert wrong_session.status_code == 401


def test_admin_can_manage_public_leads_and_reveal_phone_with_audit(client, monkeypatch):
    _configure(monkeypatch)
    session = _signed(client, "POST", "/internal/public-training/sessions", {
        "phone": "0912345678", "locale": "en", "consent": True,
    }).json()
    from app.db import get_session, TrainingPublicQuery

    gen = get_session()
    db = next(gen)
    db.add(TrainingPublicQuery(
        job_id="admin-job", session_id=session["sessionId"], question="What is FRPC?",
        answer_json=json.dumps({"answer": "A"}), status="done",
    ))
    db.commit()
    gen.close()

    client.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})
    listing = client.get("/api/training/public-leads")
    assert listing.status_code == 200
    assert listing.json()["items"][0]["phone"] == "••••••5678"

    detail = client.get(f"/api/training/public-leads/{session['sessionId']}?reveal=true")
    assert detail.status_code == 200
    assert detail.json()["phone"] == "0912345678"
    updated = client.patch(f"/api/training/public-leads/{session['sessionId']}", json={"status": "qualified", "note": "Gọi lại"})
    assert updated.status_code == 200
    assert updated.json()["status"] == "qualified"

    deleted = client.delete(f"/api/training/public-leads/{session['sessionId']}")
    assert deleted.status_code == 200
    assert client.get(f"/api/training/public-leads/{session['sessionId']}").status_code == 404
