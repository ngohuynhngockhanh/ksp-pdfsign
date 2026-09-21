"""Nghiep vu So huu tri tue: Tra cuu nhan hieu, theo doi thoi han gia han va du toan chi phi.

Co so phap ly:
- Dieu 93 Luat So huu tri tue Viet Nam: Hieu luc van bang bao ho nhan hieu la 10 nam
  ke tu ngay nop don. Co the gia han nhieu lan lien tiep, moi lan 10 nam.
  Don yeu cau gia han phai nop trong vong 6 thang truoc ngay het han. Co the nop muon
  trong thoi han an han 6 thang ke tu ngay het han nhung phai nop them phi gia han muon.
- Thong tu 263/2016/TT-BTC & Thong tu 63/2023/TT-BTC: Bieu muc phi, le phi so huu cong nghiep.
"""
from __future__ import annotations

import calendar
import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from bs4 import BeautifulSoup
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import storage
from .db import IpTrademark

logger = logging.getLogger(__name__)

WIPO_BASE_URL = "https://wipopublish.ipvietnam.gov.vn"
WIPO_SEARCH_URL = f"{WIPO_BASE_URL}/wopublish-search/public/trademarks"
WIPO_DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
}

# 5 nhan hieu chuan cua Cong ty Co phan Dau tu va Phat trien Cong nghe INUT (MST: 4401053694)
INUT_BENCHMARK_TRADEMARKS = [
    {
        "application_number": "VN-4-2019-43953",
        "application_id": "VN4201943953",
        "registration_number": "4-0405854-000",
        "mark_name": "iNut",
        "owner_name": "Công ty cổ phần đầu tư và phát triển công nghệ INUT",
        "owner_address": "Số 161/2 đường Trương Phước Phan, Khu phố 1, Phường Bình Trị Đông, Quận Bình Tân, TP. Hồ Chí Minh",
        "filing_date": "04.11.2019",
        "publication_date": "27.01.2020",
        "grant_date": "09.12.2021",
        "nice_classes": "9, 42",
        "goods_services": (
            "Nhóm 09: Phần mềm máy tính; Thiết bị kết nối Internet vạn vật (IoT); Thiết bị viễn thông; "
            "Bộ điều khiển lập trình được; Cảm biến và công tắc điện tử thông minh.\n"
            "Nhóm 42: Nghiên cứu, thiết kế và phát triển phần mềm máy tính; Dịch vụ điện toán đám mây (Cloud IoT); "
            "Tư vấn công nghệ thông tin và tự động hóa."
        ),
        "status": "Cấp bằng",
        "colors": "Đỏ, trắng, xanh dương",
        "mark_type": "Combined",
        "remote_logo_url": (
            f"{WIPO_BASE_URL}/wopublish-search/service/trademarks/application/VN4201943953/thumbnail?noLogo=true&disclaimer=Combined"
        ),
    },
    {
        "application_number": "VN-4-2019-43954",
        "application_id": "VN4201943954",
        "registration_number": "4-0405855-000",
        "mark_name": "iNutPlatform",
        "owner_name": "Công ty cổ phần đầu tư và phát triển công nghệ INUT",
        "owner_address": "Số 161/2 đường Trương Phước Phan, Khu phố 1, Phường Bình Trị Đông, Quận Bình Tân, TP. Hồ Chí Minh",
        "filing_date": "04.11.2019",
        "publication_date": "25.01.2022",
        "grant_date": "09.12.2021",
        "nice_classes": "9, 42",
        "goods_services": (
            "Nhóm 09: Nền tảng điều hành IoT; Bộ thu phát dữ liệu không dây; Phần mềm quản lý thiết bị công nghiệp; "
            "Module truyền thông mạng.\n"
            "Nhóm 42: Dịch vụ nền tảng dưới dạng dịch vụ (PaaS) cho IoT; Lưu trữ dữ liệu đám mây; Giám sát hệ thống từ xa."
        ),
        "status": "Cấp bằng",
        "colors": "Xanh dương, trắng",
        "mark_type": "Combined",
        "remote_logo_url": (
            f"{WIPO_BASE_URL}/wopublish-search/service/trademarks/application/VN4201943954/thumbnail?noLogo=true&disclaimer=Combined"
        ),
    },
    {
        "application_number": "VN-4-2019-43955",
        "application_id": "VN4201943955",
        "registration_number": "4-0405856-000",
        "mark_name": "iNutDoor",
        "owner_name": "Công ty cổ phần đầu tư và phát triển công nghệ INUT",
        "owner_address": "Số 161/2 đường Trương Phước Phan, Khu phố 1, Phường Bình Trị Đông, Quận Bình Tân, TP. Hồ Chí Minh",
        "filing_date": "04.11.2019",
        "publication_date": "25.01.2022",
        "grant_date": "09.12.2021",
        "nice_classes": "9, 42",
        "goods_services": (
            "Nhóm 09: Khóa cửa điện tử thông minh; Thiết bị điều khiển cửa cuốn từ xa qua mạng internet; "
            "Cảm biến an ninh cửa ra vào.\n"
            "Nhóm 42: Dịch vụ đám mây quản lý kiểm soát ra vào; Phát triển ứng dụng di động điều khiển cửa thông minh."
        ),
        "status": "Cấp bằng",
        "colors": "Xanh lá, trắng, xám",
        "mark_type": "Combined",
        "remote_logo_url": (
            f"{WIPO_BASE_URL}/wopublish-search/service/trademarks/application/VN4201943955/thumbnail?noLogo=true&disclaimer=Combined"
        ),
    },
    {
        "application_number": "VN-4-2019-48905",
        "application_id": "VN4201948905",
        "registration_number": "4-0440677-000",
        "mark_name": "iNutMuro",
        "owner_name": "Công ty cổ phần đầu tư và phát triển công nghệ INUT",
        "owner_address": "Số 161/2 đường Trương Phước Phan, Khu phố 1, Phường Bình Trị Đông, Quận Bình Tân, TP. Hồ Chí Minh",
        "filing_date": "02.12.2019",
        "publication_date": "25.02.2020",
        "grant_date": "06.10.2022",
        "nice_classes": "9, 42",
        "goods_services": (
            "Nhóm 09: Công tắc cảm ứng âm tường thông minh; Ổ cắm điện tử điều khiển từ xa; Bảng điều khiển nhà thông minh; "
            "Rơle và cảm biến tự động hóa.\n"
            "Nhóm 42: Dịch vụ tích hợp hệ thống nhà thông minh (Smart Home); Thiết kế mạch phần cứng và firmware nhúng."
        ),
        "status": "Cấp bằng",
        "colors": "Đen, xanh neon, trắng",
        "mark_type": "Combined",
        "remote_logo_url": (
            f"{WIPO_BASE_URL}/wopublish-search/service/trademarks/application/VN4201948905/thumbnail?noLogo=true&disclaimer=Combined"
        ),
    },
    {
        "application_number": "VN-4-2019-48906",
        "application_id": "VN4201948906",
        "registration_number": "",
        "mark_name": "iNutNebi",
        "owner_name": "Công ty cổ phần đầu tư và phát triển công nghệ INUT",
        "owner_address": "Số 161/2 đường Trương Phước Phan, Khu phố 1, Phường Bình Trị Đông, Quận Bình Tân, TP. Hồ Chí Minh",
        "filing_date": "02.12.2019",
        "publication_date": "25.02.2020",
        "grant_date": "",
        "nice_classes": "9, 42",
        "goods_services": (
            "Nhóm 09: Hệ thống cảm biến vi khí hậu; Thiết bị tưới tiêu nông nghiệp thông minh; Bộ điều khiển phun sương tự động.\n"
            "Nhóm 42: Dịch vụ phân tích dữ liệu cảm biến nông nghiệp công nghệ cao; Nghiên cứu giải pháp IoT nông nghiệp."
        ),
        "status": "Từ chối",
        "colors": "Cam, xanh lam, trắng",
        "mark_type": "Combined",
        "remote_logo_url": (
            f"{WIPO_BASE_URL}/wopublish-search/service/trademarks/application/VN4201948906/thumbnail?noLogo=true&disclaimer=Combined"
        ),
    },
]


