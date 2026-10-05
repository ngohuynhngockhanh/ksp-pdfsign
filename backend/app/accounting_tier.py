"""Module giám sát biểu phí dịch vụ kế toán và cảnh báo sớm khi sắp nhảy mốc chi phí.

Biểu phí trọn gói theo quý:
- 0 - 5 HĐ/quý (3 tháng): 2.400.000 đ (800.000 đ/tháng)
- 6 - 30 HĐ/quý (3 tháng): 3.600.000 đ (1.200.000 đ/tháng)
- 31 - 60 HĐ/quý (3 tháng): 4.800.000 đ (1.600.000 đ/tháng)
- 61 - 80 HĐ/quý (3 tháng): 6.000.000 đ (2.000.000 đ/tháng)
- 81 - 100 HĐ/quý (3 tháng): 7.200.000 đ (2.400.000 đ/tháng)
- 101 - 120 HĐ/quý (3 tháng): 8.400.000 đ (2.800.000 đ/tháng)
- 121 - 140 HĐ/quý (3 tháng): 9.600.000 đ (3.200.000 đ/tháng)
- 141 - 160 HĐ/quý (3 tháng): 10.800.000 đ (3.600.000 đ/tháng)
- 161 - 180 HĐ/quý (3 tháng): 12.000.000 đ (4.000.000 đ/tháng)
- 181 - 200 HĐ/quý (3 tháng): 13.200.000 đ (4.400.000 đ/tháng)
- 201 - 300 HĐ/quý (3 tháng): 18.000.000 đ (6.000.000 đ/tháng)
- > 300 HĐ/tháng: Thu phí theo từng tháng

QUY ƯỚC CHUẨN THỰC TẾ:
1. Hóa đơn bán ra: Đếm từng hóa đơn.
2. Hóa đơn mua vào thông thường: Đếm từng hóa đơn.
3. Hóa đơn ngân hàng (Techcombank...): KHÔNG TÍNH (0 HĐ) vì là chi phí phát sinh kèm theo tờ khai hải quan.
4. Tờ khai hải quan nhập khẩu: MỖI TỜ KHAI TÍNH RIÊNG (1 tờ khai = 1 chứng từ tính phí).

QUY TẮC BÁO ĐỘNG (ALARM):
Khi số lượng chứng từ còn <= 5 cái trước khi chạm mốc trên của bậc hiện tại (đặc biệt khi còn 1-2 cái),
hệ thống phát tín hiệu ALARM KHẨN CẤP để ngăn chặn việc xuất/nhận hóa đơn làm nhảy mốc.
"""
from __future__ import annotations

import json
from datetime import date
from typing import Any
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import AppSetting, InvCustomsDecl, InvPurchase, InvSale

DEFAULT_ACCOUNTING_TIERS = [
    {"tier": 1, "min": 0, "max": 5, "fee_quarter": 2_400_000, "fee_month": 800_000, "label": "0 - 5 HĐ/quý"},
    {"tier": 2, "min": 6, "max": 30, "fee_quarter": 3_600_000, "fee_month": 1_200_000, "label": "6 - 30 HĐ/quý"},
    {"tier": 3, "min": 31, "max": 60, "fee_quarter": 4_800_000, "fee_month": 1_600_000, "label": "31 - 60 HĐ/quý"},
    {"tier": 4, "min": 61, "max": 80, "fee_quarter": 6_000_000, "fee_month": 2_000_000, "label": "61 - 80 HĐ/quý"},
    {"tier": 5, "min": 81, "max": 100, "fee_quarter": 7_200_000, "fee_month": 2_400_000, "label": "81 - 100 HĐ/quý"},
    {"tier": 6, "min": 101, "max": 120, "fee_quarter": 8_400_000, "fee_month": 2_800_000, "label": "101 - 120 HĐ/quý"},
    {"tier": 7, "min": 121, "max": 140, "fee_quarter": 9_600_000, "fee_month": 3_200_000, "label": "121 - 140 HĐ/quý"},
    {"tier": 8, "min": 141, "max": 160, "fee_quarter": 10_800_000, "fee_month": 3_600_000, "label": "141 - 160 HĐ/quý"},
    {"tier": 9, "min": 161, "max": 180, "fee_quarter": 12_000_000, "fee_month": 4_000_000, "label": "161 - 180 HĐ/quý"},
    {"tier": 10, "min": 181, "max": 200, "fee_quarter": 13_200_000, "fee_month": 4_400_000, "label": "181 - 200 HĐ/quý"},
    {"tier": 11, "min": 201, "max": 300, "fee_quarter": 18_000_000, "fee_month": 6_000_000, "label": "201 - 300 HĐ/quý"},
]

SETTING_KEY_TIERS = "accounting_fee_tiers"
SETTING_KEY_ALARM_GAP = "accounting_fee_alarm_gap"
DEFAULT_ALARM_GAP = 5


