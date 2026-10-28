# KSP PDF Signer

Web app **tự host** để **ký số văn bản PDF bằng token chữ ký số WIN-CA** và **kiểm tra tính hợp lệ của chữ ký**.

- Đăng nhập → upload PDF → xem → **kéo chọn vùng** đặt chữ ký → chọn chứng thư số → **ký**.
- Token WIN-CA cắm trên **máy Windows** (mặc định `192.168.1.4`); web app chạy trên **server riêng** và ký từ xa qua một **agent nhỏ** trên máy Windows. Chỉ **digest (hash)** đi qua mạng — file PDF không rời server.
- Kiểm tra chữ ký: **toàn vẹn**, **hợp lệ mật mã**, **chuỗi CA tin cậy**, **thu hồi (OCSP/CRL)**, **timestamp**, **LTV**, **phạm vi ký**.

## Kiến trúc

```
Frontend (React+PDF.js) ──HTTP──► Backend (FastAPI + pyHanko) ──►  Máy Windows cắm token
   xem PDF, chọn vùng                chuẩn bị chữ ký, tính digest,      (192.168.1.111)
   chọn CTS, kiểm tra                nhúng CMS, TSA, LTV, kiểm tra       token WIN-CA/WINCA
```

Chỉ **digest (hash)** đi tới máy Windows; file PDF không rời server. Có **2 chế độ** kết nối token (đặt bằng `SIGNING_MODE`):

- **`ssh`** (mặc định, khuyến nghị) — backend SSH vào máy Windows (tài khoản Administrator) và ký bằng **kho chứng thư Windows + CSP** qua PowerShell. **Không cần cài gì** trên máy Windows ngoài **OpenSSH Server**. PIN token truyền tự động (không hỏi PIN tương tác). Đã kiểm chứng chạy thật với token **WINCA/LCS-CA**.
- **`agent`** — backend gọi HTTP tới một agent Python cài sẵn trên máy Windows, ký qua **PKCS#11**. Dùng khi không bật được SSH.

| Thư mục | Vai trò |
|---|---|
| `backend/` | FastAPI + **pyHanko**: auth, ký (external signing), kiểm tra chữ ký, trust store. `win_ssh.py` = ký qua SSH; `agent_client.py` = ký qua HTTP agent; `token_backend.py` = điều phối theo `SIGNING_MODE` |
| `frontend/` | React + Vite + **pdfjs-dist**: giao diện ký & kiểm tra |
| `windows-agent/` | (Chỉ cho chế độ `agent`) chạy trên máy cắm token: liệt kê chứng thư + ký digest bằng **PKCS#11** |

Tài liệu chuẩn để thiết kế hoặc refactor giao diện: [`docs/ui-design-system.md`](docs/ui-design-system.md).
Tài liệu gồm token màu, typography, component, responsive iPhone/desktop, accessibility,
anti-pattern và checklist kiểm thử trước khi deploy.

## Cài đặt nhanh (dev)

### 0. Cấu hình

```bash
cp .env.example .env       # rồi ĐỔI mật khẩu trước khi chạy thật
```

Trước lần chạy đầu, đặt `APP_ADMIN_PASSWORD` và `AGENT_ADMIN_PASSWORD` mạnh trong `.env`; dự án không cung cấp mật khẩu triển khai mặc định.

### 1. Backend

```bash
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173  (proxy /api → :8000)
```

### 3. Máy Windows cắm token

**Chế độ `ssh` (mặc định)** — chỉ cần bật **OpenSSH Server** trên máy Windows và cho phép tài khoản Administrator đăng nhập; **không cài gì thêm**. Máy backend cần có `sshpass` + `ssh` (Docker image đã kèm sẵn; nếu chạy tay: `apt install sshpass openssh-client`). Token cắm vào, PIN nhập trên giao diện. Yêu cầu: chứng thư token phải nằm trong kho `Cert:\CurrentUser\My` của user đăng nhập (driver token thường tự đăng ký).

