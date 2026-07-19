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

    # Ky so - mac dinh
    default_location: str = "Đắk Lắk"

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

    # Hinh thuc chu ky (appearance)
    signature_font: str = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    logo_opacity: float = 0.12  # do mo cua logo chim

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
    def default_logo_path(self) -> Path:
        return REPO_ROOT / "backend" / "app" / "assets" / "logo.png"

    @property
    def logo_path(self) -> Path:
        """Logo dang dung: uu tien logo do admin tai len, neu khong dung mac dinh."""
        uploaded = self.data_path / "logo.png"
        return uploaded if uploaded.exists() else self.default_logo_path

    def effective_jwt_secret(self) -> str:
        """Bi mat ky JWT thuc su dung. Neu con de MAC DINH (cong khai trong repo),
        tu sinh mot secret ngau nhien manh va luu lai — dong lo hong gia mao token
        role=admin ngay ca khi nguoi dung chua cau hinh JWT_SECRET.
        """
        if "change-me" not in self.jwt_secret and len(self.jwt_secret) >= 24:
            return self.jwt_secret
        keyfile = self.data_path / "jwt_secret.key"
        if keyfile.exists():
            return keyfile.read_text().strip()
        import secrets

        s = secrets.token_urlsafe(48)
        keyfile.write_text(s)
        keyfile.chmod(0o600)
        return s

    @property
    def using_default_secrets(self) -> bool:
        """True neu con dung mat khau/bi mat mac dinh (de canh bao tren UI)."""
        # JWT secret duoc tu sinh (effective_jwt_secret) nen khong tinh vao day.
        return (
            self.app_admin_password == "NhapHang123@"
            or self.agent_admin_password == "NhapHang123"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
