"""Thông tin pháp lý và định danh doanh nghiệp chuẩn của INUT JSC.

Nguồn sự thật tối cao (Single Source of Truth):
- /home/ksp/ksp-pdfsign/backend/app/COMPANY_PROFILE.md
- Cổng Thông tin Quốc gia về Đăng ký Doanh nghiệp & Tổng cục Thuế (MST: 4401053694)
- Thuế cơ sở 7 tỉnh Đắk Lắk (trụ sở Phường Tuy Hòa)
"""

from dataclasses import dataclass
from typing import Dict, Any

@dataclass(frozen=True)
class CompanyProfile:
    # 1. Thông tin chung
    name_vi: str = "CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT"
    name_en: str = "INUT TECHNOLOGY DEVELOPMENT AND INVESTMENT JOINT STOCK COMPANY"
    short_name: str = "INUT JSC"
    tax_code: str = "4401053694"
    legal_type: str = "Công ty Cổ phần"
    founded_date: str = "10/08/2018"
    
    # 2. Địa chỉ & Liên hệ (Đắk Lắk)
    address: str = "161 Trường Chinh, Phường Tuy Hòa, Tỉnh Đắk Lắk, Việt Nam"
    province: str = "Đắk Lắk"
    tax_authority: str = "Thuế cơ sở 7 tỉnh Đắk Lắk"
    phone: str = "0972 768 491"
    email: str = "khanhnhn@inut.vn"
    email_support: str = "support@inut.vn"
    website: str = "https://inut.vn"
    portal_url: str = "https://ksp-pdf-signer.p2p.inut.io.vn"
    default_location: str = "Đắk Lắk"

    # 3. Đại diện pháp luật
    representative: str = "NGÔ HUỲNH NGỌC KHÁNH"
    representative_title: str = "Tổng Giám Đốc"
    id_card_number: str = "054096010424"

    # 4. Tài khoản ngân hàng công ty duy nhất (CẤM ghi TK cá nhân)
    bank_account_name: str = "CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT"
    bank_account_number: str = "79713"
    bank_name: str = "Techcombank - Ngân hàng TMCP Kỹ Thương Việt Nam"

    # 5. Chữ ký số
    ca_provider: str = "WIN-CA"
    ca_token_pin: str = "12345678"

    def get_header_html(self, subtitle: str = "Trung tâm Giám sát Vận hành Năng lượng Tái tạo iNut Solar") -> str:
        """Sinh khối Header thương hiệu iNut JSC chuẩn cho báo cáo kỹ thuật."""
        return f"""<div class="org-title">{self.name_vi}</div>
<div class="org-subtitle">
    Mã số thuế: {self.tax_code} &nbsp;|&nbsp; {subtitle}<br>
    Trụ sở chính: {self.address}<br>
    Hotline: {self.phone} &nbsp;|&nbsp; Email: {self.email} &nbsp;|&nbsp; Web: {self.website}
</div>"""

    def get_footer_info(self) -> str:
        """Chuỗi footer ngắn gọn cho trang in."""
        return f"{self.short_name} · MST: {self.tax_code} · Trụ sở: {self.province} · {self.website}"


INUT_PROFILE = CompanyProfile()
