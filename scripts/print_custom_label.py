#!/usr/bin/env python3
"""CLI in tem nhãn giao hàng tự do (không phụ thuộc SPX) sang máy in nhiệt TP732H.

Sử dụng:
  python3 scripts/print_custom_label.py \
    --code "THI 058 601 1011" \
    --recipient "Thiết bị điện Cao Thắng" \
    --phone "0902644315" \
    --address "48 Đặng Ngọc Chinh, Phường 3, TP Tây Ninh" \
    --item "THI 058 601 1011" \
    --note "Cho xem hàng, không cho thử"
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent

# Tự động dùng virtualenv nếu đang chạy system python
venv_python = ROOT_DIR / "backend" / ".venv" / "bin" / "python3"
if venv_python.exists() and sys.executable != str(venv_python):
    import os
    os.execv(str(venv_python), [str(venv_python)] + sys.argv)

sys.path.insert(0, str(ROOT_DIR / "backend"))

from app.db import get_session, init_db
from app.spx import print_custom_shipping_label


def main() -> int:
    parser = argparse.ArgumentParser(description="In tem nhãn giao hàng tự do sang máy in TP732H")
    parser.add_argument("--code", required=True, help="Mã đơn / Nội dung kiện hàng (VD: THI 058 601 1011)")
    parser.add_argument("--recipient", required=True, help="Tên người nhận (VD: Thiết bị điện Cao Thắng)")
    parser.add_argument("--phone", required=True, help="Số điện thoại người nhận (VD: 0902644315)")
    parser.add_argument("--address", required=True, help="Địa chỉ người nhận")
    parser.add_argument("--item", default="", help="Mô tả hàng hóa (mặc định lấy theo mã đơn)")
    parser.add_argument("--note", default="Cho xem hàng, không cho thử", help="Ghi chú / Chỉ dẫn giao hàng")
    parser.add_argument("--sender-name", default="", help="Tên người gửi (mặc định INUT TECHNOLOGY)")
    parser.add_argument("--sender-phone", default="", help="SĐT người gửi")
    parser.add_argument("--sender-address", default="", help="Địa chỉ người gửi")
    parser.add_argument("--printer", default="TP732H", help="Tên máy in trên Windows (mặc định TP732H)")
    parser.add_argument("--host", default="192.168.1.10", help="IP máy Windows (tự resolve qua Nmap nếu đổi IP)")
    parser.add_argument("--no-remote", action="store_true", help="Chỉ sinh file PDF, không gửi lệnh in remote")

    args = parser.parse_args()

    init_db()
    gen = get_session()
    db = next(gen)

    try:
        print(f"[INFO] Bắt đầu chuẩn bị tem giao hàng cho: {args.recipient} ({args.phone})...")
        res = print_custom_shipping_label(
            db=db,
            code=args.code,
            recipient_name=args.recipient,
            recipient_phone=args.phone,
            recipient_address=args.address,
            item_desc=args.item,
            note=args.note,
            sender_name=args.sender_name,
            sender_phone=args.sender_phone,
            sender_address=args.sender_address,
            printer_name=args.printer,
            host=args.host,
            print_remote=not args.no_remote,
        )
        print(f"[SUCCESS] {res['message']}")
        print(f"  - Mã kiện: {res['code']}")
        print(f"  - Mã theo dõi hệ thống: {res['tracking_no']}")
        print(f"  - Document ID: {res['label_doc_id']}")
        print(f"  - Trạng thái in: {'ĐÃ IN THÀNH CÔNG' if res['is_printed'] else 'ĐÃ LƯU NHÃN'}")
        return 0
    except Exception as e:
        print(f"[ERROR] Thất bại khi in tem: {e}", file=sys.stderr)
        return 1
    finally:
        gen.close()


if __name__ == "__main__":
    sys.exit(main())
