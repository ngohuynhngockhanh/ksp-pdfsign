---
name: brother-a4-print
description: In PDF khổ A4 từ xa (1 mặt / 2 mặt tự động Duplex, nhiều bản, chọn trang, khay nạp tay) ra máy in laser Brother HL-L2320D series gắn trên máy Windows DESKTOP-O3VN908 (192.168.1.12) qua SumatraPDF CLI, REST API ksp-pdfsign hoặc CLI script.
---

# Brother HL-L2320D — In PDF Khổ A4 Từ Xa (`ksp-pdfsign`)

Skill này vận hành máy in laser trắng đen **Brother HL-L2320D** gắn qua USB trên máy Windows **`DESKTOP-O3VN908`** (`Administrator@192.168.1.12`), tích hợp trực tiếp vào kho hồ sơ `ksp-pdfsign`.

## 1. Thông Số Phần Cứng & Cấu Hình Chuẩn Trên Windows
- **Máy Windows:** `DESKTOP-O3VN908` (`192.168.1.12`, tự dò IP qua `host_discovery.resolve_windows_host`)
- **Tên máy in Windows:** `Brother HL-L2320D series` (Share LAN: `\\192.168.1.12\BrotherHL-L2320D`)
- **Cổng USB:** `USB003` (`USB\VID_04F9&PID_0062\E73793G8N504333`)
- **Driver:** `Brother Laser Type1 Class Driver` (`600×600 dpi`, `PaperSize=A4`, `Collate=True`, `Config:DuplexUnit=TRUE`)
- **Engine in CLI trên Windows:** `C:\ksp\SumatraPDF.exe` (SumatraPDF 3.5.2 portable, hỗ trợ `-silent -exit-when-done -print-to ... -print-settings ...`; fallback sang `FoxitReader.exe /t` nếu thiếu).
- **Khả năng hỗ trợ:**
  - Khổ giấy: `A4` (mặc định), `A5`, `A6`, `B5`, `Letter`, `Legal`
  - Mặt in (`duplex`): `simplex` (1 mặt), `long` / `duplexlong` (2 mặt lật cạnh dài — chuẩn đóng gáy dọc), `short` / `duplexshort` (2 mặt lật cạnh ngắn)
  - Số bản (`copies`): `1`–`50`
  - Khoảng trang (`page_range`): `'1-3'`, `'1,3,5-7'`, `'odd'`, `'even'`
  - Khay giấy (`tray`): `auto`, `tray1` (hộc chính), `manual` (khe nạp tay phía trước cho bìa cứng/decal A4)

---

## 2. Cách Sử Dụng Nhanh

### 2.1. CLI (`scripts/print_a4_brother.py`)
```bash
# Kiểm tra trạng thái máy in trên Windows
./scripts/print_a4_brother.py --status

# Xem hàng đợi in
./scripts/print_a4_brother.py --jobs

# In hồ sơ KSP PDFSign theo ID (mặc định ưu tiên bản đã ký số, khổ A4, 1 mặt)
./scripts/print_a4_brother.py --doc-id 464

# In 2 bản, in 2 mặt tự động (lật cạnh dài)
./scripts/print_a4_brother.py --doc-id 464 --duplex long --copies 2

# In 1 file PDF bất kỳ trên máy Linux (chọn trang 1-2, khay nạp tay)
./scripts/print_a4_brother.py --file reports/Minh_Chung_Xuat_Xu_Viet_Nam_iNut_Data_Logger_v1.1_Rockchip_DA_KY.pdf \
  --duplex long --pages 1-2 --tray tray1

# Chạy thử không tốn giấy
./scripts/print_a4_brother.py --doc-id 464 --duplex long --dry-run

# Hủy toàn bộ lệnh bị treo
./scripts/print_a4_brother.py --cancel-jobs
```

### 2.2. REST API (`http://127.0.0.1:2032`, xác thực Admin JWT hoặc loopback token `/home/ksp/.config/inut-crm/inut-crm.token`)
- **Kiểm tra danh sách máy in:** `GET /api/brother/printers`
- **Xem hàng đợi in:** `GET /api/brother/jobs`
- **Hủy lệnh bị treo:** `POST /api/brother/jobs/cancel`
- **In hồ sơ KSP theo `doc_pk`:** `POST /api/documents/{doc_pk}/print` (hoặc `POST /api/brother/print-document/{doc_pk}`)
  ```bash
  printf 'header = "Authorization: Bearer %s"\n' "$(</home/ksp/.config/inut-crm/inut-crm.token)" | \
    curl -sS --config - -X POST http://127.0.0.1:2032/api/documents/464/print \
      -H "Content-Type: application/json" \
      -d '{"paper_size":"A4","duplex":"long","copies":1,"prefer_signed":true}'
  ```
- **Upload trực tiếp file PDF để in A4:** `POST /api/brother/print-upload` (multipart form `file`, `duplex`, `copies`, `page_range`, `tray`, `dry_run`)

---

## 3. Quy Tắc An Toàn Khi Vận Hành
- Chỉ gửi lệnh in thật khi người dùng yêu cầu in rõ ràng; khi test/kiểm chứng code hãy dùng `dry_run=True` (`--dry-run`) để tránh lãng phí giấy.
- File PDF tạm copy sang `C:\ksp\a4_*.pdf` trên Windows sẽ tự động được xóa sau khi SumatraPDF spool xong.
- Luôn ưu tiên bản đã ký số (`prefer_signed=True`) khi in từ kho `ksp-pdfsign`, trừ khi người dùng yêu cầu in bản gốc (`--unsigned`).
