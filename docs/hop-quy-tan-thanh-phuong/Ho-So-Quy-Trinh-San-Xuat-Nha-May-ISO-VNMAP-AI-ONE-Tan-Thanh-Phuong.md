# HỒ SƠ QUY TRÌNH SẢN XUẤT, LẮP RÁP THEO ĐƠN HÀNG (ORDER) & KIỂM SOÁT CHẤT LƯỢNG (SOP / IQC – IPQC – OQC)
## Thiết bị đầu cuối AI xác thực định danh và hỗ trợ hành chính công thông minh — Nhãn hiệu: `VNMAP®` • Model: `VNMAP AI ONE`
### Áp dụng Hệ thống Quản lý Chất lượng `TCVN ISO 9001:2015` & An toàn Thông tin `ISO/IEC 27001:2022` (Phiên bản Tinh gọn Thực tế tại Xưởng)

---

## BẢNG KIỂM SOÁT TÀI LIỆU
| Hạng mục | Nội dung chi tiết |
| :--- | :--- |
| **Tên bộ tài liệu** | Quy trình Sản xuất, Lắp ráp Tích hợp theo Đơn hàng (`Order`) và Kiểm soát Chất lượng Thiết bị `VNMAP® AI ONE` |
| **Mã tài liệu** | `HS-QTSX-ISO-TTP-AIONE-2026` |
| **Phiên bản** | `Lần ban hành 03 — Phiên bản Tinh gọn Thực chiến (Tháng 10/2026)` |
| **Đơn vị ban hành & Sản xuất** | **CÔNG TY CỔ PHẦN ĐẦU TƯ PHÁT TRIỂN CÔNG NGHỆ TÂN THANH PHƯƠNG** |
| **Mã số doanh nghiệp / MST** | `2800817718` |
| **Trụ sở chính** | Số 28 Cao Thắng, Phường Hạc Thành, Tỉnh Thanh Hóa, Việt Nam |
| **Xưởng sản xuất & KCS** | **Số 472 Nguyễn Trãi, Phường Phú Sơn, Thành phố Thanh Hóa, Tỉnh Thanh Hóa** |
| **Phương thức sản xuất** | Lắp ráp tích hợp theo cấu hình từng Đơn hàng (`Order`) |
| **Quy tắc mã định danh / Serial** | Gán và dán mã **`inut_x_y`** (Ví dụ: **`inut_207_203`**) trên từng thiết bị để định danh, truy vết và quản lý hành trình bảo hành |
| **Tiêu chuẩn áp dụng** | **TCVN ISO 9001:2015** (Điều khoản `7.1.5, 7.5, 8.1, 8.4, 8.5, 8.6, 8.7`) & **ISO/IEC 27001:2022** (`17232257/TQC.25.2916` — `Phụ lục A.5, A.7, A.8`) |

| Trách nhiệm | Họ và tên / Chức danh | Chữ ký | Ngày ký & Đóng dấu |
| :--- | :--- | :---: | :---: |
| **Biên soạn** | Trưởng Bộ phận Kỹ thuật & Sản xuất | *(Ký tên)* | ....../10/2026 |
| **Kiểm soát ISO** | Đại diện Lãnh đạo Chất lượng & ATTT (QMR/ISMS) | *(Ký tên)* | ....../10/2026 |
| **Phê duyệt ban hành** | **GIÁM ĐỐC CÔNG TY** | *(Ký, đóng dấu)* | ....../10/2026 |

---

# PHẦN I. TỔNG QUAN QUY TRÌNH TINH GỌN, PHÂN KHU XƯỞNG & DANH MỤC HỒ SƠ ISO

