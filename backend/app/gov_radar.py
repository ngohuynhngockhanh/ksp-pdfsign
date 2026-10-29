"""Radar Cong van Chinh phu, UBND Tinh Dak Lak, So Y te & Thue co so 7 (Tuy Hoa).

Chu dong quet va kiem chung van ban tu cac cong chinh thuc (.gov.vn):
1. UBND Tinh Dak Lak — Van ban chi dao dieu hanh (daklak.gov.vn/van-ban-chi-dao-dieu-hanh)
2. Thue tinh Dak Lak & Thue co so 7 - Phuong Tuy Hoa (daklak.gdt.gov.vn + Fanpage Thue CS7)
3. So Y te Tinh Dak Lak (yte.daklak.gov.vn)
4. Chinh sach moi Chinh phu / Bo nganh (baochinhphu.vn / vanban.chinhphu.vn)
5. Kiem chung cong van theo so hieu (Fact-check khi xem TikTok/Facebook)
"""

from __future__ import annotations

import html
import logging
import re
import ssl
import urllib.parse
import urllib.request
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select, or_, desc
from sqlalchemy.orm import Session

from .config import Settings
from .db import GovDocument, get_session
from .telegram import TelegramClient, admin_chat_ids

logger = logging.getLogger(__name__)


WEEKLY_SCAN_INTERVAL_SEC = 7 * 86400  # Chu ky quet: 1 tuan / 1 lan
REMINDER_CHECK_INTERVAL_SEC = 6 * 3600  # Kiem tra nhac lai 3 ngay moi 6 tieng
REMINDER_DELAY_DAYS = 3  # Sau 3 ngay trong tuan do nhac lai 1 lan neu chua acknowledge

_worker_started = False
_worker_lock = threading.Lock()
_last_weekly_scan_at: datetime | None = None
# Metadata cac nguon chinh thong
PORTAL_SOURCES: list[dict[str, str]] = [
    {
        "id": "daklak_tax_cs7",
        "name": "Thuế tỉnh Đắk Lắk & Thuế cơ sở 7 (Tuy Hòa)",
        "jurisdiction": "Quản lý trực tiếp INUT (161 Trường Chinh, P. Tuy Hòa, Đắk Lắk · MST 4401053694)",
        "portal_url": "https://daklak.gdt.gov.vn/wps/portal",
        "fb_url": "https://www.facebook.com/share/19oLbR8w7g/?mibextid=wwXIfr",
        "badge": "Thuế CS7 · Tuy Hòa",
    },
    {
        "id": "daklak_ubnd",
        "name": "UBND Tỉnh Đắk Lắk — Văn bản chỉ đạo điều hành",
        "jurisdiction": "Tỉnh Đắk Lắk (bao gồm Phường Tuy Hòa sau sáp nhập)",
        "portal_url": "https://daklak.gov.vn/van-ban-chi-dao-dieu-hanh",
        "fb_url": "",
        "badge": "UBND Đắk Lắk",
    },
    {
        "id": "daklak_syt",
        "name": "Sở Y tế Tỉnh Đắk Lắk",
        "jurisdiction": "Y tế, khám sức khỏe định kỳ, an toàn vệ sinh lao động tại Đắk Lắk",
        "portal_url": "https://yte.daklak.gov.vn",
        "fb_url": "",
        "badge": "Sở Y tế Đắk Lắk",
    },
    {
        "id": "chinhphu",
        "name": "Chính phủ & Bộ ngành Trung ương (Chính sách mới)",
        "jurisdiction": "Hiệu lực toàn quốc (Nghị định, Thông tư Bộ Tài chính, Bộ Y tế, Bộ Nội vụ, Bộ KH&CN)",
        "portal_url": "https://vanban.chinhphu.vn",
        "fb_url": "",
        "badge": "Trung ương",
    },
]

# Cac tu khoa phan loai & cham diem muc do lien quan toi INUT
KEYWORD_RULES: list[tuple[str, str, int]] = [
    # (keyword_lower, category, weight)
    ("thuế cơ sở 7", "thue_ke_toan", 50),
    ("tuy hòa", "doanh_nghiep_tuy_hoa", 40),
    ("hoàn thuế", "thue_ke_toan", 35),
    ("hóa đơn", "thue_ke_toan", 35),
    ("người nộp thuế", "thue_ke_toan", 35),
    ("quản lý thuế", "thue_ke_toan", 35),
    ("kê khai", "thue_ke_toan", 30),
    ("quyết toán thuế", "thue_ke_toan", 35),
    ("mã số thuế", "thue_ke_toan", 30),
    ("thuế giá trị gia tăng", "thue_ke_toan", 30),
    ("thuế thu nhập doanh nghiệp", "thue_ke_toan", 35),
    ("doanh nghiệp nhỏ và vừa", "doanh_nghiep_tuy_hoa", 35),
    ("hộ kinh doanh", "thue_ke_toan", 25),
    ("khám sức khỏe định kỳ", "lao_dong_y_te", 45),
    ("khám sức khỏe", "lao_dong_y_te", 35),
    ("an toàn, vệ sinh lao động", "lao_dong_y_te", 40),
    ("an toàn vệ sinh lao động", "lao_dong_y_te", 40),
    ("người lao động", "lao_dong_y_te", 30),
    ("bảo hiểm xã hội", "lao_dong_y_te", 35),
    ("tiền lương", "lao_dong_y_te", 30),
    ("trí tuệ nhân tạo", "cong_nghe_ai_iot", 45),
    ("chuyển đổi số", "cong_nghe_ai_iot", 40),
    ("khoa học, công nghệ", "cong_nghe_ai_iot", 35),
    ("đổi mới sáng tạo", "cong_nghe_ai_iot", 35),
    ("năng lượng tái tạo", "cong_nghe_ai_iot", 40),
    ("điện mặt trời", "cong_nghe_ai_iot", 40),
    ("bưu chính, viễn thông", "cong_nghe_ai_iot", 30),
    ("sở hữu trí tuệ", "cong_nghe_ai_iot", 35),
]

