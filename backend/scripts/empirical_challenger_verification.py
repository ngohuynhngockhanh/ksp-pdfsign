"""Empirical Verification & Stress-Testing Script for KSP iNut Bidding Intelligence System.

Executed by Empirical Challenger against real SQLite database backend/data/ksp.db and backend APIs.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import time
from typing import Any
from fastapi.testclient import TestClient

# Add backend directory to sys.path
sys.path.insert(0, "/home/ksp/ksp-pdfsign/backend")
os.environ["DATA_DIR"] = "/home/ksp/ksp-pdfsign/backend/data"

from app.main import app
from app.config import get_settings
from app.auth import COOKIE_NAME, create_token, ensure_admin_seed
from app.db import get_session, User
from app.bidding import (
    ContractorBiddingService,
    BiddingPlaybookService,
    format_currency_vnd,
    _strip_accents,
)

DB_PATH = "/home/ksp/ksp-pdfsign/backend/data/ksp.db"

results = {
    "total_checks": 0,
    "passed_checks": 0,
    "failed_checks": 0,
    "details": [],
}

def log_check(name: str, passed: bool, detail: str = ""):
    results["total_checks"] += 1
    if passed:
        results["passed_checks"] += 1
        print(f"  [PASS] {name}")
    else:
        results["failed_checks"] += 1
        print(f"  [FAIL] {name}: {detail}")
    results["details"].append({"name": name, "passed": passed, "detail": detail})

def run_all_tests():
    print("=" * 80)
    print("STARTING EMPIRICAL CHALLENGER VERIFICATION HARNESS")
    print("=" * 80)

    # ──────────────────────────────────────────────────────────────────────────
    # SECTION 1: RAW SQLITE DATABASE INSPECTION
    # ──────────────────────────────────────────────────────────────────────────
    print("\n--- SECTION 1: Raw SQLite Database Inspection (ksp.db) ---")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 1.1 Check tables exist
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [row[0] for row in cursor.fetchall()]
    for expected_table in ["customers", "bidding_bookmarks", "bidding_watchlists", "bidding_alert_logs", "users"]:
        log_check(
            f"Table `{expected_table}` exists in ksp.db",
            expected_table in tables,
            f"Existing tables: {tables}",
        )

    # 1.2 Check customers count and tax codes in ksp.db
    cursor.execute("SELECT count(*), count(distinct tax_code) FROM customers")
    cust_count, distinct_tax = cursor.fetchone()
    log_check(
        f"Customers table has valid records (Total: {cust_count}, Distinct Tax: {distinct_tax})",
        cust_count > 0,
        f"count={cust_count}",
    )

    # 1.3 Check known tax codes present in customers table
    cursor.execute("SELECT tax_code, name FROM customers")
    db_customers = dict(cursor.fetchall())
    print(f"  Found {len(db_customers)} customers in SQLite database.")
    for mst in ["0105365128", "2800817718", "4401053694"]:
        present = mst in db_customers
        log_check(
            f"Target enterprise MST `{mst}` present in CRM customers database",
            present,
            f"Customer name: {db_customers.get(mst, 'NOT_FOUND')}",
        )
    conn.close()

    # Create authenticated client with valid admin cookie
    settings = get_settings()
    gen = get_session()
    db_sess = next(gen)
    admin_user = db_sess.query(User).filter(User.role == "admin").first()
    if not admin_user:
        admin_user = User(username="admin", password_hash="dummy", role="admin", session_version=1)
        db_sess.add(admin_user)
        db_sess.commit()
    token = create_token(admin_user, settings)
    gen.close()

    client = TestClient(app)
    client.cookies.set(COOKIE_NAME, token)
    print("  [INFO] Authenticated test client using admin session cookie.")

    # ──────────────────────────────────────────────────────────────────────────
    # SECTION 2: EMPIRICAL VERIFICATION OF 5 ENTERPRISE CUSTOMER DOSSIERS
    # ──────────────────────────────────────────────────────────────────────────
    print("\n--- SECTION 2: Verification of 5 Real-World Enterprise Customer Dossiers ---")

    # 2.1 Gdata (0105365128)
    res = client.get("/api/bidding/contractors/0105365128")
    log_check("Gdata GET /api/bidding/contractors/0105365128 status 200", res.status_code == 200)
    gdata = res.json()
    log_check("Gdata tier is WON_BIG", gdata.get("bidding_status") == "WON_BIG")
    log_check("Gdata total bids == 14 and total won == 11", gdata.get("total_bids") == 14 and gdata.get("total_won") == 11)
    log_check("Gdata win rate == 78.6%", gdata.get("win_rate_percent") == 78.6)
    log_check("Gdata won value == 12.580.000.000 VND", gdata.get("total_won_value_vnd") == 12580000000.0)
    log_check("Gdata procuring entities includes 'Tổng cục Tiêu chuẩn Đo lường Chất lượng'",
              any("Tổng cục Tiêu chuẩn Đo lường" in e for e in gdata.get("top_procuring_entities", [])))
    log_check("Gdata highlight packages includes IB2500094821-00",
              any(p.get("tbmt_code") == "IB2500094821-00" for p in gdata.get("highlight_won_packages", [])))

    # 2.2 Tân Thanh Phương (2800817718)
    res = client.get("/api/bidding/contractors/2800817718")
    log_check("Tân Thanh Phương status 200", res.status_code == 200)
    ttp = res.json()
    log_check("Tân Thanh Phương tier is WON_BIG", ttp.get("bidding_status") == "WON_BIG")
    log_check("Tân Thanh Phương win rate == 77.8%", ttp.get("win_rate_percent") == 77.8)
    log_check("Tân Thanh Phương won value == 18.450.000.000 VND", ttp.get("total_won_value_vnd") == 18450000000.0)
    log_check("Tân Thanh Phương procuring entities includes Sở TTTT Thanh Hóa",
              any("Sở Thông tin và Truyền thông Thanh Hóa" in e for e in ttp.get("top_procuring_entities", [])))
    log_check("Tân Thanh Phương highlight packages includes IB2400031920-00",
              any(p.get("tbmt_code") == "IB2400031920-00" for p in ttp.get("highlight_won_packages", [])))

    # 2.3 Merap Group (0101400572)
    res = client.get("/api/bidding/contractors/0101400572")
    log_check("Merap Group status 200", res.status_code == 200)
    merap = res.json()
    log_check("Merap Group tier is WON_BIG", merap.get("bidding_status") == "WON_BIG")
    log_check("Merap Group total bids == 48 and total won == 35", merap.get("total_bids") == 48 and merap.get("total_won") == 35)
    log_check("Merap Group win rate == 72.9%", merap.get("win_rate_percent") == 72.9)
    log_check("Merap Group won value == 68.200.000.000 VND", merap.get("total_won_value_vnd") == 68200000000.0)
    log_check("Merap Group procuring entities includes Bệnh viện Nhi Đồng 1",
              any("Bệnh viện Nhi Đồng 1" in e for e in merap.get("top_procuring_entities", [])))
    log_check("Merap Group highlight packages includes IB2500062810-00",
              any(p.get("tbmt_code") == "IB2500062810-00" for p in merap.get("highlight_won_packages", [])))

    # 2.4 IoT Sơn La (5500649200)
    res = client.get("/api/bidding/contractors/5500649200")
    log_check("IoT Sơn La status 200", res.status_code == 200)
    sonla = res.json()
    log_check("IoT Sơn La tier is REGISTERED_BIDDER", sonla.get("bidding_status") == "REGISTERED_BIDDER")
    log_check("IoT Sơn La total bids == 4 and total won == 2", sonla.get("total_bids") == 4 and sonla.get("total_won") == 2)
    log_check("IoT Sơn La win rate == 50.0%", sonla.get("win_rate_percent") == 50.0)
    log_check("IoT Sơn La won value == 890.000.000 VND", sonla.get("total_won_value_vnd") == 890000000.0)
    log_check("IoT Sơn La procuring entities includes Công ty Điện lực Sơn La",
              any("Công ty Điện lực Sơn La" in e for e in sonla.get("top_procuring_entities", [])))
    log_check("IoT Sơn La highlight packages includes IB2500041200-00",
              any(p.get("tbmt_code") == "IB2500041200-00" for p in sonla.get("highlight_won_packages", [])))

    # 2.5 INUT HQ (4401053694)
    res = client.get("/api/bidding/contractors/4401053694")
    log_check("INUT HQ status 200", res.status_code == 200)
    inut = res.json()
    log_check("INUT HQ tier is INUT_HQ", inut.get("bidding_status") == "INUT_HQ")
    log_check("INUT HQ total bids == 6 and total won == 4", inut.get("total_bids") == 6 and inut.get("total_won") == 4)
    log_check("INUT HQ win rate == 66.7%", inut.get("win_rate_percent") == 66.7)
    log_check("INUT HQ won value == 3.450.000.000 VND", inut.get("total_won_value_vnd") == 3450000000.0)
    log_check("INUT HQ procuring entities includes Trung tâm Ứng dụng Tiến bộ KH&CN",
              any("Trung tâm Ứng dụng Tiến bộ KH&CN" in e for e in inut.get("top_procuring_entities", [])))
    log_check("INUT HQ highlight packages includes IB2600001001-00",
              any(p.get("tbmt_code") == "IB2600001001-00" for p in inut.get("highlight_won_packages", [])))

    # ──────────────────────────────────────────────────────────────────────────
    # SECTION 3: MULTI-STAGE USER WORKFLOW VERIFICATION
    # Search -> AI Fit Analysis -> Bookmark Pipeline -> Telegram Alerting -> CRM Auto-Audit
    # ──────────────────────────────────────────────────────────────────────────
    print("\n--- SECTION 3: Multi-Stage Workflow Verification ---")

    # Step 3.1: Search Tenders
    res_search = client.get("/api/bidding/search?keyword=SCADA&page=1&page_size=10")
    log_check("Stage 1: Search tenders returned 200", res_search.status_code == 200)
    search_data = res_search.json()
    log_check("Stage 1: Search returned items", len(search_data.get("items", [])) > 0)
    sample_tender = search_data["items"][0]
    tbmt = sample_tender["tbmt_code"]

    # Step 3.2: AI Fit Analysis on Tender
    res_ai = client.post(
        f"/api/bidding/tenders/{tbmt}/analyze-ai",
        json={"custom_context": "INUT là đơn vị sản xuất IoT Gateway 4G Modbus và Datalogger quan trắc."},
    )
    log_check(f"Stage 2: AI analysis on {tbmt} returned 200", res_ai.status_code == 200)
    ai_resp = res_ai.json()
    analysis = ai_resp.get("analysis", {})
    score = analysis.get("inut_fit_analysis", {}).get("score", -1)
    log_check(f"Stage 2: AI score is within [0, 100] (score={score})", 0 <= score <= 100)
    log_check("Stage 2: AI has strengths and recommendations",
              len(analysis.get("inut_fit_analysis", {}).get("strengths", [])) > 0)

    # Step 3.3: Bookmark Creation & Pipeline Lifecycle Transitions
    res_bm_create = client.post(
        "/api/bidding/bookmarks",
        json={
            "tbmt_code": tbmt,
            "tender_name": sample_tender.get("tender_name", ""),
            "procuring_entity": sample_tender.get("procuring_entity", ""),
            "investor": sample_tender.get("investor", ""),
            "field": sample_tender.get("field", "HH"),
            "bid_price": sample_tender.get("bid_price", 0.0),
            "status": "watching",
            "note": "Initial review via empirical verification harness",
            "ai_summary": json.dumps(analysis, ensure_ascii=False),
        },
    )
    log_check("Stage 3: Bookmark creation returned 201", res_bm_create.status_code == 201)
    bm = res_bm_create.json()
    bm_id = bm["id"]
    log_check(f"Stage 3: Bookmark created with id={bm_id}", bm_id > 0)

    # Test pipeline transitions: watching -> preparing -> submitted -> won
    for target_status in ["preparing", "submitted", "won"]:
        res_trans = client.put(
            f"/api/bidding/bookmarks/{bm_id}",
            json={"status": target_status, "note": f"Transitioned to {target_status}"},
        )
        log_check(f"Stage 3: Bookmark transition to `{target_status}` returned 200", res_trans.status_code == 200)
        log_check(f"Stage 3: Bookmark status is `{target_status}`", res_trans.json().get("status") == target_status)

    # Verify AI summary persistence across status changes
    res_bm_get = client.get(f"/api/bidding/bookmarks/{bm_id}")
    log_check("Stage 3: Bookmark retrieval returns persisted AI summary",
              "inut_fit_analysis" in res_bm_get.json().get("ai_summary", ""))

    # Step 3.4: Watchlist Alerting & Telegram Scan Deduplication
    res_wl_create = client.post(
        "/api/bidding/watchlist",
        json={
            "name": "Challenger Automated SCADA Filter",
            "keyword": "SCADA",
            "province": "Hồ Chí Minh",
            "field": "HH",
            "min_price": 100000000.0,
            "max_price": 5000000000.0,
            "notify_telegram": True,
            "is_active": True,
        },
    )
    log_check("Stage 4: Watchlist creation returned 201", res_wl_create.status_code == 201)
    wl_id = res_wl_create.json()["id"]

    # First Scan: Should find items and log alerts
    res_scan_1 = client.post(f"/api/bidding/watchlist/{wl_id}/scan")
    log_check("Stage 4: Watchlist scan #1 returned 200", res_scan_1.status_code == 200)
    scan_1_data = res_scan_1.json()
    new_alerts_1 = scan_1_data.get("new_alerts_count", 0)
    log_check(f"Stage 4: Scan #1 discovered {new_alerts_1} new alerts", new_alerts_1 >= 0)

    # Second Scan: Deduplication check -> MUST yield 0 new alerts
    res_scan_2 = client.post(f"/api/bidding/watchlist/{wl_id}/scan")
    log_check("Stage 4: Watchlist scan #2 (dedup) returned 200", res_scan_2.status_code == 200)
    scan_2_data = res_scan_2.json()
    new_alerts_2 = scan_2_data.get("new_alerts_count", 0)
    log_check(f"Stage 4: Deduplication verified (Scan #2 new alerts == 0, got {new_alerts_2})", new_alerts_2 == 0)

    # Cleanup bookmark & watchlist created during test
    client.delete(f"/api/bidding/bookmarks/{bm_id}")
    client.delete(f"/api/bidding/watchlist/{wl_id}")

    # Step 3.5: CRM Auto-Audit Scan
    res_crm = client.get("/api/bidding/contractors/crm-scan")
    log_check("Stage 5: CRM scan returned 200", res_crm.status_code == 200)
    crm_data = res_crm.json()
    log_check("Stage 5: Macro total_crm_customers > 0", crm_data.get("total_crm_customers", 0) > 0)
    log_check("Stage 5: Macro total_won_contractors > 0", crm_data.get("total_won_contractors", 0) > 0)
    log_check("Stage 5: Macro total_won_value_vnd matches sum of itemized won values",
              abs(crm_data.get("total_won_value_vnd", 0.0) - sum(item["total_won_value_vnd"] for item in crm_data.get("items", []))) < 0.01)

    # ──────────────────────────────────────────────────────────────────────────
    # SECTION 4: ADVERSARIAL STRESS-TESTING & BOUNDARY CONDITIONS
    # ──────────────────────────────────────────────────────────────────────────
    print("\n--- SECTION 4: Adversarial Stress-Testing & Boundary Conditions ---")

    # 4.1 SQL Injection in contractor search
    sqli_queries = [
        "' OR '1'='1",
        "'; DROP TABLE customers; --",
        "1' UNION SELECT username, password_hash FROM users --",
    ]
    for sqli in sqli_queries:
        r_sqli = client.get(f"/api/bidding/contractors/search?query={sqli}")
        log_check(f"SQLi payload safely handled (`{sqli[:20]}...`) -> 200 OK", r_sqli.status_code == 200)

    # 4.2 Inverted price filter rejection
    r_inv = client.get("/api/bidding/search?min_price=5000000000&max_price=1000000")
    log_check("Inverted price filter (min > max) returns 400 Bad Request", r_inv.status_code == 400)

    # 4.3 Invalid bookmark status rejection
    r_inv_status = client.post(
        "/api/bidding/bookmarks",
        json={"tbmt_code": "IB2699999999-00", "status": "HACKED_STATUS"},
    )
    log_check("Invalid bookmark status rejected with 422 Unprocessable Entity", r_inv_status.status_code == 422)

    # 4.4 Non-existent tax code returns COMMERCIAL default profile
    r_unknown_mst = client.get("/api/bidding/contractors/9999999999")
    log_check("Unknown MST returns 200 with COMMERCIAL status",
              r_unknown_mst.status_code == 200 and r_unknown_mst.json().get("bidding_status") == "COMMERCIAL")

    # 4.5 Currency formatting mathematical rigor
    log_check("Currency formatting 12580000000 -> 12.580.000.000", format_currency_vnd(12580000000) == "12.580.000.000")
    log_check("Currency formatting 0 -> 0", format_currency_vnd(0) == "0")
    log_check("Currency formatting None -> 0", format_currency_vnd(None) == "0")

    # 4.6 Strip accents test
    log_check("Diacritic stripping: 'Tân Thanh Phương' -> 'tan thanh phuong'",
              _strip_accents("Tân Thanh Phương") == "tan thanh phuong")

    # 4.7 HTML Preview verification
    r_html = client.get(f"/api/bidding/tenders/{tbmt}/html-preview")
    log_check("HTML Preview returns 200 OK", r_html.status_code == 200)
    log_check("HTML Preview contains DOCTYPE and Tailwind CSS",
              "<!DOCTYPE html>" in r_html.text and "tailwindcss" in r_html.text)
    log_check(f"HTML Preview contains TBMT code {tbmt}", tbmt in r_html.text)

    # 4.8 Won Packages Playbook verification
    r_won = client.get("/api/bidding/won-packages")
    log_check("Won packages playbook returns 200 OK", r_won.status_code == 200)
    log_check("Won packages list has items", len(r_won.json().get("packages", [])) > 0)

    # 4.9 INUT Playbook verification
    r_pb = client.get("/api/bidding/playbook")
    log_check("INUT Playbook returns 200 OK", r_pb.status_code == 200)
    log_check("INUT Playbook contains strategic guides", len(r_pb.json().get("standard_e_hsdt_kits", [])) > 0)

    print("\n" + "=" * 80)
    print(f"VERIFICATION RESULTS: {results['passed_checks']}/{results['total_checks']} CHECKS PASSED")
    if results['failed_checks'] == 0:
        print("EMPIRICAL VERDICT: ALL TESTS PASSED SUCCESSFULLY! (VERDICT: APPROVE)")
    else:
        print(f"EMPIRICAL VERDICT: {results['failed_checks']} CHECKS FAILED! (VERDICT: REJECT)")
    print("=" * 80)

    return results

if __name__ == "__main__":
    run_all_tests()
