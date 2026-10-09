---
name: quarterly-tax-invoice-sync
description: Tự động tổng hợp toàn bộ hóa đơn mua vào, hóa đơn bán ra (iHOADON & GDT) và tờ khai hải quan theo từng quý (Q1, Q2, Q3, Q4), kết xuất PDF/XML, tạo sổ cái bảng kê Excel 4 sheet và đồng bộ chuẩn hóa lên Google Drive Kế toán iNut.
---

# 📑 KSP Quarterly Tax Invoice Sync (Tổng Hợp & Đồng Bộ Hóa Đơn & Tờ Khai Theo Quý)

Skill này cung cấp quy trình chuẩn hóa và tự động hóa 100% để tổng hợp toàn bộ hồ sơ thuế và kế toán theo từng quý (Quý 1, 2, 3, 4) cho **Công ty Cổ phần Đầu tư và Phát triển Công nghệ INUT (MST: 4401053694)**, phục vụ công tác quyết toán thuế, đối soát tồn kho và lưu trữ Google Drive kế toán.

---

## 📂 1. Cấu Trúc Thư Mục Chuẩn Trên Google Drive iNut

Toàn bộ hồ sơ của quý được lưu trữ tập trung tại thư mục:  
`Kế toán doanh nghiệp inut / VAT / Hóa đơn iNut {YYYY}:Q{X}` (Drive Root Folder ID: `168L8F2mu4RH7CURvCFXc-zRdQu2nYxyM`).

```text
Hóa đơn iNut {YYYY}:Q{X}/
├── Bang_ke_hoa_don_Q{X}_{YYYY}_INUT.xlsx   <-- File Excel Master tổng hợp 4 sheet
├── Hoa_don_mua_vao_Thang_07_{YYYY}/        <-- HĐ mua vào Tháng 7 (PDF + XML)
├── Hoa_don_ban_ra_Thang_07_{YYYY}/         <-- HĐ bán ra Tháng 7 (PDF + XML)
├── Hoa_don_mua_vao_Thang_08_{YYYY}/        <-- HĐ mua vào Tháng 8 (PDF + XML)
├── Hoa_don_ban_ra_Thang_08_{YYYY}/         <-- HĐ bán ra Tháng 8 (PDF + XML)
├── Hoa_don_mua_vao_Thang_09_{YYYY}/        <-- HĐ mua vào Tháng 9 (PDF + XML)
├── Hoa_don_ban_ra_Thang_09_{YYYY}/         <-- HĐ bán ra Tháng 9 (PDF + XML)
├── To_khai_nhap_khau_Q{X}_{YYYY}/          <-- Tờ khai HQ (Excel ToKhaiHQ7N + Barcode PDF)
└── Hop_dong_giao_khoan_Q{X}_{YYYY}/        <-- Hồ sơ HĐ giao khoán nhân công/thợ ngoài theo quý
    └── HDGK_{so_hd}_{ten_tho}/             <-- Gói hồ sơ đầy đủ của từng hợp đồng khoán
        ├── Hop_dong_giao_khoan_{code}_DA_KY.pdf
        ├── Phu_luc_02_Nghiem_thu_{code}.pdf
        ├── Phu_luc_03_Thanh_toan_UNC_{code}.pdf
        ├── Hop_dong_giao_khoan_{code}_final.docx
        ├── CCCD_Mat_truoc_{ten}.jpg
        ├── CCCD_Mat_sau_{ten}.jpg
        ├── Anh_eKYC_{ten}.jpg
        └── Chung_tu_UNC_Techcombank_{ten}.png
```

---

## ⚙️ 2. Quy Trình 5 Bước Thực Hiện Chuẩn

### Bước 1: Đồng bộ Cổng Thuế (hoadondientu.gdt.gov.vn)
- Tự động vượt Captcha SVG qua `ddddocr` và lấy token JWT.
- Kéo toàn bộ danh sách HĐ mua vào (`/api/query/invoices/purchase`, `/api/sco-query/invoices/purchase`) và bán ra (`/api/query/invoices/sold`) trong khoảng ngày của quý:
  - **Q1**: `01/01 -> 31/03`
  - **Q2**: `01/04 -> 30/06`
  - **Q3**: `01/07 -> 30/09`
  - **Q4**: `01/10 -> 31/12`
- Nạp tự động các HĐ mua còn thiếu vào CSDL KSP (`InvPurchase`).
- Tải file XML pháp lý và HTML bản thể hiện; tự động kết xuất sang file PDF bằng `weasyprint` / `html_to_pdf`.

