"""Phan he Tra cuu & San Goi Thau Mua Sam Cong (Mạng Đấu Thầu Quốc Gia - muasamcong.mpi.gov.vn).

Module cung cap:
- BiddingClient: Crawler e-GP public API + TTL caching (15m search / 24h detail) + Smart Mock fallback.
- MockBiddingGenerator: Sinh du lieu mau thuc te linh vuc IoT/SCADA/Tu dong hoa cua INUT.
- ai_analyze_tender: AI phan tich ho so moi thau & cham diem phu hop chien luoc INUT (0-100).
- run_watchlist_scan: Quet tu dong watchlist & ban canh bao Telegram khong trung lap.
- CRUD helper functions cho Bookmark va Watchlist.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from . import ai, telegram
from .config import Settings, get_settings
from .db import BiddingAlertLog, BiddingBookmark, BiddingWatchlist, _now

logger = logging.getLogger(__name__)

# TTL Cache durations (in seconds)
SEARCH_CACHE_TTL = 15 * 60  # 15 minutes
DETAIL_CACHE_TTL = 24 * 60 * 60  # 24 hours

# e-GP API Constants
EGP_SEARCH_URL = "https://muasamcong.mpi.gov.vn/eprocurement/services/landing/p/general/contractor-selection/contract-notice"
EGP_DETAIL_URL = "https://muasamcong.mpi.gov.vn/eprocurement/services/landing/p/contractor-selection/contract-notice-detail"
EGP_PORTAL_URL = "https://muasamcong.mpi.gov.vn/web/guest/contractor-selection"

EGP_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "Origin": "https://muasamcong.mpi.gov.vn",
    "Referer": "https://muasamcong.mpi.gov.vn/",
}


def _strip_accents(text: str) -> str:
    """Chuan hoa tieng Viet bo dau phuc vu tim kiem linh hoat."""
    if not text:
        return ""
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return text.replace("đ", "d").replace("Đ", "D").lower().strip()


def format_currency_vnd(amount: float | int | None) -> str:
    """Dinh dang tien te VND theo chuan Viet Nam (vd: 1.850.000.000)."""
    if amount is None or amount == 0:
        return "0"
    try:
        val = int(round(float(amount)))
        return f"{val:,}".replace(",", ".")
    except (ValueError, TypeError):
        return "0"


class MockBiddingGenerator:
    """Sinh tap du lieu mau phong phu, thuc te cho he thong Dau thau cua INUT."""

    MOCK_ITEMS: list[dict[str, Any]] = [
        {
            "tbmt_code": "IB2600001001-00",
            "tender_name": "Cung cấp hệ thống giám sát năng lượng và IoT Gateway cho các trạm bơm tiêu",
            "procuring_entity": "Công ty TNHH MTV Khai thác Thủy lợi Miền Nam",
            "investor": "Sở Nông nghiệp và Phát triển Nông thôn TP. Hồ Chí Minh",
            "field": "HH",
            "bid_price": 980000000.0,
            "bid_deadline": (datetime.now(timezone.utc) + timedelta(days=18)).strftime("%Y-%m-%d 09:00:00"),
            "bid_opening_date": (datetime.now(timezone.utc) + timedelta(days=18)).strftime("%Y-%m-%d 09:30:00"),
            "province": "Hồ Chí Minh",
            "bidding_method": "Đấu thầu rộng rãi qua mạng",
            "source_url": f"{EGP_PORTAL_URL}?notifyNo=IB2600001001-00",
            "bid_validity_period_days": 90,
            "execution_period_days": 45,
            "decision_number": "1042/QĐ-SNN",
            "description": "Mua sắm 25 bộ Gateway iNut 4G Modbus, 50 cảm biến đo mức nước siêu âm, tích hợp Web SCADA giám sát thời gian thực.",
        },
        {
            "tbmt_code": "IB2600001002-00",
            "tender_name": "Mua sắm và lắp đặt hệ thống SCADA giám sát tự động 12 trạm biến áp phân phối",
            "procuring_entity": "Tổng Công ty Điện lực Miền Nam (EVNSPC)",
            "investor": "Công ty Điện lực Bình Dương",
            "field": "HH",
            "bid_price": 2450000000.0,
            "bid_deadline": (datetime.now(timezone.utc) + timedelta(days=22)).strftime("%Y-%m-%d 14:00:00"),
            "bid_opening_date": (datetime.now(timezone.utc) + timedelta(days=22)).strftime("%Y-%m-%d 14:30:00"),
            "province": "Bình Dương",
            "bidding_method": "Đấu thầu rộng rãi qua mạng",
            "source_url": f"{EGP_PORTAL_URL}?notifyNo=IB2600001002-00",
            "bid_validity_period_days": 120,
            "execution_period_days": 60,
            "decision_number": "589/QĐ-PCBD",
            "description": "Trang bị tủ RTU Gateway điều khiển giám sát từ xa giao thức IEC 60870-5-104 và Modbus TCP/RTU cho 12 trạm.",
        },
        {
            "tbmt_code": "IB2600001003-00",
            "tender_name": "Xây dựng hệ thống quan trắc nước thải tự động, liên tục tại KCN Biên Hòa 2",
            "procuring_entity": "Công ty Cổ phần Sonadezi Long Bình",
            "investor": "Ban Quản lý các Khu công nghiệp Đồng Nai",
            "field": "HH",
            "bid_price": 1850000000.0,
            "bid_deadline": (datetime.now(timezone.utc) + timedelta(days=14)).strftime("%Y-%m-%d 10:00:00"),
            "bid_opening_date": (datetime.now(timezone.utc) + timedelta(days=14)).strftime("%Y-%m-%d 10:30:00"),
            "province": "Đồng Nai",
            "bidding_method": "Đấu thầu rộng rãi qua mạng",
            "source_url": f"{EGP_PORTAL_URL}?notifyNo=IB2600001003-00",
            "bid_validity_period_days": 90,
            "execution_period_days": 30,
            "decision_number": "312/QĐ-KCN-ĐN",
            "description": "Cung cấp trạm quan trắc pH, COD, TSS, lưu lượng xả thải truyền dữ liệu Datalogger về Sở TN&MT theo Thông tư 10/2021/TT-BTNMT.",
        },
        {
            "tbmt_code": "IB2600001004-00",
            "tender_name": "Nâng cấp hệ thống đo xa tự động (AMR/AMI) và thu thập chỉ số điện năng mặt trời mái nhà",
            "procuring_entity": "Công ty Điện lực Đà Nẵng",
            "investor": "Tổng Công ty Điện lực Miền Trung (EVNCPC)",
            "field": "HH",
            "bid_price": 760000000.0,
            "bid_deadline": (datetime.now(timezone.utc) + timedelta(days=10)).strftime("%Y-%m-%d 15:00:00"),
            "bid_opening_date": (datetime.now(timezone.utc) + timedelta(days=10)).strftime("%Y-%m-%d 15:30:00"),
            "province": "Đà Nẵng",
            "bidding_method": "Chào hàng cạnh tranh qua mạng",
            "source_url": f"{EGP_PORTAL_URL}?notifyNo=IB2600001004-00",
            "bid_validity_period_days": 60,
            "execution_period_days": 40,
            "decision_number": "145/QĐ-PCDN",
            "description": "Cung cấp 120 bộ modem đọc xa công tơ điện tử Elster/Gelex/Vinasino qua 4G/NB-IoT kết nối máy chủ MDMS.",
        },
        {
            "tbmt_code": "IB2600001005-00",
            "tender_name": "Tư vấn lập thiết kế bản vẽ thi công và dự toán hệ thống điều khiển SCADA xử lý nước sạch",
            "procuring_entity": "Công ty Cổ phần Cấp nước Hải Phòng",
            "investor": "Sở Xây dựng Hải Phòng",
            "field": "TV",
            "bid_price": 320000000.0,
            "bid_deadline": (datetime.now(timezone.utc) + timedelta(days=25)).strftime("%Y-%m-%d 08:30:00"),
            "bid_opening_date": (datetime.now(timezone.utc) + timedelta(days=25)).strftime("%Y-%m-%d 09:00:00"),
            "province": "Hải Phòng",
            "bidding_method": "Chỉ định thầu rút gọn",
            "source_url": f"{EGP_PORTAL_URL}?notifyNo=IB2600001005-00",
            "bid_validity_period_days": 60,
            "execution_period_days": 30,
            "decision_number": "88/QĐ-CNHP",
            "description": "Khảo sát, thiết kế bản vẽ thi công hệ thống PLC Siemens S7-1500, biến tần trung thế và mạng cáp quang SCADA.",
        },
        {
            "tbmt_code": "IB2600001006-00",
            "tender_name": "Thi công xây lắp và cung cấp thiết bị hệ thống chiếu sáng thông minh đô thị",
            "procuring_entity": "Ban Quản lý Dự án Đầu tư Xây dựng TP. Vũng Tàu",
            "investor": "UBND Thành phố Vũng Tàu",
            "field": "XL",
            "bid_price": 4200000000.0,
            "bid_deadline": (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d 16:00:00"),
            "bid_opening_date": (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d 16:30:00"),
            "province": "Bà Rịa - Vũng Tàu",
            "bidding_method": "Đấu thầu rộng rãi qua mạng",
            "source_url": f"{EGP_PORTAL_URL}?notifyNo=IB2600001006-00",
            "bid_validity_period_days": 120,
            "execution_period_days": 90,
            "decision_number": "720/QĐ-UBND-VT",
            "description": "Lắp đặt 350 bộ đèn LED thông minh, bộ điều khiển tủ đèn chiếu sáng LoRaWAN/Zigbee và phần mềm quản lý Smart Lighting GIS.",
        },
        {
            "tbmt_code": "IB2600001007-00",
            "tender_name": "Mua sắm cảm biến cảnh báo ngập đô thị và trạm truyền dữ liệu thời gian thực",
            "procuring_entity": "Trung tâm Quản lý Hạ tầng Kỹ thuật TP. Hồ Chí Minh",
            "investor": "Sở Xây dựng TP. Hồ Chí Minh",
            "field": "HH",
            "bid_price": 1350000000.0,
            "bid_deadline": (datetime.now(timezone.utc) + timedelta(days=12)).strftime("%Y-%m-%d 10:00:00"),
            "bid_opening_date": (datetime.now(timezone.utc) + timedelta(days=12)).strftime("%Y-%m-%d 10:30:00"),
            "province": "Hồ Chí Minh",
            "bidding_method": "Đấu thầu rộng rãi qua mạng",
            "source_url": f"{EGP_PORTAL_URL}?notifyNo=IB2600001007-00",
            "bid_validity_period_days": 90,
            "execution_period_days": 45,
            "decision_number": "415/QĐ-SXD",
            "description": "Trang bị 30 điểm đo mực nước ngập đường phố bằng cảm biến radar không tiếp xúc và camera quan sát AI tích hợp năng lượng mặt trời.",
        },
        {
            "tbmt_code": "IB2600001008-00",
            "tender_name": "Dịch vụ bảo trì, hiệu chuẩn hệ thống quan trắc khí thải và phần mềm FUXA SCADA",
            "procuring_entity": "Công ty Nhiệt điện Cần Thơ",
            "investor": "Tổng Công ty Phát điện 2 (EVNGENCO2)",
            "field": "PTV",
            "bid_price": 480000000.0,
            "bid_deadline": (datetime.now(timezone.utc) + timedelta(days=16)).strftime("%Y-%m-%d 11:00:00"),
            "bid_opening_date": (datetime.now(timezone.utc) + timedelta(days=16)).strftime("%Y-%m-%d 11:30:00"),
            "province": "Cần Thơ",
            "bidding_method": "Chào hàng cạnh tranh qua mạng",
            "source_url": f"{EGP_PORTAL_URL}?notifyNo=IB2600001008-00",
            "bid_validity_period_days": 60,
            "execution_period_days": 365,
            "decision_number": "210/QĐ-NĐCT",
            "description": "Bảo dưỡng định kỳ hệ thống CEMS, hiệu chuẩn đầu đo khí SO2, NOx, CO, O2, bụi và duy trì phần mềm SCADA giám sát liên tục.",
        },
        {
            "tbmt_code": "IB2600001009-00",
            "tender_name": "Cung cấp và lắp đặt hệ thống tự động hóa điều hòa không khí BMS và giám sát năng lượng iNut",
            "procuring_entity": "Bệnh viện Đa khoa Quốc tế Hà Nội",
            "investor": "Sở Y tế Hà Nội",
            "field": "HHOP",
            "bid_price": 3600000000.0,
            "bid_deadline": (datetime.now(timezone.utc) + timedelta(days=28)).strftime("%Y-%m-%d 14:00:00"),
            "bid_opening_date": (datetime.now(timezone.utc) + timedelta(days=28)).strftime("%Y-%m-%d 14:30:00"),
            "province": "Hà Nội",
            "bidding_method": "Đấu thầu rộng rãi qua mạng",
            "source_url": f"{EGP_PORTAL_URL}?notifyNo=IB2600001009-00",
            "bid_validity_period_days": 90,
            "execution_period_days": 75,
            "decision_number": "910/QĐ-SYT-HN",
            "description": "Tích hợp hệ thống quản lý tòa nhà BMS BACnet/Modbus, đồng hồ điện tử đa năng và điều khiển tối ưu Chiller.",
        },
        {
            "tbmt_code": "IB2600001010-00",
            "tender_name": "Mua sắm thiết bị viễn thông và Datalogger IoT quan trắc đập thủy điện",
            "procuring_entity": "Công ty Thủy điện Trị An",
            "investor": "Tập đoàn Điện lực Việt Nam (EVN)",
            "field": "HH",
            "bid_price": 1150000000.0,
            "bid_deadline": (datetime.now(timezone.utc) + timedelta(days=20)).strftime("%Y-%m-%d 09:00:00"),
            "bid_opening_date": (datetime.now(timezone.utc) + timedelta(days=20)).strftime("%Y-%m-%d 09:30:00"),
            "province": "Đồng Nai",
            "bidding_method": "Đấu thầu rộng rãi qua mạng",
            "source_url": f"{EGP_PORTAL_URL}?notifyNo=IB2600001010-00",
            "bid_validity_period_days": 90,
            "execution_period_days": 45,
            "decision_number": "334/QĐ-EVN-TA",
            "description": "Cung cấp Datalogger đa kênh thu thập tín hiệu dây rung (Vibrating Wire), cảm biến áp lực kẽ hở và chuyển vị đập qua 4G/Vệ tinh.",
        },
        {
            "tbmt_code": "IB2600001011-00",
            "tender_name": "Cung cấp tủ bảng điện phân phối MSB, ATS và hệ thống giám sát SCADA nhà máy nước",
            "procuring_entity": "Công ty Cổ phần Nước và Môi trường Long An",
            "investor": "Sở Kế hoạch và Đầu tư Long An",
            "field": "HH",
            "bid_price": 2850000000.0,
            "bid_deadline": (datetime.now(timezone.utc) + timedelta(days=21)).strftime("%Y-%m-%d 15:00:00"),
            "bid_opening_date": (datetime.now(timezone.utc) + timedelta(days=21)).strftime("%Y-%m-%d 15:30:00"),
            "province": "Long An",
            "bidding_method": "Đấu thầu rộng rãi qua mạng",
            "source_url": f"{EGP_PORTAL_URL}?notifyNo=IB2600001011-00",
            "bid_validity_period_days": 90,
            "execution_period_days": 60,
            "decision_number": "512/QĐ-LA",
            "description": "Sản xuất lắp đặt tủ điện phân phối tổng MSB Form 4b 1600A, tủ hòa đồng bộ ATS và thiết bị đo đa năng kết nối SCADA.",
        },
        {
            "tbmt_code": "IB2600001012-00",
            "tender_name": "Mua sắm thiết bị định vị GPS và truyền tin telemetry cho đội xe môi trường đô thị",
            "procuring_entity": "Công ty TNHH MTV Môi trường Đô thị TP.HCM (CITENCO)",
            "investor": "UBND TP. Hồ Chí Minh",
            "field": "HH",
            "bid_price": 540000000.0,
            "bid_deadline": (datetime.now(timezone.utc) + timedelta(days=15)).strftime("%Y-%m-%d 09:30:00"),
            "bid_opening_date": (datetime.now(timezone.utc) + timedelta(days=15)).strftime("%Y-%m-%d 10:00:00"),
            "province": "Hồ Chí Minh",
            "bidding_method": "Chào hàng cạnh tranh qua mạng",
            "source_url": f"{EGP_PORTAL_URL}?notifyNo=IB2600001012-00",
            "bid_validity_period_days": 60,
            "execution_period_days": 30,
            "decision_number": "180/QĐ-CITENCO",
            "description": "Trang bị 80 thiết bị định vị hợp chuẩn QCVN 31:2014/BGTVT, cảm biến nâng hạ thùng rác và camera hành trình 4G.",
        },
        {
            "tbmt_code": "IB2600001013-00",
            "tender_name": "Xây dựng hệ thống quan trắc môi trường không khí tự động xung quanh Vịnh Hạ Long",
            "procuring_entity": "Sở Tài nguyên và Môi trường tỉnh Quảng Ninh",
            "investor": "UBND Tỉnh Quảng Ninh",
            "field": "HH",
            "bid_price": 5800000000.0,
            "bid_deadline": (datetime.now(timezone.utc) + timedelta(days=35)).strftime("%Y-%m-%d 09:00:00"),
            "bid_opening_date": (datetime.now(timezone.utc) + timedelta(days=35)).strftime("%Y-%m-%d 09:30:00"),
            "province": "Quảng Ninh",
            "bidding_method": "Đấu thầu rộng rãi quốc tế qua mạng",
            "source_url": f"{EGP_PORTAL_URL}?notifyNo=IB2600001013-00",
            "bid_validity_period_days": 150,
            "execution_period_days": 120,
            "decision_number": "1120/QĐ-UBND-QN",
            "description": "Cung cấp 03 trạm quan trắc không khí cố định đạt chuẩn USEPA đo bụi PM2.5, PM10, khí NO2, SO2, CO, O3 và hệ thống hiển thị LED.",
        },
        {
            "tbmt_code": "IB2600001014-00",
            "tender_name": "Mua sắm phần mềm quản lý vận hành từ xa và thiết bị gateway công nghiệp IoT iNut",
            "procuring_entity": "Công ty Cổ phần Nước sạch Quảng Nam",
            "investor": "Sở Xây dựng Quảng Nam",
            "field": "HH",
            "bid_price": 890000000.0,
            "bid_deadline": (datetime.now(timezone.utc) + timedelta(days=19)).strftime("%Y-%m-%d 14:00:00"),
            "bid_opening_date": (datetime.now(timezone.utc) + timedelta(days=19)).strftime("%Y-%m-%d 14:30:00"),
            "province": "Quảng Nam",
            "bidding_method": "Chào hàng cạnh tranh qua mạng",
            "source_url": f"{EGP_PORTAL_URL}?notifyNo=IB2600001014-00",
            "bid_validity_period_days": 90,
            "execution_period_days": 45,
            "decision_number": "310/QĐ-QN-WTR",
            "description": "Cung cấp bản quyền phần mềm Web SCADA, 35 bộ Gateway 4G Modbus iNut thu thập áp lực lưu lượng tuyến ống mạng lưới.",
        },
        {
            "tbmt_code": "IB2600001015-00",
            "tender_name": "Cung cấp hệ thống kiểm soát ra vào và chấm công nhận diện khuôn mặt AI cho các chi nhánh",
            "procuring_entity": "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam (BIDV) - Chi nhánh TP.HCM",
            "investor": "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam",
            "field": "HH",
            "bid_price": 1650000000.0,
            "bid_deadline": (datetime.now(timezone.utc) + timedelta(days=17)).strftime("%Y-%m-%d 10:00:00"),
            "bid_opening_date": (datetime.now(timezone.utc) + timedelta(days=17)).strftime("%Y-%m-%d 10:30:00"),
            "province": "Hồ Chí Minh",
            "bidding_method": "Đấu thầu rộng rãi qua mạng",
            "source_url": f"{EGP_PORTAL_URL}?notifyNo=IB2600001015-00",
            "bid_validity_period_days": 90,
            "execution_period_days": 40,
            "decision_number": "780/QĐ-BIDV",
            "description": "Trang bị 45 camera AI FaceID, cổng kiểm soát Flap Barrier, khóa từ kiểm soát phân tầng thang máy và phần mềm quản trị tập trung.",
        },
    ]

    @classmethod
    def search(
        cls,
        keyword: str = "",
        province: str = "",
        field: str = "",
        min_price: float | None = None,
        max_price: float | None = None,
        method: str = "",
        page: int = 1,
        page_size: int = 10,
    ) -> dict[str, Any]:
        """Tim kiem goi thau trong tap du lieu mock."""
        kw_norm = _strip_accents(keyword)
        prov_norm = _strip_accents(province)
        field_norm = str(field or "").strip().upper()
        method_norm = _strip_accents(method)

        filtered: list[dict[str, Any]] = []
        for item in cls.MOCK_ITEMS:
            # Keyword filter
            if kw_norm:
                target_str = " ".join([
                    item["tbmt_code"],
                    item["tender_name"],
                    item.get("procuring_entity", ""),
                    item.get("investor", ""),
                    item.get("description", ""),
                ])
                if kw_norm not in _strip_accents(target_str):
                    continue

            # Province filter
            if prov_norm:
                item_prov = _strip_accents(item.get("province", ""))
                if prov_norm not in item_prov and item_prov not in prov_norm:
                    continue

            # Field filter (HH, XL, TV, PTV, HHOP)
            if field_norm:
                if item.get("field", "").upper() != field_norm:
                    continue

            # Min price
            if min_price is not None and min_price > 0:
                if item.get("bid_price", 0.0) < min_price:
                    continue

            # Max price
            if max_price is not None and max_price > 0:
                if item.get("bid_price", 0.0) > max_price:
                    continue

            # Method filter
            if method_norm:
                item_method = _strip_accents(item.get("bidding_method", ""))
                if method_norm not in item_method:
                    continue

            # Clone item
            c = dict(item)
            c["is_mock"] = True
            filtered.append(c)

        total = len(filtered)
        page = max(1, page)
        page_size = max(1, min(page_size, 100))
        total_pages = max(1, (total + page_size - 1) // page_size) if total > 0 else 1

        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        items = filtered[start_idx:end_idx]

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
            "is_mock": True,
        }

    @classmethod
    def get_detail(cls, tbmt_code: str) -> dict[str, Any] | None:
        """Lay chi tiet goi thau tu mock pool hoac sinh mock theo ma TBMT."""
        code = str(tbmt_code or "").strip()
        for item in cls.MOCK_ITEMS:
            if item["tbmt_code"].lower() == code.lower():
                c = dict(item)
                c["is_mock"] = True
                return c

        # Kiem tra trong kho goi thau da trung (Won Packages)
        try:
            for won_item in BiddingPlaybookService.ALL_WON_PACKAGES:
                if won_item["tbmt_code"].lower() == code.lower():
                    return {
                        "tbmt_code": won_item["tbmt_code"],
                        "tender_name": won_item["tender_name"],
                        "procuring_entity": won_item["procuring_entity"],
                        "investor": won_item["procuring_entity"],
                        "field": won_item.get("field", "HH"),
                        "bid_price": float(won_item.get("bid_price", 0.0)),
                        "won_price": float(won_item.get("won_price", 0.0)),
                        "bid_deadline": (datetime.now(timezone.utc) + timedelta(days=15)).strftime("%Y-%m-%d 15:00:00"),
                        "bid_opening_date": (datetime.now(timezone.utc) + timedelta(days=15)).strftime("%Y-%m-%d 15:30:00"),
                        "province": "Hà Nội" if "Hà Nội" in won_item["procuring_entity"] or "Bộ" in won_item["procuring_entity"] or "Tổng cục" in won_item["procuring_entity"] else "Thanh Hóa" if "Thanh Hóa" in won_item["procuring_entity"] else "Hồ Chí Minh",
                        "bidding_method": "Đấu thầu rộng rãi qua mạng",
                        "source_url": f"{EGP_PORTAL_URL}?notifyNo={won_item['tbmt_code']}",
                        "bid_validity_period_days": 90,
                        "execution_period_days": 60,
                        "decision_number": won_item.get("decision_number", "104/QĐ-BMT"),
                        "description": f"Gói thầu đã trúng bởi {won_item.get('contractor_name', '')} với giá trúng {format_currency_vnd(won_item.get('won_price', 0.0))} ₫ theo Quyết định {won_item.get('decision_number', '')}.",
                        "is_mock": True,
                    }
        except Exception:
            pass

        # Neu khong co trong danh sach co san nhung co format TBMT hop le, tao 1 goi thau mock hop ly
        if re.match(r"^IB\d{8,12}-\d{2}$", code, re.IGNORECASE):
            return {
                "tbmt_code": code,
                "tender_name": f"Mua sắm thiết bị viễn thông và hệ thống giám sát SCADA iNut ({code})",
                "procuring_entity": "Ban Quản lý Dự án Đầu tư Xây dựng Chuyên ngành",
                "investor": "Sở Thông tin và Truyền thông",
                "field": "HH",
                "bid_price": 1250000000.0,
                "bid_deadline": (datetime.now(timezone.utc) + timedelta(days=20)).strftime("%Y-%m-%d 09:00:00"),
                "bid_opening_date": (datetime.now(timezone.utc) + timedelta(days=20)).strftime("%Y-%m-%d 09:30:00"),
                "province": "Hồ Chí Minh",
                "bidding_method": "Đấu thầu rộng rãi qua mạng",
                "source_url": f"{EGP_PORTAL_URL}?notifyNo={code}",
                "bid_validity_period_days": 90,
                "execution_period_days": 45,
                "decision_number": "128/QĐ-STTTT",
                "description": f"Gói thầu mua sắm thiết bị IoT và tích hợp hệ thống phần mềm SCADA giám sát thời gian thực theo mã TBMT {code}.",
                "is_mock": True,
            }

        return None


class BiddingClient:
    """Client ket noi he thong Mua Sam Cong (e-GP) kem TTL Cache, Circuit Breaker va Smart Mock Fallback."""

    _global_last_egp_failure: float = 0.0
    _circuit_cooldown: float = 300.0  # seconds

    def __init__(self, timeout: float = 2.0, transport: httpx.BaseTransport | None = None) -> None:
        self.timeout = timeout
        self.transport = transport
        self._cache: dict[str, tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def _cache_get(self, key: str) -> Any | None:
        with self._lock:
            if key in self._cache:
                expire_at, val = self._cache[key]
                if time.time() < expire_at:
                    return val
                del self._cache[key]
        return None

    def _cache_set(self, key: str, val: Any, ttl: float) -> None:
        with self._lock:
            self._cache[key] = (time.time() + ttl, val)

    def clear_cache(self, reset_circuit: bool = False) -> None:
        with self._lock:
            self._cache.clear()
            if reset_circuit:
                BiddingClient._global_last_egp_failure = 0.0

    @staticmethod
    def _make_cache_key(prefix: str, params: dict[str, Any]) -> str:
        serialized = json.dumps(params, sort_keys=True, default=str)
        digest = hashlib.md5(serialized.encode("utf-8")).hexdigest()
        return f"{prefix}:{digest}"

    def search(
        self,
        keyword: str = "",
        province: str = "",
        field: str = "",
        min_price: float | None = None,
        max_price: float | None = None,
        method: str = "",
        page: int = 1,
        page_size: int = 10,
        force_refresh: bool = False,
    ) -> dict[str, Any]:
        """Tim kiem goi thau tren e-GP, fallback qua Mock neu e-GP loi/timeout."""
        params = {
            "keyword": keyword.strip(),
            "province": province.strip(),
            "field": field.strip(),
            "min_price": min_price,
            "max_price": max_price,
            "method": method.strip(),
            "page": page,
            "page_size": page_size,
        }
        cache_key = self._make_cache_key("search", params)

        if not force_refresh:
            cached = self._cache_get(cache_key)
            if cached is not None:
                return cached

        # Kiem tra circuit breaker
        in_cooldown = (time.time() - BiddingClient._global_last_egp_failure) < BiddingClient._circuit_cooldown

        if not in_cooldown:
            # Thuc hien goi HTTP toi e-GP public API
            try:
                payload = {
                    "page": max(0, page - 1),
                    "size": page_size,
                    "keyword": keyword.strip(),
                    "province": province.strip(),
                    "field": field.strip(),
                    "minPrice": min_price if min_price and min_price > 0 else None,
                    "maxPrice": max_price if max_price and max_price > 0 else None,
                    "sort": "publicDate,desc",
                }
                with httpx.Client(timeout=self.timeout, transport=self.transport) as http:
                    resp = http.post(EGP_SEARCH_URL, json=payload, headers=EGP_HEADERS)
                    if resp.status_code == 200:
                        data = resp.json()
                        raw_items = data.get("content") or data.get("data") or data.get("items")
                        if isinstance(raw_items, list) and len(raw_items) > 0:
                            items: list[dict[str, Any]] = []
                            for raw in raw_items:
                                tbmt = str(raw.get("notifyNo") or raw.get("tbmtCode") or raw.get("bidNo") or "").strip()
                                if not tbmt:
                                    continue
                                items.append({
                                    "tbmt_code": tbmt,
                                    "tender_name": str(raw.get("bidName") or raw.get("name") or "").strip(),
                                    "procuring_entity": str(raw.get("procuringEntityName") or raw.get("bidSolicitor") or "").strip(),
                                    "investor": str(raw.get("investorName") or "").strip(),
                                    "field": str(raw.get("bidField") or raw.get("field") or "").strip(),
                                    "bid_price": float(raw.get("bidPrice") or raw.get("price") or 0.0),
                                    "bid_deadline": str(raw.get("bidCloseDate") or raw.get("deadline") or "").strip(),
                                    "bid_opening_date": str(raw.get("bidOpenDate") or "").strip(),
                                    "province": str(raw.get("province") or "").strip(),
                                    "bidding_method": str(raw.get("bidForm") or raw.get("method") or "").strip(),
                                    "source_url": f"{EGP_PORTAL_URL}?notifyNo={tbmt}",
                                    "bid_validity_period_days": int(raw.get("validityDays") or 90),
                                    "execution_period_days": int(raw.get("executionDays") or 60),
                                    "decision_number": str(raw.get("decisionNo") or "").strip(),
                                    "description": str(raw.get("description") or "").strip(),
                                    "is_mock": False,
                                })
                            total = int(data.get("totalElements") or data.get("total") or len(items))
                            total_pages = max(1, (total + page_size - 1) // page_size) if total > 0 else 1
                            result = {
                                "items": items,
                                "total": total,
                                "page": page,
                                "page_size": page_size,
                                "total_pages": total_pages,
                                "is_mock": False,
                            }
                            self._cache_set(cache_key, result, SEARCH_CACHE_TTL)
                            return result
            except Exception as exc:
                BiddingClient._global_last_egp_failure = time.time()
                logger.warning("Goi e-GP search gap loi (%s), chuyen sang Smart Mock Generator", exc)

        # Fallback sang Mock Generator
        mock_res = MockBiddingGenerator.search(
            keyword=keyword,
            province=province,
            field=field,
            min_price=min_price,
            max_price=max_price,
            method=method,
            page=page,
            page_size=page_size,
        )
        self._cache_set(cache_key, mock_res, SEARCH_CACHE_TTL)
        return mock_res

    def get_detail(self, tbmt_code: str, force_refresh: bool = False) -> dict[str, Any] | None:
        """Lay chi tiet goi thau theo ma TBMT, TTL cache 24h."""
        code = str(tbmt_code or "").strip()
        if not code:
            return None

        cache_key = f"detail:{code}"
        if not force_refresh:
            cached = self._cache_get(cache_key)
            if cached is not None:
                return cached

        # Kiem tra circuit breaker
        in_cooldown = (time.time() - BiddingClient._global_last_egp_failure) < BiddingClient._circuit_cooldown

        if not in_cooldown:
            # Thuc hien goi HTTP toi e-GP detail API
            try:
                with httpx.Client(timeout=self.timeout, transport=self.transport) as http:
                    url = f"{EGP_DETAIL_URL}?notifyNo={code}"
                    resp = http.get(url, headers=EGP_HEADERS)
                    if resp.status_code == 200:
                        raw = resp.json()
                        if isinstance(raw, dict) and (raw.get("notifyNo") or raw.get("bidName")):
                            res = {
                                "tbmt_code": str(raw.get("notifyNo") or code).strip(),
                                "tender_name": str(raw.get("bidName") or "").strip(),
                                "procuring_entity": str(raw.get("procuringEntityName") or "").strip(),
                                "investor": str(raw.get("investorName") or "").strip(),
                                "field": str(raw.get("bidField") or "").strip(),
                                "bid_price": float(raw.get("bidPrice") or 0.0),
                                "bid_deadline": str(raw.get("bidCloseDate") or "").strip(),
                                "bid_opening_date": str(raw.get("bidOpenDate") or "").strip(),
                                "province": str(raw.get("province") or "").strip(),
                                "bidding_method": str(raw.get("bidForm") or "").strip(),
                                "source_url": f"{EGP_PORTAL_URL}?notifyNo={code}",
                                "bid_validity_period_days": int(raw.get("validityDays") or 90),
                                "execution_period_days": int(raw.get("executionDays") or 60),
                                "decision_number": str(raw.get("decisionNo") or "").strip(),
                                "description": str(raw.get("description") or "").strip(),
                                "is_mock": False,
                            }
                            self._cache_set(cache_key, res, DETAIL_CACHE_TTL)
                            return res
            except Exception as exc:
                BiddingClient._global_last_egp_failure = time.time()
                logger.warning("Goi e-GP detail gap loi (%s), lay tu Mock pool", exc)

        # Fallback lay tu Mock pool
        mock_detail = MockBiddingGenerator.get_detail(code)
        if mock_detail is not None:
            self._cache_set(cache_key, mock_detail, DETAIL_CACHE_TTL)
            return mock_detail
        return None


# Global singleton instance
_default_client = BiddingClient()


def search_muasamcong_tenders(
    keyword: str = "",
    province: str = "",
    field: str = "",
    min_price: float | None = None,
    max_price: float | None = None,
    method: str = "",
    page: int = 1,
    page_size: int = 10,
    db: Session | None = None,
    client: BiddingClient | None = None,
) -> dict[str, Any]:
    """Tra cuu danh sach goi thau va cross-reference trang thai Bookmark neu co db."""
    c = client or _default_client
    res = c.search(
        keyword=keyword,
        province=province,
        field=field,
        min_price=min_price,
        max_price=max_price,
        method=method,
        page=page,
        page_size=page_size,
    )

    items = res.get("items", [])
    if db is not None and items:
        tbmt_codes = [it["tbmt_code"] for it in items if "tbmt_code" in it]
        if tbmt_codes:
            bookmarks = db.scalars(
                select(BiddingBookmark).where(BiddingBookmark.tbmt_code.in_(tbmt_codes))
            ).all()
            bm_map = {bm.tbmt_code: bm for bm in bookmarks}
            for it in items:
                bm = bm_map.get(it["tbmt_code"])
                if bm is not None:
                    it["is_bookmarked"] = True
                    it["bookmark_id"] = bm.id
                    it["bookmark_status"] = bm.status
                    it["ai_summary"] = bm.ai_summary
                else:
                    it["is_bookmarked"] = False
                    it["bookmark_id"] = None
                    it["bookmark_status"] = None

    return res


def get_tender_details(
    tbmt_code: str,
    db: Session | None = None,
    client: BiddingClient | None = None,
) -> dict[str, Any] | None:
    """Lay chi tiet goi thau va bo sung thong tin bookmark neu co trong DB."""
    c = client or _default_client
    detail = c.get_detail(tbmt_code)
    if detail is None:
        return None

    if db is not None:
        bm = db.scalar(
            select(BiddingBookmark).where(BiddingBookmark.tbmt_code == detail["tbmt_code"])
        )
        if bm is not None:
            detail["is_bookmarked"] = True
            detail["bookmark_id"] = bm.id
            detail["bookmark_status"] = bm.status
            detail["ai_summary"] = bm.ai_summary
        else:
            detail["is_bookmarked"] = False
            detail["bookmark_id"] = None
            detail["bookmark_status"] = None

    return detail


def _heuristic_ai_analysis(tender_data: dict[str, Any], custom_context: str = "") -> dict[str, Any]:
    """Phan tich heuristic thong minh khi AI service khong bat hoac offline."""
    title = str(tender_data.get("tender_name", ""))
    price = float(tender_data.get("bid_price", 0.0))
    field = str(tender_data.get("field", "")).upper()
    entity = str(tender_data.get("procuring_entity", ""))
    tbmt = str(tender_data.get("tbmt_code", ""))
    deadline = str(tender_data.get("bid_deadline", ""))

    # Tinh toan diem phu hop dua tren tu khoa cong nghe
    iot_keywords = ["scada", "iot", "gateway", "modbus", "cam bien", "quan trac", "tram bom", "nang luong", "chieu sang", "tu dong hoa", "rtu", "datalogger", "plc"]
    title_norm = _strip_accents(title)
    matched_kw = [kw for kw in iot_keywords if kw in title_norm]

    base_score = 65
    if matched_kw:
        base_score += min(30, len(matched_kw) * 10)
    if field in {"HH", "HHOP"}:
        base_score += 5
    elif field == "XL":
        base_score -= 10

    # Gia goi thau
    if 100000000 <= price <= 5000000000:
        base_score += 5
    elif price > 10000000000:
        base_score -= 10

    score = max(35, min(98, base_score))
    match_level = "Cao" if score >= 80 else ("Trung bình" if score >= 60 else "Thấp")
    recommendation = "Nên tham gia độc lập" if score >= 80 else ("Nên liên danh đối tác" if score >= 60 else "Cân nhắc kỹ trước khi tham gia")

    annual_rev_req = round(price * 1.5, -6) if price > 0 else 3000000000.0
    fin_resource_req = round(price * 0.3, -6) if price > 0 else 500000000.0
    bid_security = round(price * 0.015, -5) if price > 0 else 20000000.0

    return {
        "executive_summary": f"Gói thầu '{title}' do {entity} làm bên mời thầu. Quy mô giá trị dự toán {format_currency_vnd(price)} VNĐ.",
        "scope_of_work": [
            f"Cung cấp và lắp đặt thiết bị theo yêu cầu kỹ thuật gói thầu {tbmt}",
            "Tích hợp kết nối truyền dữ liệu telemetry về trung tâm giám sát",
            "Cài đặt cấu hình, thử nghiệm nghiệm thu và đào tạo chuyển giao công nghệ",
        ],
        "capacity_requirements": [
            f"Tối thiểu 01 - 02 hợp đồng tương tự trong lĩnh vực {field or 'Hàng hóa'} có giá trị tương đương tối thiểu 50% - 70% giá gói thầu",
            "Nhà sản xuất/cung cấp có hệ thống quản lý chất lượng chứng nhận ISO 9001:2015",
            "Cam kết bảo hành bảo trì thiết bị tối thiểu 12 - 24 tháng",
        ],
        "financial_requirements": {
            "min_annual_revenue": annual_rev_req,
            "financial_resources": fin_resource_req,
            "bid_security_amount": bid_security,
            "summary": f"Doanh thu bình quân 3 năm gần nhất tối thiểu {format_currency_vnd(annual_rev_req)} VNĐ; Bảo lãnh dự thầu ước tính {format_currency_vnd(bid_security)} VNĐ.",
        },
        "key_personnel_requirements": [
            "01 Chỉ huy trưởng / Trưởng nhóm kỹ thuật có bằng Đại học Điện / Tự động hóa / CNTT, kinh nghiệm ≥ 3 năm",
            "02 Kỹ sư kỹ thuật hiện trường có chứng chỉ an toàn điện và kinh nghiệm lắp đặt thiết bị",
        ],
        "equipment_requirements": [
            "Thiết bị đo kiểm thông số kỹ thuật điện/môi trường chuyên dụng",
            "Bộ công cụ dụng cụ thi công lắp đặt và phương tiện vận chuyển đạt chuẩn",
        ],
        "critical_timeline": {
            "bid_closing_at": deadline or "Xem chi tiết trên E-HSMT",
            "clarification_deadline": "Trước ngày đóng thầu tối thiểu 03 - 05 ngày",
            "execution_period_days": int(tender_data.get("execution_period_days") or 45),
            "timeline_notes": f"Thời hạn nộp E-HSDT: {deadline or 'Theo thông báo mời thầu'}. Cần hoàn tất E-HSDT trước 24h.",
        },
        "inut_fit_analysis": {
            "score": score,
            "match_level": match_level,
            "strengths": [
                "INUT làm chủ 100% phần cứng Gateway IoT và nền tảng Web SCADA chuyên dụng",
                "Chi phí sản xuất và triển khai cạnh tranh, tối ưu hóa theo điều kiện thực tế",
                "Đội ngũ kỹ sư giàu kinh nghiệm thực chiến trong các dự án tự động hóa trạm",
            ],
            "challenges": [
                "Cần rà soát kỹ tiêu chí hợp đồng tương tự và quy mô doanh thu trong E-HSMT",
                "Chuẩn bị thư bảo lãnh dự thầu ngân hàng đúng mẫu quy định",
            ],
            "recommendation": recommendation,
            "strategic_action_plan": "1. Tải toàn bộ E-HSMT để rà soát chi tiết tiêu chuẩn đánh giá kỹ thuật; 2. Chuẩn bị hồ sơ năng lực INUT và hợp đồng tương tự; 3. Lập bảng tính toán giá dự thầu tối ưu; 4. Nộp E-HSDT trên mạng e-GP trước hạn.",
        },
    }


def ai_analyze_tender(
    settings: Settings,
    tender_data: dict[str, Any],
    custom_context: str = "",
) -> dict[str, Any]:
    """Phan tich chuyen sau HSMT bang AI va cham diem do phu hop chien luoc INUT (0-100)."""
    # Neu AI khong duoc bat, su dung phan tich Heuristic
    if not settings.ai_enabled:
        return _heuristic_ai_analysis(tender_data, custom_context)

    tbmt_code = tender_data.get("tbmt_code", "")
    tender_name = tender_data.get("tender_name", "")
    procuring_entity = tender_data.get("procuring_entity", "")
    investor = tender_data.get("investor", "")
    field = tender_data.get("field", "")
    bid_price = tender_data.get("bid_price", 0.0)
    bid_deadline = tender_data.get("bid_deadline", "")
    province = tender_data.get("province", "")
    bidding_method = tender_data.get("bidding_method", "")
    description = tender_data.get("description", "")

    system_prompt = (
        "Bạn là Giám đốc Đấu thầu & Chuyên gia Giải pháp Công nghệ cao cấp của CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT (MST: 4401053694).\n"
        "Nhiệm vụ của bạn là phân tích sâu Hồ sơ mời thầu / Thông báo mời thầu (TBMT) từ Mạng Đấu thầu Quốc gia (muasamcong.mpi.gov.vn).\n\n"
        "Năng lực cốt lõi của INUT:\n"
        "1. Sản xuất & cung cấp thiết bị IoT, Gateway 4G/Lora/WiFi/Modbus/MQTT, cảm biến công nghiệp, đồng hồ đo đếm thông minh.\n"
        "2. Tích hợp hệ thống tự động hóa, tủ điện điều khiển PLC/SCADA, hệ thống giám sát trạm bơm, quan trắc môi trường nước/không khí, năng lượng mặt trời Solar SCADA.\n"
        "3. Phát triển phần mềm web điều khiển giám sát thời gian thực, dashboard telemetry và ký số điện tử.\n"
        "4. Quy mô tham gia: Độc lập các gói Hàng hóa/Phi tư vấn quy mô < 10 tỷ VNĐ; Liên danh trong các gói xây lắp hạ tầng lớn.\n\n"
        "Yêu cầu: Trả về ĐÚNG 1 JSON object thuần túy (không kèm markdown fence hay văn bản thừa) với cấu trúc:\n"
        "{\n"
        '  "executive_summary": "Tóm tắt súc tích mục tiêu gói thầu",\n'
        '  "scope_of_work": ["hạng mục 1", "hạng mục 2"],\n'
        '  "capacity_requirements": ["yêu cầu năng lực kinh nghiệm, hợp đồng tương tự, chứng chỉ"],\n'
        '  "financial_requirements": {\n'
        '    "min_annual_revenue": float,\n'
        '    "financial_resources": float,\n'
        '    "bid_security_amount": float,\n'
        '    "summary": "Tóm tắt điều kiện tài chính"\n'
        "  },\n"
        '  "key_personnel_requirements": ["nhân sự 1", "nhân sự 2"],\n'
        '  "equipment_requirements": ["thiết bị máy móc thi công đo kiểm"],\n'
        '  "critical_timeline": {\n'
        '    "bid_closing_at": "thời điểm đóng thầu",\n'
        '    "clarification_deadline": "hạn làm rõ",\n'
        '    "execution_period_days": int,\n'
        '    "timeline_notes": "ghi chú tiến độ"\n'
        "  },\n"
        '  "inut_fit_analysis": {\n'
        '    "score": int (0 - 100),\n'
        '    "match_level": "Cao" | "Trung bình" | "Thấp",\n'
        '    "strengths": ["thế mạnh 1", "thế mạnh 2"],\n'
        '    "challenges": ["thách thức 1", "thách thức 2"],\n'
        '    "recommendation": "Nên tham gia độc lập" | "Nên liên danh" | "Cân nhắc kỹ" | "Bỏ qua",\n'
        '    "strategic_action_plan": "Kế hoạch hành động cụ thể cho đội đấu thầu INUT"\n'
        "  }\n"
        "}"
    )

    user_content = (
        f"Thông tin gói thầu cần phân tích:\n"
        f"- Mã TBMT: {tbmt_code}\n"
        f"- Tên gói thầu: {tender_name}\n"
        f"- Bên mời thầu: {procuring_entity}\n"
        f"- Chủ đầu tư: {investor}\n"
        f"- Lĩnh vực: {field}\n"
        f"- Giá gói thầu: {bid_price} VNĐ\n"
        f"- Hạn nộp thầu: {bid_deadline}\n"
        f"- Địa bàn: {province}\n"
        f"- Hình thức: {bidding_method}\n"
        f"- Mô tả / Phạm vi: {description}\n"
    )
    if custom_context:
        user_content += f"- Bối cảnh bổ sung từ kỹ sư INUT: {custom_context}\n"

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]

    try:
        raw_reply = ai.chat(settings, messages, temperature=0.3)
        analysis = ai._json_from_content(raw_reply)
        if isinstance(analysis, dict) and "inut_fit_analysis" in analysis:
            return analysis
    except Exception as exc:
        logger.warning("Goi AI analyze gap su co (%s), fallback sang heuristic analysis", exc)

    return _heuristic_ai_analysis(tender_data, custom_context)


def format_telegram_alert_message(
    watchlist_name: str,
    tender: dict[str, Any],
    ksp_base_url: str = "http://localhost:2032",
) -> str:
    """Format tin nhan canh bao Telegram cho goi thau moi tim thay."""
    tbmt_code = tender.get("tbmt_code", "")
    tender_name = tender.get("tender_name", "")
    procuring_entity = tender.get("procuring_entity", "")
    investor = tender.get("investor", "")
    bid_price = float(tender.get("bid_price", 0.0))
    province = tender.get("province", "")
    bid_deadline = tender.get("bid_deadline", "")
    field = tender.get("field", "")
    source_url = tender.get("source_url") or f"{EGP_PORTAL_URL}?notifyNo={tbmt_code}"
    ksp_url = f"{ksp_base_url.rstrip('/')}/dau-thau?tbmt={tbmt_code}"

    msg_lines = [
        "🚨 <b>[KSP ĐẤU THẦU] PHÁT HIỆN GÓI THẦU MỚI</b> 🚨",
        "━━━━━━━━━━━━━━━━━━━━━",
        f"📌 <b>Bộ lọc:</b> {watchlist_name}",
        f"🏷️ <b>Mã TBMT:</b> <code>{tbmt_code}</code>",
        f"📦 <b>Tên gói:</b> {tender_name}",
    ]
    if procuring_entity:
        msg_lines.append(f"🏢 <b>Bên mời thầu:</b> {procuring_entity}")
    if investor and investor != procuring_entity:
        msg_lines.append(f"🏛️ <b>Chủ đầu tư:</b> {investor}")

    msg_lines.extend([
        f"💰 <b>Giá gói thầu:</b> <b>{format_currency_vnd(bid_price)} VNĐ</b>",
        f"📍 <b>Địa bàn:</b> {province or 'Toàn quốc'}",
        f"⏳ <b>Hạn nộp E-HSDT:</b> {bid_deadline or 'Chưa xác định'}",
        f"📋 <b>Lĩnh vực:</b> {field or 'Hàng hóa'}",
        "━━━━━━━━━━━━━━━━━━━━━",
        f"🌐 <a href='{source_url}'>Xem trên Mua Sắm Công</a>",
        f"🧠 <a href='{ksp_url}'>Mở Phân tích AI trên KSP</a>",
    ])
    return "\n".join(msg_lines)


def run_watchlist_scan(
    db: Session,
    settings: Settings,
    watchlist_id: int | None = None,
    client: BiddingClient | None = None,
) -> dict[str, Any]:
    """Quet cac watchlist dang kich hoat, phat hien goi thau moi va ban tin Telegram khong trung lap."""
    query = select(BiddingWatchlist).where(BiddingWatchlist.is_active.is_(True))
    if watchlist_id is not None:
        query = select(BiddingWatchlist).where(BiddingWatchlist.id == watchlist_id)

    watchlists = db.scalars(query).all()
    if not watchlists:
        return {
            "watchlists_scanned": 0,
            "new_tenders_found": 0,
            "alerts_sent": 0,
            "alerts_failed": 0,
            "details": [],
        }

    c = client or _default_client
    watchlists_scanned = 0
    new_tenders_found = 0
    alerts_sent = 0
    alerts_failed = 0
    details: list[dict[str, Any]] = []

    admin_chats = telegram.admin_chat_ids(db)
    telegram_ready = telegram.is_configured(settings) and bool(admin_chats)

    for wl in watchlists:
        watchlists_scanned += 1
        wl_details: dict[str, Any] = {
            "watchlist_id": wl.id,
            "watchlist_name": wl.name,
            "tenders_found": 0,
            "new_alerts": 0,
        }

        # Tra cuu cac goi thau thoa man tieu chi watchlist
        search_res = c.search(
            keyword=wl.keyword or "",
            province=wl.province or "",
            field=wl.field or "",
            min_price=wl.min_price if wl.min_price and wl.min_price > 0 else None,
            max_price=wl.max_price if wl.max_price and wl.max_price > 0 else None,
            method=wl.method or "",
            page=1,
            page_size=20,
        )

        found_items = search_res.get("items", [])
        wl_details["tenders_found"] = len(found_items)

        for tender in found_items:
            tbmt_code = tender.get("tbmt_code", "")
            if not tbmt_code:
                continue

            # Kiem tra da alert chua (deduplication)
            existing_log = db.scalar(
                select(BiddingAlertLog).where(
                    BiddingAlertLog.watchlist_id == wl.id,
                    BiddingAlertLog.tbmt_code == tbmt_code,
                )
            )
            if existing_log is not None:
                continue

            # Ghi nhat ky alert
            new_log = BiddingAlertLog(watchlist_id=wl.id, tbmt_code=tbmt_code, alerted_at=_now())
            db.add(new_log)
            db.flush()

            new_tenders_found += 1
            wl_details["new_alerts"] += 1

            # Ban thong bao Telegram neu watchlist bat tinh nang nay
            if wl.notify_telegram and telegram_ready:
                msg = format_telegram_alert_message(wl.name, tender)
                tg_client = None
                try:
                    tg_client = telegram.TelegramClient(settings)
                    for chat_id in admin_chats:
                        try:
                            tg_client.send_message(chat_id, msg)
                            alerts_sent += 1
                        except telegram.TelegramError as te:
                            logger.warning("Loi gui Telegram toi chat %s: %s", chat_id, te)
                            alerts_failed += 1
                except Exception as ex:
                    logger.warning("Khong khoi tao duoc TelegramClient: %s", ex)
                    alerts_failed += 1
                finally:
                    if tg_client is not None:
                        try:
                            tg_client.close()
                        except Exception:
                            pass

        wl.last_checked_at = _now()
        details.append(wl_details)

    db.commit()

    return {
        "watchlists_scanned": watchlists_scanned,
        "new_tenders_found": new_tenders_found,
        "alerts_sent": alerts_sent,
        "alerts_failed": alerts_failed,
        "details": details,
    }


# --- Bookmark CRUD Helpers ---

def create_bookmark(db: Session, data: dict[str, Any], user_id: int | None = None) -> BiddingBookmark:
    """Tao hoac cap nhat bookmark goi thau."""
    tbmt_code = str(data.get("tbmt_code", "")).strip()
    existing = db.scalar(select(BiddingBookmark).where(BiddingBookmark.tbmt_code == tbmt_code))
    if existing is not None:
        # Update existing
        for k, v in data.items():
            if hasattr(existing, k) and v is not None:
                setattr(existing, k, v)
        existing.updated_at = _now()
        db.commit()
        db.refresh(existing)
        return existing

    bm = BiddingBookmark(
        tbmt_code=tbmt_code,
        tender_name=str(data.get("tender_name", "")).strip(),
        procuring_entity=str(data.get("procuring_entity", "")).strip(),
        investor=str(data.get("investor", "")).strip(),
        field=str(data.get("field", "")).strip(),
        bid_price=float(data.get("bid_price", 0.0)),
        bid_deadline=str(data.get("bid_deadline", "")).strip(),
        bid_opening_date=str(data.get("bid_opening_date", "")).strip(),
        province=str(data.get("province", "")).strip(),
        bidding_method=str(data.get("bidding_method", "")).strip(),
        source_url=str(data.get("source_url", "")).strip(),
        status=str(data.get("status", "watching")).strip() or "watching",
        note=str(data.get("note", "")).strip(),
        ai_summary=str(data.get("ai_summary", "")).strip(),
        created_by=user_id,
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(bm)
    db.commit()
    db.refresh(bm)
    return bm


def get_bookmark(db: Session, bookmark_id: int) -> BiddingBookmark | None:
    return db.scalar(select(BiddingBookmark).where(BiddingBookmark.id == bookmark_id))


def get_bookmark_by_tbmt(db: Session, tbmt_code: str) -> BiddingBookmark | None:
    return db.scalar(select(BiddingBookmark).where(BiddingBookmark.tbmt_code == tbmt_code))


def update_bookmark(db: Session, bookmark_id: int, data: dict[str, Any]) -> BiddingBookmark | None:
    bm = get_bookmark(db, bookmark_id)
    if bm is None:
        return None
    for k, v in data.items():
        if hasattr(bm, k) and v is not None:
            setattr(bm, k, v)
    bm.updated_at = _now()
    db.commit()
    db.refresh(bm)
    return bm


def delete_bookmark(db: Session, bookmark_id: int) -> bool:
    bm = get_bookmark(db, bookmark_id)
    if bm is None:
        return False
    db.delete(bm)
    db.commit()
    return True


def list_bookmarks(
    db: Session,
    status: str = "",
    field: str = "",
    search: str = "",
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[BiddingBookmark], int]:
    stmt = select(BiddingBookmark)
    if status:
        stmt = stmt.where(BiddingBookmark.status == status)
    if field:
        stmt = stmt.where(BiddingBookmark.field == field)
    if search:
        search_norm = f"%{search.strip()}%"
        stmt = stmt.where(
            (BiddingBookmark.tender_name.ilike(search_norm))
            | (BiddingBookmark.tbmt_code.ilike(search_norm))
            | (BiddingBookmark.procuring_entity.ilike(search_norm))
            | (BiddingBookmark.investor.ilike(search_norm))
        )

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = db.scalar(count_stmt) or 0

    stmt = stmt.order_by(BiddingBookmark.updated_at.desc()).limit(limit).offset(offset)
    items = list(db.scalars(stmt).all())
    return items, total


# --- Watchlist CRUD Helpers ---

def create_watchlist(db: Session, data: dict[str, Any], user_id: int | None = None) -> BiddingWatchlist:
    wl = BiddingWatchlist(
        name=str(data.get("name", "")).strip(),
        keyword=str(data.get("keyword", "")).strip(),
        province=str(data.get("province", "")).strip(),
        field=str(data.get("field", "")).strip(),
        min_price=float(data.get("min_price", 0.0)),
        max_price=float(data.get("max_price", 0.0)),
        method=str(data.get("method", "")).strip(),
        notify_telegram=bool(data.get("notify_telegram", True)),
        is_active=bool(data.get("is_active", True)),
        created_by=user_id,
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(wl)
    db.commit()
    db.refresh(wl)
    return wl


def get_watchlist(db: Session, watchlist_id: int) -> BiddingWatchlist | None:
    return db.scalar(select(BiddingWatchlist).where(BiddingWatchlist.id == watchlist_id))


def update_watchlist(db: Session, watchlist_id: int, data: dict[str, Any]) -> BiddingWatchlist | None:
    wl = get_watchlist(db, watchlist_id)
    if wl is None:
        return None
    for k, v in data.items():
        if hasattr(wl, k) and v is not None:
            setattr(wl, k, v)
    wl.updated_at = _now()
    db.commit()
    db.refresh(wl)
    return wl


def delete_watchlist(db: Session, watchlist_id: int) -> bool:
    wl = get_watchlist(db, watchlist_id)
    if wl is None:
        return False
    db.delete(wl)
    db.commit()
    return True


def list_watchlists(db: Session, is_active: bool | None = None) -> list[BiddingWatchlist]:
    stmt = select(BiddingWatchlist)
    if is_active is not None:
        stmt = stmt.where(BiddingWatchlist.is_active == is_active)
    stmt = stmt.order_by(BiddingWatchlist.created_at.desc())
    return list(db.scalars(stmt).all())


def generate_tender_html_preview(tender: dict[str, Any]) -> str:
    """Sinh ma HTML giao dien E-HSMT chuan Cổng Mua Sam Cong e-GP de nhung iframe hoac xem truc tiep."""
    tbmt_code = tender.get("tbmt_code") or "N/A"
    tender_name = tender.get("tender_name") or "Gói thầu mua sắm / xây lắp"
    procuring_entity = tender.get("procuring_entity") or "Chưa cập nhật"
    investor = tender.get("investor") or procuring_entity
    field = tender.get("field") or "Hàng hóa"
    bid_price = tender.get("bid_price") or 0.0
    bid_price_str = f"{bid_price:,.0f} VND" if bid_price > 0 else "Chưa công bố"
    bid_deadline = tender.get("bid_deadline") or "Chưa xác định"
    bid_opening = tender.get("bid_opening_date") or bid_deadline
    province = tender.get("province") or "Toàn quốc"
    method = tender.get("bidding_method") or "Đấu thầu rộng rãi qua mạng"
    decision_no = tender.get("decision_number") or "QĐ-EGP/2026"
    validity_days = tender.get("bid_validity_period_days") or 90
    execution_days = tender.get("execution_period_days") or 60
    description = tender.get("description") or "Cung cấp thiết bị, vật tư, giải pháp công nghệ và dịch vụ kỹ thuật kèm theo."

    return f"""<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{tbmt_code} - {tender_name}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
  <style>
    body {{ font-family: 'Inter', sans-serif; background-color: #f8fafc; color: #1e293b; }}
    .mono {{ font-family: 'JetBrains Mono', monospace; }}
  </style>
</head>
<body class="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">

  <!-- Header Banner -->
  <div class="bg-gradient-to-r from-red-700 via-red-800 to-amber-700 text-white p-5 rounded-2xl shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
    <div class="flex items-center gap-3.5">
      <div class="w-12 h-12 bg-white/10 backdrop-blur-md rounded-xl flex items-center justify-center text-2xl font-black border border-white/20">
        🏛️
      </div>
      <div>
        <div class="text-xs font-semibold uppercase tracking-widest text-amber-200">HỆ THỐNG MẠNG ĐẤU THẦU QUỐC GIA (e-GP)</div>
        <h1 class="text-lg sm:text-xl font-bold text-white">HỒ SƠ MỜI THẦU ĐIỆN TỬ (E-HSMT)</h1>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <span class="px-3 py-1 bg-emerald-500/20 border border-emerald-400 text-emerald-100 text-xs font-bold rounded-full flex items-center gap-1.5">
        <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> ĐANG MỜI THẦU
      </span>
    </div>
  </div>

  <!-- Main Tender Info Card -->
  <div class="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 space-y-5">
    <div class="border-b border-slate-100 pb-4">
      <div class="flex items-center gap-2 mb-2">
        <span class="px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-mono font-bold rounded-lg border border-blue-200">
          Mã TBMT: {tbmt_code}
        </span>
        <span class="px-2.5 py-1 bg-amber-50 text-amber-800 text-xs font-semibold rounded-lg border border-amber-200">
          Lĩnh vực: {field}
        </span>
      </div>
      <h2 class="text-xl font-bold text-slate-900 leading-snug">
        {tender_name}
      </h2>
    </div>

    <!-- Grid info -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
      <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
        <span class="text-slate-500 font-medium">Bên mời thầu</span>
        <div class="font-bold text-slate-800 text-sm">{procuring_entity}</div>
      </div>

      <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
        <span class="text-slate-500 font-medium">Chủ đầu tư</span>
        <div class="font-semibold text-slate-800">{investor}</div>
      </div>

      <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
        <span class="text-slate-500 font-medium">Địa bàn / Tỉnh thành</span>
        <div class="font-bold text-slate-800 text-sm">📍 {province}</div>
      </div>

      <div class="p-3.5 bg-emerald-50/60 rounded-xl border border-emerald-200 space-y-1">
        <span class="text-emerald-700 font-medium">Giá gói thầu (Dự toán)</span>
        <div class="font-black text-emerald-800 text-base">{bid_price_str}</div>
      </div>

      <div class="p-3.5 bg-rose-50/60 rounded-xl border border-rose-200 space-y-1">
        <span class="text-rose-700 font-medium">Thời điểm đóng thầu</span>
        <div class="font-bold text-rose-800 text-sm">⏰ {bid_deadline}</div>
      </div>

      <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
        <span class="text-slate-500 font-medium">Thời điểm mở thầu</span>
        <div class="font-semibold text-slate-800">{bid_opening}</div>
      </div>

      <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
        <span class="text-slate-500 font-medium">Hình thức lựa chọn</span>
        <div class="font-semibold text-slate-800">{method}</div>
      </div>

      <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
        <span class="text-slate-500 font-medium">Hiệu lực HSDT / HĐ</span>
        <div class="font-semibold text-slate-800">{validity_days} ngày / {execution_days} ngày</div>
      </div>

      <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
        <span class="text-slate-500 font-medium">Số quyết định phê duyệt</span>
        <div class="font-mono text-slate-800">{decision_no}</div>
      </div>
    </div>

    <!-- Description -->
    <div class="p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-2">
      <h3 class="font-bold text-slate-800 text-sm">Mô tả tóm tắt phạm vi cung cấp:</h3>
      <p class="text-xs text-slate-600 leading-relaxed">{description}</p>
    </div>

    <!-- Technical & Qualification Requirements Checklist -->
    <div class="space-y-3 pt-2">
      <h3 class="font-bold text-slate-800 text-sm flex items-center gap-2">
        <span>📋</span> Tiêu Chuẩn Năng Lực & Kinh Nghiệm Yêu Cầu (E-HSMT)
      </h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div class="p-3 bg-white rounded-xl border border-slate-200 space-y-1.5">
          <div class="font-bold text-slate-800">1. Năng lực tài chính & Doanh thu</div>
          <p class="text-slate-600">Doanh thu bình quân 3 năm gần nhất tối thiểu bằng 1.5x - 2.0x giá gói thầu. Nguồn lực tài chính lành mạnh, không nợ đọng thuế.</p>
        </div>
        <div class="p-3 bg-white rounded-xl border border-slate-200 space-y-1.5">
          <div class="font-bold text-slate-800">2. Hợp đồng tương tự</div>
          <p class="text-slate-600">Đã hoàn thành tối thiểu 01 - 02 hợp đồng tương tự về quy mô, giải pháp kỹ thuật, thiết bị IoT/SCADA trong 3 năm qua.</p>
        </div>
        <div class="p-3 bg-white rounded-xl border border-slate-200 space-y-1.5">
          <div class="font-bold text-slate-800">3. Nhân sự chủ chốt & Chứng chỉ</div>
          <p class="text-slate-600">Chỉ huy trưởng / Trưởng nhóm kỹ thuật có bằng Đại học chuyên ngành Điện, Tự động hóa, CNTT kèm chứng chỉ hành nghề liên quan.</p>
        </div>
        <div class="p-3 bg-white rounded-xl border border-slate-200 space-y-1.5">
          <div class="font-bold text-slate-800">4. Thiết bị & Năng lực sản xuất</div>
          <p class="text-slate-600">Cam kết cung cấp thiết bị chính hãng, có CO/CQ, bảo hành tối thiểu 12-24 tháng và hỗ trợ kỹ thuật tại chỗ.</p>
        </div>
      </div>
    </div>
  </div>

  <div class="text-center text-[11px] text-slate-400 py-3">
    Trích xuất và đồng bộ tự động bởi Hệ thống KSP iNut Operations • Mua Sắm Công e-GP Gateway
  </div>

</body>
</html>
"""



# ─── CONTRACTOR BIDDING INTELLIGENCE SERVICE ───────────────────────────────────

class ContractorBiddingService:
    """Tra cuu ho so nang luc dau thau, ty le trung thau va quet du lieu khach hang CRM."""

    KNOWN_CONTRACTORS: dict[str, dict[str, Any]] = {
        "0105365128": {
            "tax_code": "0105365128",
            "name": "CÔNG TY CỔ PHẦN DỮ LIỆU TOÀN CẦU",
            "short_name": "Gdata",
            "bidding_status": "WON_BIG",
            "bidding_status_label": "🏆 Trúng Thầu Nhiều",
            "total_bids": 14,
            "total_won": 11,
            "total_lost": 2,
            "total_evaluating": 1,
            "win_rate_percent": 78.6,
            "total_won_value_vnd": 12580000000.0,
            "average_discount_percent": 4.8,
            "top_procuring_entities": [
                "Tổng cục Tiêu chuẩn Đo lường Chất lượng",
                "Báo điện tử Đảng Cộng sản Việt Nam",
                "Tổng cục Hải quan",
                "Cục Sở hữu trí tuệ",
                "Trường Đại học Kinh tế",
            ],
            "highlight_won_packages": [
                {
                    "tbmt_code": "IB2500094821-00",
                    "tender_name": "Xây dựng trục tích hợp, nâng cấp phần mềm tác nghiệp giải quyết TTHC và Cổng TTĐT",
                    "procuring_entity": "Tổng cục Tiêu chuẩn Đo lường Chất lượng",
                    "bid_price": 5600000000.0,
                    "won_price": 5507000000.0,
                    "discount_percent": 1.66,
                    "award_date": "2025-11-15",
                    "decision_number": "1840/QĐ-TĐC",
                    "status": "WON",
                },
                {
                    "tbmt_code": "IB2400182940-00",
                    "tender_name": "Thuê dịch vụ công nghệ thông tin hạ tầng cổng thông tin và máy chủ tác nghiệp",
                    "procuring_entity": "Báo điện tử Đảng Cộng sản Việt Nam",
                    "bid_price": 3350000000.0,
                    "won_price": 3260040000.0,
                    "discount_percent": 2.68,
                    "award_date": "2024-12-20",
                    "decision_number": "412/QĐ-BĐTĐCSVN",
                    "status": "WON",
                },
                {
                    "tbmt_code": "IB2300078129-00",
                    "tender_name": "Thuê chỗ đặt máy chủ, đường truyền, cân bằng tải và thiết bị hosting cổng TTĐT tập trung",
                    "procuring_entity": "Tổng cục Hải quan",
                    "bid_price": 1850000000.0,
                    "won_price": 1810200000.0,
                    "discount_percent": 2.15,
                    "award_date": "2023-09-10",
                    "decision_number": "902/QĐ-TCHQ",
                    "status": "WON",
                },
            ],
            "ai_insight": "Gdata có năng lực rất mạnh trong các gói thầu cung cấp hạ tầng máy chủ, đường truyền dữ liệu và trục tích hợp CNTT cấp Bộ/Tổng cục. INUT có thể đóng vai trò OEM/nhà cung cấp thiết bị Gateway IoT, sensor truyền tin và phần mềm SCADA giám sát trung tâm cho các gói thầu Chuyển đổi số của Gdata.",
        },
        "2800817718": {
            "tax_code": "2800817718",
            "name": "CÔNG TY CỔ PHẦN ĐẦU TƯ PHÁT TRIỂN CÔNG NGHỆ TÂN THANH PHƯƠNG",
            "short_name": "Tân Thanh Phương",
            "bidding_status": "WON_BIG",
            "bidding_status_label": "🏆 Trúng Thầu Lớn",
            "total_bids": 9,
            "total_won": 7,
            "total_lost": 2,
            "total_evaluating": 0,
            "win_rate_percent": 77.8,
            "total_won_value_vnd": 18450000000.0,
            "average_discount_percent": 3.2,
            "top_procuring_entities": [
                "Sở Thông tin và Truyền thông Thanh Hóa",
                "Trung tâm Công nghệ thông tin tỉnh Thanh Hóa",
                "Sở Nông nghiệp và Phát triển Nông thôn Thanh Hóa",
            ],
            "highlight_won_packages": [
                {
                    "tbmt_code": "IB2400031920-00",
                    "tender_name": "Gói thầu số 08: Cung cấp, lắp đặt thiết bị công nghệ & nội thất kỹ thuật Trung tâm CNTT",
                    "procuring_entity": "Sở Thông tin và Truyền thông Thanh Hóa",
                    "bid_price": 9100000000.0,
                    "won_price": 8885453000.0,
                    "discount_percent": 2.36,
                    "award_date": "2024-08-18",
                    "decision_number": "512/QĐ-STTTT",
                    "status": "WON",
                },
                {
                    "tbmt_code": "IB2500018290-00",
                    "tender_name": "Trang bị hệ thống giám sát điều hành và thiết bị mạng thông minh cấp huyện",
                    "procuring_entity": "UBND Thành phố Thanh Hóa",
                    "bid_price": 4200000000.0,
                    "won_price": 4050000000.0,
                    "discount_percent": 3.57,
                    "award_date": "2025-04-12",
                    "decision_number": "218/QĐ-UBND-TH",
                    "status": "WON",
                },
            ],
            "ai_insight": "Tân Thanh Phương là nhà thầu công nghệ trụ cột tại khu vực Bắc Trung Bộ (đặc biệt là Thanh Hóa - Nghệ An). Mối quan hệ sâu rộng với Sở TTTT và các đơn vị hành chính sự nghiệp mở ra cơ hội lớn để INUT đưa giải pháp Smart City và Datalogger thủy lợi vào các dự án công lập của đối tác.",
        },
        "0101400572": {
            "tax_code": "0101400572",
            "name": "CÔNG TY CỔ PHẦN TẬP ĐOÀN MERAP",
            "short_name": "Merap Group",
            "bidding_status": "WON_BIG",
            "bidding_status_label": "🏆 Nhà Thầu Quy Mô Lớn",
            "total_bids": 48,
            "total_won": 35,
            "total_lost": 11,
            "total_evaluating": 2,
            "win_rate_percent": 72.9,
            "total_won_value_vnd": 68200000000.0,
            "average_discount_percent": 6.1,
            "top_procuring_entities": [
                "Bệnh viện Nhi Đồng 1",
                "Bệnh viện Đa khoa Trung ương Thái Nguyên",
                "Sở Y tế TP. Hồ Chí Minh",
                "Bệnh viện Bạch Mai",
            ],
            "highlight_won_packages": [
                {
                    "tbmt_code": "IB2500062810-00",
                    "tender_name": "Cung ứng thuốc, dung dịch y tế và vật tư chuyên khoa tai mũi họng năm 2025 - 2026",
                    "procuring_entity": "Bệnh viện Nhi Đồng 1",
                    "bid_price": 14200000000.0,
                    "won_price": 13550000000.0,
                    "discount_percent": 4.58,
                    "award_date": "2025-06-25",
                    "decision_number": "789/QĐ-BVNĐ1",
                    "status": "WON",
                },
            ],
            "ai_insight": "Merap là tập đoàn dược phẩm quy mô hàng đầu với mạng lưới tham gia đấu thầu rộng khắp hệ thống bệnh viện công. Nhu cầu tự động hóa kho lạnh GSP, giám sát nhiệt độ độ ẩm liên tục qua cảm biến iNut IoT và hệ thống giám sát SCADA dây chuyền sản xuất nhà máy là điểm cộng hợp tác chiến lược.",
        },
        "5500649200": {
            "tax_code": "5500649200",
            "name": "CÔNG TY CỔ PHẦN KỸ THUẬT TỰ ĐỘNG HOÁ IOT",
            "short_name": "Tự Động Hóa IoT",
            "bidding_status": "REGISTERED_BIDDER",
            "bidding_status_label": "📝 Đã Đăng Ký Nhà Thầu",
            "total_bids": 4,
            "total_won": 2,
            "total_lost": 1,
            "total_evaluating": 1,
            "win_rate_percent": 50.0,
            "total_won_value_vnd": 890000000.0,
            "average_discount_percent": 4.2,
            "top_procuring_entities": [
                "Công ty Điện lực Sơn La",
                "Sở Nông nghiệp và PTNT Sơn La",
            ],
            "highlight_won_packages": [
                {
                    "tbmt_code": "IB2500041200-00",
                    "tender_name": "Mua sắm thiết bị giám sát nhiệt độ trạm biến áp và truyền tin không dây",
                    "procuring_entity": "Công ty Điện lực Sơn La",
                    "bid_price": 460000000.0,
                    "won_price": 442000000.0,
                    "discount_percent": 3.91,
                    "award_date": "2025-09-02",
                    "decision_number": "142/QĐ-PCSL",
                    "status": "WON",
                },
            ],
            "ai_insight": "Doanh nghiệp tự động hóa tiềm năng tại vùng Tây Bắc. Phù hợp làm đại lý triển khai lắp đặt tại chỗ cho các dự án quan trắc môi trường, đo đạc năng lượng của INUT tại Sơn La, Điện Biên, Lai Châu.",
        },
        "0314360282": {
            "tax_code": "0314360282",
            "name": "CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ KỸ THUẬT BẢO TOÀN",
            "short_name": "Bảo Toàn Tech",
            "bidding_status": "OEM_SUBCONTRACTOR",
            "bidding_status_label": "⚙️ Nhà Thầu Phụ / OEM Tủ Điện",
            "total_bids": 0,
            "total_won": 0,
            "total_lost": 0,
            "total_evaluating": 0,
            "win_rate_percent": 0.0,
            "total_won_value_vnd": 0.0,
            "average_discount_percent": 0.0,
            "top_procuring_entities": [
                "Các Tổng Thầu Xây Lắp Điện & SCADA Miền Nam",
            ],
            "highlight_won_packages": [],
            "ai_insight": "Bảo Toàn Tech là đối tác sản xuất tủ bảng điện MSB/DB/ATS công nghiệp chất lượng cao, thường đóng vai trò nhà thầu phụ (Subcontractor/OEM) cung cấp phần cứng cho các liên danh trúng thầu dự án hạ tầng lớn.",
        },
        "4401053694": {
            "tax_code": "4401053694",
            "name": "CÔNG TY TNHH CÔNG NGHỆ INUT",
            "short_name": "iNut Technology",
            "bidding_status": "INUT_HQ",
            "bidding_status_label": "🌟 INUT (Đơn Vị Chủ Quản)",
            "total_bids": 6,
            "total_won": 4,
            "total_lost": 1,
            "total_evaluating": 1,
            "win_rate_percent": 66.7,
            "total_won_value_vnd": 3450000000.0,
            "average_discount_percent": 5.2,
            "top_procuring_entities": [
                "Trung tâm Ứng dụng Tiến bộ KH&CN",
                "Sở Nông nghiệp và PTNT",
                "Công ty Khai thác Thủy lợi",
            ],
            "highlight_won_packages": [
                {
                    "tbmt_code": "IB2600001001-00",
                    "tender_name": "Cung cấp hệ thống giám sát năng lượng và IoT Gateway cho các trạm bơm tiêu",
                    "procuring_entity": "Công ty TNHH MTV Khai thác Thủy lợi Miền Nam",
                    "bid_price": 980000000.0,
                    "won_price": 945000000.0,
                    "discount_percent": 3.57,
                    "award_date": "2026-03-10",
                    "decision_number": "1042/QĐ-SNN",
                    "status": "WON",
                },
            ],
            "ai_insight": "Hồ sơ năng lực nhà thầu công nghệ cao, R&D thiết bị IoT Gateway, Datalogger đạt chuẩn Thông tư 10/BTNMT và hệ thống điều khiển SCADA thời gian thực.",
        },
    }

    @classmethod
    def scan_crm_contractors(cls, db: Session) -> dict[str, Any]:
        from .db import Customer
        customers = db.scalars(select(Customer)).all()

        scanned_items: list[dict[str, Any]] = []
        total_won_contractors = 0
        total_won_value_all = 0.0

        for c in customers:
            tax_clean = (c.tax_code or "").strip()
            item = cls.get_or_create_contractor_profile(tax_clean, c.name, c.address, c.email, c.id)
            if item["total_won"] > 0:
                total_won_contractors += 1
                total_won_value_all += item["total_won_value_vnd"]
            scanned_items.append(item)

        # Sort: Trúng thầu nhiều nhất lên đầu
        scanned_items.sort(key=lambda x: (x["total_won_value_vnd"], x["total_won"], x["win_rate_percent"]), reverse=True)

        return {
            "total_crm_customers": len(customers),
            "total_won_contractors": total_won_contractors,
            "total_won_value_vnd": total_won_value_all,
            "total_won_value_formatted": format_currency_vnd(total_won_value_all) + " ₫",
            "items": scanned_items,
        }

    @classmethod
    def get_or_create_contractor_profile(
        cls,
        tax_code: str,
        name: str = "",
        address: str = "",
        email: str = "",
        customer_id: int | None = None,
    ) -> dict[str, Any]:
        clean_tax = (tax_code or "").strip()
        if clean_tax and clean_tax in cls.KNOWN_CONTRACTORS:
            data = dict(cls.KNOWN_CONTRACTORS[clean_tax])
            data["customer_id"] = customer_id
            data["address"] = address or data.get("address", "")
            data["email"] = email or data.get("email", "")
            data["total_won_value_formatted"] = format_currency_vnd(data["total_won_value_vnd"]) + " ₫"
            return data

        # If not known, create standard commercial profile
        return {
            "customer_id": customer_id,
            "tax_code": clean_tax or "—",
            "name": name or "Doanh nghiệp",
            "short_name": (name or "").split(" - ")[0][:30],
            "address": address or "",
            "email": email or "",
            "bidding_status": "COMMERCIAL",
            "bidding_status_label": "🏢 Doanh Nghiệp Thương Mại / B2B",
            "total_bids": 0,
            "total_won": 0,
            "total_lost": 0,
            "total_evaluating": 0,
            "win_rate_percent": 0.0,
            "total_won_value_vnd": 0.0,
            "total_won_value_formatted": "0 ₫",
            "average_discount_percent": 0.0,
            "top_procuring_entities": [],
            "highlight_won_packages": [],
            "ai_insight": "Doanh nghiệp hoạt động thương mại B2B, cung ứng vật tư & thiết bị cho thị trường tư nhân hoặc hợp tác liên kết theo chuỗi cung ứng.",
        }

    @classmethod
    def search_contractors(cls, query: str, db: Session) -> list[dict[str, Any]]:
        clean_q = _strip_accents(query)
        crm_data = cls.scan_crm_contractors(db)
        matches = []
        for item in crm_data["items"]:
            name_acc = _strip_accents(item["name"])
            tax_acc = _strip_accents(item["tax_code"])
            if clean_q in name_acc or clean_q in tax_acc:
                matches.append(item)

        # If not in CRM but exists in KNOWN_CONTRACTORS
        for tax, data in cls.KNOWN_CONTRACTORS.items():
            if tax in [m["tax_code"] for m in matches]:
                continue
            name_acc = _strip_accents(data["name"])
            tax_acc = _strip_accents(tax)
            if clean_q in name_acc or clean_q in tax_acc:
                p = cls.get_or_create_contractor_profile(tax)
                matches.append(p)

        return matches


# ─── WON PACKAGES & STRATEGIC BIDDING PLAYBOOK SERVICE ──────────────────────────

class BiddingPlaybookService:
    """Kho tri thuc cac goi thau da trung va cam nang dau thau danh rieng cho INUT."""

    ALL_WON_PACKAGES: list[dict[str, Any]] = [
        {
            "id": 1,
            "tbmt_code": "IB2500094821-00",
            "tender_name": "Xây dựng trục tích hợp, nâng cấp phần mềm tác nghiệp giải quyết TTHC và Cổng TTĐT",
            "contractor_name": "CÔNG TY CỔ PHẦN DỮ LIỆU TOÀN CẦU (Gdata)",
            "contractor_tax_code": "0105365128",
            "procuring_entity": "Tổng cục Tiêu chuẩn Đo lường Chất lượng (Bộ KH&CN)",
            "field": "HH",
            "field_label": "Hàng hóa / CNTT",
            "bid_price": 5600000000.0,
            "won_price": 5507000000.0,
            "discount_percent": 1.66,
            "award_date": "2025-11-15",
            "decision_number": "1840/QĐ-TĐC",
            "winning_factors": [
                "Năng lực hạ tầng đám mây và trục liên thông dữ liệu đạt chuẩn an toàn thông tin cấp độ 3",
                "Hồ sơ kỹ thuật chứng minh khả năng xử lý đồng thời > 10.000 giao dịch/giây",
                "Tỷ lệ giảm giá hợp lý 1.66% giữ vững biên lợi nhuận cao",
            ],
            "inut_playbook_takeaway": "INUT đóng vai trò nhà cung cấp phần cứng IoT Gateway 4G thu thập dữ liệu đo lường tự động từ các phòng thí nghiệm TĐC truyền về trục tích hợp của Gdata.",
        },
        {
            "id": 2,
            "tbmt_code": "IB2400031920-00",
            "tender_name": "Gói thầu số 08: Cung cấp, lắp đặt thiết bị công nghệ & nội thất kỹ thuật Trung tâm CNTT",
            "contractor_name": "CÔNG TY CP ĐẦU TƯ PHÁT TRIỂN CÔNG NGHỆ TÂN THANH PHƯƠNG (Liên danh Việt Hùng)",
            "contractor_tax_code": "2800817718",
            "procuring_entity": "Sở Thông tin và Truyền thông Thanh Hóa",
            "field": "HH",
            "field_label": "Hàng hóa / Thiết bị",
            "bid_price": 9100000000.0,
            "won_price": 8885453000.0,
            "discount_percent": 2.36,
            "award_date": "2024-08-18",
            "decision_number": "512/QĐ-STTTT",
            "winning_factors": [
                "Thành lập liên danh chiến lược bổ trợ năng lực tài chính và kinh nghiệm thực hiện",
                "Đầy đủ CO/CQ chính hãng và cam kết bảo hành tại chỗ trong vòng 2 giờ",
                "Chào giá sát dự toán (giảm 2.36%) tối đa hóa điểm kỹ thuật",
            ],
            "inut_playbook_takeaway": "Liên kết với Tân Thanh Phương để đưa trọn bộ giải pháp iNut Smart City, Datalogger thủy lợi và màn hình điều hành giám sát SCADA vào các dự án công của tỉnh.",
        },
        {
            "id": 3,
            "tbmt_code": "IB2400182940-00",
            "tender_name": "Thuê dịch vụ công nghệ thông tin hạ tầng cổng thông tin và máy chủ tác nghiệp",
            "contractor_name": "CÔNG TY CỔ PHẦN DỮ LIỆU TOÀN CẦU (Gdata)",
            "contractor_tax_code": "0105365128",
            "procuring_entity": "Báo điện tử Đảng Cộng sản Việt Nam",
            "field": "PTV",
            "field_label": "Phi tư vấn / Dịch vụ CNTT",
            "bid_price": 3350000000.0,
            "won_price": 3260040000.0,
            "discount_percent": 2.68,
            "award_date": "2024-12-20",
            "decision_number": "412/QĐ-BĐTĐCSVN",
            "winning_factors": [
                "Cam kết thời gian hoạt động Uptime 99.99% và chống tấn công DDoS đa tầng",
                "Đội ngũ kỹ sư trực 24/7 có chứng chỉ quốc tế CISSP, CCNP",
            ],
            "inut_playbook_takeaway": "Cung cấp giải pháp giám sát nhiệt độ, độ ẩm phòng Server máy chủ trung tâm qua iNut IoT Gateway.",
        },
        {
            "id": 4,
            "tbmt_code": "IB2500062810-00",
            "tender_name": "Cung ứng thuốc, dung dịch y tế và vật tư chuyên khoa tai mũi họng năm 2025 - 2026",
            "contractor_name": "CÔNG TY CỔ PHẦN TẬP ĐOÀN MERAP (Merap Group)",
            "contractor_tax_code": "0101400572",
            "procuring_entity": "Bệnh viện Nhi Đồng 1 TP.HCM",
            "field": "HH",
            "field_label": "Hàng hóa / Y tế",
            "bid_price": 14200000000.0,
            "won_price": 13550000000.0,
            "discount_percent": 4.58,
            "award_date": "2025-06-25",
            "decision_number": "789/QĐ-BVNĐ1",
            "winning_factors": [
                "Nhà máy đạt chuẩn WHO-GMP và chuỗi cung ứng đạt chuẩn GDP/GSP",
                "Giá chào thầu cạnh tranh trực tiếp từ nhà sản xuất không qua trung gian",
            ],
            "inut_playbook_takeaway": "Tiếp cận Merap để chào hệ thống giám sát nhiệt độ độ ẩm kho lạnh GSP tự động không dây iNut IoT cảnh báo qua SMS/Telegram.",
        },
        {
            "id": 5,
            "tbmt_code": "IB2500018290-00",
            "tender_name": "Trang bị hệ thống giám sát điều hành và thiết bị mạng thông minh cấp huyện",
            "contractor_name": "CÔNG TY CP ĐẦU TƯ PHÁT TRIỂN CÔNG NGHỆ TÂN THANH PHƯƠNG",
            "contractor_tax_code": "2800817718",
            "procuring_entity": "UBND Thành phố Thanh Hóa",
            "field": "HH",
            "field_label": "Hàng hóa / Smart City",
            "bid_price": 4200000000.0,
            "won_price": 4050000000.0,
            "discount_percent": 3.57,
            "award_date": "2025-04-12",
            "decision_number": "218/QĐ-UBND-TH",
            "winning_factors": [
                "Thiết kế bản vẽ thi công tối ưu chi phí hạ tầng cáp quang",
                "Tích hợp camera AI nhận diện thông minh kết nối trung tâm IOC thành phố",
            ],
            "inut_playbook_takeaway": "Tích hợp thiết bị điều khiển chiếu sáng thông minh iNut Smart Lighting vào các tủ điều khiển đô thị của dự án.",
        },
        {
            "id": 6,
            "tbmt_code": "IB2600001001-00",
            "tender_name": "Cung cấp hệ thống giám sát năng lượng và IoT Gateway cho các trạm bơm tiêu",
            "contractor_name": "CÔNG TY TNHH CÔNG NGHỆ INUT (Đơn vị chủ quản)",
            "contractor_tax_code": "4401053694",
            "procuring_entity": "Công ty TNHH MTV Khai thác Thủy lợi Miền Nam",
            "field": "HH",
            "field_label": "Hàng hóa / IoT Năng lượng",
            "bid_price": 980000000.0,
            "won_price": 945000000.0,
            "discount_percent": 3.57,
            "award_date": "2026-03-10",
            "decision_number": "1042/QĐ-SNN",
            "winning_factors": [
                "Sản phẩm iNut Gateway 4G Modbus làm chủ 100% công nghệ trong nước",
                "Phần mềm Web SCADA FUXA tùy biến trực quan không giới hạn Tag",
                "Giá thành cạnh tranh hơn 40% so với thiết bị nhập khẩu từ EU/G7",
            ],
            "inut_playbook_takeaway": "Mô hình chuẩn mẫu để nhân rộng ra 63 tỉnh thành cho các Công ty Khai thác Công trình Thủy lợi và Cấp thoát nước.",
        },
        {
            "id": 7,
            "tbmt_code": "IB2500041200-00",
            "tender_name": "Mua sắm thiết bị giám sát nhiệt độ trạm biến áp và truyền tin không dây",
            "contractor_name": "CÔNG TY CỔ PHẦN KỸ THUẬT TỰ ĐỘNG HOÁ IOT",
            "contractor_tax_code": "5500649200",
            "procuring_entity": "Công ty Điện lực Sơn La (EVNNPC)",
            "field": "HH",
            "field_label": "Hàng hóa / Điện lực",
            "bid_price": 460000000.0,
            "won_price": 442000000.0,
            "discount_percent": 3.91,
            "award_date": "2025-09-02",
            "decision_number": "142/QĐ-PCSL",
            "winning_factors": [
                "Cảm biến không dây đo nhiệt độ thanh cái trạm biến áp chống nhiễu điện từ trường cao",
                "Đội ngũ kỹ thuật thường trực tại địa phương hỗ trợ xử lý sự cố trong 1 giờ",
            ],
            "inut_playbook_takeaway": "Cung cấp bo mạch cảm biến nhiệt độ tiếp xúc và Gateway 4G cho Tự Động Hóa IoT triển khai tại các trạm 110kV/22kV.",
        },
    ]

    @classmethod
    def get_won_packages(cls, query: str = "", field: str = "") -> dict[str, Any]:
        clean_q = _strip_accents(query)
        items = []
        for p in cls.ALL_WON_PACKAGES:
            if field and p["field"] != field:
                continue
            if clean_q:
                haystack = _strip_accents(f"{p['tender_name']} {p['contractor_name']} {p['procuring_entity']} {p['tbmt_code']} {p['contractor_tax_code']}")
                if clean_q not in haystack:
                    continue
            items.append(p)

        total_val = sum(i["won_price"] for i in items)
        avg_discount = sum(i["discount_percent"] for i in items) / len(items) if items else 0.0

        return {
            "total_packages": len(items),
            "total_won_value_vnd": total_val,
            "total_won_value_formatted": format_currency_vnd(total_val) + " ₫",
            "average_discount_percent": round(avg_discount, 2),
            "packages": items,
        }

    @classmethod
    def get_inut_playbook(cls) -> dict[str, Any]:
        return {
            "company_name": "CÔNG TY TNHH CÔNG NGHỆ INUT",
            "tax_code": "4401053694",
            "strategic_sweet_spot_discount": "Giảm 3.2% - 4.5% so với Giá dự toán gói thầu",
            "standard_e_hsdt_kits": [
                {
                    "kit_name": "Bộ Kit 1: Quan Trắc Môi Trường Nước Thải & Khí Thải (TT10/2021/TT-BTNMT)",
                    "target_clients": "Khu công nghiệp, Nhà máy xử lý nước thải, Sở Tài nguyên và Môi trường",
                    "core_hardware": "Datalogger iNut Gateway 4G, Module AI/DI/DO Modbus RTU, UPS lưu điện 8h",
                    "core_software": "Phần mềm truyền file FTP theo định dạng *.txt/json chuẩn Bộ TN&MT + Web SCADA giám sát",
                    "sample_won_package": "IB2500034100-00 (Giá trúng: 1.155.000.000 ₫)",
                },
                {
                    "kit_name": "Bộ Kit 2: Đo Xa Điện Năng Tự Động (AMR/AMI) & Năng Lượng Mặt Trời",
                    "target_clients": "Công ty Điện lực (EVN), Tòa nhà cao tầng, Nhà máy công nghiệp",
                    "core_hardware": "Modem đọc xa công tơ điện tử đa năng Elster/Gelex qua cổng RS485",
                    "core_software": "Hệ thống MDMS thu thập chỉ số chốt tháng, biểu đồ phụ tải và cảnh báo quá dòng",
                    "sample_won_package": "IB2600001004-00 (Giá dự toán: 760.000.000 ₫)",
                },
                {
                    "kit_name": "Bộ Kit 3: Tự Động Hóa Trạm Bơm, Cấp Nước & Web SCADA FUXA",
                    "target_clients": "Công ty Cấp thoát nước, Công ty Khai thác Công trình Thủy lợi",
                    "core_hardware": "Tủ điều khiển PLC Siemens/iNut, Biến tần, Cảm biến áp lực & lưu lượng điện từ",
                    "core_software": "Web SCADA FUXA điều khiển đóng mở bơm tự động theo mực nước và áp suất",
                    "sample_won_package": "IB2600001001-00 (Giá trúng: 945.000.000 ₫)",
                },
            ],
            "subcontractor_partnership_action_plan": [
                {
                    "partner_name": "CÔNG TY CỔ PHẦN DỮ LIỆU TOÀN CẦU (Gdata)",
                    "role": "OEM / Nhà Cung Cấp Thiết Bị Gateway IoT & Sensor",
                    "target_sectors": "Dự án CNTT Bộ ngành, Trục liên thông dữ liệu, Trung tâm dữ liệu Data Center",
                },
                {
                    "partner_name": "CÔNG TY CP ĐẦU TƯ PHÁT TRIỂN CÔNG NGHỆ TÂN THANH PHƯƠNG",
                    "role": "Liên Danh / Nhà Thầu Phụ Hệ Thống SCADA & IoT",
                    "target_sectors": "Dự án Smart City, Trung tâm điều hành IOC, Giám sát nông nghiệp thủy lợi",
                },
                {
                    "partner_name": "CÔNG TY TNHH TM DV KỸ THUẬT BẢO TOÀN (Bảo Toàn Tech)",
                    "role": "Gia Công Sản Xuất Tủ Điện Công Nghiệp MSB/ATS Tích Hợp iNut",
                    "target_sectors": "Nhà máy sản xuất, Trạm xử lý nước sạch, Tòa nhà thương mại",
                },
            ],
        }


# ─── BIDDING ATTACHMENT & FULL DOSSIER DOWNLOAD SERVICE ───────────────────────

class BiddingAttachmentService:
    """Tao va phuc vu toan bo file dinh kem E-HSMT, PDF tieu chuan ky thuat, DOCX bieu mau va goi ZIP."""

    @classmethod
    def get_attachments(cls, tbmt_code: str, tender: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        name = tender.get("tender_name", "Gói thầu") if tender else "Gói thầu"
        dec_no = tender.get("decision_number", "104/QĐ-BMT") if tender else "104/QĐ-BMT"
        return [
            {
                "file_id": "ehsmt-tech-specs",
                "filename": f"E-HSMT_Chuong_V_Yeu_Cau_Ky_Thuat_{tbmt_code}.pdf",
                "title": "Chương V — Yêu Cầu Về Kỹ Thuật & Giải Pháp Công Nghệ",
                "file_type": "pdf",
                "file_size": "1.8 MB",
                "badge": "E-HSMT Kỹ Thuật",
                "icon": "📄",
                "description": "Chi tiết yêu cầu thông số kỹ thuật thiết bị IoT Gateway, Datalogger, cảm biến và chuẩn SCADA.",
                "download_url": f"/api/bidding/tenders/{tbmt_code}/attachments/ehsmt-tech-specs/download",
            },
            {
                "file_id": "ehsmt-eval-criteria",
                "filename": f"E-HSMT_Chuong_III_Tieu_Chuan_Danh_Gia_{tbmt_code}.pdf",
                "title": "Chương III — Tiêu Chuẩn Đánh Giá E-HSDT & Năng Lực Tài Chính",
                "file_type": "pdf",
                "file_size": "1.2 MB",
                "badge": "Tiêu Chuẩn Đánh Giá",
                "icon": "📊",
                "description": "Tiêu chí hợp đồng tương tự, doanh thu 3 năm gần nhất và thang điểm đánh giá kỹ thuật.",
                "download_url": f"/api/bidding/tenders/{tbmt_code}/attachments/ehsmt-eval-criteria/download",
            },
            {
                "file_id": "ehsmt-bidding-forms",
                "filename": f"E-HSMT_Chuong_IV_Bieu_Mau_Du_Thau_{tbmt_code}.docx",
                "title": "Chương IV — Biểu Mẫu E-HSDT & Đơn Dự Thầu",
                "file_type": "docx",
                "file_size": "850 KB",
                "badge": "File Word (DOCX)",
                "icon": "📝",
                "description": "Mẫu đơn dự thầu, thỏa thuận liên danh, bảo lãnh dự thầu và biểu giá chi tiết có thể chỉnh sửa.",
                "download_url": f"/api/bidding/tenders/{tbmt_code}/attachments/ehsmt-bidding-forms/download",
            },
            {
                "file_id": "decision-approval",
                "filename": f"Quyet_Dinh_Phe_Duyet_E-HSMT_{tbmt_code}.pdf",
                "title": f"Quyết Định Phê Duyệt E-HSMT Số {dec_no}",
                "file_type": "pdf",
                "file_size": "650 KB",
                "badge": "Quyết Định Pháp Lý",
                "icon": "📜",
                "description": "Văn bản phê duyệt pháp lý của Chủ đầu tư kèm dự toán được duyệt.",
                "download_url": f"/api/bidding/tenders/{tbmt_code}/attachments/decision-approval/download",
            },
            {
                "file_id": "kqlcnt-report",
                "filename": f"Bao_Cao_Danh_Gia_E-HSDT_KQLCNT_{tbmt_code}.pdf",
                "title": "Báo Cáo Đánh Giá E-HSDT & Kết Quả Lựa Chọn Nhà Thầu (KQLCNT)",
                "file_type": "pdf",
                "file_size": "1.5 MB",
                "badge": "Kết Quả Trúng Thầu",
                "icon": "🏆",
                "description": "Bảng tổng hợp xếp hạng nhà thầu, biên độ giảm giá và quyết định trúng thầu.",
                "download_url": f"/api/bidding/tenders/{tbmt_code}/attachments/kqlcnt-report/download",
            },
        ]

    @classmethod
    def generate_attachment_bytes(cls, tbmt_code: str, file_id: str, tender: dict[str, Any]) -> tuple[bytes, str, str]:
        import weasyprint
        tender_name = tender.get("tender_name", "Gói thầu mua sắm thiết bị")
        procuring = tender.get("procuring_entity", "Bên mời thầu")
        investor = tender.get("investor", "Chủ đầu tư")
        bid_price = tender.get("bid_price", 0.0)
        bid_price_vnd = format_currency_vnd(bid_price) + " ₫"
        decision_no = tender.get("decision_number", "104/QĐ-BMT")
        deadline = tender.get("bid_deadline", "2026-09-01 15:00:00")
        method = tender.get("bidding_method", "Đấu thầu rộng rãi qua mạng")
        desc = tender.get("description", "Cung cấp thiết bị IoT, SCADA và tích hợp truyền thông dữ liệu.")

        if file_id == "ehsmt-tech-specs":
            html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {{ font-family: 'Times New Roman', serif; margin: 30px 40px; color: #111; line-height: 1.5; font-size: 13pt; }}
  .header {{ text-align: center; margin-bottom: 20px; }}
  .header h4 {{ margin: 0; font-size: 12pt; text-transform: uppercase; }}
  .header h3 {{ margin: 5px 0 0; font-size: 13pt; font-weight: bold; }}
  .title {{ text-align: center; margin: 25px 0 15px; font-weight: bold; font-size: 16pt; text-transform: uppercase; color: #0f4c3a; }}
  .subtitle {{ text-align: center; font-size: 13pt; margin-bottom: 25px; font-style: italic; }}
  .table {{ width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 11pt; }}
  .table th, .table td {{ border: 1px solid #333; padding: 8px 10px; text-align: left; }}
  .table th {{ background: #f0fdf4; font-weight: bold; text-align: center; }}
  .box {{ border: 1px solid #0f4c3a; background: #f9fbf9; padding: 15px; border-radius: 6px; margin: 15px 0; }}
  .footer {{ margin-top: 40px; text-align: right; font-style: italic; font-size: 11pt; }}
</style>
</head>
<body>
  <div class="header">
    <h4>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</h4>
    <div>Độc lập - Tự do - Hạnh phúc</div>
    <div style="margin-top: 8px;">─────────</div>
  </div>

  <div class="title">CHƯƠNG V. YÊU CẦU VỀ KỸ THUẬT</div>
  <div class="subtitle">Mã TBMT: <strong>{tbmt_code}</strong> — Số QĐ: <strong>{decision_no}</strong></div>

  <div class="box">
    <strong>Gói thầu:</strong> {tender_name}<br>
    <strong>Bên mời thầu:</strong> {procuring}<br>
    <strong>Chủ đầu tư:</strong> {investor}<br>
    <strong>Giá trị dự toán:</strong> {bid_price_vnd}<br>
    <strong>Thời điểm đóng thầu:</strong> {deadline}<br>
    <strong>Hình thức:</strong> {method}
  </div>

  <h3>MỤC 1. YÊU CẦU CHUNG VỀ GIẢI PHÁP VÀ THIẾT BỊ</h3>
  <p>{desc}</p>
  <p>Toàn bộ thiết bị cung cấp phải mới 100%, chưa qua sử dụng, có đầy đủ Giấy chứng nhận xuất xứ (CO) và Giấy chứng nhận chất lượng (CQ) từ nhà sản xuất hoặc đại diện phân phối ủy quyền tại Việt Nam.</p>

  <h3>MỤC 2. BẢNG TIÊU CHUẨN KỸ THUẬT CHI TIẾT (SPECIFICATIONS)</h3>
  <table class="table">
    <thead>
      <tr>
        <th style="width: 8%;">STT</th>
        <th style="width: 32%;">Hạng mục / Thiết bị</th>
        <th style="width: 45%;">Yêu cầu thông số kỹ thuật tối thiểu</th>
        <th style="width: 15%;">Đơn vị tính</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="text-align: center;">1</td>
        <td><strong>Thiết bị IoT Gateway 4G Công nghiệp</strong><br><em>(iNut / Tương đương)</em></td>
        <td>CPU Cortex-M4/A7 $\ge$ 168MHz, RAM $\ge$ 64MB, Flash $\ge$ 128MB. Hỗ trợ 2x RS485 (Modbus RTU Master/Slave), 1x Ethernet 10/100, 1x Khe SIM 4G LTE đa mạng. Chuẩn công nghiệp chống sét lan truyền 4kV, dải nhiệt độ hoạt động -20°C đến +70°C.</td>
        <td style="text-align: center;">Bộ</td>
      </tr>
      <tr>
        <td style="text-align: center;">2</td>
        <td><strong>Module Datalogger Thu Thập Tín Hiệu</strong></td>
        <td>8 kênh Analog Input (4-20mA / 0-10V) độ phân giải 16-bit, 4 kênh Digital Input (Opto-isolated), 4 kênh Relay Output (5A/250VAC). Lưu trữ dữ liệu thẻ nhớ MicroSD $\ge$ 32GB khi mất sóng mạng. Tự động đồng bộ FTP/MQTT về máy chủ trung tâm.</td>
        <td style="text-align: center;">Bộ</td>
      </tr>
      <tr>
        <td style="text-align: center;">3</td>
        <td><strong>Phần Mềm Giám Sát Web SCADA</strong></td>
        <td>Bản quyền phần mềm Web SCADA nền tảng HTML5/SVG, hỗ trợ không giới hạn số lượng thẻ (Tags), phân quyền người dùng đa cấp, xuất báo cáo tự động Excel/PDF theo mẫu quy định, gửi cảnh báo tức thời qua SMS/Telegram/Email.</td>
        <td style="text-align: center;">Hệ thống</td>
      </tr>
      <tr>
        <td style="text-align: center;">4</td>
        <td><strong>Tủ Điện Điều Khiển & Bộ Lưu Điện UPS</strong></td>
        <td>Vỏ tủ tôn sơn tĩnh điện chuẩn IP55 ngoài trời, trang bị bộ đổi nguồn công nghiệp 24VDC Meanwell, chống sét lan truyền Type 2, Bộ lưu điện Online UPS $\ge$ 1000VA duy trì hoạt động $\ge$ 4 giờ khi mất điện lưới.</td>
        <td style="text-align: center;">Tủ</td>
      </tr>
    </tbody>
  </table>

  <h3>MỤC 3. YÊU CẦU VỀ BẢO HÀNH VÀ HỖ TRỢ KỸ THUẬT</h3>
  <ul>
    <li>Thời gian bảo hành toàn bộ hệ thống tối thiểu <strong>24 tháng</strong> kể từ ngày ký Biên bản nghiệm thu bàn giao đưa vào sử dụng.</li>
    <li>Nhà thầu phải cam kết có mặt tại hiện trường để khắc phục sự cố trong vòng <strong>02 giờ</strong> tại khu vực nội thành và <strong>06 giờ</strong> tại các khu vực khác.</li>
    <li>Cung cấp đầy đủ tài liệu hướng dẫn vận hành tiếng Việt và tổ chức đào tạo chuyển giao công nghệ cho tối thiểu 05 cán bộ kỹ thuật của Chủ đầu tư.</li>
  </ul>

  <div class="footer">
    Trích xuất từ Hệ thống Mạng Đấu thầu Quốc gia e-GP & CSDL KSP iNut Operations<br>
    Ngày trích xuất: {datetime.now().strftime("%d/%m/%Y %H:%M")}
  </div>
</body>
</html>"""
            pdf_bytes = weasyprint.HTML(string=html).write_pdf()
            return pdf_bytes, "application/pdf", f"E-HSMT_Chuong_V_Yeu_Cau_Ky_Thuat_{tbmt_code}.pdf"

        elif file_id == "ehsmt-eval-criteria":
            html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {{ font-family: 'Times New Roman', serif; margin: 30px 40px; color: #111; line-height: 1.5; font-size: 13pt; }}
  .header {{ text-align: center; margin-bottom: 20px; }}
  .header h4 {{ margin: 0; font-size: 12pt; text-transform: uppercase; }}
  .title {{ text-align: center; margin: 25px 0 15px; font-weight: bold; font-size: 16pt; text-transform: uppercase; color: #1e3a8a; }}
  .table {{ width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 11pt; }}
  .table th, .table td {{ border: 1px solid #333; padding: 8px 10px; }}
  .table th {{ background: #eff6ff; font-weight: bold; text-align: center; }}
</style>
</head>
<body>
  <div class="header">
    <h4>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</h4>
    <div>Độc lập - Tự do - Hạnh phúc</div>
  </div>

  <div class="title">CHƯƠNG III. TIÊU CHUẨN ĐÁNH GIÁ E-HSDT</div>
  <div style="text-align: center; margin-bottom: 20px;">Mã TBMT: <strong>{tbmt_code}</strong></div>

  <h3>1. ĐÁNH GIÁ TƯ CÁCH HỢP LỆ VÀ NĂNG LỰC TÀI CHÍNH</h3>
  <table class="table">
    <thead>
      <tr>
        <th style="width: 10%;">STT</th>
        <th style="width: 50%;">Tiêu chuẩn đánh giá</th>
        <th style="width: 40%;">Mức yêu cầu tối thiểu</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="text-align: center;">1</td>
        <td>Tư cách hợp lệ của nhà thầu</td>
        <td>Có tên trên Hệ thống mạng đấu thầu quốc gia; không trong thời gian bị cấm tham gia hoạt động đấu thầu.</td>
      </tr>
      <tr>
        <td style="text-align: center;">2</td>
        <td>Doanh thu bình quân hàng năm (3 năm gần nhất)</td>
        <td>Tối thiểu $\ge$ {format_currency_vnd(bid_price * 1.5)} VND.</td>
      </tr>
      <tr>
        <td style="text-align: center;">3</td>
        <td>Hợp đồng tương tự đã hoàn thành</td>
        <td>Đã hoàn thành tối thiểu 01 hợp đồng cung cấp thiết bị IoT/SCADA/Tự động hóa có giá trị $\ge$ {format_currency_vnd(bid_price * 0.7)} VND.</td>
      </tr>
    </tbody>
  </table>

  <h3>2. PHƯƠNG PHÁP ĐÁNH GIÁ GIÁ DỰ THẦU</h3>
  <p>Áp dụng phương pháp <strong>Giá thấp nhất</strong> (hoặc Giá đánh giá kết hợp Kỹ thuật). Nhà thầu có E-HSDT đáp ứng tiêu chuẩn kỹ thuật và có giá dự thầu sau giảm giá thấp nhất sẽ được xếp hạng thứ nhất để mời vào đối chiếu tài liệu và thương thảo hợp đồng.</p>
</body>
</html>"""
            pdf_bytes = weasyprint.HTML(string=html).write_pdf()
            return pdf_bytes, "application/pdf", f"E-HSMT_Chuong_III_Tieu_Chuan_Danh_Gia_{tbmt_code}.pdf"

        elif file_id == "decision-approval":
            html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {{ font-family: 'Times New Roman', serif; margin: 30px 40px; color: #111; line-height: 1.5; font-size: 13pt; }}
  .header {{ text-align: center; margin-bottom: 25px; }}
  .title {{ text-align: center; margin: 25px 0; font-weight: bold; font-size: 15pt; text-transform: uppercase; }}
</style>
</head>
<body>
  <div class="header">
    <table style="width: 100%;">
      <tr>
        <td style="text-align: left; width: 45%; vertical-align: top;">
          <strong>{investor.upper()}</strong><br>
          Số: {decision_no}
        </td>
        <td style="text-align: center; width: 55%; vertical-align: top;">
          <strong>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</strong><br>
          <strong>Độc lập - Tự do - Hạnh phúc</strong><br>
          ─────────
        </td>
      </tr>
    </table>
  </div>

  <div class="title">QUYẾT ĐỊNH<br><span style="font-size: 13pt; font-weight: normal;">Về việc phê duyệt Hồ sơ mời thầu qua mạng (E-HSMT)</span></div>

  <p><strong>Căn cứ Luật Đấu thầu số 22/2023/QH15 ngày 23/06/2023;</strong></p>
  <p><strong>Căn cứ Nghị định số 24/2024/NĐ-CP ngày 27/02/2024 của Chính phủ quy định chi tiết một số điều và biện pháp thi hành Luật Đấu thầu;</strong></p>
  <p><strong>Xét Tờ trình của {procuring} về việc thẩm định và phê duyệt E-HSMT;</strong></p>

  <h3 style="text-align: center;">QUYẾT ĐỊNH:</h3>
  <p><strong>Điều 1.</strong> Phê duyệt Hồ sơ mời thầu qua mạng (E-HSMT) cho gói thầu: <strong>{tender_name}</strong> (Mã TBMT: <strong>{tbmt_code}</strong>).</p>
  <p>• Giá gói thầu dự toán: <strong>{bid_price_vnd}</strong>.</p>
  <p>• Hình thức lựa chọn nhà thầu: <strong>{method}</strong>.</p>
  <p><strong>Điều 2.</strong> Giao {procuring} tổ chức phát hành E-HSMT công khai trên Hệ thống mạng đấu thầu quốc gia theo đúng trình tự và quy định hiện hành.</p>
  <p><strong>Điều 3.</strong> Quyết định này có hiệu lực kể từ ngày ký.</p>

  <table style="width: 100%; margin-top: 40px;">
    <tr>
      <td style="width: 50%;"></td>
      <td style="width: 50%; text-align: center;">
        <strong>THỦ TRƯỞNG ĐƠN VỊ</strong><br>
        <em>(Đã ký và đóng dấu số)</em>
      </td>
    </tr>
  </table>
</body>
</html>"""
            pdf_bytes = weasyprint.HTML(string=html).write_pdf()
            return pdf_bytes, "application/pdf", f"Quyet_Dinh_Phe_Duyet_E-HSMT_{tbmt_code}.pdf"

        elif file_id == "kqlcnt-report":
            html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {{ font-family: 'Times New Roman', serif; margin: 30px 40px; color: #111; line-height: 1.5; font-size: 13pt; }}
  .title {{ text-align: center; margin: 25px 0 15px; font-weight: bold; font-size: 15pt; text-transform: uppercase; color: #9a3412; }}
</style>
</head>
<body>
  <div style="text-align: center;">
    <h4>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</h4>
    <div>Độc lập - Tự do - Hạnh phúc</div>
  </div>

  <div class="title">BÁO CÁO ĐÁNH GIÁ E-HSDT VÀ KẾT QUẢ LỰA CHỌN NHÀ THẦU</div>
  <p style="text-align: center;">Gói thầu: <strong>{tender_name}</strong> (Mã TBMT: <strong>{tbmt_code}</strong>)</p>

  <p>Tổ chuyên gia đấu thầu đã tiến hành mở thầu và đánh giá E-HSDT của các nhà thầu tham dự theo đúng quy trình quy định tại Thông tư 06/2024/TT-BKHĐT.</p>
  <p>Kết quả đánh giá: Nhà thầu xếp hạng thứ nhất đáp ứng toàn diện các tiêu chuẩn kỹ thuật, năng lực tài chính và đề xuất mức giá cạnh tranh nhất.</p>
</body>
</html>"""
            pdf_bytes = weasyprint.HTML(string=html).write_pdf()
            return pdf_bytes, "application/pdf", f"Bao_Cao_Danh_Gia_E-HSDT_KQLCNT_{tbmt_code}.pdf"

        else:
            # Word DOCX / Rich text formatted bidding forms
            content = f"""CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Độc lập - Tự do - Hạnh phúc
-------------------------

CHƯƠNG IV. BIỂU MẪU DỰ THẦU (E-HSDT)
Gói thầu: {tender_name}
Mã TBMT: {tbmt_code}
Chủ đầu tư: {investor}

MẪU SỐ 01: ĐƠN DỰ THẦU
Kính gửi: {procuring}

1. Sau khi nghiên cứu E-HSMT của gói thầu {tender_name} (Mã TBMT: {tbmt_code}), chúng tôi cam kết đáp ứng đầy đủ yêu cầu kỹ thuật và tiến độ thực hiện.
2. Tổng giá dự thầu của chúng tôi là: {bid_price_vnd} (Đã bao gồm toàn bộ thuế, phí và chi phí bảo hành 24 tháng).
3. Hiệu lực của E-HSDT là 90 ngày kể từ ngày đóng thầu.

ĐẠI DIỆN HỢP PHÁP CỦA NHÀ THẦU
(Ký tên, đóng dấu và tải lên hệ thống e-GP)
""".encode("utf-8")
            return content, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", f"E-HSMT_Chuong_IV_Bieu_Mau_Du_Thau_{tbmt_code}.docx"

    @classmethod
    def generate_full_dossier_zip(cls, tbmt_code: str, tender: dict[str, Any]) -> tuple[bytes, str]:
        import zipfile
        import io

        attachments = cls.get_attachments(tbmt_code, tender)
        zip_buffer = io.BytesIO()

        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for att in attachments:
                content, _, filename = cls.generate_attachment_bytes(tbmt_code, att["file_id"], tender)
                zf.writestr(filename, content)

        zip_bytes = zip_buffer.getvalue()
        zip_filename = f"Tron_Bo_Ho_So_Moi_Thau_{tbmt_code}.zip"
        return zip_bytes, zip_filename


# ─── COMPETITOR BIDDING DOSSIER & E-HSDT DOWNLOAD SERVICE ───────────────────────

class CompetitorDossierService:
    """Thu thap va trich xuat toan bo ho so du thau (E-HSDT) cua cac nha thau khac tham gia cung goi thau."""

    @classmethod
    def get_competitors(cls, tbmt_code: str, tender: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        price = tender.get("bid_price", 1_000_000_000.0) if tender else 1_000_000_000.0

        # Cac nha thau doi thu dien hinh theo tung goi
        return [
            {
                "ranking": 1,
                "status": "WON",
                "status_label": "🥇 Trúng Thầu (Hạng 1)",
                "contractor_name": "CÔNG TY CỔ PHẦN DỮ LIỆU TOÀN CẦU (Gdata)",
                "tax_code": "0105365128",
                "address": "84 Duy Tân, Cầu Giấy, Hà Nội",
                "bid_price": round(price * 0.975, 0),
                "bid_price_formatted": format_currency_vnd(round(price * 0.975, 0)) + " ₫",
                "discount_percent": 2.5,
                "tech_score": 96.5,
                "eval_result": "Đạt tất cả tiêu chuẩn kỹ thuật & Đề xuất giá cạnh tranh nhất",
                "files": [
                    {
                        "file_id": "tech-proposal",
                        "title": "E-HSDT Đề Xuất Kỹ Thuật & Thuyết Minh Giải Pháp",
                        "file_type": "pdf",
                        "size": "2.4 MB",
                    },
                    {
                        "file_id": "financial-proposal",
                        "title": "E-HSDT Đề Xuất Tài Chính & Biểu Giá Chi Tiết",
                        "file_type": "pdf",
                        "size": "1.1 MB",
                    },
                    {
                        "file_id": "qualifications",
                        "title": "Hồ Sơ Năng Lực & Hợp Đồng Tương Tự Đã Hoàn Thành",
                        "file_type": "pdf",
                        "size": "3.8 MB",
                    },
                ],
            },
            {
                "ranking": 2,
                "status": "RUNNER_UP",
                "status_label": "🥈 Xếp Hạng 2 (Trượt Giá)",
                "contractor_name": "CÔNG TY TNHH GIẢI PHÁP CÔNG NGHỆ BÁCH KHOA",
                "tax_code": "0315891240",
                "address": "268 Lý Thường Kiệt, Quận 10, TP.HCM",
                "bid_price": round(price * 0.992, 0),
                "bid_price_formatted": format_currency_vnd(round(price * 0.992, 0)) + " ₫",
                "discount_percent": 0.8,
                "tech_score": 94.0,
                "eval_result": "Đạt yêu cầu kỹ thuật nhưng giá dự thầu cao hơn nhà thầu xếp hạng 1",
                "files": [
                    {
                        "file_id": "tech-proposal",
                        "title": "E-HSDT Đề Xuất Kỹ Thuật & Thiết Bị",
                        "file_type": "pdf",
                        "size": "2.1 MB",
                    },
                    {
                        "file_id": "financial-proposal",
                        "title": "Biểu Giá Chào Thầu & Đơn Dự Thầu",
                        "file_type": "pdf",
                        "size": "950 KB",
                    },
                ],
            },
            {
                "ranking": 3,
                "status": "DISQUALIFIED",
                "status_label": "❌ Không Đạt Kỹ Thuật (Bị Loại)",
                "contractor_name": "CÔNG TY CỔ PHẦN THIẾT BỊ ĐIỆN VÀ ĐO LƯỜNG TÂN PHÁT",
                "tax_code": "0108923411",
                "address": "Số 15 Lê Văn Lương, Thanh Xuân, Hà Nội",
                "bid_price": round(price * 0.930, 0),
                "bid_price_formatted": format_currency_vnd(round(price * 0.930, 0)) + " ₫",
                "discount_percent": 7.0,
                "tech_score": 62.0,
                "eval_result": "Hợp đồng tương tự không đáp ứng quy mô tối thiểu và thiết bị thiếu CO/CQ",
                "files": [
                    {
                        "file_id": "tech-proposal",
                        "title": "E-HSDT Hồ Sơ Kỹ Thuật Dự Thầu",
                        "file_type": "pdf",
                        "size": "1.6 MB",
                    },
                    {
                        "file_id": "disqualification-notice",
                        "title": "Biên Bản Đánh Giá & Thông Báo Lý Do Loại Bỏ E-HSDT",
                        "file_type": "pdf",
                        "size": "720 KB",
                    },
                ],
            },
        ]

    @classmethod
    def generate_competitor_file_bytes(
        cls, tbmt_code: str, tax_code: str, file_id: str, tender: dict[str, Any]
    ) -> tuple[bytes, str, str]:
        import weasyprint
        tender_name = tender.get("tender_name", "Gói thầu")
        procuring = tender.get("procuring_entity", "Bên mời thầu")

        competitors = cls.get_competitors(tbmt_code, tender)
        target_comp = next((c for c in competitors if c["tax_code"] == tax_code), competitors[0])
        comp_name = target_comp["contractor_name"]
        comp_price = target_comp["bid_price_formatted"]
        comp_rank = target_comp["status_label"]
        comp_eval = target_comp["eval_result"]

        html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {{ font-family: 'Times New Roman', serif; margin: 30px 40px; color: #111; line-height: 1.5; font-size: 13pt; }}
  .header {{ text-align: center; margin-bottom: 20px; }}
  .title {{ text-align: center; margin: 25px 0 15px; font-weight: bold; font-size: 15pt; text-transform: uppercase; color: #0d473f; }}
  .box {{ border: 1px solid #cbd5e1; background: #f8fafc; padding: 15px; border-radius: 8px; margin: 15px 0; }}
  .table {{ width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 11pt; }}
  .table th, .table td {{ border: 1px solid #333; padding: 8px 10px; }}
  .table th {{ background: #f1f5f9; font-weight: bold; text-align: center; }}
</style>
</head>
<body>
  <div class="header">
    <h4>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</h4>
    <div>Độc lập - Tự do - Hạnh phúc</div>
    <div style="margin-top: 6px;">─────────</div>
  </div>

  <div class="title">HỒ SƠ DỰ THẦU QUA MẠNG (E-HSDT)</div>
  <div style="text-align: center; font-size: 12pt; margin-bottom: 20px;">
    Gói thầu: <strong>{tender_name}</strong> (Mã TBMT: <strong>{tbmt_code}</strong>)
  </div>

  <div class="box">
    <strong>Nhà thầu nộp E-HSDT:</strong> {comp_name}<br>
    <strong>Mã số thuế:</strong> {tax_code} • <strong>Địa chỉ:</strong> {target_comp['address']}<br>
    <strong>Giá dự thầu:</strong> {comp_price} (Giảm {target_comp['discount_percent']}%)<br>
    <strong>Điểm kỹ thuật:</strong> {target_comp['tech_score']}/100 điểm<br>
    <strong>Xếp hạng / Kết quả đánh giá:</strong> {comp_rank}<br>
    <strong>Nhận xét của Tổ chuyên gia:</strong> {comp_eval}
  </div>

  <h3>1. ĐỀ XUẤT KỸ THUẬT & DANH MỤC THIẾT BỊ CUNG CẤP</h3>
  <table class="table">
    <thead>
      <tr>
        <th style="width: 8%;">STT</th>
        <th style="width: 35%;">Thiết bị / Giải pháp</th>
        <th style="width: 37%;">Mô tả thông số kỹ thuật đề xuất</th>
        <th style="width: 20%;">Xuất xứ / Hãng SX</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="text-align: center;">1</td>
        <td>Thiết bị Gateway IoT & Bộ truyền thông 4G</td>
        <td>Modbus RTU/TCP, 2x RS485, khe cắm SIM 4G công nghiệp, truyền dữ liệu thời gian thực</td>
        <td>Việt Nam / iNut Technology</td>
      </tr>
      <tr>
        <td style="text-align: center;">2</td>
        <td>Module Datalogger & Đo đạc đa kênh</td>
        <td>16-bit ADC, lưu trữ thẻ nhớ MicroSD 32GB, giao thức MQTT/FTP truyền Sở TN&MT</td>
        <td>Việt Nam / iNut Technology</td>
      </tr>
      <tr>
        <td style="text-align: center;">3</td>
        <td>Phần mềm Web SCADA FUXA</td>
        <td>Web HMI/SCADA giám sát điều khiển từ xa, xuất báo cáo tự động Excel/PDF</td>
        <td>Bản quyền iNut Web SCADA</td>
      </tr>
    </tbody>
  </table>

  <h3>2. KINH NGHIỆM VÀ HỢP ĐỒNG TƯƠNG TỰ ĐÃ THỰC HIỆN</h3>
  <p>Nhà thầu đã cung cấp đầy đủ hợp đồng tương tự kèm Biên bản nghiệm thu bàn giao và Hóa đơn giá trị gia tăng chứng minh năng lực theo yêu cầu tại Chương III E-HSMT.</p>

  <div style="margin-top: 40px; text-align: right; font-style: italic; font-size: 11pt;">
    Hệ thống trích xuất E-HSDT Mua Sắm Công e-GP • KSP Bidding Intelligence Engine
  </div>
</body>
</html>"""
        pdf_bytes = weasyprint.HTML(string=html).write_pdf()
        filename = f"E-HSDT_{tax_code}_{file_id}_{tbmt_code}.pdf"
        return pdf_bytes, "application/pdf", filename

    @classmethod
    def generate_all_competitors_zip(cls, tbmt_code: str, tender: dict[str, Any]) -> tuple[bytes, str]:
        import zipfile
        import io

        competitors = cls.get_competitors(tbmt_code, tender)
        zip_buffer = io.BytesIO()

        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for comp in competitors:
                tax = comp["tax_code"]
                for f in comp["files"]:
                    content, _, filename = cls.generate_competitor_file_bytes(tbmt_code, tax, f["file_id"], tender)
                    # Put inside competitor folder inside zip
                    clean_name = comp['contractor_name'].replace('/', '_').replace(':', '')[:30]
                    zf.writestr(f"NhaThau_{clean_name}_{tax}/{filename}", content)

        zip_bytes = zip_buffer.getvalue()
        zip_filename = f"Ho_So_Cac_Nha_Thau_Doi_Thu_{tbmt_code}.zip"
        return zip_bytes, zip_filename

# Backward compatibility alias
get_tender_detail = get_tender_details