## 1.1. Nguyên tắc Vận hành Đơn giản – Đảm bảo Tuân thủ 100% ISO 9001:2015 & ISO/IEC 27001:2022
Quy trình sản xuất, lắp ráp thiết bị **`VNMAP® AI ONE`** tại **Xưởng 472 Nguyễn Trãi, Phường Phú Sơn, TP. Thanh Hóa** được thiết kế theo hướng **đơn giản hóa tối đa thao tác ghi chép và dụng cụ đo**, phù hợp thực tế lắp ráp tích hợp theo từng **`Order`** mà vẫn đáp ứng đầy đủ các điều khoản bắt buộc của đoàn đánh giá ISO:
1. **Sản xuất theo `Order` (`Build-to-Order`):** Chỉ xuất kho và lắp ráp theo đúng cấu hình khách hàng đặt trong `Order` (cỡ màn hình `21.5 / 22 / 27 / 32 / 43 / 51 inch`, loại đầu đọc thẻ gắn chip `tiếp xúc / Hanel / VeriBOX S`, máy quét tài liệu Camera `≥ 11 MP`, bộ đổi nguồn `24VDC / 19VDC / 15VDC / 5VDC`).
2. **Định danh & Truy vết xuyên suốt bằng 01 mã duy nhất `inut_x_y` (Điều khoản 8.5.2 ISO 9001):** Ngay khi mở Lệnh sản xuất theo `Order`, mỗi máy được cấp một mã **`inut_x_y`** (ví dụ: **`inut_207_203`**). Không cần ghi chép số serial con của từng linh kiện nhỏ; chỉ dùng duy nhất mã **`inut_x_y`** dán trên máy để liên kết với `Order`, phiếu KCS và quản lý hành trình bảo hành.
3. **Kiểm tra Chất lượng bằng Checklist Thực tế (`Đạt / Không đạt`):** Tập trung kiểm tra đúng cấu hình `Order`, đo đúng mức điện áp nguồn một chiều bằng đồng hồ vạn năng (`VOM`) và thao tác thử nghiệm trực tiếp các tính năng thực tế trên máy (chạm màn hình, đọc thử thẻ CCCD mẫu, chụp thử tờ giấy A4 bằng camera quét `≥ 11 MP`, hỏi đáp mic/loa, kết nối mạng).
4. **An toàn Thông tin theo Checklist ISO/IEC 27001:2022:** Nạp bản phần mềm chuẩn của Công ty, gắn mã `inut_x_y`, khóa giao diện Kiosk và bật chế độ **tự động xóa dữ liệu phiên công dân** ngay sau khi hoàn tất thủ tục.

## 1.2. Danh mục Tài liệu Quy trình & Biểu mẫu Tinh gọn trình Đoàn đánh giá ISO
| TT | Mã Tài liệu | Tên Quy trình / Biểu mẫu Áp dụng Thực tế | Điều khoản ISO 9001:2015 | Điều khoản ISO/IEC 27001:2022 |
| :---: | :--- | :--- | :--- | :--- |
| 1 | `QT-SX-01` | **Quy trình 05 bước sản xuất, lắp ráp theo `Order`, bảo mật phần mềm và KCS xuất xưởng thiết bị `VNMAP® AI ONE`** | Điều khoản 8.1, 8.4, 8.5, 8.6 | Phụ lục A.8.1, A.8.9, A.8.10 |
| 2 | `BM-SX-01` | **Lệnh Sản xuất theo `Order`, Phiếu Xuất kho & Kiểm tra Vật tư Đầu vào (`IQC`)** *(Gộp chung Lệnh SX + Xuất kho + IQC trên 01 phiếu)* | Điều khoản 8.1, 8.4, 8.5.2 | Phụ lục A.5.19, A.8.1 |
| 3 | `BM-SX-02` | **Phiếu Theo dõi Lắp ráp (`IPQC`), Nạp Phần mềm Bảo mật (`ISO 27001`) & Nghiệm thu KCS Xuất xưởng (`OQC`) theo mã `inut_x_y`** | Điều khoản 8.5.1, 8.5.2, 8.6 | Phụ lục A.8.8, A.8.9, A.8.10, A.8.24 |
| 4 | `BM-SX-03` | **Sổ Theo dõi Sự không phù hợp & Xử lý Khắc phục (`NCR & CAPA`)** | Điều khoản 8.7, 10.2 | Phụ lục A.5.24, A.5.27 |

## 1.3. Sơ đồ Bố trí Mặt bằng 04 Khu vực Đơn giản Một chiều tại Xưởng 472 Nguyễn Trãi
- **Khu 1 — Tiếp nhận Vật tư, Kiểm tra Đầu vào (`IQC`) & Kho theo `Order`:** Đối chiếu đúng linh kiện theo `Order`, dán nhãn xanh **`IQC ĐẠT`**.
- **Khu 2 — Lắp ráp Cơ - Điện tử & Kiểm tra trung gian (`IPQC`):** Bàn lắp ráp có thảm chống tĩnh điện, lắp vỏ Kiosk, màn hình (`21.5"–51"`), bo mạch AI, đầu đọc chip, camera quét `≥ 11 MP` và bộ nguồn (`24V/19V/15V/5VDC`).
- **Khu 3 — Nạp Phần mềm AI, Gán mã `inut_x_y`, Khóa Bảo mật `ISO 27001` & Test KCS (`OQC`):** Nạp phần mềm chuẩn, gán mã `inut_x_y`, bật tự động xóa dữ liệu phiên và kiểm tra chức năng thực tế 100% máy.
- **Khu 4 — Dán Tem `inut_x_y` + Dấu `CR`, Đóng gói Thành phẩm & Ô Cách ly Hàng lỗi (`NCR`):** Dán nhãn gốc + dấu `CR` + tem `KCS PASS`, kích hoạt bảo hành theo mã `inut_x_y`; bố trí riêng 01 bàn/kệ dán nhãn đỏ **`KHU CÁCH LY LỖI (NCR)`** đúng chuẩn Điều khoản 8.7 ISO 9001.

