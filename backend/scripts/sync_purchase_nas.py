"""Dong bo file goc hoa don MUA len NAS moi ngay (chay bang cron).

- Duyet moi InvPurchase co file goc; dua len NAS theo CHECKSUM (sha256):
  file da co tren NAS + sha256 khop -> BO QUA (khong upload lai).
- Cay thu muc: <share>/<nas_base_path>/hoa-don-mua/<YYYY-MM>/<so_hd><suffix>.
- Log ra backend/data/nas_sync.log.

Chay: cd backend && ./.venv/bin/python scripts/sync_purchase_nas.py
Cron goi y (system crontab, sau backup DB 02:30):  45 2 * * *  cd /home/ksp/ksp-pdfsign/backend && ./.venv/bin/python scripts/sync_purchase_nas.py
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import db as dbmod  # noqa: E402
from app import nas  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import InvPurchase  # noqa: E402
from sqlalchemy import select  # noqa: E402


def _log(line: str) -> None:
    settings = get_settings()
    logf = settings.data_path / "nas_sync.log"
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with logf.open("a", encoding="utf-8") as f:
        f.write(f"{stamp} {line}\n")
    print(line)


def main() -> int:
    settings = get_settings()
    if not settings.nas_enabled:
        _log("NAS dang tat — bo qua sync hoa don mua")
        return 1
    dbmod._init_engine()
    synced = skipped = failed = 0
    with dbmod._SessionLocal() as db:
        for p in db.scalars(select(InvPurchase).where(InvPurchase.doc_id != "")):
            try:
                changed, msg = nas.sync_purchase_file(settings, db, p)
                if changed:
                    synced += 1
                else:
                    skipped += 1
            except Exception as e:  # noqa: BLE001
                failed += 1
                _log(f"LOI HD mua #{p.id}: {type(e).__name__}: {e}")
    _log(f"Xong: {synced} da sync, {skipped} bo qua (checksum khop), {failed} loi")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
