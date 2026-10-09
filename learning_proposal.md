# Learning Proposal: Quy Trình Tổng Thể Vòng Đời Dự Án, Bảng Bất Biến Trình Tự & Cơ Chế Cảnh Báo Vượt Cấp (Project Lifecycle SOP & Anti-Skip Guardrails)

## 1. Classification & Scope
- **Category:** Master Engineering & Operational SOP, Anti-Skip Sequencing Rules, Document Security Policy & Assistant Escalation Protocol.
- **Scope:** 
  1. Toàn bộ quy trình điều hành dự án công nghệ, cung cấp thiết bị phần cứng IoT (Data Logger, Camera, Radar, Kiosk) và khoán việc thi công tại INUT Technology.
  2. Toàn bộ chuỗi phát hành và thẩm định văn bản pháp lý (Hợp đồng, Phụ lục, BBBG, BBNT, Hóa đơn điện tử, Đề nghị thanh toán).
  3. **Quy tắc bắt buộc đối với AI Assistant:** Nắm vững toàn bộ vòng đời dự án; nếu người dùng vô tình làm sai, bỏ bước hoặc thao tác vượt cấp (out-of-sequence), trợ lý **BẮT BUỘC PHẢI LẬP TỨC CẢNH BÁO, NÊU RÕ RỦI RO VÀ ĐƯA RA GIẢI PHÁP ĐÚNG QUY CHUẨN**.

---

## 2. Rationale & Core Problem
1. **Rủi ro hồi tố thuế & vi phạm pháp lý:** Việc xuất hóa đơn trước khi nghiệm thu, ký biên bản bàn giao trước giờ xuất hóa đơn, hay thanh lý hợp đồng khoán trước khi có lệnh chuyển tiền ngân hàng sẽ bị Cơ quan Thuế và Thanh tra chuyên ngành bóc tách, coi là hóa đơn khống hoặc chứng từ phi lý logic.
2. **Rủi ro lộ bí mật kinh doanh & quy mô doanh nghiệp:** Việc đánh số hợp đồng tuần tự (`01`, `02`) giúp đối thủ và đối tác nắm được số lượng giao dịch phát sinh trong năm của công ty.
3. **Rủi ro tranh chấp lao động:** Không tách bạch cá nhân nhận khoán độc lập hoặc nhầm lẫn tên doanh nghiệp đối tác vào hợp đồng khoán việc cá nhân sẽ dẫn đến rủi ro bị quy kết là quan hệ lao động trá hình hoặc tranh chấp hoa hồng.
4. **Rủi ro gửi nhầm / thông tin sai lệch cho khách hàng:** Thao tác tự ý gửi email mà không qua bước duyệt bản nháp (Human-in-the-Loop) có thể gây tổn hại uy tín thương hiệu.

---

## 3. Quy Trình Tổng Thể Vòng Đời Dự Án (7 Bước Chuẩn Mực)

```mermaid
graph TD
    S1[Bước 1: Chốt Báo giá / Phiếu Đặt Hàng & Nhận Cọc Đợt 1] --> S2[Bước 2: Soạn HĐ Giao Khoán Thi Công Hiện Trường - Bản Nháp]
    S2 --> S3[Bước 3: Bên B Điền CCCD, STK & Ký Online eKYC qua Portal]
    S3 --> S4[Bước 4: Thi Công Xong -> Lập Phụ Lục II Nghiệm Thu & Ảnh Hiện Trường]
    S4 --> S5[Bước 5: Xuất HĐĐT iHOADON & Ký WINCA BBBG Cùng Ngày]
    S5 --> S6[Bước 6: Chuyển Tiền Thù Lao UNC -> Lập Phụ Lục III Thanh Lý HĐGK]
    S6 --> S7[Bước 7: Lập Giấy ĐNTT Đợt 2 Khách Hàng -> Soạn Email Trình Duyệt]
```

### Bước 1: Tiếp nhận Đơn hàng & Xác nhận Giao dịch (Khách hàng)
* **Văn bản:** Báo giá chính thức hoặc **Phiếu xác nhận đặt hàng / mua hàng** (có giá trị thay thế Hợp đồng kinh tế đối với đơn hàng linh hoạt).
* **Tiến độ thanh toán:** Thường chia 2 đợt (Đợt 1: Cọc ~50%; Đợt 2: Trả chậm linh hoạt lên đến 60–90 ngày).
* **Minh chứng:** Đối soát sao kê ngân hàng Techcombank (`79713`), ghi nhận mã giao dịch nhận cọc (ví dụ: `FT26...`).

