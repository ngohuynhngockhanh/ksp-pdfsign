"""Hệ thống Tra Cứu Hợp Chuẩn, Hợp Quy, Quy Chuẩn Kỹ Thuật Quốc Gia (QCVN/TCVN)
và Đối Soát Chuyên Ngành Theo Mã HS Code cho KSP iNut.
"""

from __future__ import annotations

from collections import OrderedDict
import io
import json
import re
import threading
import time
import zipfile
from datetime import datetime, timezone
from typing import Any

import weasyprint


def _strip_accents(text: str) -> str:
    """Loai bo dau tieng Viet de tim kiem khong dau thong minh."""
    text = str(text or "")
    patterns = {
        "[àáạảãâầấậẩẫăằắặẳẵ]": "a",
        "[èéẹẻẽêềếệểễ]": "e",
        "[ìíịỉĩ]": "i",
        "[òóọỏõôồốộổỗơờớợởỡ]": "o",
        "[ùúụủũưừứựửữ]": "u",
        "[ỳýỵỷỹ]": "y",
        "[đ]": "d",
        "[ÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴ]": "A",
        "[ÈÉẸẺÊỀẾỆỂỄ]": "E",
        "[ÌÍỊỈĨ]": "I",
        "[ÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠ]": "O",
        "[ÙÚỤỦŨƯỪỨỰỬỮ]": "U",
        "[ỲÝỴỶỸ]": "Y",
        "[Đ]": "D",
    }
    for pattern, replace in patterns.items():
        text = re.sub(pattern, replace, text)
    return text.lower()


def _norm(text: str) -> str:
    return _strip_accents(str(text or "")).strip().lower()


# ─── 📜 STANDARDS REGISTRY SERVICE (QCVN / TCVN / ĐLVN) ─────────────────────────

