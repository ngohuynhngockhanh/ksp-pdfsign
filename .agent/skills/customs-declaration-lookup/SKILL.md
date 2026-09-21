---
name: customs-declaration-lookup
description: Tự động tra cứu thông tin tờ khai Hải quan trực tuyến từ Cổng thông tin Tổng cục Hải quan (customs.gov.vn), giải mã Captcha tự động và đối soát tình trạng phân luồng, thuế nợ/đã nộp theo số tờ khai hoặc tên bộ hồ sơ KSP.
---

# 🔍 KSP Customs Declaration Lookup (Tra Cứu Thông Tin Tờ Khai Hải Quan)

Skill này cung cấp khả năng tự động hóa 100% quy trình tra cứu thông tin tờ khai xuất nhập khẩu trực tiếp từ **Cổng thông tin điện tử Tổng cục Hải quan Việt Nam**.

## 🌐 Cổng dịch vụ Hải quan
- **URL tra cứu**: `https://www.customs.gov.vn/index.jsp?pageId=136&cid=93`
- **Dịch vụ SOAP nội bộ**:
  - Tra cứu thông tin tờ khai & nợ thuế: `/bridge?url=/customs/presentation/soapclient/TracuuTTTK`
  - Tra cứu phân công người kiểm tra & trạng thái: `/bridge?url=/customs/presentation/soapclient/PhanCongKiemTraTK`
---

## 📌 Các tham số định danh chuẩn (INUT JSC)
1. **Số tờ khai (`sotk`)**:
   - 12 chữ số theo chuẩn VNACCS (ví dụ: `108625440120`).
   - Có thể chỉ định trực tiếp số tờ khai HOẶC chỉ định tên bộ hồ sơ trên Google Drive / KSP (ví dụ: `"màn hình về sản xuất"`).
2. **Mã số doanh nghiệp (`madn`)**:
   - Mặc định: `4401053694` (Công ty Cổ phần Đầu tư và Phát triển Công nghệ INUT).
   - Hoặc lấy động theo mã số thuế trên tờ khai nhập khẩu đã lưu trong CSDL.
3. **Số chứng minh thư / CCCD người đại diện pháp luật (`socmt`)**:
   - **Hằng số tĩnh luôn sử dụng**: `054096010424` (CCCD của Người đại diện theo pháp luật: Ngô Huỳnh Ngọc Khánh).
   - Đã được lưu cố định trong hồ sơ pháp lý doanh nghiệp (`COMPANY_PROFILE.md`).

---

## ⚙️ Quy trình xử lý tự động
1. **Nhận diện yêu cầu tra cứu**:
   - Hỏi người dùng **Số tờ khai hải quan (12 số)** hoặc **Tên bộ hồ sơ nhập khẩu** (ví dụ: "màn hình về sản xuất", "Rk3518 emcp",...).
   - Nếu cung cấp tên bộ hồ sơ: Hệ thống tự động truy vấn CSDL KSP (`inv_customs_drive_folders` & `inv_customs_decls`) để lấy số tờ khai 12 số tương ứng.
2. **Khởi tạo phiên & Vượt Captcha tự động**:
   - Khởi tạo session HTTP lấy cookie `JSESSIONID` từ `https://www.customs.gov.vn/index.jsp?pageId=136&cid=93`.
   - Gửi yêu cầu `POST /Captcha` để lấy ảnh Captcha định dạng Base64.
   - Giải mã tự động bằng thư viện `ddddocr` (tỷ lệ chính xác cao, tự động thử lại tối đa 5 lần nếu Captcha không hợp lệ).
3. **Gửi truy vấn tra cứu**:
   - Gửi payload JSON tới `/bridge?url=/customs/presentation/soapclient/TracuuTTTK`.
   - Gửi tiếp truy vấn phân công cán bộ xử lý tới `/bridge?url=/customs/presentation/soapclient/PhanCongKiemTraTK` với `{ "sotk": so_to_khai[:11], "mst": ma_doanh_nghiep, "ngaydk": YYYYMMDD }`.
4. **Trích xuất & Định dạng kết quả**:
   - **Thông tin tờ khai**: Số tờ khai, Phân luồng (Luồng Xanh / Vàng / Đỏ), Tên loại hình (A11, A12,...), Cơ quan Hải quan tiếp nhận, Ngày đăng ký, Ngày thông quan, Ngày qua khu vực giám sát.
   - **Chi tiết nợ thuế**: Loại thuế (Thuế XNK, Thuế GTGT), Tài khoản nộp ngân sách, Số tiền đã nộp, Số tiền phải nộp, Số tiền còn nợ.
   - **Thông tin người kiểm tra & Trạng thái xử lý**:
     - **Trạng thái xử lý**: Trạng thái tác nghiệp của cơ quan Hải quan (ví dụ: *Đang xử lý*, *Đã hoàn thành kiểm tra*,...).
     - **Công chức kiểm tra hồ sơ**: Họ tên công chức hải quan phụ trách kiểm tra bộ hồ sơ tờ khai (ví dụ: *Lê Văn Hải*).
     - **Công chức kiểm tra hàng hóa**: Họ tên công chức phụ trách kiểm hóa thực tế (nếu luồng đỏ).
     - **Thời gian hiển thị**: Mốc thời gian hệ thống ghi nhận trạng thái phân công.
---

## 🚀 Cách sử dụng từ Python SDK / Codebase
```python
from app.db import get_session
from app.customs_declaration_lookup import lookup_customs_declaration, lookup_declaration_by_ref

# Cách 1: Tra cứu trực tiếp theo số tờ khai (12 số)
result = lookup_customs_declaration(
    so_to_khai="108625440120",
    ma_doanh_nghiep="4401053694",
    so_cmt="054096010424",
)
print("Kết quả tra cứu:", result)

# Cách 2: Tra cứu thông minh theo tên bộ hồ sơ hoặc ref
for db in get_session():
    # Tự động tìm bộ hồ sơ "màn hình về sản xuất" -> số tờ khai 108625440120
    info = lookup_declaration_by_ref(db, "màn hình về sản xuất")
    print(f"Tờ khai: {info['so_to_khai']} - Luồng: {info['phan_luong']}")
    print(f"Thuế đã nộp: {info['thue']['da_nop']:,} VNĐ")
    print(f"Trạng thái xử lý: {info['nguoi_kiem_tra']['trang_thai_xu_ly']}")
    print(f"Công chức kiểm tra hồ sơ: {info['nguoi_kiem_tra']['cong_chuc_kiem_tra_ho_so']}")

---

## 📡 REST API Endpoints
- `POST /api/inv/customs-drive/lookup-customs-portal`:
  - Body: `{"ref": "màn hình về sản xuất"}` (hoặc `{"ref": "108625440120"}`)
- `GET /api/inv/customs-drive/declarations/{decl_id}/lookup-customs-portal`:
  - Tra cứu theo ID tờ khai trong CSDL KSP.
- `GET /api/inv/customs-drive/folders/{folder_id}/lookup-customs-portal`:
  - Tra cứu theo ID folder hồ sơ trên Google Drive.
