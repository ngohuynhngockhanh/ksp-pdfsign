"""Module tinh toan bieu gia va boc tach khoi luong giai phap Billiards (iNut BilliardLive).

Chuan hoa theo logic thuc te:
- Goi I: Lap dat camera & ha tang thi cong
  + Camera KBVision A5W (5MPixel Full Color): 550.000d / ban
  + POE Splitter 5V DC cho camera: 65.000d / ban
  + He thong Hub / Switch PoE Gigabit:
    * Hub PoE 8 Port 1Gb (toi da 8 cam): 1.100.000d / cai
    * Hub PoE 4 Port 1Gb (toi da 4 cam, re hon 25% so voi hub 8 port): 825.000d / cai
    * Quy tac phan bo hub PoE toi uu cho N camera:
      - q = N // 8, r = N % 8
      - Neu r == 0: dung q hub 8 port
      - Neu 1 <= r <= 4: dung q hub 8 port + 1 hub 4 port (825k)
      - Neu r > 4: dung (q + 1) hub 8 port
  + Cap mang LAN Cat6: 10.000d / met (du toan ~35m/ban)
  + Vat tu phu thi cong: 500.000d / goi
  + Cong lap dat & can goc: 300.000d / ban
- Goi II: Cong nghe Check VAR & Livestream (Phan mem & Thiet bi so hoa)
  + Thiet bi Stream Model C1 (xu ly, so hoa camera, QR cat cam, livestream, ty so): 14.790.000d (giam 5% con 14.050.500d)
  + Goi giam gia MKT kich cau mo quan: -885.500d
- Quy dinh thue & bao hanh:
  + Don gia chua bao gom VAT 8%
  + Thiet bi bao hanh 1 nam 1 doi 1, nam thu 2 tro di phi dich vu 300.000d/lan
  + Bo nho bao hanh 3 nam
  + Khong ky so dien tu, xuat PDF sach gui truc tiep cho khach hang.
"""
from __future__ import annotations
import math
from typing import Any

PRICE_CAMERA_A5W = 550_000
PRICE_POE_SPLITTER = 65_000
PRICE_HUB_POE_8PORT = 1_100_000
PRICE_HUB_POE_4PORT = round(PRICE_HUB_POE_8PORT * 0.75)  # 825_000 (re hon 25%)
PRICE_LAN_CABLE_PER_M = 10_000
CABLE_METERS_PER_TABLE = 35
PRICE_ACCESSORIES = 500_000
PRICE_LABOR_PER_TABLE = 300_000

PRICE_STREAM_C1 = 14_790_000
DISCOUNT_PCT_C1 = 5  # 5%
VOUCHER_MKT = 885_500


def calculate_poe_hubs(num_cameras: int) -> list[dict[str, Any]]:
    """Phan bo so luong Hub PoE 8 port va 4 port theo quy tac toi uu chi phi.

    - 1 hub 8 port cap toi da 8 cam (1.100.000d)
    - 1 hub 4 port cap toi da 4 cam (825.000d, re hon 25%)
    - r = N % 8:
      + r == 0: chi dung hub 8 port
      + 1 <= r <= 4: dung hub 4 port cho phan du
      + r > 4: dung them 1 hub 8 port
    """
    if num_cameras <= 0:
        return []

    q = num_cameras // 8
    r = num_cameras % 8

    hubs = []
    if q == 0 and r <= 4:
        # Chi can 1 hub 4 port
        hubs.append({
            "ten": "Switch PoE 4 Port 1Gb Gigabit (AI Watchdog)",
            "dien_giai": f"Cấp nguồn kiêm mạng cho {num_cameras} camera bàn bida (tối đa 4 port PoE 1Gb + uplink). Công suất 65W, chống sét 4KV, AI Watchdog tự khởi động lại port khi thiết bị treo.",
            "dvt": "Cái",
            "so_luong": 1,
            "don_gia": PRICE_HUB_POE_4PORT,
            "giam_gia": "",
            "thanh_tien": PRICE_HUB_POE_4PORT,
            "note": "Bảo hành 1 năm",
        })
        return hubs

    if q > 0:
        hubs.append({
            "ten": f"Switch PoE 8 Port 1Gb Gigabit (AI Watchdog)",
            "dien_giai": f"Switch POE 8 cổng 1Gb + 2 uplink 1Gb + 2 SFP (GPOE408), cấp nguồn kiêm mạng cho {min(num_cameras, q * 8)} camera. Công suất 120W, AI Watchdog tự khởi động lại port khi camera treo.",
            "dvt": "Cái",
            "so_luong": q,
            "don_gia": PRICE_HUB_POE_8PORT,
            "giam_gia": "",
            "thanh_tien": q * PRICE_HUB_POE_8PORT,
            "note": "Bảo hành 1 năm",
        })

    if 1 <= r <= 4:
        hubs.append({
            "ten": "Switch PoE 4 Port 1Gb Gigabit (AI Watchdog)",
            "dien_giai": f"Switch POE 4 cổng 1Gb mở rộng cấp nguồn cho {r} camera còn lại (giá tiết kiệm hơn 25% so với hub 8 port).",
            "dvt": "Cái",
            "so_luong": 1,
            "don_gia": PRICE_HUB_POE_4PORT,
            "giam_gia": "",
            "thanh_tien": PRICE_HUB_POE_4PORT,
            "note": "Bảo hành 1 năm",
        })
    elif r > 4:
        # Neu phan du > 4 cam, hub 4 port khong du nen phai them 1 hub 8 port nua
        hubs.append({
            "ten": "Switch PoE 8 Port 1Gb Gigabit (AI Watchdog - Mở rộng)",
            "dien_giai": f"Switch POE 8 cổng 1Gb bổ sung cấp nguồn cho {r} camera còn lại.",
            "dvt": "Cái",
            "so_luong": 1,
            "don_gia": PRICE_HUB_POE_8PORT,
            "giam_gia": "",
            "thanh_tien": PRICE_HUB_POE_8PORT,
            "note": "Bảo hành 1 năm",
        })

    return hubs