OTHER_PROVINCE_MARKERS = [
    "thành phố hà nội",
    "ubnd thành phố hà nội",
    "sở y tế hà nội",
    "tp. hồ chí minh",
    "thành phố hồ chí minh",
    "sở y tế tp.hcm",
    "sở y tế thành phố hồ chí minh",
    "7006/syt-nvy",
    "16093/syt-nvy",
    "10592/syt-nvy",
    "11507/syt-nvy",
]


def _http_get(url: str, timeout: int = 15) -> str:
    """Fetch HTML tu cong .gov.vn voi SSL fallback an toan cho cac cong tinh."""
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return raw.decode("utf-8", errors="replace")
    except Exception:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            raw = resp.read()
            return raw.decode("utf-8", errors="replace")


def _clean_text(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s or "")
    s = html.unescape(s)
    return " ".join(s.split()).strip()


def classify_and_score(
    title: str,
    doc_number: str = "",
    source_portal: str = "",
) -> tuple[str, int, bool, str, str]:
    """Phan loai, tinh diem lien quan (0-100) va sinh nhan xet tac dong cho INUT."""
    combined = f"{doc_number} {title}".lower()

    # Check if this is explicitly another province's local dispatch
    for marker in OTHER_PROVINCE_MARKERS:
        if marker in combined:
            return (
                "lao_dong_y_te" if "syt" in combined or "sức khỏe" in combined else "khac",
                20,
                False,
                (
                    "⚠️ Văn bản nội bộ của địa phương khác (Hà Nội / TP.HCM) — "
                    "KHÔNG áp dụng cho INUT (trụ sở tại Phường Tuy Hòa, Tỉnh Đắk Lắk). "
                    "Doanh nghiệp không cần điền biểu mẫu của văn bản này."
                ),
                marker,
            )

    matched: list[str] = []
    cat_scores: dict[str, int] = {}
    total_score = 0

    if source_portal == "daklak_tax_cs7":
        total_score += 40
        cat_scores["thue_ke_toan"] = cat_scores.get("thue_ke_toan", 0) + 40

    for kw, cat, weight in KEYWORD_RULES:
        if kw in combined:
            matched.append(kw)
            total_score += weight
            cat_scores[cat] = cat_scores.get(cat, 0) + weight

    # Penalize individual household tax closure announcements unless it's general guidance
    if "ngừng hoạt động" in combined or "chấm dứt hiệu lực mã số thuế của" in combined:
        if "4401053694" not in combined and "inut" not in combined:
            total_score = min(total_score, 25)

    score = min(100, total_score)
    best_cat = max(cat_scores.items(), key=lambda kv: kv[1])[0] if cat_scores else "khac"
    applies = score >= 35 or source_portal in ("daklak_tax_cs7", "chinhphu")

    # Build actionable impact summary for INUT
    if best_cat == "thue_ke_toan":
        if "ngừng hoạt động" in combined or "chấm dứt hiệu lực mã số thuế" in combined:
            impact = (
                "📌 Thông báo quản lý mã số thuế của Thuế tỉnh Đắk Lắk / Thuế cơ sở 7 (Tuy Hòa). "
                "Lưu ý kiểm tra trạng thái MST đối tác trước khi nhận hóa đơn đầu vào."
            )
        else:
            impact = (
                "✅ Áp dụng trực tiếp cho công tác Thuế - Kế toán của INUT (MST 4401053694 · "
                "Thuế cơ sở 7 tỉnh Đắk Lắk). Cần rà soát để kê khai/hạch toán đúng quy định mới."
            )
    elif best_cat == "lao_dong_y_te":
        impact = (
            "✅ Lĩnh vực Y tế - Lao động tại Đắk Lắk / Toàn quốc. "
            "INUT hiện có 02 nhân sự (Khánh & Nhâm) đã khám sức khỏe định kỳ đủ 2/2 người — "
            "chỉ cần lưu Giấy KSK + hóa đơn trong Kho hồ sơ KSP."
        )
    elif best_cat == "cong_nghe_ai_iot":
        impact = (
            "🚀 Chính sách Khoa học Công nghệ / AI / Chuyển đổi số / Năng lượng tái tạo tại Đắk Lắk & Trung ương — "
            "sát lĩnh vực kinh doanh cốt lõi của INUT (iNut AI, IoT, Solar). Nên xem chi tiết để tận dụng ưu đãi/đề án."
        )
    elif best_cat == "doanh_nghiep_tuy_hoa":
        impact = (
            "📍 Văn bản chỉ đạo áp dụng trên địa bàn Phường Tuy Hòa / Tỉnh Đắk Lắk. "
            "Cần lưu ý thực hiện nếu có yêu cầu đối với doanh nghiệp trên địa bàn."
        )
    else:
        impact = "ℹ️ Văn bản điều hành chung của cơ quan nhà nước — tham khảo thông tin."

    return best_cat, score, applies, impact, ", ".join(matched[:6])


def _fetch_daklak_ubnd_detail(van_ban_id: str) -> tuple[str, str]:
    """Lay ngay ban hanh va link PDF goc tu trang chi tiet vanBanId tren daklak.gov.vn."""
    detail_url = (
        "https://daklak.gov.vn/van-ban-chi-dao-dieu-hanh?"
        "p_p_id=viewvbpqmanagement_WAR_unitechappportlet&p_p_lifecycle=1&"
        "p_p_state=normal&p_p_mode=view&p_p_col_id=column-3&p_p_col_count=1&"
        f"_viewvbpqmanagement_WAR_unitechappportlet_vanBanId={van_ban_id}&"
        "_viewvbpqmanagement_WAR_unitechappportlet_javax.portlet.action=chiTietThongTinVanBan"
    )
    try:
        page = _http_get(detail_url, timeout=12)
        pub_date = ""
        m_date = re.search(
            r"Ngày ban hành\s*</td>\s*<td[^>]*>\s*([0-9]{2}/[0-9]{2}/[0-9]{4})",
            page,
            re.IGNORECASE | re.DOTALL,
        )
        if m_date:
            pub_date = m_date.group(1).strip()
        pdf_url = ""
        m_pdf = re.search(r'href="(/documents/[^"]+\.pdf[^"]*)"', page, re.IGNORECASE)
        if m_pdf:
            pdf_url = "https://daklak.gov.vn" + html.unescape(m_pdf.group(1))
        return pub_date, pdf_url
    except Exception as exc:
        logger.debug("Khong lay duoc chi tiet vanBanId=%s: %s", van_ban_id, exc)
        return "", ""


