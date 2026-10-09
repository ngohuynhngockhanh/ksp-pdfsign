# Import hóa đơn → sinh BBBG & Phân loại tài liệu

## Tổng quan luồng

```
Tab "Tạo BBBG":
  Upload hóa đơn (PDF) ─► /api/invoice/parse (pdfplumber) ─► FORM sửa/xác nhận
  ─► /api/bbbg/generate (Jinja2 HTML + WeasyPrint) ─► doc_id
  ─► chuyển sang tab "Ký số" (đã nạp sẵn) ─► ký ─► Hồ sơ (loại = BBBG) ─► NAS
```

Phân loại: khi ký, hệ thống tự nhận diện loại tài liệu theo nội dung trang đầu
(`classify.detect_doc_type`), hoặc dùng loại chỉ định (BBBG). Admin sửa loại tay
ở tab Hồ sơ (cột "Loại").

## Backend

| File | Vai trò |
|---|---|
| `app/invoice.py` | Parse hóa đơn ihoadon.vn bằng **pdfplumber** (không có XML nhúng). Trích bên mua (tên/MST/địa chỉ), hàng hóa (bảng), ngày. Best-effort → luôn có form xác nhận. |
| `app/bbbg.py` | Sinh BBBG: Jinja2 render `templates_bbbg/*.html` → **WeasyPrint** → PDF. Logo INUT chìm (base64 từ `settings.logo_path`). |
| `app/templates_bbbg/*.html` | Các **template** BBBG (HTML/CSS + Jinja). |
| `app/classify.py` | Phân loại theo text trang đầu; fallback **OCR** (pytesseract nếu có tesseract, nếu không dùng `rapidocr-onnxruntime`). |

**Endpoints (admin):**
- `POST /api/invoice/parse` — upload hóa đơn → dữ liệu đã parse.
- `GET /api/bbbg/templates` — danh sách template.
- `POST /api/bbbg/generate` — body `BBBGGenerate` → PDF, trả `{doc_id, filename}` để ký.
- `POST /api/documents/{id}/type` — đổi loại tài liệu.

## Thêm một template BBBG mới

1. Tạo file `backend/app/templates_bbbg/<ten>.html` (copy từ `bbbg_thiet_bi.html`).
   Dùng biến Jinja: `ben_a.*`, `ben_b.*`, `items[]` (`{ten,dvt,so_luong}`), `so_bb`,
   `noi_lap`, `ngay.{day,month,year}`, `logo_data_uri`.
2. Đăng ký trong `app/bbbg.py`:
   ```python
   TEMPLATES = {
     "bbbg_thiet_bi": {"file": "bbbg_thiet_bi.html", "label": "Biên bản bàn giao thiết bị"},
     "bbbg_<ten>":   {"file": "<ten>.html",         "label": "<Nhãn hiển thị>"},
   }
   ```
3. Xong — template tự hiện trong dropdown ở tab "Tạo BBBG".

Cùng cơ chế này có thể thêm mẫu **báo giá / hợp đồng** sau.

## Thông tin Bên A (bên bàn giao) — INUT

Lấy từ config (`.env`), cho sửa: `BBBG_COMPANY`, `BBBG_ADDRESS`, `BBBG_MST`,
`BBBG_PHONE`, `BBBG_REP`, `BBBG_REP_TITLE`. Mặc định là INUT / Ngô Huỳnh Ngọc Khánh - Giám đốc.

## Parse hóa đơn — lưu ý khi layout đổi

Parser bám vào layout ihoadon.vn: khối "Họ tên người mua hàng" rồi các dòng
"Tên đơn vị / Mã số thuế / Địa chỉ", và bảng hàng hóa (`extract_tables`). Nếu nhà
phát hành hóa đơn khác đổi layout, chỉnh anchor/toạ độ trong `app/invoice.py`
(hàm `parse_invoice`). Vì luôn có **form xác nhận**, sai sót nhỏ vẫn sửa được tay.

## OCR (phân loại PDF scan)

PDF chữ: dùng text trực tiếp (không cần OCR). PDF scan (text rỗng): OCR trang đầu.
- Mặc định: `rapidocr-onnxruntime` (pip, tự tải model ONNX lần đầu — cần Internet).
- **Tốt hơn cho tiếng Việt**: cài Tesseract (cần sudo):
  ```bash
  sudo apt install -y tesseract-ocr tesseract-ocr-vie
  ```
  Có tesseract thì `classify` tự ưu tiên dùng (`lang=vie+eng`).

