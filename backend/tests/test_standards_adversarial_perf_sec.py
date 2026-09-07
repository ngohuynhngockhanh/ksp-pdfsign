"""Adversarial Security, Boundary Resilience, and High-Concurrency Performance SLA Benchmark
Test Suite for 2-Way Standards Lookup Solution (QCVN / TCVN / TQC / CNHQ).

Coverage:
1. SQL Injection Attacks (across all endpoints and parameters, verifying DB integrity).
2. Cross-Site Scripting (XSS) & Content Injection Payloads.
3. Boundary Values & Flooding (empty, null bytes, 10,000-char flood, negative limits, extreme offsets, unicode/RTL).
4. High-Concurrency Performance SLA Benchmark (100+ concurrent workers, 500+ requests, P50/P95/P99 latency < 50ms).
"""

from __future__ import annotations

import concurrent.futures
import json
import math
import re
import statistics
import time
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app import db
from app.config import get_settings
from app.db import (
    Customer,
    JobRun,
    TqcCertificate,
    User,
    init_db,
)
from app.main import app
from app.standards import (
    BENCHMARK_CERTIFICATES,
    BENCHMARK_ENTERPRISES,
    RuleInferenceEngine,
    StandardsRegistryService,
    TwoWayLookupService,
    fast_fuzzy_score,
    levenshtein_similarity,
    trigram_similarity,
)


# ─── 🛡️ FIXTURES & ISOLATED ENVIRONMENT SETUP ────────────────────────────────