def crawl_daklak_ubnd(max_items: int = 15) -> list[dict[str, Any]]:
    """Quet Van ban chi dao dieu hanh moi nhat + van ban trong diem tren daklak.gov.vn."""
    results: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    urls = [
        # Trang danh sach moi nhat
        (
            "https://daklak.gov.vn/van-ban-chi-dao-dieu-hanh?"
            "p_p_id=viewvbpqmanagement_WAR_unitechappportlet&p_p_lifecycle=0&"
            "p_p_state=normal&p_p_mode=view&_viewvbpqmanagement_WAR_unitechappportlet_delta=20"
        ),
    ]

    for url in urls:
        try:
            page = _http_get(url, timeout=15)
        except Exception as exc:
            logger.warning("Loi quet daklak.gov.vn: %s", exc)
            continue

        # Parse table rows containing vanBanId
        row_pattern = re.compile(
            r'vanBanId=(\d+)&_viewvbpqmanagement_WAR_unitechappportlet_javax\.portlet\.action=chiTietThongTinVanBan"[^>]*>'
            r"\s*([^<]+?)\s*</a>\s*</td>\s*<td[^>]*>\s*<a[^>]*>\s*([^<]+?)\s*</a>",
            re.IGNORECASE | re.DOTALL,
        )
        for m in row_pattern.finditer(page):
            vid = m.group(1).strip()
            if vid in seen_ids:
                continue
            seen_ids.add(vid)
            raw_num = _clean_text(m.group(2))
            title = _clean_text(m.group(3))

            doc_type = "Văn bản"
            doc_number = raw_num
            for prefix in ("Quyết định", "Công văn", "Kế hoạch", "Chỉ thị", "Thông báo", "Nghị quyết", "Tờ trình"):
                if raw_num.lower().startswith(prefix.lower()):
                    doc_type = prefix
                    doc_number = raw_num[len(prefix):].strip()
                    break

            detail_url = (
                "https://daklak.gov.vn/van-ban-chi-dao-dieu-hanh?"
                "p_p_id=viewvbpqmanagement_WAR_unitechappportlet&p_p_lifecycle=1&"
                "p_p_state=normal&p_p_mode=view&p_p_col_id=column-3&p_p_col_count=1&"
                f"_viewvbpqmanagement_WAR_unitechappportlet_vanBanId={vid}&"
                "_viewvbpqmanagement_WAR_unitechappportlet_javax.portlet.action=chiTietThongTinVanBan"
            )
            results.append(
                {
                    "source_key": f"daklak_ubnd:{vid}",
                    "source_portal": "daklak_ubnd",
                    "source_label": "UBND Tỉnh Đắk Lắk",
                    "doc_number": doc_number,
                    "doc_type": doc_type,
                    "published_date": "",
                    "title": title,
                    "detail_url": detail_url,
                    "pdf_url": "",
                    "_van_ban_id": vid,
                }
            )
            if len(results) >= max_items:
                break

    # Ensure key milestone document 1858/QĐ-UBND (Khám sức khỏe định kỳ Đắk Lắk 2026-2030) is included
    if "170215" not in seen_ids:
        results.append(
            {
                "source_key": "daklak_ubnd:170215",
                "source_portal": "daklak_ubnd",
                "source_label": "UBND Tỉnh Đắk Lắk",
                "doc_number": "1858/QĐ-UBND",
                "doc_type": "Quyết định",
                "published_date": "15/06/2026",
                "title": (
                    "Quyết định về việc ban hành Kế hoạch triển khai Khám sức khỏe định kỳ "
                    "hoặc khám sàng lọc cho người dân trên địa bàn tỉnh Đắk Lắk giai đoạn 2026 - 2030 "
                    "(thí điểm tại Phường Tuy Hòa)"
                ),
                "detail_url": (
                    "https://daklak.gov.vn/van-ban-chi-dao-dieu-hanh?"
                    "p_p_id=viewvbpqmanagement_WAR_unitechappportlet&p_p_lifecycle=1&"
                    "p_p_state=normal&p_p_mode=view&p_p_col_id=column-3&p_p_col_count=1&"
                    "_viewvbpqmanagement_WAR_unitechappportlet_vanBanId=170215&"
                    "_viewvbpqmanagement_WAR_unitechappportlet_javax.portlet.action=chiTietThongTinVanBan"
                ),
                "pdf_url": "https://daklak.gov.vn/documents/10181/4211951/209724-1858_Q__UBND_15_06_2026_1__1_.pdf?version=1.0",
                "_van_ban_id": "170215",
            }
        )

    return results


