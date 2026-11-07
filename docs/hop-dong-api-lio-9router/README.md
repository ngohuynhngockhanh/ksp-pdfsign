# Bộ Hồ Sơ Hợp Đồng Khung, Báo Giá & Phụ Lục Dịch Vụ Cổng API Trí Tuệ Nhân Tạo (9Router) — LIO ↔ INUT

Thư mục này chứa trọn bộ hồ sơ pháp lý – kế toán – kỹ thuật cho dịch vụ **Thuê bao gói Cổng kết nối & Định tuyến Đa mô hình Trí tuệ Nhân tạo (AI Gateway / 9Router)** giữa:

- **BÊN CUNG CẤP DỊCH VỤ (BÊN A):** **HỘ KINH DOANH CÔNG NGHỆ LIO**
  - Mã số thuế: `054202003668`
  - Địa chỉ: 22 đường 3/2, khu phố Phú Thạnh 2, phường Phú Yên, tỉnh Đắk Lắk, Việt Nam
  - Người đại diện: Ông **HUỲNH ĐỨC NHÂM** – Chủ hộ kinh doanh
  - Tài khoản nhận thanh toán: **00344714490** – Ngân hàng TMCP Quân Đội (**MB Bank**) – Chủ TK: **HUỲNH ĐỨC NHÂM**
- **BÊN SỬ DỤNG DỊCH VỤ (BÊN B):** **CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT**
  - Mã số thuế: `4401053694`
  - Địa chỉ: 161 Trường Chinh, Phường Tuy Hòa, Tỉnh Đắk Lắk, Việt Nam
  - Người đại diện pháp luật: Ông **NGÔ HUỲNH NGỌC KHÁNH** – Giám đốc (ĐT: `0972 768 491`)
  - Tài khoản thanh toán: **79713** – Ngân hàng TMCP Kỹ Thương Việt Nam (**Techcombank**)

---

## 1. Danh mục 03 văn bản PDF chuẩn in 2 mặt (1 tờ A4 / văn bản)

1. **`01-Bao-Gia-Va-Brief-Dich-Vu-API-AI-9Router-LIO-2026.pdf`** *(02 trang A4)*
   - **Báo giá & Hồ sơ Năng lực Kỹ thuật (Service Brief)** của Hộ kinh doanh Công nghệ LIO gửi Công ty CP Đầu tư và Phát triển Công nghệ INUT.
   - Mô tả chi tiết **07 nhóm hạng mục kỹ thuật** của nền tảng `inut-9router`:
     1. Cổng định tuyến đa mô hình chuẩn OpenAI / Anthropic / Gemini / Ollama (`AI Gateway & Multi-Provider Routing`, auto-fallback, load-balancing).
     2. Dịch vụ Mô hình Ngôn ngữ Lớn (LLM Chat, Code-Gen, Deep Reasoning, hoàn thiện văn bản/hồ sơ thầu, agent đa tác vụ).
     3. Hệ thống Tối ưu & Nén Ngữ cảnh **RTK (Token Saver & Context Caching)**, endpoint `/v1/compact`.
     4. Dịch vụ Xử lý Giọng nói Đa phương thức (**TTS** thuyết minh tự động đa giọng đọc & **STT** chuyển giọng nói thành văn bản).
     5. Dịch vụ Thị giác Máy tính (**Vision OCR** giải mã hồ sơ/chứng từ/biển số/captcha, **Image Generation** & **Video Generation**).
     6. Dịch vụ Vector hóa (**Embeddings**), Tìm kiếm Web thời gian thực (**Web Search**) & Trích xuất nội dung trang (**Web Fetch**).
     7. Quản trị Định danh **API Keys**, phân tách môi trường (`apphub-iot`, `vnmap`, `ksp-50,212`, `inut-crm-pdf-signer`, `inut-opc-dev`...) & **Báo cáo Usage Telemetry**.
   - Bảng biểu phí **08 bậc gói thuê bao định mức hàng tháng** từ **3.000.000 VNĐ/tháng** đến **30.000.000 VNĐ/tháng** + Cơ chế đơn giá thỏa thuận linh hoạt theo Phụ lục.

