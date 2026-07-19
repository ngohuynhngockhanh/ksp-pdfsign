# Trust store — chứng thư gốc CA Việt Nam

Đặt các file chứng thư gốc & trung gian (`.cer` / `.crt` / `.pem` / `.der`) vào thư mục này.
Khi kiểm tra chữ ký, tất cả sẽ được nạp làm **trust root**.

Cần có tối thiểu:

1. **Root CA quốc gia (VNRCA / MIC)** — tải từ Trung tâm Chứng thực điện tử quốc gia (NEAC):
   https://rootca.gov.vn  (phần "Tải chứng thư số Root CA").
2. **Chứng thư gốc + trung gian của WIN-CA** — nhà cung cấp token của bạn.
   Thường lấy từ trang hỗ trợ của WIN-CA hoặc trích từ chính token.

> Nếu thiếu các chứng thư này, chữ ký vẫn kiểm tra được **toàn vẹn** và **hợp lệ mật mã**,
> nhưng sẽ báo **"CA chưa tin cậy"** (trusted = false) vì không dựng được chuỗi tới root.

File trong thư mục này (trừ README) không nên commit nếu là chứng thư nội bộ; chứng thư
gốc công khai của CA thì commit được.