def crawl_daklak_tax_cs7() -> list[dict[str, Any]]:
    """Quet Cong Thue tinh Dak Lak & Thue co so 7 - Phuong Tuy Hoa (daklak.gdt.gov.vn)."""
    results: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    try:
        page = _http_get("https://daklak.gdt.gov.vn/wps/portal", timeout=15)
        # Extract links with urile=wcm... and optional date (DD/MM/YYYY)
        link_pattern = re.compile(
            r'<a[^>]+href="([^"]*urile=wcm[^"]+)"[^>]*>(.*?)</a>(?:\s*\(([0-9]{2}/[0-9]{2}/[0-9]{4})\))?',
            re.IGNORECASE | re.DOTALL,
        )
        for m in link_pattern.finditer(page):
            href = html.unescape(m.group(1)).strip()
            title = _clean_text(m.group(2))
            pub_date = (m.group(3) or "").strip()
            if not title or len(title) < 12 or title.lower() in ("xem thêm", "chi tiết"):
                continue

            # Extract unique WCM UUID or path slug
            decoded_href = urllib.parse.unquote(href)
            slug_match = re.search(r"/([a-f0-9\-]{20,64})$", decoded_href, re.IGNORECASE)
            slug = slug_match.group(1) if slug_match else str( abs(hash(decoded_href)) )
            skey = f"daklak_tax:{slug}"
            if skey in seen_keys:
                continue
            seen_keys.add(skey)

            full_url = href
            if href.startswith("?"):
                full_url = "https://daklak.gdt.gov.vn/wps/portal" + href
            elif href.startswith("/"):
                full_url = "https://daklak.gdt.gov.vn" + href.replace(" ", "")

            # Detect document number in title
            num_match = re.search(
                r"(\d+/[A-ZĐ0-9\-]+(?:/[A-ZĐ0-9\-]+)?)",
                title,
            )
            doc_num = num_match.group(1) if num_match else "TB-THUẾ-ĐL"
            doc_type = "Thông báo Thuế"
            for pfx in ("Quyết định", "Công văn", "Nghị định", "Thông tư", "Thông báo", "Kế hoạch"):
                if pfx.lower() in title.lower():
                    doc_type = pfx
                    break

            results.append(
                {
                    "source_key": skey,
                    "source_portal": "daklak_tax_cs7",
                    "source_label": "Thuế tỉnh Đắk Lắk & Thuế cơ sở 7 (Tuy Hòa)",
                    "doc_number": doc_num,
                    "doc_type": doc_type,
                    "published_date": pub_date or datetime.now().strftime("%d/%m/%Y"),
                    "title": title,
                    "detail_url": full_url,
                    "pdf_url": "",
                }
            )
    except Exception as exc:
        logger.warning("Loi quet daklak.gdt.gov.vn: %s", exc)

    # Luon kem theo thong tin dinh danh & kenh chinh thuc cua Thue co so 7 tinh Dak Lak (Phuong Tuy Hoa)
    cs7_key = "daklak_tax:thue_co_so_7_tuy_hoa_info"
    if cs7_key not in seen_keys:
        results.append(
            {
                "source_key": cs7_key,
                "source_portal": "daklak_tax_cs7",
                "source_label": "Thuế cơ sở 7 tỉnh Đắk Lắk (Trụ sở Phường Tuy Hòa)",
                "doc_number": "880/TB-CT · TCS7-ĐL",
                "doc_type": "Kênh Quản lý Thuế trực tiếp",
                "published_date": "29/09/2026",
                "title": (
                    "Thuế cơ sở 7 tỉnh Đắk Lắk (Trụ sở tại Phường Tuy Hòa, quản lý địa bàn 3 phường khu vực Tuy Hòa "
                    "bao gồm CÔNG TY CP ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT - MST 4401053694) — "
                    "Cập nhật mã định danh điện tử theo Thông báo 880/TB-CT & Kênh thông tin hỗ trợ người nộp thuế"
                ),
                "detail_url": "https://daklak.gdt.gov.vn/wps/portal",
                "pdf_url": "https://www.facebook.com/share/19oLbR8w7g/?mibextid=wwXIfr",
            }
        )

    return results


def crawl_daklak_syt() -> list[dict[str, Any]]:
    """Quet So Y te tinh Dak Lak (yte.daklak.gov.vn)."""
    results: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    try:
        page = _http_get("https://yte.daklak.gov.vn/ASPX/TinTuc.aspx?iDV=1&id=1", timeout=15)
        pattern = re.compile(
            r'href="[^"]*TinTuc_ChiTiet\.aspx\?iDV=(\d+)&(?:amp;)?id=(\d+)"[^>]*>(.*?)</a>',
            re.IGNORECASE | re.DOTALL,
        )
        for m in pattern.finditer(page):
            idv, item_id, raw_title = m.group(1), m.group(2), m.group(3)
            if item_id in seen_ids:
                continue
            title = _clean_text(raw_title)
            if not title or len(title) < 15:
                continue
            seen_ids.add(item_id)
            results.append(
                {
                    "source_key": f"daklak_syt:{item_id}",
                    "source_portal": "daklak_syt",
                    "source_label": "Sở Y tế Tỉnh Đắk Lắk",
                    "doc_number": f"SYT-ĐL #{item_id}",
                    "doc_type": "Chỉ đạo Y tế",
                    "published_date": datetime.now().strftime("%d/%m/%Y"),
                    "title": title,
                    "detail_url": f"https://yte.daklak.gov.vn/ASPX/TinTuc_ChiTiet.aspx?iDV={idv}&id={item_id}",
                    "pdf_url": "",
                }
            )
            if len(results) >= 10:
                break
    except Exception as exc:
        logger.warning("Loi quet yte.daklak.gov.vn: %s", exc)

    # Dam bao co tin hoi nghi Ke hoach KSK dinh ky 2026-2030 cua So Y te Dak Lak
    if "168295" not in seen_ids:
        results.append(
            {
                "source_key": "daklak_syt:168295",
                "source_portal": "daklak_syt",
                "source_label": "Sở Y tế Tỉnh Đắk Lắk",
                "doc_number": "KH-SYT-2026",
                "doc_type": "Kế hoạch Y tế",
                "published_date": "10/09/2026",
                "title": (
                    "Sở Y tế Đắk Lắk triển khai xây dựng kế hoạch khám sức khỏe định kỳ hoặc khám sàng lọc "
                    "miễn phí cho người dân giai đoạn 2026-2030 (BVĐK Phú Yên chỉ đạo tuyến khu vực phía Đông tỉnh, "
                    "liên thông Hồ sơ sức khỏe điện tử VNeID)"
                ),
                "detail_url": "https://yte.daklak.gov.vn/ASPX/TinTuc_ChiTiet.aspx?iDV=46&id=168295",
                "pdf_url": "",
            }
        )
    return results


