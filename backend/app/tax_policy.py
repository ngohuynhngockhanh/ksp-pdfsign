"""Moc chinh sach GTGT dung de canh bao, khong thay the phan loai nghiep vu.

Nguon phap ly ap dung cho giai doan hien tai:
- Luat Thue GTGT 48/2024/QH15 (hieu luc 01/07/2025): san pham/dich vu
  phan mem thuoc nhom khong chiu thue, khac voi thue suat 0%.
- Nghi quyet 204/2025/QH15 va Nghi dinh 174/2025/ND-CP: giam 2 diem %
  cho nhom dang ap dung 10%, tu 01/07/2025 den het 31/12/2026, tru nhom loai tru.
"""
from __future__ import annotations

from datetime import date

VAT_REDUCTION_FROM = date(2025, 7, 1)
VAT_REDUCTION_TO = date(2026, 12, 31)
VAT_REDUCTION_PERIODS = (
    (date(2022, 2, 1), date(2022, 12, 31), "15/2022/NĐ-CP"),
    (date(2023, 7, 1), date(2023, 12, 31), "44/2023/NĐ-CP"),
    (date(2024, 1, 1), date(2024, 6, 30), "94/2023/NĐ-CP"),
    (date(2024, 7, 1), date(2024, 12, 31), "72/2024/NĐ-CP"),
    (date(2025, 1, 1), date(2025, 6, 30), "180/2024/NĐ-CP"),
    (VAT_REDUCTION_FROM, VAT_REDUCTION_TO, "204/2025/QH15 · 174/2025/NĐ-CP"),
)


def reduction_active(on_date: date) -> bool:
    return any(start <= on_date <= end for start, end, _ in VAT_REDUCTION_PERIODS)


def standard_rate(on_date: date, eligible_for_reduction: bool = True) -> float:
    if eligible_for_reduction and reduction_active(on_date):
        return 8.0
    return 10.0


def policy_snapshot(on_date: date) -> dict:
    active = reduction_active(on_date)
    return {
        "date": on_date.isoformat(),
        "reduction_active": active,
        "standard_eligible_rate": standard_rate(on_date),
        "reduction_from": VAT_REDUCTION_FROM.isoformat(),
        "reduction_to": VAT_REDUCTION_TO.isoformat(),
        "software_category": "KCT",
        "notes": [
            "Sản phẩm/dịch vụ phần mềm thuộc diện không chịu thuế thì khai KCT, không khai 0%.",
            "0% chỉ áp dụng khi giao dịch đáp ứng điều kiện thuế suất 0%, ví dụ xuất khẩu đủ hồ sơ.",
            "8% chỉ áp dụng cho hàng hóa/dịch vụ vốn chịu 10% và không thuộc danh sách loại trừ.",
        ],
        "legal_basis": ["48/2024/QH15", "204/2025/QH15", "174/2025/NĐ-CP"],
    }
