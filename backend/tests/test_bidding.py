"""Comprehensive unit, integration, and resiliency tests for Bidding Procurement Module."""

from datetime import datetime, timezone
import json
import httpx
import pytest
from fastapi.testclient import TestClient


from app import ai, bidding, db, telegram
from app.config import get_settings
from app.db import (
    BiddingAlertLog,
    BiddingBookmark,
    BiddingWatchlist,
    TelegramConnection,
    User,
    init_db,
)
from app.main import app


@pytest.fixture(autouse=True)
def setup_db(tmp_path, monkeypatch):
    """Set up temporary database and isolated settings for tests."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("AI_ENABLED", "false")
    get_settings.cache_clear()
    bidding._default_client.clear_cache()
    db.reset_engine_for_tests()
    init_db()
    yield
    get_settings.cache_clear()
    bidding._default_client.clear_cache()


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


# ==============================================================================
# Tier 1: Pure Unit Tests
# ==============================================================================

def test_bidding_helpers_and_formatting():
    """Test Vietnamese text normalization and VND currency formatting."""
    assert bidding._strip_accents("Hồ Chí Minh") == "ho chi minh"
    assert bidding._strip_accents("Đà Nẵng") == "da nang"
    assert bidding._strip_accents("TRẠM BƠM SCADA") == "tram bom scada"
    assert bidding._strip_accents("") == ""

    assert bidding.format_currency_vnd(1850000000) == "1.850.000.000"
    assert bidding.format_currency_vnd(0) == "0"
    assert bidding.format_currency_vnd(None) == "0"


def test_bidding_mock_generator_filtering():
    """Test MockBiddingGenerator filtering by keyword, province, field, price, and method."""
    # 1. Search keyword "SCADA"
    res_kw = bidding.MockBiddingGenerator.search(keyword="SCADA")
    assert res_kw["total"] > 0
    assert all("scada" in bidding._strip_accents(it["tender_name"] + it.get("description", "")) for it in res_kw["items"])

    # 2. Search province "Bình Dương"
    res_prov = bidding.MockBiddingGenerator.search(province="Bình Dương")
    assert res_prov["total"] >= 1
    assert any("Bình Dương" in it["province"] for it in res_prov["items"])

    # 3. Search field "HH"
    res_field = bidding.MockBiddingGenerator.search(field="HH")
    assert res_field["total"] > 0
    assert all(it["field"] == "HH" for it in res_field["items"])

    # 4. Search price range
    res_price = bidding.MockBiddingGenerator.search(min_price=1000000000.0, max_price=3000000000.0)
    assert res_price["total"] > 0
    for it in res_price["items"]:
        assert 1000000000.0 <= it["bid_price"] <= 3000000000.0

    # 5. Pagination
    res_page = bidding.MockBiddingGenerator.search(page=1, page_size=2)
    assert len(res_page["items"]) == 2
    assert res_page["page"] == 1
    assert res_page["total_pages"] > 1

    # 6. Detail lookup
    detail = bidding.MockBiddingGenerator.get_detail("IB2600001001-00")
    assert detail is not None
    assert detail["tbmt_code"] == "IB2600001001-00"

    # 7. Pattern detail lookup for unknown TBMT
    gen_detail = bidding.MockBiddingGenerator.get_detail("IB2699999999-00")
    assert gen_detail is not None
    assert gen_detail["tbmt_code"] == "IB2699999999-00"


def test_bidding_client_caching_and_ttl():
    """Test in-memory TTL caching for search and detail lookups."""
    client = bidding.BiddingClient()
    client.clear_cache()

    # First search -> sets cache
    res1 = client.search(keyword="Gateway", page=1, page_size=5)
    assert res1["total"] > 0

    # Second search with same parameters -> hits cache
    res2 = client.search(keyword="Gateway", page=1, page_size=5)
    assert res1 == res2

    # Detail cache
    d1 = client.get_detail("IB2600001001-00")
    assert d1 is not None
    d2 = client.get_detail("IB2600001001-00")
    assert d1 == d2

    client.clear_cache()
    assert len(client._cache) == 0


def test_ai_analyze_heuristic_fallback():
    """Test deterministic heuristic AI analysis when AI is disabled."""
    settings = get_settings()
    settings.ai_enabled = False

    mock_tender = {
        "tbmt_code": "IB2600001001-00",
        "tender_name": "Cung cấp hệ thống giám sát SCADA và Gateway 4G iNut",
        "procuring_entity": "Công ty Thủy lợi Miền Nam",
        "investor": "Sở Nông nghiệp TP.HCM",
        "field": "HH",
        "bid_price": 980000000.0,
        "bid_deadline": "2026-09-30 09:00:00",
        "province": "Hồ Chí Minh",
        "bidding_method": "Đấu thầu rộng rãi qua mạng",
    }

    res = bidding.ai_analyze_tender(settings, mock_tender, custom_context="Có sẵn 50 gateway trong kho")
    assert "executive_summary" in res
    assert "scope_of_work" in res
    assert isinstance(res["scope_of_work"], list)
    assert "capacity_requirements" in res
    assert "financial_requirements" in res
    assert "inut_fit_analysis" in res
    assert 0 <= res["inut_fit_analysis"]["score"] <= 100
    assert res["inut_fit_analysis"]["match_level"] in {"Cao", "Trung bình", "Thấp"}
    assert "recommendation" in res["inut_fit_analysis"]


def test_ai_analyze_live_chat_mock(monkeypatch):
    """Test AI analysis when ai.chat returns structured JSON."""
    monkeypatch.setenv("AI_ENABLED", "true")
    get_settings.cache_clear()
    settings = get_settings()

    mock_ai_response = json.dumps({
        "executive_summary": "Gói thầu cung cấp thiết bị IoT SCADA trạm bơm.",
        "scope_of_work": ["Cung cấp 20 gateway", "Lắp đặt cảm biến"],
        "capacity_requirements": ["ISO 9001:2015", "02 hợp đồng tương tự"],
        "financial_requirements": {
            "min_annual_revenue": 2000000000.0,
            "financial_resources": 500000000.0,
            "bid_security_amount": 15000000.0,
            "summary": "Doanh thu tối thiểu 2 tỷ.",
        },
        "key_personnel_requirements": ["01 Chỉ huy trưởng"],
        "equipment_requirements": ["Thiết bị đo kiểm 4G"],
        "critical_timeline": {
            "bid_closing_at": "2026-09-15 09:00:00",
            "clarification_deadline": "2026-09-10 17:00:00",
            "execution_period_days": 45,
            "timeline_notes": "Hoàn thành trong 45 ngày.",
        },
        "inut_fit_analysis": {
            "score": 95,
            "match_level": "Cao",
            "strengths": ["Làm chủ công nghệ Gateway"],
            "challenges": ["Chuẩn bị bảo lãnh dự thầu"],
            "recommendation": "Nên tham gia độc lập",
            "strategic_action_plan": "Chuẩn bị hồ sơ dự thầu ngay.",
        },
    })

    monkeypatch.setattr(ai, "chat", lambda s, msgs, temperature=0.3: mock_ai_response)

    mock_tender = {
        "tbmt_code": "IB2600001001-00",
        "tender_name": "Cung cấp hệ thống giám sát SCADA",
        "procuring_entity": "Sở Nông nghiệp",
        "investor": "UBND TP",
        "field": "HH",
        "bid_price": 980000000.0,
        "bid_deadline": "2026-09-15 09:00:00",
        "province": "Hồ Chí Minh",
    }

    res = bidding.ai_analyze_tender(settings, mock_tender)
    assert res["inut_fit_analysis"]["score"] == 95
    assert res["inut_fit_analysis"]["match_level"] == "Cao"
    assert res["inut_fit_analysis"]["recommendation"] == "Nên tham gia độc lập"


def test_telegram_alert_formatter():
    """Test formatting Telegram alert message cards."""
    tender = {
        "tbmt_code": "IB2600001001-00",
        "tender_name": "Cung cấp hệ thống giám sát năng lượng iNut",
        "procuring_entity": "Công ty Thủy lợi Miền Nam",
        "investor": "Sở Nông nghiệp TP.HCM",
        "bid_price": 980000000.0,
        "province": "Hồ Chí Minh",
        "bid_deadline": "2026-09-20 09:00:00",
        "field": "HH",
        "source_url": "https://muasamcong.mpi.gov.vn/...",
    }
    msg = bidding.format_telegram_alert_message("SCADA Miền Nam", tender)
    assert "[KSP ĐẤU THẦU] PHÁT HIỆN GÓI THẦU MỚI" in msg
    assert "SCADA Miền Nam" in msg
    assert "IB2600001001-00" in msg
    assert "980.000.000 VNĐ" in msg
    assert "Hồ Chí Minh" in msg


# ==============================================================================
# Tier 2: Database ORM CRUD & Pipeline State Machine Tests
# ==============================================================================

def test_bidding_bookmark_crud():
    """Test full CRUD lifecycle and pipeline state transitions for bookmarks."""
    gen = db.get_session()
    s = next(gen)

    # 1. Create Bookmark
    bm_data = {
        "tbmt_code": "IB2600001001-00",
        "tender_name": "Cung cấp hệ thống SCADA trạm bơm",
        "procuring_entity": "Công ty Khai thác Thủy lợi",
        "investor": "Sở Nông nghiệp",
        "field": "HH",
        "bid_price": 980000000.0,
        "bid_deadline": "2026-09-20 09:00:00",
        "province": "Hồ Chí Minh",
        "status": "watching",
        "note": "Gói tiềm năng cao cho iNut Gateway",
    }
    bm = bidding.create_bookmark(s, bm_data, user_id=1)
    assert bm.id is not None
    assert bm.tbmt_code == "IB2600001001-00"
    assert bm.status == "watching"

    # 2. Pipeline state transition: watching -> preparing -> submitted -> won
    for new_status in ["preparing", "submitted", "won"]:
        updated = bidding.update_bookmark(s, bm.id, {"status": new_status})
        assert updated is not None
        assert updated.status == new_status

    # 3. List bookmarks
    items, total = bidding.list_bookmarks(s, status="won")
    assert total == 1
    assert items[0].id == bm.id

    # 4. Search bookmarks
    items_search, total_search = bidding.list_bookmarks(s, search="SCADA")
    assert total_search == 1

    # 5. Delete bookmark
    ok = bidding.delete_bookmark(s, bm.id)
    assert ok is True
    assert bidding.get_bookmark(s, bm.id) is None

    gen.close()


def test_bidding_watchlist_crud():
    """Test full CRUD operations for automated watchlists."""
    gen = db.get_session()
    s = next(gen)

    # 1. Create Watchlist
    wl_data = {
        "name": "SCADA & IoT TP.HCM",
        "keyword": "SCADA",
        "province": "Hồ Chí Minh",
        "field": "HH",
        "min_price": 500000000.0,
        "max_price": 5000000000.0,
        "notify_telegram": True,
        "is_active": True,
    }
    wl = bidding.create_watchlist(s, wl_data, user_id=1)
    assert wl.id is not None
    assert wl.name == "SCADA & IoT TP.HCM"
    assert wl.is_active is True

    # 2. Update Watchlist
    updated = bidding.update_watchlist(s, wl.id, {"name": "SCADA Toàn Quốc", "province": ""})
    assert updated is not None
    assert updated.name == "SCADA Toàn Quốc"
    assert updated.province == ""

    # 3. List Watchlists
    watchlists = bidding.list_watchlists(s, is_active=True)
    assert len(watchlists) == 1
    assert watchlists[0].id == wl.id

    # 4. Delete Watchlist
    ok = bidding.delete_watchlist(s, wl.id)
    assert ok is True
    assert bidding.get_watchlist(s, wl.id) is None

    gen.close()


def test_bidding_watchlist_scan_and_alert_deduplication(monkeypatch):
    """Test watchlist scanning, deduplication in BiddingAlertLog, and Telegram dispatch."""
    gen = db.get_session()
    s = next(gen)

    # Seed an admin user with linked active telegram
    user = s.scalar(db.select(User).where(User.username == "admin"))
    if not user:
        user = User(username="admin", role="admin", password_hash="dummy")
        s.add(user)
        s.flush()
    tg_conn = TelegramConnection(
        user_id=user.id,
        chat_id="123456789",
        status="active",
        username="admin_tg",
    )
    s.add(tg_conn)

    # Create active watchlist
    wl = bidding.create_watchlist(s, {
        "name": "Cảm biến & IoT Miền Nam",
        "keyword": "Gateway",
        "province": "Hồ Chí Minh",
        "field": "HH",
        "notify_telegram": True,
        "is_active": True,
    })
    s.commit()

    settings = get_settings()
    settings.telegram_enabled = True
    settings.telegram_bot_token = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"

    # Mock TelegramClient.send_message
    sent_messages = []
    class MockTelegramClient:
        def __init__(self, *args, **kwargs):
            pass
        def send_message(self, chat_id, text):
            sent_messages.append((chat_id, text))
            return {"ok": True}
        def close(self):
            pass

    monkeypatch.setattr(telegram, "TelegramClient", MockTelegramClient)
    monkeypatch.setattr(telegram, "is_configured", lambda s: True)

    # First scan -> discovers tenders, records in BiddingAlertLog, sends Telegram alerts
    res1 = bidding.run_watchlist_scan(s, settings, watchlist_id=wl.id)
    assert res1["watchlists_scanned"] == 1
    assert res1["new_tenders_found"] > 0
    assert res1["alerts_sent"] > 0
    assert len(sent_messages) > 0

    first_alert_count = res1["new_tenders_found"]

    # Second immediate scan -> deduplication prevents any duplicate alerts
    sent_messages.clear()
    res2 = bidding.run_watchlist_scan(s, settings, watchlist_id=wl.id)
    assert res2["watchlists_scanned"] == 1
    assert res2["new_tenders_found"] == 0
    assert res2["alerts_sent"] == 0
    assert len(sent_messages) == 0

    # Verify BiddingAlertLog records in DB
    logs = s.scalars(db.select(BiddingAlertLog).where(BiddingAlertLog.watchlist_id == wl.id)).all()
    assert len(logs) == first_alert_count

    gen.close()


# ==============================================================================
# Tier 3: REST API Endpoint Integration Tests
# ==============================================================================

def test_api_bidding_search(auth_client):
    """Test GET /api/bidding/search with queries and validation."""
    # 1. Valid search
    r = auth_client.get("/api/bidding/search?keyword=SCADA&page=1&page_size=5")
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    assert "total" in data
    assert "page" in data
    assert data["page"] == 1
    assert len(data["items"]) <= 5

    # 2. Validation error: min_price > max_price -> 400 Bad Request
    r_bad = auth_client.get("/api/bidding/search?min_price=5000000&max_price=1000000")
    assert r_bad.status_code == 400
    assert "không được lớn hơn" in r_bad.json()["detail"]


def test_api_bidding_get_tender_detail(auth_client):
    """Test GET /api/bidding/tenders/{tbmt_code}."""
    # 1. Existing tender
    r = auth_client.get("/api/bidding/tenders/IB2600001001-00")
    assert r.status_code == 200
    data = r.json()
    assert data["tbmt_code"] == "IB2600001001-00"
    assert "tender_name" in data
    assert "bid_price" in data

    # 2. Non-existing invalid code -> 404
    r_404 = auth_client.get("/api/bidding/tenders/INVALID_NON_EXISTENT")
    assert r_404.status_code == 404


def test_api_bidding_analyze_ai(auth_client, monkeypatch):
    """Test POST /api/bidding/tenders/{tbmt_code}/analyze-ai."""
    monkeypatch.setattr(
        "app.bidding.ai.chat",
        lambda *args, **kwargs: '{"inut_fit_analysis": {"score": 90, "match_level": "Cao", "recommendation": "Tham gia"}, "executive_summary": "Tóm tắt gói thầu"}',
    )
    r = auth_client.post(
        "/api/bidding/tenders/IB2600001001-00/analyze-ai",
        json={"custom_context": "INUT có sẵn đội ngũ kỹ sư tại TP.HCM"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["tbmt_code"] == "IB2600001001-00"
    assert "analysis" in data
    assert "inut_fit_analysis" in data["analysis"]
    assert "score" in data["analysis"]["inut_fit_analysis"]



def test_api_bidding_bookmark_lifecycle(auth_client):
    """Test complete Bookmark REST API endpoints (GET, POST, PUT, DELETE)."""
    # 1. Create Bookmark (POST /api/bidding/bookmarks)
    bm_payload = {
        "tbmt_code": "IB2600001001-00",
        "tender_name": "Cung cấp hệ thống giám sát năng lượng và IoT Gateway",
        "procuring_entity": "Công ty Thủy lợi Miền Nam",
        "investor": "Sở Nông nghiệp",
        "field": "HH",
        "bid_price": 980000000.0,
        "bid_deadline": "2026-09-20 09:00:00",
        "province": "Hồ Chí Minh",
        "bidding_method": "Đấu thầu rộng rãi qua mạng",
        "source_url": "https://muasamcong.mpi.gov.vn/...",
        "status": "watching",
        "note": "Tiềm năng lớn",
    }
    r_create = auth_client.post("/api/bidding/bookmarks", json=bm_payload)
    assert r_create.status_code == 201
    bm_id = r_create.json()["id"]

    # 2. Get Bookmark Detail (GET /api/bidding/bookmarks/{id})
    r_get = auth_client.get(f"/api/bidding/bookmarks/{bm_id}")
    assert r_get.status_code == 200
    assert r_get.json()["tbmt_code"] == "IB2600001001-00"

    # 3. Update Bookmark Pipeline Status (PUT /api/bidding/bookmarks/{id})
    r_put = auth_client.put(
        f"/api/bidding/bookmarks/{bm_id}",
        json={"status": "preparing", "note": "Đang làm E-HSDT"},
    )
    assert r_put.status_code == 200
    assert r_put.json()["status"] == "preparing"
    assert r_put.json()["note"] == "Đang làm E-HSDT"

    # 4. Bad status validation -> 422
    r_bad_status = auth_client.put(
        f"/api/bidding/bookmarks/{bm_id}",
        json={"status": "invalid_status_xyz"},
    )
    assert r_bad_status.status_code == 422

    # 5. List Bookmarks (GET /api/bidding/bookmarks)
    r_list = auth_client.get("/api/bidding/bookmarks?status=preparing")
    assert r_list.status_code == 200
    assert r_list.json()["total"] == 1

    # 6. Delete Bookmark (DELETE /api/bidding/bookmarks/{id})
    r_del = auth_client.delete(f"/api/bidding/bookmarks/{bm_id}")
    assert r_del.status_code == 200
    assert r_del.json()["ok"] is True

    # 7. Verify deletion -> 404
    r_get_after = auth_client.get(f"/api/bidding/bookmarks/{bm_id}")
    assert r_get_after.status_code == 404


def test_api_bidding_watchlist_lifecycle_and_scan(auth_client):
    """Test Watchlist REST API endpoints (GET, POST, PUT, DELETE, SCAN)."""
    # 1. Create Watchlist (POST /api/bidding/watchlist)
    wl_payload = {
        "name": "Cảnh báo SCADA TP.HCM",
        "keyword": "SCADA",
        "province": "Hồ Chí Minh",
        "field": "HH",
        "min_price": 500000000.0,
        "max_price": 3000000000.0,
        "notify_telegram": True,
        "is_active": True,
    }
    r_create = auth_client.post("/api/bidding/watchlist", json=wl_payload)
    assert r_create.status_code == 201
    wl_id = r_create.json()["id"]

    # 2. Get Watchlist Detail (GET /api/bidding/watchlist/{id})
    r_get = auth_client.get(f"/api/bidding/watchlist/{wl_id}")
    assert r_get.status_code == 200
    assert r_get.json()["name"] == "Cảnh báo SCADA TP.HCM"

    # 3. Update Watchlist (PUT /api/bidding/watchlist/{id})
    r_put = auth_client.put(
        f"/api/bidding/watchlist/{wl_id}",
        json={"name": "Cảnh báo SCADA & IoT Miền Nam", "is_active": True},
    )
    assert r_put.status_code == 200
    assert r_put.json()["name"] == "Cảnh báo SCADA & IoT Miền Nam"

    # 4. Trigger single scan (POST /api/bidding/watchlist/{id}/scan)
    r_scan = auth_client.post(f"/api/bidding/watchlist/{wl_id}/scan")
    assert r_scan.status_code == 200
    assert "watchlists_scanned" in r_scan.json()
    assert r_scan.json()["watchlists_scanned"] == 1

    # 5. Trigger batch scan (POST /api/bidding/scan-all)
    r_scan_all = auth_client.post("/api/bidding/scan-all")
    assert r_scan_all.status_code == 200
    assert r_scan_all.json()["watchlists_scanned"] >= 1

    # 6. Delete Watchlist (DELETE /api/bidding/watchlist/{id})
    r_del = auth_client.delete(f"/api/bidding/watchlist/{wl_id}")
    assert r_del.status_code == 200
    assert r_del.json()["ok"] is True


def test_api_bidding_unauthenticated_guard():
    """Verify 401 Unauthorized for unauthenticated requests."""
    c = TestClient(app)
    endpoints = [
        ("GET", "/api/bidding/search"),
        ("GET", "/api/bidding/tenders/IB2600001001-00"),
        ("POST", "/api/bidding/tenders/IB2600001001-00/analyze-ai"),
        ("GET", "/api/bidding/bookmarks"),
        ("POST", "/api/bidding/bookmarks"),
        ("GET", "/api/bidding/watchlist"),
        ("POST", "/api/bidding/watchlist"),
        ("POST", "/api/bidding/scan-all"),
    ]
    for method, path in endpoints:
        if method == "GET":
            r = c.get(path)
        else:
            r = c.post(path, json={})
        assert r.status_code in {401, 403}, f"Expected 401/403 for {method} {path}, got {r.status_code}"


# ==============================================================================
# Tier 4: Resiliency & Fault Tolerance Tests
# ==============================================================================

def test_bidding_client_network_failure_mock_fallback(monkeypatch):
    """Test seamless fallback to mock data when e-GP public API times out or errors."""
    client = bidding.BiddingClient()
    client.clear_cache()

    # Simulate httpx post raising Network Timeout
    def mock_post_raise(*args, **kwargs):
        raise httpx.ConnectTimeout("Connection timed out to muasamcong.mpi.gov.vn")

    monkeypatch.setattr(httpx.Client, "post", mock_post_raise)

    # Search should seamlessly return mock data without crashing
    res = client.search(keyword="SCADA", page=1, page_size=5)
    assert res["is_mock"] is True
    assert res["total"] > 0
    assert len(res["items"]) > 0


def test_telegram_failure_does_not_break_watchlist_scan(monkeypatch):
    """Test that Telegram API failures do not block or crash the watchlist scan engine."""
    gen = db.get_session()
    s = next(gen)

    # Admin user and connection
    user = s.scalar(db.select(User).where(User.username == "admin"))
    if not user:
        user = User(username="admin", role="admin", password_hash="dummy")
        s.add(user)
        s.flush()
    s.add(TelegramConnection(user_id=user.id, chat_id="999999999", status="active"))

    # Active watchlist
    wl = bidding.create_watchlist(s, {
        "name": "Fault Tolerance Watchlist",
        "keyword": "SCADA",
        "notify_telegram": True,
        "is_active": True,
    })
    s.commit()

    settings = get_settings()
    settings.telegram_enabled = True
    settings.telegram_bot_token = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"

    # Simulate TelegramClient throwing TelegramError
    class FailingTelegramClient:
        def __init__(self, *args, **kwargs):
            pass
        def send_message(self, chat_id, text):
            raise telegram.TelegramError("Telegram Bot API rate limit exceeded")
        def close(self):
            pass

    monkeypatch.setattr(telegram, "TelegramClient", FailingTelegramClient)
    monkeypatch.setattr(telegram, "is_configured", lambda s: True)

    # Scan should succeed with alerts_failed incremented
    res = bidding.run_watchlist_scan(s, settings, watchlist_id=wl.id)
    assert res["watchlists_scanned"] == 1
    assert res["new_tenders_found"] > 0
    assert res["alerts_failed"] > 0

    gen.close()


def test_bidding_alert_log_unique_constraint_orm():
    """Test BiddingAlertLog unique constraint prevents duplicate alert logging for (watchlist_id, tbmt_code)."""
    gen = db.get_session()
    s = next(gen)
    try:
        wl = BiddingWatchlist(name="Dedup Constraint Test", keyword="Dedup")
        s.add(wl)
        s.commit()

        # First insert succeeds
        log1 = BiddingAlertLog(watchlist_id=wl.id, tbmt_code="IB2600009999-00")
        s.add(log1)
        s.commit()
        assert log1.id is not None

        # Duplicate insert must raise IntegrityError
        from sqlalchemy.exc import IntegrityError
        log2 = BiddingAlertLog(watchlist_id=wl.id, tbmt_code="IB2600009999-00")
        s.add(log2)
        with pytest.raises(IntegrityError):
            s.commit()
        s.rollback()

        # Different TBMT code succeeds
        log3 = BiddingAlertLog(watchlist_id=wl.id, tbmt_code="IB2600008888-00")
        s.add(log3)
        s.commit()
        assert log3.id is not None
    finally:
        gen.close()


def test_e2e_procurement_hunting_workflow(auth_client, monkeypatch):
    """End-to-End procurement hunting workflow: search -> detail -> AI analyze -> bookmark -> status pipeline."""
    # 1. Search for targeted IoT / SCADA tenders
    r_search = auth_client.get("/api/bidding/search?keyword=SCADA&page=1&page_size=5")
    assert r_search.status_code == 200
    items = r_search.json().get("items", [])
    assert len(items) > 0
    target_tender = items[0]
    tbmt = target_tender["tbmt_code"]

    # 2. Inspect detailed tender specifications
    r_detail = auth_client.get(f"/api/bidding/tenders/{tbmt}")
    assert r_detail.status_code == 200
    detail = r_detail.json()
    assert detail["tbmt_code"] == tbmt

    # 3. Trigger AI strategic evaluation
    monkeypatch.setenv("AI_ENABLED", "true")
    get_settings.cache_clear()
    monkeypatch.setattr(
        "app.bidding.ai.chat",
        lambda *args, **kwargs: json.dumps({
            "executive_summary": "Gói thầu SCADA giám sát chất lượng nước",
            "scope_of_work": ["Cung cấp 05 trạm quan trắc IoT"],
            "capacity_requirements": ["02 hợp đồng tương tự >= 1 tỷ"],
            "financial_requirements": {"min_annual_revenue": 3000000000.0, "summary": "Doanh thu 3 tỷ"},
            "key_personnel_requirements": ["01 Chỉ huy trưởng chuyên ngành Điện/Tự động hóa"],
            "equipment_requirements": ["01 Thiết bị đo kiểm chuẩn"],
            "critical_timeline": {"bid_closing_at": "2026-10-20 10:00:00", "execution_period_days": 60},
            "inut_fit_analysis": {
                "score": 96,
                "match_level": "Cao",
                "strengths": ["Làm chủ 100% phần mềm và phần cứng iNut"],
                "challenges": ["Thời gian chuẩn bị hồ sơ 15 ngày"],
                "recommendation": "Nên tham gia độc lập",
                "strategic_action_plan": "1. Khảo sát hiện trường; 2. Làm bảo lãnh 30 triệu; 3. Nộp E-HSDT",
            },
        }),
    )
    r_ai = auth_client.post(f"/api/bidding/tenders/{tbmt}/analyze-ai")
    assert r_ai.status_code == 200
    ai_res = r_ai.json()
    assert ai_res["analysis"]["inut_fit_analysis"]["score"] >= 80

    # 4. Bookmark tender into pipeline with initial status "watching"
    r_bm = auth_client.post("/api/bidding/bookmarks", json={
        "tbmt_code": tbmt,
        "tender_name": detail["tender_name"],
        "procuring_entity": detail.get("procuring_entity", ""),
        "investor": detail.get("investor", ""),
        "field": detail.get("field", "HH"),
        "bid_price": detail.get("bid_price", 0.0),
        "province": detail.get("province", ""),
        "status": "watching",
        "note": "AI chấm 96 điểm - cơ hội rất lớn",
        "ai_summary": json.dumps(ai_res["analysis"]),
    })
    assert r_bm.status_code == 201
    bm_id = r_bm.json()["id"]

    # 5. Advance to "preparing" stage
    r_prep = auth_client.put(f"/api/bidding/bookmarks/{bm_id}", json={
        "status": "preparing",
        "note": "Đã phân công Trưởng nhóm kỹ thuật lập giải pháp và báo giá",
    })
    assert r_prep.status_code == 200
    assert r_prep.json()["status"] == "preparing"

    # 6. Advance to "submitted" stage
    r_sub = auth_client.put(f"/api/bidding/bookmarks/{bm_id}", json={
        "status": "submitted",
        "note": "Đã ký số token USB và nộp E-HSDT thành công trên muasamcong",
    })
    assert r_sub.status_code == 200
    assert r_sub.json()["status"] == "submitted"

    # 7. Advance to "won" stage
    r_won = auth_client.put(f"/api/bidding/bookmarks/{bm_id}", json={
        "status": "won",
        "note": "Trúng thầu! Đang chuẩn bị bảo lãnh thực hiện hợp đồng",
    })
    assert r_won.status_code == 200
    assert r_won.json()["status"] == "won"

    # 8. Verify pipeline shows tender under "won"
    r_won_list = auth_client.get("/api/bidding/bookmarks?status=won")
    assert r_won_list.status_code == 200
    won_items = r_won_list.json().get("items", [])
    assert any(i["id"] == bm_id for i in won_items)


def test_adversarial_inputs_and_boundary_conditions(auth_client):
    """Adversarial search queries (Vietnamese diacritics, SQLi payloads, XSS, extreme prices, large page numbers)."""
    adversarial_keywords = [
        "Hệ thống giám sát trạm bơm Đắk Nông & Bà Rịa - Vũng Tàu",
        "' OR '1'='1' --",
        "<script>alert('xss')</script>",
        "'; DROP TABLE bidding_bookmarks; --",
        "   \t\n   SCADA   \r\n   ",
        "!@#$%^&*()_+{}[]:;\"'<>?,./",
    ]
    for kw in adversarial_keywords:
        r = auth_client.get("/api/bidding/search", params={"keyword": kw})
        assert r.status_code == 200, f"Failed for keyword: {kw}, code: {r.status_code}"
        assert isinstance(r.json().get("items"), list)

    # Extreme price boundaries
    r_extreme = auth_client.get("/api/bidding/search", params={"min_price": 0, "max_price": 10_000_000_000_000})
    assert r_extreme.status_code == 200

    # Out-of-bounds page
    r_page = auth_client.get("/api/bidding/search", params={"page": 9999, "page_size": 10})
    assert r_page.status_code == 200
    assert r_page.json().get("items") == []


def test_bidding_dossier_reviews_list_and_detail(auth_client):
    """Test listing seeded dossier reviews and retrieving deep detail with 9 files and 18 items."""
    r = auth_client.get("/api/bidding/dossier-reviews")
    assert r.status_code == 200
    items = r.json()
    assert isinstance(items, list)
    assert len(items) >= 1
    
    first = items[0]
    assert first["tbmt_code"] == "IB2600557773"
    assert "Bản Mòn" in first["package_name"]
    assert "Sơn La" in first["procuring_entity"]
    assert first["contractor_tax_code"] == "5500649200"
    assert first["overall_score"] == 96
    assert first["total_bid_price"] == 1194900000.0
    assert len(first["recommendations"]) >= 3
    
    # Detail endpoint
    r_detail = auth_client.get(f"/api/bidding/dossier-reviews/{first['id']}")
    assert r_detail.status_code == 200
    detail = r_detail.json()
    assert detail["id"] == first["id"]
    assert len(detail["files"]) == 9
    assert len(detail["items"]) == 18
    
    # Verify specific file evaluations
    f6 = next(f for f in detail["files"] if f["file_code"] == "06")
    assert f6["compliance_status"] == "fail"
    assert "placeholder" in f6["critical_risks"].lower()
    
    # Verify specific items evaluation
    it4 = next(it for it in detail["items"] if it["item_no"] == 4)
    assert "iNut RS485" in it4["proposed_model"]
    assert it4["inut_role"] == "Nhà sản xuất OEM"
    assert it4["compliance_status"] == "clarification_needed"
    
    it18 = next(it for it in detail["items"] if it["item_no"] == 18)
    assert it18["total_price"] == 302400000.0
    assert it18["compliance_status"] == "compliant"


def test_bidding_dossier_reviews_import_drive_and_export_markdown(auth_client):
    """Test importing dossier from Google Drive and exporting comprehensive Markdown report."""
    # Import from Drive
    r_import = auth_client.post("/api/bidding/dossier-reviews/import-drive", json={
        "drive_url": "https://drive.google.com/drive/folders/1l17rxMHd4-B988GJ3cwIBmFGCC3oazHV",
        "custom_notes": "Thẩm định thầu Sơn La cho anh Thắng",
    })
    assert r_import.status_code == 200
    data = r_import.json()
    assert data["ok"] is True
    rev_id = data["review_id"]
    
    # Export Markdown
    r_export = auth_client.get(f"/api/bidding/dossier-reviews/{rev_id}/export-markdown")
    assert r_export.status_code == 200
    assert "text/markdown" in r_export.headers["content-type"]
    md_text = r_export.text
    assert "BẢN BÁO CÁO CHIẾN LƯỢC THẨM ĐỊNH HỒ SƠ DỰ THẦU" in md_text
    assert "IB2600557773" in md_text
    assert "5500649200" in md_text
    assert "1.194.900.000" in md_text
    assert "MA TRẬN ĐỐI CHIẾU KỸ THUẬT" in md_text
    assert "iNut Smartcity Data Logger v2" in md_text
    assert "HCRZ-LD100-A2" in md_text

