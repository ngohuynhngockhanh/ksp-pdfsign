"""Standardized Backend Security Suite — Injection, LFI, SSRF, XSS, Uploads & Hardening.

Covers IEEE-829 test cases:
- TC-SEC-03 (SEC-BE-03): WeasyPrint LFI/SSRF prevention, HTML escaping & Content-Disposition CRLF
- TC-SEC-04 (SEC-BE-04): Windows SSH PowerShell PIN & Foxit printer command injection guards
- TC-SEC-05 (SEC-BE-05): Stored XSS escaping in /khoan/{token} & Markdown preview + CSP
- TC-SEC-13 (SEC-BE-13): SSRF blocking in inv_import, email_sync & lio_signer
- TC-SEC-14 (SEC-BE-14, SEC-EDGE-01): Zero hardcoded secrets/PINs + env TOKEN_PIN loading + no argv password
- TC-SEC-16 (SEC-BE-16): Upload max-byte limits (413), ZIP bomb defense & suffix allowlist
- TC-SEC-17 (SEC-BE-17, 19, 20): Prod CORS, CSRF Referer, Share TTL, Telemetry cooldown, error redaction, verify.py
"""
from __future__ import annotations

import io
import os
import re
import subprocess
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import doc_tracking, email_sync, inv_import, lio_signer, markdown_preview, spx, storage, win_ssh
from app.config import Settings, get_settings
from app.db import PieceworkContract, get_session
from app.main import app
from tests.test_api import PDF, _login

REPO_ROOT = Path(__file__).resolve().parents[2]