## Kiểm thử

`cd backend && pytest tests/test_bbbg_flow.py` — render BBBG, phân loại 4 loại,
parse hóa đơn thật (skip nếu không có `~/ihoadon.vn_...pdf`).

## Quy tắc chuẩn ký số Biên bản bàn giao (BBBG) & Hợp đồng (iNut Standard)

Áp dụng bắt buộc cho toàn bộ các quy trình sinh và ký số điện tử tài liệu (BBBG, BBNT, Hợp đồng, Giấy chứng nhận xuất xưởng) tại INUT Technology:

### 1. Logo iNut chìm dưới chữ ký số là chuẩn chung
* Con dấu ký số điện tử của Bên A (INUT Technology) bắt buộc phải tích hợp **Logo iNut chìm** (watermark) đặt chính giữa phía sau các dòng chữ thông tin chữ ký (`opacity: 0.16`, `position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%)`).
* Đảm bảo tính thẩm mỹ, chống làm giả, nhận diện thương hiệu công nghệ và đồng bộ giữa bản PDF thể hiện và chứng từ điện tử.

### 2. Đồng bộ tuyệt đối giữa Ngày ký hình họa và Thời gian ký số PDF
* **Nguyên tắc vàng:** Thời gian hiển thị trên con dấu hình họa (`inut_signed_at`) và thời gian ký số mã hóa nhúng trong tệp PDF (trường `/M` của đối tượng Signature dictionary và thuộc tính CMS `signingTime` trong chữ ký số PyHanko/PAdES) **PHẢI GIỐNG NHAU 100% đến từng giây**.
* Cả hai giá trị thời gian này đều phải được lấy đồng nhất theo cùng một tham số thời gian truyền vào (`sign_dt`), tuyệt đối không được để ngày hình họa một đằng, thời gian ký số mật mã một nẻo.

### 3. Quy tắc thời điểm ký số so với Hóa đơn điện tử
* Biên bản bàn giao phải được lập **CÙNG NGÀY** với ngày phát hành hóa đơn điện tử tương ứng.
* Thời điểm ký số điện tử trên BBBG phải diễn ra **SAU thời điểm xuất hóa đơn điện tử** (chuẩn mực khuyến nghị: sau từ 45 đến 55 phút trong cùng ngày phát hành hóa đơn).
* Trình tự kế toán: Xuất HĐĐT thành công và được Cơ quan Thuế cấp mã CQT ─► Sinh BBBG gắn đúng số HĐĐT và danh mục hàng hóa ─► Ký số điện tử Bên A kèm con dấu hình họa và chữ ký PAdES.

### 4. Cấu trúc chuẩn con dấu ký số điện tử Bên A (INUT)
* Khung chữ nhật viền đỏ `#dc2626`, nền `#fff8f8`, bo góc 6px, có bóng đổ nhẹ.
* Dòng 1: `✓ KÝ BỞI: CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT`
* Dòng 2: `MST: 4401053694`
* Dòng 3: `Ngày ký: dd/mm/yyyy HH:MM:SS` (khớp chuẩn xác với tham số `sign_dt`)
* Dòng 4: `✓ Chữ ký số điện tử hợp lệ`
* Phía dưới con dấu: Họ tên đại diện pháp luật (`Ông NGÔ HUỲNH NGỌC KHÁNH`).

---

## Quy chuẩn thiết kế Hợp đồng & Hợp đồng nguyên tắc riêng cho BẢO TOÀN TECH

Áp dụng bắt buộc cho toàn bộ các Hợp đồng, Hợp đồng nguyên tắc, Thỏa thuận cung cấp thiết bị và phần mềm ký với **CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ KỸ THUẬT BẢO TOÀN (Bảo Toàn Tech - MST: 0314360282, Đại diện: Ông Huỳnh Toàn - Giám đốc)**:

### 1. Cấu trúc thị giác và nhận diện thương hiệu song phương
* **Header 2 Logo song phương:**
  * Góc trái: Logo INUT Technology (`width: 58px; height: 58px; object-fit: contain;`).
  * Khối giữa: Tên công ty INUT in hoa xanh đậm `#174b72`, địa chỉ, MST `4401053694`, hotline `0972.768.491`, email `khanhnhn@inut.vn`.
  * Góc phải: Logo chính hãng Bảo Toàn Tech (`https://baotoantech.com/wp-content/uploads/2023/09/Baotoantech-340-%C3%97-156-px.jpg`, hiển thị qua `_remote_logo_data_uri`).
  * Đường kẻ phân cách: Gạch ngang xanh đậm `border-bottom: 2px solid #174b72; padding-bottom: 8px;`.
