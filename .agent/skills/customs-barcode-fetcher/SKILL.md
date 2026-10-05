---
name: customs-barcode-fetcher
description: Tự động tra cứu, giải Captcha và tải Mã vạch Hải quan (Bảng kê phương tiện chứa hàng) từ Cổng thông tin Tổng cục Hải quan (pus1.customs.gov.vn), chuyển đổi sang PDF A4 chuẩn và đồng bộ vào CSDL KSP kèm Google Drive.
---

# 📦 KSP Customs Barcode Fetcher (Tải Mã Vạch Hải Quan Tự Động)

Skill này cung cấp khả năng tự động hóa 100% quy trình lấy **Mã Vạch Hải Quan** (Bảng kê mã vạch phương tiện chứa hàng đủ điều kiện qua khu vực giám sát hải quan) cho các tờ khai nhập khẩu / xuất khẩu.

## 🌐 Cổng dịch vụ Hải quan
- **URL**: `https://pus1.customs.gov.vn/BarcodeContainer/BarcodeContainer.aspx`

## ⚙️ Quy trình xử lý tự động
1. **Thu thập thông tin tờ khai**:
   - **Mã doanh nghiệp (MST)**: Mặc định `4401053694` (hoặc MST theo tờ khai).
   - **Số tờ khai**: 12 chữ số (ví dụ: `108557295010`).
   - **Mã Hải quan**: 4 ký tự đầu ở địa điểm lưu kho hoặc mã chi cục tiếp nhận (ví dụ: `06DS` cho Chuyển phát nhanh HCM).
   - **Ngày tờ khai**: Ngày đăng ký định dạng `DD/MM/YYYY` (ví dụ: `23/08/2026`).
2. **Vượt Captcha tự động**:
   - Tải ảnh captcha từ `GenerateCaptcha.aspx`.
   - Sử dụng thư viện `ddddocr` với tỷ lệ chính xác >98%.
   - Cơ chế tự động thử lại (Retry loop tối đa 10 lần).
   - Dự phòng: Tự động gửi ảnh Captcha qua Telegram Bot nếu có cấu hình `TELEGRAM_BOT_TOKEN`.
3. **Kết xuất & Định dạng PDF (Chuẩn Phông Chữ Times New Roman)**:
   - Trích xuất bảng kết quả và ảnh Barcode 128 base64.
   - **Quy chuẩn Font chữ**: Bắt buộc thiết lập `font-family: 'Times New Roman', 'Times', 'Liberation Serif', 'DejaVu Serif', serif;` cho toàn bộ tài liệu (body, table, th, td, labels) theo chuẩn văn bản hành chính và mẫu in mã vạch của Tổng cục Hải quan. Tuyệt đối không để phông mặc định fallback không có chân gây lệch chuẩn, đảm bảo bản in ra sắc nét, trang trọng, đồng nhất 100% với bản in từ máy tính/trình duyệt.
   - Định dạng CSS chuẩn khổ A4 Portrait in sắc nét qua `WeasyPrint`.
   - Lưu vào kho lưu trữ nội bộ `ksp-pdfsign` (`/api/inv/customs-drive/documents/...`).
4. **Đồng bộ Google Drive**:
   - Tự động upload file `MaVach_{so_to_khai}.pdf` vào đúng thư mục Google Drive của lô hàng qua `rclone`.
   - Tự động tích xanh ô `barcode` trong checklist hồ sơ hải quan.

## 🚀 Cách sử dụng từ Python SDK / Codebase
```python
from app.db import get_session
from app.customs_barcode import fetch_customs_barcode_pdf, fetch_and_sync_customs_barcode

# Cách 1: Tải PDF trực tiếp
pdf_bytes, filename, meta = fetch_customs_barcode_pdf(
    mst="4401053694",
    so_to_khai="108557295010",
    ma_hq="06DS",
    ngay_to_khai="23/08/2026",
)

# Cách 2: Tự động tra cứu theo ID tờ khai và sync Google Drive
for db in get_session():
    result = fetch_and_sync_customs_barcode(db, decl_id=4)
    print("Ket qua:", result)
```

## 📡 REST API Endpoints
- `POST /api/inv/customs-drive/declarations/{decl_id}/fetch-barcode`
- `POST /api/inv/customs-drive/folders/{folder_id}/fetch-barcode`
