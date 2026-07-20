"""Doi tu du lieu cu: gan InvIssue.sale_id cho cac phieu xuat da sinh tu
generate_from_sale TRUOC KHI co cot sale_id (chi luu note text).

Note cu co dang: "Xuat ban theo HD {ky_hieu} {so_hd}" -> parse regex, tim
InvSale co ky_hieu + so_hd khop, gan sale_id. KHONG dong (khong sua so lieu),
chi vang truy vet.

Chay: cd backend && ./.venv/bin/python scripts/backfill_issue_sale_link.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app.db import InvIssue, InvSale, get_session, init_db  # noqa: E402

NOTE_RE = re.compile(r"Xuất bán theo HĐ (\S+) (\S+)")


def main() -> int:
    init_db()
    gen = get_session()
    db = next(gen)
    try:
        n_matched = 0
        n_skipped = 0
        rows = db.scalars(select(InvIssue).where(InvIssue.sale_id.is_(None)))
        for iss in rows:
            m = NOTE_RE.search(iss.note or "")
            if not m:
                n_skipped += 1
                continue
            ky_hieu, so_hd = m.group(1), m.group(2)
            sale = db.scalar(
                select(InvSale).where(
                    InvSale.ky_hieu == ky_hieu, InvSale.so_hd == so_hd
                )
            )
            if sale is None:
                n_skipped += 1
                print(f"PX #{iss.id}: khong tim thay HD ban {ky_hieu} {so_hd} — bo qua")
                continue
            iss.sale_id = sale.id
            n_matched += 1
            print(f"PX #{iss.id} -> HD ban #{sale.id} ({ky_hieu} {so_hd})")
        db.commit()
        print(f"Da gan: {n_matched} · khong khop: {n_skipped}")
    finally:
        gen.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
