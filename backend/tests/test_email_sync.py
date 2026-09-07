"""Unit and integration tests for Zoho Mail IMAP invoice PDF/XML sync."""
from __future__ import annotations

import io
import json
import zipfile
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import db as dbmod, email_sync, storage
from app.db import AppSetting, InvPurchase, JobRun, User


@pytest.fixture
def client(tmp_path, monkeypatch):
    """Isolated test client with fresh database and admin auth."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("NAS_ENABLED", "false")
    monkeypatch.setenv("AI_ENABLED", "false")
    monkeypatch.setenv("ZOHO_IMAP_ENABLED", "true")
    monkeypatch.setenv("ZOHO_SYNC_MODE", "imap")
    monkeypatch.setenv("ZOHO_IMAP_SERVER", "imappro.zoho.com")
    monkeypatch.setenv("ZOHO_IMAP_PORT", "993")
    monkeypatch.setenv("ZOHO_IMAP_USERNAME", "khanhnhn@inut.vn")
    monkeypatch.setenv("ZOHO_IMAP_PASSWORD", "test_app_pass_123")

    from app.config import get_settings
    get_settings.cache_clear()

    from app.auth import ensure_admin_seed
    dbmod.reset_engine_for_tests()
    dbmod.init_db()
    gen = dbmod.get_session()
    s = next(gen)
    ensure_admin_seed(s, get_settings())
    gen.close()

    from app.main import app
    c = TestClient(app)
    r = c.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})
    assert r.status_code == 200
    return c


SAMPLE_INVOICE_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<HDon>
    <DLHDon>
        <TTChung>
            <KHMSHDon>1</KHMSHDon>
            <KHHDon>C26TPK</KHHDon>
            <SHDon>999</SHDon>
            <NLap>2026-08-20</NLap>
            <DVTTe>VND</DVTTe>
        </TTChung>
        <NDHDon>
            <NBan>
                <Ten>C\xc3\x94NG TY TNHH NH\xc3\x80 CUNG C\xe1\xba\xa4P TEST</Ten>
                <MST>0109998888</MST>
                <DChi>H\xc3\xa0 N\xe1\xbb\x99i</DChi>
            </NBan>
            <NMua>
                <Ten>C\xc3\x94NG TY C\xe1\xbb\x94 PH\xe1\xba\xa6N \xc4\x90\xe1\xba\xa6U T\xc6\xaf V\xc3\x80 PH\xc3\x81T TRI\xe1\xbb\x82N C\xc3\x94NG NGH\xe1\xbb\x86 INUT</Ten>
                <MST>4401053694</MST>
            </NMua>
            <DSHHDVu>
                <HHDVu>
                    <TChat>1</TChat>
                    <STT>1</STT>
                    <MHHDVu>MH01</MHHDVu>
                    <THHDVu>Thi\xe1\xba\xbft b\xe1\xbb\x8b module ESP32</THHDVu>
                    <DVTinh>C\xc3\xa1i</DVTinh>
                    <SLuong>10</SLuong>
                    <DGia>100000</DGia>
                    <Tien>1000000</Tien>
                    <TSuat>8%</TSuat>
                </HHDVu>
            </DSHHDVu>
            <TToan>
                <TgTCThue>1000000</TgTCThue>
                <TgTThue>80000</TgTThue>
                <TgTTTBSo>1080000</TgTTTBSo>
                <TgTTTBChu>M\xe1\xbb\x99t tri\xe1\xbb\x87u kh\xc3\xb4ng tr\xc4\x83m t\xc3\xa1m m\xc6\xb0\xc6\xa1i ngh\xc3\xacn \xc4\x91\xe1\xbb\x93ng</TgTTTBChu>
            </TToan>
        </NDHDon>
    </DLHDon>
</HDon>"""

SAMPLE_PDF_HEADER = b"%PDF-1.4\n1 0 obj\n<< /Title (Hoa don 999) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF"


def test_email_sync_settings_get_and_save(client):
    """Kiem tra doc va luu cau hinh Zoho IMAP qua REST API."""
    r = client.get("/api/inv/email-sync/settings")
    assert r.status_code == 200
    data = r.json()
    assert data["username"] == "khanhnhn@inut.vn"
    assert data["server"] == "imappro.zoho.com"
    assert data["has_password"] is True

    # Cap nhat cau hinh
    r = client.post(
        "/api/inv/email-sync/settings",
        json={
            "enabled": True,
            "server": "imap.zoho.com",
            "port": 993,
            "username": "khanhnhn@inut.vn",
            "password": "new_app_password_xyz",
            "mailbox": "INBOX",
            "days": 60,
        },
    )
    assert r.status_code == 200
    updated = r.json()
    assert updated["server"] == "imap.zoho.com"
    assert updated["days"] == 60
    assert updated["has_password"] is True


