# INUT Design System v2 ("Crisp Editorial-Operator")

Tài liệu chuẩn hóa chính thức cho toàn bộ giao diện **KSP-PDFSign / INUT Operations Suite**.
Mọi màn hình, component và stylesheet mới hoặc refactor bắt buộc tuân thủ hệ thống này và vượt qua kiểm tra tự động `node scripts/design-lint.mjs`.

**Nguồn triển khai chuẩn (Single Source of Truth):**

- Entry CSS: `frontend/src/styles.css`
- Design tokens duy nhất: `frontend/src/styles/01-tokens.css`
- Lớp nền tảng & shell & primitives: `frontend/src/styles/02-base.css`, `03-shell.css`, `04-primitives.css`
- CSS đặc thù theo phân hệ (13 file tách rời, tổng `<= 35 KiB` / `<= 900L`): `frontend/src/styles/modules/mod-*.css`
- Thư viện 22 UI primitives: `frontend/src/components/ui/` (`index.ts`)
- App shell & định tuyến: `frontend/src/App.tsx`
- Viewport mobile: `frontend/index.html` bắt buộc giữ `viewport-fit=cover`
- Gatekeeper tự động (G1–G5): `scripts/design-lint.mjs`

---

## 1. Triết lý "Crisp Editorial-Operator"

Hệ thống v2 dung hòa bản sắc **INUT Deep Ink / Forest Teal** với kỷ luật **vận hành mật độ cao (high-density operator UI)**:

- **Dữ liệu là nhân vật chính:** Mọi màn hình tác nghiệp dùng `<PageHeader variant="compact" />` nền trắng sắc nét (`<= 80px` desktop) để dòng dữ liệu / trường nhập đầu tiên luôn xuất hiện **trên nếp gấp màn hình** (`y <= 420px` desktop `1440×900`, `y <= 480px` mobile `390×844`).
- **Hero tối màu chỉ dành cho 2/36 trang:** Chỉ `Operations` (`/`) và `MyDocuments` (`/ho-so-cua-toi`) dùng `<PageHeader variant="hero" />` nhỏ gọn (`<= 128px` desktop, `<= 140px` mobile). Cấm hoàn toàn hero khổng lồ hoặc thẻ game/RPG.
- **Một bảng màu thống nhất toàn app:** Xanh mực đậm (`--ink`), teal vận hành (`--primary`), vàng gold chỉ dùng cho thanh active sidebar & tối đa 1 CTA điều hành nổi bật, cùng 6 cặp màu ngữ nghĩa đạt chuẩn **WCAG AA (`>= 4.5:1`)**.
- **Nhãn tiếng Việt rõ nghĩa, trạng thái đa kênh:** Không bao giờ truyền đạt trạng thái chỉ bằng màu — luôn kết hợp **màu + chữ + SVG icon (`<AppIcon>`)**.
- **100% biểu tượng SVG (`lucide-react`):** Cấm tuyệt đối emoji Unicode trong nút, tiêu đề, tab, badge, empty state (tránh lỗi hộp `[NO GLYPH]` trên Linux/workstation).

---

## 2. Kiến trúc CSS & Thứ tự Import (`frontend/src/styles.css`)

```text
frontend/src/styles.css
├── styles/01-tokens.css          # Nơi DUY NHẤT được khai báo hex / rgb / rgba / z-index số
├── styles/02-base.css            # Reset, typography mặc định, form control, bảng nền tảng
├── styles/03-shell.css           # Topbar, Sidebar/Drawer, Mobile Bottom Nav, App Content
├── styles/04-primitives.css      # Toàn bộ style cho 22 component trong components/ui/
└── styles/modules/               # 13 file CSS mỏng theo domain (tổng <= 35 KiB, <= 900L)
    ├── mod-ops-docs.css          # Operations, Documents, DocTracking, MyDocuments, AuditLog, NasBrowser
    ├── mod-inventory-trade.css   # Inventory, PurchaseImport, PurchaseFixModal, StockIssue, Recipes, EmailSyncModal, NegStockModal
    ├── mod-trade-sales.css       # CustomsDecl, CustomsCheckManager, CustomsDriveDossiers, SalesInvoice, Production, Customers
    ├── mod-spx-trademarks.css    # ShippingSPX, Trademarks
    ├── mod-studios-tools.css     # CreateBBBG, CreateContract, CreateQuote, SaleDraft, PymidCoop, BilliardQuoteTab, SmartPartyPaste
    ├── mod-pdf-tools.css         # Signer, Verify, PdfCanvas, PdfView, CertPicker
    ├── mod-tax-payroll.css       # TaxSync, TaxReview, GovRadar, Payroll, PayrollHrOverview, PayrollEmployeeCharts, PayrollForecastPlanner
    ├── mod-settings-comms.css    # Messenger, Training, Settings, Telegram, Login, LogoSettings
    ├── mod-bidding.css           # BiddingProcurement
    ├── mod-piecework.css         # PieceworkContracts
    ├── mod-standards.css         # StandardsConformity, TqcCertificateLookup
    ├── mod-taxdefense.css        # TaxDefense
    └── mod-webads.css            # WebAdsLeads
```

