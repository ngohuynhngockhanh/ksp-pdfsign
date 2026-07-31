# TDD: đồng bộ và kiểm soát hóa đơn nháp iHOADON

## Hành trình người dùng

- Admin tạo hóa đơn nháp doanh nghiệp với đủ tên, MST, địa chỉ và tiền bằng chữ tự động.
- Admin đồng bộ lại bản nháp đã sửa trên iHOADON vào đúng hồ sơ CRM mà không đổi link chia sẻ.

## Bằng chứng RED/GREEN

| Bảo đảm | Kiểm thử | RED | GREEN |
|---|---|---|---|
| Payload có `total_payment_in_word` | `backend/tests/test_ihoadon_delivery.py` | Thiếu khóa | Đạt |
| Thiếu địa chỉ bị chặn bằng tiếng Việt | `backend/tests/test_ihoadon_delivery.py` | API đi tiếp và trả 502 | Trả 400 đúng thông báo |
| Đồng bộ lặp lại giữ nguyên hồ sơ và link | `backend/tests/test_ihoadon_delivery.py` | Endpoint chưa tồn tại | Đạt |
| Nút đồng bộ hoạt động trên desktop/mobile | `frontend/e2e/sale-draft-delivery.spec.ts` | Không tìm thấy nút | Đạt trên hai viewport |

## Lệnh kiểm chứng

- `backend/.venv/bin/pytest -q backend/tests/test_ihoadon_delivery.py`
- `npm run build`
- `npx playwright test e2e/sale-draft-delivery.spec.ts --grep "syncs a corrected PYMID"`
- `npm audit --audit-level=high`

Kiểm thử đồng bộ PYMID đạt trên desktop và mobile. Kiểm thử Axe cũ của toàn studio vẫn báo các lỗi nhãn/độ tương phản có sẵn ngoài phạm vi thay đổi này.