* **Hiệu ứng "Chữ sáng lên" (Highlight vàng rực rỡ):**
  * Bắt buộc có nhãn revision ở đầu: `<div class="revision-label">BẢN THỎA THUẬN NGUYÊN TẮC · Các điều khoản cốt lõi và nội dung thỏa thuận mới được làm sáng nổi bật</div>`.
  * Dùng cú pháp `==nội dung==` chuyển thành `<mark class="revision">` có nền vàng sáng `#fef08a` (`mark.revision { background: #fef08a; color: #000; padding: 1px 3px; font-weight: 600; }`) để làm nổi bật các điều khoản cốt lõi.
* **Watermark và Chân trang:**
  * Khi chưa ký số (bản nháp): Watermark chéo mờ góc `-28deg` màu đỏ nhạt `BẢN NHÁP – CHƯA CÓ HIỆU LỰC`.
  * Brand watermark: Logo INUT mờ `opacity: 0.045` đặt chính giữa thân trang.
  * Đánh số trang WeasyPrint tự động: `@bottom-center { content: "Trang " counter(page) "/" counter(pages); font-size: 9px; }`.
  * Khối tài khoản ngân hàng: Nền xám xanh `#f1f6f9`, viền xanh dày `#174b72` ghi rõ STK `79713` tại Techcombank.

### 2. Các điều khoản thương mại nguyên tắc bắt buộc cho Bảo Toàn Tech
1. **Cơ chế chốt giá linh hoạt:** Đơn giá thiết bị có tính chất biến động theo từng đợt đặt hàng phụ thuộc vào số lượng và chi phí vi mạch linh kiện tại thời điểm cung ứng; chốt nhanh qua các kênh liên lạc: **Zalo, Email, SMS hoặc Gọi thoại trực tiếp**.
2. **Hóa đơn điện tử kiêm Báo giá chính thức:** Mỗi lần Bên A phát hành Hóa đơn điện tử hợp pháp (Ký hiệu `C26TPK`, kèm BBBG) gửi cho Bên B được mặc định xem là **Bảng báo giá chính thức và xác nhận đơn giá chốt cuối cùng** được Bên B thừa nhận cho đợt hàng đó.
3. **Chính sách công nợ trả chậm:** Thời gian thanh toán trả chậm tối đa **không quá 60 ngày** kể từ ngày Bên A phát hành HĐĐT và BBBG.
4. **Chi phí phát sinh:** Các chi phí ngoài tiền hàng thiết bị (vận chuyển, chuyển phát nhanh, đóng gói, kỹ thuật hiện trường nếu có) sẽ được thông báo và xác nhận trước theo từng lần phát sinh.

### 3. File mẫu chuẩn hóa trong hệ thống
* Template HTML: `backend/app/templates_bbbg/hop_dong_nguyen_tac.html`
* Nội dung điều khoản Markdown: `backend/app/contract_templates/baotoantech_nguyen_tac_2026.md`

---

## Quy chuẩn Soạn thảo & Gửi Email Bàn giao Hồ sơ Khách hàng (Customer Dossier Email Protocol)

Áp dụng bắt buộc cho toàn bộ các hoạt động gửi email bàn giao hồ sơ nghiệm thu, kế toán thuế, hợp đồng kinh tế và thanh toán cho khách hàng của INUT Technology:

### 1. Nguyên tắc vàng: Human-in-the-Loop (Bắt buộc hỏi duyệt trước khi gửi)
* **TUYỆT ĐỐI KHÔNG TỰ Ý GỬI EMAIL NGAY:** Khi người dùng yêu cầu soạn email trên môi trường LLM/Agent, hệ thống **CHỈ ĐƯỢC PHÉP SOẠN BẢN NHÁP (DRAFT PREVIEW)** và dừng lại hỏi người dùng duyệt.
* **Quy trình 4 bước chuẩn mực:**
  1. **Thu thập dữ liệu:** Đọc đúng số hóa đơn, ngày phát hành, mã CQT, mã tra cứu, số tiền cọc (Đợt 1), số tiền còn lại (Đợt 2), điều khoản trả chậm (lên đến 90 ngày) và lấy đủ 4 tệp đính kèm.
  2. **Soạn bản nháp chi tiết:** Hiển thị rõ ràng Người nhận (`To`), Đồng kính gửi (`Cc`), Tiêu đề thư (`Subject`), Bảng tổng hợp đối soát, Khung số tài khoản Techcombank thanh toán phần còn lại, Danh sách 4 file đính kèm và Link tra cứu công khai.
  3. **Chờ phê duyệt:** Dừng lại, hỏi ý kiến người dùng và chỉ tiếp tục khi người dùng phản hồi xác nhận rõ ràng (*"Ok chốt gửi email đi em"*, *"Duyệt gửi"*, *"Gửi đi"*).
  4. **Thực thi & Ghi log:** Gửi email qua SMTP chính thức (`kspprovn@gmail.com`) và ghi nhận vào bảng `audit_logs` của hệ thống.

