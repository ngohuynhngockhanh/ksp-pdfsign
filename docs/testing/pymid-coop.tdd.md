# Bằng chứng TDD - INUT PYMID CO.OP

## Hành trình người dùng

- PYMID xem đúng danh mục giá riêng, cấu hình Nebi Level 1-3 và không thấy dữ liệu khách hàng khác.
- PYMID lưu và sửa đơn nháp, gửi INUT duyệt, tải Excel báo giá/cấu hình/Nhanh.vn.
- INUT duyệt đơn; tài khoản khách hàng khác không được truy cập.
- Giá phần cứng áp dụng VAT theo ngày chứng từ; phần mềm luôn tách riêng và ghi KCT.

## Bằng chứng RED/GREEN

| Bảo đảm | Loại | RED | GREEN |
|---|---|---|---|
| Danh mục 23 dòng, giá tăng 15%, VAT/KCT và phân quyền | API | `6edbceb` | `29092ad` |
| Luồng PYMID desktop/mobile | E2E | `2e129eb` | `ca179d3` |
| Sửa nháp và xuất danh mục Excel | API | `ad62940` | `cd24aa5` |
| Mở lại nháp trên trình duyệt | E2E | `4a78a03` | `ca179d3` |
| Chặn cấu hình sai Level hoặc lặp sản phẩm | API | `b66152c` | `06e92f1` |

## Lệnh xác minh

```bash
backend/.venv/bin/pytest -q backend/tests/test_pymid_coop.py
cd frontend && npm run build
cd frontend && npm run test:e2e -- e2e/pymid-coop.spec.ts
```

Kết quả tại thời điểm hoàn tất: 7 bài API đạt; 2 bài E2E desktop/mobile đạt, không tràn ngang và không có vi phạm WCAG A/AA trong vùng tính năng.

## Khoảng trống có chủ đích

- Sheet Nhanh.vn hiện là định dạng trung gian, chưa kiểm thử với mẫu import mới nhất tải trực tiếp từ tài khoản PYMID.
- Chưa sinh PDF báo giá riêng; sheet `Báo giá` trong Excel là chứng từ bàn giao hiện tại.
- Bao phủ 80% được áp dụng cho logic module qua các bài API và luồng E2E; dự án chưa có cấu hình báo cáo coverage thống nhất cho toàn bộ ứng dụng.