def parse_date(date_str: str) -> Optional[date]:
    """Parse chuoi ngay thang theo cac dinh dang pho bien o Viet Nam."""
    if not date_str or not date_str.strip():
        return None
    s = date_str.strip()
    patterns = [
        ("%d.%m.%Y", r"^\d{1,2}\.\d{1,2}\.\d{4}$"),
        ("%d/%m/%Y", r"^\d{1,2}/\d{1,2}/\d{4}$"),
        ("%Y-%m-%d", r"^\d{4}-\d{1,2}-\d{1,2}$"),
        ("%Y.%m.%d", r"^\d{4}\.\d{1,2}\.\d{1,2}$"),
    ]
    for fmt, regex in patterns:
        if re.match(regex, s):
            try:
                return datetime.strptime(s, fmt).date()
            except ValueError:
                continue
    return None


def format_date_vn(d: Optional[date]) -> str:
    if not d:
        return ""
    return d.strftime("%d/%m/%Y")


def add_years(d: date, years: int) -> date:
    """Them N nam, xu ly an toan nam nhuan 29/02."""
    try:
        return d.replace(year=d.year + years)
    except ValueError:
        return d.replace(year=d.year + years, day=28)


def add_months(d: date, months: int) -> date:
    """Them/bot N thang, giu ngay hop le trong thang."""
    y = d.year
    m = d.month + months
    while m > 12:
        m -= 12
        y += 1
    while m < 1:
        m += 12
        y -= 1
    max_day = calendar.monthrange(y, m)[1]
    return date(y, m, min(d.day, max_day))


