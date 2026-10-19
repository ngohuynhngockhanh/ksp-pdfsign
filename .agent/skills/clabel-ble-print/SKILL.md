---
name: clabel-ble-print
description: In tem nhan nhiet Clabel CT221B-X420 (text, logo iNut, hinh anh, QR code, barcode Code128, khung bang tuy chinh) qua BLE Gateway inut-ble (root@77.88.207.23) tren kho giay 400x300 (40x30mm / 320x240 dots @ 203 DPI).
---

# Clabel CT221B-X420 Thermal Label Printer (via `inut-ble` BLE Gateway)

Skill nay cung cap kha nang thiet ke, render (1-bit thermal raster + dithering) va in truc tiep tem nhan nhiet sang may in **Clabel CT221B-X420** thong qua **BLE Gateway (`root@77.88.207.23`)** chay `inut-ble`.

---

## 1. Ha tang BLE Gateway & Thong so Thiet bi

| Thanh phan | Gia tri / Cau hinh | Ghi chu |
| :--- | :--- | :--- |
| **BLE Gateway Host** | `root@77.88.207.23` (`inut-207-23`) | RK3528 Linux box chay `bluetooth.service` & `ble-remote.service` (`inut-ble`) |
| **Ten may in BLE** | `CT221B-X420` | Dual-mode Bluetooth 5.0 (BLE GATT + Classic SPP) |
| **Dia chi MAC BLE** | `03:22:32:84:D6:7F` | ManufacturerData `0x0000`: `03 22 32 84 d6 7f` |
| **Kho giay mac dinh** | `400x300` (`40mm x 30mm`) | Do phan giai `203.2 DPI` (`8 dots/mm`) $\rightarrow$ **`320 x 240 dots`** (`40 bytes/row`) |
| **BLE GATT Service** | `49535343-fe7d-4ae5-8fa9-9fafd205e455` | ISSC Transparent UART Service (handles `0x000c`..`0x0014`) |
| **BLE Notify Char** | `49535343-1e4d-4bd9-ba61-23c647249616` | Value handle `0x000e`, CCCD handle `0x000f` (ghi `0100` de bat notify) |
| **BLE Write Char** | `49535343-8841-43f4-a8d4-ecbe34729bb3` | Value handle `0x0011` (`props=0x0c`), MTU `240`, chunk `180 bytes` voi GATT Write ACK |
| **BLE Flow Control** | `49535343-aca3-481c-91ec-d85e28a60318` | Value handle `0x0013`, CCCD handle `0x0014` |

### Bien moi truong trong `ksp-pdfsign` (`.env` / `backend/app/config.py`)
```env
BLE_GATEWAY_HOST=77.88.207.23
BLE_GATEWAY_USER=root
BLE_GATEWAY_PORT=22
CLABEL_PRINTER_NAME=CT221B-X420
CLABEL_PRINTER_MAC=03:22:32:84:D6:7F
CLABEL_DEFAULT_WIDTH=400
CLABEL_DEFAULT_HEIGHT=300
CLABEL_DEFAULT_DENSITY=8
CLABEL_DEFAULT_SPEED=3
CLABEL_DEFAULT_GAP_MM=2
```

---

## 2. Giao thuc In Clabel CT221B (Reverse-Engineered tu APK & Driver)

Ket qua dich nguoc bang **REA MCP** tu `Clabel_Mini_v1.7.1.apk` (`com.ct.clabel.mini`), `clabel_cloud.apk` (`com.dudian.dlableprinter`) va `rastertolabel` (ModelNumber `20` = `ClabelCT221B`):