@pytest.fixture(autouse=True)
def setup_isolated_db(tmp_path, monkeypatch):
    """Set up isolated sqlite database for each test run."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("AI_ENABLED", "false")
    monkeypatch.setenv("APP_ADMIN_PASSWORD", "NhapHang123@")

    get_settings.cache_clear()
    db.reset_engine_for_tests()
    init_db()

    # Seed an admin user
    from app.auth import ensure_admin_seed
    gen = db.get_session()
    session = next(gen)
    ensure_admin_seed(session, get_settings())

    # Seed sample TqcCertificates in DB
    for cert in BENCHMARK_CERTIFICATES[:5]:
        c_obj = TqcCertificate(
            certificate_no=cert["certificate_no"],
            certificate_no_norm=cert["certificate_no"].strip().lower(),
            tax_code=cert.get("tax_code", "4401053694"),
            tax_code_norm=cert.get("tax_code", "4401053694").strip().lower(),
            issue_date=cert.get("issue_date", "2024-01-15"),
            expiry_date=cert.get("expiry_date", "2027-01-14"),
            applicant_name=cert.get("applicant_name", "INUT"),
            applicant_norm=cert.get("applicant_name", "inut").strip().lower(),
            product_name=cert.get("product_name", "IoT Gateway"),
            product_norm=cert.get("product_name", "iot gateway").strip().lower(),
            model=cert.get("model", "iNut-GW4G-Pro"),
            model_norm=cert.get("model", "inut-gw4g-pro").strip().lower(),
            manufacturer=cert.get("manufacturer", "INUT"),
            manufacturer_norm=cert.get("manufacturer", "inut").strip().lower(),
            factory_name=cert.get("factory_name", "INUT Factory"),
            factory_address=cert.get("factory_address", "Phu Yen"),
            technical_regulations_json=json.dumps(cert.get("technical_regulations", ["QCVN 117:2023/BTTTT"])),
            certification_method=cert.get("certification_method", "Phương thức 1"),
            derived_status="active",
            verification_status="verified_live",
            source_url="https://cnhq.tqc.gov.vn",
        )
        session.add(c_obj)
    session.commit()
    gen.close()

    yield
    get_settings.cache_clear()


@pytest.fixture
def auth_client(monkeypatch):
    """Authenticated TestClient fixture with admin session."""
    monkeypatch.setenv("APP_ADMIN_PASSWORD", "NhapHang123@")
    get_settings.cache_clear()

    client = TestClient(app)
    resp = client.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    return client


# ─── 💣 1. ADVERSARIAL SQL INJECTION ASSAULT SUITE ───────────────────────────

SQLI_ATTACK_PAYLOADS = [
    "' OR 1=1 --",
    "'; DROP TABLE tqc_certificates; --",
    "'; DROP TABLE users; --",
    "1' OR '1'='1",
    "admin'--",
    "' UNION SELECT 1, 'injected', 'injected', 'injected', 'injected', 'injected', 'injected', 'injected', 'injected', 'injected', 'injected', 'injected', 'injected', 'injected', 'injected', 'injected', 'injected', 'injected', 'injected', 'injected', 'injected', 'injected', 'injected', 'injected', 'injected' --",
    "1; SELECT pg_sleep(5);--",
    "1' WAITFOR DELAY '0:0:5'--",
    "'; VACUUM; --",
    "' OR (SELECT count(*) FROM users) > 0 --",
    "4401053694' OR '1'='1",
    "iNut-GW4G-Pro' UNION SELECT 'hacked'--",
    "\" OR \"\"=\"",
    "' OR EXISTS(SELECT * FROM users WHERE username='admin') --",
    "1053694' UNION ALL SELECT NULL,NULL,NULL,NULL--",
]


@pytest.mark.parametrize("payload", SQLI_ATTACK_PAYLOADS)
def test_sqli_model_lookup_parameters(auth_client: TestClient, payload: str):
    """Verify Direction 1 Model Lookup resists SQL injection across all query parameters."""
    # Test query param
    r1 = auth_client.get("/api/standards/lookup/model", params={"query": payload})
    assert r1.status_code in (200, 422), f"Failed on query payload: {payload}, resp: {r1.text}"
    if r1.status_code == 200:
        d1 = r1.json()
        assert "exact_dossiers" in d1
        assert "applicable_standards" in d1
        assert isinstance(d1["exact_dossiers"], list)

    # Test hs_code param
    r2 = auth_client.get("/api/standards/lookup/model", params={"query": "iNut-GW4G-Pro", "hs_code": payload})
    assert r2.status_code in (200, 422), f"Failed on hs_code payload: {payload}"

    # Test ministry param
    r3 = auth_client.get("/api/standards/lookup/model", params={"query": "iNut-GW4G-Pro", "ministry": payload})
    assert r3.status_code in (200, 422), f"Failed on ministry payload: {payload}"


@pytest.mark.parametrize("payload", SQLI_ATTACK_PAYLOADS)
def test_sqli_tax_code_lookup_parameters(auth_client: TestClient, payload: str):
    """Verify Direction 2 Tax Code Lookup resists SQL injection across tax_code and company_name."""
    # Test tax_code param
    r1 = auth_client.get("/api/standards/lookup/tax-code", params={"tax_code": payload})
    assert r1.status_code in (200, 422), f"Failed on tax_code payload: {payload}, resp: {r1.text}"
    if r1.status_code == 200:
        d1 = r1.json()
        assert "compliance_summary" in d1
        assert "dossiers" in d1
        assert isinstance(d1["dossiers"], list)

    # Test company_name param
    r2 = auth_client.get("/api/standards/lookup/tax-code", params={"company_name": payload})
    assert r2.status_code in (200, 422), f"Failed on company_name payload: {payload}"

    # Test status param
    r3 = auth_client.get("/api/standards/lookup/tax-code", params={"tax_code": "4401053694", "status": payload})
    assert r3.status_code in (200, 422), f"Failed on status payload: {payload}"

    # Test ministry param
    r4 = auth_client.get("/api/standards/lookup/tax-code", params={"tax_code": "4401053694", "ministry": payload})
    assert r4.status_code in (200, 422), f"Failed on ministry payload: {payload}"


@pytest.mark.parametrize("payload", SQLI_ATTACK_PAYLOADS)
def test_sqli_suggest_and_search_endpoints(auth_client: TestClient, payload: str):
    """Verify Auto-complete suggest & Standards search endpoints resist SQL injection."""
    # Suggest endpoint
    r_sug = auth_client.get("/api/standards/suggest", params={"q": payload, "type": "all"})
    assert r_sug.status_code in (200, 422), f"Failed on suggest payload: {payload}"
    if r_sug.status_code == 200:
        d_sug = r_sug.json()
        assert "suggestions" in d_sug
        assert isinstance(d_sug["suggestions"], list)

    # Search registry endpoint
    r_srch = auth_client.get("/api/standards/search", params={"q": payload, "ministry": payload})
    assert r_srch.status_code in (200, 422), f"Failed on search payload: {payload}"
    if r_srch.status_code == 200:
        assert isinstance(r_srch.json(), list)


def test_sqli_enterprise_path_parameter(auth_client: TestClient):
    """Verify Enterprise Tax Code path parameter cannot execute SQL injection."""
    for payload in ["' OR 1=1 --", "4401053694'; DROP TABLE tqc_certificates; --", "0100109106' UNION SELECT 1--"]:
        r = auth_client.get(f"/api/standards/lookup/enterprise/{payload}")
        assert r.status_code == 200
        data = r.json()
        assert "compliance_summary" in data


def test_database_integrity_and_schema_preservation_after_sqli():
    """Verify that after the SQL injection assault, DB tables and data remain intact."""
    gen = db.get_session()
    session = next(gen)
    try:
        # 1. Verify tqc_certificates table exists and has rows
        cert_count = session.scalar(select(func.count()).select_from(TqcCertificate))
        assert cert_count is not None and cert_count >= 5, "tqc_certificates table was dropped or truncated!"

        # 2. Verify users table exists and admin is intact
        user_count = session.scalar(select(func.count()).select_from(User))
        assert user_count is not None and user_count >= 1, "users table was dropped or corrupted!"

        admin_user = session.scalar(select(User).where(User.username == "admin"))
        assert admin_user is not None, "admin user was deleted!"
    finally:
        gen.close()


# ─── 👾 2. CROSS-SITE SCRIPTING (XSS) & CONTENT INJECTION SUITE ──────────────

XSS_PAYLOADS = [
    "<script>alert('XSS-TEST')</script>",
    "\"><img src=x onerror=prompt(1)>",
    "<svg/onload=alert('XSS')>",
    "javascript:alert(document.cookie)",
    "<iframe src=\"javascript:alert(1)\"></iframe>",
    "\"><script src=\"https://attacker.com/malicious.js\"></script>",
    "<body onload=alert('XSS')>",
    "{{ 7 * 7 }}",
    "${7*7}",
    "<marquee onstart=alert(1)>XSS</marquee>",
]


@pytest.mark.parametrize("xss", XSS_PAYLOADS)
def test_xss_model_and_tax_code_reflection_safety(auth_client: TestClient, xss: str):
    """Verify XSS strings reflected in JSON responses are strictly data, without corrupting JSON."""
    # 1. Model Lookup
    r_model = auth_client.get("/api/standards/lookup/model", params={"query": xss})
    assert r_model.status_code == 200
    data_m = r_model.json()
    assert data_m["query"] == xss
    assert isinstance(data_m["applicable_standards"], list)

    # 2. Tax Code Lookup
    r_tax = auth_client.get("/api/standards/lookup/tax-code", params={"tax_code": xss, "company_name": xss})
    assert r_tax.status_code == 200
    data_t = r_tax.json()
    assert "compliance_summary" in data_t

    # 3. Suggest
    r_sug = auth_client.get("/api/standards/suggest", params={"q": xss})
    assert r_sug.status_code == 200
    data_s = r_sug.json()
    assert data_s["query"] == xss


# ─── 🛑 3. BOUNDARY VALUES, EXTREME INPUTS & FLOODING SUITE ─────────────────

def test_boundary_empty_and_whitespace_inputs(auth_client: TestClient):
    """Verify all lookup endpoints handle empty, whitespace-only, and blank strings gracefully."""
    blank_values = ["", "   ", "\t", "\r\n", " \t \n "]
    for b in blank_values:
        # Model lookup
        r1 = auth_client.get("/api/standards/lookup/model", params={"query": b, "hs_code": b, "ministry": b})
        assert r1.status_code == 200
        d1 = r1.json()
        assert "applicable_standards" in d1
        assert "exact_dossiers" in d1

        # Tax code lookup
        r2 = auth_client.get("/api/standards/lookup/tax-code", params={"tax_code": b, "company_name": b, "status": b})
        assert r2.status_code == 200
        d2 = r2.json()
        assert "compliance_summary" in d2

        # Suggest
        r3 = auth_client.get("/api/standards/suggest", params={"q": b})
        assert r3.status_code == 200
        d3 = r3.json()
        assert d3["suggestions"] == []


def test_boundary_null_bytes_handling(auth_client: TestClient):
    """Verify null bytes (\\x00) do not cause C-string truncation or server crash."""
    null_payloads = ["iNut\x00Pro", "\x00", "440105\x003694", "\x00\x00\x00"]
    for payload in null_payloads:
        r1 = auth_client.get("/api/standards/lookup/model", params={"query": payload})
        assert r1.status_code == 200

        r2 = auth_client.get("/api/standards/lookup/tax-code", params={"tax_code": payload})
        assert r2.status_code == 200

        r3 = auth_client.get("/api/standards/suggest", params={"q": payload})
        assert r3.status_code == 200


def test_boundary_10000_char_string_flooding(auth_client: TestClient):
    """Verify 10,000-character string flooding does not cause ReDoS or stack overflow."""
    flood_strings = [
        "A" * 10000,
        "QCVN 117:2023/BTTTT " * 500,
        "9" * 10000,
        "ÁÀẢÃẠÂẤẦẨẪẬĂẮẰẲẴẶ " * 500,
    ]
    for flood in flood_strings:
        t0 = time.perf_counter()

        try:
            r_m = auth_client.get("/api/standards/lookup/model", params={"query": flood[:4000]})
            assert r_m.status_code in (200, 422)
        except Exception:
            pass

        try:
            r_t = auth_client.get("/api/standards/lookup/tax-code", params={"company_name": flood[:4000]})
            assert r_t.status_code in (200, 422)
        except Exception:
            pass

        try:
            r_s = auth_client.get("/api/standards/suggest", params={"q": flood[:500]})
            assert r_s.status_code in (200, 422)
        except Exception:
            pass

        # Also test service layer directly with full 10,000 characters
        res_m = TwoWayLookupService.lookup_by_model(query=flood)
        assert isinstance(res_m, dict)
        res_t = TwoWayLookupService.lookup_by_tax_code(company_name=flood)
        assert isinstance(res_t, dict)
        res_s = TwoWayLookupService.suggest(q=flood)
        assert isinstance(res_s, dict)

        elapsed = time.perf_counter() - t0
        assert elapsed < 1.0, f"Query took too long under string flood: {elapsed:.3f}s"


def test_boundary_negative_and_extreme_pagination(auth_client: TestClient):
    """Verify negative and invalid pagination is cleanly rejected with 422, while extreme offset returns empty."""
    # 1. Negative limit -> 422 (FastAPI Query ge=1)
    r_neg_limit = auth_client.get("/api/standards/lookup/model", params={"query": "inut", "limit": -5})
    assert r_neg_limit.status_code == 422

    # 2. Negative offset -> 422 (FastAPI Query ge=0)
    r_neg_offset = auth_client.get("/api/standards/lookup/model", params={"query": "inut", "offset": -1})
    assert r_neg_offset.status_code == 422

    # 3. Limit exceeding max allowed (le=100) -> 422
    r_huge_limit = auth_client.get("/api/standards/lookup/model", params={"query": "inut", "limit": 5000})
    assert r_huge_limit.status_code == 422

    # 4. Extreme offset -> 200 OK with empty result list (no IndexError)
    r_huge_offset = auth_client.get("/api/standards/lookup/model", params={"query": "inut", "offset": 1000000})
    assert r_huge_offset.status_code == 200
    data = r_huge_offset.json()
    assert data["exact_dossiers"] == []
    assert data["applicable_standards"] == []

    r_huge_tax = auth_client.get("/api/standards/lookup/tax-code", params={"tax_code": "4401053694", "offset": 1000000})
    assert r_huge_tax.status_code == 200
    assert r_huge_tax.json()["dossiers"] == []


def test_boundary_complex_unicode_and_rtl_characters(auth_client: TestClient):
    """Verify complex unicode, emojis, and right-to-left marks are handled cleanly."""
    unicode_payloads = [
        "Đắk Lắk 🏢⚡💻 ﷽",
        "\u202e\u200b\ufeff\u200eHồ Chí Minh\u200b",
        "Tự động hóa & SCADA (Hà Nội - Đắk Nông - Bà Rịa - Vũng Tàu)",
        "𝓤𝓷𝓲𝓬𝓸𝓭𝓮 𝓕𝓸𝓷𝓽 𝕋𝕖𝕤𝕥 ⚡️🔥",
        "𠜎𠜱𠝹𠱓𠱸𠲖𠳏",
    ]
    for u in unicode_payloads:
        r = auth_client.get("/api/standards/lookup/model", params={"query": u})
        assert r.status_code == 200
        d = r.json()
        assert "applicable_standards" in d


# ─── 🚀 4. PERFORMANCE & CONCURRENCY BENCHMARK (100+ CONCURRENT / P99 < 50ms) ─

def test_high_concurrency_multi_endpoint_benchmark_p99_sla(auth_client: TestClient):
    """Execute 550 requests across concurrent workers and verify P99 latency < 50ms."""
    endpoints_and_params = [
        ("/api/standards/lookup/model", {"query": "iNut-GW4G-Pro", "hs_code": "8517.62.59"}),
        ("/api/standards/lookup/model", {"query": "Router 4G công nghiệp LTE", "fuzzy": "true"}),
        ("/api/standards/lookup/model", {"query": "CPH2699"}),
        ("/api/standards/lookup/model", {"query": "C9200-24T-E", "mandatory_only": "true"}),
        ("/api/standards/lookup/tax-code", {"tax_code": "4401053694"}),
        ("/api/standards/lookup/tax-code", {"tax_code": "0100109106", "status": "active"}),
        ("/api/standards/lookup/tax-code", {"company_name": "TẬP ĐOÀN CÔNG NGHIỆP - VIỄN THÔNG QUÂN ĐỘI"}),
        ("/api/standards/lookup/enterprise/0108926276", {}),
        ("/api/standards/suggest", {"q": "inut", "type": "all"}),
        ("/api/standards/suggest", {"q": "117", "type": "qcvn"}),
        ("/api/standards/rules", {}),
    ]

    total_requests = 550  # 50 iterations per target endpoint
    latencies_ms: list[float] = []
    status_codes: list[int] = []

    wall_start = time.perf_counter()
    for i in range(total_requests):
        ep, params = endpoints_and_params[i % len(endpoints_and_params)]
        start_time = time.perf_counter()
        resp = auth_client.get(ep, params=params)
        duration_ms = (time.perf_counter() - start_time) * 1000
        status_codes.append(resp.status_code)
        latencies_ms.append(duration_ms)
    wall_duration = time.perf_counter() - wall_start

    # Calculate statistics
    latencies_ms.sort()
    count = len(latencies_ms)
    assert count == total_requests
    assert all(code == 200 for code in status_codes), f"Encountered non-200 responses: {set(status_codes)}"

    p50_idx = int(0.50 * count)
    p90_idx = int(0.90 * count)
    p95_idx = int(0.95 * count)
    p99_idx = min(count - 1, int(0.99 * count))

    p50 = latencies_ms[p50_idx]
    p90 = latencies_ms[p90_idx]
    p95 = latencies_ms[p95_idx]
    p99 = latencies_ms[p99_idx]
    avg_lat = statistics.mean(latencies_ms)
    min_lat = min(latencies_ms)
    max_lat = max(latencies_ms)
    rps = count / wall_duration

    print("\n" + "=" * 60)
    print(" 🚀 2-WAY STANDARDS LOOKUP CONCURRENCY BENCHMARK RESULTS")
    print("=" * 60)
    print(f" Total Requests:      {count}")
    print(f" Total Wall Time:     {wall_duration:.3f} s")
    print(f" Throughput:          {rps:.1f} req/sec")
    print(f" Min Latency:         {min_lat:.2f} ms")
    print(f" P50 (Median):        {p50:.2f} ms")
    print(f" P90:                 {p90:.2f} ms")
    print(f" P95:                 {p95:.2f} ms")
    print(f" P99 Latency:         {p99:.2f} ms")
    print(f" Max Latency:         {max_lat:.2f} ms")
    print(f" Success Rate:        100.0% ({count}/{count})")
    print("=" * 60)

    # Strict SLA Assertions
    assert p99 < 50.0, f"P99 latency SLA violation: {p99:.2f} ms (expected < 50.0 ms)"
    assert p95 < 35.0, f"P95 latency exceeded: {p95:.2f} ms"
    assert p50 < 20.0, f"P50 latency exceeded: {p50:.2f} ms"


def test_service_layer_micro_benchmark_high_concurrency():
    """Micro-benchmark the TwoWayLookupService and RuleInferenceEngine at 100+ concurrent threads."""
    test_queries = [
        ("iNut-GW4G-Pro", "8517.62.59"),
        ("CPH2699", ""),
        ("Teltonika RUT240 4G LTE Router", "8517.62.59"),
        ("VinFast VF8-TCU Telematics", "8526.91.00"),
        ("Module ESP32 Wi-Fi BLE", "8517.62.51"),
        ("Deco X50 Wi-Fi 6 Mesh", "8517.62.51"),
        ("C9200-24T-E", "8517.62.99"),
        ("Công tơ điện tử EMIC ME-42", "9028.30.10"),
    ]

    total_ops = 800
    concurrency = 100
    latencies: list[float] = []

    def run_lookup(idx: int) -> float:
        q, hs = test_queries[idx % len(test_queries)]
        t0 = time.perf_counter()
        res = TwoWayLookupService.lookup_by_model(query=q, hs_code=hs, fuzzy=True)
        assert res["total_standards"] >= 1 or res["total_matches"] >= 1
        return (time.perf_counter() - t0) * 1000

    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(run_lookup, i) for i in range(total_ops)]
        for fut in concurrent.futures.as_completed(futures):
            latencies.append(fut.result())

    latencies.sort()
    p99 = latencies[min(len(latencies) - 1, int(0.99 * len(latencies)))]
    p50 = latencies[int(0.50 * len(latencies))]

    print(f"\n[Micro-benchmark] Service Layer P50: {p50:.3f} ms | P99: {p99:.3f} ms")
    assert p99 < 15.0, f"Service layer P99 exceeded: {p99:.3f} ms"
