#!/usr/bin/env python3
"""Script chay tu dong luc 24h dem (00:00 moi ngay) de dong bo hoa don thue.

Chuc nang:
1. Tu dong dang nhap Cong Tong cuc Thue (hoadondientu.gdt.gov.vn) bang AI Captcha.
2. Quet toan bo hoa don mua vao va ban ra trong 7 ngay gan nhat.
3. Tu dong nap hoa don mua vao moi + tai file XML goc va HTML the hien.
4. Gui tin nhan thong bao ket qua qua Telegram Bot (ke ca khi co hoac khong co HD moi).
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

# Setup paths
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("daily_tax_sync")


def main() -> int:
    logger.info("=== BẮT ĐẦU ĐỒNG BỘ HÓA ĐƠN THUẾ ĐỊNH KỲ 24H ĐÊM ===")
    from app.db import init_db, get_session
    from app.tax_auto_sync import sync_daily_tax_invoices

    init_db()
    for db in get_session():
        try:
            # Đồng bộ 7 ngày gần nhất (đảm bảo không sót hóa đơn cuối tuần / ngày lễ)
            result = sync_daily_tax_invoices(
                db=db,
                days_back=7,
                do_import=True,
                send_telegram=True,
            )
            logger.info(f"Đồng bộ thành công: {result}")
            print(f"Sync result: {result}")
            return 0
        except Exception as exc:
            logger.exception(f"Lỗi đồng bộ hóa đơn thuế: {exc}")
            # Gửi cảnh báo lỗi qua Telegram nếu có thể
            try:
                from app.config import get_settings
                from app.telegram import TelegramClient
                settings = get_settings()
                if settings.telegram_enabled:
                    client = TelegramClient(settings)
                    client.send_message(
                        "1229390861",
                        f"❌ <b>[KSP iNut] LỖI ĐỒNG BỘ HÓA ĐƠN THUẾ 24H</b>\nChi tiết: <code>{exc}</code>"
                    )
                    client.close()
            except Exception:
                pass
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
