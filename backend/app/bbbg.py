"""Sinh Bien ban ban giao (BBBG) tu template HTML (Jinja2) -> PDF (WeasyPrint).

Them mau moi: bo 1 file .html vao templates_bbbg/ va dang ky vao TEMPLATES.
"""
from __future__ import annotations

import base64
import html
from pathlib import Path
import re

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

CONTRACT_TEMPLATE = "hop_dong_phan_mem.html"
_CONTRACT_SOURCE_DIR = Path(__file__).parent / "contract_templates"
_BAOTOAN_REV2_PATH = _CONTRACT_SOURCE_DIR / "baotoantech_iot_rev2.md"

DEFAULT_CONTRACT_TERMS = """ĐIỀU 1. PHẠM VI CUNG CẤP
1. INUT thiết lập ứng dụng “Baotoantech IOT” theo nhận diện và logo hợp pháp do Bên B cung cấp. Ứng dụng bao gồm các tính năng điều khiển, giám sát IoT mặc định tương đương nền tảng SecoHome, áp dụng cho các thiết bị do INUT sản xuất và xác nhận tương thích.
2. INUT cung cấp, vận hành dịch vụ kết nối P2P tại baotoantech.io.vn, backend/server của ứng dụng và thực hiện công việc phát hành, duy trì ứng dụng trên App Store và Google Play bằng tài khoản nhà phát triển của INUT.
3. Việc xét duyệt, thời gian hiển thị hoặc duy trì ứng dụng trên kho ứng dụng còn phụ thuộc chính sách của Apple, Google và bên thứ ba; INUT không bảo đảm kết quả nằm ngoài khả năng kiểm soát hợp lý của mình.

ĐIỀU 2. GIÁ TRỊ VÀ THANH TOÁN
1. Phí bản quyền sử dụng, thiết lập và triển khai phần mềm năm đầu là 10.000.000 đồng (Bằng chữ: Mười triệu đồng chẵn). Khoản này được xác định là sản phẩm, dịch vụ phần mềm không chịu thuế GTGT theo quy định áp dụng tại thời điểm lập hóa đơn.
2. Bên B thanh toán 50% trong vòng 05 ngày làm việc kể từ ngày ký Hợp đồng và 50% còn lại trong vòng 05 ngày làm việc kể từ ngày ký biên bản nghiệm thu hoặc được xem là đã nghiệm thu.
3. Từ năm thứ hai, phí vận hành server, P2P, cập nhật và duy trì kho ứng dụng là 3.000.000 đồng/năm, cộng thuế GTGT 10%; tổng thanh toán theo thuế suất hiện tại là 3.300.000 đồng/năm. Thuế suất thực tế tuân theo pháp luật tại thời điểm xuất hóa đơn.

ĐIỀU 3. TIẾN ĐỘ VÀ NGHIỆM THU
1. INUT bàn giao phiên bản để nghiệm thu trong vòng 30 ngày làm việc kể từ khi nhận đủ khoản thanh toán đợt một và Bên B cung cấp đầy đủ logo, nội dung, tài liệu và quyền truy cập cần thiết.
2. Bên B phản hồi bằng văn bản trong vòng 05 ngày làm việc kể từ khi nhận bản bàn giao. Quá thời hạn này mà không có lỗi nghiêm trọng được mô tả cụ thể, sản phẩm được xem là đã nghiệm thu.

ĐIỀU 4. QUYỀN SỞ HỮU TRÍ TUỆ VÀ DỮ LIỆU
1. INUT giữ toàn bộ quyền đối với SecoHome, nền tảng dùng chung, mã nguồn, thư viện, API, quy trình và công nghệ lõi. Bên B được quyền sử dụng ứng dụng mang thương hiệu Baotoantech IOT trong thời hạn dịch vụ, không được chuyển giao, bán lại mã nguồn hoặc can thiệp trái phép vào hệ thống.
2. Bên B chịu trách nhiệm và giữ quyền đối với logo, nhãn hiệu, nội dung cùng dữ liệu hợp pháp của mình. INUT chỉ xử lý dữ liệu trong phạm vi cần thiết để cung cấp dịch vụ, bảo trì, bảo mật và tuân thủ pháp luật.

ĐIỀU 5. PHÁT TRIỂN TÍNH NĂNG
1. Tính năng có thể dùng chung, tương thích thiết bị INUT và phù hợp lộ trình sản phẩm có thể được INUT xem xét thực hiện miễn phí. Phạm vi, mức độ ưu tiên và thời điểm triển khai do INUT đề xuất và chỉ ràng buộc sau khi được xác nhận bằng văn bản.
2. Tính năng riêng, độc quyền hoặc chỉ phục vụ mô hình của Bên B phải được khảo sát và thống nhất phương án kỹ thuật, chi phí, tiến độ bằng phụ lục hoặc báo giá riêng. Việc tham khảo Hunonic IoT hay ứng dụng khác không làm phát sinh nghĩa vụ sao chép hoặc phát triển miễn phí.

ĐIỀU 6. VẬN HÀNH VÀ HỖ TRỢ
1. INUT tiếp nhận hỗ trợ trong giờ hành chính và xử lý theo mức độ ảnh hưởng trên cơ sở nỗ lực hợp lý. Hoạt động bảo trì dự kiến sẽ được thông báo khi điều kiện cho phép.
2. Dịch vụ phụ thuộc internet, hạ tầng viễn thông, thiết bị đầu cuối và bên thứ ba nên không được cam kết hoạt động tuyệt đối, liên tục hoặc không có sai sót.

ĐIỀU 7. THỜI HẠN VÀ CHẤM DỨT
1. Hợp đồng có thời hạn 12 tháng kể từ ngày có hiệu lực. Việc vận hành từ năm thứ hai được gia hạn từng năm sau khi Bên B thanh toán phí vận hành và thuế tương ứng.
2. Nếu Bên B không gia hạn, INUT được tạm dừng server, P2P, cập nhật kho ứng dụng và hỗ trợ sau khi thông báo. Bên B có 30 ngày kể từ thông báo để yêu cầu xuất dữ liệu thuộc quyền của mình ở định dạng hợp lý.

ĐIỀU 8. BẢO MẬT, BẤT KHẢ KHÁNG VÀ TRANH CHẤP
1. Mỗi Bên bảo mật thông tin kỹ thuật, kinh doanh và dữ liệu không công khai nhận được từ Bên kia, trừ trường hợp pháp luật yêu cầu cung cấp.
2. Bên bị ảnh hưởng bởi sự kiện bất khả kháng phải thông báo và áp dụng biện pháp hợp lý để hạn chế thiệt hại. Thời hạn thực hiện được gia hạn tương ứng với thời gian bị ảnh hưởng.
3. Tranh chấp trước hết được thương lượng. Nếu không giải quyết được trong 30 ngày, tranh chấp được đưa ra Tòa án có thẩm quyền tại Việt Nam.

ĐIỀU 9. ĐIỀU KHOẢN CHUNG
1. Phụ lục, biên bản nghiệm thu và văn bản được người có thẩm quyền hai Bên xác nhận là bộ phận không tách rời của Hợp đồng.
2. Hợp đồng có hiệu lực từ ngày ký, được lập thành 02 bản có giá trị pháp lý như nhau, mỗi Bên giữ 01 bản."""