def build_billiard_quote_data(
    num_tables: int,
    client_name: str = "",
    contact_person: str = "",
    phone: str = "",
    address: str = "",
    include_software: bool = True,
    custom_cable_meters: int | None = None,
    stream_boxes_count: int | None = None,
    date_display: str = "11/10/2026",
) -> dict[str, Any]:
    """Xay dung du lieu bao gia Billiards hoan chinh theo dung so ban va yeu cau."""
    num_cameras = num_tables
    client_display = client_name.strip() or f"CLB Billiards ({num_tables} bàn)"

    # --- GOI I: LAP DAT CAMERA & HA TANG ---
    items_g1: list[dict[str, Any]] = [
        {
            "ten": "Camera KBVision A5W",
            "dien_giai": "• 5MP cảm biến CMOS 1/2.8”, Full color 25/30fps@5MP, chống ngược sáng DWDR, 3DNR\n• Đèn LED trợ sáng ban đêm 30m, đàm thoại 2 chiều, phân biệt người SMD, khe cắm thẻ nhớ 256GB",
            "dvt": "Cái",
            "so_luong": num_cameras,
            "don_gia": PRICE_CAMERA_A5W,
            "giam_gia": "",
            "thanh_tien": num_cameras * PRICE_CAMERA_A5W,
            "note": "1 đổi 1 trong 1 năm",
        },
        {
            "ten": "POE Splitter 5V DC cho camera",
            "dien_giai": "Chuyển cổng POE LAN thành Data LAN + Nguồn 5V camera",
            "dvt": "Cái",
            "so_luong": num_cameras,
            "don_gia": PRICE_POE_SPLITTER,
            "giam_gia": "",
            "thanh_tien": num_cameras * PRICE_POE_SPLITTER,
            "note": "",
        },
    ]

    # He thong Hub PoE theo thuat toan linh hoat
    hubs = calculate_poe_hubs(num_cameras)
    items_g1.extend(hubs)

    # Cap mang LAN
    cable_m = custom_cable_meters if custom_cable_meters is not None else (num_cameras * CABLE_METERS_PER_TABLE)
    items_g1.append({
        "ten": "Cáp mạng lan Cat6",
        "dien_giai": f"10k/mét, tính theo khối lượng thi công thực tế tại quán (~{cable_m}m)",
        "dvt": "Mét",
        "so_luong": cable_m,
        "don_gia": PRICE_LAN_CABLE_PER_M,
        "giam_gia": "",
        "thanh_tien": cable_m * PRICE_LAN_CABLE_PER_M,
        "note": "Tính theo thực tế",
    })

    # Vat tu phu
    items_g1.append({
        "ten": "Vật tư phụ",
        "dien_giai": "Băng keo, hạt mạng RJ45, ốc vít, tắc kê, ống ruột gà bảo vệ dây",
        "dvt": "Gói",
        "so_luong": 1,
        "don_gia": PRICE_ACCESSORIES,
        "giam_gia": "",
        "thanh_tien": PRICE_ACCESSORIES,
        "note": "Trọn gói",
    })

    # Cong lap
    labor_cost = num_cameras * PRICE_LABOR_PER_TABLE
    items_g1.append({
        "ten": "Công lắp",
        "dien_giai": f"Thi công kéo cáp, gắn thiết bị, căn góc camera chuẩn từng bàn bida ({num_cameras} bàn)",
        "dvt": "Cái",
        "so_luong": num_cameras,
        "don_gia": PRICE_LABOR_PER_TABLE,
        "giam_gia": "",
        "thanh_tien": labor_cost,
        "note": "Căn chỉnh hoàn thiện",
    })

    total_g1 = sum(it["thanh_tien"] for it in items_g1)

    # --- GOI II: CONG NGHE CHECK VAR & LIVESTREAM ---
    items_g2: list[dict[str, Any]] = []
    total_g2 = 0
    if include_software:
        # So hop stream C1 (moi hop C1 xu ly 8-16 kenh tuy cau hinh)
        n_c1 = stream_boxes_count if stream_boxes_count is not None else max(1, math.ceil(num_cameras / 16))
        c1_price_raw = PRICE_STREAM_C1 * n_c1
        c1_discount_amount = round(c1_price_raw * (DISCOUNT_PCT_C1 / 100))
        c1_price_final = c1_price_raw - c1_discount_amount

        items_g2.append({
            "ten": f"Thiết bị Stream Model C1 & Bản quyền Phần mềm Billiard Live ({'Hệ ' + str(num_cameras) + ' kênh' if num_cameras > 8 else 'Hệ 8 kênh'})",
            "dien_giai": f"Xử lý, lưu trữ và số hóa đồng thời {num_cameras} kênh Camera bàn bida Full HD-2K-4K, CPU ARM Multi-core, RAM tốc độ cao.\nTính năng phần mềm Billiard Live:\n- Cắt cam thông minh: Xuất mã QR tại bàn, khách quét mã xem và tải video clip về điện thoại không cần cài App\n- Check VAR chuyên nghiệp: Xem lại tình huống bi gây tranh cãi ngay tức thì trên màn hình lớn qua tính năng tua chậm\n- Livestream đa nền tảng: Phát trực tiếp luồng camera bàn lên Facebook, Fanpage, YouTube, hoặc tích hợp OBS\n- Hệ thống Dashboard quản trị quán, tích hợp bảng tỷ số trận đấu và quảng cáo khuyến mãi của quán",
            "dvt": "Bộ",
            "so_luong": n_c1,
            "don_gia": PRICE_STREAM_C1,
            "giam_gia": f"{DISCOUNT_PCT_C1}%",
            "thanh_tien": c1_price_final,
            "note": "Bảo hành 1 năm 1 đổi 1\nHỗ trợ trả góp 3-6 tháng",
        })

        items_g2.append({
            "ten": "Gói giảm giá MKT",
            "dien_giai": "Chính sách trợ giá khai trương & kích cầu truyền thông cho CLB Billiards",
            "dvt": "Gói",
            "so_luong": 1,
            "don_gia": -VOUCHER_MKT,
            "giam_gia": "",
            "thanh_tien": -VOUCHER_MKT,
            "note": "Trừ trực tiếp",
        })

        total_g2 = sum(it["thanh_tien"] for it in items_g2)

    grand_total = total_g1 + total_g2

    # --- QUY TRINH THANH TOAN ---
    if include_software:
        # Chia 5 hoac 6 dot tra gop
        p1 = round(grand_total * 0.3)
        p2 = round(grand_total * 0.25)
        rem = grand_total - p1 - p2
        p3 = round(rem / 3)
        p4 = round(rem / 3)
        p5 = rem - p3 - p4
        payment_schedule = [
            {"title": "Đợt 1: Khi ký xác nhận & chuẩn bị thiết bị (30%):", "amount": p1},
            {"title": "Đợt 2: Nghiệm thu lắp đặt phần cứng camera (25%):", "amount": p2},
            {"title": "Đợt 3: Bàn giao công nghệ Check VAR & tháng thứ 1:", "amount": p3},
            {"title": "Đợt 4: Hỗ trợ trả góp tháng thứ 2:", "amount": p4},
            {"title": "Đợt 5: Hỗ trợ trả góp tháng thứ 3 & tất toán:", "amount": p5},
        ]
    else:
        # Khong phan mem: Chia 2 dot
        p1 = round(grand_total * 0.5)
        p2 = grand_total - p1
        payment_schedule = [
            {"title": "Đợt 1 (Tạm ứng thi công khi chuyển thiết bị và kéo cáp 50%):", "amount": p1},
            {"title": "Đợt 2 (Nghiệm thu bàn giao luồng camera hoạt động ổn định 50%):", "amount": p2},
        ]

    title = (
        f"Báo giá giải pháp Tải clip và Livestream Camera ({num_tables} bàn)"
        if include_software
        else f"Báo giá giải pháp lắp đặt Camera bàn bida ({num_tables} bàn - Không phần mềm)"
    )

    return {
        "title": title,
        "ben_a": {
            "company": "CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT",
            "phone": "0972.768.491",
            "rep": "Ngô Huỳnh Ngọc Khánh",
        },
        "ben_b": {
            "name": client_display,
            "contact_person": contact_person or "Ban Quản lý CLB",
            "phone": phone or "Đang cập nhật",
            "address": address or "",
        },
        "ngay_display": date_display,
        "items_group_1": items_g1,
        "total_group_1": total_g1,
        "has_group_2": include_software,
        "items_group_2": items_g2,
        "total_group_2": total_g2,
        "grand_total": grand_total,
        "payment_schedule": payment_schedule,
    }
