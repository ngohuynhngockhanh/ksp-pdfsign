"""ksp-pdfsign — Hardened Windows Signing Agent.

Chay tren may Windows co cam token WIN-CA (vi du 192.168.1.4).
Mo HTTPS API cho backend goi toi de:
  - GET  /health              : trang thai song (khong lo duong dan DLL)
  - GET  /certs               : liet ke chung thu ky tren token
  - GET  /cert-chain/{id}     : lay chung thu + chuoi (DER, base64)
  - POST /sign-raw            : ky raw `data` bang token, tra ve chu ky raw

Bao mat:
  - Bat buoc co file config.ini (fail closed, KHONG fallback sang config.example.ini).
  - Xac thuc bang dedicated `api_secret` qua `X-Agent-Secret` (hoac tuong thich nguoc
    `X-Admin-Password`) so sanh bang `hmac.compare_digest`. Windows LogonUser chi bat
    khi chu dong cau hinh `allow_windows_logon_fallback = true`.
  - Allowlist IP nguon (`allowed_ips`) va gioi han sai mat khau (5 lan -> HTTP 429).
  - Chi ho tro SHA-256 / SHA-384 / SHA-512 (loai bo SHA-1), gioi han payload <= 1 MiB,
    va KHONG fallback sang `keys[0]` khi khong khop modulus cua chung thu.
"""
from __future__ import annotations

import base64
import binascii
import configparser
import hashlib
import hmac
import ipaddress
import json
import logging
import os
import sys
import threading
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel

MAX_SIGN_PAYLOAD_BYTES = 1_048_576  # 1 MiB
RATE_LIMIT_MAX_FAILURES = 5
RATE_LIMIT_WINDOW_SECONDS = 60.0
PLACEHOLDER_PREFIXES = ("<DAT_", "<CHANGE_", "change-me")

audit_logger = logging.getLogger("windows_agent.audit")
if not audit_logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(message)s"))
    audit_logger.addHandler(_handler)
    audit_logger.setLevel(logging.INFO)


def _audit(event: str, **fields: object) -> None:
    record = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "event": event, **fields}
    audit_logger.info(json.dumps(record, ensure_ascii=False))


@dataclass(frozen=True)
class AgentConfig:
    pkcs11_lib: str
    token_label: str
    api_secret: str
    allow_windows_logon_fallback: bool
    allowed_networks: tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]
    rate_limit_max_failures: int = RATE_LIMIT_MAX_FAILURES
    rate_limit_window_seconds: float = RATE_LIMIT_WINDOW_SECONDS


def _parse_allowed_networks(raw: str) -> tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]:
    nets: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
    for item in (raw or "127.0.0.1,::1").split(","):
        token = item.strip()
        if not token:
            continue
        if token.lower() == "localhost":
            nets.append(ipaddress.ip_network("127.0.0.1/32"))
            nets.append(ipaddress.ip_network("::1/128"))
            continue
        nets.append(ipaddress.ip_network(token, strict=False))
    if not nets:
        raise RuntimeError("Cau hinh [auth] allowed_ips khong duoc rong")
    return tuple(nets)


def _is_placeholder_secret(value: str) -> bool:
    stripped = (value or "").strip()
    if not stripped:
        return True
    return any(stripped.startswith(prefix) for prefix in PLACEHOLDER_PREFIXES)


def load_config(config_path: Path | None = None) -> AgentConfig:
    """Doc cau hinh tu config.ini; fail closed neu thieu file hoac thieu secret."""
    resolved = config_path or Path(os.environ.get("AGENT_CONFIG_PATH") or Path(__file__).with_name("config.ini"))
    if not resolved.is_file():
        raise RuntimeError(
            f"Thieu file cau hinh bat buoc: {resolved}. Copy config.example.ini -> config.ini va dat api_secret manh."
        )
    cfg = configparser.ConfigParser()
    cfg.read(resolved, encoding="utf-8")

    pkcs11_lib = cfg.get("token", "pkcs11_lib", fallback=r"C:\Windows\System32\WDPKCS.dll").strip()
    token_label = cfg.get("token", "token_label", fallback="").strip()
    api_secret = (
        cfg.get("auth", "api_secret", fallback="").strip()
        or cfg.get("auth", "admin_password", fallback="").strip()
    )
    allow_windows_logon_fallback = cfg.getboolean("auth", "allow_windows_logon_fallback", fallback=False)
    allowed_raw = cfg.get("auth", "allowed_ips", fallback="127.0.0.1,::1")
    allowed_networks = _parse_allowed_networks(allowed_raw)

    if not allow_windows_logon_fallback and _is_placeholder_secret(api_secret):
        raise RuntimeError(
            "Cau hinh [auth] api_secret trong config.ini bi trong hoac van giu gia tri mau."
        )

    return AgentConfig(
        pkcs11_lib=pkcs11_lib,
        token_label=token_label,
        api_secret=api_secret,
        allow_windows_logon_fallback=allow_windows_logon_fallback,
        allowed_networks=allowed_networks,
        rate_limit_max_failures=cfg.getint("auth", "rate_limit_max_failures", fallback=RATE_LIMIT_MAX_FAILURES),
        rate_limit_window_seconds=cfg.getfloat("auth", "rate_limit_window_seconds", fallback=RATE_LIMIT_WINDOW_SECONDS),
    )


