# Original User Request

## 2026-08-22T11:01:30Z

Triển khai toàn diện Phân hệ Tra Cứu & Săn Gói Thầu Mua Sắm Công (Mạng Đấu Thầu Quốc Gia - muasamcong.mpi.gov.vn) trong KSP.

Working directory: /home/ksp/ksp-pdfsign

## 1. Backend Architecture & Database Models
1. Bổ sung các bảng cơ sở dữ liệu trong `backend/app/db.py`:
   - `BiddingBookmark`: Lưu trữ gói thầu quan tâm (`id`, `tbmt_code`, `tender_name`, `procuring_entity`, `investor`, `field`, `bid_price`, `bid_deadline`, `province`, `source_url`, `status`: 'watching'|'preparing'|'submitted'|'won'|'lost', `note`, `ai_summary`, `created_at`, `updated_at`).
   - `BiddingWatchlist`: Lưu trữ quy tắc theo dõi tự động (`id`, `name`, `keyword`, `province`, `field`, `min_price`, `max_price`, `method`, `notify_telegram`, `is_active`, `last_checked_at`, `created_at`).
2. Xây dựng module nghiệp vụ `backend/app/bidding.py`:
   - Kết nối và tra cứu dữ liệu từ Mạng Đấu thầu Quốc gia (`muasamcong.mpi.gov.vn` - e-GP public API endpoint: e.g. `https://muasamcong.mpi.gov.vn/eprocurement/services/landing/p/general/contractor-selection/contract-notice` hoặc tương đương kèm header eprocurement, User-Agent, cookie, và cơ chế fallback mock/cache thông minh để luôn mượt mà khi mạng ngoài chập chờn).
   - Hàm `search_muasamcong_tenders(...)`: Hỗ trợ từ khóa, tỉnh thành, lĩnh vực (Hàng hóa, Xây lắp, Tư vấn, Phi tư vấn, Hỗn hợp), khoảng giá, hình thức thầu, phân trang.
   - Hàm `get_tender_details(...)`: Lấy chi tiết thông tin gói thầu.
   - Hàm `ai_analyze_tender(...)`: Sử dụng AI local/endpoint (`backend/app/ai.py`) để trích xuất tóm tắt yêu cầu năng lực, doanh thu, thời hạn và phân tích độ phù hợp với năng lực INUT.
   - Hàm `run_watchlist_scan(db)`: Quét tự động các gói thầu mới theo watchlist và gửi cảnh báo qua Telegram (qua cấu hình Telegram bot trong KSP).
   - Quản lý Bookmark và Watchlist (CRUD).
3. Xây dựng Schemas (`backend/app/schemas.py`) và Router API (`backend/app/bidding_api.py`):
   - `GET /api/bidding/search`
   - `GET /api/bidding/tenders/{tbmt_code}`
   - `POST /api/bidding/tenders/{tbmt_code}/analyze-ai`
   - `GET/POST/PUT/DELETE /api/bidding/bookmarks`
   - `GET/POST/PUT/DELETE /api/bidding/watchlist`
   - `POST /api/bidding/watchlist/{id}/scan`
4. Đăng ký router trong `backend/app/main.py`.

## 2. Frontend Integration & UI/UX
1. Bổ sung API client trong `frontend/src/api.ts` cho phân hệ Đấu thầu.
2. Xây dựng trang `frontend/src/pages/BiddingProcurement.tsx`:
   - Tab 1: **🔎 Tra Cứu Gói Thầu**: Search box lớn, bộ lọc nâng cao (Tỉnh thành, Lĩnh vực, Mức giá, Trạng thái đóng thầu, Hình thức), danh sách card gói thầu trực quan với badge trạng thái, giá gói thầu format VND, nút "⭐ Lưu theo dõi", nút "🧠 AI Phân tích", nút "🔗 Xem trên Mua Sắm Công".
   - Tab 2: **⭐ Gói Thầu Quan Tâm**: Pipeline quản lý cơ hội dự thầu, lọc theo trạng thái (Đang theo dõi, Chuẩn bị hồ sơ, Đã nộp thầu, Trúng thầu, Trượt thầu), ghi chú nội bộ, xem kết quả AI phân tích.
   - Tab 3: **⚙️ Bộ Lọc Tự Động (Watchlist & Cảnh Báo)**: Danh sách luật quét tự động, bật/tắt nhận tin Telegram, nút bấm quét ngay.
   - Modal hiển thị chi tiết gói thầu & kết quả AI phân tích.
   - Tuân thủ INUT Operations UI Design System (màu sắc sắc nét, responsive mobile iPhone 414px, input form 16px).
3. Đăng ký route và sidebar navigation `🏛️ Đấu Thầu (Mua Sắm Công)` trong `frontend/src/App.tsx`.

