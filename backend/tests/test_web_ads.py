"""Comprehensive tests for iNut Website Ads Analytics & Lead Capture."""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta, timezone

TEST_SECRET = "web-ads-secret-1234567890-abcdef"


def _canonical(method: str, path: str, timestamp: str, nonce: str, body: bytes) -> bytes:
    digest = hashlib.sha256(body).hexdigest()
    return f"{method.upper()}\n{path}\n{timestamp}\n{nonce}\n{digest}".encode("utf-8")


_NONCE_COUNTER = 0


def _signed(
    client,
    method: str,
    path: str,
    payload=None,
    *,
    secret: str = TEST_SECRET,
    nonce: str | None = None,
    timestamp: str | None = None,
    client_id: str = "inut-website",
):
    global _NONCE_COUNTER
    _NONCE_COUNTER += 1
    body = b"" if payload is None else json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ts = timestamp if timestamp is not None else str(int(time.time()))
    nc = nonce if nonce is not None else f"webads-nonce-{ts}-{_NONCE_COUNTER}"
    sig = hmac.new(secret.encode("utf-8"), _canonical(method, path, ts, nc, body), hashlib.sha256).hexdigest()
    headers = {
        "X-iNut-Training-Client": client_id,
        "X-iNut-Training-Timestamp": ts,
        "X-iNut-Training-Nonce": nc,
        "X-iNut-Training-Signature": sig,
        "Content-Type": "application/json",
    }
    return client.request(method, path, content=body, headers=headers)


def _configure(monkeypatch):
    monkeypatch.setenv("PUBLIC_TRAINING_HMAC_SECRET", TEST_SECRET)
    monkeypatch.setenv("PUBLIC_TRAINING_ENABLED", "true")
    from app.config import get_settings
    from app import web_ads

    get_settings.cache_clear()
    web_ads.reset_click_cooldowns_for_tests()


def _login_admin(client):
    resp = client.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})
    assert resp.status_code == 200, resp.text


def test_internal_endpoints_require_valid_hmac_and_reject_replay(client, monkeypatch):
    _configure(monkeypatch)

    # Unauthenticated rejected
    r_ev = client.post(
        "/internal/web-ads/events",
        json={"visitor_id": "v1", "event_type": "pageview", "page_path": "/"},
    )
    assert r_ev.status_code == 401

    r_ld = client.post(
        "/internal/web-ads/leads",
        json={"name": "An", "phone": "0912345678"},
    )
    assert r_ld.status_code == 401

    # Expired timestamp rejected
    expired_ts = str(int(time.time()) - 300)
    r_exp = _signed(
        client,
        "POST",
        "/internal/web-ads/events",
        {"visitor_id": "v1", "event_type": "pageview", "page_path": "/"},
        timestamp=expired_ts,
    )
    assert r_exp.status_code == 401

    # Replay nonce rejected
    fixed_nonce = "webads-replay-check"
    r1 = _signed(
        client,
        "POST",
        "/internal/web-ads/events",
        {"visitor_id": "v1", "event_type": "pageview", "page_path": "/"},
        nonce=fixed_nonce,
    )
    r2 = _signed(
        client,
        "POST",
        "/internal/web-ads/events",
        {"visitor_id": "v1", "event_type": "pageview", "page_path": "/"},
        nonce=fixed_nonce,
    )
    assert r1.status_code == 201
    assert r2.status_code == 401