class FailureRateLimiter:
    def __init__(self, max_failures: int = RATE_LIMIT_MAX_FAILURES, window_seconds: float = RATE_LIMIT_WINDOW_SECONDS, clock: Callable[[], float] = time.monotonic):
        self.max_failures = max_failures
        self.window_seconds = window_seconds
        self.clock = clock
        self._failures: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def _prune(self, ip: str, now: float) -> deque[float]:
        bucket = self._failures.setdefault(ip, deque())
        cutoff = now - self.window_seconds
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        return bucket

    def check(self, ip: str) -> bool:
        now = self.clock()
        with self._lock:
            bucket = self._prune(ip, now)
            return len(bucket) < self.max_failures

    def record_failure(self, ip: str) -> int:
        now = self.clock()
        with self._lock:
            bucket = self._prune(ip, now)
            bucket.append(now)
            return len(bucket)

    def reset(self, ip: str) -> None:
        with self._lock:
            self._failures.pop(ip, None)


def _client_ip(request: Request) -> str:
    raw = request.client.host if request.client and request.client.host else ""
    if raw.startswith("::ffff:"):
        raw = raw[7:]
    if raw == "testclient":
        return "127.0.0.1"
    return raw


def _ip_is_allowed(ip: str, networks: tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in networks)


class SignRawRequest(BaseModel):
    cert_id: str
    pin: str
    digest_algorithm: str = "sha256"
    data_b64: str


def _cert_summary(der: bytes) -> dict:
    from asn1crypto import x509

    c = x509.Certificate.load(der)
    tbs = c["tbs_certificate"]
    return {
        "subject": c.subject.human_friendly,
        "issuer": c.issuer.human_friendly,
        "serial": str(tbs["serial_number"].native),
        "valid_from": tbs["validity"]["not_before"].native.isoformat(),
        "valid_to": tbs["validity"]["not_after"].native.isoformat(),
    }


def _open_session(config: AgentConfig, pin: str):
    """Mo phien PKCS#11 da dang nhap PIN."""
    import pkcs11  # python-pkcs11

    lib = pkcs11.lib(config.pkcs11_lib)
    slots = [s for s in lib.get_slots(token_present=True)]
    if not slots:
        raise HTTPException(503, "Khong tim thay token (khong co slot).")
    token = None
    for s in slots:
        t = s.get_token()
        if not config.token_label or t.label == config.token_label:
            token = t
            break
    if token is None:
        raise HTTPException(503, f"Khong tim thay token nhan '{config.token_label}'.")
    return token.open(user_pin=pin)


def _list_certificates_raw(config: AgentConfig) -> list[tuple[str, bytes]]:
    """Tra ve [(id_hex, cert_der)] cho tat ca chung thu tren token."""
    import pkcs11
    from pkcs11 import Attribute, ObjectClass

    lib = pkcs11.lib(config.pkcs11_lib)
    out: list[tuple[str, bytes]] = []
    for slot in lib.get_slots(token_present=True):
        token = slot.get_token()
        with token.open() as session:
            for obj in session.get_objects({Attribute.CLASS: ObjectClass.CERTIFICATE}):
                der = bytes(obj[Attribute.VALUE])
                cid = hashlib.sha1(der).hexdigest()
                out.append((cid, der))
    return out