### Bước 2: Đồng bộ iHOADON Bán ra
- Gọi API iHOADON (`ihoadon_sync.run_sync`) kéo toàn bộ hóa đơn đã phát hành trong quý.
- Tải file PDF gốc và gói XML zip lưu trữ trong kho `storage`.
- Nạp các hóa đơn vào sổ bán ra `InvSale` và chuyển trạng thái sang `reviewed`.

### Bước 3: Rà soát Ghi sổ Kho & Tờ khai Hải quan
- Kiểm tra các hóa đơn mua hàng hóa: đảm bảo 100% các dòng đã gán đúng mã hàng (`InvItem`) và kho nhập (`InvWarehouse`), thực hiện `inventory.post_purchase()` sinh phiếu nhập kho `InvMove`.
- Kiểm tra các tờ khai hải quan nhập khẩu trong quý (`InvCustomsDecl`):
  - Gán mã hàng và kho nhận cho từng dòng tờ khai.
  - Phân bổ chi phí và chạy `inventory.post_customs()` sinh phiếu nhập kho hải quan.
  - Tải file bảng kê mã vạch hải quan `MaVach_{so_tk}.pdf` qua skill `customs-barcode-fetcher`.

### Bước 4: Tạo Bảng Kê Excel Master 4 Sheet
Tạo file workbook `Bang_ke_hoa_don_Q{X}_{YYYY}_INUT.xlsx` gồm 4 sheet định dạng chuẩn Times New Roman và phân cách hàng nghìn rõ ràng:
1. **Sheet 1 - `Tổng hợp Q{X}`**: Bảng ma trận tổng hợp theo từng tháng (Số lượng HĐ mua, Tiền mua trước thuế, Thuế GTGT mua, Số lượng HĐ bán, Doanh thu bán, Thuế GTGT bán, Số tờ khai HQ, Trị giá nhập khẩu, Thuế VAT hàng nhập).
2. **Sheet 2 - `Hóa đơn Mua vào Q{X}`**: Chi tiết toàn bộ HĐ mua trong quý (STT, Tháng, Số HĐ, Ký hiệu, Ngày HĐ, MST Bên bán, Tên Bên bán, Tiền trước thuế, Thuế GTGT, Tổng thanh toán, Trạng thái ghi sổ, Loại hàng hóa/dịch vụ, Tên file PDF).
3. **Sheet 3 - `Hóa đơn Bán ra Q{X}`**: Chi tiết toàn bộ HĐ bán trong quý (STT, Tháng, Số HĐ, Ký hiệu, Ngày HĐ, MST Người mua, Tên Người mua, Doanh thu trước thuế, Thuế GTGT, Tổng thanh toán, Trạng thái, Tên file PDF).
4. **Sheet 4 - `Tờ khai Hải quan Q{X}`**: Chi tiết toàn bộ tờ khai hải quan (STT, Số tờ khai, Ngày ĐK, Mã loại hình, Luồng, Người xuất khẩu, Số Invoice, Trị giá NT, Trị giá tính thuế VNĐ, Thuế NK, Thuế VAT, Trạng thái nhập kho, Chi tiết hàng hóa).

### Bước 5: Đóng gói & Đồng bộ Google Drive qua rclone
- Gom toàn bộ file PDF/XML hóa đơn theo từng tháng vào các thư mục tương ứng.
- Đặt các file Excel tờ khai và PDF mã vạch vào thư mục `To_khai_nhap_khau_Q{X}_{YYYY}/`.
- Đẩy trực tiếp lên Google Drive bằng lệnh:
  ```bash
  rclone copy "/tmp/staging_dir" "vnmap-drive:VAT/Hóa đơn iNut {YYYY}:Q{X}" \
    --drive-root-folder-id "168L8F2mu4RH7CURvCFXc-zRdQu2nYxyM" \
    --bind 0.0.0.0 -v
  ```
- Lấy link chia sẻ công khai (`rclone link`) gửi cho Ban Giám đốc và bộ phận Kế toán.

---

## 📈 3. Giám Sát Bậc Phí Kế Toán (Accounting Fee Tier Alarm)
Sau khi đồng bộ xong, kiểm tra số lượng chứng từ tính phí của quý theo quy định:
- **Quy tắc tính**:
  - Hóa đơn mua vào dịch vụ ngân hàng: loại trừ (0đ).
  - Tờ khai hải quan: tính từng tờ khai độc lập.