def test_event_ingestion_validation_and_click_alert_cooldown(client, monkeypatch):
    _configure(monkeypatch)
    from app import web_ads
    from app.db import WebAdEvent, get_session

    dispatched: list[int] = []
    monkeypatch.setattr(web_ads, "dispatch_click_alert", lambda settings, event_id: dispatched.append(event_id))

    # Validation failures
    bad_type = _signed(client, "POST", "/internal/web-ads/events", {
        "visitor_id": "v1", "event_type": "unknown_evt", "page_path": "/solutions/p/datalogger-cong-nghiep",
    })
    assert bad_type.status_code == 400

    missing_vid = _signed(client, "POST", "/internal/web-ads/events", {
        "visitor_id": "", "event_type": "pageview", "page_path": "/",
    })
    assert missing_vid.status_code == 400

    # Valid pageview infers product_key from path
    pv = _signed(client, "POST", "/internal/web-ads/events", {
        "visitor_id": "v_cool",
        "event_type": "pageview",
        "page_path": "/solutions/p/datalogger-cong-nghiep",
        "utm_source": "facebook",
        "utm_campaign": "dl_q4",
    })
    assert pv.status_code == 201
    assert pv.json()["ok"] is True
    pv_id = pv.json()["event_id"]

    # First click_call triggers alert; duplicate within 10 min suppressed
    c1 = _signed(client, "POST", "/internal/web-ads/events", {
        "visitor_id": "v_cool",
        "event_type": "click_call",
        "page_path": "/solutions/p/datalogger-cong-nghiep",
    })
    c2 = _signed(client, "POST", "/internal/web-ads/events", {
        "visitor_id": "v_cool",
        "event_type": "click_call",
        "page_path": "/solutions/p/datalogger-cong-nghiep",
    })
    # click_zalo on same page DOES alert (separate event_type)
    z1 = _signed(client, "POST", "/internal/web-ads/events", {
        "visitor_id": "v_cool",
        "event_type": "click_zalo",
        "page_path": "/solutions/p/datalogger-cong-nghiep",
    })
    assert c1.status_code == 201 and c2.status_code == 201 and z1.status_code == 201
    assert dispatched == [c1.json()["event_id"], z1.json()["event_id"]]

    gen = get_session()
    db = next(gen)
    ev_pv = db.get(WebAdEvent, pv_id)
    ev_c1 = db.get(WebAdEvent, c1.json()["event_id"])
    ev_c2 = db.get(WebAdEvent, c2.json()["event_id"])
    assert ev_pv is not None and ev_pv.product_key == "datalogger"
    assert ev_c1 is not None and ev_c1.notified is True
    assert ev_c2 is not None and ev_c2.notified is False
    gen.close()

    # Cooldown window expires after 600s
    assert web_ads.take_click_alert_slot("v_time", "click_call", "/p", now=1000.0) is True
    assert web_ads.take_click_alert_slot("v_time", "click_call", "/p", now=1599.0) is False
    assert web_ads.take_click_alert_slot("v_time", "click_call", "/p", now=1601.0) is True


