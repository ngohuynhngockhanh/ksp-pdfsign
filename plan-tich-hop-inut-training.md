# Kế hoạch tích hợp iNut Training thành trợ lý hỏi đáp công khai

## Tóm tắt

Đưa một nút hỏi đáp nổi trên toàn bộ trang công khai `inut.vn` (VI/EN). Người dùng phải nhập số điện thoại và đồng ý lưu trữ trước câu hỏi đầu tiên. Câu hỏi được chuyển qua BFF cùng-origin của Next.js, đi qua kết nối nội bộ tới KSP Training, rồi Hermes trả lời có nguồn. Trình duyệt không được biết hoặc gọi trực tiếp `ksp-pdf-signer.p2p.inut.io.vn`.

KSP lưu lead và lịch sử hội thoại trong SQLite hiện có; số điện thoại được mã hóa bằng Fernet, có fingerprint HMAC để chống trùng và chỉ hiển thị 4 số cuối mặc định. Dữ liệu công khai giữ 12 tháng, có màn hình quản trị trong `/training` để xem, ghi chú, đổi trạng thái và xóa.

## Thay đổi chính

### KSP Training / backend

- Thêm bảng `training_public_sessions` và `training_public_queries`; tạo bảng tự động khi khởi động, dọn dữ liệu quá 365 ngày.
- Thêm chuẩn hóa số điện thoại Việt Nam, mã hóa số điện thoại, fingerprint HMAC, trạng thái lead và ghi chú nội bộ.
- Thêm xác thực HMAC server-to-server cho các endpoint `/internal/public-training/*`; kiểm tra timestamp, nonce chống replay, client id và giới hạn kích thước request.
- Thêm endpoint nội bộ:
  - `POST /internal/public-training/sessions`
  - `POST /internal/public-training/questions`
  - `GET /internal/public-training/questions/{jobId}`
  - `GET /internal/public-training/history`
- Thêm endpoint quản trị cho `/training`:
  - `GET /api/training/public-leads`
  - `GET /api/training/public-leads/{sessionId}`
  - `PATCH /api/training/public-leads/{sessionId}`
  - `DELETE /api/training/public-leads/{sessionId}`
- Tách job công khai khỏi job CRM, giữ quyền truy cập theo session token và không cho public request gọi tool/lệnh.
- Lọc hoặc rewrite mọi URL nội bộ Training trong câu trả lời, citation, lỗi và header trước khi trả ra BFF.

### Website / Next.js BFF

- Thêm các route cùng-origin:
  - `POST /api/assistant/session`
  - `POST /api/assistant/questions`
  - `GET /api/assistant/questions/{jobId}`
  - `GET /api/assistant/history`
- BFF dùng cookie `HttpOnly`, `Secure` ở production, `SameSite=Lax`, không lưu token ở localStorage.
- Kiểm tra Origin, honeypot, consent, locale, số điện thoại, độ dài câu hỏi và giới hạn tốc độ trước khi gọi KSP.
- Ký request HMAC bằng secret chỉ có ở server; secret và `KSP_TRAINING_INTERNAL_URL` không dùng tiền tố `NEXT_PUBLIC_`.
- Thêm widget trợ lý toàn site, song ngữ VI/EN, có focus/keyboard/aria-live, trạng thái chờ/lỗi/empty và lịch sử ngắn.

### Vận hành và an toàn

- Kết nối KSP nội bộ mặc định qua `127.0.0.1:18090` (FRP STCP); không công bố hostname Training trong HTML hoặc JSON public.
- Bật tính năng sau feature flag/hạ tầng đã cấu hình; nếu BFF hoặc Hermes lỗi, widget hiển thị thông báo an toàn và không lộ stack trace.
- Kiểm tra secret không nằm trong git, không stage `.env`, giữ quyền file dữ liệu `0700/0600`.

## Kiểm thử và nghiệm thu

- Unit: chuẩn hóa số điện thoại, fingerprint/mã hóa, HMAC canonical request, nonce replay, lọc URL nội bộ, giới hạn độ dài và rate limit.
- Integration: endpoint nội bộ từ chối request thiếu/sai chữ ký; tạo session không lưu plaintext phone; query bị giới hạn theo session; cleanup sau 365 ngày; admin CRUD lead/transcript.
- Frontend: BFF từ chối cross-origin/không consent/honeypot; cookie không lộ qua JS; response không chứa hostname nội bộ.
- E2E Playwright: mở widget trên VI và EN, nhập phone + consent, gửi câu hỏi, theo dõi job, hiển thị answer/citation; reload vẫn giữ session; lỗi Hermes hiển thị graceful; mobile keyboard/focus hoạt động.
- Chạy backend pytest, frontend typecheck/build/lint và detector Impeccable sau khi hoàn tất UI.

## Giả định và mặc định

- Không OTP ở phiên bản đầu; số điện thoại là bắt buộc trước câu hỏi đầu tiên.
- Không cho public truy cập `/training`; khu vực này tiếp tục yêu cầu đăng nhập và `noindex, nofollow`.
- Lead retention mặc định 365 ngày; admin có quyền xóa sớm.
- Không thay đổi các module nghiệp vụ đang có trong KSP; triển khai trên branch/worktree riêng khi làm production.
- Commit local theo các checkpoint TDD; chưa push/deploy nếu chưa có approval vận hành riêng.
