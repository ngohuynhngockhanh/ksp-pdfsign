# 📘 KSP Operations Suite / iNut PDFSigner — Cẩm Nang Tri Thức Kỹ Thuật (OMP Playbook)

> **Tài liệu hướng dẫn kỹ thuật dành cho Oh My Pi (OMP) và Kỹ sư phát triển**  
> Bản quyền: CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT (MST: `4401053694`)  
> Cập nhật lần cuối: 07/09/2026

---

## ⚡ 1. TRA CỨU NHANH (QUICK REFERENCE CHEAT SHEET)

| Hạng mục | Giá trị / Đường dẫn | Ghi chú |
|---|---|---|
| **Máy Windows cắm Token** | Hostname: `DESKTOP-2022PHR` (Mặc định: `192.168.1.10`) | Đã cài OpenSSH Server, SSH key: `~/.ssh/id_ed25519` |
| **USB Token Doanh nghiệp** | **WIN-CA / LCS-CA** (MST: `4401053694`) | Thumbprint: `6616B8A61F228D0EAFF8AAF5F44F3ECD660DD8CD` |
| **Mã PIN Token** | **`12345678`** | Tự động nạp qua `SecureString` + `NoPrompt`, không tương tác |
| **Máy in nhiệt SPX** | **TP732H** (gắn tại máy Windows `192.168.1.10`) | In tự động qua Foxit Reader CLI / Tỉ Lệ Vàng 65% |
| **CSDL Chính** | SQLite: `backend/data/ksp.db` (Quyền: `0600`) | WAL mode, tự động migrate cột trong `_ensure_columns()` |
| **Kho tệp nhị phân** | `backend/data/docs/{doc_id}.pdf` (Quyền: `0700`) | Định danh bằng UUID hex, bảo vệ chống path traversal |
| **Máy chủ SMB NAS** | `172.32.0.100` / Share: `share` | Sao lưu 1 chiều: CSDL nén gzip (02:30), file HĐ mua (02:45) |
| **FRPC Tunnel / Domain** | `https://ksp-pdf-signer.p2p.inut.io.vn` | Local port 2032 → FRPS `p2p.inut.io.vn:7008` |
| **Môi trường Python** | `backend/.venv/bin/python3` | Python 3.12.3 kèm pyHanko, WeasyPrint, ddddocr |

---

## 🔑 2. CƠ CHẾ KÝ SỐ USB TOKEN WIN-CA & AUTO-DISCOVERY

### 2.1. Tự động dò IP động qua Nmap (`backend/app/host_discovery.py`)
Khi máy Windows cắm Token đổi IP do mạng DHCP:
```python
from app.host_discovery import resolve_windows_host

# Tự động kiểm tra port 22; nếu chết sẽ quét Nmap tìm host 'DESKTOP-2022PHR'
host = resolve_windows_host(settings.agent_default_ip)
```
- **CLI quét bằng tay & cập nhật `.env`**:
  ```bash
  # Kiểm tra kết nối
  ./scripts/discover_windows_host.py

  # Cưỡng bức quét và ghi đè IP mới vào .env
  ./scripts/discover_windows_host.py --force --update-env
  ```

### 2.2. Luồng ký số PAdES chuẩn pháp lý (`backend/app/signing.py` & `win_ssh.py`)
- Chuẩn ký: **PAdES Incremental Update** (bảo toàn cấu trúc gốc và các chữ ký trước đó).
- Ký từ xa: Chỉ băm **SHA-256 hash** gửi sang máy Windows, PDF gốc không bao giờ rời server.
- Lệnh PowerShell điều khiển CSP trên Windows:
  ```powershell
  $sec = New-Object System.Security.SecureString
  "12345678".ToCharArray() | ForEach-Object { $sec.AppendChar($_) }
  $sec.MakeReadOnly()
  $cp.KeyPassword = $sec
  $cp.Flags = [System.Security.Cryptography.CspProviderFlags]::UseExistingKey -bor [System.Security.Cryptography.CspProviderFlags]::NoPrompt
  $rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider($cp)
  $sig = $rsa.SignHash($hash, $oid)
  ```
- **Con dấu chữ ký (`appearance.py`)**: Vẽ bằng Pillow supersampling 4x để chống lỗi dãn chữ tiếng Việt của pyHanko.
- **Thẩm định chữ ký (`verify.py`)**: Áp dụng chính sách `RevocationMode.SOFT_FAIL` tương thích hoàn toàn với Root CA Quốc Gia VNRCA và WINCA.

---

## 📦 3. SỔ CÁI KHO BẤT BIẾN & REPLAY GIÁ VỐN

