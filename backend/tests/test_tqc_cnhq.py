from __future__ import annotations

import csv
import io
import json
import time

import httpx
import pytest


def test_normalize_certificate_and_parse_technical_regulations():
    from app.tqc_cnhq import normalize_certificate

    row = normalize_certificate(
        {
            "so_giay_chung_nhan": " C0955191224AE15A3 ",
            "ngay_cap_giay_chung_nhan": "2024-12-18T17:00:00.000Z",
            "don_vi_nop_ho_so_vn": "CÔNG TY INUT",
            "ten_san_pham_vn": "Thiết bị IoT",
            "ky_hieu": "T27G16",
            "ten_hang_san_xuat_vn": "TOMKO",
            "quy_chuan_ky_thuat": '["QCVN 54:2020/BTTTT"]',
            "tinh_trang_giay_chung_nhan": "còn hiệu lực",
        }
    )

    assert row["certificate_no"] == "C0955191224AE15A3"
    assert row["model"] == "T27G16"
    assert row["technical_regulations"] == ["QCVN 54:2020/BTTTT"]
    assert row["source_status"] == "còn hiệu lực"


def test_decode_official_qr_payload_round_trip():
    from app.tqc_cnhq import decode_qr_input

    # Fixed-salt fixture generated with TQC's public CryptoJS passphrase scheme.
    payload = "U2FsdGVkX18xMjM0NTY3OGKIDo1mOKsbveWEoE-jdUeJiZeNKRdqXHtlyYL5sby6"
    assert decode_qr_input(f"https://data-cnhq.tqc.gov.vn/?q={payload}") == "C0955191224AE15A3"
    assert decode_qr_input("C0955191224AE15A3") == "C0955191224AE15A3"


def test_client_calls_public_exact_endpoint_and_normalizes_response():
    from app.tqc_cnhq import TqcCnhqClient

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://api-cnhq.tqc.gov.vn/api/search/C0955191224AE15A3"
        assert "x-api-key" not in request.headers
        return httpx.Response(
            200,
            json={
                "success": True,
                "data": {
                    "so_giay_chung_nhan": "C0955191224AE15A3",
                    "ky_hieu": "CPH2699",
                    "quy_chuan_ky_thuat": '["QCVN 117:2023/BTTTT"]',
                },
            },
        )

    client = TqcCnhqClient(transport=httpx.MockTransport(handler))
    try:
        result = client.lookup("C0955191224AE15A3")
    finally:
        client.close()
    assert result["certificate_no"] == "C0955191224AE15A3"
    assert result["model"] == "CPH2699"
    assert result["provenance"]["verification_status"] == "verified_live"


def test_client_maps_not_found_without_retry():
    from app.tqc_cnhq import TqcCnhqClient

    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json={"success": False, "error": "NOT_FOUND"})

    client = TqcCnhqClient(transport=httpx.MockTransport(handler))
    try:
        result = client.lookup("T27G16")
    finally:
        client.close()
    assert result is None
    assert len(calls) == 1


@pytest.mark.parametrize(
    ("status_code", "expected_code"),
    [(401, "api_key_rejected"), (429, "upstream_retryable"), (503, "upstream_retryable")],
)
def test_client_maps_upstream_failures(status_code, expected_code):
    from app.tqc_cnhq import TqcCnhqClient, TqcCnhqError

    client = TqcCnhqClient(
        base_url=f"https://failure-{status_code}.example",
        transport=httpx.MockTransport(lambda request: httpx.Response(status_code, json={})),
    )
    try:
        with pytest.raises(TqcCnhqError) as caught:
            client.lookup("C0955191224AE15A3")
    finally:
        client.close()
    assert caught.value.code == expected_code


def test_client_rejects_malformed_success_payload():
    from app.tqc_cnhq import TqcCnhqClient, TqcCnhqError

    client = TqcCnhqClient(
        base_url="https://malformed.example",
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"success": True, "data": []})),
    )
    try:
        with pytest.raises(TqcCnhqError) as caught:
            client.lookup("C0955191224AE15A3")
    finally:
        client.close()
    assert caught.value.code == "invalid_upstream_response"