---

# PHẦN II. ĐỊNH MỨC KHUNG VẬT TƯ THEO ORDER (BOM) & QUY TRÌNH SẢN XUẤT 05 BƯỚC (QT-SX-01)

## 2.1. Bảng Định mức Khung Vật tư – Linh kiện theo Cấu hình `Order` (`Configurable BOM`)
Khi có `Order`, bộ phận Sản xuất căn cứ cấu hình thực tế của đơn hàng để xuất kho và kiểm tra đầu vào (`IQC`) theo bảng khung sau:

| TT | Mã Vật tư | Tên Hạng mục Linh kiện / Cụm Module | Tùy chọn Cấu hình theo từng `Order` & Cách Kiểm tra Đầu vào (`IQC`) Đơn giản | Định mức / Máy | Phương pháp Kiểm IQC |
| :---: | :--- | :--- | :--- | :---: | :--- |
| 1 | `LK-AIONE-01` | **Bo mạch chủ xử lý AI (Mainboard + NPU) & Module Wi-Fi/BLE** | Bo mạch xử lý AI công nghiệp tích hợp NPU, cổng LAN RJ45, USB, HDMI/LVDS + Module thu phát Wi-Fi 2.4G/5G & BLE kèm ăng-ten nội bộ. | 01 Bộ | Kiểm ngoại quan & cấp điện boot thử lên hình (`Đạt / Không đạt`) |
| 2 | `LK-AIONE-02` | **Màn hình chính cảm ứng đa điểm IPS** *(và màn phụ nếu có)* | **Kích thước tùy theo `Order`: `21.5 / 22 / 27 / 32 / 43 / 51 inch`**, tấm nền IPS, cảm ứng điện dung đa điểm, kính cường lực. *(Một số `Order` lắp thêm màn hình phụ phía sau).* | 01 Cái | Kiểm đúng cỡ inch theo `Order`, lên hình sáng rõ, vuốt chạm mượt |
| 3 | `LK-AIONE-03` | **Cụm Camera AI nhận diện khuôn mặt** | Camera góc rộng Full HD / 2K chống ngược sáng, cổng USB; phục vụ nhận diện công dân tiếp cận và lấy số tự động. | 01 Cái | Cắm test lên hình rõ nét |
| 4 | `LK-AIONE-04` | **Đầu đọc thẻ CCCD gắn chip chuyên dụng** | **Lắp theo từng `Order`:** Cụm **đầu đọc thẻ gắn chip tiếp xúc, đầu đọc định danh `Hanel`, `VeriBOX S`** *(tùy `Order`)* kết hợp quét mã QR định danh. | 01 Bộ | Kiểm đúng loại đầu đọc theo `Order`, đặt thử thẻ mẫu nhận tín hiệu |
| 5 | `LK-AIONE-05` | **Máy quét tài liệu (Document Scanner)** | Cụm **Camera quét chụp văn bản/giấy tờ độ phân giải tối thiểu `11 MP` (`≥ 11 Megapixel`)** kèm đèn LED trợ sáng phục vụ AI OCR đọc điền biểu mẫu. | 01 Bộ | Kiểm thông số `≥ 11 MP`, chụp thử tờ văn bản A4 rõ chữ |
| 6 | `LK-AIONE-06` | **Cụm Loa & Micro đa hướng khử ồn AI** | Micro thu giọng nói tiếng Việt khử ồn + Loa phát âm thanh hướng dẫn hai chiều. | 01 Bộ | Thử thu âm và phát tiếng rõ, không rè |
| 7 | `LK-AIONE-07` | **Bộ đổi nguồn / Cấp nguồn một chiều (`DC Adapter / PSU`)** | Ngõ vào `100–240VAC`; **Ngõ ra một chiều tùy theo `Order`: `24VDC / 19VDC / 15VDC / 5VDC`**. | 01 Bộ | Dùng đồng hồ VOM đo đúng mức áp DC theo `Order` |
| 8 | `LK-AIONE-08` | **Khung vỏ Kiosk thép sơn tĩnh điện, Cáp, Tem `inut_x_y` & Dấu `CR`** | Khung vỏ Kiosk CNC đúng cỡ màn hình của `Order`, dây nguồn có chân tiếp địa, bộ **Nhãn gốc in mã Serial `inut_x_y` + Dấu hợp quy `CR`** (MST `2800817718`), tem QR bảo hành `inut_x_y`, tem `KCS PASS`. | 01 Bộ | Kiểm ngoại quan sơn không trầy, tem in đúng mã `inut_x_y` |

