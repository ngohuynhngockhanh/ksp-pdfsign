"""Cau hinh ung dung, doc tu bien moi truong / file .env."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Thu muc goc cua repo (…/ksp-pdfsign)
REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Dang nhap trang web
    app_admin_username: str = "admin"
    app_admin_password: str = "NhapHang123@"

    # JWT
    jwt_secret: str = "change-me-to-a-long-random-string"
    jwt_ttl_minutes: int = 480

    # Windows agent (may cam token)
    agent_default_ip: str = "192.168.1.4"
    agent_port: int = 8443
    agent_scheme: str = "https"
    agent_admin_password: str = "NhapHang123"
    agent_verify_tls: bool = False

    # Che do ky: "ssh" (SSH + PowerShell + kho chung thu Windows, KHONG can cai
    # gi tren may Windows) hoac "agent" (goi HTTP toi Windows Agent da cai).
    signing_mode: str = "ssh"
    ssh_user: str = "Administrator"
    ssh_connect_timeout: int = 10
    ssh_command_timeout: int = 60

    # Ky so
    tsa_url: str = ""
    enable_ltv: bool = False

    # Kiem tra chu ky: co thu tai OCSP/CRL khi kiem tra khong (can Internet).
    verify_allow_fetching: bool = False

    # Luu tru
    data_dir: str = "./backend/data"

    @property
    def data_path(self) -> Path:
        p = Path(self.data_dir)
        if not p.is_absolute():
            p = REPO_ROOT / p
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def trust_path(self) -> Path:
        return REPO_ROOT / "backend" / "app" / "trust"

    @property
    def using_default_secrets(self) -> bool:
        """True neu con dung mat khau/bi mat mac dinh (de canh bao tren UI)."""
        return (
            self.app_admin_password == "NhapHang123@"
            or self.agent_admin_password == "NhapHang123"
            or "change-me" in self.jwt_secret
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
