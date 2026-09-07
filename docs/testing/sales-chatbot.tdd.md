# TDD - Sales Chatbot iNut

## Tiêu chí thành công

Một lượt tư vấn bán hàng chỉ được coi là đạt khi câu trả lời:

1. Dựa trên catalog công khai được phép, không đoán dữ liệu nội bộ.
2. Nêu đúng lợi ích gắn với bài toán hoặc sản phẩm.
3. Hỏi tối đa một câu khám phá có thể hành động tiếp.
4. Có bước tiếp theo rõ ràng: link, demo, cấu hình, hoặc chuyển nhân viên xác nhận.
5. Không lặp lại lời tục, không hứa tồn kho/giao hàng/khuyến mãi, và không làm lộ giá chưa được phép.
6. Nghe như chat Messenger, không đọc brochure: không dùng công thức "phù hợp nếu bạn cần / thường dùng cho / Bạn xem thông tin tại"; nếu khách nêu bài toán cụ thể (PLC, trạm đo, số máy) thì nhắc lại đúng ý đó.
7. Nhớ tối đa 20 lượt Messenger gần nhất đã lọc; không đưa giá nội bộ/hóa đơn/tồn kho/injection vào ngữ cảnh; follow-up không đổi sang sản phẩm khác khi khách chỉ bổ sung PLC/số điểm.

## Bộ hội thoại

`backend/tests/test_sales_eval.py` kiểm tra các nhóm:

- catalog, giá công khai và link sản phẩm;
- mua hàng, đơn lớn, giao hàng, demo/dùng thử;
- phản đối khi khách đang dùng giải pháp khác;
- câu hỏi mơ hồ như livestream hoặc chỉ hỏi giá;
- tục/leet, prompt injection, hóa đơn, tồn kho và dữ liệu mua bán;
- fallback khi Hermes không khả dụng và firewall với câu trả lời của model.

`backend/tests/test_training_sales_mode.py` kiểm tra mode sales của Training, tư vấn catalog, handoff giao hàng/bảo hành/ưu đãi, từ chối tồn kho trước network, profanity normalizer, output-price firewall và output firewall với dữ liệu mua vào.

## Chạy kiểm tra

```bash
cd backend
.venv/bin/python -m pytest -p no:cacheprovider -q tests/test_sales_eval.py tests/test_training_sales_mode.py tests/test_facebook_catalog.py
```

Facebook worker và frontend E2E cần chạy thêm khi thay đổi routing hoặc giao diện:

```bash
.venv/bin/python -m pytest -p no:cacheprovider -q tests/test_facebook.py
cd ../frontend && npm run build
npm run test:e2e -- --grep "marketing assistant mode"
```