### 2. Bộ 04 Tệp đính kèm tiêu chuẩn (The 4 Canonical Dossier Files)
1. `Phieu_xac_nhan_dat_hang_<KhachHang>_<SoPhieu>_signed.pdf` (hoặc `Hop_dong_kinh_te_...`): Đã ký số WIN-CA, ghi nhận khoản cọc và điều khoản trả chậm.
2. `Hoa_don_dien_tu_so_<SoHD>_C26TPK_<KhachHang>.pdf`: Bản thể hiện HĐĐT đầy đủ mã CQT.
3. `Hoa_don_dien_tu_so_<SoHD>_C26TPK_<KhachHang>.xml`: File XML dữ liệu gốc có chữ ký số điện tử của iNut phục vụ quyết toán thuế.
4. `Bien_ban_ban_giao_thiet_bi_So_<SoHD>_<KhachHang>_signed.pdf`: Biên bản bàn giao thiết bị lập cùng ngày HĐĐT, đã ký số WIN-CA.

### 3. File mẫu chuẩn hóa trong hệ thống
* Template HTML: `backend/app/templates_email/customer_dossier_email.html`
* Template Text: `backend/app/templates_email/customer_dossier_email.txt`

---

## Quy chuẩn Giấy Đề Nghị Thanh Toán Nhúng VietQR Động (Embedded VietQR Payment Request Standard)

Áp dụng bắt buộc cho toàn bộ các văn bản Đề nghị thanh toán (DNTT), thu hồi công nợ theo đợt hoặc thanh toán hợp đồng cho khách hàng của INUT Technology:

### 1. Bố cục nghiêm ngặt: Vừa vặn đúng 01 trang A4
* Tuyệt đối **không để chữ ký bị tràn sang trang thứ 2** (accidental page spill).
* Margin trang in: `@page { size: A4; margin: 10mm 14mm 10mm; }`.
* Kích thước chữ chuẩn `11.5px`, bảng hàng hóa `11px`, khoảng trống ký số vừa đủ `60px` cho con dấu điện tử.

### 2. Tích hợp mã VietQR động trực tiếp (Embedded Data URI)
* **Cơ chế nhúng:** Tạo mã VietQR động dạng Base64 Data URI (`data:image/png;base64,...`) và nhúng trực tiếp vào thẻ `<img>` đặt cạnh khối thông tin tài khoản ngân hàng.
* **Tham số tạo VietQR chuẩn:**
  * Ngân hàng: Techcombank (Mã định danh BIN: `970407`).
  * Số tài khoản thụ hưởng: `79713`.
  * Tên thụ hưởng viết hoa không dấu: `CONG TY CP DAU TU VA PHAT TRIEN CONG NGHE INUT` (chuẩn độ dài $\le 50$ ký tự theo quy định Napas).
  * Số tiền (`amount`): Khớp chính xác 100% với số tiền còn lại cần thanh toán của đợt này (`con_lai` / `so_tien_dot_nay`).
  * Nội dung thanh toán (`addInfo`): **BẮT BUỘC TIẾNG VIỆT KHÔNG DẤU** (ví dụ: `Khang Linh ELV thanh toan dot 2 HD 43`).

### 3. Ký số điện tử bằng USB Token WIN-CA phần cứng
* Ký số bằng USB Token WINCA trên máy trạm Windows `inut-dev` (`192.168.1.10:22`).
* Thời gian ký số: Khớp cùng ngày phát hành Giấy đề nghị thanh toán.
* Tọa độ ô ký trên Trang 1: `x1=330.0, y1=205.0, x2=530.0, y2=258.0` đặt ngay dưới phần chức danh `TỔNG GIÁM ĐỐC` và phía trên họ tên `NGÔ HUỲNH NGỌC KHÁNH`.

