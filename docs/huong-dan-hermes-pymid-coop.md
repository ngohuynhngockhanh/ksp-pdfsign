# INUT - PYMID CO.OP

## Mục đích

Đây là khu vực hợp tác riêng giữa CÔNG TY TNHH PYMID và INUT. PYMID được cấu hình bộ giải pháp nhà yến, lưu nháp, gửi INUT duyệt và tải file Excel để làm báo giá hoặc nạp dữ liệu vào Nhanh.vn. Quản trị viên INUT xem và duyệt các đơn đã gửi.

## Phân quyền

- Hồ sơ CRM PYMID được nhận diện bằng mã số thuế `0313610275`.
- Chỉ quản trị viên hoặc tài khoản gắn đúng hồ sơ CRM này được gọi `/api/pymid/*`.
- Mọi truy vấn đơn hàng luôn giới hạn bằng `customer_id` của PYMID.
- Chỉ quản trị viên được duyệt đơn. Đơn đã gửi duyệt không được sửa.

## Quy tắc danh mục và giá

- Danh mục có 23 sản phẩm từ bảng giá hai bên đã cung cấp.
- Giá hợp tác tăng 15% so với cột giá nhập cũ.
- Phần cứng: giá hợp tác hiện tại là giá đã gồm VAT 8%. Hệ thống lưu phần giá trước thuế và tính lại theo chính sách tại ngày chứng từ.
- Đến hết ngày 31/12/2026: dùng VAT 8% theo Nghị quyết 204/2025/QH15.
- Từ ngày 01/01/2027: hệ thống hiện dùng VAT 10%. Khi pháp luật thay đổi phải cập nhật `vat_policy()` và bổ sung test trước khi triển khai.
- Phần mềm: tăng 15% nhưng thuộc diện không chịu thuế, hiển thị `KCT`; tuyệt đối không ghi thành VAT 0%.
- Các mã phần mềm hiện tại: dòng nguồn 9, 10, 11, 14 và 18. Các bộ vòng check âm là phần cứng dù bảng cũ ghi loại phần mềm.

## Quy tắc hóa đơn

- Phần cứng được gom thành một dòng, đơn vị `Bộ`, số lượng `1`:
  `iNut Nebi - Bộ giải pháp nhà yến cho kết cấu giám sát, lưu trữ, Model Level X - Phiên bản tùy chỉnh theo cấu hình mong muốn của khách hàng từ phần cứng`.
- Mã trung tâm `PMC01`, `PMC02`, `PMC03` tương ứng Level 1, 2, 3.
- Phần mềm giữ thành từng dòng riêng: `iNut Nebi Software: License <tên phần mềm>`, đơn vị `Gói`, thuế `KCT`.
- Mỗi đơn lưu snapshot ngày chứng từ, mã chính sách, danh mục, đơn giá, thuế và tổng tiền. Không tính lại đơn cũ chỉ vì danh mục hoặc luật thay đổi.

## Luồng sử dụng

1. PYMID chọn Level, ngày dự kiến xuất, công trình và số lượng từng thiết bị/phần mềm.
2. Chọn `Lưu nháp`; có thể chọn `Sửa nháp` và cập nhật nhiều lần.
3. Chọn `Gửi INUT duyệt`; từ thời điểm này đơn bị khóa chỉnh sửa.
4. Quản trị viên chọn `INUT duyệt`.
5. Hai bên có thể tải Excel từng đơn hoặc danh mục giá theo ngày chứng từ.

## File Excel

- File đơn hàng: `Báo giá`, `Nhanh.vn`, `Cấu hình`.
- File danh mục: `Danh mục giá`, `Nhanh.vn`.
- Sheet `Nhanh.vn` là bảng trung gian theo dữ liệu hiện có. Do mẫu import của Nhanh.vn có thể thay đổi, cần bổ sung cơ chế nhận mẫu mới do PYMID tải từ Nhanh.vn nếu muốn bảo đảm import trực tiếp lâu dài.

## Điểm vào kỹ thuật

- Nghiệp vụ giá: `backend/app/pymid.py`.
- API và Excel: `backend/app/pymid_api.py`.
- Mô hình dữ liệu: `backend/app/db.py`.
- Giao diện: `frontend/src/pages/PymidCoop.tsx`.
- Kiểm thử API: `backend/tests/test_pymid_coop.py`.
- Kiểm thử trình duyệt: `frontend/e2e/pymid-coop.spec.ts`.

## Lưu ý từ Hermes

Hermes khuyến nghị lưu thuế suất và cách xử lý thuế trên từng dòng, lưu cờ giá đã gồm thuế, đồng thời snapshot chính sách và ngày chứng từ. Khi sao chép chứng từ sau thời điểm VAT 8% hết hiệu lực, hệ thống phải cảnh báo và tính lại theo chính sách của ngày chứng từ mới. Thiết kế hiện tại đã snapshot các giá trị chính; nếu bổ sung chức năng sao chép đơn thì bắt buộc áp dụng cảnh báo này.

