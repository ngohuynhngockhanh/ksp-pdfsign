# Adversarial Oracle & Stress Verification Harness for Bidding Intelligence System.
from __future__ import annotations

import concurrent.futures
import json
import math
import os
import threading
import time
from typing import Any
import httpx
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
def challenger_db(tmp_path_factory):
    data_dir = tmp_path_factory.mktemp("challenger_bidding_data")
    os.environ["DATA_DIR"] = str(data_dir)
    os.environ["AI_ENABLED"] = "false"
    get_settings.cache_clear()
    bidding._default_client.clear_cache(reset_circuit=True)
    db.reset_engine_for_tests()
    init_db()
    return str(data_dir)


@pytest.fixture(autouse=True)
def clean_challenger_db(challenger_db, monkeypatch):
    monkeypatch.setenv("DATA_DIR", challenger_db)
    monkeypatch.setenv("AI_ENABLED", "false")
    get_settings.cache_clear()
    bidding._default_client.clear_cache(reset_circuit=True)

    gen = db.get_session()
    s = next(gen)
    try:
        s.query(BiddingAlertLog).delete()
        s.query(BiddingBookmark).delete()
        s.query(BiddingWatchlist).delete()
        s.query(TelegramConnection).delete()
        s.query(Customer).delete()
        s.query(User).delete()

        customers = [
            Customer(name="CONG TY CP DU LIEU TOAN CAU", tax_code="0105365128", address="Ha Noi", email="gdata@test.vn"),
            Customer(name="CONG TY CP DT PT CN TAN THANH PHUONG", tax_code="2800817718", address="Thanh Hoa", email="ttp@test.vn"),
            Customer(name="CONG TY CP TAP DOAN MERAP", tax_code="0101400572", address="Hung Yen", email="merap@test.vn"),
            Customer(name="CONG TY CP KY THUAT TU DONG HOA IOT", tax_code="5500649200", address="Son La", email="iot@test.vn"),
            Customer(name="CONG TY TNHH TM DV KT BAO TOAN", tax_code="0314360282", address="TP.HCM", email="baotoan@test.vn"),
            Customer(name="CONG TY TNHH CONG NGHE INUT", tax_code="4401053694", address="TP.HCM", email="inut@test.vn"),
            Customer(name="CONG TY TNHH TM XNK DAI VIET", tax_code="0109998877", address="Da Nang", email="daiviet@test.vn"),
        ]
        for c in customers:
            s.add(c)

        admin = User(username="admin", role="admin", password_hash="hash")
        s.add(admin)
        s.commit()
    finally:
        gen.close()

    yield
    get_settings.cache_clear()
    bidding._default_client.clear_cache(reset_circuit=True)


@pytest.fixture
def auth_client(monkeypatch):
    settings = get_settings()
    gen = db.get_session()
    s = next(gen)
    admin_user = s.scalar(select(User).where(User.username == "admin"))
    token = create_token(admin_user, settings)
    gen.close()

    c = TestClient(app)
    c.cookies.set(COOKIE_NAME, token)
    return c


def test_math_oracle_format_currency_vnd_extremes():
    assert bidding.format_currency_vnd(0) == "0"
    assert bidding.format_currency_vnd(0.0) == "0"
    assert bidding.format_currency_vnd(-0.0) == "0"
    assert bidding.format_currency_vnd(None) == "0"
    assert bidding.format_currency_vnd("") == "0"
    assert bidding.format_currency_vnd("abc") == "0"
    assert bidding.format_currency_vnd(12580000000) == "12.580.000.000"
    assert bidding.format_currency_vnd(999999999999) == "999.999.999.999"
    assert bidding.format_currency_vnd(-5000000) == "-5.000.000"
    assert bidding.format_currency_vnd(1234567.89) == "1.234.568"
    assert bidding.format_currency_vnd(1234567.12) == "1.234.567"
    assert isinstance(bidding.format_currency_vnd(float("inf")), str)
    assert isinstance(bidding.format_currency_vnd(float("nan")), str)


