"""Kiểm thử tích hợp LIO Signer API (POST /v1/sessions, Polling, Webhook HMAC-SHA256)."""
from __future__ import annotations

import hashlib
import hmac
import json
import time

from app import lio_signer
from app.config import get_settings
from tests.test_api import PDF, _login


def test_lio_signer_submit_poll_and_webhook_hmac(client, monkeypatch):
    _login(client)
    settings = get_settings()
    monkeypatch.setattr(settings, "lio_signer_enabled", True)
    monkeypatch.setattr(settings, "lio_signer_api_key", "lio_test_dummy_key_123456")
    monkeypatch.setattr(
        settings,
        "lio_signer_webhook_secret",
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    )

    pdf_bytes = PDF
    up = client.post(
        "/api/documents/upload",
        files={"file": ("hop-dong-lio.pdf", pdf_bytes, "application/pdf")},
    )
    assert up.status_code == 200
    doc_pk = up.json()["id"]

    poll_state = {"step": 0}
    signed_pdf_bytes = pdf_bytes + b"\n%LIO-SIGNED-TRAILER\n"

    class DummyResp:
        def __init__(self, status_code: int, data=None, content: bytes = b""):
            self.status_code = status_code
            self._data = data
            if content:
                self.content = content
            elif data is not None:
                self.content = json.dumps(data).encode("utf-8")
            else:
                self.content = b""
            self.headers: dict[str, str] = {}
            self.request = None

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def iter_bytes(self, chunk_size: int = 65536):
            if self.content:
                yield self.content

        def json(self):
            return self._data

    class DummyClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def stream(self, method, url, headers=None):
            assert method.upper() == "GET"
            return self.get(url, headers=headers)

        def post(self, url, json=None, headers=None):
            if url.endswith("/v1/sessions/ses_test_unit_001/countersigned"):
                assert headers["Authorization"] == "Bearer lio_test_dummy_key_123456"
                import base64
                raw_sent = base64.b64decode(json["content"])
                if b"%INUT-SECOND-SIG" not in raw_sent:
                    return DummyResp(
                        422,
                        {
                            "error": "NO_NEW_SIGNATURE",
                            "message": "no new signature after owner signature",
                        },
                    )
                return DummyResp(
                    200,
                    {
                        "file_id": "fil_test_unit_001",
                        "filename": "hop-dong-lio.pdf",
                        "replaced": False,
                        "received_at": "2026-11-08T03:15:00Z",
                        "signatures": [
                            {
                                "signer": "HUỲNH ĐỨC NHÂM",
                                "serial": "54010d6a3e8b5ff3305035692d021528",
                                "signed_at": "2026-11-07T15:55:35Z",
                                "valid": True,
                            },
                            {
                                "signer": "CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT",
                                "serial": "5401fe0299887766",
                                "signed_at": "2026-11-08T03:14:40Z",
                                "valid": True,
                            },
                        ],
                    },
                )
            assert url.endswith("/v1/sessions")
            assert headers["Authorization"] == "Bearer lio_test_dummy_key_123456"
            assert headers.get("Idempotency-Key", "").startswith(f"inut-doc-{doc_pk}-")
            return DummyResp(
                201,
                {
                    "session_id": "ses_test_unit_001",
                    "status": "processing",
                    "expires_at": "2026-11-08T15:00:00Z",
                    "status_polling_url": "https://signer.liotech.vn/v1/sessions/ses_test_unit_001?t=secret_tok",
                    "files": [
                        {
                            "filename": "hop-dong-lio.pdf",
                            "url": "https://signer.liotech.vn/v1/files/fil_test_unit_001.secret_dl",
                        }
                    ],
                },
            )
        def get(self, url, headers=None):
            if "status_polling_url" in url or "/v1/sessions/ses_test_unit_001" in url:
                poll_state["step"] += 1
                if poll_state["step"] == 1:
                    return DummyResp(
                        200,
                        {
                            "session_id": "ses_test_unit_001",
                            "status": "processing",
                            "expires_at": "2026-11-08T15:00:00Z",
                            "files": [
                                {
                                    "filename": "hop-dong-lio.pdf",
                                    "url": "https://signer.liotech.vn/v1/files/fil_test_unit_001.secret_dl",
                                    "status": "waiting_approval",
                                    "signed_at": None,
                                    "placement_method": "marker",
                                }
                            ],
                        },
                    )
                return DummyResp(
                    200,
                    {
                        "session_id": "ses_test_unit_001",
                        "status": "completed",
                        "expires_at": "2026-11-08T15:00:00Z",
                        "files": [
                            {
                                "filename": "hop-dong-lio.pdf",
                                "url": "https://signer.liotech.vn/v1/files/fil_test_unit_001.secret_dl",
                                "status": "signed",
                                "signed_at": "2026-11-07T15:55:39Z",
                                "placement_method": "marker",
                            }
                        ],
                    },
                )
            if "/v1/files/fil_test_unit_001" in url:
                return DummyResp(200, content=signed_pdf_bytes)
            return DummyResp(200, {"ok": True}, content=b'{"ok":true}')

    from app import security_utils
    import socket as _socket

    monkeypatch.setattr(
        security_utils.socket,
        "getaddrinfo",
        lambda host, port, *a, **kw: [(_socket.AF_INET, _socket.SOCK_STREAM, 6, "", ("93.184.216.34", port))],
    )
    monkeypatch.setattr(security_utils.httpx, "Client", DummyClient)
    monkeypatch.setattr(lio_signer.httpx, "Client", DummyClient)

    # 1. Gửi hồ sơ sang LIO Signer -> poll nhịp 1 trả về waiting_approval + marker
    res_sign = client.post(f"/api/documents/{doc_pk}/lio-sign")
    assert res_sign.status_code == 200, res_sign.text
    body1 = res_sign.json()
    assert body1["lio_session_id"] == "ses_test_unit_001"
    assert body1["lio_status"] == "waiting_approval"
    assert body1["lio_placement_method"] == "marker"
    # Đảm bảo URL nhạy cảm không bị lộ ra JSON phía client
    assert "lio_polling_url" not in body1
    assert "lio_file_url" not in body1

    # 2. Poll lần 2 -> chuyển sang signed, tự tải PDF đã ký và cập nhật hồ sơ
    res_poll = client.post(f"/api/documents/{doc_pk}/lio-poll")
    assert res_poll.status_code == 200, res_poll.text
    body2 = res_poll.json()
    assert body2["lio_status"] == "signed"
    assert body2["signed"] is True
    assert "HUỲNH ĐỨC NHÂM" in body2["signer_name"]
    assert body2["signed_upload_name"].startswith("da-ky-lio-")

    dl = client.get(f"/api/documents/{doc_pk}/download")
    assert dl.status_code == 200
    assert dl.content.endswith(b"%LIO-SIGNED-TRAILER\n")

    # 3. Kiểm tra xác thực HMAC-SHA256 của Webhook
    raw_event = json.dumps(
        {
            "event": "file.signed",
            "session_id": "ses_test_unit_001",
            "filename": "hop-dong-lio.pdf",
            "url": "https://signer.liotech.vn/v1/files/fil_test_unit_001.secret_dl",
            "status": "signed",
            "occurred_at": "2026-11-07T15:55:39Z",
        }
    ).encode("utf-8")
    ts_now = str(int(time.time()))
    secret_bytes = bytes.fromhex(settings.lio_signer_webhook_secret)
    good_mac = hmac.new(secret_bytes, ts_now.encode("ascii") + b"." + raw_event, hashlib.sha256).hexdigest()

    # Sai chữ ký -> 401
    bad_wh = client.post(
        "/api/lio-signer/webhook",
        content=raw_event,
        headers={
            "Content-Type": "application/json",
            "X-Lio-Timestamp": ts_now,
            "X-Lio-Signature": "sha256=0000",
            "X-Lio-Delivery-Id": "dlv_001",
        },
    )
    assert bad_wh.status_code == 401

    # Đúng chữ ký HMAC trên raw body -> 200 OK
    ok_wh = client.post(
        "/api/lio-signer/webhook",
        content=raw_event,
        headers={
            "Content-Type": "application/json",
            "X-Lio-Timestamp": ts_now,
            "X-Lio-Signature": f"sha256={good_mac}",
            "X-Lio-Delivery-Id": "dlv_001",
        },
    )
    assert ok_wh.status_code == 200
    assert ok_wh.json()["ok"] is True

    # 4. Gửi bản ký 2 bên khi chưa có chữ ký thứ 2 của iNut -> 422 NO_NEW_SIGNATURE
    bad_cs = client.post(f"/api/documents/{doc_pk}/lio-countersigned")
    assert bad_cs.status_code == 422
    assert "NO_NEW_SIGNATURE" in bad_cs.text

    # 5. Tải bản đã ký đủ 2 bên qua /upload-signed -> tự động đẩy sang LIO /countersigned thành công
    both_signed_bytes = signed_pdf_bytes + b"%INUT-SECOND-SIG\n"
    ok_up = client.post(
        f"/api/documents/{doc_pk}/upload-signed",
        files={"file": ("hop-dong-ky-hai-ben.pdf", both_signed_bytes, "application/pdf")},
    )
    assert ok_up.status_code == 200, ok_up.text
    body_cs = ok_up.json()
    assert body_cs["lio_countersigned_status"] == "sent"
    assert body_cs["lio_countersigned_file_id"] == "fil_test_unit_001"
    assert body_cs["lio_countersigned_at"] == "2026-11-08T03:15:00Z"
    assert len(body_cs["lio_countersigned_signatures"]) == 2
    assert "CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT" in body_cs["signer_name"]

    # 6. Gửi lại trực tiếp qua POST /api/documents/{doc_pk}/lio-countersigned (body rỗng) -> 200 OK
    res_cs2 = client.post(f"/api/documents/{doc_pk}/lio-countersigned")
    assert res_cs2.status_code == 200
    assert res_cs2.json()["lio_countersigned_status"] == "sent"