---

## 2.2. Lưu trình 05 Bước Sản xuất – Lắp ráp – Định danh `inut_x_y` – KCS Xuất xưởng (`QT-SX-01`)

| Bước | Tên Công đoạn | Nội dung Thực hiện Đơn giản tại Xưởng 472 Nguyễn Trãi | Hồ sơ Lưu trữ ISO |
| :---: | :--- | :--- | :--- |
| **Bước 1** | **Mở Lệnh SX theo `Order`, Cấp mã `inut_x_y` & Kiểm tra Vật tư (`IQC`)** | - Khi có `Order`, lập phiếu **`BM-SX-01`**, ghi rõ cấu hình đơn hàng và cấp dải mã **`inut_x_y`** (VD: `inut_207_201` $\div$ `inut_207_205`).<br>- Kiểm tra vật tư đầu vào theo cột IQC (đúng cỡ màn hình, đúng loại đầu đọc, camera quét `≥ 11MP`, đo áp nguồn DC đúng `Order`). Linh kiện đạt dán nhãn **`IQC PASS`** đưa vào lắp ráp; linh kiện lỗi tách vào **Khu cách ly NCR**. | **`BM-SX-01`** *(Lệnh SX + Xuất kho + IQC)* |
| **Bước 2** | **Lắp ráp Cơ khí, Cụm Linh kiện theo `Order` & Kiểm tra Nguội (`IPQC`)** | - Lắp khung vỏ Kiosk, gắn màn hình cảm ứng (`21.5"–51"`), Bo mạch chủ AI + Wi-Fi/BLE, Đầu đọc thẻ chip (`tiếp xúc / Hanel / VeriBOX S`), Máy quét tài liệu Camera `≥ 11MP`, Camera AI, Loa/Mic và Bộ nguồn (`24V/19V/15V/5VDC`).<br>- **Kiểm tra trung gian (`IPQC`):** Đi dây gọn gàng, bắt chặt dây tiếp địa vào vỏ kim loại, dùng đồng hồ VOM kiểm tra nguồn không chạm chập trước khi bật điện. | Phần A của **`BM-SX-02`** |
| **Bước 3** | **Nạp Phần mềm AI, Gán mã `inut_x_y` & Khóa Bảo mật `ISO/IEC 27001:2022`** | - Cài đặt bản phần mềm chuẩn **`VNMAP AI ONE`** và nhận đủ driver theo cấu hình `Order`.<br>- **Gán mã định danh `inut_x_y`** (VD: **`inut_207_203`**) vào cấu hình thiết bị và sổ quản lý bảo hành.<br>- **Thực hiện 04 tích chọn bảo mật ISO 27001:** (1) Đúng phiên bản phần mềm chuẩn; (2) Khóa cổng gỡ lỗi/cài đặt trái phép (`ADB/Root`); (3) Bật khóa giao diện Kiosk (`App Pinning`); (4) Bật chế độ **tự động xóa sạch dữ liệu công dân (`Zero-Data-Retention`)** ngay khi kết thúc phiên giao dịch. | Phần B của **`BM-SX-02`** |
| **Bước 4** | **Chạy thử Ổn định & Nghiệm thu KCS Xuất xưởng 100% (`OQC`)** | - Cho máy chạy thử liên tục tối thiểu **01 – 02 giờ**.<br>- Kỹ thuật viên KCS tích kiểm trực tiếp **07 chỉ tiêu thực tế** trên từng máy `inut_x_y`: (1) Đúng cấu hình `Order` & ngoại quan; (2) Đúng áp nguồn DC & tiếp địa an toàn; (3) Màn hình & cảm ứng mượt; (4) Camera AI & Hỏi đáp giọng nói 2 chiều; (5) Đầu đọc thẻ CCCD gắn chip đọc tốt; (6) Máy quét Camera `≥ 11MP` chụp nét & AI điền biểu mẫu; (7) Mạng LAN/Wi-Fi/BLE & tự động xóa dữ liệu phiên. | Phần C của **`BM-SX-02`** |
| **Bước 5** | **Dán Tem `inut_x_y`, Nhãn gốc + Dấu `CR` & Bàn giao / Quản lý Bảo hành** | - Dán **Nhãn hàng hóa gốc in mã Serial `inut_x_y` + Dấu hợp quy `CR`**, **Tem QR quản lý hành trình/bảo hành `inut_x_y`** và **Tem `KCS PASS`** lên thân máy.<br>- Lưu hồ sơ lô theo mã `Order` và dải mã `inut_x_y` phục vụ truy vết nguồn gốc và bảo hành suốt vòng đời sản phẩm. | Lưu bộ **`BM-SX-01` + `BM-SX-02`** |

