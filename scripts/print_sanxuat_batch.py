#!/usr/bin/env python3
"""CLI Batch Printer Sản Xuất — Quá trình sản xuất iNut Data Logger v1.1 (70x100 @ inut-dev + Auto Clabel 40x30).

Sử dụng:
  ./scripts/print_sanxuat_batch.py \
    --devices "inut_207_153,inut_207_159,inut_207_160,inut_207_161,inut_207_178,inut_207_179,inut_207_180,inut_207_181,inut_207_182,inut_207_183"
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from contextlib import closing
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent

venv_python = ROOT_DIR / "backend" / ".venv" / "bin" / "python3"
if venv_python.exists() and sys.executable != str(venv_python):
    os.execv(str(venv_python), [str(venv_python)] + sys.argv)

sys.path.insert(0, str(ROOT_DIR / "backend"))

from app import clabel  # noqa: E402
from app.db import get_session, init_db  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Batch Printer Sản Xuất — Quá trình sản xuất iNut Data Logger v1.1 (70x100 @ inut-dev + Auto Clabel)"
    )
    parser.add_argument(
        "--devices",
        "-d",
        required=True,
        help="Danh sách mã thiết bị cách nhau dấu phẩy (VD: inut_207_153,inut_207_159,...)",
    )
    parser.add_argument("--batch-code", default=None, help="Mã lô sản xuất (tự sinh nếu bỏ trống)")
    parser.add_argument(
        "--title",
        default="Quá trình sản xuất iNut Data Logger v1.1",
        help="Tiêu đề phiếu sản xuất",
    )
    parser.add_argument(
        "--model-name",
        default="iNut Smartcity - Data Logger v1.1 - Rockchip",
        help="Tên sản phẩm chuẩn xuất hóa đơn",
    )
    parser.add_argument(
        "--a-thang",
        "--iot",
        dest="a_thang_iot",
        action="store_true",
        help="Mẫu xuất xưởng cho anh Thắng (Cty IoT): tên chuẩn hóa đơn 'iNut Smartcity - Data Logger v1.1'",
    )
    parser.add_argument(
        "--product-line",
        default="Rockchip · Xuất xưởng v1.1 ©",
        help="Dòng phụ trên tem lẻ Clabel 40x30",
    )
    parser.add_argument("--wifi-pass", default="inut12345", help="Mật khẩu Wi-Fi mặc định")
    parser.add_argument(
        "--no-auto-clabel",
        action="store_true",
        help="Tắt tự động in tem lẻ Clabel 40x30 cho các mã chưa từng in",
    )
    parser.add_argument(
        "--force-reprint-clabel",
        action="store_true",
        help="Ép in lại toàn bộ tem lẻ Clabel 40x30 kể cả các mã đã in trước đó",
    )
    parser.add_argument("--host", default="inut-dev", help="Máy chủ gắn máy in nhiệt 70x100 (mặc định: inut-dev)")
    parser.add_argument("--printer", default="TP732H", help="Tên máy in nhiệt trên inut-dev (mặc định: TP732H)")
    parser.add_argument("--dry-run", action="store_true", help="Chỉ tạo PDF và lưu CSDL, không gửi lệnh in remote")
    parser.add_argument("--pdf-out", default=None, help="Lưu bản sao file PDF 70x100 ra đường dẫn này")

    args = parser.parse_args()
    model_name = args.model_name
    product_line = args.product_line
    if args.a_thang_iot:
        if model_name == "iNut Smartcity - Data Logger v1.1 - Rockchip":
            model_name = "iNut Smartcity - Data Logger v1.1"
        if product_line == "Rockchip · Xuất xưởng v1.1 ©":
            product_line = "iNut Smartcity · Xuất xưởng v1.1 ©"

    init_db()

    with closing(next(get_session())) as db:
        res = clabel.run_sanxuat_batch_printer(
            db,
            device_ids=args.devices,
            batch_code=args.batch_code,
            title=args.title,
            model_name=model_name,
            product_line=product_line,
            wifi_pass=args.wifi_pass,
            auto_print_missing_clabel=not args.no_auto_clabel,
            force_reprint_clabel=args.force_reprint_clabel,
            print_batch_sheet_remote=not args.dry_run,
            inut_dev_host=args.host,
            inut_dev_printer=args.printer,
        )
        if args.pdf_out:
            from app import storage

            src_pdf = storage.path_for(res["pdf_doc_id"])
            Path(args.pdf_out).write_bytes(src_pdf.read_bytes())
            res["pdf_out"] = args.pdf_out

        print(json.dumps(res, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
