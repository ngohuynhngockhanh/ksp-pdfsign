# INUT/KSP Operations UI Design System

Tài liệu này là nguồn chuẩn khi tạo mới hoặc refactor giao diện CRM. Mục tiêu là
giữ toàn bộ sản phẩm cùng một ngôn ngữ hình ảnh, chạy tốt trên máy tính và iPhone,
đồng thời ưu tiên tốc độ xử lý nghiệp vụ hơn trang trí.

Nguồn triển khai thật:

- CSS chính: `frontend/src/styles.css`.
- Khung ứng dụng, menu và route: `frontend/src/App.tsx`.
- Viewport mobile: `frontend/index.html` phải giữ `viewport-fit=cover`.
- Màn hình tham chiếu tốt: `Operations.tsx`, `TaxReview.tsx`, `Settings.tsx`,
  `SaleDraft.tsx` và `CreateQuote.tsx`.

## 1. Tính cách thiết kế

Giao diện mang cảm giác **trung tâm vận hành doanh nghiệp Việt Nam**: chắc chắn,
ấm, sạch, có chiều sâu và đọc nhanh. Không dùng phong cách dashboard SaaS xanh/tím
trắng đại trà.

- Mực xanh đậm và teal diễn tả độ tin cậy, trạng thái đang hoạt động.
- Nền giấy ấm giúp tài liệu, hóa đơn và biểu mẫu bớt lạnh.
- Gold chỉ dành cho điểm nhấn quan trọng hoặc hành động nổi bật.
- Coral/đỏ dành cho lỗi, thiếu dữ liệu, thiếu PDF hoặc rủi ro cần xử lý.
- Heading dùng serif để tạo bản sắc; nội dung nghiệp vụ dùng sans-serif dễ đọc.
- Trang phải có một điểm nhấn rõ, nhưng dữ liệu luôn là nhân vật chính.

## 2. Token đang dùng

Token hiệu lực nằm trong khối `INUT Operations Design System` ở gần cuối
`styles.css`. Khối này chủ ý override bộ màu xanh cũ ở đầu file.

| Token | Giá trị | Vai trò |
|---|---:|---|
| `--ink` | `#102e2c` | Hero, sidebar, chữ tiêu đề rất đậm |
| `--primary` | `#157d72` | Hành động chính, focus, liên kết nghiệp vụ |
| `--primary-dark` | `#0f655d` | Hover/pressed |
| `--primary-soft` | `#e2f2ec` | Nền active, trạng thái nhẹ |
| `--paper` | `#f7f4ec` | Nền giấy ấm |
| `--panel` | `#fffefa` | Card/panel |
| `--bg` | `#eef3f0` | Nền ứng dụng |
| `--text` | `#173b38` | Chữ nội dung |
| `--muted` | `#6d7f7a` | Chú thích, metadata |
| `--border` | `#dce5e0` | Viền thường |
| `--border-strong` | `#c8d5cf` | Viền input/control |
| `--green` | `#23835f` | Thành công/đủ tồn |
| `--amber` | `#b87920` | Cần chú ý/chờ xử lý |
| `--coral` | `#d66048` | Thiếu dữ liệu/rủi ro |
| `--red` | `#c9533f` | Lỗi/xóa/nguy hiểm |
| `--gold` | `#dda044` | CTA đặc biệt/điểm nhấn thương hiệu |

Không hard-code màu mới nếu token hoặc biến thể hiện có đã diễn tả đúng ý nghĩa.
Màu trạng thái phải nhất quán: xanh lá không được dùng cho cảnh báo, đỏ không dùng
cho hành động bình thường.

## 3. Typography

- Nội dung/UI: `Inter` variable local, fallback `system-ui`.
- Heading lớn, tên khu vực và số liệu quan trọng: `Georgia, "Times New Roman", serif`.
- Heading serif dùng weight 500-600, không bold đen quá nặng.
- Eyebrow/kicker: 8-11px, uppercase, weight 800-900, letter-spacing `.14em-.18em`.
- Chữ phụ tối thiểu 9px trong desktop; nội dung chính tối thiểu 11-12px.
- Số tiền và số liệu dùng `font-variant-numeric: tabular-nums` khi cần so cột.
- Không viết toàn bộ đoạn văn in hoa. In hoa chỉ dùng cho nhãn ngắn.

