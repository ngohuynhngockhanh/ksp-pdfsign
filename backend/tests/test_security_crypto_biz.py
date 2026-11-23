"""Standardized Crypto Integrity, Concurrency, Static Infra Audit & Business-Logic Invariant Suite.

Covers IEEE-829 test cases:
- TC-SEC-10 (SEC-BE-10): Piecework trust-root removal, fail-closed signing & honest NEAC UI
- TC-SEC-12 (SEC-BE-12): Post-signing 409 lock, cross-contractor bank tamper guard, random seed tokens
- TC-SEC-18 (SEC-BE-18): 8-thread concurrent inventory posting TOCTOU race guard
- TC-SEC-23 (SEC-EDGE-07, 08, 11, 12, 13): Nginx, Docker, FRPC, Systemd, Requirements, html2pdf, 0-byte DB cleanup
- TC-BIZ-01..09, 12: Core business logic preservation invariants from #8
"""
from __future__ import annotations

import concurrent.futures
import datetime
import re
import threading
from pathlib import Path

import pytest
from cryptography import x509 as cx509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.x509.oid import NameOID
from fastapi.testclient import TestClient
from sqlalchemy import text

from app import (
    config as cfg_mod,
    db as dbmod,
    ihoadon,
    inventory,
    piecework_api,
    standards_game,
    tax_ops,
    tax_policy,
    verify,
)
from app.config import Settings, get_settings
from app.db import (
    InvItem,
    InvMove,
    InvPurchase,
    InvPurchaseLine,
    InvWarehouse,
    PieceworkContract,
    PieceworkContractor,
    User,
    get_session,
)
from app.main import app
from app.security import hash_password
from tests.test_api import PDF, _login

REPO_ROOT = Path(__file__).resolve().parents[2]


# ---------------------------------------------------------------------------
# TC-SEC-10 (SEC-BE-10): Trust-Root Injection Removed & Fail-Closed Signing
# ---------------------------------------------------------------------------
def test_tc_sec_10_piecework_verify_never_auto_trusts_self_signed_and_sign_fails_closed(client, monkeypatch):
    _login(client)
    # 1. Fail-closed signing when USB token/signing raises and software fallback is disabled
    monkeypatch.setenv("ALLOW_SOFTWARE_PIECEWORK_SIGN", "false")
    get_settings.cache_clear()

    c = client.post(
        "/api/piecework/contracts",
        json={
            "contract_code": "SEC10/FAIL",
            "contract_type": "thi_cong",
            "project_name": "Fail Closed Test",
            "worker_name": "Nguyen Fail",
            "worker_id_card": "038091005555",
            "total_amount": 4000000.0,
        },
    ).json()

    monkeypatch.setattr(
        piecework_api,
        "sign_piecework_pdf_pyhanko",
        lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("USB token unplugged")),
    )
    r_fail = client.post(
        f"/api/piecework/contracts/{c['id']}/sign-inut",
        json={"allow_unsigned_worker": True},
    )
    assert r_fail.status_code in (500, 502, 503), r_fail.text

    det = client.get(f"/api/piecework/contracts/{c['id']}").json()
    assert det["is_signed_by_inut"] is False

    # 2. Verify-signature does NOT append untrusted self-signed signer_cert into trust_roots
    src = (REPO_ROOT / "backend" / "app" / "piecework_api.py").read_text(errors="ignore")
    assert "roots.append(sig.signer_cert)" not in src

    # 3. NEAC modal templates in main.py & piecework_api.py do not hardcode unconditional valid banner
    main_src = (REPO_ROOT / "backend" / "app" / "main.py").read_text(errors="ignore")
    assert 'const ocspStatus = firstSig.ocsp || "Chứng thư số hợp lệ, chưa bị thu hồi"' not in main_src


