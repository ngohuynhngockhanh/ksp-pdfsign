---
name: customs-email-composer
description: Tự động soạn thảo email phản hồi Thông báo hàng đến (TBHD) / Hồ sơ thông quan Hải quan gửi các hãng chuyển phát quốc tế (UPS, FedEx, DHL) kèm danh sách 4 file đính kèm chuẩn (Mã vạch, Tờ khai luồng xanh, Giấy nộp thuế GTGT, Giấy nộp phí tờ khai hải quan), định dạng sẵn sàng để copy & paste không kèm chữ ký thừa.
---

# ✉️ KSP Customs Email Composer (Soạn Email Phản Hồi Hồ Sơ Thông Quan)

Skill này hỗ trợ tự động trích xuất thông tin tờ khai, vận đơn (AWB) và số tiền thuế/phí để tạo mẫu email phản hồi Thông báo hàng đến (TBHD) gửi đến các hãng vận chuyển / đại lý hải quan (**UPS, FedEx, DHL, EMS**) một cách chuyên nghiệp, chính xác và sẵn sàng để Copy & Paste ngay vào Gmail mà không bị trùng lặp chữ ký.

## 📦 Bộ 4 file chứng từ tiêu chuẩn đính kèm
1. **Tờ khai Hải quan thông quan** (Luồng Xanh / Thông quan - định dạng PDF hoặc XML/XLSX).
2. **Bảng kê Mã vạch phương tiện chứa hàng** (Customs Barcode - xuất từ pus1.customs.gov.vn khổ A4 chuẩn).
3. **Giấy nộp tiền vào Ngân sách Nhà nước - Thuế GTGT hàng nhập khẩu** (hoặc Thuế NK nếu có).
4. **Giấy nộp tiền vào Ngân sách Nhà nước - Lệ phí Hải quan (Phí tờ khai - 20.000 VNĐ)**.

## 📝 Cấu trúc mẫu Email chuẩn (Chuẩn Doanh nghiệp INUT JSC)

### 📌 Tiêu đề email (Subject):
`Re: [TBHD] AWB: {so_van_don_awb} - CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT - Gửi Hồ sơ thông quan & Giấy nộp thuế`

### 📋 Nội dung (Body):
```text
Kính gửi: Bộ phận Thủ tục Hải quan & Giao nhận {hang_van_chuyen},

Liên quan đến Thông báo hàng đến cho lô hàng theo Vận đơn AWB: {so_van_don_awb}, 
Công ty Cổ phần Đầu tư và Phát triển Công nghệ INUT (MST: 4401053694) xin gửi đến Quý công ty bộ hồ sơ hải quan đã thông quan luồng xanh để hoàn tất thủ tục giao hàng, bao gồm:

1. Tờ khai Hải quan luồng xanh (Số TK: {so_to_khai}, đăng ký ngày {ngay_dang_ky}).
2. Bảng kê Mã vạch phương tiện chứa hàng (Customs Barcode).
3. Giấy nộp tiền vào Ngân sách Nhà nước - Thuế GTGT hàng nhập khẩu ({so_tien_vat} VND).
4. Giấy nộp tiền vào Ngân sách Nhà nước - Lệ phí Hải quan / Phí tờ khai ({so_tien_phi} VND).

Kính đề nghị Quý công ty kiểm tra, giải tỏa hàng trên hệ thống và tiến hành giao hàng đến địa chỉ công ty theo thông tin trên vận đơn.

Trân trọng cảm ơn sự hỗ trợ của Quý công ty!
```

> [!NOTE]
> Không bao gồm chữ ký ở cuối email vì tài khoản Gmail đã có cài đặt sẵn chữ ký tự động.