## 4. Cấu trúc trang chuẩn

### App shell

- Topbar nền ink, cao khoảng 64px desktop và 54-58px mobile.
- Sidebar nền ink/teal, nhóm menu có kicker nhỏ và item active có vạch gold.
- Nội dung dùng `.docs-page`, `.page-1col`, `.page-2col`, `.signer`, `.verify`.
- Bề rộng trang nghiệp vụ tối đa khoảng 1420-1540px; không bó dashboard vào 1000px.

### Hero

Dùng hero cho trang quan trọng, không dùng cho mọi màn hình nhỏ:

- Nền gradient ink -> teal, có radial glow và vòng tròn trang trí nhẹ.
- Heading serif `clamp(29px, 3-4vw, 49-54px)`.
- CTA chính nằm bên phải desktop, xuống full-width trên mobile.
- Hero chỉ chứa tên quy trình, mô tả ngắn và 1-2 hành động cấp cao.

Mẫu: `.ops-hero`, `.tax-studio-hero`, `.settings-hero`, `.sale-draft-hero`.

### Panel và card

- Panel trắng ấm, border rất nhẹ, radius 14-20px, shadow teal loãng.
- Card thống kê có một accent cạnh trái hoặc cạnh dưới; không tô cả card bằng màu gắt.
- Header card gồm icon, kicker, title, mô tả và trạng thái nếu cần.
- Khoảng cách panel desktop 18-24px; mobile 12-16px.

## 5. Component nghiệp vụ

### Nút

- Primary: gradient teal, dùng cho hành động hoàn tất/tạo/lưu.
- Secondary: nền trắng hoặc mint nhạt, viền teal nhẹ.
- Gold CTA: chỉ dùng cho một hành động nổi bật trong hero.
- Danger: coral/đỏ, bắt buộc tên hành động rõ ràng.
- Touch target mobile tối thiểu 42px; nút icon tối thiểu 36x36px.
- Một vùng không nên có nhiều hơn một primary button cạnh tranh nhau.

### Form

- Label nằm trên input, ngắn và cụ thể.
- Mobile luôn để `font-size: 16px` cho `input/select/textarea` để iOS không tự zoom.
- Trường thiếu bắt buộc dùng `.field-missing`, kèm câu giải thích; không chỉ đổi màu.
- Form dài chia thành section có số thứ tự/kicker và heading.
- Nếu người dùng thường paste dữ liệu, dùng `SmartPartyPaste` thay vì bắt nhập từng ô.
- Biểu mẫu liên quan kho phải hiển thị mã hàng, đơn vị tính và tồn tại ngày nghiệp vụ.
- Không tự thay số lượng người dùng đã nhập khi “Sync từ kho”.

### Bảng desktop

- Luôn bọc trong `.table-wrap`.
- Header nhỏ, uppercase; body ưu tiên quét ngang nhanh.
- Tên dài phải `overflow-wrap:anywhere` hoặc ellipsis có `title`/cách xem đầy đủ.
- Số tiền căn phải; thời gian không xuống dòng nếu đủ chỗ.
- Hành động thường xuyên hiển thị trực tiếp; hành động hiếm gom menu.

### Bảng mobile

Không mặc định ép mọi bảng thành card. Chọn theo nghiệp vụ:

1. Bảng cần so sánh nhiều cột: giữ bảng và cuộn ngang có momentum.
2. Danh sách tác vụ/hóa đơn ngắn: chuyển từng hàng thành card compact.
3. Card mobile phải ngắn; bỏ nhãn lặp hiển nhiên, không phóng tên công ty bằng heading lớn.
4. Dùng `data-label` cho các ô cần nhãn sau khi ẩn `thead`.
5. Ba bản ghi phổ biến nên xem được trong vài lần vuốt, không tạo card cao gần màn hình.

`SaleDraft.tsx` + `.ihd-draft-table` là ví dụ bảng chuyển sang card compact.

### Trạng thái và cảnh báo

