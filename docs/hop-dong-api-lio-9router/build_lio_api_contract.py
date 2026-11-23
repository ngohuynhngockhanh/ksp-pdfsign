#!/usr/bin/env python3
"""
Bộ công cụ sinh Hồ sơ Hợp đồng Khung, Báo giá & Brief Kỹ thuật, và Phụ lục Gói cước + Báo cáo Usage hằng tháng
cho Dịch vụ Cổng kết nối API Trí tuệ Nhân tạo (AI Gateway / 9Router) giữa:
- BÊN CUNG CẤP DỊCH VỤ (BÊN A): HỘ KINH DOANH CÔNG NGHỆ LIO (MST: 054202003668)
- BÊN SỬ DỤNG DỊCH VỤ (BÊN B): CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT (MST: 4401053694)

Đã hợp nhất đầy đủ các điều khoản pháp lý rà soát theo bản điều chỉnh của LIO & INUT:
- Căn cứ Bộ luật Dân sự 91/2015/QH13 (Điều 403), Luật Thương mại 36/2005/QH11, Luật Giao dịch điện tử 20/2023/QH15,
  Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 và Nghị định 356/2025/NĐ-CP;
- Phạm vi sử dụng hợp pháp (bãi bỏ giải mã Captcha; bổ sung Điều 1.4 Sử dụng hợp pháp, Điều 1.5 Mô hình nhà cung cấp gốc);
- Quyền hạn kỹ thuật từng gói (Điều 2.1, 2.4, 2.5: AI-05 ngữ cảnh tối đa 200K tokens, suy luận đến xhigh; Video Gen / 400K+ / max-ultra thuộc AI-06+);
- Lịch thanh toán từ ngày 20 đến ngày 28 hằng tháng: Báo cáo Usage chuẩn lập và gửi trong ngày thanh toán, chuyển khoản thanh toán trong ngày,
  và Bên A xuất hóa đơn điện tử ngay vào ngày nhận chuyển khoản; kèm quy định chậm thanh toán (Điều 3.4);
- Bảo mật thông tin (lưu log kỹ thuật 12 tháng, nội dung truy vấn không quá 30 ngày) & Bảo vệ dữ liệu cá nhân (Điều 5.3, 5.5);
- Cam kết SLA >= 99,0%/tháng (bảo trì <= 08 giờ/tháng), xử lý gián đoạn dịch vụ > 48h, giới hạn trách nhiệm, kết quả do AI tạo ra,
  bất khả kháng, thông báo qua email và giải quyết tranh chấp (Điều 5.1, Điều 7.1 -> 7.10).
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import html as html_lib
import json
from pathlib import Path
import sqlite3
from typing import Any
import weasyprint
import pypdf

BASE_DIR = Path(__file__).resolve().parent

COMMON_CSS = """
@page {
  size: A4 portrait;
  margin: 6.5mm 10mm 7.5mm 10mm;
  @bottom-left {
    content: string(doc_footer_left);
    font-family: 'DejaVu Serif', 'Times New Roman', serif;
    font-size: 7.3pt;
    font-style: italic;
    color: #475569;
  }
  @bottom-right {
    content: "Trang " counter(page) " / " counter(pages);
    font-family: 'DejaVu Serif', 'Times New Roman', serif;
    font-size: 7.8pt;
    font-weight: bold;
    color: #1e293b;
  }
}

* {
  box-sizing: border-box;
}

body {
  font-family: 'DejaVu Serif', 'Times New Roman', serif;
  font-size: 7.65pt;
  line-height: 1.14;
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
  margin-bottom: 4px;
}

.nat-header td {
  vertical-align: top;
  text-align: center;
  padding: 0;
}

.org-name {
  font-size: 8.8pt;
  font-weight: bold;
  text-transform: uppercase;
  color: #0f172a;
  line-height: 1.2;
}

.org-sub {
  font-size: 8.1pt;
  margin-top: 1px;
  color: #334155;
}

.nat-title {
  font-size: 9.3pt;
  font-weight: bold;
  text-transform: uppercase;
  color: #0f172a;
}

.nat-motto {
  font-size: 9.0pt;
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
  font-size: 8.2pt;
  font-style: italic;
  margin-top: 2px;
  color: #334155;
}

h1.main-title {
  text-align: center;
  font-size: 10.5pt;
  font-weight: bold;
  text-transform: uppercase;
  color: #0f172a;
  margin: 2px 0 1px 0;
  line-height: 1.14;
}

.sub-title-center {
  text-align: center;
  font-size: 8.0pt;
  font-style: italic;
  color: #334155;
  margin-bottom: 3px;
}

.basis-box {
  font-size: 7.75pt;
  font-style: italic;
  text-align: justify;
  margin-bottom: 3px;
  color: #1e293b;
}

.party-box {
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  border-radius: 4px;
  padding: 4px 7px;
  margin-bottom: 4px;
}

.party-head {
  font-weight: bold;
  font-size: 8.0pt;
  color: #0f3d68;
  text-transform: uppercase;
  margin-bottom: 2px;
}

.party-tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 7.65pt;
}

.party-tbl td {
  padding: 0.6px 0;
  vertical-align: top;
}

.party-tbl td.k {
  width: 112px;
  font-weight: bold;
  color: #1e293b;
}

.party-tbl td.s {
  width: 10px;
  text-align: center;
}

.sec-heading {
  font-size: 8.4pt;
  font-weight: bold;
  text-transform: uppercase;
  color: #0f3d68;
  border-bottom: 1px solid #94a3b8;
  padding-bottom: 1px;
  margin: 4px 0 2.5px 0;
}

p {
  margin: 1.8px 0;
  text-align: justify;
}

ul.tight-list {
  margin: 1.5px 0 2.5px 0;
  padding-left: 14px;
}

ul.tight-list li {
  margin-bottom: 1.3px;
  text-align: justify;
}

table.tbl {
  width: 100%;
  border-collapse: collapse;
  margin: 2.5px 0 3.5px 0;
  font-size: 7.4pt;
}

table.tbl tr {
  break-inside: avoid;
  page-break-inside: avoid;
}

table.tbl th, table.tbl td {
  border: 1px solid #94a3b8;
  padding: 2.2px 4px;
  vertical-align: middle;
}

table.tbl th {
  background: #eff6ff;
  color: #0f3d68;
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
  border-left: 3px solid #0f3d68;
  background: #f1f5f9;
  padding: 3.5px 7px;
  margin: 3px 0;
  font-size: 7.55pt;
  text-align: justify;
}

.badge {
  display: inline-block;
  background: #dbeafe;
  color: #1e40af;
  font-weight: bold;
  padding: 0.5px 4px;
  border-radius: 3px;
  font-size: 7.3pt;
}

code {
  font-family: 'DejaVu Sans Mono', monospace;
  font-size: 7.0pt;
  background: #f1f5f9;
  padding: 0 2px;
  border-radius: 2px;
}

table.sig-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 5px;
  page-break-inside: avoid;
}

table.sig-table td {
  width: 50%;
  text-align: center;
  vertical-align: top;
}

.sig-role {
  font-weight: bold;
  font-size: 8.2pt;
  text-transform: uppercase;
  color: #0f172a;
}

.sig-note {
  font-size: 7.4pt;
  font-style: italic;
  color: #475569;
  margin-top: 1px;
}

.sig-space {
  height: 56px;
  position: relative;
}

.lio-sign-marker {
  color: #ffffff;
  font-size: 1pt;
  line-height: 1;
  user-select: none;
}

