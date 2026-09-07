# Facebook Messenger MVP

MVP này nhận tin nhắn từ fanpage iNut JSC, lưu inbox theo Facebook PSID,
gọi iNut Training/Hermes và gửi câu trả lời lại qua Meta Graph API. Bot chạy
ở **Facebook Sales Mode**: tư vấn nhu cầu như nhân viên bán hàng, hỏi một câu
khám phá phù hợp, nêu lợi ích, gửi link sản phẩm và mời nhân viên xác nhận khi
cần báo giá/custom. Lịch sử Messenger chỉ phục vụ hộp thư quản trị viên;
không gửi nguyên văn lịch sử vào Hermes.

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

## Phạm vi dữ liệu giá công khai

Luồng Hermes qua Facebook **không được đọc bất kỳ dữ liệu hóa đơn, mua vào,
bán ra, tồn kho, giá vốn hoặc CRM nội bộ nào**. `facebook_catalog.py` chỉ gọi
đúng ba trang công khai sau và không có fallback sang database:

- iNut RS485: https://inut.vn/solutions/p/rs485-gateway
- iNut Datalogger / iNut PC: https://inut.vn/solutions/p/datalogger-cong-nghiep
- iNut BilliardLive: https://inut.vn/solutions/billiard-live

Giá được đọc từ nội dung website, cache tối đa 5 phút; nếu website lỗi thì
trả lời chưa đọc được giá công khai và chuyển nhân viên. Câu hỏi về hóa đơn,
mua vào/bán ra, giá vốn hoặc tồn kho bị chặn trước khi mở phiên Hermes.
Hermes cũng nhận policy công khai đã lọc và câu trả lời nhắc tới dữ liệu tài
chính nội bộ sẽ bị thay bằng thông báo từ chối.

Các câu chào hỏi, hỏi catalog, hỏi giá sản phẩm công khai, hỏi giá mơ hồ,
xin link và nhận diện một trong ba sản phẩm được trả nhanh ở lớp KSP để khách
không phải chờ Hermes. Bot cũng nhận diện sản phẩm công khai ở lượt trước để
hiểu các câu tiếp như “món này bao nhiêu tiền?” hoặc “PLC Siemens 20 điểm”.
Các câu cần hiểu bài toán hoặc tư vấn sâu được gửi sang Hermes cùng playbook
bán hàng và tối đa 20 lượt hội thoại đã lọc. Playbook yêu cầu câu trả lời
2–5 câu, tối đa một câu hỏi khám phá, không hỏi lại điều khách vừa nói,
không hứa tồn kho/giao hàng/khuyến mãi và luôn có bước tiếp theo rõ ràng.

Mỗi tin nhắn Facebook tạo một mã phiên Hermes mới dạng `facebook-once-*`,
không resume phiên của tin trước. `personal_context` chứa policy công khai,
catalog của ba URL trên, sản phẩm công khai đang quan tâm, và tối đa 20 lượt
Messenger đã lọc (bỏ hóa đơn, tồn kho, giá không công khai, lời tục, injection).

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

Messenger có lớp guardrail trước Hermes: chặn dữ liệu hóa đơn/mua bán, tồn kho,
lập trình, lệnh shell/console, prompt injection và lời lẽ xúc phạm. Các yêu cầu
bị chặn không mở phiên Hermes nên vừa an toàn vừa phản hồi nhanh hơn; câu hỏi
lan man nhưng vô hại được Hermes chuyển hướng ngắn gọn về nhu cầu sản phẩm.

## Kiểm tra nhanh

```bash
cd backend
.venv/bin/python -m pytest -p no:cacheprovider -q tests/test_facebook.py
```

Nếu chưa điền đủ secret, endpoint sẽ trả `503` thay vì nhận webhook không an
toàn. Không dùng Page Access Token trong URL; client gửi token qua header
`Authorization: Bearer`.
