---
name: batch-printer-sanxuat
description: Quy trinh "Qua trinh san xuat iNut Data Logger v1.1" — Nhan danh sach ma thiet bi (vd 10 con inut_207_153,inut_207_159,...), kiem tra CSDL: neu ma nao da in tem Clabel 40x30 thi lay ngay san xuat da luu (khong in lai), neu chua in thi tu dong goi Clabel BLE in tem 40x30 truoc; sau do tao va in Bang Tong Hop Lo San Xuat (kho trang 70x130mm, vung thiet ke nam gon trong 70x80mm o phan tren, khong nen 65%) sang may in nhiet TP732H tren may inut-dev va luu vao ksp-pdfsign.
---

# Batch Printer San Xuat — Qua Trinh San Xuat iNut Data Logger v1.1 (70x80 tren kho 70x130 @ `inut-dev` + Auto Clabel)

Skill nay van hanh day chuyen kiem dem & xuat xuong **"Quá trình sản xuất iNut Data Logger v1.1"** ket hop 2 may in nhiet trong he sinh thai `ksp-pdfsign`:
1. **May in tem le Clabel `CT221B-X420` (`400x300` / `40x30mm`)** qua BLE Gateway `77.88.207.23`: In tem dan tren tung thiet bi.
2. **May in nhiet `TP732H` (kho trang PDF `70x130mm`, khung in nam gon trong `70x80mm` phia tren, full scale 100%)** tren may **`inut-dev` (`Administrator@192.168.1.10`)**: In to **Phieu Tong Hop & Kiem Dem Lo San Xuat** dan ngoai thung/lo.
---

## 1. Co Che Tu Dong Kiem Tra & In Bu Tem Clabel (`sanxuat_device_labels`)

Khi truyen mot danh sach ma thiet bi (vi du `inut_207_153,inut_207_159,inut_207_160,inut_207_161,inut_207_178,inut_207_179,inut_207_180,inut_207_181,inut_207_182,inut_207_183`):
1. **Tra cuu so cai `sanxuat_device_labels` trong `ksp.db`**:
   - **Neu thiet bi DA IN tem le Clabel truoc do (`is_clabel_printed = True`)**:
     - Lay nguyen **Ngay san xuat (`mfg_date`)** da in tren tem Clabel cua thiet bi do.
     - **KHONG goi in lai Clabel**, tranh lang phi giay nhiet.
   - **Neu thiet bi CHUA TUNG IN tem le Clabel**:
     - Tu dong ket noi BLE Gateway (`77.88.207.23` $\rightarrow$ `CT221B-X420`) va **in ngay tem le `Mẫu Xuất Xưởng v1.1 Rockchip` (`400x300`)** cho cac ma chua in.
     - Luu `mfg_date` (ngay hom nay `DD/MM/YYYY`) va thoi diem in vao bang `sanxuat_device_labels`.
2. **Tao & In Phieu Tong Hop Lo San Xuat (`70x80mm` tren trang `70x130mm`, `TP732H` @ `inut-dev`)**:
   - **Kich thuoc chuan**: Trang PDF `70mm x 130mm` (in full 100% khong nen 65%), toan bo khung noi dung duoc day len nam gon trong vung **`70mm x 80mm`** o phia tren (`y: 51.0mm -> 128.5mm`).
   - **Header**: Logo iNut + bieu tuong `®` & `©`, ten va thong tin **CÔNG TY CP ĐT & PT CÔNG NGHỆ INUT ® (`MST: 4401053694`)** tu dong co co chu (`fit_font`) nam gon trong khung, huy hieu **`★ MAKE IN VIETNAM · v1.1 ®`**.
   - **Tieu de & Thoi gian (2 dong rieng biet)**: **`QUÁ TRÌNH SẢN XUẤT INUT DATA LOGGER V1.1`**, ten xuat hoa don **`iNut Smartcity - Data Logger v1.1 - Rockchip`**, dong 1 **Mã lô sản xuất (`SX-V1.1-...`)**, dong 2 **Ngày giờ in phiếu (`DD/MM/YYYY HH:MM:SS`)**.
   - **Cum Ma QR Danh Sach (cach nhau dau phay)**:
     - Ma QR ma hoa chinh xac chuoi danh sach cac ma `inut_...` cach nhau bang dau phay:
       `inut_207_153,inut_207_159,inut_207_160,inut_207_161,inut_207_178,inut_207_179,inut_207_180,inut_207_181,inut_207_182,inut_207_183`
     - Khung hien thi chuoi CSV va khung thong ke kiem dem (`Đủ N/N TB · Wi-Fi: inut12345 · Đã in / Auto in · KCS ĐẠT CHUẨN v1.1`).
   - **Luu ho so `ksp-pdfsign`**: Luu vao bang `documents` (`doc_type = "xuat_xuong"`), `shares` (link public `/s/<token>`) va `sanxuat_batch_sheets`.

---

## 2. Cach Su Dung Nhanh

### 2.1. CLI (`scripts/print_sanxuat_batch.py`)
```bash
chmod +x scripts/print_sanxuat_batch.py
./scripts/print_sanxuat_batch.py \
  --devices "inut_207_153,inut_207_159,inut_207_160,inut_207_161,inut_207_178,inut_207_179,inut_207_180,inut_207_181,inut_207_182,inut_207_183"
```
- Neu muon ep in lai tem le Clabel cho toan bo danh sach: them `--force-reprint-clabel`.
- Neu chi muon tao PDF + luu DB (khong gui lenh in): them `--dry-run`.

### 2.2. REST API (`http://127.0.0.1:2032/api/clabel/*`)
- **Chay Batch Printer San Xuat (`POST /api/clabel/sanxuat-batch` hoac `GET /api/clabel/sanxuat-batch`)**:
  ```bash
  curl -sS -X POST http://127.0.0.1:2032/api/clabel/sanxuat-batch \
    -H "Content-Type: application/json" \
    -d '{
      "device_ids": "inut_207_153,inut_207_159,inut_207_160,inut_207_161,inut_207_178,inut_207_179,inut_207_180,inut_207_181,inut_207_182,inut_207_183"
    }'
  ```
- **Xem danh sach thiet bi da in tem Clabel (`GET /api/clabel/sanxuat-devices`)**:
  ```bash
  curl -sS http://127.0.0.1:2032/api/clabel/sanxuat-devices
  ```
- **Xem lich su cac phieu lo 70x100 da xuat (`GET /api/clabel/sanxuat-batches`)**:
  ```bash
  curl -sS http://127.0.0.1:2032/api/clabel/sanxuat-batches
  ```
