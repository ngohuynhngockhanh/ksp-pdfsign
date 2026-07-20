"""Backfill VAT v2: doc lai file PDF GOC de bat dong "Thue suat GTGT ... X%".

Vi sao: backfill v1 chi suy tu tong trong DB — HD nao tong_thue bi parse sai = 0
(vd HD#96 co ghi "Thuế suất GTGT (VAT rate): 8 %" nhung tong khong tach thue)
thi van 0%. Ban nay doc text PDF goc, ap dung dung logic parser moi
(_invoice_vat_rate: regex > suy tu tong > mac dinh 8).

Cap nhat:
- Dong thue_suat==0 (khong phai phan mem/license) -> rate tim duoc (neu > 0).
- Header: neu rate>0 ma tong_thue==0 va tong_tien==tong_truoc_thue (parse sot
  thue ro rang) -> tinh lai tong_thue/tong_tien cho khop chung tu goc.

Chay: cd backend && ./.venv/bin/python scripts/backfill_vat_from_pdf.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app import storage  # noqa: E402
from app.db import InvPurchase, get_session, init_db  # noqa: E402
from app.inv_import import (  # noqa: E402
    _PHAN_MEM_RE,
    _invoice_vat_rate,
    _pdf_all_text,
)


def main() -> int:
    init_db()
    gen = get_session()
    db = next(gen)
    try:
        n_lines = 0
        n_headers = 0
        for inv in db.scalars(select(InvPurchase).where(InvPurchase.source == "pdf")):
            suffix = inv.doc_suffix or ".pdf"
            if suffix != ".pdf" or not inv.doc_id or not storage.exists(inv.doc_id, suffix):
                continue
            try:
                raw = _pdf_all_text(storage.read_doc(inv.doc_id, suffix))
            except Exception as e:  # noqa: BLE001
                print(f"HĐ{inv.id} số {inv.so_hd}: lỗi đọc PDF ({e}) — bỏ qua")
                continue
            if not raw.strip():
                continue
            rate = _invoice_vat_rate(raw, inv.tong_truoc_thue or 0, inv.tong_thue or 0)
            if rate <= 0:
                continue
            changed = 0
            for ln in inv.lines:
                if (ln.thue_suat or 0) != 0 or _PHAN_MEM_RE.search(ln.ten_raw or ""):
                    continue
                ln.thue_suat = float(rate)
                changed += 1
            tt = inv.tong_truoc_thue or 0
            fixed_header = False
            if tt > 0 and (inv.tong_thue or 0) == 0 and abs((inv.tong_tien or 0) - tt) <= 1:
                inv.tong_thue = round(tt * rate / 100)
                inv.tong_tien = round(tt + inv.tong_thue)
                fixed_header = True
                n_headers += 1
            if changed or fixed_header:
                n_lines += changed
                extra = " + sửa tổng thuế header" if fixed_header else ""
                print(f"HĐ{inv.id} số {inv.so_hd}: áp {rate}% cho {changed} dòng{extra}")
        db.commit()
        print(f"Tổng: {n_lines} dòng + {n_headers} header được cập nhật")
    finally:
        gen.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
