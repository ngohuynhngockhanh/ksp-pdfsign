"""Unit & integration tests cho module Van don SPX Express (spx.vn)."""

import io
import re
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from pypdf import PageObject, PdfReader, PdfWriter

from app import db, spx, spx_label, storage
from app.db import AppSetting, Document, Share, SpxShipment, init_db
from app.main import app


def _make_genuine_spx_pdf_bytes(width: float = 282.96, height: float = 141.12) -> bytes:
    """Tạo file PDF hợp lệ giả lập file PDF gốc từ SPX Express (282.96 x 141.12 pt)."""
    writer = PdfWriter()
    page = PageObject.create_blank_page(width=width, height=height)
    writer.add_page(page)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _install_mock_spx_api(monkeypatch):
    """Cài đặt mock HTTP client mô phỏng API chính hãng của SPX Express."""
    genuine_pdf = _make_genuine_spx_pdf_bytes()

    class FakeResponse:
        def __init__(self, status_code=200, json_data=None, content=b"", headers=None):
            self.status_code = status_code
            self._json = json_data or {}
            self.content = content
            self.text = str(json_data or "")
            self.headers = headers or {"content-type": "application/json"}

        def json(self):
            return self._json

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.cookies = kwargs.get("cookies") or {}

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def close(self):
            pass

        def get(self, url, *args, **kwargs):
            if "base_info/detail" in url:
                return FakeResponse(
                    200,
                    {
                        "retcode": 0,
                        "message": "success",
                        "data": {"account_id": 1602803950, "phone": "**6757"},
                    },
                )
            if "address/search" in url:
                return FakeResponse(
                    200,
                    {
                        "retcode": 0,
                        "message": "",
                        "data": {
                            "total": 8,
                            "list": [
                                {
                                    "contact_name": "Huyền Oanh",
                                    "contact_phone": "84972768491",
                                }
                            ],
                        },
                    },
                )
            if "get_order_info" in url:
                m_tn = re.search(r"spx_tn=([A-Z0-9]+)", url)
                m_sn = re.search(r"order_sn=([A-Z0-9]+)", url)
                code = (m_tn.group(1) if m_tn else (m_sn.group(1) if m_sn else "SPXVN06647830539A"))
                spx_tn = code if code.startswith("SPXVN") else f"SPXVN{code[-10:]}"
                order_sn = code if code.startswith("VN") and not code.startswith("SPXVN") else f"VN266915{code[-6:]}Q"
                return FakeResponse(
                    200,
                    {
                        "retcode": 0,
                        "message": "success",
                        "data": {
                            "order_info": {
                                "order_sn": order_sn,
                                "spx_tn": spx_tn,
                                "sls_tn": order_sn,
                            },
                            "deliver_info": {
                                "deliver_name": "Anh Tài",
                                "deliver_phone": "84357242389",
                                "deliver_detail_address": "Người Nhân: Công Ty Cổ Phần Tập Đoàn Merap Đ Đ: Thôn Bá Khê",
                                "deliver_state": "Hưng Yên",
                                "deliver_city": "Huyện Văn Giang",
                                "deliver_district": "Xã Tân Tiến",
                            },
                            "sender_info": {
                                "sender_name": "Huyền Oanh",
                                "sender_phone": "84972768491",
                                "sender_detail_address": "Lavita Charm",
                                "sender_district": "Phường Thủ Đức",
                                "sender_state": "TP. Hồ Chí Minh",
                            },
                            "parcel_info": {
                                "parcel_item_name": "Hàng INUT linh kiện điện tử",
                                "parcel_weight": 1.0,
                            },
                            "fulfillment_info": {
                                "cod_amount": 0,
                            },
                        },
                    },
                )
            if "batch_get_shipping_label" in url:
                return FakeResponse(
                    200,
                    content=genuine_pdf,
                    headers={"content-type": "application/pdf"},
                )
            return FakeResponse(404, {"retcode": -1, "message": "not found"})

    monkeypatch.setattr("httpx.Client", FakeClient)
    monkeypatch.setattr(spx, "_get_spx_proxies", lambda: [])