**Luật thép cho CSS (`02..04` & `modules/*.css`):**
- `0` màu thô (`#hex`, `rgb()`, `rgba()`, `hsl()`). Mọi màu phải dùng `var(--*)` từ `01-tokens.css`.
- `0` dòng dài `> 200` ký tự (cấm CSS nén 1 dòng).
- `0` `!important` (ngoại lệ duy nhất: bên trong `@media print` hoặc `.sr-only`).
- `0` `z-index` dạng số thô — chỉ dùng 6 token `var(--z-*)`.
- Chỉ dùng đúng 4 độ rộng `@media`: `1280px`, `1024px`, `820px`, `430px`.

---

## 3. Hệ thống Design Tokens (`frontend/src/styles/01-tokens.css`)

### 3.1 Typography — 6 Bậc Thống Nhất

| Token | Giá trị | Weight / Line-Height | Phạm vi sử dụng |
|---|---:|---|---|
| `--font-sans` | `"Inter", ...` | 400 / 500 / 600 / 700 | **Mọi H1 nghiệp vụ (`35/36` trang)**, heading, bảng, nút, form |
| `--font-serif` | `Georgia, "Times New Roman", serif` | 600–700 | **CHỈ dùng** cho brand mark trên topbar & H1 trang chủ `/` (`Operations`) |
| `--font-mono` | `"Cascadia Mono", ui-monospace, ...` | 500 (`tabular-nums`) | Số tiền VND, MST, mã hóa đơn, mã vận đơn SPX, ngày/giờ |
| `--text-h1-hero` | `30px` | 600 / `1.2` | H1 trang điều hành `/` (`Operations`) |
| `--text-h1` | `24px` | 600 / `1.25` (`-0.02em`) | Tiêu đề trang chuẩn (`<PageHeader variant="compact">`) |
| `--text-h2` | `16px` | 600 / `1.3` | Tiêu đề section / `<SectionCard>` / Modal / Drawer |
| `--text-h3` | `14px` | 600 / `1.35` | Tiêu đề nhóm con / thẻ mobile card |
| `--text-body` | `13.5px` | 400 / `1.5` | Nội dung bảng, mô tả, văn bản chính |
| `--text-caption` | `12px` | 500 / `1.4` | **Sàn cứng chữ đọc được (`>= 12px`)**: metadata, chú thích, phụ đề |
| `--text-label` | `11px` | 700–800 (uppercase) | **CHỈ dùng** cho `<th>`, `.ui-eyebrow`, nhãn cột ngắn |
| `--text-mono` | `12.5px` | 500 (`tabular-nums`) | Dữ liệu mã định danh & số liệu so cột |
| `--text-input-mobile` | `16px` | 400 | Bắt buộc cho mọi `input/select/textarea` ở `<= 820px` (chống iOS zoom) |

### 3.2 Hệ thống 3 Tầng Bề Mặt (Surfaces) & Shell Tối

| Token | Giá trị | Vai trò |
|---|---:|---|
| `--bg-canvas` | `#f1f5f3` | Nền canvas trang chính (tầng 0) |
| `--surface-1` | `#ffffff` | Card, bảng, `<PageHeader compact>`, modal, drawer (tầng 1, viền `1px solid var(--border)`) |
| `--surface-2` | `#f7faf8` | Khay lọc chìm, `<thead>`, footer tổng hợp, card phụ (tầng 2) |
| `--surface-3` | `#edf3f0` | Nền nhấn nhẹ / hover bảng phụ |
| `--surface-hover` | `#f1f8f5` | Hover hàng bảng & item chọn |
| `--ink` | `#102e2c` | Nền sâu topbar, sidebar, hero tối |
| `--ink-2` / `--ink-mid` | `#164b45` / `#143b38` | Gradient ink chuyển mượt cho shell & hero |
| `--ink-on-dark` | `#ffffff` | Chữ chính trên nền ink (`--ink-on-dark-soft: #eaf5f1`, `--ink-on-dark-muted: #c2d8d2`) |
| `--topbar-glass` | `rgba(15, 43, 41, 0.96)` | Nền topbar cố định có `backdrop-filter` |
| `--overlay-backdrop` | `rgba(7, 28, 27, 0.6)` | Màn phủ backdrop cho drawer/modal |

*(Các alias tương thích ngược `--bg`, `--paper`, `--panel`, `--surface-subtle` được giữ trong `01-tokens.css` để không làm gãy module cũ trong quá trình nâng cấp.)*

