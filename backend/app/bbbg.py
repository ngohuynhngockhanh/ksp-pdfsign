"""Sinh Bien ban ban giao (BBBG) tu template HTML (Jinja2) -> PDF (WeasyPrint).

Them mau moi: bo 1 file .html vao templates_bbbg/ va dang ky vao TEMPLATES.
"""
from __future__ import annotations

import base64
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from weasyprint import HTML

from . import money
from .config import Settings

_TPL_DIR = Path(__file__).parent / "templates_bbbg"

# Registry template — them mau moi chi can them 1 dong + 1 file HTML.
TEMPLATES: dict[str, dict] = {
    "bbbg_thiet_bi": {"file": "bbbg_thiet_bi.html", "label": "Biên bản bàn giao thiết bị"},
}

# Template bao gia / de nghi thanh toan (co cot tien, dung render_quote).
QUOTE_TEMPLATES: dict[str, dict] = {
    "bao_gia": {"file": "bao_gia.html", "label": "Báo giá", "doc_type": "bao_gia"},
    "de_nghi_tt": {
        "file": "de_nghi_tt.html",
        "label": "Đề nghị thanh toán",
        "doc_type": "de_nghi_tt",
    },
    "bbnt": {
        "file": "bbnt.html",
        "label": "Biên bản nghiệm thu",
        "doc_type": "bbnt",
    },
}

# Dieu kien bao hanh mac dinh in tren BBNT (sua duoc tren form)
BBNT_DIEU_KHOAN_MAC_DINH = """*Điều kiện bảo hành:
- Trường hợp thiết bị bị hư hỏng về mặt kỹ thuật do lỗi của nhà sản xuất sẽ được sửa chữa và thay thế miễn phí trong vòng 1 năm đầu tiên kể từ ngày nghiệm thu
- Trong thời hạn bảo hành, nếu có bất cứ lỗi gì trong quá trình sử dụng do chất lượng thiết bị mà nhà sản xuất, lắp đặt không đạt tiêu chuẩn. Người có đủ thẩm quyền của bên mua cần thông báo bằng điện thoại, Email và văn bản tới người có thẩm quyền của bên sản xuất đồng thời cung cấp những căn cứ cần thiết để giải quyết (thời điểm phát sinh lỗi được hiểu là thời điểm bên mua gọi điện, gửi Email, văn bản yêu cầu giám định lỗi) bên sản xuất sẽ cử người đến xem xét, sửa chữa.
*Những trường hợp sau đây sẽ không được bảo hành:
- Các hư hỏng do người vận hành sử dụng không đúng theo sách hướng dẫn kèm theo thiết bị.
- Bất cứ tai nạn gì làm hỏng thiết bị.
- Sử dụng dây dẫn điện không đúng quy cách.
- Điện thế không phù hợp, không ổn định.
- Hỏng hóc do hỏa hoạn.
- Tự ý sửa chữa, cải tạo trên thiết bị.
- Các trường hợp lạm dụng thiết bị: cắm lộn nguồn điện, thiết bị hư hỏng do các vật lạ lọt vào thiết bị."""

_env = Environment(
    loader=FileSystemLoader(str(_TPL_DIR)),
    autoescape=select_autoescape(["html", "xml"]),
)
_env.filters["vnd"] = money.vnd
# So luong: 6.0 -> "6", 0.5 -> "0,5"
_env.filters["qty"] = lambda v: f"{float(v or 0):g}".replace(".", ",")


def list_templates() -> list[dict]:
    return [{"key": k, "label": v["label"]} for k, v in TEMPLATES.items()]


def list_quote_templates() -> list[dict]:
    return [{"key": k, "label": v["label"]} for k, v in QUOTE_TEMPLATES.items()]


def _logo_data_uri(settings: Settings) -> str:
    p = settings.logo_path
    if p.exists():
        return "data:image/png;base64," + base64.b64encode(p.read_bytes()).decode()
    return ""


def default_ben_a(settings: Settings) -> dict:
    return {
        "company": settings.bbbg_company,
        "address": settings.bbbg_address,
        "mst": settings.bbbg_mst,
        "phone": settings.bbbg_phone,
        "rep": settings.bbbg_rep,
        "title": settings.bbbg_rep_title,
    }


def render_bbbg(settings: Settings, data: dict) -> bytes:
    key = data.get("template_key") or "bbbg_thiet_bi"
    if key not in TEMPLATES:
        raise ValueError(f"Template khong ton tai: {key}")
    ngay = data.get("ngay") or {"day": 1, "month": 1, "year": 2026}
    ctx = {
        "so_bb": data.get("so_bb", ""),
        "noi_lap": data.get("noi_lap") or "Đắk Lắk",
        "ngay": {
            "day": int(ngay.get("day", 1)),
            "month": int(ngay.get("month", 1)),
            "year": int(ngay.get("year", 2026)),
        },
        "ben_a": {**default_ben_a(settings), **(data.get("ben_a") or {})},
        "ben_b": data.get("ben_b") or {},
        "items": data.get("items") or [],
        "logo_data_uri": _logo_data_uri(settings),
    }
    html = _env.get_template(TEMPLATES[key]["file"]).render(**ctx)
    return HTML(string=html).write_pdf()