- **Bảng dữ liệu trung tâm**: `inv_moves` (chứa toàn bộ lịch sử biến động nhập/xuất/sản xuất).
- **Quy tắc tính giá vốn**: Bình quân gia quyền di động (Moving Weighted Average) tại thời điểm xuất.
- **Khi sửa chứng từ lùi ngày**:
  ```python
  from app.inventory import replay_costing
  # Quét và tính lại giá vốn di động toàn bộ dòng xuất bị ảnh hưởng, lan truyền BOM từ NVL sang Thành phẩm
  replay_costing(db, from_date="2026-08-01")
  ```
- **Quy tắc chống âm kho**: Hệ thống chặn ghi sổ nếu thiếu hàng. Khi quản trị viên bắt buộc xuất trước nhập sau:
  - Bật cờ `am_kho_override=True`.
  - Bắt buộc ghi `am_kho_reason` vào `AuditLog`.
- **Tự học Alias (`inv_item_aliases`)**: Học tự động từ các lần map tay của kế toán theo bộ `(tên_chuẩn_hóa, mst_ncc) -> item_id`.

---

## 🧾 4. HÓA ĐƠN VAT & CỔNG THUẾ TỰ ĐỘNG

- **Giải mã Captcha SVG Cổng Thuế (`tax_auto_sync.py`)**:
  - SVG vector $\rightarrow$ lọc thẻ rác qua BeautifulSoup $\rightarrow$ rasterize PNG $2.5\times$ qua CairoSVG $\rightarrow$ nhận diện bằng `ddddocr`.
  - Fallback: Bắn ảnh Captcha qua Telegram Bot cho admin nếu nhận diện thất bại 5 lần.
- **File HTML bản thể hiện tự chứa (`tax.py`)**:
  - Nhúng `details.js` trực tiếp vào thẻ `<script>` và chuyển đổi mọi ảnh nhúng sang Base64 Data URI để lưu trữ vĩnh viễn ngoại tuyến.
- **Lập tờ khai Quý Mẫu 01-GTGT (`tax_ops.py`)**:
  - Tự động tổng hợp chỉ tiêu `[22]` đến `[43]` và xuất file Excel đối soát thuế.
- **Phân hệ Giải trình Thuế & Thẩm tra Doanh thu 2022-2025 (`tax_defense.py` & `tax_defense_api.py`)**:
  - **Mục tiêu**: Phục vụ thanh tra, kiểm tra thuế chuyên sâu, lập luận vững chắc **KHÔNG PHỤ THUỘC TỒN KHO VẬT LÝ**.
  - **Ma trận 4 năm**: Doanh thu chưa thuế: `3.580.884.956 VNĐ` (127 HĐ có mã CQT), Thuế GTGT: `167.335.245 VNĐ`.
  - **Phân bổ phân khúc (Tiers)**: Nhỏ (<10M), Vừa (10-50M), Lớn (50-100M), Rất lớn (>100M).
  - **Cơ cấu thuế suất**: 51,4% DT là phần mềm Không chịu thuế (KCT - Chỉ tiêu [26]), 39,2% DT chịu thuế 10%, 9,4% DT giảm 8%.
  - **Cơ cấu chi phí mua vào**: Phân rã Hàng hóa, Dịch vụ viễn thông/máy chủ/kế toán, và Nhập khẩu hải quan. Cảnh báo HĐ $\ge 20$ triệu bắt buộc lưu kèm Ủy nhiệm chi (UNC).
  - **Luận điểm giải trình không tồn kho**: Doanh nghiệp giải pháp IoT / phần mềm áp dụng mô hình tinh gọn (Just-In-Time / On-Demand), chi phí giá vốn chủ yếu là R&D, chất xám nhân công, linh kiện gia công theo đơn đặt hàng, giao ngay cho khách hàng, không đọng vốn tồn kho.
  - **Endpoints API**:
    + `GET /api/tax-defense/overview`: Ma trận số liệu Doanh thu & Chi phí 4 năm.
    + `GET /api/tax-defense/justification-dossier`: Toàn văn bản thuyết minh giải trình pháp lý.
    + `GET /api/tax-defense/export-excel`: Tải tệp Excel báo cáo giải trình 4 sheets.
    + `POST /api/tax-defense/import-historical-purchase`: Nạp bảng kê mua vào Excel các năm cũ (2022-2024).
    + `GET /api/tax-defense/partner-status`: Rà soát trạng thái hoạt động toàn bộ đối tác mua/bán (phát hiện NNT Trạng thái 06).
    + `GET /api/tax-defense/check-mst?mst=...`: Tra cứu thời gian thực trạng thái pháp lý 1 MST bất kỳ.
  - **Cổng Thông Tin Công Quyền Đối Chứng (Official Referers)**:
    + 🏛️ **Tổng Cục Thuế - Chuyên trang Công khai NNT**: `https://congkhaithongtin.gdt.gov.vn` (Chuyên trang tra cứu Trạng thái 06 - Bỏ địa chỉ kinh doanh).
    + 🔎 **Cổng Tra Cứu Thông Tin NNT (GDT)**: `https://tracuunnt.gdt.gov.vn/tcnnt/mstdn.jsp`.
    + 🏢 **Cổng Thông Tin Quốc Gia Đăng Ký Doanh Nghiệp**: `https://dangkykinhdoanh.gov.vn`.
    + ⚡ **Hệ thống CSDL Doanh nghiệp VietQR API**: `https://api.vietqr.io/v2/business/{mst}`.
  - **Điểm nóng thực tế**: Khách hàng **CÔNG TY TNHH TM DV KHÁNH LỢI (MST: `0316764844`)** xuất hóa đơn năm 2024 (159M) hiện thuộc **Trạng thái 06**. Hệ thống tự động sinh luận điểm giải trình bảo vệ: HĐ xuất năm 2024 khi đối tác đang hoạt động, có mã CQT hợp lệ, đầy đủ biên bản bàn giao, INUT đã nộp 100% thuế GTGT đầu ra vào NSNN; việc đối tác sau đó bỏ địa chỉ không làm ảnh hưởng tính hợp pháp của doanh thu INUT.
  - **Giao diện Web**: Tab `⚖️ Giải trình thuế (2022-2025)` tại URL `/giai-trinh-thue` (gồm 4 phân hệ con: Ma trận doanh thu, Cơ cấu chi phí, Rà soát MST Trạng thái 06, Thuyết minh giải trình).