### 3.3 Màu Thương Hiệu, Chữ, Viền & 6 Bộ Ngữ Nghĩa WCAG AA (`>= 4.5:1`)

| Nhóm | Token chính | Giá trị | Ghi chú |
|---|---|---:|---|
| **Brand** | `--primary` / `--primary-hover` / `--primary-dark` / `--primary-soft` | `#157d72` / `#126f66` / `#0f655d` / `#e4f3ef` | Hành động chính, focus, active state |
| **Gold** | `--gold` / `--gold-bright` / `--gold-fg` | `#d4942a` / `#f2bd62` / `#143b36` | Vạch active sidebar & tối đa 1 CTA điều hành nổi bật |
| **Text** | `--text` / `--muted` / `--text-subtle` / `--text-faint` | `#173b38` / `#4b615b` / `#5c706a` / `#7b8c87` | Phân cấp độ tương phản chữ |
| **Borders** | `--border` / `--border-subtle` / `--border-strong` / `--border-hover` | `#dce5e0` / `#edf1ef` / `#c4d3cc` / `#9bbdb5` | Viền card, bảng, input, hover |
| **Neutral** | `--sem-neutral-{fg,bg,border,solid}` | `#445953` / `#eef3f0` / `#d2ddd8` | Nháp, không áp dụng, lưu trữ |
| **Brand Sem** | `--sem-brand-{fg,bg,border,solid}` | `#0f655d` / `#e4f3ef` / `#b6d9ce` | Đang hoạt động, ưu tiên INUT |
| **Info** | `--sem-info-{fg,bg,border,solid}` | `#0e7490` / `#e6f6fa` / `#a5dce9` | Thông tin, đồng bộ, đang xử lý |
| **Success** | `--sem-success-{fg,bg,border,solid}` | `#157347` / `#e6f5ed` / `#b2dfc8` | Hoàn tất, hợp lệ, đủ tồn, đã ký |
| **Warning** | `--sem-warning-{fg,bg,border,solid}` | `#a16207` / `#fffbeb` / `#f0d58c` | Chờ duyệt, cần đối soát, sắp hết hạn |
| **Danger** | `--sem-danger-{fg,bg,border,solid}` | `#b91c1c` / `#fef2f2` / `#f5bcbc` | Lỗi, thiếu PDF, âm tồn, thao tác xóa |
| **Charts** | `--chart-1` .. `--chart-6` | `#157d72`, `#0e7490`, `#d4942a`, `#157347`, `#b91c1c`, `#5b6e68` | Toàn bộ biểu đồ & SVG series |
| **Toasts** | `--toast-{info,success,warning,danger}-{bg,border}` | Nền tối tương phản `>= 7:1` với `--ink-on-dark` | Thông báo nổi góc phải trên `ToastProvider` |

### 3.4 Khoảng Cách, 4 Bo Góc (Radii), 3 Đổ Bóng (Shadows) & 6 Tầng Z-Index

| Danh mục | Token & Giá trị chuẩn | Vai trò |
|---|---|---|
| **Spacing** | `--space-1: 4px`, `--space-2: 8px`, `--space-3: 12px`, `--space-4: 16px`, `--space-5: 20px`, `--space-6: 24px`, `--space-8: 32px` | Lưới 4px thống nhất toàn hệ thống |
| **Touch** | `--touch-desktop: 38px`, `--touch-min: 44px` | Mọi nút chạm mobile bắt buộc `>= 44×44px` |
| **Radii (4+pill)** | `--radius-xs: 6px` (badge) · `--radius-sm: 8px` (button/input) · `--radius-md: 12px` (card/table/toolbar) · `--radius-lg: 16px` (modal/drawer) · `--radius-pill: 9999px` | Khai tử 40 giá trị radius rời rạc |
| **Shadows (3)** | `--shadow-xs` (`0 1px 2px`) · `--shadow-sm` (`0 6px 18px`) · `--shadow-lg` (`0 20px 50px`) + `--ring`, `--ring-danger` | Elevation nhất quán, focus ring rõ ràng |
| **Z-Index (6)** | `--z-sticky: 20` · `--z-topbar: 40` · `--z-bottom-nav: 45` · `--z-drawer: 1050` · `--z-modal: 1080` · `--z-toast: 1200` | Tuyệt đối không dùng số thô (`9999`, `1000`, ...) |
| **Shell Dims** | `--topbar-h-desktop: 64px` · `--topbar-h-mobile: 56px` · `--sidebar-w: 232px` (`206px` compact) · `--bottom-nav-h: 62px` · `--page-max-w: 1480px` (`1040px` narrow / `1600px` wide) | Nhịp chiều ngang cố định khi đổi route |

