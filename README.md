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

Test giả lập token bằng khóa RSA cục bộ (không cần token thật) và kiểm tra:
ký → xác minh **hợp lệ**; sửa 1 byte → phát hiện **không toàn vẹn**; luồng HTTP đăng nhập → upload → ký → kiểm tra.

## Bảo mật — lưu ý

- **Đổi toàn bộ mật khẩu mặc định** trong `.env` trước khi dùng thật; UI cảnh báo khi còn mặc định.
- Agent chỉ nên nghe trong LAN, dùng HTTPS, và giới hạn firewall chỉ nhận từ IP backend.
- Không commit `.env`, chứng thư nội bộ, hay khóa lên git (đã có trong `.gitignore`).

## Ghi chú kỹ thuật

- **Ký ngoài (external signing)**: backend dùng pyHanko chuẩn bị field + appearance tại vùng đã chọn và tính byte-range digest; agent ký digest bằng token với `CKM_SHA256_RSA_PKCS`; backend nhúng CMS. Có thể bật **TSA** (`TSA_URL`) và **LTV** (`ENABLE_LTV`).
- **Tọa độ**: frontend chuyển pixel canvas → điểm PDF bằng `viewport.convertToPdfPoint` (tự xử lý zoom & lật trục Y).