.sig-name {
  font-weight: bold;
  font-size: 8.5pt;
  text-transform: uppercase;
  color: #0f172a;
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
<div class="sub-title-center">(Áp dụng mô hình Thuê bao trọn gói hằng tháng kèm Báo cáo Usage chuẩn &amp; Thanh toán – Xuất hóa đơn từ ngày 20–28 hằng tháng)</div>

<div class="party-box">
  <div class="party-head">KÍNH GỬI (KHÁCH HÀNG DOANH NGHIỆP): CÔNG TY CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT</div>
  <table class="party-tbl">
    <tr><td class="k">Mã số thuế</td><td class="s">:</td><td><strong>4401053694</strong> &nbsp;&bull;&nbsp; <strong>Địa chỉ trụ sở:</strong> 161 Trường Chinh, Phường Tuy Hòa, Tỉnh Đắk Lắk, Việt Nam</td></tr>
    <tr><td class="k">Người đại diện</td><td class="s">:</td><td>Ông <strong>NGÔ HUỲNH NGỌC KHÁNH</strong> &nbsp;&mdash;&nbsp; Chức vụ: <strong>Giám đốc</strong> (ĐT: 0972 768 491 &bull; Email: <code>khanhnhn@inut.vn</code>)</td></tr>
    <tr><td class="k">Đơn vị chào giá</td><td class="s">:</td><td><strong>HỘ KINH DOANH CÔNG NGHỆ LIO</strong> (MST: <strong>054202003668</strong> &bull; Đại diện: Ông <strong>HUỲNH ĐỨC NHÂM</strong> – Chủ hộ kinh doanh &bull; Đ/c: 22 đường 3/2, KP Phú Thạnh 2, P. Phú Yên, tỉnh Đắk Lắk &bull; ĐT: 0344 714 490 &bull; Email: <code>nhamhd@liotech.vn</code>)</td></tr>
  </table>
</div>

<div class="sec-heading">PHẦN I. TỔNG QUAN GIẢI PHÁP &amp; DANH MỤC HẠNG MỤC KỸ THUẬT CUNG CẤP (AI GATEWAY BRIEF)</div>
<p>Nhằm đáp ứng nhu cầu sử dụng năng lực tính toán Trí tuệ Nhân tạo (AI/LLM) tần suất cao phục vụ hoạt động Nghiên cứu &amp; Phát triển (R&amp;D), tự động hóa xử lý chứng từ – đấu thầu (<strong>KSP PDFSign</strong>), vận hành Kiosk Hành chính công thông minh (<strong>VNMAP AI ONE</strong>), Hệ thống Bãi đỗ xe AI (<strong>VNMAP Parking</strong>), Nền tảng IoT/SCADA (<strong>iNut AppHub / iNut Smartcity</strong>) và trợ lý tác nhân AI nội bộ, <strong>Hộ kinh doanh Công nghệ LIO</strong> trân trọng đề xuất gói dịch vụ <strong>Cổng định tuyến và kết nối API Trí tuệ Nhân tạo hợp nhất (9Router AI Gateway)</strong> gồm <strong>07 hạng mục kỹ thuật cốt lõi</strong> sau:</p>

<table class="tbl">
  <thead>
    <tr>
      <th style="width:5%;">TT</th>
      <th style="width:24%;">Hạng mục Dịch vụ API</th>
      <th style="width:27%;">Chuẩn Giao thức / Endpoint &amp;<br/>Mã định tuyến nội bộ 9Router<br/><em>(Model Alias / Combo Profile)</em></th>
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
        <code>POST /v1/responses</code> &bull; <code>GET /v1/models</code>
      </td>
      <td>Cung cấp 01 chuẩn giao tiếp REST/SSE tương thích OpenAI &amp; Anthropic duy nhất; tự động biên dịch chéo giao thức (<em>Format Translator</em>), cân bằng tải đa tài khoản và chuyển mạch dự phòng tức thời (<em>Auto-Fallback Combos</em>: <code>pymid</code>, <code>gpt</code>, <code>hermes</code>, <code>opus-inut</code>, <code>sonnet</code>, <code>argon</code>, <code>for-plan</code>, <code>inut</code>) với mục tiêu khả dụng tối thiểu 99,0%/tháng.</td>
    </tr>
    <tr>
      <td class="c"><strong>02</strong></td>
      <td><strong>API Mô hình Ngôn ngữ Lớn &amp; Suy luận Chuyên sâu</strong><br/><em>(LLM Chat, Code-Gen &amp; Deep Reasoning)</em></td>
      <td>
        <em>Mã định tuyến nội bộ 9Router (Model Alias / Combo Profile):</em><br/>
        <code>gemini-4-argon-high-400k</code>, <code>gemini-3.8-flash-high</code>, <code>claude-opus-5-5-high-400k</code>, <code>gpt-6.1-sol</code> / <code>gpt-6-astra</code>
      </td>
      <td>Xử lý ngôn ngữ tự nhiên cửa sổ ngữ cảnh theo bậc gói (<code>200K</code> đến <code>400K&ndash;1M tokens</code>) với 06 cấp độ suy luận (<code>low</code>, <code>medium</code>, <code>high</code>, <code>xhigh</code>, <code>max</code>, <code>ultra</code>). Phục vụ sinh thuyết minh kỹ thuật, phân tích hồ sơ mời thầu e-GP, rà soát hợp đồng, bóc tách hóa đơn – tờ khai và lập trình tự động Firmware/SCADA.</td>
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
      <td><strong>API Thị giác Máy tính, Khởi tạo Ảnh &amp; Video AI</strong><br/><em>(Vision OCR, Image &amp; Video Gen)</em></td>
      <td>
        <code>GET /v1/models/image-to-text</code><br/>
        <code>POST /v1/images/generations</code><br/>
        <code>POST /v1/videos/generations</code>
      </td>
      <td>Nhận diện hình ảnh và OCR (bóc tách thông tin từ tài liệu và giấy tờ theo quy định bảo vệ dữ liệu cá nhân tại Điều 5.5 Hợp đồng, nhận diện biển số xe <strong>VNMAP Parking / iNut4C</strong>), tạo ảnh kỹ thuật và tạo video mô phỏng theo quyền hạn của từng gói.</td>
    </tr>
    <tr>
      <td class="c"><strong>06</strong></td>
      <td><strong>API Vector hóa (Embeddings) &amp; Truy vấn Web</strong><br/><em>(RAG Embeddings, Web Search &amp; Fetch)</em></td>
      <td>
        <code>POST /v1/embeddings</code><br/>
        <code>POST /v1/search</code> &bull; <code>POST /v1/web/fetch</code>
      </td>
      <td>Tạo vector nhúng (<em>Embeddings</em>) phục vụ cơ sở dữ liệu tri thức nội bộ (tra cứu văn bản pháp luật, QCVN, datasheet thiết bị); tìm kiếm thông tin web thời gian thực và trích xuất nội dung URL chuẩn Markdown sạch cho AI Agent.</td>
    </tr>
    <tr>
      <td class="c"><strong>07</strong></td>
      <td><strong>Quản trị Khóa API, Cụm Proxy &amp; Báo cáo Usage</strong><br/><em>(API Keys, Proxy Pools &amp; Usage Report)</em></td>
      <td>
        <code>Bearer sk-...</code> (Multi-Key)<br/>
        <code>Smart Proxy Pools</code><br/>
        <code>Usage Telemetry Engine</code>
      </td>
      <td>Phân quyền khóa API độc lập cho từng dự án/phòng ban của INUT (<code>ksp-inut-crm-pdf-signer</code>, <code>apphub-iot</code>, <code>apphub vnmap3d</code>, <code>inut-opc-inut-dev</code>, <code>chatbox-telegram-vnmap</code>...); định tuyến qua dải Proxy tĩnh và xuất <strong>Báo cáo Usage chuẩn trong ngày thanh toán</strong>.</td>
    </tr>
  </tbody>
</table>

<div class="sec-heading">PHẦN II. BIỂU PHÍ CÁC GÓI THUÊ BAO THÁNG &amp; QUYỀN HẠN KỸ THUẬT TỪNG GÓI</div>
<p>Dịch vụ API Trí tuệ Nhân tạo được cung cấp theo <strong>Gói thuê bao định mức hằng tháng</strong> (<strong>không áp dụng hình thức Pay-as-you-go tính cước lẻ</strong>). Mỗi gói được xác định bằng <strong>mức trần về số requests, tổng tokens và số API Keys</strong>; cận dưới chỉ dùng để phân bậc, và gói bậc cao bao gồm đầy đủ quyền hạn kỹ thuật của các gói bậc thấp hơn:</p>

<table class="tbl">
  <thead>
    <tr>
      <th style="width:8%;">Mã Gói<br/>(Bậc)</th>
      <th style="width:19%;">Tên Gói Thuê Bao Tháng</th>
      <th style="width:15%;">Định mức Trần<br/>Requests / Tháng</th>
      <th style="width:18%;">Định mức Trần Tokens / Tháng<br/><em>(Input + Output + Cache + Reasoning)</em></th>
      <th style="width:24%;">Quyền hạn Kỹ thuật<br/>&amp; Số lượng API Keys tối đa</th>
      <th style="width:16%;">Mức Phí Trọn Gói / Tháng (VNĐ)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td class="c"><strong>AI-01</strong><br/><em>(Bậc 1)</em></td>
      <td><strong>Gói Cơ Bản</strong><br/><em>(Starter API Tier)</em></td>
      <td class="c">Tối đa <strong>30.000</strong><br/>requests/tháng</td>
      <td class="c">Tối đa <strong>3,0 tỷ</strong> tokens<br/>(<code>&le; 3.0B tokens</code>)</td>
      <td>Tối đa 05 API Keys &bull; Hạng mục 1, 2 (suy luận <code>low/medium</code>, ngữ cảnh <code>128K</code>), 4 (TTS/STT chuẩn), 6 (Embeddings)</td>
      <td class="r"><strong>3.000.000 đ</strong></td>
    </tr>
    <tr>
      <td class="c"><strong>AI-02</strong><br/><em>(Bậc 2)</em></td>
      <td><strong>Gói Tiêu Chuẩn</strong><br/><em>(Standard API Tier)</em></td>
      <td class="c"><strong>30.001 &ndash; 60.000</strong><br/>(Trần: 60.000)</td>
      <td class="c"><strong>3,0 tỷ &ndash; 5,0 tỷ</strong> tokens<br/>(Trần: <code>5.0B tokens</code>)</td>
      <td>Tối đa 10 API Keys &bull; Mở khóa Hạng mục 3 (RTK Token Saver &amp; Caching), Hạng mục 5 (Vision OCR), Web Search/Fetch</td>
      <td class="r"><strong>5.000.000 đ</strong></td>
    </tr>
    <tr>
      <td class="c"><strong>AI-03</strong><br/><em>(Bậc 3)</em></td>
      <td><strong>Gói Nghiệp Vụ</strong><br/><em>(Business API Tier)</em></td>
      <td class="c"><strong>60.001 &ndash; 100.000</strong><br/>(Trần: 100.000)</td>
      <td class="c"><strong>5,0 tỷ &ndash; 8,0 tỷ</strong> tokens<br/>(Trần: <code>8.0B tokens</code>)</td>
      <td>Tối đa 15 API Keys &bull; Mở khóa Fusion Combo Auto-Fallback &amp; suy luận mức <code>high</code>, ngữ cảnh đến <code>200K tokens</code></td>
      <td class="r"><strong>8.000.000 đ</strong></td>
    </tr>
    <tr>
      <td class="c"><strong>AI-04</strong><br/><em>(Bậc 4)</em></td>
      <td><strong>Gói Chuyên Nghiệp</strong><br/><em>(Pro API Tier)</em></td>
      <td class="c"><strong>100.001 &ndash; 150.000</strong><br/>(Trần: 150.000)</td>
      <td class="c"><strong>8,0 tỷ &ndash; 12,0 tỷ</strong> tokens<br/>(Trần: <code>12.0B tokens</code>)</td>
      <td>Tối đa 20 API Keys &bull; Suy luận mức <code>xhigh</code>, ngữ cảnh tối đa <code>200K tokens</code>, Image Gen, Smart Proxy Pools dự phòng</td>
      <td class="r"><strong>12.000.000 đ</strong></td>
    </tr>
    <tr>
      <td class="c"><strong>AI-05</strong><br/><em>(Bậc 5)</em></td>
      <td><strong>Gói Tăng Trưởng</strong><br/><em>(Growth API Tier)</em></td>
      <td class="c"><strong>150.001 &ndash; 220.000</strong><br/>(Trần: 220.000)</td>
      <td class="c"><strong>12,0 tỷ &ndash; 16,0 tỷ</strong> tokens<br/>(Trần: <code>16.0B tokens</code>)</td>
      <td>Tối đa 25 API Keys &bull; Suy luận đến <code>xhigh</code>, ngữ cảnh tối đa <code>200K tokens</code>, Vision OCR + Image Gen, <code>Fast Priority 1.5x</code>, Multi-Agent <em>(chưa gồm Video Gen, ngữ cảnh &ge;400K, suy luận max/ultra)</em></td>
      <td class="r"><strong>16.000.000 đ</strong></td>
    </tr>
    <tr>
      <td class="c"><strong>AI-06</strong><br/><em>(Bậc 6)</em></td>
      <td><strong>Gói Doanh Nghiệp I</strong><br/><em>(Enterprise I Tier)</em></td>
      <td class="c"><strong>220.001 &ndash; 300.000</strong><br/>(Trần: 300.000)</td>
      <td class="c"><strong>16,0 tỷ &ndash; 20,0 tỷ</strong> tokens<br/>(Trần: <code>20.0B tokens</code>)</td>
      <td>Tối đa 35 API Keys &bull; Mở khóa <strong>Video Gen</strong>, cửa sổ ngữ cảnh lớn <code>400K &ndash; 1M tokens</code> &amp; suy luận mức <code>max</code></td>
      <td class="r"><strong>20.000.000 đ</strong></td>
    </tr>
    <tr>
      <td class="c"><strong>AI-07</strong><br/><em>(Bậc 7)</em></td>
      <td><strong>Gói Doanh Nghiệp II</strong><br/><em>(Enterprise II Tier)</em></td>
      <td class="c"><strong>300.001 &ndash; 380.000</strong><br/>(Trần: 380.000)</td>
      <td class="c"><strong>20,0 tỷ &ndash; 25,0 tỷ</strong> tokens<br/>(Trần: <code>25.0B tokens</code>)</td>
      <td>Tối đa 50 API Keys &bull; Luồng định tuyến ưu tiên riêng (Dedicated Combo &amp; Proxy) + suy luận <code>max/ultra</code></td>
      <td class="r"><strong>25.000.000 đ</strong></td>
    </tr>
    <tr>
      <td class="c"><strong>AI-08</strong><br/><em>(Bậc 8)</em></td>
      <td><strong>Gói Hạ Tầng Toàn Diện</strong><br/><em>(Unlimited Scale Tier)</em></td>
      <td class="c"><strong>380.001 &ndash; 500.000</strong><br/>(Trần: 500.000)</td>
      <td class="c"><strong>25,0 tỷ &ndash; 30,0 tỷ</strong> tokens<br/>(Trần: <code>30.0B tokens</code>)</td>
      <td>Không giới hạn API Keys &bull; Toàn bộ cụm <code>9Router</code> (trọn bộ 07 hạng mục, ngữ cảnh <code>1M</code>, suy luận <code>max/ultra</code>)</td>
      <td class="r"><strong>30.000.000 đ</strong></td>
    </tr>
    <tr>
      <td class="c"><strong>AI-FLEX</strong></td>
      <td><strong>Gói Thỏa Thuận Tháng</strong><br/><em>(Custom Monthly Package)</em></td>
      <td colspan="3">Theo cấu hình quyền hạn bổ sung hoặc sản lượng Usage dự kiến thỏa thuận trực tiếp giữa hai Bên tại Phụ lục của từng tháng cụ thể.</td>
      <td class="r"><strong>Thỏa thuận theo<br/>Phụ lục tháng<br/>(3tr &ndash; 30tr đ)</strong></td>
    </tr>
  </tbody>
</table>

<div class="callout-info">
  <strong>Nguyên tắc áp dụng Gói thuê bao, Báo cáo Usage chuẩn trong ngày &amp; Thanh toán – Xuất hóa đơn (Từ ngày 20 đến ngày 28 hằng tháng):</strong><br/>
  1. <strong>Mô hình mua theo Gói cố định, KHÔNG phải Pay-as-you-go:</strong> Mỗi tháng hai Bên ký <strong>01 Phụ lục Hợp đồng</strong> để chốt gói dịch vụ và mức phí trọn gói của tháng đó (từ <code>3.000.000 đ</code> đến <code>30.000.000 đ</code>). Không phát sinh cước vượt trần tự động ngoài Phụ lục đã ký.<br/>
  2. <strong>Báo cáo Usage chuẩn trong ngày &amp; Chuyển khoản trong ngày (Từ ngày 20 đến ngày 28 hằng tháng):</strong> Trong khoảng thời gian từ <strong>ngày 20 đến ngày 28 hằng tháng</strong>, vào ngày chốt thanh toán của kỳ, Hộ kinh doanh Công nghệ LIO kết xuất và gửi <strong>Báo cáo Usage chuẩn trong ngày</strong>; Công ty INUT kiểm tra đối soát và <strong>chuyển khoản thanh toán 100% giá trị gói ngay trong ngày</strong> vào STK <strong>00344714490 – Ngân hàng Quân đội (MB Bank)</strong> – Chủ TK: <strong>HỘ KINH DOANH CÔNG NGHỆ LIO</strong>.<br/>
  3. <strong>Xuất hóa đơn điện tử vào ngày chuyển khoản:</strong> Hộ kinh doanh Công nghệ LIO lập và xuất <strong>Hóa đơn điện tử hợp lệ ngay vào ngày nhận được tiền chuyển khoản thanh toán</strong> của Công ty INUT.
</div>

<table class="sig-table">
  <tr>
    <td>
      <div class="sig-role">XÁC NHẬN CỦA KHÁCH HÀNG (CÔNG TY INUT)</div>
      <div class="sig-note">(Ký số, ghi rõ họ tên)</div>
      <div class="sig-space"></div>
      <div class="sig-name">NGÔ HUỲNH NGỌC KHÁNH</div>
    </td>
    <td>
      <div class="sig-role">ĐẠI DIỆN HỘ KINH DOANH CÔNG NGHỆ LIO</div>
      <div class="sig-note">(Ký số, ghi rõ họ tên)</div>
      <div class="sig-space lio-sig-space"><span class="lio-sign-marker">[[LIO_SIGN]]</span></div>
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
<style>
{COMMON_CSS}
@page {{ margin: 5.5mm 9.5mm 6.5mm 9.5mm; }}
body {{ font-size: 6.95pt; line-height: 1.085; }}
h1.main-title {{ font-size: 9.8pt; margin: 1px 0; }}
.sub-title-center {{ font-size: 7.5pt; margin-bottom: 2px; }}
.basis-box {{ font-size: 7.1pt; margin-bottom: 2px; }}
.party-box {{ padding: 3px 6px; margin-bottom: 2.5px; }}
.party-head {{ font-size: 7.5pt; margin-bottom: 1px; }}
.party-tbl {{ font-size: 7.05pt; }}
.sec-heading {{ font-size: 7.8pt; margin: 2.5px 0 1.5px 0; padding-bottom: 0.5px; }}
p {{ margin: 1.1px 0; }}
ul.tight-list {{ margin: 1px 0 1.5px 0; padding-left: 12px; }}
ul.tight-list li {{ margin-bottom: 0.8px; }}
table.tbl {{ margin: 1.5px 0 2px 0; font-size: 6.85pt; }}
table.tbl th, table.tbl td {{ padding: 1.3px 3px; }}
code {{ font-size: 6.5pt; }}
table.sig-table {{ margin-top: 3px; }}
.sig-space {{ height: 52px; }}
</style>
</head>
<body>
<div class="footer-str">Hợp đồng nguyên tắc Dịch vụ API Trí tuệ Nhân tạo số 0111/2026/HĐDV-LIO-INUT — Ký ngày 01/11/2026</div>

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
  - Căn cứ Bộ luật Dân sự số 91/2015/QH13 ngày 24/11/2015, trong đó có Điều 403 về phụ lục hợp đồng;<br/>
  - Căn cứ Luật Thương mại số 36/2005/QH11 và Luật Giao dịch điện tử số 20/2023/QH15;<br/>
  - Căn cứ Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15 và Nghị định số 356/2025/NĐ-CP;<br/>
  - Căn cứ nhu cầu sử dụng dịch vụ thực tế của Công ty Cổ phần Đầu tư và Phát triển Công nghệ INUT và năng lực cung ứng hạ tầng của Hộ kinh doanh Công nghệ LIO.
</div>

<p>Hôm nay, ngày <strong>01 tháng 11 năm 2026</strong>, tại tỉnh Đắk Lắk, chúng tôi gồm có:</p>

<div class="party-box">
  <table class="party-tbl">
    <tr>
      <td style="width:50%; padding-right:8px; border-right:1px solid #cbd5e1;">
        <div class="party-head">BÊN A (BÊN CUNG CẤP DỊCH VỤ): HỘ KINH DOANH CÔNG NGHỆ LIO</div>
        - <strong>Mã số thuế:</strong> <strong>054202003668</strong><br/>
        - <strong>Địa chỉ:</strong> 22 đường 3/2, khu phố Phú Thạnh 2, phường Phú Yên, tỉnh Đắk Lắk<br/>
        - <strong>Đại diện:</strong> Ông <strong>HUỲNH ĐỨC NHÂM</strong> &ndash; <strong>Chủ hộ kinh doanh</strong> (ĐT: 0344 714 490)<br/>
        - <strong>Tài khoản:</strong> <strong>00344714490</strong> tại <strong>Ngân hàng TMCP Quân đội (MB Bank)</strong> &ndash; Chủ TK: <strong>HỘ KINH DOANH CÔNG NGHỆ LIO</strong><br/>
        - <strong>Email nhận thông báo:</strong> <code>nhamhd@liotech.vn</code>
      </td>
      <td style="width:50%; padding-left:8px;">
        <div class="party-head">BÊN B (BÊN SỬ DỤNG DỊCH VỤ): CÔNG TY CP ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT</div>
        - <strong>Mã số thuế:</strong> <strong>4401053694</strong><br/>
        - <strong>Địa chỉ trụ sở:</strong> 161 Trường Chinh, phường Tuy Hòa, tỉnh Đắk Lắk<br/>
        - <strong>Đại diện:</strong> Ông <strong>NGÔ HUỲNH NGỌC KHÁNH</strong> &ndash; <strong>Giám đốc</strong> (ĐT: 0972 768 491)<br/>
        - <strong>Tài khoản:</strong> <strong>79713</strong> tại <strong>Ngân hàng TMCP Kỹ Thương Việt Nam (Techcombank)</strong><br/>
        - <strong>Email nhận thông báo:</strong> <code>khanhnhn@inut.vn</code>
      </td>
    </tr>
  </table>
</div>

<p>Hai Bên thống nhất ký kết <strong>Hợp đồng nguyên tắc cung cấp gói dịch vụ Cổng kết nối API Trí tuệ Nhân tạo</strong> (sau đây gọi là “Hợp đồng”) với các điều khoản sau:</p>

<div class="sec-heading">ĐIỀU 1. PHẠM VI DỊCH VỤ, SỬ DỤNG HỢP PHÁP &amp; MÔ HÌNH NHÀ CUNG CẤP GỐC</div>
<p><strong>1.1. Bản chất Hợp đồng:</strong> Hợp đồng này quy định các điều kiện kỹ thuật, biểu phí khung và quy trình đối soát, thanh toán cho việc Bên A cung cấp cho Bên B <strong>Gói dịch vụ Cổng kết nối và định tuyến API Trí tuệ Nhân tạo đa mô hình (9Router AI Gateway)</strong> phục vụ hoạt động sản xuất kinh doanh, phát triển phần mềm và vận hành thiết bị của Bên B.</p>
<p><strong>1.2. Các hạng mục kỹ thuật thuộc phạm vi dịch vụ (07 Hạng mục 9Router AI Gateway):</strong></p>
<ul class="tight-list">
  <li><strong>Hạng mục 1 – Cổng định tuyến AI hợp nhất (Unified AI Gateway &amp; Fusion Combo):</strong> Cung cấp điểm cuối <code>/v1/chat/completions</code>, <code>/v1/messages</code>, <code>/v1/responses</code> kèm cơ chế chuyển đổi giao thức, cân bằng tải và chuyển mạch dự phòng (<em>Auto-Fallback Combos</em>: <code>pymid</code>, <code>gpt</code>, <code>hermes</code>, <code>opus-inut</code>, <code>sonnet</code>, <code>argon</code>, <code>for-plan</code>, <code>inut</code>).</li>
  <li><strong>Hạng mục 2 – API Xử lý Ngôn ngữ Lớn &amp; Suy luận chuyên sâu (LLM Chat, Code-Gen &amp; Deep Reasoning):</strong> Truy cập các mô hình ngôn ngữ và suy luận đa cấp qua <strong>Mã định tuyến nội bộ 9Router (Model Alias / Combo Profile)</strong> (gồm: <code>gemini-4-argon-high-400k</code>, <code>gemini-3.8-flash-high/medium</code>, <code>claude-opus-5-5-high-400k</code>, <code>claude-sonnet</code>, <code>gpt-6.1-sol</code>, <code>gpt-6-astra</code>) phục vụ lập trình phần mềm/firmware, phân tích hồ sơ thầu e-GP, soạn thảo kỹ thuật và bóc tách dữ liệu chứng từ.</li>
  <li><strong>Hạng mục 3 – Nén ngữ cảnh &amp; Bộ nhớ đệm Token (RTK Token Saver &amp; Context Caching):</strong> Nén tự động kết quả công cụ (<code>RTK Hook</code>) và quản lý bộ nhớ đệm ngữ cảnh (<code>Cached Tokens</code> / <code>/v1/responses/compact</code>).</li>
  <li><strong>Hạng mục 4 – API Giọng nói AI (TTS &amp; STT):</strong> Tổng hợp giọng đọc Tiếng Việt (<code>/v1/audio/speech</code>: <code>google-tts/vi</code>, <code>edge-tts/vi-VN-HoaiMyNeural</code>, <code>kokoro</code>) và chuyển giọng nói thành văn bản (<code>/v1/audio/transcriptions</code>) phục vụ Kiosk <strong>VNMAP AI ONE</strong> và loa thông báo thông minh.</li>
  <li><strong>Hạng mục 5 – API Thị giác máy tính, Khởi tạo Ảnh và Video AI:</strong> Nhận diện hình ảnh và OCR (bóc tách thông tin từ tài liệu và giấy tờ theo Điều 5.5 Hợp đồng, nhận diện biển số xe <strong>VNMAP Parking / iNut4C</strong>), tạo ảnh kỹ thuật (<code>/v1/images/generations</code>) và tạo video mô phỏng (<code>/v1/videos/generations</code>) theo quyền hạn của từng gói.</li>
  <li><strong>Hạng mục 6 – API Vector hóa (Embeddings) &amp; Truy xuất Web (Web Search &amp; Web Fetch):</strong> Tạo vector dữ liệu (<code>/v1/embeddings</code>) cho hệ thống tra cứu RAG nội bộ và tìm kiếm/trích xuất dữ liệu web (<code>/v1/search</code>, <code>/v1/web/fetch</code>).</li>
  <li><strong>Hạng mục 7 – Quản trị Khóa API (Bearer Keys), Cụm Proxy &amp; Báo cáo Usage định kỳ:</strong> Cấp phát các khóa <code>Bearer API Key</code> riêng cho từng phân hệ của Bên B, duy trì cụm <code>Smart Proxy Pools</code> và kết xuất <strong>Báo cáo Usage chuẩn</strong> theo từng khóa, từng endpoint và mô hình.</li>
</ul>
<p><strong>1.3. Tính độc lập về hạ tầng và quyền sở hữu:</strong> Hệ thống Cổng định tuyến 9Router AI Gateway, mã nguồn điều phối, cơ chế nén ngữ cảnh RTK, cụm Proxy Pools và hạ tầng kết nối là tài sản công nghệ và hạ tầng kinh doanh độc lập thuộc quyền sở hữu, quản lý riêng của Bên A (do Bên A tự đầu tư và vận hành). Bên B chỉ thuê quyền truy cập dịch vụ theo gói định mức hằng tháng và không nắm giữ quyền sở hữu đối với hạ tầng lõi của Bên A.</p>
<p><strong>1.4. Sử dụng hợp pháp:</strong> Bên B không sử dụng dịch vụ để vượt qua hoặc vô hiệu hóa các biện pháp xác thực, kiểm soát truy cập (bao gồm CAPTCHA) của hệ thống thông tin của cơ quan nhà nước hoặc của bên thứ ba, hoặc cho mục đích trái pháp luật. Khi có căn cứ cho rằng một khóa API bị sử dụng trái với điểm này, Bên A được tạm ngưng khóa API đó và thông báo ngay cho Bên B.</p>
<p><strong>1.5. Mô hình của nhà cung cấp gốc:</strong> Dịch vụ sử dụng các mô hình AI do bên thứ ba phát triển và vận hành (“Nhà cung cấp gốc”). Tên mô hình nêu trong Hợp đồng và các Phụ lục là mã định tuyến nội bộ của hệ thống 9Router, không phải cam kết về một phiên bản mô hình cụ thể. Khi Nhà cung cấp gốc thay đổi, ngừng hoặc giới hạn một mô hình, Bên A được thay thế bằng mô hình có năng lực tương đương và thông báo cho Bên B trong 03 (ba) ngày làm việc. Trường hợp không có mô hình tương đương, áp dụng Điều 7.1 Hợp đồng. Bên B tuân thủ chính sách sử dụng của Nhà cung cấp gốc mà Bên A đã thông báo.</p>

<div class="sec-heading">ĐIỀU 2. ĐỊNH MỨC GÓI THUÊ BAO THÁNG &amp; QUYỀN HẠN KỸ THUẬT</div>
<p><strong>2.1. Nguyên tắc định mức gói:</strong> Dịch vụ được cung cấp theo hình thức <strong>Gói thuê bao định mức hằng tháng</strong> (không áp dụng Pay-as-you-go). Mỗi gói được xác định bằng <strong>mức trần về số requests, tổng tokens và số API Keys</strong>; cận dưới trong biểu phí chỉ dùng để phân bậc. Khi mức sử dụng chạm bất kỳ mức trần nào, áp dụng cơ chế điều tiết tại Điều 2.3. Phần định mức chưa sử dụng trong kỳ không được hoàn tiền và không chuyển sang kỳ sau, trừ trường hợp quy định tại Điều 7.1:</p>

<table class="tbl">
  <thead>
    <tr>
      <th style="width:9%;">Mã Gói</th>
      <th style="width:21%;">Tên Gói Dịch Vụ</th>
      <th style="width:18%;">Định mức Requests / Tháng</th>
      <th style="width:23%;">Định mức Tổng Tokens / Tháng<br/><em>(Input + Output + Cache + Reasoning)</em></th>
      <th style="width:13%;">Trần Số lượng<br/>API Keys</th>
      <th style="width:16%;">Mức Phí Trọn Gói / Tháng (VNĐ)</th>
    </tr>
  </thead>
  <tbody>
    <tr><td class="c"><strong>AI-01</strong></td><td><strong>Gói Cơ Bản (Starter)</strong></td><td class="c"><code>0 &ndash; 30.000</code> reqs</td><td class="c">Tối đa <code>3,0 tỷ</code> tokens (<code>3.0B</code>)</td><td class="c">Tối đa 05 keys</td><td class="r"><strong>3.000.000 đ</strong></td></tr>
    <tr><td class="c"><strong>AI-02</strong></td><td><strong>Gói Tiêu Chuẩn (Standard)</strong></td><td class="c"><code>30.001 &ndash; 60.000</code> reqs</td><td class="c"><code>3,0 tỷ &ndash; 5,0 tỷ</code> tokens (<code>5.0B</code>)</td><td class="c">Tối đa 10 keys</td><td class="r"><strong>5.000.000 đ</strong></td></tr>
    <tr><td class="c"><strong>AI-03</strong></td><td><strong>Gói Nghiệp Vụ (Business)</strong></td><td class="c"><code>60.001 &ndash; 100.000</code> reqs</td><td class="c"><code>5,0 tỷ &ndash; 8,0 tỷ</code> tokens (<code>8.0B</code>)</td><td class="c">Tối đa 15 keys</td><td class="r"><strong>8.000.000 đ</strong></td></tr>
    <tr><td class="c"><strong>AI-04</strong></td><td><strong>Gói Chuyên Nghiệp (Pro)</strong></td><td class="c"><code>100.001 &ndash; 150.000</code> reqs</td><td class="c"><code>8,0 tỷ &ndash; 12,0 tỷ</code> tokens (<code>12.0B</code>)</td><td class="c">Tối đa 20 keys</td><td class="r"><strong>12.000.000 đ</strong></td></tr>
    <tr><td class="c"><strong>AI-05</strong></td><td><strong>Gói Tăng Trưởng (Growth)</strong></td><td class="c"><code>150.001 &ndash; 220.000</code> reqs</td><td class="c"><code>12,0 tỷ &ndash; 16,0 tỷ</code> tokens (<code>16.0B</code>)</td><td class="c">Tối đa 25 keys</td><td class="r"><strong>16.000.000 đ</strong></td></tr>
    <tr><td class="c"><strong>AI-06</strong></td><td><strong>Gói Doanh Nghiệp I</strong></td><td class="c"><code>220.001 &ndash; 300.000</code> reqs</td><td class="c"><code>16,0 tỷ &ndash; 20,0 tỷ</code> tokens (<code>20.0B</code>)</td><td class="c">Tối đa 35 keys</td><td class="r"><strong>20.000.000 đ</strong></td></tr>
    <tr><td class="c"><strong>AI-07</strong></td><td><strong>Gói Doanh Nghiệp II</strong></td><td class="c"><code>300.001 &ndash; 380.000</code> reqs</td><td class="c"><code>20,0 tỷ &ndash; 25,0 tỷ</code> tokens (<code>25.0B</code>)</td><td class="c">Tối đa 50 keys</td><td class="r"><strong>25.000.000 đ</strong></td></tr>
    <tr><td class="c"><strong>AI-08</strong></td><td><strong>Gói Hạ Tầng Toàn Diện</strong></td><td class="c"><code>380.001 &ndash; 500.000</code> reqs</td><td class="c"><code>25,0 tỷ &ndash; 30,0 tỷ</code> tokens (<code>30.0B</code>)</td><td class="c">Không giới hạn</td><td class="r"><strong>30.000.000 đ</strong></td></tr>
    <tr><td class="c"><strong>AI-FLEX</strong></td><td><strong>Gói Thỏa Thuận Theo Tháng</strong></td><td colspan="3">Theo cấu hình quyền hạn bổ sung hoặc bậc định mức thỏa thuận riêng tại Phụ lục của từng tháng.</td><td class="r"><strong>Theo Phụ lục</strong></td></tr>
  </tbody>
</table>

<p><strong>2.2. Ký Phụ lục chốt gói hằng tháng:</strong> Mỗi kỳ tháng, hai Bên ký <strong>01 Phụ lục Hợp đồng</strong> ghi nhận Mã gói cước đăng ký, định mức trần và mức phí trọn gói của kỳ đó.</p>
<p><strong>2.3. Chính sách thuế và điều tiết định mức:</strong> Mức phí trọn gói đã bao gồm các loại thuế, phí theo quy định áp dụng đối với hộ kinh doanh (nếu có). Khi mức sử dụng chạm trần định mức gói trong kỳ, hệ thống tự động điều tiết tốc độ (<em>Soft Rate-Limit</em> / chuyển sang mô hình tiết kiệm token) mà không tự ý tính thêm phí vượt gói nếu chưa có phụ lục nâng gói.</p>
<p><strong>2.4. Quyền hạn kỹ thuật:</strong> Quyền hạn kỹ thuật của từng gói được xác định theo cột “Quyền hạn Kỹ thuật &amp; Số lượng API Keys tối đa” tại Phần II Bảng báo giá số <code>0111/2026/BG-LIO-INUT</code>; gói bậc cao bao gồm quyền hạn của các gói bậc thấp hơn. Phụ lục tháng chỉ mở rộng quyền hạn ngoài bảng này khi ghi rõ là “quyền hạn bổ sung” kèm mức phí tương ứng.</p>
<p><strong>2.5. Nâng gói trong kỳ:</strong> Bên B có thể đề nghị nâng gói trong kỳ bằng phụ lục bổ sung. Bên B thanh toán phần chênh lệch giữa hai gói trong 05 (năm) ngày làm việc kể từ ngày ký phụ lục bổ sung; định mức mới áp dụng từ ngày Bên A nhận đủ tiền. Không áp dụng hạ gói trong kỳ.</p>

<div class="sec-heading">ĐIỀU 3. BÁO CÁO USAGE TRONG NGÀY, THANH TOÁN (NGÀY 20–28 HẰNG THÁNG) &amp; HÓA ĐƠN</div>
<p><strong>3.1. Thời hạn thanh toán hằng tháng (Từ ngày 20 đến ngày 28 hằng tháng) &amp; Báo cáo Usage chuẩn trong ngày:</strong> Trong khoảng thời gian <strong>từ ngày 20 đến ngày 28 hằng tháng</strong>, vào ngày thanh toán của kỳ, <strong>Bên A kết xuất và gửi cho Bên B Bản Báo cáo Usage chuẩn tính đến trong ngày đó</strong>; căn cứ Báo cáo Usage chuẩn và Phụ lục tháng, <strong>Bên B kiểm tra và thực hiện chuyển khoản thanh toán 100% giá trị gói dịch vụ ngay trong ngày</strong>.</p>
<p><strong>3.2. Phương thức thanh toán:</strong> Chuyển khoản ngân hàng 100% vào tài khoản số <strong>00344714490</strong> tại <strong>Ngân hàng TMCP Quân đội (MB Bank)</strong> — Chủ tài khoản: <strong>HỘ KINH DOANH CÔNG NGHỆ LIO</strong> (Đại diện: Ông <strong>HUỲNH ĐỨC NHÂM</strong> – Chủ Hộ kinh doanh Công nghệ LIO). Nội dung chuyển khoản: <code>INUT thanh toan goi dich vu API AI thang [MM/YYYY] theo HD 0111/2026/HDDV-LIO-INUT</code>.</p>
<p><strong>3.3. Thời điểm lập hóa đơn điện tử và bộ chứng từ:</strong> <strong>Bên A lập và xuất hóa đơn điện tử hợp lệ ngay vào ngày nhận được tiền chuyển khoản thanh toán của Bên B</strong> (cùng ngày kết xuất Báo cáo Usage chuẩn và chuyển khoản thanh toán). Báo cáo Usage là căn cứ nghiệm thu dịch vụ; Bên B xác nhận ngay trong ngày thanh toán hoặc nêu ý kiến trong tối đa 05 (năm) ngày làm việc kể từ ngày nhận (hết thời hạn này mà Bên B không có ý kiến thì Báo cáo được coi là đã được xác nhận). Bộ chứng từ của mỗi kỳ gồm: Hợp đồng; Phụ lục tháng; hóa đơn điện tử xuất ngày chuyển khoản; chứng từ chuyển khoản; Báo cáo Usage đã được xác nhận.</p>
<p><strong>3.4. Chậm thanh toán:</strong> Hết ngày 28 của kỳ mà Bên A chưa nhận đủ tiền, Bên A gửi thông báo cho Bên B. Sau 05 (năm) ngày làm việc kể từ ngày thông báo mà Bên B vẫn chưa thanh toán đủ, Bên A được tạm ngưng dịch vụ hoặc giảm định mức xuống mức gói <code>AI-01</code> cho đến khi nhận đủ tiền. Bên B trả lãi chậm trả trên số tiền chậm trả theo Điều 306 Luật Thương mại. Thời gian tạm ngưng theo điểm này không được tính là thời gian ngừng dịch vụ theo Điều 7.1.</p>

<div class="sec-heading">ĐIỀU 4. THỜI HẠN HỢP ĐỒNG</div>
<p><strong>4.1.</strong> Hợp đồng này có hiệu lực kể từ ngày <strong>01 tháng 11 năm 2026</strong> và áp dụng không xác định thời hạn cho đến khi một Bên có thông báo chấm dứt gửi cho Bên kia trước ít nhất <strong>30 ngày</strong>, sau khi hai Bên đã hoàn tất đối soát Usage và thanh quyết toán xong kỳ hiện hành.</p>

<div class="sec-heading">ĐIỀU 5. CHẤT LƯỢNG DỊCH VỤ (SLA), BẢO MẬT &amp; BẢO VỆ DỮ LIỆU CÁ NHÂN</div>
<p><strong>5.1. Chất lượng dịch vụ (SLA):</strong> Bên A duy trì Cổng định tuyến 9Router với mục tiêu khả dụng tối thiểu <strong>99,0%</strong> thời gian mỗi tháng, đo tại điểm cuối API của Bên A, kèm cơ chế chuyển mạch dự phòng (<em>Auto-Fallback</em>). Không tính vào thời gian gián đoạn: bảo trì có thông báo trước tối thiểu 24 giờ, tổng không quá <strong>08 (tám) giờ</strong> mỗi tháng; sự cố hoặc giới hạn từ phía Nhà cung cấp gốc mà Bên A đã chuyển mạch dự phòng hoặc thông báo kịp thời cho Bên B; sự kiện bất khả kháng; lỗi từ phía Bên B.</p>
<p><strong>5.2. Cấp phát khóa và hỗ trợ kỹ thuật:</strong> Bên A cấp phát các khóa <code>Bearer API Keys</code> theo đúng định mức gói tại Phụ lục và hỗ trợ kỹ thuật khi Bên B tích hợp.</p>
<p><strong>5.3. Bảo mật thông tin:</strong> Bên A bảo mật nội dung truy vấn, mã nguồn, tài liệu kỹ thuật, dữ liệu khách hàng và thông tin kinh doanh của Bên B truyền qua cổng API. Bên A chỉ truyền dữ liệu tới Nhà cung cấp gốc trong phạm vi cần thiết để xử lý từng truy vấn theo yêu cầu của Bên B; việc truyền này không bị coi là tiết lộ cho bên thứ ba. Bên A không dùng dữ liệu của Bên B để huấn luyện mô hình, không bán hoặc cung cấp cho bên khác, trừ khi cơ quan nhà nước có thẩm quyền yêu cầu theo quy định của pháp luật. Bên A lưu nhật ký kỹ thuật (thời điểm, khóa API, endpoint, mô hình, số tokens) để lập Báo cáo Usage trong <strong>12 (mười hai) tháng</strong>; nội dung truy vấn và kết quả không được lưu quá <strong>30 (ba mươi) ngày</strong>, trừ khi Bên B yêu cầu khác bằng văn bản.</p>
<p><strong>5.4. Nghĩa vụ hóa đơn và báo cáo:</strong> Vào ngày thanh toán trong khung ngày 20–28 hằng tháng, Bên A cung cấp Báo cáo Usage chuẩn trong ngày và lập hóa đơn điện tử ngay vào ngày nhận được tiền chuyển khoản thanh toán của Bên B theo Điều 3.3.</p>
<p><strong>5.5. Dữ liệu cá nhân:</strong> Khi Bên B gửi dữ liệu cá nhân qua dịch vụ (bao gồm thông tin căn cước công dân, hình ảnh hoặc giọng nói gắn với cá nhân): <strong>(a)</strong> Bên B là bên kiểm soát dữ liệu cá nhân, Bên A là bên xử lý dữ liệu cá nhân theo Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15 và Nghị định số 356/2025/NĐ-CP; Hợp đồng này là thỏa thuận xử lý dữ liệu cá nhân giữa hai Bên; <strong>(b)</strong> Bên B bảo đảm có cơ sở pháp lý để xử lý, bao gồm sự đồng ý của chủ thể dữ liệu khi pháp luật yêu cầu, và chỉ gửi dữ liệu cần thiết cho mục đích xử lý; <strong>(c)</strong> Bên A chỉ xử lý dữ liệu theo chỉ dẫn của Bên B, áp dụng biện pháp bảo vệ phù hợp và giới hạn người có quyền truy cập; <strong>(d)</strong> Bên B được thông báo rằng một số Nhà cung cấp gốc đặt máy chủ ngoài lãnh thổ Việt Nam; trước khi gửi dữ liệu cá nhân qua các mô hình này, hai Bên phối hợp thực hiện thủ tục chuyển dữ liệu cá nhân ra nước ngoài theo quy định, và Bên B có thể yêu cầu Bên A cấp khóa API riêng chỉ định tuyến tới các mô hình được hai Bên thống nhất cho dữ liệu cá nhân; <strong>(đ)</strong> Bên A thông báo cho Bên B về sự cố lộ, mất dữ liệu cá nhân trong vòng <strong>24 (hai mươi bốn) giờ</strong> kể từ khi phát hiện; <strong>(e)</strong> Khi Hợp đồng chấm dứt, Bên A xóa dữ liệu cá nhân còn lưu trong <strong>30 (ba mươi) ngày</strong>, trừ phần pháp luật yêu cầu lưu giữ.</p>

<div class="sec-heading">ĐIỀU 6. QUYỀN VÀ NGHĨA VỤ CỦA BÊN B (CÔNG TY CP ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT)</div>
<p><strong>6.1.</strong> Quản lý bảo mật các khóa <code>Bearer API Key</code> được cấp; sử dụng dịch vụ đúng quy định tại Điều 1.4, Điều 1.5 và Điều 5.5 Hợp đồng.</p>
<p><strong>6.2.</strong> Ký Phụ lục xác nhận gói dịch vụ hằng tháng; đối soát Báo cáo Usage chuẩn trong ngày và chuyển khoản thanh toán đầy đủ ngay trong ngày (trong khung từ ngày 20 đến ngày 28 hằng tháng) theo Điều 2 và Điều 3 Hợp đồng.</p>

<div class="sec-heading">ĐIỀU 7. TRÁCH NHIỆM, BẤT KHẢ KHÁNG, GIẢI QUYẾT TRANH CHẤP &amp; ĐIỀU KHOẢN CHUNG</div>
<p><strong>7.1. Gián đoạn dịch vụ:</strong> Trường hợp dịch vụ ngừng quá 48 giờ liên tục không thuộc các trường hợp loại trừ tại Điều 5.1, Bên A hoàn trả hoặc bù trừ vào kỳ kế tiếp phần phí tương ứng với số ngày gián đoạn, tính theo tỷ lệ trên phí gói của kỳ đó. Đây là biện pháp khắc phục duy nhất đối với việc gián đoạn dịch vụ, trừ trường hợp Bên A cố ý vi phạm.</p>
<p><strong>7.2. Đơn phương ngừng sử dụng:</strong> Trường hợp Bên B đơn phương ngừng sử dụng giữa chừng trong kỳ sau khi đã kích hoạt gói cước của kỳ đó thì phí gói không được hoàn lại, trừ trường hợp quy định tại Điều 7.1 hoặc hai Bên có thỏa thuận khác.</p>
<p><strong>7.3. Tính thống nhất của hồ sơ:</strong> Mọi Phụ lục gói cước hằng tháng, Báo cáo Usage, Biên bản nghiệm thu và Hóa đơn điện tử phát sinh theo Hợp đồng này là bộ phận cấu thành không tách rời của Hợp đồng.</p>
<p><strong>7.4. Hiệu lực ký kết:</strong> Hợp đồng được lập dưới dạng thông điệp dữ liệu, ký bằng chữ ký số của hai Bên và có giá trị pháp lý theo Luật Giao dịch điện tử số 20/2023/QH15 kể từ thời điểm ký số của Bên ký sau cùng (áp dụng cho kỳ từ ngày 01/11/2026).</p>
<p><strong>7.5. Giới hạn trách nhiệm:</strong> Tổng trách nhiệm bồi thường của mỗi Bên phát sinh từ Hợp đồng trong một kỳ tháng không vượt quá phí gói của kỳ đó, trừ trường hợp cố ý vi phạm hoặc vi phạm nghĩa vụ bảo mật, bảo vệ dữ liệu cá nhân. Không Bên nào chịu trách nhiệm đối với thiệt hại gián tiếp hoặc lợi nhuận bị mất.</p>
<p><strong>7.6. Kết quả do AI tạo ra:</strong> Kết quả do mô hình AI tạo ra có thể không chính xác. Bên B tự kiểm tra trước khi sử dụng kết quả cho hồ sơ thầu, hợp đồng, hóa đơn, tờ khai hoặc các quyết định pháp lý, tài chính; Bên A không bảo đảm tính chính xác của nội dung do mô hình tạo ra. Quyền đối với kết quả đầu ra thuộc về Bên B trong phạm vi pháp luật và điều khoản của Nhà cung cấp gốc cho phép.</p>
<p><strong>7.7. Bất khả kháng:</strong> Sự kiện bất khả kháng được xác định theo Điều 156 Bộ luật Dân sự. Bên bị ảnh hưởng thông báo cho Bên kia trong 03 (ba) ngày làm việc và không bị coi là vi phạm trong thời gian sự kiện kéo dài. Nếu sự kiện kéo dài quá 30 ngày, mỗi Bên được chấm dứt Hợp đồng bằng thông báo, hai Bên quyết toán theo phần dịch vụ đã cung cấp.</p>
<p><strong>7.8. Sửa đổi, bổ sung:</strong> Mọi sửa đổi, bổ sung Hợp đồng được lập bằng văn bản hoặc thông điệp dữ liệu có chữ ký số của hai Bên.</p>
<p><strong>7.9. Thông báo:</strong> Thông báo theo Hợp đồng được gửi qua email nêu tại phần thông tin các Bên và được coi là đã nhận vào ngày làm việc kế tiếp sau ngày gửi.</p>
<p><strong>7.10. Luật áp dụng và giải quyết tranh chấp:</strong> Hợp đồng được điều chỉnh bởi pháp luật Việt Nam. Tranh chấp được giải quyết trước hết bằng thương lượng trong 30 ngày; nếu không thành, một Bên có quyền khởi kiện tại Tòa án nhân dân có thẩm quyền nơi Bên A đăng ký kinh doanh./.</p>

<table class="sig-table">
  <tr>
    <td>
      <div class="sig-role">ĐẠI DIỆN BÊN B (CÔNG TY INUT)</div>
      <div class="sig-note">(Ký số)</div>
      <div class="sig-space"></div>
      <div class="sig-name">NGÔ HUỲNH NGỌC KHÁNH</div>
    </td>
    <td>
      <div class="sig-role">ĐẠI DIỆN BÊN A (HKD CÔNG NGHỆ LIO)</div>
      <div class="sig-note">(Ký số)</div>
      <div class="sig-space lio-sig-space"><span class="lio-sign-marker">[[LIO_SIGN]]</span></div>
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
    payment_window_str: str = "Từ ngày 20/11/2026 đến ngày 28/11/2026",
    selected_tier_code: str = "AI-05",
    selected_tier_name: str = "Gói Tăng Trưởng (Growth API Tier)",
    selected_req_quota: str = "Tối đa 220.000 requests/tháng (bậc 150.001 – 220.000)",
    selected_token_quota: str = "Tối đa 16,0 tỷ tokens/tháng (Input + Output + Cache + Reasoning)",
    selected_amount: int = 16_000_000,
    selected_amount_words: str = "Mười sáu triệu đồng chẵn",
) -> str:
    amount_fmt = f"{selected_amount:,.0f}".replace(",", ".")
    m_num, y_num = month_str.split("/")
    last_day = "30" if m_num in {"04", "06", "09", "11"} else ("28" if m_num == "02" else "31")
    return f"""<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8"/>
<title>Phụ Lục Số {appendix_no} (Kỳ Tháng {month_str}) - Hợp Đồng 0111/2026/HĐDV-LIO-INUT</title>
<style>{COMMON_CSS}</style>
</head>
<body>
<div class="footer-str">Phụ lục số {appendix_no} (PL-{appendix_no}/2026/HĐDV-LIO-INUT — Kỳ Tháng {month_str}) kèm Hợp đồng số 0111/2026/HĐDV-LIO-INUT</div>

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

<h1 class="main-title">PHỤ LỤC HỢP ĐỒNG SỐ {appendix_no} &mdash; KỲ THÁNG {month_str}<br/>XÁC NHẬN GÓI CƯỚC THUÊ BAO, QUYỀN HẠN KỸ THUẬT &amp; LỊCH THANH TOÁN TRONG NGÀY</h1>
<div class="sub-title-center">(Kèm theo và là bộ phận không tách rời của Hợp đồng nguyên tắc số <strong>0111/2026/HĐDV-LIO-INUT</strong> ký ngày 01/11/2026)</div>

<div class="basis-box">
  - Căn cứ Bộ luật Dân sự số 91/2015/QH13 (Điều 403 về phụ lục hợp đồng), Luật Thương mại số 36/2005/QH11 và Luật Giao dịch điện tử số 20/2023/QH15;<br/>
  - Căn cứ Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15 và Nghị định số 356/2025/NĐ-CP;<br/>
  - Căn cứ Hợp đồng nguyên tắc số <strong>0111/2026/HĐDV-LIO-INUT</strong> ký ngày 01/11/2026 và nhu cầu sử dụng dịch vụ thực tế của Công ty Cổ phần Đầu tư và Phát triển Công nghệ INUT trong <strong>Kỳ tháng {month_str}</strong>.
</div>

<div class="party-box">
  <table class="party-tbl">
    <tr>
      <td style="width:50%; padding-right:8px; border-right:1px solid #cbd5e1;">
        <div style="font-weight:bold; color:#0f3d68; text-transform:uppercase; margin-bottom:2px;">BÊN A (BÊN CUNG CẤP DỊCH VỤ):</div>
        <strong>HỘ KINH DOANH CÔNG NGHỆ LIO</strong><br/>
        - Mã số thuế: <strong>054202003668</strong><br/>
        - Địa chỉ: 22 đường 3/2, khu phố Phú Thạnh 2, phường Phú Yên, tỉnh Đắk Lắk<br/>
        - Đại diện: Ông <strong>HUỲNH ĐỨC NHÂM</strong> &ndash; Chủ hộ kinh doanh<br/>
        - Tài khoản: <strong>00344714490</strong> tại Ngân hàng TMCP Quân đội (MB Bank) &ndash; Chủ TK: <strong>HỘ KINH DOANH CÔNG NGHỆ LIO</strong><br/>
        - Email nhận thông báo: <code>nhamhd@liotech.vn</code>
      </td>
      <td style="width:50%; padding-left:8px;">
        <div style="font-weight:bold; color:#0f3d68; text-transform:uppercase; margin-bottom:2px;">BÊN B (BÊN SỬ DỤNG DỊCH VỤ):</div>
        <strong>CÔNG TY CP ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT</strong><br/>
        - Mã số thuế: <strong>4401053694</strong><br/>
        - Địa chỉ: 161 Trường Chinh, phường Tuy Hòa, tỉnh Đắk Lắk<br/>
        - Đại diện: Ông <strong>NGÔ HUỲNH NGỌC KHÁNH</strong> &ndash; Giám đốc (ĐT: 0972 768 491)<br/>
        - Tài khoản: <strong>79713</strong> tại Ngân hàng TMCP Kỹ Thương Việt Nam (Techcombank)<br/>
        - Email nhận thông báo: <code>khanhnhn@inut.vn</code>
      </td>
    </tr>
  </table>
</div>

<p>Hai Bên thống nhất ký kết <strong>Phụ lục Hợp đồng số {appendix_no}</strong> xác nhận gói cước thuê bao API Trí tuệ Nhân tạo áp dụng cho <strong>Kỳ tháng {month_str}</strong> như sau:</p>

<div class="sec-heading">MỤC 1. GÓI DỊCH VỤ ĐĂNG KÝ, ĐỊNH MỨC TRẦN &amp; QUYỀN HẠN KỸ THUẬT KỲ THÁNG {month_str}</div>
<p><strong>1.1. Kỳ áp dụng:</strong> Từ ngày <code>01/{month_str}</code> đến hết ngày <code>{last_day}/{month_str}</code>.</p>
<p><strong>1.2. Gói dịch vụ và mức phí trọn gói:</strong></p>

<table class="tbl">
  <thead>
    <tr>
      <th style="width:6%;">STT</th>
      <th style="width:24%;">Mã gói &amp; Tên gói</th>
      <th style="width:33%;">Định mức tối đa trong kỳ</th>
      <th style="width:21%;">Quyền hạn kỹ thuật</th>
      <th style="width:16%;">Thành tiền trọn gói (VNĐ)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td class="c"><strong>01</strong></td>
      <td>
        <span class="badge">{selected_tier_code}</span><br/>
        <strong>{selected_tier_name}</strong>
      </td>
      <td>
        - <strong>Requests:</strong> {selected_req_quota}<br/>
        - <strong>Tokens:</strong> {selected_token_quota}<br/>
        - <strong>Số khóa API:</strong> Tối đa 25 Bearer API Keys
      </td>
      <td class="c">Theo điểm 1.3 Mục này<br/>và Bảng báo giá số<br/><code>0111/2026/BG-LIO-INUT</code></td>
      <td class="r" style="font-size:9.6pt; font-weight:bold; color:#0f3d68;">{amount_fmt} đ</td>
    </tr>
    <tr>
      <td colspan="4" class="r" style="font-weight:bold; background:#f8fafc;">TỔNG GIÁ TRỊ GÓI THUÊ BAO KỲ THÁNG {month_str} (đã bao gồm các loại thuế, phí theo quy định áp dụng đối với hộ kinh doanh, nếu có)</td>
      <td class="r" style="font-size:9.8pt; font-weight:bold; color:#b91c1c; background:#f8fafc;">{amount_fmt} đ</td>
    </tr>
  </tbody>
</table>
<p><em>(Số tiền bằng chữ: <strong>{selected_amount_words}</strong>.)</em></p>

<p><strong>1.3. Quyền hạn kỹ thuật của gói {selected_tier_code} trong kỳ (xác định theo Bảng báo giá số 0111/2026/BG-LIO-INUT):</strong></p>
<ul class="tight-list">
  <li><strong>Hạng mục 1:</strong> Cổng định tuyến AI hợp nhất, Fusion Combo và Auto-Fallback (mục tiêu khả dụng &ge; 99,0%/tháng);</li>
  <li><strong>Hạng mục 2:</strong> LLM Chat, Code-Gen và suy luận đến mức <code>xhigh</code>; cửa sổ ngữ cảnh tối đa <strong>200K tokens</strong>;</li>
  <li><strong>Hạng mục 3 &amp; 4:</strong> RTK Token Saver, Context Caching; TTS và STT tiếng Việt tiêu chuẩn;</li>
  <li><strong>Hạng mục 5 &amp; 6:</strong> Vision OCR (bóc tách tài liệu/giấy tờ theo Điều 5.5 Hợp đồng, biển số xe) và tạo ảnh (Image Gen); Embeddings, Web Search và Web Fetch;</li>
  <li><strong>Hạng mục 7:</strong> Tối đa 25 Bearer API Keys, Smart Proxy Pools dự phòng, ưu tiên tốc độ <code>Fast Priority 1.5x</code>, chế độ đa tác nhân (Multi-Agent) và Báo cáo Usage chuẩn.</li>
  <li><em>Giới hạn bậc gói:</em> Gói {selected_tier_code} không bao gồm tạo video (Video Gen), cửa sổ ngữ cảnh từ 400K tokens trở lên, mức suy luận <code>max</code> và <code>ultra</code> (các quyền hạn này thuộc gói <code>AI-06</code> trở lên hoặc thỏa thuận riêng theo gói <code>AI-FLEX</code>).</li>
</ul>

<div class="sec-heading">MỤC 2. BÁO CÁO USAGE TRONG NGÀY, THANH TOÁN (NGÀY 20–28) &amp; XUẤT HÓA ĐƠN KỲ THÁNG {month_str}</div>
<p><strong>2.1. Báo cáo Usage chuẩn trong ngày và chuyển khoản thanh toán trong ngày ({payment_window_str}):</strong> Trong khoảng thời gian <strong>{payment_window_str.lower()}</strong>, vào ngày chốt thanh toán của kỳ, <strong>Bên A kết xuất và gửi cho Bên B Báo cáo Usage chuẩn tính đến trong ngày đó</strong>; Bên B kiểm tra đối soát và <strong>thanh toán 100% giá trị gói ngay trong ngày</strong> bằng chuyển khoản vào tài khoản số <strong>00344714490</strong> tại <strong>Ngân hàng TMCP Quân đội (MB Bank)</strong>, chủ tài khoản <strong>HỘ KINH DOANH CÔNG NGHỆ LIO</strong> (Đại diện: Ông <strong>HUỲNH ĐỨC NHÂM</strong> – Chủ Hộ kinh doanh Công nghệ LIO). Nội dung chuyển khoản: <code>“INUT thanh toan goi dich vu API AI thang {month_str} theo HD 0111/2026/HDDV-LIO-INUT”</code>.</p>
<p><strong>2.2. Xuất hóa đơn điện tử vào ngày chuyển khoản:</strong> <strong>Bên A lập và xuất hóa đơn điện tử hợp lệ ngay vào ngày nhận được tiền chuyển khoản thanh toán của Bên B</strong> (cùng ngày kết xuất Báo cáo Usage chuẩn và chuyển khoản thanh toán).</p>
<p><strong>2.3. Nghiệm thu và hiệu lực:</strong> Báo cáo Usage chuẩn được hai Bên xác nhận nghiệm thu ngay trong ngày thanh toán (hoặc Bên B nêu ý kiến trong tối đa 05 ngày làm việc kể từ ngày nhận; hết thời hạn này mà Bên B không có ý kiến thì Báo cáo được coi là đã được xác nhận). Phụ lục này được lập dưới dạng thông điệp dữ liệu, ký bằng chữ ký số của hai Bên và có hiệu lực theo Luật Giao dịch điện tử số 20/2023/QH15./.</p>

<table class="sig-table">
  <tr>
    <td>
      <div class="sig-role">ĐẠI DIỆN BÊN B (CÔNG TY INUT)</div>
      <div class="sig-note">(Ký số)</div>
      <div class="sig-space"></div>
      <div class="sig-name">NGÔ HUỲNH NGỌC KHÁNH</div>
    </td>
    <td>
      <div class="sig-role">ĐẠI DIỆN BÊN A (HKD CÔNG NGHỆ LIO)</div>
      <div class="sig-note">(Ký số)</div>
      <div class="sig-space lio-sig-space"><span class="lio-sign-marker">[[LIO_SIGN]]</span></div>
      <div class="sig-name">HUỲNH ĐỨC NHÂM</div>
    </td>
  </tr>
</table>

</body>
</html>
"""


