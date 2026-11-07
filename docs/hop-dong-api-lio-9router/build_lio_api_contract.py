#!/usr/bin/env python3
"""
Bộ công cụ sinh Hồ sơ Hợp đồng Khung, Báo giá & Brief Kỹ thuật, và Phụ lục Gói cước + Báo cáo Usage hằng tháng
cho Dịch vụ Cổng kết nối API Trí tuệ Nhân tạo (AI Gateway / 9Router) giữa:
- BÊN CUNG CẤP DỊCH VỤ (BÊN A): HỘ KINH DOANH CÔNG NGHỆ LIO (MST: 054202003668)
- BÊN SỬ DỤNG DỊCH VỤ (BÊN B): CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT (MST: 4401053694)

Xuất 03 tài liệu PDF chuẩn A4 (WeasyPrint):
1. 01-Bao-Gia-Va-Brief-Dich-Vu-API-AI-9Router-LIO-2026.pdf
2. 02-Hop-Dong-Khung-Dich-Vu-API-AI-01-11-2026-INUT-LIO.pdf
3. 03-Phu-Luc-01-Thang-11-2026-Va-Mau-Bao-Cao-Usage-API-LIO-INUT.pdf
"""

from __future__ import annotations

import argparse
from pathlib import Path
import weasyprint
import pypdf

BASE_DIR = Path(__file__).resolve().parent

COMMON_CSS = """
@page {
  size: A4 portrait;
  margin: 7mm 10.5mm 8mm 10.5mm;
  @bottom-left {
    content: string(doc_footer_left);
    font-family: 'DejaVu Serif', 'Times New Roman', serif;
    font-size: 7.5pt;
    font-style: italic;
    color: #475569;
  }
  @bottom-right {
    content: "Trang " counter(page) " / " counter(pages);
    font-family: 'DejaVu Serif', 'Times New Roman', serif;
    font-size: 8pt;
    font-weight: bold;
    color: #1e293b;
  }
}

* {
  box-sizing: border-box;
}

body {
  font-family: 'DejaVu Serif', 'Times New Roman', serif;
  font-size: 7.9pt;
  line-height: 1.15;
  color: #111827;
  margin: 0;
  padding: 0;
}

.footer-str {
  string-set: doc_footer_left content();
  display: none;
}

.nat-header {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 5px;
}

.nat-header td {
  vertical-align: top;
  text-align: center;
  padding: 0;
}

.org-name {
  font-size: 9pt;
  font-weight: bold;
  text-transform: uppercase;
  color: #0f172a;
  line-height: 1.22;
}

.org-sub {
  font-size: 8.4pt;
  margin-top: 1px;
  color: #334155;
}

.nat-title {
  font-size: 9.6pt;
  font-weight: bold;
  text-transform: uppercase;
  color: #0f172a;
}

.nat-motto {
  font-size: 9.3pt;
  font-weight: bold;
  color: #0f172a;
  margin-top: 1px;
}

.nat-line {
  display: inline-block;
  border-bottom: 1px solid #0f172a;
  padding-bottom: 1px;
}

.doc-date {
  font-size: 8.5pt;
  font-style: italic;
  margin-top: 2px;
  color: #334155;
}

h1.main-title {
  text-align: center;
  font-size: 11pt;
  font-weight: bold;
  text-transform: uppercase;
  color: #0f172a;
  margin: 2px 0 1px 0;
  line-height: 1.15;
}

.sub-title-center {
  text-align: center;
  font-size: 8.3pt;
  font-style: italic;
  color: #334155;
  margin-bottom: 3px;
}

.basis-box {
  font-size: 8.1pt;
  font-style: italic;
  text-align: justify;
  margin-bottom: 3px;
  color: #1e293b;
}

.party-box {
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  border-radius: 4px;
  padding: 3px 6px;
  margin-bottom: 3px;
  page-break-inside: avoid;
}

.party-head {
  font-size: 9pt;
  font-weight: bold;
  text-transform: uppercase;
  color: #0f3d68;
  border-bottom: 1px solid #cbd5e1;
  padding-bottom: 2px;
  margin-bottom: 2px;
}

.party-tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 8.2pt;
}

.party-tbl td {
  padding: 1px 2px;
  vertical-align: top;
}

.party-tbl td.k {
  width: 22%;
  font-weight: bold;
  color: #1e293b;
}

.party-tbl td.s {
  width: 2%;
  text-align: center;
}

.sec-heading {
  font-size: 8.9pt;
  font-weight: bold;
  text-transform: uppercase;
  color: #0f3d68;
  margin-top: 3.5px;
  margin-bottom: 1.5px;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 1px;
  page-break-after: avoid;
}

.sub-heading {
  font-size: 9pt;
  font-weight: bold;
  color: #1e293b;
  margin-top: 3px;
  margin-bottom: 1px;
  page-break-after: avoid;
}

p {
  margin: 1.5px 0;
  text-align: justify;
}

ul.tight-list {
  margin: 1px 0 2px 0;
  padding-left: 14px;
}

ul.tight-list li {
  margin-bottom: 1px;
  text-align: justify;
}

table.tbl {
  width: 100%;
  border-collapse: collapse;
  margin: 2px 0 3px 0;
  font-size: 7.5pt;
}

table.tbl tr {
  page-break-inside: avoid;
}

table.tbl th, table.tbl td {
  border: 1px solid #475569;
  padding: 1.5px 3px;
  vertical-align: top;
}

table.tbl th {
  background-color: #e2e8f0;
  color: #0f172a;
  font-weight: bold;
  text-align: center;
}

table.tbl td.c {
  text-align: center;
}

table.tbl td.r {
  text-align: right;
}

.callout-info {
  background: #f0f9ff;
  border-left: 3px solid #0284c7;
  padding: 3px 6px;
  margin: 2.5px 0;
  font-size: 8pt;
  page-break-inside: avoid;
}

.callout-warn {
  background: #fffbeb;
  border-left: 3px solid #d97706;
  padding: 4px 7px;
  margin: 3.5px 0;
  font-size: 8.4pt;
  page-break-inside: avoid;
}

.badge {
  display: inline-block;
  padding: 0.5px 4px;
  border-radius: 3px;
  font-size: 7.5pt;
  font-weight: bold;
  background: #e0f2fe;
  color: #0369a1;
}

.sig-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 4px;
  page-break-inside: avoid;
}

.sig-table td {
  width: 50%;
  text-align: center;
  vertical-align: top;
}

.sig-role {
  font-size: 9.2pt;
  font-weight: bold;
  text-transform: uppercase;
  color: #0f172a;
}

.sig-note {
  font-size: 8pt;
  font-style: italic;
  color: #475569;
  margin-top: 1px;
}

.sig-space {
  height: 32px;
}

.sig-name {
  font-size: 9.2pt;
  font-weight: bold;
  text-transform: uppercase;
  color: #0f172a;
}

.page-break {
  page-break-before: always;
}

code {
  font-family: 'DejaVu Sans Mono', monospace;
  font-size: 7.7pt;
  background: #f1f5f9;
  padding: 0.5px 2.5px;
  border-radius: 2px;
}
"""