def create_app(config: AgentConfig | None = None) -> FastAPI:
    cfg = config or load_config()
    limiter = FailureRateLimiter(
        max_failures=cfg.rate_limit_max_failures,
        window_seconds=cfg.rate_limit_window_seconds,
    )
    application = FastAPI(
        title="ksp-pdfsign windows-agent",
        version="2.0.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    def _authorize(
        request: Request,
        x_agent_secret: str | None,
        x_admin_password: str | None,
    ) -> str:
        ip = _client_ip(request)
        if not _ip_is_allowed(ip, cfg.allowed_networks):
            _audit("auth_ip_denied", client_ip=ip, path=request.url.path)
            raise HTTPException(403, "Dia chi IP khong nam trong danh sach cho phep")

        if not limiter.check(ip):
            _audit("auth_rate_limited", client_ip=ip, path=request.url.path)
            raise HTTPException(429, "Qua nhieu lan xac thuc that bai; thu lai sau")

        supplied = (x_agent_secret or x_admin_password or "").strip()
        if not supplied:
            limiter.record_failure(ip)
            _audit("auth_missing_secret", client_ip=ip, path=request.url.path)
            raise HTTPException(401, "Thieu khoa xac thuc agent")

        if not _is_placeholder_secret(cfg.api_secret) and hmac.compare_digest(supplied, cfg.api_secret):
            limiter.reset(ip)
            return ip

        if cfg.allow_windows_logon_fallback and sys.platform == "win32":
            try:
                import win32security  # type: ignore

                handle = win32security.LogonUser("Administrator", ".", supplied, 3, 0)
                handle.Close()
                limiter.reset(ip)
                return ip
            except Exception:
                pass

        failures = limiter.record_failure(ip)
        _audit("auth_failed", client_ip=ip, path=request.url.path, failures=failures)
        if failures >= cfg.rate_limit_max_failures:
            raise HTTPException(429, "Qua nhieu lan xac thuc that bai; thu lai sau")
        raise HTTPException(401, "Sai khoa xac thuc agent")

    @application.get("/health")
    def health():
        return {"status": "ok"}

    @application.get("/certs")
    def certs(
        request: Request,
        x_agent_secret: str | None = Header(default=None),
        x_admin_password: str | None = Header(default=None),
    ):
        ip = _authorize(request, x_agent_secret, x_admin_password)
        result = []
        for cid, der in _list_certificates_raw(cfg):
            info = _cert_summary(der)
            info["id"] = cid
            result.append(info)
        _audit("certs_listed", client_ip=ip, count=len(result))
        return {"certs": result}

    @application.get("/cert-chain/{cert_id}")
    def cert_chain(
        cert_id: str,
        request: Request,
        x_agent_secret: str | None = Header(default=None),
        x_admin_password: str | None = Header(default=None),
    ):
        ip = _authorize(request, x_agent_secret, x_admin_password)
        certs_raw = _list_certificates_raw(cfg)
        by_id = {cid: der for cid, der in certs_raw}
        if cert_id not in by_id:
            _audit("cert_chain_not_found", client_ip=ip, cert_id=cert_id)
            raise HTTPException(404, "Khong tim thay chung thu")
        signing_der = by_id[cert_id]
        others = [der for cid, der in certs_raw if cid != cert_id]
        chain = [signing_der, *others]
        _audit("cert_chain_served", client_ip=ip, cert_id=cert_id, chain_len=len(chain))
        return {"chain_der_b64": [base64.b64encode(d).decode() for d in chain]}

    @application.post("/sign-raw")
    def sign_raw(
        req: SignRawRequest,
        request: Request,
        x_agent_secret: str | None = Header(default=None),
        x_admin_password: str | None = Header(default=None),
    ):
        ip = _authorize(request, x_agent_secret, x_admin_password)
        from pkcs11 import Attribute, KeyType, Mechanism, ObjectClass

        # Bounded strict base64 decoding (<= 1 MiB decoded)
        if len(req.data_b64) > (MAX_SIGN_PAYLOAD_BYTES * 4 // 3) + 16:
            _audit("sign_payload_too_large", client_ip=ip, cert_id=req.cert_id)
            raise HTTPException(413, "Du lieu ky vuot qua gioi han 1 MiB")
        try:
            data = base64.b64decode(req.data_b64, validate=True)
        except (binascii.Error, ValueError):
            _audit("sign_invalid_base64", client_ip=ip, cert_id=req.cert_id)
            raise HTTPException(400, "data_b64 khong hop le")
        if len(data) > MAX_SIGN_PAYLOAD_BYTES:
            _audit("sign_payload_too_large", client_ip=ip, cert_id=req.cert_id, size=len(data))
            raise HTTPException(413, "Du lieu ky vuot qua gioi han 1 MiB")

        algo = (req.digest_algorithm or "").strip().lower()
        mechanism = {
            "sha256": Mechanism.SHA256_RSA_PKCS,
            "sha384": Mechanism.SHA384_RSA_PKCS,
            "sha512": Mechanism.SHA512_RSA_PKCS,
        }.get(algo)
        if mechanism is None:
            _audit("sign_unsupported_algo", client_ip=ip, cert_id=req.cert_id, algo=algo)
            raise HTTPException(400, f"digest_algorithm khong ho tro: {req.digest_algorithm}")

        target_der = None
        for cid, der in _list_certificates_raw(cfg):
            if cid == req.cert_id:
                target_der = der
                break
        if target_der is None:
            _audit("sign_cert_not_found", client_ip=ip, cert_id=req.cert_id)
            raise HTTPException(404, "Khong tim thay chung thu de ky")

        session = _open_session(cfg, req.pin)
        try:
            from asn1crypto import x509 as ax509

            cert = ax509.Certificate.load(target_der)
            modulus = cert.public_key["public_key"].parsed["modulus"].native

            priv = None
            for key in session.get_objects(
                {Attribute.CLASS: ObjectClass.PRIVATE_KEY, Attribute.KEY_TYPE: KeyType.RSA}
            ):
                try:
                    if int.from_bytes(bytes(key[Attribute.MODULUS]), "big") == modulus:
                        priv = key
                        break
                except Exception:
                    continue
            if priv is None:
                _audit("sign_key_mismatch", client_ip=ip, cert_id=req.cert_id)
                raise HTTPException(404, "Khong tim thay private key RSA khop voi chung thu duoc yeu cau")

            signature = priv.sign(data, mechanism=mechanism)
            _audit("sign_succeeded", client_ip=ip, cert_id=req.cert_id, algo=algo, payload_bytes=len(data))
            return {"signature_b64": base64.b64encode(bytes(signature)).decode()}
        finally:
            session.close()

    return application


if os.environ.get("AGENT_DEFER_APP_INIT") != "1":
    app = create_app()
else:
    app = None