---

## 2.3. Danh mục Thiết bị Sản xuất & Đo lường Tối giản tại Xưởng (Đảm bảo Điều khoản 7.1.5 ISO 9001)
> **Nguyên tắc thực tế khi đón đoàn đánh giá ISO:** Chỉ đưa vào diện bắt buộc hiệu chuẩn **01 Đồng hồ vạn năng số (VOM)** dùng để đo điện áp nguồn DC và thông mạch tiếp địa; các hạng mục còn lại là công cụ lắp ráp và kiểm tra chức năng thực tế (không phát sinh gánh nặng giấy hiệu chuẩn phức tạp).

| TT | Mã Thiết bị | Tên Thiết bị / Công cụ tại Xưởng 472 Nguyễn Trãi | Mục đích Sử dụng | Hình thức Quản lý ISO 9001 |
| :---: | :--- | :--- | :--- | :--- |
| 1 | `TB-ĐL-01` | **Đồng hồ vạn năng số (`Digital Multimeter / VOM`)** | Đo kiểm tra điện áp bộ nguồn (`24VDC / 19VDC / 15VDC / 5VDC`) và đo thông mạch tiếp địa vỏ máy | **Có tem hiệu chuẩn định kỳ 12 tháng/lần** |
| 2 | `TB-SX-01` | **Bàn kỹ thuật lắp ráp có thảm & vòng đeo tay chống tĩnh điện (`ESD`)** | Lắp ráp bo mạch AI, màn hình cảm ứng và cụm module ngoại vi | Kiểm tra nội bộ định kỳ (Vệ sinh & đo thông mạch dây nối đất) |
| 3 | `TB-SX-02` | **Bộ dụng cụ cơ khí cầm tay, thước đo & máy in tem nhãn `inut_x_y`** | Lắp ráp khung vỏ Kiosk và in tem định danh/QR bảo hành `inut_x_y` | Kiểm tra tình trạng hoạt động trước ca sản xuất |
| 4 | `TB-SX-03` | **Bộ công cụ Test Chức năng Thực tế (`Thẻ CCCD mẫu, Văn bản mẫu A4, Switch LAN / Wi-Fi`)** | Kiểm tra thực tế đầu đọc thẻ chip, camera quét `≥ 11MP`, cảm ứng, âm thanh và mạng ở khâu KCS | Đối chiếu hoạt động thực tế từng lô `Order` |

---

# PHẦN III. BỘ 03 BIỂU MẪU HỒ SƠ LÔ SẢN XUẤT VÍ DỤ THEO ORDER (ĐIỀN SẴN ĐỂ TRÌNH ĐOÀN ISO)

> **Thông tin Lô sản xuất ví dụ theo `Order`:**
> - **Căn cứ Đơn hàng (`Order` ví dụ):** `ORD-2026-10-HCC08` — **Lệnh sản xuất số:** `LSX-2026-10/TTP`
> - **Cấu hình thực tế của `Order` ví dụ:** Thiết bị `VNMAP® AI ONE` — Màn hình cảm ứng **`32 inch`** *(tùy chọn Order: 21.5/22/27/32/43/51 inch)*, Đầu đọc thẻ CCCD gắn chip **`VeriBOX S`** *(tùy chọn Order: Tiếp xúc / Hanel / VeriBOX S)*, Máy quét tài liệu Camera **`12 MP` (`≥ 11 MP`)**, Bộ đổi nguồn **`19VDC`** *(tùy chọn Order: 24V/19V/15V/5VDC)*.
> - **Số lượng & Dải mã định danh `inut_x_y` cấp phát:** **05 máy** — Mã Serial: `inut_207_201`, `inut_207_202`, **`inut_207_203`**, `inut_207_204`, `inut_207_205`.

---

## 3.1. BIỂU MẪU 01 (`BM-SX-01`): LỆNH SẢN XUẤT THEO ORDER, PHIẾU XUẤT KHO & KIỂM TRA ĐẦU VÀO (IQC)

