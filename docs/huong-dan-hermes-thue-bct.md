# HƯỚNG DẪN NGHIỆP VỤ BÁO CÁO THUẾ (BCT) GTGT CHO AGENT HERMES

Tài liệu này cung cấp toàn bộ tri thức nền tảng về tính năng **Báo cáo thuế GTGT theo quý** trong dự án `ksp-pdfsign`. Sử dụng tài liệu này để nạp vào ngữ cảnh (context) của Agent/LLM (Hermes) giúp thực hiện các tác vụ lập trình, sửa lỗi và phát triển tiếp Giai đoạn 2 một cách chuẩn xác.

---

## 1. TỔNG QUAN HỆ THỐNG & ĐƯỜNG ĐI CỦA DỮ LIỆU THUẾ

Hệ thống quản lý thuế GTGT bao gồm 2 phân hệ bổ trợ cho nhau:
1. **Phân hệ Review File Kế Toán (Đã hoàn thiện):** Cho phép kế toán tải lên file Báo cáo thuế (`.xlsx` gồm 3 sheet: Tờ khai, Bảng kê bán ra, Bảng kê mua vào) để hệ thống tự động parse, chấm lỗi nghiệp vụ (như số âm ở `[40]`, sai lệch công thức, gộp sai nhóm thuế suất) và hiển thị trực quan Excel online cho quản trị viên kiểm tra trước khi nộp.
2. **Phân hệ Sinh Báo Cáo Nội Bộ (Đang phát triển/Sơ khai):** Tự động gom dữ liệu hóa đơn trong CRM (`InvSale`, `InvPurchase`) để tính toán ra tờ khai GTGT nội bộ, sinh file Excel và cho phép đối chiếu trực tiếp từng chỉ tiêu với file của kế toán.

### Luồng Dữ Liệu:
```
[Cổng thông tin Thuế Tổng cục Thuế]
            │
            ▼ (Đồng bộ hàng ngày qua tax_daily.py / api/tax/sync)
 ┌──────────────────────┐
 │   Hóa đơn trong DB   │◄────── [CRM Invoices (XML / PDF)]
 │InvSale & InvPurchase │
 └──────────┬───────────┘
            │
            ├────────────────────────────────────────┐
            ▼ (Tính toán nội bộ)                      ▼ (Kế toán tự làm tay)
 ┌──────────────────────┐                 ┌──────────────────────┐
 │   TaxReport (CRM)    │                 │ File .xlsx của Kế toán│
 │  Chỉ tiêu nội bộ     │                 │   (Upload lên Web)   │
 └──────────┬───────────┘                 └──────────┬───────────┘
            │                                        │
            └───────────────────┬────────────────────┘
                                ▼
                    [So sánh đối chiếu chỉ tiêu]
                    (api/tax/reports/{id}/compare/{review_id})
```

---

## 2. CẤU TRÚC FILE EXCEL & THUẬT TOÁN PARSE (tax_review.py)

Hệ thống không sử dụng tọa độ ô cứng (hardcoded coordinates) để đọc các chỉ tiêu vì file Excel của kế toán có thể bị thêm/bớt dòng. Thay vào đó, hệ thống định vị động.

### 2.1. Đọc tờ khai (Sheet "Tờ khai")
- **Nhãn chỉ tiêu:** Tìm kiếm tất cả các ô khớp với biểu thức chính quy: `r"^\[(\d+[a-z]?)\]$"` (ví dụ: `[22]`, `[40a]`, `[43]`). Chỉ nhận diện khi ô đó chứa đúng nhãn, tránh đọc nhầm các ô chứa công thức giải thích như `[27]=[29]+[30]`.
- **Lấy giá trị:** Giá trị của chỉ tiêu là **số đầu tiên nằm bên PHẢI nhãn** trên cùng một dòng, và trước nhãn tiếp theo của dòng đó.
- **Formula Cache:** File Excel được tải bằng `openpyxl.load_workbook(..., data_only=True)`. Điều này có nghĩa là giá trị đọc được là giá trị đã được tính toán và lưu cache bởi Excel. Nếu file Excel được tạo tự động bằng code mà không được mở/lưu lại bằng Excel để tính công thức, các ô này sẽ trả về `None`.

