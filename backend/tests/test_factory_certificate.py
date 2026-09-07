"""Test giay chung nhan xuat xuong va cac truong thong tin thiet bi."""
from __future__ import annotations

import pytest
import re

pytest.importorskip("weasyprint")

import pypdfium2 as pdfium  # noqa: E402

from app import bbbg, classify  # noqa: E402
from app.config import get_settings  # noqa: E402


SAMPLE = {
    "certificate_no": "GCXX-17-08-2026-INUT",
    "ngay": {"day": 17, "month": 8, "year": 2026},
    "noi_lap": "Đắk Lắk",
    "ben_b": {
        "name": "CÔNG TY CỔ PHẦN TẬP ĐOÀN MERAP",
        "address": "Thôn Bá Khê, Xã Văn Giang, Tỉnh Hưng Yên, Việt Nam",
        "mst": "0101400572",
    },
    "product_name": "iNut Smartcity - Data Logger v2",
    "model": "iNut Smartcity - Data Logger v2",
    "ma_thiet_bi": "7.32",
    "serial_number": "SN-732-DEMO",
    "quantity": 1,
    "unit": "Bộ",
    "reference_quote": "17-08-2026/BG-INUT",
    "firmware_version": "",
    "features": [
        "Thu thập và hiển thị dữ liệu thời gian thực.",
        "Kết nối MQTT theo cấu hình triển khai.",
    ],
    "quality_status": "Đạt",
    "warranty": "Bảo hành 12 tháng, 1 đổi 1 kể từ ngày mua hàng.",
    "note": "Các khả năng tích hợp phụ thuộc cấu hình và firmware thực tế.",
}


def _text(pdf: bytes) -> str:
    doc = pdfium.PdfDocument(pdf)
    return "\n".join(doc[i].get_textpage().get_text_range() for i in range(len(doc)))


def test_render_factory_certificate_for_merap():
    pdf = bbbg.render_factory_certificate(get_settings(), SAMPLE)
    assert pdf.startswith(b"%PDF") and len(pdf) > 5000
    text = _text(pdf)
    compact = re.sub(r"\s+", " ", text)
    assert "GIẤY CHỨNG NHẬN XUẤT XƯỞNG" in text
    assert "CÔNG TY CỔ PHẦN TẬP ĐOÀN MERAP" in compact
    assert "0101400572" in text
    assert "iNut Smartcity - Data Logger v2" in text
    assert "7.32" in text
    assert "SN-732-DEMO" in text
    assert "Bảo hành 12 tháng, 1 đổi 1" in text
    assert "Đạt" in text
    assert classify.detect_doc_type(pdf) == "xuat_xuong"


def test_factory_certificate_template_is_registered():
    keys = [item["key"] for item in bbbg.list_factory_certificate_templates()]
    assert keys == ["giay_chung_nhan_xuat_xuong"]


def test_factory_certificate_defaults_serial_and_manufacture_date():
    data = {**SAMPLE, "serial_number": "", "ngay_san_xuat": None}
    pdf = bbbg.render_factory_certificate(get_settings(), data)
    compact = re.sub(r"\s+", " ", _text(pdf))
    assert "cast207.32" in compact
    assert "17/08/2026" in compact
