#!/usr/bin/env python3
"""Snapshot ECUS and sync its PDF attachments into mapped Drive folders."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# Running this file by path puts ``scripts/`` (not ``backend/``) on sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import audit, db as dbmod, ecus_drive_sync  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import JobRun  # noqa: E402


def _args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Chỉ đọc ECUS và in danh sách file, không lưu/upload",
    )
    parser.add_argument(
        "--declaration",
        action="append",
        dest="declarations",
        help="Chỉ đồng bộ số tờ khai này (có thể lặp lại)",
    )
    return parser.parse_args()


def main() -> int:
    args = _args()
    settings = get_settings()
    if not settings.ecus_drive_sync_enabled and not args.dry_run:
        print("ECUS_DRIVE_SYNC_ENABLED=false — bỏ qua, chưa upload lên Drive")
        return 0

    dbmod.init_db()
    numbers = set(args.declarations or []) or None
    with dbmod._SessionLocal() as db:
        job = JobRun(
            kind="ecus_drive_sync",
            status="running",
            stats=json.dumps({"dry_run": args.dry_run, "message": "Đang đọc ECUS"}, ensure_ascii=False),
        )
        db.add(job)
        db.commit()
        try:
            result = ecus_drive_sync.sync_from_remote(
                db,
                settings,
                dry_run=args.dry_run,
                declaration_numbers=numbers,
            )
            job.status = "needs_action" if result["failed"] or result["unmatched"] else "success"
            job.needs_action = job.status == "needs_action"
            job.stats = json.dumps(result, ensure_ascii=False)
            audit.record(
                db,
                "system",
                "admin",
                "",
                "ecus_drive_sync",
                "ecus",
                f"uploaded:{result['uploaded']} skipped:{result['skipped']} failed:{len(result['failed'])}",
            )
            print(json.dumps({"job_id": job.id, **result}, ensure_ascii=False))
            return 1 if job.status == "needs_action" else 0
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            job = db.get(JobRun, job.id)
            if job:
                job.status = "failed"
                job.error = str(exc)[:2000]
                job.finished_at = datetime.now(timezone.utc)
                db.commit()
            print(f"ecus_drive_sync failed: {type(exc).__name__}: {exc}", file=sys.stderr)
            return 1
        finally:
            if job.finished_at is None:
                job.finished_at = datetime.now(timezone.utc)
                db.commit()


if __name__ == "__main__":
    raise SystemExit(main())
