#!/home/ksp/ksp-pdfsign/backend/.venv/bin/python
"""CLI in PDF khổ A4 từ xa ra máy in Brother HL-L2320D trên máy Windows (DESKTOP-O3VN908).

Ví dụ:
  ./scripts/print_a4_brother.py --status
  ./scripts/print_a4_brother.py --jobs
  ./scripts/print_a4_brother.py --doc-id 464 --duplex long --copies 2
  ./scripts/print_a4_brother.py --file reports/file.pdf --duplex simplex --pages 1-2
  ./scripts/print_a4_brother.py --doc-id 464 --dry-run
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app import brother_print  # noqa: E402
from app.db import get_session  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="In PDF khổ A4 ra máy in laser Brother HL-L2320D trên Windows"
    )
    parser.add_argument(
        "--host",
        default=brother_print.DEFAULT_WINDOWS_HOST,
        help=f"IP/host máy Windows (mặc định: {brother_print.DEFAULT_WINDOWS_HOST})",
    )
    parser.add_argument(
        "--printer",
        default=brother_print.DEFAULT_BROTHER_PRINTER,
        help=f"Tên máy in Windows (mặc định: {brother_print.DEFAULT_BROTHER_PRINTER})",
    )
    parser.add_argument("--status", action="store_true", help="Kiểm tra danh sách và trạng thái máy in")
    parser.add_argument("--jobs", action="store_true", help="Xem hàng đợi lệnh in hiện tại")
    parser.add_argument("--cancel-jobs", action="store_true", help="Hủy toàn bộ lệnh in bị treo")
    parser.add_argument("--job-id", type=int, default=None, help="Hủy 1 job ID cụ thể (kèm --cancel-jobs)")
    parser.add_argument("--doc-id", type=int, default=None, help="ID hồ sơ (PK) trong KSP PDFSign")
    parser.add_argument("--file", type=str, default=None, help="Đường dẫn file PDF cục bộ cần in")
    parser.add_argument("--unsigned", action="store_true", help="In bản gốc chưa ký thay vì bản đã ký")
    parser.add_argument("--paper", default="A4", help="Khổ giấy (mặc định: A4)")
    parser.add_argument(
        "--duplex",
        default="simplex",
        choices=["simplex", "long", "short", "duplexlong", "duplexshort"],
        help="Chế độ mặt in: simplex (1 mặt), long (2 mặt lật dọc), short (2 mặt lật ngang)",
    )
    parser.add_argument("--copies", type=int, default=1, help="Số bản in (1-50)")
    parser.add_argument("--pages", default=None, help="Khoảng trang cần in (vd: '1-3', '1,3', 'odd', 'even')")
    parser.add_argument(
        "--scale",
        default="fit",
        choices=["fit", "shrink", "noscale"],
        help="Tỷ lệ trang: fit (mặc định), shrink, noscale",
    )
    parser.add_argument(
        "--orientation",
        default="auto",
        choices=["auto", "portrait", "landscape"],
        help="Hướng giấy: auto (mặc định), portrait, landscape",
    )
    parser.add_argument(
        "--tray",
        default="auto",
        choices=["auto", "tray1", "manual"],
        help="Khay giấy: auto (mặc định), tray1 (hộc chính), manual (nạp tay)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Chỉ kiểm tra thông số, không gửi lệnh in")

    args = parser.parse_args()

    if args.status:
        printers = brother_print.list_windows_printers(host=args.host)
        print(json.dumps(printers, ensure_ascii=False, indent=2))
        return 0

    if args.jobs:
        jobs = brother_print.get_printer_jobs(host=args.host, printer_name=args.printer)
        print(json.dumps(jobs, ensure_ascii=False, indent=2))
        return 0

    if args.cancel_jobs:
        res = brother_print.cancel_printer_jobs(
            host=args.host, printer_name=args.printer, job_id=args.job_id
        )
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return 0

    if args.doc_id is not None:
        for db in get_session():
            res = brother_print.print_ksp_document_a4(
                db,
                args.doc_id,
                prefer_signed=not args.unsigned,
                host=args.host,
                printer_name=args.printer,
                paper_size=args.paper,
                duplex=args.duplex,
                copies=args.copies,
                page_range=args.pages,
                scale=args.scale,
                orientation=args.orientation,
                tray=args.tray,
                dry_run=args.dry_run,
            )
            print(json.dumps(res, ensure_ascii=False, indent=2))
            return 0

    if args.file:
        fpath = Path(args.file).expanduser().resolve()
        if not fpath.is_file():
            print(f"Không tìm thấy tệp: {fpath}", file=sys.stderr)
            return 1
        res = brother_print.print_pdf_bytes_a4(
            fpath.read_bytes(),
            filename=fpath.name,
            host=args.host,
            printer_name=args.printer,
            paper_size=args.paper,
            duplex=args.duplex,
            copies=args.copies,
            page_range=args.pages,
            scale=args.scale,
            orientation=args.orientation,
            tray=args.tray,
            dry_run=args.dry_run,
        )
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
