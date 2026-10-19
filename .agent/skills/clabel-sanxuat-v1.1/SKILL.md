---
name: clabel-sanxuat-v1.1
description: Thiet ke va in tem nhan nhiet "Mau Xuat Xuong v1.1 Rockchip" (400x300 / 40x30mm / 320x240 dots) tren may in Clabel CT221B-X420 qua BLE Gateway (root@77.88.207.23) voi Logo iNut, icon (R) & Copyright (C), huy hieu MAKE IN VIETNAM, QR ma thiet bi co logo iNut o tam va Ngay san xuat = ngay goi lenh in.
---

# Clabel San Xuat v1.1 — Mau Xuat Xuong v1.1 Rockchip (400x300)

Skill nay dong goi mau tem nhan xuat xuong chuan cong nghiep **Mau Xuat Xuong v1.1 Rockchip** tren kho giay `400x300` (`40mm x 30mm` = `320 x 240 dots` @ 203.2 DPI) cho may in nhiet **Clabel CT221B-X420** qua **BLE Gateway (`root@77.88.207.23`)**.

---

## 1. Bo Cuc & Tieu Chuan Thiet Ke (`320 x 240 dots` 1-bit)

1. **Nguyen tac Nen Trang - Net Den 100% (Chong nhoe nhiet dau in 203 DPI)**:
   - Toan bo khung hop (`MAKE IN VIETNAM`, `SN / MÃ THIẾT BỊ`, `Pass Wi-Fi`, `NSX`, `QC PASS`) su dung **nen trang (`fill=1`), vien den (`outline=0`) va chu den (`fill=0`)** de tuyet doi khong bi nhoe nhiet den thui mat chu tren giay nhiet.
2. **Cum Thuong hieu, Ten Xuat Hoa Don & Xuat xu (Header)**:
   - **Logo iNut sac net (`60x60 dots`)** o goc tren ben trai, kem bieu tuong **`(R)` (Registered Trademark)** o goc phai tren cua logo va ten thuong hieu **`iNut® JSC`**.
   - **Khung huy hieu `★ MAKE IN VIETNAM`** (nen trang vien den 2px, chu den in dam) o goc tren ben phai.
   - Ten san pham chuan xuat hoa don GTGT: **`iNut Smartcity - Data Logger v1.1 - Rockchip`** (`iNut Smartcity - Data Logger v1.1` / `Rockchip · Xuất xưởng ©`).
3. **Cum SN / Ma Thiet bi, Pass Wi-Fi & Ngay san xuat (Cot trai)**:
   - Khung **`SN / MÃ THIẾT BỊ (DEVICE ID)`** duy nhat (khong lap lai SN trung lap): hien thi **`inut_207_153`** in dam canh giua.
   - Khung **`Pass Wi-Fi: inut12345`** (mat khau Wi-Fi AP mac dinh cua thiet bi).
   - Khung **`NSX: DD/MM/YYYY`** (tu dong lay **ngay hien tai luc goi lenh in**) kem khung **`QC PASS`**.
4. **Cum QR Code Ma Thiet Bi (Cot phai)**:
   - Ma QR (`104x104 dots`, muc sua loi cao nhat `ERROR_CORRECT_H` 30%) ma hoa chinh xac chuoi `device_id` (vd: `inut_207_153`), **chinh giua co logo iNut mini (`22x22 dots`)**, kem dong **`QR: <device_id>`**.
5. **Chan trang Ban quyen (Footer)**:
   - **`© 2026 INUT® JSC · DN KH&CN`** | **`MST: 4401053694 · https://inut.vn`** + khung **`[iNut® © v1.1]`**.
---

## 2. Cach Su Dung Nhanh

### 2.1. CLI (`scripts/print_clabel.py`)
Chỉ cần truyền mã thiết bị (ví dụ `inut_207_153` hoặc `inut_200_177`), ngày sản xuất sẽ tự động lấy theo ngày gọi lệnh in:
```bash
./scripts/print_clabel.py --sanxuat-v1.1 inut_207_153
```
Hoặc truyền kèm ngày sản xuất tùy chọn và xuất file ảnh xem trước:
```bash
./scripts/print_clabel.py \
  --sanxuat-v1.1 inut_207_153 \
  --mfg-date "19/10/2026" \
  --preview-out /tmp/sanxuat_inut_207_153.png
```

### 2.2. Python SDK (`backend/app/clabel.py`)
```python
from app import clabel

res = clabel.print_sanxuat_v1_1_label(
    device_id="inut_207_153",  # Hoặc "inut_200_177"
    # mfg_date=None -> Tự động lấy ngày hôm nay (DD/MM/YYYY)
    save_preview_path="/tmp/sanxuat_inut_207_153.png",
)
print(res)
```

### 2.3. REST API (`http://127.0.0.1:2032/api/clabel/*`)
- **In nhanh qua GET / POST `/api/clabel/print-sanxuat`**:
  ```bash
  curl -sS "http://127.0.0.1:2032/api/clabel/print-sanxuat?device_id=inut_207_153"
  ```
- **Xem trước ảnh PNG 1-bit (`320x240`) qua `/api/clabel/preview-sanxuat`**:
  ```bash
  curl -sS "http://127.0.0.1:2032/api/clabel/preview-sanxuat?device_id=inut_207_153" -o /tmp/preview.png
  ```
- **Hoặc gọi qua `/api/clabel/print` với `template: "sanxuat_v1.1"`**:
  ```bash
  curl -sS -X POST http://127.0.0.1:2032/api/clabel/print \
    -H "Content-Type: application/json" \
    -d '{"template": "sanxuat_v1.1", "device_id": "inut_207_153"}'
  ```
