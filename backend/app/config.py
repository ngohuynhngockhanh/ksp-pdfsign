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
    app_admin_password: str = ""

    # JWT
    jwt_secret: str = "change-me-to-a-long-random-string"
    jwt_ttl_minutes: int = 480

    # Ky so - mac dinh
    default_location: str = "Đắk Lắk"

    # Chia se file: URL goc dung de tao link + so ngay het han mac dinh
    public_base_url: str = "https://ksp-pdf-signer.p2p.inut.io.vn"
    share_default_days: int = 7

    # BBBG - thong tin Ben A (ben ban/ban giao) mac dinh (INUT), cho sua
    bbbg_company: str = "CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT"
    bbbg_address: str = "161 Trường Chinh, Phường Tuy Hòa, Tỉnh Đắk Lắk, Việt Nam"
    bbbg_mst: str = "4401053694"
    bbbg_phone: str = "0972768491"
    bbbg_rep: str = "NGÔ HUỲNH NGỌC KHÁNH"
    bbbg_rep_title: str = "Giám đốc"

    # De nghi thanh toan - letterhead rieng (khac BBBG: TP.HCM / Tong giam doc)
    dntt_noi_lap: str = "TP.HCM"
    dntt_email: str = "khanhnhn@inut.vn"
    dntt_website: str = "inut.vn"
    dntt_rep: str = "NGÔ HUỲNH NGỌC KHÁNH"
    dntt_rep_title: str = "Tổng giám đốc"

    # Tai khoan nhan thanh toan (sau nay mo rong BANK_ACCOUNTS nhieu STK)
    bank_account_name: str = "CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT"
    bank_account_number: str = "79713"
    bank_name: str = "Techcombank - Ngân hàng Thương mại Cổ phần Kỹ Thương Việt Nam"

    # AI (endpoint tuong thich OpenAI) - mac dinh 9router local
    ai_enabled: bool = False
    ai_base_url: str = "http://127.0.0.1:20128/v1"
    ai_api_key: str = "public"
    ai_model: str = "opencode/big-pickle"
    ai_max_tokens: int = 3500
    ai_timeout: float = 120.0

    # iNut Training proxy. Mat khau chi dung server-to-server, UI khong hoi lai.
    training_base_url: str = "http://127.0.0.1:8090"
    training_password: str = ""
    training_timeout: float = 180.0
    training_rate_limit_per_minute: int = 100
    training_rate_window_seconds: int = 60
    training_share_days: int = 30

    # Facebook Messenger webhook. Secrets must stay in the server environment.
    facebook_enabled: bool = False
    facebook_page_id: str = "1698631723787176"
    facebook_page_name: str = "INUT JSC - IoT and Edge Computing"
    facebook_verify_token: str = ""
    facebook_app_secret: str = ""
    facebook_page_access_token: str = ""
    facebook_graph_base_url: str = "https://graph.facebook.com"
    facebook_graph_version: str = "v23.0"
    facebook_timeout: float = 20.0
    facebook_reply_enabled: bool = True
    # Retained for config compatibility; Facebook never sends Messenger history to Hermes.
    facebook_context_turns: int = 0
    facebook_retention_days: int = 365

    # Telegram notifications. The bot token is only read from the server env.
    telegram_enabled: bool = False
    telegram_bot_token: str = ""
    telegram_bot_username: str = "Webinut_bot"
    telegram_api_base_url: str = "https://api.telegram.org"
    telegram_poll_timeout: int = 25
    telegram_connect_ttl_seconds: int = 600
    telegram_notify_enabled: bool = True

    # Trợ lý công khai trên inut.vn. Secret chỉ dùng server-to-server qua BFF.
    public_training_enabled: bool = False
    public_training_hmac_secret: str = ""
    public_training_client_id: str = "inut-website"
    public_training_retention_days: int = 365
    public_training_rate_limit: int = 100
    public_training_rate_window_seconds: int = 60

    # Dong bo NAS (SMB) - backup ho so 1 chieu app -> NAS
    nas_enabled: bool = True
    nas_host: str = "172.32.0.100"
    nas_share: str = "inut"
    nas_user: str = "ksp"
    nas_password: str = "Nhaphang123"
    nas_base_path: str = "ho-so"
    nas_timeout: int = 10

    # Bang luong: dong bo file Excel tu Google Drive qua rclone.
    payroll_drive_remote: str = "vnmap-drive:"
    payroll_drive_folder_id: str = "1FSWhB8T_yWB2MD6ig181qgM_NnEX3GvI"
    payroll_rclone_bind: str = "0.0.0.0"

    # Ho so nhap khau: Drive chi doc, folder ID luu theo nam trong DB.
    customs_drive_remote: str = "vnmap-drive:"
    customs_drive_bind: str = "0.0.0.0"

    # ECUS attachments: snapshot DB qua SCP, khong mo ECUS hay ky/gui lai VNACCS.
    ecus_drive_sync_enabled: bool = False
    ecus_ssh_host: str = "192.168.1.10"
    ecus_ssh_user: str = "Administrator"

    ecus_ssh_key_path: str = "/home/ksp/.ssh/id_ed25519"
    ecus_db_path: str = "C:/pro/ECUSSIGN_PRO/Database/ECUSSIGN_DN_4401053694.DB"
    ecus_ssh_timeout: int = 60

    # iHOADON - chi dong bo va tao hoa don GHI_TAM, khong ky/phat hanh.
    ihoadon_enabled: bool = False
    ihoadon_base_url: str = "https://ihoadon.com.vn"
    ihoadon_tax_code: str = "4401053694"
    ihoadon_username: str = "4401053694"
    ihoadon_password: str = ""
    ihoadon_timeout: float = 30.0

    # TQC CNHQ lookup. The API key is optional and never exposed to clients.
    tqc_cnhq_base_url: str = "https://api-cnhq.tqc.gov.vn"
    tqc_cnhq_api_key: str = ""
    tqc_cnhq_timeout: float = 15.0
    tqc_cnhq_cache_ttl_seconds: int = 86400
    tqc_cnhq_rate_limit_per_minute: int = 450

    # Zoho Mail Sync (đồng bộ hóa đơn PDF/XML từ email qua REST API OAuth 2.0 hoặc IMAP)
    zoho_sync_mode: str = "rest_api"  # "rest_api" | "imap"
    zoho_client_id: str = ""
    zoho_client_secret: str = ""
    zoho_refresh_token: str = ""
    zoho_accounts_url: str = "https://accounts.zoho.com"
    zoho_mail_api_url: str = "https://mail.zoho.com"
    zoho_imap_enabled: bool = True
    zoho_imap_server: str = "imappro.zoho.com"
    zoho_imap_port: int = 993
    zoho_imap_username: str = "khanhnhn@inut.vn"
    zoho_imap_password: str = ""
    zoho_imap_mailbox: str = "INBOX"
    zoho_imap_days: int = 30
    zoho_imap_timeout: float = 20.0

    # Email canh bao job thue
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_to: str = ""

    # Windows agent (may cam token)
    agent_default_ip: str = "192.168.1.10"
    agent_port: int = 8443
    agent_scheme: str = "https"
    agent_admin_password: str = ""
    agent_verify_tls: bool = False

    # Che do ky: "ssh" (SSH + PowerShell + kho chung thu Windows, KHONG can cai
    # gi tren may Windows) hoac "agent" (goi HTTP toi Windows Agent da cai).
    signing_mode: str = "ssh"
    ssh_user: str = "Administrator"
    ssh_connect_timeout: int = 15
    ssh_command_timeout: int = 300

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
        try:
            p.chmod(0o700)
        except OSError:
            pass
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
            not self.app_admin_password
            or not self.agent_admin_password
            or self.app_admin_password == "NhapHang123@"
            or self.agent_admin_password == "NhapHang123"
        )


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    # Ap override cau hinh dong (AI/NAS) tu DB len tren gia tri .env.
    # Import tre de tranh vong lap (settings_store -> db -> config).
    try:
        from . import settings_store

        settings_store.apply_overrides(s)
    except Exception:
        pass
    return s
