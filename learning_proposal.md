# Learning Proposal: Chuẩn Hóa Ký Số Doanh Nghiệp (WINCA), Thiết Kế Hợp Đồng BẢO TOÀN TECH, Quy Trình Gửi Email Hồ Sơ Khách Hàng & Giấy Đề Nghị Thanh Toán Nhúng VietQR Động

## 1. Classification & Scope
- **Category:** Domain Rule, Document Design Standard, Customer Communication Protocol & System Security Policy
- **Scope:** 
  1. Toàn bộ quy trình ký số PDF cho văn bản pháp lý doanh nghiệp tại INUT Technology (BBBG, BBNT, Hợp đồng, Giấy xuất xưởng, Giấy đề nghị thanh toán).
  2. Toàn bộ quy trình soạn thảo và ban hành Hợp đồng / Hợp đồng nguyên tắc riêng cho đối tác **BẢO TOÀN TECH** (`CÔNG TY TNHH TM DV KỸ THUẬT BẢO TOÀN` - MST: `0314360282`).
  3. **Quy trình gửi email bàn giao hồ sơ khách hàng (Customer Dossier Email Protocol)**: Bắt buộc Human-in-the-Loop và áp dụng mẫu template 4 tệp đính kèm chuẩn hóa cho mọi khách hàng (Fuji, ELV, Bảo Toàn, v.v.).
  4. **Quy chuẩn Giấy đề nghị thanh toán nhúng mã VietQR động (Embedded VietQR Payment Request Standard)**: Áp dụng cho mọi đợt thanh toán công nợ và thu hồi vốn dự án.
---

## 2. Rationale & Core Problem
1. **Rủi ro chữ ký số không hợp lệ:** Khi xuất tài liệu giao dịch với khách hàng/thuế, việc dùng chứng thư phần mềm tự sinh (Self-signed mock CA) sẽ bị cơ quan quản lý và đối tác từ chối. Bắt buộc phải ký bằng **USB Token WINCA phần cứng chính thức** trên máy trạm `inut-dev` (`192.168.1.10`).
2. **Lỗi lệch pha mốc thời gian:** Thời gian trên con dấu hình họa (`inut_signed_at`) và thời gian ký số mã hóa (`/M` & CMS `signingTime`) phải khớp nhau 100% đến từng giây.
3. **Yêu cầu phong cách hợp đồng riêng cho Bảo Toàn Tech:**
   - Người dùng yêu cầu phong cách thiết kế hợp đồng cho Bảo Toàn Tech phải giữ đúng nhận diện: **Header 2 logo song phương (INUT & Bảo Toàn Tech)**, đường kẻ `#174b72`, watermark chìm, hiệu ứng **"Chữ sáng lên" (Highlight vàng rực rỡ `#fef08a`)** trên các điều khoản cốt lõi (`==...==`), bảng ngân hàng Techcombank, và điều khoản trả chậm 60 ngày.

---

## 3. Quy Tắc Bắt Buộc

### Phần A: Quy tắc ký số bằng USB Token WINCA (iNut Standard)
* **Thiết bị ký số:** USB Token WINCA cắm tại `inut-dev` (IP: `192.168.1.10`, Port: `22` SSH):
  * Cert ID: `6616B8A61F228D0EAFF8AAF5F44F3ECD660DD8CD`
  * Issuer: `C=VN, O=WINGROUP, CN=WINCA`
  * Subject: `OID.0.9.2342.19200300.100.1.1=MST:4401053694, CN=CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT`
  * PIN: `12345678`
* **Con dấu ký số hình họa:**
  * Bắt buộc có **Logo iNut chìm ở giữa** (`settings.logo_path`, `opacity: 0.16`).
  * Khung viền mỏng đỏ/xanh, hiển thị đầy đủ thông tin pháp nhân và ngày ký.
* **Đồng bộ thời gian:** `ts` hiển thị và thuộc tính `/M` của PDF phải **khớp 100% từng giây** theo tham số `sign_dt`. Ký số diễn ra sau giờ xuất HĐĐT từ 45 - 55 phút trong cùng ngày.

### Phần B: Mẫu thiết kế Hợp đồng cố định cho BẢO TOÀN TECH
* **Template chuẩn:** `backend/app/templates_bbbg/hop_dong_nguyen_tac.html`
* **Nội dung điều khoản chuẩn:** `backend/app/contract_templates/baotoantech_nguyen_tac_2026.md`
* **Nhận diện Header 2 Logo:**
  * Bên trái: Logo INUT Technology (`width: 58px; height: 58px;`).
  * Bên phải: Logo Bảo Toàn Tech (`https://baotoantech.com/wp-content/uploads/2023/09/Baotoantech-340-%C3%97-156-px.jpg`).
  * Gạch ngang phân cách: `border-bottom: 2px solid #174b72; padding-bottom: 8px;`.
