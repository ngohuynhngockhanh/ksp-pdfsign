"""Test sinh BBBG + phan loai (khong can hoa don that)."""
from __future__ import annotations

import os

import pytest

pytest.importorskip("weasyprint")
pytest.importorskip("pdfplumber")

import pypdfium2 as pdfium  # noqa: E402

from app import bbbg, classify  # noqa: E402
from app.config import get_settings  # noqa: E402

SAMPLE = {
    "so_bb": "09-07-2026/BB-BGTB",
    "noi_lap": "Đắk Lắk",
    "ngay": {"day": 9, "month": 7, "year": 2026},
    "ben_b": {
        "name": "CÔNG TY CỔ PHẦN CÔNG NGHỆ TÂN THANH PHƯƠNG",
        "address": "Số 28 Cao Thắng, Thanh Hoá",
        "mst": "2800817718",
    },
    "items": [
        {"ten": "iNut Manager Prime v2 - MDM Android", "dvt": "Gói", "so_luong": "1"},
        {"ten": "Camera Wifi Ezviz C6N", "dvt": "Chiếc", "so_luong": "6"},
    ],
}


def _text(pdf: bytes) -> str:
    d = pdfium.PdfDocument(pdf)
    return "\n".join(d[i].get_textpage().get_text_range() for i in range(len(d)))


def test_render_bbbg():
    pdf = bbbg.render_bbbg(get_settings(), SAMPLE)
    assert pdf.startswith(b"%PDF") and len(pdf) > 5000
    t = _text(pdf)
    assert "BIÊN BẢN BÀN GIAO" in t
    assert "TÂN THANH PHƯƠNG" in t
    assert "2800817718" in t
    assert "iNut Manager Prime" in t
    assert "Camera Wifi Ezviz" in t
    assert "NGÔ HUỲNH NGỌC KHÁNH" in t  # Ben A tu config


def test_templates_registry():
    keys = [t["key"] for t in bbbg.list_templates()]
    assert "bbbg_thiet_bi" in keys


def test_classify_text():
    assert classify.classify_text("... BIÊN BẢN BÀN GIAO THIẾT BỊ ...") == "bbbg"
    assert classify.classify_text("HỢP ĐỒNG KINH TẾ số 01") == "hop_dong"
    assert classify.classify_text("BÁO GIÁ thiết bị") == "bao_gia"
    assert classify.classify_text("HÓA ĐƠN GIÁ TRỊ GIA TĂNG") == "hoa_don"
    assert classify.classify_text("noi dung khac") == "khac"
    assert classify.classify_text("") == ""


def test_detect_on_generated_bbbg():
    pdf = bbbg.render_bbbg(get_settings(), SAMPLE)
    assert classify.detect_doc_type(pdf) == "bbbg"


@pytest.mark.skipif(
    not os.path.exists(os.path.expanduser("~/ihoadon.vn_4401053694_19_09072026.pdf")),
    reason="khong co hoa don mau",
)
def test_parse_real_invoice():
    from app import invoice

    p = os.path.expanduser("~/ihoadon.vn_4401053694_19_09072026.pdf")
    data = invoice.parse_invoice(open(p, "rb").read())
    assert data["buyer"]["mst"] == "2800817718"
    assert "TÂN THANH PHƯƠNG" in data["buyer"]["name"]
    assert data["ngay"] == {"day": 9, "month": 7, "year": 2026}
    assert any("iNut Manager Prime" in it["ten"] for it in data["items"])
    # khong lot dong danh so cot
    assert all(not (it["ten"].isdigit() and len(it["ten"]) <= 2) for it in data["items"])


@pytest.mark.skipif(
    not os.path.exists(os.path.expanduser("~/ihoadon.vn_4401053694_19_09072026.xml")),
    reason="khong co hoa don XML mau",
)
def test_parse_invoice_xml():
    from app import invoice

    p = os.path.expanduser("~/ihoadon.vn_4401053694_19_09072026.xml")
    data = invoice.parse_invoice_xml(open(p, "rb").read())
    assert data["source"] == "xml"
    assert data["buyer"]["mst"] == "2800817718"
    assert "TÂN THANH PHƯƠNG" in data["buyer"]["name"]
    assert data["ngay"] == {"year": 2026, "month": 7, "day": 9}
    assert data["items"][0]["so_luong"] == "1"
    assert "iNut Manager Prime" in data["items"][0]["ten"]