def test_math_oracle_win_rate_and_discount_edge_cases():
    total_bids = 10
    total_won = 10
    win_rate = round((total_won / total_bids) * 100, 1)
    assert win_rate == 100.0

    total_bids = 5
    total_won = 0
    win_rate = round((total_won / total_bids) * 100, 1)
    assert win_rate == 0.0

    total_bids = 0
    total_won = 0
    win_rate = round((total_won / total_bids) * 100, 1) if total_bids > 0 else 0.0
    assert win_rate == 0.0

    bid_price = 1000000000.0
    won_price = 950000000.0
    discount = round(((bid_price - won_price) / bid_price) * 100, 2)
    assert discount == 5.0

    won_price_overrun = 1050000000.0
    neg_discount = round(((bid_price - won_price_overrun) / bid_price) * 100, 2)
    assert neg_discount == -5.0


ADVERSARIAL_CHALLENGE_PAYLOADS = [
    "' OR '1'='1",
    "'; DROP TABLE customers; --",
    "' UNION SELECT id, username, password_hash FROM users --",
    "1' WAITFOR DELAY '0:0:5'--",
    "admin' #",
    "<script>alert(document.cookie)</script>",
    "<img src='x' onerror='alert(1)'>",
    "<svg/onload=alert(1)>",
    chr(0) + chr(1) + chr(2) + chr(3),
    "‮​﻿Mã TBMT Đảo Ngược",
    "Đắk Lắk - TP. Hồ Chí Minh - Bà Rịa - Vũng Tàu 🚀🏢💡⚡",
    "../../../../../../../../etc/passwd",
    "..\..\..\..\windows\system32\drivers\etc\hosts",
    "%" * 50,
    "_" * 50,
    "A" * 2000,
]


@pytest.mark.parametrize("payload", ADVERSARIAL_CHALLENGE_PAYLOADS)
def test_adversarial_contractor_search_fuzzing(auth_client: TestClient, payload: str):
    r = auth_client.get("/api/bidding/contractors/search", params={"query": payload})
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)


@pytest.mark.parametrize("payload", ADVERSARIAL_CHALLENGE_PAYLOADS)
def test_adversarial_tender_search_fuzzing(auth_client: TestClient, payload: str):
    r = auth_client.get("/api/bidding/search", params={"keyword": payload, "province": payload, "field": payload})
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    assert isinstance(data["items"], list)


def test_adversarial_tax_code_path_traversal(auth_client: TestClient):
    traversal_codes = [
        "0000000000",
        "../../etc/passwd",
        "<script>",
    ]
    for code in traversal_codes:
        r = auth_client.get(f"/api/bidding/contractors/{code}")
        assert r.status_code in {200, 404}
        if r.status_code == 200:
            data = r.json()
            assert "tax_code" in data
            assert data["bidding_status"] in {"COMMERCIAL", "WON_BIG", "REGISTERED_BIDDER", "OEM_SUBCONTRACTOR", "INUT_HQ"}


def test_circuit_breaker_timeout_and_fallback():
    client = bidding.BiddingClient(timeout=0.01)
    client.clear_cache(reset_circuit=True)
    res = client.search(keyword="SCADA Gateway", page=1, page_size=5)
    assert res is not None
    assert "items" in res
    assert res["is_mock"] is True
    assert bidding.BiddingClient._global_last_egp_failure > 0

    start_t = time.time()
    res2 = client.search(keyword="SCADA Gateway", page=1, page_size=5)
    elapsed = time.time() - start_t
    assert elapsed < 0.2
    assert res2["is_mock"] is True


def test_circuit_breaker_corrupt_http_response_handling():
    def mock_transport_500(request):
        return httpx.Response(status_code=500, text="<html><body>500 Internal Server Error</body></html>")

    mock_transport = httpx.MockTransport(mock_transport_500)
    client = bidding.BiddingClient(timeout=1.0, transport=mock_transport)
    client.clear_cache(reset_circuit=True)
    res = client.search(keyword="PLC", page=1, page_size=5)
    assert res is not None
    assert res["is_mock"] is True
    assert bidding.BiddingClient._global_last_egp_failure > 0