def test_client_maps_non_json_success_body_to_safe_upstream_error():
    from app.tqc_cnhq import TqcCnhqClient, TqcCnhqError

    client = TqcCnhqClient(
        base_url="https://non-json.example",
        transport=httpx.MockTransport(lambda request: httpx.Response(200, text="<html>maintenance</html>")),
    )
    try:
        with pytest.raises(TqcCnhqError) as caught:
            client.lookup("C0955191224AE15A3")
    finally:
        client.close()
    assert caught.value.code == "invalid_upstream_response"
    assert caught.value.status == 502


def test_rate_limit_is_shared_across_client_instances():
    from app import tqc_cnhq
    from app.tqc_cnhq import TqcCnhqClient, TqcCnhqError

    tqc_cnhq._RATE_LIMIT_WINDOWS.pop("https://rate-limit.example", None)
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"success": False, "error": "NOT_FOUND"}))
    first = TqcCnhqClient(base_url="https://rate-limit.example", rate_limit_per_minute=1, transport=transport)
    second = TqcCnhqClient(base_url="https://rate-limit.example", rate_limit_per_minute=1, transport=transport)
    try:
        assert first.lookup("C0955191224AE15A3") is None
        with pytest.raises(TqcCnhqError, match="giới hạn"):
            second.lookup("C0955191224AE15A4")
    finally:
        first.close()
        second.close()


def test_background_client_waits_for_next_rate_limit_window(monkeypatch):
    from app import tqc_cnhq
    from app.tqc_cnhq import TqcCnhqClient

    state = {"now": 0.0}
    monkeypatch.setattr(tqc_cnhq.time, "monotonic", lambda: state["now"])
    monkeypatch.setattr(tqc_cnhq.time, "sleep", lambda seconds: state.update(now=state["now"] + seconds))
    tqc_cnhq._RATE_LIMIT_WINDOWS.pop("https://wait-rate-limit.example", None)
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"success": False, "error": "NOT_FOUND"}))
    first = TqcCnhqClient(base_url="https://wait-rate-limit.example", rate_limit_per_minute=1, transport=transport)
    background = TqcCnhqClient(
        base_url="https://wait-rate-limit.example",
        rate_limit_per_minute=1,
        wait_on_rate_limit=True,
        transport=transport,
    )
    try:
        assert first.lookup("C0955191224AE15A3") is None
        assert background.lookup("C0955191224AE15A4") is None
    finally:
        first.close()
        background.close()
    assert state["now"] == pytest.approx(60.0)


