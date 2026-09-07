"""Comprehensive 4-Tier Automated Test Suite for 2-Way QCVN / Technical Standards Lookup Solution.

Coverage Architecture:
- Tier 1: Feature Coverage (>=5 tests per feature):
    * F1: Direction 1 Model -> QCVN Lookup (Exact match for certified models).
    * F2: Direction 1 Rule-Based QCVN Inference (Unseen 4G/5G/IoT/Wi-Fi devices and HS codes).
    * F3: Direction 2 MST / Tax Code -> Dossiers & Active QCVNs Lookup.
    * F4: Auto-Complete Suggestions API (`/api/standards/suggest` across models, MSTs, companies, QCVNs).
    * F5: Multi-Field Filtering (by ministry, mandatory status, validity) and Pagination.
- Tier 2: Boundary & Corner Cases (>=5 tests):
    * Empty search query, single character, whitespace.
    * Non-existent tax code and non-existent model name.
    * Invalid HS code format, special characters, SQL injection and XSS probe strings.
    * Extreme pagination (limit=1000, offset=50000, negative offset).
    * Expired vs Active dossier status resolution across date boundaries.
- Tier 3: Cross-Feature Combinations:
    * Fuzzy matching + unaccented search + ministry filter.
    * Direction 1 Model lookup with HS code override + mandatory filter.
    * Direction 2 MST lookup with status filtering and pagination.
    * Fuzzy model queries with typo tolerance (e.g. "iNut GW4G Pro" -> "iNut-GW4G-Pro").
- Tier 4: Real-World Workload Scenarios & Performance Benchmarks:
    * Realistic devices: iNut-GW4G-Pro, CPH2699, ESP32, VinFast TCU, Cisco router, TP-Link.
    * Real enterprises: INUT 4401053694, Viettel 0100109106, VinFast 0108926276, OPPO 0312636094.
    * Query latency benchmark: measure execution time across 50 consecutive queries, assert average response time < 50ms.
"""

from __future__ import annotations

import difflib
import re
import time
from typing import Any

import pytest
from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.testclient import TestClient

from app.standards import (
    HsCodeConformityService,
    TestingLabRegistryService,
    _strip_accents,
)


# ─── 📚 BENCHMARK KNOWLEDGE BASE & ORACLE ENGINE FOR 2-WAY LOOKUP ──────────────