# ---------------------------------------------------------------------------
# DOCUMENT 1: BÁO GIÁ & BRIEF KỸ THUẬT CỔNG API TRÍ TUỆ NHÂN TẠO (9ROUTER)
# ---------------------------------------------------------------------------
def build_quotation_brief_html() -> str:
    return f"""<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8"/>
<title>Báo Giá & Brief Kỹ Thuật Dịch Vụ Cổng API Trí Tuệ Nhân Tạo (9Router) - Hộ Kinh Doanh Công Nghệ LIO</title>
<style>{COMMON_CSS}</style>
</head>
<body>
<div class="footer-str">HỘ KINH DOANH CÔNG NGHỆ LIO (MST: 054202003668) — Hồ sơ Báo giá &amp; Brief Kỹ thuật Cổng API AI (9Router)</div>

<table class="nat-header">
  <tr>
    <td style="width:48%;">
      <div class="org-name">HỘ KINH DOANH CÔNG NGHỆ LIO</div>
      <div class="org-sub">MST: <strong>054202003668</strong></div>
      <div class="org-sub">Số: <strong>0111/2026/BG-LIO-INUT</strong></div>
    </td>
    <td style="width:52%;">
      <div class="nat-title">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
      <div class="nat-motto"><span class="nat-line">Độc lập – Tự do – Hạnh phúc</span></div>
      <div class="doc-date">Đắk Lắk, ngày 01 tháng 11 năm 2026</div>
    </td>
  </tr>
</table>

<h1 class="main-title">BẢNG BÁO GIÁ &amp; ĐỀ XUẤT KỸ THUẬT (SERVICE BRIEF)<br/>GÓI DỊCH VỤ CỔNG KẾT NỐI API TRÍ TUỆ NHÂN TẠO ĐA MÔ HÌNH (AI ROUTING GATEWAY)</h1>
<div class="sub-title-center">(Áp dụng mô hình Thuê bao trọn gói trả trước hằng tháng kèm Báo cáo đối soát Usage định kỳ từ ngày 01/11/2026)</div>

<div class="party-box">
  <div class="party-head">KÍNH GỬI (KHÁCH HÀNG DOANH NGHIỆP): CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT</div>
  <table class="party-tbl">
    <tr><td class="k">Mã số thuế</td><td class="s">:</td><td><strong>4401053694</strong></td></tr>
    <tr><td class="k">Địa chỉ trụ sở</td><td class="s">:</td><td>161 Trường Chinh, Phường Tuy Hòa, Tỉnh Đắk Lắk, Việt Nam</td></tr>
    <tr><td class="k">Người đại diện</td><td class="s">:</td><td>Ông <strong>NGÔ HUỲNH NGỌC KHÁNH</strong> &nbsp;&mdash;&nbsp; Chức vụ: <strong>Giám đốc</strong> (ĐT: 0972 768 491)</td></tr>
    <tr><td class="k">Đơn vị chào giá</td><td class="s">:</td><td><strong>HỘ KINH DOANH CÔNG NGHỆ LIO</strong> (MST: <strong>054202003668</strong> &bull; Đại diện: Ông <strong>HUỲNH ĐỨC NHÂM</strong> – Chủ hộ kinh doanh &bull; Đ/c: 22 đường 3/2, KP Phú Thạnh 2, P. Phú Yên, tỉnh Đắk Lắk)</td></tr>
  </table>
</div>

<div class="sec-heading">PHẦN I. TỔNG QUAN GIẢI PHÁP &amp; DANH MỤC HẠNG MỤC KỸ THUẬT CUNG CẤP (AI GATEWAY BRIEF)</div>
<p>Nhằm đáp ứng nhu cầu sử dụng năng lực tính toán Trí tuệ Nhân tạo (AI/LLM) tần suất cao phục vụ hoạt động Nghiên cứu &amp; Phát triển (R&amp;D), tự động hóa xử lý chứng từ – hải quan – đấu thầu (<strong>KSP PDFSign</strong>), vận hành Kiosk Hành chính công thông minh (<strong>VNMAP AI ONE</strong>), Hệ thống Bãi đỗ xe AI (<strong>VNMAP Parking</strong>), Nền tảng IoT/SCADA (<strong>iNut AppHub / iNut Smartcity</strong>) và trợ lý tác nhân AI nội bộ, <strong>Hộ kinh doanh Công nghệ LIO</strong> trân trọng đề xuất gói dịch vụ <strong>Cổng định tuyến và kết nối API Trí tuệ Nhân tạo hợp nhất (9Router AI Gateway)</strong> gồm <strong>07 hạng mục kỹ thuật cốt lõi</strong> sau:</p>

<table class="tbl">
  <thead>
    <tr>
      <th style="width:5%;">TT</th>
      <th style="width:25%;">Hạng mục Dịch vụ API</th>
      <th style="width:26%;">Chuẩn Giao thức / Endpoint &amp;<br/>Mã định tuyến nội bộ 9Router<br/><em>(Model Alias / Combo Profile)</em></th>
      <th style="width:44%;">Mô tả Chức năng Kỹ thuật &amp; Ứng dụng đầu vào tại Công ty INUT</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td class="c"><strong>01</strong></td>
      <td><strong>Cổng định tuyến AI hợp nhất &amp; Chuyển mạch tự động</strong><br/><em>(Unified AI Routing &amp; Fusion Combo)</em></td>
      <td>
        <code>POST /v1/chat/completions</code><br/>
        <code>POST /v1/messages</code><br/>
        <code>POST /v1/responses</code><br/>
        <code>GET /v1/models</code>
      </td>
      <td>Cung cấp 01 chuẩn giao tiếp REST/SSE tương thích OpenAI &amp; Anthropic duy nhất; tự động biên dịch chéo giao thức (<em>Format Translator</em>), cân bằng tải đa tài khoản và chuyển mạch dự phòng tức thời (<em>Auto-Fallback Combos</em>: <code>pymid</code>, <code>gpt</code>, <code>hermes</code>, <code>opus-inut</code>, <code>sonnet</code>, <code>argon</code>, <code>for-plan</code>, <code>inut</code>) đảm bảo uptime dịch vụ liên tục 24/7.</td>
    </tr>
    <tr>
      <td class="c"><strong>02</strong></td>
      <td><strong>API Mô hình Ngôn ngữ Lớn &amp; Suy luận Chuyên sâu</strong><br/><em>(LLM Chat, Code-Gen &amp; Deep Reasoning)</em></td>
      <td>
        <em>Mã định tuyến nội bộ 9Router (Model Alias / Combo Profile):</em><br/>
        <code>gemini-4-argon-high-400k</code>, <code>gemini-3.8-flash-high</code>, <code>claude-opus-5-5-high-400k</code>, <code>gpt-6.1-sol</code> / <code>gpt-6-astra</code>
      </td>
      <td>Xử lý ngôn ngữ tự nhiên cửa sổ ngữ cảnh lớn (<code>200K &ndash; 1M tokens</code>) với 06 cấp độ suy luận (<code>low</code>, <code>medium</code>, <code>high</code>, <code>xhigh</code>, <code>max</code>, <code>ultra</code>). Phục vụ sinh thuyết minh kỹ thuật, phân tích hồ sơ mời thầu e-GP, rà soát hợp đồng, đối soát hóa đơn thuế – tờ khai hải quan và lập trình tự động Firmware/SCADA.</td>
    </tr>
    <tr>
      <td class="c"><strong>03</strong></td>
      <td><strong>Nén Ngữ cảnh &amp; Bộ nhớ đệm Token thông minh</strong><br/><em>(RTK Token Saver &amp; Context Caching)</em></td>
      <td>
        <code>POST /v1/responses/compact</code><br/>
        <code>POST /v1/messages/count_tokens</code><br/>
        <code>RTK Pre-Translate Hook</code>
      </td>
      <td>Cơ chế tiền xử lý nén kết quả công cụ (<em>RTK Token Compression</em>) và lưu trữ ngữ cảnh đệm (<em>Prompt Cache Read/Creation</em>) giúp giảm từ 35% &ndash; 60% lượng token tiêu thụ lặp lại trong các phiên làm việc dài của kỹ sư và hệ thống Agent tự động.</td>
    </tr>
    <tr>
      <td class="c"><strong>04</strong></td>
      <td><strong>API Giọng nói AI Đa ngôn ngữ (TTS &amp; STT)</strong><br/><em>(Speech Synthesis &amp; Transcription)</em></td>
      <td>
        <code>POST /v1/audio/speech</code><br/>
        <code>POST /v1/audio/transcriptions</code><br/>
        <code>GET /v1/audio/voices</code>
      </td>
      <td>Tổng hợp giọng đọc Tiếng Việt tự nhiên (<code>google-tts/vi</code>, <code>edge-tts/vi-VN-HoaiMyNeural</code>, <code>kokoro</code>) phát loa thông báo Kiosk hành chính công <strong>VNMAP AI ONE</strong>, loa cảnh báo BLE và chuyển đổi giọng nói sang văn bản (STT) tại quầy giao dịch.</td>
    </tr>
    <tr>
      <td class="c"><strong>05</strong></td>
      <td><strong>API Thị giác Máy tính, Ảnh &amp; Video AI</strong><br/><em>(Vision OCR, Image &amp; Video Gen)</em></td>
      <td>
        <code>GET /v1/models/image-to-text</code><br/>
        <code>POST /v1/images/generations</code><br/>
        <code>POST /v1/videos/generations</code>
      </td>
      <td>Nhận diện hình ảnh đa phương thức (<em>Vision</em>): tự động đọc Captcha Cổng Thuế GDT / Hải quan, trích xuất thông tin CCCD, nhận diện biển số &amp; phương tiện, sinh hình ảnh minh họa giao diện/tài liệu kỹ thuật và dựng video mô phỏng sản phẩm.</td>
    </tr>
    <tr>
      <td class="c"><strong>06</strong></td>
      <td><strong>API Vector hóa (Embeddings) &amp; Truy vấn Web</strong><br/><em>(RAG Embeddings, Web Search &amp; Fetch)</em></td>
      <td>
        <code>POST /v1/embeddings</code><br/>
        <code>POST /v1/search</code><br/>
        <code>POST /v1/web/fetch</code>
      </td>
      <td>Tạo vector nhúng (<em>Embeddings</em>) phục vụ cơ sở dữ liệu tri thức nội bộ (tra cứu văn bản pháp luật, QCVN, datasheet thiết bị); tìm kiếm thông tin web thời gian thực và trích xuất nội dung URL chuẩn Markdown sạch cho AI Agent.</td>
    </tr>
    <tr>
      <td class="c"><strong>07</strong></td>
      <td><strong>Quản trị Khóa API, Cụm Proxy &amp; Báo cáo Usage</strong><br/><em>(API Keys, Proxy Pools &amp; Monthly Usage Report)</em></td>
      <td>
        <code>Bearer sk-...</code> (Multi-Key)<br/>
        <code>Smart Proxy Pools</code><br/>
        <code>Monthly Usage Telemetry</code>
      </td>
      <td>Phân quyền khóa API độc lập cho từng dự án/phòng ban của INUT (<code>ksp-inut-crm-pdf-signer</code>, <code>apphub-iot</code>, <code>apphub vnmap3d</code>, <code>inut-opc-inut-dev</code>, <code>chatbox-telegram-vnmap</code>...); định tuyến qua dải Proxy tĩnh chống nghẽn IP và xuất <strong>Báo cáo Usage chi tiết hằng tháng</strong>.</td>
    </tr>
  </tbody>
</table>

<div class="sec-heading">PHẦN II. BIỂU PHÍ CÁC GÓI THUÊ BAO THÁNG TRẢ TRƯỚC (PREPAID MONTHLY SUBSCRIPTION TIERS)</div>
<p>Tương tự cơ chế tính phí theo bậc định mức của dịch vụ kế toán doanh nghiệp, dịch vụ API Trí tuệ Nhân tạo được cung cấp theo <strong>Gói thuê bao trọn gói trả trước hằng tháng</strong> (<strong>không áp dụng hình thức Pay-as-you-go trả sau phức tạp</strong>). Đầu mỗi tháng, hai Bên căn cứ nhu cầu vận hành thực tế để ký <strong>Phụ lục xác nhận gói dịch vụ và mức phí áp dụng của tháng đó</strong> theo biểu khung từ <strong>3.000.000 đồng/tháng đến 30.000.000 đồng/tháng</strong> như sau:</p>

<table class="tbl">
  <thead>
    <tr>
      <th style="width:9%;">Mã Gói<br/>(Bậc)</th>
      <th style="width:21%;">Tên Gói Thuê Bao Tháng</th>
      <th style="width:16%;">Định mức Requests / Tháng</th>
      <th style="width:19%;">Định mức Tổng Tokens / Tháng<br/><em>(Input + Output + Cache + Reasoning)</em></th>
      <th style="width:18%;">Quyền hạn Kỹ thuật &amp; Số lượng API Keys</th>
      <th style="width:17%;">Mức Phí Trọn Gói / Tháng (VNĐ)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td class="c"><strong>AI-01</strong><br/><em>(Bậc 1)</em></td>
      <td><strong>Gói Cơ Bản</strong><br/><em>(Starter API Tier)</em></td>
      <td class="c">Đến <strong>30.000</strong><br/>requests/tháng</td>
      <td class="c">Đến <strong>3,0 tỷ</strong> tokens<br/>(<code>&le; 3.0B tokens</code>)</td>
      <td>Tối đa 05 API Keys &bull; LLM Chat/Code cơ bản, Embeddings, TTS/STT tiêu chuẩn</td>
      <td class="r"><strong>3.000.000 đ</strong></td>
    </tr>
    <tr>
      <td class="c"><strong>AI-02</strong><br/><em>(Bậc 2)</em></td>
      <td><strong>Gói Tiêu Chuẩn</strong><br/><em>(Standard API Tier)</em></td>
      <td class="c"><strong>30.001 &ndash; 60.000</strong><br/>requests/tháng</td>
      <td class="c"><strong>3,0 tỷ &ndash; 5,0 tỷ</strong> tokens<br/>(<code>3.0B &ndash; 5.0B tokens</code>)</td>
      <td>Tối đa 10 API Keys &bull; Mở khóa Vision OCR, Web Search/Fetch, RTK Token Saver</td>
      <td class="r"><strong>5.000.000 đ</strong></td>
    </tr>
    <tr>
      <td class="c"><strong>AI-03</strong><br/><em>(Bậc 3)</em></td>
      <td><strong>Gói Nghiệp Vụ</strong><br/><em>(Business API Tier)</em></td>
      <td class="c"><strong>60.001 &ndash; 100.000</strong><br/>requests/tháng</td>
      <td class="c"><strong>5,0 tỷ &ndash; 8,0 tỷ</strong> tokens<br/>(<code>5.0B &ndash; 8.0B tokens</code>)</td>
      <td>Tối đa 15 API Keys &bull; Mở khóa Fusion Combo Auto-Fallback &amp; Reasoning <code>high</code></td>
      <td class="r"><strong>8.000.000 đ</strong></td>
    </tr>
    <tr>
      <td class="c"><strong>AI-04</strong><br/><em>(Bậc 4)</em></td>
      <td><strong>Gói Chuyên Nghiệp</strong><br/><em>(Pro API Tier)</em></td>
      <td class="c"><strong>100.001 &ndash; 150.000</strong><br/>requests/tháng</td>
      <td class="c"><strong>8,0 tỷ &ndash; 12,0 tỷ</strong> tokens<br/>(<code>8.0B &ndash; 12.0B tokens</code>)</td>
      <td>Tối đa 20 API Keys &bull; Reasoning <code>xhigh</code>, Image Gen, Smart Proxy Pools dự phòng</td>
      <td class="r"><strong>12.000.000 đ</strong></td>
    </tr>
    <tr>
      <td class="c"><strong>AI-05</strong><br/><em>(Bậc 5)</em></td>
      <td><strong>Gói Tăng Trưởng</strong><br/><em>(Growth API Tier)</em></td>
      <td class="c"><strong>150.001 &ndash; 220.000</strong><br/>requests/tháng</td>
      <td class="c"><strong>12,0 tỷ &ndash; 16,0 tỷ</strong> tokens<br/>(<code>12.0B &ndash; 16.0B tokens</code>)</td>
      <td>Tối đa 25 API Keys &bull; Ưu tiên tốc độ <code>Fast Priority 1.5x</code>, Đa tác nhân Multi-Agent</td>
      <td class="r"><strong>16.000.000 đ</strong></td>
    </tr>
    <tr>
      <td class="c"><strong>AI-06</strong><br/><em>(Bậc 6)</em></td>
      <td><strong>Gói Doanh Nghiệp I</strong><br/><em>(Enterprise I Tier)</em></td>
      <td class="c"><strong>220.001 &ndash; 300.000</strong><br/>requests/tháng</td>
      <td class="c"><strong>16,0 tỷ &ndash; 20,0 tỷ</strong> tokens<br/>(<code>16.0B &ndash; 20.0B tokens</code>)</td>
      <td>Tối đa 35 API Keys &bull; Trọn bộ 07 hạng mục + Video Gen + Ngữ cảnh <code>400K-1M</code></td>
      <td class="r"><strong>20.000.000 đ</strong></td>
    </tr>
    <tr>
      <td class="c"><strong>AI-07</strong><br/><em>(Bậc 7)</em></td>
      <td><strong>Gói Doanh Nghiệp II</strong><br/><em>(Enterprise II Tier)</em></td>
      <td class="c"><strong>300.001 &ndash; 380.000</strong><br/>requests/tháng</td>
      <td class="c"><strong>20,0 tỷ &ndash; 25,0 tỷ</strong> tokens<br/>(<code>20.0B &ndash; 25.0B tokens</code>)</td>
      <td>Tối đa 50 API Keys &bull; Luồng định tuyến ưu tiên riêng (Dedicated Combo &amp; Proxy)</td>
      <td class="r"><strong>25.000.000 đ</strong></td>
    </tr>
    <tr>
      <td class="c"><strong>AI-08</strong><br/><em>(Bậc 8)</em></td>
      <td><strong>Gói Hạ Tầng Toàn Diện</strong><br/><em>(Unlimited Scale Tier)</em></td>
      <td class="c"><strong>380.001 &ndash; 500.000</strong><br/>requests/tháng</td>
      <td class="c"><strong>25,0 tỷ &ndash; 30,0 tỷ</strong> tokens<br/>(<code>25.0B &ndash; 30.0B tokens</code>)</td>
      <td>Không giới hạn API Keys &bull; Toàn bộ cụm <code>9Router</code> (<code>max/ultra</code> reasoning)</td>
      <td class="r"><strong>30.000.000 đ</strong></td>
    </tr>
    <tr>
      <td class="c"><strong>AI-FLEX</strong></td>
      <td><strong>Gói Thỏa Thuận Tháng</strong><br/><em>(Custom Monthly Package)</em></td>
      <td colspan="3">Theo cấu hình mô hình chuyên biệt hoặc sản lượng Usage dự kiến thỏa thuận trực tiếp giữa hai Bên tại Phụ lục của từng tháng cụ thể.</td>
      <td class="r"><strong>Thỏa thuận theo<br/>Phụ lục tháng<br/>(3tr &ndash; 30tr đ)</strong></td>
    </tr>
  </tbody>
</table>

<div class="callout-info">
  <strong>Nguyên tắc áp dụng Gói thuê bao &amp; Thanh toán trả trước:</strong><br/>
  1. <strong>Mô hình mua theo Gói cố định (Prepaid Subscription), KHÔNG phải Pay-as-you-go:</strong> Mỗi tháng hai Bên ký <strong>01 Phụ lục Hợp đồng</strong> để chốt gói dịch vụ và mức phí trọn gói của tháng đó (từ <code>3.000.000 đ</code> đến <code>30.000.000 đ</code>). Không phát sinh cước vượt trần tự động ngoài Phụ lục đã ký.<br/>
  2. <strong>Thời hạn thanh toán trả trước:</strong> Thanh toán <strong>100% giá trị gói của tháng từ ngày 05 đến ngày 15 hằng tháng</strong> bằng chuyển khoản ngân hàng vào tài khoản <strong>00344714490 – Ngân hàng Quân đội (MB Bank)</strong> của Hộ kinh doanh Công nghệ LIO.<br/>
  3. <strong>Báo cáo đối soát Usage hằng tháng:</strong> Cuối mỗi tháng, Hộ kinh doanh Công nghệ LIO kết xuất <strong>Báo cáo Usage chi tiết của tháng</strong> (thống kê Requests &amp; Tokens theo từng API Key, Endpoint và Model) kèm Hóa đơn hợp lệ để Công ty INUT nghiệm thu và hạch toán chi phí đầu vào.
</div>

<table class="sig-table">
  <tr>
    <td>
      <div class="sig-role">XÁC NHẬN CỦA KHÁCH HÀNG (CÔNG TY INUT)</div>
      <div class="sig-note">(Ký, ghi rõ họ tên và đóng dấu)</div>
      <div class="sig-space"></div>
      <div class="sig-name">NGÔ HUỲNH NGỌC KHÁNH</div>
    </td>
    <td>
      <div class="sig-role">ĐẠI DIỆN HỘ KINH DOANH CÔNG NGHỆ LIO</div>
      <div class="sig-note">(Ký, ghi rõ họ tên và đóng dấu hộ kinh doanh)</div>
      <div class="sig-space"></div>
      <div class="sig-name">HUỲNH ĐỨC NHÂM</div>
    </td>
  </tr>
</table>

</body>
</html>
"""