def test_lead_capture_encryption_enrichment_and_cross_matching(client, monkeypatch):
    _configure(monkeypatch)
    from app import crypto, web_ads
    from app.db import (
        Customer,
        TrainingPublicQuery,
        TrainingPublicSession,
        WebAdEvent,
        WebLead,
        get_session,
    )

    lead_alerts: list[tuple[int, int]] = []
    monkeypatch.setattr(
        web_ads,
        "dispatch_lead_alert",
        lambda settings, lead_id, training_query_count=0: lead_alerts.append((lead_id, training_query_count)),
    )

    # Seed existing CRM Customer + TrainingPublicSession with same phone 0912345678
    gen = get_session()
    db = next(gen)
    cust = Customer(
        name="Công ty Cơ điện ABC",
        contact="Anh Minh - +84 912.345.678",
        email="minh@abc.vn",
    )
    db.add(cust)
    ts = TrainingPublicSession(
        token_hash="tokhash-test-1",
        phone_ciphertext=crypto.encrypt("0912345678"),
        phone_hash=crypto.fingerprint("0912345678"),
        phone_last4="5678",
        locale="vi",
    )
    db.add(ts)
    db.flush()
    db.add_all([
        TrainingPublicQuery(
            job_id="q-1",
            session_id=ts.id,
            question="Datalogger đọc được bao nhiêu PLC?",
            answer_json=json.dumps({"answer": {"answer": "Hỗ trợ hơn 100 PLC qua Modbus/IEC 104."}}),
            status="done",
        ),
        TrainingPublicQuery(
            job_id="q-2",
            session_id=ts.id,
            question="Có sẵn FUXA SCADA không?",
            answer_json=json.dumps({"answer": "Có sẵn FUXA Web SCADA self-hosted."}),
            status="done",
        ),
    ])
    db.commit()
    cust_id = cust.id
    ts_id = ts.id
    gen.close()

    # Record visitor journey before submitting lead
    for evt in (
        {
            "visitor_id": "v_lead_1",
            "event_type": "pageview",
            "page_path": "/solutions/p/datalogger-cong-nghiep",
            "utm_source": "facebook",
            "utm_medium": "cpc",
            "utm_campaign": "dl_fb_q4",
            "fbclid": "fb_xyz_999",
        },
        {
            "visitor_id": "v_lead_1",
            "event_type": "view_price",
            "page_path": "/solutions/p/datalogger-cong-nghiep",
            "utm_source": "facebook",
            "utm_campaign": "dl_fb_q4",
        },
        {
            "visitor_id": "v_lead_1",
            "event_type": "view_price",
            "page_path": "/solutions/p/datalogger-cong-nghiep",
        },
        {
            "visitor_id": "v_lead_1",
            "event_type": "select_sku",
            "page_path": "/solutions/p/datalogger-cong-nghiep",
            "sku": "INUT-SC-DL11",
            "coupon": "FBADS20",
        },
    ):
        resp = _signed(client, "POST", "/internal/web-ads/events", evt)
        assert resp.status_code == 201

    # Submit lead WITHOUT UTMs or SKU — backend should backfill from visitor's events!
    lead_resp = _signed(client, "POST", "/internal/web-ads/leads", {
        "visitor_id": "v_lead_1",
        "name": "Nguyễn Văn Minh",
        "phone": "+84 (912) 345-678",
        "company": "Công ty Cơ điện ABC",
        "quantity": 3,
        "device_info": "8 PLC Siemens S7-1200",
        "need": "Giám sát điện năng",
        "message": "Cần báo giá gấp tuần này",
    })
    assert lead_resp.status_code == 201, lead_resp.text
    body = lead_resp.json()
    assert body["ok"] is True
    assert body["matched_customer_id"] == cust_id
    assert body["matched_training_session_id"] == ts_id
    lead_id = body["lead_id"]

    # Telegram lead alert dispatched with training_query_count=2
    assert lead_alerts == [(lead_id, 2)]

    # Verify DB storage: phone encrypted, UTMs/SKU/pricing backfilled, submit_lead event created
    gen = get_session()
    db = next(gen)
    row = db.get(WebLead, lead_id)
    assert row is not None
    assert "0912345678" not in row.phone_ciphertext
    assert crypto.decrypt(row.phone_ciphertext) == "0912345678"
    assert row.phone_last4 == "5678"
    assert row.visit_count == 1
    assert row.price_view_count == 2
    assert row.utm_source == "facebook"
    assert row.utm_campaign == "dl_fb_q4"
    assert row.fbclid == "fb_xyz_999"
    assert row.sku == "INUT-SC-DL11"
    assert row.coupon_code == "FBADS20"
    assert row.discount_percent == 20.0
    # 6_250_000 * 0.8 = 5_000_000; qty=3 -> -5% volume = 4_750_000 * 3 = 14_250_000
    assert row.quoted_price_vnd == 14_250_000.0

    # Formatted Telegram message contains all key details
    tg_msg = web_ads.format_lead_telegram_message(
        row, phone="0912345678", training_query_count=2, public_base_url="https://ksp.inut.vn"
    )
    assert "Nguyễn Văn Minh" in tg_msg
    assert "INUT-SC-DL11" in tg_msg
    assert "FBADS20" in tg_msg
    assert "dl_fb_q4" in tg_msg
    assert "2</b> câu hỏi" in tg_msg
    assert "Xem bảng giá: <b>2</b>" in tg_msg

    # Verify submit_lead event recorded
    submit_ev = db.query(WebAdEvent).filter_by(visitor_id="v_lead_1", event_type="submit_lead").first()
    assert submit_ev is not None
    assert json.loads(submit_ev.meta_json)["lead_id"] == lead_id
    gen.close()

    # Non-VN international phone fallback accepted so leads are never lost
    intl = _signed(client, "POST", "/internal/web-ads/leads", {
        "name": "John Doe",
        "phone": "+1 (415) 555-2671",
        "sku": "INUT-SC-R4WF4G",
        "locale": "en",
    })
    assert intl.status_code == 201, intl.text

    # Invalid too-short phone rejected
    bad_phone = _signed(client, "POST", "/internal/web-ads/leads", {
        "name": "Test",
        "phone": "12345",
    })
    assert bad_phone.status_code == 400


