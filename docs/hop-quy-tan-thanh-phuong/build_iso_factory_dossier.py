#!/usr/bin/env python3
"""Generate streamlined, audit-safe 4-page A4 PDF for Tan Thanh Phuong's VNMAP AI ONE Factory Production & QC Dossier (ISO 9001:2015 & ISO/IEC 27001:2022):
Ho-So-Quy-Trinh-San-Xuat-Nha-May-ISO-VNMAP-AI-ONE-Tan-Thanh-Phuong.pdf
Streamlined Lean ISO edition:
- Simplest practical factory execution while 100% compliant with ISO 9001:2015 & ISO/IEC 27001:2022
- Order-based production (screen 21.5/22/27/32/43/51 inch, reader Contact/Hanel/VeriBOX S, scanner camera >=11MP, power 24V/19V/15V/5VDC)
- Single device ID / Serial rule: inut_x_y (e.g. inut_207_203) affixed to each unit for full traceability & warranty journey
- Only 01 calibrated instrument required (Digital Multimeter VOM), practical Pass/Fail checklists, 3 consolidated forms
"""

from __future__ import annotations

import base64
from pathlib import Path
import weasyprint

BASE_DIR = Path(__file__).resolve().parent
LOGO_PATH = BASE_DIR / "refs" / "vnmap_logo.png"
LOGO_B64 = base64.b64encode(LOGO_PATH.read_bytes()).decode("ascii") if LOGO_PATH.exists() else ""
LOGO_URI = f"data:image/png;base64,{LOGO_B64}" if LOGO_B64 else ""

COMMON_CSS = """
@page {
  size: A4 portrait;
  margin: 10mm 11mm 12mm 11mm;
  @bottom-left {
    content: string(doc_footer_left);
    font-family: 'DejaVu Sans', 'Liberation Sans', sans-serif;
    font-size: 7.2pt;
    color: #64748b;
  }
  @bottom-right {
    content: "Trang " counter(page) " / " counter(pages);
    font-family: 'DejaVu Sans', 'Liberation Sans', sans-serif;
    font-size: 7.5pt;
    font-weight: bold;
    color: #334155;
  }
}

* {
  box-sizing: border-box;
}

body {
  font-family: 'DejaVu Sans', 'Liberation Sans', sans-serif;
  font-size: 7.75pt;
  line-height: 1.24;
  color: #1e293b;
  margin: 0;
  padding: 0;
}

.footer-str {
  string-set: doc_footer_left content();
  display: none;
}

.doc-banner {
  border: 2px solid #0f294a;
  border-radius: 5px;
  padding: 8px 10px;
  background: linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%);
  margin-bottom: 6px;
}

.doc-banner-top {
  display: table;
  width: 100%;
  border-bottom: 1.5px solid #cbd5e1;
  padding-bottom: 6px;
  margin-bottom: 6px;
}

.doc-banner-logo {
  display: table-cell;
  width: 138px;
  vertical-align: middle;
}

.doc-banner-logo img {
  max-width: 128px;
  max-height: 44px;
}

.doc-banner-org {
  display: table-cell;
  vertical-align: middle;
  text-align: right;
  font-size: 7.8pt;
  color: #334155;
  line-height: 1.34;
}

.doc-banner-org strong {
  font-size: 8.8pt;
  color: #0f294a;
}

.doc-banner-title {
  text-align: center;
  font-size: 11.2pt;
  font-weight: 800;
  color: #0f294a;
  text-transform: uppercase;
  letter-spacing: 0.2px;
  margin: 3px 0 2px 0;
}

.doc-banner-sub {
  text-align: center;
  font-size: 8.3pt;
  color: #1e40af;
  font-weight: 600;
  margin: 0;
}

.meta-grid {
  width: 100%;
  border-collapse: collapse;
  margin-top: 6px;
  font-size: 7.8pt;
}

.meta-grid td {
  border: 1px solid #cbd5e1;
  padding: 3.5px 6px;
  background: #ffffff;
}

.meta-grid td.lbl {
  background: #f1f5f9;
  font-weight: 700;
  color: #0f294a;
  width: 21%;
}

.sec-title {
  font-size: 8.8pt;
  font-weight: 800;
  text-transform: uppercase;
  color: #ffffff;
  background: #0f294a;
  padding: 3px 7px;
  border-left: 4px solid #0284c7;
  border-radius: 3px;
  margin: 5px 0 3px 0;
  page-break-after: avoid;
}

.sub-title {
  font-size: 8.1pt;
  font-weight: 700;
  color: #0f294a;
  border-left: 3.5px solid #0284c7;
  padding-left: 6px;
  margin: 4px 0 2px 0;
  page-break-after: avoid;
}

table.data-tbl {
  width: 100%;
  border-collapse: collapse;
  margin: 2px 0 4px 0;
  font-size: 7.3pt;
}

table.data-tbl th {
  background: #1e3a5f;
  color: #ffffff;
  font-weight: 700;
  text-align: left;
  padding: 2.5px 4.5px;
  border: 1px solid #0f294a;
}

table.data-tbl td {
  border: 1px solid #cbd5e1;
  padding: 2.1px 4.5px;
  vertical-align: top;
}

table.data-tbl tr:nth-child(even) td {
  background: #f8fafc;
}

.badge {
  display: inline-block;
  padding: 1.5px 5px;
  border-radius: 3px;
  font-size: 7.1pt;
  font-weight: 700;
}

.b-green {
  background: #dcfce7;
  color: #166534;
  border: 1px solid #86efac;
}

.b-blue {
  background: #dbeafe;
  color: #1e40af;
  border: 1px solid #93c5fd;
}

.b-amber {
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fcd34d;
}

.b-red {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fca5a5;
}

.callout {
  border: 1px solid #93c5fd;
  border-left: 4px solid #1d4ed8;
  background: #eff6ff;
  border-radius: 4px;
  padding: 6px 8px;
  margin: 5px 0;
  font-size: 7.6pt;
}

.form-box {
  border: 1.5px solid #0f294a;
  border-radius: 4px;
  padding: 5px 7px;
  margin: 3px 0 5px 0;
  background: #ffffff;
  page-break-inside: avoid;
}

.form-hdr {
  display: table;
  width: 100%;
  border-bottom: 1.5px solid #0f294a;
  padding-bottom: 4px;
  margin-bottom: 5px;
}

.form-hdr-left {
  display: table-cell;
  width: 67%;
  vertical-align: middle;
}

.form-hdr-right {
  display: table-cell;
  width: 33%;
  vertical-align: middle;
  text-align: right;
  font-size: 7.4pt;
  color: #334155;
}

.form-title {
  font-size: 9.3pt;
  font-weight: 800;
  color: #0f294a;
  text-transform: uppercase;
}

.form-sub {
  font-size: 7.6pt;
  color: #1e40af;
  font-weight: 600;
}

.sig-grid {
  width: 100%;
  border-collapse: collapse;
  margin-top: 5px;
  font-size: 7.6pt;
}

.sig-grid td {
  text-align: center;
  vertical-align: top;
  padding: 4px;
  border: 1px dashed #cbd5e1;
}

.sig-space {
  height: 22px;
}

.page-break {
  page-break-before: always;
}

.mono {
  font-family: 'DejaVu Sans Mono', 'Liberation Mono', monospace;
  font-size: 7.45pt;
}
"""