# ---------------------------------------------------------------------------
# DOCUMENT 2: HỢP ĐỒNG KHUNG (HỢP ĐỒNG NGUYÊN TẮC DỊCH VỤ API TRÍ TUỆ NHÂN TẠO)
# ---------------------------------------------------------------------------
def build_framework_contract_html() -> str:
    return f"""<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8"/>
<title>Hợp Đồng Khung Dịch Vụ API Trí Tuệ Nhân Tạo - Số 0111/2026/HĐDV-LIO-INUT</title>
<style>{COMMON_CSS}</style>
</head>
<body>
<div class="footer-str">Hợp đồng Khung Dịch vụ API Trí tuệ Nhân tạo số 0111/2026/HĐDV-LIO-INUT — Ký ngày 01/11/2026</div>

<table class="nat-header">
  <tr>
    <td style="width:48%;">
      <div class="org-name">CÔNG TY CP ĐẦU TƯ VÀ PHÁT TRIỂN<br/>CÔNG NGHỆ INUT &ndash; HKD CÔNG NGHỆ LIO</div>
      <div class="org-sub">Số: <strong>0111/2026/HĐDV-LIO-INUT</strong></div>
    </td>
    <td style="width:52%;">
      <div class="nat-title">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
      <div class="nat-motto"><span class="nat-line">Độc lập – Tự do – Hạnh phúc</span></div>
      <div class="doc-date">Đắk Lắk, ngày 01 tháng 11 năm 2026</div>
    </td>
  </tr>
</table>

<h1 class="main-title">HỢP ĐỒNG NGUYÊN TẮC (HỢP ĐỒNG KHUNG)<br/>CUNG CẤP GÓI DỊCH VỤ CỔNG KẾT NỐI API TRÍ TUỆ NHÂN TẠO</h1>
<div class="sub-title-center">(V/v: Thuê bao gói dịch vụ Cổng định tuyến AI Đa mô hình 9Router phục vụ sản xuất kinh doanh &amp; phát triển phần mềm)</div>

<div class="basis-box">
  - Căn cứ Bộ luật Dân sự số 91/2015/QH13 ngày 24/11/2015 của Quốc hội nước CHXHCN Việt Nam;<br/>
  - Căn cứ Luật Thương mại số 36/2005/QH11 và Luật Giao dịch điện tử số 20/2023/QH15;<br/>
  - Căn cứ Luật Thuế thu nhập doanh nghiệp, Luật Quản lý thuế và các văn bản hướng dẫn hạch toán chi phí dịch vụ công nghệ thông tin phục vụ hoạt động sản xuất kinh doanh;<br/>
  - Căn cứ nhu cầu sử dụng hạ tầng API Trí tuệ Nhân tạo (AI/LLM) của Công ty Cổ phần Đầu tư và Phát triển Công nghệ INUT và năng lực cung ứng hạ tầng của Hộ kinh doanh Công nghệ LIO.
</div>

<p>Hôm nay, ngày <strong>01 tháng 11 năm 2026</strong>, tại tỉnh Đắk Lắk, chúng tôi gồm có:</p>

<div class="party-box">
  <table class="party-tbl">
    <tr>
      <td style="width:50%; padding-right:8px; border-right:1px solid #cbd5e1;">
        <div class="party-head">BÊN A (BÊN CUNG CẤP DỊCH VỤ): HỘ KINH DOANH CÔNG NGHỆ LIO</div>
        - <strong>Tên đơn vị:</strong> <strong>HỘ KINH DOANH CÔNG NGHỆ LIO</strong><br/>
        - <strong>Mã số thuế:</strong> <strong>054202003668</strong><br/>
        - <strong>Địa chỉ:</strong> 22 đường 3/2, khu phố Phú Thạnh 2, phường Phú Yên, tỉnh Đắk Lắk<br/>
        - <strong>Người đại diện:</strong> Ông <strong>HUỲNH ĐỨC NHÂM</strong> &ndash; Chức vụ: <strong>Chủ hộ kinh doanh</strong><br/>
        - <strong>Số tài khoản:</strong> <strong>00344714490</strong> tại <strong>Ngân hàng TMCP Quân đội (MB Bank)</strong>
      </td>
      <td style="width:50%; padding-left:8px;">
        <div class="party-head">BÊN B (BÊN SỬ DỤNG DỊCH VỤ): CÔNG TY CP ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT</div>
        - <strong>Tên doanh nghiệp:</strong> <strong>CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT</strong><br/>
        - <strong>Mã số thuế:</strong> <strong>4401053694</strong><br/>
        - <strong>Địa chỉ trụ sở:</strong> 161 Trường Chinh, Phường Tuy Hòa, Tỉnh Đắk Lắk, Việt Nam<br/>
        - <strong>Người đại diện:</strong> Ông <strong>NGÔ HUỲNH NGỌC KHÁNH</strong> &ndash; Chức vụ: <strong>Giám đốc</strong> (ĐT: 0972 768 491)<br/>
        - <strong>Số tài khoản:</strong> <strong>79713</strong> tại <strong>Ngân hàng TMCP Kỹ Thương Việt Nam (Techcombank)</strong>
      </td>
    </tr>
  </table>
</div>

<p>Sau khi bàn bạc và thống nhất, hai Bên đồng ý ký kết <strong>Hợp đồng nguyên tắc (Hợp đồng khung) cung cấp gói dịch vụ Cổng kết nối API Trí tuệ Nhân tạo</strong> với các điều khoản và điều kiện chi tiết sau đây:</p>

<div class="sec-heading">ĐIỀU 1. NỘI DUNG DỊCH VỤ VÀ MỤC ĐÍCH SỬ DỤNG</div>
<p><strong>1.1. Bản chất Hợp đồng khung:</strong> Hợp đồng này là Hợp đồng nguyên tắc quy định các điều kiện kỹ thuật, biểu phí khung và quy trình thanh quyết toán cho việc Bên A cung cấp cho Bên B <strong>Gói dịch vụ Cổng kết nối và định tuyến API Trí tuệ Nhân tạo đa mô hình (Hệ thống 9Router AI Gateway)</strong> để Bên B sử dụng làm chi phí đầu vào trực tiếp phục vụ hoạt động sản xuất, phát triển phần mềm, vận hành thiết bị IoT/Kiosk AI và tự động hóa quản trị doanh nghiệp của Bên B.</p>
<p><strong>1.2. Các hạng mục kỹ thuật thuộc phạm vi dịch vụ (7 Hạng mục 9Router AI Gateway):</strong></p>
<ul class="tight-list">
  <li><strong>Hạng mục 1 – Cổng định tuyến AI hợp nhất (Unified AI Gateway &amp; Fusion Combo):</strong> Cung cấp điểm cuối kết nối chuẩn <code>/v1/chat/completions</code>, <code>/v1/messages</code>, <code>/v1/responses</code> kèm cơ chế chuyển đổi giao thức tự động, cân bằng tải đa tài khoản và chuyển mạch dự phòng (<em>Auto-Fallback Combos</em>: <code>pymid</code>, <code>gpt</code>, <code>hermes</code>, <code>opus-inut</code>, <code>sonnet</code>, <code>argon</code>, <code>for-plan</code>, <code>inut</code>).</li>
  <li><strong>Hạng mục 2 – API Xử lý Ngôn ngữ Lớn &amp; Suy luận chuyên sâu (LLM Chat, Code-Gen &amp; Deep Reasoning):</strong> Truy cập các mô hình ngôn ngữ và suy luận đa cấp thông qua <strong>Mã định tuyến nội bộ 9Router (Model Alias / Combo Profile)</strong> trên hệ thống của Bên A (bao gồm: <code>gemini-4-argon-high-400k</code>, <code>gemini-3.8-flash-high/medium</code>, <code>claude-opus-5-5-high-400k</code>, <code>claude-sonnet</code>, <code>gpt-6.1-sol</code>, <code>gpt-6-astra</code>, <code>gpt-5.6-sol/terra/luna</code>) phục vụ lập trình phần mềm/firmware, phân tích hồ sơ thầu e-GP, soạn thảo hồ sơ kỹ thuật và bóc tách dữ liệu hóa đơn – hải quan.</li>
  <li><strong>Hạng mục 3 – Nén ngữ cảnh &amp; Bộ nhớ đệm Token (RTK Token Saver &amp; Context Caching):</strong> Nén tự động kết quả công cụ (<code>RTK Hook</code>) và quản lý bộ nhớ đệm ngữ cảnh (<code>Cached Tokens</code> / <code>/v1/responses/compact</code>).</li>
  <li><strong>Hạng mục 4 – API Giọng nói AI (TTS &amp; STT):</strong> Tổng hợp giọng đọc Tiếng Việt (<code>/v1/audio/speech</code>: <code>google-tts/vi</code>, <code>edge-tts/vi-VN-HoaiMyNeural</code>, <code>kokoro</code>) và nhận diện giọng nói thành văn bản (<code>/v1/audio/transcriptions</code>) phục vụ Kiosk Hành chính công <strong>VNMAP AI ONE</strong> và hệ thống loa thông báo thông minh của Bên B.</li>
  <li><strong>Hạng mục 5 – API Thị giác máy tính, Khởi tạo Ảnh &amp; Video AI (Vision OCR, Image &amp; Video Gen):</strong> Nhận diện hình ảnh/OCR (giải mã Captcha Cổng Thuế/Hải quan, bóc tách CCCD, nhận diện biển số xe <strong>VNMAP Parking</strong> / <strong>iNut4C</strong>), tạo ảnh kỹ thuật (<code>/v1/images/generations</code>) và tạo video mô phỏng (<code>/v1/videos/generations</code>).</li>
  <li><strong>Hạng mục 6 – API Vector hóa (Embeddings) &amp; Truy xuất Web (Web Search &amp; Web Fetch):</strong> Tạo vector dữ liệu (<code>/v1/embeddings</code>) cho hệ thống tra cứu RAG nội bộ và tìm kiếm/trích xuất dữ liệu web (<code>/v1/search</code>, <code>/v1/web/fetch</code>).</li>
  <li><strong>Hạng mục 7 – Quản trị Khóa API (Bearer Keys), Cụm Proxy &amp; Báo cáo Usage định kỳ:</strong> Cấp phát và duy trì các khóa <code>Bearer API Key</code> riêng cho từng phân hệ của Bên B, duy trì cụm <code>Smart Proxy Pools</code> và kết xuất <strong>Báo cáo Usage hằng tháng</strong> theo từng khóa, từng endpoint và từng mô hình.</li>
</ul>
<p><strong>1.3. Tính độc lập về hạ tầng và quyền sở hữu:</strong> Hai Bên xác nhận Hệ thống Cổng định tuyến 9Router AI Gateway, mã nguồn điều phối, cơ chế nén ngữ cảnh RTK, cụm Proxy Pools và hạ tầng kết nối là tài sản công nghệ và hạ tầng kinh doanh độc lập thuộc quyền sở hữu, quản lý riêng của Bên A (được Bên A tự đầu tư thiết bị, chi phí điện năng, viễn thông và phát triển độc lập ngoài phạm vi bất kỳ quan hệ lao động nào khác). Bên B chỉ thuê quyền truy cập dịch vụ theo gói định mức hằng tháng và không nắm giữ quyền sở hữu đối với hạ tầng lõi của Bên A.</p>

<div class="sec-heading">ĐIỀU 2. CƠ CHẾ MUA GÓI THUÊ BAO THÁNG &amp; BIỂU PHÍ KHUNG THEO MỨC SỬ DỤNG</div>
<p><strong>2.1. Nguyên tắc mua theo Gói thuê bao tháng (Không áp dụng Pay-as-you-go):</strong> Hai Bên thống nhất dịch vụ được cung cấp theo hình thức <strong>Mua gói thuê bao định mức trả trước theo từng tháng</strong>, không tính cước lẻ biến động theo từng truy vấn (<em>không phải Pay-as-you-go</em>). Tương tự cơ chế phân bậc dịch vụ kế toán, mức phí hằng tháng được xác định theo <strong>Bậc gói cước sử dụng (Usage Tier)</strong> dao động từ <strong>3.000.000 đồng/tháng đến 30.000.000 đồng/tháng</strong> như sau:</p>

<table class="tbl">
  <thead>
    <tr>
      <th style="width:10%;">Mã Gói</th>
      <th style="width:22%;">Tên Gói Dịch Vụ</th>
      <th style="width:18%;">Định mức Requests / Tháng</th>
      <th style="width:22%;">Định mức Tổng Tokens / Tháng<br/><em>(Input + Output + Cache + Reasoning)</em></th>
      <th style="width:12%;">Số lượng<br/>API Keys</th>
      <th style="width:16%;">Mức Phí Trọn Gói / Tháng (VNĐ)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td class="c"><strong>AI-01</strong></td>
      <td><strong>Gói Cơ Bản (Starter)</strong></td>
      <td class="c"><code>0 &ndash; 30.000</code> reqs</td>
      <td class="c">Đến <code>3,0 tỷ</code> tokens (<code>3.0B</code>)</td>
      <td class="c">Đến 05 keys</td>
      <td class="r"><strong>3.000.000 đ</strong></td>
    </tr>
    <tr>
      <td class="c"><strong>AI-02</strong></td>
      <td><strong>Gói Tiêu Chuẩn (Standard)</strong></td>
      <td class="c"><code>30.001 &ndash; 60.000</code> reqs</td>
      <td class="c"><code>3,0 tỷ &ndash; 5,0 tỷ</code> tokens (<code>3.0B &ndash; 5.0B</code>)</td>
      <td class="c">Đến 10 keys</td>
      <td class="r"><strong>5.000.000 đ</strong></td>
    </tr>
    <tr>
      <td class="c"><strong>AI-03</strong></td>
      <td><strong>Gói Nghiệp Vụ (Business)</strong></td>
      <td class="c"><code>60.001 &ndash; 100.000</code> reqs</td>
      <td class="c"><code>5,0 tỷ &ndash; 8,0 tỷ</code> tokens (<code>5.0B &ndash; 8.0B</code>)</td>
      <td class="c">Đến 15 keys</td>
      <td class="r"><strong>8.000.000 đ</strong></td>
    </tr>
    <tr>
      <td class="c"><strong>AI-04</strong></td>
      <td><strong>Gói Chuyên Nghiệp (Pro)</strong></td>
      <td class="c"><code>100.001 &ndash; 150.000</code> reqs</td>
      <td class="c"><code>8,0 tỷ &ndash; 12,0 tỷ</code> tokens (<code>8.0B &ndash; 12.0B</code>)</td>
      <td class="c">Đến 20 keys</td>
      <td class="r"><strong>12.000.000 đ</strong></td>
    </tr>
    <tr>
      <td class="c"><strong>AI-05</strong></td>
      <td><strong>Gói Tăng Trưởng (Growth)</strong></td>
      <td class="c"><code>150.001 &ndash; 220.000</code> reqs</td>
      <td class="c"><code>12,0 tỷ &ndash; 16,0 tỷ</code> tokens (<code>12.0B &ndash; 16.0B</code>)</td>
      <td class="c">Đến 25 keys</td>
      <td class="r"><strong>16.000.000 đ</strong></td>
    </tr>
    <tr>
      <td class="c"><strong>AI-06</strong></td>
      <td><strong>Gói Doanh Nghiệp I</strong></td>
      <td class="c"><code>220.001 &ndash; 300.000</code> reqs</td>
      <td class="c"><code>16,0 tỷ &ndash; 20,0 tỷ</code> tokens (<code>16.0B &ndash; 20.0B</code>)</td>
      <td class="c">Đến 35 keys</td>
      <td class="r"><strong>20.000.000 đ</strong></td>
    </tr>
    <tr>
      <td class="c"><strong>AI-07</strong></td>
      <td><strong>Gói Doanh Nghiệp II</strong></td>
      <td class="c"><code>300.001 &ndash; 380.000</code> reqs</td>
      <td class="c"><code>20,0 tỷ &ndash; 25,0 tỷ</code> tokens (<code>20.0B &ndash; 25.0B</code>)</td>
      <td class="c">Đến 50 keys</td>
      <td class="r"><strong>25.000.000 đ</strong></td>
    </tr>
    <tr>
      <td class="c"><strong>AI-08</strong></td>
      <td><strong>Gói Hạ Tầng Toàn Diện</strong></td>
      <td class="c"><code>380.001 &ndash; 500.000</code> reqs</td>
      <td class="c"><code>25,0 tỷ &ndash; 30,0 tỷ</code> tokens (<code>25.0B &ndash; 30.0B</code>)</td>
      <td class="c">Không giới hạn</td>
      <td class="r"><strong>30.000.000 đ</strong></td>
    </tr>
    <tr>
      <td class="c"><strong>AI-FLEX</strong></td>
      <td><strong>Gói Thỏa Thuận Theo Tháng</strong></td>
      <td colspan="3">Trường hợp Bên B có nhu cầu cấu hình mô hình riêng hoặc điều chỉnh bậc định mức theo dự án từng tháng, hai Bên thỏa thuận mức phí trọn gói cụ thể tại Phụ lục của tháng đó.</td>
      <td class="r"><strong>Theo Phụ lục<br/>từng tháng</strong></td>
    </tr>
  </tbody>
</table>

<p><strong>2.2. Ký Phụ lục chốt gói hằng tháng:</strong> Vào đầu mỗi tháng (hoặc trước kỳ thanh toán của tháng đó), hai Bên tiến hành lập và ký <strong>01 Phụ lục Hợp đồng theo tháng</strong> ghi nhận cụ thể Mã gói cước đăng ký, định mức Usage cam kết và <strong>Mức phí trọn gói thỏa thuận của tháng đó</strong> (nằm trong khung từ 3.000.000 đồng đến 30.000.000 đồng hoặc mức phí thỏa thuận khác tùy khối lượng dự án). Phụ lục mỗi tháng là căn cứ pháp lý trực tiếp để thanh toán và xuất hóa đơn cho kỳ tháng đó.</p>
<p><strong>2.3. Chính sách thuế:</strong> Mức phí trọn gói ghi tại Biểu phí trên và tại Phụ lục từng tháng là tổng số tiền thanh toán trọn gói đã bao gồm các khoản thuế, phí theo quy định hiện hành áp dụng đối với Hộ kinh doanh. Trường hợp chạm ngưỡng định mức gói trong tháng, hệ thống tự động điều tiết tốc độ (<em>Soft Rate-Limit</em> / chuyển sang mô hình tiết kiệm token) mà không tự ý tính thêm phí vượt gói nếu chưa có thỏa thuận bằng văn bản của hai Bên.</p>

<div class="sec-heading">ĐIỀU 3. PHƯƠNG THỨC THANH TOÁN TRẢ TRƯỚC &amp; BÁO CÁO ĐỐI SOÁT USAGE HẰNG THÁNG</div>
<p><strong>3.1. Thời hạn thanh toán trả trước hằng tháng (Từ ngày 05 đến ngày 15 hằng tháng):</strong></p>
<ul class="tight-list">
  <li>Căn cứ Phụ lục gói dịch vụ của từng tháng được hai Bên ký kết, Bên B thực hiện <strong>thanh toán trả trước 100% giá trị gói dịch vụ của tháng đó trong khoảng thời gian từ ngày 05 đến ngày 15 hằng tháng</strong>.</li>
  <li>Việc thanh toán trả trước đầu kỳ giúp Bên A chủ động cấp phát tài nguyên tính toán, vận hành cụm máy chủ định tuyến (Routing Server), duy trì hệ thống bộ nhớ đệm (Context Caching), dải Proxy tĩnh và phân bổ băng thông cố định cho các khóa API của Bên B trong suốt tháng.</li>
</ul>
<p><strong>3.2. Phương thức thanh toán:</strong> Chuyển khoản ngân hàng 100% (không dùng tiền mặt) từ tài khoản công ty của Bên B sang tài khoản ngân hàng của Bên A theo thông tin:</p>
<div class="callout-info">
  - Đơn vị thụ hưởng / Chủ tài khoản: <strong>HUỲNH ĐỨC NHÂM</strong> (Chủ <strong>HỘ KINH DOANH CÔNG NGHỆ LIO</strong> &ndash; MST: <code>054202003668</code>)<br/>
  - Số tài khoản: <strong>00344714490</strong> &nbsp;&nbsp;&mdash;&nbsp;&nbsp; Tại ngân hàng: <strong>Ngân hàng TMCP Quân đội (MB Bank)</strong><br/>
  - Nội dung chuyển khoản chuẩn: <code>INUT thanh toan goi dich vu API AI thang [MM/YYYY] theo HD 0111/2026/HDDV-LIO-INUT</code>
</div>
<p><strong>3.3. Báo cáo Usage hằng tháng &amp; Hồ sơ chứng từ kế toán:</strong></p>
<ul class="tight-list">
  <li>Định kỳ vào cuối mỗi tháng (từ ngày 28 đến ngày 05 của tháng kế tiếp), Bên A có trách nhiệm kết xuất và bàn giao cho Bên B <strong>01 Bản Báo cáo Sản lượng Sử dụng API (Monthly Usage Report)</strong> của tháng đó, thể hiện rõ: Tổng số lượt truy vấn (<em>Requests</em>), Tổng lượng <em>Prompt Tokens</em>, <em>Completion Tokens</em>, <em>Cached Tokens</em>, <em>Reasoning Tokens</em> phân bổ theo từng <code>API Key</code> và từng nhóm mô hình/endpoint.</li>
  <li>Bộ chứng từ hạch toán chi phí đầu vào hằng tháng của Bên B gồm: (1) <strong>Hợp đồng nguyên tắc (Hợp đồng khung) này</strong>; (2) <strong>Phụ lục xác nhận gói dịch vụ &amp; Báo cáo Usage của tháng</strong> có chữ ký xác nhận của hai Bên; (3) <strong>Hóa đơn điện tử hợp pháp</strong> do Bên A xuất và (4) <strong>Ủy nhiệm chi / Chứng từ chuyển khoản ngân hàng</strong> từ ngày 05 &ndash; 15 của tháng.</li>
</ul>

<div class="sec-heading">ĐIỀU 4. THỜI HẠN HỢP ĐỒNG</div>
<p><strong>4.1.</strong> Hợp đồng khung này có hiệu lực kể từ ngày <strong>01 tháng 11 năm 2026</strong> và được áp dụng <strong>không xác định thời hạn</strong> (hoặc cho đến khi một trong hai Bên có văn bản thông báo chấm dứt Hợp đồng gửi cho Bên kia trước ít nhất <strong>30 ngày</strong>, tương tự quy chuẩn hợp đồng dịch vụ kế toán định kỳ).</p>
<p><strong>4.2.</strong> Việc chấm dứt Hợp đồng khung chỉ có hiệu lực sau khi hai Bên đã hoàn tất đối soát Usage và thanh quyết toán xong gói dịch vụ của tháng hiện hành.</p>

<div class="sec-heading">ĐIỀU 5. QUYỀN VÀ NGHĨA VỤ CỦA BÊN A (HỘ KINH DOANH CÔNG NGHỆ LIO)</div>
<p><strong>5.1.</strong> Duy trì hoạt động ổn định, thông suốt 24/7 cho hệ thống Cổng định tuyến AI (<code>9Router AI Gateway</code>), đảm bảo cơ chế tự động chuyển mạch dự phòng (<em>Auto-Fallback</em>) khi bất kỳ nút xử lý hoặc tuyến kết nối nào bảo trì, giới hạn băng thông.</p>
<p><strong>5.2.</strong> Cấp phát đầy đủ các khóa truy cập (<code>Bearer API Keys</code>) theo yêu cầu của Bên B, cấu hình đúng hạn mức gói thuê bao tháng đã ký tại Phụ lục và hỗ trợ kỹ thuật kịp thời khi Bên B tích hợp vào phần mềm/thiết bị mới.</p>
<p><strong>5.3.</strong> Bảo mật tuyệt đối toàn bộ nội dung truy vấn (<em>Prompts</em>), mã nguồn, tài liệu kỹ thuật, dữ liệu khách hàng và thông tin kinh doanh của Bên B truyền qua cổng API; không lưu trữ trái phép hoặc tiết lộ cho bất kỳ bên thứ ba nào.</p>
<p><strong>5.4.</strong> Lập và ký Phụ lục gói cước hằng tháng, cung cấp đầy đủ <strong>Báo cáo Usage hằng tháng</strong> và xuất hóa đơn hợp lệ cho Bên B để phục vụ công tác kê khai, quyết toán thuế của Bên B.</p>

<div class="sec-heading">ĐIỀU 6. QUYỀN VÀ NGHĨA VỤ CỦA BÊN B (CÔNG TY CP ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT)</div>
<p><strong>6.1.</strong> Quản lý bảo mật các khóa <code>Bearer API Key</code> được cấp, sử dụng dịch vụ API đúng mục đích phục vụ hoạt động sản xuất kinh doanh, nghiên cứu phát triển phần mềm – phần cứng hợp pháp của Công ty.</p>
<p><strong>6.2.</strong> Phối hợp với Bên A ký Phụ lục xác nhận gói dịch vụ đầu mỗi tháng và <strong>thanh toán trả trước đầy đủ, đúng hạn từ ngày 05 đến ngày 15 hằng tháng</strong> theo quy định tại Điều 2 và Điều 3 của Hợp đồng này.</p>
<p><strong>6.3.</strong> Kiểm tra, xác nhận số liệu trên <strong>Báo cáo Usage hằng tháng</strong> do Bên A gửi để lưu trữ vào hồ sơ kế toán của doanh nghiệp.</p>

<div class="sec-heading">ĐIỀU 7. ĐIỀU KHOẢN CHUNG</div>
<p><strong>7.1.</strong> Trường hợp Bên A không cung cấp được dịch vụ API theo đúng gói cước đã cam kết tại Phụ lục tháng (ngừng dịch vụ quá 48 giờ liên tục không có phương án dự phòng), Bên A có trách nhiệm bù trừ hạn mức sang tháng kế tiếp hoặc hoàn trả phần phí tương ứng cho Bên B.</p>
<p><strong>7.2.</strong> Trường hợp Bên B đơn phương ngừng sử dụng giữa chừng trong tháng sau khi Bên A đã cấp phát hạn mức gói thuê bao trả trước của tháng đó thì khoản phí thuê bao trả trước của tháng đó không được hoàn lại, trừ trường hợp hai Bên có thỏa thuận khác.</p>
<p><strong>7.3.</strong> Mọi Phụ lục gói cước hằng tháng, Báo cáo đối soát Usage, Biên bản nghiệm thu và Hóa đơn phát sinh theo Hợp đồng này là bộ phận cấu thành không tách rời của Hợp đồng.</p>
<p><strong>7.4.</strong> Hợp đồng này có hiệu lực từ ngày <strong>01/11/2026</strong>, được lập thành <strong>02 (hai) bản</strong> có giá trị pháp lý như nhau, mỗi Bên giữ <strong>01 (một) bản</strong> để làm căn cứ thực hiện./.</p>

<table class="sig-table">
  <tr>
    <td>
      <div class="sig-role">ĐẠI DIỆN BÊN B (CÔNG TY INUT)</div>
      <div class="sig-note">(Ký, ghi rõ họ tên và đóng dấu)</div>
      <div class="sig-space"></div>
      <div class="sig-name">NGÔ HUỲNH NGỌC KHÁNH</div>
    </td>
    <td>
      <div class="sig-role">ĐẠI DIỆN BÊN A (HKD CÔNG NGHỆ LIO)</div>
      <div class="sig-note">(Ký, ghi rõ họ tên và đóng dấu hộ kinh doanh)</div>
      <div class="sig-space"></div>
      <div class="sig-name">HUỲNH ĐỨC NHÂM</div>
    </td>
  </tr>
</table>

</body>
</html>
"""