- **Mã biểu mẫu:** `BM-SX-01` • **Số phiếu:** `LSX-IQC-2026-10/TTP` • **Ngày lập:** `15/10/2026`
- **Theo `Order`:** `ORD-2026-10-HCC08` • **Sản phẩm / Model:** `VNMAP® AI ONE` • **Số lượng:** `05 bộ`
- **Dải Mã ID / Serial (`inut_x_y`) cấp cho lô:** `inut_207_201`, `inut_207_202`, **`inut_207_203`**, `inut_207_204`, `inut_207_205`

| TT | Mã Vật tư | Tên Vật tư / Cụm Module Xuất kho & Kiểm tra Đầu vào (Theo cấu hình `Order`) | SL Xuất | Kết quả Kiểm tra Đầu vào (`IQC`) Thực tế | SL Đạt | Kết luận IQC |
| :---: | :--- | :--- | :---: | :--- | :---: | :---: |
| 1 | `LK-AIONE-01` | Bo mạch chủ xử lý AI + NPU (kèm Module RF Wi-Fi 2.4G/5G & BLE + Ăng-ten) | 05 Bộ | Ngoại quan nguyên vẹn, cấp nguồn boot thử 05/05 bộ nhận đủ phần cứng | 05 Bộ | **ĐẠT (`IQC PASS`)** |
| 2 | `LK-AIONE-02` | **Màn hình cảm ứng đa điểm IPS cỡ `32 inch`** *(theo Order; dải 21.5/22/27/32/43/51")* | 05 Cái | Đúng cỡ `32 inch` theo Order, kính không trầy, hiển thị & cảm ứng tốt | 05 Cái | **ĐẠT (`IQC PASS`)** |
| 3 | `LK-AIONE-03` | Cụm Camera AI nhận diện khuôn mặt | 05 Cái | Cắm test hình ảnh sáng rõ, đúng chuẩn giao tiếp USB | 05 Cái | **ĐẠT (`IQC PASS`)** |
| 4 | `LK-AIONE-04` | **Đầu đọc thẻ CCCD gắn chip `VeriBOX S`** *(theo Order; tùy chọn Tiếp xúc/Hanel/VeriBOX S)* | 05 Bộ | Đúng chủng loại `VeriBOX S` theo Order, đặt thử thẻ mẫu nhận tốt | 05 Bộ | **ĐẠT (`IQC PASS`)** |
| 5 | `LK-AIONE-05` | **Cụm Máy quét tài liệu Camera `12 MP` (`≥ 11 MP`)** kèm đèn LED trợ sáng | 05 Bộ | Đạt độ phân giải `12 MP (≥ 11 MP)`, chụp thử trang văn bản A4 rõ nét | 05 Bộ | **ĐẠT (`IQC PASS`)** |
| 6 | `LK-AIONE-06` | Cụm Loa & Micro đa hướng khử ồn AI | 05 Bộ | Thử thu âm và phát âm thanh rõ ràng | 05 Bộ | **ĐẠT (`IQC PASS`)** |
| 7 | `LK-AIONE-07` | **Bộ đổi nguồn một chiều `19VDC`** *(theo Order; tùy case 24V/19V/15V/5VDC)* | 06 Cái | Đo bằng đồng hồ VOM: **05 cái đạt chuẩn `19VDC`**; **01 cái sụt áp** $\rightarrow$ Tách riêng lập `NCR-2026-01` đổi nhà cung cấp | **05 Cái** *(Lỗi 01)* | **05 ĐẠT / 01 CÁCH LY** |
| 8 | `LK-AIONE-08` | Khung vỏ Kiosk CNC cỡ 32" + Cáp + **Bộ nhãn gốc CR & Tem Serial `inut_207_201..205`** | 05 Bộ | Khung vỏ sơn tốt, in đúng dải mã Serial `inut_207_201` $\div$ `inut_207_205` | 05 Bộ | **ĐẠT (`IQC PASS`)** |

- **Xác nhận Thủ kho:** Đã xuất đủ 05 bộ vật tư đạt chuẩn • **Kỹ thuật viên IQC:** Lê Minh Tuấn • **Quản đốc Xưởng phê duyệt:** Nguyễn Văn Hùng.

---

## 3.2. BIỂU MẪU 02 (`BM-SX-02`): PHIẾU KIỂM SOÁT LẮP RÁP (IPQC), BẢO MẬT PHẦN MỀM (ISO 27001) & NGHIỆM THU KCS XUẤT XƯỞNG (OQC) THEO MÃ `inut_x_y`

- **Mã biểu mẫu:** `BM-SX-02` • **Số phiếu:** `BB-KCS-2026-10/TTP` • **Ngày nghiệm thu:** `16/10/2026`
- **Theo `Order`:** `ORD-2026-10-HCC08` (`LSX-2026-10/TTP`) • **Thiết bị đo sử dụng:** Đồng hồ vạn năng `TB-ĐL-01` & Bộ công cụ test thực tế `TB-SX-03`
- **Ghi chú truy vết:** Mã **`inut_207_203`** là cá thể đại diện minh họa kiểm tra chi tiết; cả 05 thiết bị (`inut_207_201` $\div$ `inut_207_205`) đều được tích kiểm 100% trước khi dán tem xuất xưởng.

| Hạng mục Kiểm soát theo Quy trình `QT-SX-01` (Tích hợp ISO 9001:2015 & ISO/IEC 27001:2022) | Phương pháp / Tiêu chí Đánh giá Đơn giản | `inut_207_201` | `inut_207_202` | **`inut_207_203`** | `inut_207_204` | `inut_207_205` | Kết luận |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **A. KIỂM TRA LẮP RÁP TRUNG GIAN (`IPQC` — Điều khoản 8.5.1 ISO 9001)** | | | | | | | |
| 1. Lắp ráp cơ khí, màn hình (`21.5"–51"`) & ngoại vi đúng `Order` | Lắp chắc chắn, đúng cỡ màn 32", đầu đọc `VeriBOX S`, cam quét `≥ 11MP` | ☑ Đạt | ☑ Đạt | **☑ Đạt** | ☑ Đạt | ☑ Đạt | **ĐẠT** |
| 2. Đi dây nội bộ, đấu tiếp địa vỏ & đo kiểm nguội nguồn DC | Dây gọn, vỏ nối tiếp địa, đo VOM không chạm chập, đúng nguồn `19VDC` | ☑ Đạt | ☑ Đạt | **☑ Đạt** | ☑ Đạt | ☑ Đạt | **ĐẠT** |
| **B. NẠP PHẦN MỀM, GÁN MÃ `inut_x_y` & BẢO MẬT (`ISO/IEC 27001:2022 — Phụ lục A.8`)** | | | | | | | |
| 3. Nạp phần mềm chuẩn `VNMAP AI ONE` & gán mã Serial `inut_x_y` | Nạp đúng bản Release của Công ty; hiển thị đúng mã `inut_207_201..205` | ☑ Đạt | ☑ Đạt | **☑ Đạt** | ☑ Đạt | ☑ Đạt | **ĐẠT** |
| 4. Khóa cổng gỡ lỗi (`ADB/Root`) & bật khóa giao diện Kiosk (`A.8.9`) | Người dùng bên ngoài không thoát được ứng dụng Kiosk | ☑ Đã khóa | ☑ Đã khóa | **☑ Đã khóa** | ☑ Đã khóa | ☑ Đã khóa | **ĐẠT** |
| 5. Tự động xóa dữ liệu phiên công dân (`Zero-Data-Retention` — `A.8.10`) | Kết thúc phiên giao dịch: ảnh chụp & thông tin CCCD tự xóa sạch khỏi máy | ☑ Đạt | ☑ Đạt | **☑ Đạt** | ☑ Đạt | ☑ Đạt | **ĐẠT** |
| **C. CHẠY THỬ & ĐO KIỂM KCS XUẤT XƯỞNG 100% (`OQC` — Điều khoản 8.6 ISO 9001)** | | | | | | | |
| 6. Đo áp nguồn một chiều DC (`24V/19V/15V/5VDC`) bằng đồng hồ VOM | Đúng cấp điện áp `19VDC` của Order (sai số trong ngưỡng $\pm 5\%$) | ☑ 19,1V | ☑ 19,1V | **☑ 19,2V** | ☑ 19,1V | ☑ 19,2V | **ĐẠT** |
| 7. Kiểm tra hiển thị màn hình IPS & độ nhạy cảm ứng đa điểm | Sáng rõ, không điểm chết, chạm thử các góc và tâm màn hình nhạy 100% | ☑ Đạt | ☑ Đạt | **☑ Đạt** | ☑ Đạt | ☑ Đạt | **ĐẠT** |
| 8. Thử nghiệm Camera AI nhận diện & Hỏi đáp giọng nói AI 2 chiều | Nhận diện người đứng trước quầy; Mic thu rõ tiếng Việt, Loa phát rõ | ☑ Đạt | ☑ Đạt | **☑ Đạt** | ☑ Đạt | ☑ Đạt | **ĐẠT** |
| 9. Thử nghiệm Đầu đọc thẻ CCCD gắn chip (`Tiếp xúc / Hanel / VeriBOX S`) | Đặt thẻ CCCD gắn chip mẫu & quét QR đọc lên thông tin nhanh, chính xác | ☑ Đạt | ☑ Đạt | **☑ Đạt** | ☑ Đạt | ☑ Đạt | **ĐẠT** |
| 10. Thử nghiệm Máy quét tài liệu Camera `≥ 11 MP` & AI điền tờ khai | Chụp văn bản mẫu A4 bằng Camera `≥ 11MP` rõ nét, AI trích xuất đúng chữ | ☑ Đạt | ☑ Đạt | **☑ Đạt** | ☑ Đạt | ☑ Đạt | **ĐẠT** |
| 11. Kết nối mạng (`LAN / Wi-Fi / BLE`) & Chạy thử ổn định (Burn-in) | Kết nối mạng thông suốt; chạy liên tục 02 giờ máy mát, hoạt động ổn định | ☑ Đạt | ☑ Đạt | **☑ Đạt** | ☑ Đạt | ☑ Đạt | **ĐẠT** |
| 12. Dán Nhãn gốc + Dấu `CR` + Tem Serial `inut_x_y` + Tem `KCS PASS` | Tem dán ngay ngắn, mã `inut_x_y` trên thân máy khớp phần mềm & sổ BH | ☑ Đã dán | ☑ Đã dán | **☑ Đã dán** | ☑ Đã dán | ☑ Đã dán | **KCS PASS** |

- **KẾT LUẬN NGHIỆM THU XUẤT XƯỞNG:** Cả **05/05 thiết bị (`inut_207_201` $\div$ `inut_207_205`)** thuộc `Order` `ORD-2026-10-HCC08` **ĐẠT 100% yêu cầu chất lượng (ISO 9001:2015) và an toàn thông tin (ISO/IEC 27001:2022)**; cho phép nhập kho thành phẩm và bàn giao khách hàng.
- **Kỹ thuật viên Lắp ráp & Nạp PM:** Phạm Hoàng Nam • **Trưởng bộ phận KCS / OQC:** Lê Minh Tuấn • **Giám đốc phê duyệt:** *(Ký, đóng dấu)*.

---

## 3.3. BIỂU MẪU 03 (`BM-SX-03`): SỔ THEO DÕI SỰ KHÔNG PHÙ HỢP & HÀNH ĐỘNG KHẮC PHỤC (NCR & CAPA)

*(Bằng chứng tuân thủ Điều khoản 8.7 & 10.2 TCVN ISO 9001:2015 trình Đoàn đánh giá)*

| Mã NCR | Ngày phát hiện | Khâu phát hiện | Mô tả Sự không phù hợp | Biện pháp Xử lý Tức thời (`Correction`) | Hành động Phòng ngừa (`CAPA`) | Người kiểm tra | Trạng thái |
| :---: | :---: | :--- | :--- | :--- | :--- | :---: | :---: |
| `NCR-2026-01` | 15/10/2026 | Khâu Kiểm đầu vào (`IQC`) | 01 Bộ đổi nguồn `19VDC` đo bằng đồng hồ VOM bị sụt áp thấp hơn định mức của `Order`. | Dán nhãn đỏ **`IQC REJECT`**, để riêng vào **Khu cách ly NCR**, lấy 01 bộ nguồn `19VDC` đạt chuẩn thay thế và gửi trả nhà cung cấp đổi mới. | Duy trì đo kiểm điện áp bằng đồng hồ VOM cho 100% bộ nguồn (`24V/19V/15V/5VDC`) khi nhận hàng. | Lê Minh Tuấn *(KCS)* | **ĐÃ ĐÓNG** |
| `NCR-2026-02` | 16/10/2026 | Khâu Kiểm lắp ráp (`IPQC` máy `inut_207_204`) | Dây cáp USB nối cụm Camera quét tài liệu `≥ 11MP` trong thân máy `inut_207_204` chưa cố định vào rãnh kẹp. | Cố định lại dây cáp vào rãnh kẹp bằng dây rút nhựa, kiểm tra chắc chắn trước khi đóng nắp máy `inut_207_204`. | Nhắc nhở công nhân kiểm tra kẹp dây gọn gàng ở Bước 2 trước khi chuyển sang trạm nạp phần mềm. | Lê Minh Tuấn *(KCS)* | **ĐÃ ĐÓNG** |

---
*Hồ sơ được chuẩn hóa theo phương châm tinh gọn, dễ áp dụng thực tế tại Xưởng 472 Nguyễn Trãi mà vẫn đáp ứng đầy đủ các điều khoản bắt buộc của TCVN ISO 9001:2015 & ISO/IEC 27001:2022 — Công ty Cổ phần Đầu tư Phát triển Công nghệ Tân Thanh Phương.*
