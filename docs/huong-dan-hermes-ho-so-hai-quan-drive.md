# HƯỚNG DẪN HERMES: HỒ SƠ NHẬP KHẨU TỪ GOOGLE DRIVE

## Phạm vi

Phân hệ **Bộ hồ sơ theo tờ khai** đồng bộ một chiều từ Google Drive vào CRM. Bản gốc trên Drive không bị đổi, xóa hoặc di chuyển; hệ thống chỉ lưu bản sao nội bộ và liên kết ngược về folder gốc.

## Nguồn và ghép hồ sơ

- Nguồn năm 2026: folder ID `1yg_TqCrWS4dDx-O-bYYhfktFq1OdNk9z`.
- Mỗi năm dùng một nguồn riêng; không trộn hồ sơ giữa các năm.
- Ghép tự động khi tìm thấy đúng số tờ khai 12 chữ số trong tên folder hoặc nội dung tài liệu.
- Folder không ghép được hoặc có nhiều số tờ khai được đưa vào **Chờ tờ khai** để gán thủ công.
- Excel VNACCS có số tờ khai nhưng chưa có trong CRM được nhập ở trạng thái `draft`, sau đó liên kết vào hồ sơ.

## Checklist review

- Cốt lõi: tờ khai; CI khi phát sinh thanh toán/giá trị giao dịch.
- Theo điều kiện lô hàng: PL, vận đơn B/L hoặc AWB, giấy phép/kiểm tra chuyên ngành, chứng từ nộp thuế, hợp đồng/PO và chứng từ thanh toán.
- Xuất xứ nội bộ: C/O **hoặc** CI/PL ghi rõ China/Trung Quốc là đủ để đánh dấu đã có bằng chứng ban đầu. Chỉ có câu Origin China thì cảnh báo vàng, không tự kết luận đủ điều kiện ưu đãi thuế; thiếu cả hai là cảnh báo đỏ.

## API và vận hành

- `GET /api/inv/customs-drive/sources`: xem nguồn theo năm.
- `POST /api/inv/customs-drive/sync/{year}`: đồng bộ read-only.
- `GET /api/inv/customs-drive/status/{job_id}`: xem trạng thái job.
- `GET /api/inv/customs-drive/folders`: xem danh sách hồ sơ, lọc `waiting_declaration` để xử lý hàng chờ.
- `POST /api/inv/customs-drive/folders/{folder_id}/assign`: gán thủ công vào tờ khai CRM.
- `POST /api/inv/customs-drive/folders/{folder_id}/review`: chạy lại checklist.

Khi review, luôn coi cảnh báo là hỗ trợ kiểm soát nội bộ; việc xác định nghĩa vụ pháp lý cuối cùng cần đối chiếu hồ sơ thực tế và tư vấn đại lý hải quan/kế toán.

