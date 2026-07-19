"""Test bao gia / de nghi thanh toan: doc so bang chu, tinh tien, render PDF, AI."""
from __future__ import annotations

import json

import pytest

pytest.importorskip("weasyprint")

import pypdfium2 as pdfium  # noqa: E402

from app import ai, bbbg, classify, money  # noqa: E402
from app.config import get_settings  # noqa: E402


def _text(pdf: bytes) -> str:
    d = pdfium.PdfDocument(pdf)
    return "\n".join(d[i].get_textpage().get_text_range() for i in range(len(d)))


# ---------------------------------------------------------------------------
# money.py
# ---------------------------------------------------------------------------
def test_so_tien_bang_chu():
    assert money.so_tien_bang_chu(60_000_000) == "Sáu mươi triệu đồng chẵn"
    assert money.so_tien_bang_chu(0) == "Không đồng"
    assert money.so_tien_bang_chu(105) == "Một trăm lẻ năm đồng chẵn"
    assert money.so_tien_bang_chu(21) == "Hai mươi mốt đồng chẵn"
    assert money.so_tien_bang_chu(15) == "Mười lăm đồng chẵn"
    assert (
        money.so_tien_bang_chu(1_234_567)
        == "Một triệu hai trăm ba mươi bốn nghìn năm trăm sáu mươi bảy đồng chẵn"
    )
    assert money.so_tien_bang_chu(1_000_005) == "Một triệu không trăm lẻ năm đồng chẵn"
    assert money.so_tien_bang_chu(2_500_000_000) == "Hai tỷ năm trăm triệu đồng chẵn"


def test_parse_num():
    assert money.parse_num("1.500.000") == 1_500_000
    assert money.parse_num("1,500,000") == 1_500_000
    assert money.parse_num("1500000") == 1_500_000
    assert money.parse_num("1.5") == 1.5
    assert money.parse_num("") == 0
    assert money.parse_num(None) == 0
    assert money.parse_num(7) == 7


def test_compute_totals():
    r = money.compute_totals([
        {"ten": "A", "dvt": "Cái", "so_luong": 2, "don_gia": 10_000_000, "thue_suat": 10},
        {"ten": "B", "dvt": "Gói", "so_luong": 1, "don_gia": 5_000_000, "thue_suat": 8},
    ])
    assert r["items"][0]["thanh_tien"] == 20_000_000
    assert r["tong_truoc_thue"] == 25_000_000
    assert r["tong_thue"] == 2_000_000 + 400_000
    assert r["tong_thanh_toan"] == 27_400_000


# ---------------------------------------------------------------------------
# Render PDF
# ---------------------------------------------------------------------------
QUOTE = {
    "template_key": "bao_gia",
    "so": "19-07-2026/BG-INUT",
    "ngay": {"day": 19, "month": 7, "year": 2026},
    "ben_b": {"name": "CÔNG TY TNHH MẪU", "address": "123 Lê Lợi, TP.HCM", "mst": "0312345678"},
    "items": [
        {"ten": "iNut Platform Enterprise", "dvt": "Gói", "so_luong": 1,
         "don_gia": 50_000_000, "thue_suat": 10},
        {"ten": "Camera AI", "dvt": "Chiếc", "so_luong": 4,
         "don_gia": 2_500_000, "thue_suat": 8},
    ],
    "thuyet_minh": "INUT trân trọng giới thiệu giải pháp chuyển đổi số toàn diện.",
}


def test_render_bao_gia():
    pdf, totals = bbbg.render_quote(get_settings(), dict(QUOTE))
    assert pdf.startswith(b"%PDF")
    assert totals["tong_truoc_thue"] == 60_000_000
    assert totals["tong_thanh_toan"] == 65_800_000
    assert totals["items"][0]["tien_thue"] == 5_000_000
    assert totals["items"][1]["tien_thue"] == 800_000
    t = _text(pdf)
    assert "BÁO GIÁ" in t
    assert "CÔNG TY TNHH MẪU" in t
    assert "iNut Platform Enterprise" in t
    assert "50.000.000" in t          # don gia
    assert "65.800.000" in t          # tong thanh toan
    assert "Tiền thuế" in t           # cot thue tung dong
    assert "800.000" in t             # tien thue dong 2 (10tr x 8%)
    assert "Sáu mươi lăm triệu tám trăm nghìn đồng chẵn" in t
    assert "giải pháp chuyển đổi số" in t  # thuyet minh
    assert "NGÔ HUỲNH NGỌC KHÁNH" in t


def test_render_de_nghi_tt_toan_bo():
    data = {**QUOTE, "template_key": "de_nghi_tt", "so": "19-07-2026/DNTT-INUT"}
    pdf, totals = bbbg.render_quote(get_settings(), data)
    assert totals["con_lai"] == 65_800_000
    t = _text(pdf)
    assert "ĐỀ NGHỊ THANH TOÁN" in t
    assert "TP.HCM" in t                       # noi lap mac dinh rieng
    assert "hotro@mysmarthome.com.vn" in t
    assert "Techcombank" in t and "79713" in t  # TK nhan
    assert "TỔNG SỐ TIỀN CÒN LẠI CẦN THANH TOÁN" in t
    assert "Tổng giám đốc".upper() in t.upper()


