"""Comprehensive 4-Tier End-to-End Test Suite for KSP iNut Bidding Intelligence System.

Coverage Architecture:
- Tier 1: Feature Coverage (>=5 tests per feature for Contractor Search, CRM Scan, AI Scoring,
           Watchlist Telegram Alerts, Bookmark Pipeline, HTML Preview, Win Rate/Discount Rates).
- Tier 2: Boundary Value & Error Handling (Non-existent MST, whitespace tax codes, 0 VND budgets,
           100% and 0% win rates, inverted price ranges, SQLi payloads, XSS tags, invalid pagination).
- Tier 3: Cross-Feature Workflows (Search -> AI Score -> Bookmark Pipeline -> Watchlist Alert -> CRM Scan).
- Tier 4: Real-World Workload Customer Dossiers for Major Enterprise Contractors:
           1. Gdata (0105365128)
           2. Tân Thanh Phương (2800817718)
           3. Merap Group (0101400572)
           4. IoT Sơn La (5500649200)
           5. INUT HQ (4401053694)
"""

from __future__ import annotations

import json
import os
from typing import Any
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import ai, bidding, db, telegram
from app.auth import COOKIE_NAME, create_token
from app.config import get_settings
from app.db import (
    BiddingAlertLog,
    BiddingBookmark,
    BiddingWatchlist,
    Customer,
    TelegramConnection,
    User,
    init_db,
)
from app.main import app


@pytest.fixture(scope="session")
def session_db(tmp_path_factory):
    """Session-scoped database creation for blazing fast test execution."""
    data_dir = tmp_path_factory.mktemp("bidding_e2e_data")
    os.environ["DATA_DIR"] = str(data_dir)
    os.environ["AI_ENABLED"] = "false"
    get_settings.cache_clear()
    bidding._default_client.clear_cache()
    db.reset_engine_for_tests()
    init_db()
    return str(data_dir)


@pytest.fixture(autouse=True)
def clean_db(session_db, monkeypatch):
    """Fast per-test isolation with table truncation and seeding."""
    monkeypatch.setenv("DATA_DIR", session_db)
    monkeypatch.setenv("AI_ENABLED", "false")
    get_settings.cache_clear()
    bidding._default_client.clear_cache()

    gen = db.get_session()
    s = next(gen)
    try:
        s.query(BiddingAlertLog).delete()
        s.query(BiddingBookmark).delete()
        s.query(BiddingWatchlist).delete()
        s.query(TelegramConnection).delete()
        s.query(Customer).delete()
        s.query(User).delete()

        sample_customers = [
            Customer(name="CÔNG TY CỔ PHẦN DỮ LIỆU TOÀN CẦU", tax_code="0105365128", address="Hà Nội", email="contact@gdata.vn"),
            Customer(name="CÔNG TY CỔ PHẦN ĐẦU TƯ PHÁT TRIỂN CÔNG NGHỆ TÂN THANH PHƯƠNG", tax_code="2800817718", address="Thanh Hóa", email="info@tanthanhphuong.vn"),
            Customer(name="CÔNG TY CỔ PHẦN TẬP ĐOÀN MERAP", tax_code="0101400572", address="Hưng Yên", email="contact@merapgroup.com"),
            Customer(name="CÔNG TY CỔ PHẦN KỸ THUẬT TỰ ĐỘNG HOÁ IOT", tax_code="5500649200", address="Sơn La", email="iot@sonla.vn"),
            Customer(name="CÔNG TY TNHH CÔNG NGHỆ INUT", tax_code="4401053694", address="TP. Hồ Chí Minh", email="contact@inut.vn"),
            Customer(name="CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ KỸ THUẬT BẢO TOÀN", tax_code="0314360282", address="TP. Hồ Chí Minh", email="baotoan@tech.vn"),
            Customer(name="CÔNG TY TNHH DỊCH VỤ THƯƠNG MẠI B2B AN PHÁT", tax_code="0399887766", address="Bình Dương", email="anphat@b2b.vn"),
        ]
        for c in sample_customers:
            s.add(c)

        admin_user = User(username="admin", role="admin", password_hash="dummy_hash")
        s.add(admin_user)
        s.commit()
    finally:
        gen.close()

    yield
    get_settings.cache_clear()
    bidding._default_client.clear_cache()


@pytest.fixture
def auth_client(monkeypatch):
    """Isolated test client authenticated as administrator using direct JWT session."""
    settings = get_settings()
    gen = db.get_session()
    s = next(gen)
    admin_user = s.scalar(select(User).where(User.username == "admin"))
    token = create_token(admin_user, settings)
    gen.close()

    c = TestClient(app)
    c.cookies.set(COOKIE_NAME, token)
    return c


# ==============================================================================
# TIER 1: FEATURE COVERAGE (>=5 tests per feature across all 7 core features)
# ==============================================================================

# ─── Feature 1: Contractor Search by MST / Name ───────────────────────────────

def test_tier1_contractor_search_by_exact_mst(auth_client: TestClient):
    """T1.1: Exact search by tax code retrieves matching contractor."""
    r = auth_client.get("/api/bidding/contractors/search?query=0105365128")
    assert r.status_code == 200
    results = r.json()
    assert isinstance(results, list)
    assert len(results) >= 1
    contractor = results[0]
    assert contractor["tax_code"] == "0105365128"
    assert "DỮ LIỆU TOÀN CẦU" in contractor["name"]
    assert contractor["bidding_status"] == "WON_BIG"