def get_accounting_tiers(db: Session | None = None) -> list[dict[str, Any]]:
    """Lấy danh sách biểu phí từ AppSetting hoặc mặc định."""
    if db is not None:
        row = db.get(AppSetting, SETTING_KEY_TIERS)
        if row and row.value:
            try:
                return json.loads(row.value)
            except Exception:
                pass
    return DEFAULT_ACCOUNTING_TIERS


def get_alarm_gap(db: Session | None = None) -> int:
    """Khoảng cách cảnh báo (mặc định 5 hóa đơn)."""
    if db is not None:
        row = db.get(AppSetting, SETTING_KEY_ALARM_GAP)
        if row and row.value and row.value.isdigit():
            return int(row.value)
    return DEFAULT_ALARM_GAP


def save_accounting_config(
    db: Session,
    tiers: list[dict[str, Any]] | None = None,
    alarm_gap: int = DEFAULT_ALARM_GAP,
) -> None:
    """Lưu toàn bộ cấu hình biểu phí vào AppSetting."""
    r_tiers = db.get(AppSetting, SETTING_KEY_TIERS) or AppSetting(key=SETTING_KEY_TIERS, value="")
    r_tiers.value = json.dumps(tiers or DEFAULT_ACCOUNTING_TIERS, ensure_ascii=False)
    db.merge(r_tiers)

    r_gap = db.get(AppSetting, SETTING_KEY_ALARM_GAP) or AppSetting(key=SETTING_KEY_ALARM_GAP, value="")
    r_gap.value = str(alarm_gap)
    db.merge(r_gap)

    db.commit()


