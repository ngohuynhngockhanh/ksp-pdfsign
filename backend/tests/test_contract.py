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
        "revision": "REVISION 2",
        "ngay": {"day": 23, "month": 7, "year": 2026},
        "noi_lap": "Đắk Lắk",
        "ben_b": {
            "name": "CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ KỸ THUẬT BẢO TOÀN",
            "mst": "0314360282",
            "address": "3/16A Đường 18B, TP.HCM",
            "email": "baotoan.ceo@gmail.com",
            "dai_dien": "",
        },
        "dieu_khoan": bbbg.BAOTOAN_CONTRACT_TERMS_REV2,
    })
    assert pdf.startswith(b"%PDF")
    text = _text(pdf)
    for expected in (
        "BẢN NHÁP", "Baotoantech IOT", "baotoantech.io.vn",
        "REVISION 2", "10.000.000", "3.000.000", "0314360282",
        "79713", "Techcombank", "mã nguồn", "phụ lục", "QR dùng một lần",
        "FUXA", "60 ngày", "24104", "07 ngày", "5.000.000",
        "Khoản tạm ứng này chưa xuất hóa đơn", "xuất hóa đơn cho toàn bộ giá trị",
    ):
        assert expected in text


def test_revision_markup_is_escaped_before_highlighting():
    rendered = bbbg._contract_terms_html('==Nội dung mới== <script>alert("x")</script>')
    assert '<mark class="revision">Nội dung mới</mark>' in rendered
    assert "<script>" not in rendered
    assert "&lt;script&gt;" in rendered


def test_signed_ready_contract_has_no_draft_watermark():
    pdf = bbbg.render_contract(get_settings(), {
        "ngay": {"day": 23, "month": 7, "year": 2026},
        "ben_b": {"name": "BẢO TOÀN", "mst": "0314360282", "dai_dien": "NGUYỄN VĂN A"},
    })
    assert "BẢN NHÁP" not in _text(pdf)


def test_final_contract_keeps_inut_watermark_and_baotoan_representative():
    pdf = bbbg.render_contract(get_settings(), {
        "ngay": {"day": 29, "month": 7, "year": 2026},
        "ben_b": {
            "name": "BẢO TOÀN TECH",
            "mst": "0314360282",
            "dai_dien": "HUỲNH TOÀN",
        },
    })
    text = _text(pdf)
    assert "HUỲNH TOÀN" in text
    assert "INUT" in text
    assert "BẢN NHÁP" not in text