def test_telegram_failure_does_not_abort_watchlist_scan(monkeypatch):
    gen = db.get_session()
    s = next(gen)
    admin = s.scalar(select(User).where(User.username == "admin"))
    tg = TelegramConnection(user_id=admin.id, chat_id="999888777", status="active", username="admin")
    s.add(tg)

    wl = bidding.create_watchlist(s, {
        "name": "Khi Thai CEMS",
        "keyword": "CEMS",
        "notify_telegram": True,
        "is_active": True,
    })
    s.commit()

    settings = get_settings()
    settings.telegram_enabled = True
    settings.telegram_bot_token = "invalid:token"

    class FailingTelegramClient:
        def __init__(self, *args, **kwargs):
            pass
        def send_message(self, chat_id, text):
            raise telegram.TelegramError("Connection timed out")
        def close(self):
            pass

    monkeypatch.setattr(telegram, "TelegramClient", FailingTelegramClient)
    monkeypatch.setattr(telegram, "is_configured", lambda s: True)

    scan_res = bidding.run_watchlist_scan(s, settings, watchlist_id=wl.id)
    assert scan_res["watchlists_scanned"] == 1
    assert scan_res["new_tenders_found"] > 0
    assert scan_res["alerts_failed"] > 0
    logs = s.scalars(select(BiddingAlertLog).where(BiddingAlertLog.watchlist_id == wl.id)).all()
    assert len(logs) > 0
    gen.close()


def test_ai_scoring_corrupted_json_fallback(monkeypatch):
    monkeypatch.setenv("AI_ENABLED", "true")
    get_settings.cache_clear()
    settings = get_settings()

    monkeypatch.setattr(ai, "chat", lambda s, msgs, temperature=0.3: "")

    tender = {
        "tbmt_code": "IB2600001001-00",
        "tender_name": "Cung cap he thong SCADA",
        "procuring_entity": "So Nong Nghiep",
        "field": "HH",
        "bid_price": 980000000.0,
    }

    result = bidding.ai_analyze_tender(settings, tender)
    assert result is not None
    assert "inut_fit_analysis" in result
    score = result["inut_fit_analysis"]["score"]
    assert 0 <= score <= 100
    assert result["inut_fit_analysis"]["match_level"] in {"Cao", "Trung bình", "Thấp"}


def test_ai_scoring_missing_fields_and_boundary_pricing():
    settings = get_settings()
    settings.ai_enabled = False

    edge_cases = [
        {},
        {"tender_name": "Tu van", "bid_price": 0.0, "field": "TV"},
        {"tender_name": "Xay lap", "bid_price": 500000000000.0, "field": "XL"},
        {"tender_name": None, "bid_price": None, "field": None, "procuring_entity": None},
    ]

    for tender in edge_cases:
        res = bidding.ai_analyze_tender(settings, tender)
        assert "executive_summary" in res
        assert "scope_of_work" in res
        assert "financial_requirements" in res
        assert "inut_fit_analysis" in res
        score = res["inut_fit_analysis"]["score"]
        assert 0 <= score <= 100


def test_crm_scan_macro_financial_consistency(auth_client: TestClient):
    r = auth_client.get("/api/bidding/contractors/crm-scan")
    assert r.status_code == 200
    data = r.json()

    assert "total_crm_customers" in data
    assert "total_won_contractors" in data
    assert "total_won_value_vnd" in data
    assert "items" in data

    items = data["items"]
    assert len(items) == data["total_crm_customers"]

    actual_won_contractors = sum(1 for it in items if it["total_won"] > 0)
    actual_won_value = sum(it["total_won_value_vnd"] for it in items)

    assert actual_won_contractors == data["total_won_contractors"]
    assert actual_won_value == data["total_won_value_vnd"]

    for i in range(len(items) - 1):
        cur = (items[i]["total_won_value_vnd"], items[i]["total_won"], items[i]["win_rate_percent"])
        nxt = (items[i+1]["total_won_value_vnd"], items[i+1]["total_won"], items[i+1]["win_rate_percent"])
        assert cur >= nxt


def test_bidding_client_thread_safety_under_load():
    client = bidding.BiddingClient()
    client.clear_cache(reset_circuit=True)
    errors = []

    def worker_task(thread_id: int):
        try:
            for i in range(10):
                kw = "SCADA" if i % 2 == 0 else "Gateway"
                res = client.search(keyword=kw, page=1, page_size=5)
                assert res is not None
                detail = client.get_detail("IB2600001001-00")
                assert detail is not None
                if i == 5 and thread_id == 0:
                    client.clear_cache()
        except Exception as e:
            errors.append(e)

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(worker_task, tid) for tid in range(8)]
        for f in concurrent.futures.as_completed(futures):
            f.result()

    assert len(errors) == 0