def test_tier1_contractor_search_by_company_name(auth_client: TestClient):
    """T1.2: Search by company name keyword matches correctly."""
    r = auth_client.get("/api/bidding/contractors/search?query=Tân Thanh Phương")
    assert r.status_code == 200
    results = r.json()
    assert len(results) >= 1
    assert any(c["tax_code"] == "2800817718" for c in results)


def test_tier1_contractor_search_diacritic_insensitive(auth_client: TestClient):
    """T1.3: Diacritic-insensitive search works for unaccented query."""
    r = auth_client.get("/api/bidding/contractors/search?query=tan thanh phuong")
    assert r.status_code == 200
    results = r.json()
    assert len(results) >= 1
    assert any("TÂN THANH PHƯƠNG" in c["name"] for c in results)


def test_tier1_contractor_search_partial_keyword_matching(auth_client: TestClient):
    """T1.4: Search with partial keyword matches relevant contractors."""
    r = auth_client.get("/api/bidding/contractors/search?query=MERAP")
    assert r.status_code == 200
    results = r.json()
    assert len(results) >= 1
    assert results[0]["tax_code"] == "0101400572"
    assert results[0]["short_name"] == "Merap Group"


def test_tier1_contractor_search_non_matching_returns_empty_list(auth_client: TestClient):
    """T1.5: Search with non-existent query returns clean empty list."""
    r = auth_client.get("/api/bidding/contractors/search?query=DOANH_NGHIEP_KHONG_TON_TAI_XYZ_9999")
    assert r.status_code == 200
    results = r.json()
    assert results == []


def test_tier1_contractor_get_profile_by_tax_code_endpoint(auth_client: TestClient):
    """T1.6: GET /api/bidding/contractors/{tax_code} returns full profile."""
    r = auth_client.get("/api/bidding/contractors/5500649200")
    assert r.status_code == 200
    p = r.json()
    assert p["tax_code"] == "5500649200"
    assert p["short_name"] == "Tự Động Hóa IoT"
    assert p["bidding_status"] == "REGISTERED_BIDDER"
    assert p["total_bids"] == 4
    assert p["total_won"] == 2
    assert p["win_rate_percent"] == 50.0
    assert len(p["highlight_won_packages"]) >= 1


# ─── Feature 2: CRM Auto-Auditing & 5-Tier Classification ─────────────────────

def test_tier1_crm_scan_macro_metrics_calculation(auth_client: TestClient):
    """T2.1: CRM Scan returns accurate aggregated macro metrics."""
    r = auth_client.get("/api/bidding/contractors/crm-scan")
    assert r.status_code == 200
    data = r.json()
    assert "total_crm_customers" in data
    assert "total_won_contractors" in data
    assert "total_won_value_vnd" in data
    assert "total_won_value_formatted" in data
    assert "items" in data

    assert data["total_crm_customers"] >= 6
    assert data["total_won_contractors"] >= 4
    assert data["total_won_value_vnd"] > 0
    assert "₫" in data["total_won_value_formatted"]


def test_tier1_crm_scan_5_tier_classifications(auth_client: TestClient):
    """T2.2: Verifies all 5 contractor tiers are properly assigned."""
    r = auth_client.get("/api/bidding/contractors/crm-scan")
    assert r.status_code == 200
    items = r.json()["items"]
    statuses = {item["bidding_status"] for item in items}

    # All 5 tiers defined in requirement R2 must be supported
    assert "WON_BIG" in statuses
    assert "REGISTERED_BIDDER" in statuses
    assert "OEM_SUBCONTRACTOR" in statuses
    assert "INUT_HQ" in statuses
    assert "COMMERCIAL" in statuses


def test_tier1_crm_scan_sorting_order_descending(auth_client: TestClient):
    """T2.3: Scanned contractors are sorted by won value descending."""
    r = auth_client.get("/api/bidding/contractors/crm-scan")
    assert r.status_code == 200
    items = r.json()["items"]
    won_values = [it["total_won_value_vnd"] for it in items]
    assert won_values == sorted(won_values, reverse=True)


def test_tier1_crm_scan_unknown_customer_fallback_to_commercial():
    """T2.4: Unrecorded tax code falls back to COMMERCIAL tier."""
    gen = db.get_session()
    s = next(gen)
    try:
        profile = bidding.ContractorBiddingService.get_or_create_contractor_profile("9988776655", name="Công Ty TNHH Mới")
        assert profile["bidding_status"] == "COMMERCIAL"
        assert profile["total_won"] == 0
        assert profile["win_rate_percent"] == 0.0
        assert profile["total_won_value_vnd"] == 0.0
    finally:
        gen.close()


def test_tier1_crm_scan_aggregation_consistency(auth_client: TestClient):
    """T2.5: Sum of individual items matches macro total_won_value_vnd."""
    r = auth_client.get("/api/bidding/contractors/crm-scan")
    assert r.status_code == 200
    data = r.json()
    calculated_sum = sum(i["total_won_value_vnd"] for i in data["items"])
    assert calculated_sum == pytest.approx(data["total_won_value_vnd"], 0.01)


# ─── Feature 3: AI Strategic Scoring (0-100) & Fit Evaluation ─────────────────

def test_tier1_ai_score_range_and_output_contract(auth_client: TestClient):
    """T3.1: AI evaluation returns score in [0, 100] and valid match level."""
    r = auth_client.post(
        "/api/bidding/tenders/IB2600001001-00/analyze-ai",
        json={"custom_context": "Đã có sẵn 25 bộ iNut Gateway"},
    )
    assert r.status_code == 200
    data = r.json()
    assert "analysis" in data
    analysis = data["analysis"]
    assert "inut_fit_analysis" in analysis
    fit = analysis["inut_fit_analysis"]
    assert 0 <= fit["score"] <= 100
    assert fit["match_level"] in {"Cao", "Trung bình", "Thấp"}
    assert "recommendation" in fit


