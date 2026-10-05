# Living Project Summary: Đối Chiếu Hóa Đơn Mua Vào Quý 3/2026 >= 5M & Sao Kê Techcombank

- **Description**: Đối chiếu toàn bộ hóa đơn mua vào thương mại Q3/2026 có giá trị từ 5 triệu đồng trở lên với sao kê Techcombank (TK 79713); phát hiện các khoản lệch ngày thanh toán để lập hợp đồng kinh tế bảo vệ chi phí thuế.
- **Working Directory**: `/home/ksp/ksp-pdfsign`
- **Data Sources**:
  - `backend/data/ksp.db` (`inv_purchase_invoices`) & `Bang_ke_hoa_don_Q3_2026_INUT.xlsx`
  - `/tmp/bank_statements_q3/tech_q3_7_8_2026.xlsx` & `/tmp/bank_statements_q3/tech_q3_9_2026.xlsx`
- **Requirements**:
  - R1: Lọc hóa đơn mua vào Q3/2026 $\ge$ 5 triệu (loại trừ tờ khai hải quan, phí/thuế ngân hàng, hóa đơn hủy).
  - R2: Trích xuất và lập chỉ mục các giao dịch chi tiền từ sao kê Techcombank.
  - R3: Đối chiếu khớp nối từng HĐ với sao kê, tính độ lệch ngày ($T_{\text{TT}} - T_{\text{HĐ}}$) và dạng lệch (trả trước, trả sau, chia đợt).
  - R4: Đề xuất danh sách NCC và các điều khoản hợp đồng kinh tế cần ký bổ sung để hợp thức hóa chứng từ thanh toán không dùng tiền mặt.
- **Acceptance Criteria**: C1..C5 verified with zero mock data.
- **Status**: Launched (Multi-Agent Teamwork Active)