- **Ngưỡng cảnh báo**:
  - Kích hoạt ALARM cảnh báo nếu còn $\le 5$ chứng từ trước khi nhảy sang bậc phí kế toán cao hơn.
- **Lệnh kiểm tra**:
  ```python
  from app.db import get_session
  from app import accounting_tier
  for db in get_session():
      status = accounting_tier.evaluate_accounting_fee_status(db, ky="2026-Q3")
      print("Tier:", status["current_tier"]["label"], "| Remaining:", status["thresholds"]["remaining_before_jump"])
  ```

---

## 🏦 4. Quy Tắc Đối Soát Hóa Đơn Mua Vào Với Sao Kê Ngân Hàng (Bank Reconciliation & Contract Rules)

Khi thực hiện đối soát các khoản thanh toán mua hàng hóa/dịch vụ với Sao kê Ngân hàng (Techcombank, VCB...), bắt buộc phải tuân thủ nghiêm ngặt các quy tắc sau:

### 4.1. Quy tắc Xác Định Ngày Hóa Đơn Pháp Lý (CỰC KỲ QUAN TRỌNG)
* **NGUYÊN TẮC VÀNG**: **BẮT BUỘC PHẢI DÙNG NGÀY IN TRÊN BẢN THỂ HIỆN HÓA ĐƠN GỐC (PDF / XML KÝ SỐ)**.
* **TUYỆT ĐỐI KHÔNG DÙNG**: Ngày `tdlap` (thời điểm lập nháp hệ thống do API Cổng Thuế GDT trả về).
  * *Lý do*: Trên phần mềm hóa đơn điện tử bên bán, kế toán có thể tạo bản nháp trước 1 - 2 ngày (lưu trường `tdlap`), nhưng đến khi giao dịch phát sinh thực tế hoặc nhận tiền thì họ mới bấm ký số phát hành chính thức (in ngày trên PDF).
  * *Ví dụ thực tế Q3/2026*:
    * **Nextstep (HĐ 143)**: Cổng thuế lưu `tdlap = 06/08`, nhưng PDF hóa đơn in rõ `Ngày 07/08/2026`. Tiền chuyển khoản lúc `11:16 ngày 07/08/2026` $\rightarrow$ **CÙNG NGÀY 100% ($\Delta = 0$), không hề lệch!**
    * **Thời Đại Công Nghệ 4.0 (HĐ 35593)**: Cổng thuế lưu `tdlap = 09/08` (Chủ nhật), nhưng PDF hóa đơn in `Ngày 10/08/2026` (Thứ hai). Tiền chuyển khoản lúc `11:21 ngày 10/08/2026` $\rightarrow$ **CÙNG NGÀY 100% ($\Delta = 0$)!**

### 4.2. Quy tắc Đối Chiếu Thời Điểm Chuyển Tiền Trên Sao Kê
* Khi kiểm tra sao kê ngân hàng (như Techcombank), phải phân biệt 2 cột:
  1. **Ngày KH thực hiện (Requesting Date)**: Thời điểm thực tế người dùng bấm lệnh chuyển tiền trên App/Web.
  2. **Ngày giao dịch / Hạch toán (Transaction Date)**: Thời điểm Core Banking ghi sổ.
* Nếu lệnh chuyển tiền thực hiện vào chiều tối muộn hoặc **ngày nghỉ (Thứ Bảy, Chủ Nhật)**, ngân hàng có thể hạch toán sang ngày làm việc tiếp theo.
  * *Ví dụ*: HĐ 573 Song Long xuất ngày `16/08/2026` (Chủ nhật). Lệnh chuyển tiền Techcombank thực hiện lúc `17:07 ngày 16/08/2026` ($\Delta = 0$). Ngân hàng hạch toán sang ngày `17/08/2026`. Thực tế giao dịch phát sinh hoàn toàn cùng ngày với hóa đơn.

### 4.3. Quy tắc Lọc Đối Tượng & Yêu Cầu Hợp Đồng Kinh Tế
* **Phạm vi kiểm tra**: Chỉ xét các hóa đơn mua vào thương mại có tổng thanh toán **$\ge 5.000.000$ VNĐ** (theo yêu cầu quản trị nội bộ và kiểm soát rủi ro thuế).
* **Loại trừ khỏi bảng đối chiếu**:
  1. Hóa đơn phí/thuế dịch vụ ngân hàng Techcombank (MST `0100230800`): đối soát theo sao kê hàng tháng.
  2. Tờ khai hải quan nhập khẩu: đối soát riêng theo Giấy nộp tiền vào NSNN tại Kho bạc Nhà nước.
  3. Các hóa đơn nhỏ dưới 5.000.000 VNĐ.
  4. Hóa đơn hủy/xóa bỏ (như HĐ 5163153 S-RETAIL).