ISO_FACTORY_HTML = f"""<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8"/>
<title>Hồ sơ Quy trình Sản xuất, Lắp ráp &amp; Kiểm soát Chất lượng Nhà máy ISO (Bản Tinh gọn) — VNMAP AI ONE — Tân Thanh Phương</title>
<style>{COMMON_CSS}</style>
</head>
<body>
<div class="footer-str">HS-QTSX-ISO-TTP-AIONE-2026 | Hồ sơ Quy trình Sản xuất &amp; KCS Tinh gọn (ISO 9001:2015 &amp; ISO/IEC 27001:2022) — VNMAP® AI ONE — Công ty CP Đầu tư Phát triển Công nghệ Tân Thanh Phương</div>

<!-- TRANG 1: BÌA HỒ SƠ, NGUYÊN TẮC TINH GỌN, DANH MỤC HỒ SƠ & SƠ ĐỒ XƯỞNG 4 KHU VỰC -->
<div class="doc-banner">
  <div class="doc-banner-top">
    <div class="doc-banner-logo">
      <img src="{LOGO_URI}" alt="VNMAP"/>
    </div>
    <div class="doc-banner-org">
      <strong>CÔNG TY CỔ PHẦN ĐẦU TƯ PHÁT TRIỂN CÔNG NGHỆ TÂN THANH PHƯƠNG</strong><br/>
      Mã số doanh nghiệp / MST: <strong>2800817718</strong> &bull; ĐT: <strong>0237 888 6868</strong> &bull; Web: <strong>https://vnmap.ai</strong><br/>
      Trụ sở chính: Số 28 Cao Thắng, Phường Hạc Thành, Tỉnh Thanh Hóa, Việt Nam<br/>
      <strong>Xưởng sản xuất &amp; KCS: Số 472 Nguyễn Trãi, Phường Phú Sơn, TP. Thanh Hóa, Tỉnh Thanh Hóa</strong>
    </div>
  </div>
  <div class="doc-banner-title">HỒ SƠ QUY TRÌNH SẢN XUẤT, LẮP RÁP THEO ĐƠN HÀNG (ORDER) &amp; KIỂM SOÁT CHẤT LƯỢNG TINH GỌN (ISO 9001:2015 &amp; ISO/IEC 27001:2022)</div>
  <p class="doc-banner-sub">Sản phẩm: <strong>Thiết bị đầu cuối AI xác thực định danh và hỗ trợ hành chính công thông minh</strong> &bull; Nhãn hiệu: <strong>VNMAP®</strong> &bull; Model: <strong>VNMAP AI ONE</strong></p>
  <table class="meta-grid">
    <tr>
      <td class="lbl">Mã bộ tài liệu</td>
      <td><strong>HS-QTSX-ISO-TTP-AIONE-2026</strong> (Ver 3.0 — Tinh gọn)</td>
      <td class="lbl">Phương thức Sản xuất</td>
      <td><strong>Lắp ráp tích hợp theo từng <span class="mono">Order</span> khách hàng</strong></td>
    </tr>
    <tr>
      <td class="lbl">Đơn vị Sản xuất</td>
      <td><strong>CÔNG TY CP ĐẦU TƯ PHÁT TRIỂN CÔNG NGHỆ TÂN THANH PHƯƠNG</strong></td>
      <td class="lbl">Địa điểm Xưởng SX</td>
      <td><strong>Số 472 Nguyễn Trãi, P. Phú Sơn, TP. Thanh Hóa</strong></td>
    </tr>
    <tr>
      <td class="lbl">Tiêu chuẩn Áp dụng</td>
      <td><strong>TCVN ISO 9001:2015</strong> &amp; <strong>ISO/IEC 27001:2022</strong> (<span class="mono">17232257/TQC.25.2916</span>)</td>
      <td class="lbl">Mã Định danh / Truy vết</td>
      <td>Chuẩn <strong><span class="mono">inut_x_y</span></strong> (VD: <strong><span class="mono">inut_207_203</span></strong>) dán trên từng máy</td>
    </tr>
  </table>
</div>

<table class="data-tbl">
  <thead>
    <tr>
      <th style="width:24%">Trách nhiệm Phê duyệt</th>
      <th style="width:30%">Chức danh / Bộ phận</th>
      <th style="width:26%">Phạm vi Áp dụng</th>
      <th style="width:20%">Ký &amp; Đóng dấu</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Biên soạn Quy trình</strong></td>
      <td>Trưởng Bộ phận Kỹ thuật &amp; Sản xuất</td>
      <td>Xưởng SX 472 Nguyễn Trãi, TP. Thanh Hóa</td>
      <td style="height:15px;"></td>
    </tr>
    <tr>
      <td><strong>Kiểm soát QMS &amp; ISMS</strong></td>
      <td>Đại diện Lãnh đạo Chất lượng &amp; ATTT (QMR/ISMS)</td>
      <td>Ban ISO &amp; Bộ phận KCS</td>
      <td></td>
    </tr>
    <tr>
      <td><strong>Phê duyệt Ban hành</strong></td>
      <td><strong>GIÁM ĐỐC CÔNG TY</strong></td>
      <td>Công ty CP ĐT PT Công nghệ Tân Thanh Phương</td>
      <td></td>
    </tr>
  </tbody>
</table>

<div class="sec-title">PHẦN I. NGUYÊN TẮC VẬN HÀNH TINH GỌN, DANH MỤC HỒ SƠ &amp; SƠ ĐỒ XƯỞNG 472 NGUYỄN TRÃI</div>

<div class="callout">
  <strong>4 Nguyên tắc Đơn giản hóa Tối đa mà Đảm bảo 100% Yêu cầu Đánh giá ISO 9001:2015 &amp; ISO/IEC 27001:2022:</strong><br/>
  <strong>1. Xuất kho &amp; lắp ráp theo cấu hình <span class="mono">Order</span>:</strong> Tùy theo từng <span class="mono">Order</span> thực tế để lắp cỡ màn hình cảm ứng (<strong><span class="mono">21.5 / 22 / 27 / 32 / 43 / 51 inch</span></strong>), đầu đọc thẻ CCCD gắn chip (<strong>tiếp xúc / <span class="mono">Hanel</span> / <span class="mono">VeriBOX S</span></strong>), máy quét tài liệu Camera <strong>tối thiểu <span class="mono">11 MP</span> (<span class="mono">&ge; 11MP</span>)</strong> và bộ đổi nguồn (<strong><span class="mono">24VDC / 19VDC / 15VDC / 5VDC</span></strong>).<br/>
  <strong>2. Quản lý xuyên suốt bằng 01 mã định danh <span class="mono">inut_x_y</span> (Điều khoản 8.5.2 ISO 9001):</strong> Mỗi máy được cấp và dán cố định 01 mã <strong><span class="mono">inut_x_y</span></strong> (ví dụ: <strong><span class="mono">inut_207_203</span></strong>) để đại diện cho sản phẩm/model, truy vết theo <span class="mono">Order</span> và quản lý hành trình bảo hành (không cần ghi chép mã phụ của từng linh kiện nhỏ).<br/>
  <strong>3. Đánh giá bằng Checklist Thực tế (<span class="mono">☑ Đạt / Không đạt</span>):</strong> Chỉ cần <strong>01 Đồng hồ vạn năng số (VOM)</strong> có tem hiệu chuẩn để đo áp nguồn DC; các bước còn lại kiểm tra trực tiếp bằng thao tác thực tế (chạm cảm ứng, đọc thẻ CCCD mẫu, chụp văn bản A4 bằng camera &ge;11MP, thử mic/loa/mạng).<br/>
  <strong>4. Gộp gọn chỉ còn 03 Biểu mẫu (<span class="mono">BM-SX-01, BM-SX-02, BM-SX-03</span>):</strong> Đủ 100% bằng chứng Điều khoản 7.1.5, 8.1, 8.4, 8.5, 8.6, 8.7 ISO 9001 &amp; Phụ lục A.8 ISO 27001.
</div>

<div class="sub-title">1.1. Danh mục Quy trình &amp; 03 Biểu mẫu Tinh gọn Áp dụng tại Xưởng 472 Nguyễn Trãi</div>
<table class="data-tbl">
  <thead>
    <tr>
      <th style="width:5%">TT</th>
      <th style="width:15%">Mã Tài liệu</th>
      <th style="width:44%">Tên Quy trình / Biểu mẫu Thực tế (Gộp gọn, dễ ghi chép)</th>
      <th style="width:18%">Điều khoản ISO 9001</th>
      <th style="width:18%">Điều khoản ISO 27001</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>1</td>
      <td><span class="mono">QT-SX-01</span></td>
      <td><strong>Quy trình 05 bước sản xuất, lắp ráp theo <span class="mono">Order</span>, định danh <span class="mono">inut_x_y</span> và KCS xuất xưởng</strong></td>
      <td>Điều khoản 8.1, 8.4, 8.5, 8.6</td>
      <td>Phụ lục A.8.1, A.8.9, A.8.10</td>
    </tr>
    <tr>
      <td>2</td>
      <td><span class="mono">BM-SX-01</span></td>
      <td><strong>Lệnh Sản xuất theo <span class="mono">Order</span>, Phiếu Xuất kho &amp; Kiểm tra Vật tư Đầu vào (<span class="mono">IQC</span>)</strong> <em>(Gộp 3 trong 1)</em></td>
      <td>Điều khoản 8.1, 8.4, 8.5.2</td>
      <td>Phụ lục A.5.19, A.8.1</td>
    </tr>
    <tr>
      <td>3</td>
      <td><span class="mono">BM-SX-02</span></td>
      <td><strong>Phiếu Checklist Lắp ráp (<span class="mono">IPQC</span>), Bảo mật PM (<span class="mono">ISO 27001</span>) &amp; KCS Xuất xưởng (<span class="mono">OQC</span>) theo mã <span class="mono">inut_x_y</span></strong></td>
      <td>Điều khoản 8.5.1, 8.5.2, 8.6</td>
      <td>Phụ lục A.8.8, A.8.9, A.8.10</td>
    </tr>
    <tr>
      <td>4</td>
      <td><span class="mono">BM-SX-03</span></td>
      <td><strong>Sổ Theo dõi Sự không phù hợp &amp; Xử lý Khắc phục (<span class="mono">NCR &amp; CAPA</span>)</strong></td>
      <td>Điều khoản 8.7, 10.2</td>
      <td>Phụ lục A.5.24, A.5.27</td>
    </tr>
  </tbody>
</table>

<div class="sub-title">1.2. Sơ đồ Bố trí 04 Khu vực Đơn giản Một chiều tại Xưởng 472 Nguyễn Trãi, P. Phú Sơn, TP. Thanh Hóa</div>
<div style="border:1.5px solid #cbd5e1;border-radius:4px;padding:5px;background:#ffffff;text-align:center;">
  <svg width="100%" height="106" viewBox="0 0 860 155" xmlns="http://www.w3.org/2000/svg">
    <rect x="6" y="6" width="198" height="86" rx="5" fill="#eff6ff" stroke="#1d4ed8" stroke-width="1.8"/>
    <text x="105" y="25" text-anchor="middle" font-family="DejaVu Sans" font-size="10.2" font-weight="bold" fill="#0f294a">KHU 1: TIẾP NHẬN, KIỂM IQC</text>
    <text x="105" y="40" text-anchor="middle" font-family="DejaVu Sans" font-size="10.2" font-weight="bold" fill="#1d4ed8">&amp; KHO VẬT TƯ THEO ORDER</text>
    <text x="105" y="57" text-anchor="middle" font-family="DejaVu Sans" font-size="8.4" fill="#334155">Kiểm ngoại quan, đo áp nguồn VOM,</text>
    <text x="105" y="70" text-anchor="middle" font-family="DejaVu Sans" font-size="8.4" fill="#334155">dán nhãn xanh IQC PASS</text>

    <path d="M204 49 L224 49" stroke="#0f294a" stroke-width="2"/>

    <rect x="224" y="6" width="198" height="86" rx="5" fill="#f0fdf4" stroke="#15803d" stroke-width="1.8"/>
    <text x="323" y="25" text-anchor="middle" font-family="DejaVu Sans" font-size="10.2" font-weight="bold" fill="#14532d">KHU 2: LẮP RÁP CƠ - ĐIỆN TỬ</text>
    <text x="323" y="40" text-anchor="middle" font-family="DejaVu Sans" font-size="10.2" font-weight="bold" fill="#15803d">THEO CẤU HÌNH ORDER (IPQC)</text>
    <text x="323" y="57" text-anchor="middle" font-family="DejaVu Sans" font-size="8.4" fill="#334155">Màn 21.5"–51", đầu đọc, cam &ge;11MP,</text>
    <text x="323" y="70" text-anchor="middle" font-family="DejaVu Sans" font-size="8.4" fill="#334155">nguồn 24/19/15/5VDC, tiếp địa vỏ</text>

    <path d="M422 49 L442 49" stroke="#0f294a" stroke-width="2"/>

    <rect x="442" y="6" width="198" height="86" rx="5" fill="#fefce8" stroke="#b45309" stroke-width="1.8"/>
    <text x="541" y="25" text-anchor="middle" font-family="DejaVu Sans" font-size="10.2" font-weight="bold" fill="#78350f">KHU 3: NẠP PM AI, GÁN MÃ</text>
    <text x="541" y="40" text-anchor="middle" font-family="DejaVu Sans" font-size="10.2" font-weight="bold" fill="#b45309">inut_x_y, ISO 27001 &amp; TEST KCS</text>
    <text x="541" y="57" text-anchor="middle" font-family="DejaVu Sans" font-size="8.4" fill="#334155">Khóa Kiosk, tự xóa dữ liệu phiên,</text>
    <text x="541" y="70" text-anchor="middle" font-family="DejaVu Sans" font-size="8.4" fill="#334155">test thực tế CCCD, cam &ge;11MP, mạng</text>

    <path d="M640 49 L660 49" stroke="#0f294a" stroke-width="2"/>

    <rect x="660" y="6" width="194" height="86" rx="5" fill="#dcfce7" stroke="#15803d" stroke-width="2"/>
    <text x="757" y="25" text-anchor="middle" font-family="DejaVu Sans" font-size="10.2" font-weight="bold" fill="#14532d">KHU 4: DÁN TEM inut_x_y,</text>
    <text x="757" y="40" text-anchor="middle" font-family="DejaVu Sans" font-size="10.2" font-weight="bold" fill="#15803d">DẤU CR &amp; ĐÓNG GÓI BÀN GIAO</text>
    <text x="757" y="57" text-anchor="middle" font-family="DejaVu Sans" font-size="8.4" fill="#334155">Dán nhãn gốc + CR + KCS PASS,</text>
    <text x="757" y="70" text-anchor="middle" font-family="DejaVu Sans" font-size="8.4" fill="#334155">lưu sổ hành trình bảo hành inut_x_y</text>

    <!-- Khu cách ly NCR -->
    <rect x="6" y="104" width="848" height="43" rx="5" fill="#fef2f2" stroke="#dc2626" stroke-width="1.5" stroke-dasharray="5,3"/>
    <text x="430" y="122" text-anchor="middle" font-family="DejaVu Sans" font-size="9.5" font-weight="bold" fill="#991b1b">BÀN / KỆ CÁCH LY LINH KIỆN &amp; SẢN PHẨM LỖI (NCR QUARANTINE — DÁN NHÃN ĐỎ RIÊNG BIỆT THEO ĐIỀU KHOẢN 8.7 ISO 9001)</text>
    <text x="430" y="137" text-anchor="middle" font-family="DejaVu Sans" font-size="8.2" fill="#7f1d1d">Linh kiện lỗi phát hiện khi kiểm đầu vào (IQC) hoặc máy chưa đạt khi KCS đều được dán nhãn ĐỎ và để riêng tại kệ này để đổi trả/khắc phục theo BM-SX-03</text>
  </svg>
</div>

<!-- TRANG 2: BẢNG KHUNG VẬT TƯ THEO ORDER, QUY TRÌNH 5 BƯỚC & THIẾT BỊ ĐO TỐI GIẢN -->
<div class="page-break"></div>

<div class="sec-title">PHẦN II. KHUNG VẬT TƯ THEO ORDER (BOM), QUY TRÌNH 05 BƯỚC (QT-SX-01) &amp; THIẾT BỊ TỐI GIẢN</div>

<div class="sub-title">2.1. Bảng Định mức Khung Vật tư – Linh kiện theo Cấu hình <span class="mono">Order</span> (<span class="mono">Configurable BOM</span>) &amp; Cách Kiểm IQC Đơn giản</div>
<table class="data-tbl">
  <thead>
    <tr>
      <th style="width:4%">TT</th>
      <th style="width:13%">Mã Vật tư</th>
      <th style="width:28%">Tên Hạng mục Linh kiện / Cụm Module</th>
      <th style="width:35%">Tùy chọn Cấu hình theo từng <span class="mono">Order</span></th>
      <th style="width:6%">ĐM</th>
      <th style="width:14%">Cách Kiểm Đầu vào (IQC)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>1</td>
      <td><span class="mono">LK-AIONE-01</span></td>
      <td><strong>Bo mạch chủ AI (Mainboard + NPU) &amp; Module RF Wi-Fi/BLE</strong></td>
      <td>Bo mạch xử lý AI công nghiệp tích hợp NPU, cổng LAN RJ45, USB, HDMI/LVDS + Module Wi-Fi 2.4G/5G &amp; BLE kèm ăng-ten nội bộ.</td>
      <td>01 Bộ</td>
      <td>Kiểm ngoại quan, cấp nguồn boot thử lên hình</td>
    </tr>
    <tr>
      <td>2</td>
      <td><span class="mono">LK-AIONE-02</span></td>
      <td><strong>Màn hình chính cảm ứng đa điểm IPS</strong> <em>(và màn phụ tùy Order)</em></td>
      <td><strong>Kích thước tùy theo <span class="mono">Order</span>: <span class="mono">21.5 / 22 / 27 / 32 / 43 / 51 inch</span></strong>, tấm nền IPS, cảm ứng điện dung đa điểm, kính cường lực.</td>
      <td>01 Cái</td>
      <td>Đúng cỡ inch của Order, sáng rõ, chạm mượt</td>
    </tr>
    <tr>
      <td>3</td>
      <td><span class="mono">LK-AIONE-03</span></td>
      <td><strong>Cụm Camera AI nhận diện khuôn mặt</strong></td>
      <td>Camera góc rộng Full HD / 2K chống ngược sáng, giao tiếp USB; phục vụ nhận diện công dân tiếp cận và lấy số tự động.</td>
      <td>01 Cái</td>
      <td>Cắm cổng USB test lên hình rõ nét</td>
    </tr>
    <tr>
      <td>4</td>
      <td><span class="mono">LK-AIONE-04</span></td>
      <td><strong>Đầu đọc thẻ CCCD gắn chip chuyên dụng</strong></td>
      <td><strong>Tùy chọn theo từng <span class="mono">Order</span>:</strong> Cụm <strong>đầu đọc thẻ gắn chip tiếp xúc, đầu đọc định danh <span class="mono">Hanel</span>, <span class="mono">VeriBOX S</span></strong> kết hợp quét mã QR định danh.</td>
      <td>01 Bộ</td>
      <td>Đúng loại đầu đọc theo Order, thử nhận thẻ mẫu</td>
    </tr>
    <tr>
      <td>5</td>
      <td><span class="mono">LK-AIONE-05</span></td>
      <td><strong>Máy quét tài liệu (Document Scanner)</strong></td>
      <td>Cụm <strong>Camera quét chụp văn bản/giấy tờ độ phân giải tối thiểu <span class="mono">11 MP</span> (<span class="mono">&ge; 11 Megapixel</span>)</strong> kèm đèn LED trợ sáng phục vụ AI OCR điền biểu mẫu.</td>
      <td>01 Bộ</td>
      <td>Đạt thông số &ge; 11MP, chụp thử tờ A4 rõ chữ</td>
    </tr>
    <tr>
      <td>6</td>
      <td><span class="mono">LK-AIONE-06</span></td>
      <td><strong>Cụm Loa &amp; Micro đa hướng khử ồn AI</strong></td>
      <td>Micro đa hướng thu giọng nói tiếng Việt khử ồn + Loa phát âm thanh hướng dẫn thủ tục hành chính hai chiều.</td>
      <td>01 Bộ</td>
      <td>Thử thu âm và phát tiếng rõ, không rè</td>
    </tr>
    <tr>
      <td>7</td>
      <td><span class="mono">LK-AIONE-07</span></td>
      <td><strong>Bộ đổi nguồn / Cấp nguồn một chiều DC</strong></td>
      <td>Ngõ vào 100–240VAC; <strong>Ngõ ra một chiều tùy theo <span class="mono">Order</span>: <span class="mono">24VDC / 19VDC / 15VDC / 5VDC</span></strong>.</td>
      <td>01 Bộ</td>
      <td>Đo bằng đồng hồ VOM đúng áp DC của Order</td>
    </tr>
    <tr>
      <td>8</td>
      <td><span class="mono">LK-AIONE-08</span></td>
      <td><strong>Khung vỏ Kiosk CNC, Cáp, Tem <span class="mono">inut_x_y</span> &amp; Dấu CR</strong></td>
      <td>Khung vỏ Kiosk thép sơn tĩnh điện theo cỡ màn hình Order, dây nguồn tiếp địa, <strong>Nhãn gốc in mã <span class="mono">inut_x_y</span> + Dấu CR</strong> (MST 2800817718), tem KCS PASS.</td>
      <td>01 Bộ</td>
      <td>Sơn không trầy, tem in đúng mã <span class="mono">inut_x_y</span></td>
    </tr>
  </tbody>
</table>

<div class="sub-title">2.2. Lưu trình 05 Bước Sản xuất – Lắp ráp theo <span class="mono">Order</span> – Định danh <span class="mono">inut_x_y</span> – KCS Xuất xưởng (<span class="mono">QT-SX-01</span>)</div>
<table class="data-tbl">
  <thead>
    <tr>
      <th style="width:8%">Bước</th>
      <th style="width:25%">Tên Công đoạn</th>
      <th style="width:49%">Thao tác Thực hiện Đơn giản tại Xưởng 472 Nguyễn Trãi</th>
      <th style="width:18%">Biểu mẫu Ghi nhận</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Bước 1</strong></td>
      <td><strong>Lệnh SX theo <span class="mono">Order</span>, Cấp mã <span class="mono">inut_x_y</span> &amp; Kiểm IQC</strong></td>
      <td>Căn cứ <span class="mono">Order</span> khách hàng, lập phiếu <span class="mono">BM-SX-01</span>, cấp dải mã <strong><span class="mono">inut_x_y</span></strong> (VD: <span class="mono">inut_207_201..205</span>). Kiểm tra vật tư đầu vào theo đúng cấu hình <span class="mono">Order</span>, đo áp nguồn DC bằng đồng hồ VOM; đạt dán nhãn <strong>IQC PASS</strong>.</td>
      <td><strong><span class="mono">BM-SX-01</span></strong><br/><em>(Lệnh SX + IQC)</em></td>
    </tr>
    <tr>
      <td><strong>Bước 2</strong></td>
      <td><strong>Lắp ráp theo <span class="mono">Order</span> &amp; Kiểm tra Nguội (<span class="mono">IPQC</span>)</strong></td>
      <td>Lắp vỏ Kiosk, gắn màn hình (<span class="mono">21.5"–51"</span>), Bo mạch AI, Đầu đọc chip (tiếp xúc / <span class="mono">Hanel</span> / <span class="mono">VeriBOX S</span>), Camera quét <span class="mono">&ge; 11MP</span>, Camera AI, Loa/Mic, Bộ nguồn (<span class="mono">24V/19V/15V/5VDC</span>). Bắt dây tiếp địa vỏ máy và đo kiểm nguội không chạm chập.</td>
      <td>Phần A của<br/><strong><span class="mono">BM-SX-02</span></strong></td>
    </tr>
    <tr>
      <td><strong>Bước 3</strong></td>
      <td><strong>Nạp Phần mềm AI, Gán mã <span class="mono">inut_x_y</span> &amp; Khóa <span class="mono">ISO 27001</span></strong></td>
      <td>Cài đặt bản phần mềm chuẩn <strong>VNMAP AI ONE</strong>; <strong>gán cứng mã <span class="mono">inut_x_y</span></strong> (VD: <span class="mono">inut_207_203</span>) vào phần mềm &amp; sổ bảo hành; khóa cổng gỡ lỗi (<span class="mono">ADB/Root</span>), khóa giao diện Kiosk và bật <strong>tự động xóa dữ liệu phiên công dân</strong> sau khi hoàn tất giao dịch.</td>
      <td>Phần B của<br/><strong><span class="mono">BM-SX-02</span></strong></td>
    </tr>
    <tr>
      <td><strong>Bước 4</strong></td>
      <td><strong>Chạy thử Ổn định &amp; Nghiệm thu KCS 100% (<span class="mono">OQC</span>)</strong></td>
      <td>Cho máy chạy thử ổn định 01–02 giờ; tích kiểm trực tiếp trên từng máy: Đo áp nguồn DC đúng <span class="mono">Order</span>, chạm cảm ứng IPS, thử Camera AI &amp; giọng nói 2 chiều, đọc thẻ CCCD mẫu, chụp văn bản A4 bằng Camera <span class="mono">&ge; 11MP</span>, kết nối mạng LAN/Wi-Fi/BLE.</td>
      <td>Phần C của<br/><strong><span class="mono">BM-SX-02</span></strong></td>
    </tr>
    <tr>
      <td><strong>Bước 5</strong></td>
      <td><strong>Dán Tem <span class="mono">inut_x_y</span> + Dấu CR &amp; Quản lý Bảo hành</strong></td>
      <td>Dán <strong>Nhãn gốc in mã Serial <span class="mono">inut_x_y</span> + Dấu hợp quy CR</strong>, <strong>Tem QR bảo hành <span class="mono">inut_x_y</span></strong> và <strong>Tem KCS PASS</strong> lên từng máy. Lưu hồ sơ theo <span class="mono">Order</span> và mã <span class="mono">inut_x_y</span> để truy vết hành trình &amp; bảo hành.</td>
      <td>Lưu bộ hồ sơ lô<br/><span class="mono">BM-SX-01..02</span></td>
    </tr>
  </tbody>
</table>

<div class="sub-title">2.3. Danh mục Thiết bị Sản xuất &amp; Đo lường Tối giản tại Xưởng (Đảm bảo Điều khoản 7.1.5 ISO 9001 — Không rườm rà hiệu chuẩn)</div>
<table class="data-tbl">
  <thead>
    <tr>
      <th style="width:5%">TT</th>
      <th style="width:14%">Mã Thiết bị</th>
      <th style="width:39%">Tên Thiết bị / Công cụ tại Xưởng 472 Nguyễn Trãi</th>
      <th style="width:24%">Công dụng Thực tế</th>
      <th style="width:18%">Quản lý theo ISO 9001</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>1</td>
      <td><span class="mono">TB-ĐL-01</span></td>
      <td><strong>Đồng hồ vạn năng số (<span class="mono">Digital Multimeter / VOM</span>)</strong></td>
      <td>Đo điện áp nguồn DC (<span class="mono">24V/19V/15V/5VDC</span>) &amp; đo thông mạch tiếp địa</td>
      <td><span class="badge b-green">Tem hiệu chuẩn 12 tháng</span></td>
    </tr>
    <tr>
      <td>2</td>
      <td><span class="mono">TB-SX-01</span></td>
      <td>Bàn lắp ráp kỹ thuật có thảm &amp; vòng đeo tay chống tĩnh điện (<span class="mono">ESD</span>)</td>
      <td>Lắp ráp bo mạch AI, màn hình và các cụm ngoại vi</td>
      <td><span class="badge b-blue">Kiểm tra nội bộ định kỳ</span></td>
    </tr>
    <tr>
      <td>3</td>
      <td><span class="mono">TB-SX-02</span></td>
      <td>Bộ dụng cụ cơ khí cầm tay (tô-vít, kìm, thước) &amp; Máy in tem <span class="mono">inut_x_y</span></td>
      <td>Lắp ráp vỏ Kiosk và in tem định danh / QR bảo hành <span class="mono">inut_x_y</span></td>
      <td><span class="badge b-blue">Kiểm tra trước ca SX</span></td>
    </tr>
    <tr>
      <td>4</td>
      <td><span class="mono">TB-SX-03</span></td>
      <td>Bộ công cụ Test Chức năng Thực tế (Thẻ CCCD mẫu, Văn bản mẫu A4, mạng Wi-Fi/LAN)</td>
      <td>Thử trực tiếp đầu đọc thẻ chip, camera quét &ge;11MP, cảm ứng, âm thanh, mạng</td>
      <td><span class="badge b-blue">Đối chiếu thực tế từng lô</span></td>
    </tr>
  </tbody>
</table>

<!-- TRANG 3: BIỂU MẪU 01 (GỘP LỆNH SX THEO ORDER + XUẤT KHO + KIỂM TRA IQC) -->
<div class="page-break"></div>

<div class="sec-title">PHẦN III. BỘ 03 BIỂU MẪU HỒ SƠ LÔ SẢN XUẤT VÍ DỤ THEO ORDER (ĐIỀN SẴN TRÌNH ĐOÀN ISO)</div>

<div class="form-box">
  <div class="form-hdr">
    <div class="form-hdr-left">
      <div class="form-title">BIỂU MẪU 01: LỆNH SẢN XUẤT THEO ORDER, PHIẾU XUẤT KHO &amp; KIỂM TRA VẬT TƯ ĐẦU VÀO (IQC)</div>
      <div class="form-sub">CÔNG TY CỔ PHẦN ĐẦU TƯ PHÁT TRIỂN CÔNG NGHỆ TÂN THANH PHƯƠNG — Xưởng SX: Số 472 Nguyễn Trãi, P. Phú Sơn, TP. Thanh Hóa</div>
    </div>
    <div class="form-hdr-right">
      Mã biểu mẫu: <strong>BM-SX-01</strong><br/>
      Số phiếu: <strong>LSX-IQC-2026-10/TTP</strong><br/>
      Ngày lập: <strong>15/10/2026</strong>
    </div>
  </div>

  <table class="meta-grid" style="margin-bottom:6px;">
    <tr>
      <td class="lbl">Căn cứ Đơn hàng (Order)</td>
      <td><strong>ORD-2026-10-HCC08</strong> <em>(Hồ sơ ví dụ theo Order)</em></td>
      <td class="lbl">Sản phẩm / Model</td>
      <td><strong>VNMAP® AI ONE</strong> &bull; Số lượng: <strong>05 bộ</strong></td>
    </tr>
    <tr>
      <td class="lbl">Cấu hình Order ví dụ</td>
      <td colspan="3">Màn hình cảm ứng <strong>32 inch</strong> <em>(tùy chọn Order: 21.5/22/27/32/43/51")</em> &bull; Đầu đọc thẻ chip <strong>VeriBOX S</strong> <em>(tùy chọn Order: Tiếp xúc / Hanel / VeriBOX S)</em> &bull; Máy quét tài liệu Camera <strong>12 MP (&ge; 11 MP)</strong> &bull; Bộ đổi nguồn <strong>19VDC</strong> <em>(tùy chọn Order: 24V/19V/15V/5VDC)</em></td>
    </tr>
    <tr>
      <td class="lbl">Dải Mã ID / Serial (<span class="mono">inut_x_y</span>)</td>
      <td colspan="3"><span class="mono">inut_207_201</span>, <span class="mono">inut_207_202</span>, <strong><span class="mono">inut_207_203</span></strong> <em>(máy đại diện)</em>, <span class="mono">inut_207_204</span>, <span class="mono">inut_207_205</span> — Dán cố định trên từng máy để định danh &amp; quản lý bảo hành</td>
    </tr>
  </table>

  <table class="data-tbl" style="margin:4px 0;">
    <thead>
      <tr>
        <th style="width:5%">TT</th>
        <th style="width:13%">Mã Vật tư</th>
        <th style="width:36%">Tên Vật tư / Cụm Module Xuất kho (Theo cấu hình Order ví dụ)</th>
        <th style="width:8%">SL Xuất</th>
        <th style="width:22%">Kết quả Kiểm tra Đầu vào (IQC) Thực tế</th>
        <th style="width:7%">SL Đạt</th>
        <th style="width:9%">Kết luận</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>1</td>
        <td><span class="mono">LK-AIONE-01</span></td>
        <td>Bo mạch chủ xử lý AI + NPU (kèm Module RF Wi-Fi 2.4G/5G &amp; BLE + Ăng-ten)</td>
        <td>05 Bộ</td>
        <td>Ngoại quan tốt, cấp điện boot thử 05/05 bộ lên hình ổn định</td>
        <td><strong>05 Bộ</strong></td>
        <td><span class="badge b-green">☑ IQC PASS</span></td>
      </tr>
      <tr>
        <td>2</td>
        <td><span class="mono">LK-AIONE-02</span></td>
        <td><strong>Màn hình cảm ứng đa điểm IPS cỡ 32 inch</strong> <em>(theo Order; dải 21.5/22/27/32/43/51")</em></td>
        <td>05 Cái</td>
        <td>Đúng cỡ 32 inch theo Order, hiển thị sáng rõ, chạm mượt</td>
        <td><strong>05 Cái</strong></td>
        <td><span class="badge b-green">☑ IQC PASS</span></td>
      </tr>
      <tr>
        <td>3</td>
        <td><span class="mono">LK-AIONE-03</span></td>
        <td>Cụm Camera AI nhận diện khuôn mặt</td>
        <td>05 Cái</td>
        <td>Cắm cổng USB test hình ảnh rõ nét</td>
        <td><strong>05 Cái</strong></td>
        <td><span class="badge b-green">☑ IQC PASS</span></td>
      </tr>
      <tr>
        <td>4</td>
        <td><span class="mono">LK-AIONE-04</span></td>
        <td><strong>Đầu đọc thẻ CCCD gắn chip <span class="mono">VeriBOX S</span></strong> <em>(theo Order; Tiếp xúc/Hanel/VeriBOX S)</em></td>
        <td>05 Bộ</td>
        <td>Đúng loại <span class="mono">VeriBOX S</span> của Order, thử đặt thẻ mẫu nhận tốt</td>
        <td><strong>05 Bộ</strong></td>
        <td><span class="badge b-green">☑ IQC PASS</span></td>
      </tr>
      <tr>
        <td>5</td>
        <td><span class="mono">LK-AIONE-05</span></td>
        <td><strong>Cụm Máy quét tài liệu Camera <span class="mono">12 MP (&ge; 11 MP)</span></strong> kèm đèn LED trợ sáng</td>
        <td>05 Bộ</td>
        <td>Đạt độ phân giải <span class="mono">12 MP (&ge; 11 MP)</span>, chụp thử tờ A4 rõ chữ</td>
        <td><strong>05 Bộ</strong></td>
        <td><span class="badge b-green">☑ IQC PASS</span></td>
      </tr>
      <tr>
        <td>6</td>
        <td><span class="mono">LK-AIONE-06</span></td>
        <td>Cụm Loa &amp; Micro đa hướng khử ồn AI</td>
        <td>05 Bộ</td>
        <td>Thử thu âm và phát tiếng rõ ràng</td>
        <td><strong>05 Bộ</strong></td>
        <td><span class="badge b-green">☑ IQC PASS</span></td>
      </tr>
      <tr>
        <td>7</td>
        <td><span class="mono">LK-AIONE-07</span></td>
        <td><strong>Bộ đổi nguồn một chiều <span class="mono">19VDC</span></strong> <em>(theo Order; tùy case 24V/19V/15V/5VDC)</em></td>
        <td>06 Cái</td>
        <td>Đo bằng VOM (<span class="mono">TB-ĐL-01</span>): 05 cái đạt <span class="mono">19VDC</span>; <strong>01 cái sụt áp &rarr; Cách ly lập <span class="mono">NCR-2026-01</span></strong></td>
        <td><strong>05 Cái</strong><br/><em>(Lỗi 01)</em></td>
        <td><span class="badge b-amber">05 ĐẠT / 01 NCR</span></td>
      </tr>
      <tr>
        <td>8</td>
        <td><span class="mono">LK-AIONE-08</span></td>
        <td>Khung vỏ Kiosk CNC cỡ 32" + Cáp + <strong>Bộ nhãn gốc CR &amp; Tem Serial <span class="mono">inut_207_201..205</span></strong></td>
        <td>05 Bộ</td>
        <td>Khung vỏ sơn tốt, tem in đúng dải mã <span class="mono">inut_207_201..205</span></td>
        <td><strong>05 Bộ</strong></td>
        <td><span class="badge b-green">☑ IQC PASS</span></td>
      </tr>
    </tbody>
  </table>

  <table class="sig-grid" style="margin-top:8px;">
    <tr>
      <td style="width:33%"><strong>THỦ KHO XUẤT VẬT TƯ</strong><div class="sig-space"></div>Đã xuất đủ 05 bộ đạt chuẩn theo Order</td>
      <td style="width:33%"><strong>KỸ THUẬT VIÊN KIỂM ĐẦU VÀO (IQC)</strong><div class="sig-space"></div>Lê Minh Tuấn</td>
      <td style="width:34%"><strong>QUẢN ĐỐC XƯỞNG PHÊ DUYỆT LỆNH SX</strong><div class="sig-space"></div>Nguyễn Văn Hùng</td>
    </tr>
  </table>
</div>

<!-- TRANG 4: BIỂU MẪU 02 (CHECKLIST IPQC + ISO 27001 + OQC THEO MÃ inut_x_y) & BIỂU MẪU 03 (SỔ NCR) -->
<div class="page-break"></div>

<div class="form-box">
  <div class="form-hdr">
    <div class="form-hdr-left">
      <div class="form-title">BIỂU MẪU 02: PHIẾU CHECKLIST LẮP RÁP (IPQC), BẢO MẬT PHẦN MỀM (ISO 27001) &amp; KCS XUẤT XƯỞNG (OQC)</div>
      <div class="form-sub">Theo Order: <strong>ORD-2026-10-HCC08</strong> &bull; Cá thể đại diện: <strong><span class="mono">inut_207_203</span></strong> (Kiểm 100% dải <span class="mono">inut_207_201</span> &divide; <span class="mono">inut_207_205</span>) &bull; Dụng cụ đo: Đồng hồ VOM <span class="mono">TB-ĐL-01</span></div>
    </div>
    <div class="form-hdr-right">
      Mã biểu mẫu: <strong>BM-SX-02</strong><br/>
      Số phiếu: <strong>BB-KCS-2026-10/TTP</strong><br/>
      Ngày nghiệm thu: <strong>16/10/2026</strong>
    </div>
  </div>

  <table class="data-tbl" style="margin:3px 0;">
    <thead>
      <tr>
        <th style="width:31%">Hạng mục Kiểm tra Thực tế (ISO 9001:2015 &amp; ISO/IEC 27001:2022)</th>
        <th style="width:21%">Tiêu chí Đánh giá Đơn giản</th>
        <th style="width:8%"><span class="mono">inut_207_201</span></th>
        <th style="width:8%"><span class="mono">inut_207_202</span></th>
        <th style="width:8%"><strong><span class="mono">inut_207_203</span></strong></th>
        <th style="width:8%"><span class="mono">inut_207_204</span></th>
        <th style="width:8%"><span class="mono">inut_207_205</span></th>
        <th style="width:8%">Kết luận</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td colspan="8" style="background:#eff6ff;font-weight:bold;color:#0f294a;">A. KIỂM TRA LẮP RÁP TRUNG GIAN (IPQC — Điều khoản 8.5.1 ISO 9001)</td>
      </tr>
      <tr>
        <td>1. Lắp ráp cơ khí, màn hình (<span class="mono">21.5"–51"</span>) &amp; ngoại vi đúng Order</td>
        <td>Đúng màn 32", VeriBOX S, cam &ge;11MP</td>
        <td>☑ Đạt</td>
        <td>☑ Đạt</td>
        <td><strong>☑ Đạt</strong></td>
        <td>☑ Đạt</td>
        <td>☑ Đạt</td>
        <td><span class="badge b-green">ĐẠT</span></td>
      </tr>
      <tr>
        <td>2. Đi dây nội bộ, bắt tiếp địa vỏ &amp; kiểm nguội nguồn DC</td>
        <td>Vỏ nối tiếp địa, đo VOM không chạm chập</td>
        <td>☑ Đạt</td>
        <td>☑ Đạt</td>
        <td><strong>☑ Đạt</strong></td>
        <td>☑ Đạt</td>
        <td>☑ Đạt</td>
        <td><span class="badge b-green">ĐẠT</span></td>
      </tr>
      <tr>
        <td colspan="8" style="background:#eff6ff;font-weight:bold;color:#0f294a;">B. NẠP PHẦN MỀM, GÁN MÃ <span class="mono">inut_x_y</span> &amp; BẢO MẬT (ISO/IEC 27001:2022 — Phụ lục A.8)</td>
      </tr>
      <tr>
        <td>3. Nạp phần mềm chuẩn <strong>VNMAP AI ONE</strong> &amp; gán mã <span class="mono">inut_x_y</span></td>
        <td>Đúng bản chuẩn; hiện đúng mã <span class="mono">inut_x_y</span></td>
        <td>☑ Đạt</td>
        <td>☑ Đạt</td>
        <td><strong>☑ Đạt</strong></td>
        <td>☑ Đạt</td>
        <td>☑ Đạt</td>
        <td><span class="badge b-green">ĐẠT</span></td>
      </tr>
      <tr>
        <td>4. Khóa cổng gỡ lỗi (<span class="mono">ADB/Root</span>) &amp; khóa giao diện Kiosk (<span class="mono">A.8.9</span>)</td>
        <td>Không thoát được ra ngoài màn Kiosk</td>
        <td>☑ Đã khóa</td>
        <td>☑ Đã khóa</td>
        <td><strong>☑ Đã khóa</strong></td>
        <td>☑ Đã khóa</td>
        <td>☑ Đã khóa</td>
        <td><span class="badge b-green">ĐẠT</span></td>
      </tr>
      <tr>
        <td>5. Bật tự động xóa dữ liệu phiên công dân (<span class="mono">A.8.10</span>)</td>
        <td>Kết thúc phiên: tự xóa sạch ảnh &amp; CCCD</td>
        <td>☑ Đạt</td>
        <td>☑ Đạt</td>
        <td><strong>☑ Đạt</strong></td>
        <td>☑ Đạt</td>
        <td>☑ Đạt</td>
        <td><span class="badge b-green">ĐẠT</span></td>
      </tr>
      <tr>
        <td colspan="8" style="background:#eff6ff;font-weight:bold;color:#0f294a;">C. CHẠY THỬ &amp; NGHIỆM THU KCS XUẤT XƯỞNG 100% (OQC — Điều khoản 8.6 ISO 9001)</td>
      </tr>
      <tr>
        <td>6. Đo áp nguồn DC (<span class="mono">24V/19V/15V/5VDC</span>) bằng đồng hồ VOM</td>
        <td>Đúng mức áp <span class="mono">19VDC</span> của Order (&plusmn;5%)</td>
        <td>☑ 19,1V</td>
        <td>☑ 19,1V</td>
        <td><strong>☑ 19,2V</strong></td>
        <td>☑ 19,1V</td>
        <td>☑ 19,2V</td>
        <td><span class="badge b-green">ĐẠT</span></td>
      </tr>
      <tr>
        <td>7. Kiểm tra hiển thị màn hình IPS &amp; cảm ứng đa điểm</td>
        <td>Sáng rõ, chạm các góc &amp; tâm nhạy 100%</td>
        <td>☑ Đạt</td>
        <td>☑ Đạt</td>
        <td><strong>☑ Đạt</strong></td>
        <td>☑ Đạt</td>
        <td>☑ Đạt</td>
        <td><span class="badge b-green">ĐẠT</span></td>
      </tr>
      <tr>
        <td>8. Thử Camera AI nhận diện &amp; Hỏi đáp giọng nói 2 chiều</td>
        <td>Nhận diện tốt; Mic thu rõ, Loa phát rõ</td>
        <td>☑ Đạt</td>
        <td>☑ Đạt</td>
        <td><strong>☑ Đạt</strong></td>
        <td>☑ Đạt</td>
        <td>☑ Đạt</td>
        <td><span class="badge b-green">ĐẠT</span></td>
      </tr>
      <tr>
        <td>9. Thử Đầu đọc thẻ CCCD gắn chip (<span class="mono">Tiếp xúc/Hanel/VeriBOX S</span>)</td>
        <td>Đặt thẻ CCCD mẫu &amp; QR đọc chính xác</td>
        <td>☑ Đạt</td>
        <td>☑ Đạt</td>
        <td><strong>☑ Đạt</strong></td>
        <td>☑ Đạt</td>
        <td>☑ Đạt</td>
        <td><span class="badge b-green">ĐẠT</span></td>
      </tr>
      <tr>
        <td>10. Thử Máy quét Camera <strong>&ge; 11 MP</strong> &amp; AI điền biểu mẫu</td>
        <td>Chụp tờ A4 rõ nét (12MP), AI điền đúng</td>
        <td>☑ Đạt</td>
        <td>☑ Đạt</td>
        <td><strong>☑ Đạt</strong></td>
        <td>☑ Đạt</td>
        <td>☑ Đạt</td>
        <td><span class="badge b-green">ĐẠT</span></td>
      </tr>
      <tr>
        <td>11. Kết nối mạng (LAN/Wi-Fi/BLE) &amp; Chạy thử ổn định (02h)</td>
        <td>Mạng thông suốt; chạy 02h máy ổn định</td>
        <td>☑ Đạt</td>
        <td>☑ Đạt</td>
        <td><strong>☑ Đạt</strong></td>
        <td>☑ Đạt</td>
        <td>☑ Đạt</td>
        <td><span class="badge b-green">ĐẠT</span></td>
      </tr>
      <tr>
        <td>12. Dán Nhãn gốc + Dấu CR + Tem <span class="mono">inut_x_y</span> + Tem KCS PASS</td>
        <td>Mã <span class="mono">inut_x_y</span> khớp Phần mềm &amp; Sổ BH</td>
        <td>☑ Đã dán</td>
        <td>☑ Đã dán</td>
        <td><strong>☑ Đã dán</strong></td>
        <td>☑ Đã dán</td>
        <td>☑ Đã dán</td>
        <td><span class="badge b-green">KCS PASS</span></td>
      </tr>
    </tbody>
  </table>
</div>

<!-- BM-SX-03 -->
<div class="form-box">
  <div class="form-hdr">
    <div class="form-hdr-left">
      <div class="form-title">BIỂU MẪU 03: SỔ THEO DÕI SỰ KHÔNG PHÙ HỢP &amp; HÀNH ĐỘNG KHẮC PHỤC (NCR &amp; CAPA)</div>
      <div class="form-sub">Bằng chứng tuân thủ Điều khoản 8.7 &amp; 10.2 TCVN ISO 9001:2015</div>
    </div>
    <div class="form-hdr-right">
      Mã biểu mẫu: <strong>BM-SX-03</strong>
    </div>
  </div>
  <table class="data-tbl" style="margin:3px 0;">
    <thead>
      <tr>
        <th style="width:12%">Mã NCR</th>
        <th style="width:15%">Khâu Phát hiện</th>
        <th style="width:28%">Mô tả Sự không phù hợp</th>
        <th style="width:23%">Biện pháp Xử lý Tức thời</th>
        <th style="width:14%">Phòng ngừa (CAPA)</th>
        <th style="width:8%">Trạng thái</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><span class="mono">NCR-2026-01</span></td>
        <td>Khâu IQC Đầu vào (15/10/2026)</td>
        <td>01 Bộ đổi nguồn <span class="mono">19VDC</span> đo bằng đồng hồ VOM bị sụt áp thấp hơn định mức Order.</td>
        <td>Dán nhãn đỏ <span class="mono">IQC REJECT</span>, để riêng vào Kệ cách ly NCR, lấy 01 bộ nguồn <span class="mono">19VDC</span> đạt chuẩn thay thế, trả NCC đổi mới.</td>
        <td>Đo áp bằng đồng hồ VOM cho 100% bộ nguồn khi nhập.</td>
        <td><span class="badge b-green">ĐÃ ĐÓNG</span></td>
      </tr>
      <tr>
        <td><span class="mono">NCR-2026-02</span></td>
        <td>Khâu IPQC (<span class="mono">inut_207_204</span>)</td>
        <td>Dây cáp USB nối cụm Camera quét tài liệu &ge;11MP trong thân máy <span class="mono">inut_207_204</span> chưa cài vào rãnh kẹp.</td>
        <td>Cố định lại dây cáp vào rãnh kẹp bằng dây rút nhựa trên máy <span class="mono">inut_207_204</span> trước khi đóng nắp.</td>
        <td>Kiểm tra kẹp dây gọn ở Bước 2 trước khi sang Khu 3.</td>
        <td><span class="badge b-green">ĐÃ ĐÓNG</span></td>
      </tr>
    </tbody>
  </table>
  <table class="sig-grid">
    <tr>
      <td style="width:33%"><strong>KỸ THUẬT VIÊN LẮP RÁP &amp; NẠP PM</strong><div class="sig-space"></div>Phạm Hoàng Nam</td>
      <td style="width:33%"><strong>TRƯỞNG BỘ PHẬN KCS / OQC</strong><div class="sig-space"></div>Lê Minh Tuấn (Đạt 05/05 máy <span class="mono">inut_207_201..205</span>)</td>
      <td style="width:34%"><strong>GIÁM ĐỐC CÔNG TY PHÊ DUYỆT XUẤT XƯỞNG</strong><div class="sig-space"></div><strong>CÔNG TY CP ĐT PT CÔNG NGHỆ TÂN THANH PHƯƠNG</strong></td>
    </tr>
  </table>
</div>

</body>
</html>
"""


def main() -> None:
    out_html = BASE_DIR / "iso_factory_dossier.html"
    out_pdf = BASE_DIR / "Ho-So-Quy-Trinh-San-Xuat-Nha-May-ISO-VNMAP-AI-ONE-Tan-Thanh-Phuong.pdf"

    out_html.write_text(ISO_FACTORY_HTML, encoding="utf-8")
    weasyprint.HTML(string=ISO_FACTORY_HTML, base_url=str(BASE_DIR)).write_pdf(str(out_pdf))
    print(f"Rendered: {out_pdf} ({out_pdf.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
