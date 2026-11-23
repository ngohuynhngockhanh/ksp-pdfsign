"""Automated security tests for hardened Windows Signing Agent (TC-SEC-22)."""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import importlib.util
import os
import sys
import types
from pathlib import Path

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi.testclient import TestClient

AGENT_FILE = Path(__file__).with_name("agent.py")


def _load_agent_module():
    os.environ["AGENT_DEFER_APP_INIT"] = "1"
    spec = importlib.util.spec_from_file_location("windows_agent_under_test", AGENT_FILE)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def _make_test_cert_der():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    modulus = key.public_key().public_numbers().n
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "INUT TEST SIGNER")])
    now = dt.datetime.now(dt.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(days=1))
        .not_valid_after(now + dt.timedelta(days=30))
        .sign(key, hashes.SHA256())
    )
    der = cert.public_bytes(serialization.Encoding.DER)
    cid = hashlib.sha1(der).hexdigest()
    return cid, der, modulus


def _install_fake_pkcs11(monkeypatch, cert_der: bytes, key_moduli: list[int]):
    """Mock python-pkcs11 module with deterministic keys and call tracking."""
    signed_by: list[int] = []

    class FakeAttribute:
        CLASS = "CLASS"
        VALUE = "VALUE"
        KEY_TYPE = "KEY_TYPE"
        MODULUS = "MODULUS"

    class FakeObjectClass:
        CERTIFICATE = "CERTIFICATE"
        PRIVATE_KEY = "PRIVATE_KEY"

    class FakeKeyType:
        RSA = "RSA"

    class FakeMechanism:
        SHA1_RSA_PKCS = "SHA1_RSA_PKCS"
        SHA256_RSA_PKCS = "SHA256_RSA_PKCS"
        SHA384_RSA_PKCS = "SHA384_RSA_PKCS"
        SHA512_RSA_PKCS = "SHA512_RSA_PKCS"

    class FakePrivateKey:
        def __init__(self, idx: int, mod: int):
            self.idx = idx
            self._mod_bytes = mod.to_bytes((mod.bit_length() + 7) // 8, "big")

        def __getitem__(self, attr):
            if attr == FakeAttribute.MODULUS:
                return self._mod_bytes
            raise KeyError(attr)

        def sign(self, data: bytes, mechanism=None):
            signed_by.append(self.idx)
            return b"FAKE-SIG-" + str(self.idx).encode()

    class FakeSession:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def close(self):
            pass

        def get_objects(self, template):
            if template.get(FakeAttribute.CLASS) == FakeObjectClass.CERTIFICATE:
                return [{FakeAttribute.VALUE: cert_der}]
            if template.get(FakeAttribute.CLASS) == FakeObjectClass.PRIVATE_KEY:
                return [FakePrivateKey(i, m) for i, m in enumerate(key_moduli)]
            return []

    class FakeToken:
        label = "TEST_TOKEN"

        def open(self, user_pin=None):
            return FakeSession()

    class FakeSlot:
        def get_token(self):
            return FakeToken()

    class FakeLib:
        def get_slots(self, token_present=True):
            return [FakeSlot()]

    fake_mod = types.ModuleType("pkcs11")
    fake_mod.Attribute = FakeAttribute
    fake_mod.ObjectClass = FakeObjectClass
    fake_mod.KeyType = FakeKeyType
    fake_mod.Mechanism = FakeMechanism
    fake_mod.lib = lambda _path: FakeLib()
    monkeypatch.setitem(sys.modules, "pkcs11", fake_mod)
    return signed_by


_TEST_AGENT_CRED = "super-strong-agent-secret-32chars!"
_PLACEHOLDER_CRED = "<DAT_AGENT_API_SECRET_NGAU_NHIEN_MANH>"


def _write_config(tmp_path: Path, *, secret: str = _TEST_AGENT_CRED, allowed_ips: str = "127.0.0.1,::1") -> Path:
    cfg = tmp_path / "config.ini"
    cfg.write_text(
        "[token]\n"
        "pkcs11_lib = /mock/WDPKCS.dll\n"
        "token_label =\n\n"
        "[auth]\n"
        f"api_secret = {secret}\n"
        f"allowed_ips = {allowed_ips}\n"
        "rate_limit_max_failures = 5\n"
        "rate_limit_window_seconds = 60\n"
        "allow_windows_logon_fallback = false\n",
        encoding="utf-8",
    )
    return cfg


def test_tc_sec_22_missing_config_fails_closed(tmp_path: Path):
    agent = _load_agent_module()
    missing = tmp_path / "does-not-exist.ini"
    with pytest.raises(RuntimeError, match="Thieu file cau hinh"):
        agent.load_config(missing)


def test_tc_sec_22_placeholder_secret_rejected(tmp_path: Path):
    agent = _load_agent_module()
    cfg_path = _write_config(tmp_path, secret=_PLACEHOLDER_CRED)
    with pytest.raises(RuntimeError, match="api_secret"):
        agent.load_config(cfg_path)


def test_tc_sec_22_health_omits_pkcs11_and_docs_disabled(tmp_path: Path):
    agent = _load_agent_module()
    cfg = agent.load_config(_write_config(tmp_path))
    client = TestClient(agent.create_app(cfg))

    r_health = client.get("/health")
    assert r_health.status_code == 200
    assert r_health.json() == {"status": "ok"}
    assert "pkcs11_lib" not in r_health.json()

    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404
    assert client.get("/openapi.json").status_code == 404


def test_tc_sec_22_ip_allowlist_and_rate_limiting(tmp_path: Path, monkeypatch):
    agent = _load_agent_module()
    cid, der, mod = _make_test_cert_der()
    _install_fake_pkcs11(monkeypatch, der, [mod])

    # Disallow testclient IP (127.0.0.1) -> 403
    cfg_blocked = agent.load_config(_write_config(tmp_path, allowed_ips="10.99.99.99/32"))
    client_blocked = TestClient(agent.create_app(cfg_blocked))
    r_ip = client_blocked.get("/certs", headers={"X-Agent-Secret": "super-strong-agent-secret-32chars!"})
    assert r_ip.status_code == 403

    # Allow 127.0.0.1, send 5 wrong secrets -> 5th/6th returns 429
    cfg_ok = agent.load_config(_write_config(tmp_path, allowed_ips="127.0.0.1,::1"))
    client_ok = TestClient(agent.create_app(cfg_ok))
    statuses = [
        client_ok.get("/certs", headers={"X-Admin-Password": "wrong-secret"}).status_code
        for _ in range(6)
    ]
    assert statuses[:4] == [401, 401, 401, 401]
    assert 429 in statuses[4:]
    assert statuses[5] == 429


def test_tc_sec_22_sign_raw_rejects_sha1_oversized_and_modulus_mismatch(tmp_path: Path, monkeypatch):
    agent = _load_agent_module()
    cid, der, real_modulus = _make_test_cert_der()
    agent_cred = _TEST_AGENT_CRED
    cfg = agent.load_config(_write_config(tmp_path, secret=agent_cred))
    client = TestClient(agent.create_app(cfg))
    headers = {"X-Agent-Secret": agent_cred}

    # 2 wrong private keys on token -> MUST return 404 and NEVER sign with keys[0]!
    signed_by = _install_fake_pkcs11(monkeypatch, der, [real_modulus + 1, real_modulus + 2])

    # SHA-1 rejected with 400
    r_sha1 = client.post(
        "/sign-raw",
        headers=headers,
        json={
            "cert_id": cid,
            "pin": "1234",
            "digest_algorithm": "sha1",
            "data_b64": base64.b64encode(b"payload").decode(),
        },
    )
    assert r_sha1.status_code == 400
    assert signed_by == []

    # Oversized >1 MiB payload rejected with 413
    oversized = base64.b64encode(b"A" * (1_048_576 + 1)).decode()
    r_big = client.post(
        "/sign-raw",
        headers=headers,
        json={
            "cert_id": cid,
            "pin": "1234",
            "digest_algorithm": "sha256",
            "data_b64": oversized,
        },
    )
    assert r_big.status_code == 413
    assert signed_by == []

    # Modulus mismatch -> 404 (no silent keys[0] fallback!)
    r_mismatch = client.post(
        "/sign-raw",
        headers=headers,
        json={
            "cert_id": cid,
            "pin": "1234",
            "digest_algorithm": "sha256",
            "data_b64": base64.b64encode(b"digest-bytes").decode(),
        },
    )
    assert r_mismatch.status_code == 404
    assert signed_by == []

    # Matching 2nd key on 2-key token succeeds cleanly with SHA-256
    signed_by_ok = _install_fake_pkcs11(monkeypatch, der, [real_modulus + 99, real_modulus])
    r_ok = client.post(
        "/sign-raw",
        headers=headers,
        json={
            "cert_id": cid,
            "pin": "1234",
            "digest_algorithm": "sha256",
            "data_b64": base64.b64encode(b"digest-bytes").decode(),
        },
    )
    assert r_ok.status_code == 200
    assert base64.b64decode(r_ok.json()["signature_b64"]) == b"FAKE-SIG-1"
    assert signed_by_ok == [1]
