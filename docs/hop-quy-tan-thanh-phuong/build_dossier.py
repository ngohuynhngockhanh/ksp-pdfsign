#!/usr/bin/env python3
"""
Generate 2 publication-grade A4 PDFs for Tan Thanh Phuong's VNMAP AI ONE QCVN Conformity Certification & Declaration:
1. Phuong-An-Chien-Luoc-Hop-Quy-QCVN-VNMAP-AI-ONE-Tan-Thanh-Phuong-2026.pdf
2. Ho-So-Ky-Thuat-Va-Bieu-Mau-Dang-Ky-Hop-Quy-VNMAP-AI-ONE-Tan-Thanh-Phuong.pdf
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
    margin: 13mm 14mm 14.5mm 14.5mm;
    @bottom-left {
        content: string(doc_footer_left);
        font-family: 'DejaVu Sans', 'Liberation Sans', sans-serif;
        font-size: 7.5pt;
        color: #64748b;
    }
    @bottom-right {
        content: "Trang " counter(page) " / " counter(pages);
        font-family: 'DejaVu Sans', 'Liberation Sans', sans-serif;
        font-size: 7.5pt;
        color: #475569;
        font-weight: bold;
    }
}

* {
    box-sizing: border-box;
}

body {
    font-family: 'DejaVu Sans', 'Liberation Sans', sans-serif;
    font-size: 8.9pt;
    line-height: 1.38;
    color: #0f172a;
    margin: 0;
    padding: 0;
}

.footer-str {
    string-set: doc_footer_left content();
    display: none;
}

h1, h2, h3, h4 {
    color: #0f294a;
    margin-top: 0;
    page-break-after: avoid;
    break-after: avoid;
}

.doc-banner {
    border: 1.5px solid #0f294a;
    border-radius: 6px;
    padding: 12px 15px;
    background: #f8fafc;
    margin-bottom: 14px;
}

.doc-banner-top {
    display: table;
    width: 100%;
    border-bottom: 1px solid #cbd5e1;
    padding-bottom: 8px;
    margin-bottom: 8px;
}

.doc-banner-logo {
    display: table-cell;
    width: 28%;
    vertical-align: middle;
}

.doc-banner-logo img {
    max-height: 36px;
    max-width: 150px;
}

.doc-banner-org {
    display: table-cell;
    width: 72%;
    vertical-align: middle;
    text-align: right;
    font-size: 8.3pt;
    color: #334155;
}

.doc-banner-title {
    font-size: 13.5pt;
    font-weight: 700;
    color: #0f294a;
    text-transform: uppercase;
    letter-spacing: 0.2px;
    margin: 4px 0 3px 0;
}

.doc-banner-sub {
    font-size: 9.2pt;
    color: #334155;
    margin: 0;
}

.meta-grid {
    width: 100%;
    border-collapse: collapse;
    margin-top: 8px;
    font-size: 8.5pt;
}

.meta-grid td {
    padding: 3px 6px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
}

.meta-grid td.lbl {
    background: #f1f5f9;
    font-weight: 700;
    color: #1e293b;
    width: 22%;
}

.sec-title {
    font-size: 10.8pt;
    font-weight: 700;
    text-transform: uppercase;
    color: #ffffff;
    background: #0f294a;
    padding: 5px 10px;
    border-radius: 4px;
    margin: 14px 0 8px 0;
    page-break-after: avoid;
    break-after: avoid;
}

.sub-title {
    font-size: 9.8pt;
    font-weight: 700;
    color: #0f294a;
    border-left: 3.5px solid #0284c7;
    padding-left: 8px;
    margin: 10px 0 6px 0;
    page-break-after: avoid;
    break-after: avoid;
}

table.data-tbl {
    width: 100%;
    border-collapse: collapse;
    margin: 6px 0 10px 0;
    font-size: 8.5pt;
}

table.data-tbl th {
    background: #e2e8f0;
    color: #0f172a;
    font-weight: 700;
    text-align: left;
    padding: 5px 7px;
    border: 1px solid #94a3b8;
}

table.data-tbl td {
    padding: 5px 7px;
    border: 1px solid #cbd5e1;
    vertical-align: top;
}

table.data-tbl tr:nth-child(even) td {
    background: #f8fafc;
}

table.data-tbl tr {
    page-break-inside: avoid;
    break-inside: avoid;
}

.callout {
    border-radius: 5px;
    padding: 8px 11px;
    margin: 8px 0;
    font-size: 8.8pt;
    page-break-inside: avoid;
    break-inside: avoid;
}

.callout-danger {
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-left: 4px solid #dc2626;
}

.callout-warn {
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-left: 4px solid #d97706;
}

.callout-ok {
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-left: 4px solid #16a34a;
}

.callout-info {
    background: #f0f9ff;
    border: 1px solid #bae6fd;
    border-left: 4px solid #0284c7;
}

.badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 7.6pt;
    font-weight: 700;
}

.badge-red { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
.badge-amber { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
.badge-green { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
.badge-blue { background: #e0f2fe; color: #075985; border: 1px solid #7dd3fc; }

ul, ol {
    margin: 4px 0 8px 0;
    padding-left: 18px;
}

li {
    margin-bottom: 3px;
}

.page-break {
    page-break-before: always;
    break-before: page;
}

/* Statutory Legal Forms (Times New Roman) */
.legal-form {
    font-family: 'Times New Roman', 'Liberation Serif', serif;
    font-size: 9.8pt;
    line-height: 1.32;
    color: #000000;
    border: 1px solid #475569;
    padding: 10px 14px;
    background: #ffffff;
}

.legal-header-tbl {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 6px;
}

.legal-header-tbl td {
    vertical-align: top;
    text-align: center;
    font-size: 9.8pt;
}

.legal-title {
    text-align: center;
    font-size: 12pt;
    font-weight: bold;
    text-transform: uppercase;
    margin: 6px 0 3px 0;
    color: #000000;
}

.legal-sub {
    text-align: center;
    font-size: 9.2pt;
    font-style: italic;
    margin: 0 0 7px 0;
}

.legal-p {
    margin: 3.5px 0;
    text-align: justify;
}

.sig-tbl {
    width: 100%;
    border-collapse: collapse;
    margin-top: 9px;
    page-break-inside: avoid;
    break-inside: avoid;
}

.sig-tbl td {
    vertical-align: top;
    text-align: center;
    font-size: 9.8pt;
}

.sig-space {
    height: 54px;
}

.mono {
    font-family: 'DejaVu Sans Mono', 'Liberation Mono', monospace;
    font-size: 8.3pt;
    background: #f1f5f9;
    padding: 1px 4px;
    border-radius: 3px;
}

.label-card {
    border: 1.8px solid #0f172a;
    border-radius: 6px;
    padding: 10px 14px;
    width: 88%;
    margin: 8px auto;
    background: #ffffff;
    page-break-inside: avoid;
    break-inside: avoid;
}
"""


