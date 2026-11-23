# Cài Windows Signing Agent trên máy cắm USB Token (VD: 192.168.1.4)

Agent chạy trên **máy Windows đang cắm token WIN-CA**. Backend sẽ gọi tới agent qua HTTPS (có xác thực chứng chỉ SAN + khóa `api_secret` riêng) để ký.

## 1. Cài Python + thư viện

1. Cài Python 3.11/3.12 (chọn *Add Python to PATH*).
2. Mở PowerShell tại thư mục `windows-agent`:
   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   ```

## 2. Cấu hình (`config.ini` — bắt buộc, fail closed nếu thiếu)

1. Copy `config.example.ini` → `config.ini` (tuyệt đối KHÔNG commit `config.ini`).
2. Sửa `pkcs11_lib` cho đúng DLL PKCS#11 của token WIN-CA (`WDPKCS.dll`, `eTPKCS11.dll`, ...).
3. Tạo khóa `api_secret` ngẫu nhiên dài tối thiểu 32 byte và cấu hình vào `[auth]`:
   ```powershell
   python -c "import secrets; print(secrets.token_hex(32))"
   ```
   - Đặt `api_secret = <chuỗi_vừa_tạo>` trong `config.ini` (và cấu hình khớp trên backend).
   - Đặt `allowed_ips = 127.0.0.1,::1,<IP_MAY_CHU_BACKEND>/32`.
   - Giữ `allow_windows_logon_fallback = false` để không phơi bày tài khoản OS Administrator qua HTTP.

## 3. Tạo chứng chỉ HTTPS self-signed có SAN IP (`SubjectAlternativeName`)

Sử dụng chứng chỉ có **SAN IP** để backend bật **`AGENT_VERIFY_TLS=true`** (và ghim chứng chỉ qua `AGENT_CA_BUNDLE=/path/to/agent-cert.pem`) thay vì tắt TLS verification:

```powershell
# Thay 192.168.1.4 bang IP LAN that cua may Windows cam token
openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes `
  -keyout key.pem -out cert.pem `
  -subj "/CN=192.168.1.4" `
  -addext "subjectAltName=IP:192.168.1.4,IP:127.0.0.1,DNS:localhost" `
  -addext "basicConstraints=CA:FALSE" `
  -addext "keyUsage=digitalSignature,keyEncipherment" `
  -addext "extendedKeyUsage=serverAuth"

# Khoa quyen doc private key (chi user chay service duoc doc)
icacls key.pem /inheritance:r /grant:r "$($env:USERNAME):(R)"
```

Copy `cert.pem` sang máy chủ backend (VD: `/home/ksp/ksp-pdfsign/backend/data/agent-cert.pem`) và cấu hình trong `.env` của backend:
```env
AGENT_SCHEME=https
AGENT_VERIFY_TLS=true
AGENT_CA_BUNDLE=/home/ksp/ksp-pdfsign/backend/data/agent-cert.pem
```

## 4. Chạy thử

Bind đúng IP LAN nội bộ thay vì `0.0.0.0` (nếu có nhiều card mạng):
```powershell
.\.venv\Scripts\python -m uvicorn agent:app --host 192.168.1.4 --port 8443 --ssl-keyfile key.pem --ssl-certfile cert.pem
```

Kiểm tra từ máy backend (có xác thực chứng chỉ bằng `--cacert`):
```bash
curl --cacert /home/ksp/ksp-pdfsign/backend/data/agent-cert.pem https://192.168.1.4:8443/health
```

## 5. Cài thành Windows Service bằng NSSM

1. Tải [NSSM](https://nssm.cc/download), giải nén.
2. ```powershell
   nssm install ksp-pdfsign-agent
   ```
   - **Path**: `…\windows-agent\.venv\Scripts\python.exe`
   - **Arguments**: `-m uvicorn agent:app --host 192.168.1.4 --port 8443 --ssl-keyfile key.pem --ssl-certfile cert.pem`
   - **Startup directory**: `…\windows-agent`
3. Ở tab *Log on*, đặt chạy dưới tài khoản có phiên truy cập token.
4. `nssm start ksp-pdfsign-agent`.

## Bảo mật

- Chỉ mở cổng 8443 cho **IP của máy backend** (Windows Firewall → Inbound Rule → Scope → Remote IP) kết hợp `[auth] allowed_ips` trong `config.ini`.
- Luôn bật `AGENT_VERIFY_TLS=true` với `AGENT_CA_BUNDLE` chứa `cert.pem` có SAN IP.
- Không bật OpenAPI `/docs` (đã tắt mặc định trong `agent.py`), không ghi log PIN / `api_secret`.
- Agent tự động chặn 429 sau 5 lần sai khóa trong 60 giây và chỉ chấp nhận thuật toán băm SHA-256/384/512 (không hỗ trợ SHA-1).