**Chế độ `agent`** — xem [`windows-agent/install-service.md`](windows-agent/install-service.md): cài Python, `pip install -r requirements.txt`, sửa `config.ini` (đường dẫn DLL PKCS#11), chạy dưới dạng Windows Service (NSSM). Đặt `SIGNING_MODE=agent` trong `.env`.

### Chạy bằng Docker (backend + frontend)

```bash
cp .env.example .env
docker compose up --build      # frontend: http://localhost:8080
```

> Windows Agent **không** chạy trong Docker — nó phải chạy trên máy Windows cắm token.

### Telegram thông báo Messenger

Bot Telegram chạy long polling trong backend (không cần mở thêm webhook public). Tạo bot
bằng `@BotFather`, đặt token mới vào `.env` rồi khởi động lại backend:

```dotenv
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=<TOKEN_MOI_CUA_BOTFATHER>
TELEGRAM_BOT_USERNAME=Webinut_bot
```

Trong menu quản trị chọn **Telegram thông báo** → **Tạo link đăng nhập Telegram** → mở
link bằng Telegram và bấm **Start**. Link có hạn và chỉ dùng một lần; khi có tin
Messenger mới, bot gửi bản xem trước kèm link mở hộp thư KSP. Có thể dùng `/disconnect`
trong Telegram hoặc nút **Ngắt kết nối** trong KSP để thu hồi liên kết.
Long polling nên chạy một process backend (không dùng nhiều `--workers` cho cùng một bot).

## Trust store (kiểm tra chữ ký báo "tin cậy")

Đặt chứng thư gốc/trung gian vào `backend/app/trust/` — xem [`backend/app/trust/README.md`](backend/app/trust/README.md):
- **Root CA quốc gia (VNRCA)** từ https://rootca.gov.vn
- **Chứng thư gốc WIN-CA** từ nhà cung cấp

Thiếu các file này thì chữ ký vẫn kiểm tra được toàn vẹn & hợp lệ mật mã, nhưng báo *"CA chưa tin cậy"*.

## Kiểm thử

```bash
cd backend && . .venv/bin/activate && pip install pytest && python -m pytest -q
```

## Đồng bộ iHOADON

Màn **Xuất hóa đơn · iHOADON** cho phép xem thống kê, danh sách hóa đơn
`GHI_TAM` và đẩy hóa đơn nháp từ CRM sang tài khoản INUT. Tích hợp này không
có thao tác ký, giữ số hoặc phát hành. Cấu hình tài khoản tại trang **Cài đặt**;
mật khẩu được lưu cục bộ và không commit vào Git.

Phần **cổng khách hàng** đồng bộ riêng các hóa đơn `DA_XUAT`, lưu PDF/XML cục bộ
và ghép khách hàng bằng MST khớp chính xác. Admin bấm **Đồng bộ cổng khách** tại
trang Cài đặt; khách đăng nhập xem hóa đơn và hồ sơ của chính mình, hoặc tải ZIP
theo khoảng ngày. Job hằng ngày lúc 03:00 dùng các unit
`deploy/ksp-ihoadon-sync.service` và `deploy/ksp-ihoadon-sync.timer`.

Trang **Đồng bộ thuế** hiển thị trạng thái token cổng thuế và giới hạn các nút
quý trong năm 2026. Khi token hết hạn, cơ quan thuế vẫn yêu cầu admin nhập CAPTCHA
thủ công trước khi tiếp tục đồng bộ.

Test giả lập token bằng khóa RSA cục bộ (không cần token thật) và kiểm tra:
ký → xác minh **hợp lệ**; sửa 1 byte → phát hiện **không toàn vẹn**; luồng HTTP đăng nhập → upload → ký → kiểm tra.
## Theo dõi lượt xem hồ sơ (Doc Tracking)

Gắn cờ theo dõi lên bất kỳ hồ sơ nào trong **Kho hồ sơ** để nhận **cảnh báo
Telegram tức thì** khi đối tác/khách hàng mở xem, tải xuống hoặc thẩm định chữ
ký số NEAC.

### Cách hoạt động

1. Admin bấm **⋯ → 👁 Theo dõi lượt xem** trên dòng hồ sơ cần theo dõi, nhập
   ghi chú ngữ cảnh, ngày mốc và hạn báo Telegram (số ngày).
2. Khi ai đó mở link chia sẻ `/s/{token}`, trình duyệt tự gọi GeoIP bên thứ 3
   (`ipwho.is` → fallback `Cloudflare cdn-cgi/trace`) lấy **IP thật + tỉnh/thành
   + nhà mạng** rồi gửi kèm **One-Time HMAC Nonce** (60 giây, dùng 1 lần) về
   `POST /api/doc-telemetry`. Backend xác minh nonce, ghi lượt xem, và bắn
   Telegram cho admin.
3. Khi tải file trực tiếp (không qua JS), server fallback ghi nhận từ header
   `X-Forwarded-For` / `X-Real-IP`.

### Chống spam & bảo mật

| Cơ chế | Chi tiết |
|--------|----------|
| HMAC-SHA256 Nonce | Ký bằng `jwt_secret` + `share_token` + `document_id` + `timestamp_60s` + `ua_hash`, hết hạn 60 giây, dùng 1 lần |
| Browser fingerprint nhẹ | Hash `screen + language + timezone + platform` gắn kèm telemetry |
| Cooldown view | Cùng IP + cùng hồ sơ: chỉ bắn Telegram 1 lần mỗi 10 phút |
| Rate limit | Tối đa 3 tin Telegram / 10 phút / IP (chống phá rối) |
| Download & NEAC | Luôn bắn Telegram (vẫn chịu rate limit 3/10min/IP) |
| Hết hạn tự tắt | Quá ngày hạn → ngưng bắn Telegram, vẫn lưu thống kê 100% |

### API

| Endpoint | Mô tả |
|----------|-------|
| `POST /api/doc-telemetry` | Nhận telemetry từ browser (nonce + GeoIP + fingerprint) |
| `GET /api/documents/{id}/tracking` | Xem cấu hình cờ theo dõi |
| `PUT /api/documents/{id}/tracking` | Bật/tắt cờ, ghi chú, ngày mốc, hạn Telegram |
| `GET /api/doc-views` | Dashboard tổng hợp các hồ sơ đang theo dõi |
| `GET /api/doc-views/{id}` | Lịch sử lượt xem chi tiết (phân trang) |

### Giao diện

- **Kho hồ sơ** (`/ho-so`): bấm ⋯ → 👁 Theo dõi lượt xem trên từng dòng.
- **Theo dõi lượt xem** (`/theo-doi-xem`): dashboard tổng hợp số lượt xem/tải/NEAC,
  bấm **Chi tiết** để xem bảng lịch sử IP, vị trí, thiết bị, thời gian.

## Radar Công văn Chính phủ & Thuế cơ sở 7 Đắk Lắk (`gov_radar`)

Màn **Radar Công văn & Thuế CS7** (`/cong-van-chinh-phu`) chủ động quét văn bản từ các cổng chính thức (`.gov.vn`) và kênh **Thuế cơ sở 7 tỉnh Đắk Lắk** (trụ sở Phường Tuy Hòa — cơ quan thuế quản lý trực tiếp INUT `MST: 4401053694`), tự động chấm điểm mức độ liên quan và bắn cảnh báo Telegram.

### Nguồn quét tự động

| Nguồn | Cổng chính thức | Phạm vi |
|---|---|---|
| **Thuế tỉnh Đắk Lắk & Thuế cơ sở 7 (Tuy Hòa)** | `https://daklak.gdt.gov.vn/wps/portal` & Fanpage Thuế CS7 | Quản lý thuế trực tiếp địa bàn Phường Tuy Hòa, tỉnh Đắk Lắk |
| **UBND Tỉnh Đắk Lắk** | `https://daklak.gov.vn/van-ban-chi-dao-dieu-hanh` | Quyết định, Kế hoạch, Công văn chỉ đạo điều hành toàn tỉnh (kèm PDF ký số) |
| **Sở Y tế Tỉnh Đắk Lắk** | `https://yte.daklak.gov.vn` | Khám sức khỏe định kỳ, an toàn vệ sinh lao động tại Đắk Lắk |
| **Chính phủ & Bộ ngành Trung ương** | `https://vanban.chinhphu.vn` | Nghị định, Thông tư mới của Bộ Tài chính, Bộ Y tế, Bộ Nội vụ, Bộ KH&CN |

### API

| Endpoint | Mô tả |
|---|---|
| `GET /api/gov-radar` | Danh sách công văn đã quét (lọc theo nguồn, lĩnh vực, từ khóa, mức độ áp dụng cho INUT) |
| `POST /api/gov-radar/sync` | Chủ động quét văn bản mới từ các cổng `.gov.vn` và gửi bản tin Telegram |
| `POST /api/gov-radar/verify` | Kiểm chứng nhanh số hiệu công văn / tin đồn MXH (VD: `16093/SYT-NVY`, `1858/QĐ-UBND`) xem có áp dụng cho INUT tại Đắk Lắk hay không |

## Bảo mật — lưu ý

- **Đổi toàn bộ mật khẩu mặc định** trong `.env` trước khi dùng thật; UI cảnh báo khi còn mặc định.
- Agent chỉ nên nghe trong LAN, dùng HTTPS, và giới hạn firewall chỉ nhận từ IP backend.
- Không commit `.env`, chứng thư nội bộ, hay khóa lên git (đã có trong `.gitignore`).

## Ghi chú kỹ thuật

- **Ký ngoài (external signing)**: backend dùng pyHanko chuẩn bị field + appearance tại vùng đã chọn và tính byte-range digest; agent ký digest bằng token với `CKM_SHA256_RSA_PKCS`; backend nhúng CMS. Có thể bật **TSA** (`TSA_URL`) và **LTV** (`ENABLE_LTV`).
- **Tọa độ**: frontend chuyển pixel canvas → điểm PDF bằng `viewport.convertToPdfPoint` (tự xử lý zoom & lật trục Y).