STRATEGY_HTML = f"""<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8"/>
<title>Phương Án Chiến Lược Hợp Quy QCVN VNMAP AI ONE - Tân Thanh Phương</title>
<style>{COMMON_CSS}</style>
</head>
<body>
<div class="footer-str">PA-QCVN-TTP-2026-V1 | Phương án Chứng nhận &amp; Công bố Hợp quy VNMAP® AI ONE — Công ty CP Đầu tư Phát triển Công nghệ Tân Thanh Phương</div>

<div class="doc-banner">
  <div class="doc-banner-top">
    <div class="doc-banner-logo">
      <img src="{LOGO_URI}" alt="VNMAP"/>
    </div>
    <div class="doc-banner-org">
      <strong>ĐƠN VỊ ĐỨNG TÊN HỢP QUY: CÔNG TY CP ĐẦU TƯ PHÁT TRIỂN CÔNG NGHỆ TÂN THANH PHƯƠNG</strong><br/>
      MST: <strong>2800817718</strong> | Trụ sở: Số 28 Cao Thắng, P. Hạc Thành, Tỉnh Thanh Hóa<br/>
      Cơ sở sản xuất: Số 472 Nguyễn Trãi, P. Phú Sơn, TP. Thanh Hóa, Tỉnh Thanh Hóa
    </div>
  </div>
  <div class="doc-banner-title">PHƯƠNG ÁN CHIẾN LƯỢC, TỐI ƯU CHI PHÍ &amp; LỘ TRÌNH CHỨNG NHẬN / CÔNG BỐ HỢP QUY QCVN</div>
  <p class="doc-banner-sub">Áp dụng cho sản phẩm <strong>Thiết bị đầu cuối AI hỗ trợ hành chính công VNMAP® AI ONE</strong> theo khung pháp lý mới nhất năm 2026 (<strong>Thông tư 14/2026/TT-BKHCN</strong> &amp; <strong>Thông tư 36/2026/TT-BKHCN</strong>)</p>
  <table class="meta-grid">
    <tr>
      <td class="lbl">Mã phương án</td>
      <td><strong>PA-QCVN-TTP-2026-V1</strong></td>
      <td class="lbl">Ngày lập</td>
      <td><strong>03/11/2026</strong></td>
    </tr>
    <tr>
      <td class="lbl">Sản phẩm / Nhãn hiệu</td>
      <td><strong>VNMAP AI ONE</strong> (Nhãn hiệu: <strong>VNMAP®</strong>)</td>
      <td class="lbl">Xuất xứ hàng hóa</td>
      <td><strong>Sản xuất tại Việt Nam (Tân Thanh Phương)</strong></td>
    </tr>
    <tr>
      <td class="lbl">Căn cứ pháp lý 2026</td>
      <td colspan="3">Luật số <strong>78/2025/QH15</strong>; Nghị định <strong>22/2026/NĐ-CP</strong> &amp; <strong>37/2026/NĐ-CP</strong>; Thông tư <strong>14/2026/TT-BKHCN</strong> (hiệu lực 25/05/2026) &amp; Thông tư <strong>36/2026/TT-BKHCN</strong> (hiệu lực 01/06/2026)</td>
    </tr>
  </table>
</div>

<div class="sec-title">1. THẨM ĐỊNH 02 CHỨNG CHỈ ISO CỦA TÂN THANH PHƯƠNG &amp; ĐIỂM NÓNG PHÁP LÝ CẦN XỬ LÝ NGAY</div>

<p>Theo <strong>Thông tư số 36/2026/TT-BKHCN</strong> (hiệu lực từ 01/06/2026, thay thế Thông tư 29/2025/TT-BKHCN và bãi bỏ cơ chế cấp mới Phương thức 1 cũ của TT 30/2011/TT-BTTTT), thiết bị CNTT &amp; thu phát vô tuyến sản xuất trong nước áp dụng <strong>Phương thức 3</strong> (<em>Thử nghiệm mẫu điển hình kết hợp đánh giá quá trình sản xuất; Giấy chứng nhận có giá trị tới 05 năm</em>). Theo <strong>Chú thích (13) Thông tư 36/2026/TT-BKHCN</strong> và <strong>Khoản 8 Điều 6 Thông tư 14/2026/TT-BKHCN</strong>, doanh nghiệp được <strong>miễn đánh giá quá trình sản xuất tại xưởng</strong> nếu có chứng chỉ <strong>ISO 9001</strong> còn hiệu lực <strong>ít nhất 06 tháng</strong> và đúng phạm vi, địa điểm sản xuất.</p>

<table class="data-tbl">
  <thead>
    <tr>
      <th style="width:23%">Chứng chỉ hiện có</th>
      <th style="width:25%">Tổ chức cấp &amp; Thời hạn</th>
      <th style="width:28%">Phạm vi &amp; Địa điểm ghi trên GCN</th>
      <th style="width:24%">Kết luận thẩm định Hợp quy (03/11/2026)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>TCVN ISO 9001:2015</strong><br/>Số: <span class="mono">HT 4620/1.23.18</span></td>
      <td><strong>QUACERT</strong> (JAS-ANZ)<br/>Cấp: 04/07/2023<br/>Hết hạn: <strong>03/07/2026</strong></td>
      <td>- Đ/c: Số 28 Cao Thắng, P. Điện Biên, TP. Thanh Hóa<br/>- Phạm vi: <em>Sản xuất máy tính bảng; Cung cấp lắp đặt thiết bị điện tử</em></td>
      <td><span class="badge badge-red">KHÔNG ĐỦ ĐIỀU KIỆN MIỄN</span><br/>1) <strong>Đã hết hạn 04 tháng</strong> (từ 03/07/2026).<br/>2) Chưa ghi xưởng <strong>472 Nguyễn Trãi</strong> và thiếu cụm <em>ki ốt thông minh / thiết bị đọc định danh</em>.</td>
    </tr>
    <tr>
      <td><strong>ISO/IEC 27001:2022</strong><br/>Số: <span class="mono">17232257/TQC.25.2916</span></td>
      <td><strong>TQC CGLOBAL</strong> (BOA / IAF)<br/>Cấp: 16/04/2025<br/>Hết hạn: <strong>15/04/2028</strong></td>
      <td>- VP: Số 28 Cao Thắng, TP. Thanh Hóa<br/>- <strong>Xưởng SX: Số 472 Nguyễn Trãi, P. Phú Sơn, TP. Thanh Hóa</strong><br/>- Phạm vi: <em>Sản xuất phần cứng &amp; phần mềm máy tính, ki ốt thông minh, thiết bị đọc định danh, máy tính để bàn...</em></td>
      <td><span class="badge badge-amber">HỖ TRỢ MẠNH NHƯNG CHƯA ĐỦ</span><br/>Còn hạn dài, đúng y hệt xưởng 472 Nguyễn Trãi &amp; phạm vi Kiosk/AI Box, <strong>nhưng là ISO 27001 (ATTT)</strong>, không thay thế được <strong>ISO 9001 (QLCL)</strong> theo Chú thích (13).</td>
    </tr>
  </tbody>
</table>

<div class="callout callout-ok">
  <strong>GIẢI PHÁP XỬ LÝ CỰC GỌN CHO TÂN THANH PHƯƠNG (03 LỰA CHỌN THỰC CHIẾN):</strong>
  <ol style="margin-bottom:0">
    <li><strong>Kiểm tra ngay bản gia hạn ISO 9001 sau tháng 07/2026:</strong> Ảnh ISO 9001 vừa gửi trùng với file <span class="mono">giay_1.png</span> cũ trên website <span class="mono">vnmap.ai</span>. Cần hỏi ngay bộ phận Hành chính/ISO của Tân Thanh Phương xem đã có bản tái chứng nhận <strong>ISO 9001:2015 chu kỳ 2026–2029</strong> (có ghi xưởng 472 Nguyễn Trãi) chưa. Nếu có sẵn &rarr; <strong>Miễn đánh giá xưởng 100% ngay lập tức!</strong></li>
    <li><strong>Nếu chưa gia hạn ISO 9001 — Phương án Tối ưu nhất (Combo tại TQC CGLOBAL):</strong> Chính <strong>TQC CGLOBAL</strong> (đơn vị đang cấp tờ ISO 27001 số <span class="mono">17232257/TQC.25.2916</span> cho Tân Thanh Phương) đồng thời là <strong>Tổ chức chứng nhận hợp quy ICT được Bộ KH&amp;CN chỉ định (QĐ 1562/QĐ-BKHCN)</strong>! Tân Thanh Phương nộp hồ sơ tại TQC CGLOBAL để cấp bổ sung <strong>ISO 9001:2015</strong> bê nguyên địa chỉ xưởng <span class="mono">472 Nguyễn Trãi</span> &amp; nguyên văn Scope của tờ ISO 27001 (hồ sơ mặt bằng có sẵn tại TQC nên ra giấy cực nhanh, chi phí ghép ưu đãi ~12–15 triệu cho 3 năm), đồng thời hưởng quyền <strong>miễn đánh giá xưởng Phương thức 3 (hiệu lực 5 năm)</strong> cho cả dải sản phẩm Kiosk, AI Box, VeriBOX, Tablet về sau.</li>
    <li><strong>Nếu cần lấy CNHQ gấp mà không muốn làm lại ISO 9001:</strong> Vẫn nộp <strong>Phương thức 3</strong> bình thường — chuyên gia TQC CGLOBAL / VNTA thực hiện <strong>Đánh giá quá trình sản xuất (Factory Audit 01 ngày)</strong> trực tiếp tại xưởng <span class="mono">472 Nguyễn Trãi, Thanh Hóa</span> (phí đánh giá QTSX chỉ ~5–8 triệu VNĐ, không bắt buộc phải có chứng chỉ ISO 9001).</li>
  </ol>
</div>

<div class="sec-title">2. BÓC TÁCH 05 "BẪY ĐỘI CHI PHÍ" TRONG BROCHURE THƯƠNG MẠI VNMAP_ONE_AI.PDF</div>

<p>Đối chiếu cuốn Brochure giới thiệu sản phẩm <span class="mono">VNMAP_ONE_AI.pdf</span> (trang 7–8) với báo giá dịch vụ hợp quy cũ ngày 13/10/2026 (<strong>123.886.800 VNĐ</strong>), có <strong>05 chi tiết câu chữ thương mại</strong> nếu bê nguyên vào Hồ sơ kỹ thuật nộp Phòng Lab sẽ làm đội thêm <strong>45 – 75 triệu VNĐ</strong> và kéo dài thời gian thử nghiệm:</p>

<table class="data-tbl">
  <thead>
    <tr>
      <th style="width:4%">#</th>
      <th style="width:27%">Chi tiết trong Brochure / Báo giá cũ</th>
      <th style="width:34%">Hệ quả pháp lý &amp; Chi phí phát sinh</th>
      <th style="width:35%">Cách chuẩn hóa trong Hồ sơ Kỹ thuật Hợp quy</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>1</strong></td>
      <td>Trang 8 Brochure ghi: <em>"Pin Lithium dự phòng tích hợp dung lượng cao"</em></td>
      <td>Bị bắt buộc đo <strong>QCVN 101:2020/BTTTT</strong> (Điều 2.6 An toàn Pin Lithium): tốn thêm <strong>6 – 10 triệu đ</strong>, phải nộp thêm nhiều cell/pack pin rời để thử phá hủy (đoản mạch, ép, rơi) mất 2–3 tuần.</td>
      <td><span class="badge badge-green">LOẠI BỎ TRIỆT ĐỂ</span> Khai đúng cấu hình thương mại để bàn/kiosk dùng <strong>Adapter nguồn rời DC 12V (không tích hợp pin Lithium bên trong)</strong>; lưu điện dùng UPS ngoài &rarr; <strong>Miễn 100% QCVN 101</strong>.</td>
    </tr>
    <tr>
      <td><strong>2</strong></td>
      <td>Báo giá 123,88tr tính gộp cả <strong>3G WCDMA + 4G LTE</strong> (<span class="mono">74,5tr</span> phần RF) và nguy cơ bị áp VoLTE</td>
      <td>Mạng 2G đã tắt sóng, 3G đang dừng thương mại; nếu khai chung chung "4G LTE" không ghi rõ Data-Only dễ bị áp thêm bài đo thoại VoLTE hoặc 3G thừa, đội <strong>20 – 30 triệu đ</strong>.</td>
      <td><span class="badge badge-green">TỐI ƯU KÉP</span> <strong>PA1:</strong> Để 4G là USB Dongle phụ kiện cắm ngoài &rarr; <strong>cắt hẳn QCVN 117 &amp; 86 (giảm ~38tr)</strong>. <strong>PA2 (nếu cần ghi 4G lên giấy CNHQ):</strong> Khai rõ <strong>LTE Cat.1bis Data-Only (B1/B3/B5/B8), không hỗ trợ 2G/3G/VoLTE</strong>, miễn TRP/TRS theo Chú thích (4) TT 36/2026.</td>
    </tr>
    <tr>
      <td><strong>3</strong></td>
      <td>Báo giá 123,88tr vẽ thêm mục <em>"Đo thêm cho Bluetooth (RF &amp; EMC): 13.500.000 đ"</em></td>
      <td>Thu trùng lặp! BLE 2.4GHz nằm chung trong <strong>QCVN 54:2020/BTTTT</strong> với Wi-Fi 2.4GHz và chung EMC <strong>QCVN 112:2017/BTTTT</strong>. Đặc biệt theo <strong>Chú thích (3) TT 36/2026</strong>, Bluetooth EIRP &lt; 60mW (17,78 dBm) không bắt buộc CNHQ riêng.</td>
      <td><span class="badge badge-green">CẮT GIẢM ~10 TRIỆU</span> Chip <span class="mono">SWT6621S</span> phát BLE &le; 8 dBm (~6,3 mW &ll; 60 mW): miễn đo riêng theo Chú thích (3), hoặc nếu đo gộp chung báo cáo QCVN 54 chỉ chấp nhận phụ phí giờ máy <strong>3 – 3,5 triệu đ</strong>.</td>
    </tr>
    <tr>
      <td><strong>4</strong></td>
      <td>Trang 8 Brochure ghi tích hợp sẵn <em>"Đầu đọc thẻ gắn chip ISO/IEC 14443A/B (NFC 13.56MHz)"</em></td>
      <td>Nếu hàn/gắn cố định module NFC 13.56MHz trong vỏ máy: phải đo thêm <strong>QCVN 55:2023/BTTTT</strong> (đã bỏ điều kiện khắc nghiệt từ 01/07/2025) + <strong>QCVN 96:2015/BTTTT</strong> (~8 – 11 triệu đ).</td>
      <td><span class="badge badge-blue">LINH HOẠT THEO MẪU ĐO</span> Nếu nộp mẫu khối xử lý trung tâm AI Box (đầu đọc CCCD rời cổng USB) &rarr; <strong>không phải đo QCVN 55/96</strong>. Nếu nộp nguyên cụm All-in-One gắn sẵn NFC trong thân máy để đi thầu Đề án 06 &rarr; đo luôn QCVN 55 (đk thường) + QCVN 96.</td>
    </tr>
    <tr>
      <td><strong>5</strong></td>
      <td>Báo giá cũ bỏ sót quy chuẩn Máy tính / Thiết bị xử lý dữ liệu để bàn (<strong>Mã HS 8471.41.90</strong>)</td>
      <td>Nếu chỉ làm theo mã thu phát vô tuyến mà thiếu <strong>QCVN 118:2018/BTTTT</strong> (EMC thiết bị CNTT) &amp; <strong>QCVN 132:2022/BTTTT</strong> (An toàn điện IEC 62368-1), khi nghiệm thu thầu Kiosk/Máy tính Hành chính công sẽ bị hỏi thiếu quy chuẩn máy tính!</td>
      <td><span class="badge badge-green">BỔ SUNG ĐÚNG LUẬT</span> Định danh chuẩn là <strong>Thiết bị đầu cuối AI / Máy tính xử lý dữ liệu tích hợp vô tuyến (HS 8471.41.90 — Rủi ro trung bình theo Chú thích 12 TT 36/2026)</strong>, đo bổ sung QCVN 118 + QCVN 132 (đo kèm Adapter 12V theo Chú thích 10, chỉ ~8–9tr cả cặp).</td>
    </tr>
  </tbody>
</table>

<div class="sec-title">3. SO SÁNH 03 GÓI PHƯƠNG ÁN CẤU HÌNH &amp; DỰ TOÁN NGÂN SÁCH HỢP QUY</div>

<p>Tùy theo mục tiêu hồ sơ thầu của <strong>Tân Thanh Phương</strong> (cần tối ưu chi phí nhanh gọn hay cần ghi đầy đủ cả chữ <em>4G LTE + NFC 13.56MHz</em> lên Giấy Chứng nhận Hợp quy để tạo lợi thế tuyệt đối khi đấu thầu Trung tâm Phục vụ Hành chính công), dưới đây là <strong>03 phương án cấu hình chuẩn</strong>:</p>

<table class="data-tbl">
  <thead>
    <tr>
      <th style="width:20%">Tiêu chí đối sánh</th>
      <th style="width:27%">PHƯƠNG ÁN 1 (KHUYẾN NGHỊ TỐI ƯU CHI PHÍ)<br/><em>Bản LAN + Wi-Fi 2.4G/5G + BLE (4G/CCCD cắm USB rời)</em></th>
      <th style="width:28%">PHƯƠNG ÁN 2 (FULL VŨ KHÍ ĐẤU THẦU)<br/><em>Bản All-in-One: LAN + Wi-Fi 2.4G/5G + BLE + 4G LTE Cat.1 + NFC 13.56MHz</em></th>
      <th style="width:25%">BÁO GIÁ DỊCH VỤ CŨ (13/10/2026)<br/><em>Chưa tối ưu cấu hình &amp; bị tính trùng phí</em></th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Cấu hình phần cứng mẫu đem đi đo (EUT)</strong></td>
      <td>Khối xử lý trung tâm <strong>VNMAP AI ONE</strong> (<span class="mono">RK3528/RK3518 + SWT6621S</span>), LAN RJ45, Wi-Fi 2.4G/5G, BLE &lt;60mW, Adapter DC 12V (<strong>Không Pin, không gắn SIM 4G trong vỏ</strong>).</td>
      <td>Trọn cụm để bàn <strong>VNMAP AI ONE</strong> tích hợp sẵn 2 màn hình cảm ứng, Wi-Fi 2.4G/5G, BLE, <strong>Module 4G LTE Cat.1bis Data-Only</strong> (<span class="mono">A7680C</span>) &amp; <strong>Đầu đọc NFC 13.56MHz</strong>, Adapter DC 12V (<strong>Không Pin</strong>).</td>
      <td>Bị gộp cả 3G + 4G + thu riêng phí Bluetooth 13,5tr; chưa có QCVN 118/132 cho máy tính Kiosk; nếu nộp kèm Brochure có Pin sẽ đội thêm QCVN 101.</td>
    </tr>
    <tr>
      <td><strong>Danh mục QCVN đo kiểm &amp; đánh giá bắt buộc</strong></td>
      <td>
        1. <strong>QCVN 54:2020/BTTTT</strong> (Wi-Fi 2.4G / BLE)<br/>
        2. <strong>QCVN 65:2021/BTTTT</strong> (Wi-Fi 5G)<br/>
        3. <strong>QCVN 112:2017/BTTTT</strong> (EMC vô tuyến)<br/>
        4. <strong>QCVN 118:2018/BTTTT</strong> (EMC CNTT)<br/>
        5. <strong>QCVN 132:2022/BTTTT</strong> (An toàn điện IEC 62368-1 kèm Adapter 12V)
      </td>
      <td>
        Gồm đủ 05 QCVN của Phương án 1, <strong>cộng thêm</strong>:<br/>
        6. <strong>QCVN 117:2023/BTTTT</strong> (chỉ đo 4G LTE Data-only B1/B3/B5/B8, bỏ 2G/3G/VoLTE)<br/>
        7. <strong>QCVN 86:2019/BTTTT</strong> (hoặc 86:2025 - EMC LTE)<br/>
        8. <strong>QCVN 55:2023/BTTTT</strong> (NFC 13.56MHz đk thường) + <strong>QCVN 96:2015/BTTTT</strong>
      </td>
      <td>
        - QCVN 54/65/112/117/86 (kèm 3G thừa)<br/>
        - Phụ thu Bluetooth vô lý 13,5tr<br/>
        - Thiếu QCVN 118, 132, 55, 96
      </td>
    </tr>
    <tr>
      <td><strong>Số lượng mẫu cần chuẩn bị</strong></td>
      <td><strong>02 mẫu</strong> hoàn chỉnh (01 mẫu dẫn sóng RF SMA hàn sẵn hoặc đo bức xạ + 01 mẫu thương mại nguyên chiếc đo EMC &amp; An toàn điện QCVN 132) + 02 Adapter 12V.</td>
      <td><strong>02 mẫu</strong> hoàn chỉnh (01 mẫu hàn sẵn pigtail SMA cho Wi-Fi &amp; 4G LTE + 01 mẫu thương mại nguyên chiếc kèm 2 Adapter 12V).</td>
      <td>02 – 03 mẫu (+ 05–08 mẫu pin rời nếu vướng QCVN 101).</td>
    </tr>
    <tr>
      <td><strong>Phí đo kiểm Lab dự kiến (VNTA / Quatest 1)</strong></td>
      <td><strong>~28.000.000 – 34.000.000 đ</strong><br/><em>(Nếu gắn thêm NFC 13.56MHz trong vỏ: cộng ~8–10tr cho QCVN 55 + 96)</em></td>
      <td><strong>~58.000.000 – 68.000.000 đ</strong><br/><em>(Làm việc trực tiếp phòng Lab chỉ định, không qua cò trung gian kê giá)</em></td>
      <td>94.500.000 đ (chưa VAT)</td>
    </tr>
    <tr>
      <td><strong>Phí CNHQ Phương thức 3 (TQC / VNTA) + Hồ sơ CBHQ</strong></td>
      <td><strong>~10.000.000 – 15.000.000 đ</strong><br/><em>(Chưa gồm phí cấp mới ISO 9001 nếu Tân Thanh Phương chưa gia hạn)</em></td>
      <td><strong>~12.000.000 – 16.000.000 đ</strong><br/><em>(Hiệu lực Giấy CNHQ kiểu loại tới 03–05 năm)</em></td>
      <td>20.210.000 đ (chưa VAT)</td>
    </tr>
    <tr>
      <td><strong>TỔNG NGÂN SÁCH DỰ KIẾN (GỒM VAT)</strong></td>
      <td><strong style="color:#15803d;font-size:10pt">~41.000.000 – 53.000.000 VNĐ</strong><br/><span class="badge badge-green">Tiết kiệm ~70 – 82 triệu VNĐ</span></td>
      <td><strong style="color:#0369a1;font-size:10pt">~75.600.000 – 90.000.000 VNĐ</strong><br/><span class="badge badge-blue">Đủ cả 4G + NFC, vẫn rẻ hơn ~35–48tr</span></td>
      <td><strong style="color:#b91c1c;font-size:10pt">123.886.800 VNĐ</strong><br/><span class="badge badge-red">Đắt &amp; thiếu QCVN máy tính</span></td>
    </tr>
    <tr>
      <td><strong>Thời gian hoàn thành</strong></td>
      <td><strong>15 – 20 ngày làm việc</strong></td>
      <td><strong>20 – 25 ngày làm việc</strong></td>
      <td>25 – 35 ngày làm việc</td>
    </tr>
  </tbody>
</table>

<div class="callout callout-info">
  <strong>MẸO PHÁP LÝ QUAN TRỌNG KHI SOẠN HỒ SƠ (ĐIỂM a KHOẢN 5 ĐIỀU 86 NĐ 37/2026 &amp; KHOẢN 7 ĐIỀU 14 TT 14/2026):</strong><br/>
  Trên <strong>Bản đăng ký công bố hợp quy (Mẫu Phụ lục IV)</strong>, phần mô tả đặc tính kỹ thuật chỉ kê khai <strong>cấu hình vi xử lý, dải tần/công suất thu phát vô tuyến và thông số nguồn điện DC 12V</strong>; <strong>KHÔNG ghi cứng kích thước vỏ cơ khí (mm) và khối lượng tịnh (kg)</strong> vào Bản công bố. Theo hướng dẫn chính thức của Bộ KH&amp;CN ngày 14/10/2026, cách ghi này giúp Tân Thanh Phương thay đổi quy cách đóng gói cơ khí bên ngoài (mẫu để bàn gọn hoặc mẫu tích hợp chân quầy) mà không bị coi là thay đổi nội dung Bản công bố phải đi công bố lại, miễn giữ nguyên bo mạch, module vô tuyến và nguồn cấp!
</div>

<div class="sec-title">4. LỘ TRÌNH 05 BƯỚC TRIỂN KHAI THỰC TẾ CHO TÂN THANH PHƯƠNG &amp; INUT</div>

<table class="data-tbl">
  <thead>
    <tr>
      <th style="width:11%">Bước / Mốc</th>
      <th style="width:24%">Đầu việc cụ thể</th>
      <th style="width:22%">Đơn vị phụ trách</th>
      <th style="width:43%">Đầu ra &amp; Hồ sơ sử dụng ngay</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Bước 1</strong><br/><em>Ngày 1–2</em></td>
      <td>Chốt Cấu hình Mẫu đo (PA1 hoặc PA2) &amp; Xác nhận tình trạng tờ <strong>ISO 9001:2015</strong></td>
      <td>BGĐ Tân Thanh Phương &amp; Kỹ thuật iNut</td>
      <td>- Xác nhận xem Tân Thanh Phương đã có ISO 9001 chu kỳ 2026–2029 chưa; nếu chưa thì đăng ký ghép cấp ISO 9001 tại <strong>TQC CGLOBAL</strong> (dựa trên hồ sơ ISO 27001 số <span class="mono">17232257/TQC.25.2916</span> tại xưởng <span class="mono">472 Nguyễn Trãi</span>).<br/>- Chốt PA1 (không 4G trong vỏ, ~45tr) hay PA2 (Full 4G + NFC trong vỏ, ~80tr).</td>
    </tr>
    <tr>
      <td><strong>Bước 2</strong><br/><em>Ngày 2–4</em></td>
      <td>Chuẩn bị <strong>02 mẫu phần cứng EUT</strong> + Nạp sẵn cổng điều khiển đo kiểm <span class="mono">:85</span></td>
      <td>Đội R&amp;D Phần cứng iNut</td>
      <td>- <strong>Mẫu #01 (Conducted RF):</strong> Đấu sẵn đầu SMA ra từ chân anten Wi-Fi/BLE (<span class="mono">SWT6621S</span>) và LTE (<span class="mono">A7680C</span> nếu chọn PA2), nạp sẵn Web UI đo kiểm <span class="mono">http://192.168.10.1:85</span>.<br/>- <strong>Mẫu #02 (Radiated EMC &amp; Safety):</strong> Nguyên chiếc thương mại dán sẵn <strong>Nhãn gốc VNMAP® AI ONE</strong> của Tân Thanh Phương + Adapter DC 12V đạt chuẩn IEC 62368-1.</td>
    </tr>
    <tr>
      <td><strong>Bước 3</strong><br/><em>Ngày 5–16</em></td>
      <td>Gửi mẫu thử nghiệm trực tiếp tại <strong>Phòng Lab chỉ định</strong> (VNTA Lab / Quatest 1)</td>
      <td>Tân Thanh Phương đứng tên Hợp đồng đo; Kỹ thuật iNut hỗ trợ Lab</td>
      <td>- Gửi kèm cuốn <strong>Hồ sơ Kỹ thuật &amp; Hướng dẫn Đo kiểm Phòng Lab</strong> (Tài liệu số 2 đính kèm, đã soạn sẵn 100% đứng tên Tân Thanh Phương).<br/>- Nhận bộ <strong>Phiếu kết quả thử nghiệm (Test Reports)</strong> chính thức mang tên <em>Công ty CP Đầu tư Phát triển Công nghệ Tân Thanh Phương</em>.</td>
    </tr>
    <tr>
      <td><strong>Bước 4</strong><br/><em>Ngày 17–21</em></td>
      <td>Chứng nhận Hợp quy <strong>Phương thức 3</strong> &amp; Miễn/Kết hợp đánh giá xưởng 472 Nguyễn Trãi</td>
      <td><strong>TQC CGLOBAL</strong> hoặc <strong>TT KĐ&amp;CN Cục Viễn thông</strong></td>
      <td>- Nộp Đơn đề nghị CNHQ Phương thức 3 + Phiếu đo Lab + Chứng chỉ ISO 9001 (hoặc biên bản đánh giá QTSX tại xưởng 472 Nguyễn Trãi).<br/>- Nhận <strong>Giấy Chứng nhận Hợp quy</strong> cho kiểu loại <strong>VNMAP AI ONE</strong>.</td>
    </tr>
    <tr>
      <td><strong>Bước 5</strong><br/><em>Ngày 22–25</em></td>
      <td>Đăng ký <strong>Công bố Hợp quy</strong> (Phụ lục IV &amp; V TT 14/2026) &amp; Dán dấu <strong>CR</strong> lưu thông</td>
      <td>Tân Thanh Phương ký số nộp trên Cổng CSDL Quốc gia TCĐLCL</td>
      <td>- Ký số <strong>Bản đăng ký công bố hợp quy (Phụ lục IV)</strong> + <strong>Báo cáo tự đánh giá (Phụ lục V)</strong> đã soạn sẵn ở Tài liệu số 2.<br/>- Nhận Thông báo tiếp nhận CBHQ, in chính thức <strong>Dấu hợp quy CR</strong> lên tem máy <strong>VNMAP® AI ONE</strong> để bàn giao &amp; nghiệm thu dự án!</td>
    </tr>
  </tbody>
</table>

<div class="callout callout-warn">
  <strong>KỊCH BẢN ĐÀM PHÁN ÉP GIÁ PHÒNG LAB / ĐƠN VỊ DỊCH VỤ (NẾU DÙNG ĐỐI TÁC DỊCH VỤ):</strong><br/>
  <em>"Bên anh (Công ty CP Đầu tư Phát triển Công nghệ Tân Thanh Phương — Nhà sản xuất trong nước tại xưởng 472 Nguyễn Trãi, Thanh Hóa) đã chuẩn bị sẵn đầy đủ 02 mẫu Conducted/Radiated kèm giao diện Web phát test mode cố định từng kênh Wi-Fi 2.4G/5G/BLE và hồ sơ kỹ thuật theo Thông tư 14/2026 &amp; 36/2026/TT-BKHCN. Máy dùng nguồn Adapter DC 12V không pin Lithium nên miễn QCVN 101; phần BLE công suất &lt; 8 dBm (&lt; 60 mW) nằm trong Chú thích (3) TT 36/2026 và chung băng 2.4GHz QCVN 54 nên không tính tách riêng 13,5 triệu; phần 4G (nếu đo) chỉ khóa đúng 4 băng LTE Cat.1 Data-Only B1/B3/B5/B8 không 2G/3G/VoLTE. Đề nghị báo giá sát phí niêm yết phòng Lab theo đúng danh mục QCVN đã chốt."</em>
</div>

</body>
</html>
"""