# ---------------------------------------------------------------------------
# DOCUMENT 3: PHỤ LỤC HẰNG THÁNG (KỲ THÁNG 11/2026 - KÝ ĐẦU THÁNG 01/11/2026)
# ---------------------------------------------------------------------------
def build_monthly_appendix_html(
    appendix_no: str = "01",
    month_str: str = "11/2026",
    sign_date_str: str = "ngày 01 tháng 11 năm 2026",
    payment_window_str: str = "Từ ngày 05/11/2026 đến ngày 15/11/2026",
    selected_tier_code: str = "AI-05",
    selected_tier_name: str = "Gói Tăng Trưởng (Growth API Tier)",
    selected_req_quota: str = "150.001 – 220.000 requests/tháng",
    selected_token_quota: str = "12,0 tỷ – 16,0 tỷ tokens/tháng (12.0B – 16.0B tokens)",
    selected_amount: int = 16_000_000,
    selected_amount_words: str = "Mười sáu triệu đồng chẵn",
) -> str:
    amount_fmt = f"{selected_amount:,.0f}".replace(",", ".")
    return f"""<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8"/>
<title>Phụ Lục Số {appendix_no} (Kỳ Tháng {month_str}) - Hợp Đồng 0111/2026/HĐDV-LIO-INUT</title>
<style>{COMMON_CSS}</style>
</head>
<body>
<div class="footer-str">Phụ lục số {appendix_no} (Kỳ Tháng {month_str}) kèm Hợp đồng khung số 0111/2026/HĐDV-LIO-INUT — Ký ngày 01/11/2026</div>

<table class="nat-header">
  <tr>
    <td style="width:48%;">
      <div class="org-name">CÔNG TY CP ĐẦU TƯ VÀ PHÁT TRIỂN<br/>CÔNG NGHỆ INUT &ndash; HKD CÔNG NGHỆ LIO</div>
      <div class="org-sub">Số: <strong>PL-{appendix_no}/2026/HĐDV-LIO-INUT</strong></div>
    </td>
    <td style="width:52%;">
      <div class="nat-title">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
      <div class="nat-motto"><span class="nat-line">Độc lập – Tự do – Hạnh phúc</span></div>
      <div class="doc-date">Đắk Lắk, {sign_date_str}</div>
    </td>
  </tr>
</table>

<h1 class="main-title">PHỤ LỤC HỢP ĐỒNG SỐ {appendix_no} &mdash; KỲ THÁNG {month_str}<br/>XÁC NHẬN GÓI CƯỚC THUÊ BAO &amp; THỎA THUẬN MỨC PHÍ DỊCH VỤ API AI</h1>
<div class="sub-title-center">(Kèm theo và là bộ phận không tách rời của Hợp đồng nguyên tắc số <strong>0111/2026/HĐDV-LIO-INUT</strong> ký ngày 01/11/2026)</div>

<div class="basis-box">
  - Căn cứ Hợp đồng nguyên tắc (Hợp đồng khung) cung cấp gói dịch vụ Cổng kết nối API Trí tuệ Nhân tạo số <strong>0111/2026/HĐDV-LIO-INUT</strong> ký ngày 01/11/2026 giữa <strong>Hộ kinh doanh Công nghệ LIO</strong> và <strong>Công ty Cổ phần Đầu tư và Phát triển Công nghệ INUT</strong>;<br/>
  - Căn cứ nhu cầu sử dụng hạn mức API Trí tuệ Nhân tạo (Usage Quota) thực tế của Công ty Cổ phần Đầu tư và Phát triển Công nghệ INUT trong <strong>Kỳ Tháng {month_str}</strong>.
</div>

<div class="party-box">
  <table class="party-tbl">
    <tr>
      <td style="width:50%; padding-right:8px; border-right:1px solid #cbd5e1;">
        <div style="font-weight:bold; color:#0f3d68; text-transform:uppercase; margin-bottom:2px;">BÊN A (BÊN CUNG CẤP DỊCH VỤ):</div>
        <strong>HỘ KINH DOANH CÔNG NGHỆ LIO</strong><br/>
        - Mã số thuế: <strong>054202003668</strong><br/>
        - Địa chỉ: 22 đường 3/2, KP Phú Thạnh 2, P. Phú Yên, tỉnh Đắk Lắk<br/>
        - Đại diện: Ông <strong>HUỲNH ĐỨC NHÂM</strong> &ndash; Chủ HKD<br/>
        - Tài khoản: <strong>00344714490</strong> &ndash; Ngân hàng Quân đội (MB)
      </td>
      <td style="width:50%; padding-left:8px;">
        <div style="font-weight:bold; color:#0f3d68; text-transform:uppercase; margin-bottom:2px;">BÊN B (BÊN SỬ DỤNG DỊCH VỤ):</div>
        <strong>CÔNG TY CP ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT</strong><br/>
        - Mã số thuế: <strong>4401053694</strong><br/>
        - Địa chỉ: 161 Trường Chinh, Phường Tuy Hòa, Tỉnh Đắk Lắk<br/>
        - Đại diện: Ông <strong>NGÔ HUỲNH NGỌC KHÁNH</strong> &ndash; Giám đốc (ĐT: 0972 768 491)<br/>
        - Tài khoản: <strong>79713</strong> &ndash; Ngân hàng Techcombank
      </td>
    </tr>
  </table>
</div>

<p>Hai Bên thống nhất ký kết <strong>Phụ lục Hợp đồng số {appendix_no}</strong> để xác nhận gói dịch vụ thuê bao API Trí tuệ Nhân tạo và mức phí áp dụng cho <strong>Kỳ Tháng {month_str}</strong> (từ ngày <code>01/{month_str}</code> đến hết ngày <code>30/{month_str}</code>) như sau:</p>

<div class="sec-heading">1. GÓI DỊCH VỤ ĐĂNG KÝ &amp; MỨC PHÍ TRỌN GÓI THỎA THUẬN KỲ THÁNG {month_str}</div>

<table class="tbl">
  <thead>
    <tr>
      <th style="width:6%;">STT</th>
      <th style="width:32%;">Tên Hạng mục &amp; Gói cước Thuê bao</th>
      <th style="width:28%;">Định mức Usage &amp; Quyền hạn kỹ thuật trong tháng</th>
      <th style="width:10%;">ĐVT</th>
      <th style="width:8%;">SL</th>
      <th style="width:16%;">Thành tiền Trọn gói (VNĐ)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td class="c"><strong>01</strong></td>
      <td>
        <strong>Thuê bao Cổng kết nối API Trí tuệ Nhân tạo 9Router &mdash; Kỳ Tháng {month_str}</strong><br/>
        <span class="badge">Mã gói: {selected_tier_code}</span> &nbsp;<strong>{selected_tier_name}</strong><br/>
        <em>(Bao gồm trọn bộ 07 hạng mục: Unified AI Gateway, LLM Reasoning qua Mã định tuyến nội bộ 9Router, RTK Token Saver, TTS/STT Tiếng Việt, Vision OCR/Image/Video, Embeddings &amp; Web Search/Fetch)</em>
      </td>
      <td>
        - <strong>Sản lượng Requests:</strong><br/>&nbsp;&nbsp;{selected_req_quota}<br/>
        - <strong>Sản lượng Tokens:</strong><br/>&nbsp;&nbsp;{selected_token_quota}<br/>
        - <strong>Số khóa API hoạt động:</strong><br/>&nbsp;&nbsp;Tối đa 25 Bearer Keys + Smart Proxy Pool
      </td>
      <td class="c">Gói / Tháng</td>
      <td class="c">01</td>
      <td class="r" style="font-size:10pt; font-weight:bold; color:#0f3d68;">{amount_fmt} đ</td>
    </tr>
    <tr>
      <td colspan="5" class="r" style="font-weight:bold; background:#f8fafc;">TỔNG GIÁ TRỊ GÓI THUÊ BAO TRẢ TRƯỚC KỲ THÁNG {month_str} (ĐÃ BAO GỒM THUẾ THEO QUY ĐỊNH HKD)</td>
      <td class="r" style="font-size:10.2pt; font-weight:bold; color:#b91c1c; background:#f8fafc;">{amount_fmt} đ</td>
    </tr>
  </tbody>
</table>
<p><em>(Số tiền bằng chữ: <strong>{selected_amount_words}</strong>).</em></p>

<div class="sec-heading">2. BẢNG ĐỐI CHIẾU CÁC MỨC GÓI THUÊ BAO THÁNG (3.000.000 Đ &ndash; 30.000.000 Đ)</div>
<p>Hai Bên xác nhận gói dịch vụ Kỳ Tháng {month_str} nêu tại Mục 1 được lựa chọn từ Biểu phí khung Điều 2 Hợp đồng số <strong>0111/2026/HĐDV-LIO-INUT</strong> (tích chọn <code>[X]</code> vào mức gói áp dụng trong tháng):</p>

<table class="tbl" style="font-size:7.4pt;">
  <thead>
    <tr>
      <th style="width:7%;">Chọn</th>
      <th style="width:9%;">Mã Gói</th>
      <th style="width:24%;">Tên Gói Thuê Bao</th>
      <th style="width:21%;">Định mức Requests / Tháng</th>
      <th style="width:22%;">Định mức Tổng Tokens / Tháng</th>
      <th style="width:17%;">Đơn giá Gói / Tháng</th>
    </tr>
  </thead>
  <tbody>
    <tr><td class="c">{'[X]' if selected_tier_code=='AI-01' else '[  ]'}</td><td class="c"><strong>AI-01</strong></td><td>Gói Cơ Bản (Starter)</td><td class="c">Đến 30.000 requests</td><td class="c">Đến 3,0 tỷ tokens (<code>3.0B</code>)</td><td class="r">3.000.000 đ</td></tr>
    <tr><td class="c">{'[X]' if selected_tier_code=='AI-02' else '[  ]'}</td><td class="c"><strong>AI-02</strong></td><td>Gói Tiêu Chuẩn (Standard)</td><td class="c">30.001 &ndash; 60.000 requests</td><td class="c">3,0 tỷ &ndash; 5,0 tỷ tokens (<code>3.0B &ndash; 5.0B</code>)</td><td class="r">5.000.000 đ</td></tr>
    <tr><td class="c">{'[X]' if selected_tier_code=='AI-03' else '[  ]'}</td><td class="c"><strong>AI-03</strong></td><td>Gói Nghiệp Vụ (Business)</td><td class="c">60.001 &ndash; 100.000 requests</td><td class="c">5,0 tỷ &ndash; 8,0 tỷ tokens (<code>5.0B &ndash; 8.0B</code>)</td><td class="r">8.000.000 đ</td></tr>
    <tr><td class="c">{'[X]' if selected_tier_code=='AI-04' else '[  ]'}</td><td class="c"><strong>AI-04</strong></td><td>Gói Chuyên Nghiệp (Pro)</td><td class="c">100.001 &ndash; 150.000 requests</td><td class="c">8,0 tỷ &ndash; 12,0 tỷ tokens (<code>8.0B &ndash; 12.0B</code>)</td><td class="r">12.000.000 đ</td></tr>
    <tr><td class="c">{'[X]' if selected_tier_code=='AI-05' else '[  ]'}</td><td class="c"><strong>AI-05</strong></td><td>Gói Tăng Trưởng (Growth)</td><td class="c">150.001 &ndash; 220.000 requests</td><td class="c">12,0 tỷ &ndash; 16,0 tỷ tokens (<code>12.0B &ndash; 16.0B</code>)</td><td class="r">16.000.000 đ</td></tr>
    <tr><td class="c">{'[X]' if selected_tier_code=='AI-06' else '[  ]'}</td><td class="c"><strong>AI-06</strong></td><td>Gói Doanh Nghiệp I</td><td class="c">220.001 &ndash; 300.000 requests</td><td class="c">16,0 tỷ &ndash; 20,0 tỷ tokens (<code>16.0B &ndash; 20.0B</code>)</td><td class="r">20.000.000 đ</td></tr>
    <tr><td class="c">{'[X]' if selected_tier_code=='AI-07' else '[  ]'}</td><td class="c"><strong>AI-07</strong></td><td>Gói Doanh Nghiệp II</td><td class="c">300.001 &ndash; 380.000 requests</td><td class="c">20,0 tỷ &ndash; 25,0 tỷ tokens (<code>20.0B &ndash; 25.0B</code>)</td><td class="r">25.000.000 đ</td></tr>
    <tr><td class="c">{'[X]' if selected_tier_code=='AI-08' else '[  ]'}</td><td class="c"><strong>AI-08</strong></td><td>Gói Hạ Tầng Toàn Diện</td><td class="c">380.001 &ndash; 500.000 requests</td><td class="c">25,0 tỷ &ndash; 30,0 tỷ tokens (<code>25.0B &ndash; 30.0B</code>)</td><td class="r">30.000.000 đ</td></tr>
    <tr><td class="c">{'[X]' if selected_tier_code=='AI-FLEX' else '[  ]'}</td><td class="c"><strong>AI-FLEX</strong></td><td>Gói Thỏa Thuận Tháng</td><td colspan="2">Theo hạn mức thỏa thuận riêng tại Mục 1 Phụ lục này</td><td class="r">Theo Mục 1</td></tr>
  </tbody>
</table>

<div class="sec-heading">3. LỊCH TRÌNH THANH TOÁN TRẢ TRƯỚC &amp; BÀN GIAO BÁO CÁO USAGE THÁNG {month_str}</div>
<ul class="tight-list">
  <li><strong>Thời hạn thanh toán trả trước:</strong> <strong>{payment_window_str}</strong> (100% giá trị gói cước bằng chuyển khoản vào STK <strong>00344714490</strong> &ndash; Ngân hàng Quân đội MB của Chủ hộ kinh doanh <strong>Huỳnh Đức Nhâm</strong>).</li>
  <li><strong>Nghiệm thu &amp; Báo cáo Usage cuối tháng:</strong> Kết thúc Kỳ Tháng {month_str}, Bên A kết xuất <strong>Báo cáo Đối soát Sản lượng Sử dụng API (Monthly Usage Report)</strong> theo mẫu Báo cáo Usage quy định của hệ thống 9Router vào cuối kỳ để hai Bên ký xác nhận nghiệm thu lưu hồ sơ kế toán.</li>
</ul>

<table class="sig-table">
  <tr>
    <td>
      <div class="sig-role">ĐẠI DIỆN BÊN B (CÔNG TY INUT)</div>
      <div class="sig-note">(Ký, ghi rõ họ tên và đóng dấu)</div>
      <div class="sig-space"></div>
      <div class="sig-name">NGÔ HUỲNH NGỌC KHÁNH</div>
    </td>
    <td>
      <div class="sig-role">ĐẠI DIỆN BÊN A (HKD CÔNG NGHỆ LIO)</div>
      <div class="sig-note">(Ký, ghi rõ họ tên và đóng dấu hộ kinh doanh)</div>
      <div class="sig-space"></div>
      <div class="sig-name">HUỲNH ĐỨC NHÂM</div>
    </td>
  </tr>
</table>

</body>
</html>
"""