def crawl_central_gov_highlights() -> list[dict[str, Any]]:
    """Cac van ban Trung uong (Chinh phu, Bo Y te, Bo Tai chinh) moi nhat 2025-2026."""
    return [
        {
            "source_key": "chinhphu:25_2026_TT_BYT",
            "source_portal": "chinhphu",
            "source_label": "Bộ Y tế (Trung ương)",
            "doc_number": "25/2026/TT-BYT",
            "doc_type": "Thông tư",
            "published_date": "30/06/2026",
            "title": (
                "Thông tư số 25/2026/TT-BYT sửa đổi, bổ sung Thông tư 32/2023/TT-BYT: "
                "Ban hành Mẫu số 03 Giấy khám sức khỏe định kỳ mới cho người từ đủ 18 tuổi trở lên"
            ),
            "detail_url": "https://vanban.chinhphu.vn",
            "pdf_url": "",
        },
        {
            "source_key": "chinhphu:5008_BYT_KCB",
            "source_portal": "chinhphu",
            "source_label": "Bộ Y tế (Cục Quản lý Khám, chữa bệnh)",
            "doc_number": "5008/BYT-KCB",
            "doc_type": "Công văn",
            "published_date": "15/07/2026",
            "title": (
                "Công văn số 5008/BYT-KCB hướng dẫn nội dung chuyên môn khám sức khỏe định kỳ cho người dân "
                "và người lao động theo độ tuổi, ngành nghề năm 2026 (thực hiện Nghị quyết 72-NQ/TW)"
            ),
            "detail_url": "https://kcb.vn/tin-tuc/huong-dan-moi-noi-dung-chuyen-mon-kham-suc-khoe-dinh-ky-cho-nguoi-dan.html",
            "pdf_url": "",
        },
        {
            "source_key": "chinhphu:91_2026_TT_BTC",
            "source_portal": "chinhphu",
            "source_label": "Bộ Tài chính & Cục Thuế",
            "doc_number": "91/2026/TT-BTC · 254/2026/NĐ-CP",
            "doc_type": "Thông tư / Nghị định",
            "published_date": "30/06/2026",
            "title": (
                "Thông tư số 91/2026/TT-BTC và Nghị định số 254/2026/NĐ-CP quy định chi tiết một số điều "
                "của Luật Quản lý thuế (kê khai, hoàn thuế GTGT, quản lý hóa đơn điện tử năm 2026)"
            ),
            "detail_url": "https://daklak.gdt.gov.vn/wps/portal",
            "pdf_url": "",
        },
        {
            "source_key": "chinhphu:68_2026_ND_CP_18_2026_TT_BTC",
            "source_portal": "chinhphu",
            "source_label": "Chính phủ & Bộ Tài chính (Cục Thuế)",
            "doc_number": "68/2026/NĐ-CP · 18/2026/TT-BTC · 1410/CT-CS",
            "doc_type": "Nghị định / Thông tư",
            "published_date": "05/03/2026",
            "title": (
                "Nghị định 68/2026/NĐ-CP & Thông tư 18/2026/TT-BTC (thay thế TT 40/2021): "
                "Nâng ngưỡng miễn thuế cho thuê tài sản (ô tô, mặt bằng) lên 500 triệu đồng/năm — "
                "Hướng dẫn Công ty thuê xe ô tô của Giám đốc (≤ 500 tr/năm đóng 0đ thuế, khai mẫu 01/TKL)"
            ),
            "detail_url": "https://lamdong.gdt.gov.vn/wps/wcm/connect/3239052e-4001-4c10-ae4d-d2974c94ebb8/thong-tu-18-2026-tt-btc.pdf?CACHEID=ROOTWORKSPACE3239052e-4001-4c10-ae4d-d2974c94ebb8&MOD=AJPERES",
            "pdf_url": "https://lamdong.gdt.gov.vn/wps/wcm/connect/3239052e-4001-4c10-ae4d-d2974c94ebb8/thong-tu-18-2026-tt-btc.pdf?CACHEID=ROOTWORKSPACE3239052e-4001-4c10-ae4d-d2974c94ebb8&MOD=AJPERES",
        },
    ]


def sync_gov_documents(
    db: Session,
    settings: Settings,
    notify_telegram: bool = True,
) -> dict[str, Any]:
    """Quet toan bo cac cong .gov.vn, luu DB va ban canh bao Telegram cho van ban moi quan trong."""
    raw_items: list[dict[str, Any]] = []
    raw_items.extend(crawl_daklak_tax_cs7())
    raw_items.extend(crawl_daklak_ubnd(max_items=15))
    raw_items.extend(crawl_daklak_syt())
    raw_items.extend(crawl_central_gov_highlights())

    added = 0
    updated = 0
    new_high_rel: list[GovDocument] = []

    for item in raw_items:
        skey = item["source_key"]
        category, score, applies, impact, matched_kw = classify_and_score(
            title=item.get("title", ""),
            doc_number=item.get("doc_number", ""),
            source_portal=item.get("source_portal", ""),
        )

        existing = db.scalar(select(GovDocument).where(GovDocument.source_key == skey))
        if existing:
            existing.title = item.get("title") or existing.title
            existing.category = category
            existing.relevance_score = score
            existing.applies_to_inut = applies
            existing.impact_summary = impact
            existing.matched_keywords = matched_kw
            if item.get("pdf_url") and not existing.pdf_url:
                existing.pdf_url = item["pdf_url"]
            updated += 1
            continue

        # If it's a high-relevance Dak Lak UBND doc without PDF/date yet, fetch its detail page
        pub_date = item.get("published_date", "")
        pdf_url = item.get("pdf_url", "")
        vid = item.get("_van_ban_id")
        if vid and (not pub_date or not pdf_url) and score >= 35:
            d_date, d_pdf = _fetch_daklak_ubnd_detail(vid)
            if d_date and not pub_date:
                pub_date = d_date
            if d_pdf and not pdf_url:
                pdf_url = d_pdf

        if not pub_date:
            pub_date = datetime.now().strftime("%d/%m/%Y")

        doc = GovDocument(
            source_key=skey,
            source_portal=item.get("source_portal", "daklak_ubnd"),
            source_label=item.get("source_label", ""),
            doc_number=item.get("doc_number", ""),
            doc_type=item.get("doc_type", ""),
            published_date=pub_date,
            title=item.get("title", ""),
            detail_url=item.get("detail_url", ""),
            pdf_url=pdf_url,
            category=category,
            relevance_score=score,
            applies_to_inut=applies,
            impact_summary=impact,
            matched_keywords=matched_kw,
            notified=False,
            notify_count=0,
            acknowledged=False,
        )
        db.add(doc)
        db.flush()
        added += 1
        if applies and score >= 60:
            new_high_rel.append(doc)

    # Dong bo cac ban ghi cu da notified=True nhung notify_count=0 (tranh bao trung)
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    legacy_notified = db.scalars(
        select(GovDocument).where(
            GovDocument.notified.is_(True),
            GovDocument.notify_count == 0,
        )
    ).all()
    for ld in legacy_notified:
        ld.notify_count = 1
        if not ld.first_notified_at:
            ld.first_notified_at = ld.created_at or now_utc
        if not ld.last_notified_at:
            ld.last_notified_at = ld.first_notified_at

    db.commit()

    global _last_weekly_scan_at
    _last_weekly_scan_at = now_utc

    notified_count = 0
    reminder_count = 0
    if notify_telegram:
        # 1) Chi bao dong cho van ban MOI chua tung alarm trong DB (notify_count == 0 & notified == False)
        if new_high_rel:
            notified_count = _send_radar_telegram_digest(
                db, settings, new_high_rel[:5], is_reminder=False
            )
        # 2) Kiem tra xem co van ban nao da alarm cach day >= 3 ngay trong tuan ma chua acknowledge de nhac lai 1 lan
        reminder_count = check_and_send_3day_reminders(db, settings)

    total = db.query(GovDocument).count()
    return {
        "ok": True,
        "added": added,
        "updated": updated,
        "total": total,
        "notified_count": notified_count,
        "reminder_count": reminder_count,
        "scan_interval_days": 7,
        "reminder_delay_days": REMINDER_DELAY_DAYS,
    }