def test_email_sync_test_connection_mock(client):
    """Kiem tra endpoint test ket noi IMAP voi mock imaplib."""
    with patch("imaplib.IMAP4_SSL") as mock_imap_cls:
        mock_instance = MagicMock()
        mock_instance.login.return_value = ("OK", [b"Logged in"])
        mock_instance.select.return_value = ("OK", [b"42"])
        mock_imap_cls.return_value = mock_instance

        r = client.post(
            "/api/inv/email-sync/test",
            json={
                "mode": "imap",
                "server": "imappro.zoho.com",
                "port": 993,
                "username": "khanhnhn@inut.vn",
                "password": "test_password",
                "mailbox": "INBOX",
            },
        )
        assert r.status_code == 200
        res = r.json()
        assert res["ok"] is True
        assert res["total_emails"] == 42


def test_email_sync_run_and_smart_matching(client):
    """Kiem tra dong bo hoa don: tao hoa don moi va gan PDF vao hoa don co san."""
    from email.message import EmailMessage

    # Tao email 1: chua XML
    msg1 = EmailMessage()
    msg1["Subject"] = "Hóa đơn điện tử số 999 C26TPK"
    msg1["From"] = "ncc@test.com"
    msg1["Date"] = "Thu, 20 Aug 2026 10:00:00 +0700"
    msg1.set_content("Kính gửi hóa đơn điện tử đính kèm")
    msg1.add_attachment(SAMPLE_INVOICE_XML, maintype="application", subtype="xml", filename="0109998888_C26TPK_999.xml")
    raw_email1 = msg1.as_bytes()

    # Mock IMAP tra ve email 1
    with patch("imaplib.IMAP4_SSL") as mock_imap_cls:
        mock_instance = MagicMock()
        mock_instance.login.return_value = ("OK", [b"Logged in"])
        mock_instance.select.return_value = ("OK", [b"1"])
        mock_instance.search.return_value = ("OK", [b"1"])
        mock_instance.fetch.return_value = ("OK", [(b"1 (RFC822 {1000}", raw_email1)])
        mock_imap_cls.return_value = mock_instance

        # Chay sync lan 1 -> Tao moi InvPurchase
        r = client.post("/api/inv/email-sync/run", json={"days": 30})
        assert r.status_code == 200
        res = r.json()
        assert res["status"] in {"success", "needs_action"}
        assert res["stats"]["created_new_draft"] == 1

        # Kiem tra trong database
        gen = dbmod.get_session()
        s = next(gen)
        inv = s.scalar(select(InvPurchase).where(InvPurchase.mst_ban == "0109998888", InvPurchase.so_hd == "999"))
        assert inv is not None
        assert inv.ten_ban == "CÔNG TY TNHH NHÀ CUNG CẤP TEST"
        assert inv.tong_tien == 1080000.0
        assert inv.doc_suffix == ".xml"
        old_doc_id = inv.doc_id
        gen.close()

    # Tao email 2: chua PDF cung so hoa don 999 C26TPK MST 0109998888
    # Tao zip chua ca PDF
    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w") as zf:
        zf.writestr("0109998888_C26TPK_999.pdf", SAMPLE_PDF_HEADER)
    zip_bytes = zip_buf.getvalue()

    msg2 = EmailMessage()
    msg2["Subject"] = "Bản PDF hóa đơn số 999 C26TPK"
    msg2["From"] = "ncc@test.com"
    msg2["Date"] = "Fri, 21 Aug 2026 10:00:00 +0700"
    msg2.set_content("Kính gửi file PDF hóa đơn")
    msg2.add_attachment(zip_bytes, maintype="application", subtype="zip", filename="invoice_bundle.zip")
    raw_email2 = msg2.as_bytes()

    # Mock IMAP tra ve email 2
    with patch("imaplib.IMAP4_SSL") as mock_imap_cls:
        mock_instance = MagicMock()
        mock_instance.login.return_value = ("OK", [b"Logged in"])
        mock_instance.select.return_value = ("OK", [b"2"])
        mock_instance.search.return_value = ("OK", [b"2"])
        mock_instance.fetch.return_value = ("OK", [(b"2 (RFC822 {1000}", raw_email2)])
        mock_imap_cls.return_value = mock_instance

        # Chay sync lan 2 -> Gán PDF vào hóa đơn XML đã có
        # Mock parse_purchase_pdf để trích xuất cùng MST và số HĐ
        with patch("app.inv_import.parse_purchase_pdf") as mock_parse_pdf:
            mock_parse_pdf.return_value = {
                "source": "pdf",
                "so_hd": "999",
                "ky_hieu": "C26TPK",
                "ngay": "2026-08-20",
                "ten_ban": "CÔNG TY TNHH NHÀ CUNG CẤP TEST",
                "mst_ban": "0109998888",
                "tong_truoc_thue": 1000000.0,
                "tong_thue": 80000.0,
                "tong_tien": 1080000.0,
                "items": [{"ten": "Thiết bị module ESP32", "so_luong": 10, "don_gia": 100000, "thanh_tien": 1000000}],
            }

            r = client.post("/api/inv/email-sync/run", json={"days": 30})
            assert r.status_code == 200
            res = r.json()
            assert res["stats"]["pdf_attached_to_existing"] == 1

            # Kiem tra InvPurchase da duoc gan PDF moi
            gen = dbmod.get_session()
            s = next(gen)
            inv = s.scalar(select(InvPurchase).where(InvPurchase.mst_ban == "0109998888", InvPurchase.so_hd == "999"))
            assert inv.doc_suffix == ".pdf"
            assert inv.doc_id != old_doc_id
            gen.close()


