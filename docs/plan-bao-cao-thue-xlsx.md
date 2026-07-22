# Plan: Tính năng xuất XLS Báo cáo thuế GTGT (BCT quý) + lưu lại

> Mục tiêu: từ dữ liệu hoá đơn đã đồng bộ trong hệ thống (InvSale / InvPurchase),
> tự sinh file **BCT quý** đúng 3 sheet như mẫu kế toán nộp
> (`Tờ khai 01/GTGT` + `Bảng kê bán ra` + `Bảng kê mua vào`), tính đúng các chỉ tiêu
> [22]…[43], và **lưu lại** bản đã sinh để đối chiếu / in / nộp.

## ★ Giai đoạn 1 (làm trước): Úp file kế toán → tự review + xem Excel online

Không sinh tự động. Kế toán úp file BCT (.xlsx) → hệ thống parse, chấm lỗi, hiện Excel ngay trên web,
lưu lại từng phiên bản để anh review. Độc lập với Giai đoạn 2, ship được ngay.

**Backend**
- `app/tax_review.py` (mới): `parse_bct(xlsx_bytes) -> BctDoc` — đọc 3 sheet bằng `openpyxl`, nhận diện
  các ô chỉ tiêu [22]…[43] + đọc dòng bảng kê bán/mua. Nhận diện theo nhãn `[NN]` trong ô (không hardcode
  toạ độ cứng — file kế toán có thể xê dịch dòng).
- `check_bct(doc) -> list[Finding]` — bộ luật chấm (mức đỏ/vàng), dùng lại cho GĐ2:
  1. `[40a]`/`[40]` < 0 → ĐỎ (phải chuyển sang [41]/[43]).
  2. HĐ bán rate=0 nhưng bên mua là DN nội địa → VÀNG (nghi 0% sai / quên thuế).
  3. Σ bảng kê ≠ chỉ tiêu tờ khai > 1đ → ĐỎ.
  4. `[36]=[35]-[25]`, `[28]=[26]+[27]`, `[34]/[35]` không khớp công thức → ĐỎ.
  5. rate suy ra ∉ {0,5,8,10} → VÀNG.
  6. HĐ nhập khẩu chưa có chứng từ nộp thuế khâu NK → VÀNG (nhắc).
- `grid(xlsx_bytes) -> {sheets:[{name, rows:[[cell...]], merges:[...]}]}` — lưới ô để render online
  (giá trị + merge cell + số cột), tái dùng `openpyxl`.
- Model `TaxReviewUpload` (DB): id, ky, ten_file, doc_id (file gốc trong `storage`), findings (JSON),
  ct_snapshot (JSON các chỉ tiêu chính), uploaded_by, uploaded_at, note. Giữ nhiều phiên bản theo kỳ.

**Route** (`require_admin`):
- `POST /api/tax/review/upload` (multipart .xlsx) → parse + check + lưu → trả `{id, findings, ct}`.
- `GET  /api/tax/review` → danh sách phiên bản đã úp (lọc theo kỳ).
- `GET  /api/tax/review/{id}/grid` → lưới 3 sheet để xem online.
- `GET  /api/tax/review/{id}/file` → tải lại file gốc.

**Frontend** — tab mới "Review tờ khai" (cạnh Đồng bộ thuế), theo pattern upload của `PurchaseImport.tsx`:
- Ô kéo-thả .xlsx → hiện panel **cảnh báo** (đỏ/vàng, mỗi lỗi kèm ô/chỉ tiêu liên quan + cách sửa).
- **Xem Excel online**: tab con cho từng sheet, render bảng HTML từ `grid` (tô đỏ ô có lỗi, merge cell).
- Lịch sử phiên bản theo kỳ để so sánh bản kế toán gửi lần 1 / lần 2…

**Test**: dùng đúng file `BCT_QUY_2__2026` làm fixture → kỳ vọng bắt được 3 lỗi đã biết
([40] âm, 2 HĐ 0% gộp nhầm nhóm, nhãn 10% mà thực 8%).

---

## 0. Bối cảnh & lý do (Giai đoạn 2 — sinh tự động từ dữ liệu hệ thống)

