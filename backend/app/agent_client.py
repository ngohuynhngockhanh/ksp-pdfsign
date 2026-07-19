"""Client goi toi Windows Agent (may cam token WIN-CA).

Chi gui DIGEST/DATA can ky qua mang, khong gui ca file PDF.
"""
from __future__ import annotations

import base64

import httpx

from .config import Settings
from .schemas import AgentTarget, CertInfo


class AgentError(RuntimeError):
    pass


def _base_url(settings: Settings, ip: str) -> str:
    return f"{settings.agent_scheme}://{ip}:{settings.agent_port}"


def _client(settings: Settings) -> httpx.Client:
    return httpx.Client(verify=settings.agent_verify_tls, timeout=30.0)


def list_certs(settings: Settings, ip: str, admin_password: str) -> list[CertInfo]:
    """Liet ke chung thu ky co tren token qua agent."""
    url = f"{_base_url(settings, ip)}/certs"
    try:
        with _client(settings) as c:
            r = c.get(url, headers={"X-Admin-Password": admin_password})
    except httpx.HTTPError as e:
        raise AgentError(f"Khong ket noi duoc agent tai {ip}: {e}") from e
    if r.status_code == 401:
        raise AgentError("Sai mat khau Administrator (agent tu choi).")
    if r.status_code != 200:
        raise AgentError(f"Agent loi {r.status_code}: {r.text[:200]}")
    return [CertInfo(**item) for item in r.json().get("certs", [])]


def sign_raw(
    settings: Settings,
    agent: AgentTarget,
    cert_id: str,
    data: bytes,
    digest_algorithm: str,
) -> bytes:
    """Yeu cau agent ky raw `data` bang token (tra ve chu ky raw).

    Agent phai ky `data` bang PKCS#11 mechanism tuong ung digest_algorithm
    (vi du sha256 -> CKM_SHA256_RSA_PKCS), tuc la tu bam + pad + ky ben trong token.
    """
    url = f"{_base_url(settings, agent.ip)}/sign-raw"
    payload = {
        "cert_id": cert_id,
        "pin": agent.pin,
        "digest_algorithm": digest_algorithm,
        "data_b64": base64.b64encode(data).decode("ascii"),
    }
    try:
        with _client(settings) as c:
            r = c.post(
                url,
                json=payload,
                headers={"X-Admin-Password": agent.admin_password},
            )
    except httpx.HTTPError as e:
        raise AgentError(f"Khong ket noi duoc agent tai {agent.ip}: {e}") from e
    if r.status_code == 401:
        raise AgentError("Sai mat khau Administrator (agent tu choi ky).")
    if r.status_code != 200:
        raise AgentError(f"Agent ky that bai {r.status_code}: {r.text[:200]}")
    sig_b64 = r.json().get("signature_b64")
    if not sig_b64:
        raise AgentError("Agent khong tra ve chu ky.")
    return base64.b64decode(sig_b64)


def get_cert_chain(
    settings: Settings, ip: str, admin_password: str, cert_id: str
) -> list[bytes]:
    """Lay chung thu ky + chuoi (DER bytes) cho cert_id."""
    url = f"{_base_url(settings, ip)}/cert-chain/{cert_id}"
    try:
        with _client(settings) as c:
            r = c.get(url, headers={"X-Admin-Password": admin_password})
    except httpx.HTTPError as e:
        raise AgentError(f"Khong ket noi duoc agent tai {ip}: {e}") from e
    if r.status_code != 200:
        raise AgentError(f"Khong lay duoc chuoi chung thu {r.status_code}: {r.text[:200]}")
    return [base64.b64decode(x) for x in r.json().get("chain_der_b64", [])]