2. **`02-Hop-Dong-Khung-Dich-Vu-API-AI-01-11-2026-INUT-LIO.pdf`** *(02 trang A4)*
   - **Hợp đồng nguyên tắc (Hợp đồng khung) số `0111/2026/HĐDV-LIO-INUT`** ký ngày **01/11/2026**, hiệu lực từ **01/11/2026** (thời hạn 12 tháng, tự động gia hạn).
   - Thiết kế theo mô hình **thuê bao trọn gói định mức trả trước hàng tháng** (tương tự cơ chế phân bậc của Hợp đồng dịch vụ kế toán `49/2026/HĐDV-NEXTSTEP`), **không tính cước lẻ biến động theo từng truy vấn (không phải Pay-as-you-go)**.
   - Quy định đầy đủ **07 Điều khoản**:
     - **Điều 1:** Nội dung và phạm vi công việc của Bên A (7 nhóm dịch vụ AI Gateway + SLA 99,5% + an toàn thông tin).
     - **Điều 2:** Biểu phí các gói thuê bao định mức hàng tháng (từ 3.000.000 đ đến 30.000.000 đ/tháng) và cơ chế đặt gói linh hoạt theo Phụ lục hàng tháng.
     - **Điều 3:** Thời hạn & phương thức thanh toán (**trả trước 100% từ ngày 05 đến ngày 15 hàng tháng** qua chuyển khoản ngân hàng) và nghĩa vụ bàn giao **Báo cáo Sản lượng Sử dụng API (Usage Report) + Hóa đơn điện tử hợp lệ** cuối tháng để Bên B hạch toán chi phí hợp lý tính thuế TNDN.
     - **Điều 4 & Điều 5:** Quyền và nghĩa vụ của Bên A và Bên B.
     - **Điều 6 & Điều 7:** Thời hạn hợp đồng, chế tài vi phạm (hoàn trả 100% phí tháng nếu Bên A không thực hiện đúng cam kết) và điều khoản chung.

3. **`03-Phu-Luc-01-Thang-11-2026-Va-Mau-Bao-Cao-Usage-API-LIO-INUT.pdf`** *(02 trang A4)*
   - **Trang 1 — Phụ lục Hợp đồng số 01 (`01-PLHĐ/2026-11/LIO-INUT`):** Phiếu xác nhận gói dịch vụ API Trí tuệ Nhân tạo kỳ **Tháng 11/2026** (mặc định đang điền gói **AI-03 — 8.000.000 VNĐ/tháng** hoặc có thể tùy biến bất kỳ bậc nào từ 3 triệu – 30 triệu VNĐ qua tham số CLI).
   - **Trang 2 — Biên bản Nghiệm thu & Báo cáo Sản lượng Sử dụng API (Monthly Usage & Acceptance Statement):**
     - Tự động trích xuất số liệu thực tế từ cơ sở dữ liệu Telemetry của `inut-9router` (`/home/ksp/.9router/db/data.sqlite`) để làm căn cứ nghiệm thu kỹ thuật & chứng từ kế toán kèm theo Hóa đơn điện tử.

---

## 2. Cách kết xuất lại PDF cho các tháng tiếp theo (CLI Generator)

Script `build_lio_api_contract.py` cho phép tạo nhanh Phụ lục đặt gói và Báo cáo Usage cho bất kỳ tháng nào chỉ với 1 lệnh:

```bash
# Mặc định (Kỳ Tháng 11/2026 - Gói AI-03: 8.000.000 VNĐ)
/home/ksp/ksp-pdfsign/backend/.venv/bin/python \
  /home/ksp/ksp-pdfsign/docs/hop-dong-api-lio-9router/build_lio_api_contract.py

# Ví dụ đổi sang Gói AI-02 (5.000.000 VNĐ) hoặc Gói AI-05 (15.000.000 VNĐ):
/home/ksp/ksp-pdfsign/backend/.venv/bin/python \
  /home/ksp/ksp-pdfsign/docs/hop-dong-api-lio-9router/build_lio_api_contract.py \
  --month "12/2026" \
  --appendix-no "02-PLHĐ/2026-12/LIO-INUT" \
  --sign-date "ngày 01 tháng 12 năm 2026" \
  --payment-window "từ ngày 05/12/2026 đến hết ngày 15/12/2026" \
  --tier-code "AI-05" \
  --tier-name "Gói Doanh Nghiệp (Business)" \
  --req-quota "Đến 180.000 requests" \
  --token-quota "Đến 18,0 tỷ tokens" \
  --amount 15000000 \
  --amount-words "Mười lăm triệu đồng chẵn"
```