1. **Tap lenh TSPL / Clabel**:
   - **Khoi tao trang in (`StartPage`)**:
     ```text
     SIZE 40 mm,30 mm
     DIRECTION 0,0
     REFERENCE 0,0
     GAP 2 mm,0 mm        (hoac GAP 0 mm,0 mm cho giay lien tuc; BLINE 2 mm,0 mm cho black-mark)
     DENSITY 8            (1..15)
     SET TEAR ON
     SPEED 3              (1..5)
     CLS
     ```
   - **Lenh ve do hoa & ma vach native (`TscCmd`)**:
     - `BITMAP x,y,width_bytes,height_dots,mode,<raw_bytes>`
       - `width_bytes = width_dots / 8` (voi `320x240` dots $\rightarrow$ `40 bytes/row`, tong `9600 bytes`).
       - Quy uoc bit: **`0` = dot nhiet (den), `1` = khong dot (trang)**, MSB-first (`0x80 >> (x & 7)`).
       - `mode`: `0` = OVERWRITE, `1` = OR, `2` = XOR.
     - `TEXT x,y,"font",rotation,x_mul,y_mul,"content"` (Font ROM: `"1"`..`"8"`, `"TSS24.BF2"`).
     - `BAR x,y,width,height` (ve thanh den dac).
     - `BOX x1,y1,x2,y2,thickness[,radius]` (ve khung chu nhat).
     - `CIRCLE x,y,diameter,thickness` & `ELLIPSE x,y,width,height,thickness`.
     - `ERASE x,y,w,h` (xoa vung trang) & `REVERSE x,y,w,h` (dao nguoc mau den/trang).
     - `BARCODE x,y,"128",height,readable,rotation,narrow,wide,"code"` (128, EAN13, EAN8, 39, 93, CODABAR, ITF).
     - `QRCODE x,y,ECC,cell_width,mode,rotation,"content"`.
     - `DMATRIX x,y,width,height,"content"` & `PDF417 x,y,width,height,rotation,"content"`.
   - **Ket thuc trang in (`EndPage`)**:
     ```text
     PRINT 1,1
     ```

2. **Khung lenh nhi phan Vendor (`TTLV4` & `CmdHelper$TSC`)**:
   - **TTLV4 (`envelopedData`)**: `0xdd 0x00 <func_main> <func_sub> <len_hi> <len_lo> <payload...> <crc8_poly07> 0xdd`
     - `func=0x05, sub=0x07, payload=0x01/0x00`: Bat/tat `MemoryPrint`.
     - `func=0x01, sub=0x0d`: Truy van trang thai phan cung.
   - **CmdHelper$TSC**:
     - Chon loai giay: `10 1f aa 55 80 05 <00:gap | 01:continuous | 02:mark>`
     - Truy van / dieu khien he thong: `10 <cmd> <len> <payload...> <crc8_sum>` (`0xa0`..`0xae`).

3. **Co che truyen BLE GATT (`PrintConnectController`)**:
   - Ket noi LE toi `03:22:32:84:D6:7F`.
   - Thuong luong `MTU 512` (may in phan hoi `MTU 240`).
   - Bật Notify tren CCCD `0x000f` (`0100`).
   - Cat goi TSPL thanh tung chunk `180 bytes` va ghi qua handle `0x0011` bang **GATT Write Request (`char-write-req`)** de nhan ACK tu chip BLE cua may in tren moi chunk, dam bao **khong bao gio tran bo dem UART** khi in bitmap 9.6KB (~2.9 giay/tem).

---

## 3. Cach su dung CLI (`scripts/print_clabel.py`)

### 3.1. In tem chuan iNut (Logo iNut + Text Tieng Viet + Badge + QR Code)
```bash
./scripts/print_clabel.py \
  --title "iNut JSC" \
  --subtitle "IoT & Edge Computing" \
  --line "Gateway: 77.88.207.23" \
  --line "Printer: CT221B-X420" \
  --line "Size: 400x300 (320x240px)" \
  --badge "INUT-BLE GATEWAY READY" \
  --footer-title "Đắk Lắk - TP.HCM" \
  --footer-line "MST: 4401053694" \
  --footer-line "https://inut.vn" \
  --qr "https://inut.vn"
```

### 3.1b. In Tem "Mẫu Xuất Xưởng v1.1 Rockchip" (`clabel-sanxuat-v1.1` — 400x300)
Mẫu tem xuất xưởng chuẩn công nghiệp có **Logo iNut + biểu tượng `®` & `©`**, huy hiệu **`★ MAKE IN VIETNAM`**, **QR mã thiết bị có gắn logo iNut ở tâm** và **Ngày sản xuất (`NSX`) tự động lấy theo ngày gọi lệnh in**:
```bash
./scripts/print_clabel.py --sanxuat-v1.1 inut_207_153
# Hoặc qua API:
curl -sS "http://127.0.0.1:2032/api/clabel/print-sanxuat?device_id=inut_207_153"
```

### 3.2. In tem co Ma vach 1D (Code128) hoac tat Logo/QR
```bash
./scripts/print_clabel.py \
  --title "KHO THIẾT BỊ INUT" \
  --subtitle "RK3528 BLE Gateway" \
  --line "SN: INUT-207-23" \
  --line "MAC: 03:22:32:84:D6:7F" \
  --badge "QC PASSED" \
  --barcode "INUT20723" \
  --qr "https://inut.vn/device/207-23"
```