@pytest.fixture(autouse=True)
def setup_db(tmp_path, monkeypatch):
    """Set up temporary database for tests."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    db.reset_engine_for_tests()
    init_db()


@pytest.fixture
def auth_client(tmp_path, monkeypatch):
    """Isolated test client with fresh database and admin auth."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("APP_ADMIN_PASSWORD", "NhapHang123@")

    from app.config import get_settings

    get_settings.cache_clear()

    from app.auth import ensure_admin_seed

    db.reset_engine_for_tests()
    init_db()
    gen = db.get_session()
    s = next(gen)
    ensure_admin_seed(s, get_settings())
    spx.save_spx_settings(
        s,
        {
            "spx_username": "0345296757",
            "spx_password": "NhapHang123@",
            "spx_cookies": "spx_token=test_token_123; spx_sid=test_sid_456",
        },
    )
    gen.close()

    c = TestClient(app)
    r = c.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})
    assert r.status_code == 200
    return c


def test_spx_label_pdf_generation():
    """Test generating internal A6 shipping label PDF for non-SPX internal drafts."""
    pdf_bytes = spx_label.generate_spx_a6_label(
        tracking_no="INTERNAL-0123456789",
        recipient_name="Nguyễn Văn A",
        recipient_phone="0901234567",
        recipient_address="123 Lê Lợi, P. Bến Nghé, Q.1, TP. HCM",
        cod_amount=1500000.0,
        weight_gram=500,
        item_description="Thiết bị iNut Sensor Node 4G",
        note="Cho xem hàng, không cho thử",
        sender_name="INUT TECHNOLOGY",
        sender_phone="0345296757",
        sender_address="Khu Công Nghệ Cao, TP. Thủ Đức, TP. HCM",
        order_code="DH-2026-TEST-01",
    )
    assert len(pdf_bytes) > 1000
    assert pdf_bytes.startswith(b"%PDF")


def test_spx_settings_encryption():
    """Test saving and masking SPX settings with AES encryption."""
    gen = db.get_session()
    s = next(gen)

    payload = {
        "spx_username": "0345296757",
        "spx_password": "NhapHang123@",
        "spx_shop_id": "SHOP_999",
        "spx_api_token": "TOK_SEC_ABC123",
        "spx_cookies": "spx_token=tok_abc; spx_sid=sid_xyz",
        "spx_sender_name": "INUT TECH",
        "spx_sender_phone": "0345296757",
        "spx_sender_address": "Khu CNC, TP Thủ Đức",
        "spx_sender_province": "Hồ Chí Minh",
        "spx_sender_district": "TP Thủ Đức",
        "spx_sender_ward": "Tăng Nhơn Phú B",
    }

    saved = spx.save_spx_settings(s, payload)
    assert saved["spx_password"] == "********"
    assert saved["spx_api_token"] == "********"
    assert saved["spx_cookies"] == "********"
    assert saved["spx_username"] == "0345296757"

    raw = spx.get_spx_raw_credentials(s)
    assert raw["spx_password"] == "NhapHang123@"
    assert raw["spx_api_token"] == "TOK_SEC_ABC123"
    assert raw["spx_cookies"] == "spx_token=tok_abc; spx_sid=sid_xyz"

    gen.close()


def test_spx_order_lifecycle(monkeypatch):
    """Test full SPX order creation, listing, authentic label retrieval, and cancellation."""
    _install_mock_spx_api(monkeypatch)
    gen = db.get_session()
    s = next(gen)
    spx.save_spx_settings(
        s,
        {
            "spx_username": "0345296757",
            "spx_password": "NhapHang123@",
            "spx_cookies": "spx_token=tok_live; spx_sid=sid_live",
        },
    )

    # 1. Create order
    shipment = spx.create_spx_order(
        s,
        {
            "recipient_name": "Lê Hoàng Nam",
            "recipient_phone": "0912345678",
            "recipient_address": "789 Nguyễn Huệ, Phường Bến Nghé",
            "province": "Hồ Chí Minh",
            "district": "Quận 1",
            "ward": "Phường Bến Nghé",
            "cod_amount": 2500000.0,
            "weight_gram": 800,
            "item_description": "iNut PLC Kit",
            "note": "Cho xem hàng, không cho thử",
            "order_code": "DH-TEST-002",
        },
    )

    assert shipment.id is not None
    assert shipment.tracking_no.startswith("SPXVN")
    assert shipment.status == "ready_to_ship"
    assert shipment.shipping_fee > 0

    # 2. Get label (replaces ReportLab draft with genuine SPX label scaled 65%)
    label_pdf = spx.get_spx_order_label(s, shipment.tracking_no)
    assert label_pdf.startswith(b"%PDF")
    assert b"ReportLab" not in label_pdf

    # 3. List orders
    items, total, unprinted_count, printed_count = spx.list_spx_orders(s)
    assert total >= 1
    assert any(i.tracking_no == shipment.tracking_no for i in items)

    # 4. Cancel order
    cancelled = spx.cancel_spx_order(s, shipment.tracking_no)
    assert cancelled.status == "cancelled"

    gen.close()


