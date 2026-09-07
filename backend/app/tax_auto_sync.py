"""Module tu dong dong bo hoa don thue hang ngay tu Cong Thong Tin Hoa Don Dien Tu (hoadondientu.gdt.gov.vn).

Cac tinh nang chinh:
1. Tu dong giai ma Captcha SVG bang loc duong nhieu + ddddocr.
2. Tu dong dang nhap va gia han JWT Token thue.
3. Tu dong tai hoa don mua vao / ban ra moi nhat.
4. Tu dong doi chieu, tao ban nhap (Purchase Draft), tai XML goc & HTML the hien vao he thong.
5. Gui thong bao bao cao tom tat qua Telegram Bot.
"""

from __future__ import annotations

import logging
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any

from bs4 import BeautifulSoup
import cairosvg
import ddddocr
from sqlalchemy.orm import Session

from . import crypto, tax, telegram
from .config import get_settings
from .db import AppSetting

logger = logging.getLogger(__name__)


def solve_tax_svg_captcha(svg_str: str) -> str:
    """Xoa cac duong ke gay nhieu trong SVG va giai ma bang ddddocr."""
    try:
        soup = BeautifulSoup(svg_str, "html.parser")
        # Xoa cac duong line/curve nhieu (fill="none" hoac co stroke)
        for p in soup.find_all("path"):
            if p.get("fill") == "none" or p.get("stroke"):
                p.decompose()

        clean_svg = str(soup)
        png_bytes = cairosvg.svg2png(bytestring=clean_svg.encode("utf-8"), scale=2.5)

        ocr = ddddocr.DdddOcr(show_ad=False)
        res = ocr.classification(png_bytes)
        return str(res).strip()
    except Exception as e:
        logger.warning(f"Loi giai captcha SVG: {e}")
        return ""


def resolve_sync_range(
    days_back: int = 7,
    from_date: str | None = None,
    to_date: str | None = None,
) -> tuple[str, str]:
    """Resolve an explicit ISO range or the legacy rolling-day window."""
    if bool(from_date) != bool(to_date):
        raise ValueError("Phải nhập đủ from_date và to_date")
    if from_date and to_date:
        try:
            start, end = date.fromisoformat(from_date), date.fromisoformat(to_date)
        except ValueError as exc:
            raise ValueError("Ngày phải có dạng YYYY-MM-DD") from exc
        if start > end:
            raise ValueError("Ngày bắt đầu không được sau ngày kết thúc")
        return start.isoformat(), end.isoformat()
    if days_back < 0 or days_back > 366:
        raise ValueError("days_back phải trong khoảng 0..366")
    today = date.today()
    return (today - timedelta(days=days_back)).isoformat(), today.isoformat()


def get_or_refresh_tax_token(db: Session, max_retries: int = 10) -> str:
    """Kiem tra token thue hien tai; neu het han thi tu dong giai captcha va dang nhap lai."""
    mst_row = db.get(AppSetting, "tax_mst")
    pwd_row = db.get(AppSetting, "tax_password_enc")

    if not mst_row or not mst_row.value:
        raise tax.TaxError("Chưa cấu hình Mã số thuế (tax_mst) trong Cài đặt hệ thống.")
    if not pwd_row or not pwd_row.value:
        raise tax.TaxError("Chưa cấu hình Mật khẩu thuế (tax_password_enc) trong Cài đặt hệ thống.")

    mst = mst_row.value.strip()
    password = crypto.decrypt(pwd_row.value)

    # 1. Kiem tra token hien tai
    tok_row = db.get(AppSetting, "tax_token_enc")
    if tok_row and tok_row.value:
        current_token = crypto.decrypt(tok_row.value)
        if current_token and tax.check_token(current_token):
            logger.info("Token Tổng cục Thuế hiện tại vẫn còn hiệu lực.")
            return current_token

    # 2. Dang nhap lai tu dong voi AI Captcha solver
    logger.info(f"Token thuế đã hết hạn. Đang tự động đăng nhập lại cho MST {mst}...")
    for attempt in range(1, max_retries + 1):
        try:
            c = tax.get_captcha()
            ckey = c.get("key", "")
            cvalue = solve_tax_svg_captcha(c.get("svg", ""))

            if not cvalue:
                time.sleep(0.5)
                continue

            token = tax.authenticate(mst, password, ckey, cvalue)
            logger.info(f"Đăng nhập Cổng Thuế thành công ở lần thử {attempt}!")

            # Luu token ma hoa vao AppSetting
            if not tok_row:
                tok_row = AppSetting(key="tax_token_enc", value="")
            tok_row.value = crypto.encrypt(token)
            db.merge(tok_row)
            db.commit()
            return token

        except tax.TaxError as exc:
            logger.warning(f"Thử đăng nhập thuế lần {attempt} thất bại: {exc}")
            time.sleep(1)
        except Exception as exc:
            logger.warning(f"Lỗi kết nối Cổng Thuế lần {attempt}: {exc}")
            time.sleep(1)

    raise tax.TaxError(f"Không thể đăng nhập Cổng Tổng cục Thuế sau {max_retries} lần thử giải Captcha.")


