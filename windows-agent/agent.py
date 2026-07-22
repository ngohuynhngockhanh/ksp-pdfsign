"""ksp-pdfsign — Windows Signing Agent.

Chay tren may Windows co cam token WIN-CA (vi du 192.168.1.4).
Mo HTTPS API cho backend goi toi de:
  - GET  /certs               : liet ke chung thu ky tren token
  - GET  /cert-chain/{id}     : lay chung thu + chuoi (DER, base64)
  - POST /sign-raw            : ky raw `data` bang token, tra ve chu ky raw

Xac thuc: moi request phai kem header X-Admin-Password = mat khau Administrator
cua may Windows; agent kiem tra bang Windows LogonUser (chi ai biet mat khau
admin moi ky duoc). Tren nen tang khac (test tren Linux), dat AGENT_ADMIN_PASSWORD
trong config de so khop truc tiep.

Co che ky (uu tien PKCS#11, co the chuyen sang CNG neu can):
  - PKCS#11 qua DLL cua token (WIN-CA). Xac dinh dung duong dan DLL trong config.
  - Mechanism: CKM_SHA256_RSA_PKCS (khop digest_algorithm sha256 tu backend) —
    token tu bam + pad + ky ben trong, dung voi hop dong async_sign_raw cua pyHanko.
"""
from __future__ import annotations

import base64
import configparser
import hashlib
import sys
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

CONFIG_PATH = Path(__file__).with_name("config.ini")

# ---------------------------------------------------------------------------
# Cau hinh
# ---------------------------------------------------------------------------
_cfg = configparser.ConfigParser()
_cfg.read(CONFIG_PATH if CONFIG_PATH.exists() else Path(__file__).with_name("config.example.ini"))

PKCS11_LIB = _cfg.get("token", "pkcs11_lib", fallback=r"C:\Windows\System32\WDPKCS.dll")
TOKEN_LABEL = _cfg.get("token", "token_label", fallback="")
ADMIN_PASSWORD_FALLBACK = _cfg.get("auth", "admin_password", fallback="")
USE_WINDOWS_LOGON = _cfg.getboolean("auth", "use_windows_logon", fallback=True)

app = FastAPI(title="ksp-pdfsign windows-agent", version="1.0.0")


# ---------------------------------------------------------------------------
# Xac thuc mat khau Administrator
# ---------------------------------------------------------------------------
def _check_admin(admin_password: str | None) -> None:
    if not admin_password:
        raise HTTPException(401, "Thieu mat khau Administrator")
    if USE_WINDOWS_LOGON and sys.platform == "win32":
        try:
            import win32security  # type: ignore

            # LOGON32_LOGON_NETWORK=3, LOGON32_PROVIDER_DEFAULT=0
            handle = win32security.LogonUser(
                "Administrator", ".", admin_password, 3, 0
            )
            handle.Close()
            return
        except Exception:
            raise HTTPException(401, "Sai mat khau Administrator")
    # Fallback (khong phai Windows hoac tat LogonUser): so khop cau hinh.
    if admin_password != ADMIN_PASSWORD_FALLBACK:
        raise HTTPException(401, "Sai mat khau Administrator")


# ---------------------------------------------------------------------------
# Truy cap token qua PKCS#11
# ---------------------------------------------------------------------------
def _open_session(pin: str):
    """Mo phien PKCS#11 da dang nhap PIN. Tra ve (session, lib)."""
    import pkcs11  # python-pkcs11

    lib = pkcs11.lib(PKCS11_LIB)
    slots = [s for s in lib.get_slots(token_present=True)]
    if not slots:
        raise HTTPException(503, "Khong tim thay token (khong co slot).")
    token = None
    for s in slots:
        t = s.get_token()
        if not TOKEN_LABEL or t.label == TOKEN_LABEL:
            token = t
            break
    if token is None:
        raise HTTPException(503, f"Khong tim thay token nhan '{TOKEN_LABEL}'.")
    session = token.open(user_pin=pin)
    return session