def test_spx_api_endpoints(auth_client, monkeypatch):
    """Test FastAPI SPX endpoints."""
    _install_mock_spx_api(monkeypatch)

    # 1. Get settings
    r = auth_client.get("/api/spx/settings")
    assert r.status_code == 200
    assert "spx_username" in r.json()

    # 2. Save settings
    r = auth_client.post(
        "/api/spx/settings",
        json={
            "spx_username": "0345296757",
            "spx_password": "NhapHang123@",
            "spx_cookies": "spx_token=tok_api; spx_sid=sid_api",
            "spx_sender_name": "INUT TECHNOLOGY",
            "spx_sender_phone": "0345296757",
            "spx_sender_address": "TP Thủ Đức, TP HCM",
        },
    )
    assert r.status_code == 200
    assert r.json()["spx_password"] == "********"

    # 3. Test connection & session validation
    r = auth_client.post(
        "/api/spx/test-connection",
        json={
            "username": "0345296757",
            "password": "NhapHang123@",
        },
    )
    assert r.status_code == 200
    assert r.json()["success"] is True

    r_val = auth_client.get("/api/spx/session/validate")
    assert r_val.status_code == 200
    assert r_val.json()["valid"] is True

    # 4. Create order
    r = auth_client.post(
        "/api/spx/orders",
        json={
            "recipient_name": "Phạm Văn Minh",
            "recipient_phone": "0933112233",
            "recipient_address": "12 Điện Biên Phủ, Phường Đa Kao, Quận 1",
            "province": "Hồ Chí Minh",
            "district": "Quận 1",
            "ward": "Phường Đa Kao",
            "cod_amount": 500000.0,
            "weight_gram": 450,
            "item_description": "Cáp tín hiệu RS485 Modbus",
            "note": "Cho xem hàng không cho thử",
            "order_code": "DH-API-001",
        },
    )
    assert r.status_code == 200
    tracking_no = r.json()["tracking_no"]
    assert tracking_no.startswith("SPXVN")

    # 5. List orders
    r = auth_client.get("/api/spx/orders")
    assert r.status_code == 200
    data = r.json()
    assert data["total"] >= 1
    assert any(x["tracking_no"] == tracking_no for x in data["items"])

    # 6. Get label PDF
    r = auth_client.get(f"/api/spx/orders/{tracking_no}/label")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")
    assert b"ReportLab" not in r.content

    # 7. Cancel order
    r = auth_client.post(f"/api/spx/orders/{tracking_no}/cancel")
    assert r.status_code == 200
    assert r.json()["status"] == "cancelled"


def test_spx_quick_print_and_sync(monkeypatch):
    """Test Quick Print by Code, Sync Batch, and Share Registration with authentic SPX mock."""
    _install_mock_spx_api(monkeypatch)
    gen = db.get_session()
    s = next(gen)
    spx.save_spx_settings(
        s,
        {
            "spx_username": "0345296757",
            "spx_password": "NhapHang123@",
            "spx_cookies": "spx_token=tok_sync; spx_sid=sid_sync",
        },
    )

    # 1. Sync batch of codes
    sync_raw = "SPXVN0988776655\nVN2615337004838260\nSPXVN011223344"
    res = spx.sync_spx_orders_batch(s, sync_raw)
    assert res["success"] is True
    assert res["total_synced"] == 3

    # Verify authentic recipient data was populated (never "Khách hàng SPX")
    synced_order = spx.get_spx_order(s, "SPXVN0988776655")
    assert synced_order is not None
    assert synced_order.recipient_name == "Anh Tài"
    assert not synced_order.recipient_name.startswith("Khách hàng SPX")

    # 2. Check stats
    stats = spx.get_spx_stats(s)
    assert stats["total"] >= 3
    assert stats["unprinted"] >= 3

    # 3. Quick print a new code (not in DB yet)
    quick_res = spx.quick_print_by_code(s, "SPXVN999888777", print_remote=False)
    assert quick_res["success"] is True
    assert quick_res["is_printed"] is True
    assert quick_res["tracking_no"] == "SPXVN999888777"
    assert quick_res["recipient_name"] == "Anh Tài"
    assert quick_res["share_url"].startswith("/s/")
    assert quick_res["label_doc_id"] != ""

    # 4. Mark printed / unprinted toggle
    toggled = spx.mark_spx_order_printed(s, "SPXVN0988776655", is_printed=True)
    assert toggled.is_printed is True
    assert toggled.printed_at is not None

    unprinted_toggled = spx.mark_spx_order_printed(s, "SPXVN0988776655", is_printed=False)
    assert unprinted_toggled.is_printed is False

    # 5. List with is_printed filter
    items_unprinted, total_u, count_u, count_p = spx.list_spx_orders(s, is_printed=False)
    assert len(items_unprinted) >= 3
    assert all(not i.is_printed for i in items_unprinted)

    gen.close()


