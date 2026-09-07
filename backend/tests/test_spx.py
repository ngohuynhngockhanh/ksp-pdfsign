"""Unit & integration tests cho module Van don SPX Express (spx.vn)."""

from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient

from app import db, spx, spx_label
from app.db import AppSetting, SpxShipment, init_db
from app.main import app


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
    gen.close()

    c = TestClient(app)
    r = c.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})
    assert r.status_code == 200
    return c



def test_spx_label_pdf_generation():
    """Test generating A6 thermal shipping label PDF."""
    pdf_bytes = spx_label.generate_spx_a6_label(
        tracking_no="SPXVN0123456789",
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
        "spx_password": "MySecretPassword123@",
        "spx_shop_id": "SHOP_999",
        "spx_api_token": "TOK_SEC_ABC123",
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
    assert saved["spx_username"] == "0345296757"

    # Verify decrypted raw credentials
    raw = spx.get_spx_raw_credentials(s)
    assert raw["spx_password"] == "MySecretPassword123@"
    assert raw["spx_api_token"] == "TOK_SEC_ABC123"

    gen.close()


def test_spx_order_lifecycle():
    """Test full SPX order creation, listing, label retrieval, and cancellation."""
    gen = db.get_session()
    s = next(gen)

    # 1. Create order
    shipment = spx.create_spx_order(s, {
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
    })

    assert shipment.id is not None
    assert shipment.tracking_no.startswith("SPXVN")
    assert shipment.status == "ready_to_ship"
    assert shipment.shipping_fee > 0
    assert shipment.label_doc_id != ""

    # 2. Get label
    label_pdf = spx.get_spx_order_label(s, shipment.tracking_no)
    assert len(label_pdf) > 1000
    assert label_pdf.startswith(b"%PDF")

    # 3. List orders
    items, total, unprinted_count, printed_count = spx.list_spx_orders(s)
    assert total >= 1
    assert any(i.tracking_no == shipment.tracking_no for i in items)

    # 4. Cancel order
    cancelled = spx.cancel_spx_order(s, shipment.tracking_no)
    assert cancelled.status == "cancelled"

    gen.close()


def test_spx_api_endpoints(auth_client):
    """Test FastAPI SPX endpoints."""
    # 1. Get settings
    r = auth_client.get("/api/spx/settings")
    assert r.status_code == 200
    assert "spx_username" in r.json()

    # 2. Save settings
    r = auth_client.post("/api/spx/settings", json={
        "spx_username": "0345296757",
        "spx_password": "NhapHang123@",
        "spx_sender_name": "INUT TECHNOLOGY",
        "spx_sender_phone": "0345296757",
        "spx_sender_address": "TP Thủ Đức, TP HCM",
    })
    assert r.status_code == 200
    assert r.json()["spx_password"] == "********"

    # 3. Test connection
    r = auth_client.post("/api/spx/test-connection", json={
        "username": "0345296757",
        "password": "NhapHang123@",
    })
    assert r.status_code == 200
    assert r.json()["success"] is True

    # 4. Create order
    r = auth_client.post("/api/spx/orders", json={
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
    })
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
    assert len(r.content) > 1000
    assert r.content.startswith(b"%PDF")

    # 7. Cancel order
    r = auth_client.post(f"/api/spx/orders/{tracking_no}/cancel")
    assert r.status_code == 200
    assert r.json()["status"] == "cancelled"


def test_spx_quick_print_and_sync():
    """Test Quick Print by Code, Sync Batch, and Batch Print Unprinted."""
    gen = db.get_session()
    s = next(gen)

    # 1. Sync batch of codes
    sync_raw = "SPXVN0988776655\nVN2615337004838260\nSPXVN011223344"
    res = spx.sync_spx_orders_batch(s, sync_raw)
    assert res["success"] is True
    assert res["total_synced"] == 3

    # 2. Check stats
    stats = spx.get_spx_stats(s)
    assert stats["total"] >= 3
    assert stats["unprinted"] >= 3

    # 3. Quick print a new code (not in DB yet)
    quick_res = spx.quick_print_by_code(s, "SPXVN999888777", print_remote=False)
    assert quick_res["success"] is True
    assert quick_res["is_printed"] is True
    assert quick_res["tracking_no"] == "SPXVN999888777"

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


def test_spx_sync_and_quick_print_api(auth_client):
    """Test FastAPI SPX quick-print, sync-orders, mark-printed, and stats."""
    # 1. Sync orders
    r = auth_client.post("/api/spx/sync-orders", json={"raw_text": "SPXVN000111222\nSPXVN000333444"})
    assert r.status_code == 200
    assert r.json()["total_synced"] == 2

    # 2. Stats
    r = auth_client.get("/api/spx/stats")
    assert r.status_code == 200
    assert r.json()["total"] >= 2

    # 3. Quick print via API
    r = auth_client.post("/api/spx/quick-print", json={
        "tracking_no": "SPXVN000111222",
        "print_remote": False,
    })
    assert r.status_code == 200
    assert r.json()["is_printed"] is True

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