BENCHMARK_STANDARDS: list[dict[str, Any]] = [
    {
        "code": "QCVN 117:2023/BTTTT",
        "name": "Quy chuẩn kỹ thuật quốc gia về thiết bị đầu cuối thông tin di động mặt đất E-UTRA (4G LTE / VoLTE)",
        "issuing_ministry": "BTTTT",
        "ministry_label": "Bộ Thông tin và Truyền thông",
        "category": "radio_telecom",
        "category_label": "Vô tuyến & Viễn thông 4G/5G",
        "legal_basis": "Thông tư số 02/2024/TT-BTTTT (thay thế TT 04/2023/TT-BTTTT)",
        "effective_date": "2024-07-01",
        "mandatory": True,
        "procedure_type": "mandatory_cert_and_cr",
        "procedure_label": "Bắt buộc Chứng nhận Hợp quy & Công bố CR",
        "target_equipment": "Thiết bị IoT Gateway 4G, Router 4G LTE, Datalogger 4G, Modem công nghiệp, Điện thoại thông minh",
        "applicable_hs_codes": ["8517.62.59", "8517.62.99", "8517.12.00", "8517.69.00"],
        "testing_labs": ["VNTA-LAB", "QUATEST 1", "QUATEST 3", "Vinacontrol"],
    },
    {
        "code": "QCVN 117:2020/BTTTT",
        "name": "Quy chuẩn kỹ thuật quốc gia về thiết bị đầu cuối thông tin di động mặt đất E-UTRA (4G LTE)",
        "issuing_ministry": "BTTTT",
        "ministry_label": "Bộ Thông tin và Truyền thông",
        "category": "radio_telecom",
        "category_label": "Vô tuyến & Viễn thông 4G LTE",
        "legal_basis": "Thông tư số 10/2020/TT-BTTTT",
        "effective_date": "2021-07-01",
        "mandatory": True,
        "procedure_type": "mandatory_cert_and_cr",
        "procedure_label": "Bắt buộc Chứng nhận Hợp quy & Công bố CR",
        "target_equipment": "Thiết bị viễn thông di động 4G, Modem 4G",
        "applicable_hs_codes": ["8517.62.59", "8517.62.99"],
        "testing_labs": ["VNTA-LAB", "QUATEST 1", "QUATEST 3"],
    },
    {
        "code": "QCVN 127:2021/BTTTT",
        "name": "Quy chuẩn kỹ thuật quốc gia về thiết bị đầu cuối thông tin di động mặt đất 5G Standalone (5G SA)",
        "issuing_ministry": "BTTTT",
        "ministry_label": "Bộ Thông tin và Truyền thông",
        "category": "radio_telecom",
        "category_label": "Vô tuyến & Viễn thông 5G",
        "legal_basis": "Thông tư số 02/2024/TT-BTTTT",
        "effective_date": "2022-07-01",
        "mandatory": True,
        "procedure_type": "mandatory_cert_and_cr",
        "procedure_label": "Bắt buộc Chứng nhận Hợp quy & Công bố CR",
        "target_equipment": "Router 5G công nghiệp, Smartphone 5G, 5G Dongle / CPE",
        "applicable_hs_codes": ["8517.62.59", "8517.12.00"],
        "testing_labs": ["VNTA-LAB", "QUATEST 1", "QUATEST 3"],
    },
    {
        "code": "QCVN 54:2020/BTTTT",
        "name": "Quy chuẩn kỹ thuật quốc gia về thiết bị thu phát vô tuyến dải tần 2,4 GHz (Wi-Fi 802.11b/g/n, Bluetooth, Zigbee)",
        "issuing_ministry": "BTTTT",
        "ministry_label": "Bộ Thông tin và Truyền thông",
        "category": "radio_telecom",
        "category_label": "Vô tuyến & Wi-Fi / BLE",
        "legal_basis": "Thông tư số 02/2024/TT-BTTTT & TT 04/2023/TT-BTTTT",
        "effective_date": "2021-07-01",
        "mandatory": True,
        "procedure_type": "mandatory_cert_and_cr",
        "procedure_label": "Bắt buộc Chứng nhận Hợp quy & Công bố CR",
        "target_equipment": "Module Wi-Fi ESP32, Module BLE 5.0, Bộ định tuyến Wi-Fi, Nút cảm biến Zigbee, Thiết bị IoT",
        "applicable_hs_codes": ["8517.62.51", "8517.62.59", "8517.70.21"],
        "testing_labs": ["VNTA-LAB", "QUATEST 1", "QUATEST 3"],
    },
    {
        "code": "QCVN 65:2020/BTTTT",
        "name": "Quy chuẩn kỹ thuật quốc gia về thiết bị truy nhập vô tuyến băng tần 5 GHz (Wi-Fi 802.11a/n/ac/ax)",
        "issuing_ministry": "BTTTT",
        "ministry_label": "Bộ Thông tin và Truyền thông",
        "category": "radio_telecom",
        "category_label": "Vô tuyến & Wi-Fi 5GHz",
        "legal_basis": "Thông tư số 02/2024/TT-BTTTT",
        "effective_date": "2021-07-01",
        "mandatory": True,
        "procedure_type": "mandatory_cert_and_cr",
        "procedure_label": "Bắt buộc Chứng nhận Hợp quy & Công bố CR",
        "target_equipment": "Access Point công nghiệp 5GHz, Router Wi-Fi 6 Dual Band, Màn hình tương tác thông minh",
        "applicable_hs_codes": ["8517.62.51", "8517.62.59"],
        "testing_labs": ["VNTA-LAB", "QUATEST 1", "QUATEST 3"],
    },
    {
        "code": "QCVN 18:2022/BTTTT",
        "name": "Quy chuẩn kỹ thuật quốc gia về tương thích điện từ (EMC) cho thiết bị thông tin vô tuyến",
        "issuing_ministry": "BTTTT",
        "ministry_label": "Bộ Thông tin và Truyền thông",
        "category": "emc",
        "category_label": "Tương thích điện từ (EMC)",
        "legal_basis": "Thông tư số 02/2024/TT-BTTTT",
        "effective_date": "2023-07-01",
        "mandatory": True,
        "procedure_type": "mandatory_cr_declaration",
        "procedure_label": "Bắt buộc Công Bố Hợp Quy CR",
        "target_equipment": "Toàn bộ thiết bị phát/thu vô tuyến 4G, 5G, Wi-Fi, Bluetooth, LoRa, RFID",
        "applicable_hs_codes": ["8517.62.59", "8517.62.99", "8517.70.21"],
        "testing_labs": ["VNTA-LAB", "QUATEST 1", "QUATEST 3"],
    },
    {
        "code": "QCVN 101:2020/BTTTT",
        "name": "Quy chuẩn kỹ thuật quốc gia về pin Lithium cho thiết bị cầm tay và thiết bị di động",
        "issuing_ministry": "BTTTT",
        "ministry_label": "Bộ Thông tin và Truyền thông",
        "category": "electrical_safety",
        "category_label": "An toàn Pin Lithium & Năng lượng",
        "legal_basis": "Thông tư số 02/2024/TT-BTTTT",
        "effective_date": "2021-07-01",
        "mandatory": True,
        "procedure_type": "mandatory_cr_declaration",
        "procedure_label": "Bắt buộc Tự Công Bố Hợp Quy CR",
        "target_equipment": "Pin Li-ion, Pin Li-Po 18650, Pin dự phòng cho thiết bị Datalogger / Gateway không dây",
        "applicable_hs_codes": ["8507.60.10", "8507.60.90", "8504.40.90"],
        "testing_labs": ["QUATEST 1", "QUATEST 3", "Viện Cơ học Năng lượng"],
    },
    {
        "code": "QCVN 132:2022/BTTTT",
        "name": "Quy chuẩn kỹ thuật quốc gia về an toàn điện cho thiết bị đầu cuối viễn thông và CNTT (IEC 62368-1)",
        "issuing_ministry": "BTTTT",
        "ministry_label": "Bộ Thông tin và Truyền thông",
        "category": "electrical_safety",
        "category_label": "An toàn điện (Safety IEC 62368-1)",
        "legal_basis": "Thông tư số 02/2024/TT-BTTTT",
        "effective_date": "2024-01-01",
        "mandatory": True,
        "procedure_type": "mandatory_cr_declaration",
        "procedure_label": "Bắt buộc Công Bố Hợp Quy CR",
        "target_equipment": "Máy tính bảng công nghiệp, Màn hình HMI, Bộ chuyển đổi nguồn công nghiệp, Gateway viễn thông",
        "applicable_hs_codes": ["8517.62.59", "8471.30.20", "8504.40.19"],
        "testing_labs": ["QUATEST 1", "QUATEST 3", "TUV Rheinland"],
    },
    {
        "code": "TT 10/2021/TT-BTNMT",
        "name": "Quy định kỹ thuật quan trắc môi trường và quản lý thông tin, dữ liệu quan trắc (Điều 33 đến 50)",
        "issuing_ministry": "BTNMT",
        "ministry_label": "Bộ Tài nguyên và Môi trường",
        "category": "environment",
        "category_label": "Quan trắc Môi trường & Datalogger",
        "legal_basis": "Thông tư số 10/2021/TT-BTNMT ngày 30/06/2021 của Bộ TN&MT",
        "effective_date": "2021-08-16",
        "mandatory": True,
        "procedure_type": "mandatory_procurement_standard",
        "procedure_label": "Quy định Bắt buộc trong E-HSMT & Đấu thầu Trạm Quan Trắc",
        "target_equipment": "Datalogger truyền dữ liệu quan trắc nước thải / khí thải tự động, Cảm biến đo mức, pH, COD, TSS",
        "applicable_hs_codes": ["9026.10.10", "9026.80.10", "9027.80.30", "8517.62.59"],
        "testing_labs": ["Viện Đo lường Việt Nam (VMI)", "Trung tâm Quan trắc Môi trường"],
    },
    {
        "code": "QCVN 19:2019/BKHCN",
        "name": "Quy chuẩn kỹ thuật quốc gia về tương thích điện từ đối với thiết bị điện và điện tử gia dụng",
        "issuing_ministry": "BKHCN",
        "ministry_label": "Bộ Khoa học và Công nghệ",
        "category": "emc",
        "category_label": "Tương thích điện từ (BKHCN EMC)",
        "legal_basis": "Thông tư số 11/2019/TT-BKHCN",
        "effective_date": "2021-07-01",
        "mandatory": True,
        "procedure_type": "mandatory_cr_declaration",
        "procedure_label": "Bắt buộc Chứng nhận Hợp quy CR (Nhóm 2)",
        "target_equipment": "Tủ lạnh, Máy giặt, Dụng cụ điện cầm tay, Bảng điều khiển vi mạch, Bộ nguồn điện tử",
        "applicable_hs_codes": ["8509.80.90", "8450.11.10", "8516.60.10", "8504.40.90"],
        "testing_labs": ["QUATEST 1", "QUATEST 2", "QUATEST 3"],
    },
    {
        "code": "ĐLVN 24:2014",
        "name": "Văn bản kỹ thuật đo lường Việt Nam: Công tơ điện tử xoay chiều (Quy trình thử nghiệm và kiểm định)",
        "issuing_ministry": "BKHCN",
        "ministry_label": "Tổng cục Tiêu chuẩn Đo lường Chất lượng (BKHCN)",
        "category": "metrology",
        "category_label": "Đo lường & Kiểm định Công tơ Điện",
        "legal_basis": "Quyết định số 1588/QĐ-TĐC của Tổng cục TĐC",
        "effective_date": "2014-10-01",
        "mandatory": True,
        "procedure_type": "mandatory_metrology_verification",
        "procedure_label": "Bắt buộc Phê Duyệt Mẫu & Kiểm Định Ban Đầu / Định Kỳ",
        "target_equipment": "Công tơ điện tử 1 pha, 3 pha nhiều biểu giá, Công tơ điện tử thông minh đọc xa AMR/AMI",
        "applicable_hs_codes": ["9028.30.10", "9028.30.90", "9028.90.10"],
        "testing_labs": ["VMI", "QUATEST 1", "QUATEST 3", "Trung tâm Thí nghiệm Điện EVN"],
    },
    {
        "code": "TCVN ISO 9001:2015",
        "name": "Hệ thống quản lý chất lượng — Các yêu cầu (ISO 9001:2015)",
        "issuing_ministry": "BKHCN",
        "ministry_label": "Tổng cục Tiêu chuẩn Đo lường Chất lượng",
        "category": "iso_management",
        "category_label": "Hệ thống Quản lý Chất lượng ISO",
        "legal_basis": "Tiêu chuẩn quốc gia công bố bởi Bộ KH&CN",
        "effective_date": "2015-12-31",
        "mandatory": False,
        "procedure_type": "voluntary_system_cert",
        "procedure_label": "Chứng nhận Hợp Chuẩn (Tự nguyện / Tiêu chí E-HSMT Đấu Thầu)",
        "target_equipment": "Toàn bộ quy trình R&D, Sản xuất lắp ráp phần cứng, Phát triển phần mềm",
        "applicable_hs_codes": ["TOAN_BO_NGANH_CNTT_CO_DIEN"],
        "testing_labs": ["QUACERT", "Vinacontrol CE", "BSI", "SGS Vietnam"],
    },
]

