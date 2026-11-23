"""Standardized Backend Security Suite — Auth, Authorization, RBAC & Session Lifecycle.

Covers IEEE-829 test cases:
- TC-SEC-01 (SEC-BE-01): Unauthenticated / cross-contract piecework storage read + disk GC
- TC-SEC-02 (SEC-BE-02): Unauthenticated open corporate email relay (/api/mail/send)
- TC-SEC-06 (SEC-BE-06): Unauthenticated repo-wide markdown & root text disclosure
- TC-SEC-07 (SEC-BE-07): Systemic RBAC matrix (anon / customer / pymid_staff vs admin routes)
- TC-SEC-08 (SEC-BE-08): Random temp customer passwords & enforced must_change_password
- TC-SEC-09 (SEC-BE-09): Loopback admin bypass removal & POST-only Clabel print routes
- TC-SEC-11 (SEC-BE-11): SPX label auth, Hermes eval-report auth, Trademark logo redirect
- TC-SEC-15 (SEC-BE-15): Logout jti revocation, live DB claims, per-user lockout, login-link, /api/health
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import accounts, auth, db as dbmod, storage, tax_ops
from app.config import get_settings
from app.db import AuditLog, IpTrademark, PieceworkContract, User, get_session
from app.main import app
from app.security import hash_password
from tests.test_api import PDF, _login


def _new_anon_client() -> TestClient:
    return TestClient(app)


def _create_user_and_login(
    username: str,
    password: str,
    *,
    role: str = "customer",
    customer_id: int | None = None,
    must_change_password: bool = False,
    training_access: bool = False,
) -> tuple[TestClient, int]:
    gen = get_session()
    db = next(gen)
    try:
        u = User(
            username=username,
            password_hash=hash_password(password),
            role=role,
            customer_id=customer_id,
            must_change_password=must_change_password,
            training_access=training_access,
        )
        db.add(u)
        db.commit()
        db.refresh(u)
        uid = u.id
    finally:
        gen.close()

    c = TestClient(app)
    r = c.post("/api/login", json={"username": username, "password": password})
    assert r.status_code == 200, f"Login failed for {username}: {r.status_code} {r.text}"
    return c, uid


# ---------------------------------------------------------------------------
# TC-SEC-01 (SEC-BE-01): Piecework doc authz, contract scoping & disk GC
# ---------------------------------------------------------------------------
def test_tc_sec_01_piecework_docs_require_admin_or_matching_portal_token(client):
    _login(client)
    # 1. Store an unrelated confidential PDF in shared vault (not linked to piecework)
    up = client.post("/api/documents/upload", files={"file": ("secret-contract.pdf", PDF, "application/pdf")})
    assert up.status_code == 200, up.text
    secret_doc_pk = up.json()["id"]
    secret_doc_id = up.json()["doc_id"]

    # 2. Create two piecework contracts C1 and C2; attach a file + an SVG to C1
    c1 = client.post(
        "/api/piecework/contracts",
        json={
            "contract_code": "SEC01/C1",
            "contract_type": "thi_cong",
            "project_name": "Proj C1",
            "worker_name": "Worker One",
            "worker_id_card": "038091000001",
            "total_amount": 4000000.0,
        },
    ).json()
    c2 = client.post(
        "/api/piecework/contracts",
        json={
            "contract_code": "SEC01/C2",
            "contract_type": "thi_cong",
            "project_name": "Proj C2",
            "worker_name": "Worker Two",
            "worker_id_card": "038091000002",
            "total_amount": 4000000.0,
        },
    ).json()

    att = client.post(
        f"/api/piecework/contracts/{c1['id']}/upload-doc",
        files={"file": ("acceptance.pdf", PDF, "application/pdf")},
        data={"doc_kind": "acceptance"},
    )
    assert att.status_code == 200, att.text
    c1_doc_id = att.json()["doc_id"]

    # Unauthenticated caller cannot read arbitrary vault doc_id or piecework doc_id
    anon = _new_anon_client()
    assert anon.get(f"/api/piecework/docs/{secret_doc_id}/file").status_code in (401, 403)
    assert anon.get(f"/api/piecework/docs/{secret_doc_id}/download").status_code in (401, 403)
    assert anon.get(f"/api/piecework/docs/{c1_doc_id}/file").status_code in (401, 403)

    # Wrong contract portal_token cannot read C1's attachment or arbitrary vault doc
    assert anon.get(f"/api/piecework/docs/{c1_doc_id}/file", params={"token": c2["portal_token"]}).status_code in (401, 403, 404)
    assert anon.get(f"/api/piecework/docs/{secret_doc_id}/file", params={"token": c1["portal_token"]}).status_code in (401, 403, 404)

    # Matching C1 portal_token succeeds with private no-store caching
    ok_tok = anon.get(f"/api/piecework/docs/{c1_doc_id}/file", params={"token": c1["portal_token"]})
    assert ok_tok.status_code == 200
    cc = ok_tok.headers.get("cache-control", "").lower()
    assert "no-store" in cc or "private" in cc

    # Admin session succeeds
    ok_adm = client.get(f"/api/piecework/docs/{c1_doc_id}/file")
    assert ok_adm.status_code == 200

    # SVG forced as attachment (never inline scriptable SVG)
    svg_doc_id = storage.save_upload(b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", suffix=".svg")
    gen = get_session()
    db = next(gen)
    try:
        row = db.get(PieceworkContract, c1["id"])
        row.bank_proof_doc_id = svg_doc_id
        db.commit()
    finally:
        gen.close()
    svg_resp = client.get(f"/api/piecework/docs/{svg_doc_id}/file")
    assert svg_resp.status_code == 200
    assert "attachment" in svg_resp.headers.get("content-disposition", "").lower()

    # Deleting a document garbage-collects the unreferenced disk file
    assert storage.find_doc_path(secret_doc_id) is not None
    del_resp = client.delete(f"/api/documents/{secret_doc_pk}")
    assert del_resp.status_code == 200
    assert storage.find_doc_path(secret_doc_id) is None


# ---------------------------------------------------------------------------
# TC-SEC-02 (SEC-BE-02): /api/mail/send closed to unauth & low-priv callers
# ---------------------------------------------------------------------------
def test_tc_sec_02_mail_send_requires_admin_or_service_auth(client, monkeypatch):
    monkeypatch.setenv("MAIL_API_TOKEN", "mail-secret-token-2026")
    monkeypatch.setenv("MAIL_HMAC_SECRET", "mail-hmac-secret-2026")
    get_settings.cache_clear()

    sent_calls = []
    monkeypatch.setattr(tax_ops, "send_custom_email", lambda *a, **kw: (sent_calls.append((a, kw)), True)[1])

    payload = {"to": "victim@example.com", "subject": "Test", "html": "<b>hello</b>"}

    # 1. Anonymous without Origin header -> 401
    anon = _new_anon_client()
    r_anon = anon.post("/api/mail/send", json=payload)
    assert r_anon.status_code == 401
    assert len(sent_calls) == 0

    # 2. Customer role -> 403
    cust_client, _ = _create_user_and_login("cust_mail", "StrongPass!2026", role="customer")
    r_cust = cust_client.post("/api/mail/send", json=payload)
    assert r_cust.status_code == 403
    assert len(sent_calls) == 0

    # 3. Admin session -> 200 + audit record written
    _login(client)
    r_admin = client.post("/api/mail/send", json=payload)
    assert r_admin.status_code == 200, r_admin.text
    assert len(sent_calls) == 1

    # 4. Ecosystem Bearer token -> 200
    r_tok = anon.post(
        "/api/mail/send",
        json=payload,
        headers={"Authorization": "Bearer mail-secret-token-2026"},
    )
    assert r_tok.status_code == 200, r_tok.text
    assert len(sent_calls) == 2

    gen = get_session()
    db = next(gen)
    try:
        logs = db.query(AuditLog).filter(AuditLog.action.ilike("%mail%")).all()
        assert len(logs) >= 1
    finally:
        gen.close()


# ---------------------------------------------------------------------------
# TC-SEC-06 (SEC-BE-06): Repo-wide Markdown & root file disclosure blocked
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "path",
    [
        "/md/.agent/skills/clabel-ble-print/SKILL.md",
        "/md/README.md",
        "/md/PROJECT.md",
        "/md/backend/app/COMPANY_PROFILE.md",
        "/md/../README.md",
        "/.agent/skills/clabel-ble-print/SKILL.md",
        "/backend/app/COMPANY_PROFILE.md",
        "/README.md",
    ],
)
def test_tc_sec_06_internal_repo_markdown_never_disclosed_unauth(client, path):
    anon = _new_anon_client()
    r = anon.get(path)
    # Must NOT return internal markdown content (404/401/403 or SPA shell without internal doc text)
    if r.status_code == 200:
        body = r.text
        assert "77.88.207.23" not in body
        assert "clabel-ble-print" not in body
        assert "CT221B" not in body
        assert "<!doctype html>" in body.lower() or "<html" in body.lower()
        assert "id=\"root\"" in body
    else:
        assert r.status_code in (401, 403, 404)


def test_tc_sec_06_ksp_linkedin_not_publicly_exposed(client):
    anon = _new_anon_client()
    r = anon.get("/ksp-likeedin.txt")
    assert r.status_code in (401, 403, 404) or ("id=\"root\"" in r.text)


# ---------------------------------------------------------------------------
# TC-SEC-07 (SEC-BE-07): Systemic RBAC Matrix (anon=401, customer=403, pymid_staff=403)
# ---------------------------------------------------------------------------
ADMIN_ONLY_ENDPOINTS = [
    ("GET", "/api/bidding/contractors/crm-scan", None),
    ("GET", "/api/bidding/search", None),
    ("POST", "/api/bidding/bookmarks", {"tbmt_code": "IB2600001001-00", "tender_name": "Test"}),
    ("GET", "/api/trademarks", None),
    ("POST", "/api/trademarks/sync", {}),
    ("POST", "/api/standards/game/reset", {}),
    ("POST", "/api/standards/generate-cr-declaration/pdf", {
        "company_name": "Test",
        "tax_code": "0101010101",
        "address": "HN",
        "representative_name": "A",
        "representative_title": "GD",
        "product_name": "GW",
        "model_name": "M1",
        "manufacturer": "M",
        "country_of_origin": "VN",
        "applicable_standards": ["QCVN 54:2020/BTTTT"],
        "test_report_number": "1",
        "test_lab_name": "Lab",
    }),
    ("GET", "/api/payroll/employees", None),
    ("GET", "/api/tax/session", None),
    ("GET", "/api/tax-defense/overview", None),
    ("GET", "/api/nas/status", None),
    ("GET", "/api/settings", None),
    ("GET", "/api/audit", None),
    ("GET", "/api/gov-radar", None),
    ("GET", "/api/inv/stock", None),
    ("GET", "/api/spx/orders", None),
    ("GET", "/api/piecework/contracts", None),
]


def test_tc_sec_07_admin_routes_reject_anon_customer_and_pymid_staff(client):
    anon = _new_anon_client()
    cust_client, _ = _create_user_and_login("rbac_cust", "CustPass!2026", role="customer")
    pymid_client, _ = _create_user_and_login(
        "rbac_pymid", "PymidPass!2026", role="pymid_staff"
    )

    for method, url, body in ADMIN_ONLY_ENDPOINTS:
        r_anon = anon.request(method, url, json=body)
        assert r_anon.status_code == 401, f"ANON should get 401 on {method} {url}, got {r_anon.status_code}"

        r_cust = cust_client.request(method, url, json=body)
        assert r_cust.status_code == 403, f"CUSTOMER should get 403 on {method} {url}, got {r_cust.status_code}"

        r_pymid = pymid_client.request(method, url, json=body)
        assert r_pymid.status_code == 403, f"PYMID_STAFF should get 403 on {method} {url}, got {r_pymid.status_code}"


# ---------------------------------------------------------------------------
# TC-SEC-08 (SEC-BE-08): Random temp passwords & enforced must_change_password
# ---------------------------------------------------------------------------
def test_tc_sec_08_random_temp_password_and_enforced_must_change_password(client):
    _login(client)
    c1 = client.post("/api/customers", json={"name": "Cty Alpha", "tax_code": "0109000001"}).json()
    c2 = client.post("/api/customers", json={"name": "Cty Beta", "tax_code": "0109000002"}).json()

    a1 = client.post(f"/api/customers/{c1['id']}/account-auto")
    a2 = client.post(f"/api/customers/{c2['id']}/account-auto")
    assert a1.status_code == 200 and a2.status_code == 200
    pw1 = a1.json()["password"]
    pw2 = a2.json()["password"]
    assert pw1 != "inut12345" and pw2 != "inut12345"
    assert pw1 != pw2
    assert len(pw1) >= 12

    # Log in as c1 -> must_change_password=True blocks data APIs with 403
    cust = _new_anon_client()
    r_login = cust.post("/api/login", json={"username": a1.json()["username"], "password": pw1})
    assert r_login.status_code == 200
    old_cookie = cust.cookies.get(auth.COOKIE_NAME)
    assert old_cookie

    # /api/me is allowed and advertises must_change_password=True
    me = cust.get("/api/me")
    assert me.status_code == 200
    assert me.json()["must_change_password"] is True

    # Data routes are strictly blocked with 403 until password is changed
    assert cust.get("/api/my/documents").status_code == 403
    assert cust.get("/api/my/invoices").status_code == 403

    # Changing password succeeds and revokes old cookie
    chg = cust.post("/api/me/password", json={"old_password": pw1, "new_password": "NewStrongPass!2026"})
    assert chg.status_code == 200, chg.text

    stale = _new_anon_client()
    stale.cookies.set(auth.COOKIE_NAME, old_cookie)
    assert stale.get("/api/me").status_code == 401

    # Fresh login with new password unlocks /api/my/documents
    fresh = _new_anon_client()
    assert fresh.post("/api/login", json={"username": a1.json()["username"], "password": "NewStrongPass!2026"}).status_code == 200
    assert fresh.get("/api/me").json()["must_change_password"] is False
    assert fresh.get("/api/my/documents").status_code == 200


# ---------------------------------------------------------------------------
# TC-SEC-09 (SEC-BE-09): Loopback admin bypass closed & Clabel POST-only
# ---------------------------------------------------------------------------
def test_tc_sec_09_loopback_unauth_bypass_blocked_and_clabel_post_only(client, tmp_path, monkeypatch):
    anon = _new_anon_client()

    # Unauthenticated loopback POSTs must return 401 (no local-9router auto-admin)
    assert anon.post("/api/telegram/send", json={"message": "spoof"}).status_code == 401
    assert anon.post("/api/clabel/print", json={"text": "spoof"}).status_code == 401
    assert anon.post("/api/clabel/sanxuat-batch", json={"device_ids": ["inut_1"]}).status_code == 401

    # State-changing GET routes must be removed (405 Method Not Allowed or 404, never 200)
    for get_route in (
        "/api/clabel/print?text=x",
        "/api/clabel/print-sanxuat?device_id=inut_1",
        "/api/clabel/print-usb-hub",
        "/api/clabel/sanxuat-batch?device_ids=inut_1",
    ):
        r = anon.get(get_route)
        assert r.status_code in (401, 404, 405), f"Unexpected {r.status_code} on GET {get_route}"

    # Authenticated loopback service bearer token IS accepted
    tok_file = tmp_path / "loopback.token"
    tok_file.write_text("loopback-service-secret-2026")
    tok_file.chmod(0o600)
    monkeypatch.setenv("INUT_CRM_MCP_TOKEN_FILE", str(tok_file))
    get_settings.cache_clear()

    r_auth = anon.get(
        "/api/clabel/status",
        headers={"Authorization": "Bearer loopback-service-secret-2026"},
    )
    assert r_auth.status_code != 401


# ---------------------------------------------------------------------------
# TC-SEC-11 (SEC-BE-11): SPX label, Hermes eval-report & Trademark logo auth/redirect
# ---------------------------------------------------------------------------
def test_tc_sec_11_spx_label_eval_report_and_trademark_logo_protected(client):
    anon = _new_anon_client()
    cust, _ = _create_user_and_login("cust_sec11", "CustPass!2026", role="customer")

    assert anon.get("/api/spx/orders/SPXVN00001/label").status_code == 401
    assert cust.get("/api/spx/orders/SPXVN00001/label").status_code == 403

    assert anon.get("/training/eval-report").status_code == 401
    assert cust.get("/training/eval-report").status_code == 403

    # Seed a trademark with an untrusted external redirect URL
    gen = get_session()
    db = next(gen)
    try:
        tm = IpTrademark(
            application_number="4-2026-99999",
            mark_name="EVILTEST",
            owner_name="Test",
            remote_logo_url="https://evil.example/phish.png",
        )
        db.add(tm)
        db.commit()
        db.refresh(tm)
        tm_id = tm.id
    finally:
        gen.close()

    assert anon.get(f"/api/trademarks/{tm_id}/logo", follow_redirects=False).status_code == 401
    assert cust.get(f"/api/trademarks/{tm_id}/logo", follow_redirects=False).status_code == 403

    _login(client)
    r_logo = client.get(f"/api/trademarks/{tm_id}/logo", follow_redirects=False)
    assert r_logo.status_code in (400, 404), f"Must not redirect to evil.example; got {r_logo.status_code} {r_logo.headers.get('location')}"


# ---------------------------------------------------------------------------
# TC-SEC-15 (SEC-BE-15): Logout revocation, live DB claims, per-user lockout, login-link, /api/health
# ---------------------------------------------------------------------------
def test_tc_sec_15_session_logout_revocation_and_live_db_claims(client):
    # Two separate admin sessions (device A & device B)
    dev_a = _new_anon_client()
    dev_b = _new_anon_client()
    assert dev_a.post("/api/login", json={"username": "admin", "password": "NhapHang123@"}).status_code == 200
    assert dev_b.post("/api/login", json={"username": "admin", "password": "NhapHang123@"}).status_code == 200
    tok_a = dev_a.cookies.get(auth.COOKIE_NAME)

    # Logout device A -> replaying token A MUST return 401
    assert dev_a.post("/api/logout").status_code == 200
    replay_a = _new_anon_client()
    replay_a.cookies.set(auth.COOKIE_NAME, tok_a)
    assert replay_a.get("/api/me").status_code == 401

    # Device B remains valid (per-jti logout does not nuke other devices)
    assert dev_b.get("/api/me").status_code == 200

    # Live DB claim check: create admin2, issue JWT, then demote role in DB -> immediate 403
    adm2, adm2_id = _create_user_and_login("adm_demote", "AdminPass!2026", role="admin")
    assert adm2.get("/api/customers").status_code == 200
    gen = get_session()
    db = next(gen)
    try:
        u = db.get(User, adm2_id)
        u.role = "customer"
        db.commit()
    finally:
        gen.close()
    assert adm2.get("/api/customers").status_code == 403


def test_tc_sec_15_per_username_lockout_login_link_single_use_and_health_hygiene(client):
    # 1. Per-username brute-force lockout does NOT lock out another user on same IP
    attacker = _new_anon_client()
    for _ in range(5):
        r = attacker.post("/api/login", json={"username": "locked_victim", "password": "wrong"})
        assert r.status_code in (401, 429)
    assert attacker.post("/api/login", json={"username": "locked_victim", "password": "wrong"}).status_code == 429

    # Legitimate admin on same loopback IP can still log in!
    legit = _new_anon_client()
    assert legit.post("/api/login", json={"username": "admin", "password": "NhapHang123@"}).status_code == 200

    # 2. Login link: single-use & rejects backslash open redirect
    cust = legit.post("/api/customers", json={
        "name": "Link Single Use", "tax_code": "0108887776",
        "account_username": "link_su", "account_password": "StrongPass!2026",
    }).json()
    made = legit.post(f"/api/customers/{cust['id']}/login-link?days=3")
    assert made.status_code == 200
    link_path = made.json()["url"].split("/api", 1)[1]

    # Attempt backslash open redirect -> must NOT redirect to evil.com
    c_open = _new_anon_client()
    r_bad_next = c_open.get("/api" + link_path, params={"next": r"/\evil.com"}, follow_redirects=False)
    assert r_bad_next.status_code in (302, 400)
    if r_bad_next.status_code == 302:
        loc = r_bad_next.headers.get("location", "")
        assert "evil.com" not in loc and "\\" not in loc

    # Second replay of the same single-use token MUST fail
    c_replay = _new_anon_client()
    r_second = c_replay.get("/api" + link_path, follow_redirects=False)
    assert r_second.status_code in (401, 404, 410)

    # 3. /api/health omits using_default_secrets
    health = _new_anon_client().get("/api/health")
    assert health.status_code == 200
    assert "using_default_secrets" not in health.json()