DOSSIER_HTML = f"""<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8"/>
<title>Hồ Sơ Kỹ Thuật &amp; Biểu Mẫu Đăng Ký Hợp Quy VNMAP AI ONE - Tân Thanh Phương</title>
<style>{COMMON_CSS}</style>
</head>
<body>
<div class="footer-str">HSKT-CBHQ-TTP-VNMAP-AIONE-2026 | Hồ sơ Kỹ thuật &amp; Biểu mẫu Đăng ký Hợp quy VNMAP® AI ONE — Công ty CP Đầu tư Phát triển Công nghệ Tân Thanh Phương</div>

<!-- COVER / HEADER -->
<div class="doc-banner">
  <div class="doc-banner-top">
    <div class="doc-banner-logo">
      <img src="{LOGO_URI}" alt="VNMAP"/>
    </div>
    <div class="doc-banner-org">
      <strong>CÔNG TY CỔ PHẦN ĐẦU TƯ PHÁT TRIỂN CÔNG NGHỆ TÂN THANH PHƯƠNG</strong><br/>
      Mã số doanh nghiệp / MST: <strong>2800817718</strong><br/>
      Trụ sở chính: Số 28 Cao Thắng, Phường Hạc Thành, Tỉnh Thanh Hóa, Việt Nam<br/>
      Nhà máy / Xưởng sản xuất: Số 472 Nguyễn Trãi, Phường Phú Sơn, TP. Thanh Hóa, Tỉnh Thanh Hóa
    </div>
  </div>
  <div class="doc-banner-title">HỒ SƠ KỸ THUẬT SẢN PHẨM, HƯỚNG DẪN ĐO KIỂM PHÒNG THỬ NGHIỆM &amp; BỘ BIỂU MẪU ĐĂNG KÝ CHỨNG NHẬN / CÔNG BỐ HỢP QUY</div>
  <p class="doc-banner-sub">Sản phẩm: <strong>Thiết bị đầu cuối AI xác thực định danh và hỗ trợ hành chính công thông minh</strong> &bull; Nhãn hiệu: <strong>VNMAP®</strong> &bull; Model: <strong>VNMAP AI ONE</strong></p>
  <table class="meta-grid">
    <tr>
      <td class="lbl">Mã hồ sơ kỹ thuật</td>
      <td><strong>HSKT-VNMAP-AIONE-2026</strong></td>
      <td class="lbl">Phiên bản / Ngày ban hành</td>
      <td><strong>Ver 1.0 — Tháng 11/2026</strong></td>
    </tr>
    <tr>
      <td class="lbl">Chủ sở hữu &amp; Nhà sản xuất</td>
      <td><strong>CÔNG TY CP ĐẦU TƯ PHÁT TRIỂN CÔNG NGHỆ TÂN THANH PHƯƠNG</strong></td>
      <td class="lbl">Xuất xứ hàng hóa</td>
      <td><strong>Sản xuất tại Việt Nam (Make in Vietnam)</strong></td>
    </tr>
    <tr>
      <td class="lbl">Mã HS tham chiếu</td>
      <td><strong>8471.41.90</strong> / 8517.62.59</td>
      <td class="lbl">Phương thức đánh giá</td>
      <td><strong>Phương thức 3 &amp; Tự đánh giá</strong> (TT 14/2026 &amp; TT 36/2026/TT-BKHCN)</td>
    </tr>
  </table>
</div>

<!-- PHẦN I: BẢN MÔ TẢ CHUNG & ĐẶC TẢ KỸ THUẬT -->
<div class="sec-title">PHẦN I. BẢN MÔ TẢ CHUNG &amp; ĐẶC TẢ KỸ THUẬT THIẾT BỊ (TECHNICAL SPECIFICATION)</div>

<div class="sub-title">1.1. Thông tin định danh sản phẩm và cơ sở sản xuất</div>
<table class="data-tbl">
  <tbody>
    <tr>
      <td style="width:30%"><strong>Tên sản phẩm, hàng hóa</strong></td>
      <td><strong>Thiết bị đầu cuối AI xác thực định danh và hỗ trợ hành chính công thông minh</strong><br/><em>(Tên tiếng Anh: Intelligent Public Administration &amp; Identity Verification AI Terminal)</em></td>
    </tr>
    <tr>
      <td><strong>Nhãn hiệu thương mại (Brand)</strong></td>
      <td><strong>VNMAP®</strong></td>
    </tr>
    <tr>
      <td><strong>Ký hiệu kiểu loại (Model)</strong></td>
      <td><strong>VNMAP AI ONE</strong></td>
    </tr>
    <tr>
      <td><strong>Tổ chức sản xuất &amp; đứng tên hợp quy</strong></td>
      <td><strong>CÔNG TY CỔ PHẦN ĐẦU TƯ PHÁT TRIỂN CÔNG NGHỆ TÂN THANH PHƯƠNG</strong><br/>- Mã số thuế: <strong>2800817718</strong> &bull; Điện thoại: <strong>0237 888 6868</strong> &bull; Email: <strong>gm@tanthanhphuong.vn</strong><br/>- Trụ sở đăng ký kinh doanh: Số 28 Cao Thắng, Phường Hạc Thành, Tỉnh Thanh Hóa, Việt Nam<br/>- Địa điểm cơ sở sản xuất, lắp ráp, KCS: <strong>Số 472 Nguyễn Trãi, Phường Phú Sơn, Thành phố Thanh Hóa, Tỉnh Thanh Hóa, Việt Nam</strong></td>
    </tr>
    <tr>
      <td><strong>Công dụng &amp; Phạm vi sử dụng</strong></td>
      <td>Thiết bị đầu cuối xử lý dữ liệu thông minh đặt tại quầy giao dịch Trung tâm Phục vụ Hành chính công, UBND cấp xã/phường, bệnh viện, ngân hàng và tòa nhà; hỗ trợ tra cứu thủ tục bằng giọng nói AI hai chiều, số hóa biểu mẫu, xác thực định danh điện tử và đồng bộ dữ liệu qua mạng LAN/Wi-Fi.</td>
    </tr>
    <tr>
      <td><strong>Nguồn điện cấp &amp; Cấu trúc an toàn</strong></td>
      <td>Sử dụng bộ đổi nguồn ngoài (External AC/DC Adapter): Ngõ vào <strong>100–240VAC, 50/60Hz</strong>; Ngõ ra một chiều <strong>DC 12V — 3.0A (hoặc 12V — 5.0A)</strong>.<br/><strong>Lưu ý cấu trúc an toàn:</strong> Thiết bị hoạt động cố định trên bàn quầy, <strong>KHÔNG tích hợp pin Lithium dự phòng bên trong thân máy</strong> (không thuộc đối tượng áp dụng QCVN 101:2020/BTTTT).</td>
    </tr>
  </tbody>
</table>

<div class="sub-title">1.2. Sơ đồ khối cấu trúc phần cứng &amp; Thông số kỹ thuật chi tiết</div>

<table class="data-tbl">
  <thead>
    <tr>
      <th style="width:26%">Khối chức năng</th>
      <th style="width:74%">Thông số kỹ thuật chuẩn đăng ký Hợp quy</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>1. Bộ xử lý trung tâm &amp; Bộ nhớ</strong></td>
      <td>Vi xử lý đa nhân kiến trúc ARM Cortex-A53/A55 64-bit tích hợp nhân tăng tốc AI NPU; RAM 4GB/8GB LPDDR4; Bộ nhớ lưu trữ eMMC 32GB/64GB; Hệ điều hành nhân Linux / Android Embedded bảo mật (cơ chế Zero-Data-Retention tự động xóa dữ liệu phiên giao dịch).</td>
    </tr>
    <tr>
      <td><strong>2. Giao diện hiển thị &amp; Ngoại vi</strong></td>
      <td>Giao tiếp HDMI / MIPI-DSI kết nối màn hình cảm ứng điện dung đa điểm IPS (hỗ trợ cấu hình màn hình kép giao dịch viên &amp; công dân); 01 cổng mạng LAN Gigabit RJ45 (10/100/1000 Mbps); các cổng USB 2.0/3.0 kết nối thiết bị ngoại vi (máy quét tài liệu, camera AI nhận diện khuôn mặt, bảng ký số điện tử, loa &amp; micro đa hướng khử ồn).</td>
    </tr>
    <tr>
      <td><strong>3. Khối thu phát vô tuyến Wi-Fi băng tần kép &amp; BLE</strong><br/><em>(Tích hợp tiêu chuẩn)</em></td>
      <td>
        - <strong>Chipset thu phát vô tuyến:</strong> Module tích hợp <span class="mono">Seekwave SWT6621S</span> (chuẩn IEEE 802.11b/g/n/ax &amp; Bluetooth Low Energy 5.3).<br/>
        - <strong>Băng tần Wi-Fi 2.4 GHz:</strong> <span class="mono">2400 MHz – 2483,5 MHz</span> (Kênh 1 đến Kênh 13; băng thông 20 MHz / 40 MHz; điều chế DSSS/CCK, OFDM, OFDMA; công suất bức xạ EIRP &le; 20 dBm / 100 mW &mdash; Phù hợp <strong>QCVN 54:2020/BTTTT</strong>).<br/>
        - <strong>Băng tần Wi-Fi 5 GHz:</strong> <span class="mono">5150–5350 MHz</span> &amp; <span class="mono">5725–5850 MHz</span> (Kênh 36–64 và 149–165; băng thông 20/40/80 MHz; điều chế OFDM/OFDMA; công suất EIRP &le; 23 dBm &mdash; Phù hợp <strong>QCVN 65:2021/BTTTT</strong>).<br/>
        - <strong>Bluetooth Low Energy (BLE 5.3):</strong> <span class="mono">2402 MHz – 2480 MHz</span> (40 kênh, GFSK, công suất phát EIRP &lt; 10 dBm / 10 mW &ll; 60 mW).
      </td>
    </tr>
    <tr>
      <td><strong>4. Tùy chọn mở rộng (chỉ áp dụng khi lắp đặt theo cấu hình mở rộng)</strong></td>
      <td>
        - <em>Tùy chọn 4A — Module truyền dữ liệu di động 4G LTE Cat.1bis (Data-Only):</em> Băng tần hoạt động FDD-LTE Band 1 (2100 MHz), Band 3 (1800 MHz), Band 5 (850 MHz), Band 8 (900 MHz); Power Class 3 (23 dBm &plusmn; 2dB); <strong>chỉ truyền dữ liệu gói (Data-Only), không hỗ trợ 2G GSM, không hỗ trợ 3G WCDMA, không hỗ trợ thoại VoLTE</strong> (Phù hợp <strong>QCVN 117:2023/BTTTT</strong> &amp; <strong>QCVN 86:2019/BTTTT</strong>).<br/>
        - <em>Tùy chọn 4B — Đầu đọc thẻ CCCD gắn chip không tiếp xúc NFC:</em> Tần số <span class="mono">13,553 – 13,567 MHz</span>, chuẩn ISO/IEC 14443 Type A/B (Phù hợp <strong>QCVN 55:2023/BTTTT</strong> &amp; <strong>QCVN 96:2015/BTTTT</strong>).
      </td>
    </tr>
    <tr>
      <td><strong>5. Điều kiện môi trường &amp; Quy trình KCS xuất xưởng</strong></td>
      <td>Nhiệt độ làm việc: 0&deg;C đến +45&deg;C; Độ ẩm tương đối: 10% – 90% (không ngưng tụ). 100% sản phẩm xuất xưởng tại Nhà máy <strong>472 Nguyễn Trãi, P. Phú Sơn, TP. Thanh Hóa</strong> được kiểm tra ngoại quan, an toàn điện nguồn DC 12V, hiệu năng NPU/LAN/Wi-Fi, gán số Serial Number duy nhất và lưu hồ sơ KCS theo hệ thống quản lý của Tân Thanh Phương.</td>
    </tr>
  </tbody>
</table>

<!-- PHẦN II: NHÃN HÀNG HÓA & DẤU HỢP QUY CR -->
<div class="sec-title">PHẦN II. MẪU NHÃN HÀNG HÓA GỐC &amp; THIẾT KẾ DẤU HỢP QUY (CR)</div>
<p>Mẫu nhãn kỹ thuật dán cố định trên thân thiết bị <strong>VNMAP® AI ONE</strong> tuân thủ đầy đủ quy định tại <strong>Nghị định số 43/2017/NĐ-CP</strong>, <strong>Nghị định số 111/2021/NĐ-CP</strong>, <strong>Nghị định số 37/2026/NĐ-CP</strong> và quy cách <strong>Dấu hợp quy CR</strong> tại <strong>Phụ lục I Thông tư số 14/2026/TT-BKHCN</strong>:</p>

<div class="label-card">
  <table style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="width:74%;vertical-align:top;padding-right:10px;border-right:1px dashed #94a3b8;">
        <div style="font-size:10.5pt;font-weight:800;color:#0f294a;margin-bottom:3px;">THIẾT BỊ ĐẦU CUỐI AI HỖ TRỢ HÀNH CHÍNH CÔNG</div>
        <div style="font-size:8.6pt;line-height:1.45;">
          &bull; <strong>Nhãn hiệu (Brand):</strong> VNMAP® &nbsp;&nbsp;|&nbsp;&nbsp; <strong>Kiểu loại (Model):</strong> VNMAP AI ONE<br/>
          &bull; <strong>Nguồn điện (Rating):</strong> DC 12V — 3.0A / 5.0A (Sử dụng kèm Adapter AC 100–240V ~ 50/60Hz)<br/>
          &bull; <strong>Kết nối vô tuyến:</strong> Wi-Fi 2.4GHz (2400–2483.5MHz) / 5GHz (5150–5350, 5725–5850MHz); BLE 5.3<br/>
          &bull; <strong>Số Serial (S/N):</strong> TTP-AIONE-2026-XXXX &nbsp;&nbsp;|&nbsp;&nbsp; <strong>Năm sản xuất:</strong> 2026<br/>
          &bull; <strong>Nhà sản xuất:</strong> <strong>CÔNG TY CP ĐẦU TƯ PHÁT TRIỂN CÔNG NGHỆ TÂN THANH PHƯƠNG</strong><br/>
          &bull; <strong>Trụ sở:</strong> Số 28 Cao Thắng, Phường Hạc Thành, Tỉnh Thanh Hóa, Việt Nam<br/>
          &bull; <strong>Sản xuất tại (Xưởng SX):</strong> Số 472 Nguyễn Trãi, P. Phú Sơn, TP. Thanh Hóa &bull; <strong>Xuất xứ: Việt Nam</strong>
        </div>
      </td>
      <td style="width:26%;vertical-align:middle;text-align:center;padding-left:8px;">
        <svg width="86" height="86" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
          <rect x="4" y="4" width="112" height="112" rx="6" fill="none" stroke="#0f172a" stroke-width="3.5"/>
          <circle cx="60" cy="52" r="36" fill="none" stroke="#0f172a" stroke-width="4"/>
          <text x="60" y="64" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="34" font-weight="bold" fill="#0f172a">CR</text>
          <text x="60" y="106" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="11.5" font-weight="bold" fill="#0f172a">2800817718</text>
        </svg>
        <div style="font-size:7pt;color:#475569;margin-top:2px;">Dấu hợp quy CR<br/>(Phụ lục I TT 14/2026/TT-BKHCN)</div>
      </td>
    </tr>
  </table>
</div>

<div class="page-break"></div>

<!-- PHẦN III: HƯỚNG DẪN ĐO KIỂM PHÒNG LAB -->
<div class="sec-title">PHẦN III. HƯỚNG DẪN ĐIỀU KHIỂN CHẾ ĐỘ ĐO KIỂM DÀNH CHO PHÒNG THỬ NGHIỆM (LAB TEST GUIDE)</div>

<p>Để hỗ trợ Kỹ thuật viên Phòng thử nghiệm được chỉ định thực hiện nhanh chóng các phép đo phát xạ/thu dẫn (Conducted) và bức xạ (Radiated) theo <strong>QCVN 54:2020/BTTTT</strong>, <strong>QCVN 65:2021/BTTTT</strong>, <strong>QCVN 112:2017/BTTTT</strong>, <strong>QCVN 118:2018/BTTTT</strong> (và <strong>QCVN 117:2023/BTTTT</strong>, <strong>QCVN 86:2019/BTTTT</strong> đối với cấu hình mở rộng 4G LTE), mẫu thử nghiệm <strong>VNMAP AI ONE</strong> đã được tích hợp sẵn <strong>Trình điều khiển Đo kiểm Hợp quy qua Giao diện Web cục bộ (cổng <span class="mono">:85</span>)</strong> không cần dùng lệnh dòng lệnh phức tạp:</p>

<table class="data-tbl">
  <thead>
    <tr>
      <th style="width:22%">Hạng mục đo kiểm</th>
      <th style="width:78%">Thao tác trực quan trên Giao diện Web Quản trị Đo kiểm (<span class="mono">http://&lt;IP-Thiết-Bị&gt;:85</span>)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>1. Kết nối ban đầu vào mẫu đo (EUT)</strong></td>
      <td>
        - Cấp nguồn DC 12V cho thiết bị <strong>VNMAP AI ONE</strong>, đợi ~35 giây để hệ thống khởi động hoàn tất.<br/>
        - Cắm cáp mạng LAN RJ45 từ máy tính điều khiển của Phòng Lab vào cổng LAN của mẫu đo (IP mặc định qua LAN: <span class="mono">http://192.168.10.1:85</span> hoặc xem địa chỉ IP hiển thị trên màn hình). Đăng nhập tài khoản kỹ thuật bàn giao kèm biên bản gửi mẫu.
      </td>
    </tr>
    <tr>
      <td><strong>2. Đo Wi-Fi 2.4 GHz</strong><br/><em>(QCVN 54:2020 &amp; QCVN 112:2017)</em></td>
      <td>
        - <strong>Chế độ phát liên tục / AP theo kênh cố định:</strong> Vào mục <strong>Tổng quan &rarr; Wi-Fi AP</strong> &rarr; Chọn Băng tần <span class="mono">2.4 GHz (802.11b/g/n/ax)</span> &rarr; Chọn Kênh đo chuẩn: <strong>Kênh 1 (2412 MHz)</strong>, <strong>Kênh 6 (2437 MHz)</strong> hoặc <strong>Kênh 13 (2472 MHz)</strong> &rarr; Nhấn <strong>Lưu &amp; Áp dụng</strong>.<br/>
        - <strong>Tắt phát sóng Wi-Fi tức thời (Idle/RX):</strong> Gạt công tắc <strong>Wi-Fi AP &rarr; TẮT</strong>. Hệ thống ngắt hoàn toàn sóng phát Wi-Fi trong 1 giây.
      </td>
    </tr>
    <tr>
      <td><strong>3. Đo Wi-Fi 5 GHz</strong><br/><em>(QCVN 65:2021 &amp; QCVN 112:2017)</em></td>
      <td>
        - Vào mục <strong>Tổng quan &rarr; Wi-Fi AP</strong> &rarr; Đổi Băng tần sang <span class="mono">5 GHz</span> &rarr; Chọn kênh cần đo theo yêu cầu bài đo:<br/>
          &bull; Băng U-NII-1 (5150–5250 MHz): <strong>Kênh 36 (5180 MHz)</strong>, <strong>Kênh 40 (5200 MHz)</strong>, <strong>Kênh 44 (5220 MHz)</strong>, <strong>Kênh 48 (5240 MHz)</strong>.<br/>
          &bull; Băng U-NII-3 (5725–5850 MHz): <strong>Kênh 149 (5745 MHz)</strong>, <strong>Kênh 157 (5785 MHz)</strong>, <strong>Kênh 165 (5825 MHz)</strong>.<br/>
        - Băng thông hỗ trợ chuyển đổi: <strong>20 MHz / 40 MHz / 80 MHz</strong>.
      </td>
    </tr>
    <tr>
      <td><strong>4. Đo Bluetooth BLE 5.3</strong><br/><em>(2402 – 2480 MHz)</em></td>
      <td>
        - Vào tab <strong>Nâng cao &rarr; Đo kiểm Hợp quy QCVN</strong>:<br/>
          &bull; <strong>Phát Quảng cáo BLE chuẩn (TX Advertising):</strong> Bấm nút <span class="mono">BLE TX Advertising</span>.<br/>
          &bull; <strong>Phát dữ liệu điều chế PRBS9 cố định kênh (RF Conducted):</strong> Sử dụng tiện ích <span class="mono">SW_ATCommand_Test</span> chọn kênh Đầu/Giữa/Cuối: <strong>Ch 0 (2402 MHz)</strong>, <strong>Ch 19 (2440 MHz)</strong>, <strong>Ch 39 (2480 MHz)</strong>, Payload <span class="mono">PRBS9</span>.<br/>
          &bull; <strong>Thu quét gói tin (RX / PER):</strong> Bấm nút <span class="mono">BLE RX Scan</span>.
      </td>
    </tr>
    <tr>
      <td><strong>5. Đo 4G LTE-FDD</strong><br/><em>(Chỉ áp dụng cho cấu hình mở rộng có lắp 4G)</em></td>
      <td>
        - Lắp Test USIM của máy đo tổng hợp Rohde &amp; Schwarz CMW500 / Anritsu MT8821C vào khe SIM.<br/>
        - Vào tab <strong>Nâng cao &rarr; Đo kiểm Hợp quy QCVN</strong>:<br/>
          &bull; Nhấn <span class="mono">Chế độ Chỉ 4G (Tắt hẳn Wi-Fi &amp; BLE)</span> để triệt tiêu can nhiễu chéo khi đo phát xạ giả &amp; EMC.<br/>
          &bull; Chọn khóa cứng từng băng tần đo: <strong>Lock B1 (2100 MHz)</strong>, <strong>Lock B3 (1800 MHz)</strong>, <strong>Lock B5 (850 MHz)</strong>, <strong>Lock B8 (900 MHz)</strong>. Thiết bị tự động bám trạm giả lập Base Station (LTE Cat.1bis Data-Only, miễn đo 2G/3G/VoLTE).
      </td>
    </tr>
    <tr>
      <td><strong>6. Khôi phục mặc định</strong></td>
      <td>Sau khi hoàn thành toàn bộ phép đo, nhấn nút màu xanh <span class="mono">Khôi phục Toàn bộ Mặc định Thương mại</span> tại tab Nâng cao.</td>
    </tr>
  </tbody>
</table>

<div class="page-break"></div>

<!-- PHẦN IV: ĐƠN ĐỀ NGHỊ CHỨNG NHẬN HỢP QUY PHƯƠNG THỨC 3 -->
<div class="sec-title">PHẦN IV. MẪU ĐƠN ĐỀ NGHỊ CHỨNG NHẬN HỢP QUY (PHƯƠNG THỨC 3 — DỰ THẢO KÝ NỘP)</div>

<div class="legal-form">
  <table class="legal-header-tbl">
    <tr>
      <td style="width:46%">
        <strong>CÔNG TY CP ĐẦU TƯ PHÁT TRIỂN<br/>CÔNG NGHỆ TÂN THANH PHƯƠNG</strong><br/>
        <span>Số: ………/2026/ĐĐN-TTP</span>
      </td>
      <td style="width:54%">
        <strong>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</strong><br/>
        <strong>Độc lập - Tự do - Hạnh phúc</strong><br/>
        <span>───────────────</span><br/>
        <em>Thanh Hóa, ngày …… tháng …… năm 2026</em>
      </td>
    </tr>
  </table>

  <div class="legal-title">GIẤY ĐĂNG KÝ CHỨNG NHẬN HỢP QUY SẢN PHẨM, HÀNG HÓA</div>
  <div class="legal-sub">(Theo Phương thức 3 quy định tại Thông tư số 14/2026/TT-BKHCN và Thông tư số 36/2026/TT-BKHCN)</div>

  <p class="legal-p"><strong>Kính gửi:</strong> <strong>Tổ chức Chứng nhận Hợp quy được chỉ định (TQC CGLOBAL / Trung tâm Kiểm định và Chứng nhận - Cục Viễn thông)</strong></p>

  <p class="legal-p"><strong>1. Tổ chức đề nghị chứng nhận:</strong> <strong>CÔNG TY CỔ PHẦN ĐẦU TƯ PHÁT TRIỂN CÔNG NGHỆ TÂN THANH PHƯƠNG</strong></p>
  <p class="legal-p">- Địa chỉ trụ sở chính: Số 28 Cao Thắng, Phường Hạc Thành, Tỉnh Thanh Hóa, Việt Nam.</p>
  <p class="legal-p">- Địa chỉ cơ sở sản xuất: Số 472 Nguyễn Trãi, Phường Phú Sơn, Thành phố Thanh Hóa, Tỉnh Thanh Hóa, Việt Nam.</p>
  <p class="legal-p">- Mã số doanh nghiệp / Mã số thuế: <strong>2800817718</strong> &nbsp;&nbsp;&nbsp;&nbsp; Điện thoại: <strong>0237 888 6868</strong> &nbsp;&nbsp;&nbsp;&nbsp; Email: <strong>gm@tanthanhphuong.vn</strong></p>

  <p class="legal-p"><strong>2. Đăng ký chứng nhận hợp quy cho sản phẩm sản xuất trong nước sau đây:</strong></p>
  <p class="legal-p">- Tên sản phẩm, hàng hóa: <strong>Thiết bị đầu cuối AI xác thực định danh và hỗ trợ hành chính công thông minh</strong></p>
  <p class="legal-p">- Nhãn hiệu: <strong>VNMAP®</strong> &nbsp;&nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;&nbsp; Ký hiệu kiểu loại (Model): <strong>VNMAP AI ONE</strong> &nbsp;&nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;&nbsp; Xuất xứ: <strong>Việt Nam</strong></p>
  <p class="legal-p">- Quy chuẩn kỹ thuật quốc gia đăng ký chứng nhận: <strong>QCVN 54:2020/BTTTT</strong>; <strong>QCVN 65:2021/BTTTT</strong> <em>[và QCVN 117:2023/BTTTT; QCVN 55:2023/BTTTT nếu đăng ký cấu hình mở rộng]</em>.</p>
  <p class="legal-p">- Phương thức đánh giá sự phù hợp: <strong>Phương thức 3</strong> (Thử nghiệm mẫu điển hình kết hợp đánh giá quá trình sản xuất; đề nghị xem xét miễn/kết hợp đánh giá quá trình sản xuất căn cứ Hệ thống quản lý chất lượng tại xưởng sản xuất Số 472 Nguyễn Trãi, P. Phú Sơn, TP. Thanh Hóa theo Chú thích (13) Thông tư số 36/2026/TT-BKHCN).</p>

  <p class="legal-p"><strong>3. Hồ sơ đính kèm:</strong> (1) Giấy chứng nhận ĐKDN số 2800817718; (2) Bản đặc tả kỹ thuật &amp; Mẫu nhãn hàng hóa VNMAP® AI ONE; (3) Hồ sơ hệ thống quản lý chất lượng xưởng sản xuất Số 472 Nguyễn Trãi; (4) Phiếu kết quả thử nghiệm của Phòng thử nghiệm được chỉ định số: ……………………………… cấp ngày ……/……/2026.</p>

  <p class="legal-p">Công ty Cổ phần Đầu tư Phát triển Công nghệ Tân Thanh Phương cam kết sản phẩm sản xuất hàng loạt phù hợp với mẫu điển hình đã thử nghiệm và tuân thủ đầy đủ các quy chuẩn kỹ thuật quốc gia tương ứng.</p>

  <table class="sig-tbl">
    <tr>
      <td style="width:48%"></td>
      <td style="width:52%">
        <strong>ĐẠI DIỆN HỢP PHÁP CỦA TỔ CHỨC</strong><br/>
        <em>(Ký, ghi rõ họ tên, chức vụ và đóng dấu)</em>
        <div class="sig-space"></div>
        <strong>GIÁM ĐỐC</strong>
      </td>
    </tr>
  </table>
</div>

<div class="page-break"></div>

<!-- PHẦN V: BẢN ĐĂNG KÝ CÔNG BỐ HỢP QUY (MẪU PHỤ LỤC IV - TT 14/2026/TT-BKHCN) -->
<div class="sec-title">PHẦN V. BẢN ĐĂNG KÝ CÔNG BỐ HỢP QUY &amp; BÁO CÁO TỰ ĐÁNH GIÁ (MẪU PHỤ LỤC IV &amp; V — TT 14/2026/TT-BKHCN)</div>

<div class="legal-form" style="margin-bottom:14px;">
  <div style="text-align:center;font-weight:bold;font-size:10.5pt;">
    CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM<br/>
    Độc lập - Tự do - Hạnh phúc<br/>
    ───────────────
  </div>

  <div class="legal-title">BẢN ĐĂNG KÝ CÔNG BỐ HỢP QUY</div>
  <div class="legal-sub">(Ban hành kèm theo Phụ lục IV — Thông tư số 14/2026/TT-BKHCN ngày 09/04/2026 của Bộ trưởng Bộ Khoa học và Công nghệ)<br/>Số: ………/2026/CBHQ-TTP</div>

  <p class="legal-p"><strong>Tên tổ chức, cá nhân:</strong> <strong>CÔNG TY CỔ PHẦN ĐẦU TƯ PHÁT TRIỂN CÔNG NGHỆ TÂN THANH PHƯƠNG</strong></p>
  <p class="legal-p"><strong>Địa chỉ:</strong> Số 28 Cao Thắng, Phường Hạc Thành, Tỉnh Thanh Hóa, Việt Nam <em>(Cơ sở sản xuất: Số 472 Nguyễn Trãi, Phường Phú Sơn, Thành phố Thanh Hóa, Tỉnh Thanh Hóa, Việt Nam)</em></p>
  <p class="legal-p"><strong>Điện thoại:</strong> 0237 888 6868 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <strong>Mã số doanh nghiệp:</strong> 2800817718 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <strong>E-mail:</strong> gm@tanthanhphuong.vn</p>

  <p class="legal-p" style="font-weight:bold;text-transform:uppercase;margin-top:8px;">CÔNG BỐ:</p>
  <p class="legal-p"><strong>Sản phẩm, hàng hóa:</strong> <strong>Thiết bị đầu cuối AI xác thực định danh và hỗ trợ hành chính công thông minh</strong><br/>
  - Nhãn hiệu: <strong>VNMAP®</strong> &nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp; Kiểu, loại (Model): <strong>VNMAP AI ONE</strong> &nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp; Xuất xứ: <strong>Việt Nam</strong><br/>
  - Đặc tính kỹ thuật chính: Thiết bị đầu cuối xử lý dữ liệu tích hợp thu phát vô tuyến băng tần 2.4 GHz (2400–2483,5 MHz), băng tần 5 GHz (5150–5350 MHz; 5725–5850 MHz), giao tiếp mạng LAN RJ45 Gigabit, sử dụng nguồn điện một chiều DC 12V cấp từ bộ đổi nguồn AC/DC ngoài (100–240VAC, 50/60Hz).</p>

  <p class="legal-p"><strong>Phù hợp với quy chuẩn kỹ thuật quốc gia:</strong><br/>
  - <strong>QCVN 54:2020/BTTTT</strong> — Quy chuẩn kỹ thuật quốc gia về thiết bị thu phát vô tuyến hoạt động trong băng tần 2,4 GHz;<br/>
  - <strong>QCVN 65:2021/BTTTT</strong> — Quy chuẩn kỹ thuật quốc gia về thiết bị truy nhập vô tuyến băng tần 5 GHz;<br/>
  - <strong>QCVN 112:2017/BTTTT</strong> — Quy chuẩn kỹ thuật quốc gia về tương thích điện từ đối với thiết bị vô tuyến truyền dữ liệu băng rộng;<br/>
  - <strong>QCVN 118:2018/BTTTT</strong> — Quy chuẩn kỹ thuật quốc gia về tương thích điện từ của thiết bị đa phương tiện — Yêu cầu phát xạ;<br/>
  - <strong>QCVN 132:2022/BTTTT</strong> — Quy chuẩn kỹ thuật quốc gia về an toàn điện đối với thiết bị đầu cuối viễn thông và công nghệ thông tin <em>[bổ sung QCVN 117:2023/BTTTT, QCVN 86:2019/BTTTT, QCVN 55:2023/BTTTT, QCVN 96:2015/BTTTT nếu công bố cấu hình mở rộng]</em>.</p>

  <p class="legal-p"><strong>Thông tin bổ sung (cơ sở công bố hợp quy, phương thức đánh giá sự phù hợp):</strong><br/>
  <strong>Hình thức đánh giá:</strong><br/>
  + <em>Tổ chức chứng nhận đánh giá (Phương thức 3):</em> Giấy chứng nhận hợp quy số ………………………… do …………………………………… cấp ngày ……/……/2026.<br/>
  + <em>Tự đánh giá của tổ chức, cá nhân:</em> Báo cáo tự đánh giá sự phù hợp số ………/2026/BCTĐG-TTP do Người đứng đầu tổ chức ký ngày ……/……/2026 căn cứ Kết quả thử nghiệm của Phòng thử nghiệm được chỉ định.</p>

  <p class="legal-p"><strong>Công ty Cổ phần Đầu tư Phát triển Công nghệ Tân Thanh Phương</strong> cam kết và chịu trách nhiệm về tính phù hợp của sản phẩm, hàng hóa <strong>Thiết bị đầu cuối AI xác thực định danh và hỗ trợ hành chính công thông minh (Nhãn hiệu: VNMAP®, Kiểu loại: VNMAP AI ONE)</strong> do mình sản xuất, kinh doanh, bảo quản, vận chuyển, sử dụng, khai thác.</p>

  <table class="sig-tbl">
    <tr>
      <td style="width:48%"></td>
      <td style="width:52%">
        <em>Thanh Hóa, ngày …… tháng …… năm 2026</em><br/>
        <strong>ĐẠI DIỆN TỔ CHỨC, CÁ NHÂN</strong><br/>
        <em>(Ký tên, chức vụ, đóng dấu)</em>
        <div class="sig-space"></div>
        <strong>GIÁM ĐỐC</strong>
      </td>
    </tr>
  </table>
</div>

<div class="page-break"></div>

<!-- MẪU PHỤ LỤC V: BÁO CÁO TỰ ĐÁNH GIÁ -->
<div class="legal-form">
  <table class="legal-header-tbl">
    <tr>
      <td style="width:48%">
        <strong>CÔNG TY CP ĐẦU TƯ PHÁT TRIỂN<br/>CÔNG NGHỆ TÂN THANH PHƯƠNG</strong><br/>
        <span>───────</span><br/>
        <span>Số: ………/2026/BCTĐG-TTP</span>
      </td>
      <td style="width:52%">
        <strong>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</strong><br/>
        <strong>Độc lập - Tự do - Hạnh phúc</strong><br/>
        <span>───────────────</span><br/>
        <em>Thanh Hóa, ngày …… tháng …… năm 2026</em>
      </td>
    </tr>
  </table>

  <div class="legal-title">BÁO CÁO TỰ ĐÁNH GIÁ SỰ PHÙ HỢP QUY CHUẨN KỸ THUẬT</div>
  <div class="legal-sub">(Ban hành kèm theo Phụ lục V — Thông tư số 14/2026/TT-BKHCN ngày 09/04/2026 của Bộ trưởng Bộ Khoa học và Công nghệ)</div>

  <p class="legal-p"><strong>1. Tên tổ chức, cá nhân; địa chỉ; điện thoại, e-mail:</strong><br/>
  - Tên tổ chức: <strong>CÔNG TY CỔ PHẦN ĐẦU TƯ PHÁT TRIỂN CÔNG NGHỆ TÂN THANH PHƯƠNG</strong> (MST: <strong>2800817718</strong>)<br/>
  - Địa chỉ trụ sở: Số 28 Cao Thắng, Phường Hạc Thành, Tỉnh Thanh Hóa, Việt Nam.<br/>
  - Địa chỉ cơ sở sản xuất: Số 472 Nguyễn Trãi, Phường Phú Sơn, Thành phố Thanh Hóa, Tỉnh Thanh Hóa, Việt Nam.<br/>
  - Điện thoại: 0237 888 6868 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; E-mail: gm@tanthanhphuong.vn</p>

  <p class="legal-p"><strong>2. Tên sản phẩm, hàng hóa:</strong><br/>
  - Tên sản phẩm: <strong>Thiết bị đầu cuối AI xác thực định danh và hỗ trợ hành chính công thông minh</strong><br/>
  - Nhãn hiệu: <strong>VNMAP®</strong> &nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp; Kiểu, loại (Model): <strong>VNMAP AI ONE</strong> &nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp; Nhà sản xuất: Công ty CP Đầu tư Phát triển Công nghệ Tân Thanh Phương (Xuất xứ: Việt Nam).</p>

  <p class="legal-p"><strong>3. Địa điểm và ngày đánh giá:</strong> Tại trụ sở Công ty CP Đầu tư Phát triển Công nghệ Tân Thanh Phương, ngày …… tháng …… năm 2026.</p>

  <p class="legal-p"><strong>4. Số hiệu quy chuẩn kỹ thuật áp dụng tự đánh giá:</strong><br/>
  <strong>QCVN 112:2017/BTTTT</strong>; <strong>QCVN 118:2018/BTTTT</strong>; <strong>QCVN 132:2022/BTTTT</strong> <em>[và QCVN 86:2019/BTTTT; QCVN 96:2015/BTTTT nếu áp dụng cấu hình mở rộng]</em> (theo Danh mục sản phẩm, hàng hóa có mức độ rủi ro trung bình tại Phụ lục II Thông tư số 36/2026/TT-BKHCN).</p>

  <p class="legal-p"><strong>5. Tên tổ chức thử nghiệm:</strong><br/>
  Phòng thử nghiệm được Bộ Khoa học và Công nghệ chỉ định / công nhận: …………………………………………………………………………………</p>

  <p class="legal-p"><strong>6. Đánh giá kết quả thử nghiệm theo quy chuẩn kỹ thuật áp dụng:</strong></p>
  <table class="data-tbl" style="font-family:'Times New Roman','Liberation Serif',serif;font-size:10pt;">
    <thead>
      <tr>
        <th style="width:7%">TT</th>
        <th style="width:28%">Số hiệu Quy chuẩn kỹ thuật</th>
        <th style="width:37%">Số Phiếu kết quả thử nghiệm &amp; Ngày cấp</th>
        <th style="width:28%">Kết quả đối chiếu yêu cầu QCVN</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>1</td>
        <td><strong>QCVN 112:2017/BTTTT</strong></td>
        <td>Số: ………………………… ngày ……/……/2026</td>
        <td>Đạt toàn bộ chỉ tiêu EMC vô tuyến</td>
      </tr>
      <tr>
        <td>2</td>
        <td><strong>QCVN 118:2018/BTTTT</strong></td>
        <td>Số: ………………………… ngày ……/……/2026</td>
        <td>Đạt toàn bộ chỉ tiêu phát xạ EMC</td>
      </tr>
      <tr>
        <td>3</td>
        <td><strong>QCVN 132:2022/BTTTT</strong></td>
        <td>Số: ………………………… ngày ……/……/2026</td>
        <td>Đạt toàn bộ chỉ tiêu an toàn điện</td>
      </tr>
    </tbody>
  </table>

  <p class="legal-p"><strong>7. Các thông tin khác (nếu có):</strong> Hệ thống quản lý tại xưởng sản xuất Số 472 Nguyễn Trãi, Phường Phú Sơn, TP. Thanh Hóa duy trì kiểm soát chất lượng xuất xưởng 100% sản phẩm trước khi lưu thông trên thị trường (Chứng chỉ ISO/IEC 27001:2022 số 17232257/TQC.25.2916 còn hiệu lực đến 15/04/2028 và quy trình KCS nội bộ).</p>

  <p class="legal-p"><strong>8. Kết luận:</strong><br/>
  &#9745; <strong>Sản phẩm, hàng hóa phù hợp với quy chuẩn kỹ thuật.</strong><br/>
  &#9744; Sản phẩm, hàng hóa không phù hợp với quy chuẩn kỹ thuật.</p>

  <p class="legal-p">Công ty Cổ phần Đầu tư Phát triển Công nghệ Tân Thanh Phương cam kết bảo đảm sản phẩm, hàng hóa phù hợp với các quy chuẩn kỹ thuật, tiêu chuẩn đã công bố áp dụng và hoàn toàn chịu trách nhiệm trước pháp luật về chất lượng sản phẩm, hàng hóa và kết quả tự đánh giá.</p>

  <table class="sig-tbl">
    <tr>
      <td style="width:48%">
        <strong>NGƯỜI ĐÁNH GIÁ</strong><br/>
        <em>(Ký và ghi rõ họ, tên)</em>
        <div class="sig-space"></div>
        <strong>Phụ trách Kỹ thuật / KCS</strong>
      </td>
      <td style="width:52%">
        <strong>XÁC NHẬN CỦA NGƯỜI ĐỨNG ĐẦU TỔ CHỨC</strong><br/>
        <em>(Ký tên, chức vụ, đóng dấu)</em>
        <div class="sig-space"></div>
        <strong>GIÁM ĐỐC</strong>
      </td>
    </tr>
  </table>
</div>

</body>
</html>
"""


def main() -> None:
    out1 = BASE_DIR / "Phuong-An-Chien-Luoc-Hop-Quy-QCVN-VNMAP-AI-ONE-Tan-Thanh-Phuong-2026.pdf"
    out2 = BASE_DIR / "Ho-So-Ky-Thuat-Va-Bieu-Mau-Dang-Ky-Hop-Quy-VNMAP-AI-ONE-Tan-Thanh-Phuong.pdf"

    (BASE_DIR / "strategy.html").write_text(STRATEGY_HTML, encoding="utf-8")
    (BASE_DIR / "dossier.html").write_text(DOSSIER_HTML, encoding="utf-8")

    weasyprint.HTML(string=STRATEGY_HTML, base_url=str(BASE_DIR)).write_pdf(str(out1))
    weasyprint.HTML(string=DOSSIER_HTML, base_url=str(BASE_DIR)).write_pdf(str(out2))

    print(f"Rendered: {out1} ({out1.stat().st_size:,} bytes)")
    print(f"Rendered: {out2} ({out2.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