### 3.5 Đúng 4 Breakpoints & Hợp đồng Responsive Mobile

| Breakpoint | Ý nghĩa & Hành vi chuẩn |
|---:|---|
| **`1280px`** | Thu gọn chiều rộng sidebar (`--sidebar-w-compact: 206px`), giảm khoảng đệm ngang nhẹ trên laptop 1280px |
| **`1024px`** | Layout 2 cột lớn / `SplitWorkspace` chuyển thành xếp dọc hoặc thu hẹp cột phụ; KPI strip rút xuống 2–3 cột |
| **`820px`** | **Ngưỡng mobile thống nhất** (gồm cả `DataView` — đã đồng bộ từ `768px` → `820px`!): Topbar ẩn `.topbar-user` & `.topbar .logout` (đã có trong footer drawer) để `.topbar-route-pill` hiển thị đủ không bị cắt giữa từ; mở drawer slide-in `100dvh`; hiện `.mobile-bottom-nav`; `AppModal`/`DetailDrawer` thành bottom sheet; `DataView` chuyển sang `<MobileCard>`; mọi `input/select/textarea` = `16px`; mọi nút chạm `>= 44px` |
| **`430px`** | Tinh chỉnh khe hở cho điện thoại hẹp (`360px`–`414px`, iPhone Pro / SE), vẫn đảm bảo `0px` horizontal overflow xuống tới `320px` |

---

## 4. 7 Kiểu Trang Chuẩn — Page Archetypes (Ánh xạ đủ 38/38 file)

Mọi trang trong `frontend/src/pages/` thuộc đúng 1 trong 7 khuôn mẫu sau (không tạo khuôn mẫu ngoại lệ):

| Archetype | Bố cục Desktop (`1440×900`) | Bố cục Mobile (`390×844`) | Danh sách file ánh xạ (38/38) |
|---|---|---|---|
| **A1. Executive Dashboard** | `<PageHeader variant="hero">` (`<=128px`, Georgia `30px`) → 4-col `<KpiStrip>` → 2-col Action Queues (`<SectionCard>`) → Sync Health Strip | Compact Hero → 2×2 `<KpiStrip>` → Stacked `<SectionCard>` | `Operations.tsx` *(1)* |
| **A2. Operational Data Workbench** | `<PageHeader compact>` → Tùy chọn `<KpiStrip>` → `<FilterBar>` (`overflow:visible`, sticky) → `<ActionBar>` → `<DataView>` (sticky `thead`, nút hành động gọn/overflow) + `<DetailDrawer>`/`<AppModal>` | Compact Header → 2×2 KPI → Bộ lọc gập gọn → Danh sách `<MobileCard>` (hoặc bảng cuộn ngang có cột đầu dính cho sổ kế toán) | `Documents`, `DocTracking`, `MyDocuments` *(hero)*, `Customers`, `AuditLog`, `NasBrowser`, `Inventory` (+`PurchaseFixModal` chuyển về `components/`), `PurchaseImport`, `CustomsDecl`, `SalesInvoice`, `StockIssue`, `Production`, `Recipes`, `ShippingSPX`, `TaxSync`, `GovRadar`, `Trademarks` *(18)* |
| **A3. Multi-Tab Enterprise Workbench** | `<PageHeader compact>` → `<ResponsiveTabs>` (nút cuộn trái/phải + fade khi tràn, không bao giờ cắt chữ) → `<KpiStrip>` + `<FilterBar>` + `<DataView>`/`<SectionCard>` theo tab | Compact Header → Scroll-snap Tabs → 2×2 KPI → Bộ lọc gập gọn → `<MobileCard>` | `BiddingProcurement`, `PieceworkContracts`, `StandardsConformity`, `TaxDefense`, `TaxReview`, `WebAdsLeads`, `Payroll` *(7)* |
| **A4. Document & Quote Studio** | `<PageHeader compact>` → Tùy chọn `<StepFlow>` → `<SplitWorkspace variant="preview-right">` (Trái 58%: `<SectionCard>` + `<FormGrid>` + `SmartPartyPaste`; Phải 42%: tổng hợp/xem trước dính + CTA chính) | Compact Header → Chuyển 2 tab Biểu mẫu / Xem trước → Thanh tổng hợp & CTA dính đáy | `CreateBBBG`, `CreateContract`, `CreateQuote`, `SaleDraft`, `PymidCoop` *(5)* |
| **A5. Split Canvas / PDF Inspector** | `<PageHeader compact>` → `<SplitWorkspace variant="sidebar-left">` (Trái 360px: dropzone tải file, chọn chữ ký số, metadata; Phải `1fr`: toolbar & canvas PDF) | Compact Header → Chuyển 2 bước (`Thiết lập` / `Xem PDF`) → Canvas cảm ứng + thanh xác nhận dính đáy | `Signer`, `Verify` *(2)* |
| **A6. Inbox & Knowledge Desk** | `<PageHeader compact>` → `<SplitWorkspace variant="inbox">` (Trái 340px: danh sách hội thoại/chủ đề có tìm kiếm; Phải `1fr`: luồng tin nhắn + ô soạn thảo / nội dung tri thức) | Danh sách ↔ Chi tiết 1 cột kèm nút quay lại trên header | `Messenger`, `Training` *(2)* |
| **A7. System Config & Auth** | `Settings`/`Telegram`: `<PageHeader compact>` → Menu mục/Tab + các `<SectionCard>` xếp dọc + thanh Lưu dính đáy · `Login`: Thẻ đăng nhập căn giữa trên nền ink | `<SectionCard>` xếp dọc, control rộng 100%, cao `>= 44px` | `Settings`, `Telegram`, `Login` *(3)* |