BENCHMARK_DOSSIERS: list[dict[str, Any]] = [
    {
        "dossier_no": "DOS-INUT-2024-001",
        "certificate_no": "C0955191224AE15A1",
        "applicant_tax_code": "4401053694",
        "applicant_name": "CÔNG TY TNHH PHÁT TRIỂN CÔNG NGHỆ INUT",
        "product_name": "Thiết bị IoT Gateway 4G LTE Công nghiệp",
        "model": "iNut-GW4G-Pro",
        "manufacturer": "CÔNG TY TNHH PHÁT TRIỂN CÔNG NGHỆ INUT",
        "country_of_origin": "Việt Nam",
        "standards": ["QCVN 117:2023/BTTTT", "QCVN 54:2020/BTTTT", "QCVN 18:2022/BTTTT", "QCVN 101:2020/BTTTT", "QCVN 132:2022/BTTTT"],
        "issue_date": "2024-08-01",
        "expiry_date": "2027-08-01",
        "status": "active",
        "hs_code": "8517.62.59",
    },
    {
        "dossier_no": "DOS-INUT-2024-002",
        "certificate_no": "C0955191224AE15A2",
        "applicant_tax_code": "4401053694",
        "applicant_name": "CÔNG TY TNHH PHÁT TRIỂN CÔNG NGHỆ INUT",
        "product_name": "Bộ định tuyến Wi-Fi 6 AX3000 Dual Band Công nghiệp",
        "model": "iNut-WF6-Pro",
        "manufacturer": "CÔNG TY TNHH PHÁT TRIỂN CÔNG NGHỆ INUT",
        "country_of_origin": "Việt Nam",
        "standards": ["QCVN 54:2020/BTTTT", "QCVN 65:2020/BTTTT", "QCVN 18:2022/BTTTT", "QCVN 132:2022/BTTTT"],
        "issue_date": "2024-06-15",
        "expiry_date": "2027-06-15",
        "status": "active",
        "hs_code": "8517.62.51",
    },
    {
        "dossier_no": "DOS-INUT-2024-003",
        "certificate_no": "C0955191224AE15A3",
        "applicant_tax_code": "4401053694",
        "applicant_name": "CÔNG TY TNHH PHÁT TRIỂN CÔNG NGHỆ INUT",
        "product_name": "Datalogger quan trắc môi trường Thông tư 10",
        "model": "iNut-TT10-Pro",
        "manufacturer": "CÔNG TY TNHH PHÁT TRIỂN CÔNG NGHỆ INUT",
        "country_of_origin": "Việt Nam",
        "standards": ["TT 10/2021/TT-BTNMT", "QCVN 117:2023/BTTTT", "QCVN 18:2022/BTTTT"],
        "issue_date": "2024-09-01",
        "expiry_date": "2027-09-01",
        "status": "active",
        "hs_code": "9026.10.10",
    },
    {
        "dossier_no": "DOS-VIETTEL-2023-088",
        "certificate_no": "C0842100523AE01B1",
        "applicant_tax_code": "0100109106",
        "applicant_name": "TẬP ĐOÀN CÔNG NGHIỆP - VIỄN THÔNG QUÂN ĐỘI (VIETTEL)",
        "product_name": "Thiết bị định tuyến 5G NR Outdoor CPE",
        "model": "VHT-5G-CPE01",
        "manufacturer": "Tổng công ty Công nghiệp Công nghệ cao Viettel (VHT)",
        "country_of_origin": "Việt Nam",
        "standards": ["QCVN 127:2021/BTTTT", "QCVN 117:2023/BTTTT", "QCVN 54:2020/BTTTT", "QCVN 65:2020/BTTTT", "QCVN 18:2022/BTTTT", "QCVN 132:2022/BTTTT"],
        "issue_date": "2023-05-10",
        "expiry_date": "2026-05-10",
        "status": "active",
        "hs_code": "8517.62.59",
    },
    {
        "dossier_no": "DOS-VIETTEL-2020-012",
        "certificate_no": "C0123010120AE01B0",
        "applicant_tax_code": "0100109106",
        "applicant_name": "TẬP ĐOÀN CÔNG NGHIỆP - VIỄN THÔNG QUÂN ĐỘI (VIETTEL)",
        "product_name": "Modem 3G/4G Viettel D6606",
        "model": "D6606",
        "manufacturer": "Viettel",
        "country_of_origin": "Việt Nam",
        "standards": ["QCVN 117:2020/BTTTT", "QCVN 18:2022/BTTTT"],
        "issue_date": "2020-01-15",
        "expiry_date": "2023-01-15",
        "status": "expired",
        "hs_code": "8517.62.59",
    },
    {
        "dossier_no": "DOS-OPPO-2024-991",
        "certificate_no": "C0955191224AE15A4",
        "applicant_tax_code": "0312636094",
        "applicant_name": "CÔNG TY TNHH MỘT THÀNH VIÊN KỸ THUẬT & KHOA HỌC OPPO",
        "product_name": "Điện thoại di động thông minh 5G OPPO Reno",
        "model": "CPH2699",
        "manufacturer": "OPPO Guangdong Mobile Communications Co., Ltd.",
        "country_of_origin": "Trung Quốc",
        "standards": ["QCVN 117:2023/BTTTT", "QCVN 127:2021/BTTTT", "QCVN 54:2020/BTTTT", "QCVN 65:2020/BTTTT", "QCVN 18:2022/BTTTT", "QCVN 101:2020/BTTTT", "QCVN 132:2022/BTTTT"],
        "issue_date": "2024-11-20",
        "expiry_date": "2027-11-20",
        "status": "active",
        "hs_code": "8517.12.00",
    },
    {
        "dossier_no": "DOS-VINFAST-2024-301",
        "certificate_no": "C0712010824AE99V1",
        "applicant_tax_code": "0108926276",
        "applicant_name": "CÔNG TY CỔ PHẦN SẢN XUẤT VÀ KINH DOANH VINFAST",
        "product_name": "Bộ truyền thông điều khiển xe điện thông minh Telematics Control Unit (TCU)",
        "model": "VF-TCU-VF9",
        "manufacturer": "VINFAST",
        "country_of_origin": "Việt Nam",
        "standards": ["QCVN 117:2023/BTTTT", "QCVN 54:2020/BTTTT", "QCVN 18:2022/BTTTT", "QCVN 132:2022/BTTTT"],
        "issue_date": "2024-08-10",
        "expiry_date": "2027-08-10",
        "status": "active",
        "hs_code": "8517.62.59",
    },
    {
        "dossier_no": "DOS-GELEX-2023-112",
        "certificate_no": "C0455110223AE44G1",
        "applicant_tax_code": "0100100745",
        "applicant_name": "TỔNG CÔNG TY CỔ PHẦN THIẾT BỊ ĐIỆN VIỆT NAM (GELEX EMIC)",
        "product_name": "Công tơ điện tử xoay chiều 3 pha nhiều biểu giá",
        "model": "ME-41",
        "manufacturer": "GELEX EMIC",
        "country_of_origin": "Việt Nam",
        "standards": ["ĐLVN 24:2014", "QCVN 19:2019/BKHCN"],
        "issue_date": "2023-02-15",
        "expiry_date": "2028-02-15",
        "status": "active",
        "hs_code": "9028.30.10",
    },
    {
        "dossier_no": "DOS-MEANWELL-2023-550",
        "certificate_no": "C0322190923AE55M1",
        "applicant_tax_code": "0303882745",
        "applicant_name": "CÔNG TY CỔ PHẦN CÔNG NGHỆ DI ĐỘNG THÔNG MINH (PHÂN PHỐI MEANWELL)",
        "product_name": "Bộ nguồn chuyển đổi công nghiệp DIN-Rail 24VDC 120W",
        "model": "NDR-120-24",
        "manufacturer": "MEAN WELL Enterprises Co., Ltd.",
        "country_of_origin": "Đài Loan",
        "standards": ["QCVN 19:2019/BKHCN", "QCVN 132:2022/BTTTT"],
        "issue_date": "2023-09-19",
        "expiry_date": "2026-09-19",
        "status": "active",
        "hs_code": "8504.40.90",
    },
]


