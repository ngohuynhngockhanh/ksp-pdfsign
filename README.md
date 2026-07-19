# KSP PDF Signer

Web app **tự host** để **ký số văn bản PDF bằng token chữ ký số WIN-CA** và **kiểm tra tính hợp lệ của chữ ký**.

- Đăng nhập → upload PDF → xem → **kéo chọn vùng** đặt chữ ký → chọn chứng thư số → **ký**.
- Token WIN-CA cắm trên **máy Windows** (mặc định `192.168.1.4`); web app chạy trên **server riêng** và ký từ xa qua một **agent nhỏ** trên máy Windows. Chỉ **digest (hash)** đi qua mạng — file PDF không rời server.
- Kiểm tra chữ ký: **toàn vẹn**, **hợp lệ mật mã**, **chuỗi CA tin cậy**, **thu hồi (OCSP/CRL)**, **timestamp**, **LTV**, **phạm vi ký**.

## Kiến trúc

```
Frontend (React+PDF.js) ──HTTP──► Backend (FastAPI + pyHanko) ──HTTPS──► Windows Agent (192.168.1.4)
   xem PDF, chọn vùng                chuẩn bị chữ ký, tính digest,          giữ token WIN-CA,
   chọn CTS, kiểm tra                nhúng CMS, TSA, LTV, kiểm tra          ký digest qua PKCS#11
```

| Thư mục | Vai trò |
|---|---|
| `backend/` | FastAPI + **pyHanko**: auth, ký (external signing), kiểm tra chữ ký, trust store |
| `frontend/` | React + Vite + **pdfjs-dist**: giao diện ký & kiểm tra |
| `windows-agent/` | Chạy trên máy cắm token: liệt kê chứng thư + ký digest bằng **PKCS#11** |

## Cài đặt nhanh (dev)

### 0. Cấu hình

```bash
cp .env.example .env       # rồi ĐỔI mật khẩu trước khi chạy thật
```

Mặc định: đăng nhập web `admin` / `NhapHang123@`; mật khẩu Administrator máy token `NhapHang123`; IP agent `192.168.1.4`.

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

### 3. Windows Agent (trên máy 192.168.1.4)

Xem hướng dẫn chi tiết: [`windows-agent/install-service.md`](windows-agent/install-service.md).
Tóm tắt: cài Python + `pip install -r requirements.txt`, copy `config.example.ini` → `config.ini` (sửa đường dẫn DLL PKCS#11 của WIN-CA), tạo chứng chỉ HTTPS self-signed, chạy dưới dạng Windows Service (NSSM).

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

Test giả lập token bằng khóa RSA cục bộ (không cần token thật) và kiểm tra:
ký → xác minh **hợp lệ**; sửa 1 byte → phát hiện **không toàn vẹn**; luồng HTTP đăng nhập → upload → ký → kiểm tra.

## Bảo mật — lưu ý

- **Đổi toàn bộ mật khẩu mặc định** trong `.env` trước khi dùng thật; UI cảnh báo khi còn mặc định.
- Agent chỉ nên nghe trong LAN, dùng HTTPS, và giới hạn firewall chỉ nhận từ IP backend.
- Không commit `.env`, chứng thư nội bộ, hay khóa lên git (đã có trong `.gitignore`).

## Ghi chú kỹ thuật

- **Ký ngoài (external signing)**: backend dùng pyHanko chuẩn bị field + appearance tại vùng đã chọn và tính byte-range digest; agent ký digest bằng token với `CKM_SHA256_RSA_PKCS`; backend nhúng CMS. Có thể bật **TSA** (`TSA_URL`) và **LTV** (`ENABLE_LTV`).
- **Tọa độ**: frontend chuyển pixel canvas → điểm PDF bằng `viewport.convertToPdfPoint` (tự xử lý zoom & lật trục Y).