### Bước 2: Khởi tạo Hợp đồng Giao khoán việc Cá nhân (Thi công / Lắp đặt)
* **Bản chất pháp lý:** Quan hệ dân sự độc lập giữa INUT (Bên A) và **Cá nhân chuyên môn nhận khoán độc lập (Bên B)**, không gắn tên công ty đối tác vào tư cách Bên B.
* **Quy tắc số hiệu bảo mật:** Bắt buộc dạng `{ddmmyyyy}-01/HĐGK-INUT...` (ví dụ: `20092026-01/HĐGK-INUT-KHANGLINHELV`), tuyệt đối không đánh số thứ tự đơn thuần `01/2026/HĐGK`.
* **Định mức thù lao:** Căn cứ tỷ lệ khoán (ví dụ: 15% giá trị trước VAT). Nếu thù lao $< 5.000.000$ đ thì miễn khấu trừ 10% thuế TNCN theo Khoản 2 Điều 50 Nghị định 253/2026/NĐ-CP.
* **Nguyên tắc "Bảo ký mới ký":** Khởi tạo ở trạng thái **Bản nháp mở (Draft - Unlocked)**, Bên A không ký trước.

### Bước 3: Người nhận khoán điền thông tin & Ký tên Online qua Cổng Portal
* **Liên kết Portal:** Gửi link `/khoan/{token}` cho cộng tác viên.
* **Tính năng thông minh:**
  * Auto-save `localStorage` chống mất dữ liệu khi F5/reload.
  * Tên ngân hàng nhận thù lao để trống tự do (không mặc định Techcombank).
  * Tải / Chụp ảnh CCCD 2 mặt (Mặt trước + Mặt sau).
  * Chụp ảnh chân dung eKYC (chống chối bỏ) và vẽ chữ ký tay cảm ứng (iOS Safari Pointer Events).
  * Cảnh báo màu vàng và hộp thoại `confirm()` xác nhận: Sau khi ký sẽ khóa hợp đồng, muốn sửa phải liên hệ Hotline INUT (`0972.768.491`).
* **Phụ lục I (CCCD):** Tự động sinh trang *Phụ lục I: Ảnh chụp CCCD* gộp chung vào file PDF Hợp đồng (3 trang).

### Bước 4: Thi công hoàn tất & Lập Phụ lục II (Nghiệm thu hiện trường)
* **Văn bản:** *Phụ lục II: Biên bản nghiệm thu hoàn thành công việc & Ảnh hiện trường* (file PDF riêng biệt, tên file chứa mã HĐGK).
* **Mốc thời gian ký bắt buộc:** Ký vào **ngày xuất hóa đơn điện tử** và **TRƯỚC thời điểm xuất hóa đơn** (ví dụ HĐĐT xuất lúc 22:03 ngày 24/09 thì Nghiệm thu ký lúc `16:30:00 ngày 24/09`).
* **Đính kèm:** Tối thiểu 02 ảnh hiện trường thực tế (thiết bị màn hình/datalogger + kiểm thử luồng tín hiệu/camera).

### Bước 5: Phát hành Hóa đơn điện tử & Ký số WINCA Biên bản bàn giao (BBBG)
* **Hóa đơn điện tử (HĐĐT):** Phát hành qua hệ thống iHOADON, lấy mã Cơ quan Thuế cấp hợp lệ.
* **Biên bản bàn giao thiết bị (BBBG):** Lập **CÙNG NGÀY** với HĐĐT, ký số USB Token WINCA phần cứng trên máy `inut-dev` (`192.168.1.10:22`) **SAU giờ xuất HĐĐT từ 45 đến 55 phút**.