# ---------------------------------------------------------------------------
# TC-SEC-12 (SEC-BE-12): Post-Sign Lock, Cross-Contractor Bank Guard & Random Seed Tokens
# ---------------------------------------------------------------------------
def test_tc_sec_12_piecework_post_sign_lock_bank_guard_and_no_static_seed_tokens(client):
    _login(client)
    # 1. Verify zero old hardcoded static portal tokens in freshly seeded DB
    contracts = client.get("/api/piecework/contracts").json()["contracts"]
    tokens = {c["portal_token"] for c in contracts}
    for static_tok in (
        "dongson-kiosk-token-849200",
        "sonla-ll100-token-850082",
        "daklak-webcam-token-866093",
    ):
        assert static_tok not in tokens, f"Static seeded portal_token {static_tok} still present!"

    # 2. Create a master contractor B with known bank account
    c_b = client.post(
        "/api/piecework/contractors",
        json={
            "code": "CTV-VICTIM-B",
            "name": "Victim Contractor B",
            "id_card": "038099008888",
            "phone": "0901112222",
            "bank_account": "TCB-ORIGINAL-SAFE",
            "bank_name": "Techcombank",
        },
    ).json()

    # Create unsigned contract C2 (unrelated worker) and attempt to submit Contractor B's CCCD + attacker bank
    c2 = client.post(
        "/api/piecework/contracts",
        json={
            "contract_code": "SEC12/C2",
            "contract_type": "thi_cong",
            "project_name": "Bank Tamper Test",
            "worker_name": "Attacker Worker",
            "worker_id_card": "038099001111",
            "total_amount": 4000000.0,
        },
    ).json()

    dummy_sig = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    r_sub = client.post(
        f"/api/public/khoan/{c2['portal_token']}/submit-signature",
        json={
            "signature_data": dummy_sig,
            "worker_id_card": "038099008888",
            "worker_bank_account": "HACKER-999999",
            "worker_bank_name": "EvilBank",
        },
    )
    assert r_sub.status_code == 200, r_sub.text

    # Contractor B's master bank_account MUST remain untouched!
    b_after = client.get(f"/api/piecework/contractors/{c_b['id']}").json()
    assert b_after["bank_account"] == "TCB-ORIGINAL-SAFE"

    # 3. Once signed, re-submitting signature or adding site photos returns 409 Conflict
    r_overwrite = client.post(
        f"/api/public/khoan/{c2['portal_token']}/submit-signature",
        json={"signature_data": dummy_sig, "worker_name": "Tampered After Sign"},
    )
    assert r_overwrite.status_code == 409

    r_photo = client.post(
        f"/api/public/khoan/{c2['portal_token']}/add-site-photos",
        json={"site_photos_data": [dummy_sig]},
    )
    assert r_photo.status_code == 409


# ---------------------------------------------------------------------------
# TC-SEC-18 (SEC-BE-18): 8-Thread Concurrent Inventory Posting TOCTOU Guard
# ---------------------------------------------------------------------------
def test_tc_sec_18_concurrent_inventory_post_creates_single_ledger_entry(client):
    _login(client)
    wh = client.get("/api/inv/warehouses").json()[0]
    item_resp = client.post(
        "/api/inv/items",
        json={"ma_hang": "RACE-001", "ten": "Race Test Board", "dvt": "cái"},
    )
    assert item_resp.status_code == 200, item_resp.text
    item = item_resp.json()
    purch = client.post(
        "/api/inv/purchase",
        json={
            "so_hd": "RACE-HD-01",
            "ky_hieu": "1C26TIN",
            "ngay": "2026-08-01",
            "ten_ban": "Supplier Race",
            "lines": [
                {
                    "ten_raw": "Race Test Board",
                    "item_id": item["id"],
                    "warehouse_id": wh["id"],
                    "so_luong": 10,
                    "don_gia": 100000,
                    "thanh_tien": 1000000,
                }
            ],
        },
    )
    assert purch.status_code == 200, purch.text
    pid = purch.json()["id"]

    # Fire 8 concurrent threads simultaneously against POST /api/inv/purchase/{pid}/post
    barrier = threading.Barrier(8)
    cookie_val = client.cookies.get("ksp_session")

    def worker():
        c = TestClient(app)
        c.cookies.set("ksp_session", cookie_val)
        barrier.wait(timeout=10)
        resp = c.post(f"/api/inv/purchase/{pid}/post")
        return resp.status_code

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        statuses = list(pool.map(lambda _: worker(), range(8)))

    assert statuses.count(200) == 1, f"Expected exactly 1x 200, got statuses={statuses}"
    assert all(s in (200, 400, 409) for s in statuses), f"Unexpected status in {statuses}"

    gen = get_session()
    db = next(gen)
    try:
        moves = db.query(InvMove).filter(InvMove.ref_type == "purchase", InvMove.ref_id == pid).all()
        assert len(moves) == 1, f"Duplicate ledger rows created: {len(moves)}"
    finally:
        gen.close()