Kế toán đang làm file thủ công (xem `BCT_QUY_2__2026`). Khi review thủ công phát hiện
lỗi lặp lại (xem mục "Rủi ro nghiệp vụ" bên dưới). Hệ thống đã có sẵn:
- Đồng bộ HĐ từ cổng thuế + đối chiếu (`app/tax.py::reconcile`, route `/api/tax/sync`).
- Kho HĐ bán/mua trong DB (`InvSale`, `InvPurchase`).
- Helper xuất XLSX (`app/inv_export.py`: `xlsx_response`, `export_ihoadon_xlsx` dùng template).

=> Chỉ cần thêm **1 engine tính tờ khai** + **1 bộ render 3 sheet** + **lưu bản sinh**.

## 1. Nguồn dữ liệu & khoảng trống cần xử lý

| Cần | Có trong DB? | Ghi chú |
|-----|--------------|---------|
| Doanh thu chưa thuế / tiền thuế / tổng | ✅ `tong_truoc_thue`, `tong_thue`, `tong_tien` | có sẵn cả bán & mua |
| Số HĐ, ký hiệu, ngày, MST, tên | ✅ | có sẵn |
| **Thuế suất từng HĐ** | ❌ **KHÔNG có cột** | phải **suy ra** `rate = round(tong_thue/tong_truoc_thue*100)` |
| Phân biệt **0%** vs **không chịu thuế** vs **không kê khai** | ❌ | cả 3 đều có `tong_thue=0` → **nhập nhằng** |
| HĐ điều chỉnh/thay thế | ✅ `is_dieu_chinh` (InvSale) | loại khỏi bảng kê hoặc xử lý riêng |
| Số dư khấu trừ kỳ trước [22] | ❌ | lấy từ [43] của tờ khai kỳ liền trước (xem mục lưu trữ) |

**Quyết định thiết kế: ✅ CHỌN (A) — thêm cột thuế suất** (user chốt 2026-07-21).
- Thêm cột `thue_suat` (Float, nullable) vào `InvSale`/`InvPurchase`; backfill = suy ra từ tỷ lệ
  `round(tong_thue/tong_truoc_thue*100)`, bucket ∈ {KCT, 0, 5, 8, 10}; migration nhẹ (SQLite `ADD COLUMN`).
- Khi rate suy ra = 0 → để kế toán **xác nhận tay** là 0% / không chịu thuế / không kê khai
  (đây chính là chỗ nhập nhằng đã gây lỗi gộp nhóm ở file quý 2/2026).
- Backfill phải log các HĐ rate ∉ {0,5,8,10} để rà tay.

## 2. Engine tính tờ khai — `app/tax_report.py` (mới)

`def build_tax_return(db, tu: str, den: str) -> TaxReturn` gom HĐ trong kỳ, bucket theo rate, tính:

Bán ra:
- `[26]` = Σ doanh thu **không chịu thuế**
- `[29]` = Σ doanh thu **0%**;  `[30]/[31]` = base/thuế **5%**
- `[32]/[33]` = base/thuế nhóm giảm thuế **8% và 10%** (gộp theo mẫu hiện hành) — **kèm split 8% vs 10% ở phụ lục**
- `[27]` = [29]+[30]+[32];  `[28]` = [31]+[33];  `[34]=[26]+[27]`;  `[35]=[28]`

Mua vào: `[23]` = Σ base khấu trừ; `[24]=[25]` = Σ thuế đủ đk khấu trừ.

Nghĩa vụ (⚠️ **chỗ kế toán hay sai**):
```
[36] = [35] - [25]
tmp  = [36] - [22] + [37] - [38] + [39]
if tmp >= 0:  [40a] = [40] = tmp;              [41] = [42] = [43] = 0
else:         [40a] = [40] = 0;  [41] = -tmp;  [43] = [41] - [42]
```
=> **KHÔNG bao giờ để số âm nằm ở [40a]/[40]**. Âm ⇒ chuyển hết sang [41]/[43] (khấu trừ chuyển kỳ sau).

Trả về object có đủ 26..43 + danh sách dòng bán/mua đã phân nhóm + cảnh báo (mục 4).

## 3. Render 3 sheet — dùng template, giữ đúng layout mẫu

- Lưu file mẫu rỗng `app/assets/bct_gtgt_template.xlsx` (tách từ file kế toán, xoá số),
  `load_workbook(template)` rồi đổ số vào ô cố định — giống `export_ihoadon_xlsx`.
- 3 sheet: `Tờ khai`, `Bảng kê bán ra`, `Bảng kê mua vào`. Header MST/tên/địa chỉ/kỳ lấy từ `AppSetting`
  (`tax_mst`, tên/địa chỉ DN) + tham số kỳ.