### 4. File mẫu và Lưu trữ
* Template HTML: `backend/app/templates_bbbg/de_nghi_tt.html`
* Phân loại trong CSDL KSP: `doc_type = 'de_nghi_tt'`
* Sinh link chia sẻ bảo mật công khai ngay sau khi ký (`https://ksp-pdf-signer.p2p.inut.io.vn/s/<token>`) để gửi nhanh qua Zalo/Email.

---

## Quy chuẩn Soạn thảo & Luồng Ký Hợp Đồng Giao Khoán (Piecework Contract Protocol)

Áp dụng bắt buộc cho toàn bộ các hoạt động thuê khoán dịch vụ kỹ thuật, khảo sát, lắp đặt, hoa hồng cộng tác viên cá nhân tại INUT Technology:

### 1. Nguyên tắc vàng: Bên A không ký trước – "Bảo ký mới ký"
* **Không tự ý ký số Bên A trước:** Khi tạo hợp đồng giao khoán việc, luôn giữ ở trạng thái **BẢN NHÁP (DRAFT)** (`is_signed_by_inut = False`), không lock văn bản.
* **Cung cấp link Cổng thông tin cho người nhận khoán (`/khoan/{portal_token}`):** Người nhận khoán tự mở link để điền đầy đủ Họ tên, CCCD, ngày cấp, nơi cấp, số điện thoại, địa chỉ thường trú, số tài khoản ngân hàng nhận tiền, tải ảnh CCCD 2 mặt, chụp ảnh chân dung eKYC và ký tên Bên B trước.
* **Tuyệt đối không auto-stamp Bên A:** Loại bỏ cơ chế tự động đóng dấu/ký Bên A khi Bên B gửi chữ ký qua web portal.
* **Chỉ ký số WINCA Bên A khi người dùng duyệt:** Chỉ khi người nhận khoán đã hoàn tất và người dùng kiểm tra nói *"ký đi"* / *"duyệt"* thì mới thực hiện ký số WINCA Bên A.

### 2. Tách bạch tư cách cá nhân nhận khoán độc lập
* Hợp đồng giao khoán dịch vụ là quan hệ dân sự độc lập giữa INUT Technology và cá nhân người nhận khoán (cộng tác viên).
* Tuyệt đối không gắn tên công ty đối tác vào tư cách pháp lý hay nghĩa vụ của Bên B.

### 3. Hỗ trợ định dạng kép: PDF + DOCX
* Luôn sinh đồng thời file `.pdf` bản nháp và file Word `.docx` đầy đủ điều khoản để người dùng kiểm tra hoặc gửi file Word cho cộng tác viên.

### 4. Tính năng Cổng thông tin Mobile Portal thông minh (`/khoan/{token}`)
* **Auto-save `localStorage` chống mất dữ liệu:** Lưu trữ tự động từng ký tự nhập trên form cá nhân; tự động khôi phục ngay khi F5 hoặc mở lại trình duyệt.
* **Ngân hàng linh hoạt:** Không mặc định Techcombank, cho phép người nhận khoán tự điền bất kỳ ngân hàng nào (Vietcombank, MB, ACB, VPBank, v.v.).
* **Nút bấm Sticky "Xem hợp đồng (Realtime)":** Đặt nổi bật ở thanh trên cùng (Top Bar) trên điện thoại. Khi chạm vào, hệ thống tự động đồng bộ bản nháp lên server và mở PDF hiển thị đầy đủ thông tin realtime vừa nhập.
* **Hộp cảnh báo & Hộp thoại xác nhận chống bấm nhầm (Lock Confirmation):**
  - Hộp cảnh báo màu vàng trước nút ký: Thông báo rõ sau khi ký thông tin sẽ bị khóa, muốn sửa phải liên hệ Công ty INUT qua Hotline 0972.768.491.
  - Hộp thoại `confirm()` xác nhận bắt buộc trước khi gửi chữ ký để chống bấm nhầm.
  - Trạng thái đã ký: Khóa form và hướng dẫn liên hệ Hotline INUT.
* **Tự chụp/tải ảnh 2 mặt CCCD & chèn trực tiếp vào Phụ lục Hợp đồng PDF:**
  - Cổng mobile cung cấp 2 ô chụp / tải ảnh mặt trước & mặt sau CCCD (hỗ trợ camera điện thoại).
  - Tự động nén ảnh nhanh và chèn trực tiếp vào trang **"PHỤ LỤC: ẢNH CHỤP CĂN CƯỚC CÔNG DÂN NGƯỜI NHẬN KHOÁN"** trong file PDF hợp đồng phục vụ quyết toán thuế.