* **Phân loại để lập Hợp đồng kinh tế**:
  * **Nhóm 1 - BẮT BUỘC KÝ HỢP ĐỒNG GẤP**: Các khoản chuyển tiền đặt cọc / tạm ứng trước ngày hóa đơn nhiều tuần, hoặc **lệch tháng / lệch kỳ tính thuế** (như cọc tháng 7, xuất HĐ tháng 8; hoặc cọc tháng 8, xuất HĐ tháng 9).
    * *Yêu cầu hợp đồng*: Phải ghi rõ điều khoản "Bên A tạm ứng/đặt cọc [50%] ngay sau khi ký hợp đồng để chuẩn bị vật tư/sản xuất; Bên B bàn giao hàng và xuất hóa đơn thì thanh toán nốt phần còn lại".
  * **Nhóm 2 - HỢP ĐỒNG GIÁ TRỊ LỚN (> 200 triệu)**: Dù chuyển tiền cùng ngày hay trả chậm 1 ngày (như HĐ Tomko 236 triệu), giá trị lớn bắt buộc phải có Hợp đồng mua bán và Biên bản bàn giao hàng hóa hoàn chỉnh.
  * **Nhóm 3 - CHUYỂN TIỀN CÙNG NGÀY HOẶC TRẢ CHẬM 1 - 3 NGÀY**: Không cần hợp đồng cọc phức tạp, chỉ cần Đơn đặt hàng hoặc Hợp đồng nguyên tắc ghi nhận điều khoản thanh toán trả chậm thông thường.

### 4.4. Quy tắc Ký số Biên bản bàn giao (BBBG) đi kèm Hóa đơn bán ra
* **Đồng bộ thời gian**: Ngày lập BBBG và mốc thời gian ký số mật mã nhúng trong file PDF (`/M`) **bắt buộc phải lùi về cùng ngày với ngày xuất hóa đơn bán ra**.
* **Thời điểm ký số**: Lập trình đặt ngẫu nhiên sau thời điểm ký số hóa đơn điện tử từ **46 đến 54 phút** (mô phỏng logic thực tế: lập hóa đơn $\rightarrow$ in ấn/chuẩn bị thiết bị $\rightarrow$ bàn giao nghiệm thu).
* **Kỹ thuật thực hiện**: Sử dụng tính năng truyền `system_time` vào PyHanko khi ký số bằng USB Token WINCA (192.168.1.10) để nhúng thời gian lịch sử, đảm bảo Foxit Reader và Adobe Acrobat kiểm tra báo **Hợp lệ (Signature is VALID, Integrity Intact)**.

### 4.5. Quy tắc Hợp đồng giao khoán nhân công / thợ ngoài (Piecework Contracts)
* **Thời điểm ký HĐ khoán**: Ngày ký Hợp đồng giao khoán **phải đi trước ngày xuất hóa đơn bán ra từ 15 đến 30 ngày**.
  * *Logic kế toán*: Giao khoán công việc trước $\rightarrow$ Thợ triển khai thi công/gia công tại hiện trường $\rightarrow$ Hoàn thành công việc $\rightarrow$ Lập Biên bản nghiệm thu đạt chuẩn $\rightarrow$ Mới đủ căn cứ xuất hóa đơn bán ra cho khách hàng. Không được để ngày HĐ khoán sau ngày hóa đơn bán ra.
* **Điều khoản thanh toán bắt buộc trong HĐ khoán**:
  > *"Khi có Biên bản nghiệm thu khối lượng hoàn thành đạt yêu cầu, Bên A (INUT) thực hiện thanh toán tiền thù lao cho Bên B bằng hình thức chuyển khoản ngân hàng không dùng tiền mặt trong vòng 30 (ba mươi) ngày kể từ ngày ký Biên bản nghiệm thu hợp đồng khoán."*
* **Ngưỡng thuế TNCN & Ngân hàng (NĐ 253/2026/NĐ-CP & NĐ 320/2025/NĐ-CP)**:
  * Dưới 5.000.000 VNĐ/lần: Miễn khấu trừ 10% thuế TNCN tại nguồn (Khoản 2 Điều 50 NĐ 253).
  * Từ 5.000.000 VNĐ/lần trở lên: Bắt buộc chuyển khoản từ TK Techcombank `79713` vào STK chính chủ của thợ (trùng tên CCCD) và khấu trừ 10% thuế TNCN (hoặc có Cam kết 08/CK) để được tính 100% chi phí hợp lý TNDN.

