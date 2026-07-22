#!/usr/bin/env python3
"""Job 02:00: dong bo hoa don va tao/cap nhat BCT cua quy vua ket thuc."""
from __future__ import annotations

from datetime import date

from app import db as dbmod, tax_ops


def previous_quarter(today: date) -> str:
    current_q = (today.month - 1) // 3 + 1
    return f"{today.year - 1}-Q4" if current_q == 1 else f"{today.year}-Q{current_q - 1}"


def main() -> int:
    dbmod.init_db()
    with dbmod._SessionLocal() as db:
        run = tax_ops.run_tax_sync(db)
        if date.today().day == 1 and date.today().month in {1, 4, 7, 10}:
            tax_ops.generate_report(db, previous_quarter(date.today()))
        print(f"tax_sync #{run.id}: {run.status}")
        return 0 if run.status in {"success", "needs_action"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