* **Hiệu ứng "Chữ sáng lên":**
  * Cú pháp `==nội dung==` chuyển thành `<mark class="revision">` có nền vàng sáng `#fef08a` (`font-weight: 600`).
* **Các điều khoản nguyên tắc đặc thù của Bảo Toàn Tech:**
  1. *Cơ chế chốt giá linh hoạt:* Đơn giá thiết bị biến động theo từng lần chốt qua Zalo, Email, SMS hoặc Gọi thoại trực tiếp.
  2. *Hóa đơn điện tử kiêm Báo giá:* Mỗi HĐĐT GTGT xuất ra (kèm BBBG) là Bảng báo giá chính thức xác nhận đơn giá chốt cuối cùng.
  3. *Chính sách trả chậm:* Thời gian trả chậm tối đa **60 ngày** kể từ ngày xuất HĐĐT và BBBG.
  4. *Chi phí phát sinh khác:* Thông báo và xác nhận trước theo từng đợt.
* **Watermark bản nháp:** `BẢN NHÁP – CHƯA CÓ HIỆU LỰC` chéo `-28deg` màu đỏ nhạt khi chưa ký số.

### Phần C: Quy trình Kiểm soát Gửi Email Khách Hàng (Human-in-the-Loop Approval Rule)
* **NGUYÊN TẮC BẮT BUỘC:** Tuyệt đối **KHÔNG ĐƯỢC TỰ Ý GỬI EMAIL NGAY** khi tương tác qua chat Agent LLM.
* **Quy trình 4 bước bắt buộc:**
  1. *Soạn thảo bản nháp (Draft Preview):* Trích xuất đầy đủ thông tin Người nhận (`To`), Đồng kính gửi (`Cc`), Người gửi (`From`), Tiêu đề thư (`Subject`), Bảng thông tin tóm tắt dự án/hóa đơn, Khung thông tin tài khoản chuyển tiền Đợt 2, Danh sách 4 file đính kèm đầy đủ, Link tra cứu bảo mật.
  2. *Trình duyệt:* Hiển thị toàn văn bản nháp lên cửa sổ hội thoại để người dùng kiểm duyệt.
  3. *Chờ phê duyệt rõ ràng:* Dừng lại và hỏi người dùng. Chỉ thực hiện gửi khi người dùng ra lệnh xác nhận rõ ràng (ví dụ: *"Ok chốt gửi email đi em"*, *"Duyệt gửi"*, *"Gửi đi"*).
  4. *Thực thi & Ghi vết:* Gửi email qua SMTP chính thức (`kspprovn@gmail.com`) và ghi nhận sự kiện vào bảng `audit_logs`.

### Phần D: Mẫu Email Bàn Giao Trọn Bộ Hồ Sơ Cho Khách Hàng (Dossier Template)
* **Bộ 04 tệp đính kèm tiêu chuẩn:**
  1. `Phieu_xac_nhan_dat_hang_<KhachHang>_<SoPhieu>_signed.pdf` (hoặc `Hop_dong_kinh_te_...`): Đã ký số WIN-CA, ghi nhận cọc và điều khoản trả chậm linh hoạt (lên đến 90 ngày).
  2. `Hoa_don_dien_tu_so_<SoHD>_C26TPK_<KhachHang>.pdf`: Bản thể hiện HĐĐT đầy đủ mã CQT.
  3. `Hoa_don_dien_tu_so_<SoHD>_C26TPK_<KhachHang>.xml`: File XML dữ liệu gốc có chữ ký số điện tử của iNut phục vụ quyết toán thuế.
  4. `Bien_ban_ban_giao_thiet_bi_So_<SoHD>_<KhachHang>_signed.pdf`: Biên bản bàn giao thiết bị lập cùng ngày HĐĐT, đã ký số WIN-CA.
* **Bảng tổng hợp đối soát trong email:** Khách hàng, MST, Địa chỉ, Tên gói hàng hóa/giải pháp, Giá trước thuế, Thuế GTGT 8%, Tổng thanh toán, Đợt 1 (Cọc), Đợt 2 (Phần còn lại trả chậm), Mã CQT & Mã tra cứu HĐĐT, BBBG, Thời hạn bảo hành 24 tháng.
* **Khung chuyển khoản Techcombank:** STK `79713` tại Techcombank, tên thụ hưởng, cú pháp chuyển khoản rõ ràng.
* **Link xem trực tuyến:** Link công khai an toàn qua KSP PDF-Sign.
* **File template lưu trữ vĩnh viễn trong mã nguồn:**
  * `backend/app/templates_email/customer_dossier_email.html`
  * `backend/app/templates_email/customer_dossier_email.txt`