# ---------------------------------------------------------------------------
# LIVE TELEMETRY LOADER (9ROUTER SQLITE — READ-ONLY)
# ---------------------------------------------------------------------------
VN_TZ = timezone(timedelta(hours=7))

API_KEY_DESCRIPTIONS: dict[str, str] = {
    "ksp-50.212": "Máy chủ phát triển & vận hành KSP / hệ sinh thái nội bộ Công ty INUT",
    "pymid-cty": "Hệ thống tác nhân AI lập trình, soạn thảo kỹ thuật & tự động hóa nghiệp vụ doanh nghiệp",
    "apphub.a.inut.io.vn": "Nền tảng iNut AppHub, giám sát IoT/SCADA & vận hành cụm trạm năng lượng",
    "root8-21": "Hạ tầng kỹ thuật, kiểm thử tự động & cụm dịch vụ nội bộ INUT",
    "Inut-ai-router": "Cổng định tuyến AI cho thiết bị biên iNut & phân tích dữ liệu vận hành",
    "inut-trade": "Phân tích dữ liệu & tự động hóa nghiệp vụ thị trường nội bộ",
    "Chatbot.vnmap.ai": "Trợ lý AI VNMAP, bản đồ số, PLC/OPC & hệ thống KSP PDFSign",
    "apphub vnmap3d": "Nền tảng bản đồ số 3D VNMAP & dịch vụ đô thị thông minh",
    "inut-opc-inut-dev": "Phát triển Firmware nhúng & tích hợp PLC/OPC công nghiệp",
    "ksp-inut-crm-pdf-signer": "Hệ thống KSP PDFSign: quản lý hồ sơ, chứng từ & hợp đồng",
}


