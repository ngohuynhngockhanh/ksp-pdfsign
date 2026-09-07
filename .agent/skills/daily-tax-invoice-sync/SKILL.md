---
name: daily-tax-invoice-sync
description: Tự động giải Captcha SVG, đăng nhập Cổng Hóa đơn điện tử Tổng cục Thuế (hoadondientu.gdt.gov.vn), đồng bộ hóa đơn mua vào/bán ra mỗi ngày, bóc tách XML/HTML bản thể hiện pháp lý và đối soát CSDL KSP kèm thông báo Telegram.
---

# 📑 KSP Daily Tax Invoice Sync (Đồng Bộ Hóa Đơn Thuế Tự Động Mỗi Ngày)

Skill này cung cấp quy trình tự động hóa 100% đối soát và nạp hóa đơn điện tử trực tiếp từ **Cổng Hóa đơn điện tử của Tổng cục Thuế** (`hoadondientu.gdt.gov.vn`) vào hệ thống quản trị nội bộ KSP iNut.

## 🌐 Cổng dịch vụ Thuế
- **URL**: `https://hoadondientu.gdt.gov.vn`
- **Mã số thuế**: `4401053694` (Công ty Cổ phần Đầu tư và Phát triển Công nghệ INUT)

## ⚙️ Quy trình xử lý tự động
1. **Kiểm tra phiên đăng nhập (JWT Token)**:
   - Nếu token còn hạn (`tax.check_token` trả về `True`) -> Tiếp tục sử dụng ngay.
   - Nếu token hết hạn -> Kích hoạt cơ chế Vượt Captcha tự động.
2. **Vượt Captcha SVG thông minh**:
   - Tải file ảnh vector SVG từ `/api/captcha`.
   - Thuật toán bóc tách DOM loại bỏ toàn bộ các đường cong/đường thẳng gây nhiễu (`fill="none"` / `stroke`).
   - Rasterize sang PNG độ phân giải cao và giải mã bằng `ddddocr`.
   - Xác thực tại `/api/security-taxpayer/authenticate` và mã hóa lưu token mới vào CSDL `AppSetting`.
3. **Thu thập & Bóc tách Hóa đơn**:
   - **Hóa đơn mua vào có mã CQT**: `/api/query/invoices/purchase`
   - **Hóa đơn mua vào không mã / Máy tính tiền**: `/api/sco-query/invoices/purchase`
   - **Hóa đơn bán ra**: `/api/query/invoices/sold`
4. **Đối soát & Nạp dữ liệu tự động**:
   - So sánh danh sách hóa đơn trên cổng với CSDL `ksp.db`.
   - Tự động tạo bản ghi **Phiếu mua hàng (Purchase Draft)** cho các hóa đơn mua mới phát sinh.
   - Tải file **XML gốc** (bản có giá trị pháp lý) và **HTML bản thể hiện** lưu trữ an toàn trong kho `storage`.
5. **Cảnh báo & Báo cáo Telegram**:
   - Gửi tin nhắn tóm tắt số lượng HĐ mua mới nạp, HĐ bán ra và tình trạng đối chiếu qua Telegram Bot.

## 🚀 Cách sử dụng từ Python SDK / Codebase
```python
from app.db import get_session
from app.tax_auto_sync import sync_daily_tax_invoices

for db in get_session():
    # Đồng bộ 7 ngày gần nhất, tự động nạp HĐ và bắn Telegram
    result = sync_daily_tax_invoices(db, days_back=7, do_import=True, send_telegram=True)
    print("Kết quả đồng bộ:", result)
```

## 📡 REST API Endpoints
- `POST /api/tax/auto-sync?days_back=7&do_import=true&send_telegram=true`
- `GET /api/tax/auto-sync/status`