---

## 5. Thư viện 22 UI Primitives (`frontend/src/components/ui/`)

Import toàn bộ qua barrel `import { ... } from "../components/ui"`. *(Riêng `PasswordModal` đã chuyển về `frontend/src/components/auth/PasswordModal.tsx` và vẫn được re-export từ `components/ui` để giữ tương thích ngược.)*

### Nhóm 1 — Bố cục & Khung trang (6)

| # | Primitive | Props chính & Biến thể | Quy ước sử dụng |
|---:|---|---|---|
| 1 | **`PageShell`** | `maxWidth?: "default" \| "narrow" \| "wide"`, `data-page?`, `className?` | Vỏ ngoài duy nhất của mọi trang (`1480px` mặc định); thay toàn bộ 22 wrapper rời rạc. |
| 2 | **`PageHeader`** | `variant?: "compact" \| "hero"` *(mặc định `"compact"`)*, `eyebrow?`, `title`, `subtitle?`, `icon?: IconName`, `breadcrumbs?`, `backAction?`, `badges?`, `actions?`, `headingTag?: "h1" \| "h2"` | **Bắt buộc trên `36/36` trang in-shell.** Giữ tối đa 1 nút `primary` trong `actions`. |
| 3 | **`SectionCard`** | `title?`, `eyebrow?`, `subtitle?`, `icon?`, `actions?`, `footer?`, `padding?: "default" \| "compact" \| "flush"`, `tone?: "default" \| "subtle"`, `id?` | Card bề mặt `--surface-1` chuẩn thay 95 class card tự chế. Không lồng `SectionCard` quá 1 cấp. |
| 4 | **`SplitWorkspace`** | `variant?: "sidebar-left" \| "preview-right" \| "inbox"`, `primary`, `secondary`, `mobileTabs?: [string, string]`, `activeMobilePane?`, `onMobilePaneChange?` | Chuẩn hóa bố cục 2 khung cho các trang A4, A5, A6 và tự chuyển tab trên mobile `<= 820px`. |
| 5 | **`StepFlow`** | `steps: Array<{ id, label, done?, active?, onClick? }>` | Thanh tiến trình ngang cho các luồng tạo hồ sơ nhiều bước (`CreateBBBG`, `SaleDraft`, `PymidCoop`, `Signer`). |
| 6 | **`ResponsiveTabs`** | `tabs: Array<{ id, label, badge?, icon?: IconName, disabled? }>`, `active`, `onChange`, `variant?: "underline" \| "segmented"` | Tự phát hiện tràn ngang (`ResizeObserver` + scroll) và hiện nút chevron trái/phải + fade mép để tab không bao giờ bị cắt. |

### Nhóm 2 — Biểu tượng, Hành động & Trạng thái (5)

| # | Primitive | Props chính & Biến thể | Quy ước sử dụng |
|---:|---|---|---|
| 7 | **`AppIcon`** (`Icon.tsx`) | `name: IconName` (160+ biểu tượng `lucide-react`), `size?` (16), `strokeWidth?` (1.8), `aria-label?`, `aria-hidden?` | **Nguồn icon duy nhất** toàn hệ thống (stroke 1.8 đồng nhất với sidebar). Khi nằm trong nút chỉ có icon, truyền `aria-label` ở nút. |
| 8 | **`AppButton`** | `variant?: "primary" \| "secondary" \| "ghost" \| "danger" \| "gold"`, `size?: "sm" \| "md" \| "lg"`, `loading?`, `leftIcon?`, `rightIcon?`, `iconOnly?`, `fullWidth?` | Thay 39 class nút cũ. Mặc định `type="button"`. Tự hiển thị spinner khi `loading` và đạt `>= 44px` trên mobile. |
| 9 | **`StatusBadge`** | `tone?: "neutral" \| "info" \| "success" \| "warning" \| "danger" \| "brand"`, `variant?: "soft" \| "solid" \| "outline"`, `size?: "sm" \| "md"`, `dot?`, `icon?` | Thay 56 class chip/badge/pill cũ. Luôn mang chữ có nghĩa (không dùng badge trống chỉ có màu). |
| 10 | **`KpiStrip`** | `items: Array<{ label, value, sub?, delta?, icon?, tone?, onClick?, active? }>`, `loading?`, `columns?: 2 \| 3 \| 4 \| 5` | **Một hình học KPI duy nhất toàn app:** vạch trái `3px` theo màu ngữ nghĩa, nhãn uppercase `11–12px`, số liệu `tabular-nums`, có chế độ `loading` skeleton. |
| 11 | **`InlineAlert`** | `tone?: "info" \| "success" \| "warning" \| "danger"`, `title?`, `action?`, `onDismiss?`, `children?` | Tự chọn `<AppIcon>` theo tone. Đặt ngay tại khu vực phát sinh lỗi/cảnh báo, nêu rõ cách khắc phục. |

