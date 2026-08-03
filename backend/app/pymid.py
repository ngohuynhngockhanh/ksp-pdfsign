"""Quy tắc giá và VAT cho chương trình INUT - PYMID CO.OP."""
from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP


CATALOG = [
    {"code": "PMC01", "name": "Bộ Trung Tâm PYMID CENTER - 32 bit 1GB RAM - 8GB flash - lưu dữ liệu 1 năm", "unit": "Cái", "source_price": 2455000, "category": "hardware", "level": 1},
    {"code": "PMC02", "name": "Bộ Trung Tâm PYMID CENTER - 64 bit 2GB RAM - 16GB flash - lưu dữ liệu 2 năm", "unit": "Cái", "source_price": 2895000, "category": "hardware", "level": 2},
    {"code": "PMC03", "name": "Bộ Trung Tâm PYMID CENTER - 64 bit 4GB RAM - 32GB flash - lưu dữ liệu 3 năm", "unit": "Cái", "source_price": 3295000, "category": "hardware", "level": 3},
    {"code": "USB-RS485", "name": "USB RS485 cho mạch RS485 Relay", "unit": "Cái", "source_price": 71200, "category": "hardware"},
    {"code": "USB-HUB7", "name": "USB Hub 7", "unit": "Cái", "source_price": 126000, "category": "hardware"},
    {"code": "RS485-RELAY4", "name": "Mạch RS485 4 Relay, ID 1, Baudrate 9600", "unit": "Cái", "source_price": 550000, "category": "hardware"},
    {"code": "PSU-12V-RELAY", "name": "Nguồn 12V 1A cho mạch Relay và dây DC chia 3", "unit": "Cái", "source_price": 62000, "category": "hardware"},
    {"code": "ROUTER-PYMID", "name": "Router Wi-Fi cho PYMID Center", "unit": "Cái", "source_price": 220000, "category": "hardware"},
    {"code": "SW-BIEU-DO", "name": "Phần mềm xuất số liệu và biểu đồ phục vụ phân tích", "unit": "Gói", "source_price": 150000, "category": "software"},
    {"code": "SW-PHUN-SUONG", "name": "Phần mềm điều khiển phun sương theo điều kiện độ ẩm và timer", "unit": "Gói", "source_price": 550000, "category": "software"},
    {"code": "SW-NHIET", "name": "Phần mềm điều khiển nhiệt", "unit": "Gói", "source_price": 300000, "category": "software"},
    {"code": "SENSOR-SHT30", "name": "Cảm biến nhiệt độ, độ ẩm RS485 SHT30", "unit": "Cái", "source_price": 570000, "category": "hardware"},
    {"code": "CABLE-SENSOR-4C", "name": "Dây cảm biến nhiệt độ, độ ẩm 4 lõi 4 màu", "unit": "Mét", "source_price": 6037, "category": "hardware"},
    {"code": "SW-CHECK-AUDIO", "name": "Phần mềm kiểm tra ổn định công suất dây âm thanh", "unit": "Gói", "source_price": 250000, "category": "software"},
    {"code": "AUDIO-CHECK-4", "name": "Bộ 4 vòng kiểm tra công suất đường dây loa", "unit": "Bộ", "source_price": 800000, "category": "hardware"},
    {"code": "AUDIO-CHECK-6", "name": "Bộ 6 vòng kiểm tra công suất đường dây loa", "unit": "Bộ", "source_price": 1200000, "category": "hardware"},
    {"code": "AUDIO-CHECK-8", "name": "Bộ 8 vòng kiểm tra công suất đường dây loa", "unit": "Bộ", "source_price": 1800000, "category": "hardware"},
    {"code": "SW-AMPE", "name": "Phần mềm biểu đồ và cảnh báo dòng điện", "unit": "Gói", "source_price": 700000, "category": "software"},
    {"code": "AMPE-10X20A", "name": "Mạch đo ampe 10 vòng, 20A mỗi vòng", "unit": "Cái", "source_price": 3988000, "category": "hardware"},
    {"code": "PSU-AMPE", "name": "Nguồn cho bộ đo ampe", "unit": "Cái", "source_price": 140000, "category": "hardware"},
    {"code": "CHINT-25A", "name": "Khởi động từ Chint 25A", "unit": "Cái", "source_price": 132000, "category": "hardware"},
    {"code": "CHINT-63A", "name": "Khởi động từ Chint 63A", "unit": "Cái", "source_price": 252000, "category": "hardware"},
    {"code": "MCB-CHINT-63A", "name": "Aptomat Chint 63A", "unit": "Cái", "source_price": 150000, "category": "hardware"},
]


def money(value: Decimal | float | int) -> int:
    return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def vat_policy(document_date: date) -> dict:
    if date(2025, 7, 1) <= document_date <= date(2026, 12, 31):
        return {"code": "NQ204_2025_VAT8", "vat_rate": 8, "label": "VAT 8%", "valid_to": "2026-12-31"}
    return {"code": "VAT_STANDARD_10", "vat_rate": 10, "label": "VAT 10%", "valid_to": ""}


def price_for(source_price: float, category: str, policy: dict) -> dict:
    current_gross = money(Decimal(str(source_price)) * Decimal("1.15"))
    if category == "software":
        return {"net_price": current_gross, "tax_amount": 0, "gross_price": current_gross,
                "vat_rate": None, "vat_label": "KCT", "tax_treatment": "exempt"}
    base_net = money(Decimal(current_gross) / Decimal("1.08"))
    rate = int(policy["vat_rate"])
    tax = money(Decimal(base_net) * Decimal(rate) / Decimal(100))
    return {"net_price": base_net, "tax_amount": tax, "gross_price": base_net + tax,
            "vat_rate": rate, "vat_label": f"VAT {rate}%", "tax_treatment": "taxable"}


def invoice_name(level: int) -> str:
    return ("iNut Nebi - Bộ giải pháp nhà yến cho kết cấu giám sát, lưu trữ, "
            f"Model Level {level} - Phiên bản tùy chỉnh theo cấu hình mong muốn của khách hàng từ phần cứng")
