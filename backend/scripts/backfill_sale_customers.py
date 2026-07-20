"""Doi tu du lieu cu: tu gan customer_id cho cac HD ban da import truoc khi
co tinh nang auto-gan (accounts.find_customer trong inv_import.py).

Chi quet InvSale.customer_id IS NULL, thu khop theo (ten_mua, mst_mua) qua
find_customer (MST -> ten exact -> alias da hoc). KHONG tao khach hang moi.

Chay: cd backend && ./.venv/bin/python scripts/backfill_sale_customers.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app import accounts  # noqa: E402
from app.db import InvSale, get_session, init_db  # noqa: E402


def main() -> int:
    init_db()
    gen = get_session()
    db = next(gen)
    try:
        n_matched = 0
        n_skipped = 0
        rows = db.scalars(select(InvSale).where(InvSale.customer_id.is_(None)))
        for inv in rows:
            c = accounts.find_customer(db, inv.ten_mua, inv.mst_mua)
            if c is None:
                n_skipped += 1
                continue
            inv.customer_id = c.id
            n_matched += 1
            print(f"HD #{inv.id} ({inv.ten_mua!r}) -> khach #{c.id} ({c.name!r})")
        db.commit()
        print(f"Da gan: {n_matched} · khong khop: {n_skipped}")
    finally:
        gen.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