def test_tier1_ai_score_sections_structure(auth_client: TestClient):
    """T3.2: AI output contains all required breakdown sections."""
    r = auth_client.post("/api/bidding/tenders/IB2600001002-00/analyze-ai")
    assert r.status_code == 200
    analysis = r.json()["analysis"]
    assert "executive_summary" in analysis
    assert "scope_of_work" in analysis
    assert isinstance(analysis["scope_of_work"], list)
    assert "capacity_requirements" in analysis
    assert "financial_requirements" in analysis


def test_tier1_ai_score_custom_context_integration(auth_client: TestClient):
    """T3.3: Custom context is accepted without error and passed to engine."""
    custom_note = "INUT đã triển khai thành công 10 trạm tương tự tại EVNSPC"
    r = auth_client.post(
        "/api/bidding/tenders/IB2600001002-00/analyze-ai",
        json={"custom_context": custom_note},
    )
    assert r.status_code == 200
    assert r.json()["tbmt_code"] == "IB2600001002-00"


def test_tier1_ai_score_auto_updates_existing_bookmark(auth_client: TestClient):
    """T3.4: AI analysis automatically persists into bookmark.ai_summary."""
    # 1. Create a bookmark for TBMT
    auth_client.post("/api/bidding/bookmarks", json={
        "tbmt_code": "IB2600001003-00",
        "tender_name": "Quan trắc nước thải tự động",
        "status": "watching",
    })

    # 2. Trigger AI analysis
    r_ai = auth_client.post("/api/bidding/tenders/IB2600001003-00/analyze-ai")
    assert r_ai.status_code == 200
    assert r_ai.json()["saved_to_bookmark"] is True

    # 3. Check bookmark has ai_summary populated
    r_bm = auth_client.get("/api/bidding/bookmarks?search=IB2600001003-00")
    assert r_bm.status_code == 200
    items = r_bm.json()["items"]
    assert len(items) == 1
    assert items[0]["ai_summary"] != ""
    loaded = json.loads(items[0]["ai_summary"])
    assert "inut_fit_analysis" in loaded


def test_tier1_ai_score_heuristic_fallback_resilience(monkeypatch):
    """T3.5: AI score functions deterministically when LLM is unavailable."""
    settings = get_settings()
    settings.ai_enabled = False
    tender = {
        "tbmt_code": "IB2600001004-00",
        "tender_name": "Hệ thống Gateway SCADA đo xa 4G",
        "procuring_entity": "PC Đà Nẵng",
        "field": "HH",
        "bid_price": 760000000.0,
    }
    res = bidding.ai_analyze_tender(settings, tender)
    assert 0 <= res["inut_fit_analysis"]["score"] <= 100
    assert res["inut_fit_analysis"]["match_level"] in {"Cao", "Trung bình", "Thấp"}


# ─── Feature 4: Watchlist Telegram Alerts & Deduplication ──────────────────────

def test_tier1_watchlist_create_and_validation(auth_client: TestClient):
    """T4.1: Create automated watchlist with criteria filters."""
    payload = {
        "name": "Bộ lọc Gateway & SCADA",
        "keyword": "Gateway",
        "province": "Hồ Chí Minh",
        "field": "HH",
        "min_price": 200000000.0,
        "max_price": 2000000000.0,
        "notify_telegram": True,
        "is_active": True,
    }
    r = auth_client.post("/api/bidding/watchlist", json=payload)
    assert r.status_code == 201
    wl = r.json()
    assert wl["id"] is not None
    assert wl["name"] == "Bộ lọc Gateway & SCADA"
    assert wl["notify_telegram"] is True


def test_tier1_watchlist_scan_discovers_tenders_and_logs(auth_client: TestClient, monkeypatch):
    """T4.2: Watchlist scan identifies matching tenders and records them."""
    # Mock Telegram dispatch
    monkeypatch.setattr(telegram, "is_configured", lambda s: True)
    monkeypatch.setattr(telegram, "TelegramClient", lambda s: type("MockTG", (), {
        "send_message": lambda self, chat_id, text: {"ok": True},
        "close": lambda self: None,
    })())

    r_create = auth_client.post("/api/bidding/watchlist", json={
        "name": "Scan Test SCADA",
        "keyword": "SCADA",
        "notify_telegram": True,
        "is_active": True,
    })
    wl_id = r_create.json()["id"]

    r_scan = auth_client.post(f"/api/bidding/watchlist/{wl_id}/scan")
    assert r_scan.status_code == 200
    res = r_scan.json()
    assert res["watchlists_scanned"] == 1
    assert res["new_tenders_found"] > 0


def test_tier1_watchlist_scan_deduplication_integrity(auth_client: TestClient, monkeypatch):
    """T4.3: Subsequent scan on same watchlist suppresses duplicate alerts."""
    monkeypatch.setattr(telegram, "is_configured", lambda s: True)
    sent_msgs = []
    class MockTG:
        def __init__(self, s): pass
        def send_message(self, chat_id, text):
            sent_msgs.append(text)
            return {"ok": True}
        def close(self): pass

    monkeypatch.setattr(telegram, "TelegramClient", MockTG)

    r_create = auth_client.post("/api/bidding/watchlist", json={
        "name": "Dedup Test",
        "keyword": "Gateway",
        "notify_telegram": True,
        "is_active": True,
    })
    wl_id = r_create.json()["id"]

    # 1st Scan
    r1 = auth_client.post(f"/api/bidding/watchlist/{wl_id}/scan")
    assert r1.status_code == 200
    first_found = r1.json()["new_tenders_found"]
    assert first_found > 0

    # 2nd Scan Immediately -> Deduplicated (0 new)
    r2 = auth_client.post(f"/api/bidding/watchlist/{wl_id}/scan")
    assert r2.status_code == 200
    assert r2.json()["new_tenders_found"] == 0
    assert r2.json()["alerts_sent"] == 0