### 5. Chuẩn hóa thuật ngữ pháp lý đối ngoại (External Legal Platform Wording)
* Trong toàn bộ các điều khoản thi hành và cam kết chữ ký điện tử của Hợp đồng giao khoán, Hợp đồng kinh tế:
* **TUYỆT ĐỐI KHÔNG DÙNG:** *"trên hệ thống KSP"*.
* **BẮT BUỘC DÙNG:** *"trên nền tảng lưu trữ hợp đồng của Bên A"*.

### 6. Quy tắc đặt số hiệu Hợp đồng bảo mật & Tự động nhúng VietQR thanh toán
* **Quy tắc số hiệu bảo mật (Contract Privacy Numbering):**
  - **Tuyệt đối không đánh số thứ tự đơn thuần (như `01/2026/HĐGK` hay `Số 1`):** Tránh để đối tác hoặc bên ngoài suy đoán được số lượng hợp đồng phát sinh trong năm của công ty.
  - **Quy tắc chuẩn hóa:** Lấy **ngày hợp đồng (dạng `ddmmyyyy`) ghép nối tiếp trước số thứ tự**:
    * Ví dụ ngày 20/09/2026: `20092026-01/HĐGK-INUT` hoặc `20092026-01/HĐGK-INUT-KHANGLINHELV`.
* **Tự động nhúng mã VietQR động trực tiếp vào Điều 2 Hợp đồng:**
  - Khi người nhận khoán điền STK và tên ngân hàng, hệ thống tự động sinh mã VietQR Napas 247 và nhúng trực tiếp cạnh khung thông tin tài khoản thụ hưởng của Bên B (cả trên bản PDF và file Word DOCX).
* **Nội dung chuyển khoản chuẩn hóa bắt buộc ghi ngày ký:**
  - Cú pháp chuẩn tiếng Việt không dấu $\le 50$ ký tự:
    `INUT tt HDGK {code_part} ky {dd.mm} {HO_TEN_THO}`
    *(Ví dụ: `INUT tt HDGK 20092026-01 ky 20.09 TRAN QUOC THANG`)*.
  - Giúp kế toán và cơ quan thuế đối chiếu tức thì ngày ký hợp đồng và người thụ hưởng.

### 7. Quy tắc phân tách Phụ lục riêng biệt & Thời điểm ký số đối soát
* **Phân định tài liệu trong bộ hồ sơ khoán việc:**
  - **Hợp đồng chính + Phụ lục I (CCCD 2 mặt):** Gộp chung làm 01 tài liệu PDF hoàn chỉnh (3 trang), ký vào ngày hợp đồng (ví dụ: `20/09/2026`).
  - **Phụ lục II (Biên bản nghiệm thu & Ảnh hiện trường):** Tài liệu riêng biệt (có file PDF và chữ ký riêng), phản ánh công việc hoàn thành và nghiệm thu thực tế tại công trình.
  - **Phụ lục III (Xác nhận thanh toán & Thanh lý HĐ kèm UNC):** Tài liệu riêng biệt (có file PDF và chữ ký riêng), phản ánh nghĩa vụ chi trả ngân hàng đã hoàn tất.
* **Quy tắc thời điểm ký số logic cho các Phụ lục:**
  - **Phụ lục II (Nghiệm thu):** Ký vào **ngày xuất hóa đơn điện tử** và **trước thời điểm xuất hóa đơn** (ví dụ HĐ 43 xuất lúc 22:03 ngày 24/09/2026 thì Phụ lục II ký lúc `16:30:00 ngày 24/09/2026`).
  - **Phụ lục III (Thanh toán & UNC):** Ký **sau thời điểm lập Ủy nhiệm chi** trên ứng dụng ngân hàng. Nếu ngày submit trùng ngày trên UNC thì lấy thời điểm realtime trong ngày (sau giờ tạo lệnh UNC, ví dụ: lệnh tạo lúc 09:22 SA thì ký lúc 09:45 SA).
* **Hiển thị trên Cổng Portal (`/khoan/{token}`):** Hiển thị danh mục 3 khối hồ sơ riêng biệt kèm nút xem trực tiếp từng bản PDF để người nhận khoán và ban giám đốc đối chiếu độc lập.