def test_spx_sync_and_quick_print_api(auth_client, monkeypatch):
    """Test FastAPI SPX quick-print, sync-orders, mark-printed, and stats."""
    _install_mock_spx_api(monkeypatch)

    # 1. Sync orders
    r = auth_client.post(
        "/api/spx/sync-orders",
        json={"raw_text": "SPXVN000111222\nSPXVN000333444"},
    )
    assert r.status_code == 200
    assert r.json()["total_synced"] == 2

    # 2. Stats
    r = auth_client.get("/api/spx/stats")
    assert r.status_code == 200
    assert r.json()["total"] >= 2

    # 3. Quick print via API
    r = auth_client.post(
        "/api/spx/quick-print",
        json={
            "tracking_no": "SPXVN000111222",
            "print_remote": False,
        },
    )
    assert r.status_code == 200
    assert r.json()["is_printed"] is True
    assert r.json()["share_url"].startswith("/s/")

    # 4. Filter by unprinted
    r = auth_client.get("/api/spx/orders?is_printed=false")
    assert r.status_code == 200
    data = r.json()
    assert all(not x["is_printed"] for x in data["items"])

    # 5. Mark printed / unprinted API
    r = auth_client.post("/api/spx/orders/SPXVN000333444/mark-printed")
    assert r.status_code == 200
    assert r.json()["is_printed"] is True

    r = auth_client.post("/api/spx/orders/SPXVN000333444/mark-unprinted")
    assert r.status_code == 200
    assert r.json()["is_printed"] is False


def test_custom_shipping_label(auth_client):
    """Test generating and printing custom delivery labels (non-SPX)."""
    gen = db.get_session()
    s = next(gen)

    res = spx.print_custom_shipping_label(
        db=s,
        code="THI 058 601 1011",
        recipient_name="Thiết bị điện Cao Thắng",
        recipient_phone="0902644315",
        recipient_address="48 Đặng Ngọc Chinh, Phường 3, TP Tây Ninh",
        item_desc="THI 058 601 1011",
        print_remote=False,
    )
    assert res["success"] is True
    assert res["code"] == "THI 058 601 1011"
    assert res["label_doc_id"] != ""

    r = auth_client.post(
        "/api/spx/custom-label/print",
        json={
            "code": "TEST-CUSTOM-001",
            "recipient_name": "Nguyen Van B",
            "recipient_phone": "0987654321",
            "recipient_address": "123 Le Loi, Da Nang",
            "print_remote": False,
        },
    )
    assert r.status_code == 200
    assert r.json()["success"] is True
    assert r.json()["code"] == "TEST-CUSTOM-001"

    gen.close()


def test_zero_fake_template_invariant_blocks_offline_spxvn(monkeypatch):
    """Verify official SPX codes NEVER fallback to generate_spx_a6_label or create fake 'Khách hàng SPX' rows when offline."""
    monkeypatch.setattr(spx, "fetch_spx_order_online", lambda *a, **kw: None)
    monkeypatch.setattr(
        spx,
        "_run_playwright_spx_login",
        lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("Offline test")),
    )

    gen = db.get_session()
    s = next(gen)

    with pytest.raises(RuntimeError):
        spx.quick_print_by_code(s, "SPXVN06647830539A", print_remote=False)

    assert spx.get_spx_order(s, "SPXVN06647830539A") is None

    with pytest.raises(RuntimeError):
        spx.sync_spx_orders_batch(s, "SPXVN06647830539A")

    assert spx.get_spx_order(s, "SPXVN06647830539A") is None
    gen.close()


