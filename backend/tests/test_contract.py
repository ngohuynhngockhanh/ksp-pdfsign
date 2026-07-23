from __future__ import annotations

import pypdfium2 as pdfium

from app import bbbg
from app.config import get_settings


def _text(pdf: bytes) -> str:
    doc = pdfium.PdfDocument(pdf)
    return "\n".join(doc[i].get_textpage().get_text_range() for i in range(len(doc)))


def test_render_baotoan_contract_draft_contains_required_terms():
    pdf = bbbg.render_contract(get_settings(), {
        "so": "01/2026/HĐPM-INUT",
        "ngay": {"day": 23, "month": 7, "year": 2026},
        "noi_lap": "Đắk Lắk",
        "ben_b": {
            "name": "CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ KỸ THUẬT BẢO TOÀN",
            "mst": "0314360282",
            "address": "3/16A Đường 18B, TP.HCM",
            "email": "baotoan.ceo@gmail.com",
            "dai_dien": "",
        },
        "dieu_khoan": bbbg.DEFAULT_CONTRACT_TERMS,
    })
    assert pdf.startswith(b"%PDF")
    text = _text(pdf)
    for expected in (
        "BẢN NHÁP", "Baotoantech IOT", "baotoantech.io.vn",
        "10.000.000", "3.000.000", "3.300.000", "0314360282",
        "79713", "Techcombank", "mã nguồn", "phụ lục",
    ):
        assert expected in text


def test_signed_ready_contract_has_no_draft_watermark():
    pdf = bbbg.render_contract(get_settings(), {
        "ngay": {"day": 23, "month": 7, "year": 2026},
        "ben_b": {"name": "BẢO TOÀN", "mst": "0314360282", "dai_dien": "NGUYỄN VĂN A"},
    })
    assert "BẢN NHÁP" not in _text(pdf)