def find_tier_for_count(count: int, tiers: list[dict[str, Any]] | None = None) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Tìm tier hiện tại và tier kế tiếp dựa trên số lượng hóa đơn."""
    tiers_list = tiers or DEFAULT_ACCOUNTING_TIERS
    for idx, t in enumerate(tiers_list):
        if t["min"] <= count <= t["max"]:
            next_t = tiers_list[idx + 1] if idx + 1 < len(tiers_list) else None
            return t, next_t
    last_tier = tiers_list[-1]
    return last_tier, None


def get_quarter_range(on_date: date | None = None) -> tuple[str, str, str]:
    """Lấy mã quý và khoảng ngày (YYYY-MM-DD) của quý."""
    d = on_date or date.today()
    q = (d.month - 1) // 3 + 1
    ky = f"{d.year}-Q{q}"
    start_month = (q - 1) * 3 + 1
    start_date = date(d.year, start_month, 1).isoformat()
    if q == 4:
        end_date = date(d.year, 12, 31).isoformat()
    else:
        end_month = start_month + 3
        end_date = (date(d.year, end_month, 1) - date.resolution).isoformat()
    return ky, start_date, end_date


def get_quarter_dates(ky: str) -> tuple[str, str]:
    """Phân tách mã quý YYYY-Qx thành (start_date, end_date)."""
    year_str, q_str = ky.upper().split("-Q")
    year, q = int(year_str), int(q_str)
    start_month = (q - 1) * 3 + 1
    start_date = date(year, start_month, 1).isoformat()
    if q == 4:
        end_date = date(year, 12, 31).isoformat()
    else:
        end_date = (date(year, start_month + 3, 1) - date.resolution).isoformat()
    return start_date, end_date


def is_bank_partner(name: str | None, tax_code: str | None = None) -> bool:
    """Nhận diện hóa đơn ngân hàng (Techcombank, Vietcombank...)."""
    n = (name or "").lower()
    return any(k in n for k in ["ngân hàng", "techcombank", "vietcombank", "vpbank", "mbbank", "vietinbank", "bidv"])


def evaluate_accounting_fee_status(
    db: Session,
    ky: str | None = None,
    count_bank: bool = False,
    customs_mode: str = "each",  # Mặc định: "each" (mỗi tờ khai tính riêng 1 đơn vị)
) -> dict[str, Any]:
    """Đánh giá chi tiết số lượng hóa đơn theo chuẩn kế toán dịch vụ và cảnh báo nhảy mốc.

    Quy ước mặc định:
    - count_bank = False: Hóa đơn ngân hàng KO TÍNH (vì là chi phí kèm theo tờ khai).
    - customs_mode = "each": Mỗi tờ khai hải quan tính riêng 1 đơn vị chứng từ.
    """
    if ky:
        start_date, end_date = get_quarter_dates(ky)
        active_ky = ky
    else:
        active_ky, start_date, end_date = get_quarter_range()

    # 1. Hóa đơn bán ra
    sales = db.scalars(
        select(InvSale)
        .where(InvSale.ngay >= start_date, InvSale.ngay <= end_date, InvSale.status != "void")
    ).all()
    count_sales = len(sales)

    # 2. Hóa đơn mua vào
    purchases = db.scalars(
        select(InvPurchase)
        .where(InvPurchase.ngay >= start_date, InvPurchase.ngay <= end_date, InvPurchase.status != "void")
    ).all()

    bank_purchases = [p for p in purchases if is_bank_partner(p.ten_ban, p.mst_ban)]
    regular_purchases = [p for p in purchases if p not in bank_purchases]

    count_regular_purchases = len(regular_purchases)
    count_bank_purchases_raw = len(bank_purchases)
    count_bank_billed = count_bank_purchases_raw if count_bank else 0

    # 3. Tờ khai hải quan
    customs = db.scalars(
        select(InvCustomsDecl)
        .where(InvCustomsDecl.ngay_dang_ky >= start_date, InvCustomsDecl.ngay_dang_ky <= end_date)
    ).all()
    count_customs_raw = len(customs)
    if customs_mode == "each":
        count_customs_billed = count_customs_raw
    elif customs_mode == "one_per_quarter":
        count_customs_billed = 1 if count_customs_raw > 0 else 0
    else:
        count_customs_billed = 0

    # Tổng số chứng từ tính phí theo quy ước
    total_billed = count_sales + count_regular_purchases + count_bank_billed + count_customs_billed
    total_raw = count_sales + len(purchases) + count_customs_raw

    tiers = get_accounting_tiers(db)
    alarm_gap = get_alarm_gap(db)

    current_tier, next_tier = find_tier_for_count(total_billed, tiers)
    remaining_to_next_tier = max(0, current_tier["max"] - total_billed)
    is_at_or_above_limit = total_billed >= current_tier["max"]
    is_alarm = (0 <= remaining_to_next_tier <= alarm_gap) and (next_tier is not None)

    fee_diff = (next_tier["fee_quarter"] - current_tier["fee_quarter"]) if next_tier else 0
    fee_month_diff = (next_tier["fee_month"] - current_tier["fee_month"]) if next_tier else 0

    alarm_message = ""
    if is_alarm:
        urgency = "🔴 KHẨN CẤP" if remaining_to_next_tier <= 2 else "⚠️ CẢNH BÁO"
        alarm_message = (
            f"🚨 [{urgency} - ALARM BIỂU PHÍ KẾ TOÁN {active_ky}]\n"
            f"⚡ Số lượng hóa đơn/chứng từ tính phí hiện tại: {total_billed} HĐ\n"
            f"   • {count_sales} HĐ bán ra\n"
            f"   • {count_regular_purchases} HĐ mua vào thông thường\n"
            f"   • 0 HĐ ngân hàng (loại trừ {count_bank_purchases_raw} HĐ phí Techcombank vì là chi phí tờ khai)\n"
            f"   • {count_customs_billed} tờ khai hải quan (tính riêng từng tờ khai)\n\n"
            f"🎯 CHỈ CÒN ĐÚNG {remaining_to_next_tier} HÓA ĐƠN NỮA là CHẠM TRẦN mốc {current_tier['max']} HĐ ({current_tier['label']})!\n"
            f"💸 NẾU PHÁT SINH THÊM VƯỢT MỐC {current_tier['max']}, PHÍ KẾ TOÁN SẼ NHẢY BẬC LÊN: {next_tier['label'] if next_tier else ''}\n"
            f"   ➔ Số tiền tăng thêm: +{fee_diff:,.0f} đ/quý (+{fee_month_diff:,.0f} đ/tháng)!\n"
            f"🛑 ĐỀ NGHỊ KIỂM SOÁT NGAY: Tuyệt đối không xuất/nhận thêm hóa đơn trong quý này nếu không cấp bách!"
        )

    return {
        "quarter": active_ky,
        "date_range": {"from": start_date, "to": end_date},
        "breakdown": {
            "sales_count": count_sales,
            "regular_purchases_count": count_regular_purchases,
            "bank_purchases_raw": count_bank_purchases_raw,
            "bank_purchases_billed": count_bank_billed,
            "customs_raw": count_customs_raw,
            "customs_billed": count_customs_billed,
            "total_billed_documents": total_billed,
            "total_raw_documents": total_raw,
        },
        "rules": {
            "count_bank": count_bank,
            "customs_mode": customs_mode,
            "alarm_gap": alarm_gap,
        },
        "current_tier": current_tier,
        "next_tier": next_tier,
        "thresholds": {
            "current_max": current_tier["max"],
            "remaining_before_jump": remaining_to_next_tier,
            "alarm_gap": alarm_gap,
            "is_alarm": is_alarm,
            "is_at_or_above_limit": is_at_or_above_limit,
            "cost_increase_if_jumped": fee_diff,
        },
        "alarm_message": alarm_message,
    }