def _load_contract_terms(path: Path, fallback: str) -> str:
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return fallback


BAOTOAN_CONTRACT_TERMS_REV2 = _load_contract_terms(
    _BAOTOAN_REV2_PATH, DEFAULT_CONTRACT_TERMS
)


def _contract_terms_html(text: str) -> str:
    """Render the editable ==highlight== convention without allowing raw HTML."""
    escaped = html.escape(text)
    return re.sub(r"==(.+?)==", r'<mark class="revision">\1</mark>', escaped, flags=re.DOTALL)

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


def render_contract(settings: Settings, data: dict) -> bytes:
    ngay = data.get("ngay") or {"day": 1, "month": 1, "year": 2026}
    ben_b = data.get("ben_b") or {}
    ctx = {
        **data,
        "ngay": {k: int(ngay.get(k, 1)) for k in ("day", "month", "year")},
        "ben_a": default_ben_a(settings),
        "ben_b": ben_b,
        "dieu_khoan": (data.get("dieu_khoan") or BAOTOAN_CONTRACT_TERMS_REV2).strip(),
        "dieu_khoan_html": _contract_terms_html(
            (data.get("dieu_khoan") or BAOTOAN_CONTRACT_TERMS_REV2).strip()
        ),
        "is_draft": not (ben_b.get("dai_dien") or "").strip(),
        "logo_data_uri": _logo_data_uri(settings),
        "email": settings.dntt_email,
        "website": settings.dntt_website,
        "bank": {
            "account_name": settings.bank_account_name,
            "account_number": settings.bank_account_number,
            "bank_name": settings.bank_name,
        },
    }
    html = _env.get_template(CONTRACT_TEMPLATE).render(**ctx)
    return HTML(string=html).write_pdf()
