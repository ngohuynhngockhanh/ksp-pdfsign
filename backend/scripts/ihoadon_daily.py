#!/usr/bin/env python3
"""Job hang ngay dong bo hoa don da phat hanh cho cong khach hang."""
from __future__ import annotations

from app import db as dbmod, ihoadon_sync
from app.config import get_settings


def main() -> int:
    dbmod.init_db()
    with dbmod._SessionLocal() as db:
        try:
            run = ihoadon_sync.run_sync(db, get_settings())
        except ihoadon_sync.SyncBusy as e:
            print(str(e))
            return 0
        print(f"ihoadon_customer_sync #{run.id}: {run.status} {run.stats}")
        return 0 if run.status in {"success", "needs_action"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