---

## 🚢 5. HẢI QUAN VNACCS, ECUS5 & LOGISTICS IN NHIỆT

- **Đồng bộ ECUS5 (`ecus_drive_sync.py`)**: Kéo file `ECUSSIGN_DN_4401053694.DB` từ máy Windows qua SCP vào `/tmp/` chế độ Read-Only, giải nén `DCHUNGTU_BS` (zlib/gzip) và đẩy lên Google Drive qua `rclone`.
- **Cào Mã vạch Hải quan (`customs_barcode.py`)**: Cào từ `pus1.customs.gov.vn` bằng `ddddocr`, render PDF A4 qua `WeasyPrint`.
- **In tem SPX Golden Ratio (`spx.py`)**: Co giãn 65% căn lề phải vừa vặn khổ in 80mm máy in TP732H, đẩy lệnh in qua Foxit Reader CLI trên máy Windows.

---

## 🏛️ 6. ĐẤU THẦU e-GP & TIÊU CHUẨN QCVN

- **Crawler e-GP (`bidding.py`)**: Kết nối `muasamcong.mpi.gov.vn`, TTL cache 15m/24h, Circuit Breaker 300s tự rớt về `MockBiddingGenerator` (15 gói thầu mẫu IoT/SCADA).
- **Phân nhóm khách hàng CRM 5 Tiers**: `WON_BIG`, `INUT_HQ`, `REGISTERED_BIDDER`, `OEM_SUBCONTRACTOR`, `COMMERCIAL`.
- **Tra cứu 2 chiều Tiêu chuẩn (`standards.py`)**:
  - Model $\rightarrow$ Quy chuẩn bắt buộc (QCVN 117 4G, QCVN 54 Wi-Fi, QCVN 65 5GHz, TT10 Datalogger).
  - MST $\rightarrow$ Danh bạ chứng nhận / công bố hợp quy (CBHQ/CNHQ).

---

## 🖥️ 7. FRONTEND & UI DESIGN SYSTEM

- **Kiến trúc SPA**: React 18 + TypeScript + Vite (không dùng `react-router-dom`, dùng Custom History Routing).
- **Design Tokens (`styles.css`)**: Slate Teal (`#174038`), Dark Emerald (`#0c6b58`), Gold Accent (`#ef9f31`).
- **Data Table (`.dt`)**: Sticky header, class `.row-zero` (tồn 0), `.row-treo` (treo tiền), `.row-neg` (âm kho).
- **Quy tắc Safari iOS**: Mọi thẻ `input, select, textarea { font-size: 16px; }` trên mobile để chống auto-zoom.

---

## 🛠️ 8. LỆNH VẬN HÀNH, TEST & KIỂM TRA HỆ THỐNG

### Khởi động dịch vụ Backend:
```bash
cd /home/ksp/ksp-pdfsign/backend
PYTHONPATH=. .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 2032
```

### Chạy kiểm thử Backend:
```bash
cd /home/ksp/ksp-pdfsign/backend
.venv/bin/pytest tests/test_signing.py
.venv/bin/pytest tests/test_inventory.py
.venv/bin/pytest tests/test_bidding.py
```

### Build & Chạy kiểm thử Frontend E2E:
```bash
cd /home/ksp/ksp-pdfsign/frontend
npm run build
npx playwright test e2e/verify-persistent.spec.ts
```

### Kiểm tra & Cập nhật IP máy Windows Token:
```bash
./scripts/discover_windows_host.py --force --update-env
```
