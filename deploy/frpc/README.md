# frpc — expose app qua p2p.inut.io.vn

Client frpc để đưa app (chạy `127.0.0.1:2032`) ra domain `ksp-pdf-signer.a.inut.vn`.

## Đã cài trên máy này
- Binary + config: `~/ksp-frpc/frpc`, `~/ksp-frpc/frpc.ini` (chứa `meta_token` thật — KHÔNG commit).
- Systemd **user service**: `~/.config/systemd/user/frpc-ksp.service` (bản mẫu ở đây).
- Đã bật tự khởi động khi boot:
  ```bash
  systemctl --user enable --now frpc-ksp.service
  loginctl enable-linger ksp          # chạy khi máy khởi động, không cần đăng nhập
  ```
- Kiểm tra: `systemctl --user status frpc-ksp.service` · `journalctl --user -u frpc-ksp.service -f`

## Trạng thái
Client đã kết nối frps thành công (`login to server success`, `start proxy success`).

## Còn thiếu (phía hạ tầng inut)
Domain `ksp-pdf-signer.a.inut.vn` trỏ về frps `45.251.114.38` nhưng **nginx/frps bên inut
chưa route domain này vào tunnel** (đang trả trang mặc định "Please Press F5 Refresh").
Quản trị frps/nginx của inut cần thêm route `ksp-pdf-signer.a.inut.vn` → vhost frp
(subdomain hoặc custom_domains). Nếu frps dùng `subdomain_host`, đổi `custom_domains`
trong `frpc.ini` thành `subdomain = ksp-pdf-signer`.

Trong lúc chờ, app truy cập trực tiếp tại `http://77.87.50.212:2032`.