def fmt_int(n: int) -> str:
    return f"{int(n):,}".replace(",", ".")


def fmt_tokens_short(n: int) -> str:
    if n >= 1_000_000_000:
        val_vi = f"{n / 1e9:.2f}".replace(".", ",")
        return f"{val_vi} tỷ ({n / 1e9:.2f}B)"
    if n >= 1_000_000:
        val_vi = f"{n / 1e6:.2f}".replace(".", ",")
        return f"{val_vi} triệu ({n / 1e6:.2f}M)"
    return f"{fmt_int(n)} tokens"


def _classify_model_bucket(model: str, provider: str) -> str:
    m = (model or "").lower()
    p = (provider or "").lower()
    if "flash" in m:
        return "flash"
    if "argon" in m:
        return "argon"
    if "hydrogen" in m or "carbon" in m:
        return "hydro_carbon"
    if "claude" in m or "opus" in m or "sonnet" in m:
        return "claude"
    if "gpt" in m or "codex" in p or "opencode" in p:
        return "codex_other"
    return "codex_other"


MODEL_BUCKET_META: list[tuple[str, str, str]] = [
    (
        "flash",
        "LLM Tốc độ cao & Tác nhân tự động (Flash)",
        "POST /v1/responses &bull; /v1/chat/completions",
    ),
    (
        "argon",
        "LLM Suy luận & Lập trình chuyên sâu (Argon)",
        "POST /v1/responses &bull; /v1/chat/completions",
    ),
    (
        "hydro_carbon",
        "LLM Suy luận cấp cao (Hydrogen &amp; Carbon)",
        "POST /v1/responses &bull; /v1/chat/completions",
    ),
    (
        "claude",
        "LLM Suy luận &amp; Soạn thảo chuyên sâu (Claude)",
        "POST /v1/responses &bull; /v1/chat/completions",
    ),
    (
        "codex_other",
        "LLM Lập trình Codex &amp; Dịch vụ bổ trợ",
        "POST /v1/responses &bull; /v1/chat/completions &bull; /v1/systemone",
    ),
]