def test_validate_spx_session_and_auto_login(monkeypatch):
    """Test session heartbeat validation and Playwright auto-login with password fallback."""
    _install_mock_spx_api(monkeypatch)
    gen = db.get_session()
    s = next(gen)

    # Empty cookie -> invalid
    res_empty = spx.validate_spx_session(s, cookie_str="")
    assert res_empty["valid"] is False

    # Valid cookie -> valid
    res_valid = spx.validate_spx_session(s, cookie_str="spx_token=t1; spx_sid=s1")
    assert res_valid["valid"] is True
    assert res_valid["account_id"] == 1602803950

    # Auto-login with password fallback (NhapHang123 fails, NhapHang123@ succeeds)
    attempts = []

    def fake_playwright_login(u, p, timeout=45):
        attempts.append((u, p))
        if p != "NhapHang123@":
            raise RuntimeError("ERROR_PASSWORD_INVALID")
        return "spx_token=fresh_tok_999; spx_sid=fresh_sid_999; login_status=true"

    monkeypatch.setattr(spx, "_run_playwright_spx_login", fake_playwright_login)
    spx.save_spx_settings(s, {"spx_username": "0345296757", "spx_password": "NhapHang123"})

    login_res = spx.auto_login_spx(s)
    assert login_res["success"] is True
    assert "spx_token=fresh_tok_999" in login_res["cookies"]
    assert ("0345296757", "NhapHang123") in attempts
    assert ("0345296757", "NhapHang123@") in attempts

    raw = spx.get_spx_raw_credentials(s)
    assert raw["spx_password"] == "NhapHang123@"
    assert "spx_token=fresh_tok_999" in raw["spx_cookies"]
    gen.close()


def test_scale_pdf_golden_ratio_and_cache_poisoning_remediation(monkeypatch):
    """Test Golden Ratio 65% scaling and automatic remediation of poisoned 'Khách hàng SPX' cache."""
    _install_mock_spx_api(monkeypatch)
    gen = db.get_session()
    s = next(gen)
    spx.save_spx_settings(
        s,
        {
            "spx_username": "0345296757",
            "spx_password": "NhapHang123@",
            "spx_cookies": "spx_token=tok_rem; spx_sid=sid_rem",
        },
    )

    # 1. Verify scale_pdf_golden_ratio rejects invalid bytes
    with pytest.raises(ValueError):
        spx.scale_pdf_golden_ratio(b"NOT_A_PDF")

    orig_pdf = _make_genuine_spx_pdf_bytes(282.96, 141.12)
    scaled_pdf = spx.scale_pdf_golden_ratio(orig_pdf)
    reader = PdfReader(io.BytesIO(scaled_pdf))
    assert len(reader.pages) == 1
    assert abs(float(reader.pages[0].mediabox.width) - 282.96) < 0.5
    assert abs(float(reader.pages[0].mediabox.height) - 141.12) < 0.5

    # 2. Simulate poisoned row 33 (SPXVN06647830539A with fake ReportLab PDF)
    fake_pdf = spx_label.generate_spx_a6_label(
        tracking_no="SPXVN06647830539A",
        recipient_name="Khách hàng SPX (30539A)",
        recipient_phone="",
        recipient_address="Địa chỉ nhận hàng theo đơn SPX Express",
    )
    fake_doc_id = storage.save_upload(fake_pdf, suffix=".pdf")
    poisoned = SpxShipment(
        tracking_no="SPXVN06647830539A",
        order_code="SPXVN06647830539A",
        recipient_name="Khách hàng SPX (30539A)",
        recipient_phone="",
        recipient_address="Địa chỉ nhận hàng theo đơn SPX Express",
        province="Hồ Chí Minh",
        district="",
        ward="",
        cod_amount=0.0,
        weight_gram=500,
        length_cm=10,
        width_cm=10,
        height_cm=10,
        item_description="Sản phẩm / Phụ kiện INUT",
        note="Cho xem hàng, không cho thử",
        payer="sender",
        status="ready_to_ship",
        shipping_fee=22000.0,
        label_doc_id=fake_doc_id,
        sender_name="INUT",
        sender_phone="0345296757",
        sender_address="TP Thủ Đức",
    )
    s.add(poisoned)
    s.commit()

    # Calling get_spx_order_label must detect poisoned cache, fetch online, and replace with genuine label
    remediated_pdf = spx.get_spx_order_label(s, "SPXVN06647830539A")
    s.refresh(poisoned)
    assert poisoned.order_code == "VN26691530539AQ"
    assert poisoned.recipient_name == "Anh Tài"
    assert poisoned.recipient_phone == "84357242389"
    assert poisoned.label_doc_id != fake_doc_id
    assert b"ReportLab" not in remediated_pdf
    gen.close()