### Nhóm 3 — Dữ liệu, Bộ lọc & Trạng thái Tải (5)

| # | Primitive | Props chính & Biến thể | Quy ước sử dụng |
|---:|---|---|---|
| 12 | **`DataView`** | `desktop`, `mobileCards?`, `loading?`, `skeletonRows?`, `skeletonCols?`, `empty?`, `stickyHeader?`, `tableClassName?` + bộ con **`MobileCard`, `MobileCardHeader`, `MobileCardGrid`, `MobileCardRow`, `MobileCardActions`** | Đồng bộ chuyển mobile ở `820px`. Bảng desktop bọc `.ui-table-scroll-wrap` (`tabIndex={0}`); danh sách ngắn ưu tiên `<MobileCard>` gọn 3 vùng (header / lưới thuộc tính / nút hành động). |
| 13 | **`FilterBar`** | `search?: { value, onChange, placeholder?, ariaLabel? }`, `filters?`, `actions?`, `activeCount?`, `onReset?`, `collapsibleMobile?` | Thanh lọc `overflow: visible` (`z-index: var(--z-sticky)`) nằm **phía trên** vùng cuộn bảng. Trên mobile `<= 820px`, ô tìm kiếm luôn hiện và nút `"Bộ lọc (N)"` mở gọn bộ lọc phụ. |
| 14 | **`ActionBar`** | `selectedCount?`, `onClearSelection?`, `primaryActions?`, `secondaryActions?`, `overflowItems?: Array<{ label, icon?, danger?, onClick, disabled? }>` | Thanh thao tác hàng loạt & menu tràn (`...`) giúp nút hành động không bao giờ bị tràn/cắt khỏi card desktop. |
| 15 | **`EmptyState`** | `icon?: IconName` *(mặc định `"inbox"`)*, `title`, `description?`, `action?`, `compact?` | Thay 11 class `.empty*`. Luôn giải thích vì sao rỗng (chưa có dữ liệu vs lọc không khớp) kèm CTA tiếp theo. |
| 16 | **`SkeletonBlock` & `TableSkeleton`** | `SkeletonBlock({ variant?: "line" \| "title" \| "card" \| "rect", lines? })` · `TableSkeleton({ rows?, cols? })` | Shimmer mượt tôn trọng `prefers-reduced-motion`; bắt buộc dùng trên mọi trang bất đồng bộ (không để trắng trang). |

### Nhóm 4 — Biểu mẫu, Hộp thoại & Phản hồi (6)

| # | Primitive | Props chính & Biến thể | Quy ước sử dụng |
|---:|---|---|---|
| 17 | **`FormGrid` & `FormField`** | `FormGrid({ cols?: 2 \| 3 \| 4 \| 5 })` · `FormField({ label, htmlFor?, required?, hint?, error?, fullWidth? })` | Nhãn đặt trên input, gắn `.field-missing` + thông báo lỗi rõ ràng; mobile `<= 820px` tự về 1 cột và input `16px`. |
| 18 | **`AppModal`** | `open`, `onClose`, `title`, `subtitle?`, `size?: "sm" \| "md" \| "lg" \| "xl"`, `footer?`, `dismissible?`, `initialFocusRef?`, `className?` | **Bắt buộc giữ `aria-label="Đóng hộp thoại"`** trên nút đóng (hợp đồng E2E + a11y), focus-trap `Tab`/`Shift+Tab`, `aria-labelledby`, Escape, khóa scroll ref-counted, bottom-sheet trên mobile. |
| 19 | **`DetailDrawer`** | `open`, `onClose`, `title`, `subtitle?`, `size?: "md" \| "lg"` (`480px`/`640px`), `footer?`, `className?` | Ngăn trượt phải desktop / bottom-sheet `92dvh` mobile để xem chi tiết hồ sơ mà không mất vị trí cuộn bảng. Giữ `aria-label="Đóng hộp thoại"`. |
| 20 | **`ConfirmDialog` + `ConfirmProvider` + `useConfirm`** | `const confirm = useConfirm(); const ok = await confirm({ title, message?, confirmLabel?, cancelLabel?, tone?: "primary" \| "danger" \| "warning" });` | Được bọc toàn cục trong `App.tsx`. **Thay thế 100% `window.confirm()`** (tuyệt đối không gọi dialog trình duyệt). |
| 21 | **`PromptDialog`** | `open`, `title`, `label?`, `defaultValue?`, `placeholder?`, `onConfirm`, `onCancel` | Hộp thoại nhập 1 giá trị dựng trên `AppModal` + `FormField` + `AppButton`. **Thay thế 100% `window.prompt()`**. |
| 22 | **`ToastProvider` + `useToast`** | `const { showToast, success, error, info, warning } = useToast();` | Bọc toàn cục trong `App.tsx`, `z-index: var(--z-toast)`, có `<AppIcon>` theo tone và nút đóng `aria-label="Đóng thông báo"`. **Thay thế 100% `window.alert()` và toast tự chế.** |

