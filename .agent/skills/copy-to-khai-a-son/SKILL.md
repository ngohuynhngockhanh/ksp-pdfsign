---
name: copy-to-khai-a-son
description: Soạn đoạn tin nhắn tiếng Việt có thể copy ngay để gửi anh Sơn/đơn vị khai hải quan, gồm trạng thái lô hàng, link Drive, tên hàng khai báo và HS Code đề xuất. Dùng khi người dùng nói "copy tờ khai anh Sơn", "soạn tên tờ khai", "tên hàng tiếng Việt đề xuất", "hàng về rồi", hoặc cần tổng hợp CI/PL/Datasheet theo mẫu các tờ khai luồng xanh trước đây.
---

# Copy tờ khai anh Sơn

Tạo một đoạn tin nhắn ngắn, đúng dữ liệu chứng từ và sẵn để copy. Ưu tiên bằng chứng theo thứ tự `CI -> Datasheet -> PL -> tờ khai luồng xanh cũ`.

## Quy trình

1. Xác định đúng bộ hồ sơ và trạng thái vận chuyển.
   - Nếu người dùng nói hàng đang đi, dùng câu `Dạ hàng đang trên đường về ạ`.
   - Chỉ dùng `Dạ hàng về rồi ạ` khi có xác nhận hàng đã đến.
   - Giữ nguyên link Drive người dùng cung cấp; nếu chưa có link, hỏi hoặc bỏ dòng link.

2. Đọc CI để lấy dữ liệu pháp lý chính:
   - Tên hàng, model, số lượng, đơn giá, tổng tiền, HS phía xuất khẩu và xuất xứ.
   - Luôn ưu tiên model trên CI. Không lấy model từ tên file Datasheet nếu khác CI.

3. Đọc Datasheet để bổ sung mô tả kỹ thuật:
   - Công dụng chính, nguyên lý/kiểu thiết bị, vật liệu, giao tiếp hoặc tín hiệu đầu ra, độ phân giải và nguồn điện khi thực sự cần phân loại.
   - Chỉ đưa các đặc tính phân biệt hàng hóa; tránh biến tên khai báo thành một đoạn quảng cáo dài.

4. Đọc PL để kiểm tra số lượng, kiện, trọng lượng và kích thước. Nêu riêng mọi điểm không khớp CI.

5. Tham chiếu tờ khai luồng xanh cũ nếu workspace có dữ liệu:
   - Tìm các tờ khai có `phan_luong == "1"` và đọc mô tả dòng hàng.
   - Bám cấu trúc đã được chấp nhận, không sao chép mô tả của sản phẩm khác.
   - Mẫu ưu tiên: `{Tên hàng/công dụng}, {cấu tạo hoặc đặc tính chính}, model: {MODEL}, NSX: {MANUFACTURER}, hàng mới 100%`.

6. Đề xuất HS Code:
   - Xem mã trên CI là bằng chứng đầu vào, không mặc định đó là mã Việt Nam.
   - Nếu CI dùng mã quốc gia 10 số, quy đổi sang mã Việt Nam phù hợp và ghi rõ `HS Code đề xuất`.
   - Đối chiếu chức năng thực tế trong Datasheet và mẫu khai cũ. Không phân loại chỉ từ tên thương mại.
   - Khi chưa có căn cứ pháp lý chắc chắn, yêu cầu đơn vị khai hải quan xác nhận trước khi mở tờ khai.

7. Kiểm tra chéo trước khi xuất:
   - Model CI với Datasheet/receipt.
   - Số lượng CI với PL.
   - Trị giá CI với receipt/chứng từ thanh toán.
   - Xuất xứ CI/nhãn và thông tin nhà sản xuất.

## Định dạng đầu ra

Xuất khối đầu tiên để người dùng copy nguyên văn:

```text
Dạ hàng {đang trên đường về|về rồi} ạ, chi tiết chứng từ đầy đủ trong folder:
{DRIVE_URL}

Tên hàng tiếng Việt đề xuất:
{TÊN HÀNG}, model: {MODEL}, NSX: {NHÀ SẢN XUẤT}, hàng mới 100%.

HS Code đề xuất: {HS_CODE}.
Nhờ các anh kiểm tra và xác nhận giúp em tên hàng, mã HS trước khi mở tờ khai ạ.
```

Sau khối copy, chỉ thêm tối đa ba ghi chú ngắn về chênh lệch hoặc dữ liệu cần xác nhận. Không trộn cảnh báo vào giữa nội dung copy.

## Nguyên tắc

- Không bịa model, vật liệu, xuất xứ, NSX hoặc HS Code.
- Không gọi một mã HS là chắc chắn nếu mới chỉ dựa vào CI/Datasheet.
- Không tự đồng bộ Drive, sửa hồ sơ hay gửi tin nhắn ra ngoài nếu người dùng chỉ yêu cầu soạn nội dung.
- Viết tự nhiên theo giọng nội bộ Việt Nam: lịch sự, ngắn, dễ copy.
