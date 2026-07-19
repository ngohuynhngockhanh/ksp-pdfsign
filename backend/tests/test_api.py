"""Test tang HTTP: login -> upload -> sign -> verify (agent duoc mock)."""
from __future__ import annotations

import datetime

import pytest

pytest.importorskip("pyhanko")
pytest.importorskip("fastapi")

from cryptography import x509 as cx509  # noqa: E402
from cryptography.hazmat.primitives import hashes, serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import padding, rsa  # noqa: E402
from cryptography.x509.oid import NameOID  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


def _key_cert():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = cx509.Name([cx509.NameAttribute(NameOID.COMMON_NAME, "API Test Signer")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        cx509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(cx509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=365))
        .add_extension(
            cx509.KeyUsage(
                digital_signature=True, content_commitment=True, key_encipherment=False,
                data_encipherment=False, key_agreement=False, key_cert_sign=False,
                crl_sign=False, encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .sign(key, hashes.SHA256())
    )
    return key, cert


PDF = (
    b"%PDF-1.4\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
    b"xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n"
    b"0000000052 00000 n \n0000000101 00000 n \n"
    b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n164\n%%EOF\n"
)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from app.config import get_settings

    get_settings.cache_clear()

    from app import token_backend, verify
    from asn1crypto import x509 as ax509

    key, cert = _key_cert()
    cert_der = cert.public_bytes(serialization.Encoding.DER)

    monkeypatch.setattr(
        token_backend, "get_cert_chain", lambda s, ip, pw, cid: [cert_der]
    )

    def fake_sign_raw(s, agent, cid, data, alg):
        h = {"sha256": hashes.SHA256}[alg]()
        return key.sign(data, padding.PKCS1v15(), h)

    monkeypatch.setattr(token_backend, "sign_raw", fake_sign_raw)
    monkeypatch.setattr(
        verify, "load_trust_roots", lambda s: [ax509.Certificate.load(cert_der)]
    )

    from app.main import app

    return TestClient(app)


def _login(client):
    r = client.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})
    assert r.status_code == 200


def test_requires_auth(client):
    assert client.post("/api/upload").status_code == 401


def test_login_bad(client):
    r = client.post("/api/login", json={"username": "admin", "password": "wrong"})
    assert r.status_code == 401


def test_full_flow(client):
    _login(client)
    up = client.post("/api/upload", files={"file": ("t.pdf", PDF, "application/pdf")})
    assert up.status_code == 200
    doc_id = up.json()["doc_id"]

    sign = client.post(
        "/api/sign",
        json={
            "doc_id": doc_id,
            "rect": {"page": 0, "x1": 350, "y1": 50, "x2": 560, "y2": 130},
            "cert_id": "test",
            "agent": {"ip": "127.0.0.1", "admin_password": "NhapHang123", "pin": "1234"},
            "reason": "Duyet",
            "location": "Ha Noi",
            "signer_name": "",
        },
    )
    assert sign.status_code == 200, sign.text
    signed_id = sign.json()["doc_id"]

    signed_pdf = client.get(f"/api/download/{signed_id}")
    assert signed_pdf.status_code == 200

    ver = client.post(
        "/api/verify",
        files={"file": ("signed.pdf", signed_pdf.content, "application/pdf")},
    )
    assert ver.status_code == 200, ver.text
    body = ver.json()
    assert body["signature_count"] == 1
    sig = body["signatures"][0]
    assert sig["intact"] and sig["valid"] and sig["trusted"]