### Bước 6: Chi trả thù lao & Lập Phụ lục III (Thanh toán & Thanh lý HĐGK)
* **Thanh toán:** Kế toán tạo lệnh chuyển khoản ngân hàng (Techcombank Business) chi trả thù lao khoán việc.
* **Nội dung chuyển khoản chuẩn:** `INUT tt HDGK {code_part} ky {dd.mm} {HO_TEN_THO}` (ví dụ: `INUT tt HDGK 20092026-01 ky 20.09 TRAN QUOC THANG`).
* **Văn bản:** *Phụ lục III: Biên bản xác nhận thanh toán & Thanh lý HĐ* (file PDF riêng biệt, tên file chứa mã HĐGK).
* **Mốc thời gian ký bắt buộc:** Ký **SAU thời điểm tạo lệnh Ủy nhiệm chi** trên ứng dụng ngân hàng (ví dụ: lệnh tạo lúc 09:22 SA ngày 09/10 thì ký lúc `09:55:52 SA ngày 09/10`).

### Bước 7: Thu hồi công nợ Đợt 2 Khách hàng & Bàn giao Hồ sơ
* **Giấy Đề nghị thanh toán (DNTT):** Vừa vặn đúng **01 trang A4 duy nhất**, nhúng mã VietQR động trực tiếp (Techcombank `79713`, đúng số tiền còn lại, nội dung tiếng Việt không dấu có ngày ký), ký số WINCA.
* **Gửi email bàn giao hồ sơ:** Áp dụng mẫu email chuẩn hóa (Dossier Template), bắt buộc tuân thủ **Human-in-the-Loop** (chỉ soạn nháp trình duyệt, chỉ gửi khi người dùng bấm xác nhận).

---

## 4. Bảng Bất Biến Trình Tự Thời Gian (Sequence Invariants)

| Cặp sự kiện | Quan hệ thời gian bắt buộc | Lý do pháp lý / kế toán thuế |
| :--- | :---: | :--- |
| **HĐ Giao khoán** vs **Nghiệm thu (PL2)** | $T_{\text{HĐGK}} < T_{\text{Nghiệm thu}}$ | Phải có hợp đồng giao việc trước khi thi công và nghiệm thu. |
| **Nghiệm thu (PL2)** vs **Hóa đơn điện tử** | $T_{\text{Nghiệm thu}} \le T_{\text{HĐĐT}}$<br>*(Cùng ngày, trước giờ HĐ)* | Hàng hóa/dịch vụ phải được nghiệm thu hoàn thành trước khi lập hóa đơn GTGT giao khách. |
| **Hóa đơn điện tử** vs **BBBG thiết bị** | $T_{\text{HĐĐT}} < T_{\text{BBBG}}$<br>*(Cùng ngày, sau 45–55p)* | Hóa đơn xuất và cấp mã CQT xong mới tiến hành bàn giao thực tế và đóng dấu điện tử. |
| **Lệnh Ủy nhiệm chi** vs **Thanh lý (PL3)** | $T_{\text{Lệnh UNC}} \le T_{\text{Thanh lý}}$ | Tiền phải được thực chuyển thành công trước khi ký xác nhận đã nhận đủ tiền và thanh lý hợp đồng. |
| **Ký Bên B** vs **Ký số WINCA Bên A** | $T_{\text{Ký Bên B}} \le T_{\text{Ký Bên A}}$ | Người nhận khoán điền thông tin và ký xác nhận trước, người dùng duyệt rồi Bên A mới ký số WINCA. |
| **Dấu hình họa** vs **Tem mật mã PAdES `/M`** | $T_{\text{Hình họa}} \equiv T_{\text{PAdES /M}}$<br>*(Khớp 100% từng giây)* | Chống lỗi lệch pha thời gian con dấu và chữ ký số mật mã khi kiểm tra trên Foxit/Acrobat/NEAC. |

---

## 5. Cơ Chế Cảnh Báo Vượt Cấp & Can Thiệp Của Trợ Lý (Anti-Skip Guardrails)

Khi người dùng ra lệnh trong quá trình chat, Assistant **BẮT BUỘC PHẢI CHỦ ĐỘNG BẬT CẢNH BÁO** trong các trường hợp sau:

1. **Cảnh báo khi yêu cầu ký Bên A trước:**
   * *Hành vi sai:* Yêu cầu ký số WINCA Bên A khi hợp đồng giao khoán còn đang là bản nháp chưa có thông tin Bên B.
   * *Phản ứng trợ lý:* **DỪNG LẠI & CẢNH BÁO:** *"Hợp đồng giao khoán việc cần để ở trạng thái Bản nháp mở để người nhận khoán tự vào link điền thông tin cá nhân, CCCD và ký trước. Khi nào họ hoàn tất và anh duyệt thì em mới kích hoạt ký số Bên A."*