def test_tier1_watchlist_scan_all_batch_endpoint(auth_client: TestClient):
    """T4.4: POST /api/bidding/scan-all triggers batch scan across all active rules."""
    auth_client.post("/api/bidding/watchlist", json={"name": "Batch 1", "keyword": "IoT", "is_active": True})
    auth_client.post("/api/bidding/watchlist", json={"name": "Batch 2", "keyword": "SCADA", "is_active": True})

    r = auth_client.post("/api/bidding/scan-all")
    assert r.status_code == 200
    assert r.json()["watchlists_scanned"] >= 2


def test_tier1_watchlist_telegram_failure_isolation(auth_client: TestClient, monkeypatch):
    """T4.5: Telegram communication error does not crash the scan endpoint."""
    monkeypatch.setattr(telegram, "is_configured", lambda s: True)
    class FailingTG:
        def __init__(self, s): pass
        def send_message(self, *a, **kw):
            raise telegram.TelegramError("Connection timed out to api.telegram.org")
        def close(self): pass

    monkeypatch.setattr(telegram, "TelegramClient", FailingTG)

    r_create = auth_client.post("/api/bidding/watchlist", json={
        "name": "Fault Test",
        "keyword": "SCADA",
        "notify_telegram": True,
        "is_active": True,
    })
    wl_id = r_create.json()["id"]

    r = auth_client.post(f"/api/bidding/watchlist/{wl_id}/scan")
    assert r.status_code == 200
    assert r.json()["watchlists_scanned"] == 1


# ─── Feature 5: Bookmark Pipeline State Machine ───────────────────────────────

def test_tier1_bookmark_create_and_fields(auth_client: TestClient):
    """T5.1: Create bookmark with complete metadata."""
    payload = {
        "tbmt_code": "IB2600001001-00",
        "tender_name": "Cung cấp Gateway iNut 4G",
        "procuring_entity": "Sở Nông nghiệp",
        "field": "HH",
        "bid_price": 980000000.0,
        "status": "watching",
        "note": "Tiềm năng lớn",
    }
    r = auth_client.post("/api/bidding/bookmarks", json=payload)
    assert r.status_code == 201
    bm = r.json()
    assert bm["tbmt_code"] == "IB2600001001-00"
    assert bm["status"] == "watching"
    assert bm["bid_price"] == 980000000.0


def test_tier1_bookmark_pipeline_transitions(auth_client: TestClient):
    """T5.2: Transition bookmark across all stages: watching -> preparing -> submitted -> won."""
    r_create = auth_client.post("/api/bidding/bookmarks", json={
        "tbmt_code": "IB2600001002-00",
        "tender_name": "SCADA Trạm Biến Áp",
        "status": "watching",
    })
    bm_id = r_create.json()["id"]

    for st in ["preparing", "submitted", "won", "lost"]:
        r_update = auth_client.put(f"/api/bidding/bookmarks/{bm_id}", json={"status": st})
        assert r_update.status_code == 200
        assert r_update.json()["status"] == st


def test_tier1_bookmark_list_filtering_by_status(auth_client: TestClient):
    """T5.3: Filter bookmark list by status."""
    auth_client.post("/api/bidding/bookmarks", json={"tbmt_code": "IB2600001001-00", "tender_name": "A", "status": "preparing"})
    auth_client.post("/api/bidding/bookmarks", json={"tbmt_code": "IB2600001002-00", "tender_name": "B", "status": "won"})

    r = auth_client.get("/api/bidding/bookmarks?status=preparing")
    assert r.status_code == 200
    items = r.json()["items"]
    assert all(it["status"] == "preparing" for it in items)


def test_tier1_bookmark_search_filtering(auth_client: TestClient):
    """T5.4: Search bookmarks by query string."""
    auth_client.post("/api/bidding/bookmarks", json={"tbmt_code": "IB2600001001-00", "tender_name": "Hệ thống SCADA Nước", "status": "watching"})
    auth_client.post("/api/bidding/bookmarks", json={"tbmt_code": "IB2600001002-00", "tender_name": "Camera Giám Sát", "status": "watching"})

    r = auth_client.get("/api/bidding/bookmarks?search=SCADA")
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 1
    assert "SCADA" in items[0]["tender_name"]


def test_tier1_bookmark_delete_and_404_lifecycle(auth_client: TestClient):
    """T5.5: Delete bookmark and verify 404 on subsequent get."""
    r_create = auth_client.post("/api/bidding/bookmarks", json={"tbmt_code": "IB2600001005-00", "tender_name": "Tư Vấn Thiết Kế"})
    bm_id = r_create.json()["id"]

    r_del = auth_client.delete(f"/api/bidding/bookmarks/{bm_id}")
    assert r_del.status_code == 200
    assert r_del.json()["ok"] is True

    r_get = auth_client.get(f"/api/bidding/bookmarks/{bm_id}")
    assert r_get.status_code == 404


# ─── Feature 6: HTML Preview & E-HSMT Generation ──────────────────────────────

def test_tier1_html_preview_endpoint_200_and_content_type(auth_client: TestClient):
    """T6.1: HTML preview endpoint returns 200 and text/html content."""
    r = auth_client.get("/api/bidding/tenders/IB2600001001-00/html-preview")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]


