"""Backfill VAT cho dong hoa don mua cu (parser PDF truoc day khong boc thue suat).

Quy tac (da chot voi user):
- Rate hoa don = snap(tong_thue/tong_truoc_thue*100) ve muc 0/5/8/10 — ton trong
  tong thuc te tren chung tu (HD tong_thue=0 -> 0/KCT, KHONG ep 8%).
- Dong ten phan mem/license -> giu 0 (KCT).
- Chi cap nhat dong dang thue_suat==0; khong de dong da co VAT (xml/scan_ai).
- Chi doi metadata VAT, khong dung so luong/tien -> khong anh huong so kho.

Chay: cd backend && ./.venv/bin/python scripts/backfill_vat.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app.db import InvPurchase, get_session, init_db  # noqa: E402
from app.inv_import import _line_vat, _snap_vat  # noqa: E402


def main() -> int:
    init_db()
    gen = get_session()
    db = next(gen)
    try:
        n_lines = 0
        for inv in db.scalars(select(InvPurchase)):
            tt = inv.tong_truoc_thue or 0
            rate = _snap_vat((inv.tong_thue or 0) / tt * 100) if tt > 0 else 0
            changed = 0
            for ln in inv.lines:
                if (ln.thue_suat or 0) != 0:
                    continue  # da co VAT (xml/scan_ai) -> giu nguyen
                new = _line_vat(ln.ten_raw or "", rate)
                if new != 0:
                    ln.thue_suat = float(new)
                    changed += 1
            if changed:
                n_lines += changed
                print(f"HĐ{inv.id} số {inv.so_hd} ({inv.source}): áp {rate}% cho {changed} dòng")
        db.commit()
        print(f"Tổng: {n_lines} dòng được cập nhật VAT")
    finally:
        gen.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