def load_usage_from_sqlite(
    db_path: str | Path,
    month_str: str = "11/2026",
    report_date: str | None = None,
    exclude_keys: set[str] | None = None,
) -> dict[str, Any]:
    """Đọc dữ liệu usage thực tế từ 9Router SQLite (read-only) theo kỳ MM/YYYY."""
    exclude_set = {k.strip() for k in (exclude_keys or set()) if k.strip()}
    m_num, y_num = month_str.split("/")
    ym_prefix = f"{y_num}-{m_num.zfill(2)}"

    cutoff_iso_date: str | None = None
    if report_date:
        d_p, m_p, y_p = report_date.split("/")
        cutoff_iso_date = f"{y_p}-{m_p.zfill(2)}-{d_p.zfill(2)}"

    resolved_path = Path(db_path).resolve()
    conn = sqlite3.connect(f"file:{resolved_path}?mode=ro", uri=True)
    try:
        key_map: dict[str, str] = {}
        for kid, kval, kname in conn.execute("SELECT id, key, name FROM apiKeys"):
            key_map[kval] = (kname or f"key-{kid[:8]}").strip()

        by_key: dict[str, dict[str, int]] = defaultdict(
            lambda: {"requests": 0, "prompt": 0, "cached": 0, "completion": 0}
        )
        by_bucket: dict[str, dict[str, Any]] = {
            b_id: {"requests": 0, "prompt": 0, "cached": 0, "completion": 0, "models": defaultdict(int)}
            for b_id, _, _ in MODEL_BUCKET_META
        }
        excluded_stats: dict[str, dict[str, int]] = defaultdict(
            lambda: {"requests": 0, "prompt": 0, "cached": 0, "completion": 0}
        )
        cluster_total = {"requests": 0, "prompt": 0, "cached": 0, "completion": 0}
        inut_total = {"requests": 0, "prompt": 0, "cached": 0, "completion": 0}
        date_keys: list[str] = []

        for dk, raw in conn.execute(
            "SELECT dateKey, data FROM usageDaily WHERE dateKey LIKE ? ORDER BY dateKey ASC",
            (f"{ym_prefix}-%",),
        ):
            if cutoff_iso_date and dk > cutoff_iso_date:
                continue
            date_keys.append(dk)
            day = json.loads(raw)
            for ak_k, v in (day.get("byApiKey") or {}).items():
                rk = v.get("apiKey")
                label = key_map.get(rk, "Local (No API Key)") if rk else "Local (No API Key)"
                parts = ak_k.split("|")
                model = v.get("rawModel") or (parts[1] if len(parts) > 1 else "unknown")
                provider = v.get("provider") or (parts[2] if len(parts) > 2 else "")
                req = int(v.get("requests", 0) or 0)
                pt = int(v.get("promptTokens", 0) or 0)
                ct = int(v.get("completionTokens", 0) or 0)
                ca = int(v.get("cachedTokens", 0) or 0)

                cluster_total["requests"] += req
                cluster_total["prompt"] += pt
                cluster_total["cached"] += ca
                cluster_total["completion"] += ct

                if label in exclude_set:
                    ex = excluded_stats[label]
                    ex["requests"] += req
                    ex["prompt"] += pt
                    ex["cached"] += ca
                    ex["completion"] += ct
                    continue

                inut_total["requests"] += req
                inut_total["prompt"] += pt
                inut_total["cached"] += ca
                inut_total["completion"] += ct

                bk = by_key[label]
                bk["requests"] += req
                bk["prompt"] += pt
                bk["cached"] += ca
                bk["completion"] += ct

                b_id = _classify_model_bucket(model, provider)
                bm = by_bucket[b_id]
                bm["requests"] += req
                bm["prompt"] += pt
                bm["cached"] += ca
                bm["completion"] += ct
                bm["models"][model] += pt + ct

        # Lấy mốc timestamp sự kiện cuối cùng (GMT+7) để đối soát
        max_ts_row = conn.execute("SELECT MAX(timestamp) FROM usageHistory").fetchone()
        last_ts_vn = ""
        if max_ts_row and max_ts_row[0]:
            dt_utc = datetime.fromisoformat(max_ts_row[0].replace("Z", "+00:00"))
            last_ts_vn = dt_utc.astimezone(VN_TZ).strftime("%H:%M ngày %d/%m/%Y (GMT+7)")
    finally:
        conn.close()

    # Verify exact arithmetic invariants
    assert sum(b["requests"] for b in by_bucket.values()) == inut_total["requests"]
    assert sum(b["prompt"] + b["completion"] for b in by_bucket.values()) == (
        inut_total["prompt"] + inut_total["completion"]
    )
    assert sum(k["requests"] for k in by_key.values()) == inut_total["requests"]
    assert sum(k["prompt"] + k["completion"] for k in by_key.values()) == (
        inut_total["prompt"] + inut_total["completion"]
    )

    model_rows: list[dict[str, Any]] = []
    for b_id, title, endpoint_html in MODEL_BUCKET_META:
        bm = by_bucket[b_id]
        if bm["requests"] == 0:
            continue
        top_models = [m for m, _ in sorted(bm["models"].items(), key=lambda x: -x[1])[:3]]
        model_rows.append(
            {
                "id": b_id,
                "title": title,
                "endpoint_html": endpoint_html,
                "top_models": top_models,
                "requests": bm["requests"],
                "prompt": bm["prompt"],
                "cached": bm["cached"],
                "completion": bm["completion"],
                "total": bm["prompt"] + bm["completion"],
            }
        )

    # Sort API keys descending by total tokens; keep top 4 individually and group minor keys neatly
    sorted_keys = sorted(
        by_key.items(),
        key=lambda x: -(x[1]["prompt"] + x[1]["completion"]),
    )
    inut_total_tokens = inut_total["prompt"] + inut_total["completion"]
    key_rows: list[dict[str, Any]] = []
    minor_mid: list[tuple[str, dict[str, int]]] = []
    minor_tail: list[tuple[str, dict[str, int]]] = []

    for idx, (label, stats) in enumerate(sorted_keys):
        tot = stats["prompt"] + stats["completion"]
        share = (tot / inut_total_tokens * 100.0) if inut_total_tokens else 0.0
        if idx < 4 or share >= 0.5:
            key_rows.append(
                {
                    "labels": [label],
                    "desc": API_KEY_DESCRIPTIONS.get(
                        label, "Hệ thống / dự án nghiệp vụ sử dụng API AI tại Công ty INUT"
                    ),
                    "requests": stats["requests"],
                    "total": tot,
                    "share_pct": share,
                }
            )
        elif tot >= 1_000_000:
            minor_mid.append((label, stats))
        else:
            minor_tail.append((label, stats))

    if minor_mid:
        m_req = sum(s["requests"] for _, s in minor_mid)
        m_tot = sum(s["prompt"] + s["completion"] for _, s in minor_mid)
        key_rows.append(
            {
                "labels": [lbl for lbl, _ in minor_mid],
                "desc": "Cổng định tuyến AI thiết bị biên iNut & phân tích dữ liệu vận hành",
                "requests": m_req,
                "total": m_tot,
                "share_pct": (m_tot / inut_total_tokens * 100.0) if inut_total_tokens else 0.0,
            }
        )
    if minor_tail:
        t_req = sum(s["requests"] for _, s in minor_tail)
        t_tot = sum(s["prompt"] + s["completion"] for _, s in minor_tail)
        key_rows.append(
            {
                "labels": [lbl for lbl, _ in minor_tail],
                "desc": "Trợ lý VNMAP, bản đồ số 3D, PLC/OPC công nghiệp & KSP PDFSign",
                "requests": t_req,
                "total": t_tot,
                "share_pct": (t_tot / inut_total_tokens * 100.0) if inut_total_tokens else 0.0,
            }
        )

    assert sum(r["requests"] for r in key_rows) == inut_total["requests"]
    assert sum(r["total"] for r in key_rows) == inut_total_tokens

    first_date = date_keys[0] if date_keys else f"{ym_prefix}-01"
    last_date = date_keys[-1] if date_keys else (cutoff_iso_date or f"{ym_prefix}-30")
    f_y, f_m, f_d = first_date.split("-")
    l_y, l_m, l_d = last_date.split("-")

    return {
        "month_str": month_str,
        "report_date": report_date or f"{l_d}/{l_m}/{l_y}",
        "period_start_vn": f"{f_d}/{f_m}/{f_y}",
        "period_end_vn": f"{l_d}/{l_m}/{l_y}",
        "days_count": len(date_keys),
        "last_event_ts_vn": last_ts_vn,
        "active_keys_count": len(by_key),
        "inut_total": {
            **inut_total,
            "total_tokens": inut_total_tokens,
            "non_cached_tokens": inut_total_tokens - inut_total["cached"],
            "cached_pct": (inut_total["cached"] / inut_total_tokens * 100.0) if inut_total_tokens else 0.0,
        },
        "excluded": {
            lbl: {**st, "total_tokens": st["prompt"] + st["completion"]}
            for lbl, st in excluded_stats.items()
        },
        "cluster_total": {
            **cluster_total,
            "total_tokens": cluster_total["prompt"] + cluster_total["completion"],
        },
        "model_rows": model_rows,
        "key_rows": key_rows,
    }