def test_email_sync_jobs_api(client):
    """Kiem tra lich su cac job dong bo email qua /api/jobs/email-sync."""
    r = client.get("/api/jobs/email-sync")
    assert r.status_code == 200
    runs = r.json()
    assert isinstance(runs, list)

    r2 = client.get("/api/inv/email-sync/runs")
    assert r2.status_code == 200
    assert len(r2.json()) == len(runs)


def test_zoho_rest_api_oauth_and_sync(client):
    """Kiem tra toan bo luong Zoho Mail REST API OAuth 2.0: doi token, lay messages va sync hoa don."""
    # 1. Test luu cau hinh voi grant_token
    token_resp_mock = {
        "access_token": "1000.access_token_abc",
        "refresh_token": "1000.refresh_token_xyz",
        "expires_in": 3600,
    }

    accounts_mock = {
        "data": [{"accountId": "12345678", "accountName": "khanhnhn@inut.vn"}]
    }

    from datetime import datetime, timezone
    now_ts_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

    msgs_mock = {
        "data": [
            {
                "messageId": "msg_001",
                "folderId": "fld_001",
                "subject": "Hóa đơn điện tử NCC",
                "fromAddress": "ncc@test.com",
                "receivedTime": now_ts_ms,
                "hasAttachment": "1",
            }
        ]
    }

    att_info_mock = {
        "data": {
            "attachments": [
                {
                    "attachmentId": "att_001",
                    "attachmentName": "0109998888_C26TPK_999.xml",
                    "attachmentSize": 1024,
                }
            ]
        }
    }

    class MockUrlopenResp:
        def __init__(self, data: bytes):
            self.data = data
        def read(self):
            return self.data
        def __enter__(self):
            return self
        def __exit__(self, exc_type, exc_val, exc_tb):
            pass

    def custom_urlopen(req, timeout=15.0):
        url = req.full_url if hasattr(req, "full_url") else str(req)
        if "/oauth/v2/token" in url:
            return MockUrlopenResp(json.dumps(token_resp_mock).encode())
        elif "/api/accounts/" in url and "/messages/view" in url:
            return MockUrlopenResp(json.dumps(msgs_mock).encode())
        elif "/attachmentinfo" in url:
            return MockUrlopenResp(json.dumps(att_info_mock).encode())
        elif "/attachments/att_001" in url:
            return MockUrlopenResp(SAMPLE_INVOICE_XML)
        elif "/api/accounts" in url:
            return MockUrlopenResp(json.dumps(accounts_mock).encode())
        return MockUrlopenResp(b"{}")

    with patch("urllib.request.urlopen", side_effect=custom_urlopen):
        # 1. Test endpoint doi grant token qua REST API
        r = client.post(
            "/api/inv/email-sync/settings",
            json={
                "enabled": True,
                "mode": "rest_api",
                "client_id": "1000.test_client_id",
                "client_secret": "test_client_secret",
                "grant_token": "1000.grant_code_123",
                "accounts_url": "https://accounts.zoho.com",
                "mail_api_url": "https://mail.zoho.com",
            },
        )
        assert r.status_code == 200
        data = r.json()
        assert data["mode"] == "rest_api"
        assert data["has_refresh_token"] is True

        # 2. Test endpoint kiem tra ket noi REST API
        r_test = client.post(
            "/api/inv/email-sync/test",
            json={
                "mode": "rest_api",
                "client_id": "1000.test_client_id",
                "client_secret": "test_client_secret",
                "refresh_token": "1000.refresh_token_xyz",
            },
        )
        assert r_test.status_code == 200
        test_res = r_test.json()
        assert test_res["ok"] is True
        assert "khanhnhn@inut.vn" in test_res["message"]

        # 3. Test chay sync qua REST API
        r_run = client.post("/api/inv/email-sync/run", json={"days": 30})
        assert r_run.status_code == 200
        run_res = r_run.json()
        assert run_res["status"] in {"success", "needs_action"}
        assert run_res["stats"]["attachments_found"] >= 1
        assert run_res["stats"]["created_new_draft"] == 1