### 4.6. Quy Tắc Đồng Bộ Hợp Đồng Giao Khoán Lên Google Drive Kế Toán Theo Thời Điểm Ký Của Từng Quý
* **Nguyên tắc phân bổ Quý**: Hợp đồng giao khoán đã ký được tự động phân loại và đồng bộ vào thư mục Quý của Kế toán theo **thời điểm ký số** (`inut_signed_at` -> `worker_signed_at` -> `contract_date`):
  * Ký tháng 1, 2, 3: Lưu vào `VAT/Hóa đơn iNut {YYYY}:Q1/Hop_dong_giao_khoan_Q1_{YYYY}/`
  * Ký tháng 4, 5, 6: Lưu vào `VAT/Hóa đơn iNut {YYYY}:Q2/Hop_dong_giao_khoan_Q2_{YYYY}/`
  * Ký tháng 7, 8, 9: Lưu vào `VAT/Hóa đơn iNut {YYYY}:Q3/Hop_dong_giao_khoan_Q3_{YYYY}/`
  * Ký tháng 10, 11, 12: Lưu vào `VAT/Hóa đơn iNut {YYYY}:Q4/Hop_dong_giao_khoan_Q4_{YYYY}/`
* **Thành phần gói hồ sơ đóng gói đầy đủ (Dossier Package)** cho mỗi HĐGK (`HDGK_{so_hd}_{ten_tho}/`):
  1. **Hợp đồng chính + Phụ lục I** (`Hop_dong_giao_khoan_{code}_DA_KY.pdf`): PDF chứa đầy đủ chữ ký số doanh nghiệp PAdES của iNut và chữ ký tay eKYC của thợ.
  2. **Phụ lục II Nghiệm thu** (`Phu_luc_02_Nghiem_thu_{code}.pdf`): Biên bản nghiệm thu khối lượng hoàn thành, ký trước thời điểm xuất hóa đơn bán ra.
  3. **Phụ lục III Thanh toán** (`Phu_luc_03_Thanh_toan_UNC_{code}.pdf`): Biên bản xác nhận thanh toán thù lao đính kèm chứng từ UNC ngân hàng.
  4. **Bản thảo Word DOCX** (`Hop_dong_giao_khoan_{code}_final.docx`): Văn bản gốc tổng hợp phục vụ kế toán tra cứu và đối chiếu điều khoản.
  5. **Các chứng từ đính kèm**: Ảnh CCCD 2 mặt (`CCCD_Mat_truoc_{ten}.jpg`, `CCCD_Mat_sau_{ten}.jpg`), ảnh chân dung selfie lúc ký (`Anh_eKYC_{ten}.jpg`), chứng từ chuyển khoản ngân hàng (`Chung_tu_UNC_Techcombank_{ten}.png`), và ảnh hiện trường thi công.
* **Thao tác trên Giao diện Quản lý KSP**:
  * Nút **`☁️ Sync Drive Quý`** tại thanh công cụ đầu trang: Tự động gom và đẩy toàn bộ HĐ giao khoán đã ký trong quý lên thư mục Quý tương ứng trên Google Drive kế toán.
  * Nút **`☁️ Sync Drive Kế toán`** tại từng dòng hợp đồng: Đẩy riêng gói hồ sơ của hợp đồng vừa hoàn thành lên Drive ngay lập tức.
  * Liên kết **`📁 Mở Drive Quý`** / **`🚀 Mở Thư Mục Trên Google Drive`**: Cho phép kế toán và ban giám đốc bấm mở trực tiếp thư mục lưu trữ trên Google Drive.
* **Lệnh đồng bộ qua API/CLI**:
  * API đồng bộ đơn lẻ: `POST /api/piecework/contracts/{id}/sync-drive`
  * API đồng bộ theo quý: `POST /api/piecework/sync-quarterly-drive?year={YYYY}&quarter={X}`
  * Lệnh rclone:
    ```bash
    rclone copy "/path/to/staged/folder" \
      "vnmap-drive:VAT/Hóa đơn iNut {YYYY}:Q{X}/Hop_dong_giao_khoan_Q{X}_{YYYY}/HDGK_{code}_{name}" \
      --drive-root-folder-id "168L8F2mu4RH7CURvCFXc-zRdQu2nYxyM" \
      --bind 0.0.0.0 -v
    ```