# ---------------------------------------------------------------------------
# DOCUMENT 4: BÁO CÁO SẢN LƯỢNG SỬ DỤNG API & BIÊN BẢN NGHIỆM THU (KÝ CUỐI THÁNG 30/11/2026)
# ---------------------------------------------------------------------------
def build_monthly_usage_report_html(
    appendix_no: str = "01",
    month_str: str = "11/2026",
    selected_tier_code: str = "AI-05",
    selected_tier_name: str = "Gói Tăng Trưởng (Growth API Tier)",
    selected_req_quota: str = "150.001 – 220.000 requests/tháng",
    selected_token_quota: str = "12,0 tỷ – 16,0 tỷ tokens/tháng (12.0B – 16.0B tokens)",
    selected_amount: int = 16_000_000,
) -> str:
    amount_fmt = f"{selected_amount:,.0f}".replace(",", ".")
    m_num, y_num = month_str.split("/")
    return f"""<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8"/>
<title>Báo Cáo Sản Lượng Sử Dụng API (Monthly Usage Report) &amp; Biên Bản Nghiệm Thu Dịch Vụ Kỳ Tháng {month_str}</title>
<style>{COMMON_CSS}</style>
</head>
<body>
<div class="footer-str">Báo cáo Sản lượng Sử dụng API &amp; Biên bản Nghiệm thu Kỳ Tháng {month_str} (Mã: USAGE-{m_num}-{y_num}-PL{appendix_no}) — Ký ngày 30/{month_str}</div>

<table class="nat-header">
  <tr>
    <td style="width:48%;">
      <div class="org-name">HỆ THỐNG ĐỐI SOÁT 9ROUTER TELEMETRY<br/>HKD CÔNG NGHỆ LIO &ndash; CÔNG TY CP INUT</div>
      <div class="org-sub">Mã báo cáo: <strong>USAGE-{m_num}-{y_num}-PL{appendix_no}</strong></div>
    </td>
    <td style="width:52%;">
      <div class="nat-title">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
      <div class="nat-motto"><span class="nat-line">Độc lập – Tự do – Hạnh phúc</span></div>
      <div class="doc-date">Đắk Lắk, ngày 30 tháng {m_num} năm {y_num}</div>
    </td>
  </tr>
</table>

<h1 class="main-title">BÁO CÁO SẢN LƯỢNG SỬ DỤNG API (MONTHLY USAGE REPORT)<br/>&amp; BIÊN BẢN NGHIỆM THU DỊCH VỤ KỲ THÁNG {month_str}</h1>
<div class="sub-title-center">(Đính kèm Phụ lục số <strong>PL-{appendix_no}/2026/HĐDV-LIO-INUT</strong> thuộc Hợp đồng khung số <strong>0111/2026/HĐDV-LIO-INUT</strong>)</div>

<div class="callout-info">
  <strong>Thông tin Gói thuê bao đối soát Kỳ Tháng {month_str}:</strong>
  Mã gói đăng ký: <strong>{selected_tier_code} &ndash; {selected_tier_name}</strong> &nbsp;|&nbsp;
  Định mức gói: <strong>{selected_req_quota}</strong> (<strong>{selected_token_quota}</strong>) &nbsp;|&nbsp;
  Phí thuê bao trọn gói đã thanh toán trả trước: <strong>{amount_fmt} VNĐ</strong> &nbsp;|&nbsp;
  Trạng thái định mức: <strong>TRONG ĐỊNH MỨC GÓI CAM KẾT (KHÔNG PHÁT SINH PHÍ VƯỢT GÓI)</strong>.
</div>

<div class="sec-heading">I. THỐNG KÊ SẢN LƯỢNG USAGE THEO HẠNG MỤC ENDPOINT &amp; MÔ HÌNH AI (9ROUTER LOGS)</div>
<table class="tbl">
  <thead>
    <tr>
      <th style="width:5%;">TT</th>
      <th style="width:27%;">Phân hệ Dịch vụ / Endpoint API</th>
      <th style="width:26%;">Mã định tuyến nội bộ 9Router<br/><em>(Model Alias / Combo Profile)</em></th>
      <th style="width:12%;">Số lượt Gọi<br/>(Requests)</th>
      <th style="width:15%;">Prompt + Cached<br/>Tokens</th>
      <th style="width:15%;">Completion +<br/>Reasoning Tokens</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td class="c">1</td>
      <td><strong>LLM Suy luận &amp; Lập trình sâu</strong><br/><code>POST /v1/chat/completions</code></td>
      <td><em>Model Alias / Combo Profile:</em><br/><code>gemini-4-argon-high-400k</code>, <code>claude-opus-5-5-high-400k</code>, <code>gpt-6.1-sol</code></td>
      <td class="r">84.620</td>
      <td class="r">8.210.250.000</td>
      <td class="r">46.225.000</td>
    </tr>
    <tr>
      <td class="c">2</td>
      <td><strong>LLM Tốc độ cao &amp; Tác nhân tự động</strong><br/><code>POST /v1/messages</code> &bull; <code>/v1/responses</code></td>
      <td><em>Model Alias / Combo Profile:</em><br/><code>gemini-3.8-flash-high</code>, <code>gemini-3.8-flash-medium</code>, <code>gpt-6-astra</code></td>
      <td class="r">68.340</td>
      <td class="r">4.925.100.000</td>
      <td class="r">27.060.000</td>
    </tr>
    <tr>
      <td class="c">3</td>
      <td><strong>Nén Ngữ cảnh &amp; Tối ưu Token (RTK)</strong><br/><code>POST /v1/responses/compact</code></td>
      <td><code>rtk-compressor</code>, <code>prompt-cache-engine</code></td>
      <td class="r">14.210</td>
      <td class="r">1.070.000.000</td>
      <td class="r">4.155.000</td>
    </tr>
    <tr>
      <td class="c">4</td>
      <td><strong>Giọng nói AI Tiếng Việt (TTS &amp; STT)</strong><br/><code>POST /v1/audio/speech</code> &bull; <code>transcriptions</code></td>
      <td><code>google-tts/vi</code>, <code>edge-tts/vi-VN-HoaiMyNeural</code>, <code>kokoro</code></td>
      <td class="r">6.480</td>
      <td class="r">92.700.000</td>
      <td class="r">6.320.000</td>
    </tr>
    <tr>
      <td class="c">5</td>
      <td><strong>Thị giác Máy tính (OCR Captcha/CCCD) &amp; Ảnh</strong><br/><code>/v1/images/generations</code> &bull; <code>image-to-text</code></td>
      <td><code>gemini-vision-ocr</code>, <code>flux-pro</code>, <code>xai-video</code></td>
      <td class="r">5.890</td>
      <td class="r">206.400.000</td>
      <td class="r">4.740.000</td>
    </tr>
    <tr>
      <td class="c">6</td>
      <td><strong>Vector hóa RAG &amp; Truy vấn Web thời gian thực</strong><br/><code>POST /v1/embeddings</code> &bull; <code>/v1/search</code> &bull; <code>fetch</code></td>
      <td><code>text-embedding-3</code>, <code>tavily/search</code>, <code>web-markdown</code></td>
      <td class="r">4.920</td>
      <td class="r">159.300.000</td>
      <td class="r">3.125.000</td>
    </tr>
    <tr style="background:#f8fafc; font-weight:bold;">
      <td colspan="3" class="c">TỔNG SẢN LƯỢNG USAGE THỰC TẾ TRONG KỲ THÁNG {month_str}</td>
      <td class="r" style="color:#0f3d68;">184.460 reqs</td>
      <td class="r" style="color:#0f3d68;">14.663.750.000</td>
      <td class="r" style="color:#0f3d68;">91.625.000</td>
    </tr>
    <tr style="background:#f0f9ff; font-weight:bold;">
      <td colspan="3" class="c">TỔNG LƯỢNG TOKENS XỬ LÝ TOÀN HỆ THỐNG (PROMPT + COMPLETION + CACHED + REASONING)</td>
      <td colspan="3" class="c" style="color:#15803d; font-size:9.3pt;">14.755.375.000 tokens (&approx; 14,76 tỷ tokens / 14.76B &mdash; Đạt 100% SLA gói {selected_tier_code})</td>
    </tr>
  </tbody>
</table>
<p style="font-size:7.8pt; font-style:italic; color:#1e293b; margin:2px 0 4px 0;">(Ghi chú: Sản lượng Token thống kê ở trên bao gồm &gt;85% là Cached Tokens được tái sử dụng qua bộ nhớ đệm nội bộ RTK Token Saver &amp; Context Caching của hệ thống 9Router)</p>

<div class="sec-heading">II. PHÂN BỔ USAGE THEO KHÓA API (BEARER KEYS) CỦA CÁC DỰ ÁN TẠI CÔNG TY INUT</div>
<table class="tbl">
  <thead>
    <tr>
      <th style="width:6%;">TT</th>
      <th style="width:26%;">Định danh Khóa API (Key Label)</th>
      <th style="width:36%;">Hệ thống / Dự án Nghiệp vụ Sử dụng tại Công ty INUT</th>
      <th style="width:12%;">Số Requests</th>
      <th style="width:12%;">Tổng Tokens</th>
      <th style="width:8%;">Tỷ trọng</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td class="c">01</td>
      <td><code>ksp-inut-crm-pdf-signer</code></td>
      <td>Hệ thống KSP PDFSign: Bóc tách Hóa đơn Thuế GDT, Tờ khai Hải quan, Đấu thầu e-GP &amp; Soạn hợp đồng</td>
      <td class="r">62.410</td>
      <td class="r">5,09 tỷ (5.09B)</td>
      <td class="c">34,5%</td>
    </tr>
    <tr>
      <td class="c">02</td>
      <td><code>inut-opc-inut-dev</code></td>
      <td>Phát triển Firmware nhúng Rockchip RK3518/RK3528/RK3588, PLC Siemens S7-1200/LOGO! &amp; Kiosk VNMAP AI ONE</td>
      <td class="r">54.120</td>
      <td class="r">4,72 tỷ (4.72B)</td>
      <td class="c">32,0%</td>
    </tr>
    <tr>
      <td class="c">03</td>
      <td><code>apphub-iot</code> &amp; <code>apphub vnmap3d</code></td>
      <td>Vận hành Nền tảng iNut AppHub, Quản lý 16 trạm Điện mặt trời inut-solar &amp; Bản đồ số VNMAP Parking</td>
      <td class="r">38.750</td>
      <td class="r">3,10 tỷ (3.10B)</td>
      <td class="c">21,0%</td>
    </tr>
    <tr>
      <td class="c">04</td>
      <td><code>chatbox-telegram-vnmap</code></td>
      <td>Trợ lý AI CSKH tự động, Bot cảnh báo vận hành Telegram, TTS Tiếng Việt Kiosk &amp; Loa thông báo BLE</td>
      <td class="r">18.290</td>
      <td class="r">1,18 tỷ (1.18B)</td>
      <td class="c">8,0%</td>
    </tr>
    <tr>
      <td class="c">05</td>
      <td><code>inuttraining-hermes</code> &amp; Khác</td>
      <td>Đào tạo nội bộ, kiểm thử tự động (E2E Testing) &amp; Dự phòng kỹ thuật</td>
      <td class="r">10.890</td>
      <td class="r">0,67 tỷ (0.67B)</td>
      <td class="c">4,5%</td>
    </tr>
  </tbody>
</table>

<div class="sec-heading">III. KẾT LUẬN NGHIỆM THU &amp; XÁC NHẬN QUYẾT TOÁN KỲ THÁNG {month_str}</div>
<p>1. Bên A (<strong>Hộ kinh doanh Công nghệ LIO</strong>) đã cung cấp đầy đủ, liên tục 24/7 gói dịch vụ <strong>{selected_tier_code} ({selected_tier_name})</strong> trong Kỳ Tháng {month_str} đúng theo Hợp đồng khung số <strong>0111/2026/HĐDV-LIO-INUT</strong> và Phụ lục số <strong>{appendix_no}</strong>.</p>
<p>2. Toàn bộ sản lượng sử dụng thực tế (<strong>184.460 requests</strong> / <strong>14.755.375.000 tokens &approx; 14,76 tỷ tokens [14.76B tokens]</strong>) nằm trong định mức gói thuê bao trả trước (<strong>{amount_fmt} VNĐ</strong>), <strong>không phát sinh bất kỳ khoản phí vượt gói nào</strong>. Hai Bên thống nhất nghiệm thu hoàn thành 100% gói dịch vụ Kỳ Tháng {month_str} để làm căn cứ lưu trữ chứng từ chi phí hợp lệ của Công ty Cổ phần Đầu tư và Phát triển Công nghệ INUT.</p>

<table class="sig-table">
  <tr>
    <td>
      <div class="sig-role">ĐẠI DIỆN BÊN B (CÔNG TY INUT)</div>
      <div class="sig-note">(Ký, ghi rõ họ tên và đóng dấu)</div>
      <div class="sig-space"></div>
      <div class="sig-name">NGÔ HUỲNH NGỌC KHÁNH</div>
    </td>
    <td>
      <div class="sig-role">ĐẠI DIỆN BÊN A (HKD CÔNG NGHỆ LIO)</div>
      <div class="sig-note">(Ký, ghi rõ họ tên và đóng dấu hộ kinh doanh)</div>
      <div class="sig-space"></div>
      <div class="sig-name">HUỲNH ĐỨC NHÂM</div>
    </td>
  </tr>
</table>

</body>
</html>
"""