# ---------------------------------------------------------------------------
# TC-SEC-23 (SEC-EDGE-07, 08, 11, 12, 13): Static Infra & Config Security Gate
# ---------------------------------------------------------------------------
def test_tc_sec_23_infra_configs_and_hygiene():
    # 1. Nginx configs carry security headers + server_tokens off + forwarding headers
    for nginx_rel in ("frontend/nginx.conf", "deploy/nginx-ksp-pdf-signer.conf"):
        txt = (REPO_ROOT / nginx_rel).read_text(errors="ignore")
        assert "server_tokens off" in txt, f"{nginx_rel} missing server_tokens off"
        assert "X-Content-Type-Options" in txt, f"{nginx_rel} missing X-Content-Type-Options"
        assert "X-Frame-Options" in txt, f"{nginx_rel} missing X-Frame-Options"
        assert "Referrer-Policy" in txt, f"{nginx_rel} missing Referrer-Policy"
        assert "X-Forwarded-For" in txt, f"{nginx_rel} missing X-Forwarded-For"
        assert "X-Forwarded-Proto" in txt, f"{nginx_rel} missing X-Forwarded-Proto"

    # 2. docker-compose.yml does not expose backend 8000 on 0.0.0.0
    dc = (REPO_ROOT / "docker-compose.yml").read_text(errors="ignore")
    assert '"8000:8000"' not in dc and "'8000:8000'" not in dc

    # 3. Dockerfiles use non-root USER and frontend uses npm ci + package-lock.json
    fe_df = (REPO_ROOT / "frontend" / "Dockerfile").read_text(errors="ignore")
    assert "package-lock.json" in fe_df and "npm ci" in fe_df
    be_df = (REPO_ROOT / "backend" / "Dockerfile").read_text(errors="ignore")
    assert re.search(r"^\s*USER\s+(?!root\b)\S+", be_df, re.M), "backend/Dockerfile missing non-root USER"

    # 4. FRPC enables TLS
    frpc = (REPO_ROOT / "deploy" / "frpc" / "frpc.ini.example").read_text(errors="ignore")
    assert re.search(r"tls_enable\s*=\s*true", frpc, re.I)

    # 5. Systemd units specify User=ksp, PrivateTmp=true, NoNewPrivileges=true, and no /tmp/ksp-*.lock
    for unit in (
        "deploy/ksp-ihoadon-sync.service",
        "deploy/ksp-tax-sync.service",
        "deploy/ksp-ecus-drive-sync.service",
        "deploy/frpc/frpc-ksp.service",
    ):
        u_txt = (REPO_ROOT / unit).read_text(errors="ignore")
        assert "User=" in u_txt, f"{unit} missing User="
        assert "NoNewPrivileges=true" in u_txt, f"{unit} missing NoNewPrivileges=true"
        assert "PrivateTmp=true" in u_txt, f"{unit} missing PrivateTmp=true"
        assert "/tmp/ksp-" not in u_txt, f"{unit} still uses predictable /tmp lockfile"

    # 6. backend/requirements.txt migrated from python-jose to PyJWT
    reqs = (REPO_ROOT / "backend" / "requirements.txt").read_text(errors="ignore")
    assert "python-jose" not in reqs.lower()
    assert "pyjwt" in reqs.lower()

    # 7. html2pdf.mjs no longer imports external sibling repo & disables JS
    html2pdf = (REPO_ROOT / "backend" / "scripts" / "html2pdf.mjs").read_text(errors="ignore")
    assert "/home/ksp/inut-ffmpeg-service" not in html2pdf
    assert "javaScriptEnabled: false" in html2pdf

    # 8. .gitignore covers SQLite WAL/SHM & agent config; 5 stray 0-byte DB files removed
    gi = (REPO_ROOT / ".gitignore").read_text(errors="ignore")
    for pat in ("*.db-wal", "*.db-shm", "windows-agent/config.ini"):
        assert pat in gi, f".gitignore missing {pat}"
    for stray in (
        "backend/app.db",
        "backend/ksp.db",
        "backend/ksp_pdfsign.db",
        "backend/data/app.db",
        "backend/data/pdfsign.db",
    ):
        assert not (REPO_ROOT / stray).exists(), f"Stray 0-byte DB still exists: {stray}"