---

## 6. Anti-Patterns Bị Cấm Tuyệt Đối

1. **10 sub-theme ngoại lai:** Cấm Shopee Orange (`ShippingSPX`), Facebook Blue (`Messenger`), Acid Lime + Beige (`PymidCoop`), Rainbow Electric Blue / Neon Purple KPI (`Trademarks`), Navy/Rust và ghi đè `--ink` toàn cục (`CreateContract`), Terracotta (`Payroll`), Sky Blue (`TaxReview`), Warm Brown (`Settings`), font `Cambria` (`SaleDraft`), thẻ game RPG `Lv.2 / EXP` (`StandardsConformity`). Nhận diện đối tác/hãng vận chuyển chỉ được thể hiện bằng logo nhỏ hoặc `<StatusBadge>`.
2. **Màu cứng ngoài `01-tokens.css`:** Cấm mọi `#hex`, `rgb()`, `rgba()`, `hsl()` trong `02..04`, `modules/*.css`, và mọi file `.tsx`.
3. **Inline `style={{}}` tĩnh:** Cấm mọi `style={{}}` dùng cho bố cục, khoảng cách, màu sắc, typography. Ngoại lệ duy nhất là tọa độ/kích thước tính động lúc chạy (canvas PDF, thanh tiến độ, vị trí biểu đồ) — bắt buộc đánh dấu comment `/* ds-dynamic */` và giới hạn **tối đa `<= 15` vị trí toàn repo**.
4. **Emoji làm icon UI:** Cấm raw emoji (`📊`, `🔴`, `👥`, `⚡`, `✓`, `✕`, ...) trong nút, tiêu đề, tab, badge, empty state. Luôn dùng `<AppIcon name="..." />`.
5. **Dialog trình duyệt:** Cấm tuyệt đối `alert()`, `confirm()`, `prompt()`, `window.alert()`, `window.confirm()`, `window.prompt()`. Dùng `useToast()`, `useConfirm()`, `<PromptDialog>`.
6. **Box-in-box-in-box & Hero khổng lồ:** Không lồng khung viền 3 lớp, không dựng hero tối màu cao 300–500px đẩy toàn bộ dữ liệu/form xuống dưới nếp gấp mobile.
7. **CSS vi phạm vệ sinh:** Cấm CSS nén 1 dòng (`> 200` ký tự), cấm `!important` ngoài `@media print`/`.sr-only`, cấm `@media` ngoài 4 mốc `1280/1024/820/430`, cấm `z-index` số thô (`9999`, `1000`, ...).
8. **Chữ siêu nhỏ & zoom iOS:** Cấm nội dung đọc `< 12px`; cấm `input/select/textarea` `< 16px` trên mobile `<= 820px`.
9. **Nút mơ hồ & cạnh tranh CTA:** Không viết nhãn chung chung `"OK"`, `"Xử lý"`, `"Thực hiện"`; một vùng thao tác chỉ có **tối đa 1 nút `variant="primary"`**.

---

## 7. Kiểm Tra Tự Động — `scripts/design-lint.mjs` & Cổng Chất Lượng (G1–G7)

### Cách chạy

```bash
# Chế độ cảnh báo (Waves 1–3): in bảng điểm G1–G5 + thống kê từng file, luôn exit 0
node scripts/design-lint.mjs --warn

# Chế độ chặn CI (Wave 4 & phát triển mới): exit 1 ngay khi có bất kỳ vi phạm G1–G5 nào
node scripts/design-lint.mjs --strict

# Xem chi tiết số dòng vi phạm từng file hoặc xuất JSON cho CI
node scripts/design-lint.mjs --warn --verbose
node scripts/design-lint.mjs --warn --json
```

