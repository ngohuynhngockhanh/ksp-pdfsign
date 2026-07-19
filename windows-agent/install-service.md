# Cài Windows Signing Agent trên máy 192.168.1.4

Agent chạy trên **máy Windows đang cắm token WIN-CA**. Backend sẽ gọi tới agent qua HTTPS để ký.

## 1. Cài Python + thư viện

1. Cài Python 3.11/3.12 (chọn *Add Python to PATH*).
2. Mở PowerShell tại thư mục `windows-agent`:
   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   ```

## 2. Cấu hình

1. Copy `config.example.ini` → `config.ini`.
2. Sửa `pkcs11_lib` cho đúng DLL PKCS#11 của token WIN-CA. Cách tìm:
   - Xem thư mục cài driver token (thường trong `C:\Windows\System32\` hoặc `C:\Program Files\...`).
   - Các DLL hay gặp: `WDPKCS.dll` (WatchData/mToken), `eTPKCS11.dll` (SafeNet).
   - Nếu không chắc, chạy thử: `python -c "import pkcs11; print(pkcs11.lib(r'ĐƯỜNG_DẪN_DLL').get_slots())"` — nếu không lỗi là đúng.
3. Để `use_windows_logon = true` để xác thực bằng mật khẩu **Administrator** thật của máy.

## 3. Tạo chứng chỉ HTTPS self-signed (dùng trong LAN)

```powershell
python -c "from cryptography.hazmat.primitives.asymmetric import rsa; from cryptography import x509; import datetime; from cryptography.hazmat.primitives import hashes, serialization; from cryptography.x509.oid import NameOID; k=rsa.generate_private_key(public_exponent=65537,key_size=2048); n=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'192.168.1.4')]); c=x509.CertificateBuilder().subject_name(n).issuer_name(n).public_key(k.public_key()).serial_number(x509.random_serial_number()).not_valid_before(datetime.datetime.utcnow()).not_valid_after(datetime.datetime.utcnow()+datetime.timedelta(days=3650)).sign(k,hashes.SHA256()); open('key.pem','wb').write(k.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.TraditionalOpenSSL,serialization.NoEncryption())); open('cert.pem','wb').write(c.public_bytes(serialization.Encoding.PEM))"
```

## 4. Chạy thử

```powershell
.\.venv\Scripts\python -m uvicorn agent:app --host 0.0.0.0 --port 8443 --ssl-keyfile key.pem --ssl-certfile cert.pem
```

Kiểm tra từ máy backend:
```bash
curl -k https://192.168.1.4:8443/health
```

## 5. Cài thành Windows Service (tự chạy nền) bằng NSSM

1. Tải [NSSM](https://nssm.cc/download), giải nén.
2. ```powershell
   nssm install ksp-pdfsign-agent
   ```
   - **Path**: `…\windows-agent\.venv\Scripts\python.exe`
   - **Arguments**: `-m uvicorn agent:app --host 0.0.0.0 --port 8443 --ssl-keyfile key.pem --ssl-certfile cert.pem`
   - **Startup directory**: `…\windows-agent`
3. Ở tab *Log on*, đặt chạy dưới tài khoản **có phiên truy cập được token** (thường là user đang đăng nhập/đã import chứng thư), nếu token yêu cầu phiên người dùng.
4. `nssm start ksp-pdfsign-agent`.

## Bảo mật

- Chỉ mở cổng 8443 cho **IP của máy backend** (Windows Firewall → Inbound Rule → Scope → Remote IP).
- Đổi mật khẩu Administrator mặc định `NhapHang123`.
- Không ghi log PIN / mật khẩu.

## Ghi chú về PIN token

Một số token WIN-CA cho phép truyền PIN qua PKCS#11 để ký tự động (phù hợp ký qua web).
Nếu token bắt buộc bấm PIN trên phần mềm/thiết bị, cần bật chế độ "nhớ PIN" hoặc dùng
token/HSM hỗ trợ ký không tương tác. Kiểm tra với nhà cung cấp WIN-CA.
