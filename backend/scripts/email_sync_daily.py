#!/usr/bin/env python3
"""Job hang ngay dong bo hoa don PDF/XML tu Zoho Mail."""
from __future__ import annotations

import sys
from app import db as dbmod, email_sync
from app.config import get_settings


def main() -> int:
    dbmod.init_db()
    with dbmod._SessionLocal() as db:
        try:
            run = email_sync.run_sync(db, get_settings())
        except email_sync.EmailSyncBusy as e:
            print(f"[BUSY] {e}")
            return 0
        except email_sync.EmailSyncError as e:
            print(f"[ERROR] {e}", file=sys.stderr)
            return 1
        print(f"email_invoice_sync #{run.id}: {run.status} {run.stats}")
        return 0 if run.status in {"success", "needs_action"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