# ---------------------------------------------------------------------------
# TC-BIZ-01..09 & TC-BIZ-12: Non-Negotiable Business Logic Preservation Invariants
# ---------------------------------------------------------------------------
def test_tc_biz_04_inventory_same_day_replay_and_negative_stock_modal_contract(client):
    _login(client)
    whs = client.get("/api/inv/warehouses").json()
    assert {"HH", "NVL", "TP"}.issubset({w["code"] for w in whs})
    hh = next(w for w in whs if w["code"] == "HH")

    item_resp = client.post(
        "/api/inv/items",
        json={"ma_hang": "BIZ-INV-1", "ten": "IoT Gateway", "dvt": "bộ"},
    )
    assert item_resp.status_code == 200, item_resp.text
    item = item_resp.json()

    # Same-day purchase (qty 5 @ 200k) and issue (qty 3) -> nhap runs before xuat
    p = client.post(
        "/api/inv/purchase",
        json={
            "so_hd": "BIZ-P1",
            "ky_hieu": "1C26TIN",
            "ngay": "2026-08-10",
            "ten_ban": "NCC",
            "lines": [{"ten_raw": "IoT Gateway", "item_id": item["id"], "warehouse_id": hh["id"], "so_luong": 5, "don_gia": 200000, "thanh_tien": 1000000}],
        },
    ).json()
    assert client.post(f"/api/inv/purchase/{p['id']}/post").status_code == 200

    iss = client.post(
        "/api/inv/issues",
        json={
            "ngay": "2026-08-10",
            "lines": [{"item_id": item["id"], "warehouse_id": hh["id"], "so_luong": 3}],
        },
    ).json()
    assert client.post(f"/api/inv/issues/{iss['id']}/post").status_code == 200

    # Over-issue (qty 10 > remaining 2) MUST return 400 with detail.violations for NegStockModal
    bad_iss = client.post(
        "/api/inv/issues",
        json={
            "ngay": "2026-08-10",
            "lines": [{"item_id": item["id"], "warehouse_id": hh["id"], "so_luong": 10}],
        },
    ).json()
    r_neg = client.post(f"/api/inv/issues/{bad_iss['id']}/post")
    assert r_neg.status_code == 400
    detail = r_neg.json().get("detail", {})
    assert isinstance(detail, dict) and "violations" in detail and len(detail["violations"]) >= 1

    # Voiding first issue restores qty to 5
    assert client.post(f"/api/inv/issues/{iss['id']}/void").status_code == 200
    stock = client.get("/api/inv/stock").json()
    rows = stock["rows"] if isinstance(stock, dict) else stock
    row = next(r for r in rows if r["item_id"] == item["id"] and r["warehouse_id"] == hh["id"])
    assert row["ton"] == pytest.approx(5.0)


