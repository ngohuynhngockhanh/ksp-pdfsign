"""Script đồng bộ toàn bộ hóa đơn mua vào từ Cổng Tổng cục Thuế (2022 - 2025).

Truy vấn Cổng hoadondientu.gdt.gov.vn theo từng tháng (từ 01/07/2022 đến 31/08/2025),
bóc tách số hóa đơn, ký hiệu, MST người bán, tên người bán, tiền chưa thuế, thuế GTGT,
và tự động nạp vào bảng inv_purchase_invoices (source='gdt_portal', status='posted').
"""
from __future__ import annotations

import re
import sys
import time
from datetime import date, datetime
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR / "backend"))

from app.db import get_session, init_db, InvPurchase
from app.tax_auto_sync import get_or_refresh_tax_token
from app.tax import _query_range, BASE
from sqlalchemy import select


def get_month_ranges(start_year: int = 2022, start_month: int = 7, end_year: int = 2025, end_month: int = 8):
    ranges = []
    y = start_year
    m = start_month
    while y < end_year or (y == end_year and m <= end_month):
        # determine days in month
        if m in (1, 3, 5, 7, 8, 10, 12):
            last_day = 31
        elif m in (4, 6, 9, 11):
            last_day = 30
        else:
            last_day = 29 if (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else 28
            
        start_str = f"{y}-{m:02d}-01"
        end_str = f"{y}-{m:02d}-{last_day:02d}"
        label = f"Tháng {m:02d}/{y}"
        ranges.append((start_str, end_str, label, y))
        
        m += 1
        if m > 12:
            m = 1
            y += 1
    return ranges


def sync_all_historical_purchases():
    init_db()
    gen = get_session()
    db = next(gen)
    
    print("[INFO] Lấy hoặc làm mới token Tổng cục Thuế...")
    token = get_or_refresh_tax_token(db)
    print(f"[OK] Token xác thực thành công (độ dài: {len(token)})")

    ranges = get_month_ranges(2022, 7, 2025, 8)
    print(f"[INFO] Tổng số tháng cần quét: {len(ranges)} tháng")

    total_fetched = 0
    total_new = 0
    total_skipped = 0

    for start_str, end_str, label, yr in ranges:
        try:
            # Query invoices
            invoices = _query_range(token, f"{BASE}/query/invoices/purchase", start_str, end_str)
            # Query sco (máy tính tiền)
            try:
                sco_invs = _query_range(token, f"{BASE}/sco-query/invoices/purchase", start_str, end_str)
                invoices.extend(sco_invs)
            except Exception:
                pass

            cnt = len(invoices)
            total_fetched += cnt
            month_new = 0

            for inv in invoices:
                shdon = inv.get("shdon")
                khhdon = inv.get("khhdon") or ""
                nbmst = re.sub(r"[^0-9-]", "", inv.get("nbmst") or "")
                nbten = (inv.get("nbten") or "").strip()

                tdlap = inv.get("tdlap") or f"{start_str}T00:00:00Z"
                ngay = tdlap[:10]

                pretax = float(inv.get("tgtcthue") or 0.0)
                vat = float(inv.get("tgtthue") or 0.0)
                tot = float(inv.get("tgtttbso") or (pretax + vat))

                exists = db.scalar(
                    select(InvPurchase).where(
                        InvPurchase.so_hd == shdon,
                        InvPurchase.ky_hieu == khhdon,
                        InvPurchase.mst_ban == nbmst
                    )
                )
                if not exists:
                    loai = "dich_vu" if any(w in nbten.lower() for w in ["ngân hàng", "viễn thông", "grab", "be", "phần mềm", "tư vấn", "công chứng"]) else "hang_hoa"
                    p = InvPurchase(
                        so_hd=shdon,
                        ky_hieu=khhdon,
                        mst_ban=nbmst,
                        ten_ban=nbten,
                        ngay=ngay,
                        tong_truoc_thue=pretax,
                        tong_thue=vat,
                        tong_tien=tot,
                        source="gdt_portal",
                        status="posted",
                        loai=loai,
                        confidence=1.0,
                    )
                    db.add(p)
                    month_new += 1
                else:
                    total_skipped += 1

            db.commit()
            total_new += month_new
            print(f"[{label}] Trả về: {cnt:2d} HĐ | Mới: {month_new:2d} | Trùng: {cnt - month_new:2d}")
            time.sleep(0.4)
        except Exception as e:
            print(f"[{label}] Lỗi: {e}")
            time.sleep(1.0)

    print("\n================ TỔNG KẾT ĐỒNG BỘ CỔNG THUẾ ================")
    print(f"Tổng hóa đơn quét được từ Cổng thuế: {total_fetched}")
    print(f"Hóa đơn mới thêm vào CSDL: {total_new}")
    print(f"Hóa đơn đã có sẵn (bỏ qua): {total_skipped}")

    gen.close()


if __name__ == "__main__":
    sync_all_historical_purchases()