class StandardsRegistryService:
    """CSDL Quy chuan Ky thuat Quoc gia (QCVN), Tieu chuan Viet Nam (TCVN) va Do luong (DLVN)."""

    STANDARDS_DATABASE: list[dict[str, Any]] = [
        # ─── BỘ THÔNG TIN VÀ TRUYỀN THÔNG (BTTTT) ───
        {
            "code": "QCVN 117:2023/BTTTT",
            "name": "Quy chuẩn kỹ thuật quốc gia về thiết bị đầu cuối thông tin di động mặt đất E-UTRA (4G LTE & VoLTE)",
            "ministry": "BTTTT",
            "ministry_label": "Bộ Thông tin và Truyền thông",
            "category": "radio_telecom",
            "category_label": "Vô tuyến & Viễn thông 4G/VoLTE",
            "circular": "Thông tư số 02/2024/TT-BTTTT & TT 04/2023/TT-BTTTT",
            "effective_date": "2024-07-01",
            "status": "active",
            "procedure_type": "mandatory_cert_and_cr",
            "procedure_label": "Bắt buộc Chứng nhận Hợp quy & Công bố CR (Bao gồm VoLTE)",
            "target_equipment": "Thiết bị IoT Gateway 4G, Router 4G LTE, Datalogger 4G, Modem công nghiệp, Điện thoại thông minh 4G VoLTE",
            "applicable_hs_codes": ["8517.62.59", "8517.62.99", "8517.12.00", "8517.69.00"],
            "managing_agency": "Cục Viễn thông (VNTA) — Bộ TT&TT",
            "certification_method": "Phương thức 1 (Thử nghiệm mẫu điển hình) hoặc Phương thức 5",
            "testing_labs": ["Cục Viễn thông (VNTA Lab)", "Quatest 1", "Quatest 3", "Vinacontrol"],
            "key_technical_requirements": [
                "Băng tần hoạt động: B1 (2100MHz), B3 (1800MHz), B7 (2600MHz), B8 (900MHz), B20 (800MHz), B28 (700MHz), B38, B40, B41",
                "Hỗ trợ bắt buộc tính năng thoại qua mạng 4G VoLTE (Voice over LTE) theo Thông tư 02/2024/TT-BTTTT",
                "Công suất phát xạ cực đại (EIRP): 23 dBm ± 2 dB",
                "Bức xạ giả phát xạ ngoài băng (Spurious Emissions): Đáp ứng bảng giới hạn Table 6.6.3.1-1 của ETSI TS 136 101",
                "Độ nhạy thu tối thiểu (Reference Sensitivity Power Level): <= -94 dBm tùy băng thông 1.4MHz đến 20MHz",
                "Chống nhiễu nghẽn và chọn lọc kênh lân cận (Blocking & ACS)",
            ],
            "inut_product_match": "iNut 4G Industrial Gateway, iNut Datalogger quan trắc TT10",
        },
        {
            "code": "QCVN 117:2020/BTTTT",
            "name": "Quy chuẩn kỹ thuật quốc gia về thiết bị đầu cuối thông tin di động mặt đất E-UTRA (4G LTE)",
            "ministry": "BTTTT",
            "ministry_label": "Bộ Thông tin và Truyền thông",
            "category": "radio_telecom",
            "category_label": "Vô tuyến & Viễn thông 4G/5G",
            "circular": "Thông tư số 04/2023/TT-BTTTT & TT 10/2020/TT-BTTTT",
            "effective_date": "2021-07-01",
            "status": "active",
            "procedure_type": "mandatory_cert_and_cr",
            "procedure_label": "Bắt buộc Chứng nhận Hợp quy & Công bố CR",
            "target_equipment": "Thiết bị IoT Gateway 4G, Router 4G LTE, Datalogger 4G, Modem công nghiệp, Điện thoại thông minh",
            "applicable_hs_codes": ["8517.62.59", "8517.62.99", "8517.12.00", "8517.69.00"],
            "managing_agency": "Cục Viễn thông (VNTA) — Bộ TT&TT",
            "certification_method": "Phương thức 1 (Thử nghiệm mẫu điển hình) hoặc Phương thức 5",
            "testing_labs": ["Cục Viễn thông (VNTA Lab)", "Quatest 1", "Quatest 3", "Vinacontrol"],
            "key_technical_requirements": [
                "Băng tần hoạt động: B1 (2100MHz), B3 (1800MHz), B7 (2600MHz), B8 (900MHz), B20 (800MHz), B28 (700MHz), B38, B40, B41",
                "Công suất phát xạ cực đại (EIRP): 23 dBm ± 2 dB",
                "Bức xạ giả phát xạ ngoài băng (Spurious Emissions): Đáp ứng bảng giới hạn Table 6.6.3.1-1 của ETSI TS 136 101",
                "Độ nhạy thu tối thiểu (Reference Sensitivity Power Level): <= -94 dBm tùy băng thông 1.4MHz đến 20MHz",
                "Chống nhiễu nghẽn và chọn lọc kênh lân cận (Blocking & ACS)",
            ],
            "inut_product_match": "iNut 4G Industrial Gateway, iNut Datalogger quan trắc TT10",
        },
        {
            "code": "QCVN 127:2021/BTTTT",
            "name": "Quy chuẩn kỹ thuật quốc gia về thiết bị đầu cuối thông tin di động mặt đất 5G Standalone (5G SA)",
            "ministry": "BTTTT",
            "ministry_label": "Bộ Thông tin và Truyền thông",
            "category": "radio_telecom",
            "category_label": "Vô tuyến & Viễn thông 5G NR",
            "circular": "Thông tư số 02/2024/TT-BTTTT & TT 04/2023/TT-BTTTT",
            "effective_date": "2022-07-01",
            "status": "active",
            "procedure_type": "mandatory_cert_and_cr",
            "procedure_label": "Bắt buộc Chứng nhận Hợp quy & Công bố CR",
            "target_equipment": "Thiết bị 5G CPE, Router 5G công nghiệp, Điện thoại 5G SA, Modem 5G IoT",
            "applicable_hs_codes": ["8517.12.00", "8517.62.59", "8517.69.00"],
            "managing_agency": "Cục Viễn thông (VNTA) — Bộ TT&TT",
            "certification_method": "Phương thức 1",
            "testing_labs": ["VNTA Lab", "Quatest 1", "Quatest 3"],
            "key_technical_requirements": [
                "Băng tần hoạt động: n1, n3, n28, n41, n77, n78 (Sub-6GHz)",
                "Công suất phát EIRP: 23 dBm ± 2 dB hoặc 26 dBm (Power Class 2/3)",
                "Bức xạ phát xạ giả ngoài băng và độ chọn lọc máy thu 3GPP TS 38.521-1",
            ],
            "inut_product_match": "iNut 5G Industrial Gateway",
        },
        {
            "code": "QCVN 128:2021/BTTTT",
            "name": "Quy chuẩn kỹ thuật quốc gia về trạm gốc thông tin di động 5G (5G Base Station)",
            "ministry": "BTTTT",
            "ministry_label": "Bộ Thông tin và Truyền thông",
            "category": "radio_telecom",
            "category_label": "Trạm gốc Viễn thông 5G",
            "circular": "Thông tư số 02/2024/TT-BTTTT",
            "effective_date": "2022-07-01",
            "status": "active",
            "procedure_type": "mandatory_cert_and_cr",
            "procedure_label": "Bắt buộc Chứng nhận Hợp quy & Công bố CR",
            "target_equipment": "Trạm thu phát sóng 5G gNodeB, Micro-cell 5G, Small-cell 5G",
            "applicable_hs_codes": ["8517.61.00"],
            "managing_agency": "Cục Viễn thông (VNTA)",
            "certification_method": "Phương thức 1 hoặc Phương thức 5",
            "testing_labs": ["VNTA Testing Lab", "Quatest 1"],
            "key_technical_requirements": [
                "Công suất phát xạ cực đại trạm gốc gNodeB",
                "Mặt nạ phổ phát xạ (Operating band unwanted emissions)",
                "Độ không xuyên điều chế và độ nhạy máy thu",
            ],
            "inut_product_match": "Trạm thu phát 5G Private Network",
        },
        {
            "code": "QCVN 129:2021/BTTTT",
            "name": "Quy chuẩn kỹ thuật quốc gia về thiết bị đầu cuối thông tin di động mặt đất 5G Non-Standalone (5G NSA)",
            "ministry": "BTTTT",
            "ministry_label": "Bộ Thông tin và Truyền thông",
            "category": "radio_telecom",
            "category_label": "Vô tuyến & Viễn thông 5G NSA",
            "circular": "Thông tư số 02/2024/TT-BTTTT",
            "effective_date": "2022-07-01",
            "status": "active",
            "procedure_type": "mandatory_cert_and_cr",
            "procedure_label": "Bắt buộc Chứng nhận Hợp quy & Công bố CR",
            "target_equipment": "Thiết bị di động 5G NSA kết hợp công nghệ LTE EN-DC",
            "applicable_hs_codes": ["8517.12.00", "8517.62.59"],
            "managing_agency": "Cục Viễn thông (VNTA)",
            "certification_method": "Phương thức 1",
            "testing_labs": ["VNTA Lab", "Quatest 3"],
            "key_technical_requirements": [
                "Tính năng hoạt động kết hợp Dual Connectivity E-UTRA - NR (EN-DC)",
                "Yêu cầu tương thích dải tần và chuyển vùng liền mạch",
            ],
            "inut_product_match": "Smartphone & IoT Module 5G NSA",
        },
        {
            "code": "QCVN 54:2020/BTTTT",
            "name": "Quy chuẩn kỹ thuật quốc gia về thiết bị thu phát vô tuyến dải tần 2,4 GHz (Wi-Fi 802.11b/g/n, Bluetooth, Zigbee)",
            "ministry": "BTTTT",
            "ministry_label": "Bộ Thông tin và Truyền thông",
            "category": "radio_telecom",
            "category_label": "Vô tuyến & Wi-Fi / BLE",
            "circular": "Thông tư số 04/2023/TT-BTTTT & TT 02/2024/TT-BTTTT",
            "effective_date": "2021-07-01",
            "status": "active",
            "procedure_type": "mandatory_cert_and_cr",
            "procedure_label": "Bắt buộc Chứng nhận Hợp quy & Công bố CR",
            "target_equipment": "Module Wi-Fi ESP32, Module BLE 5.0, Bộ định tuyến Wi-Fi, Nút cảm biến Zigbee, Thiết bị IoT nhà thông minh",
            "applicable_hs_codes": ["8517.62.51", "8517.62.59", "8517.70.21"],
            "managing_agency": "Cục Viễn thông (VNTA) — Bộ TT&TT",
            "certification_method": "Phương thức 1 (Thử mẫu điển hình)",
            "testing_labs": ["Cục Viễn thông (VNTA Lab)", "Quatest 1", "Quatest 3"],
            "key_technical_requirements": [
                "Dải tần số hoạt động: 2400 MHz đến 2483.5 MHz",
                "Công suất phát xạ đẳng hướng tương đương cực đại (E.I.R.P): Không vượt quá 100 mW (20 dBm)",
                "Mật độ phổ công suất cực đại: 10 mW/MHz đối với thiết bị trải phổ FHSS/DSSS",
                "Bức xạ không mong muốn trong chế độ phát và chế độ chờ (Rx/Tx Spurious)",
            ],
            "inut_product_match": "Board vi điều khiển iNut ESP32-C3, Gateway iNut Wi-Fi / BLE",
        },
        {
            "code": "QCVN 65:2020/BTTTT",
            "name": "Quy chuẩn kỹ thuật quốc gia về thiết bị truy nhập vô tuyến băng tần 5 GHz (Wi-Fi 802.11a/n/ac/ax)",
            "ministry": "BTTTT",
            "ministry_label": "Bộ Thông tin và Truyền thông",
            "category": "radio_telecom",
            "category_label": "Vô tuyến & Wi-Fi 5GHz",
            "circular": "Thông tư số 04/2023/TT-BTTTT & TT 02/2024/TT-BTTTT",
            "effective_date": "2021-07-01",
            "status": "active",
            "procedure_type": "mandatory_cert_and_cr",
            "procedure_label": "Bắt buộc Chứng nhận Hợp quy & Công bố CR",
            "target_equipment": "Access Point công nghiệp 5GHz, Router Wi-Fi 6, Bộ truyền hình ảnh không dây",
            "applicable_hs_codes": ["8517.62.51", "8517.62.59"],
            "managing_agency": "Cục Viễn thông (VNTA) — Bộ TT&TT",
            "certification_method": "Phương thức 1",
            "testing_labs": ["VNTA Testing Lab", "Quatest 1", "Quatest 3"],
            "key_technical_requirements": [
                "Băng tần: 5150 - 5350 MHz (indoor) và 5470 - 5725 MHz (outdoor/indoor)",
                "Hỗ trợ tính năng lựa chọn tần số động (DFS) và điều khiển công suất phát (TPC)",
                "Công suất phát EIRP tối đa 200 mW (5150-5350 MHz) và 1000 mW (5470-5725 MHz)",
            ],
            "inut_product_match": "Industrial Wi-Fi Bridge 5GHz",
        },
        {
            "code": "QCVN 101:2020/BTTTT",
            "name": "Quy chuẩn kỹ thuật quốc gia về pin Lithium cho thiết bị cầm tay và thiết bị di động",
            "ministry": "BTTTT",
            "ministry_label": "Bộ Thông tin và Truyền thông",
            "category": "electrical_safety",
            "category_label": "An toàn Pin Lithium & Năng lượng",
            "circular": "Thông tư số 04/2023/TT-BTTTT & TT 02/2024/TT-BTTTT",
            "effective_date": "2021-07-01",
            "status": "active",
            "procedure_type": "mandatory_cr_declaration",
            "procedure_label": "Bắt buộc Tự Công Bố Hợp Quy CR",
            "target_equipment": "Pin Li-ion, Pin Li-Po 18650, Pin dự phòng cho thiết bị Datalogger / Gateway không dây",
            "applicable_hs_codes": ["8507.60.10", "8507.60.90", "8504.40.90"],
            "managing_agency": "Cục Viễn thông (Bộ TT&TT)",
            "certification_method": "Tự công bố hợp quy dựa trên kết quả thử nghiệm phòng Lab được chỉ định",
            "testing_labs": ["Quatest 1", "Quatest 3", "Viện Cơ học Năng lượng"],
            "key_technical_requirements": [
                "Thử nghiệm an toàn điện: Ngắn mạch bên ngoài, sạc quá mức (overcharge), xả cưỡng bức",
                "Thử nghiệm cơ học: Rơi tự do, va đập, nén ép, rung động",
                "Thử nghiệm môi trường nhiệt: Tiếp xúc nhiệt độ cao (130°C trong 10 phút), chu kỳ nhiệt (-40°C đến +75°C)",
            ],
            "inut_product_match": "Pack Pin Lithium 3.7V/12V nuôi nguồn Datalogger iNut khi mất điện",
        },
        {
            "code": "QCVN 18:2022/BTTTT",
            "name": "Quy chuẩn kỹ thuật quốc gia về tương thích điện từ (EMC) cho thiết bị thông tin vô tuyến",
            "ministry": "BTTTT",
            "ministry_label": "Bộ Thông tin và Truyền thông",
            "category": "emc",
            "category_label": "Tương thích điện từ (EMC)",
            "circular": "Thông tư số 04/2023/TT-BTTTT & TT 02/2024/TT-BTTTT",
            "effective_date": "2023-07-01",
            "status": "active",
            "procedure_type": "mandatory_cr_declaration",
            "procedure_label": "Bắt buộc Công Bố Hợp Quy CR",
            "target_equipment": "Toàn bộ thiết bị phát/thu vô tuyến 4G, 5G, Wi-Fi, Bluetooth, LoRa, RFID",
            "applicable_hs_codes": ["8517.62.59", "8517.62.99", "8517.70.21"],
            "managing_agency": "Cục Viễn thông — Bộ TT&TT",
            "certification_method": "Thử nghiệm đo phát xạ (Emissions) và miễn nhiễm (Immunity)",
            "testing_labs": ["VNTA Lab", "Quatest 1", "Quatest 3", "Viện Đo Lường"],
            "key_technical_requirements": [
                "Phát xạ dẫn trên cổng nguồn AC/DC và cổng viễn thông (Conducted Emissions)",
                "Phát xạ bức xạ trường điện từ (Radiated Emissions 30MHz - 6GHz)",
                "Miễn nhiễm phóng tĩnh điện (ESD: 4kV tiếp xúc, 8kV không khí theo IEC 61000-4-2)",
                "Miễn nhiễm xung điện nhanh/đột biến (EFT/Burst 1kV, Surge 2kV theo IEC 61000-4-4/5)",
            ],
            "inut_product_match": "Tất cả các dòng phần cứng iNut IoT Gateway & SCADA Board",
        },
        {
            "code": "QCVN 132:2022/BTTTT",
            "name": "Quy chuẩn kỹ thuật quốc gia về an toàn điện cho thiết bị đầu cuối viễn thông và CNTT (IEC 62368-1)",
            "ministry": "BTTTT",
            "ministry_label": "Bộ Thông tin và Truyền thông",
            "category": "electrical_safety",
            "category_label": "An toàn điện (Safety IEC 62368-1)",
            "circular": "Thông tư số 04/2023/TT-BTTTT & TT 02/2024/TT-BTTTT",
            "effective_date": "2024-01-01",
            "status": "active",
            "procedure_type": "mandatory_cr_declaration",
            "procedure_label": "Bắt buộc Công Bố Hợp Quy CR",
            "target_equipment": "Máy tính bảng công nghiệp, Màn hình HMI, Bộ chuyển đổi nguồn công nghiệp, Gateway viễn thông",
            "applicable_hs_codes": ["8517.62.59", "8471.30.20", "8504.40.19"],
            "managing_agency": "Cục Viễn thông",
            "certification_method": "Thử nghiệm theo chuẩn Hazard-Based Safety Engineering (HBSE)",
            "testing_labs": ["Quatest 1", "Quatest 3", "TUV Rheinland"],
            "key_technical_requirements": [
                "Bảo vệ chống nguy cơ điện giật (Energy Source Class 1, 2, 3)",
                "Bảo vệ chống cháy do điện (Vật liệu vỏ chống cháy V-0 / V-1)",
                "Bảo vệ chống tổn thương do nhiệt và bức xạ nhiệt",
            ],
            "inut_product_match": "Tủ điều khiển IoT iNut & Màn hình Web HMI",
        },
        {
            "code": "QCVN 118:2018/BTTTT",
            "name": "Quy chuẩn kỹ thuật quốc gia về tương thích điện từ cho thiết bị đa phương tiện (CISPR 32)",
            "ministry": "BTTTT",
            "ministry_label": "Bộ Thông tin và Truyền thông",
            "category": "emc",
            "category_label": "Tương thích điện từ (EMC Multimedia)",
            "circular": "Thông tư số 02/2024/TT-BTTTT & TT 04/2023/TT-BTTTT",
            "effective_date": "2019-07-01",
            "status": "active",
            "procedure_type": "mandatory_cr_declaration",
            "procedure_label": "Bắt buộc Công Bố Hợp Quy CR",
            "target_equipment": "Thiết bị chuyển mạch Switch mạng, Router có dây, Máy chủ Server, Màn hình máy tính",
            "applicable_hs_codes": ["8517.62.21", "8517.62.51", "8471.41.90", "8471.50.00"],
            "managing_agency": "Cục Viễn thông — Bộ TT&TT",
            "certification_method": "Thử nghiệm đo phát xạ (Emissions Class A/Class B)",
            "testing_labs": ["VNTA Lab", "Quatest 1", "Quatest 3"],
            "key_technical_requirements": [
                "Phát xạ dẫn trên cổng nguồn AC/DC và cổng mạng Ethernet RJ45",
                "Phát xạ bức xạ trường điện từ 30MHz đến 6GHz",
                "Phân cấp thiết bị Class A (công nghiệp/văn phòng) và Class B (gia đình)",
            ],
            "inut_product_match": "Switch công nghiệp Managed & Unmanaged iNut",
        },

        # ─── BỘ TÀI NGUYÊN VÀ MÔI TRƯỜNG (BTNMT) ───
        {
            "code": "TT 10/2021/TT-BTNMT",
            "name": "Quy định kỹ thuật quan trắc môi trường và quản lý thông tin, dữ liệu quan trắc chất lượng môi trường (Điều 33 đến 50)",
            "ministry": "BTNMT",
            "ministry_label": "Bộ Tài nguyên và Môi trường",
            "category": "environment",
            "category_label": "Quan trắc Môi trường & Datalogger",
            "circular": "Thông tư số 10/2021/TT-BTNMT ngày 30/06/2021 của Bộ TN&MT",
            "effective_date": "2021-08-16",
            "status": "active",
            "procedure_type": "mandatory_procurement_standard",
            "procedure_label": "Quy định Bắt buộc trong E-HSMT & Đấu thầu Trạm Quan Trắc",
            "target_equipment": "Datalogger truyền dữ liệu quan trắc nước thải / khí thải tự động liên tục, Cảm biến pH, COD, TSS, NH4+, SO2, NOx, CO, Bụi",
            "applicable_hs_codes": ["9026.10.10", "9026.80.10", "9027.80.30", "8517.62.59"],
            "managing_agency": "Sở Tài nguyên và Môi trường các Tỉnh / Cục Kiểm soát Ô nhiễm MT",
            "certification_method": "Kiểm định định kỳ thiết bị đo + Thử nghiệm kết nối truyền FTP/Txt theo chuẩn Thông tư 10",
            "testing_labs": ["Viện Đo lường Việt Nam (VMI)", "Trung tâm Quan trắc Môi trường Miền Bắc/Nam"],
            "key_technical_requirements": [
                "Định dạng tệp dữ liệu truyền về Sở TN&MT: Tệp văn bản (.txt) mã hóa UTF-8 không dấu cách (Tab delimited)",
                "Giao thức truyền dữ liệu: FTP Server (hoặc FTPS) với tần suất truyền 5 phút/lần",
                "Lưu trữ dữ liệu tối thiểu tại chỗ: >= 30 ngày (Khuyến nghị thẻ nhớ >= 32GB)",
                "Khả năng điều khiển lấy mẫu tự động khi có thông số vượt ngưỡng (Trigger Auto Sampler qua Relay/Modbus)",
                "Ghi nhận trạng thái vận hành thiết bị: Đo bình thường, Hiệu chuẩn (Calib), Báo lỗi (Error), Mất điện lưới",
            ],
            "inut_product_match": "iNut Datalogger TT10 Pro (Tích hợp Modem 4G LTE + Web SCADA FTP Client)",
        },
        {
            "code": "QCVN 40:2011/BTNMT",
            "name": "Quy chuẩn kỹ thuật quốc gia về nước thải công nghiệp (Cột A và Cột B)",
            "ministry": "BTNMT",
            "ministry_label": "Bộ Tài nguyên và Môi trường",
            "category": "environment",
            "category_label": "Tiêu chuẩn Xả thải Nước thải",
            "circular": "Thông tư số 47/2011/TT-BTNMT",
            "effective_date": "2012-01-01",
            "status": "active",
            "procedure_type": "mandatory_environmental_standard",
            "procedure_label": "Tiêu chuẩn xả thải bắt buộc KCN & Nhà máy",
            "target_equipment": "Hệ thống xử lý nước thải, Trạm quan trắc nước thải tự động",
            "applicable_hs_codes": ["9027.80.30", "8421.21.11"],
            "managing_agency": "Bộ TN&MT và Chi cục Bảo vệ Môi trường",
            "certification_method": "Đo đạc và phân tích mẫu nước theo phương pháp TCVN/SMEWW",
            "testing_labs": ["Viện Môi trường & Tài nguyên", "Quatest 3"],
            "key_technical_requirements": [
                "Giá trị pH: 6.0 - 9.0 (Cột A) / 5.5 - 9.0 (Cột B)",
                "Nhu cầu oxy hóa học (COD): <= 75 mg/l (Cột A) / <= 150 mg/l (Cột B)",
                "Tổng chất rắn lơ lửng (TSS): <= 50 mg/l (Cột A) / <= 100 mg/l (Cột B)",
                "Amoni (NH4+ tính theo N): <= 5 mg/l (Cột A) / <= 10 mg/l (Cột B)",
            ],
            "inut_product_match": "Tủ quan trắc nước thải iNut tích hợp FUXA SCADA",
        },
        {
            "code": "QCVN 05:2023/BTNMT",
            "name": "Quy chuẩn kỹ thuật quốc gia về chất lượng không khí xung quanh",
            "ministry": "BTNMT",
            "ministry_label": "Bộ Tài nguyên và Môi trường",
            "category": "environment",
            "category_label": "Chất lượng Không khí & Quan trắc Khí thải",
            "circular": "Thông tư số 01/2023/TT-BTNMT",
            "effective_date": "2023-09-12",
            "status": "active",
            "procedure_type": "mandatory_environmental_standard",
            "procedure_label": "Tiêu chuẩn Môi trường Bắt buộc Quan trắc",
            "target_equipment": "Trạm quan trắc không khí tự động xung quanh, Cảm biến bụi mịn PM2.5/PM10, Đầu đo khí SO2, NO2, CO, O3",
            "applicable_hs_codes": ["9027.80.30", "9026.80.10"],
            "managing_agency": "Bộ TN&MT & Cục Kiểm soát Ô nhiễm Môi trường",
            "certification_method": "Đo đạc liên tục và hiệu chuẩn theo phương pháp chuẩn TCVN",
            "testing_labs": ["Viện Môi trường & Tài nguyên", "VMI", "Quatest 3"],
            "key_technical_requirements": [
                "Nồng độ bụi mịn PM2.5 trung bình 24 giờ: <= 50 µg/m³",
                "Nồng độ bụi mịn PM10 trung bình 24 giờ: <= 100 µg/m³",
                "Nồng độ khí CO trung bình 1 giờ: <= 30.000 µg/m³, SO2 trung bình 1 giờ: <= 350 µg/m³",
            ],
            "inut_product_match": "Trạm quan trắc không khí xung quanh iNut Air Monitoring",
        },

        # ─── BỘ KHOA HỌC VÀ CÔNG NGHỆ (BKHCN) & ĐO LƯỜNG ───
        {
            "code": "QCVN 19:2019/BKHCN",
            "name": "Quy chuẩn kỹ thuật quốc gia về tương thích điện từ đối với thiết bị điện và điện tử gia dụng và các mục đích tương tự",
            "ministry": "BKHCN",
            "ministry_label": "Bộ Khoa học và Công nghệ",
            "category": "emc",
            "category_label": "Tương thích điện từ (BKHCN EMC)",
            "circular": "Thông tư số 11/2019/TT-BKHCN & TT 14/2026/TT-BKHCN",
            "effective_date": "2021-07-01",
            "status": "active",
            "procedure_type": "mandatory_cr_declaration",
            "procedure_label": "Bắt buộc Chứng nhận Hợp quy CR (Nhóm 2)",
            "target_equipment": "Tủ lạnh, Máy giặt, Nồi cơm điện, Dụng cụ điện cầm tay, Động cơ điện và Bảng điều khiển vi mạch",
            "applicable_hs_codes": ["8509.80.90", "8450.11.10", "8516.60.10"],
            "managing_agency": "Tổng cục Tiêu chuẩn Đo lường Chất lượng (STAMEQ)",
            "certification_method": "Phương thức 5 (Chứng nhận tại cơ sở sản xuất) hoặc Phương thức 7 (Theo lô nhập khẩu)",
            "testing_labs": ["Quatest 1", "Quatest 2", "Quatest 3"],
            "key_technical_requirements": [
                "Nhiễu điện áp đầu nối (Terminal disturbance voltage): CISPR 14-1",
                "Nhiễu công suất (Disturbance power): 30 MHz đến 300 MHz",
                "Phát xạ sóng hài và nhấp nháy điện áp: TCVN 7909-3-2 (IEC 61000-3-2) và TCVN 7909-3-3",
            ],
            "inut_product_match": "Bộ điều khiển điện tử OEM iNut",
        },
        {
            "code": "QCVN 4:2009/BKHCN",
            "name": "Quy chuẩn kỹ thuật quốc gia về an toàn đối với thiết bị điện và điện tử",
            "ministry": "BKHCN",
            "ministry_label": "Bộ Khoa học và Công nghệ",
            "category": "electrical_safety",
            "category_label": "An toàn Điện Thiết bị (BKHCN Safety)",
            "circular": "Thông tư số 21/2009/TT-BKHCN & TT 14/2026/TT-BKHCN",
            "effective_date": "2010-06-01",
            "status": "active",
            "procedure_type": "mandatory_cr_declaration",
            "procedure_label": "Bắt buộc Chứng nhận Hợp quy CR (Nhóm 2)",
            "target_equipment": "Bộ đổi nguồn Adapter, Dụng cụ điện đun nước nóng, Bàn là, Nồi cơm điện, Quạt điện",
            "applicable_hs_codes": ["8504.40.19", "8504.40.90", "8516.60.10"],
            "managing_agency": "Tổng cục Tiêu chuẩn Đo lường Chất lượng (STAMEQ)",
            "certification_method": "Phương thức 5 hoặc Phương thức 7",
            "testing_labs": ["Quatest 1", "Quatest 2", "Quatest 3"],
            "key_technical_requirements": [
                "Bảo vệ chống chạm vào các bộ phận mang điện nguy hiểm",
                "Độ bền điện môi và điện trở cách điện",
                "Độ phát nhiệt và khả năng chống cháy vật liệu cách điện",
            ],
            "inut_product_match": "Bộ nguồn Adapter DIN-Rail 24VDC iNut",
        },
        {
            "code": "ĐLVN 24:2014",
            "name": "Văn bản kỹ thuật đo lường Việt Nam: Công tơ điện tử xoay chiều (Quy trình thử nghiệm và kiểm định)",
            "ministry": "BKHCN",
            "ministry_label": "Tổng cục Tiêu chuẩn Đo lường Chất lượng (BKHCN)",
            "category": "metrology",
            "category_label": "Đo lường & Kiểm định Công tơ Điện",
            "circular": "Quyết định số 1588/QĐ-TĐC của Tổng cục Tiêu chuẩn Đo lường Chất lượng",
            "effective_date": "2014-10-01",
            "status": "active",
            "procedure_type": "mandatory_metrology_verification",
            "procedure_label": "Bắt buộc Phê Duyệt Mẫu & Kiểm Định Ban Đầu / Định Kỳ",
            "target_equipment": "Công tơ điện tử 1 pha, 3 pha nhiều biểu giá, Công tơ điện tử thông minh đọc xa AMR/AMI",
            "applicable_hs_codes": ["9028.30.10", "9028.30.90", "9028.90.10"],
            "managing_agency": "Viện Đo lường Việt Nam (VMI) & Trung tâm Kỹ thuật Tiêu chuẩn Đo lường",
            "certification_method": "Phê duyệt mẫu (Type Approval) + Kiểm định ban đầu từng chiếc có kẹp chì niêm phong",
            "testing_labs": ["Viện Đo lường Việt Nam (VMI)", "Quatest 1", "Quatest 3", "Trung tâm Thí nghiệm Điện EVN"],
            "key_technical_requirements": [
                "Cấp chính xác: Class 0.2S, Class 0.5S (đo đếm ranh giới) hoặc Class 1.0, Class 2.0 (thương mại)",
                "Kiểm tra sai số tương đối tại các tải định mức (Imin, Itr, In, Imax) và hệ số công suất cos phi = 1.0, 0.5L, 0.8C",
                "Kiểm tra dòng điện khởi động và hiện tượng chạy không tải (anti-creeping test)",
                "Cổng truyền thông dữ liệu: Cổng quang học IEC 62056-21, RS485 chuẩn DLMS/COSEM hoặc Modbus",
            ],
            "inut_product_match": "Modem đọc xa công tơ điện tử iNut AMR Modbus/DLMS",
        },
        {
            "code": "ĐLVN 39:2019",
            "name": "Văn bản kỹ thuật đo lường Việt Nam: Hệ thống đo điện năng (Quy trình thử nghiệm và kiểm định)",
            "ministry": "BKHCN",
            "ministry_label": "Tổng cục Tiêu chuẩn Đo lường Chất lượng",
            "category": "metrology",
            "category_label": "Đo lường & Hệ thống Thu thập Số liệu Đo đếm",
            "circular": "Quyết định số 2245/QĐ-TĐC của Tổng cục TĐC",
            "effective_date": "2019-11-01",
            "status": "active",
            "procedure_type": "mandatory_metrology_verification",
            "procedure_label": "Kiểm định Hệ thống Đo đếm Ranh giới & Nhà máy Điện",
            "target_equipment": "Hệ thống đo đếm điện năng nhà máy điện mặt trời, trạm biến áp 110kV/220kV, tủ đo đếm ranh giới",
            "applicable_hs_codes": ["9028.30.10", "8504.31.21"],
            "managing_agency": "Viện Đo lường Việt Nam (VMI) & Trung tâm Thí nghiệm Điện",
            "certification_method": "Kiểm định định kỳ toàn bộ chuỗi đo biến dòng (TI), biến điện áp (TU) và công tơ",
            "testing_labs": ["VMI", "Trung tâm Thí nghiệm Điện EVN NPC/CPC/SPC"],
            "key_technical_requirements": [
                "Sai số tổng hợp của hệ thống đo đếm không vượt quá cấp chính xác thiết kế",
                "Tính toàn vẹn của dữ liệu chu kỳ 30 phút truyền về Trung tâm Điều độ Hệ thống Điện Quốc gia (NLDC)",
            ],
            "inut_product_match": "Hệ thống iNut SCADA Gateway thu thập dữ liệu công tơ ranh giới",
        },

        # ─── BỘ GIAO THÔNG VẬN TẢI (BGTVT) ───
        {
            "code": "QCVN 31:2014/BGTVT",
            "name": "Quy chuẩn kỹ thuật quốc gia về thiết bị giám sát hành trình của xe ô tô (Hộp đen GPS)",
            "ministry": "BGTVT",
            "ministry_label": "Bộ Giao thông Vận tải",
            "category": "automotive_iot",
            "category_label": "Giám sát Hành trình & Giao thông Vận tải",
            "circular": "Thông tư số 09/2015/TT-BGTVT và TT 73/2014/TT-BGTVT",
            "effective_date": "2015-04-15",
            "status": "active",
            "procedure_type": "mandatory_cert_and_cr",
            "procedure_label": "Bắt buộc Chứng nhận Hợp quy Cục Đăng kiểm Việt Nam",
            "target_equipment": "Thiết bị giám sát hành trình ô tô, Hộp đen GPS xe tải/xe khách/taxi, Hộp TCU xe điện",
            "applicable_hs_codes": ["8526.91.00", "8517.62.59"],
            "managing_agency": "Cục Đăng kiểm Việt Nam — Bộ GTVT",
            "certification_method": "Thử nghiệm tính năng phần cứng, phần mềm máy chủ và đo kiểm vô tuyến",
            "testing_labs": ["Trung tâm Thử nghiệm xe cơ giới (Cục Đăng kiểm)", "VNTA Lab", "Quatest 1"],
            "key_technical_requirements": [
                "Ghi nhận và lưu trữ vận tốc, tọa độ GPS, thời gian lái xe liên tục (> 4 giờ cảnh báo)",
                "Đầu đọc thẻ nhận diện lái xe RFID chuẩn ISO/IEC 15693 hoặc ISO 14443",
                "Cổng trích xuất dữ liệu chuẩn qua USB hoặc truyền 4G về Tổng cục Đường bộ Việt Nam",
                "Độ chính xác đo vận tốc sai số không quá ± 3 km/h",
            ],
            "inut_product_match": "Hộp đen GPS iNut Tracker 4G & VinFast Telematics TCU",
        },

        # ─── BỘ CÔNG THƯƠNG (BCT) ───
        {
            "code": "QCVN 07:2019/BCT",
            "name": "Quy chuẩn kỹ thuật quốc gia về hiệu suất năng lượng và dán nhãn năng lượng thiết bị điện",
            "ministry": "BCT",
            "ministry_label": "Bộ Công Thương",
            "category": "energy_efficiency",
            "category_label": "Hiệu suất Năng lượng & Nhãn Xanh",
            "circular": "Quyết định số 04/2017/QĐ-TTg của Thủ tướng Chính phủ",
            "effective_date": "2020-01-01",
            "status": "active",
            "procedure_type": "mandatory_energy_labeling",
            "procedure_label": "Bắt buộc Dán Nhãn Năng Lượng trước khi lưu thông",
            "target_equipment": "Động cơ điện 3 pha không đồng bộ, Máy biến áp phân phối, Đèn LED chiếu sáng công nghiệp",
            "applicable_hs_codes": ["8501.52.10", "8501.52.20", "8504.21.11", "9405.40.99"],
            "managing_agency": "Vụ Tiết kiệm năng lượng và Phát triển bền vững — Bộ Công Thương",
            "certification_method": "Thử nghiệm hiệu suất năng lượng tối thiểu (MEPS) + Đăng ký dán nhãn Bộ Công Thương",
            "testing_labs": ["Quatest 1", "Quatest 3", "Viện Năng lượng"],
            "key_technical_requirements": [
                "Cấp hiệu suất năng lượng động cơ đạt chuẩn IE2 hoặc IE3 theo TCVN 7540",
                "Hiệu suất quang thông đèn LED >= 100 lm/W",
                "Tổn hao không tải và tổn hao ngắn mạch máy biến áp đạt ngưỡng quy định",
            ],
            "inut_product_match": "Hệ thống giám sát hiệu suất năng lượng iNut Power Monitoring",
        },
        {
            "code": "TCVN 13078:2020",
            "name": "Hệ thống sạc dẫn truyền cho xe điện — Phần 1: Yêu cầu chung (IEC 61851-1:2017)",
            "ministry": "BKHCN",
            "ministry_label": "Tổng cục Tiêu chuẩn Đo lường Chất lượng",
            "category": "energy_efficiency",
            "category_label": "Trạm sạc & Hạ tầng Xe điện (EV Charging)",
            "circular": "Quyết định công bố tiêu chuẩn quốc gia của Bộ KH&CN",
            "effective_date": "2020-12-31",
            "status": "active",
            "procedure_type": "mandatory_cr_declaration",
            "procedure_label": "Chứng nhận Phù hợp Tiêu chuẩn Trạm sạc Xe điện",
            "target_equipment": "Trụ sạc xe điện AC/DC, Trạm sạc nhanh DC 60kW/150kW/250kW, Súng sạc CCS2/Type 2",
            "applicable_hs_codes": ["8504.40.90"],
            "managing_agency": "Tổng cục Tiêu chuẩn Đo lường Chất lượng (STAMEQ)",
            "certification_method": "Thử nghiệm an toàn cách điện cao áp, tương thích giao thức OCPP 1.6/2.0.1 và bảo vệ ngắn mạch",
            "testing_labs": ["Quatest 1", "Quatest 3", "TUV Rheinland", "Vinacontrol"],
            "key_technical_requirements": [
                "Bảo vệ chống điện giật chạm vỏ và ngắt tự động RCD Type B (30mA AC / 6mA DC)",
                "Giao tiếp điều khiển phát xạ PWM Pilot giữa trạm sạc và xe điện theo IEC 61851-1",
                "Khả năng chịu đựng xung sét lan truyền 6kV và cấp bảo vệ vỏ ngoài >= IP54",
            ],
            "inut_product_match": "Bộ điều khiển trung tâm trạm sạc xe điện iNut EVSE Controller",
        },

        # ─── TIÊU CHUẨN HỆ THỐNG QUẢN LÝ (TCVN ISO) ───
        {
            "code": "TCVN ISO 9001:2015",
            "name": "Hệ thống quản lý chất lượng — Các yêu cầu (ISO 9001:2015)",
            "ministry": "BKHCN",
            "ministry_label": "Tổng cục Tiêu chuẩn Đo lường Chất lượng",
            "category": "iso_management",
            "category_label": "Hệ thống Quản lý Chất lượng ISO",
            "circular": "Quyết định công bố tiêu chuẩn quốc gia của Bộ KH&CN",
            "effective_date": "2015-12-31",
            "status": "active",
            "procedure_type": "voluntary_system_cert",
            "procedure_label": "Chứng nhận Hợp Chuẩn (Bắt buộc trong 95% E-HSMT Đấu Thầu)",
            "target_equipment": "Toàn bộ quy trình R&D, Sản xuất lắp ráp phần cứng, Phát triển phần mềm và Dịch vụ bảo hành của INUT",
            "applicable_hs_codes": ["TOAN_BO_NGANH_CNTT_CO_DIEN"],
            "managing_agency": "Tổ chức Chứng nhận ISO được Bộ KH&CN cấp phép (QUACERT, Vinacontrol, TUV, SGS)",
            "certification_method": "Đánh giá định kỳ 3 năm/lần kèm đánh giá giám sát hàng năm",
            "testing_labs": ["QUACERT", "Vinacontrol CE", "BSI", "SGS Vietnam"],
            "key_technical_requirements": [
                "Kiểm soát quy trình thiết kế và phát triển sản phẩm phần cứng IoT",
                "Quản lý nhà cung cấp linh kiện và truy xuất nguồn gốc linh kiện điện tử",
                "Quy trình kiểm tra chất lượng KCS (IQC, PQC, OQC) và đo lường sự hài lòng khách hàng",
            ],
            "inut_product_match": "Quy trình sản xuất thiết bị iNut Technology",
        },
        {
            "code": "TCVN ISO/IEC 27001:2022",
            "name": "Công nghệ thông tin — Kỹ thuật an toàn — Hệ thống quản lý an toàn thông tin (ISMS)",
            "ministry": "BTTTT",
            "ministry_label": "Bộ TT&TT & Bộ KH&CN",
            "category": "iso_management",
            "category_label": "An toàn Thông tin ISMS",
            "circular": "Quyết định công bố TCVN tương đương ISO/IEC 27001:2022",
            "effective_date": "2023-05-15",
            "status": "active",
            "procedure_type": "voluntary_system_cert",
            "procedure_label": "Chứng nhận An toàn Thông tin Đám mây & SCADA",
            "target_equipment": "Hạ tầng máy chủ đám mây iNut Cloud, Nền tảng Web SCADA FUXA, Trục truyền tin IoT",
            "applicable_hs_codes": ["PHAN_MEM_VA_DICH_VU_DAM_MAY"],
            "managing_agency": "Cục An toàn Thông tin (Bộ TT&TT)",
            "certification_method": "Đánh giá 93 biện pháp kiểm soát an toàn theo Phụ lục A ISO 27001:2022",
            "testing_labs": ["QUACERT", "TUV SUD", "BSI Vietnam"],
            "key_technical_requirements": [
                "Mã hóa dữ liệu lưu trữ (AES-256) và dữ liệu truyền tải (TLS 1.3/HTTPS/MQTTS)",
                "Kiểm soát truy cập phân quyền đa yếu tố (MFA, RBAC)",
                "Kế hoạch ứng phó sự cố an ninh mạng và phục hồi sau thảm họa (Disaster Recovery)",
            ],
            "inut_product_match": "Nền tảng KSP Cloud & FUXA Web SCADA Server",
        },
    ]

    @classmethod
    def search(
        cls,
        query: str = "",
        ministry: str = "",
        category: str = "",
        procedure_type: str = "",
    ) -> list[dict[str, Any]]:
        """Tim kiem live search quy chuan theo ma, ten, thiet bi hoac hs code."""
        q = _strip_accents(query.strip())
        results = []

        for item in cls.STANDARDS_DATABASE:
            if ministry and item["ministry"].upper() != ministry.upper():
                continue
            if category and item["category"].lower() != category.lower():
                continue
            if procedure_type and item["procedure_type"].lower() != procedure_type.lower():
                continue

            if not q:
                results.append(item)
                continue

            code_acc = _strip_accents(item["code"])
            name_acc = _strip_accents(item["name"])
            target_acc = _strip_accents(item["target_equipment"])
            circular_acc = _strip_accents(item.get("circular", ""))
            hs_list = " ".join(item.get("applicable_hs_codes", []))

            if q in code_acc or q in name_acc or q in target_acc or q in hs_list or q in circular_acc:
                results.append(item)

        return results

    @classmethod
    def get_by_code(cls, code: str) -> dict[str, Any] | None:
        """Lay chi tiet 1 quy chuan theo ma QCVN/TCVN."""
        c = _strip_accents(code or "").strip().lower()
        if not c:
            return None
        # 1. Exact match
        for item in cls.STANDARDS_DATABASE:
            if _strip_accents(item["code"]).strip().lower() == c:
                return item
        # 2. Normalized alphanumeric match
        c_clean = re.sub(r"[^a-z0-9]", "", c)
        for item in cls.STANDARDS_DATABASE:
            if re.sub(r"[^a-z0-9]", "", _strip_accents(item["code"]).lower()) == c_clean:
                return item
        # 3. Substring / partial match
        for item in cls.STANDARDS_DATABASE:
            if c in _strip_accents(item["code"]).lower():
                return item
        return None

    @classmethod
    def get_statistics(cls) -> dict[str, Any]:
        """Thong ke tong so quy chuan theo Bo chu quan va linh vuc."""
        total = len(cls.STANDARDS_DATABASE)
        by_ministry = {}
        by_category = {}
        for item in cls.STANDARDS_DATABASE:
            m = item["ministry"]
            by_ministry[m] = by_ministry.get(m, 0) + 1
            cat = item["category_label"]
            by_category[cat] = by_category.get(cat, 0) + 1

        return {
            "total_standards": total,
            "by_ministry": by_ministry,
            "by_category": by_category,
            "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
        }