def test_tc_biz_05_06_09_domain_invariants():
    # TC-BIZ-05: iHOADON client MUST NEVER sign, reserve numbers, or publish/issue legal invoices
    ihd_src = (REPO_ROOT / "backend" / "app" / "ihoadon.py").read_text(errors="ignore").lower()
    for forbidden in ("/publish", "/issue", "/sign-invoice", "cap_so_hoa_don", "phat_hanh"):
        assert forbidden not in ihd_src, f"iHOADON draft-only invariant violated: found {forbidden}"

    # TC-BIZ-06: VN VAT policy — software is KCT, 8% reduction active in 2026
    d_2026 = datetime.date(2026, 8, 15)
    assert tax_policy.reduction_active(d_2026) is True
    assert tax_policy.standard_rate(d_2026) == 8.0
    assert tax_policy.policy_snapshot(d_2026)["software_category"] == "KCT"

    # TC-BIZ-09: Facebook context_turns defaults to 0 (no prior Messenger history sent to Hermes)
    s = Settings(_env_file=None)
    assert s.facebook_context_turns == 0


def test_tc_biz_07_piecework_decree_253_and_admin_unlock(client):
    _login(client)
    c_sub_created = client.post(
        "/api/piecework/contracts",
        json={
            "contract_code": "BIZ07/SUB5M",
            "contract_type": "thi_cong",
            "project_name": "Sub 5M",
            "worker_name": "Worker A",
            "worker_id_card": "038091007771",
            "total_amount": 4500000.0,
        },
    ).json()
    c_over_created = client.post(
        "/api/piecework/contracts",
        json={
            "contract_code": "BIZ07/OVER5M",
            "contract_type": "thi_cong",
            "project_name": "Over 5M",
            "worker_name": "Worker B",
            "worker_id_card": "038091007772",
            "total_amount": 6000000.0,
        },
    ).json()
    c_sub = client.get(f"/api/piecework/contracts/{c_sub_created['id']}").json()
    c_over = client.get(f"/api/piecework/contracts/{c_over_created['id']}").json()
    assert c_sub["tax_rate"] == 0.0 and c_sub["tax_amount"] == 0.0
    assert c_over["tax_rate"] == 10.0 and c_over["tax_amount"] == 600000.0

    # Sign once -> 2nd submit blocked (409) -> Admin /unlock allows legitimate re-sign (200)
    dummy_sig = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    assert client.post(f"/api/public/khoan/{c_sub['portal_token']}/submit-signature", json={"signature_data": dummy_sig}).status_code == 200
    assert client.post(f"/api/public/khoan/{c_sub['portal_token']}/submit-signature", json={"signature_data": dummy_sig}).status_code == 409
    assert client.post(f"/api/piecework/contracts/{c_sub['id']}/unlock").status_code == 200
    assert client.post(f"/api/public/khoan/{c_sub['portal_token']}/submit-signature", json={"signature_data": dummy_sig}).status_code == 200


def test_tc_biz_12_sqlite_wal_fk_busy_timeout_and_standards_game_isolation(client, tmp_path):
    gen = get_session()
    db = next(gen)
    try:
        mode = db.execute(text("PRAGMA journal_mode")).scalar()
        fk = db.execute(text("PRAGMA foreign_keys")).scalar()
        bt = db.execute(text("PRAGMA busy_timeout")).scalar()
        assert str(mode).lower() == "wal", f"Expected WAL journal_mode, got {mode}"
        assert int(fk) == 1, f"Expected foreign_keys=1, got {fk}"
        assert int(bt) >= 5000, f"Expected busy_timeout>=5000, got {bt}"
    finally:
        gen.close()

    # standards_game MUST NOT hardcode /home/ksp/ksp-pdfsign/backend/data/ksp.db
    sg_src = (REPO_ROOT / "backend" / "app" / "standards_game.py").read_text(errors="ignore")
    assert "/home/ksp/ksp-pdfsign/backend/data/ksp.db" not in sg_src