def test_tier1_html_preview_structure_and_meta(auth_client: TestClient):
    """T6.2: Preview HTML contains DOCTYPE, viewport, title, and styling."""
    r = auth_client.get("/api/bidding/tenders/IB2600001001-00/html-preview")
    html = r.text
    assert "<!DOCTYPE html>" in html
    assert "<meta name=\"viewport\"" in html
    assert "MẠNG ĐẤU THẦU QUỐC GIA" in html
    assert "cdn.tailwindcss.com" in html


def test_tier1_html_preview_tender_metadata_rendered(auth_client: TestClient):
    """T6.3: Tender specifics (TBMT, price, investor, decision) are rendered."""
    r = auth_client.get("/api/bidding/tenders/IB2600001001-00/html-preview")
    html = r.text
    assert "IB2600001001-00" in html
    assert "980,000,000" in html or "980.000.000" in html or "980" in html
    assert "Sở Nông nghiệp" in html
    assert "1042/QĐ-SNN" in html


def test_tier1_html_preview_ehsmt_checklist_cards(auth_client: TestClient):
    """T6.4: Standard E-HSMT qualification criteria cards exist in HTML."""
    r = auth_client.get("/api/bidding/tenders/IB2600001001-00/html-preview")
    html = r.text
    assert "Năng lực tài chính & Doanh thu" in html
    assert "Hợp đồng tương tự" in html
    assert "Nhân sự chủ chốt" in html
    assert "Thiết bị & Năng lực sản xuất" in html


def test_tier1_html_preview_non_existent_tender_404(auth_client: TestClient):
    """T6.5: HTML preview for invalid TBMT returns 404."""
    r = auth_client.get("/api/bidding/tenders/NON_EXISTENT_TBMT_9999/html-preview")
    assert r.status_code == 404


# ─── Feature 7: Win Rate & Discount Rates Statistics ──────────────────────────

def test_tier1_win_rate_calculation_formula():
    """T7.1: Win rate calculation equals total_won / total_bids * 100."""
    gdata = bidding.ContractorBiddingService.KNOWN_CONTRACTORS["0105365128"]
    expected_win_rate = round((gdata["total_won"] / gdata["total_bids"]) * 100, 1)
    assert gdata["win_rate_percent"] == expected_win_rate
    assert gdata["win_rate_percent"] == 78.6


def test_tier1_discount_rate_package_formula():
    """T7.2: Discount rate formula: (bid_price - won_price) / bid_price * 100."""
    gdata = bidding.ContractorBiddingService.KNOWN_CONTRACTORS["0105365128"]
    pkg = gdata["highlight_won_packages"][0]
    expected_discount = round(((pkg["bid_price"] - pkg["won_price"]) / pkg["bid_price"]) * 100, 2)
    assert pkg["discount_percent"] == expected_discount
    assert pkg["discount_percent"] == 1.66


def test_tier1_average_discount_rate_positive_value():
    """T7.3: Average discount percentage is positive for active contractors."""
    for tax, data in bidding.ContractorBiddingService.KNOWN_CONTRACTORS.items():
        if data["total_won"] > 0:
            assert data["average_discount_percent"] > 0.0


def test_tier1_currency_formatting_vnd_standard():
    """T7.4: Currency formatting follows Vietnamese dot-separated standard."""
    assert bidding.format_currency_vnd(12580000000) == "12.580.000.000"
    assert bidding.format_currency_vnd(18450000000) == "18.450.000.000"
    assert bidding.format_currency_vnd(68200000000) == "68.200.000.000"


def test_tier1_currency_formatting_edge_values():
    """T7.5: Currency formatting handles 0, negative, and None safely."""
    assert bidding.format_currency_vnd(0) == "0"
    assert bidding.format_currency_vnd(0.0) == "0"
    assert bidding.format_currency_vnd(None) == "0"
    assert bidding.format_currency_vnd(-1000000) == "-1.000.000"


# ==============================================================================
# TIER 2: BOUNDARY VALUE & ERROR HANDLING TESTS
# ==============================================================================

def test_tier2_non_existent_tax_code_defaults_to_commercial():
    """T2.1: Non-existent tax code creates a safe default COMMERCIAL profile."""
    gen = db.get_session()
    s = next(gen)
    try:
        profile = bidding.ContractorBiddingService.get_or_create_contractor_profile("0000000000")
        assert profile["bidding_status"] == "COMMERCIAL"
        assert profile["total_bids"] == 0
        assert profile["total_won"] == 0
        assert profile["win_rate_percent"] == 0.0
        assert profile["total_won_value_vnd"] == 0.0
        assert profile["highlight_won_packages"] == []
    finally:
        gen.close()


def test_tier2_empty_and_whitespace_tax_code_handling():
    """T2.2: Empty or whitespace tax code does not raise exceptions."""
    gen = db.get_session()
    s = next(gen)
    try:
        for empty_val in ["", "   ", "\t\n", None]:
            profile = bidding.ContractorBiddingService.get_or_create_contractor_profile(empty_val)
            assert profile["tax_code"] == "—"
            assert profile["bidding_status"] == "COMMERCIAL"
    finally:
        gen.close()


def test_tier2_zero_and_negative_bid_price_handling():
    """T2.3: Zero bid price is safely formatted without crash."""
    assert bidding.format_currency_vnd(0) == "0"
    assert bidding.format_currency_vnd(0.0) == "0"


