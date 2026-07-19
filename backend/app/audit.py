"""Ghi nhat ky thao tac (best-effort, khong lam hong request chinh)."""
from __future__ import annotations

from sqlalchemy.orm import Session

from .db import AuditLog

# Nhan hien thi cho action
ACTION_LABELS = {
    "login": "Đăng nhập",
    "login_fail": "Đăng nhập thất bại",
    "sign": "Ký số",
    "bbbg_generate": "Sinh BBBG",
    "upload_signed": "Tải bản đã ký",
    "delete_doc": "Xoá hồ sơ",
    "assign": "Gán khách hàng",
    "set_type": "Đổi loại",
    "share": "Chia sẻ",
    "bulk_delete": "Xoá hàng loạt",
    "bulk_assign": "Gán hàng loạt",
    "customer_create": "Tạo khách hàng",
    "customer_delete": "Xoá khách hàng",
    "account_set": "Cấp/đổi tài khoản KH",
    "password_change": "Đổi mật khẩu",
    "password_reset": "Reset mật khẩu",
    "nas_sync_all": "Đồng bộ NAS",
    "logo_change": "Đổi logo",
}


def record(
    db: Session,
    username: str,
    role: str,
    ip: str,
    action: str,
    target: str = "",
    detail: str = "",
) -> None:
    try:
        db.add(AuditLog(
            username=username or "", role=role or "", ip=ip or "",
            action=action, target=(target or "")[:255], detail=(detail or "")[:500],
        ))
        db.commit()
    except Exception:
        db.rollback()
