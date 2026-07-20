"""Doi tu du lieu cu: sinh alias hoc tu cac dong hoa don mua da match TAY tu truoc.

Chi lay dong InvPurchaseLine.match_kind == 'manual' co item_id (dong nguoi dung
da tu chon mat hang). Upsert vao inv_item_aliases theo (ten chuan hoa, MST ben
ban cua hoa don chua dong do) — giong het logic tu dong hoc trong
inventory._upsert_purchase_aliases(), chi khac la chay 1 lan cho du lieu da co
truoc khi tinh nang alias duoc them vao.

Chay: cd backend && ./.venv/bin/python scripts/backfill_aliases.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app.db import InvItemAlias, InvPurchase, InvPurchaseLine, get_session, init_db  # noqa: E402
from app.inventory import normalize_name  # noqa: E402


def main() -> int:
    init_db()
    gen = get_session()
    db = next(gen)
    try:
        n_new = 0
        n_updated = 0
        n_skipped = 0
        # Dedup trong chinh batch nay (2 dong manual cung ten + cung NCC):
        # dong sau ghi de dong truoc (lay lan map moi nhat).
        pending: dict[tuple[str, str], InvItemAlias] = {}
        rows = db.scalars(
            select(InvPurchaseLine)
            .join(InvPurchase, InvPurchaseLine.invoice_id == InvPurchase.id)
            .where(InvPurchaseLine.match_kind == "manual", InvPurchaseLine.item_id.is_not(None))
        )
        for ln in rows:
            mst = (ln.invoice.mst_ban or "").strip()
            ten_norm = normalize_name(ln.ten_raw)
            if not ten_norm:
                n_skipped += 1
                continue
            key = (ten_norm, mst)
            if key in pending:
                pending[key].item_id = ln.item_id
                pending[key].warehouse_id = ln.warehouse_id
                continue
            existing = db.scalars(
                select(InvItemAlias).where(
                    InvItemAlias.ten_norm == ten_norm, InvItemAlias.mst_ban == mst
                )
            ).first()
            if existing is None:
                obj = InvItemAlias(
                    ten_norm=ten_norm, mst_ban=mst,
                    item_id=ln.item_id, warehouse_id=ln.warehouse_id,
                )
                db.add(obj)
                pending[key] = obj
                n_new += 1
            else:
                existing.item_id = ln.item_id
                existing.warehouse_id = ln.warehouse_id
                pending[key] = existing
                n_updated += 1
        db.commit()
        print(f"Alias moi: {n_new} · cap nhat: {n_updated} · bo qua (ten rong): {n_skipped}")
    finally:
        gen.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