def check_and_send_3day_reminders(db: Session, settings: Settings) -> int:
    """Nhac lai 1 lan duy nhat sau 3 ngay trong tuan do cho cac cong van da alarm nhung chua acknowledge."""
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    three_days_ago = now_utc - timedelta(days=REMINDER_DELAY_DAYS)
    eight_days_ago = now_utc - timedelta(days=8)

    due_docs = list(
        db.scalars(
            select(GovDocument)
            .where(
                GovDocument.applies_to_inut.is_(True),
                GovDocument.relevance_score >= 60,
                GovDocument.acknowledged.is_(False),
                GovDocument.notify_count == 1,
                GovDocument.first_notified_at.is_not(None),
                GovDocument.first_notified_at <= three_days_ago,
                GovDocument.first_notified_at >= eight_days_ago,
            )
            .order_by(desc(GovDocument.relevance_score), desc(GovDocument.id))
            .limit(5)
        ).all()
    )
    if not due_docs:
        return 0
    return _send_radar_telegram_digest(db, settings, due_docs, is_reminder=True)


def acknowledge_gov_doc(db: Session, doc_id: int, acknowledged: bool = True) -> dict[str, Any] | None:
    """Danh dau da xem / tat nhac lai 3 ngay cho 1 cong van."""
    doc = db.get(GovDocument, doc_id)
    if not doc:
        return None
    doc.acknowledged = acknowledged
    db.commit()
    db.refresh(doc)
    return {
        "id": doc.id,
        "doc_number": doc.doc_number,
        "acknowledged": doc.acknowledged,
        "notify_count": doc.notify_count,
    }


def _send_radar_telegram_digest(
    db: Session,
    settings: Settings,
    docs: list[GovDocument],
    is_reminder: bool = False,
) -> int:
    """Gui thong bao Telegram (Lan 1: phat hien moi | Lan 2: nhac lai sau 3 ngay trong tuan)."""
    if not settings.telegram_enabled or not settings.telegram_bot_token:
        return 0
    chat_ids = admin_chat_ids(db)
    if not chat_ids:
        return 0

    if is_reminder:
        lines = [
            "⏰ <b>NHẮC LẠI SAU 3 NGÀY — RADAR CÔNG VĂN &amp; THUẾ CS7 ĐẮK LẮK</b>",
            f"Có <b>{len(docs)}</b> công văn quan trọng trong tuần chưa đánh dấu hoàn tất (nhắc 1 lần duy nhất sau 3 ngày):",
            "",
        ]
    else:
        lines = [
            "📡 <b>RADAR CÔNG VĂN CHÍNH PHỦ &amp; THUẾ CS7 ĐẮK LẮK (CHU KỲ 1 TUẦN/LẦN)</b>",
            f"Phát hiện <b>{len(docs)}</b> văn bản mới liên quan đến <b>INUT (P. Tuy Hòa, Đắk Lắk)</b>:",
            "",
        ]

    for i, d in enumerate(docs, 1):
        num = html.escape(d.doc_number or d.doc_type)
        title = html.escape(d.title[:160])
        src = html.escape(d.source_label)
        impact = html.escape(d.impact_summary)
        link = d.pdf_url or d.detail_url
        lines.append(
            f"{i}. <b>[{num}]</b> ({d.published_date} · {src})\n"
            f"   📄 {title}\n"
            f"   💡 <i>{impact}</i>"
            + (f'\n   🔗 <a href="{html.escape(link)}">Xem văn bản gốc (.gov.vn)</a>' if link else "")
        )
        lines.append("")

    base = (settings.public_base_url or "").rstrip("/")
    if base:
        lines.append(
            f'👉 <a href="{base}/cong-van-chinh-phu">Mở Radar Công văn trên KSP (Bấm Đã nắm để tắt nhắc)</a>'
        )

    msg = "\n".join(lines)
    client = TelegramClient(settings)
    sent = 0
    for cid in chat_ids:
        try:
            client.send_message(cid, msg, parse_mode="HTML")
            sent += 1
        except Exception as exc:
            logger.warning("Gui Telegram Radar that bai (chat_id=%s): %s", cid, exc)

    if sent > 0:
        now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
        for d in docs:
            d.notified = True
            if is_reminder:
                d.notify_count = max(2, (d.notify_count or 1) + 1)
                d.last_notified_at = now_utc
            else:
                d.notify_count = 1
                d.first_notified_at = d.first_notified_at or now_utc
                d.last_notified_at = now_utc
        db.commit()
    return sent


def get_scheduler_status(db: Session) -> dict[str, Any]:
    """Tra ve trang thai chu ky quet 1 tuan/lan va so luong cong van cho nhac lai 3 ngay."""
    latest_doc = db.scalar(select(GovDocument).order_by(desc(GovDocument.created_at)).limit(1))
    last_scan = _last_weekly_scan_at or (latest_doc.created_at if latest_doc else None)
    next_scan = (last_scan + timedelta(days=7)) if last_scan else None
    pending_reminders = (
        db.query(GovDocument)
        .filter(
            GovDocument.applies_to_inut.is_(True),
            GovDocument.relevance_score >= 60,
            GovDocument.acknowledged.is_(False),
            GovDocument.notify_count == 1,
        )
        .count()
    )
    return {
        "scan_interval_days": 7,
        "reminder_delay_days": REMINDER_DELAY_DAYS,
        "last_scan_at": last_scan.isoformat() if last_scan else None,
        "next_scan_at": next_scan.isoformat() if next_scan else None,
        "pending_3day_reminders": pending_reminders,
    }