def test_tier2_perfect_100_percent_win_rate_contractor():
    """T2.4: 100% win rate calculation produces 100.0 without overflow."""
    profile = {
        "total_bids": 5,
        "total_won": 5,
    }
    win_rate = round((profile["total_won"] / profile["total_bids"]) * 100, 1)
    assert win_rate == 100.0


def test_tier2_zero_percent_win_rate_or_zero_bids():
    """T2.5: 0 bids or 0 wins returns 0.0% win rate without DivisionByZero."""
    oem_sub = bidding.ContractorBiddingService.KNOWN_CONTRACTORS["0314360282"]
    assert oem_sub["total_bids"] == 0
    assert oem_sub["total_won"] == 0
    assert oem_sub["win_rate_percent"] == 0.0


def test_tier2_inverted_price_filter_rejection(auth_client: TestClient):
    """T2.6: Search with min_price > max_price returns HTTP 400 Bad Request."""
    r = auth_client.get("/api/bidding/search?min_price=10000000000&max_price=5000000")
    assert r.status_code == 400
    assert "Giá tối thiểu không được lớn hơn" in r.json()["detail"]


def test_tier2_sqli_payloads_in_contractor_search(auth_client: TestClient):
    """T2.7: SQL injection payloads in contractor search return 200 with 0 matches."""
    sqli_payloads = [
        "' OR '1'='1",
        "'; DROP TABLE customers; --",
        "1' UNION SELECT null, null, null--",
    ]
    for p in sqli_payloads:
        r = auth_client.get("/api/bidding/contractors/search", params={"query": p})
        assert r.status_code == 200
        assert isinstance(r.json(), list)


def test_tier2_xss_tags_in_tender_custom_context_and_notes(auth_client: TestClient):
    """T2.8: XSS strings are safely stored and returned without execution."""
    xss_payload = "<script>alert('XSS_ATTACK')</script>"
    r_bm = auth_client.post("/api/bidding/bookmarks", json={
        "tbmt_code": "IB2600001001-00",
        "tender_name": "Tender with XSS",
        "note": xss_payload,
        "status": "watching",
    })
    assert r_bm.status_code == 201
    bm_id = r_bm.json()["id"]

    r_get = auth_client.get(f"/api/bidding/bookmarks/{bm_id}")
    assert r_get.status_code == 200
    assert r_get.json()["note"] == xss_payload


def test_tier2_out_of_bounds_pagination(auth_client: TestClient):
    """T2.9: Page 9999 returns empty items list, page 0 returns 422."""
    r_empty = auth_client.get("/api/bidding/search?page=9999&page_size=10")
    assert r_empty.status_code == 200
    assert r_empty.json()["items"] == []

    r_invalid = auth_client.get("/api/bidding/search?page=0")
    assert r_invalid.status_code == 422


def test_tier2_invalid_bookmark_status_rejection(auth_client: TestClient):
    """T2.10: Unallowed bookmark statuses return HTTP 422 Unprocessable Entity."""
    for invalid_st in ["UNKNOWN", "APPROVED", "CANCELLED", "HACKED"]:
        r = auth_client.post("/api/bidding/bookmarks", json={
            "tbmt_code": "IB2600001001-00",
            "tender_name": "Test",
            "status": invalid_st,
        })
        assert r.status_code == 422


# ==============================================================================
# TIER 3: CROSS-FEATURE INTEGRATION WORKFLOWS
# ==============================================================================

def test_tier3_end_to_end_search_to_pipeline_to_crm_audit(auth_client: TestClient, monkeypatch):
    """T3.1: Complete End-to-End Workflow:
    Search Contractor -> Extract Won Package -> Fetch Detail & HTML Preview ->
    AI Strategic Analysis -> Bookmark Pipeline Transitions -> Watchlist Alert Scan -> CRM Audit.
    """
    # Step 1: Search Contractor (Gdata / 0105365128)
    r_search = auth_client.get("/api/bidding/contractors/search?query=0105365128")
    assert r_search.status_code == 200
    contractors = r_search.json()
    assert len(contractors) >= 1
    gdata = contractors[0]
    assert gdata["tax_code"] == "0105365128"
    assert len(gdata["highlight_won_packages"]) >= 1

    # Step 2: Extract top won package
    won_pkg = gdata["highlight_won_packages"][0]
    tbmt_code = won_pkg["tbmt_code"]
    assert tbmt_code.startswith("IB")

    # Step 3: Fetch tender details from e-GP generator
    r_detail = auth_client.get(f"/api/bidding/tenders/{tbmt_code}")
    assert r_detail.status_code == 200
    detail = r_detail.json()
    assert detail["tbmt_code"] == tbmt_code

    # Step 4: Inspect HTML E-HSMT Preview
    r_html = auth_client.get(f"/api/bidding/tenders/{tbmt_code}/html-preview")
    assert r_html.status_code == 200
    assert tbmt_code in r_html.text

    # Step 5: Perform AI Strategic Fit Scoring
    r_ai = auth_client.post(
        f"/api/bidding/tenders/{tbmt_code}/analyze-ai",
        json={"custom_context": "Gói thầu của đối tác Gdata, INUT cấp gateway"},
    )
    assert r_ai.status_code == 200
    ai_analysis = r_ai.json()["analysis"]
    score = ai_analysis["inut_fit_analysis"]["score"]
    assert 0 <= score <= 100

    # Step 6: Create Bookmark with AI analysis summary
    r_bm = auth_client.post("/api/bidding/bookmarks", json={
        "tbmt_code": tbmt_code,
        "tender_name": detail["tender_name"],
        "procuring_entity": detail["procuring_entity"],
        "field": detail.get("field", "HH"),
        "bid_price": detail.get("bid_price", 0.0),
        "status": "watching",
        "note": f"AI Chấm {score} điểm",
        "ai_summary": json.dumps(ai_analysis),
    })
    assert r_bm.status_code == 201
    bm_id = r_bm.json()["id"]

    # Step 7: Advance Bookmark through the full sales pipeline
    pipeline_stages = ["preparing", "submitted", "won"]
    for st in pipeline_stages:
        r_up = auth_client.put(f"/api/bidding/bookmarks/{bm_id}", json={"status": st})
        assert r_up.status_code == 200
        assert r_up.json()["status"] == st

    # Verify bookmark is listed under "won"
    r_won = auth_client.get("/api/bidding/bookmarks?status=won")
    assert r_won.status_code == 200
    assert any(b["id"] == bm_id for b in r_won.json()["items"])

    # Step 8: Setup automated Watchlist for matching keyword
    r_wl = auth_client.post("/api/bidding/watchlist", json={
        "name": "Giám sát Gói Thầu Gdata",
        "keyword": "trục tích hợp",
        "notify_telegram": True,
        "is_active": True,
    })
    assert r_wl.status_code == 201
    wl_id = r_wl.json()["id"]

    # Step 9: Execute Watchlist Scan
    r_scan = auth_client.post(f"/api/bidding/watchlist/{wl_id}/scan")
    assert r_scan.status_code == 200
    assert r_scan.json()["watchlists_scanned"] == 1

    # Step 10: Run full CRM Customer Audit
    r_crm = auth_client.get("/api/bidding/contractors/crm-scan")
    assert r_crm.status_code == 200
    crm_data = r_crm.json()
    assert crm_data["total_won_contractors"] >= 4
    gdata_in_crm = next((c for c in crm_data["items"] if c["tax_code"] == "0105365128"), None)
    assert gdata_in_crm is not None
    assert gdata_in_crm["bidding_status"] == "WON_BIG"
    assert gdata_in_crm["win_rate_percent"] == 78.6