def test_index_search_is_accent_neutral_and_reports_local_scope(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from app import db
    from app.config import get_settings
    from app.tqc_cnhq import search_index, upsert_certificate

    get_settings.cache_clear()
    db.reset_engine_for_tests()
    db.init_db()
    session = next(db.get_session())
    try:
        upsert_certificate(
            session,
            {
                "so_giay_chung_nhan": "C0955191224AE15A3",
                "don_vi_nop_ho_so_vn": "CÔNG TY CỔ PHẦN DI ĐỘNG THÔNG MINH",
                "ten_san_pham_vn": "Thiết bị đầu cuối",
                "ky_hieu": "CPH2699",
                "ten_hang_san_xuat_vn": "OPPO",
                "quy_chuan_ky_thuat": "[]",
                "tinh_trang_giay_chung_nhan": "còn hiệu lực",
            },
            verification_status="verified_cached",
        )
        result = search_index(session, q="di dong thong minh")
    finally:
        session.close()

    assert result["search_scope"] == "local_index"
    assert result["items"][0]["model"] == "CPH2699"
    assert result["items"][0]["provenance"]["verification_status"] == "verified_cached"


def test_index_recomputes_expiry_and_valid_on_uses_vietnam_calendar_dates(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from app import db
    from app.config import get_settings
    from app.tqc_cnhq import search_index, upsert_certificate

    get_settings.cache_clear()
    db.reset_engine_for_tests()
    db.init_db()
    session = next(db.get_session())
    try:
        upsert_certificate(session, {
            "so_giay_chung_nhan": "C0955191224AE15A3",
            "ngay_cap_giay_chung_nhan": "2024-12-18T17:00:00.000Z",
            "ngay_het_han": "2024-12-19T17:00:00.000Z",
            "ky_hieu": "BOUNDARY",
            "quy_chuan_ky_thuat": "[]",
            "tinh_trang_giay_chung_nhan": "còn hiệu lực",
        })
        upsert_certificate(session, {
            "so_giay_chung_nhan": "C0955191224AE15A4",
            "ngay_cap_giay_chung_nhan": "2024-12-18T17:00:00.000Z",
            "ngay_het_han": "2024-12-19T17:00:00.000Z",
            "ky_hieu": "CANCELLED",
            "quy_chuan_ky_thuat": "[]",
            "tinh_trang_giay_chung_nhan": "đã thu hồi",
        })
        utc_day_before = search_index(session, valid_on="2024-12-18")
        issue_day = search_index(session, valid_on="2024-12-19")
        expiry_day = search_index(session, valid_on="2024-12-20")
        expired = search_index(session, status="expired")
    finally:
        session.close()

    assert utc_day_before["total"] == 0
    assert [item["model"] for item in issue_day["items"]] == ["BOUNDARY"]
    assert [item["model"] for item in expiry_day["items"]] == ["BOUNDARY"]
    assert expired["items"][0]["derived_status"] == "expired"


def test_csv_import_schema_is_bounded_and_deduplicated():
    from app.tqc_cnhq import parse_import_csv

    text = "certificate_no,qr_url\nC0955191224AE15A3,\nC0955191224AE15A3,\n"
    rows = parse_import_csv(text)
    assert rows == [{"certificate_no": "C0955191224AE15A3", "qr_input": ""}]


@pytest.fixture
def auth_client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("APP_ADMIN_PASSWORD", "NhapHang123@")
    from app.config import get_settings
    from app import db
    from app.auth import ensure_admin_seed
    from fastapi.testclient import TestClient
    from app.main import app

    get_settings.cache_clear()
    db.reset_engine_for_tests()
    db.init_db()
    session = next(db.get_session())
    ensure_admin_seed(session, get_settings())
    session.close()
    client = TestClient(app)
    assert client.post("/api/login", json={"username": "admin", "password": "NhapHang123@"}).status_code == 200
    return client


def test_tqc_search_and_exact_lookup_use_local_index(auth_client, monkeypatch):
    from app import standards_api
    from app import tqc_cnhq

    raw = {
        "so_giay_chung_nhan": "C0955191224AE15A3",
        "don_vi_nop_ho_so_vn": "CÔNG TY INUT",
        "ten_san_pham_vn": "Thiết bị IoT",
        "ky_hieu": "T27G16",
        "ten_hang_san_xuat_vn": "TOMKO",
        "quy_chuan_ky_thuat": "[]",
        "tinh_trang_giay_chung_nhan": "còn hiệu lực",
    }

    class FakeClient:
        def lookup(self, certificate_no):
            return tqc_cnhq.normalize_certificate(raw, source_url="https://api-cnhq.tqc.gov.vn/api/search/C0955191224AE15A3")

        def close(self):
            pass

    monkeypatch.setattr(standards_api.tqc_cnhq, "get_client", lambda _settings=None, **kwargs: FakeClient())
    response = auth_client.get("/api/standards/tqc/certificates/C0955191224AE15A3")
    assert response.status_code == 200
    assert response.json()["certificate"]["model"] == "T27G16"
    search = auth_client.get("/api/standards/tqc/search", params={"model": "t27g16"})
    assert search.status_code == 200
    assert search.json()["items"][0]["manufacturer"] == "TOMKO"


def test_tqc_import_requires_admin_and_returns_counts(auth_client, monkeypatch):
    from app import standards_api
    from app import tqc_cnhq

    class FakeClient:
        def lookup(self, certificate_no):
            return tqc_cnhq.normalize_certificate({
                "so_giay_chung_nhan": certificate_no,
                "ky_hieu": "CPH2699",
                "quy_chuan_ky_thuat": "[]",
            })

        def close(self):
            pass

    monkeypatch.setattr(standards_api.tqc_cnhq, "get_client", lambda _settings=None: FakeClient())
    response = auth_client.post("/api/standards/tqc/import", json={
        "entries": [{"certificate_no": "C0955191224AE15A3"}],
    })
    assert response.status_code == 200
    body = response.json()
    assert body["verified"] == 1
    assert body["items"][0]["status"] == "verified_live"


def test_tqc_import_rejects_unauthenticated_request(auth_client):
    auth_client.cookies.clear()
    response = auth_client.post("/api/standards/tqc/import", json={
        "entries": [{"certificate_no": "C0955191224AE15A3"}],
    })
    assert response.status_code == 401


def test_tqc_csv_endpoint_runs_500_fresh_rows_as_background_job(auth_client, monkeypatch):
    from app import standards_api
    from app import tqc_cnhq

    class FakeClient:
        def lookup(self, certificate_no):
            return tqc_cnhq.normalize_certificate({
                "so_giay_chung_nhan": certificate_no,
                "ky_hieu": f"MODEL-{certificate_no[-3:]}",
                "quy_chuan_ky_thuat": "[]",
            })

        def close(self):
            pass

    monkeypatch.setattr(standards_api.tqc_cnhq, "get_client", lambda _settings=None, **kwargs: FakeClient())
    content = "certificate_no\n" + "\n".join(f"C0955191224AE{i:03d}" for i in range(500))
    response = auth_client.post(
        "/api/standards/tqc/import/csv",
        files={"file": ("tqc.csv", content.encode(), "text/csv")},
    )
    assert response.status_code == 202
    job_id = response.json()["job_id"]
    observed_progress = []
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        status_response = auth_client.get(f"/api/standards/tqc/import/jobs/{job_id}")
        assert status_response.status_code == 200
        body = status_response.json()
        if 0 < body["progress"] < 100:
            observed_progress.append(body["progress"])
        if body["status"] == "success":
            break
        time.sleep(0.02)
    assert body["status"] == "success"
    assert body["result"]["verified"] == 500
    assert observed_progress
    latest = auth_client.get("/api/standards/tqc/import/jobs/latest")
    assert latest.status_code == 200
    assert latest.json()["job"]["job_id"] == job_id


def test_tqc_csv_running_job_resumes_from_persisted_cursor(auth_client, monkeypatch):
    from app import standards_api
    from app import tqc_cnhq
    from app.db import JobRun, get_session

    class FakeClient:
        def lookup(self, certificate_no):
            return tqc_cnhq.normalize_certificate({
                "so_giay_chung_nhan": certificate_no,
                "ky_hieu": f"MODEL-{certificate_no[-1]}",
                "quy_chuan_ky_thuat": "[]",
            })

        def close(self):
            pass

    monkeypatch.setattr(standards_api.tqc_cnhq, "get_client", lambda _settings=None, **kwargs: FakeClient())
    session_gen = get_session()
    db = next(session_gen)
    job = JobRun(
        kind="tqc_csv_import",
        status="running",
        stats=json.dumps({
            "phase": "running",
            "progress": 50,
            "requested": 2,
            "payload": {
                "entries": [
                    {"certificate_no": "C0955191224AE15A3", "qr_input": ""},
                    {"certificate_no": "C0955191224AE15A4", "qr_input": ""},
                ],
                "refresh_existing": False,
            },
            "cursor": 1,
            "result": {
                "requested": 2, "processed": 1, "verified": 1, "cached": 0,
                "not_found": 0, "errors": [], "items": [{"certificate_no": "C0955191224AE15A3"}],
            },
        }),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    job_id = job.id
    session_gen.close()

    retry_while_running = auth_client.post(f"/api/standards/tqc/import/jobs/{job_id}/retry")
    assert retry_while_running.status_code == 409
    standards_api.resume_tqc_import_jobs()
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        response = auth_client.get(f"/api/standards/tqc/import/jobs/{job_id}")
        if response.json()["status"] == "success":
            break
        time.sleep(0.02)
    assert response.json()["status"] == "success"
    assert response.json()["result"]["verified"] == 2


def test_tqc_csv_retry_waits_until_failed_worker_cleanup(auth_client):
    from app import standards_api
    from app.db import JobRun, get_session

    session_gen = get_session()
    db = next(session_gen)
    job = JobRun(
        kind="tqc_csv_import",
        status="failed",
        error="temporary failure",
        stats=json.dumps({"phase": "running", "progress": 20, "requested": 1, "payload": {"entries": [{}]}}),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    job_id = job.id
    session_gen.close()

    with standards_api._TQC_IMPORT_LOCK:
        standards_api._TQC_IMPORT_ACTIVE.add(job_id)
    try:
        response = auth_client.post(f"/api/standards/tqc/import/jobs/{job_id}/retry")
    finally:
        with standards_api._TQC_IMPORT_LOCK:
            standards_api._TQC_IMPORT_ACTIVE.discard(job_id)
    assert response.status_code == 409
    status_response = auth_client.get(f"/api/standards/tqc/import/jobs/{job_id}")
    assert status_response.json()["status"] == "failed"