### 2.2. Đọc Bảng kê (Sheet "Bảng kê bán ra" & "Bảng kê mua vào")
- **Nhận diện cột Thuế suất:** Quét toàn bộ bảng để tìm cột có tần suất xuất hiện các giá trị thuế suất hợp lệ `{0.05, 0.08, 0.1}` nhiều nhất. Cột này được chọn làm `rate_col`.
- **Nhận diện dòng dữ liệu:** Dòng dữ liệu hợp lệ phải có giá trị số tại cột thuế suất (`rate_col`) và có số tiền doanh thu ở bên trái.
- **Xác định các trường thông tin:**
  - **Doanh thu:** Số gần nhất bên trái cột thuế suất.
  - **Tiền thuế:** Số gần nhất bên phải cột thuế suất (nếu không có thì mặc định là `0.0`).
  - **Tên đối tác (Khách hàng/Nhà cung cấp):** Ô chữ dài nhất bên trái cột doanh thu (loại trừ các ô định dạng ngày tháng hoặc nhãn chỉ tiêu).
  - **Ngày hóa đơn:** Ô đầu tiên có kiểu dữ liệu `datetime` hoặc chuỗi dạng `dd/mm/yyyy`.
  - **Số hóa đơn:** Số nguyên hoặc chuỗi số nằm bên trái cột ngày hóa đơn.

---

## 3. LOGIC NGHIỆP VỤ GTGT & QUY TẮC CHỈ TIÊU

Đây là phần tối quan trọng đối với kế toán và lập trình viên. Các chỉ tiêu trên Tờ khai 01/GTGT tuân theo công thức thuế Việt Nam:

### 3.1. Phân nhóm Thuế suất bán ra (Đầu ra)
- `[26]`: Doanh thu không chịu thuế (KCT) - Ví dụ: sản phẩm/dịch vụ phần mềm theo Luật Thuế 48/2024/QH15.
- `[29]`: Doanh thu thuế suất 0% - Chỉ áp dụng cho xuất khẩu đủ hồ sơ, không chịu thuế khác với thuế suất 0%.
- `[30]`/`[31]`: Doanh thu và Thuế GTGT đầu ra thuế suất 5%.
- `[32]`/`[33]`: Doanh thu và Thuế GTGT đầu ra gộp của nhóm thuế suất 8% và 10% (theo mẫu tờ khai hiện hành). Hệ thống có lưu snapshot tách riêng `split_8_base`, `split_8_tax`, `split_10_base`, `split_10_tax` để kiểm tra.
- **Công thức tổng:**
  - `[27] = [29] + [30] + [32]` (Tổng doanh thu chịu thuế).
  - `[28] = [31] + [33]` (Tổng thuế GTGT đầu ra).
  - `[34] = [26] + [27]` (Tổng doanh thu bán ra).
  - `[35] = [28]` (Tổng thuế GTGT đầu ra).

### 3.2. Thuế đầu vào (Mua vào)
- `[23]`: Tổng giá trị hàng hóa, dịch vụ mua vào.
- `[24]`: Tổng thuế GTGT của hàng hóa, dịch vụ mua vào.
- `[25]`: Thuế GTGT đầu vào được khấu trừ kỳ này (thường bằng `[24]`, trừ trường hợp có hóa đơn mua vào không đủ điều kiện khấu trừ).

### 3.3. Quy tắc vàng về số âm của chỉ tiêu `[40]` / `[40a]`
Kế toán thủ công thường điền số âm vào chỉ tiêu `[40]` khi thuế đầu vào lớn hơn thuế đầu ra. **Đây là lỗi nghiêm trọng cần chặn đứng.**
- `[36] = [35] - [25]` (Thuế GTGT phát sinh trong kỳ).
- **Kết quả tính toán thực tế:** `tmp = [36] - [22] + [37] - [38] + [39]` (với `[22]` là số dư khấu trừ kỳ trước chuyển sang).
- **Quy tắc phân bổ:**
  - Nếu `tmp >= 0`: Thuế phải nộp.
    - `[40a] = [40] = tmp`
    - `[41] = [42] = [43] = 0`
  - Nếu `tmp < 0`: Thuế còn được khấu trừ chuyển kỳ sau.
    - `[40a] = [40] = 0` (BẮT BUỘC bằng 0, không được âm!)
    - `[41] = -tmp` (Ghi số dương số thuế còn được khấu trừ)
    - `[43] = [41] - [42]` (Số thuế chuyển kỳ sau thực tế).