### Phần E: Quy Chuẩn Giấy Đề Nghị Thanh Toán Nhúng VietQR Động (Embedded VietQR DNTT)
* **Bố cục chặt chẽ:** Bắt buộc vừa vặn trên **đúng 01 trang A4 duy nhất**, không để chữ ký hay khối đóng dấu bị tràn sang trang thứ 2 (`@page { size: A4; margin: 10mm 14mm 10mm; }`).
* **Nhúng trực tiếp VietQR động:**
  * Tạo mã VietQR động dạng Base64 Data URI từ API Napas (`https://api.vietqr.io/v2/generate`).
  * Ngân hàng: Techcombank (`970407`).
  * Số tài khoản: `79713`.
  * Tên thụ hưởng viết hoa không dấu ($\le 50$ ký tự): `CONG TY CP DAU TU VA PHAT TRIEN CONG NGHE INUT`.
  * Số tiền thanh toán: Khớp chính xác 100% với số tiền đề nghị thanh toán của đợt này (`con_lai` / `so_tien_dot_nay`).
  * Nội dung chuyển khoản: **BẮT BUỘC TIẾNG VIỆT KHÔNG DẤU** (ví dụ: `Khang Linh ELV thanh toan dot 2 HD 43`).
  * Nhúng ảnh trực tiếp vào thẻ `<img>` đặt cạnh khối thông tin tài khoản ngân hàng.
* **Ký số USB Token WINCA phần cứng:**
  * Ký số bằng USB Token WINCA trên máy trạm Windows `inut-dev` (`192.168.1.10:22`).
  * Thời gian ký số: Ngày hiện tại phát hành văn bản đề nghị thanh toán.
  * Tọa độ ô ký số trên Trang 1: `[330, 205, 530, 258]`.
* **Tích hợp CSDL & Chia sẻ:** Lưu vào bảng `documents` với `doc_type = 'de_nghi_tt'` và sinh public share link ngay lập tức để gửi khách qua Zalo/Email.

### Phần F: Quy Chuẩn Soạn Thảo & Luồng Ký Hợp Đồng Giao Khoán (Piecework Contract Protocol)
* **NGUYÊN TẮC BẮT BUỘC: BÊN A KHÔNG KÝ TRƯỚC, CHỈ KÝ KHI NGƯỜI DÙNG DUYỆT ("BẢO KÝ MỚI KÝ")**:
  1. *Khởi tạo hợp đồng ở trạng thái BẢN NHÁP (DRAFT):* `is_signed_by_inut = False`, không lock văn bản.
  2. *Cung cấp link Cổng thông tin cho người nhận khoán (`/khoan/{portal_token}`):* Cho phép thợ/cộng tác viên tự vào điền đầy đủ Họ tên, CCCD, ngày cấp, nơi cấp, số điện thoại, địa chỉ, số tài khoản ngân hàng, tải ảnh CCCD 2 mặt, chụp ảnh chân dung eKYC và ký tên Bên B trước.
  3. *Tuyệt đối không auto-stamp Bên A:* Loại bỏ cơ chế tự động ký/đóng dấu Bên A khi Bên B ký qua portal.
  4. *Bên A chỉ ký sau khi người dùng kiểm tra và ra lệnh ký:* Chỉ thực hiện ký số WINCA Bên A khi người nhận khoán đã hoàn tất và người dùng ra lệnh xác nhận.