def calculate_trademark_validity(
    filing_date_str: str,
    grant_date_str: str = "",
    today: Optional[date] = None,
) -> Dict[str, Any]:
    """Tinh toan thoi han hieu luc nhan hieu theo Dieu 93 Luat So huu tri tue.

    - Hieu luc: 10 nam ke tu ngay nop don.
    - Khung nop don gia han: 6 thang truoc ngay het han.
    - Thoi han an han nop muon: 6 thang sau ngay het han (kem phi nop muon).
    """
    if today is None:
        today = date.today()

    f_date = parse_date(filing_date_str)
    g_date = parse_date(grant_date_str)

    if not f_date:
        return {
            "filing_date": filing_date_str,
            "grant_date": grant_date_str,
            "expiry_date": "",
            "renewal_window_start": "",
            "grace_period_end": "",
            "days_remaining": 0,
            "time_remaining_formatted": "Chưa rõ ngày nộp đơn",
            "phase": "unknown",
            "phase_label": "Chưa xác định",
            "is_renewable_now": False,
        }

    # Hieu luc 10 nam tu ngay nop don
    expiry_date = add_years(f_date, 10)
    # Khung nop don gia han mo truoc 6 thang
    renewal_window_start = add_months(expiry_date, -6)
    # An han nop muon den 6 thang sau ngay het han
    grace_period_end = add_months(expiry_date, 6)

    days_remaining = (expiry_date - today).days

    if today < renewal_window_start:
        phase = "active"
        phase_label = "Đang có hiệu lực"
        is_renewable_now = False
    elif renewal_window_start <= today <= expiry_date:
        phase = "in_renewal_window"
        phase_label = "Đang trong kỳ gia hạn (trước 6 tháng)"
        is_renewable_now = True
    elif expiry_date < today <= grace_period_end:
        phase = "in_grace_period"
        phase_label = "Quá hạn (Đang trong ân hạn 6 tháng)"
        is_renewable_now = True
    else:
        phase = "expired"
        phase_label = "Đã hết hiệu lực"
        is_renewable_now = False

    # Format chuoi thoi gian truc quan
    if days_remaining > 0:
        years = days_remaining // 365
        rem = days_remaining % 365
        months = rem // 30
        rem_days = rem % 30
        parts = []
        if years > 0:
            parts.append(f"{years} năm")
        if months > 0:
            parts.append(f"{months} tháng")
        if rem_days > 0 or not parts:
            parts.append(f"{rem_days} ngày")
        time_remaining_formatted = f"Còn {' '.join(parts)} ({days_remaining:,} ngày)"
    elif days_remaining == 0:
        time_remaining_formatted = "Hôm nay là ngày hết hạn hiệu lực"
    else:
        days_past = abs(days_remaining)
        if today <= grace_period_end:
            time_remaining_formatted = f"Quá hạn {days_past} ngày (Còn trong ân hạn)"
        else:
            time_remaining_formatted = f"Đã hết hiệu lực {days_past} ngày"

    return {
        "filing_date": format_date_vn(f_date),
        "grant_date": format_date_vn(g_date),
        "expiry_date": format_date_vn(expiry_date),
        "renewal_window_start": format_date_vn(renewal_window_start),
        "grace_period_end": format_date_vn(grace_period_end),
        "days_remaining": days_remaining,
        "time_remaining_formatted": time_remaining_formatted,
        "phase": phase,
        "phase_label": phase_label,
        "is_renewable_now": is_renewable_now,
    }


