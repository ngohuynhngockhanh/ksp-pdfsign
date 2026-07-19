"""Dieu phoi ky/liet ke chung thu theo SIGNING_MODE.

- "ssh"   -> win_ssh  (SSH + PowerShell + kho chung thu Windows)  [mac dinh]
- "agent" -> agent_client (HTTP toi Windows Agent da cai)
"""
from __future__ import annotations

from . import agent_client, win_ssh
from .config import Settings
from .schemas import AgentTarget, CertInfo

# Loi chung de main.py bat 1 kieu.
BackendError = (win_ssh.WinSshError, agent_client.AgentError)


def _is_ssh(settings: Settings) -> bool:
    return settings.signing_mode.lower() == "ssh"


def list_certs(settings: Settings, ip: str, admin_password: str) -> list[CertInfo]:
    if _is_ssh(settings):
        return win_ssh.list_certs(settings, ip, admin_password)
    return agent_client.list_certs(settings, ip, admin_password)


def get_cert_chain(
    settings: Settings, ip: str, admin_password: str, cert_id: str
) -> list[bytes]:
    if _is_ssh(settings):
        return win_ssh.get_cert_chain(settings, ip, admin_password, cert_id)
    return agent_client.get_cert_chain(settings, ip, admin_password, cert_id)


def sign_raw(
    settings: Settings,
    agent: AgentTarget,
    cert_id: str,
    data: bytes,
    digest_algorithm: str,
) -> bytes:
    if _is_ssh(settings):
        return win_ssh.sign_raw(
            settings, agent.ip, agent.admin_password, cert_id, agent.pin, data, digest_algorithm
        )
    return agent_client.sign_raw(settings, agent, cert_id, data, digest_algorithm)