- Success: xanh lá, nội dung “đã/đủ/thành công”.
- Warning: amber, nội dung “chờ/chưa kiểm tra/cần xác nhận”.
- Critical: coral/đỏ, nội dung “thiếu/sai/không đủ/thất bại”.
- Thiếu PDF cần nổi bật và có nút upload bù ngay tại vị trí xử lý.
- Animation blink chỉ dành cho lỗi đang chờ người dùng; phải tắt qua
  `prefers-reduced-motion`.
- Thông báo phải nói rõ hậu quả và bước tiếp theo, không dùng “Có lỗi xảy ra” chung chung.

### Empty/loading/error

- Loading dùng skeleton hoặc câu mô tả chính xác đang tải gì.
- Empty state nói vì sao rỗng và có CTA phù hợp.
- Error đặt gần thao tác gây lỗi; không xóa dữ liệu form đã nhập.
- Sync bên ngoài phải hiện lần chạy cuối, trạng thái và nút thử lại.

## 6. Responsive contract

Các breakpoint chuẩn đang dùng:

- `1180px`: sidebar/page padding gọn hơn, layout 2 cột lớn có thể về 1 cột.
- `820px`: chuyển sang menu drawer, topbar mobile, modal dạng bottom sheet.
- `560-650px`: form/grid về 1 cột, toolbar xếp dọc, touch target lớn hơn.
- `430px`: tinh chỉnh riêng điện thoại hẹp như iPhone 11 Pro Max ở CSS viewport 414px.

Quy tắc bắt buộc:

- Hỗ trợ tối thiểu CSS viewport 320px.
- Không có horizontal overflow ở `documentElement`.
- Sidebar mobile dùng `100dvh` (có fallback `100vh`), `overflow-y:scroll`,
  `-webkit-overflow-scrolling:touch`, safe-area bottom và `touch-action:pan-y`.
- Padding topbar dùng `env(safe-area-inset-left/right)` trên màn hẹp.
- Thành phần sticky phải kiểm tra không che nội dung khi Safari thu/phóng thanh địa chỉ.
- Modal mobile không cao quá `94vh` và phần action nên sticky ở đáy modal.
- Tránh `width:100vw` trong vùng có scrollbar; ưu tiên `width:100%` và `min-width:0`.
- Grid/flex child chứa tên dài phải có `min-width:0`.

## 7. Motion và accessibility

- Transition 150-220ms; chỉ animate opacity, transform, màu và shadow.
- Không dùng animation liên tục cho trang trí.
- Tôn trọng `prefers-reduced-motion`.
- Focus dùng `--ring`; không xóa outline mà không có thay thế.
- Contrast nội dung chính phải đủ rõ trên nền giấy.
- Nút icon cần `aria-label`; icon trang trí dùng `aria-hidden="true"`.
- Không truyền đạt trạng thái chỉ bằng màu; luôn có chữ hoặc icon đi kèm.

## 8. Quy tắc triển khai CSS

- Đây là CSS thuần, không thêm UI framework nếu không có quyết định kiến trúc riêng.
- Tái sử dụng class nền tảng trước khi tạo class mới.
- CSS riêng của trang đặt thành một khối có comment, desktop trước rồi breakpoint ngay sau.
- Tránh inline style cho layout lặp lại; chuyển thành class có tên theo nghiệp vụ.
- Selector không nên phụ thuộc sâu vào cấu trúc DOM; ưu tiên class rõ nghĩa.
- Không dùng `!important` trừ override trạng thái/bảng mobile mà specificity cũ khó tránh.
- Khi thêm token mới, cập nhật bảng token trong tài liệu này.
- Không sửa khối token xanh cũ để đổi giao diện mới; token hiệu lực là khối INUT ở cuối.
  Về sau có thể dọn khối cũ trong một refactor CSS riêng có kiểm thử toàn app.

## 9. Anti-pattern cần tránh