def calculate_renewal_fees(
    nice_classes_str: str,
    is_late: bool = False,
    late_months: int = 0,
) -> Dict[str, Any]:
    """Boc tach du toan le phi gia han nhan hieu theo Thong tu 263/2016/TT-BTC & 63/2023/TT-BTC.

    Co cau phi:
    1. Le phi gia han hieu luc VBBH: 100.000d / nhom
    2. Phi su dung van bang bao ho (10 nam): 250.000d cho nhom dau + 150.000d cho moi nhom tiep theo
    3. Phi tham dinh yeu cau gia han: 160.000d / van bang
    4. Phi cong bo thong tin gia han: 120.000d / don
    5. Phi dang ba thong tin gia han: 120.000d / van bang
    6. Phi nop muon (neu co): 10% le phi gia han moi thang muon (10.000d * so nhom * so thang)

    Voi nhan hieu 2 nhom (vi du Nhom 9 & Nhom 42 cua INUT):
    - Le phi gia han: 200.000d
    - Phi su dung VBBH: 250.000d + 150.000d = 400.000d
    - Phi tham dinh: 160.000d
    - Phi cong bo: 120.000d
    - Phi dang ba: 120.000d
    => Tong cong: dung 1.000.000 VNĐ.
    """
    raw_classes = [
        c.strip()
        for c in nice_classes_str.replace(";", ",").split(",")
        if c.strip()
    ]
    num_classes = max(1, len(raw_classes))

    # 1. Le phi gia han
    extension_fee = 100_000 * num_classes

    # 2. Phi su dung VBBH (10 nam)
    if num_classes == 1:
        usage_fee = 250_000
    else:
        usage_fee = 250_000 + (num_classes - 1) * 150_000

    # 3. Phi tham dinh yeu cau gia han
    examination_fee = 160_000

    # 4. Phi cong bo thong tin gia han
    publication_fee = 120_000

    # 5. Phi dang ba thong tin gia han
    registration_fee = 120_000

    items = [
        {
            "code": "EXTENSION_FEE",
            "name": "Lệ phí gia hạn hiệu lực văn bằng bảo hộ",
            "amount": float(extension_fee),
            "note": f"100.000 đ × {num_classes} nhóm Nice ({', '.join(raw_classes) if raw_classes else '1 nhóm'})",
        },
        {
            "code": "USAGE_FEE",
            "name": "Phí sử dụng văn bằng bảo hộ (duy trì hiệu lực 10 năm)",
            "amount": float(usage_fee),
            "note": (
                f"250.000 đ nhóm đầu + 150.000 đ × {num_classes - 1} nhóm tiếp theo"
                if num_classes > 1
                else "250.000 đ / 1 nhóm"
            ),
        },
        {
            "code": "EXAMINATION_FEE",
            "name": "Phí thẩm định yêu cầu gia hạn",
            "amount": float(examination_fee),
            "note": "160.000 đ / 1 văn bằng",
        },
        {
            "code": "PUBLICATION_FEE",
            "name": "Phí công bố quyết định gia hạn",
            "amount": float(publication_fee),
            "note": "120.000 đ / 1 đơn",
        },
        {
            "code": "REGISTRATION_FEE",
            "name": "Phí đăng bạ thông tin gia hạn",
            "amount": float(registration_fee),
            "note": "120.000 đ / 1 văn bằng",
        },
    ]

    # 6. Phi gia han muon neu nop trong 6 thang an han
    late_fee = 0.0
    if is_late and late_months > 0:
        capped_months = min(6, max(1, late_months))
        late_fee = 100_000 * num_classes * 0.10 * capped_months
        items.append({
            "code": "LATE_PENALTY_FEE",
            "name": f"Lệ phí gia hạn muộn ({capped_months} tháng quá hạn)",
            "amount": float(late_fee),
            "note": f"10% lệ phí gia hạn × {num_classes} nhóm × {capped_months} tháng muộn",
        })

    total = sum(item["amount"] for item in items)

    return {
        "num_classes": num_classes,
        "classes": raw_classes,
        "is_late": is_late,
        "late_months": late_months,
        "items": items,
        "total_amount": total,
        "total_formatted": f"{int(total):,} VNĐ",
    }