2. **Cảnh báo khi mốc thời gian nghiệm thu sau giờ hóa đơn:**
   * *Hành vi sai:* Đặt ngày/giờ nghiệm thu sau thời điểm xuất hóa đơn điện tử.
   * *Phản ứng trợ lý:* **DỪNG LẠI & CẢNH BÁO:** *"Nghiệm thu công việc phải diễn ra TRƯỚC thời điểm phát hành hóa đơn điện tử (ví dụ: HĐ xuất lúc 22:03 thì nghiệm thu phải ký trước lúc 16:30 cùng ngày) để bảo vệ tính hợp lệ khi giải trình thuế."*
3. **Cảnh báo khi thanh lý hợp đồng trước khi có ủy nhiệm chi:**
   * *Hành vi sai:* Ký Phụ lục III (Thanh lý & thanh toán) khi chưa có lệnh chuyển tiền ngân hàng.
   * *Phản ứng trợ lý:* **DỪNG LẠI & CẢNH BÁO:** *"Phụ lục III xác nhận thanh lý chỉ được ký SAU thời điểm tạo lệnh chuyển khoản ngân hàng (UNC) để đảm bảo tính xác thực dòng tiền."*
4. **Cảnh báo khi dùng số hợp đồng tuần tự đơn thuần (`01`, `02`):**
   * *Hành vi sai:* Yêu cầu đặt mã hợp đồng là `01/2026/HĐGK`.
   * *Phản ứng trợ lý:* **CHỦ ĐỘNG CHUẨN HÓA & CẢNH BÁO:** *"Theo quy tắc bảo mật số lượng hợp đồng, mã hợp đồng được chuẩn hóa tự động ghép ngày tháng: `20092026-01/HĐGK-INUT...` để bên ngoài không suy đoán được quy mô phát sinh của công ty."*
5. **Cảnh báo khi yêu cầu gửi email ngay lập tức:**
   * *Hành vi sai:* Yêu cầu gửi email thẳng cho khách hàng mà chưa trình duyệt.
   * *Phản ứng trợ lý:* **TUÂN THỦ HUMAN-IN-THE-LOOP:** Chỉ hiển thị bản nháp đầy đủ (Người nhận, CC, tiêu đề, nội dung, 4 file đính kèm) và hỏi: *"Anh xem qua bản nháp đã chuẩn chưa, khi nào anh chốt 'Gửi đi' thì em mới kích hoạt gửi email."*
6. **Cảnh báo khi văn bản đối ngoại chứa tên mã nội bộ:**
   * *Hành vi sai:* Sử dụng cụm từ `"trên hệ thống KSP"`.
   * *Phản ứng trợ lý:* Tự động sửa dứt điểm thành `"trên nền tảng lưu trữ hợp đồng của Bên A"`.

---

## 6. Thẩm Định Chữ Ký Số Chính Hãng Quốc Gia (NEAC Protocol)
* **Ký số chính thức:** Bắt buộc dùng USB Token WINCA phần cứng trên máy trạm Windows `inut-dev` (`192.168.1.10:22`, Cert ID: `6616B8A61F228D0EAFF8AAF5F44F3ECD660DD8CD`, Issuer: `WINGROUP`).
* **Tích hợp kiểm tra 1-click:** Cổng Mobile Portal tích hợp nút kiểm tra trực tuyến kết nối thẳng API Cổng Quốc gia NEAC (`https://neac.gov.vn/vi/Home/VerifyFileByNeac`) để khách hàng/cộng tác viên xem trực tiếp kết quả thẩm định:
  * Trạng thái toàn vẹn: *Không bị thay đổi (100%)*
  * Giá trị pháp lý: *Hợp lệ tại thời điểm ký*
  * Thu hồi chứng thư: *OCSP / CRL Đạt chuẩn*
* **Dòng hướng dẫn công khai:** Luôn ghi rõ đường link chính thức của Trung tâm Chứng thực điện tử quốc gia (Bộ TTTT) tại `https://neac.gov.vn/vi` để khách hàng tự tải file PDF về kiểm tra độc lập.