- Nền trắng phẳng + card giống nhau trên mọi trang.
- Purple gradient, glassmorphism dày hoặc icon emoji lộn xộn.
- Heading quá lớn trong card dữ liệu, đặc biệt tên doanh nghiệp dài.
- Desktop table bị nén đến mức mỗi chữ xuống một dòng trên mobile.
- Card mobile có quá nhiều khoảng trắng hoặc lặp nhãn không cần thiết.
- Font dưới 16px trong input mobile gây Safari zoom.
- Nút chỉ ghi “OK”, “Xử lý”, “Thực hiện” mà không nói hành động.
- Sticky bar che input/action hoặc menu drawer không cuộn được.
- Chỉ kiểm tra bằng cách thu nhỏ cửa sổ desktop; phải chạy device emulation.

## 10. Checklist trước khi hoàn tất UI

### Nghiệp vụ

- [ ] Hành động chính và trạng thái hiện tại nhìn thấy trong 3 giây.
- [ ] Lỗi/cảnh báo có hướng xử lý cụ thể.
- [ ] Dữ liệu dài, rỗng, bằng 0 và số tiền lớn đều hiển thị đúng.
- [ ] Form không mất dữ liệu khi API lỗi.
- [ ] Luồng kho hiển thị tồn và đơn vị tính tại đúng ngày cần kiểm tra.

### Desktop

- [ ] Kiểm tra ở 1440x900 và khoảng 1024px.
- [ ] Không có nội dung tràn khỏi panel/grid.
- [ ] Bảng, toolbar và sticky action không che nhau.

### Mobile

- [ ] Kiểm tra iPhone 11 Pro Max: 414px CSS width, DPR 3.
- [ ] Kiểm tra thêm 390px và tối thiểu 320px.
- [ ] `document.documentElement.scrollWidth === clientWidth`.
- [ ] Menu mở, vuốt tới “Cài đặt”, đóng bằng backdrop được.
- [ ] Input focus không zoom trang.
- [ ] Nút chạm >= 42px và không sát mép safe-area.
- [ ] Tên doanh nghiệp dài xuống dòng hợp lý, không làm card quá cao.

### Chất lượng

- [ ] `npm --prefix frontend run build` thành công.
- [ ] `git diff --check` thành công.
- [ ] Kiểm tra screenshot hoặc trực tiếp bằng Playwright device emulation.
- [ ] Kiểm tra `prefers-reduced-motion` nếu có animation.
- [ ] Không commit secret, ảnh debug hoặc dữ liệu khách hàng dùng để test.

## 11. Mẫu kiểm thử Playwright

Project không cài Playwright trong frontend; máy triển khai hiện có thể dùng package ở
`/home/ksp/inut-ffmpeg-service/node_modules/playwright`. Khi môi trường thay đổi, dùng
Playwright sẵn có của hệ thống hoặc cài dev dependency theo quyết định của dự án.

Các assertion tối thiểu cho mobile:

```js
const context = await browser.newContext({ ...devices["iPhone 11 Pro Max"] });
const page = await context.newPage();
await page.goto(url, { waitUntil: "networkidle" });

const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
if (overflow !== 0) throw new Error(`Horizontal overflow: ${overflow}px`);

await page.locator(".hamburger").click();
const sidebar = page.locator(".sidebar");
await sidebar.evaluate((el) => { el.scrollTop = el.scrollHeight; });
const scrollTop = await sidebar.evaluate((el) => el.scrollTop);
if (scrollTop <= 0) throw new Error("Mobile sidebar cannot scroll");
```

Không lưu JWT, mật khẩu hoặc cookie production vào script/test fixture.

## 12. Quy trình tạo một màn hình mới

1. Xác định công việc chính, dữ liệu cần quét và rủi ro nghiệp vụ.
2. Chọn page shell hiện có; không tự tạo canvas/layout mới nếu không cần.
3. Phác hierarchy: hero/toolbar -> trạng thái -> nội dung chính -> hành động.
4. Dùng token và component hiện có; chỉ thêm pattern mới khi có lý do rõ.
5. Làm desktop và mobile cùng lúc, không để responsive đến cuối.
6. Test dữ liệu thật có tên dài, số tiền lớn, trạng thái lỗi và danh sách rỗng.
7. Build, diff check, device emulation rồi mới deploy.

Khi một quyết định UI mới được áp dụng ở nhiều màn hình, cập nhật tài liệu này trong
cùng commit để những lần refactor sau không làm mất ngôn ngữ thiết kế hiện tại.
