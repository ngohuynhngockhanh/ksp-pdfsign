"""Ghi nhat ky thao tac (best-effort, khong lam hong request chinh)."""
from __future__ import annotations

from sqlalchemy.orm import Session

from .db import AuditLog

# Nhan hien thi cho action
ACTION_LABELS = {
    "login": "Đăng nhập",
    "login_fail": "Đăng nhập thất bại",
    "login_locked": "Bị chặn (khóa IP 30p)",
    "sign": "Ký số",
    "bbbg_generate": "Sinh BBBG",
    "quote_generate": "Sinh báo giá/đề nghị TT",
    "ai_narrative": "Sinh thuyết minh AI",
    "upload_signed": "Tải bản đã ký",
    "delete_doc": "Xoá hồ sơ",
    "rename_doc": "Đổi tên hồ sơ",
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
    "order_create": "Tạo đơn hàng",
    "order_delete": "Xoá đơn hàng",
    "order_assign": "Gán đơn hàng",
    "logo_change": "Đổi logo",
    "inv_item_create": "Tạo mặt hàng",
    "inv_item_merge": "Gộp mã hàng",
    "inv_opening_import": "Import tồn đầu kỳ",
    "inv_purchase_upload": "Upload HĐ mua vào",
    "inv_import_url": "Import HĐ từ link",
    "inv_bang_ke": "Đối chiếu bảng kê thuế",
    "inv_purchase_manual": "Tạo HĐ mua (tay)",
    "inv_purchase_post": "Ghi sổ HĐ mua",
    "inv_purchase_void": "Hủy ghi sổ HĐ mua",
    "inv_purchase_delete": "Xóa HĐ mua",
    "inv_issue_create": "Tạo phiếu xuất",
    "inv_issue_post": "Ghi sổ phiếu xuất",
    "inv_issue_void": "Hủy ghi sổ phiếu xuất",
    "inv_issue_delete": "Xóa phiếu xuất",
    "inv_production_create": "Tạo lệnh sản xuất",
    "inv_production_post": "Ghi sổ lệnh SX",
    "inv_production_void": "Hủy ghi sổ lệnh SX",
    "inv_production_delete": "Xóa lệnh SX",
    "inv_recipe_create": "Lưu công thức SX",
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