def _list_certificates_raw() -> list[tuple[str, bytes]]:
    """Tra ve [(id_hex, cert_der)] cho tat ca chung thu tren token."""
    import pkcs11
    from pkcs11 import Attribute, ObjectClass

    lib = pkcs11.lib(PKCS11_LIB)
    out: list[tuple[str, bytes]] = []
    for slot in lib.get_slots(token_present=True):
        token = slot.get_token()
        # Mo phien read-only khong can PIN de doc chung thu cong khai.
        with token.open() as session:
            for obj in session.get_objects({Attribute.CLASS: ObjectClass.CERTIFICATE}):
                der = bytes(obj[Attribute.VALUE])
                cid = hashlib.sha1(der).hexdigest()
                out.append((cid, der))
    return out


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class SignRawRequest(BaseModel):
    cert_id: str
    pin: str
    digest_algorithm: str = "sha256"
    data_b64: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
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


@app.get("/health")
def health():
    return {"status": "ok", "pkcs11_lib": PKCS11_LIB}


@app.get("/certs")
def certs(x_admin_password: str | None = Header(default=None)):
    _check_admin(x_admin_password)
    result = []
    for cid, der in _list_certificates_raw():
        info = _cert_summary(der)
        info["id"] = cid
        result.append(info)
    return {"certs": result}


@app.get("/cert-chain/{cert_id}")
def cert_chain(cert_id: str, x_admin_password: str | None = Header(default=None)):
    _check_admin(x_admin_password)
    certs_raw = _list_certificates_raw()
    by_id = {cid: der for cid, der in certs_raw}
    if cert_id not in by_id:
        raise HTTPException(404, "Khong tim thay chung thu")
    # Chuoi: chung thu ky truoc, sau do cac chung thu con lai (CA trung gian)
    # co tren token. pyHanko/backend se dung nhung cai lien quan.
    signing_der = by_id[cert_id]
    others = [der for cid, der in certs_raw if cid != cert_id]
    chain = [signing_der, *others]
    return {"chain_der_b64": [base64.b64encode(d).decode() for d in chain]}


@app.post("/sign-raw")
def sign_raw(req: SignRawRequest, x_admin_password: str | None = Header(default=None)):
    _check_admin(x_admin_password)
    import pkcs11
    from pkcs11 import Attribute, KeyType, Mechanism, ObjectClass

    data = base64.b64decode(req.data_b64)
    mechanism = {
        "sha1": Mechanism.SHA1_RSA_PKCS,
        "sha256": Mechanism.SHA256_RSA_PKCS,
        "sha384": Mechanism.SHA384_RSA_PKCS,
        "sha512": Mechanism.SHA512_RSA_PKCS,
    }.get(req.digest_algorithm)
    if mechanism is None:
        raise HTTPException(400, f"digest_algorithm khong ho tro: {req.digest_algorithm}")

    # Xac dinh chung thu -> lay CKA_ID de tim private key tuong ung.
    target_der = None
    for cid, der in _list_certificates_raw():
        if cid == req.cert_id:
            target_der = der
            break
    if target_der is None:
        raise HTTPException(404, "Khong tim thay chung thu de ky")

    session = _open_session(req.pin)
    try:
        # Tim private key khop public key cua chung thu (theo modulus).
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
            # Neu khong so khop duoc modulus, dung private key dau tien.
            keys = list(
                session.get_objects(
                    {Attribute.CLASS: ObjectClass.PRIVATE_KEY, Attribute.KEY_TYPE: KeyType.RSA}
                )
            )
            if not keys:
                raise HTTPException(404, "Token khong co khoa RSA de ky")
            priv = keys[0]

        signature = priv.sign(data, mechanism=mechanism)
        return {"signature_b64": base64.b64encode(bytes(signature)).decode()}
    finally:
        session.close()