- Bảng kê: đổ từng dòng HĐ theo nhóm thuế suất, tự tính TỔNG CỘNG, số làm tròn đồng (0 lẻ).
- Trả `StreamingResponse` xlsx qua helper sẵn có (`app/inv_export.py`).

## 4. Kiểm tra tự động (cảnh báo trước khi kế toán nộp)

Engine sinh list cảnh báo, hiện lên UI:
- HĐ bán rate=0 nhưng bên mua là DN nội địa (nghi thiếu thuế, không phải xuất khẩu 0%).
- Chênh Σ bảng kê vs chỉ tiêu tờ khai > 1đ.
- `[40a]` hoặc `[40]` < 0 (sai cấu trúc — chặn).
- HĐ nhập khẩu (tờ khai HQ) chưa đính giấy nộp thuế → thuế đầu vào chưa đủ đk khấu trừ.
- Chênh rate suy ra ≠ {0,5,8,10} (HĐ số liệu lỗi).
- Đối chiếu với `reconcile()`: còn `missing_*`/`mismatch_*`/`orphan_*` trong kỳ → cảnh báo "chưa khớp cổng thuế".

## 5. Lưu lại bản đã sinh — model `TaxReport` (mới trong `app/db.py`)

```
class TaxReport:
    id, ky ("2026-Q2"), tu, den,
    ct_22, ct_35, ct_25, ct_36, ct_40, ct_41, ct_43,   # snapshot chỉ tiêu chính
    so_ban, so_mua, warnings (JSON),
    doc_id (file xlsx trong storage),  created_by, created_at,
    status ("draft"|"final")
```
- `[22]` kỳ này = `ct_43` của `TaxReport` kỳ liền trước (nếu chưa có → cho nhập tay, lưu lại).
- File xlsx lưu qua `storage` (như HĐ), tải lại bất kỳ lúc nào; cron backup NAS đã cover.

## 6. API + UI

Backend (`app/main.py`, `require_admin` như các route tax khác):
- `GET  /api/tax/report/preview?tu=&den=` → JSON tờ khai + cảnh báo (không lưu).
- `POST /api/tax/report/generate` → tính, render xlsx, tạo `TaxReport`, lưu file. Trả id + link.
- `GET  /api/tax/report/{id}/xlsx` → tải file đã lưu.
- `GET  /api/tax/report` → danh sách theo kỳ.

Frontend (tab Thuế đã có): chọn kỳ → "Xem trước tờ khai" (bảng chỉ tiêu + panel cảnh báo đỏ/vàng)
→ nút "Sinh & lưu XLS" → tải về. Danh sách bản đã lưu theo quý.

## 7. Thứ tự làm

1. Migration + cột `thue_suat` (nếu chọn A) + model `TaxReport`.
2. `tax_report.py`: bucket rate + engine chỉ tiêu + unit test theo đúng file quý 2/2026
   (kỳ vọng: [35]=11.890.521, [25]=12.059.273,64, [36]=−168.752,64, [40]=0, [41]=[43]=4.443.786,64).
3. Template xlsx 3 sheet + render.
4. Bộ cảnh báo (mục 4) + nối `reconcile`.
5. Route + UI + lưu bản sinh.
6. Test hồi quy với dữ liệu quý thật.

## 8. Rủi ro nghiệp vụ (đúc từ file kế toán quý 2/2026 — dùng làm test case)

- **Số âm ở [40a]/[40]**: file để `[40]=−4.443.786,64`. Sai. Phải là `[40]=0`, `[41]=[43]=4.443.786,64`.
- **2 HĐ bán thuế suất 0%** (HĐ 6: 30.000.000; HĐ 14: 15.512.500 = 45.512.500) bị **gộp vào [32]**
  và **[29] để trống**. Nếu thực sự 0% → phải nằm [29]; nếu quên thuế → thiếu ~3,6 triệu. **Phải hỏi kế toán.**
- **Nhãn "10%" nhưng thực tế 8%**: [33]=8% của phần chịu thuế, không bằng 10%×[32]. Cần tách rõ nhóm 8% (giảm thuế) và 10%.
- HĐ nhập khẩu (HUNAN RIKA, SHENZHEN HAOYU) khấu trừ thuế đầu vào: cần chứng từ nộp thuế ở khâu nhập khẩu.
