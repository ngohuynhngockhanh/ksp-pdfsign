"""Ma hoa doi xung (giai ma duoc) cho secret luu trong DB — vd mat khau cong thue.

Dung Fernet (AES-128-CBC + HMAC). Khoa luu 1 file rieng trong data_path (giong
jwt_secret.key), chmod 600. KHONG dung MD5/hash vi can GIAI MA lai de auto-login.
"""
from __future__ import annotations

from cryptography.fernet import Fernet

from .config import get_settings

_KEYFILE = "crypto.key"


def _fernet() -> Fernet:
    settings = get_settings()
    keyfile = settings.data_path / _KEYFILE
    if keyfile.exists():
        key = keyfile.read_bytes().strip()
    else:
        key = Fernet.generate_key()
        keyfile.write_bytes(key)
        try:
            keyfile.chmod(0o600)
        except OSError:
            pass
    return Fernet(key)


def encrypt(plain: str) -> str:
    """Ma hoa chuoi -> token base64 (luu DB). Rong -> rong."""
    if not plain:
        return ""
    return _fernet().encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt(token: str) -> str:
    """Giai ma token -> chuoi goc. Loi/rong -> rong."""
    if not token:
        return ""
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except Exception:  # noqa: BLE001
        return ""
