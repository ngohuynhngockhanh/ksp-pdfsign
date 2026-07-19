# Kế hoạch: Báo giá + Đề nghị thanh toán + Thuyết minh AI

## Mục tiêu
Từ danh sách hàng hóa + đơn giá → sinh **Báo giá** đẹp (logo INUT chìm, tự tính
thành tiền/VAT/tổng, số tiền bằng chữ). Sinh **Đề nghị thanh toán (đề nghị TT)**.
Thêm nút **"Sinh thuyết minh (AI)"** viết đoạn giới thiệu/thuyết minh báo giá.

Chốt: tự tính tiền + VAT theo dòng (0/5/8/10%); nguồn hàng hóa = nhập tay / từ
hóa đơn (PDF/XML, tái dùng `invoice.py`) / từ hồ sơ có sẵn; AI dùng endpoint
tương thích OpenAI (cắm OpenRouter free / local / bất kỳ), cấu hình `.env`.

## Kiến trúc (tái dùng hạ tầng BBBG)
```
Tab "Báo giá": nguồn (nhập tay | hóa đơn | hồ sơ) → form (hàng+đơn giá+VAT)
  → tự tính tiền → [Sinh thuyết minh AI] → sinh PDF (WeasyPrint template) → ký/lưu hồ sơ
```
- **Sinh PDF**: mở rộng `bbbg.py` thành module render chung (Jinja2+WeasyPrint) với
  nhiều template: `bbbg_thiet_bi`, `bao_gia`, `de_nghi_tt`. Đăng ký thêm = 1 file HTML.
- **doc_type** mới: `bao_gia`, `de_nghi_tt` (đã có khung phân loại + badge).

## Thành phần

### Backend
- `app/money.py` (mới): `so_tien_bang_chu(n)` (đọc số tiền tiếng Việt) + helper tính
  dòng (thành tiền = SL×đơn giá), tổng trước thuế, thuế theo suất, tổng thanh toán.
- `app/templates_bbbg/bao_gia.html`, `de_nghi_tt.html` (mới): bảng có cột Đơn giá /
  Thành tiền / Thuế suất; khối tổng; logo chìm; ô "Thuyết minh" (nếu có).
- `app/ai.py` (mới): client **tương thích OpenAI** `/chat/completions`. Config:
  `AI_ENABLED`, `AI_BASE_URL` (vd `https://openrouter.ai/api/v1`), `AI_API_KEY`,
  `AI_MODEL` (vd model free). Hàm `quote_narrative(items, khach, tong, note)` →
  đoạn văn tiếng Việt. Không có key → báo "chưa cấu hình AI".
- `main.py` endpoints (admin):
  - `POST /api/quote/generate` (body: items[{ten,dvt,so_luong,don_gia,thue_suat}],
    ben_b, ngày, số, template=bao_gia|de_nghi_tt, thuyet_minh) → tính tiền, render
    PDF, lưu storage, upsert khách hàng, trả `{doc_id, customer_id}` (ký như BBBG).
  - `POST /api/ai/quote-narrative` → gọi `ai.quote_narrative`, trả text.
  - Tái dùng `/api/invoice/parse` cho nguồn hóa đơn (đã có đơn giá/thành tiền).
- Audit: log `quote_generate`, `ai_narrative`.

### Frontend
- Tab **"Báo giá"** (`pages/CreateQuote.tsx`): chọn nguồn → form hàng hóa (tên/ĐVT/
  SL/đơn giá/thuế suất, tự hiện thành tiền + tổng realtime) → nút **"Sinh thuyết minh
  (AI)"** (đổ vào textarea, sửa được) → "Sinh báo giá → Ký". Chọn template báo giá /
  đề nghị TT.
- `api.ts`: `quoteGenerate`, `aiQuoteNarrative`.
- Badge loại: thêm `bao_gia`, `de_nghi_tt` (đã có màu trong DOC_TYPES).

### Config (.env) — dùng 9router có sẵn của inut-apphub
```
AI_ENABLED=true
AI_BASE_URL=http://127.0.0.1:20128/v1      # 9router (OpenAI-compat, đã chạy)
AI_MODEL=opencode/big-pickle               # free, no-signup (DeepSeek-V4-Flash)
AI_API_KEY=public                          # Bearer public
AI_MAX_TOKENS=3500                          # reasoning -> cần lớn, nếu nhỏ content rỗng
```
Lưu ý: response 9router có thể kèm đuôi `data: [DONE]` sau JSON → parse bằng
`JSONDecoder().raw_decode()` (lấy object JSON đầu tiên). Đã test thật OK (tiếng Việt).

### Đề nghị thanh toán — trường
Số ĐN, ngày, bên nhận (khách), **số tiền** (+ bằng chữ), **lý do/nội dung**, tham chiếu
(hợp đồng/hóa đơn/BBBG số), **tài khoản nhận**. TK mặc định: **79713 - Techcombank**
(thiết kế danh sách nhiều STK, hiện 1; cấu hình `BANK_ACCOUNTS` trong config để mở rộng).

## Kiểm thử
- `money.so_tien_bang_chu`: 60000000 → "Sáu mươi triệu đồng chẵn"; test vài mốc.
- Tính tiền: items + VAT → tổng đúng.
- Render báo giá: PDF có bảng tiền, tổng, số bằng chữ, logo chìm (render ảnh đối chiếu).
- AI: mock client → narrative trả về; thật thì cần key.
- Luồng: parse hóa đơn → form báo giá → sinh → ký → hồ sơ loại `bao_gia` → NAS.

## Cần bạn xác nhận khi làm
- Endpoint + model AI free cụ thể (base_url / model của "opencode/openrouter" bạn dùng).
- "Đề nghị TT" cần trường gì (số tiền, lý do, theo hợp đồng/hóa đơn số, tài khoản nhận).

## Mở rộng (nền CRM sau)
Báo giá/đề nghị TT gắn theo khách hàng + hồ sơ → là bước đầu của module bán hàng
(deal/quote → hợp đồng → hóa đơn → bàn giao → thanh toán) cho CRM.