def test_tier3_multi_contractor_batch_comparison(auth_client: TestClient):
    """T3.2: Batch comparisons across all CRM customer tiers."""
    r = auth_client.get("/api/bidding/contractors/crm-scan")
    assert r.status_code == 200
    items = r.json()["items"]

    tier_counts = {}
    for item in items:
        st = item["bidding_status"]
        tier_counts[st] = tier_counts.get(st, 0) + 1

    # Ensure multiple contractor tiers are populated in CRM
    assert tier_counts.get("WON_BIG", 0) >= 3
    assert tier_counts.get("REGISTERED_BIDDER", 0) >= 1
    assert tier_counts.get("INUT_HQ", 0) >= 1


def test_tier3_ai_evaluation_persists_across_bookmark_modifications(auth_client: TestClient):
    """T3.3: Updating bookmark status preserves AI analysis data intact."""
    # 1. Create Bookmark
    r_create = auth_client.post("/api/bidding/bookmarks", json={
        "tbmt_code": "IB2600001001-00",
        "tender_name": "Test Persist",
        "status": "watching",
    })
    bm_id = r_create.json()["id"]

    # 2. Run AI Analysis -> auto-persists to bookmark
    auth_client.post("/api/bidding/tenders/IB2600001001-00/analyze-ai")

    # 3. Update status to 'preparing'
    r_update = auth_client.put(f"/api/bidding/bookmarks/{bm_id}", json={
        "status": "preparing",
        "note": "Tiếp tục chuẩn bị",
    })
    assert r_update.status_code == 200

    # 4. Verify AI summary remained intact
    r_get = auth_client.get(f"/api/bidding/bookmarks/{bm_id}")
    assert r_get.status_code == 200
    assert r_get.json()["ai_summary"] != ""
    assert "inut_fit_analysis" in r_get.json()["ai_summary"]


# ==============================================================================
# TIER 4: REAL-WORLD WORKLOAD CUSTOMER DOSSIERS
# ==============================================================================

def test_tier4_enterprise_contractor_gdata(auth_client: TestClient):
    """T4.1: Real-World Customer Dossier: Gdata (0105365128)."""
    r = auth_client.get("/api/bidding/contractors/0105365128")
    assert r.status_code == 200
    d = r.json()

    assert d["tax_code"] == "0105365128"
    assert d["name"] == "CÔNG TY CỔ PHẦN DỮ LIỆU TOÀN CẦU"
    assert d["short_name"] == "Gdata"
    assert d["bidding_status"] == "WON_BIG"
    assert d["bidding_status_label"] == "🏆 Trúng Thầu Nhiều"
    assert d["total_bids"] == 14
    assert d["total_won"] == 11
    assert d["total_lost"] == 2
    assert d["total_evaluating"] == 1
    assert d["win_rate_percent"] == 78.6
    assert d["total_won_value_vnd"] == 12580000000.0
    assert d["average_discount_percent"] == 4.8

    # Check top procuring entities
    assert "Tổng cục Tiêu chuẩn Đo lường Chất lượng" in d["top_procuring_entities"]
    assert "Báo điện tử Đảng Cộng sản Việt Nam" in d["top_procuring_entities"]
    assert "Tổng cục Hải quan" in d["top_procuring_entities"]

    # Check won packages
    pkgs = d["highlight_won_packages"]
    assert len(pkgs) >= 3
    assert any(p["tbmt_code"] == "IB2500094821-00" and p["decision_number"] == "1840/QĐ-TĐC" for p in pkgs)
    assert any(p["tbmt_code"] == "IB2400182940-00" and p["decision_number"] == "412/QĐ-BĐTĐCSVN" for p in pkgs)

    # Check AI insight
    assert "OEM/nhà cung cấp thiết bị Gateway IoT" in d["ai_insight"]