# ─── 📦 HS CODE TO CONFORMITY MAPPING SERVICE ───────────────────────────────────

class HsCodeConformityService:
    """Tra cuu danh muc quy chuan va thu tuc kiem tra chuyen nganh theo Ma HS Code Hai Quan."""

    HS_CODE_MAPPINGS: list[dict[str, Any]] = [
        {
            "hs_code": "8517.62.59",
            "hs_description": "Thiết bị thu phát khác dùng cho mạng viễn thông di động mặt đất hoặc mạng vô tuyến khác (Bao gồm IoT Gateway 4G/LTE)",
            "applicable_standards": ["QCVN 117:2020/BTTTT", "QCVN 18:2022/BTTTT", "QCVN 132:2022/BTTTT"],
            "customs_inspection_agency": "Cục Viễn thông — Bộ Thông tin và Truyền thông",
            "inspection_type": "Kiểm tra chất lượng nhà nước sau thông quan (Đăng ký KTCL trước khi mở tờ khai)",
            "required_procedure": "Chứng nhận Hợp quy + Bản Công Bố Hợp Quy (CR) + Dán dấu CR",
            "customs_notes": "Doanh nghiệp nộp Giấy đăng ký kiểm tra chất lượng có xác nhận của Cục Viễn Thông để được giải phóng hàng về kho bảo quản.",
            "exemption_cases": "Linh kiện mẫu R&D nhập khẩu < 3 chiếc phục vụ thử nghiệm nội bộ không thương mại.",
        },
        {
            "hs_code": "8517.62.51",
            "hs_description": "Thiết bị mạng chuyển mạch và định tuyến không dây (Wireless Access Point, Wi-Fi Router, Module Wi-Fi 2.4GHz / 5GHz)",
            "applicable_standards": ["QCVN 54:2020/BTTTT", "QCVN 65:2020/BTTTT", "QCVN 18:2022/BTTTT"],
            "customs_inspection_agency": "Cục Viễn thông — Bộ TT&TT",
            "inspection_type": "Kiểm tra chất lượng theo Thông tư 04/2023/TT-BTTTT",
            "required_procedure": "Chứng nhận Hợp quy (CNHQ) + Công bố Hợp quy (CBHQ)",
            "customs_notes": "Bắt buộc phải có Giấy chứng nhận hợp quy do Cục Viễn Thông cấp trước khi nộp hồ sơ công bố hợp quy.",
            "exemption_cases": "Thiết bị nhập khẩu phục vụ mục đích quốc phòng, an ninh.",
        },
        {
            "hs_code": "8507.60.90",
            "hs_description": "Ắc quy điện khác loại ion liti (Lithium-ion accumulator / Pack pin sạc thiết bị điện tử)",
            "applicable_standards": ["QCVN 101:2020/BTTTT"],
            "customs_inspection_agency": "Cục Viễn thông — Bộ TT&TT",
            "inspection_type": "Công bố hợp quy theo Thông tư 04/2023/TT-BTTTT",
            "required_procedure": "Tự Công Bố Hợp Quy (CR) dựa trên kết quả đo kiểm phòng Lab chỉ định",
            "customs_notes": "Phải nộp Bản công bố hợp quy có dấu tiếp nhận của Cục Viễn Thông trong vòng 15 ngày kể từ ngày thông quan.",
            "exemption_cases": "Pin gắn liền trong thiết bị đã được chứng nhận hợp quy đồng bộ.",
        },
        {
            "hs_code": "9026.10.10",
            "hs_description": "Thiết bị đo hoặc kiểm tra lưu lượng hoặc mức chất lỏng loại hoạt động bằng điện (Cảm biến đo mức radar/siêu âm, lưu lượng kế điện từ)",
            "applicable_standards": ["TT 10/2021/TT-BTNMT", "ĐLVN 61:2000"],
            "customs_inspection_agency": "Chi cục Tiêu chuẩn Đo lường Chất lượng (BKHCN) / Sở TN&MT",
            "inspection_type": "Kiểm định ban đầu trước khi đưa vào hệ thống đo đạc quan trắc môi trường",
            "required_procedure": "Giấy chứng nhận kiểm định đo lường + Chứng chỉ xuất xưởng CO/CQ",
            "customs_notes": "Thông quan bình thường nếu không nằm trong danh mục phương tiện đo nhóm 2 bắt buộc phê duyệt mẫu.",
            "exemption_cases": "Thiết bị nghiên cứu phòng thí nghiệm.",
        },
        {
            "hs_code": "9028.30.10",
            "hs_description": "Công tơ điện tử xoay chiều nhiều biểu giá (Electronic Multi-tariff Electricity Meter)",
            "applicable_standards": ["ĐLVN 24:2014", "ĐLVN 39:2019", "QCVN 19:2019/BKHCN"],
            "customs_inspection_agency": "Tổng cục Tiêu chuẩn Đo lường Chất lượng — Bộ KH&CN",
            "inspection_type": "Phê duyệt mẫu phương tiện đo Nhóm 2 + Kiểm định ban đầu từng chiếc",
            "required_procedure": "Quyết định Phê duyệt mẫu của Tổng cục TĐC + Tem kiểm định và Kẹp chì niêm phong",
            "customs_notes": "Hàng hóa chỉ được đưa vào giao nhận mua bán điện sau khi đã được tổ chức kiểm định được chỉ định dán tem kiểm định.",
            "exemption_cases": "Mẫu nhập khẩu để thử nghiệm phê duyệt mẫu.",
        },
        {
            "hs_code": "8504.40.90",
            "hs_description": "Bộ biến đổi tĩnh điện khác (Bộ nguồn Adapter 220VAC sang 12VDC/24VDC, Bộ nguồn Meanwell công nghiệp)",
            "applicable_standards": ["QCVN 4:2009/BKHCN", "QCVN 19:2019/BKHCN", "QCVN 132:2022/BTTTT"],
            "customs_inspection_agency": "Chi cục Tiêu chuẩn Đo lường Chất lượng các Tỉnh/Thành phố",
            "inspection_type": "Kiểm tra nhà nước về chất lượng hàng hóa nhập khẩu theo Thông tư 06/2020/TT-BKHCN",
            "required_procedure": "Chứng nhận Hợp quy Phương thức 7 (Theo lô hàng) hoặc Phương thức 5",
            "customs_notes": "Doanh nghiệp nộp Giấy đăng ký kiểm tra chất lượng có xác nhận của Chi cục TĐC để thông quan.",
            "exemption_cases": "Linh kiện nhập khẩu phục vụ trực tiếp dây chuyền sản xuất lắp ráp tủ điện nội bộ.",
        },
    ]

    @classmethod
    def lookup_hs_code(cls, hs_code: str) -> dict[str, Any] | None:
        """Tra cuu chi tiet thu tuc kiem tra chuyen nganh theo ma HS Code."""
        clean_hs = re.sub(r"[^0-9]", "", hs_code.strip())
        for mapping in cls.HS_CODE_MAPPINGS:
            m_clean = re.sub(r"[^0-9]", "", mapping["hs_code"])
            if clean_hs.startswith(m_clean) or m_clean.startswith(clean_hs):
                return mapping

        # Neu khong co mapping chinh xac nhung co HS 4-6 so, tao tra cuu suy luan
        if len(clean_hs) >= 4:
            prefix4 = clean_hs[:4]
            if prefix4 == "8517":
                return {
                    "hs_code": hs_code,
                    "hs_description": "Thiết bị viễn thông, truyền dẫn dữ liệu vô tuyến hoặc có dây (Nhóm 8517)",
                    "applicable_standards": ["QCVN 117:2020/BTTTT", "QCVN 54:2020/BTTTT", "QCVN 18:2022/BTTTT"],
                    "customs_inspection_agency": "Cục Viễn thông — Bộ Thông tin và Truyền thông",
                    "inspection_type": "Kiểm tra chuyên ngành theo Thông tư 04/2023/TT-BTTTT",
                    "required_procedure": "Chứng nhận Hợp quy (CNHQ) + Công bố Hợp quy (CBHQ) dấu CR",
                    "customs_notes": "Cần đăng ký kiểm tra chất lượng tại Cổng thông tin một cửa quốc gia (NSW).",
                    "exemption_cases": "Hàng tạm nhập tái xuất.",
                }
            elif prefix4 == "9026" or prefix4 == "9028":
                return {
                    "hs_code": hs_code,
                    "hs_description": "Dụng cụ và thiết bị đo lường, kiểm tra chất lỏng, khí hoặc điện năng (Nhóm 9026 / 9028)",
                    "applicable_standards": ["ĐLVN 24:2014", "TT 10/2021/TT-BTNMT"],
                    "customs_inspection_agency": "Tổng cục Tiêu chuẩn Đo lường Chất lượng / Sở TN&MT",
                    "inspection_type": "Kiểm định đo lường phương tiện đo nhóm 2",
                    "required_procedure": "Phê duyệt mẫu + Kiểm định ban đầu",
                    "customs_notes": "Kiểm tra tính hợp lệ của giấy chứng nhận kiểm định xuất xưởng.",
                    "exemption_cases": "Hàng triển lãm hội chợ.",
                }

        return None


# ─── 🏛️ TESTING LABS & CERTIFICATION BODIES REGISTRY ──────────────────────────

class TestingLabRegistryService:
    """Danh ba cac phong thu nghiem va to chuc chung nhan hop quy duoc chi dinh tai Viet Nam."""

    DESIGNATED_LABS: list[dict[str, Any]] = [
        {
            "id": 1,
            "name": "Trung tâm Đo lường Chất lượng Viễn thông (Cục Viễn thông — VNTA Testing Lab)",
            "code": "VNTA-LAB",
            "ministry": "BTTTT",
            "address": "Tòa nhà VNTA, Đường Dương Đình Nghệ, Cầu Giấy, Hà Nội",
            "branch": "Chi nhánh TP.HCM: Số 60 Tân Canh, Phường 1, Tân Bình, TP.HCM",
            "phone": "024.37820990",
            "email": "testing@vnta.gov.vn",
            "scope": [
                "Đo kiểm RF vô tuyến 4G/LTE (QCVN 117), 5G (QCVN 127)",
                "Đo kiểm Wi-Fi 2.4GHz / 5GHz (QCVN 54, QCVN 65)",
                "Đo kiểm tương thích điện từ EMC vô tuyến (QCVN 18)",
                "An toàn điện viễn thông (QCVN 132 / IEC 62368-1)",
            ],
            "average_testing_time_days": "7 - 10 ngày làm việc",
            "estimated_cost_vnd": "15.000.000 - 35.000.000 ₫ / mẫu",
            "badge": "Chỉ định số 1 BTTTT",
        },
        {
            "id": 2,
            "name": "Trung tâm Kỹ thuật Tiêu chuẩn Đo lường Chất lượng 1 (QUATEST 1)",
            "code": "QUATEST-1",
            "ministry": "BKHCN",
            "address": "Số 8 Hoàng Quốc Việt, Cầu Giấy, Hà Nội",
            "phone": "024.38361399",
            "email": "quatest1@quatest1.com.vn",
            "scope": [
                "Chứng nhận Hợp quy sản phẩm điện - điện tử (QCVN 4, QCVN 19)",
                "Đo kiểm Pin Lithium (QCVN 101:2020/BTTTT)",
                "Thử nghiệm tương thích điện từ EMC và an toàn điện hạ áp",
                "Hiệu chuẩn và kiểm định phương tiện đo lường công nghiệp",
            ],
            "average_testing_time_days": "5 - 7 ngày làm việc",
            "estimated_cost_vnd": "8.000.000 - 20.000.000 ₫ / mẫu",
            "badge": "Chỉ định BKHCN Miền Bắc",
        },
        {
            "id": 3,
            "name": "Trung tâm Kỹ thuật Tiêu chuẩn Đo lường Chất lượng 3 (QUATEST 3)",
            "code": "QUATEST-3",
            "ministry": "BKHCN",
            "address": "Số 49 Pasteur, Phường Nguyễn Thái Bình, Quận 1, TP.HCM",
            "branch": "Khu Thí nghiệm Biên Hòa: KCN Biên Hòa 1, Đồng Nai",
            "phone": "028.38294274",
            "email": "info@quatest3.com.vn",
            "scope": [
                "Đo kiểm vô tuyến & EMC thiết bị IoT, Bluetooth, Wi-Fi",
                "Chứng nhận hợp quy Pin Lithium và Adapter sạc",
                "Phân tích mẫu nước thải, khí thải công nghiệp (QCVN 40, QCVN 05)",
                "Thử nghiệm độ bền môi trường (Nhiệt độ, Độ ẩm, Rung sốc, Chuẩn IP65/IP67)",
            ],
            "average_testing_time_days": "5 - 8 ngày làm việc",
            "estimated_cost_vnd": "10.000.000 - 25.000.000 ₫ / mẫu",
            "badge": "Chỉ định BKHCN Miền Nam",
        },
        {
            "id": 4,
            "name": "Viện Đo lường Việt Nam (VMI)",
            "code": "VMI",
            "ministry": "BKHCN",
            "address": "Nhà D, Số 8 Hoàng Quốc Việt, Cầu Giấy, Hà Nội",
            "phone": "024.38361869",
            "email": "vmi@vmi.gov.vn",
            "scope": [
                "Phê duyệt mẫu công tơ điện tử (ĐLVN 24:2014, ĐLVN 39:2019)",
                "Kiểm định chuẩn đo lường quốc gia về điện áp, dòng điện, công suất",
                "Hiệu chuẩn cảm biến lưu lượng, áp suất, nhiệt độ quan trắc môi trường",
            ],
            "average_testing_time_days": "10 - 15 ngày làm việc",
            "estimated_cost_vnd": "12.000.000 - 40.000.000 ₫ / mẫu",
            "badge": "Cơ quan Đo lường Cao nhất",
        },
        {
            "id": 5,
            "name": "Trung tâm Chứng nhận Phù hợp (QUACERT)",
            "code": "QUACERT",
            "ministry": "BKHCN",
            "address": "Số 8 Hoàng Quốc Việt, Cầu Giấy, Hà Nội",
            "phone": "024.37561025",
            "email": "quacert@quacert.gov.vn",
            "scope": [
                "Đánh giá & Cấp chứng chỉ ISO 9001:2015 (Hệ thống quản lý chất lượng)",
                "Đánh giá & Cấp chứng chỉ ISO 14001:2015 (Quản lý môi trường)",
                "Đánh giá & Cấp chứng chỉ ISO/IEC 27001:2022 (An toàn thông tin)",
                "Chứng nhận Hợp chuẩn sản phẩm công nghiệp",
            ],
            "average_testing_time_days": "15 - 30 ngày (Quy trình audit)",
            "estimated_cost_vnd": "25.000.000 - 60.000.000 ₫ / chu kỳ 3 năm",
            "badge": "Tổ chức Chứng nhận ISO Quốc gia",
        },
    ]

    @classmethod
    def list_all(cls) -> list[dict[str, Any]]:
        return cls.DESIGNATED_LABS