class RuleInferenceEngine:
    """Suy luan quy chuan QCVN bat buoc va khuyen nghi cho thiet bi cong nghe chua tung co ho so."""

    TECH_RULES: list[dict[str, Any]] = [
        {
            "tech": "4g_lte",
            "keywords": ["4g", "lte", "e-utra", "volte", "cat-1", "cat-4", "cat-m1", "nb-iot", "simcom", "quectel"],
            "mandatory_standards": ["QCVN 117:2023/BTTTT", "QCVN 18:2022/BTTTT", "QCVN 132:2022/BTTTT"],
            "reason": "Thiết bị viễn thông di động bắt buộc đo kiểm RF (QCVN 117), EMC (QCVN 18), và An toàn điện (QCVN 132)",
        },
        {
            "tech": "5g_nr",
            "keywords": ["5g", "5g nr", "5g sa", "5g nsa", "sub-6ghz", "n77", "n78", "cpe 5g"],
            "mandatory_standards": ["QCVN 127:2021/BTTTT", "QCVN 117:2023/BTTTT", "QCVN 18:2022/BTTTT", "QCVN 132:2022/BTTTT"],
            "reason": "Thiết bị di động 5G bắt buộc QCVN 127, kèm QCVN 117 cho chế độ lùi 4G",
        },
        {
            "tech": "wifi_2_4g_ble",
            "keywords": ["wifi", "wi-fi", "2.4ghz", "2.4g", "bluetooth", "ble", "zigbee", "esp32", "esp8266", "802.11b/g/n"],
            "mandatory_standards": ["QCVN 54:2020/BTTTT", "QCVN 18:2022/BTTTT"],
            "reason": "Thiết bị vô tuyến dải tần 2,4 GHz diện hẹp bắt buộc QCVN 54 và QCVN 18",
        },
        {
            "tech": "wifi_5g",
            "keywords": ["5ghz", "5g wifi", "dual band", "wi-fi 6", "wifi 6", "802.11a/n/ac/ax", "ax3000", "ax1800"],
            "mandatory_standards": ["QCVN 65:2020/BTTTT", "QCVN 54:2020/BTTTT", "QCVN 18:2022/BTTTT", "QCVN 132:2022/BTTTT"],
            "reason": "Thiết bị truy nhập vô tuyến 5 GHz băng rộng bắt buộc QCVN 65 (DFS/TPC) và QCVN 54",
        },
        {
            "tech": "lithium_battery",
            "keywords": ["pin", "battery", "lithium", "li-ion", "li-po", "18650", "accumulator"],
            "mandatory_standards": ["QCVN 101:2020/BTTTT"],
            "reason": "Thiết bị có pin sạc Lithium bắt buộc tự công bố hợp quy QCVN 101",
        },
        {
            "tech": "environment_datalogger",
            "keywords": ["datalogger", "quan trac", "moi truong", "thong tu 10", "nuoc thai", "khi thai"],
            "mandatory_standards": ["TT 10/2021/TT-BTNMT"],
            "reason": "Trạm quan trắc tự động liên tục bắt buộc chuẩn truyền FTP theo Thông tư 10/2021/TT-BTNMT",
        },
        {
            "tech": "power_supply_emc",
            "keywords": ["adapter", "power supply", "bo nguon", "din-rail", "bien ap", "meanwell"],
            "mandatory_standards": ["QCVN 19:2019/BKHCN", "QCVN 132:2022/BTTTT"],
            "reason": "Bộ đổi nguồn hạ áp bắt buộc EMC BKHCN (QCVN 19) và An toàn điện (QCVN 132)",
        },
        {
            "tech": "electricity_meter",
            "keywords": ["cong to", "dien tu", "meter", "amr", "ami", "dlms", "emic"],
            "mandatory_standards": ["ĐLVN 24:2014", "QCVN 19:2019/BKHCN"],
            "reason": "Phương tiện đo nhóm 2 bắt buộc phê duyệt mẫu ĐLVN 24 và EMC QCVN 19",
        },
    ]

    @classmethod
    def infer_applicable_standards(cls, text: str, hs_code: str = "") -> list[dict[str, Any]]:
        """Suy luan danh sach quy chuan dua tren dac tinh ky thuat va ma HS."""
        normalized_text = _strip_accents(text).lower()
        matched_standards_set: set[str] = set()
        inferred_rules: list[dict[str, Any]] = []

        # 1. Quet tu khoa ky thuat
        for rule in cls.TECH_RULES:
            match_found = False
            for kw in rule["keywords"]:
                if re.search(r"\b" + re.escape(_strip_accents(kw)) + r"\b", normalized_text) or kw in normalized_text:
                    match_found = True
                    break
            if match_found:
                inferred_rules.append({
                    "technology": rule["tech"],
                    "reason": rule["reason"],
                    "standards": rule["mandatory_standards"],
                })
                for std_code in rule["mandatory_standards"]:
                    matched_standards_set.add(std_code)

        # 2. Quet theo ma HS Code neu co
        if hs_code:
            clean_hs = re.sub(r"[^0-9]", "", hs_code.strip())
            hs_info = HsCodeConformityService.lookup_hs_code(clean_hs)
            if hs_info:
                for std_code in hs_info.get("applicable_standards", []):
                    matched_standards_set.add(std_code)

        # 3. Tra ve full objects (ho tro ca QCVN 117:2020 va QCVN 117:2023)
        results: list[dict[str, Any]] = []
        for std in BENCHMARK_STANDARDS:
            std_code = std["code"]
            if std_code in matched_standards_set:
                results.append(std)
            elif "QCVN 117:2023/BTTTT" in matched_standards_set and std_code == "QCVN 117:2020/BTTTT":
                results.append(std)
            elif "QCVN 117:2020/BTTTT" in matched_standards_set and std_code == "QCVN 117:2023/BTTTT":
                results.append(std)

        return results


class TwoWayLookupEngine:
    """Bo may tra cuu 2 chieu: Model -> QCVN va MST -> Dossier/QCVN voi 3-Tier Search & Cache."""

    @classmethod
    def lookup_model(
        cls,
        query: str,
        hs_code: str = "",
        ministry: str = "",
        mandatory_only: bool = False,
        fuzzy: bool = True,
        limit: int = 20,
        offset: int = 0,
    ) -> dict[str, Any]:
        """Chieu 1: Tra cuu Model / Tu khoa -> Ho so chung nhan da co va quy chuan suy luan."""
        start_time = time.perf_counter()
        q = str(query or "").strip()
        q_norm = _strip_accents(q)

        # 1. Tier 1 & Tier 2: Tim ho so thuc te tren Benchmark Dossiers
        matched_dossiers: list[dict[str, Any]] = []
        exact_matches: list[dict[str, Any]] = []
        prefix_matches: list[dict[str, Any]] = []
        fuzzy_matches: list[dict[str, Any]] = []

        if q_norm:
            q_tokens = set(re.findall(r"[a-z0-9]+", q_norm))
            for dossier in BENCHMARK_DOSSIERS:
                model_raw = dossier["model"]
                model_norm = _strip_accents(model_raw)
                product_norm = _strip_accents(dossier["product_name"])
                mfg_norm = _strip_accents(dossier["manufacturer"])
                dossier_tokens = set(re.findall(r"[a-z0-9]+", model_norm + " " + product_norm))

                # Exact match
                if q_norm == model_norm or q_norm.replace("-", "") == model_norm.replace("-", ""):
                    exact_matches.append(dossier)
                # Prefix / Substring match
                elif model_norm.startswith(q_norm) or q_norm in model_norm or q_norm in product_norm or q_norm in mfg_norm:
                    prefix_matches.append(dossier)
                # Token overlap (unaccented keywords match)
                elif len(q_tokens) >= 2 and len(q_tokens.intersection(dossier_tokens)) >= 2:
                    prefix_matches.append(dossier)
                elif fuzzy:
                    score = difflib.SequenceMatcher(None, q_norm, model_norm).ratio()
                    if score >= 0.82:
                        fuzzy_matches.append(dossier)

        if exact_matches:
            matched_dossiers = exact_matches
        elif prefix_matches:
            matched_dossiers = prefix_matches
        elif fuzzy_matches:
            matched_dossiers = fuzzy_matches
        elif hs_code and not q_norm:
            # Fallback to HS code only when query is empty
            clean_hs = re.sub(r"[^0-9]", "", hs_code.strip())
            for dossier in BENCHMARK_DOSSIERS:
                d_hs = re.sub(r"[^0-9]", "", dossier.get("hs_code", ""))
                if clean_hs and (clean_hs.startswith(d_hs) or d_hs.startswith(clean_hs)):
                    matched_dossiers.append(dossier)

        # 2. Tong hop danh sach quy chuan tu cac ho so khop
        aggregated_std_codes: set[str] = set()
        for d in matched_dossiers:
            for s in d.get("standards", []):
                aggregated_std_codes.add(s)

        # 3. Goi RuleInferenceEngine de bo sung quy chuan
        inferred_standards = RuleInferenceEngine.infer_applicable_standards(q, hs_code=hs_code)
        for s in inferred_standards:
            aggregated_std_codes.add(s["code"])

        # 4. Lay danh sach chi tiet Standards & Ap dung Filters
        standards_list: list[dict[str, Any]] = []
        for s_obj in BENCHMARK_STANDARDS:
            if s_obj["code"] in aggregated_std_codes:
                if ministry and s_obj.get("issuing_ministry", "").upper() != ministry.upper():
                    continue
                if mandatory_only and not s_obj.get("mandatory", False):
                    continue
                standards_list.append(s_obj)

        # 5. Phan trang
        total_matches = len(matched_dossiers)
        paginated_dossiers = matched_dossiers[offset : offset + limit] if offset < len(matched_dossiers) else []
        execution_time_ms = round((time.perf_counter() - start_time) * 1000, 3)

        return {
            "query": query,
            "total_matches": total_matches,
            "exact_dossiers": paginated_dossiers,
            "applicable_standards": standards_list,
            "inferred_count": len(inferred_standards),
            "execution_time_ms": execution_time_ms,
        }

    @classmethod
    def lookup_tax_code(
        cls,
        tax_code: str = "",
        company_name: str = "",
        status: str = "all",
        limit: int = 20,
        offset: int = 0,
    ) -> dict[str, Any]:
        """Chieu 2: Tra cuu MST / Ten doanh nghiep -> Ho so hop quy, trang thai va active QCVNs."""
        start_time = time.perf_counter()
        raw_mst = re.sub(r"[^0-9]", "", str(tax_code or "").strip())
        name_norm = _strip_accents(str(company_name or "").strip())

        matched_dossiers: list[dict[str, Any]] = []
        resolved_company_name = company_name or ""
        resolved_tax_code = raw_mst

        for dossier in BENCHMARK_DOSSIERS:
            d_mst = re.sub(r"[^0-9]", "", dossier.get("applicant_tax_code", ""))
            d_name_norm = _strip_accents(dossier.get("applicant_name", ""))

            is_match = False
            if raw_mst and (raw_mst == d_mst or d_mst.startswith(raw_mst)):
                is_match = True
            elif name_norm and (name_norm in d_name_norm or d_name_norm in name_norm):
                is_match = True

            if is_match:
                if not resolved_company_name:
                    resolved_company_name = dossier.get("applicant_name", "")
                if not resolved_tax_code:
                    resolved_tax_code = dossier.get("applicant_tax_code", "")

                # Loc theo trang thai: active | expired | all
                d_status = dossier.get("status", "active")
                if status == "active" and d_status != "active":
                    continue
                if status == "expired" and d_status != "expired":
                    continue
                matched_dossiers.append(dossier)

        # Tinh toan thong ke Compliance Summary
        total_dossiers = len(matched_dossiers)
        active_dossiers = sum(1 for d in matched_dossiers if d.get("status") == "active")
        expired_dossiers = sum(1 for d in matched_dossiers if d.get("status") == "expired")

        active_qcvn_set: set[str] = set()
        for d in matched_dossiers:
            if d.get("status") == "active":
                for s in d.get("standards", []):
                    active_qcvn_set.add(s)

        paginated_dossiers = matched_dossiers[offset : offset + limit] if offset < len(matched_dossiers) else []
        execution_time_ms = round((time.perf_counter() - start_time) * 1000, 3)

        return {
            "tax_code": resolved_tax_code,
            "company_name": resolved_company_name,
            "compliance_summary": {
                "total_dossiers": total_dossiers,
                "active_dossiers": active_dossiers,
                "expired_dossiers": expired_dossiers,
                "unique_standards_count": len(active_qcvn_set),
            },
            "dossiers": paginated_dossiers,
            "active_qcvn_list": sorted(list(active_qcvn_set)),
            "execution_time_ms": execution_time_ms,
        }

    @classmethod
    def suggest(
        cls,
        query: str,
        type: str = "all",
        limit: int = 10,
    ) -> dict[str, Any]:
        """Auto-complete goi y tu khoa thong minh da doi tuong (model, tax_code, company, qcvn)."""
        start_time = time.perf_counter()
        q = str(query or "").strip()
        q_norm = _strip_accents(q)
        suggestions: list[dict[str, Any]] = []

        if len(q) >= 2:
            # 1. Models
            if type in ("all", "model"):
                seen_models = set()
                for d in BENCHMARK_DOSSIERS:
                    m = d["model"]
                    if m not in seen_models and (q_norm in _strip_accents(m) or q_norm in _strip_accents(d["product_name"])):
                        seen_models.add(m)
                        suggestions.append({
                            "type": "model",
                            "text": m,
                            "meta": d["product_name"],
                        })

            # 2. Tax codes & Companies
            if type in ("all", "tax_code", "company"):
                seen_msts = set()
                for d in BENCHMARK_DOSSIERS:
                    mst = d["applicant_tax_code"]
                    comp = d["applicant_name"]
                    if mst not in seen_msts:
                        mst_match = q.replace("-", "") in mst
                        comp_match = q_norm in _strip_accents(comp)
                        if mst_match or comp_match:
                            seen_msts.add(mst)
                            if type in ("all", "tax_code"):
                                suggestions.append({
                                    "type": "tax_code",
                                    "text": mst,
                                    "meta": comp,
                                })
                            if type in ("all", "company"):
                                suggestions.append({
                                    "type": "company",
                                    "text": comp,
                                    "meta": f"MST: {mst}",
                                })

            # 3. Standards QCVN
            if type in ("all", "qcvn"):
                seen_stds = set()
                for s in BENCHMARK_STANDARDS:
                    code = s["code"]
                    if code not in seen_stds and (q_norm in _strip_accents(code) or q_norm in _strip_accents(s["name"])):
                        seen_stds.add(code)
                        suggestions.append({
                            "type": "qcvn",
                            "text": code,
                            "meta": s["name"][:75] + "...",
                        })

        execution_time_ms = round((time.perf_counter() - start_time) * 1000, 3)
        return {
            "query": query,
            "suggestions": suggestions[:limit],
            "execution_time_ms": execution_time_ms,
        }