- **Số dư chuyển kỳ:** Chỉ tiêu `[22]` của kỳ này bắt buộc phải bằng chỉ tiêu `[43]` của kỳ liền trước.

---

## 4. CÁC CẢNH BÁO TỰ ĐỘNG (findings)

Hệ thống sinh ra 2 cấp độ cảnh báo: **ĐỎ** (Lỗi nghiêm trọng, chặn/phải sửa) và **VÀNG** (Cần kiểm tra/xác nhận lại).

### 4.1. Lỗi ĐỎ (Level: `do`)
1. **Số âm ở [40]/[40a]:** Phát hiện giá trị nhỏ hơn `-0.5` ở chỉ tiêu nộp thuế. Cần hướng dẫn đưa về 0 và chuyển sang `[41]`/`[43]`.
2. **Sai công thức nội bộ:**
   - `[36] != [35] - [25]`
   - `[28] != [31] + [33]`
   - `[34] != [26] + [27]`
3. **Lệch bảng kê và tờ khai:**
   - Tổng doanh thu/thuế trên bảng kê bán ra lệch với chỉ tiêu `[34]`/`[35]` trên tờ khai (> 1đ).
   - Tổng giá trị/thuế trên bảng kê mua vào lệch với chỉ tiêu `[23]`/`[25]` trên tờ khai (> 1đ).
4. **Hóa đơn áp thuế suất 8% ngoài thời kỳ giảm thuế:** Kiểm tra ngày hóa đơn đối chiếu với danh sách các thời kỳ giảm thuế trong `tax_policy.py`.

### 4.2. Lỗi VÀNG (Level: `vang`)
1. **Hóa đơn bán ra 0% cho doanh nghiệp nội địa:** Nghi ngờ khai nhầm. Phần mềm KCT phải khai vào `[26]`, không khai vào `[29]`.
2. **Nhóm [32]/[33] có tỷ lệ thuế suất bất thường:** Ví dụ: Do gộp cả doanh thu chịu thuế 8% và doanh thu 0% (KCT) vào chỉ tiêu `[32]` nhưng tiền thuế chỉ tính cho phần 8%, dẫn đến tỷ lệ chia ra mức lẻ (ví dụ: `6.12%`).
3. **Thuế suất lạ:** Có hóa đơn mang thuế suất khác `{0, 5, 8, 10}`.
4. **Hóa đơn 10% trong thời kỳ giảm thuế:** Cần nhắc nhở kiểm tra xem hàng hóa đó có thuộc nhóm loại trừ giảm thuế hay không.

### 4.3. Đối chiếu tự động với CRM (Cross-check)
Hệ thống tự động tra cứu mã hóa đơn trong DB CRM. Nếu toàn bộ các dòng hàng của hóa đơn khớp số có nhãn là sản phẩm phần mềm không chịu thuế (`thue_kct = True`), cảnh báo vàng về hóa đơn 0% sẽ được đổi thành **"Đã xác nhận là phần mềm KCT — bảng kê đang xếp sai nhóm"** để chỉ rõ lỗi xếp nhầm nhóm từ `[32]` sang `[26]`.

---

## 5. THỰC TẾ SO VỚI KẾ HOẠCH (IMPLEMENTATION DRIFT)

Khi Hermes làm việc trên Giai đoạn 2 (Tự sinh báo cáo), cần lưu ý các điểm khác biệt giữa kế hoạch ban đầu (`docs/plan-bao-cao-thue-xlsx.md`) và mã nguồn thực tế:

1. **Về việc xuất Excel mẫu tờ khai:**
   - *Kế hoạch:* Lưu template mẫu chuẩn của tổng cục thuế (`app/assets/bct_gtgt_template.xlsx`) rồi ghi đè số vào.
   - *Thực tế:* Hiện tại `tax_ops.py` đang sinh một file Excel trắng thô sơ bằng `openpyxl.Workbook()` rồi ghi text và số phẳng (sheet `Tờ khai 01-GTGT`, `Bảng kê bán ra`, `Bảng kê mua vào`), **chưa có mẫu tờ khai chính thức có định dạng đẹp**. Nếu cần cải tiến layout, hãy dùng `inv_export.py` làm mẫu để nạp template.