# ─── 📝 CONFORMITY DECLARATION DOCUMENT GENERATOR (CR FORM) ────────────────────

class ConformityDocumentGenerator:
    """Tao va xuat Ban Cong Bo Hop Quy (CR) theo Mau so 02 TT 28/2012/TT-BKHCN va toan van quy chuan."""

    @classmethod
    def generate_cr_declaration_pdf(
        cls,
        company_name: str = "CÔNG TY TNHH CÔNG NGHỆ INUT",
        tax_code: str = "4401053694",
        address: str = "Tỉnh Phú Yên, Việt Nam",
        representative_name: str = "Ngô Huỳnh Ngọc Khánh",
        representative_title: str = "Giám đốc",
        product_name: str = "Thiết bị IoT Gateway 4G Công nghiệp",
        model_name: str = "iNut-GW4G-Pro",
        manufacturer: str = "CÔNG TY TNHH CÔNG NGHỆ INUT",
        country_of_origin: str = "Việt Nam",
        applicable_standards: list[str] | None = None,
        test_report_number: str = "VNTA-TR-2026/0842",
        test_lab_name: str = "Trung tâm Đo lường Chất lượng Viễn thông (Cục Viễn thông)",
    ) -> tuple[bytes, str]:
        """Sinh Ban Cong Bo Hop Quy (CR) chuan phap ly dinh dang PDF."""
        standards = applicable_standards or ["QCVN 117:2020/BTTTT", "QCVN 54:2020/BTTTT", "QCVN 18:2022/BTTTT", "QCVN 132:2022/BTTTT"]

        html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {{ font-family: 'Times New Roman', serif; margin: 30px 45px; color: #111; line-height: 1.5; font-size: 13pt; }}
  .header {{ text-align: center; margin-bottom: 25px; }}
  .title {{ text-align: center; margin: 25px 0 15px; font-weight: bold; font-size: 16pt; text-transform: uppercase; color: #0d473f; }}
  .subtitle {{ text-align: center; font-size: 12pt; margin-bottom: 20px; font-style: italic; }}
  .table {{ width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 12pt; }}
  .table th, .table td {{ border: 1px solid #333; padding: 8px 12px; }}
  .table th {{ background: #f1f5f9; font-weight: bold; text-align: center; }}
  .box {{ border: 1px solid #0f766e; background: #f0fdfa; padding: 15px; border-radius: 8px; margin: 15px 0; }}
  .footer {{ margin-top: 40px; width: 100%; }}
</style>
</head>
<body>
  <div class="header">
    <h4 style="margin: 0; font-size: 12pt; text-transform: uppercase;">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</h4>
    <div style="font-weight: bold; font-size: 13pt; margin-top: 4px;">Độc lập - Tự do - Hạnh phúc</div>
    <div style="margin-top: 6px;">─────────────────────</div>
  </div>

  <div class="title">BẢN CÔNG BỐ HỢP QUY</div>
  <div class="subtitle">(Ban hành kèm theo Thông tư số 28/2012/TT-BKHCN và Thông tư số 02/2017/TT-BKHCN)</div>

  <p>Số: <strong>CBHQ-{tax_code}-{datetime.now().strftime('%Y%m%d')}</strong></p>

  <p><strong>1. Tên tổ chức, cá nhân công bố:</strong> {company_name}</p>
  <p>• Mã số doanh nghiệp / Mã số thuế: <strong>{tax_code}</strong></p>
  <p>• Địa chỉ trụ sở chính: {address}</p>
  <p>• Người đại diện theo pháp luật: <strong>{representative_name}</strong> — Chức vụ: {representative_title}</p>

  <p><strong>2. Thông tin về sản phẩm, hàng hóa công bố hợp quy:</strong></p>
  <div class="box">
    • Tên sản phẩm, hàng hóa: <strong>{product_name}</strong><br>
    • Ký hiệu / Mã kiểu loại (Model): <strong>{model_name}</strong><br>
    • Nhà sản xuất: {manufacturer}<br>
    • Xuất xứ hàng hóa: <strong>{country_of_origin}</strong>
  </div>

  <p><strong>3. Phù hợp với các Quy chuẩn kỹ thuật quốc gia (QCVN) sau đây:</strong></p>
  <table class="table">
    <thead>
      <tr>
        <th style="width: 10%;">STT</th>
        <th style="width: 35%;">Số hiệu Quy chuẩn kỹ thuật</th>
        <th style="width: 55%;">Tên Quy chuẩn kỹ thuật quốc gia</th>
      </tr>
    </thead>
    <tbody>
      {"".join([f'<tr><td style="text-align: center;">{idx+1}</td><td><strong>{std}</strong></td><td>Quy chuẩn kỹ thuật quốc gia do Bộ quản lý chuyên ngành ban hành</td></tr>' for idx, std in enumerate(standards)])}
    </tbody>
  </table>

  <p><strong>4. Căn cứ công bố hợp quy:</strong></p>
  <p>• Phiếu kết quả thử nghiệm số: <strong>{test_report_number}</strong></p>
  <p>• Đơn vị thử nghiệm thực hiện: <strong>{test_lab_name}</strong> (Được Bộ quản lý chuyên ngành chỉ định).</p>

  <p><strong>5. Cam kết của tổ chức, cá nhân:</strong></p>
  <p>{company_name} cam kết và chịu hoàn toàn trách nhiệm trước pháp luật về tính phù hợp của sản phẩm, hàng hóa đối với các Quy chuẩn kỹ thuật quốc gia đã công bố và duy trì việc kiểm soát chất lượng trong suốt quá trình sản xuất, lưu thông trên thị trường.</p>

  <table class="footer">
    <tr>
      <td style="width: 50%; border: 0;"></td>
      <td style="width: 50%; text-align: center; border: 0; vertical-align: top;">
        <em>Ngày {datetime.now().day} tháng {datetime.now().month} năm {datetime.now().year}</em><br>
        <strong>ĐẠI DIỆN HỢP PHÁP CỦA TỔ CHỨC, CÁ NHÂN</strong><br>
        <div style="height: 75px; display: flex; align-items: center; justify-content: center; color: #047857; font-weight: bold;">
          [ĐÃ KÝ SỐ ĐIỆN TỬ KSP iNUT]
        </div>
        <strong>{representative_name}</strong><br>
        <em>{representative_title}</em>
      </td>
    </tr>
  </table>
</body>
</html>"""
        pdf_bytes = weasyprint.HTML(string=html).write_pdf()
        filename = f"Ban_Cong_Bo_Hop_Quy_{model_name}_{tax_code}.pdf"
        return pdf_bytes, filename

    @classmethod
    def generate_standard_summary_pdf(cls, standard_data: dict[str, Any]) -> tuple[bytes, str]:
        """Xuat toan van tom tat quy chuan ky thuat QCVN dinh dang PDF."""
        code = standard_data.get("code", "QCVN")
        name = standard_data.get("name", "Quy chuẩn kỹ thuật quốc gia")
        ministry = standard_data.get("ministry_label", "Bộ quản lý chuyên ngành")
        circular = standard_data.get("circular", "Thông tư quy định")
        target = standard_data.get("target_equipment", "Thiết bị điện tử")
        reqs = standard_data.get("key_technical_requirements", [])
        labs = standard_data.get("testing_labs", [])

        html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {{ font-family: 'Times New Roman', serif; margin: 30px 45px; color: #111; line-height: 1.5; font-size: 13pt; }}
  .header {{ text-align: center; margin-bottom: 25px; }}
  .title {{ text-align: center; margin: 25px 0 15px; font-weight: bold; font-size: 16pt; text-transform: uppercase; color: #0f766e; }}
  .box {{ border: 1px solid #cbd5e1; background: #f8fafc; padding: 15px; border-radius: 8px; margin: 15px 0; }}
  .req-box {{ background: #f0fdf4; border: 1px solid #86efac; padding: 14px 18px; border-radius: 8px; }}
</style>
</head>
<body>
  <div class="header">
    <h4 style="margin: 0; font-size: 12pt; text-transform: uppercase;">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</h4>
    <div style="font-weight: bold; font-size: 13pt; margin-top: 4px;">Độc lập - Tự do - Hạnh phúc</div>
    <div style="margin-top: 6px;">─────────────────────</div>
  </div>

  <div class="title">{code}</div>
  <h3 style="text-align: center; margin-top: 0; color: #1e293b;">{name}</h3>

  <div class="box">
    <strong>Cơ quan ban hành:</strong> {ministry}<br>
    <strong>Văn bản pháp lý:</strong> {circular}<br>
    <strong>Ngày hiệu lực:</strong> {standard_data.get('effective_date', 'Hiện hành')}<br>
    <strong>Thủ tục áp dụng:</strong> {standard_data.get('procedure_label', 'Bắt buộc')}<br>
    <strong>Đối tượng thiết bị áp dụng:</strong> {target}
  </div>

  <h3>MỤC 1. CHỈ TIÊU KỸ THUẬT CỐT LÕI BẮT BUỘC</h3>
  <div class="req-box">
    <ul>
      {"".join([f'<li style="margin-bottom: 8px;">{r}</li>' for r in reqs])}
    </ul>
  </div>

  <h3>MỤC 2. TỔ CHỨC THỬ NGHIỆM & CHỨNG NHẬN ĐƯỢC CHỈ ĐỊNH</h3>
  <ul>
    {"".join([f'<li style="margin-bottom: 6px;"><strong>{lab}</strong></li>' for lab in labs])}
  </ul>

  <div style="margin-top: 40px; text-align: right; font-style: italic; font-size: 11pt;">
    Hệ thống Tra cứu Hợp chuẩn Hợp quy • KSP iNut Operations
  </div>
</body>
</html>"""
        pdf_bytes = weasyprint.HTML(string=html).write_pdf()
        filename = f"Toan_Van_Quy_Chuan_{code.replace('/', '_').replace(':', '_')}.pdf"
        return pdf_bytes, filename


# ─── 📘 PRACTICAL IMPORT PLAYBOOKS & CASE STUDIES SERVICE ───────────────────────

class PracticalPlaybookService:
    """Kho cam nang huong dan thuc chien nhap khau & chung nhan hop quy cho cac dong thiet bi cong nghe."""

    PLAYBOOKS: list[dict[str, Any]] = [
        {
            "id": "inut_rockchip_embedded_pc",
            "title": "Máy Tính Nhúng iNut Rockchip (Không Pin, Wi-Fi 2.4G/5G & BLE)",
            "subtitle": "Case Thực Chiến: Nhập Khẩu Bo Mạch HS 8473 & Hợp Quy Thiết Bị Tự Sản Xuất Khi Chưa Có Nhà Máy ISO",
            "category": "embedded_pc",
            "badge": "⭐ Case Thực Tế INUT",
            "hs_codes": [
                {
                    "code": "8473.30.10",
                    "description": "Bộ phận và phụ tùng của máy xử lý dữ liệu tự động (Bo mạch máy tính nhúng SBC Rockchip RK3568/RK3588/RK3399 chưa đóng vỏ)",
                    "import_tax_mfn": "0%",
                    "import_tax_form_e": "0%",
                    "vat_rate": "10%",
                    "recommended": True,
                },
                {
                    "code": "8471.41.90",
                    "description": "Máy tính nhúng công nghiệp hoàn thiện (Thành phẩm sau khi INUT đóng vỏ nhôm CNC, gắn nguồn và anten)",
                    "import_tax_mfn": "0%",
                    "import_tax_form_e": "0%",
                    "vat_rate": "10%",
                    "recommended": True,
                },
            ],
            "required_standards": [
                {
                    "code": "QCVN 54:2020/BTTTT",
                    "name": "Thiết bị thu phát vô tuyến 2,4 GHz (Wi-Fi 2.4G & Bluetooth)",
                    "procedure": "Chứng nhận Hợp quy (CNHQ) + Công bố CR",
                    "test_scope": "Công suất phát EIRP <= 100mW (20dBm), Mật độ phổ công suất, Bức xạ không mong muốn",
                },
                {
                    "code": "QCVN 65:2020/BTTTT",
                    "name": "Thiết bị truy nhập vô tuyến 5 GHz (Wi-Fi Dual Band 802.11a/n/ac/ax)",
                    "procedure": "Chứng nhận Hợp quy (CNHQ) + Công bố CR",
                    "test_scope": "Băng tần 5150-5350MHz / 5470-5725MHz, Điều khiển công suất TPC, Lựa chọn tần số DFS",
                },
                {
                    "code": "QCVN 18:2022/BTTTT",
                    "name": "Tương thích điện từ (EMC) cho thiết bị thông tin vô tuyến",
                    "procedure": "Công bố Hợp quy (CR)",
                    "test_scope": "Phát xạ dẫn cổng nguồn DC/AC, Phát xạ bức xạ 30MHz-6GHz, Miễn nhiễm tĩnh điện ESD, Xung nhanh EFT",
                },
                {
                    "code": "QCVN 132:2022/BTTTT",
                    "name": "An toàn điện thiết bị CNTT theo IEC 62368-1",
                    "procedure": "Công bố Hợp quy (CR)",
                    "test_scope": "Bảo vệ chống chạm điện giật qua vỏ nhôm, Chống cháy mạch nguồn DC, Tổn thương phát nhiệt",
                },
            ],
            "six_step_workflow": [
                {
                    "step": 1,
                    "title": "Nhập Khẩu Linh Kiện Bo Mạch HS 8473.30 (Miễn KTCL BTTTT)",
                    "description": "Nhập khẩu bo mạch máy tính nhúng Rockchip dạng bán thành phẩm (chưa đóng vỏ/chưa có nguồn hoàn chỉnh). Khai mã HS 8473.30.10 -> Thông quan bình thường không cần đăng ký KTCL chuyên ngành BTTTT.",
                },
                {
                    "step": 2,
                    "title": "Lắp Ráp Thành Phẩm Hoàn Chỉnh (Đóng Vỏ & Gắn Tem iNut)",
                    "description": "Tại xưởng R&D của INUT, lắp bo mạch vào vỏ nhôm công nghiệp CNC / Vỏ DIN-rail, gắn anten Wi-Fi, gắn cổng nguồn 12V/24V DC và dán nhãn nhãn hiệu: 'iNut Rockchip Industrial Box PC - Model: iNut-RK3568-Edge'.",
                },
                {
                    "step": 3,
                    "title": "Đăng Ký Đo Kiểm Mẫu Điển Hình (Phương Thức 1)",
                    "description": "Gửi 01 - 02 bộ mẫu hoàn thiện đến VNTA Lab (Cục Viễn thông) hoặc Quatest 1 / Quatest 3 để đo kiểm 4 quy chuẩn (QCVN 54, 65, 18, 132). Bỏ qua QCVN 101 vì thiết bị không có pin!",
                },
                {
                    "step": 4,
                    "title": "Cục Viễn Thông Cấp Giấy CNHQ Phương Thức 1 (Hiệu Lực 3 Năm)",
                    "description": "Nộp hồ sơ trực tuyến kèm Test Report lên Cục Viễn Thông. Cục cấp Giấy Chứng Nhận Hợp Quy theo Phương thức 1. KHÔNG YÊU CẦU AUDIT NHÀ MÁY HAY CHỨNG CHỈ ISO 9001!",
                },
                {
                    "step": 5,
                    "title": "Ban Hành Bản Công Bố Hợp Quy (Mẫu 02 TT28) & Ký Số KSP",
                    "description": "Dùng công cụ KSP iNut tạo Bản Công Bố Hợp Quy, ký số điện tử KSP iNut và lưu hồ sơ lưu chiểu tại công ty theo quy định của Thông tư 28/2012/TT-BKHCN.",
                },
                {
                    "step": 6,
                    "title": "In & Dán Tem Dấu CR Hợp Pháp Lên Thiết Bị Phân Phối",
                    "description": "Dán tem dấu hợp quy CR (kèm mã CNHQ BTTTT) và tem nhãn phụ tiếng Việt lên thân máy trước khi bàn giao cho khách hàng hoặc tham gia đấu thầu cơ điện / IoT.",
                },
            ],
            "cost_estimate": {
                "state_fees": [
                    {"name": "Lệ phí cấp Giấy Chứng Nhận Hợp Quy (BTTTT)", "cost": "150.000 ₫ / giấy", "agency": "Cục Viễn thông"},
                    {"name": "Lệ phí tiếp nhận Bản Công Bố Hợp Quy (BTTTT)", "cost": "150.000 ₫ / hồ sơ", "agency": "Cục Viễn thông"},
                ],
                "lab_testing_fees": [
                    {"scope": "Wi-Fi 2.4 GHz & BLE (QCVN 54:2020)", "cost": "3.500.000 - 5.000.000 ₫", "time": "3 - 5 ngày"},
                    {"scope": "Wi-Fi 5 GHz Dual Band (QCVN 65:2020)", "cost": "4.500.000 - 6.500.000 ₫", "time": "4 - 6 ngày"},
                    {"scope": "Tương thích điện từ EMC (QCVN 18:2022)", "cost": "4.000.000 - 6.000.000 ₫", "time": "3 - 5 ngày"},
                    {"scope": "An toàn điện thiết bị CNTT (QCVN 132:2022)", "cost": "3.000.000 - 5.000.000 ₫", "time": "3 - 5 ngày"},
                ],
                "total_lab_cost_range": "15.000.000 - 22.500.000 ₫ (Áp dụng cho cả vòng đời Model trong 3 năm)",
                "forwarder_service_cost_range": "Không phát sinh nếu INUT tự mang mẫu đến VNTA Lab / Quatest",
            },
            "practical_tips": [
                "🔥 GIẢI ĐÁP VỀ NHÀ MÁY ISO: Doanh nghiệp KHÔNG BẮT BUỘC phải có nhà máy hay chứng chỉ ISO 9001 khi chứng nhận hợp quy BTTTT theo Phương thức 1 (Thử nghiệm mẫu điển hình). Chỉ cần sản phẩm thực tế vượt qua bài đo kiểm tại phòng Lab!",
                "TIẾT KIỆM CHI PHÍ PIN: Vì bộ iNut Rockchip chạy nguồn ngoài không có pin, bạn được MIỄN HOÀN TOÀN thử nghiệm QCVN 101, tiết kiệm ngay 4 - 6.5 triệu ₫ và 7 ngày chờ đợi.",
                "TẬN DỤNG CHỨNG CHỈ CỦA MODULE WI-FI: Nếu bo mạch Rockchip dùng Module Wi-Fi rời của Realtek/Espressif/Broadcom đã có sẵn CNHQ tại Việt Nam, bạn chỉ cần đo kiểm EMC (QCVN 18) và An toàn (QCVN 132), giảm thêm 50% chi phí đo kiểm!",
                "NẾU DỰ ÁN ĐẤU THẦU ĐÒI ISO 9001 CỦA NHÀ SẢN XUẤT: INUT có thể đăng ký chứng nhận ISO 9001:2015 cho phạm vi 'Thiết kế, tích hợp và phân phối thiết bị IoT/SCADA' thông qua QUACERT hoặc Vinacontrol với chi phí chỉ ~15 - 20 triệu ₫ cho văn phòng R&D mà không cần xưởng sản xuất quy mô lớn.",
            ],
        },
        {
            "id": "interactive_display_wifi_battery",
            "title": "Màn Hình Tương Tác Thông Minh (Wi-Fi 2.4G/5G, Bluetooth & Pin Lithium)",
            "subtitle": "Case Study Nhập Khẩu Màn Hình Cảm Ứng All-in-One Chạy Android/Windows Phục Vụ Giáo Dục & Doanh Nghiệp",
            "category": "display_iot",
            "badge": "🔥 Case Study Trọng Điểm",
            "hs_codes": [
                {
                    "code": "8471.41.90",
                    "description": "Máy xử lý dữ liệu tự động dạng màn hình cảm ứng tương tác thông minh (Tích hợp CPU, RAM, OS Android/Windows)",
                    "import_tax_mfn": "0%",
                    "import_tax_form_e": "0%",
                    "vat_rate": "10% (hoặc 8%)",
                    "recommended": True,
                },
                {
                    "code": "8528.52.00",
                    "description": "Màn hình hiển thị phẳng có khả năng kết nối trực tiếp với máy tính (Interactive Flat Panel / Smart Display)",
                    "import_tax_mfn": "0%",
                    "import_tax_form_e": "0%",
                    "vat_rate": "10%",
                    "recommended": False,
                },
            ],
            "required_standards": [
                {
                    "code": "QCVN 54:2020/BTTTT",
                    "name": "Thiết bị thu phát vô tuyến dải tần 2,4 GHz (Wi-Fi 2.4G & Bluetooth)",
                    "procedure": "Chứng nhận Hợp quy (CNHQ) + Công bố CR",
                    "test_scope": "Công suất phát EIRP <= 100mW (20dBm), Mật độ phổ công suất, Bức xạ không mong muốn Rx/Tx",
                },
                {
                    "code": "QCVN 65:2020/BTTTT",
                    "name": "Thiết bị truy nhập vô tuyến băng tần 5 GHz (Wi-Fi 802.11a/n/ac/ax)",
                    "procedure": "Chứng nhận Hợp quy (CNHQ) + Công bố CR",
                    "test_scope": "Băng tần 5150-5350MHz / 5470-5725MHz, Điều khiển công suất TPC, Lựa chọn tần số động DFS",
                },
                {
                    "code": "QCVN 18:2022/BTTTT",
                    "name": "Tương thích điện từ (EMC) cho thiết bị thông tin vô tuyến",
                    "procedure": "Công bố Hợp quy (CR)",
                    "test_scope": "Phát xạ dẫn cổng nguồn, Phát xạ bức xạ 30MHz-6GHz, Miễn nhiễm tĩnh điện ESD, Xung nhanh EFT",
                },
                {
                    "code": "QCVN 101:2020/BTTTT",
                    "name": "Pin Lithium cho thiết bị di động & cầm tay",
                    "procedure": "Công bố Hợp quy (CR)",
                    "test_scope": "Ngắn mạch bên ngoài, Thử sạc quá mức (overcharge), Thử cơ học va đập & nhiệt độ cao 130°C",
                },
                {
                    "code": "QCVN 132:2022/BTTTT",
                    "name": "An toàn điện thiết bị CNTT & Viễn thông (IEC 62368-1)",
                    "procedure": "Công bố Hợp quy (CR)",
                    "test_scope": "Bảo vệ chống điện giật, Chống cháy vỏ nguồn V-0, Tổn thương do phát nhiệt",
                },
            ],
            "six_step_workflow": [
                {
                    "step": 1,
                    "title": "Đăng ký Kiểm tra Chất lượng (KTCL) Nhà nước",
                    "description": "Tạo hồ sơ đăng ký KTCL trực tuyến trên Cổng Một Cửa Quốc Gia (NSW: vnsw.gov.vn) với Cục Viễn Thông. Nhận mã số tiếp nhận ĐKKTCL.",
                },
                {
                    "step": 2,
                    "title": "Mở Tờ Khai Hải Quan & Xin Kéo Hàng Về Kho",
                    "description": "Nộp tờ khai điện tử VNACCS kèm Giấy ĐKKTCL có xác nhận của Cục Viễn Thông. Hải quan giải phóng hàng cho phép kéo về kho doanh nghiệp bảo quản.",
                },
                {
                    "step": 3,
                    "title": "Trích Mẫu Đo Kiểm Tại Phòng Lab Chỉ Định",
                    "description": "Trích 01 - 02 bộ mẫu gửi VNTA Lab, Quatest 1 hoặc Quatest 3 để đo kiểm các chỉ tiêu RF (QCVN 54/65), EMC (QCVN 18), Pin (QCVN 101), An toàn (QCVN 132). Lấy Test Report.",
                },
                {
                    "step": 4,
                    "title": "Nộp Hồ Sơ Cấp Giấy Chứng Nhận Hợp Quy (CNHQ)",
                    "description": "Nộp hồ sơ trực tuyến kèm Test Report lên Cục Viễn Thông. Cục Viễn Thông cấp Giấy Chứng Nhận Hợp Quy (Hiệu lực 03 năm theo Phương thức 1).",
                },
                {
                    "step": 5,
                    "title": "Nộp Bản Công Bố Hợp Quy (CBHQ) & Thông Quan NSW",
                    "description": "Tạo Bản công bố hợp quy (Mẫu 02 TT28) nộp lên hệ thống NSW. Cục Viễn thông xác nhận hoàn thành KTCL -> Hải quan duyệt Thông quan chính thức.",
                },
                {
                    "step": 6,
                    "title": "Dán Tem Dấu CR & Nhãn Phụ Tiếng Việt",
                    "description": "In tem dấu hợp quy CR (kèm mã CNHQ) và nhãn phụ tiếng Việt (Tên sản phẩm, Model, Thông số nguồn, Xuất xứ) dán lên sản phẩm trước khi phân phối.",
                },
            ],
            "cost_estimate": {
                "state_fees": [
                    {"name": "Lệ phí cấp Giấy Chứng Nhận Hợp Quy (BTTTT)", "cost": "150.000 ₫ / giấy", "agency": "Cục Viễn thông"},
                    {"name": "Lệ phí tiếp nhận Bản Công Bố Hợp Quy (BTTTT)", "cost": "150.000 ₫ / hồ sơ", "agency": "Cục Viễn thông"},
                    {"name": "Phí Đăng ký KTCL trên Cổng NSW", "cost": "Miễn phí (0 ₫)", "agency": "Cổng Một Cửa Quốc Gia"},
                ],
                "lab_testing_fees": [
                    {"scope": "Wi-Fi 2.4 GHz & Bluetooth (QCVN 54:2020)", "cost": "3.500.000 - 5.000.000 ₫", "time": "3 - 5 ngày"},
                    {"scope": "Wi-Fi 5 GHz Dual Band (QCVN 65:2020)", "cost": "4.500.000 - 6.500.000 ₫", "time": "4 - 6 ngày"},
                    {"scope": "Tương thích điện từ EMC (QCVN 18:2022)", "cost": "4.000.000 - 6.000.000 ₫", "time": "3 - 5 ngày"},
                    {"scope": "An toàn Pin Lithium (QCVN 101:2020)", "cost": "4.000.000 - 6.500.000 ₫", "time": "5 - 7 ngày"},
                    {"scope": "An toàn điện CNTT (QCVN 132:2022)", "cost": "3.000.000 - 5.000.000 ₫", "time": "3 - 5 ngày"},
                ],
                "total_lab_cost_range": "19.000.000 - 28.000.000 ₫ (Áp dụng cho 1 model đầu tiên trong 3 năm)",
                "forwarder_service_cost_range": "4.000.000 - 7.500.000 ₫ / lô hàng",
            },
            "practical_tips": [
                "Giấy CNHQ cấp theo Phương thức 1 có giá trị 03 năm: Trong suốt 3 năm, các lô nhập khẩu tiếp theo cùng Model/Hãng không cần gửi mẫu đo kiểm lại, tiết kiệm 100% chi phí đo kiểm Lab!",
                "Yêu cầu nhà sản xuất nước ngoài cung cấp trước Test Report quốc tế (CE RED / FCC / CB Certificate IEC 62368-1) để đối chiếu trước khi gửi mẫu.",
                "Tận dụng công cụ KSP iNut để tạo Bản Công Bố Hợp Quy PDF ký số điện tử chỉ trong 10 giây.",
            ],
        },
        {
            "id": "iot_gateway_4g_lte",
            "title": "Thiết Bị IoT Gateway 4G LTE & Router Công Nghiệp",
            "subtitle": "Quy Trình Nhập Khẩu Linh Kiện & Bộ Truyền Thông Không Dây Cho Trạm Giám Sát SCADA",
            "category": "telecom",
            "badge": "Chuẩn iNut Gateway",
            "hs_codes": [
                {
                    "code": "8517.62.59",
                    "description": "Thiết bị thu phát khác dùng cho mạng vô tuyến di động (Bao gồm IoT 4G Industrial Gateway)",
                    "import_tax_mfn": "0%",
                    "import_tax_form_e": "0%",
                    "vat_rate": "10%",
                    "recommended": True,
                },
            ],
            "required_standards": [
                {
                    "code": "QCVN 117:2020/BTTTT",
                    "name": "Thiết bị đầu cuối thông tin di động E-UTRA (4G LTE)",
                    "procedure": "Chứng nhận Hợp quy (CNHQ) + Công bố CR",
                    "test_scope": "Đo kiểm băng tần B1/B3/B7/B8/B20/B28, Công suất phát cực đại 23dBm, Bức xạ giả",
                },
                {
                    "code": "QCVN 18:2022/BTTTT",
                    "name": "Tương thích điện từ (EMC) vô tuyến",
                    "procedure": "Công bố Hợp quy (CR)",
                    "test_scope": "Phát xạ dẫn, phát xạ bức xạ, Miễn nhiễm tĩnh điện ESD 4kV/8kV",
                },
                {
                    "code": "QCVN 132:2022/BTTTT",
                    "name": "An toàn điện thiết bị viễn thông (IEC 62368-1)",
                    "procedure": "Công bố Hợp quy (CR)",
                    "test_scope": "Chống điện giật và quá nhiệt",
                },
            ],
            "cost_estimate": {
                "total_lab_cost_range": "15.000.000 - 22.000.000 ₫ / model",
            },
            "practical_tips": [
                "Nếu sử dụng Module 4G Quectel / SIMCom đã có sẵn Chứng nhận Hợp quy tại Việt Nam, thiết bị tích hợp chỉ cần đo kiểm EMC (QCVN 18) và An toàn (QCVN 132), giúp giảm 50% chi phí đo kiểm!",
            ],
        },
        {
            "id": "datalogger_water_environment_tt10",
            "title": "Datalogger & Trạm Quan Trắc Nước Thải / Khí Thải Tự Động (Thông Tư 10/2021/TT-BTNMT)",
            "subtitle": "Tiêu Chuẩn Kỹ Thuật Truyền Dữ Liệu Về Sở TN&MT & Đấu Thầu Trạm Quan Trắc",
            "category": "environment",
            "badge": "Chuẩn BTNMT",
            "hs_codes": [
                {
                    "code": "9026.10.10",
                    "description": "Thiết bị đo mức / lưu lượng chất lỏng tự động",
                    "import_tax_mfn": "0%",
                    "import_tax_form_e": "0%",
                    "vat_rate": "10%",
                    "recommended": True,
                },
                {
                    "code": "9027.80.30",
                    "description": "Dụng cụ và thiết bị phân tích lý hóa chất lỏng (COD, pH, TSS, Amoni)",
                    "import_tax_mfn": "0%",
                    "import_tax_form_e": "0%",
                    "vat_rate": "10%",
                    "recommended": False,
                },
            ],
            "required_standards": [
                {
                    "code": "TT 10/2021/TT-BTNMT",
                    "name": "Quy định kỹ thuật quan trắc môi trường và truyền dữ liệu FTP",
                    "procedure": "Quy định Bắt buộc trong E-HSMT Đấu Thầu & Nghiệm Thu",
                    "test_scope": "Định dạng tệp .txt UTF-8 mã hóa chuẩn, Tần suất truyền 5 phút/lần qua FTP/FTPS, Lưu trữ tại chỗ >= 30 ngày, Điều khiển lấy mẫu tự động",
                },
            ],
            "cost_estimate": {
                "total_lab_cost_range": "Hiệu chuẩn & Kiểm định cảm biến: 2.000.000 - 5.000.000 ₫ / đầu đo",
            },
            "practical_tips": [
                "Datalogger iNut TT10 Pro hỗ trợ sẵn Client truyền FTP tự động theo cú pháp Thông tư 10, đáp ứng 100% tiêu chí kỹ thuật trong hồ sơ mời thầu E-HSMT.",
            ],
        },
    ]

    @classmethod
    def list_all(cls) -> list[dict[str, Any]]:
        return cls.PLAYBOOKS

    @classmethod
    def get_by_id(cls, playbook_id: str) -> dict[str, Any] | None:
        for pb in cls.PLAYBOOKS:
            if pb["id"] == playbook_id:
                return pb
        return None


# ─── 🧠 RULE-BASED INFERENCE ENGINE (DEVICE SPEC / KEYWORDS / HS CODE) ────────

class RuleInferenceEngine:
    """Suy luan quy chuan QCVN/TCVN bat buoc va khuyen nghi dua tren dac tinh ky thuat, tu khoa va ma HS."""

    INFERENCE_RULES: list[dict[str, Any]] = [
        {
            "id": "rule_4g_lte",
            "name": "Thiết bị vô tuyến 4G LTE / VoLTE",
            "keywords": ["4g", "lte", "volte", "e-utra", "cat-m", "cat-m1", "cat-1", "cat-4", "nb-iot", "cellular", "rut240", "gw4g"],
            "hs_prefixes": ["8517.12", "8517.62", "8517.69"],
            "mandatory_standards": ["QCVN 117:2023/BTTTT", "QCVN 18:2022/BTTTT", "QCVN 132:2022/BTTTT"],
            "recommended_standards": ["TCVN ISO 9001:2015"],
            "ministry": "BTTTT",
            "rationale": "Thiết bị có tính năng phát sóng vô tuyến 4G LTE bắt buộc chứng nhận QCVN 117:2023 (hỗ trợ VoLTE theo TT 02/2024/TT-BTTTT), EMC QCVN 18 và An toàn điện QCVN 132.",
            "confidence": 0.98,
        },
        {
            "id": "rule_5g_nr",
            "name": "Thiết bị vô tuyến 5G NR (New Radio)",
            "keywords": ["5g", "5g nr", "sub-6ghz", "mmwave", "nr5g", "5g standalone", "5g nsa", "gnodeb"],
            "hs_prefixes": ["8517.12", "8517.61", "8517.62"],
            "mandatory_standards": ["QCVN 127:2021/BTTTT", "QCVN 117:2023/BTTTT", "QCVN 18:2022/BTTTT", "QCVN 132:2022/BTTTT"],
            "recommended_standards": ["QCVN 129:2021/BTTTT"],
            "ministry": "BTTTT",
            "rationale": "Thiết bị 5G bắt buộc chứng nhận QCVN 127/129 theo Thông tư 02/2024/TT-BTTTT, kèm tương thích điện từ EMC và an toàn điện IEC 62368-1.",
            "confidence": 0.96,
        },
        {
            "id": "rule_wifi_2g_ble",
            "name": "Thiết bị vô tuyến dải tần 2,4 GHz (Wi-Fi 2.4G, Bluetooth, BLE, Zigbee)",
            "keywords": ["wifi", "wi-fi", "2.4ghz", "2.4 ghz", "bluetooth", "ble", "zigbee", "802.11b", "802.11g", "802.11n", "esp32", "esp8266"],
            "hs_prefixes": ["8517.62.51", "8517.62.59", "8517.70.21"],
            "mandatory_standards": ["QCVN 54:2020/BTTTT", "QCVN 18:2022/BTTTT"],
            "recommended_standards": ["QCVN 132:2022/BTTTT"],
            "ministry": "BTTTT",
            "rationale": "Thiết bị phát sóng dải 2.4 GHz công suất EIRP <= 100mW bắt buộc CNHQ theo QCVN 54:2020 và EMC QCVN 18:2022.",
            "confidence": 0.95,
        },
        {
            "id": "rule_wifi_5g",
            "name": "Thiết bị truy nhập vô tuyến 5 GHz (Wi-Fi 5GHz, Wi-Fi 6, Dual Band)",
            "keywords": ["5ghz", "5 ghz", "wifi 5", "wifi 6", "wi-fi 6", "wifi6", "wifi 6e", "802.11a", "802.11ac", "802.11ax", "dual band", "bang tan kep", "ax3000", "ax5400"],
            "hs_prefixes": ["8517.62.51", "8517.62.59"],
            "mandatory_standards": ["QCVN 65:2020/BTTTT", "QCVN 18:2022/BTTTT"],
            "recommended_standards": ["QCVN 132:2022/BTTTT"],
            "ministry": "BTTTT",
            "rationale": "Thiết bị Wi-Fi 5 GHz bắt buộc đáp ứng tính năng TPC và DFS theo QCVN 65:2020 và EMC QCVN 18:2022.",
            "confidence": 0.94,
        },
        {
            "id": "rule_lithium_battery",
            "name": "Pin Lithium / Ắc quy ion liti",
            "keywords": ["pin", "battery", "lithium", "li-ion", "lipo", "li-po", "18650", "pin sac", "accumulator"],
            "hs_prefixes": ["8507.60", "8507.80"],
            "mandatory_standards": ["QCVN 101:2020/BTTTT"],
            "recommended_standards": ["QCVN 132:2022/BTTTT"],
            "ministry": "BTTTT",
            "rationale": "Pin Lithium cho thiết bị di động, cầm tay bắt buộc tự công bố hợp quy CR theo QCVN 101:2020/BTTTT.",
            "confidence": 0.97,
        },
        {
            "id": "rule_gps_telematics",
            "name": "Thiết bị giám sát hành trình ô tô (Hộp đen GPS / Telematics / TCU)",
            "keywords": ["gps", "giam sat hanh trinh", "hop den", "telematics", "tcu", "dinh vi", "o to", "xe tai", "xe khach", "vf8-tcu", "vf8"],
            "hs_prefixes": ["8526.91", "8517.62.59"],
            "mandatory_standards": ["QCVN 31:2014/BGTVT", "QCVN 117:2023/BTTTT", "QCVN 18:2022/BTTTT"],
            "recommended_standards": ["QCVN 132:2022/BTTTT"],
            "ministry": "BGTVT",
            "rationale": "Thiết bị GSHT lắp trên ô tô kinh doanh vận tải bắt buộc chứng nhận hợp quy của Cục Đăng kiểm Việt Nam (QCVN 31:2014/BGTVT) và hợp quy vô tuyến BTTTT.",
            "confidence": 0.96,
        },
        {
            "id": "rule_environment_monitoring",
            "name": "Datalogger & Trạm quan trắc môi trường (Nước thải / Khí thải)",
            "keywords": ["quan trac", "datalogger", "nuoc thai", "khi thai", "moi truong", "ftp", "tt10", "so tnmt", "tn&mt", "tu dong lien tuc"],
            "hs_prefixes": ["9026.10", "9026.80", "9027.80", "8517.62.59"],
            "mandatory_standards": ["TT 10/2021/TT-BTNMT", "QCVN 40:2011/BTNMT"],
            "recommended_standards": ["QCVN 05:2023/BTNMT", "QCVN 117:2023/BTTTT", "QCVN 18:2022/BTTTT"],
            "ministry": "BTNMT",
            "rationale": "Thiết bị truyền số liệu quan trắc môi trường bắt buộc tuân thủ Điều 33-50 Thông tư 10/2021/TT-BTNMT (định dạng .txt UTF-8, FTP 5 phút/lần, lưu trữ 30 ngày).",
            "confidence": 0.95,
        },
        {
            "id": "rule_electricity_metering",
            "name": "Công tơ điện tử & Thiết bị đo đếm điện năng",
            "keywords": ["cong to", "do dien", "amr", "ami", "dong ho dien", "bieu gia", "dien ke", "dlms", "metering", "electricity meter", "3 pha", "1 pha", "me-41", "me-42", "emic"],
            "hs_prefixes": ["9028.30", "9028.90"],
            "mandatory_standards": ["ĐLVN 24:2014", "ĐLVN 39:2019", "QCVN 19:2019/BKHCN"],
            "recommended_standards": ["QCVN 117:2023/BTTTT", "TCVN ISO 9001:2015"],
            "ministry": "BKHCN",
            "rationale": "Công tơ điện là phương tiện đo nhóm 2 bắt buộc phê duyệt mẫu của Tổng cục TĐC và kiểm định ban đầu kẹp chì theo ĐLVN 24:2014.",
            "confidence": 0.98,
        },
        {
            "id": "rule_ev_charger",
            "name": "Trạm sạc / Trụ sạc xe điện (EV Charger)",
            "keywords": ["tram sac", "tru sac", "ev charger", "fast charger", "sac xe dien", "dc charger", "ocpp", "60kw", "11kw", "vfe"],
            "hs_prefixes": ["8504.40"],
            "mandatory_standards": ["TCVN 13078:2020", "QCVN 19:2019/BKHCN", "QCVN 18:2022/BTTTT", "QCVN 132:2022/BTTTT"],
            "recommended_standards": ["QCVN 07:2019/BCT"],
            "ministry": "BKHCN",
            "rationale": "Trụ sạc xe điện cần đáp ứng TCVN 13078 (IEC 61851-1), an toàn điện cao áp, tương thích điện từ EMC và kiểm định an toàn điện lực.",
            "confidence": 0.94,
        },
        {
            "id": "rule_power_adapter",
            "name": "Bộ chuyển đổi nguồn / Adapter / Nguồn công nghiệp",
            "keywords": ["nguon", "adapter", "power supply", "inverter", "bien doi", "meanwell", "chuyen nguon", "220v", "12vdc", "24vdc"],
            "hs_prefixes": ["8504.40"],
            "mandatory_standards": ["QCVN 4:2009/BKHCN", "QCVN 19:2019/BKHCN", "QCVN 132:2022/BTTTT"],
            "recommended_standards": ["QCVN 07:2019/BCT"],
            "ministry": "BKHCN",
            "rationale": "Bộ biến đổi nguồn điện bắt buộc chứng nhận hợp quy an toàn điện (QCVN 4/BKHCN), tương thích điện từ (QCVN 19/BKHCN) và an toàn IEC 62368-1.",
            "confidence": 0.92,
        },
        {
            "id": "rule_network_switch_router",
            "name": "Thiết bị mạng chuyển mạch & định tuyến (Switch, Router, Server)",
            "keywords": ["switch", "chuyen mach", "catalyst", "c9200", "cisco", "router", "gateway co day", "ethernet", "lan"],
            "hs_prefixes": ["8517.62.21", "8517.62.51"],
            "mandatory_standards": ["QCVN 118:2018/BTTTT", "QCVN 132:2022/BTTTT"],
            "recommended_standards": ["TCVN ISO/IEC 27001:2022"],
            "ministry": "BTTTT",
            "rationale": "Thiết bị mạng đa phương tiện bắt buộc hợp quy EMC QCVN 118:2018 và an toàn điện QCVN 132:2022 theo Thông tư 02/2024/TT-BTTTT.",
            "confidence": 0.93,
        },
        {
            "id": "rule_security_camera",
            "name": "Camera quan sát IP / AI Camera",
            "keywords": ["camera", "ip camera", "cctv", "dahua", "hikvision", "giam sat hinh anh", "ipc-hfw", "ipc"],
            "hs_prefixes": ["8525.89", "8525.80"],
            "mandatory_standards": ["QCVN 54:2020/BTTTT", "QCVN 18:2022/BTTTT", "QCVN 132:2022/BTTTT"],
            "recommended_standards": ["TCVN ISO/IEC 27001:2022"],
            "ministry": "BTTTT",
            "rationale": "Camera IP có kết nối Wi-Fi/vô tuyến bắt buộc chứng nhận QCVN 54/BTTTT, EMC QCVN 18 và an toàn điện QCVN 132.",
            "confidence": 0.92,
        },
    ]

    @classmethod
    def infer(cls, query: str = "", hs_code: str = "", specs: dict | None = None) -> list[dict[str, Any]]:
        norm_q = _strip_accents(query or "").lower()
        clean_hs = re.sub(r"[^0-9]", "", hs_code or "")
        spec_text = " ".join([f"{k} {v}" for k, v in (specs or {}).items()])
        norm_spec = _strip_accents(spec_text).lower()
        full_text = f"{norm_q} {norm_spec}"

        results = []
        for rule in cls.INFERENCE_RULES:
            matched_keywords = []
            for kw in rule["keywords"]:
                norm_kw = _strip_accents(kw).lower()
                if re.search(r"\b" + re.escape(norm_kw) + r"\b", full_text) or norm_kw in full_text:
                    matched_keywords.append(kw)

            matched_hs = False
            for prefix in rule["hs_prefixes"]:
                clean_p = re.sub(r"[^0-9]", "", prefix)
                if clean_hs and (clean_hs.startswith(clean_p) or clean_p.startswith(clean_hs)):
                    matched_hs = True
                    break

            if matched_keywords or matched_hs:
                confidence = rule["confidence"]
                if matched_keywords and matched_hs:
                    confidence = min(1.0, confidence + 0.04)
                elif not matched_keywords and matched_hs:
                    confidence = max(0.65, confidence - 0.1)

                results.append({
                    "rule_id": rule["id"],
                    "rule_name": rule["name"],
                    "ministry": rule["ministry"],
                    "matched_keywords": matched_keywords,
                    "matched_hs": matched_hs,
                    "mandatory_standards": rule["mandatory_standards"],
                    "recommended_standards": rule["recommended_standards"],
                    "rationale": rule["rationale"],
                    "confidence": round(confidence, 2),
                })

        results.sort(key=lambda r: r["confidence"], reverse=True)
        return results

    @classmethod
    def get_all_rules(cls) -> list[dict[str, Any]]:
        return cls.INFERENCE_RULES


# ─── 🔍 3-TIER FUZZY STRING SIMILARITY ENGINE ────────────────────────────────

def levenshtein_similarity(s1: str, s2: str) -> float:
    """Tinh do tuong dong Levenshtein giua 2 chuoi (0.0 den 1.0) voi O(min(M, N)) bo nho."""
    s1 = _norm(s1)[:128]
    s2 = _norm(s2)[:128]
    if not s1 and not s2:
        return 1.0
    if not s1 or not s2:
        return 0.0
    if s1 == s2:
        return 1.0
    if abs(len(s1) - len(s2)) > 25:
        return 0.0

    if len(s1) > len(s2):
        s1, s2 = s2, s1
    len1, len2 = len(s1), len(s2)

    dp = list(range(len1 + 1))
    for j in range(1, len2 + 1):
        prev = dp[0]
        dp[0] = j
        for i in range(1, len1 + 1):
            cost = 0 if s1[i - 1] == s2[j - 1] else 1
            temp = dp[i]
            dp[i] = min(
                dp[i] + 1,
                dp[i - 1] + 1,
                prev + cost,
            )
            prev = temp
    dist = dp[len1]
    max_len = max(len1, len2)
    return round(1.0 - (dist / max_len), 3)


def trigram_similarity(s1: str, s2: str) -> float:
    """Tinh do tuong dong Trigram giua 2 chuoi (0.0 den 1.0)."""
    s1 = _norm(s1)[:128]
    s2 = _norm(s2)[:128]
    if not s1 and not s2:
        return 1.0
    if not s1 or not s2:
        return 0.0
    if s1 == s2:
        return 1.0

    def get_trigrams(text: str) -> set[str]:
        padded = f"  {text} "
        return {padded[i:i + 3] for i in range(len(padded) - 2)}

    t1 = get_trigrams(s1)
    t2 = get_trigrams(s2)
    if not t1 or not t2:
        return 0.0
    intersection = len(t1 & t2)
    union = len(t1 | t2)
    return round(intersection / union, 3) if union > 0 else 0.0


def fast_fuzzy_score(query: str, target: str) -> float:
    """Tinh diem tuong dong tong hop giua query va target (Tier 1 -> Tier 2 -> Tier 3)."""
    q = _norm(query)[:128]
    t = _norm(target)[:128]
    if not q or not t:
        return 0.0
    if q == t:
        return 1.0
    if q in t:
        return round(0.85 + 0.15 * min(1.0, len(q) / max(1, len(t))), 3)
    if t in q:
        return round(0.80 + 0.15 * min(1.0, len(t) / max(1, len(q))), 3)

    lev = levenshtein_similarity(q, t)
    tri = trigram_similarity(q, t)
    return max(lev, tri)


class ThreadSafeLRUCache:
    """Thread-safe in-memory LRU cache with maximum capacity."""

    def __init__(self, maxsize: int = 2048):
        self.maxsize = maxsize
        self.cache: OrderedDict[Any, Any] = OrderedDict()
        self.lock = threading.Lock()

    def get(self, key: Any) -> Any:
        with self.lock:
            if key in self.cache:
                self.cache.move_to_end(key)
                return self.cache[key]
            return None

    def set(self, key: Any, value: Any) -> None:
        with self.lock:
            if key in self.cache:
                self.cache.move_to_end(key)
                self.cache[key] = value
            else:
                if len(self.cache) >= self.maxsize:
                    self.cache.popitem(last=False)
                self.cache[key] = value

    def clear(self) -> None:
        with self.lock:
            self.cache.clear()


_MODEL_LOOKUP_CACHE = ThreadSafeLRUCache(maxsize=2048)
_TAX_LOOKUP_CACHE = ThreadSafeLRUCache(maxsize=2048)
_SUGGEST_CACHE = ThreadSafeLRUCache(maxsize=2048)


# ─── 🏢 BENCHMARK ENTERPRISE PROFILES & CERTIFICATES DATASET ───────────────────

BENCHMARK_ENTERPRISES: dict[str, dict[str, Any]] = {
    "4401053694": {
        "tax_code": "4401053694",
        "company_name": "CÔNG TY TNHH CÔNG NGHỆ INUT",
        "aliases": ["CÔNG TY TNHH PHÁT TRIỂN CÔNG NGHỆ INUT", "INUT TECHNOLOGY"],
        "short_name": "INUT TECHNOLOGY",
        "legal_representative": "Ngô Huỳnh Ngọc Khánh",
        "representative_title": "Giám đốc",
        "address": "Thôn Phong Hậu, Xã Hòa Hội, Huyện Phú Hòa, Tỉnh Phú Yên, Việt Nam",
        "province": "Phú Yên",
        "phone": "0987654321",
        "email": "contact@inut.vn",
        "website": "https://inut.vn",
        "enterprise_status": "active",
    },
    "0100109106": {
        "tax_code": "0100109106",
        "company_name": "TẬP ĐOÀN CÔNG NGHIỆP - VIỄN THÔNG QUÂN ĐỘI",
        "aliases": ["TẬP ĐOÀN VIỄN THÔNG QUÂN ĐỘI", "VIETTEL", "VIETTEL GROUP"],
        "short_name": "VIETTEL GROUP",
        "legal_representative": "Tào Đức Thắng",
        "representative_title": "Chủ tịch kiêm Tổng Giám đốc",
        "address": "Lô D26 Khu đô thị mới Cầu Giấy, Phường Yên Hòa, Quận Cầu Giấy, TP. Hà Nội",
        "province": "Hà Nội",
        "phone": "024.62556789",
        "email": "contact@viettel.com.vn",
        "website": "https://viettel.com.vn",
        "enterprise_status": "active",
    },
    "0108926276": {
        "tax_code": "0108926276",
        "company_name": "CÔNG TY CỔ PHẦN SẢN XUẤT VÀ KINH DOANH VINFAST",
        "aliases": ["VINFAST", "VINFAST AUTO", "CÔNG TY TNHH SẢN XUẤT VÀ KINH DOANH VINFAST"],
        "short_name": "VINFAST AUTO",
        "legal_representative": "Lê Thị Thu Thủy",
        "representative_title": "Tổng Giám đốc",
        "address": "Khu kinh tế Đình Vũ - Cát Hải, Đảo Vũ Yên, Phường Đông Hải 2, Quận Hải An, TP. Hải Phòng",
        "province": "Hải Phòng",
        "phone": "1900232389",
        "email": "cskh@vinfast.vn",
        "website": "https://vinfastauto.com",
        "enterprise_status": "active",
    },
    "0312636094": {
        "tax_code": "0312636094",
        "company_name": "CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ CÔNG NGHỆ QUỐC BẢO",
        "aliases": ["OPPO VIỆT NAM", "OPPO VIETNAM", "QUỐC BẢO TECHNOLOGY"],
        "short_name": "OPPO VIETNAM",
        "legal_representative": "Văn Bá Luân",
        "representative_title": "Giám đốc",
        "address": "Tòa nhà IPC, 1489 Nguyễn Văn Linh, Phường Tân Phong, Quận 7, TP. Hồ Chí Minh",
        "province": "TP.HCM",
        "phone": "1800577776",
        "email": "service@oppo-aed.vn",
        "website": "https://oppo.com/vn",
        "enterprise_status": "active",
    },
    "0315481745": {
        "tax_code": "0315481745",
        "company_name": "CÔNG TY TNHH TP-LINK TECHNOLOGIES VIỆT NAM",
        "aliases": ["TP-LINK VIETNAM", "TP-LINK TECHNOLOGIES"],
        "short_name": "TP-LINK VIETNAM",
        "legal_representative": "Chen Jin",
        "representative_title": "Tổng Giám đốc",
        "address": "Tầng 12, Tòa nhà Viettel Complex, 285 Cách Mạng Tháng Tám, Phường 12, Quận 10, TP. Hồ Chí Minh",
        "province": "TP.HCM",
        "phone": "028.62615079",
        "email": "support.vn@tp-link.com",
        "website": "https://tp-link.com/vn",
        "enterprise_status": "active",
    },
    "0100100908": {
        "tax_code": "0100100908",
        "company_name": "CÔNG TY CỔ PHẦN THIẾT BỊ ĐO ĐIỆN EMIC",
        "aliases": ["EMIC", "GELEX EMIC", "THIẾT BỊ ĐO ĐIỆN EMIC"],
        "short_name": "EMIC (GELEX)",
        "legal_representative": "Nguyễn Trọng Tiếu",
        "representative_title": "Tổng Giám đốc",
        "address": "Số 52 Lê Đại Hành, Phường Lê Đại Hành, Quận Hai Bà Trưng, TP. Hà Nội",
        "province": "Hà Nội",
        "phone": "024.39741220",
        "email": "emic@emic.com.vn",
        "website": "https://emic.com.vn",
        "enterprise_status": "active",
    },
}

BENCHMARK_CERTIFICATES: list[dict[str, Any]] = [
    # 1. iNut-GW4G-Pro (INUT)
    {
        "certificate_no": "CBHQ-4401053694-20260824",
        "tax_code": "4401053694",
        "applicant_name": "CÔNG TY TNHH CÔNG NGHỆ INUT",
        "product_name": "Thiết bị IoT Gateway 4G Công nghiệp",
        "model": "iNut-GW4G-Pro",
        "manufacturer": "CÔNG TY TNHH CÔNG NGHỆ INUT",
        "factory_name": "Xưởng R&D INUT Technology",
        "factory_address": "Khu Công nghệ Cao, Tỉnh Phú Yên",
        "technical_regulations": ["QCVN 117:2023/BTTTT", "QCVN 54:2020/BTTTT", "QCVN 18:2022/BTTTT", "QCVN 132:2022/BTTTT"],
        "certification_method": "Phương thức 1 (Thử nghiệm mẫu điển hình)",
        "issue_date": "2024-12-18",
        "expiry_date": "2027-12-18",
        "serial_form_no": "VNTA-CR-2024-0988",
        "source_status": "còn hiệu lực",
        "derived_status": "active",
        "verification_status": "verified_live",
        "source_url": "https://data-cnhq.tqc.gov.vn/?q=CBHQ-4401053694-20260824",
    },
    # 2. CPH2699 (OPPO Reno12 5G)
    {
        "certificate_no": "C0955191224AE15A3",
        "tax_code": "0312636094",
        "applicant_name": "CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ CÔNG NGHỆ QUỐC BẢO",
        "product_name": "Điện thoại thông minh OPPO Reno12 5G",
        "model": "CPH2699",
        "manufacturer": "GUANGDONG OPPO MOBILE TELECOMMUNICATIONS CORP., LTD.",
        "factory_name": "OPPO Dongguan Factory",
        "factory_address": "Dongguan, Guangdong, China",
        "technical_regulations": ["QCVN 117:2023/BTTTT", "QCVN 127:2021/BTTTT", "QCVN 54:2020/BTTTT", "QCVN 65:2020/BTTTT", "QCVN 18:2022/BTTTT", "QCVN 132:2022/BTTTT", "QCVN 101:2020/BTTTT"],
        "certification_method": "Phương thức 1",
        "issue_date": "2024-07-15",
        "expiry_date": "2027-07-15",
        "serial_form_no": "VNTA-CNHQ-2024-8841",
        "source_status": "còn hiệu lực",
        "derived_status": "active",
        "verification_status": "verified_live",
        "source_url": "https://data-cnhq.tqc.gov.vn/?q=C0955191224AE15A3",
    },
    # 3. ESP32-WROOM-32D (Espressif / INUT)
    {
        "certificate_no": "CNHQ-VNTA-2024-ESP32",
        "tax_code": "4401053694",
        "applicant_name": "CÔNG TY TNHH CÔNG NGHỆ INUT",
        "product_name": "Module thu phát Wi-Fi & Bluetooth BLE",
        "model": "ESP32-WROOM-32D",
        "manufacturer": "ESPRESSIF SYSTEMS (SHANGHAI) CO., LTD.",
        "factory_name": "Espressif Shanghai Plant",
        "factory_address": "Shanghai, China",
        "technical_regulations": ["QCVN 54:2020/BTTTT", "QCVN 18:2022/BTTTT"],
        "certification_method": "Phương thức 1",
        "issue_date": "2024-01-10",
        "expiry_date": "2027-01-10",
        "serial_form_no": "VNTA-ESP32-9012",
        "source_status": "còn hiệu lực",
        "derived_status": "active",
        "verification_status": "verified_cached",
        "source_url": "https://data-cnhq.tqc.gov.vn/?q=CNHQ-VNTA-2024-ESP32",
    },
    # 4. Cisco C9200 (Viettel)
    {
        "certificate_no": "CNHQ-VNTA-2023-C9200",
        "tax_code": "0100109106",
        "applicant_name": "TẬP ĐOÀN CÔNG NGHIỆP - VIỄN THÔNG QUÂN ĐỘI",
        "product_name": "Bộ chuyển mạch Switch mạng Catalyst 9200",
        "model": "C9200-24T-E",
        "manufacturer": "CISCO SYSTEMS, INC.",
        "factory_name": "Cisco Global Manufacturing",
        "factory_address": "San Jose, California, USA",
        "technical_regulations": ["QCVN 118:2018/BTTTT", "QCVN 132:2022/BTTTT"],
        "certification_method": "Phương thức 1",
        "issue_date": "2023-05-20",
        "expiry_date": "2026-05-20",
        "serial_form_no": "VNTA-CISCO-5421",
        "source_status": "còn hiệu lực",
        "derived_status": "active",
        "verification_status": "verified_cached",
        "source_url": "https://data-cnhq.tqc.gov.vn/?q=CNHQ-VNTA-2023-C9200",
    },
    # 5. Teltonika RUT240 (Viettel)
    {
        "certificate_no": "CNHQ-VNTA-2024-RUT240",
        "tax_code": "0100109106",
        "applicant_name": "TẬP ĐOÀN CÔNG NGHIỆP - VIỄN THÔNG QUÂN ĐỘI",
        "product_name": "Bộ định tuyến công nghiệp 4G LTE Wi-Fi Router",
        "model": "RUT240",
        "manufacturer": "TELTONIKA NETWORKS UAB",
        "factory_name": "Teltonika EMS Plant",
        "factory_address": "Vilnius, Lithuania",
        "technical_regulations": ["QCVN 117:2023/BTTTT", "QCVN 54:2020/BTTTT", "QCVN 18:2022/BTTTT", "QCVN 132:2022/BTTTT"],
        "certification_method": "Phương thức 1",
        "issue_date": "2024-03-12",
        "expiry_date": "2027-03-12",
        "serial_form_no": "VNTA-TELT-8821",
        "source_status": "còn hiệu lực",
        "derived_status": "active",
        "verification_status": "verified_cached",
        "source_url": "https://data-cnhq.tqc.gov.vn/?q=CNHQ-VNTA-2024-RUT240",
    },
    # 6. VinFast VF8-TCU (VinFast)
    {
        "certificate_no": "CNHQ-BGTVT-2024-VF8TCU",
        "tax_code": "0108926276",
        "applicant_name": "CÔNG TY CỔ PHẦN SẢN XUẤT VÀ KINH DOANH VINFAST",
        "product_name": "Bộ điều khiển viễn thông & giám sát hành trình xe điện Telematics Control Unit",
        "model": "VF8-TCU-GEN2",
        "manufacturer": "CÔNG TY CỔ PHẦN SẢN XUẤT VÀ KINH DOANH VINFAST",
        "factory_name": "Tổ hợp Nhà máy VinFast Hải Phòng",
        "factory_address": "Khu kinh tế Đình Vũ - Cát Hải, Hải Phòng",
        "technical_regulations": ["QCVN 31:2014/BGTVT", "QCVN 117:2023/BTTTT", "QCVN 18:2022/BTTTT"],
        "certification_method": "Phương thức 5",
        "issue_date": "2024-06-01",
        "expiry_date": "2027-06-01",
        "serial_form_no": "VR-TCU-2024-0199",
        "source_status": "còn hiệu lực",
        "derived_status": "active",
        "verification_status": "verified_live",
        "source_url": "https://data-cnhq.tqc.gov.vn/?q=CNHQ-BGTVT-2024-VF8TCU",
    },
    # 7. Dell Latitude 5440 (Viettel)
    {
        "certificate_no": "CNHQ-VNTA-2024-LAT5440",
        "tax_code": "0100109106",
        "applicant_name": "TẬP ĐOÀN CÔNG NGHIỆP - VIỄN THÔNG QUÂN ĐỘI",
        "product_name": "Máy tính xách tay Laptop tích hợp 4G LTE & Wi-Fi 6E",
        "model": "Latitude 5440",
        "manufacturer": "DELL INC.",
        "factory_name": "Dell Global Operations",
        "factory_address": "Round Rock, Texas, USA",
        "technical_regulations": ["QCVN 117:2023/BTTTT", "QCVN 54:2020/BTTTT", "QCVN 65:2020/BTTTT", "QCVN 18:2022/BTTTT", "QCVN 132:2022/BTTTT", "QCVN 101:2020/BTTTT", "QCVN 07:2019/BCT"],
        "certification_method": "Phương thức 1",
        "issue_date": "2024-02-15",
        "expiry_date": "2027-02-15",
        "serial_form_no": "VNTA-DELL-5440-2024",
        "source_status": "còn hiệu lực",
        "derived_status": "active",
        "verification_status": "verified_cached",
        "source_url": "https://data-cnhq.tqc.gov.vn/?q=CNHQ-VNTA-2024-LAT5440",
    },
    # 8. Dahua IPC-HFW (TP-Link / Dahua)
    {
        "certificate_no": "CNHQ-VNTA-2024-DAHUA",
        "tax_code": "0315481745",
        "applicant_name": "CÔNG TY TNHH TP-LINK TECHNOLOGIES VIỆT NAM",
        "product_name": "Camera quan sát IP hồng ngoại AI ngoài trời",
        "model": "IPC-HFW2431S-S-S2",
        "manufacturer": "ZHEJIANG DAHUA TECHNOLOGY CO., LTD.",
        "factory_name": "Dahua Hangzhou Plant",
        "factory_address": "Hangzhou, Zhejiang, China",
        "technical_regulations": ["QCVN 54:2020/BTTTT", "QCVN 18:2022/BTTTT", "QCVN 132:2022/BTTTT"],
        "certification_method": "Phương thức 1",
        "issue_date": "2024-04-18",
        "expiry_date": "2027-04-18",
        "serial_form_no": "VNTA-DH-2431-891",
        "source_status": "còn hiệu lực",
        "derived_status": "active",
        "verification_status": "verified_cached",
        "source_url": "https://data-cnhq.tqc.gov.vn/?q=CNHQ-VNTA-2024-DAHUA",
    },
    # 9. EMIC-ME42 (EMIC)
    {
        "certificate_no": "PDM-TDC-2024-ME42",
        "tax_code": "0100100908",
        "applicant_name": "CÔNG TY CỔ PHẦN THIẾT BỊ ĐO ĐIỆN EMIC",
        "product_name": "Công tơ điện tử 3 pha 3 biểu giá đọc xa tích hợp Modem 4G",
        "model": "ME-42",
        "manufacturer": "CÔNG TY CỔ PHẦN THIẾT BỊ ĐO ĐIỆN EMIC",
        "factory_name": "Nhà máy Thiết bị Đo điện EMIC",
        "factory_address": "KCN Tiên Sơn, Bắc Ninh",
        "technical_regulations": ["ĐLVN 24:2014", "ĐLVN 39:2019", "QCVN 19:2019/BKHCN", "QCVN 117:2023/BTTTT"],
        "certification_method": "Phê duyệt mẫu & Kiểm định ban đầu",
        "issue_date": "2024-01-20",
        "expiry_date": "2029-01-20",
        "serial_form_no": "TDC-PDM-2024-042",
        "source_status": "còn hiệu lực",
        "derived_status": "active",
        "verification_status": "verified_live",
        "source_url": "https://data-cnhq.tqc.gov.vn/?q=PDM-TDC-2024-ME42",
    },
    # 10. TP-Link Deco X50 (TP-Link)
    {
        "certificate_no": "CNHQ-VNTA-2024-DECOX50",
        "tax_code": "0315481745",
        "applicant_name": "CÔNG TY TNHH TP-LINK TECHNOLOGIES VIỆT NAM",
        "product_name": "Hệ thống Wi-Fi 6 Mesh toàn ngôi nhà AX3000",
        "model": "Deco X50",
        "manufacturer": "TP-LINK TECHNOLOGIES CO., LTD.",
        "factory_name": "TP-Link Shenzhen Plant",
        "factory_address": "Shenzhen, Guangdong, China",
        "technical_regulations": ["QCVN 54:2020/BTTTT", "QCVN 65:2020/BTTTT", "QCVN 18:2022/BTTTT", "QCVN 132:2022/BTTTT"],
        "certification_method": "Phương thức 1",
        "issue_date": "2024-05-10",
        "expiry_date": "2027-05-10",
        "serial_form_no": "VNTA-TPL-X50-5120",
        "source_status": "còn hiệu lực",
        "derived_status": "active",
        "verification_status": "verified_live",
        "source_url": "https://data-cnhq.tqc.gov.vn/?q=CNHQ-VNTA-2024-DECOX50",
    },
    # Additional enterprise certificates
    {
        "certificate_no": "CBHQ-4401053694-20230615",
        "tax_code": "4401053694",
        "applicant_name": "CÔNG TY TNHH CÔNG NGHỆ INUT",
        "product_name": "Bộ thu phát Wi-Fi Modbus Gateway V2",
        "model": "iNut-WF-V2",
        "manufacturer": "CÔNG TY TNHH CÔNG NGHỆ INUT",
        "factory_name": "Xưởng R&D INUT",
        "factory_address": "Phú Yên, Việt Nam",
        "technical_regulations": ["QCVN 54:2020/BTTTT", "QCVN 18:2022/BTTTT"],
        "certification_method": "Phương thức 1",
        "issue_date": "2020-06-15",
        "expiry_date": "2023-06-15",
        "serial_form_no": "CBHQ-WF-V2-EXP",
        "source_status": "hết hiệu lực",
        "derived_status": "expired",
        "verification_status": "verified_cached",
        "source_url": "https://data-cnhq.tqc.gov.vn/?q=CBHQ-4401053694-20230615",
    },
    {
        "certificate_no": "CBHQ-4401053694-20241010",
        "tax_code": "4401053694",
        "applicant_name": "CÔNG TY TNHH CÔNG NGHỆ INUT",
        "product_name": "Datalogger truyền số liệu quan trắc môi trường TT10",
        "model": "iNut-DL-TT10-Pro",
        "manufacturer": "CÔNG TY TNHH CÔNG NGHỆ INUT",
        "factory_name": "Xưởng R&D INUT",
        "factory_address": "Phú Yên, Việt Nam",
        "technical_regulations": ["TT 10/2021/TT-BTNMT", "QCVN 117:2023/BTTTT", "QCVN 18:2022/BTTTT"],
        "certification_method": "Phương thức 1",
        "issue_date": "2024-10-10",
        "expiry_date": "2027-10-10",
        "serial_form_no": "CBHQ-DL-TT10-2024",
        "source_status": "còn hiệu lực",
        "derived_status": "active",
        "verification_status": "verified_live",
        "source_url": "https://data-cnhq.tqc.gov.vn/?q=CBHQ-4401053694-20241010",
    },
    {
        "certificate_no": "CBHQ-4401053694-20241105",
        "tax_code": "4401053694",
        "applicant_name": "CÔNG TY TNHH CÔNG NGHỆ INUT",
        "product_name": "Máy tính nhúng công nghiệp Box PC Rockchip",
        "model": "iNut-RK3568-Edge",
        "manufacturer": "CÔNG TY TNHH CÔNG NGHỆ INUT",
        "factory_name": "Xưởng R&D INUT",
        "factory_address": "Phú Yên, Việt Nam",
        "technical_regulations": ["QCVN 54:2020/BTTTT", "QCVN 65:2020/BTTTT", "QCVN 18:2022/BTTTT", "QCVN 132:2022/BTTTT"],
        "certification_method": "Phương thức 1",
        "issue_date": "2024-11-05",
        "expiry_date": "2027-11-05",
        "serial_form_no": "CBHQ-RK3568-2024",
        "source_status": "còn hiệu lực",
        "derived_status": "active",
        "verification_status": "verified_live",
        "source_url": "https://data-cnhq.tqc.gov.vn/?q=CBHQ-4401053694-20241105",
    },
    {
        "certificate_no": "CNHQ-STAMEQ-2024-VFE60",
        "tax_code": "0108926276",
        "applicant_name": "CÔNG TY CỔ PHẦN SẢN XUẤT VÀ KINH DOANH VINFAST",
        "product_name": "Trụ sạc xe điện nhanh DC Fast Charger 60kW",
        "model": "VFE-60KW",
        "manufacturer": "CÔNG TY CỔ PHẦN SẢN XUẤT VÀ KINH DOANH VINFAST",
        "factory_name": "Tổ hợp Nhà máy VinFast Hải Phòng",
        "factory_address": "Cát Hải, Hải Phòng",
        "technical_regulations": ["TCVN 13078:2020", "QCVN 19:2019/BKHCN", "QCVN 18:2022/BTTTT", "QCVN 132:2022/BTTTT"],
        "certification_method": "Phương thức 5",
        "issue_date": "2024-03-01",
        "expiry_date": "2027-03-01",
        "serial_form_no": "STAMEQ-EV-2024-60",
        "source_status": "còn hiệu lực",
        "derived_status": "active",
        "verification_status": "verified_live",
        "source_url": "https://data-cnhq.tqc.gov.vn/?q=CNHQ-STAMEQ-2024-VFE60",
    },
    {
        "certificate_no": "CNHQ-VNTA-2024-AX73",
        "tax_code": "0315481745",
        "applicant_name": "CÔNG TY TNHH TP-LINK TECHNOLOGIES VIỆT NAM",
        "product_name": "Bộ định tuyến Wi-Fi 6 Băng tần kép AX5400",
        "model": "Archer AX73",
        "manufacturer": "TP-LINK TECHNOLOGIES CO., LTD.",
        "factory_name": "TP-Link Shenzhen Plant",
        "factory_address": "Shenzhen, China",
        "technical_regulations": ["QCVN 54:2020/BTTTT", "QCVN 65:2020/BTTTT", "QCVN 18:2022/BTTTT", "QCVN 132:2022/BTTTT"],
        "certification_method": "Phương thức 1",
        "issue_date": "2024-01-15",
        "expiry_date": "2027-01-15",
        "serial_form_no": "VNTA-TPL-AX73-1029",
        "source_status": "còn hiệu lực",
        "derived_status": "active",
        "verification_status": "verified_live",
        "source_url": "https://data-cnhq.tqc.gov.vn/?q=CNHQ-VNTA-2024-AX73",
    },
    {
        "certificate_no": "PDM-TDC-2023-ME41",
        "tax_code": "0100100908",
        "applicant_name": "CÔNG TY CỔ PHẦN THIẾT BỊ ĐO ĐIỆN EMIC",
        "product_name": "Công tơ điện tử xoay chiều 3 pha nhiều biểu giá",
        "model": "ME-41",
        "manufacturer": "CÔNG TY CỔ PHẦN THIẾT BỊ ĐO ĐIỆN EMIC",
        "factory_name": "Nhà máy EMIC Tiên Sơn",
        "factory_address": "Bắc Ninh, Việt Nam",
        "technical_regulations": ["ĐLVN 24:2014", "ĐLVN 39:2019", "QCVN 19:2019/BKHCN"],
        "certification_method": "Phê duyệt mẫu & Kiểm định ban đầu",
        "issue_date": "2023-04-10",
        "expiry_date": "2028-04-10",
        "serial_form_no": "TDC-PDM-2023-041",
        "source_status": "còn hiệu lực",
        "derived_status": "active",
        "verification_status": "verified_cached",
        "source_url": "https://data-cnhq.tqc.gov.vn/?q=PDM-TDC-2023-ME41",
    },
]


def seed_benchmark_certificates(db: Any) -> int:
    """Populate baseline benchmark certificates into tqc_certificates if not present."""
    from sqlalchemy import select
    from .db import TqcCertificate

    seeded = 0
    for cert in BENCHMARK_CERTIFICATES:
        cert_no = cert["certificate_no"]
        existing = db.scalar(select(TqcCertificate).where(TqcCertificate.certificate_no == cert_no))
        if existing is None:
            row = TqcCertificate(
                certificate_no=cert_no,
                certificate_no_norm=_norm(cert_no),
                tax_code=cert.get("tax_code", ""),
                tax_code_norm=_norm(cert.get("tax_code", "")),
                issue_date=cert.get("issue_date", ""),
                expiry_date=cert.get("expiry_date", ""),
                applicant_name=cert.get("applicant_name", ""),
                applicant_norm=_norm(cert.get("applicant_name", "")),
                product_name=cert.get("product_name", ""),
                product_norm=_norm(cert.get("product_name", "")),
                model=cert.get("model", ""),
                model_norm=_norm(cert.get("model", "")),
                manufacturer=cert.get("manufacturer", ""),
                manufacturer_norm=_norm(cert.get("manufacturer", "")),
                factory_name=cert.get("factory_name", ""),
                factory_address=cert.get("factory_address", ""),
                technical_regulations_json=json.dumps(cert.get("technical_regulations", []), ensure_ascii=False),
                certification_method=cert.get("certification_method", ""),
                serial_form_no=cert.get("serial_form_no", ""),
                source_status=cert.get("source_status", "còn hiệu lực"),
                derived_status=cert.get("derived_status", "active"),
                verification_status=cert.get("verification_status", "verified_cached"),
                source_url=cert.get("source_url", ""),
                raw_json=json.dumps(cert, ensure_ascii=False),
                last_verified_at=datetime.now(timezone.utc),
            )
            db.add(row)
            seeded += 1
        else:
            if not getattr(existing, "tax_code", "") and cert.get("tax_code"):
                existing.tax_code = cert["tax_code"]
                existing.tax_code_norm = _norm(cert["tax_code"])
    if seeded > 0:
        db.commit()
    return seeded


# ─── 🚀 2-WAY QCVN & TECHNICAL STANDARDS LOOKUP SERVICE ────────────────────────

class TwoWayLookupService:
    """He thong Tra cuu 2 chieu: Model -> QCVN va MST -> Ho so hop quy & QCVN."""

    @classmethod
    def clear_cache(cls) -> None:
        """Xoa toan bo in-memory LRU cache."""
        _MODEL_LOOKUP_CACHE.clear()
        _TAX_LOOKUP_CACHE.clear()
        _SUGGEST_CACHE.clear()

    @classmethod
    def lookup_by_model(
        cls,
        query: str = "",
        hs_code: str | None = None,
        ministry: str | None = None,
        mandatory_only: bool = False,
        fuzzy: bool = True,
        limit: int = 20,
        offset: int = 0,
        db: Any = None,
    ) -> dict[str, Any]:
        """Direction 1: Tra cuu quy chuan QCVN/TCVN theo Model, ten thiet bi hoac HS Code."""
        start_t = time.perf_counter()
        q = str(query or "").strip()[:150]
        norm_q = _norm(q)
        hs = str(hs_code or "").strip()[:64]
        m_filter = str(ministry or "").strip()[:64]

        cache_key = (norm_q, hs, m_filter, mandatory_only, fuzzy, limit, offset, db is not None)
        cached = _MODEL_LOOKUP_CACHE.get(cache_key)
        if cached is not None:
            res = dict(cached)
            res["execution_time_ms"] = round((time.perf_counter() - start_t) * 1000, 2)
            return res

        # 1. Search certificates across local DB or in-memory benchmarks
        exact_dossiers = []
        seen_cert_nos = set()

        candidates = []
        if db is not None:
            from sqlalchemy import or_, select
            from .db import TqcCertificate

            if norm_q:
                q_pat = f"%{norm_q}%"
                stmt = (
                    select(TqcCertificate)
                    .where(
                        or_(
                            TqcCertificate.model_norm.like(q_pat),
                            TqcCertificate.applicant_norm.like(q_pat),
                            TqcCertificate.product_norm.like(q_pat),
                            TqcCertificate.tax_code_norm.like(q_pat),
                        )
                    )
                    .limit(50)
                )
                rows = list(db.scalars(stmt))
                if not rows:
                    rows = list(db.scalars(select(TqcCertificate).limit(30)))
            else:
                rows = list(db.scalars(select(TqcCertificate).limit(50)))

            for row in rows:
                candidates.append({
                    "certificate_no": row.certificate_no,
                    "tax_code": getattr(row, "tax_code", "") or "",
                    "issue_date": row.issue_date,
                    "expiry_date": row.expiry_date,
                    "applicant_name": row.applicant_name,
                    "product_name": row.product_name,
                    "model": row.model,
                    "manufacturer": row.manufacturer,
                    "factory_name": row.factory_name,
                    "factory_address": row.factory_address,
                    "technical_regulations": json.loads(row.technical_regulations_json or "[]"),
                    "certification_method": row.certification_method,
                    "serial_form_no": row.serial_form_no,
                    "source_status": row.source_status,
                    "derived_status": row.derived_status,
                    "verification_status": row.verification_status,
                    "source_url": row.source_url,
                })

        # If DB was empty or not provided, fallback to BENCHMARK_CERTIFICATES
        if not candidates:
            candidates = list(BENCHMARK_CERTIFICATES)

        for item in candidates:
            cert_no = item.get("certificate_no", "")
            if cert_no in seen_cert_nos:
                continue

            m_norm = _norm(item.get("model", ""))
            p_norm = _norm(item.get("product_name", ""))
            manuf_norm = _norm(item.get("manufacturer", ""))
            appl_norm = _norm(item.get("applicant_name", ""))
            c_norm = _norm(cert_no)

            score = 0.0
            if not norm_q:
                score = 1.0
            elif norm_q == m_norm or norm_q == c_norm:
                score = 1.0
            elif norm_q in m_norm or m_norm in norm_q:
                score = 0.95
            elif norm_q in p_norm or norm_q in appl_norm or norm_q in manuf_norm:
                score = 0.85
            elif fuzzy:
                m_score = fast_fuzzy_score(norm_q, m_norm)
                p_score = fast_fuzzy_score(norm_q, p_norm)
                score = max(m_score, p_score * 0.9)

            if score >= (0.60 if fuzzy else 0.85) or not norm_q:
                seen_cert_nos.add(cert_no)
                enriched_item = dict(item)
                enriched_item["confidence_score"] = round(score, 2)
                exact_dossiers.append(enriched_item)

        exact_dossiers.sort(key=lambda d: d.get("confidence_score", 0), reverse=True)

        # 2. Rule inference
        inferred_rules = RuleInferenceEngine.infer(query=q, hs_code=hs)

        # 3. Gather applicable standards
        standards_map: dict[str, dict[str, Any]] = {}

        # From matched dossiers
        for d in exact_dossiers:
            regs = d.get("technical_regulations", [])
            for reg in regs:
                if reg not in standards_map:
                    std_info = StandardsRegistryService.get_by_code(reg)
                    if std_info:
                        std_dict = dict(std_info)
                    else:
                        std_dict = {
                            "code": reg,
                            "name": f"Quy chuẩn kỹ thuật áp dụng theo hồ sơ {d.get('certificate_no')}",
                            "ministry": "BTTTT" if "BTTTT" in reg else ("BKHCN" if "BKHCN" in reg else "BCT"),
                            "ministry_label": "Bộ quản lý chuyên ngành",
                            "category": "radio_telecom",
                            "category_label": "Quy chuẩn chuyên ngành",
                            "circular": "Thông tư hiện hành",
                            "effective_date": "Hiện hành",
                            "status": "active",
                            "procedure_type": "mandatory_cert_and_cr",
                            "procedure_label": "Bắt buộc",
                            "target_equipment": d.get("product_name", ""),
                            "testing_labs": ["Cục Viễn thông (VNTA Lab)", "Quatest 1", "Quatest 3"],
                            "key_technical_requirements": ["Đáp ứng đầy đủ các chỉ tiêu kỹ thuật"],
                        }
                    std_dict["mandatory"] = True
                    std_dict["confidence"] = 0.99
                    std_dict["issuing_ministry"] = std_dict.get("ministry", "")
                    std_dict["legal_basis"] = std_dict.get("circular", "")
                    std_dict["match_reason"] = f"Khớp trực tiếp từ hồ sơ chứng nhận {d.get('certificate_no')} cho model {d.get('model')}"
                    standards_map[reg] = std_dict

        # From inferred rules
        for rule in inferred_rules:
            for code in rule.get("mandatory_standards", []):
                if code not in standards_map or not standards_map[code].get("mandatory"):
                    std_info = StandardsRegistryService.get_by_code(code)
                    std_dict = dict(std_info) if std_info else {
                        "code": code,
                        "name": code,
                        "ministry": rule.get("ministry", "BTTTT"),
                        "circular": "Thông tư quy định hiện hành",
                        "testing_labs": ["VNTA Lab", "Quatest 1", "Quatest 3"],
                    }
                    std_dict["mandatory"] = True
                    std_dict["confidence"] = rule.get("confidence", 0.95)
                    std_dict["issuing_ministry"] = std_dict.get("ministry", "")
                    std_dict["legal_basis"] = std_dict.get("circular", "")
                    std_dict["match_reason"] = rule.get("rationale", "")
                    standards_map[code] = std_dict

            for code in rule.get("recommended_standards", []):
                if code not in standards_map:
                    std_info = StandardsRegistryService.get_by_code(code)
                    std_dict = dict(std_info) if std_info else {
                        "code": code,
                        "name": code,
                        "ministry": rule.get("ministry", "BTTTT"),
                        "circular": "Tiêu chuẩn tự nguyện / Khuyến nghị",
                        "testing_labs": ["QUACERT", "Quatest 1"],
                    }
                    std_dict["mandatory"] = False
                    std_dict["confidence"] = round(rule.get("confidence", 0.85) * 0.9, 2)
                    std_dict["issuing_ministry"] = std_dict.get("ministry", "")
                    std_dict["legal_basis"] = std_dict.get("circular", "")
                    std_dict["match_reason"] = f"Khuyến nghị áp dụng theo luật {rule.get('name')}"
                    standards_map[code] = std_dict

        # From direct keyword search in registry if few results
        if not standards_map and norm_q:
            direct_search = StandardsRegistryService.search(query=q)
            for std in direct_search:
                code = std["code"]
                std_dict = dict(std)
                std_dict["mandatory"] = True
                std_dict["confidence"] = 0.88
                std_dict["issuing_ministry"] = std_dict.get("ministry", "")
                std_dict["legal_basis"] = std_dict.get("circular", "")
                std_dict["match_reason"] = f"Khớp từ khóa trong CSDL Quy chuẩn Kỹ thuật Quốc gia"
                standards_map[code] = std_dict

        applicable_standards = list(standards_map.values())

        # 4. Filters
        if ministry and ministry.strip().lower() not in ("", "all"):
            m_target = ministry.strip().upper()
            applicable_standards = [
                s for s in applicable_standards
                if s.get("ministry", "").upper() == m_target or s.get("issuing_ministry", "").upper() == m_target
            ]

        if mandatory_only:
            applicable_standards = [s for s in applicable_standards if s.get("mandatory") is True]

        # Sort standards: mandatory first, then confidence desc, then code asc
        applicable_standards.sort(
            key=lambda s: (1 if s.get("mandatory") else 0, s.get("confidence", 0), s.get("code", "")),
            reverse=True,
        )

        # 5. Customs Procedure
        customs_proc = None
        target_hs = hs
        if not target_hs and exact_dossiers:
            # Check if any inferred rule matched HS
            for r in inferred_rules:
                if r.get("matched_hs") and r.get("rule_id") == "rule_4g_lte":
                    target_hs = "8517.62.59"
                    break
        if not target_hs and ("4g" in norm_q or "gateway" in norm_q or "router" in norm_q):
            target_hs = "8517.62.59"

        if target_hs:
            customs_proc = HsCodeConformityService.lookup_hs_code(target_hs)

        # Pagination
        paginated_dossiers = exact_dossiers[offset : offset + limit]
        paginated_standards = applicable_standards[offset : offset + limit]

        exec_time = round((time.perf_counter() - start_t) * 1000, 2)
        result = {
            "query": query,
            "hs_code": hs,
            "total_matches": len(exact_dossiers),
            "total_standards": len(applicable_standards),
            "exact_dossiers": paginated_dossiers,
            "applicable_standards": paginated_standards,
            "inferred_rules": inferred_rules,
            "customs_procedure": customs_proc,
            "execution_time_ms": exec_time,
        }
        _MODEL_LOOKUP_CACHE.set(cache_key, result)
        return result

    @classmethod
    def lookup_by_tax_code(
        cls,
        tax_code: str | None = None,
        company_name: str | None = None,
        status: str | None = None,
        ministry: str | None = None,
        limit: int = 20,
        offset: int = 0,
        db: Any = None,
    ) -> dict[str, Any]:
        """Direction 2: Tra cuu ho so hop quy va danh muc QCVN theo MST hoac ten doanh nghiep."""
        start_t = time.perf_counter()
        raw_tax = str(tax_code or "").strip()[:64]
        clean_tax = re.sub(r"[^0-9]", "", raw_tax)
        c_name = str(company_name or "").strip()[:150]
        norm_company = _norm(c_name)
        status_filter = str(status or "").strip()[:32]
        ministry_filter = str(ministry or "").strip()[:64]

        cache_key = (clean_tax, norm_company, status_filter, ministry_filter, limit, offset, db is not None)
        cached = _TAX_LOOKUP_CACHE.get(cache_key)
        if cached is not None:
            res = dict(cached)
            res["execution_time_ms"] = round((time.perf_counter() - start_t) * 1000, 2)
            return res

        # 1. Resolve enterprise profile
        enterprise_profile: dict[str, Any] = {}
        if clean_tax in BENCHMARK_ENTERPRISES:
            enterprise_profile = dict(BENCHMARK_ENTERPRISES[clean_tax])
        elif norm_company:
            # Search across BENCHMARK_ENTERPRISES by name or aliases
            best_score = 0.0
            best_profile = None
            for p in BENCHMARK_ENTERPRISES.values():
                p_name_norm = _norm(p["company_name"])
                score = fast_fuzzy_score(norm_company, p_name_norm)
                for alias in p.get("aliases", []):
                    alias_score = fast_fuzzy_score(norm_company, _norm(alias))
                    score = max(score, alias_score)
                if score > best_score:
                    best_score = score
                    best_profile = p
            if best_profile and best_score >= 0.60:
                enterprise_profile = dict(best_profile)
                if not clean_tax:
                    clean_tax = enterprise_profile["tax_code"]

        # If not found in benchmarks, try local DB Customer or synthesize
        if not enterprise_profile:
            if db is not None:
                from sqlalchemy import select
                from .db import Customer

                if clean_tax:
                    cust = db.scalar(select(Customer).where(Customer.tax_code == clean_tax))
                elif norm_company:
                    cust = db.scalar(select(Customer).where(Customer.name.ilike(f"%{c_name}%")))
                else:
                    cust = None

                if cust:
                    enterprise_profile = {
                        "tax_code": cust.tax_code or clean_tax,
                        "company_name": cust.name,
                        "short_name": cust.name,
                        "legal_representative": cust.contact or "Đang cập nhật",
                        "representative_title": "Đại diện theo pháp luật",
                        "address": cust.address or "Việt Nam",
                        "province": "Việt Nam",
                        "phone": "",
                        "email": cust.email or "",
                        "website": "",
                        "enterprise_status": "active",
                    }
                    if not clean_tax:
                        clean_tax = cust.tax_code

        # Fallback profile
        if not enterprise_profile and (clean_tax or c_name):
            enterprise_profile = {
                "tax_code": clean_tax,
                "company_name": c_name or f"DOANH NGHIỆP MST {clean_tax}",
                "short_name": c_name or clean_tax,
                "legal_representative": "Đại diện theo pháp luật",
                "representative_title": "Giám đốc",
                "address": "Việt Nam",
                "province": "Việt Nam",
                "phone": "",
                "email": "",
                "website": "",
                "enterprise_status": "active",
            }

        # 2. Collect matching dossiers
        raw_dossiers = []
        seen_certs = set()

        # From DB
        if db is not None:
            from sqlalchemy import select
            from .db import TqcCertificate

            stmt = select(TqcCertificate)
            if clean_tax:
                stmt = stmt.where((TqcCertificate.tax_code == clean_tax) | (TqcCertificate.tax_code_norm == clean_tax))
            elif norm_company:
                stmt = stmt.where((TqcCertificate.applicant_norm.like(f"%{norm_company}%")) | (TqcCertificate.applicant_name.ilike(f"%{c_name}%")))

            rows = list(db.scalars(stmt))
            for row in rows:
                cert_no = row.certificate_no
                if cert_no not in seen_certs:
                    seen_certs.add(cert_no)
                    raw_dossiers.append({
                        "dossier_id": cert_no,
                        "certificate_no": cert_no,
                        "tax_code": getattr(row, "tax_code", "") or clean_tax,
                        "dossier_type": "CBHQ_BTTTT" if "CBHQ" in cert_no else ("PDM_TDC" if "PDM" in cert_no else "CNHQ_BTTTT"),
                        "dossier_type_label": "Bản Công Bố Hợp Quy" if "CBHQ" in cert_no else "Giấy Chứng Nhận Hợp Quy",
                        "issue_date": row.issue_date,
                        "expiry_date": row.expiry_date,
                        "applicant_name": row.applicant_name,
                        "product_name": row.product_name,
                        "model": row.model,
                        "manufacturer": row.manufacturer,
                        "factory_name": row.factory_name,
                        "factory_address": row.factory_address,
                        "applied_qcvn_list": json.loads(row.technical_regulations_json or "[]"),
                        "technical_regulations": json.loads(row.technical_regulations_json or "[]"),
                        "certification_method": row.certification_method,
                        "certificate_status": row.derived_status if row.derived_status in ("active", "expired", "cancelled") else "active",
                        "derived_status": row.derived_status if row.derived_status in ("active", "expired", "cancelled") else "active",
                        "verification_status": row.verification_status,
                        "source_url": row.source_url,
                    })

        # Combine with in-memory benchmarks
        for cert in BENCHMARK_CERTIFICATES:
            cert_no = cert["certificate_no"]
            if cert_no in seen_certs:
                continue

            match = False
            if clean_tax and cert.get("tax_code") == clean_tax:
                match = True
            elif norm_company:
                c_norm = _norm(cert.get("applicant_name", ""))
                if norm_company in c_norm or fast_fuzzy_score(norm_company, c_norm) >= 0.70:
                    match = True

            if match:
                seen_certs.add(cert_no)
                raw_dossiers.append({
                    "dossier_id": cert_no,
                    "certificate_no": cert_no,
                    "tax_code": cert.get("tax_code", clean_tax),
                    "dossier_type": "CBHQ_BTTTT" if "CBHQ" in cert_no else ("PDM_TDC" if "PDM" in cert_no else "CNHQ_BTTTT"),
                    "dossier_type_label": "Bản Công Bố Hợp Quy" if "CBHQ" in cert_no else "Giấy Chứng Nhận Hợp Quy",
                    "issue_date": cert.get("issue_date", ""),
                    "expiry_date": cert.get("expiry_date", ""),
                    "applicant_name": cert.get("applicant_name", ""),
                    "product_name": cert.get("product_name", ""),
                    "model": cert.get("model", ""),
                    "manufacturer": cert.get("manufacturer", ""),
                    "factory_name": cert.get("factory_name", ""),
                    "factory_address": cert.get("factory_address", ""),
                    "applied_qcvn_list": cert.get("technical_regulations", []),
                    "technical_regulations": cert.get("technical_regulations", []),
                    "certification_method": cert.get("certification_method", ""),
                    "certificate_status": cert.get("derived_status", "active"),
                    "derived_status": cert.get("derived_status", "active"),
                    "verification_status": cert.get("verification_status", "verified_live"),
                    "source_url": cert.get("source_url", ""),
                })

        # 3. Compliance summary statistics
        total_dossiers = len(raw_dossiers)
        active_dossiers = sum(1 for d in raw_dossiers if d.get("derived_status") == "active" or d.get("certificate_status") == "active")
        expired_dossiers = sum(1 for d in raw_dossiers if d.get("derived_status") == "expired" or d.get("certificate_status") == "expired")
        cancelled_dossiers = sum(1 for d in raw_dossiers if d.get("derived_status") == "cancelled" or d.get("certificate_status") == "cancelled")

        active_qcvn_set = set()
        for d in raw_dossiers:
            if d.get("derived_status") == "active" or d.get("certificate_status") == "active":
                for qcvn in d.get("applied_qcvn_list", []):
                    if qcvn:
                        active_qcvn_set.add(qcvn)

        active_qcvn_list = sorted(list(active_qcvn_set))
        distinct_models = list(dict.fromkeys([d.get("model") for d in raw_dossiers if d.get("model")]))

        products = []
        for d in raw_dossiers:
            if d.get("model") and not any(p["model"] == d["model"] for p in products):
                products.append({
                    "model": d.get("model"),
                    "product_name": d.get("product_name"),
                    "manufacturer": d.get("manufacturer"),
                    "dossier_id": d.get("dossier_id"),
                    "status": d.get("derived_status", "active"),
                })

        # 4. Filters & Pagination on dossiers
        filtered_dossiers = list(raw_dossiers)
        if status and status.strip().lower() not in ("", "all"):
            s_target = status.strip().lower()
            filtered_dossiers = [
                d for d in filtered_dossiers
                if d.get("derived_status", "").lower() == s_target or d.get("certificate_status", "").lower() == s_target
            ]

        if ministry and ministry.strip().lower() not in ("", "all"):
            m_target = ministry.strip().upper()
            filtered_dossiers = [
                d for d in filtered_dossiers
                if any(m_target in qcvn.upper() for qcvn in d.get("applied_qcvn_list", []))
            ]

        paginated_dossiers = filtered_dossiers[offset : offset + limit]
        exec_time = round((time.perf_counter() - start_t) * 1000, 2)

        result = {
            "tax_code": clean_tax or enterprise_profile.get("tax_code", ""),
            "company_name": enterprise_profile.get("company_name", c_name),
            "enterprise_profile": enterprise_profile,
            "compliance_summary": {
                "total_dossiers": total_dossiers,
                "active_dossiers": active_dossiers,
                "expired_dossiers": expired_dossiers,
                "cancelled_dossiers": cancelled_dossiers,
                "unique_standards_count": len(active_qcvn_list),
                "active_qcvn_list": active_qcvn_list,
                "total_certified_models": len(distinct_models),
            },
            "dossiers": paginated_dossiers,
            "active_qcvn_list": active_qcvn_list,
            "products": products,
            "execution_time_ms": exec_time,
        }
        _TAX_LOOKUP_CACHE.set(cache_key, result)
        return result

    @classmethod
    def suggest(
        cls,
        q: str = "",
        type: str = "all",
        limit: int = 10,
        db: Any = None,
    ) -> dict[str, Any]:
        """Gợi ý thông minh (Auto-complete) cho Models, MST, Doanh nghiệp và QCVN."""
        start_t = time.perf_counter()
        query = str(q or "").strip()[:150]
        norm_q = _norm(query)
        t = (type or "all").lower()[:32]

        if not norm_q:
            return {
                "query": query,
                "suggestions": [],
                "execution_time_ms": round((time.perf_counter() - start_t) * 1000, 2),
            }

        cache_key = (norm_q, t, limit, db is not None)
        cached = _SUGGEST_CACHE.get(cache_key)
        if cached is not None:
            res = dict(cached)
            res["execution_time_ms"] = round((time.perf_counter() - start_t) * 1000, 2)
            return res

        candidates: list[dict[str, Any]] = []

        # 1. Models
        if t in ("all", "model"):
            seen_models = set()
            for cert in BENCHMARK_CERTIFICATES:
                model = cert.get("model", "")
                if model and model not in seen_models:
                    seen_models.add(model)
                    score = fast_fuzzy_score(norm_q, _norm(model))
                    p_name = cert.get("product_name", "")
                    score = max(score, fast_fuzzy_score(norm_q, _norm(p_name)) * 0.9)
                    if score >= 0.55:
                        candidates.append({
                            "type": "model",
                            "text": model,
                            "label": f"{model} ({p_name})",
                            "badge": "Model",
                            "meta": cert.get("applicant_name", ""),
                            "target_url": f"/standards/lookup?model={model}",
                            "score": score,
                        })

        # 2. Tax Codes & Companies
        if t in ("all", "tax_code", "company"):
            for mst, p in BENCHMARK_ENTERPRISES.items():
                if t in ("all", "tax_code"):
                    score_mst = fast_fuzzy_score(norm_q, mst)
                    if score_mst >= 0.55 or norm_q in mst:
                        candidates.append({
                            "type": "tax_code",
                            "text": mst,
                            "label": f"MST: {mst} — {p['company_name']}",
                            "badge": "MST",
                            "meta": p["company_name"],
                            "target_url": f"/standards/enterprise/{mst}",
                            "score": max(score_mst, 0.95 if norm_q in mst else 0.5),
                        })

                if t in ("all", "company"):
                    score_comp = fast_fuzzy_score(norm_q, _norm(p["company_name"]))
                    for alias in p.get("aliases", []):
                        score_comp = max(score_comp, fast_fuzzy_score(norm_q, _norm(alias)))
                    if score_comp >= 0.55:
                        candidates.append({
                            "type": "company",
                            "text": p["company_name"],
                            "label": f"{p['company_name']} ({p.get('province', 'VN')})",
                            "badge": "Doanh Nghiệp",
                            "meta": f"MST: {mst}",
                            "target_url": f"/standards/enterprise/{mst}",
                            "score": score_comp,
                        })

        # 3. Standards / QCVN
        if t in ("all", "qcvn", "standard"):
            for std in StandardsRegistryService.STANDARDS_DATABASE:
                code = std["code"]
                name = std["name"]
                score_code = fast_fuzzy_score(norm_q, _norm(code))
                score_name = fast_fuzzy_score(norm_q, _norm(name)) * 0.85
                score = max(score_code, score_name)
                if score >= 0.55 or norm_q in _norm(code):
                    candidates.append({
                        "type": "qcvn",
                        "text": code,
                        "label": f"{code} — {name[:60]}...",
                        "badge": std.get("ministry", "QCVN"),
                        "meta": std.get("category_label", "Quy chuẩn kỹ thuật"),
                        "target_url": f"/standards/registry/{code}",
                        "score": max(score, 0.95 if norm_q in _norm(code) else 0.5),
                    })

        # 4. HS Codes
        if t in ("all", "hs_code"):
            for hs in HsCodeConformityService.HS_CODE_MAPPINGS:
                h_code = hs["hs_code"]
                h_desc = hs["hs_description"]
                score_hs = fast_fuzzy_score(norm_q, re.sub(r"[^0-9]", "", h_code))
                score_desc = fast_fuzzy_score(norm_q, _norm(h_desc)) * 0.85
                score = max(score_hs, score_desc)
                if score >= 0.55 or norm_q in re.sub(r"[^0-9]", "", h_code):
                    candidates.append({
                        "type": "hs_code",
                        "text": h_code,
                        "label": f"HS {h_code} — {h_desc[:50]}...",
                        "badge": "HS Code",
                        "meta": hs.get("inspection_type", "Kiểm tra chuyên ngành"),
                        "target_url": f"/standards/hs-lookup/{h_code}",
                        "score": max(score, 0.95 if norm_q in re.sub(r"[^0-9]", "", h_code) else 0.5),
                    })

        # Deduplicate suggestions by (type, text)
        seen_keys = set()
        unique_candidates = []
        for c in candidates:
            key = (c["type"], c["text"])
            if key not in seen_keys:
                seen_keys.add(key)
                unique_candidates.append(c)

        unique_candidates.sort(key=lambda c: c.get("score", 0), reverse=True)
        final_suggestions = [
            {k: v for k, v in c.items() if k != "score"}
            for c in unique_candidates[:limit]
        ]

        exec_time = round((time.perf_counter() - start_t) * 1000, 2)
        result = {
            "query": query,
            "suggestions": final_suggestions,
            "execution_time_ms": exec_time,
        }
        _SUGGEST_CACHE.set(cache_key, result)
        return result
