"""Module quản lý, định kỳ chạy task tra cứu tờ khai hải quan và gửi thông báo Telegram.

- Định kỳ kiểm tra (mặc định 60 phút / 1 tiếng 1 lần) cho tờ khai Luồng Vàng / Luồng Đỏ.
- Gửi thông báo Telegram khi có thay đổi trạng thái, cán bộ kiểm tra hoặc khi hoàn thành.
- Tự động đánh dấu hoàn thành (clear task check) khi tờ khai đã "Hoàn thành xử lý" hoặc có ngày thông quan.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .customs_declaration_lookup import (
    DEFAULT_MST,
    DEFAULT_SO_CMT,
    lookup_customs_declaration,
)
from .db import (
    InvCustomsCheckLog,
    InvCustomsCheckTask,
    InvCustomsDecl,
    InvCustomsDriveFolder,
    TelegramConnection,
    User,
    get_session,
)

logger = logging.getLogger(__name__)

_worker_started = False
_worker_lock = threading.Lock()


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def send_customs_telegram_notification(settings: Settings, message: str) -> bool:
    """Gửi thông báo tới các tài khoản Admin KSP đã liên kết Telegram."""
    if not settings.telegram_enabled or not settings.telegram_bot_token:
        return False
    from .telegram import TelegramClient, TelegramError

    client = TelegramClient(settings)
    sent_any = False
    try:
        for db in get_session():
            rows = list(
                db.scalars(
                    select(TelegramConnection)
                    .join(User)
                    .where(
                        TelegramConnection.status == "active",
                        User.role == "admin",
                    )
                )
            )
            for row in rows:
                try:
                    client.send_message(row.chat_id, message)
                    sent_any = True
                except TelegramError as e:
                    logger.warning(f"Lỗi gửi telegram tới {row.chat_id}: {e}")
            break
    except Exception as exc:
        logger.warning(f"Lỗi khởi tạo Telegram client: {exc}")
    finally:
        client.close()
    return sent_any


def format_customs_telegram_message(
    task: InvCustomsCheckTask,
    res: dict[str, Any],
    is_completed: bool,
    is_changed: bool = True,
) -> str:
    so_tk = res.get("so_to_khai") or task.so_to_khai
    phan_luong = res.get("phan_luong") or task.phan_luong or "Chưa rõ luồng"
    folder = task.folder_name or "Bộ hồ sơ KSP"
    nguoi_kt = res.get("nguoi_kiem_tra") or {}
    trang_thai = nguoi_kt.get("trang_thai_xu_ly") or "Đang xử lý"
    can_bo_hs = nguoi_kt.get("cong_chuc_kiem_tra_ho_so") or "Chưa phân công"
    can_bo_hh = nguoi_kt.get("cong_chuc_kiem_tra_hang_hoa") or ""
    ngay_tq = res.get("ngay_thong_quan") or ""
    ngay_kvgs = res.get("ngay_qua_kvgs") or ""
    thue = res.get("thue") or {}
    da_nop = thue.get("da_nop", 0)

    if is_completed:
        header = f"🎯 [HẢI QUAN] TỜ KHAI {so_tk} ĐÃ HOÀN THÀNH XỬ LÝ / THÔNG QUAN!"
    elif is_changed:
        header = f"🔔 [HẢI QUAN] CẬP NHẬT TRẠNG THÁI TỜ KHAI {so_tk} ({phan_luong})"
    else:
        header = f"⏱️ [HẢI QUAN] ĐỊNH KỲ KIỂM TRA TỜ KHAI {so_tk} ({phan_luong})"
    lines = [
        header,
        f"📁 Bộ hồ sơ: {folder}",
        f"🏷️ Phân luồng: {phan_luong}",
        f"⚡ Trạng thái xử lý: {trang_thai}",
        f"👮 Cán bộ kiểm tra hồ sơ: {can_bo_hs}",
    ]
    if can_bo_hh:
        lines.append(f"📦 Cán bộ kiểm tra hàng hóa: {can_bo_hh}")
    if ngay_tq:
        lines.append(f"✅ Ngày thông quan: {ngay_tq}")
    if ngay_kvgs:
        lines.append(f"🚚 Ngày qua KVGS: {ngay_kvgs}")
    if da_nop:
        da_nop_str = f"{da_nop:,.0f}".replace(",", ".")
        lines.append(f"💵 Thuế GTGT đã nộp: {da_nop_str} VNĐ")

    if is_completed:
        lines.append("🛑 Tự động đóng task kiểm tra định kỳ (Clear task check).")
    else:
        lines.append(f"⏱️ Lần check tiếp theo: sau {task.interval_minutes} phút.")

    return "\n".join(lines)


def run_task_check(
    db: Session,
    task: InvCustomsCheckTask,
    settings: Settings,
    force_telegram: bool = False,
) -> dict[str, Any]:
    """Thực hiện một lần kiểm tra tờ khai từ Cổng Hải Quan và cập nhật task."""
    try:
        res = lookup_customs_declaration(
            so_to_khai=task.so_to_khai,
            ma_doanh_nghiep=task.ma_doanh_nghiep or DEFAULT_MST,
            so_cmt=task.so_cmt or DEFAULT_SO_CMT,
        )
    except Exception as exc:
        task.last_checked_at = _now()
        task.last_error = str(exc)[:500]
        task.next_check_at = _now() + timedelta(minutes=task.interval_minutes)
        db.commit()
        return {"ok": False, "error": str(exc), "task_id": task.id}

    task.last_error = ""
    nguoi_kt = res.get("nguoi_kiem_tra") or {}
    curr_status = str(nguoi_kt.get("trang_thai_xu_ly") or "Đang xử lý").strip()
    curr_officer = str(nguoi_kt.get("cong_chuc_kiem_tra_ho_so") or "").strip()
    curr_ngay_tq = str(res.get("ngay_thong_quan") or "").strip()
    curr_ngay_kvgs = str(res.get("ngay_qua_kvgs") or "").strip()

    # Điều kiện coi là xong rồi (hoàn thành)
    is_completed = bool(
        curr_ngay_tq
        or "hoàn thành" in curr_status.lower()
        or "thông quan" in curr_status.lower()
        or curr_ngay_kvgs
    )

    is_changed = (
        curr_status != task.last_status_text
        or curr_officer != task.last_officer
        or (is_completed and task.status != "completed")
    )

    task.last_checked_at = _now()
    task.last_status_text = curr_status
    task.last_officer = curr_officer
    task.ngay_thong_quan = curr_ngay_tq
    task.ngay_qua_kvgs = curr_ngay_kvgs
    task.last_result_json = json.dumps(res, ensure_ascii=False)
    if res.get("phan_luong"):
        task.phan_luong = res["phan_luong"]

    if is_completed:
        task.status = "completed"
        task.completed_at = _now()
        task.next_check_at = None
    elif task.status == "active":
        task.next_check_at = _now() + timedelta(minutes=task.interval_minutes)

    # Gửi Telegram theo chế độ notify_mode:
    # - "always": Luôn bắn mỗi chu kỳ (mặc định 1 tiếng/lần) để người dùng biết bot vẫn hoạt động
    # - "on_change": Chỉ bắn khi có thay đổi trạng thái hoặc khi hoàn thành
    telegram_sent = False
    msg = ""
    should_notify = False
    if task.telegram_notify:
        mode = getattr(task, "notify_mode", "always") or "always"
        if mode == "always":
            should_notify = True
        else:
            should_notify = is_completed or is_changed or force_telegram

    if should_notify:
        msg = format_customs_telegram_message(task, res, is_completed, is_changed)
        telegram_sent = send_customs_telegram_notification(settings, msg)

    # Ghi log
    thue = res.get("thue") or {}
    log = InvCustomsCheckLog(
        task_id=task.id,
        checked_at=_now(),
        trang_thai_xu_ly=curr_status,
        cong_chuc_kiem_tra=curr_officer,
        ngay_thong_quan=curr_ngay_tq,
        thue_da_nop=float(thue.get("da_nop") or 0.0),
        is_completed=is_completed,
        telegram_sent=telegram_sent,
        message=msg or curr_status,
    )
    db.add(log)
    db.commit()
    db.refresh(task)

    return {
        "ok": True,
        "task_id": task.id,
        "so_to_khai": task.so_to_khai,
        "is_completed": is_completed,
        "is_changed": is_changed,
        "trang_thai_xu_ly": curr_status,
        "cong_chuc_kiem_tra": curr_officer,
        "ngay_thong_quan": curr_ngay_tq,
        "telegram_sent": telegram_sent,
        "status": task.status,
    }


def auto_seed_tasks_from_decls(db: Session) -> list[InvCustomsCheckTask]:
    """Tự động thêm task theo dõi cho các tờ khai Luồng Vàng (2) và Luồng Đỏ (3) trong CSDL."""
    decls = list(
        db.scalars(
            select(InvCustomsDecl).where(
                InvCustomsDecl.phan_luong.in_(["2", "3", "Luồng Vàng", "Luồng Đỏ"])
            )
        )
    )
    folders = list(db.scalars(select(InvCustomsDriveFolder)))
    folder_map = {f.customs_id: f.name for f in folders if f.customs_id}

    created = []
    for d in decls:
        existing = db.scalar(
            select(InvCustomsCheckTask).where(
                InvCustomsCheckTask.so_to_khai == d.so_to_khai
            )
        )
        if not existing:
            luong_label = (
                "Luồng Vàng"
                if d.phan_luong == "2"
                else "Luồng Đỏ"
                if d.phan_luong == "3"
                else str(d.phan_luong)
            )
            task = InvCustomsCheckTask(
                so_to_khai=d.so_to_khai,
                ma_doanh_nghiep=DEFAULT_MST,
                so_cmt=DEFAULT_SO_CMT,
                folder_name=folder_map.get(d.id, ""),
                phan_luong=luong_label,
                interval_minutes=60,
                notify_mode="always",
                status="active",
                telegram_notify=True,
            )
            db.add(task)
            created.append(task)
    if created:
        db.commit()
        for t in created:
            db.refresh(t)
    return created


def check_all_due_tasks(db: Session, settings: Settings) -> list[dict[str, Any]]:
    """Kiểm tra tất cả các task active đã đến hạn (next_check_at <= now hoặc chưa check)."""
    now = _now()
    tasks = list(
        db.scalars(
            select(InvCustomsCheckTask).where(
                InvCustomsCheckTask.status == "active",
                (InvCustomsCheckTask.next_check_at.is_(None))
                | (InvCustomsCheckTask.next_check_at <= now),
            )
        )
    )
    results = []
    for t in tasks:
        try:
            r = run_task_check(db, t, settings, force_telegram=False)
            results.append(r)
        except Exception as exc:
            logger.warning(f"Lỗi chạy check cho task {t.id} ({t.so_to_khai}): {exc}")
    return results


def start_customs_check_worker(settings: Settings) -> None:
    """Khởi chạy background worker thread kiểm tra tờ khai định kỳ mỗi 60 giây."""
    global _worker_started
    with _worker_lock:
        if _worker_started:
            return
        _worker_started = True

    def _loop() -> None:
        logger.info("CustomsCheckWorker thread started.")
        while True:
            try:
                for db in get_session():
                    check_all_due_tasks(db, settings)
                    break
            except Exception as exc:
                logger.warning(f"Lỗi vòng lặp CustomsCheckWorker: {exc}")
            time.sleep(60)

    t = threading.Thread(target=_loop, daemon=True, name="CustomsCheckWorker")
    t.start()