* **Tách bạch tư cách cá nhân nhận khoán:** Khi giao khoán dịch vụ/hoa hồng kỹ thuật cho nhân sự, hợp đồng là quan hệ dân sự độc lập giữa iNut và cá nhân đó, tuyệt đối không gắn tên công ty đối tác vào tư cách pháp lý hay nghĩa vụ của Bên B.
* **Hỗ trợ định dạng kép (PDF + DOCX):** Luôn sinh cả file `.pdf` và file Word `.docx` kèm link chia sẻ để người dùng tải và xem trước.
* **Trải nghiệm Mobile Portal Thông Minh (`/khoan/{token}`):**
  * *Tự động lưu nháp vào `localStorage`:* Mọi ký tự nhập vào Họ tên, CCCD, SĐT, Địa chỉ, STK ngân hàng được lưu ngay tức thì vào `localStorage`. Khi người dùng F5 hoặc reload trang, toàn bộ thông tin tự động được khôi phục, không bao giờ bị mất dữ liệu.
  * *Tên ngân hàng không mặc định Techcombank:* Trường tên ngân hàng để trống kèm placeholder đa dạng (`Vietcombank, MB, Techcombank, ACB, VPBank...`) để người nhận khoán tự do điền ngân hàng chính chủ của mình.
  * *Thanh dính trên cùng (Sticky Top Bar) & Nút "Xem hợp đồng (Realtime)":* Đặt cố định ở đầu trang trên điện thoại với đèn trạng thái tự động lưu nháp và nút bấm `Xem hợp đồng (Realtime)`. Khi bấm, hệ thống tự động đồng bộ bản nháp mới nhất lên server, biên dịch PDF ngay tức khắc và mở file PDF chuẩn xác từng chi tiết mà người dùng vừa nhập.
  * *Hộp cảnh báo & Hộp thoại xác nhận trước khi ký (Lock Confirmation Dialog):*
    - Trước khi ký: Hiển thị hộp cảnh báo màu vàng nổi bật: *"Bằng việc bấm xác nhận ký tên, bạn xác nhận toàn bộ thông tin cá nhân và tài khoản ngân hàng trên là chính xác. Sau khi ký thành công, thông tin hợp đồng sẽ được KHÓA CHÍNH THỨC và bạn KHÔNG THỂ TỰ Ý CHỈNH SỬA. Muốn chỉnh sửa sau đó, bạn phải liên hệ Công ty INUT (Hotline: 0972.768.491) để được hỗ trợ mở khóa."*
    - Khi bấm ký: Bật hộp thoại `confirm()` xác nhận dứt khoát lần 2 để chống bấm nhầm.
    - Sau khi ký: Khóa hoàn toàn form nhập liệu, hiển thị dấu tích xanh và thông báo đã khóa, hướng dẫn liên hệ Hotline INUT nếu có sai sót cần chỉnh sửa.
    - Phía quản trị: Cung cấp endpoint `POST /api/piecework/contracts/{cid}/unlock` để admin chủ động mở khóa hợp đồng khi cần thiết.
  * *Tự Chụp / Tải CCCD 2 Mặt & Chèn Trực Tiếp Vào Phụ Lục Hợp Đồng PDF:*
    - Trên Cổng Mobile: Cung cấp 2 khung tải/chụp trực tiếp từ camera hoặc thư viện ảnh cho *Ảnh Mặt trước CCCD* và *Ảnh Mặt sau CCCD*. Tự động nén ảnh tối ưu đường truyền và hiển thị thumbnail tức thời.
    - Tự động nhúng vào PDF: Khi có ảnh 2 mặt CCCD, hệ thống tự động sinh thêm trang **"PHỤ LỤC: ẢNH CHỤP CĂN CƯỚC CÔNG DÂN NGƯỜI NHẬN KHOÁN"** ở cuối file PDF Hợp đồng (gồm ảnh chụp sắc nét 2 mặt, khung viền, mã hợp đồng và cam kết xác thực nhân thân chính chủ của người nhận khoán).
* **Quy Tắc Đặt Số Hiệu Hợp Đồng Bảo Mật (Contract Privacy Numbering):**
  * Tuyệt đối không đánh số thứ tự đơn thuần (như `01/2026/HĐGK` hay `Số 1`) để tránh lộ số lượng hợp đồng phát sinh trong năm của công ty.
  * Lấy **ngày hợp đồng (`ddmmyyyy`) ghép trước số thứ tự**: Ví dụ `20092026-01/HĐGK-INUT-KHANGLINHELV`.
* **Tự Động Nhúng Mã VietQR Kèm Nội Dung Chuyển Khoản Ghi Rõ Ngày Ký:**
  * Tự động sinh mã VietQR Napas 247 và nhúng thẳng vào Điều 2 của Hợp đồng khi người nhận khoán điền STK & Tên ngân hàng.
  * Nội dung chuyển khoản chuẩn hóa tiếng Việt không dấu: `INUT tt HDGK {code_part} ky {dd.mm} {HO_TEN_THO}` (ví dụ: `INUT tt HDGK 20092026-01 ky 20.09 TRAN QUOC THANG`).