# ---------------------------------------------------------------------------
# TC-SEC-03 (SEC-BE-03): WeasyPrint LFI / SSRF & Content-Disposition CRLF
# ---------------------------------------------------------------------------
def test_tc_sec_03_safe_weasyprint_url_fetcher_and_standards_pdf_injection(client, tmp_path, monkeypatch):
    from app import security_utils

    # Direct unit test of safe_weasyprint_url_fetcher
    sentinel = tmp_path / "sentinel.txt"
    sentinel.write_text("TOP_SECRET_SENTINEL_VALUE")

    with pytest.raises(ValueError):
        security_utils.safe_weasyprint_url_fetcher(f"file://{sentinel}")
    with pytest.raises(ValueError):
        security_utils.safe_weasyprint_url_fetcher("file:///etc/passwd")
    with pytest.raises(ValueError):
        security_utils.safe_weasyprint_url_fetcher("http://127.0.0.1:2032/api/health")
    with pytest.raises(ValueError):
        security_utils.safe_weasyprint_url_fetcher("https://example.com/pixel.png")

    # data: URI remains allowed (used by inline logos/QR/signatures)
    data_res = security_utils.safe_weasyprint_url_fetcher(
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    )
    assert data_res is not None

    # End-to-end CR declaration PDF with LFI/SSRF HTML injection + CRLF filename attempt
    _login(client)
    resp = client.post(
        "/api/standards/generate-cr-declaration/pdf",
        json={
            "company_name": f'<link rel="attachment" href="file://{sentinel}"><img src="http://127.0.0.1:2032/api/health">Test Co',
            "tax_code": "0101010101",
            "address": "<b>Ha Noi</b>",
            "representative_name": "Nguyen A",
            "representative_title": "GD",
            "product_name": "Gateway",
            "model_name": 'GW1"\r\nX-Injected: evil',
            "manufacturer": "INUT",
            "country_of_origin": "VN",
            "applicable_standards": ["QCVN 54:2020/BTTTT"],
            "test_report_number": "TR-001",
            "test_lab_name": "VNTA",
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.content.startswith(b"%PDF")
    assert b"TOP_SECRET_SENTINEL_VALUE" not in resp.content
    cd = resp.headers.get("content-disposition", "")
    assert "\r" not in cd and "\n" not in cd and "X-Injected:" not in cd
    assert "x-injected" not in {k.lower() for k in resp.headers.keys()}

    # Verify pypdf sees zero embedded attachments
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(resp.content))
    assert not getattr(reader, "attachments", {})


def test_tc_sec_03_markdown_to_pdf_blocks_raw_html_lfi(client, tmp_path):
    sentinel = tmp_path / "md_secret.txt"
    sentinel.write_text("MD_SENTINEL_SECRET_999")
    md_bytes = f'# Report\n\n<link rel="attachment" href="file://{sentinel}">\n<script>alert(1)</script>\n'.encode()

    pdf_bytes = markdown_preview.render_markdown_to_pdf_bytes(md_bytes, title="report.md")
    assert pdf_bytes.startswith(b"%PDF")
    assert b"MD_SENTINEL_SECRET_999" not in pdf_bytes


# ---------------------------------------------------------------------------
# TC-SEC-04 (SEC-BE-04): Windows SSH / PowerShell & Printer Command Injection
# ---------------------------------------------------------------------------
def test_tc_sec_04_win_ssh_pin_base64_and_host_allowlist(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ALLOWED_SSH_HOSTS", "192.168.1.10,192.168.1.111")
    get_settings.cache_clear()
    settings = get_settings()

    captured_scripts = []

    def fake_run(s, host, admin_password, ps_script):
        captured_scripts.append((host, ps_script))
        return "SIG=QUFB"

    monkeypatch.setattr(win_ssh, "_run", fake_run)

    malicious_pin = '1234"; whoami; $(calc.exe) #'
    out = win_ssh.sign_raw(settings, "192.168.1.10", "adm", "AABBCC", malicious_pin, b"hello", "sha256")
    assert out == b"AAA"
    assert len(captured_scripts) == 1
    script = captured_scripts[0][1]
    assert "whoami" not in script
    assert "$(calc.exe)" not in script
    assert "FromBase64String" in script

    # Disallowed SSH host must be rejected before running SSH
    with pytest.raises(Exception):
        win_ssh.sign_raw(settings, "10.99.99.99", "adm", "AABBCC", "1234", b"hello", "sha256")


def test_tc_sec_04_spx_and_clabel_reject_command_injection_printer_and_host(client, monkeypatch):
    _login(client)
    called = []
    monkeypatch.setattr(subprocess, "run", lambda *a, **kw: called.append(a))

    # SPX remote print with shell metacharacters in printer_name or rogue host
    r_spx = client.post(
        "/api/spx/orders/SPXVN123456/print-remote",
        params={"printer_name": 'TP732H" & whoami & "', "host": "10.99.99.99"},
    )
    assert r_spx.status_code in (400, 404, 422)
    assert len(called) == 0

    # Clabel batch print with shell metacharacters in printer_name / host
    r_clabel = client.post(
        "/api/clabel/sanxuat-batch",
        json={"device_ids": ["inut_207_153"], "printer_name": 'TP732H" & calc.exe & "', "host": "10.99.99.99"},
    )
    assert r_clabel.status_code in (400, 422)
    assert len(called) == 0


# ---------------------------------------------------------------------------
# TC-SEC-05 (SEC-BE-05): Stored XSS Neutralization in Portals & Markdown + CSP
# ---------------------------------------------------------------------------
def test_tc_sec_05_piecework_portal_and_markdown_stored_xss_neutralized(client):
    _login(client)
    created = client.post(
        "/api/piecework/contracts",
        json={
            "contract_code": "XSS/2026/01",
            "contract_type": "thi_cong",
            "project_name": 'Proj "><img src=x onerror=alert(1)>',
            "worker_name": "Initial Worker",
            "worker_id_card": "038091009999",
            "total_amount": 4000000.0,
        },
    ).json()
    token = created["portal_token"]

    xss_name = '"><img src=x onerror=window.__xss=1><script>alert(1)</script>'
    r_draft = client.post(
        f"/api/public/khoan/{token}/save-draft",
        json={"worker_name": xss_name, "worker_address": '<svg onload=alert(2)>'},
    )
    assert r_draft.status_code == 200, r_draft.text

    portal = client.get(f"/khoan/{token}")
    assert portal.status_code == 200
    assert '<img src=x onerror=window.__xss=1>' not in portal.text
    assert '<svg onload=alert(2)>' not in portal.text
    assert "&lt;img src=x onerror=window.__xss=1&gt;" in portal.text or "&quot;&gt;&lt;img" in portal.text

    # CSP must not permit raw 'unsafe-inline' in script-src on portals
    csp = portal.headers.get("content-security-policy", "")
    script_part = ""
    for part in csp.split(";"):
        if part.strip().startswith("script-src"):
            script_part = part
            break
    assert "'unsafe-inline'" not in script_part, f"Portal CSP still has script-src unsafe-inline: {csp}"

    # Markdown preview disables raw HTML execution (escapes tags into entities)
    md_html = markdown_preview.render_markdown_preview_html(
        b"# Title\n\n<script>window.__mdXss=1</script><img src=x onerror=alert(1)>\n",
        title="xss.md",
    )
    assert "<script>window.__mdXss=1</script>" not in md_html
    assert "<img src=x onerror=alert(1)>" not in md_html
    assert "&lt;img src=x onerror=alert(1)&gt;" in md_html


# ---------------------------------------------------------------------------
# TC-SEC-13 (SEC-BE-13): SSRF Protection (inv_import, email_sync, lio_signer)
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "bad_url",
    [
        "http://127.0.0.1:2032/api/health",
        "http://localhost:8090/eval-report",
        "http://169.254.169.254/latest/meta-data/",
        "http://192.168.1.10:8443/health",
        "file:///etc/passwd",
    ],
)
def test_tc_sec_13_ssrf_blocked_in_inv_import_and_validator(client, bad_url):
    from app import security_utils

    with pytest.raises(ValueError):
        security_utils.validate_outbound_url(bad_url)

    _login(client)
    r1 = client.post("/api/inv/purchase/import-url", json={"url": bad_url})
    assert r1.status_code in (400, 422), f"Expected 400/422 for SSRF URL {bad_url}, got {r1.status_code}"

    r2 = client.post("/api/inv/sale/import-url", json={"url": bad_url})
    assert r2.status_code in (400, 422), f"Expected 400/422 for SSRF URL {bad_url}, got {r2.status_code}"


def test_tc_sec_13_email_sync_and_lio_signer_host_allowlist(client):
    _login(client)
    # Non-Zoho accounts_url / mail_api_url rejected
    r_zoho = client.post(
        "/api/inv/email-sync/settings",
        json={
            "enabled": True,
            "accounts_url": "https://evil.example/oauth/v2/token",
            "mail_api_url": "https://evil.example/api/accounts",
        },
    )
    assert r_zoho.status_code in (400, 422)

    # LIO Signer rejects non-allowlisted polling_url / file_url
    from app import security_utils
    settings = get_settings()
    with pytest.raises(ValueError):
        security_utils.validate_outbound_url(
            "http://127.0.0.1:8090/steal",
            allowed_hosts=["signer.liotech.vn"],
        )


# ---------------------------------------------------------------------------
# TC-SEC-14 (SEC-BE-14, SEC-EDGE-01 + User Directive #22): Zero Hardcoded Secrets
# ---------------------------------------------------------------------------
def test_tc_sec_14_no_hardcoded_secrets_and_env_token_pin(monkeypatch, tmp_path):
    # Clear secret env vars to verify code defaults in Settings are empty
    for key in (
        "NAS_PASSWORD",
        "TTS_KOKORO_API_KEY",
        "TTS_VNMAP_API_KEY",
        "APP_ADMIN_PASSWORD",
        "AGENT_ADMIN_PASSWORD",
        "TOKEN_PIN",
    ):
        monkeypatch.delenv(key, raising=False)

    s = Settings(_env_file=None, data_dir=str(tmp_path))
    assert s.nas_password == ""
    assert s.tts_kokoro_api_key == ""
    assert s.tts_vnmap_api_key == ""
    assert s.app_admin_password == ""
    assert s.agent_admin_password == ""
    assert s.token_pin == ""

    # User Directive #22: Settings cleanly reads TOKEN_PIN from environment
    monkeypatch.setenv("TOKEN_PIN", "12345678")
    s_env = Settings(_env_file=None, data_dir=str(tmp_path))
    assert s_env.token_pin == "12345678"

    # Static verification: tracked .env.example and scripts/*.py have zero hardcoded PINs/NAS passwords
    env_example = (REPO_ROOT / ".env.example").read_text(errors="ignore")
    assert not re.search(r"^\s*NAS_PASSWORD=\S+", env_example, re.M), ".env.example still contains NAS_PASSWORD value"
    assert not re.search(r"^\s*TOKEN_PIN=\S+", env_example, re.M), ".env.example still contains TOKEN_PIN value"
    assert re.search(r"^\s*TOKEN_PIN=", env_example, re.M), ".env.example should document TOKEN_PIN="

    for py_path in sorted((REPO_ROOT / "scripts").glob("*.py")):
        txt = py_path.read_text(errors="ignore")
        assert not re.search(r'pin\s*=\s*"[0-9]{6,}"', txt), f"Hardcoded numeric PIN in {py_path.name}"
        assert "inut12345" not in txt or "help=" in txt, f"Check Wi-Fi default in {py_path.name}"

    # Verify spx.py does not pass SPX password via argv to node script
    spx_src = (REPO_ROOT / "backend" / "app" / "spx.py").read_text(errors="ignore")
    assert '["node", str(script_path), username, password]' not in spx_src


# ---------------------------------------------------------------------------
# TC-SEC-16 (SEC-BE-16): Upload Limits (413), ZIP Bomb & Extension Allowlist
# ---------------------------------------------------------------------------
def test_tc_sec_16_upload_size_zip_bomb_and_extension_guards(client):
    _login(client)
    # 1. Oversized upload (>25MB) to /api/verify returns 413
    huge = b"%PDF-1.4\n" + (b"0" * (26 * 1024 * 1024))
    r_big = client.post("/api/verify", files={"file": ("huge.pdf", huge, "application/pdf")})
    assert r_big.status_code == 413

    # 2. ZIP bomb (>50 files) rejected by inv_import.expand_zip
    buf_many = io.BytesIO()
    with zipfile.ZipFile(buf_many, "w", zipfile.ZIP_DEFLATED) as zf:
        for i in range(65):
            zf.writestr(f"inv_{i}.xml", "<HDon></HDon>")
    with pytest.raises(ValueError):
        inv_import.expand_zip("many.zip", buf_many.getvalue())

    # 3. ZIP bomb (>200MB uncompressed zeros, tiny compressed) rejected
    buf_bomb = io.BytesIO()
    with zipfile.ZipFile(buf_bomb, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("bomb.xml", b"0" * (210 * 1024 * 1024))
    with pytest.raises(ValueError):
        inv_import.expand_zip("bomb.zip", buf_bomb.getvalue())

    # 4. Unsafe storage suffix rejected
    with pytest.raises(ValueError):
        storage.save_upload(b"evil", suffix="/../evil.py")
    with pytest.raises(ValueError):
        storage.save_upload(b"evil", suffix=".php.exe")

    # 5. Unrestricted extension (.html / .exe) rejected on piecework upload
    c = client.post(
        "/api/piecework/contracts",
        json={
            "contract_code": "UP/2026/01",
            "contract_type": "thi_cong",
            "project_name": "Upload Guard",
            "worker_name": "Tester",
            "worker_id_card": "038091001111",
            "total_amount": 3000000.0,
        },
    ).json()
    r_html = client.post(
        f"/api/piecework/contracts/{c['id']}/upload-doc",
        files={"file": ("evil.html", b"<html><script>alert(1)</script></html>", "text/html")},
        data={"doc_kind": "acceptance"},
    )
    assert r_html.status_code in (400, 422)


# ---------------------------------------------------------------------------
# TC-SEC-17 (SEC-BE-17, 19, 20): CORS, CSRF Referer, Share TTL, Telemetry & Error Hygiene
# ---------------------------------------------------------------------------
def test_tc_sec_17_cors_csrf_referer_share_ttl_and_telemetry_cooldown(client, monkeypatch):
    monkeypatch.setenv("APP_DEV_CORS", "false")
    get_settings.cache_clear()
    _login(client)

    # 1. Prod CORS does not reflect localhost:5173 when APP_DEV_CORS=false
    r_opt = client.options(
        "/api/me",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
    )
    assert r_opt.headers.get("access-control-allow-origin") != "http://localhost:5173"

    # 2. Cookie-authenticated mutation with malicious Referer and no Origin -> 403
    r_csrf = client.post(
        "/api/orders",
        json={"name": "CSRF Order"},
        headers={"Referer": "https://evil.example/attack.html"},
    )
    assert r_csrf.status_code == 403

    # 3. ShareRequest.days clamped/rejected above 365
    up = client.post("/api/documents/upload", files={"file": ("share.pdf", PDF, "application/pdf")})
    doc_pk = up.json()["id"]
    r_share = client.post(f"/api/documents/{doc_pk}/share", json={"days": 999999})
    assert r_share.status_code in (200, 422)
    if r_share.status_code == 200:
        from datetime import datetime, timezone
        exp = datetime.fromisoformat(r_share.json()["expires_at"].replace("Z", "+00:00"))
        delta_days = (exp - datetime.now(timezone.utc)).days
        assert delta_days <= 366

    # 4. Telemetry cooldown keyed on server IP: same-doc view dedupes immediately & per-IP caps at 3/10min
    assert doc_tracking._should_notify("198.51.100.10", doc_pk, "view") is True
    assert doc_tracking._should_notify("198.51.100.10", doc_pk, "view") is False
    assert doc_tracking._should_notify("198.51.100.11", doc_pk + 1, "download") is True
    assert doc_tracking._should_notify("198.51.100.11", doc_pk + 2, "download") is True
    assert doc_tracking._should_notify("198.51.100.11", doc_pk + 3, "download") is True
    assert doc_tracking._should_notify("198.51.100.11", doc_pk + 4, "download") is False

    # 5. error_detail redacts internal IPs/stacktraces and returns correlation ref
    from app import security_utils
    msg = security_utils.error_detail("Lỗi kết nối máy in", RuntimeError("ssh: connect to 192.168.1.10 /home/ksp/.ssh failed"))
    assert "192.168.1.10" not in msg
    assert "/home/ksp" not in msg
    assert "Mã tra cứu" in msg