### Bảng Tiêu Chí Chấp Nhận (Exit Gates G1–G7)

| Cổng | Tiêu chí đo lường bắt buộc | Cơ chế kiểm tra |
|---|---|---|
| **G1. Color Token Purity** | `0` màu thô (`#hex`, `rgb()`, `rgba()`, `hsl()`) trong `02..04`, `styles/modules/*.css` và `.tsx` (`100%` qua token `01-tokens.css`; biểu đồ dùng `--chart-1..6`). | `scripts/design-lint.mjs --strict` |
| **G2. CSS Weight & Hygiene** | Tổng `styles/modules/*.css` `<= 35 KiB` & `<= 900` dòng · `0` dòng `> 200` ký tự · `0` `!important` (trừ `@media print`/`.sr-only`) · đúng 4 mốc `@media` (`1280/1024/820/430`) · `0` `z-index` số thô ngoài `01-tokens.css`. | `scripts/design-lint.mjs --strict` |
| **G3. Static Inline Styles** | `0` `style={{}}` tĩnh trong `.tsx`; chỉ cho phép `/* ds-dynamic */` cho hình học động, trần `<= 15` toàn repo. | `scripts/design-lint.mjs --strict` |
| **G4. Icons & Native Dialogs** | `0` emoji UI trong `.tsx`; `0` lời gọi `alert()`/`confirm()`/`prompt()` toàn repo. | `scripts/design-lint.mjs --strict` |
| **G5. Primitive Adoption** | `<PageHeader>` `36/36` trang in-shell (`Login` & `PurchaseFixModal` ngoại lệ); `0` KPI grid tự chế; `0` `.modal-backdrop` thô (100% `AppModal`/`DetailDrawer`); `0` toast tự chế (100% `useToast`); `<AppButton>` `>= 95%`; `<StatusBadge>` `>= 95%`; trang bất đồng bộ có `SkeletonBlock`/`TableSkeleton` & `EmptyState`. | `scripts/design-lint.mjs --strict` |
| **G6. Visual Ergonomics** | Trên `36` route × `3` viewport (`1440×900`, `390×844`, `360×800`): `0px` tràn ngang · `0` ảnh vỡ (`naturalWidth === 0`) · `0` tab/nút/topbar pill bị cắt · `PageHeader compact <= 88px` / `hero <= 140px` · dữ liệu/form bắt đầu trên nếp gấp (`y <= 420px` desktop, `<= 480px` mobile) · `input >= 16px` & touch target `>= 44×44px` mobile · Axe WCAG AA `0` lỗi critical/serious. | Playwright `design-system-audit.spec.ts` |
| **G7. Zero Regression** | `npx tsc --noEmit` + `npm --prefix frontend run build` PASS + toàn bộ 23 E2E spec hiện hữu PASS + `0` lỗi console + bảo toàn 36 route & 7 alias. | CI / Playwright |

---

## 8. Quy trình Tạo hoặc Refactor Màn Hình

1. **Chọn đúng Archetype (A1–A7)** ở Mục 4 và bọc trang bằng `<PageShell data-page="...">` + `<PageHeader variant="compact" />` (giữ chính xác tiêu đề tiếng Việt mà E2E đang kiểm tra).
2. **Lắp ghép từ 22 UI Primitives:** Dùng `KpiStrip`, `FilterBar`, `ActionBar`, `ResponsiveTabs`, `DataView` (+ `MobileCard`), `SectionCard`, `AppButton`, `StatusBadge`, `AppIcon`, `AppModal`/`DetailDrawer`, `useConfirm`, `useToast`, `SkeletonBlock`, `EmptyState`.
3. **Chỉ viết CSS vào đúng file `styles/modules/mod-*.css` của phân hệ** nếu layout thật sự cần (dùng 100% `var(--*)`, không tạo màu/radius/shadow/breakpoint mới).
4. **Thiết kế Desktop và Mobile song song:** Kiểm tra ngay ở `1440×900`, `390×844`, `360×800` (tên doanh nghiệp dài, số tiền lớn, trạng thái lỗi, rỗng, đang tải).
5. **Chạy đủ cổng xác minh trước khi hoàn tất:**
   ```bash
   cd frontend && npx tsc --noEmit && npm run build
   node scripts/design-lint.mjs --warn    # (hoặc --strict sau Wave 4)
   ```
   Và xác minh trực quan + Playwright (device emulation, `documentElement.scrollWidth === clientWidth`, mở/cuộn/đóng drawer, focus input không zoom).

Mọi thay đổi về token hoặc primitive dùng chung phải được cập nhật đồng bộ trong `frontend/src/styles/01-tokens.css`, `frontend/src/components/ui/index.ts` và tài liệu này.