def download_and_store_logo(
    application_id: str,
    remote_url: str,
    client: Optional[httpx.Client] = None,
) -> Optional[str]:
    """Tai anh logo tu Cong Cuc SHTT va luu vao KSP Storage noi bo."""
    if not remote_url:
        return None
    try:
        if client:
            resp = client.get(remote_url, timeout=15.0)
        else:
            with httpx.Client(
                headers=WIPO_DEFAULT_HEADERS,
                timeout=15.0,
                verify=False,
                follow_redirects=True,
            ) as c:
                resp = c.get(remote_url)
        if resp.status_code == 200 and len(resp.content) > 100:
            doc_id = storage.save_upload(resp.content, suffix=".jpg")
            logger.info("Da luu logo %s vao doc_id=%s (%d bytes)", application_id, doc_id, len(resp.content))
            return doc_id
    except Exception as e:
        logger.warning("Loi khi tai logo %s tu %s: %s", application_id, remote_url, e)
    return None


def parse_wipo_html(html_text: str) -> List[Dict[str, Any]]:
    """Trich xuat danh sach nhan hieu tu ma nguon HTML cua WIPO Publish."""
    soup = BeautifulSoup(html_text, "html.parser")
    rows = soup.select("table.ui-responsive tbody tr") or soup.select("table tbody tr")
    results = []

    for row in rows:
        tds = row.select("td")
        if len(tds) < 8:
            continue

        # Column mapping from table:
        # [0] checkbox, [1] logo sample, [2] mark_name, [3] app_number,
        # [4] filing_date, [5] publication_date, [6] reg_number, [7] grant_date,
        # [8] owner_name, [9] nice_classes, [10] status
        mark_name = tds[2].get_text(strip=True) if len(tds) > 2 else ""
        app_number = tds[3].get_text(strip=True) if len(tds) > 3 else ""
        filing_date = tds[4].get_text(strip=True) if len(tds) > 4 else ""
        pub_date = tds[5].get_text(strip=True) if len(tds) > 5 else ""
        reg_number = tds[6].get_text(strip=True) if len(tds) > 6 else ""
        grant_date = tds[7].get_text(strip=True) if len(tds) > 7 else ""
        owner_name = tds[8].get_text(strip=True) if len(tds) > 8 else ""
        nice_classes = tds[9].get_text(strip=True) if len(tds) > 9 else ""
        status = tds[10].get_text(strip=True) if len(tds) > 10 else ""

        if not app_number and not mark_name:
            continue

        # Tim thumbnail img va detail link
        img = row.select_one("img")
        thumbnail_url = img["src"] if img and img.has_attr("src") else ""

        detail_a = row.select_one("a[href*='detail/trademarks']")
        detail_url = ""
        app_id = ""
        if detail_a and detail_a.has_attr("href"):
            href = detail_a["href"]
            if href.startswith("./"):
                detail_url = f"{WIPO_BASE_URL}/wopublish-search/public/{href[2:]}"
            elif href.startswith("/"):
                detail_url = f"{WIPO_BASE_URL}{href}"
            else:
                detail_url = href
            # Parse id=VN4201943955
            m = re.search(r"id=([A-Za-z0-9]+)", href)
            if m:
                app_id = m.group(1)

        if not app_id and app_number:
            app_id = re.sub(r"[^A-Za-z0-9]", "", app_number)

        if not thumbnail_url and app_id:
            thumbnail_url = (
                f"{WIPO_BASE_URL}/wopublish-search/service/trademarks/application/{app_id}/thumbnail?noLogo=true&disclaimer=Combined"
            )

        validity = calculate_trademark_validity(filing_date, grant_date)
        fees = calculate_renewal_fees(nice_classes)

        results.append({
            "application_number": app_number,
            "application_id": app_id,
            "mark_name": mark_name,
            "registration_number": reg_number,
            "filing_date": filing_date,
            "publication_date": pub_date,
            "grant_date": grant_date,
            "owner_name": owner_name,
            "nice_classes": nice_classes,
            "status": status,
            "thumbnail_url": thumbnail_url,
            "detail_url": detail_url,
            "validity": validity,
            "fee_breakdown": fees,
        })

    return results


