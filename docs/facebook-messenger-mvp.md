# Facebook Messenger MVP

MVP này nhận tin nhắn từ fanpage iNut JSC, lưu ngữ cảnh theo Facebook PSID,
gọi iNut Training/Hermes và gửi câu trả lời lại qua Meta Graph API.

## Callback

```text
https://ksp-pdf-signer.p2p.inut.io.vn/webhooks/facebook
```

Page đang kết nối là `INUT JSC - IoT and Edge Computing`, Page ID
`1698631723787176`.

## Cấu hình server

Đặt các giá trị sau trong `.env` của `ksp-pdfsign` (không commit token):

```dotenv
FACEBOOK_ENABLED=true
FACEBOOK_PAGE_ID=100063494173321
FACEBOOK_VERIFY_TOKEN=<chuoi-bi-mat-tu-tao>
FACEBOOK_APP_SECRET=<Meta-App-Secret>
FACEBOOK_PAGE_ACCESS_TOKEN=<Page-Access-Token>
FACEBOOK_GRAPH_BASE_URL=https://graph.facebook.com
FACEBOOK_GRAPH_VERSION=v23.0
FACEBOOK_REPLY_ENABLED=true
TRAINING_RATE_LIMIT_PER_MINUTE=100
TRAINING_RATE_WINDOW_SECONDS=60
```

`FACEBOOK_VERIFY_TOKEN`, App Secret và Page Access Token không được gửi trong
chat, log hoặc commit. Có thể tạo verify token bằng secret manager hoặc:

```bash
openssl rand -hex 32
```

Sau khi đổi `.env`, khởi động lại backend để `get_settings()` đọc cấu hình mới.

## Cấu hình Meta

1. Trong Meta for Developers, tạo/chọn App có quyền quản trị fanpage.
2. Thêm Messenger/Webhooks, nhập callback URL ở trên và đúng verify token.
3. Chọn Page iNut JSC, cấp Page Access Token và đăng ký các sự kiện tin nhắn.
4. Dùng tài khoản trong App Roles để kiểm thử trước. Khi mở cho khách ngoài
   vai trò thử nghiệm, hoàn tất App Review/Advanced Access theo yêu cầu Meta.

Meta sẽ gọi `GET` để kiểm tra webhook, sau đó gửi `POST` có
`X-Hub-Signature-256`. Backend kiểm tra chữ ký, bỏ event trùng `mid`, ACK
nhanh rồi xử lý Hermes ở worker nền.

## Giá và tồn kho

MVP lấy `Product.don_gia` làm giá tham khảo nội bộ và đối chiếu tồn từ `InvItem`
và sổ kho. Hermes được nhắc rõ không tự bịa giá/tồn/giao hàng. Câu hỏi cần
chốt giá chính thức, cấu hình đặc biệt hoặc đơn lớn sẽ được đánh dấu chuyển
nhân viên.

Hermes profile `inuttraining` đang dùng model `hermes` qua nine-router. KSP tái
sử dụng phiên đăng nhập Hermes để không đốt giới hạn đăng nhập 5 lần/10 phút;
rate limit Training mặc định là 100 yêu cầu/60 giây và có thể chỉnh trong
`Cài đặt hệ thống`.

MVP hiện xử lý văn bản và attachment placeholder; chưa tự phân tích ảnh/voice,
chưa tạo báo giá hoặc hóa đơn và chưa tự ghi sổ kho.

Quản trị viên xem thống kê rate, lỗi/reject Training và số tin vào/ra Facebook
trong trang `Training`. Khu vực `MESSENGER INBOX` nhóm hội thoại theo người,
hiển thị tên Facebook (hoặc PSID rút gọn nếu Meta không cho đọc tên), và cho
phép bấm vào để xem toàn bộ lịch sử chat.

Mỗi tin trả lời còn lưu thời gian từ lúc webhook nhận tin đến lúc Graph API
nhận câu trả lời, cùng các chặng hàng đợi, dựng ngữ cảnh, Hermes và gửi Graph.
Dashboard hiển thị trung bình, P50, P95 và P95 từng chặng để biết chính xác
điểm nghẽn thay vì đoán.

Messenger có lớp guardrail trước Hermes: chỉ nhận câu hỏi liên quan sản phẩm,
giải pháp và quy trình iNut trong dữ liệu đã duyệt; từ chối chủ đề lan man,
lập trình, lệnh shell/console và prompt injection. Các yêu cầu bị chặn không
mở phiên Hermes nên vừa an toàn vừa phản hồi nhanh hơn.

## Kiểm tra nhanh

```bash
cd backend
.venv/bin/python -m pytest -p no:cacheprovider -q tests/test_facebook.py
```

Nếu chưa điền đủ secret, endpoint sẽ trả `503` thay vì nhận webhook không an
toàn. Không dùng Page Access Token trong URL; client gửi token qua header
`Authorization: Bearer`.