# ---------------------------------------------------------------------------
# DOCUMENT 4: BÁO CÁO SẢN LƯỢNG SỬ DỤNG API & BIÊN BẢN NGHIỆM THU (KÝ TRONG NGÀY THANH TOÁN 20-28)
# ---------------------------------------------------------------------------
def build_monthly_usage_report_html(
    appendix_no: str = "01",
    month_str: str = "11/2026",
    selected_tier_code: str = "AI-05",
    selected_tier_name: str = "Gói Tăng Trưởng (Growth API Tier)",
    selected_req_quota: str = "Tối đa 220.000 requests/tháng",
    selected_token_quota: str = "Tối đa 16,0 tỷ tokens/tháng (16.0B tokens)",
    selected_amount: int = 16_000_000,
    selected_amount_words: str = "Mười sáu triệu đồng chẵn",
    usage_data: dict[str, Any] | None = None,
) -> str:
    amount_fmt = fmt_int(selected_amount)
    m_num, y_num = month_str.split("/")

    if usage_data is not None:
        r_date = usage_data["report_date"]
        rd_d, rd_m, rd_y = r_date.split("/")
        period_start = usage_data["period_start_vn"]
        period_end = usage_data["period_end_vn"]
        days_count = usage_data["days_count"]
        last_ts_vn = usage_data.get("last_event_ts_vn", "")
        active_keys_count = usage_data["active_keys_count"]
        tot = usage_data["inut_total"]
        tot_reqs = tot["requests"]
        tot_prompt = tot["prompt"]
        tot_comp = tot["completion"]
        tot_cached = tot["cached"]
        tot_tokens = tot["total_tokens"]
        tot_non_cached = tot["non_cached_tokens"]
        cached_pct_vi = f"{tot['cached_pct']:.2f}".replace(".", ",")
        tot_tokens_b_vi = f"{tot_tokens / 1e9:.2f}".replace(".", ",")
        tot_cached_b_vi = f"{tot_cached / 1e9:.2f}".replace(".", ",")
        tot_non_cached_b_vi = f"{tot_non_cached / 1e9:.2f}".replace(".", ",")

        model_rows_html = []
        for idx, row in enumerate(usage_data["model_rows"], start=1):
            aliases_html = ", ".join(f"<code>{html_lib.escape(m)}</code>" for m in row["top_models"])
            model_rows_html.append(
                f"""    <tr>
      <td class="c">{idx}</td>
      <td><strong>{row['title']}</strong><br/><code>{row['endpoint_html']}</code></td>
      <td><em>Model Alias tiêu biểu:</em><br/>{aliases_html}</td>
      <td class="r">{fmt_int(row['requests'])}</td>
      <td class="r">{fmt_int(row['prompt'])}</td>
      <td class="r">{fmt_int(row['completion'])}</td>
    </tr>"""
            )
        model_tbody_html = "\n".join(model_rows_html)

        key_rows_html = []
        for idx, row in enumerate(usage_data["key_rows"], start=1):
            labels_html = ", ".join(f"<code>{html_lib.escape(lbl)}</code>" for lbl in row["labels"])
            pct = row["share_pct"]
            pct_str = "<0,01%" if 0 < pct < 0.01 else f"{pct:.2f}%".replace(".", ",")
            key_rows_html.append(
                f"""    <tr>
      <td class="c">{idx:02d}</td>
      <td>{labels_html}</td>
      <td>{html_lib.escape(row['desc'])}</td>
      <td class="r">{fmt_int(row['requests'])}</td>
      <td class="r">{fmt_tokens_short(row['total'])}</td>
      <td class="c">{pct_str}</td>
    </tr>"""
            )
        key_tbody_html = "\n".join(key_rows_html)

        excluded_note_parts = []
        for ex_lbl, ex_st in usage_data["excluded"].items():
            excluded_note_parts.append(
                f"<code>{html_lib.escape(ex_lbl)}</code> ({fmt_int(ex_st['requests'])} requests / {fmt_int(ex_st['total_tokens'])} tokens)"
            )
        excluded_note_html = ""
        if excluded_note_parts:
            ct_all = usage_data["cluster_total"]
            excluded_note_html = (
                f"""<p style="font-size:7.1pt; font-style:italic; color:#334155; margin:1.5px 0 3px 0;">"""
                f"""(Ghi chú đối soát: Đã tách loại khóa nội bộ quản trị/kiểm thử của Bên A là {', '.join(excluded_note_parts)} ra khỏi sản lượng tính cho Bên B. """
                f"""Tổng sản lượng toàn cụm 9Router cùng kỳ là {fmt_int(ct_all['requests'])} requests / {fmt_int(ct_all['total_tokens'])} tokens.)</p>"""
            )

        ts_note = f" &bull; Chốt log lúc {html_lib.escape(last_ts_vn)}" if last_ts_vn else ""
        return f"""<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8"/>
<title>Báo Cáo Sản Lượng Sử Dụng API (Usage Report) &amp; Biên Bản Nghiệm Thu Dịch Vụ Kỳ Tháng {month_str}</title>
<style>
{COMMON_CSS}
@page {{ margin: 5.5mm 9.5mm 6.5mm 9.5mm; }}
body {{ font-size: 7.35pt; line-height: 1.12; }}
table.tbl {{ font-size: 7.15pt; margin: 2px 0 2.5px 0; }}
table.tbl th, table.tbl td {{ padding: 1.8px 3.5px; }}
.sig-space {{ height: 52px; }}
</style>
</head>
<body>
<div class="footer-str">Báo cáo Usage thực tế &amp; Biên bản Nghiệm thu Kỳ Tháng {month_str} (Mã: USAGE-{m_num}-{y_num}-PL{appendix_no} • Ngày {r_date})</div>

<table class="nat-header">
  <tr>
    <td style="width:48%;">
      <div class="org-name">HỆ THỐNG ĐỐI SOÁT 9ROUTER TELEMETRY<br/>HKD CÔNG NGHỆ LIO &ndash; CÔNG TY CP INUT</div>
      <div class="org-sub">Mã báo cáo: <strong>USAGE-{m_num}-{y_num}-PL{appendix_no}</strong></div>
    </td>
    <td style="width:52%;">
      <div class="nat-title">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
      <div class="nat-motto"><span class="nat-line">Độc lập – Tự do – Hạnh phúc</span></div>
      <div class="doc-date">Đắk Lắk, ngày {rd_d} tháng {rd_m} năm {rd_y}</div>
    </td>
  </tr>
</table>

<h1 class="main-title">BÁO CÁO SẢN LƯỢNG SỬ DỤNG API CHUẨN TRONG NGÀY (USAGE REPORT)<br/>&amp; BIÊN BẢN NGHIỆM THU DỊCH VỤ KỲ THÁNG {month_str}</h1>
<div class="sub-title-center">(Số liệu thực tế kỳ <strong>{period_start} &ndash; {period_end}</strong> [{days_count} ngày]{ts_note} &bull; Đính kèm Phụ lục <strong>PL-{appendix_no}/2026/HĐDV-LIO-INUT</strong> &amp; Hợp đồng <strong>0111/2026/HĐDV-LIO-INUT</strong>)</div>

<div class="callout-info">
  <strong>Thông tin Gói thuê bao &amp; Quyết toán trong ngày ({r_date}) Kỳ Tháng {month_str}:</strong>
  Mã gói đăng ký: <strong>{selected_tier_code} &ndash; {selected_tier_name}</strong> &nbsp;|&nbsp;
  Định mức trần gói: <strong>{selected_req_quota}</strong> &bull; <strong>{selected_token_quota}</strong> &bull; <strong>25 API Keys</strong> &nbsp;|&nbsp;
  Phí trọn gói thanh toán trong ngày: <strong>{amount_fmt} VNĐ</strong> (Hóa đơn điện tử xuất ngay ngày chuyển khoản) &nbsp;|&nbsp;
  Trạng thái quyết toán: <strong>GIỮ NGUYÊN PHÍ TRỌN GÓI {selected_tier_code} THEO KHOẢN 2.3 ĐIỀU 2 HỢP ĐỒNG (KHÔNG PHÁT SINH PHÍ VƯỢT GÓI)</strong>.
</div>

<div class="sec-heading">I. THỐNG KÊ SẢN LƯỢNG USAGE THỰC TẾ THEO NHÓM MÔ HÌNH AI &amp; ENDPOINT (9ROUTER LOGS)</div>
<table class="tbl">
  <thead>
    <tr>
      <th style="width:4%;">TT</th>
      <th style="width:28%;">Phân hệ Mô hình / Endpoint API</th>
      <th style="width:27%;">Mã định tuyến nội bộ 9Router<br/><em>(Model Alias tiêu biểu)</em></th>
      <th style="width:11%;">Số lượt Gọi<br/>(Requests)</th>
      <th style="width:16%;">Prompt Tokens<br/><em>(đã gồm Cached)</em></th>
      <th style="width:14%;">Completion<br/>Tokens</th>
    </tr>
  </thead>
  <tbody>
{model_tbody_html}
    <tr style="background:#f8fafc; font-weight:bold;">
      <td colspan="3" class="c">TỔNG SẢN LƯỢNG USAGE THỰC TẾ CỦA CÔNG TY INUT ({period_start} &ndash; {period_end})</td>
      <td class="r" style="color:#0f3d68;">{fmt_int(tot_reqs)} reqs</td>
      <td class="r" style="color:#0f3d68;">{fmt_int(tot_prompt)}</td>
      <td class="r" style="color:#0f3d68;">{fmt_int(tot_comp)}</td>
    </tr>
    <tr style="background:#f0f9ff; font-weight:bold;">
      <td colspan="3" class="c">TỔNG TOKENS XỬ LÝ (PROMPT + COMPLETION) &amp; TỶ LỆ BỘ NHỚ ĐỆM CACHE</td>
      <td colspan="3" class="c" style="color:#15803d; font-size:8.3pt;">{fmt_int(tot_tokens)} tokens (&approx; {tot_tokens_b_vi} tỷ / {tot_tokens / 1e9:.2f}B) &mdash; Cached: {tot_cached_b_vi} tỷ ({cached_pct_vi}%) &bull; Mới: {tot_non_cached_b_vi} tỷ</td>
    </tr>
  </tbody>
</table>
<p style="font-size:7.1pt; font-style:italic; color:#1e293b; margin:1.5px 0 3px 0;">(Ghi chú kỹ thuật: Trong hệ thống 9Router, cột Prompt Tokens đã bao gồm Cached Tokens. Lượng Cached Tokens tái sử dụng qua RTK Token Saver &amp; Context Caching đạt <strong>{fmt_int(tot_cached)} tokens ({cached_pct_vi}%)</strong>; lượng token tính toán mới [Non-cached Prompt + Completion] là <strong>{fmt_int(tot_non_cached)} tokens &approx; {tot_non_cached_b_vi} tỷ tokens</strong>.)</p>

<div class="sec-heading">II. PHÂN BỔ USAGE THỰC TẾ THEO KHÓA API (BEARER KEYS) CỦA CÔNG TY INUT ({active_keys_count} / 25 KHÓA HOẠT ĐỘNG)</div>
<table class="tbl">
  <thead>
    <tr>
      <th style="width:5%;">TT</th>
      <th style="width:27%;">Định danh Khóa API (Key Label)</th>
      <th style="width:36%;">Hệ thống / Dự án Nghiệp vụ Sử dụng tại Công ty INUT</th>
      <th style="width:11%;">Số Requests</th>
      <th style="width:13%;">Tổng Tokens</th>
      <th style="width:8%;">Tỷ trọng</th>
    </tr>
  </thead>
  <tbody>
{key_tbody_html}
  </tbody>
</table>
{excluded_note_html}

<div class="sec-heading">III. KẾT LUẬN NGHIỆM THU, QUYẾT TOÁN GÓI {selected_tier_code} &amp; CHUYỂN KHOẢN TRONG NGÀY {r_date}</div>
<p>1. Bên A (<strong>Hộ kinh doanh Công nghệ LIO</strong>) đã cung cấp đầy đủ, liên tục dịch vụ <strong>9Router AI Gateway</strong> trong kỳ <strong>{period_start} &ndash; {period_end}</strong> đạt mục tiêu khả dụng SLA &ge; 99,0% theo Hợp đồng nguyên tắc số <strong>0111/2026/HĐDV-LIO-INUT</strong> và Phụ lục số <strong>PL-{appendix_no}/2026/HĐDV-LIO-INUT</strong>.</p>
<p>2. Đối chiếu định mức gói <strong>{selected_tier_code}</strong>: Số lượt truy vấn thực tế (<strong>{fmt_int(tot_reqs)} / 220.000 requests</strong>) và số khóa API hoạt động (<strong>{active_keys_count:02d} / 25 keys</strong>) đều nằm trong định mức cam kết. Tổng tokens xử lý ghi nhận <strong>{fmt_int(tot_tokens)} tokens (&approx; {tot_tokens_b_vi} tỷ tokens)</strong> do tỷ lệ tái sử dụng bộ nhớ đệm <em>Cached Tokens</em> đạt <strong>{cached_pct_vi}%</strong> (token mới chỉ <strong>{tot_non_cached_b_vi} tỷ tokens</strong>). Căn cứ <strong>Khoản 2.3 Điều 2 Hợp đồng số 0111/2026/HĐDV-LIO-INUT</strong> (<em>không tự ý tính thêm phí vượt gói khi chưa có phụ lục nâng gói</em>), hai Bên thống nhất nghiệm thu hoàn thành 100% dịch vụ kỳ Tháng {month_str} và <strong>giữ nguyên mức phí trọn gói {selected_tier_code} là {amount_fmt} VNĐ ({selected_amount_words}), không phát sinh bất kỳ khoản phụ phí vượt gói nào</strong>.</p>
<p>3. Căn cứ Báo cáo Usage chuẩn lập trong ngày <strong>{r_date}</strong> (khung thanh toán 20&ndash;28/{month_str}), Bên B thực hiện chuyển khoản <strong>{amount_fmt} VNĐ</strong> ngay trong ngày vào STK <strong>00344714490</strong> tại <strong>Ngân hàng TMCP Quân đội (MB Bank)</strong> &ndash; Chủ TK: <strong>HỘ KINH DOANH CÔNG NGHỆ LIO</strong> (nội dung: <code>INUT thanh toan goi dich vu API AI thang {month_str} theo HD 0111/2026/HDDV-LIO-INUT</code>), và Bên A xuất hóa đơn điện tử hợp lệ ngay vào ngày nhận chuyển khoản./.</p>

<table class="sig-table">
  <tr>
    <td>
      <div class="sig-role">ĐẠI DIỆN BÊN B (CÔNG TY INUT)</div>
      <div class="sig-note">(Ký số)</div>
      <div class="sig-space"></div>
      <div class="sig-name">NGÔ HUỲNH NGỌC KHÁNH</div>
    </td>
    <td>
      <div class="sig-role">ĐẠI DIỆN BÊN A (HKD CÔNG NGHỆ LIO)</div>
      <div class="sig-note">(Ký số)</div>
      <div class="sig-space lio-sig-space"><span class="lio-sign-marker">[[LIO_SIGN]]</span></div>
      <div class="sig-name">HUỲNH ĐỨC NHÂM</div>
    </td>
  </tr>
</table>

</body>
</html>
"""

    return f"""<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8"/>
<title>Báo Cáo Sản Lượng Sử Dụng API (Usage Report) &amp; Biên Bản Nghiệm Thu Dịch Vụ Kỳ Tháng {month_str}</title>
<style>{COMMON_CSS}</style>
</head>
<body>
<div class="footer-str">Báo cáo Sản lượng Sử dụng API &amp; Biên bản Nghiệm thu Kỳ Tháng {month_str} (Mã: USAGE-{m_num}-{y_num}-PL{appendix_no})</div>

<table class="nat-header">
  <tr>
    <td style="width:48%;">
      <div class="org-name">HỆ THỐNG ĐỐI SOÁT 9ROUTER TELEMETRY<br/>HKD CÔNG NGHỆ LIO &ndash; CÔNG TY CP INUT</div>
      <div class="org-sub">Mã báo cáo: <strong>USAGE-{m_num}-{y_num}-PL{appendix_no}</strong></div>
    </td>
    <td style="width:52%;">
      <div class="nat-title">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
      <div class="nat-motto"><span class="nat-line">Độc lập – Tự do – Hạnh phúc</span></div>
      <div class="doc-date">Đắk Lắk, tháng {m_num} năm {y_num} (Lập &amp; đối soát trong ngày thanh toán 20–28/{month_str})</div>
    </td>
  </tr>
</table>

<h1 class="main-title">BÁO CÁO SẢN LƯỢNG SỬ DỤNG API CHUẨN TRONG NGÀY (USAGE REPORT)<br/>&amp; BIÊN BẢN NGHIỆM THU DỊCH VỤ KỲ THÁNG {month_str}</h1>
<div class="sub-title-center">(Đính kèm Phụ lục số <strong>PL-{appendix_no}/2026/HĐDV-LIO-INUT</strong> thuộc Hợp đồng nguyên tắc số <strong>0111/2026/HĐDV-LIO-INUT</strong>)</div>

<div class="callout-info">
  <strong>Thông tin Gói thuê bao &amp; Thanh toán – Hóa đơn trong ngày Kỳ Tháng {month_str}:</strong>
  Mã gói: <strong>{selected_tier_code} &ndash; {selected_tier_name}</strong> &nbsp;|&nbsp;
  Định mức trần: <strong>{selected_req_quota}</strong> (<strong>{selected_token_quota}</strong>) &nbsp;|&nbsp;
  Phí trọn gói chuyển khoản trong ngày: <strong>{amount_fmt} VNĐ</strong> (Hóa đơn điện tử xuất ngay vào ngày chuyển khoản) &nbsp;|&nbsp;
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
      <td><strong>Thị giác Máy tính (Vision OCR tài liệu/biển số) &amp; Ảnh</strong><br/><code>/v1/images/generations</code> &bull; <code>image-to-text</code></td>
      <td><code>gemini-vision-ocr</code>, <code>flux-pro</code></td>
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
      <td colspan="3" class="c" style="color:#15803d; font-size:9.1pt;">14.755.375.000 tokens (&approx; 14,76 tỷ tokens / 14.76B &mdash; Đạt 100% SLA gói {selected_tier_code})</td>
    </tr>
  </tbody>
</table>
<p style="font-size:7.5pt; font-style:italic; color:#1e293b; margin:2px 0 3px 0;">(Ghi chú: Sản lượng Token thống kê ở trên bao gồm &gt;85% là Cached Tokens được tái sử dụng qua bộ nhớ đệm nội bộ RTK Token Saver &amp; Context Caching của hệ thống 9Router)</p>

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
      <td>Hệ thống KSP PDFSign: Bóc tách chứng từ, hồ sơ hải quan, phân tích đấu thầu e-GP &amp; soạn hợp đồng</td>
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

<div class="sec-heading">III. KẾT LUẬN NGHIỆM THU, CHUYỂN KHOẢN TRONG NGÀY &amp; XUẤT HÓA ĐƠN KỲ THÁNG {month_str}</div>
<p>1. Bên A (<strong>Hộ kinh doanh Công nghệ LIO</strong>) đã cung cấp đầy đủ, liên tục dịch vụ <strong>{selected_tier_code} ({selected_tier_name})</strong> trong Kỳ Tháng {month_str} đạt mục tiêu khả dụng SLA &ge; 99,0% đúng theo Hợp đồng nguyên tắc số <strong>0111/2026/HĐDV-LIO-INUT</strong> và Phụ lục số <strong>PL-{appendix_no}/2026/HĐDV-LIO-INUT</strong>.</p>
<p>2. Sản lượng sử dụng thực tế (<strong>184.460 requests</strong> / <strong>14.755.375.000 tokens &approx; 14,76 tỷ tokens [14.76B tokens]</strong>) nằm trong trần định mức gói (<strong>{amount_fmt} VNĐ</strong>), <strong>không phát sinh phí vượt gói</strong>. Căn cứ Báo cáo Usage chuẩn lập trong ngày (trong khung ngày 20–28/{month_str}), Bên B thực hiện chuyển khoản thanh toán 100% giá trị gói ngay trong ngày và Bên A xuất hóa đơn điện tử hợp lệ ngay vào ngày nhận chuyển khoản./.</p>

<table class="sig-table">
  <tr>
    <td>
      <div class="sig-role">ĐẠI DIỆN BÊN B (CÔNG TY INUT)</div>
      <div class="sig-note">(Ký số)</div>
      <div class="sig-space"></div>
      <div class="sig-name">NGÔ HUỲNH NGỌC KHÁNH</div>
    </td>
    <td>
      <div class="sig-role">ĐẠI DIỆN BÊN A (HKD CÔNG NGHỆ LIO)</div>
      <div class="sig-note">(Ký số)</div>
      <div class="sig-space lio-sig-space"><span class="lio-sign-marker">[[LIO_SIGN]]</span></div>
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
    parser.add_argument("--payment-window", default="Từ ngày 20/11/2026 đến ngày 28/11/2026")
    parser.add_argument("--tier-code", default="AI-05")
    parser.add_argument("--tier-name", default="Gói Tăng Trưởng (Growth API Tier)")
    parser.add_argument("--req-quota", default="Tối đa 220.000 requests/tháng (bậc 150.001 – 220.000)")
    parser.add_argument("--token-quota", default="Tối đa 16,0 tỷ tokens/tháng (Input + Output + Cache + Reasoning)")
    parser.add_argument("--amount", type=int, default=16_000_000)
    parser.add_argument("--amount-words", default="Mười sáu triệu đồng chẵn")
    parser.add_argument("--usage-db", default="", help="Đường dẫn tới 9Router data.sqlite để kéo số liệu Usage thực tế (read-only)")
    parser.add_argument("--report-date", default="", help="Ngày lập Báo cáo Usage thực tế dạng DD/MM/YYYY (vd: 23/11/2026)")
    parser.add_argument("--exclude-keys", default="nham-inut", help="Danh sách API Key label tách loại khỏi sản lượng INUT, ngăn cách bằng dấu phẩy")
    parser.add_argument("--usage-only", action="store_true", help="Chỉ xuất lại File 02 (Báo cáo Usage & Biên bản nghiệm thu), không ghi đè File 01")
    args = parser.parse_args()

    BASE_DIR.mkdir(parents=True, exist_ok=True)
    m_num, y_num = args.month.split("/")

    usage_data: dict[str, Any] | None = None
    if args.usage_db:
        exclude_set = {x.strip() for x in args.exclude_keys.split(",") if x.strip()}
        usage_data = load_usage_from_sqlite(
            db_path=args.usage_db,
            month_str=args.month,
            report_date=args.report_date or None,
            exclude_keys=exclude_set,
        )
        r_date_slug = usage_data["report_date"].replace("/", "-")
        snap_path = BASE_DIR / f"usage-snapshot-{r_date_slug}.json"
        snap_path.write_text(json.dumps(usage_data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Saved live usage snapshot: {snap_path.name}")

    html_usage = build_monthly_usage_report_html(
        appendix_no=args.appendix_no,
        month_str=args.month,
        selected_tier_code=args.tier_code,
        selected_tier_name=args.tier_name,
        selected_req_quota=args.req_quota,
        selected_token_quota=args.token_quota,
        selected_amount=args.amount,
        selected_amount_words=args.amount_words,
        usage_data=usage_data,
    )
    (BASE_DIR / "04-bao-cao-usage.html").write_text(html_usage, encoding="utf-8")

    if usage_data is not None:
        r_date_slug = usage_data["report_date"].replace("/", "-")
        pdf_file_02 = BASE_DIR / f"File-02-Ky-Ngay-{r_date_slug}-Bao-Cao-Usage-Va-Bien-Ban-Nghiem-Thu-Thang-{m_num}-{y_num}-LIO-INUT.pdf"
    else:
        pdf_file_02 = BASE_DIR / f"File-02-Ky-Ngay-30-{m_num}-{y_num}-Bao-Cao-Usage-Va-Bien-Ban-Nghiem-Thu-Thang-{m_num}-{y_num}-LIO-INUT.pdf"

    weasyprint.HTML(string=html_usage, base_url=str(BASE_DIR)).write_pdf(str(pdf_file_02))

    if args.usage_only:
        r = pypdf.PdfReader(str(pdf_file_02))
        print(f"Generated: {pdf_file_02.name} ({pdf_file_02.stat().st_size:,} bytes | {len(r.pages)} pages)")
        return

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