def test_render_de_nghi_tt_co_coc():
    data = {
        **QUOTE, "template_key": "de_nghi_tt",
        "loai_tt": "co_coc", "tien_coc": 20_000_000,
    }
    pdf, totals = bbbg.render_quote(get_settings(), data)
    assert totals["con_lai"] == 45_800_000
    t = _text(pdf)
    assert "Số tiền đã đặt cọc" in t
    assert "20.000.000" in t
    assert "45.800.000" in t
    assert "Bốn mươi lăm triệu tám trăm nghìn đồng chẵn" in t


def test_render_de_nghi_tt_nhieu_phan():
    data = {
        **QUOTE, "template_key": "de_nghi_tt",
        "loai_tt": "nhieu_phan", "tien_coc": 10_000_000, "da_thanh_toan": 20_000_000,
        "so_tien_dot_nay": 15_000_000, "dot_thu": 2, "tong_so_dot": 3,
    }
    pdf, totals = bbbg.render_quote(get_settings(), data)
    assert totals["con_lai"] == 15_000_000
    t = _text(pdf)
    assert "Đợt 2/3" in t
    assert "Đã thanh toán các đợt trước" in t
    assert "SỐ TIỀN CẦN THANH TOÁN ĐỢT NÀY" in t
    assert "15.000.000" in t


def test_render_bbnt():
    data = {
        **QUOTE, "template_key": "bbnt", "so": "19-07-2026/BBNT-INUT",
        "ben_b": {**QUOTE["ben_b"], "dai_dien": "Ông Lê Xuân Tú", "ten_ngan": "MAU CO"},
        "bbnt_ghi_chu": "Bảo hành 1 năm 1 đổi 1 kể từ ngày nghiệm thu*",
    }
    pdf, _ = bbbg.render_quote(get_settings(), data)
    t = _text(pdf)
    assert "BIÊN BẢN NGHIỆM THU" in t
    assert "Bên mua".upper() in t.upper() and "Bên bán".upper() in t.upper()
    assert "Ông Lê Xuân Tú" in t
    assert "MAU CO" in t                        # ten goi tat
    assert "Bảo hành 1 năm 1 đổi 1" in t        # ghi chu hang muc
    assert "Điều kiện bảo hành" in t            # dieu khoan mac dinh
    assert "lập thành 2 bản" in t
    assert "50.000.000" not in t                # BBNT khong in gia
    assert classify.detect_doc_type(pdf) == "bbnt"


def test_quote_templates_registry():
    keys = [t["key"] for t in bbbg.list_quote_templates()]
    assert keys == ["bao_gia", "de_nghi_tt", "bbnt"]


# ---------------------------------------------------------------------------
# Phan loai
# ---------------------------------------------------------------------------
def test_classify_de_nghi_tt():
    # 'Tong gia tri hop dong' xuat hien trong de nghi TT -> van phai ra de_nghi_tt
    assert classify.classify_text("ĐỀ NGHỊ THANH TOÁN ... tổng giá trị hợp đồng") == "de_nghi_tt"
    assert classify.classify_text("HỢP ĐỒNG KINH TẾ") == "hop_dong"


def test_detect_on_generated_pdfs():
    s = get_settings()
    pdf_bg, _ = bbbg.render_quote(s, dict(QUOTE))
    assert classify.detect_doc_type(pdf_bg) == "bao_gia"
    pdf_tt, _ = bbbg.render_quote(s, {**QUOTE, "template_key": "de_nghi_tt"})
    assert classify.detect_doc_type(pdf_tt) == "de_nghi_tt"


# ---------------------------------------------------------------------------
# AI client
# ---------------------------------------------------------------------------
def test_parse_json_loose_voi_duoi_done():
    raw = json.dumps({"choices": [{"message": {"content": "OK"}}]}) + "\ndata: [DONE]\n"
    obj = ai._parse_json_loose(raw)
    assert obj["choices"][0]["message"]["content"] == "OK"


def test_ai_khong_cau_hinh():
    s = get_settings().model_copy(update={"ai_enabled": False})
    with pytest.raises(ai.AINotConfigured):
        ai.chat(s, [{"role": "user", "content": "hi"}])


def test_quote_narrative_mock(monkeypatch):
    import httpx

    def fake_post(url, **kwargs):
        assert url.endswith("/chat/completions")
        body = kwargs["json"]
        assert body["model"]
        assert any("Camera AI" in m["content"] for m in body["messages"])
        return httpx.Response(
            200,
            text=json.dumps({
                "choices": [{"message": {"content": "Kính gửi Quý khách, INUT xin gửi báo giá."}}]
            }) + "\ndata: [DONE]",
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    s = get_settings().model_copy(update={"ai_enabled": True})
    text = ai.quote_narrative(
        s, items=[{"ten": "Camera AI", "dvt": "Chiếc", "so_luong": 4}],
        khach="CÔNG TY TNHH MẪU", tong=65_800_000,
    )
    assert "báo giá" in text


def test_quote_narrative_rong_bao_loi(monkeypatch):
    import httpx

    monkeypatch.setattr(
        httpx, "post",
        lambda url, **kw: httpx.Response(
            200, text=json.dumps({"choices": [{"message": {"content": ""}}]})
        ),
    )
    s = get_settings().model_copy(update={"ai_enabled": True})
    with pytest.raises(ai.AIError, match="AI_MAX_TOKENS"):
        ai.chat(s, [{"role": "user", "content": "hi"}])