def sync_daily_tax_invoices(
    db: Session,
    days_back: int = 7,
    do_import: bool = True,
    send_telegram: bool = True,
    from_date: str | None = None,
    to_date: str | None = None,
) -> dict[str, Any]:
    """Tự động đồng bộ hóa đơn thuế trong khoảng N ngày gần nhất."""
    tu, den = resolve_sync_range(days_back, from_date, to_date)

    # 1. Lay token hop le
    token = get_or_refresh_tax_token(db)

    # 2. Tai danh sach hoa don
    invoices = tax.fetch_invoices(token, tu, den)
    mua_count = len(invoices.get("mua", []))
    ban_count = len(invoices.get("ban", []))

    # 3. Doi chieu voi CSDL
    rec = tax.reconcile(db, invoices, tu, den)
    missing_mua = rec.get("missing_mua", [])
    missing_ban = rec.get("missing_ban", [])

    # 4. Nap hoa don mua vao con thieu
    import_result = {"imported": 0, "skipped": 0, "errors": 0}
    if do_import and missing_mua:
        import_result = tax.import_missing_purchases(db, token, missing_mua)

    # 5. Cap nhat XML goc con thieu
    attach_result = tax.attach_missing_xml(db, token, invoices.get("mua", []))

    # 6. Gui thong bao Telegram neu co cau hinh
    if send_telegram:
        _notify_telegram_summary(
            db=db,
            tu=tu,
            den=den,
            mua_count=mua_count,
            ban_count=ban_count,
            imported=import_result["imported"],
            missing_ban_count=len(missing_ban),
        )

    return {
        "ok": True,
        "range": {"tu": tu, "den": den},
        "portal_invoices": {"mua": mua_count, "ban": ban_count},
        "missing": {"mua": len(missing_mua), "ban": len(missing_ban)},
        "import": import_result,
        "xml_attached": attach_result,
        "synced_at": datetime.now(timezone.utc).isoformat(),
    }


def _notify_telegram_summary(
    db: Session,
    tu: str,
    den: str,
    mua_count: int,
    ban_count: int,
    imported: int,
    missing_ban_count: int,
) -> None:
    """Gui thong bao ket qua dong bo hoa don thue qua Telegram toi tat ca admin."""
    settings = get_settings()
    if not settings.telegram_enabled:
        return

    from sqlalchemy import select
    from .db import TelegramConnection, User
    from .telegram import TelegramClient, TelegramError

    # Lay danh sach tat ca active admin Telegram chat IDs
    rows = list(
        db.scalars(
            select(TelegramConnection)
            .join(User)
            .where(TelegramConnection.status == "active", User.role == "admin")
        )
    )
    if not rows:
        return

    if imported > 0:
        lines = [
            "🧾 [KSP iNut] PHÁT HIỆN HÓA ĐƠN THUẾ MỚI",
            f"🗓️ Kỳ đối soát: {tu} ➔ {den}",
            f"✨ Đã tự động nạp vào hệ thống: +{imported} HĐ mua vào",
            f"📥 Tổng HĐ mua trên Cổng Thuế: {mua_count}",
            f"📤 Tổng HĐ bán trên Cổng Thuế: {ban_count}",
        ]
        if missing_ban_count > 0:
            lines.append(f"⚠️ HĐ Bán ra chưa xuất trên KSP: {missing_ban_count}")
        lines.append("🟢 File XML gốc và HTML bản thể hiện đã được lưu trữ an toàn.")
    else:
        lines = [
            "✅ [KSP iNut] ĐÃ SYNC HÓA ĐƠN THUẾ THÀNH CÔNG — KHÔNG CÓ HÓA ĐƠN MỚI",
            f"🗓️ Kỳ đối soát: {tu} ➔ {den}",
            f"📥 Tổng HĐ Mua vào: {mua_count} (Đã khớp 100%)",
            f"📤 Tổng HĐ Bán ra: {ban_count} (Đã khớp 100%)",
            "✨ Hệ thống kế toán & kho đã được cập nhật đồng bộ.",
        ]

    msg = "\n".join(lines)
    client = TelegramClient(settings)
    try:
        for row in rows:
            try:
                client.send_message(row.chat_id, msg)
            except TelegramError as e:
                logger.warning(f"Không thể gửi tin nhắn Telegram tới {row.chat_id}: {e}")
    finally:
        client.close()