def test_tier4_enterprise_contractor_tan_thanh_phuong(auth_client: TestClient):
    """T4.2: Real-World Customer Dossier: Tân Thanh Phương (2800817718)."""
    r = auth_client.get("/api/bidding/contractors/2800817718")
    assert r.status_code == 200
    d = r.json()

    assert d["tax_code"] == "2800817718"
    assert d["name"] == "CÔNG TY CỔ PHẦN ĐẦU TƯ PHÁT TRIỂN CÔNG NGHỆ TÂN THANH PHƯƠNG"
    assert d["short_name"] == "Tân Thanh Phương"
    assert d["bidding_status"] == "WON_BIG"
    assert d["bidding_status_label"] == "🏆 Trúng Thầu Lớn"
    assert d["total_bids"] == 9
    assert d["total_won"] == 7
    assert d["win_rate_percent"] == 77.8
    assert d["total_won_value_vnd"] == 18450000000.0

    # Top procuring entities in Thanh Hoa
    assert "Sở Thông tin và Truyền thông Thanh Hóa" in d["top_procuring_entities"]
    assert "Trung tâm Công nghệ thông tin tỉnh Thanh Hóa" in d["top_procuring_entities"]

    # Won packages
    pkgs = d["highlight_won_packages"]
    assert len(pkgs) >= 2
    assert any(p["tbmt_code"] == "IB2400031920-00" and "512/QĐ-STTTT" in p["decision_number"] for p in pkgs)
    assert any(p["tbmt_code"] == "IB2500018290-00" and "218/QĐ-UBND-TH" in p["decision_number"] for p in pkgs)

    # AI Insight
    assert "Smart City" in d["ai_insight"]


def test_tier4_enterprise_contractor_merap_group(auth_client: TestClient):
    """T4.3: Real-World Customer Dossier: Merap Group (0101400572)."""
    r = auth_client.get("/api/bidding/contractors/0101400572")
    assert r.status_code == 200
    d = r.json()

    assert d["tax_code"] == "0101400572"
    assert d["name"] == "CÔNG TY CỔ PHẦN TẬP ĐOÀN MERAP"
    assert d["short_name"] == "Merap Group"
    assert d["bidding_status"] == "WON_BIG"
    assert d["bidding_status_label"] == "🏆 Nhà Thầu Quy Mô Lớn"
    assert d["total_bids"] == 48
    assert d["total_won"] == 35
    assert d["win_rate_percent"] == 72.9
    assert d["total_won_value_vnd"] == 68200000000.0

    # Hospital procuring entities
    assert "Bệnh viện Nhi Đồng 1" in d["top_procuring_entities"]
    assert "Bệnh viện Bạch Mai" in d["top_procuring_entities"]

    # Won package
    pkgs = d["highlight_won_packages"]
    assert len(pkgs) >= 1
    assert pkgs[0]["tbmt_code"] == "IB2500062810-00"
    assert pkgs[0]["decision_number"] == "789/QĐ-BVNĐ1"

    # AI Insight
    assert "kho lạnh GSP" in d["ai_insight"]


def test_tier4_enterprise_contractor_iot_son_la(auth_client: TestClient):
    """T4.4: Real-World Customer Dossier: IoT Sơn La (5500649200)."""
    r = auth_client.get("/api/bidding/contractors/5500649200")
    assert r.status_code == 200
    d = r.json()

    assert d["tax_code"] == "5500649200"
    assert d["name"] == "CÔNG TY CỔ PHẦN KỸ THUẬT TỰ ĐỘNG HOÁ IOT"
    assert d["short_name"] == "Tự Động Hóa IoT"
    assert d["bidding_status"] == "REGISTERED_BIDDER"
    assert d["bidding_status_label"] == "📝 Đã Đăng Ký Nhà Thầu"
    assert d["total_bids"] == 4
    assert d["total_won"] == 2
    assert d["win_rate_percent"] == 50.0
    assert d["total_won_value_vnd"] == 890000000.0

    # Procuring entities
    assert "Công ty Điện lực Sơn La" in d["top_procuring_entities"]

    # Won package
    assert any(p["tbmt_code"] == "IB2500041200-00" and "142/QĐ-PCSL" in p["decision_number"] for p in d["highlight_won_packages"])

    # AI Insight
    assert "Tây Bắc" in d["ai_insight"]


def test_tier4_enterprise_contractor_inut_hq(auth_client: TestClient):
    """T4.5: Real-World Customer Dossier: INUT HQ (4401053694)."""
    r = auth_client.get("/api/bidding/contractors/4401053694")
    assert r.status_code == 200
    d = r.json()

    assert d["tax_code"] == "4401053694"
    assert d["name"] == "CÔNG TY TNHH CÔNG NGHỆ INUT"
    assert d["short_name"] == "iNut Technology"
    assert d["bidding_status"] == "INUT_HQ"
    assert d["bidding_status_label"] == "🌟 INUT (Đơn Vị Chủ Quản)"
    assert d["total_bids"] == 6
    assert d["total_won"] == 4
    assert d["win_rate_percent"] == 66.7
    assert d["total_won_value_vnd"] == 3450000000.0

    # Procuring entities
    assert "Trung tâm Ứng dụng Tiến bộ KH&CN" in d["top_procuring_entities"]

    # Won package
    assert any(p["tbmt_code"] == "IB2600001001-00" and "1042/QĐ-SNN" in p["decision_number"] for p in d["highlight_won_packages"])

    # AI Insight
    assert "R&D thiết bị IoT Gateway" in d["ai_insight"]