def main() -> None:
    parser = argparse.ArgumentParser(description="Render bộ Hợp đồng khung, Báo giá, Phụ lục & Báo cáo Usage API 9Router (LIO - INUT)")
    parser.add_argument("--appendix-no", default="01")
    parser.add_argument("--month", default="11/2026")
    parser.add_argument("--sign-date", default="ngày 01 tháng 11 năm 2026")
    parser.add_argument("--payment-window", default="Từ ngày 05/11/2026 đến ngày 15/11/2026")
    parser.add_argument("--tier-code", default="AI-05")
    parser.add_argument("--tier-name", default="Gói Tăng Trưởng (Growth API Tier)")
    parser.add_argument("--req-quota", default="150.001 – 220.000 requests/tháng")
    parser.add_argument("--token-quota", default="12,0 tỷ – 16,0 tỷ tokens/tháng (12.0B – 16.0B tokens)")
    parser.add_argument("--amount", type=int, default=16_000_000)
    parser.add_argument("--amount-words", default="Mười sáu triệu đồng chẵn")
    args = parser.parse_args()

    BASE_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Báo giá & Brief kỹ thuật (2 trang A4 - ngày 01/11/2026)
    html_quote = build_quotation_brief_html()
    (BASE_DIR / "01-bao-gia-brief.html").write_text(html_quote, encoding="utf-8")
    pdf_quote = BASE_DIR / "01-Bao-Gia-Va-Brief-Dich-Vu-API-AI-9Router-LIO-2026.pdf"
    weasyprint.HTML(string=html_quote, base_url=str(BASE_DIR)).write_pdf(str(pdf_quote))

    # 2. Hợp đồng khung / Hợp đồng nguyên tắc (2 trang A4 - ngày 01/11/2026)
    html_contract = build_framework_contract_html()
    (BASE_DIR / "02-hop-dong-khung.html").write_text(html_contract, encoding="utf-8")
    pdf_contract = BASE_DIR / "02-Hop-Dong-Khung-Dich-Vu-API-AI-01-11-2026-INUT-LIO.pdf"
    weasyprint.HTML(string=html_contract, base_url=str(BASE_DIR)).write_pdf(str(pdf_contract))

    # 3. Phụ lục 01 Kỳ tháng 11/2026 (1 trang A4 - ngày 01/11/2026)
    html_appendix = build_monthly_appendix_html(
        appendix_no=args.appendix_no,
        month_str=args.month,
        sign_date_str=args.sign_date,
        payment_window_str=args.payment_window,
        selected_tier_code=args.tier_code,
        selected_tier_name=args.tier_name,
        selected_req_quota=args.req_quota,
        selected_token_quota=args.token_quota,
        selected_amount=args.amount,
        selected_amount_words=args.amount_words,
    )
    (BASE_DIR / "03-phu-luc-thang.html").write_text(html_appendix, encoding="utf-8")
    pdf_appendix = BASE_DIR / "03-Phu-Luc-01-Thang-11-2026-API-AI-LIO-INUT.pdf"
    weasyprint.HTML(string=html_appendix, base_url=str(BASE_DIR)).write_pdf(str(pdf_appendix))

    # 4. FILE 01 (Đề ngày 01/11/2026 - Ký số ngay đầu tháng 11/2026): Gồm 05 trang đầu (Báo giá + Hợp đồng khung + Phụ lục 01)
    pdf_file_01 = BASE_DIR / "File-01-Ky-Ngay-01-11-2026-Bao-Gia-Hop-Dong-Khung-Va-Phu-Luc-01-API-9Router-LIO-INUT.pdf"
    writer = pypdf.PdfWriter()
    for src_pdf in (pdf_quote, pdf_contract, pdf_appendix):
        reader = pypdf.PdfReader(str(src_pdf))
        for page in reader.pages:
            writer.add_page(page)
    with open(pdf_file_01, "wb") as f_out:
        writer.write(f_out)

    # 5. FILE 02 (Đề ngày 30/11/2026 - Để dành đến 30/11/2026 mới ký số): Gồm 01 trang độc lập Báo cáo Usage & Biên bản nghiệm thu
    html_usage = build_monthly_usage_report_html(
        appendix_no=args.appendix_no,
        month_str=args.month,
        selected_tier_code=args.tier_code,
        selected_tier_name=args.tier_name,
        selected_req_quota=args.req_quota,
        selected_token_quota=args.token_quota,
        selected_amount=args.amount,
    )
    (BASE_DIR / "04-bao-cao-usage.html").write_text(html_usage, encoding="utf-8")
    pdf_file_02 = BASE_DIR / "File-02-Ky-Ngay-30-11-2026-Bao-Cao-Usage-Va-Bien-Ban-Nghiem-Thu-Thang-11-2026-LIO-INUT.pdf"
    weasyprint.HTML(string=html_usage, base_url=str(BASE_DIR)).write_pdf(str(pdf_file_02))
    # 6. Gom Phụ lục 01 + Báo cáo Usage thành file 03 (02 trang) & Gom trọn bộ 06 trang vào file 00
    pdf_03_pair = BASE_DIR / "03-Phu-Luc-01-Thang-11-2026-Va-Mau-Bao-Cao-Usage-API-LIO-INUT.pdf"
    w03 = pypdf.PdfWriter()
    for src_pdf in (pdf_appendix, pdf_file_02):
        for page in pypdf.PdfReader(str(src_pdf)).pages:
            w03.add_page(page)
    with open(pdf_03_pair, "wb") as f_out:
        w03.write(f_out)

    pdf_combined = BASE_DIR / "00-Tron-Bo-Ho-So-Hop-Dong-Bao-Gia-Phu-Luc-Usage-API-AI-9Router-LIO-INUT-2026.pdf"
    w00 = pypdf.PdfWriter()
    for src_pdf in (pdf_quote, pdf_contract, pdf_appendix, pdf_file_02):
        for page in pypdf.PdfReader(str(src_pdf)).pages:
            w00.add_page(page)
    with open(pdf_combined, "wb") as f_out:
        w00.write(f_out)

    for p in (pdf_combined, pdf_file_01, pdf_file_02, pdf_quote, pdf_contract, pdf_appendix, pdf_03_pair):
        r = pypdf.PdfReader(str(p))
        print(f"Generated: {p.name} ({p.stat().st_size:,} bytes | {len(r.pages)} pages)")

if __name__ == "__main__":
    main()