def search_wipo_trademarks(
    query: str = "APNA:(INUT)",
    client: Optional[httpx.Client] = None,
) -> List[Dict[str, Any]]:
    """Gửi truy vấn tìm kiếm tới Cổng Cục SHTT / WIPO Publish."""
    params = {"query": query}
    try:
        if client:
            resp = client.get(
                WIPO_SEARCH_URL,
                params=params,
                headers=WIPO_DEFAULT_HEADERS,
                timeout=20.0,
                follow_redirects=True,
            )
        else:
            with httpx.Client(
                headers=WIPO_DEFAULT_HEADERS,
                timeout=20.0,
                verify=False,
                follow_redirects=True,
            ) as c:
                resp = c.get(WIPO_SEARCH_URL, params=params)

        if resp.status_code == 200:
            return parse_wipo_html(resp.text)
        logger.warning("WIPO tra cuu tra ve status_code=%d", resp.status_code)
    except Exception as e:
        logger.error("Loi khi ket noi toi Cong Cuc SHTT WIPO: %s", e)
    return []


def seed_inut_trademarks(db: Session) -> int:
    """Khoi tao tap du lieu mac dinh gom 5 don nhan hieu cua INUT neu CSDL trong."""
    count = db.scalar(select(IpTrademark.id).limit(1))
    if count is not None:
        return 0

    inserted = 0
    for item in INUT_BENCHMARK_TRADEMARKS:
        validity = calculate_trademark_validity(item["filing_date"], item["grant_date"])
        tm = IpTrademark(
            application_number=item["application_number"],
            application_id=item["application_id"],
            registration_number=item["registration_number"],
            mark_name=item["mark_name"],
            owner_name=item["owner_name"],
            owner_address=item["owner_address"],
            filing_date=item["filing_date"],
            publication_date=item["publication_date"],
            grant_date=item["grant_date"],
            expiry_date=validity["expiry_date"],
            renewal_window_start=validity["renewal_window_start"],
            nice_classes=item["nice_classes"],
            goods_services=item["goods_services"],
            status=item["status"],
            colors=item["colors"],
            mark_type=item["mark_type"],
            remote_logo_url=item["remote_logo_url"],
            logo_doc_id="",
            logo_suffix=".jpg",
        )
        db.add(tm)
        inserted += 1

    db.commit()
    logger.info("Da seed thanh cong %d nhan hieu INUT vao CSDL ip_trademarks", inserted)
    return inserted