## 3. Testing & Documentation
1. Viết bài kiểm thử `backend/tests/test_bidding.py` kiểm tra 100% chức năng (tra cứu, bookmark, watchlist, AI analyze, API endpoints).
2. Chạy `pytest` bảo đảm 100% test pass.
3. Chạy `npm --prefix frontend run build` bảo đảm 0 lỗi TypeScript/Vite.
4. Cập nhật Mục 12 trong Cẩm nang Tri thức `gemini.md`.

## 2026-08-24T14:17:45Z

<USER_REQUEST>
Nghiên cứu sâu hạ tầng kỹ thuật hiện có và phát triển giải pháp tra cứu Quy chuẩn Kỹ thuật Quốc gia (QCVN) / Tiêu chuẩn áp dụng theo hai chiều: từ Model/mã sản phẩm ra QCVN bắt buộc và từ Mã số thuế (MST)/Tên công ty ra danh mục hồ sơ hợp quy và QCVN liên quan.

Working directory: /home/ksp/ksp-pdfsign
Integrity mode: development

Tham chiếu hệ thống hiện tại:
- Module nghiệp vụ: backend/app/standards.py, backend/app/standards_api.py
- Test suite liên quan: backend/tests/test_standards.py

## Requirements

### R1. Khảo sát & Đánh giá Hạ tầng Dữ liệu Hiện có
- Khảo sát toàn diện mô hình dữ liệu, cơ chế lưu trữ và logic xử lý của hệ thống Standards / TQC hiện hữu trong codebase (backend/app/standards.py, backend/app/standards_api.py).
- Rà soát các nguồn dữ liệu bên ngoài (Cổng thông tin QCVN/TCVN, Cục Viễn thông, Tổng cục Đo lường Chất lượng, Hải quan) để xác định khả năng liên kết và đồng bộ dữ liệu.

### R2. Thiết kế Kiến trúc Tra cứu 2 Chiều & Schema Chuẩn hóa
- Thiết kế mô hình dữ liệu (Schema) và cơ chế chỉ mục / tra cứu tối ưu hỗ trợ:
  1. Tra cứu theo Model / Tên hàng hóa / Từ khóa kỹ thuật -> Trả về danh sách QCVN/TCVN bắt buộc hoặc khuyến nghị, kèm căn cứ pháp lý.
  2. Tra cứu theo Mã số thuế (MST) / Tên doanh nghiệp -> Trả về danh sách sản phẩm, hồ sơ chứng nhận, hợp quy và các QCVN doanh nghiệp đã đăng ký/tuân thủ.
- Thiết kế RESTful API endpoints chuẩn hóa cho tính năng tra cứu, bao gồm cơ chế lọc, phân trang, gợi ý từ khóa (auto-complete) và tìm kiếm mờ (fuzzy / partial match).

### R3. Xây dựng PoC Thực nghiệm & Kịch bản Kiểm thử
- Hiện thực hóa một bản PoC (Proof of Concept) tra cứu với tập dữ liệu mẫu thực tế của các thiết bị viễn thông, CNTT, điện tử tiêu biểu (hoặc hồ sơ doanh nghiệp mẫu).
- Xây dựng kịch bản kiểm thử tự động (Automated Test Suite) để đo lường độ chính xác và tốc độ phản hồi của các truy vấn tra cứu theo Model và theo MST.

### R4. Báo cáo Nghiên cứu & Lộ trình Triển khai Production
- Lập tài liệu phân tích kỹ thuật (Research & Architecture Report) chi tiết: ưu/nhược điểm các phương án tiếp cận (FTS SQLite / Postgres, Semantic Search, Rule-based Sync), chiến lược thu thập/làm sạch dữ liệu tự động, và lộ trình tích hợp vào hệ thống hiện tại.

## Acceptance Criteria

### Tài liệu Nghiên cứu & Đặc tả Kiến trúc
- [ ] Báo cáo đánh giá hiện trạng module Standards/TQC và phân tích tính khả thi của các nguồn dữ liệu đồng bộ.
- [ ] Tài liệu đặc tả API và Schema dữ liệu cho cả 2 luồng tra cứu (Model -> QCVN và MST -> QCVN/Hồ sơ).

### Triển khai PoC & Kiểm thử Khả thi
- [ ] PoC tra cứu hoạt động thành công với tập dữ liệu mẫu, hỗ trợ tìm kiếm chính xác và tìm kiếm mờ.
- [ ] Test suite tự động thực thi vượt qua 100% các ca kiểm thử: tra cứu Model trả về đúng QCVN, tra cứu MST trả về đúng danh mục hồ sơ và QCVN liên quan.
- [ ] Đề xuất lộ trình tích hợp (Integration Roadmap) rõ ràng cho giai đoạn chuyển giao sang Production.
</USER_REQUEST>