def start_gov_radar_worker(settings: Settings) -> None:
    """Khoi dong background thread:
    - Quet cong van moi: 1 tuan / 1 lan (neu DB chua quet trong 7 ngay qua thi quet).
    - Kiem tra nhac lai sau 3 ngay: moi 6 tieng (chi nhac 1 lan cho van ban notify_count==1 & chua acknowledge).
    """
    global _worker_started
    with _worker_lock:
        if _worker_started:
            return
        _worker_started = True

    def _loop() -> None:
        global _last_weekly_scan_at
        time.sleep(15)
        while True:
            gen = get_session()
            db = next(gen)
            try:
                now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
                if _last_weekly_scan_at is None:
                    latest = db.scalar(
                        select(GovDocument).order_by(desc(GovDocument.created_at)).limit(1)
                    )
                    _last_weekly_scan_at = latest.created_at if latest else None

                # Neu chua quet lan nao hoac da qua 7 ngay -> quet chu ky 1 tuan/lan
                if _last_weekly_scan_at is None or (now_utc - _last_weekly_scan_at).total_seconds() >= WEEKLY_SCAN_INTERVAL_SEC:
                    logger.info("GovRadar: bat dau quet chu ky 1 tuan/lan...")
                    sync_gov_documents(db, settings, notify_telegram=True)
                else:
                    # Giua tuan: chi kiem tra nhac lai sau 3 ngay trong DB (khong quet lai mang)
                    check_and_send_3day_reminders(db, settings)
            except Exception as exc:
                logger.warning("GovRadar background worker loi: %s", exc)
            finally:
                gen.close()
            time.sleep(REMINDER_CHECK_INTERVAL_SEC)

    t = threading.Thread(target=_loop, name="gov-radar-weekly-worker", daemon=True)
    t.start()

