"""Backup CSDL SQLite len NAS moi ngay (chay bang cron).

- Backup nhat quan bang sqlite3 backup API (an toan khi server dang ghi).
- Nen gzip, upload len NAS: <share>/<nas_base_path>/backup-db/ksp-YYYY-MM-DD.db.gz
- Giu 60 ngay (2 thang), file cu hon tu xoa tren NAS.

Chay: cd backend && ./.venv/bin/python scripts/backup_db.py
"""
from __future__ import annotations

import gzip
import io
import re
import sqlite3
import sys
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import smbclient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.nas import NasDisabled, _ensure_session, _root  # noqa: E402

KEEP_DAYS = 60
BACKUP_DIR = "backup-db"
NAME_RE = re.compile(r"^ksp-(\d{4}-\d{2}-\d{2})\.db\.gz$")


def main() -> int:
    settings = get_settings()
    if not settings.nas_enabled:
        print("NAS dang tat (NAS_ENABLED=false) — bo qua backup")
        return 1

    db_path = settings.data_path / "ksp.db"
    if not db_path.exists():
        print(f"Khong thay CSDL: {db_path}")
        return 1

    # 1) Ban sao nhat quan (khong hong khi uvicorn dang ghi)
    with tempfile.NamedTemporaryFile(suffix=".db") as tmp:
        src = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        dst = sqlite3.connect(tmp.name)
        with dst:
            src.backup(dst)
        src.close()
        dst.close()
        raw = Path(tmp.name).read_bytes()

    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb") as gz:
        gz.write(raw)
    data = buf.getvalue()

    # 2) Upload
    try:
        _ensure_session(settings)
    except NasDisabled:
        print("NAS dang tat — bo qua backup")
        return 1
    folder = rf"{_root(settings)}\{BACKUP_DIR}"
    smbclient.makedirs(folder, exist_ok=True)
    name = f"ksp-{date.today().isoformat()}.db.gz"
    with smbclient.open_file(rf"{folder}\{name}", mode="wb") as f:
        f.write(data)
    print(
        f"{datetime.now():%Y-%m-%d %H:%M} backup OK: {name} "
        f"({len(raw):,} -> {len(data):,} bytes)"
    )

    # 3) Xoa ban cu hon KEEP_DAYS
    cutoff = date.today() - timedelta(days=KEEP_DAYS)
    removed = 0
    for entry in smbclient.scandir(folder):
        m = NAME_RE.match(entry.name)
        if not m:
            continue  # khong dung file minh tao thi khong dong vao
        try:
            d = date.fromisoformat(m.group(1))
        except ValueError:
            continue
        if d < cutoff:
            smbclient.remove(rf"{folder}\{entry.name}")
            removed += 1
    if removed:
        print(f"Da xoa {removed} ban backup cu hon {KEEP_DAYS} ngay")
    return 0


if __name__ == "__main__":
    sys.exit(main())