def dntt_ben_a(settings: Settings) -> dict:
    """Letterhead de nghi TT: cong ty nhu BBBG nhung ky Tong giam doc."""
    return {
        "company": settings.bbbg_company,
        "address": settings.bbbg_address,
        "mst": settings.bbbg_mst,
        "phone": settings.bbbg_phone,
        "rep": settings.dntt_rep,
        "title": settings.dntt_rep_title,
    }


def render_quote(settings: Settings, data: dict) -> tuple[bytes, dict]:
    """Sinh PDF bao gia / de nghi thanh toan. Tra ve (pdf, totals) de log/tra API.

    data: template_key, so, ngay, noi_lap, ben_b, items (ten/dvt/so_luong/don_gia/
    thue_suat), thuyet_minh, hieu_luc; rieng de_nghi_tt: loai_tt (toan_bo|co_coc|
    nhieu_phan), tien_coc, da_thanh_toan, so_tien_dot_nay, dot_thu, tong_so_dot,
    han_thanh_toan, can_cu.
    """
    key = data.get("template_key") or "bao_gia"
    if key not in QUOTE_TEMPLATES:
        raise ValueError(f"Template khong ton tai: {key}")
    totals = money.compute_totals(data.get("items") or [])
    tong = totals["tong_thanh_toan"]

    loai_tt = data.get("loai_tt") or "toan_bo"
    tien_coc = money.parse_num(data.get("tien_coc"))
    da_thanh_toan = money.parse_num(data.get("da_thanh_toan"))
    if loai_tt == "co_coc":
        con_lai = max(0, tong - round(tien_coc))
    elif loai_tt == "nhieu_phan":
        so_dot_nay = money.parse_num(data.get("so_tien_dot_nay"))
        con_lai = round(so_dot_nay) if so_dot_nay else max(
            0, tong - round(tien_coc) - round(da_thanh_toan)
        )
    else:
        con_lai = tong

    ngay = data.get("ngay") or {"day": 1, "month": 1, "year": 2026}
    is_dntt = key == "de_nghi_tt"
    ben_a = dntt_ben_a(settings) if is_dntt else default_ben_a(settings)
    noi_lap = data.get("noi_lap") or (
        settings.dntt_noi_lap if is_dntt else settings.default_location
    )
    ctx = {
        "so": data.get("so", ""),
        "noi_lap": noi_lap,
        "ngay": {
            "day": int(ngay.get("day", 1)),
            "month": int(ngay.get("month", 1)),
            "year": int(ngay.get("year", 2026)),
        },
        "ben_a": {**ben_a, **(data.get("ben_a") or {})},
        "ben_b": data.get("ben_b") or {},
        "items": totals["items"],
        "tong_truoc_thue": totals["tong_truoc_thue"],
        "tong_thue": totals["tong_thue"],
        "tong_thanh_toan": tong,
        "thuyet_minh": (data.get("thuyet_minh") or "").strip(),
        "hieu_luc": int(data.get("hieu_luc") or 30),
        "loai_tt": loai_tt,
        "tien_coc": round(tien_coc),
        "da_thanh_toan": round(da_thanh_toan),
        "con_lai": con_lai,
        "dot_thu": int(data.get("dot_thu") or 0),
        "tong_so_dot": int(data.get("tong_so_dot") or 0),
        "han_thanh_toan": data.get("han_thanh_toan") or "05 ngày",
        "can_cu": (data.get("can_cu") or "").strip(),
        "bang_chu": money.so_tien_bang_chu(con_lai if is_dntt else tong),
        "bbnt_ghi_chu": (data.get("bbnt_ghi_chu") or "").strip(),
        "bbnt_dieu_khoan": (data.get("bbnt_dieu_khoan") or "").strip()
        or BBNT_DIEU_KHOAN_MAC_DINH,
        "email": settings.dntt_email,
        "website": settings.dntt_website,
        "bank": {
            "account_name": settings.bank_account_name,
            "account_number": settings.bank_account_number,
            "bank_name": settings.bank_name,
        },
        "logo_data_uri": _logo_data_uri(settings),
    }
    html = _env.get_template(QUOTE_TEMPLATES[key]["file"]).render(**ctx)
    totals["con_lai"] = con_lai
    return HTML(string=html).write_pdf(), totals