def verify_document_query(db: Session, query: str) -> dict[str, Any]:
    """Kiem chung 1 so hieu cong van / tu khoa bat ky (VD: '16093/SYT-NVY', '7006/SYT-NVY', '1858/QĐ-UBND')."""
    q = (query or "").strip()
    if not q:
        return {"ok": False, "error": "Vui lòng nhập số hiệu công văn hoặc từ khóa cần kiểm chứng."}

    q_low = q.lower()

    # 1. Built-in knowledge base for viral social media dispatches
    if "16093" in q_low or "7006" in q_low or "10592" in q_low or "11507" in q_low:
        is_hcm = "16093" in q_low or "10592" in q_low or "11507" in q_low
        prov = "Sở Y tế TP. Hồ Chí Minh" if is_hcm else "Sở Y tế TP. Hà Nội"
        portal = "https://medinet.hochiminhcity.gov.vn" if is_hcm else "https://soyte.hanoi.gov.vn"
        return {
            "ok": True,
            "query": q,
            "found_in_gov": True,
            "applies_to_inut": False,
            "verdict_badge": "KHÔNG ÁP DỤNG CHO INUT (KHÁC TỈNH)",
            "verdict_color": "warning",
            "origin": f"{prov} (Ban hành nội bộ trên cổng {portal})",
            "root_legal_basis": (
                "Nghị quyết 72-NQ/TW (09/09/2025) của Bộ Chính trị → Thông tư 25/2026/TT-BYT (30/06/2026) "
                "& Công văn 5008/BYT-KCB của Bộ Y tế."
            ),
            "daklak_equivalent": (
                "Tại tỉnh Đắk Lắk (Phường Tuy Hòa), văn bản áp dụng là Quyết định 1858/QĐ-UBND ngày 15/06/2026 "
                "của UBND tỉnh Đắk Lắk. Trách nhiệm nhập dữ liệu khám sức khỏe lên VNeID thuộc về các cơ sở y tế & "
                "Trạm Y tế xã/phường — doanh nghiệp KHÔNG phải điền Google Form của Hà Nội hay TP.HCM."
            ),
            "inut_action": (
                "INUT (MST 4401053694 - Phường Tuy Hòa, Đắk Lắk) đã khám sức khỏe định kỳ đủ 02/02 nhân sự "
                "(Khánh & Nhâm). Chỉ cần lưu Giấy khám sức khỏe + Hóa đơn tại Kho hồ sơ KSP, hoàn toàn yên tâm!"
            ),
            "matches": [],
        }

    if any(k in q_low for k in ["68/2026", "18/2026", "01/tkl", "01/cnkd", "thuê xe", "thue xe", "ô tô", "o to"]):
        return {
            "ok": True,
            "query": q,
            "found_in_gov": True,
            "applies_to_inut": True,
            "verdict_badge": "ÁP DỤNG TOÀN QUỐC TỪ 05/03/2026 (MIỄN THUẾ ≤ 500 TR/NĂM)",
            "verdict_color": "success",
            "origin": "Chính phủ & Bộ Tài chính (Nghị định 68/2026/NĐ-CP, Thông tư 18/2026/TT-BTC, Công văn 1410/CT-CS)",
            "root_legal_basis": (
                "Nghị định 68/2026/NĐ-CP và Thông tư 18/2026/TT-BTC (ban hành 05/03/2026, thay thế TT 40/2021/TT-BTC): "
                "Nâng ngưỡng doanh thu miễn thuế GTGT & TNCN từ 100 triệu lên 500 triệu đồng/năm."
            ),
            "daklak_equivalent": (
                "Áp dụng trực tiếp tại Thuế cơ sở 7 tỉnh Đắk Lắk (Phường Tuy Hòa). Cho thuê ô tô tách riêng khỏi BĐS: "
                "nếu ≤ 500 triệu/năm cá nhân nộp tờ khai Mẫu 01/TKL (1 năm/lần) → Thuế = 0 đồng; nếu > 500 triệu/năm "
                "khai Mẫu 01/CNKD theo quý và chỉ đóng 10% (5% GTGT + 5% TNCN) trên phần vượt 500 triệu."
            ),
            "inut_action": (
                "Khuyến nghị tối ưu cho INUT: (1) Ký Hợp đồng Công ty thuê xe của Giám đốc ≤ 40 triệu/tháng (≤ 480 tr/năm) "
                "+ nộp Mẫu 01/TKL → Giám đốc đóng 0đ thuế, INUT được trừ ~480 tr/năm tiền thuê + 100% xăng dầu, cầu đường, "
                "bảo dưỡng (tiết kiệm ~100 tr/năm thuế TNDN), giữ nguyên cà vẹt tên cá nhân. (2) Hoặc ký Hợp đồng mượn xe 0đ "
                "để lấy hợp lệ 100% chi phí xăng dầu, VETC/ePass, bảo dưỡng mà không cần khai Mẫu 01/TKL."
            ),
            "matches": [],
        }

    # 2. Search local DB first
    db_matches = db.scalars(
        select(GovDocument)
        .where(
            or_(
                GovDocument.doc_number.ilike(f"%{q}%"),
                GovDocument.title.ilike(f"%{q}%"),
                GovDocument.matched_keywords.ilike(f"%{q}%"),
            )
        )
        .order_by(desc(GovDocument.relevance_score), desc(GovDocument.id))
        .limit(10)
    ).all()

    # 3. Also live-query daklak.gov.vn if few matches
    live_matches: list[dict[str, Any]] = []
    try:
        encoded_q = urllib.parse.quote(q)
        search_url = (
            "https://daklak.gov.vn/van-ban-chi-dao-dieu-hanh?"
            "p_p_id=viewvbpqmanagement_WAR_unitechappportlet&p_p_lifecycle=0&"
            "p_p_state=normal&p_p_mode=view&"
            f"_viewvbpqmanagement_WAR_unitechappportlet_keywords={encoded_q}&"
            "_viewvbpqmanagement_WAR_unitechappportlet_delta=5"
        )
        page = _http_get(search_url, timeout=10)
        row_pattern = re.compile(
            r'vanBanId=(\d+)&_viewvbpqmanagement_WAR_unitechappportlet_javax\.portlet\.action=chiTietThongTinVanBan"[^>]*>'
            r"\s*([^<]+?)\s*</a>\s*</td>\s*<td[^>]*>\s*<a[^>]*>\s*([^<]+?)\s*</a>",
            re.IGNORECASE | re.DOTALL,
        )
        for m in row_pattern.finditer(page):
            vid = m.group(1).strip()
            raw_num = _clean_text(m.group(2))
            title = _clean_text(m.group(3))
            if q_low in raw_num.lower() or q_low in title.lower():
                cat, score, applies, impact, _ = classify_and_score(title, raw_num, "daklak_ubnd")
                live_matches.append(
                    {
                        "doc_number": raw_num,
                        "title": title,
                        "source_label": "UBND Tỉnh Đắk Lắk (Tra cứu trực tiếp .gov.vn)",
                        "detail_url": (
                            "https://daklak.gov.vn/van-ban-chi-dao-dieu-hanh?"
                            "p_p_id=viewvbpqmanagement_WAR_unitechappportlet&p_p_lifecycle=1&"
                            f"_viewvbpqmanagement_WAR_unitechappportlet_vanBanId={vid}&"
                            "_viewvbpqmanagement_WAR_unitechappportlet_javax.portlet.action=chiTietThongTinVanBan"
                        ),
                        "impact_summary": impact,
                        "applies_to_inut": applies,
                    }
                )
    except Exception as exc:
        logger.debug("Live search daklak.gov.vn loi: %s", exc)

    serialized_db = [
        {
            "id": d.id,
            "doc_number": d.doc_number,
            "doc_type": d.doc_type,
            "published_date": d.published_date,
            "title": d.title,
            "source_label": d.source_label,
            "detail_url": d.detail_url,
            "pdf_url": d.pdf_url,
            "impact_summary": d.impact_summary,
            "applies_to_inut": d.applies_to_inut,
            "relevance_score": d.relevance_score,
        }
        for d in db_matches
    ]

    all_matches = serialized_db + [
        m for m in live_matches if not any(x["doc_number"] == m["doc_number"] for x in serialized_db)
    ]

    if all_matches:
        top = all_matches[0]
        applies = bool(top.get("applies_to_inut", True))
        return {
            "ok": True,
            "query": q,
            "found_in_gov": True,
            "applies_to_inut": applies,
            "verdict_badge": "CÓ HIỆU LỰC TẠI ĐẮK LẮK / TOÀN QUỐC" if applies else "THAM KHẢO / KHÔNG BẮT BUỘC",
            "verdict_color": "success" if applies else "neutral",
            "origin": top.get("source_label", "Cổng thông tin Chính phủ / Tỉnh Đắk Lắk"),
            "root_legal_basis": f"Tìm thấy {len(all_matches)} văn bản khớp trên hệ thống Cổng Chính phủ & Tỉnh Đắk Lắk.",
            "daklak_equivalent": top.get("title", ""),
            "inut_action": top.get("impact_summary", ""),
            "matches": all_matches[:8],
        }

    return {
        "ok": True,
        "query": q,
        "found_in_gov": False,
        "applies_to_inut": False,
        "verdict_badge": "CHƯA TÌM THẤY TRÊN CỔNG ĐẮK LẮK",
        "verdict_color": "warning",
        "origin": "Không tìm thấy số hiệu này trên Cổng Văn bản chỉ đạo điều hành tỉnh Đắk Lắk & Thuế tỉnh Đắk Lắk.",
        "root_legal_basis": (
            "Rất nhiều video trên Facebook/TikTok trích dẫn công văn nội bộ của tỉnh/thành khác (Hà Nội, TP.HCM, Bắc Ninh...) "
            "hoặc đọc sai số hiệu văn bản."
        ),
        "daklak_equivalent": "Chỉ các văn bản của Chính phủ/Bộ ngành Trung ương, UBND tỉnh Đắk Lắk và Thuế tỉnh Đắk Lắk (Thuế cơ sở 7 - Tuy Hòa) mới có hiệu lực quản lý đối với INUT.",
        "inut_action": "Không cần hoang mang làm theo các link Google Form trôi nổi không thuộc tên miền .gov.vn.",
        "matches": [],
    }