2. **So sánh chênh lệch:**
   - Endpoint `compare` đối chiếu các chỉ tiêu phẳng trực tiếp, nhưng `TaxReviewUpload` lưu snapshot dưới dạng tóm tắt. Hermes cần chú ý tránh để xảy ra lệch key khi đối chiếu các chỉ tiêu không có sẵn.
3. **Hóa đơn điều chỉnh (`is_dieu_chinh`):**
   - Hàm `build_report` loại bỏ hóa đơn điều chỉnh khi tính toán chỉ tiêu, nhưng hàm `report_xlsx` xuất bảng kê thô không loại bỏ chúng ra khỏi danh sách dòng, dẫn đến tổng số trên bảng kê Excel xuất ra có thể lệch với chỉ tiêu tờ khai nội bộ.

---

## 6. CẨM NĂNG TRIỂN KHAI & VẬN HÀNH (DEPLOYMENT)

### 6.1. Khởi động lại Backend trên Production
Do backend chạy dưới dạng dịch vụ chạy nền bằng `nohup` chứ không quản lý qua systemd trực tiếp cho process uvicorn, mỗi khi cập nhật file python, bạn cần restart tay:
```bash
# Tìm process đang chạy cổng 2032
lsof -i :2032

# Kill process đó
kill <PID>

# Hoặc kill nhanh:
fuser -k 2032/tcp

# Khởi động lại từ thư mục backend
cd /home/ksp/ksp-pdfsign/backend
nohup uvicorn app.main:app --port 2032 --host 127.0.0.1 > uvicorn.log 2>&1 &
```

### 6.2. Đồng bộ tự động & Sinh báo cáo tự động bằng Systemd
Hệ thống sử dụng systemd timer để chạy định kỳ script `backend/scripts/tax_daily.py`:
- Dịch vụ: `/etc/systemd/system/ksp-tax-sync.service` (hoặc link tới `deploy/ksp-tax-sync.service`)
- Timer: `/etc/systemd/system/ksp-tax-sync.timer` (chạy vào 02:00 hàng ngày).
- **Cơ chế:** Khi đến ngày đầu tiên của quý mới (01/01, 01/04, 01/07, 01/10), script này sẽ tự động gọi hàm sinh báo cáo nội bộ (`build_report` và `generate_report`) cho quý trước đó.

---

## 7. HƯỚNG DẪN KIỂM THỬ (TESTING)

Hermes phải đảm bảo tất cả các bài test thuế đều vượt qua trước và sau khi chỉnh sửa code:
```bash
# Chạy toàn bộ test liên quan đến thuế
pytest backend/tests/test_tax_review.py backend/tests/test_tax_ops.py backend/tests/test_tax_policy.py
```
- Fixture test thực tế nằm ở: `backend/tests/fixtures/tax/bct_quy2_2026.xlsx`.
- File test `test_tax_review.py` chứa các kịch bản kiểm tra: chỉ tiêu âm [40], dòng bán ra 0%, gộp sai tỷ lệ thuế suất nhóm 8% và 10%, và kiểm tra crosscheck hóa đơn phần mềm KCT từ DB.

---

## 8. MẪU PROMPT PHÙ HỢP ĐỂ DẠY HERMES

Khi mở một phiên làm việc mới với Hermes và yêu cầu chỉnh sửa liên quan đến thuế, hãy gửi prompt mở đầu sau:

> *"Tôi đang làm việc trên module Báo cáo thuế GTGT quý của dự án ksp-pdfsign. Hãy đọc kỹ hướng dẫn nghiệp vụ và cấu trúc kỹ thuật tại `docs/huong-dan-hermes-thue-bct.md`. Tôi muốn thực hiện [mô tả yêu cầu, ví dụ: sửa lỗi đối chiếu chỉ tiêu so sánh / sửa hàm sinh file Excel dùng mẫu template]. Hãy phân tích code hiện tại dựa theo tài liệu hướng dẫn và đề xuất giải pháp."*
