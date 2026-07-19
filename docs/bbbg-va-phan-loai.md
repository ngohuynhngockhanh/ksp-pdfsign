# Import hóa đơn → sinh BBBG & Phân loại tài liệu

## Tổng quan luồng

```
Tab "Tạo BBBG":
  Upload hóa đơn (PDF) ─► /api/invoice/parse (pdfplumber) ─► FORM sửa/xác nhận
  ─► /api/bbbg/generate (Jinja2 HTML + WeasyPrint) ─► doc_id
  ─► chuyển sang tab "Ký số" (đã nạp sẵn) ─► ký ─► Hồ sơ (loại = BBBG) ─► NAS
```

Phân loại: khi ký, hệ thống tự nhận diện loại tài liệu theo nội dung trang đầu
(`classify.detect_doc_type`), hoặc dùng loại chỉ định (BBBG). Admin sửa loại tay
ở tab Hồ sơ (cột "Loại").

## Backend

| File | Vai trò |
|---|---|
| `app/invoice.py` | Parse hóa đơn ihoadon.vn bằng **pdfplumber** (không có XML nhúng). Trích bên mua (tên/MST/địa chỉ), hàng hóa (bảng), ngày. Best-effort → luôn có form xác nhận. |
| `app/bbbg.py` | Sinh BBBG: Jinja2 render `templates_bbbg/*.html` → **WeasyPrint** → PDF. Logo INUT chìm (base64 từ `settings.logo_path`). |
| `app/templates_bbbg/*.html` | Các **template** BBBG (HTML/CSS + Jinja). |
| `app/classify.py` | Phân loại theo text trang đầu; fallback **OCR** (pytesseract nếu có tesseract, nếu không dùng `rapidocr-onnxruntime`). |

**Endpoints (admin):**
- `POST /api/invoice/parse` — upload hóa đơn → dữ liệu đã parse.
- `GET /api/bbbg/templates` — danh sách template.
- `POST /api/bbbg/generate` — body `BBBGGenerate` → PDF, trả `{doc_id, filename}` để ký.
- `POST /api/documents/{id}/type` — đổi loại tài liệu.

## Thêm một template BBBG mới

1. Tạo file `backend/app/templates_bbbg/<ten>.html` (copy từ `bbbg_thiet_bi.html`).
   Dùng biến Jinja: `ben_a.*`, `ben_b.*`, `items[]` (`{ten,dvt,so_luong}`), `so_bb`,
   `noi_lap`, `ngay.{day,month,year}`, `logo_data_uri`.
2. Đăng ký trong `app/bbbg.py`:
   ```python
   TEMPLATES = {
     "bbbg_thiet_bi": {"file": "bbbg_thiet_bi.html", "label": "Biên bản bàn giao thiết bị"},
     "bbbg_<ten>":   {"file": "<ten>.html",         "label": "<Nhãn hiển thị>"},
   }
   ```
3. Xong — template tự hiện trong dropdown ở tab "Tạo BBBG".

Cùng cơ chế này có thể thêm mẫu **báo giá / hợp đồng** sau.

## Thông tin Bên A (bên bàn giao) — INUT

Lấy từ config (`.env`), cho sửa: `BBBG_COMPANY`, `BBBG_ADDRESS`, `BBBG_MST`,
`BBBG_PHONE`, `BBBG_REP`, `BBBG_REP_TITLE`. Mặc định là INUT / Ngô Huỳnh Ngọc Khánh - Giám đốc.

## Parse hóa đơn — lưu ý khi layout đổi

Parser bám vào layout ihoadon.vn: khối "Họ tên người mua hàng" rồi các dòng
"Tên đơn vị / Mã số thuế / Địa chỉ", và bảng hàng hóa (`extract_tables`). Nếu nhà
phát hành hóa đơn khác đổi layout, chỉnh anchor/toạ độ trong `app/invoice.py`
(hàm `parse_invoice`). Vì luôn có **form xác nhận**, sai sót nhỏ vẫn sửa được tay.

## OCR (phân loại PDF scan)

PDF chữ: dùng text trực tiếp (không cần OCR). PDF scan (text rỗng): OCR trang đầu.
- Mặc định: `rapidocr-onnxruntime` (pip, tự tải model ONNX lần đầu — cần Internet).
- **Tốt hơn cho tiếng Việt**: cài Tesseract (cần sudo):
  ```bash
  sudo apt install -y tesseract-ocr tesseract-ocr-vie
  ```
  Có tesseract thì `classify` tự ưu tiên dùng (`lang=vie+eng`).

## Kiểm thử

`cd backend && pytest tests/test_bbbg_flow.py` — render BBBG, phân loại 4 loại,
parse hóa đơn thật (skip nếu không có `~/ihoadon.vn_...pdf`).