### 3.3. In truc tiep mot file hinh anh / logo bat ky (PNG/JPG)
- Voi logo/bieu tuong do hoa net cao:
  ```bash
  ./scripts/print_clabel.py --image backend/app/assets/logo.png
  ```
- Voi anh chup nhieu sac do (bat Floyd-Steinberg dithering `--dither`):
  ```bash
  ./scripts/print_clabel.py --image /path/to/photo.png --dither
  ```

### 3.4. Thiet ke bo cuc tuy chinh bang JSON DSL (`--elements-json`)
Ho tro cac loai phan tu: `logo`, `image`, `text`, `qrcode`, `barcode`, `line`, `box`, `badge`, `circle`, `reverse`.
```bash
./scripts/print_clabel.py --elements-json '[
  {"type": "logo", "x": 12, "y": 14, "size": 96},
  {"type": "text", "x": 120, "y": 16, "text": "iNut SmartCity", "font_size": 20, "bold": true},
  {"type": "text", "x": 120, "y": 44, "text": "Node: 77.88.207.23\nModel: CT221B-X420", "font_size": 13},
  {"type": "line", "x": 10, "y": 124, "x2": 310, "thickness": 2},
  {"type": "badge", "x": 12, "y": 134, "width": 195, "height": 28, "text": "BLE GATT 0x0011"},
  {"type": "barcode", "x": 12, "y": 170, "width": 195, "height": 56, "code": "CT221BX420"},
  {"type": "qrcode", "x": 218, "y": 134, "size": 92, "data": "https://inut.vn"}
]'
```

### 3.5. Kiem tra trang thai BLE Gateway & Quet thiet bi BLE
```bash
./scripts/print_clabel.py --status
./scripts/print_clabel.py --scan
```

---

## 4. REST API Endpoints trong `ksp-pdfsign` (`http://127.0.0.1:2032/api/clabel/*`) & MCP (`clabel_ble_print`)

Khi goi truc tiep tren may chu local (`http://127.0.0.1:2032/api/clabel/...`), endpoint cho phep goi thang khong can cookie/token (hoac dung Admin JWT / MCP Bearer token khi goi tu xa):

### 4.1. In tem nhan bang JSON (`POST /api/clabel/print`)
```bash
curl -sS -X POST http://127.0.0.1:2032/api/clabel/print \
  -H "Content-Type: application/json" \
  -d '{
    "title": "iNut JSC",
    "subtitle": "IoT & Edge Computing",
    "lines": ["Gateway: 77.88.207.23", "Printer: CT221B-X420", "Size: 400x300 (320x240px)"],
    "badge": "INUT-BLE GATEWAY READY",
    "footer_title": "Đắk Lắk - TP.HCM",
    "footer_lines": ["MST: 4401053694", "https://inut.vn"],
    "qr_data": "https://inut.vn",
    "show_logo": true,
    "border": true,
    "width": 400,
    "height": 300,
    "copies": 1
  }'
```

### 4.2. In nhanh 1 dong qua Query Params (`GET /api/clabel/print`)
```bash
curl -sS "http://127.0.0.1:2032/api/clabel/print?title=iNut+JSC&subtitle=IoT+Gateway&badge=READY&qr_data=https://inut.vn"
```

### 4.3. Upload file hinh anh truc tiep de in (`POST /api/clabel/print-image`)
```bash
curl -sS -X POST http://127.0.0.1:2032/api/clabel/print-image \
  -F "file=@backend/app/assets/logo.png" \
  -F "width=400" \
  -F "height=300" \
  -F "dither=false"
```

### 4.4. Xem truoc anh PNG (`GET/POST /api/clabel/preview`), Trang thai & Quet BLE
- `GET http://127.0.0.1:2032/api/clabel/status`: Kiem tra `bluetooth.service`, `ble-remote.service` va `CT221B-X420` tren `77.88.207.23`.
- `POST http://127.0.0.1:2032/api/clabel/scan`: Quet danh sach thiet bi BLE xung quanh gateway `77.88.207.23`.
- `GET/POST http://127.0.0.1:2032/api/clabel/preview`: Render va tra ve file anh `image/png` 1-bit (`320x240`).
- `POST http://127.0.0.1:2032/api/clabel/print-tspl`: Gui truc tiep chuoi lenh TSPL (`tspl` hoac `tspl_base64`) sang may in.
- **MCP Tool (`inut-crm-mcp`)**: `clabel_ble_print` (`operation: "print" | "scan" | "print_tspl"`).
