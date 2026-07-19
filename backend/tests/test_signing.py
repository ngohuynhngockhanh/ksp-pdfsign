"""Test ky + kiem tra end-to-end, gia lap token bang khoa RSA cuc bo.

Khong can token that: ta thay agent_client bang mot ham ky local (PKCS#1 v1.5),
mo phong dung cach token ky voi CKM_SHA256_RSA_PKCS.
"""
from __future__ import annotations

import datetime
import io

import pytest

pytest.importorskip("pyhanko")

from cryptography import x509 as cx509  # noqa: E402
from cryptography.hazmat.primitives import hashes, serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import padding, rsa  # noqa: E402
from cryptography.x509.oid import NameOID  # noqa: E402

from app import signing, storage, token_backend, verify  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.schemas import AgentTarget, Rect, SignRequest  # noqa: E402


def _make_key_and_cert():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = cx509.Name([
        cx509.NameAttribute(NameOID.COMMON_NAME, "WIN-CA Test Signer"),
        cx509.NameAttribute(NameOID.COUNTRY_NAME, "VN"),
    ])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        cx509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(cx509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=365))
        .add_extension(
            cx509.KeyUsage(
                digital_signature=True,
                content_commitment=True,  # nonRepudiation
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .sign(key, hashes.SHA256())
    )
    return key, cert


_HASHES = {
    "sha1": hashes.SHA1,
    "sha256": hashes.SHA256,
    "sha384": hashes.SHA384,
    "sha512": hashes.SHA512,
}


def _minimal_pdf() -> bytes:
    # PDF 1 trang toi thieu, hop le du de pyHanko ky.
    return (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
        b"xref\n0 4\n"
        b"0000000000 65535 f \n"
        b"0000000009 00000 n \n"
        b"0000000052 00000 n \n"
        b"0000000101 00000 n \n"
        b"trailer<</Size 4/Root 1 0 R>>\n"
        b"startxref\n164\n%%EOF\n"
    )


def test_rect_as_box_normalizes():
    r = Rect(page=0, x1=100, y1=700, x2=300, y2=650)
    assert r.as_box() == (100, 650, 300, 700)


def test_sign_and_verify_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    settings = get_settings()

    key, cert = _make_key_and_cert()
    cert_der = cert.public_bytes(serialization.Encoding.DER)

    def fake_chain(settings, ip, admin_password, cert_id):
        return [cert_der]

    def fake_sign_raw(settings, agent, cert_id, data, digest_algorithm):
        h = _HASHES[digest_algorithm]()
        return key.sign(data, padding.PKCS1v15(), h)

    monkeypatch.setattr(token_backend, "get_cert_chain", fake_chain)
    monkeypatch.setattr(token_backend, "sign_raw", fake_sign_raw)
    # verify: tin tuong chinh cert nay lam root
    from asn1crypto import x509 as ax509
    monkeypatch.setattr(
        verify, "load_trust_roots", lambda s: [ax509.Certificate.load(cert_der)]
    )

    doc_id = storage.save_upload(_minimal_pdf())
    req = SignRequest(
        doc_id=doc_id,
        rect=Rect(page=0, x1=350, y1=50, x2=560, y2=130),
        cert_id="test",
        agent=AgentTarget(ip="127.0.0.1", admin_password="x", pin="1234"),
        reason="Test",
        location="Ha Noi",
    )

    signed_id, signer_label = signing.sign_document(settings, req)
    assert "INUT" in signer_label or signer_label
    signed_bytes = storage.read_doc(signed_id)

    result = verify.verify_document(settings, signed_bytes, signed_id)
    assert result.signature_count == 1
    sig = result.signatures[0]
    assert sig.intact is True
    assert sig.valid is True
    assert sig.trusted is True

    # Sua 1 byte -> phai bao khong toan ven
    tampered = bytearray(signed_bytes)
    tampered[100] ^= 0xFF
    bad = verify.verify_document(settings, bytes(tampered), "bad")
    assert bad.signatures[0].intact is False
