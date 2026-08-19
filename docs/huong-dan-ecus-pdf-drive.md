# Workflow ECUS -> PDF -> Google Drive

## Phạm vi

Workflow này chỉ đọc database ECUSSign Pro qua SCP từ máy Windows đã cấu hình,
giải các PDF nằm trong `DCHUNGTU_BS/AttachedFile`, rồi đưa bản sao vào folder
Drive đã gắn với cùng số tờ khai trong CRM. Nó không mở phần mềm ECUS, không ký,
không gửi lại VNACCS và không sửa database trên máy Windows.

ECUS hiện lưu các PDF đính kèm (ví dụ AWB và invoice), không lưu sẵn một file PDF
in riêng của tờ khai. Muốn có bản PDF trình bày của tờ khai thì cần xuất/in từ
file Excel tờ khai ở bước riêng.

## Cấu hình

Thêm vào `.env` của backend (không commit khóa SSH):

```dotenv
ECUS_DRIVE_SYNC_ENABLED=false
ECUS_SSH_HOST=192.168.1.111
ECUS_SSH_USER=Administrator
ECUS_SSH_KEY_PATH=/home/ksp/.ssh/id_ed25519
ECUS_DB_PATH=C:/pro/ECUSSIGN_PRO/Database/ECUSSIGN_DN_4401053694.DB
ECUS_SSH_TIMEOUT=60
```

`ECUS_DRIVE_SYNC_ENABLED=false` là chế độ an toàn. Chạy thử dry-run trước:

```bash
cd /home/ksp/ksp-pdfsign/backend
.venv/bin/python scripts/ecus_drive_sync.py --dry-run
```

Khi danh sách đúng, đặt `ECUS_DRIVE_SYNC_ENABLED=true` rồi chạy thủ công hoặc
bật timer systemd. Tên upload có dạng:
`ECUS-<số tờ khai>-<tên gốc>-<12 ký tự hash>.pdf`; hash giúp chạy lại không tạo
trùng và không ghi đè file có nội dung khác.

## Deploy timer

```bash
sudo install -m 0644 deploy/ksp-ecus-drive-sync.service /etc/systemd/system/
sudo install -m 0644 deploy/ksp-ecus-drive-sync.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ksp-ecus-drive-sync.timer
```

Xem log/lịch sử:

```bash
systemctl status ksp-ecus-drive-sync.timer
journalctl -u ksp-ecus-drive-sync.service -n 100 --no-pager
```

Nếu tờ khai chưa có folder Drive tương ứng, job không upload và báo `unmatched`
để tránh đưa nhầm hồ sơ sang folder khác.