def test_admin_overview_leads_crud_customer_draft_quote_and_digest(client, monkeypatch):
    _configure(monkeypatch)
    from app import web_ads

    monkeypatch.setattr(web_ads, "dispatch_click_alert", lambda *a, **kw: None)
    monkeypatch.setattr(web_ads, "dispatch_lead_alert", lambda *a, **kw: None)

    # Admin endpoints reject unauthenticated requests
    assert client.get("/api/web-ads/overview").status_code == 401
    assert client.get("/api/web-ads/leads").status_code == 401

    # Non-admin customer role receives 403
    from app.db import Customer, User, get_session
    from app.security import hash_password

    gen = get_session()
    db = next(gen)
    c_only = Customer(name="Cust Role Test")
    db.add(c_only)
    db.flush()
    db.add(User(
        username="cust_webads",
        password_hash=hash_password("CustPass123!"),
        role="customer",
        customer_id=c_only.id,
    ))
    db.commit()
    gen.close()

    assert client.post("/api/login", json={"username": "cust_webads", "password": "CustPass123!"}).status_code == 200
    assert client.get("/api/web-ads/overview").status_code == 403
    assert client.get("/api/web-ads/leads").status_code == 403

    # Seed events & leads across two campaigns and two products
    for evt in (
        {"visitor_id": "va", "event_type": "pageview", "page_path": "/solutions/p/datalogger-cong-nghiep", "utm_source": "facebook", "utm_campaign": "camp_dl"},
        {"visitor_id": "va", "event_type": "view_price", "page_path": "/solutions/p/datalogger-cong-nghiep", "utm_source": "facebook", "utm_campaign": "camp_dl"},
        {"visitor_id": "va", "event_type": "select_sku", "page_path": "/solutions/p/datalogger-cong-nghiep", "sku": "INUT-SC-DL11", "utm_source": "facebook", "utm_campaign": "camp_dl"},
        {"visitor_id": "va", "event_type": "click_zalo", "page_path": "/solutions/p/datalogger-cong-nghiep", "utm_source": "facebook", "utm_campaign": "camp_dl"},
        {"visitor_id": "vb", "event_type": "pageview", "page_path": "/solutions/p/datalogger-cong-nghiep", "utm_source": "facebook", "utm_campaign": "camp_dl"},
        {"visitor_id": "vc", "event_type": "pageview", "page_path": "/solutions/p/rs485-gateway", "utm_source": "google", "utm_campaign": "camp_rs"},
        {"visitor_id": "vc", "event_type": "view_price", "page_path": "/solutions/p/rs485-gateway", "utm_source": "google", "utm_campaign": "camp_rs"},
        {"visitor_id": "vc", "event_type": "click_call", "page_path": "/solutions/p/rs485-gateway", "utm_source": "google", "utm_campaign": "camp_rs"},
    ):
        assert _signed(client, "POST", "/internal/web-ads/events", evt).status_code == 201

    ld1 = _signed(client, "POST", "/internal/web-ads/leads", {
        "visitor_id": "va",
        "name": "Trần Quang Hải",
        "phone": "0988777666",
        "email": "hai@factory.vn",
        "company": "Nhà máy Thủy điện Sông Hinh",
        "sku": "INUT-SC-DL11",
        "quantity": 3,
        "coupon_code": "FBADS20",
        "device_info": "PLC Schneider M340",
        "need": "SCADA nhà máy",
    }).json()["lead_id"]

    ld2 = _signed(client, "POST", "/internal/web-ads/leads", {
        "visitor_id": "vc",
        "name": "Lê Thị Lan",
        "phone": "0977111222",
        "product_key": "rs485",
        "sku": "INUT-SC-R4WF4G",
        "quantity": 10,
        "coupon_code": "INUTNEWBIE",
    }).json()["lead_id"]

    # Login as admin
    _login_admin(client)

    # 1. Overview unfiltered
    ov = client.get("/api/web-ads/overview?days=30")
    assert ov.status_code == 200, ov.text
    ov_data = ov.json()
    assert ov_data["days"] == 30
    totals = ov_data["totals"]
    assert totals["pageviews"] == 3
    assert totals["unique_visitors"] == 3
    assert totals["price_views"] == 2
    assert totals["sku_selects"] == 1
    assert totals["call_clicks"] == 1
    assert totals["zalo_clicks"] == 1
    assert totals["leads"] == 2
    assert totals["visit_to_price_rate"] == 66.67
    assert totals["price_to_lead_rate"] == 100.0
    assert totals["visit_to_lead_rate"] == 66.67
    assert len(ov_data["by_campaign"]) == 2
    assert len(ov_data["by_page"]) == 2
    assert len(ov_data["by_sku"]) == 2
    assert len(ov_data["daily"]) == 30
    assert set(ov_data["filters"]["product_keys"]) == {"datalogger", "rs485"}
    assert set(ov_data["filters"]["utm_campaigns"]) == {"camp_dl", "camp_rs"}

    # Overview filtered by product_key & utm_campaign
    ov_dl = client.get("/api/web-ads/overview?days=30&product_key=datalogger&utm_campaign=camp_dl").json()
    assert ov_dl["totals"]["pageviews"] == 2
    assert ov_dl["totals"]["leads"] == 1
    assert ov_dl["totals"]["zalo_clicks"] == 1
    assert ov_dl["totals"]["call_clicks"] == 0

    # 2. Leads listing, search & masking
    listed = client.get("/api/web-ads/leads?q=0988777666").json()
    assert listed["total"] == 1
    assert listed["items"][0]["id"] == ld1
    assert listed["items"][0]["phone"] == "0988777666"
    assert listed["items"][0]["phone_last4"] == "7666"

    masked = client.get("/api/web-ads/leads?mask_phone=true&product_key=datalogger").json()
    assert masked["total"] == 1
    assert masked["items"][0]["phone"] == "••••••7666"

    # 3. Lead detail with chronological event timeline
    detail = client.get(f"/api/web-ads/leads/{ld1}")
    assert detail.status_code == 200
    d_json = detail.json()
    assert [e["event_type"] for e in d_json["events"]] == [
        "pageview",
        "view_price",
        "select_sku",
        "click_zalo",
        "submit_lead",
    ]

    # 4. Create CRM customer from lead (create then idempotent link)
    cc1 = client.post(f"/api/web-ads/leads/{ld1}/create-customer")
    assert cc1.status_code == 200, cc1.text
    cc1_data = cc1.json()
    assert cc1_data["ok"] is True
    assert cc1_data["created"] is True
    assert cc1_data["customer"]["name"] == "Nhà máy Thủy điện Sông Hinh"
    assert "0988777666" in cc1_data["customer"]["contact"]

    cc2 = client.post(f"/api/web-ads/leads/{ld1}/create-customer")
    assert cc2.status_code == 200
    assert cc2.json()["created"] is False
    assert cc2.json()["customer_id"] == cc1_data["customer_id"]

    # 5. Draft quote prefill with canonical SKU + coupon + volume discount
    dq1 = client.post(f"/api/web-ads/leads/{ld1}/draft-quote")
    assert dq1.status_code == 200, dq1.text
    q1 = dq1.json()
    assert q1["lead_id"] == ld1
    assert q1["customer_id"] == cc1_data["customer_id"]
    assert q1["customer_name"] == "Nhà máy Thủy điện Sông Hinh"
    assert q1["coupon_code"] == "FBADS20"
    assert q1["discount_percent"] == 20.0
    assert q1["volume_discount_percent"] == 5.0
    assert len(q1["items"]) == 1
    assert q1["items"][0]["ten"] == "iNut Smartcity: Data Logger V1.1 (INUT-SC-DL11)"
    assert q1["items"][0]["dvt"] == "Bộ"
    assert q1["items"][0]["so_luong"] == 3
    assert q1["items"][0]["don_gia"] == 4_750_000
    assert q1["items"][0]["thue_suat"] == 10
    assert q1["subtotal_vnd"] == 14_250_000
    assert q1["vat_vnd"] == 1_425_000
    assert q1["total_vnd"] == 15_675_000

    # Dealer tier draft quote (>=10 units)
    dq2 = client.post(f"/api/web-ads/leads/{ld2}/draft-quote").json()
    assert dq2["items"][0]["ten"] == "iNut Smartcity: RS485 WIFI/4G (INUT-SC-R4WF4G)"
    # base 2_525_000 -> retail 3_156_250 -> -20% = 2_525_000 -> -5% volume = 2_398_750
    assert dq2["items"][0]["don_gia"] == 2_398_750
    assert "Đại lý SI" in dq2["note"]

    # 6. PATCH lead status, note, quantity
    patched = client.patch(
        f"/api/web-ads/leads/{ld1}",
        json={"status": "quoted", "note": "Đã gửi báo giá bản 1", "quantity": 4},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["status"] == "quoted"
    assert patched.json()["note"] == "Đã gửi báo giá bản 1"
    assert patched.json()["quantity"] == 4

    # Invalid status rejected
    bad_patch = client.patch(f"/api/web-ads/leads/{ld1}", json={"status": "invalid_st"})
    assert bad_patch.status_code == 400

    # 7. Daily digest (unconfigured -> sent=False, then mocked Telegram -> sent=True)
    dg_unconf = client.post("/api/web-ads/daily-digest?days=1")
    assert dg_unconf.status_code == 200
    assert dg_unconf.json()["ok"] is True
    assert dg_unconf.json()["sent"] is False
    assert dg_unconf.json()["summary"]["totals"]["leads"] == 2

    sent_payloads: list[str] = []
    monkeypatch.setattr(
        web_ads,
        "send_telegram_html",
        lambda db_sess, settings, html_text: (sent_payloads.append(html_text), 1)[1],
    )
    dg_sent = client.post("/api/web-ads/daily-digest?days=1")
    assert dg_sent.status_code == 200
    assert dg_sent.json()["sent"] is True
    assert dg_sent.json()["delivered_count"] == 1
    assert len(sent_payloads) == 1
    assert "camp_dl" in sent_payloads[0]
    assert "INUT-SC-DL11" in sent_payloads[0]

    # 8. DELETE lead
    deleted = client.delete(f"/api/web-ads/leads/{ld2}")
    assert deleted.status_code == 200
    assert deleted.json()["ok"] is True
    assert client.get(f"/api/web-ads/leads/{ld2}").status_code == 404


def test_canonical_coupon_and_volume_discount_prevent_double_counting_and_spoofing(client, monkeypatch):
    _configure(monkeypatch)
    from app import web_ads

    monkeypatch.setattr(web_ads, "dispatch_lead_alert", lambda *a, **kw: None)

    # Case 1: qty=3 + FBADS20 with combined/spoofed discount_percent=24 -> canonical 20% + 5% volume = 4_750_000/unit
    r_with_coupon = _signed(client, "POST", "/internal/web-ads/leads", {
        "name": "Double Discount Guard A",
        "phone": "0911222333",
        "sku": "INUT-SC-DL11",
        "quantity": 3,
        "coupon_code": "FBADS20",
        "discount_percent": 24,
    })
    assert r_with_coupon.status_code == 201, r_with_coupon.text
    lead_a_id = r_with_coupon.json()["lead_id"]

    # Case 2: qty=3 + NO coupon with spoofed/volume discount_percent=5 -> 0% coupon + 5% volume = 5_937_500/unit
    r_no_coupon = _signed(client, "POST", "/internal/web-ads/leads", {
        "name": "Double Discount Guard B",
        "phone": "0911222444",
        "sku": "INUT-SC-DL11",
        "quantity": 3,
        "discount_percent": 5,
    })
    assert r_no_coupon.status_code == 201, r_no_coupon.text
    lead_b_id = r_no_coupon.json()["lead_id"]

    # Case 3: Spoofed discount_percent=99 on known coupon or empty coupon is ignored
    assert web_ads.compute_sku_pricing("INUT-SC-DL11", quantity=3, coupon_code="FBADS20", discount_percent=99)["unit_price"] == 4_750_000
    assert web_ads.compute_sku_pricing("INUT-SC-DL11", quantity=3, coupon_code="", discount_percent=99)["unit_price"] == 5_937_500

    _login_admin(client)

    detail_a = client.get(f"/api/web-ads/leads/{lead_a_id}").json()
    assert detail_a["discount_percent"] == 20.0
    assert detail_a["quoted_price_vnd"] == 14_250_000.0
    draft_a = client.post(f"/api/web-ads/leads/{lead_a_id}/draft-quote").json()
    assert draft_a["discount_percent"] == 20.0
    assert draft_a["volume_discount_percent"] == 5.0
    assert draft_a["items"][0]["don_gia"] == 4_750_000
    assert draft_a["subtotal_vnd"] == 14_250_000

    detail_b = client.get(f"/api/web-ads/leads/{lead_b_id}").json()
    assert detail_b["discount_percent"] == 0.0
    assert detail_b["quoted_price_vnd"] == 17_812_500.0
    draft_b = client.post(f"/api/web-ads/leads/{lead_b_id}/draft-quote").json()
    assert draft_b["discount_percent"] == 0.0
    assert draft_b["volume_discount_percent"] == 5.0
    assert draft_b["items"][0]["don_gia"] == 5_937_500
    assert draft_b["subtotal_vnd"] == 17_812_500