def sync_trademarks_from_wipo(
    db: Session,
    query: str = "APNA:(INUT)",
    download_logos: bool = True,
) -> Dict[str, Any]:
    """Dong bo danh sach nhan hieu tu Cong Cuc SHTT va cap nhat CSDL KSP."""
    wipo_items = search_wipo_trademarks(query=query)

    # Neu WIPO tam thoi khong ket noi duoc va DB con trong -> fallback seed
    if not wipo_items:
        existing_count = db.query(IpTrademark).count()
        if existing_count == 0:
            seed_inut_trademarks(db)
            existing_count = db.query(IpTrademark).count()
        return {
            "ok": True,
            "synced_count": 0,
            "total_in_db": existing_count,
            "message": "Không kết nối được Cổng Cục SHTT, đã sử dụng dữ liệu lưu trữ nội bộ KSP.",
        }

    synced = 0
    with httpx.Client(headers=WIPO_DEFAULT_HEADERS, timeout=15.0, verify=False, follow_redirects=True) as client:
        for item in wipo_items:
            app_no = item["application_number"]
            tm = db.scalar(select(IpTrademark).where(IpTrademark.application_number == app_no))
            if not tm:
                tm = IpTrademark(application_number=app_no)
                db.add(tm)

            tm.application_id = item["application_id"]
            tm.mark_name = item["mark_name"]
            tm.registration_number = item["registration_number"]
            tm.filing_date = item["filing_date"]
            tm.publication_date = item["publication_date"]
            tm.grant_date = item["grant_date"]
            tm.owner_name = item["owner_name"] or tm.owner_name or "Công ty cổ phần đầu tư và phát triển công nghệ INUT"
            tm.nice_classes = item["nice_classes"]
            tm.status = item["status"]
            tm.remote_logo_url = item["thumbnail_url"]

            validity = calculate_trademark_validity(item["filing_date"], item["grant_date"])
            tm.expiry_date = validity["expiry_date"]
            tm.renewal_window_start = validity["renewal_window_start"]

            # Neu chua co logo_doc_id hoac yeu cau tai lai
            if download_logos and item["thumbnail_url"] and not tm.logo_doc_id:
                doc_id = download_and_store_logo(item["application_id"], item["thumbnail_url"], client=client)
                if doc_id:
                    tm.logo_doc_id = doc_id

            synced += 1

        db.commit()

    total_in_db = db.query(IpTrademark).count()
    return {
        "ok": True,
        "synced_count": synced,
        "total_in_db": total_in_db,
        "message": f"Đã đồng bộ thành công {synced} nhãn hiệu từ Cục Sở hữu trí tuệ.",
    }


def trademark_to_dict(tm: IpTrademark) -> Dict[str, Any]:
    """Chuyen doi ban ghi IpTrademark sang dict kem du toan le phi va countdown."""
    validity = calculate_trademark_validity(tm.filing_date, tm.grant_date)
    fees = calculate_renewal_fees(
        tm.nice_classes or "",
        is_late=(validity["phase"] == "in_grace_period"),
        late_months=max(0, (validity["days_remaining"] * -1) // 30) if validity["phase"] == "in_grace_period" else 0,
    )
    return {
        "id": tm.id,
        "application_number": tm.application_number,
        "application_id": tm.application_id,
        "registration_number": tm.registration_number,
        "mark_name": tm.mark_name,
        "owner_name": tm.owner_name,
        "owner_address": tm.owner_address,
        "filing_date": tm.filing_date,
        "publication_date": tm.publication_date,
        "grant_date": tm.grant_date,
        "expiry_date": tm.expiry_date or validity["expiry_date"],
        "nice_classes": tm.nice_classes,
        "goods_services": tm.goods_services,
        "status": tm.status,
        "colors": tm.colors,
        "mark_type": tm.mark_type,
        "remote_logo_url": tm.remote_logo_url,
        "logo_doc_id": tm.logo_doc_id,
        "logo_suffix": tm.logo_suffix,
        "renewal_window_start": tm.renewal_window_start or validity["renewal_window_start"],
        "created_at": tm.created_at.isoformat() if tm.created_at else None,
        "updated_at": tm.updated_at.isoformat() if tm.updated_at else None,
        "validity": validity,
        "fee_breakdown": fees,
    }