* **Chuẩn Hóa Thuật Ngữ Pháp Lý Đối Ngoại (External Legal Platform Wording Rule):**
  * Trong toàn bộ các điều khoản thi hành, cam kết chữ ký điện tử của Hợp đồng giao khoán, Hợp đồng kinh tế gửi khách hàng / cộng tác viên bên ngoài:
  * **TUYỆT ĐỐI KHÔNG DÙNG THUẬT NGỮ TÊN MÃ NỘI BỘ "HỆ THỐNG KSP"**.
  * **BẮT BUỘC DÙNG:** *"trên nền tảng lưu trữ hợp đồng của Bên A"* (hoặc *"trên nền tảng điện tử của Bên A"*).
---

## 4. Code & Document Changes Applied
1. `docs/bbbg-va-phan-loai.md`: Đã cập nhật đầy đủ 2 chương:
   - `## Quy tắc chuẩn ký số Biên bản bàn giao (BBBG) & Hợp đồng (iNut Standard)`
   - `## Quy chuẩn thiết kế Hợp đồng & Hợp đồng nguyên tắc riêng cho BẢO TOÀN TECH`
2. `backend/app/templates_bbbg/hop_dong_nguyen_tac.html`: Tạo mới template chuẩn hóa vĩnh viễn cho Hợp đồng nguyên tắc.
3. `backend/app/contract_templates/baotoantech_nguyen_tac_2026.md`: Lưu trữ nội dung điều khoản mẫu có đánh dấu highlight vàng `==...==`.
4. Link public trên KSP PDF-Sign luôn đồng bộ theo đúng mẫu này:
   - PDF: `https://ksp-pdf-signer.p2p.inut.io.vn/s/tOyOEdhnCnuDCN4LnhTS1g`
   - DOCX: `https://ksp-pdf-signer.p2p.inut.io.vn/s/_3HmqQvlyWUOCiv64BlO7w`
5. `backend/app/templates_email/customer_dossier_email.html`: Template HTML gửi email bàn giao hồ sơ chuẩn hóa cho khách hàng.
6. `backend/app/templates_email/customer_dossier_email.txt`: Template Plain Text tương ứng.
7. Đã ghi nhận nhật ký kiểm toán `audit_logs` cho sự kiện gửi email hồ sơ dự án Fuji.
8. `backend/app/templates_bbbg/de_nghi_tt.html`: Tối ưu CSS vừa vặn 1 trang A4 và hỗ trợ hiển thị VietQR động bên cạnh khối tài khoản.
9. Tạo và ký số thành công Giấy đề nghị thanh toán Đợt 2 cho Khang Linh ELV (Doc ID 195) kèm mã VietQR 9.606.600đ và share link công khai.
10. `backend/app/piecework_api.py`: Bổ sung form điền thông tin cá nhân và tài khoản trên Cổng portal `/khoan/{token}`, loại bỏ auto-stamp Bên A để tuân thủ nguyên tắc "bảo ký mới ký".
11. Đã hủy ký và chuyển Hợp đồng giao khoán số `01/2026/HĐGK-INUT-KHANGLINHELV` (2.668.500đ) về trạng thái Bản nháp mở, sinh file Word DOCX (Doc ID 197) và link public.
12. `backend/app/piecework_api.py`: Tích hợp `localStorage` auto-save & restore, Sticky Top Bar trên Mobile với nút "Xem hợp đồng (Realtime)", endpoint `/api/public/khoan/{token}/save-draft` đồng bộ dữ liệu thời gian thực và bỏ mặc định Techcombank.
13. `backend/app/templates_bbbg/hop_dong_giao_khoan.html` & file Word DOCX: Sửa dứt điểm câu chữ Điều 4.2 thành *"trên nền tảng lưu trữ hợp đồng của Bên A"* thay cho *"trên hệ thống KSP"*.
14. `backend/app/piecework_api.py`: Thêm hộp thoại xác nhận `confirm()`, cảnh báo khóa thông tin trước khi ký, hiển thị thông báo liên hệ INUT sau khi ký và bổ sung endpoint mở khóa `/api/piecework/contracts/{cid}/unlock`.
15. `backend/app/piecework_api.py` & `backend/app/templates_bbbg/hop_dong_giao_khoan.html`: Tích hợp tính năng tự chụp/tải 2 mặt CCCD trên mobile portal và tự động chèn Phụ lục ảnh CCCD sắc nét vào cuối file PDF hợp đồng.
16. Cập nhật mã hợp đồng khoán thành `20092026-01/HĐGK-INUT-KHANGLINHELV` ngày 20/09/2026, tự động sinh mã VietQR nhúng Điều 2 với nội dung `INUT tt HDGK 20092026-01 ky 20.09 TRAN QUOC THANG` trên cả PDF và DOCX.