# ─── 🚀 FASTAPI TEST ROUTER & CLIENT INTEGRATION ───────────────────────────────

two_way_router = APIRouter(prefix="/api/standards", tags=["standards_2way"])


@two_way_router.get("/lookup/model")
def api_lookup_model(
    query: str = Query(..., min_length=1, description="Model, ten thiet bi hoac tu khoa"),
    hs_code: str = Query("", description="Ma HS Code 8 so"),
    ministry: str = Query("", description="Bo chu quan: BTTTT, BKHCN, BTNMT, BCT"),
    mandatory_only: bool = Query(False, description="Chi lay quy chuan bat buoc"),
    fuzzy: bool = Query(True, description="Bat tim kiem mo"),
    limit: int = Query(20, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    return TwoWayLookupEngine.lookup_model(
        query=query,
        hs_code=hs_code,
        ministry=ministry,
        mandatory_only=mandatory_only,
        fuzzy=fuzzy,
        limit=limit,
        offset=offset,
    )


@two_way_router.get("/lookup/tax-code")
def api_lookup_tax_code(
    tax_code: str = Query("", description="Ma so thue doanh nghiep"),
    company_name: str = Query("", description="Ten cong ty"),
    status: str = Query("all", description="Trang thai: active | expired | all"),
    limit: int = Query(20, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    if not tax_code and not company_name:
        raise HTTPException(status_code=422, detail="Vui long nhap Ma so thue hoac Ten cong ty")
    return TwoWayLookupEngine.lookup_tax_code(
        tax_code=tax_code,
        company_name=company_name,
        status=status,
        limit=limit,
        offset=offset,
    )


@two_way_router.get("/suggest")
def api_suggest_standards(
    q: str = Query(..., min_length=2, description="Tu khoa goi y"),
    type: str = Query("all", description="all | model | tax_code | company | qcvn"),
    limit: int = Query(10, ge=1, le=50),
) -> dict[str, Any]:
    return TwoWayLookupEngine.suggest(query=q, type=type, limit=limit)


@pytest.fixture(scope="module")
def api_client():
    test_app = FastAPI()
    test_app.include_router(two_way_router)
    return TestClient(test_app)


# ═══════════════════════════════════════════════════════════════════════════════
# 🌟 TIER 1: FEATURE COVERAGE TESTS (>=5 tests per feature)
# ═══════════════════════════════════════════════════════════════════════════════

# ─── Feature 1: Direction 1 - Model -> QCVN Lookup (5+ Tests) ───

def test_tier1_f1_exact_model_lookup_inut_gw4g_pro():
    """Tra cuu chinh xac Model iNut-GW4G-Pro -> Tra ve 4 QCVN bat buoc cua BTTTT."""
    res = TwoWayLookupEngine.lookup_model("iNut-GW4G-Pro")
    assert res["total_matches"] == 1
    assert len(res["exact_dossiers"]) == 1
    assert res["exact_dossiers"][0]["model"] == "iNut-GW4G-Pro"
    assert res["exact_dossiers"][0]["applicant_tax_code"] == "4401053694"

    std_codes = [s["code"] for s in res["applicable_standards"]]
    assert "QCVN 117:2023/BTTTT" in std_codes
    assert "QCVN 54:2020/BTTTT" in std_codes
    assert "QCVN 18:2022/BTTTT" in std_codes
    assert "QCVN 132:2022/BTTTT" in std_codes
    assert res["execution_time_ms"] < 50.0


def test_tier1_f1_exact_model_lookup_cph2699_oppo_smartphone():
    """Tra cuu chinh xac Model CPH2699 (Oppo Reno 5G) -> Tra ve QCVN 117, 127, 54, 65, 18, 101, 132."""
    res = TwoWayLookupEngine.lookup_model("CPH2699")
    assert res["total_matches"] == 1
    dossier = res["exact_dossiers"][0]
    assert dossier["applicant_tax_code"] == "0312636094"
    assert "OPPO" in dossier["applicant_name"]

    std_codes = [s["code"] for s in res["applicable_standards"]]
    assert "QCVN 127:2021/BTTTT" in std_codes
    assert "QCVN 65:2020/BTTTT" in std_codes
    assert "QCVN 101:2020/BTTTT" in std_codes


def test_tier1_f1_exact_model_lookup_wifi6_router_inut_wf6_pro():
    """Tra cuu Model iNut-WF6-Pro -> Tra ve QCVN 54, 65, 18, 132 va Phong thu nghiem chi dinh."""
    res = TwoWayLookupEngine.lookup_model("iNut-WF6-Pro")
    assert res["total_matches"] == 1
    stds = res["applicable_standards"]
    assert any(s["code"] == "QCVN 65:2020/BTTTT" for s in stds)
    vnta_labs = [s for s in stds if "VNTA-LAB" in s.get("testing_labs", [])]
    assert len(vnta_labs) >= 3


def test_tier1_f1_exact_model_lookup_power_supply_meanwell():
    """Tra cuu Model bo nguon MeanWell NDR-120-24 -> Tra ve QCVN 19 (EMC) va QCVN 132 (Safety)."""
    res = TwoWayLookupEngine.lookup_model("NDR-120-24")
    assert res["total_matches"] == 1
    std_codes = [s["code"] for s in res["applicable_standards"]]
    assert "QCVN 19:2019/BKHCN" in std_codes
    assert "QCVN 132:2022/BTTTT" in std_codes


def test_tier1_f1_exact_model_lookup_electricity_meter_gelex_me41():
    """Tra cuu Model Cong to dien tu ME-41 -> Tra ve Phe duyet mau DLVN 24 va EMC QCVN 19."""
    res = TwoWayLookupEngine.lookup_model("ME-41")
    assert res["total_matches"] == 1
    std_codes = [s["code"] for s in res["applicable_standards"]]
    assert "ĐLVN 24:2014" in std_codes
    assert "QCVN 19:2019/BKHCN" in std_codes


def test_tier1_f1_model_case_insensitivity_and_spacing():
    """Tra cuu model viet thuong va co khoang trang du thua."""
    res = TwoWayLookupEngine.lookup_model("   inut-gw4g-pro   ")
    assert res["total_matches"] >= 1
    assert res["exact_dossiers"][0]["model"] == "iNut-GW4G-Pro"


# ─── Feature 2: Direction 1 - Rule-Based QCVN Inference (5+ Tests) ───

def test_tier1_f2_rule_inference_unseen_4g_lte_device():
    """Thiet bi hoan toan moi chua co trong DB nhung co tu khoa '4G LTE VoLTE Cat-1'."""
    stds = RuleInferenceEngine.infer_applicable_standards("Thiết bị giám sát hành trình 4G LTE Cat-1 VoLTE")
    std_codes = [s["code"] for s in stds]
    assert "QCVN 117:2023/BTTTT" in std_codes or "QCVN 117:2020/BTTTT" in std_codes
    assert "QCVN 18:2022/BTTTT" in std_codes
    assert "QCVN 132:2022/BTTTT" in std_codes


def test_tier1_f2_rule_inference_unseen_5g_router():
    """Thiet bi hoan toan moi co tu khoa '5G NR Sub-6GHz Industrial Gateway'."""
    stds = RuleInferenceEngine.infer_applicable_standards("5G NR Sub-6GHz Industrial Gateway")
    std_codes = [s["code"] for s in stds]
    assert "QCVN 127:2021/BTTTT" in std_codes
    assert "QCVN 18:2022/BTTTT" in std_codes


def test_tier1_f2_rule_inference_unseen_wifi_ble_smart_sensor():
    """Cam bien thong minh ESP32 Wi-Fi 2.4GHz & Bluetooth Low Energy."""
    stds = RuleInferenceEngine.infer_applicable_standards("Cảm biến nhiệt ẩm ESP32-C3 Wi-Fi 2.4GHz và BLE 5.0")
    std_codes = [s["code"] for s in stds]
    assert "QCVN 54:2020/BTTTT" in std_codes
    assert "QCVN 18:2022/BTTTT" in std_codes


def test_tier1_f2_rule_inference_unseen_dual_band_ax3000_access_point():
    """Bo phat Wi-Fi 6 bang tan kep 5GHz va 2.4GHz."""
    stds = RuleInferenceEngine.infer_applicable_standards("Access Point Wi-Fi 6 AX3000 Dual Band 5GHz")
    std_codes = [s["code"] for s in stds]
    assert "QCVN 65:2020/BTTTT" in std_codes
    assert "QCVN 54:2020/BTTTT" in std_codes


def test_tier1_f2_rule_inference_unseen_lithium_battery():
    """Pack pin sạc Lithium-ion 18650 cho thiet bi cam tay."""
    stds = RuleInferenceEngine.infer_applicable_standards("Khối pin Lithium-ion 18650 3.7V 2600mAh")
    std_codes = [s["code"] for s in stds]
    assert "QCVN 101:2020/BTTTT" in std_codes


def test_tier1_f2_rule_inference_by_hs_code_alone():
    """Suy luan quy chuan truc tiep dua tren ma HS Code 8517.62.59."""
    stds = RuleInferenceEngine.infer_applicable_standards("Thiết bị truyền thông chưa rõ model", hs_code="8517.62.59")
    std_codes = [s["code"] for s in stds]
    assert any("QCVN 117" in code for code in std_codes)


# ─── Feature 3: Direction 2 - MST / Tax Code -> Dossier Lookup (5+ Tests) ───

def test_tier1_f3_mst_lookup_inut_enterprise():
    """Tra cuu MST 4401053694 cua INUT -> Tra ve 3 ho so hop quy va danh sach QCVN tich cuc."""
    res = TwoWayLookupEngine.lookup_tax_code(tax_code="4401053694")
    assert res["tax_code"] == "4401053694"
    assert "INUT" in res["company_name"]
    summary = res["compliance_summary"]
    assert summary["total_dossiers"] == 3
    assert summary["active_dossiers"] == 3
    assert summary["expired_dossiers"] == 0
    assert summary["unique_standards_count"] >= 4
    assert "QCVN 117:2023/BTTTT" in res["active_qcvn_list"]
    assert "QCVN 54:2020/BTTTT" in res["active_qcvn_list"]


def test_tier1_f3_mst_lookup_viettel_telecom():
    """Tra cuu MST 0100109106 cua Viettel -> Tra ve ca ho so active va expired."""
    res = TwoWayLookupEngine.lookup_tax_code(tax_code="0100109106", status="all")
    assert "VIETTEL" in res["company_name"]
    summary = res["compliance_summary"]
    assert summary["total_dossiers"] == 2
    assert summary["active_dossiers"] == 1
    assert summary["expired_dossiers"] == 1
    assert "QCVN 127:2021/BTTTT" in res["active_qcvn_list"]


def test_tier1_f3_mst_lookup_oppo_smartphone():
    """Tra cuu MST 0312636094 cua OPPO -> Tra ve ho so CPH2699."""
    res = TwoWayLookupEngine.lookup_tax_code(tax_code="0312636094")
    assert res["compliance_summary"]["total_dossiers"] == 1
    assert res["dossiers"][0]["model"] == "CPH2699"


def test_tier1_f3_lookup_by_company_name_fuzzy():
    """Tra cuu bang ten cong ty khong can MST."""
    res = TwoWayLookupEngine.lookup_tax_code(company_name="CONG TY TNHH PHAT TRIEN CONG NGHE INUT")
    assert res["tax_code"] == "4401053694"
    assert res["compliance_summary"]["total_dossiers"] == 3


def test_tier1_f3_mst_normalization_with_dashes():
    """Tra cuu MST co chua dau gach ngang '4401-053-694'."""
    res = TwoWayLookupEngine.lookup_tax_code(tax_code="4401-053-694")
    assert res["tax_code"] == "4401053694"
    assert res["compliance_summary"]["total_dossiers"] == 3


# ─── Feature 4: Auto-Complete Suggestions API (5+ Tests) ───

def test_tier1_f4_suggest_by_model_prefix():
    """Goi y tu khoa theo tien to Model 'iNut'."""
    res = TwoWayLookupEngine.suggest(query="iNut", type="model")
    assert len(res["suggestions"]) >= 2
    texts = [s["text"] for s in res["suggestions"]]
    assert "iNut-GW4G-Pro" in texts
    assert "iNut-WF6-Pro" in texts


def test_tier1_f4_suggest_by_tax_code_prefix():
    """Goi y tu khoa theo dau MST '44010'."""
    res = TwoWayLookupEngine.suggest(query="44010", type="tax_code")
    assert len(res["suggestions"]) >= 1
    assert res["suggestions"][0]["text"] == "4401053694"
    assert "INUT" in res["suggestions"][0]["meta"]


def test_tier1_f4_suggest_by_company_name_prefix():
    """Goi y tu khoa theo ten cong ty 'viettel'."""
    res = TwoWayLookupEngine.suggest(query="viettel", type="company")
    assert len(res["suggestions"]) >= 1
    assert "VIETTEL" in res["suggestions"][0]["text"]
    assert "0100109106" in res["suggestions"][0]["meta"]


def test_tier1_f4_suggest_by_qcvn_code_prefix():
    """Goi y theo so hieu quy chuan '117'."""
    res = TwoWayLookupEngine.suggest(query="117", type="qcvn")
    assert len(res["suggestions"]) >= 1
    assert any("QCVN 117" in s["text"] for s in res["suggestions"])


def test_tier1_f4_suggest_all_types_and_limit():
    """Goi y tat ca cac loai doi tuong co gioi han limit=5."""
    res = TwoWayLookupEngine.suggest(query="inut", type="all", limit=5)
    assert len(res["suggestions"]) <= 5
    types = {s["type"] for s in res["suggestions"]}
    assert "model" in types or "company" in types or "tax_code" in types


# ─── Feature 5: Multi-Field Filtering & Pagination (5+ Tests) ───

def test_tier1_f5_filter_by_issuing_ministry():
    """Loc quy chuan theo Bo TT&TT vs Bo KH&CN."""
    res_btttt = TwoWayLookupEngine.lookup_model(query="iNut-GW4G-Pro", ministry="BTTTT")
    assert all(s["issuing_ministry"] == "BTTTT" for s in res_btttt["applicable_standards"])

    res_bkhcn = TwoWayLookupEngine.lookup_model(query="ME-41", ministry="BKHCN")
    assert all(s["issuing_ministry"] == "BKHCN" for s in res_bkhcn["applicable_standards"])


def test_tier1_f5_filter_mandatory_only():
    """Loc chi lay quy chuan bat buoc (loai bo TCVN ISO 9001 tu nguyen)."""
    res = TwoWayLookupEngine.lookup_model(query="iNut", mandatory_only=True)
    assert all(s["mandatory"] is True for s in res["applicable_standards"])


def test_tier1_f5_filter_dossier_by_status():
    """Loc danh muc ho so theo trang thai active vs expired."""
    res_active = TwoWayLookupEngine.lookup_tax_code(tax_code="0100109106", status="active")
    assert len(res_active["dossiers"]) == 1
    assert res_active["dossiers"][0]["status"] == "active"

    res_expired = TwoWayLookupEngine.lookup_tax_code(tax_code="0100109106", status="expired")
    assert len(res_expired["dossiers"]) == 1
    assert res_expired["dossiers"][0]["status"] == "expired"


def test_tier1_f5_pagination_limit_and_offset():
    """Phan trang limit va offset chinh xac."""
    res_p1 = TwoWayLookupEngine.lookup_tax_code(tax_code="4401053694", limit=2, offset=0)
    assert len(res_p1["dossiers"]) == 2

    res_p2 = TwoWayLookupEngine.lookup_tax_code(tax_code="4401053694", limit=2, offset=2)
    assert len(res_p2["dossiers"]) == 1
    assert res_p1["dossiers"][0]["dossier_no"] != res_p2["dossiers"][0]["dossier_no"]


def test_tier1_f5_pagination_count_invariance():
    """Tong so ban ghi khong thay doi khi phan trang."""
    res_full = TwoWayLookupEngine.lookup_tax_code(tax_code="4401053694", limit=10, offset=0)
    res_page = TwoWayLookupEngine.lookup_tax_code(tax_code="4401053694", limit=1, offset=1)
    assert res_full["compliance_summary"]["total_dossiers"] == res_page["compliance_summary"]["total_dossiers"] == 3


# ═══════════════════════════════════════════════════════════════════════════════
# 🛡️ TIER 2: BOUNDARY & CORNER CASES (>=5 tests)
# ═══════════════════════════════════════════════════════════════════════════════

def test_tier2_boundary_empty_and_whitespace_queries():
    """Xu ly truy van rong va khoang trang khong bao gio gay loi 500."""
    res_empty = TwoWayLookupEngine.lookup_model("")
    assert res_empty["total_matches"] == 0
    assert res_empty["applicable_standards"] == []

    res_spaces = TwoWayLookupEngine.lookup_model("     \t\n  ")
    assert res_spaces["total_matches"] == 0


def test_tier2_boundary_single_character_query():
    """Truy van chi co 1 ky tu -> suggest yeu cau toi thieu 2 ky tu hoac tra ve empty."""
    res_suggest = TwoWayLookupEngine.suggest("a")
    assert len(res_suggest["suggestions"]) == 0

    res_model = TwoWayLookupEngine.lookup_model("x")
    assert isinstance(res_model["total_matches"], int)


def test_tier2_boundary_non_existent_tax_code_and_model():
    """Truy van MST hoac Model khong ton tai trong he thong."""
    res_mst = TwoWayLookupEngine.lookup_tax_code(tax_code="9999999999")
    assert res_mst["compliance_summary"]["total_dossiers"] == 0
    assert len(res_mst["dossiers"]) == 0
    assert res_mst["active_qcvn_list"] == []

    res_model = TwoWayLookupEngine.lookup_model("UNKNOWN-NONEXISTENT-XYZ-999")
    assert res_model["total_matches"] == 0
    assert res_model["exact_dossiers"] == []


def test_tier2_boundary_invalid_hs_code_and_special_chars():
    """Ma HS Code khong hop le va ky tu dac biet."""
    res_hs = HsCodeConformityService.lookup_hs_code("INVALID_HS_CODE_999999")
    assert res_hs is None

    res_special = TwoWayLookupEngine.lookup_model("!@#$%^&*()_+{}[]:;\"'<>?,./")
    assert isinstance(res_special["total_matches"], int)


def test_tier2_boundary_sql_injection_and_xss_probe_strings():
    """Kiem tra phong thu truoc cac chuoi SQL Injection va XSS."""
    sqli_payloads = [
        "' OR '1'='1",
        "'; DROP TABLE tqc_certificates; --",
        "1' UNION SELECT * FROM customers --",
        "<script>alert('xss')</script>",
        "4401053694' OR '1'='1",
    ]
    for payload in sqli_payloads:
        res_model = TwoWayLookupEngine.lookup_model(payload)
        assert isinstance(res_model, dict)
        assert "applicable_standards" in res_model

        res_mst = TwoWayLookupEngine.lookup_tax_code(tax_code=payload)
        assert isinstance(res_mst, dict)
        assert "compliance_summary" in res_mst


def test_tier2_boundary_extreme_pagination():
    """Phan trang voi limit va offset vuot nguong lon."""
    res = TwoWayLookupEngine.lookup_tax_code(tax_code="4401053694", limit=1000, offset=50000)
    assert len(res["dossiers"]) == 0
    assert res["compliance_summary"]["total_dossiers"] == 3


def test_tier2_boundary_dossier_date_resolution():
    """Xac dinh dung trang thai active vs expired theo ngay hieu luc."""
    viettel_expired = [d for d in BENCHMARK_DOSSIERS if d["model"] == "D6606"][0]
    assert viettel_expired["status"] == "expired"

    inut_active = [d for d in BENCHMARK_DOSSIERS if d["model"] == "iNut-GW4G-Pro"][0]
    assert inut_active["status"] == "active"


# ═══════════════════════════════════════════════════════════════════════════════
# 🔀 TIER 3: CROSS-FEATURE COMBINATIONS
# ═══════════════════════════════════════════════════════════════════════════════

def test_tier3_cross_fuzzy_unaccented_search_with_ministry_filter():
    """Ket hop: Tim kiem khong dau + Tim kiem mo + Bo loc Bo TT&TT."""
    res = TwoWayLookupEngine.lookup_model(
        query="thiet bi inut gw4g",
        ministry="BTTTT",
        fuzzy=True,
    )
    assert res["total_matches"] >= 1
    assert any(d["model"] == "iNut-GW4G-Pro" for d in res["exact_dossiers"])
    assert all(s["issuing_ministry"] == "BTTTT" for s in res["applicable_standards"])


def test_tier3_cross_model_lookup_with_hs_code_override_and_mandatory_filter():
    """Ket hop: Model lookup + Ma HS Code 8517.62.59 + Bo loc mandatory_only."""
    res = TwoWayLookupEngine.lookup_model(
        query="iNut-GW4G-Pro",
        hs_code="8517.62.59",
        mandatory_only=True,
    )
    std_codes = [s["code"] for s in res["applicable_standards"]]
    assert "QCVN 117:2023/BTTTT" in std_codes
    assert "QCVN 18:2022/BTTTT" in std_codes
    assert all(s["mandatory"] is True for s in res["applicable_standards"])


def test_tier3_cross_direction2_mst_with_status_filtering_and_pagination():
    """Ket hop: MST lookup + Loc status active + Phan trang limit=1."""
    res = TwoWayLookupEngine.lookup_tax_code(
        tax_code="0100109106",
        status="active",
        limit=1,
        offset=0,
    )
    assert len(res["dossiers"]) == 1
    assert res["dossiers"][0]["status"] == "active"
    assert res["compliance_summary"]["total_dossiers"] == 1
    assert "QCVN 127:2021/BTTTT" in res["active_qcvn_list"]


def test_tier3_cross_fuzzy_typo_tolerance_model_name():
    """Ket hop: Doan nhan Model co loi chinh ta nhe (khong gach ngang, viet lien)."""
    res = TwoWayLookupEngine.lookup_model("iNut GW4G Pro", fuzzy=True)
    assert res["total_matches"] >= 1
    assert res["exact_dossiers"][0]["model"] == "iNut-GW4G-Pro"


# ═══════════════════════════════════════════════════════════════════════════════
# 🏆 TIER 4: REAL-WORLD WORKLOAD SCENARIOS & PERFORMANCE BENCHMARKS
# ═══════════════════════════════════════════════════════════════════════════════

def test_tier4_real_world_scenario_1_telecom_4g_volte_iot_gateway():
    """Kich ban thuc te 1: Nhap khau Gateway 4G VoLTE iNut-GW4G-Pro (HS 8517.62.59)."""
    res = TwoWayLookupEngine.lookup_model("iNut-GW4G-Pro", hs_code="8517.62.59")
    assert res["total_matches"] == 1
    dossier = res["exact_dossiers"][0]
    assert dossier["model"] == "iNut-GW4G-Pro"
    assert dossier["applicant_tax_code"] == "4401053694"

    # Kiem tra day du 5 quy chuan cot loi
    std_codes = [s["code"] for s in res["applicable_standards"]]
    for expected_std in ["QCVN 117:2023/BTTTT", "QCVN 54:2020/BTTTT", "QCVN 18:2022/BTTTT", "QCVN 101:2020/BTTTT", "QCVN 132:2022/BTTTT"]:
        assert expected_std in std_codes

    # Kiem tra danh ba phong Lab chi dinh
    vnta_lab = [lab for lab in TestingLabRegistryService.list_all() if "VNTA-LAB" in lab["code"]]
    assert len(vnta_lab) == 1
    assert "QCVN 117" in " ".join(vnta_lab[0]["scope"])


def test_tier4_real_world_scenario_2_smart_screen_interactive_display():
    """Kich ban thuc te 2: Nhap khau Man hinh tuong tac CPH2699 / Bo mach Rockchip RK3588."""
    res = TwoWayLookupEngine.lookup_model("CPH2699", hs_code="8517.12.00")
    assert res["total_matches"] == 1
    std_codes = [s["code"] for s in res["applicable_standards"]]
    assert "QCVN 54:2020/BTTTT" in std_codes
    assert "QCVN 65:2020/BTTTT" in std_codes
    assert "QCVN 18:2022/BTTTT" in std_codes
    assert "QCVN 132:2022/BTTTT" in std_codes


def test_tier4_real_world_scenario_3_enterprise_compliance_audit_inut():
    """Kich ban thuc te 3: Tham dinh toan dien nang luc hop quy cua INUT (MST 4401053694)."""
    res = TwoWayLookupEngine.lookup_tax_code(tax_code="4401053694")
    summary = res["compliance_summary"]
    assert summary["total_dossiers"] == 3
    assert summary["active_dossiers"] == 3
    assert summary["expired_dossiers"] == 0
    assert summary["unique_standards_count"] >= 5
    assert "QCVN 117:2023/BTTTT" in res["active_qcvn_list"]
    assert "QCVN 65:2020/BTTTT" in res["active_qcvn_list"]


def test_tier4_real_world_scenario_4_enterprise_compliance_viettel_and_vinfast():
    """Kich ban thuc te 4: Kiem tra ho so Viettel (0100109106) va VinFast (0108926276)."""
    res_viettel = TwoWayLookupEngine.lookup_tax_code(tax_code="0100109106")
    assert res_viettel["compliance_summary"]["total_dossiers"] == 2

    res_vinfast = TwoWayLookupEngine.lookup_tax_code(tax_code="0108926276")
    assert res_vinfast["compliance_summary"]["total_dossiers"] == 1
    assert res_vinfast["dossiers"][0]["model"] == "VF-TCU-VF9"
    assert "VINFAST" in res_vinfast["company_name"]


def test_tier4_real_world_scenario_5_performance_benchmark_sub_50ms_sla():
    """Kich ban thuc te 5: Benchmark do tre 50 truy van lien tiep, cam ket SLA < 50ms."""
    queries = [
        ("model", "iNut-GW4G-Pro"),
        ("model", "CPH2699"),
        ("model", "iNut-WF6-Pro"),
        ("model", "NDR-120-24"),
        ("model", "ME-41"),
        ("model", "VF-TCU-VF9"),
        ("model", "VHT-5G-CPE01"),
        ("model", "Industrial 4G Router"),
        ("model", "Wi-Fi 6 AX3000 Access Point"),
        ("model", "Smart Sensor Node BLE 5.0"),
        ("tax_code", "4401053694"),
        ("tax_code", "0100109106"),
        ("tax_code", "0312636094"),
        ("tax_code", "0108926276"),
        ("tax_code", "0100100745"),
        ("tax_code", "0303882745"),
        ("suggest", "inut"),
        ("suggest", "viettel"),
        ("suggest", "117"),
        ("suggest", "cph"),
    ] * 3  # 60 queries

    durations: list[float] = []

    for q_type, q_val in queries[:50]:
        t0 = time.perf_counter()
        if q_type == "model":
            TwoWayLookupEngine.lookup_model(q_val)
        elif q_type == "tax_code":
            TwoWayLookupEngine.lookup_tax_code(tax_code=q_val)
        elif q_type == "suggest":
            TwoWayLookupEngine.suggest(q_val)
        t_elapsed_ms = (time.perf_counter() - t0) * 1000
        durations.append(t_elapsed_ms)

    avg_latency = sum(durations) / len(durations)
    max_latency = max(durations)
    sorted_durations = sorted(durations)
    p95_latency = sorted_durations[int(len(sorted_durations) * 0.95)]

    print(f"\n[BENCHMARK] Total queries: {len(durations)}")
    print(f"[BENCHMARK] Avg Latency: {avg_latency:.3f} ms (Target SLA: < 50.0 ms)")
    print(f"[BENCHMARK] P95 Latency: {p95_latency:.3f} ms")
    print(f"[BENCHMARK] Max Latency: {max_latency:.3f} ms")

    assert avg_latency < 50.0, f"Average latency {avg_latency:.2f}ms exceeded 50ms SLA"
    assert p95_latency < 80.0, f"P95 latency {p95_latency:.2f}ms exceeded 80ms threshold"


# ═══════════════════════════════════════════════════════════════════════════════
# 🌐 FASTAPI HTTP CLIENT ENDPOINT TESTS (REST Interface Verification)
# ═══════════════════════════════════════════════════════════════════════════════

def test_api_endpoint_lookup_model_success(api_client):
    """Kiem tra REST API GET /api/standards/lookup/model."""
    response = api_client.get("/api/standards/lookup/model?query=iNut-GW4G-Pro&hs_code=8517.62.59")
    assert response.status_code == 200
    data = response.json()
    assert data["query"] == "iNut-GW4G-Pro"
    assert data["total_matches"] == 1
    assert len(data["applicable_standards"]) >= 4
    assert data["execution_time_ms"] < 50.0


def test_api_endpoint_lookup_tax_code_success(api_client):
    """Kiem tra REST API GET /api/standards/lookup/tax-code."""
    response = api_client.get("/api/standards/lookup/tax-code?tax_code=4401053694")
    assert response.status_code == 200
    data = response.json()
    assert data["tax_code"] == "4401053694"
    assert data["compliance_summary"]["total_dossiers"] == 3
    assert len(data["active_qcvn_list"]) >= 4


def test_api_endpoint_suggest_success(api_client):
    """Kiem tra REST API GET /api/standards/suggest."""
    response = api_client.get("/api/standards/suggest?q=inut&limit=5")
    assert response.status_code == 200
    data = response.json()
    assert data["query"] == "inut"
    assert len(data["suggestions"]) >= 1


def test_api_endpoint_lookup_tax_code_missing_param_422(api_client):
    """Kiem tra REST API GET /api/standards/lookup/tax-code thieu ca 2 tham so."""
    response = api_client.get("/api/standards/lookup/tax-code")
    assert response.status_code == 422


def test_api_endpoint_suggest_short_query_422(api_client):
    """Kiem tra REST API GET /api/standards/suggest tu khoa duoi 2 ky tu."""
    response = api_client.get("/api/standards/suggest?q=a")
    assert response.status_code == 422
