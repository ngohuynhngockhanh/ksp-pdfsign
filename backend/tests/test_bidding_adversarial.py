"""Adversarial stress-test suite for Bidding Module backend.

Tests:
1. Adversarial query payloads (SQLi, XSS, unicode, emojis, control chars, path traversal)
2. Boundary price values (0 VND, negative, max float/int, inverted min > max)
3. State machine integrity (all valid transitions, invalid status rejection with 422)
4. Watchlist scan duplicate suppression & alert deduplication
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app import bidding, db, telegram
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
    """Set up isolated db for each test without tmpdir collision."""
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
def auth_client(monkeypatch):
    """Isolated test client with admin auth."""
    monkeypatch.setenv("APP_ADMIN_PASSWORD", "NhapHang123@")
    get_settings.cache_clear()
    from app.auth import ensure_admin_seed
    gen = db.get_session()
    s = next(gen)
    ensure_admin_seed(s, get_settings())
    gen.close()

    c = TestClient(app)
    r = c.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})
    assert r.status_code == 200
    return c


# ==============================================================================
# 1. Adversarial Query Payloads
# ==============================================================================

ADVERSARIAL_PAYLOADS = [
    # SQL Injections
    "' OR '1'='1",
    "'; DROP TABLE bidding_bookmarks; --",
    "' UNION SELECT null, null, null, null, null--",
    "admin'--",
    "1' OR 1=1--",
    "1; SELECT pg_sleep(5);--",
    "1' WAITFOR DELAY '0:0:5'--",
    # XSS Payloads
    "<script>alert('xss')</script>",
    '"><img src=x onerror=alert(1)>',
    "<svg/onload=alert(1)>",
    "javascript:alert(document.cookie)",
    "'\"><script src=//evil.com/x.js></script>",
    # Complex Unicode / Diacritics / RTL / Homoglyphs / Zero-width
    "Đắk Lắk 🏢⚡💻 ﷽",
    "\u202e\u200b\ufeff\u200eHồ Chí Minh\u200b",
    "Tự động hóa & SCADA (Hà Nội - Đắk Nông - Bà Rịa - Vũng Tàu)",
    "𝓤𝓷𝓲𝓬𝓸𝓭𝓮 𝓕𝓸𝓷𝓽 𝕋𝕖𝕤𝕥 ⚡️🔥",
    "NULL\x00BYTE\r\nCRLF",
    # Special & Regex Metacharacters
    "%",
    "_",
    ".*",
    "[a-z]+",
    "^IB.*-00$",
    "\\",
    "///",
    "../../../../etc/passwd",
    "$$foo$$",
]


@pytest.mark.parametrize("payload", ADVERSARIAL_PAYLOADS)
def test_adversarial_search_api_payloads(auth_client: TestClient, payload: str):
    """Verify search API handles extreme adversarial strings without crashing or 500 error."""
    # Keyword search
    r = auth_client.get("/api/bidding/search", params={"keyword": payload})
    assert r.status_code == 200, f"Failed on keyword payload: {payload}, resp: {r.text}"
    data = r.json()
    assert "items" in data
    assert isinstance(data["items"], list)

    # Province search
    r_prov = auth_client.get("/api/bidding/search", params={"province": payload})
    assert r_prov.status_code == 200, f"Failed on province payload: {payload}"

    # Field search
    r_field = auth_client.get("/api/bidding/search", params={"field": payload})
    assert r_field.status_code == 200, f"Failed on field payload: {payload}"


@pytest.mark.parametrize("payload", ADVERSARIAL_PAYLOADS)
def test_adversarial_bookmark_search_and_injection(auth_client: TestClient, payload: str):
    """Verify bookmark listing and DB filtering resist SQL injection and special chars."""
    gen = db.get_session()
    s = next(gen)

    # Seed a bookmark
    bidding.create_bookmark(s, {
        "tbmt_code": "IB2600001001-00",
        "tender_name": "Cung cấp hệ thống SCADA trạm bơm",
        "procuring_entity": "Sở Nông nghiệp",
        "field": "HH",
        "status": "watching",
    })

    # Search with payload via ORM helper
    items, total = bidding.list_bookmarks(s, search=payload)
    assert isinstance(items, list)
    assert isinstance(total, int)

    # Search with payload via API
    r = auth_client.get("/api/bidding/bookmarks", params={"search": payload})
    assert r.status_code == 200
    res_data = r.json()
    assert "items" in res_data
    assert "total" in res_data
    gen.close()


def test_adversarial_bookmark_creation_with_xss_and_unicode(auth_client: TestClient):
    """Verify bookmark creation safely stores and retrieves XSS / Unicode strings."""
    xss_name = "<script>alert('xss')</script> Gói thầu SCADA ⚡"
    xss_note = "<img src=x onerror=alert(1)> <b>Ghi chú nội bộ</b>"
    payload = {
        "tbmt_code": "IB2699990001-00",
        "tender_name": xss_name,
        "procuring_entity": "Sở TN&MT 🏢",
        "note": xss_note,
        "status": "watching",
    }
    r = auth_client.post("/api/bidding/bookmarks", json=payload)
    assert r.status_code == 201
    created = r.json()
    assert created["tender_name"] == xss_name
    assert created["note"] == xss_note

    # Retrieve and verify exact match
    r_get = auth_client.get(f"/api/bidding/bookmarks/{created['id']}")
    assert r_get.status_code == 200
    assert r_get.json()["tender_name"] == xss_name


# ==============================================================================
# 2. Boundary Price Values
# ==============================================================================

def test_price_formatting_boundaries():
    """Verify format_currency_vnd handles boundary, zero, negative, and extreme floats."""
    assert bidding.format_currency_vnd(0) == "0"
    assert bidding.format_currency_vnd(0.0) == "0"
    assert bidding.format_currency_vnd(None) == "0"
    assert bidding.format_currency_vnd(-500000) == "-500.000"
    assert bidding.format_currency_vnd(100_000_000_000) == "100.000.000.000"
    assert bidding.format_currency_vnd(5_432_100_000.6) == "5.432.100.001"
    assert bidding.format_currency_vnd(5_432_100_001.5) == "5.432.100.002"
    assert bidding.format_currency_vnd("invalid_price") == "0"


def test_search_price_boundaries(auth_client: TestClient):
    """Test boundary prices in search API."""
    # 0 VND
    r = auth_client.get("/api/bidding/search", params={"min_price": 0, "max_price": 0})
    assert r.status_code == 200

    # Negative price values (should not crash)
    r_neg = auth_client.get("/api/bidding/search", params={"min_price": -1000000, "max_price": -500})
    assert r_neg.status_code == 200

    # Max 64-bit integer
    max_int64 = 9223372036854775807
    r_huge = auth_client.get("/api/bidding/search", params={"min_price": 1000, "max_price": max_int64})
    assert r_huge.status_code == 200

    # Inverted min > max price: MUST return HTTP 400 Bad Request
    r_inv = auth_client.get("/api/bidding/search", params={"min_price": 5000000000.0, "max_price": 1000000000.0})
    assert r_inv.status_code == 400
    assert "Giá tối thiểu không được lớn hơn giá tối đa" in r_inv.json()["detail"]


# ==============================================================================
# 3. State Machine Integrity
# ==============================================================================

VALID_STATUSES = ["watching", "preparing", "submitted", "won", "lost"]
INVALID_STATUSES = ["deleted", "invalid_status", "PENDING", "ACTIVE", "<script>", "   "]


def test_bookmark_state_machine_valid_transitions(auth_client: TestClient):
    """Verify all valid status transitions for BiddingBookmark."""
    # Create initial bookmark (watching)
    r_create = auth_client.post("/api/bidding/bookmarks", json={
        "tbmt_code": "IB2600001001-00",
        "tender_name": "Gói thầu thử nghiệm pipeline",
        "status": "watching",
    })
    assert r_create.status_code == 201
    bm_id = r_create.json()["id"]

    # Test transitioning through all valid statuses forward and backward
    transition_sequence = ["preparing", "submitted", "won", "preparing", "lost", "watching"]
    for st in transition_sequence:
        r_update = auth_client.put(f"/api/bidding/bookmarks/{bm_id}", json={"status": st})
        assert r_update.status_code == 200
        assert r_update.json()["status"] == st


@pytest.mark.parametrize("invalid_status", INVALID_STATUSES)
def test_bookmark_state_machine_invalid_status_rejection_create(auth_client: TestClient, invalid_status: str):
    """Verify invalid status is rejected with HTTP 422 on creation."""
    r = auth_client.post("/api/bidding/bookmarks", json={
        "tbmt_code": "IB2600001001-00",
        "tender_name": "Gói thầu test invalid status",
        "status": invalid_status,
    })
    assert r.status_code == 422


@pytest.mark.parametrize("invalid_status", INVALID_STATUSES + [""])
def test_bookmark_state_machine_invalid_status_rejection_update(auth_client: TestClient, invalid_status: str):
    """Verify invalid status is rejected with HTTP 422 on update."""
    r_create = auth_client.post("/api/bidding/bookmarks", json={
        "tbmt_code": "IB2600001001-00",
        "tender_name": "Gói thầu test invalid status",
        "status": "watching",
    })
    bm_id = r_create.json()["id"]

    r_update = auth_client.put(f"/api/bidding/bookmarks/{bm_id}", json={"status": invalid_status})
    assert r_update.status_code == 422


# ==============================================================================
# 4. Watchlist Scan Duplicate Suppression
# ==============================================================================

def test_watchlist_scan_duplicate_suppression_and_telegram_dedup(monkeypatch):
    """Verify repeated watchlist scans never create duplicate alert records or send duplicate Telegram messages."""
    gen = db.get_session()
    s = next(gen)

    # 1. Setup Telegram config and admin connection
    settings = get_settings()
    settings.telegram_bot_token = "mock_bot_token_12345"

    from app.auth import ensure_admin_seed
    ensure_admin_seed(s, settings)
    admin_user = s.scalar(select(User).where(User.username == "admin"))
    assert admin_user is not None

    admin_conn = TelegramConnection(
        user_id=admin_user.id,
        chat_id="123456789",
        status="active",
    )
    s.add(admin_conn)
    s.commit()

    # Track Telegram sent messages
    sent_messages: list[tuple[str, str]] = []

    class MockTelegramClient:
        def __init__(self, s):
            pass
        def send_message(self, chat_id, text, **kwargs):
            sent_messages.append((str(chat_id), text))
            return {"ok": True}
        def close(self):
            pass

    monkeypatch.setattr(telegram, "TelegramClient", MockTelegramClient)
    monkeypatch.setattr(telegram, "is_configured", lambda s: True)

    # 2. Create active Watchlist matching Mock tenders
    wl = bidding.create_watchlist(s, {
        "name": "SCADA & IoT Miền Nam",
        "keyword": "SCADA",
        "notify_telegram": True,
        "is_active": True,
    })

    # 3. FIRST SCAN -> Should find matching tenders, create alert logs, and send Telegram messages
    scan_1 = bidding.run_watchlist_scan(s, settings, watchlist_id=wl.id)
    assert scan_1["watchlists_scanned"] == 1
    assert scan_1["new_tenders_found"] > 0
    assert scan_1["alerts_sent"] == scan_1["new_tenders_found"]
    first_scan_tenders_count = scan_1["new_tenders_found"]
    first_scan_telegram_count = len(sent_messages)
    assert first_scan_telegram_count == first_scan_tenders_count

    # Check alert logs in DB
    logs_count_1 = s.scalar(select(func.count(BiddingAlertLog.id)).where(BiddingAlertLog.watchlist_id == wl.id))
    assert logs_count_1 == first_scan_tenders_count

    # 4. SECOND SCAN IMMEDIATELY AFTER -> MUST SUPPRESS ALL DUPLICATES (0 new alerts, 0 telegram messages sent)
    scan_2 = bidding.run_watchlist_scan(s, settings, watchlist_id=wl.id)
    assert scan_2["watchlists_scanned"] == 1
    assert scan_2["new_tenders_found"] == 0, f"Expected 0 new tenders on 2nd scan, got {scan_2['new_tenders_found']}"
    assert scan_2["alerts_sent"] == 0, f"Expected 0 alerts sent on 2nd scan, got {scan_2['alerts_sent']}"
    assert len(sent_messages) == first_scan_telegram_count, "Duplicate Telegram messages were sent!"

    logs_count_2 = s.scalar(select(func.count(BiddingAlertLog.id)).where(BiddingAlertLog.watchlist_id == wl.id))
    assert logs_count_2 == logs_count_1, "Duplicate BiddingAlertLog records were created in DB!"

    # 5. THIRD SCAN via API -> MUST ALSO RETURN 0 NEW ALERTS
    auth_c = TestClient(app)
    r_login = auth_c.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})
    assert r_login.status_code == 200

    r_api_scan = auth_c.post(f"/api/bidding/watchlist/{wl.id}/scan")
    assert r_api_scan.status_code == 200
    api_scan_data = r_api_scan.json()
    assert api_scan_data["new_tenders_found"] == 0
    assert api_scan_data["alerts_sent"] == 0
    assert len(sent_messages) == first_scan_telegram_count

    gen.close()
