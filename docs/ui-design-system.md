# KSP PDF Signer — UI Design System

Hệ thiết kế nhẹ, **CSS thuần** (không dùng thư viện UI), định nghĩa trong
`frontend/src/styles.css`. Mục tiêu: gọn, dễ quét mắt, nhất quán toàn app.
Áp dụng cho mọi trang: Ký số, Tạo BBBG, Hồ sơ, Khách hàng, NAS, Kiểm tra, Hồ sơ của tôi.

## 1. Màu (tokens)

Biến trong `:root`:
| Token | Hex | Dùng cho |
|---|---|---|
| `--primary` | `#1e6fd9` | Nút chính, link, tab active |
| `--primary-dark` | `#1857aa` | Hover nút chính |
| `--text` | `#1c2530` | Chữ chính |
| `--muted` | `#6b7683` | Chữ phụ, nhãn |
| `--border` | `#d9dee5` | Viền |
| `--green` | `#1a9e56` | Hợp lệ / thành công |
| `--red` | `#d13b3b` | Lỗi / xoá |

**Quy tắc:** xanh thương hiệu (`#1e6fd9`) **chỉ** dùng cho link/nút/tab — **không**
dùng làm màu badge loại tài liệu (tránh nhầm với hành động).

### Badge loại tài liệu (bg / text)
| Loại | Class | Nền | Chữ |
|---|---|---|---|
| Biên bản bàn giao | `.tb-bbbg` | `#f3e8ff` | `#6b21a8` |
| Hợp đồng | `.tb-hop_dong` | `#e0e7ff` | `#3730a3` |
| Báo giá | `.tb-bao_gia` | `#dbeafe` | `#075985` |
| Hóa đơn | `.tb-hoa_don` | `#fef3c7` | `#92400e` |
| Khác / trống | `.tb-khac` | `#f3f4f6` | `#4b5563` |

### Chip trạng thái (`.chip`)
`.green` (#dcfce7/#166534) · `.amber` (#fef3c7/#92400e) · `.gray` (#f3f4f6/#6b7280) ·
`.indigo` (#e0e7ff/#3730a3). Thêm `.sm` cho cỡ nhỏ (cạnh tên file: NAS ✓, 📎 đã ký).

## 2. Thành phần

### Bảng dữ liệu — `.dt` (bọc trong `.table-wrap`)
- `.table-wrap`: viền + bo góc 10px + `overflow-x:auto`.
- `thead th`: chữ 0.72rem **IN HOA**, 600, xám `#6b7280`, nền `#f9fafb`.
- `tbody td`: padding `8px 12px`, viền dưới `#eef1f4`, `tr:hover` nền `#f7f9fc`.
- Cột ẩn trên màn nhỏ: thêm class `.col-hide-sm` (ẩn <820px).
- Cột hành động: `.col-act` (căn phải, co hẹp).

### Hành động trên hàng
- **3 hành động chính** dạng icon vuông `.iact` (⬇ Tải, 🔗 Chia sẻ, ✔ Kiểm tra).
- **Hành động phụ** gom vào menu `⋯` (`<RowMenu>` trong `Documents.tsx`): xem/thay
  bản đã ký, xoá (đỏ). Đóng khi bấm ra ngoài (`.menu-backdrop`).

### Badge bấm-để-sửa
- **Loại**: `<TypeCell>` — badge màu, bấm → `<select>` (`.cell-edit`), đổi xong về badge.
- **Khách hàng**: `<CustomerCell>` — pill `.pill.cust`, bấm để đổi; chưa gán = pill viền đứt.

### Nút
- Chính: `.primary` / `button[type=submit]` (nền xanh, full-width trong form).
- Nhỏ (toolbar/thanh trạng thái): `.btn-sm` (+ `.danger` / `.ghost`).
- Link dạng text: `.link-btn`; nguy hiểm: `.danger-link`.

### Panel & form
- `.panel`: nền trắng, viền, bo góc 10px, tiêu đề `h3`.
- `.grid2`: lưới 2 cột cho cặp trường form.
- `label` + `input`/`select` full-width; nhãn nhỏ xám phía trên.

### Toolbar trang danh sách — `.docs-toolbar`
Một hàng: tiêu đề + `.count` (pill số đếm) · nhóm `.tb-group` (ô `.search`,
`.tb-select` lọc, số dòng/trang) đẩy phải. Thanh phụ bên dưới: NAS status, bulk-bar.

### Trạng thái rỗng / đang tải
- Rỗng: `.empty` (icon lớn `.empty-ic` + mô tả + nút "Xoá bộ lọc").
- Đang tải: hàng `.skel-row` với `.skel` (shimmer).

## 3. Layout trang
- Trang danh sách: `.docs-page` (max-width 1180px, căn giữa).
- Trang 1 cột (form/duyệt): `.page-1col` (max-width ~1000px).
- Trang 2 cột (ký, kiểm tra): grid trái panel + phải viewer.

## 4. Responsive
- `<820px`: ẩn cột `.col-hide-sm` (Người ký / Thời gian), thu hẹp ô tìm.
- Bảng luôn cuộn ngang trong `.table-wrap` (không vỡ layout).

## 5. Trang khách hàng
Footer cảm ơn (`.thanks-bar` / `.thanks-note`) chỉ hiện cho vai trò khách hàng và
trang chia sẻ công khai `/s/{token}`.

## 6. Thêm/đổi thành phần
- Badge loại mới: thêm class `.tb-<key>` (nền + chữ) và map trong `DOC_TYPES` (`api.ts`).
- Chip trạng thái mới: dùng `.chip` + biến thể màu có sẵn.
- Bảng mới: bọc `.table-wrap` + `.dt`, theo mẫu `Documents.tsx` / `MyDocuments.tsx`.

## Nguồn tham khảo (nghiên cứu UX)
Linear (ẩn thông tin phụ, hiện khi hover) · Stripe (màu ngữ nghĩa ≠ màu thương hiệu) ·
GitHub (tìm/lọc luôn sẵn) · Vercel (mỗi hàng 1 hành động chính, còn lại vào menu ⋯).
