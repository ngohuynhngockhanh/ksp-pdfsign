# Đề Xuất Lưu Trữ Quy Tắc Nghiệp Vụ (Learning Proposal)

## 1. Phân loại & Bối cảnh (Classification & Context)
- **Nguồn yêu cầu**: Chỉ đạo trực tiếp của người dùng về quy tắc pháp lý và thực thi ký số đối với Hóa đơn bán ra, Biên bản bàn giao (BBBG) và Hợp đồng giao khoán nhân công/thợ ngoài.
- **Phạm vi tác động**:
  1. **Quy tắc ký số Biên bản bàn giao (BBBG)**: Đồng bộ mốc thời gian ký số với Hóa đơn bán ra.
  2. **Quy tắc định ngày Hợp đồng khoán**: Thời điểm ký HĐ khoán so với ngày xuất Hóa đơn đầu ra.
  3. **Quy tắc điều khoản thanh toán HĐ khoán**: Ràng buộc thời hạn thanh toán sau khi có Biên bản nghiệm thu.

---

## 2. Chi tiết 3 Quy tắc cốt lõi cần lưu trữ (Core Rules)

### Quy tắc 1: Đồng bộ ngày ký số BBBG với Hóa đơn bán ra
- **Nội dung**: Khi ký số Biên bản bàn giao (BBBG) đi kèm hóa đơn bán ra, ngày lập và mốc thời gian ký số mật mã nhúng trong file PDF (`/M`) **bắt buộc phải lùi về cùng ngày với ngày xuất hóa đơn bán ra** (thời điểm ký số PDF sau mốc ký hóa đơn từ 45 – 55 phút ngẫu nhiên).
- **Yêu cầu kỹ thuật**: Sử dụng tính năng truyền `system_time` vào PyHanko khi ký số bằng USB Token WINCA để nhúng mốc thời gian lịch sử, đảm bảo Foxit Reader và Adobe Acrobat kiểm tra chữ ký báo **Hợp lệ (Signature is VALID, Integrity Intact)**.

### Quy tắc 2: Logic thời điểm ký Hợp đồng giao khoán
- **Nội dung**: Ngày ký Hợp đồng giao khoán **phải đi trước ngày xuất hóa đơn bán ra từ 15 đến 30 ngày**.
- **Căn cứ kế toán & kiểm toán**: Công việc khoán thi công/lắp đặt/gia công phải được giao kết trước $\rightarrow$ Thợ thực hiện $\rightarrow$ Hoàn thành công việc $\rightarrow$ Nghiệm thu đạt chuẩn $\rightarrow$ Mới đủ căn cứ xuất hóa đơn bán ra cho khách hàng. Không được để ngày HĐ khoán sau ngày hóa đơn bán ra.

### Quy tắc 3: Điều khoản thanh toán Hợp đồng khoán sau nghiệm thu
- **Nội dung**: Trong điều khoản thanh toán của Hợp đồng giao khoán, bắt buộc phải ghi rõ:
  > *"Khi có Biên bản nghiệm thu khối lượng hoàn thành đạt yêu cầu, Bên A (iNut) sẽ thực hiện thanh toán thù lao cho Bên B (người nhận khoán) trong vòng 30 (ba mươi) ngày kể từ ngày ký Biên bản nghiệm thu."*
- **Ý nghĩa thuế & quản trị**: Hợp thức hóa việc thanh toán sau nghiệm thu, bảo vệ chi phí được trừ khi tính thuế TNDN theo Nghị định 320/2025/NĐ-CP và thời hạn thanh toán không dùng tiền mặt (Nghị định 181/2025/NĐ-CP & 253/2026/NĐ-CP).

---

## 3. Các vị trí tài liệu & mã nguồn cập nhật (Proposed Additions)

1. **`docs/OMP_PLAYBOOK.md`**: Bổ sung Mục 6: "Quy chuẩn nghiệp vụ Hóa đơn - BBBG - Hợp đồng giao khoán".
2. **`.agent/skills/quarterly-tax-invoice-sync/SKILL.md`**: Cập nhật Mục 4 về quy tắc đồng bộ ngày BBBG và hợp đồng khoán.
3. **`backend/app/templates_bbbg/hop_dong_giao_khoan.html`**: Chuẩn hóa điều khoản thanh toán trong mẫu hợp đồng khoán: thời hạn thanh toán trong vòng 30 ngày kể từ ngày nghiệm thu.
