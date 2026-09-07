"""Module sinh tem nhãn vận đơn SPX Express khổ A6 (100mm x 150mm) chuẩn in nhiệt."""

import io
import os
from datetime import datetime
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.graphics.barcode import code128
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import qrcode


# Đăng ký font tiếng Việt Unicode
FONT_REGULAR = "Helvetica"
FONT_BOLD = "Helvetica-Bold"

try:
    if os.path.exists("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        pdfmetrics.registerFont(TTFont("DejaVuSans", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
        pdfmetrics.registerFont(TTFont("DejaVuSans-Bold", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))
        FONT_REGULAR = "DejaVuSans"
        FONT_BOLD = "DejaVuSans-Bold"
    elif os.path.exists("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"):
        pdfmetrics.registerFont(TTFont("LiberationSans", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"))
        pdfmetrics.registerFont(TTFont("LiberationSans-Bold", "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"))
        FONT_REGULAR = "LiberationSans"
        FONT_BOLD = "LiberationSans-Bold"
except Exception:
    pass


def generate_spx_a6_label(
    tracking_no: str,
    recipient_name: str,
    recipient_phone: str,
    recipient_address: str,
    cod_amount: float = 0.0,
    weight_gram: int = 500,
    item_description: str = "Thiết bị điện tử / Phụ kiện INUT",
    note: str = "Cho xem hàng, không cho thử",
    sender_name: str = "INUT TECHNOLOGY",
    sender_phone: str = "0345296757",
    sender_address: str = "161 Trường Chinh, P. Tuy Hòa, Đắk Lắk",
    order_code: str = "",
    sort_code: str = "VN-SGN-01",
) -> bytes:
    """Tạo file PDF tem nhãn vận chuyển A6 (100mm x 150mm) in nhiệt chuẩn SPX Express."""
    page_width = 100 * mm
    page_height = 150 * mm

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=(page_width, page_height))
    c.setTitle(f"SPX_AWB_{tracking_no}")

    # Lề nhãn 3mm
    margin = 3.0 * mm
    content_w = page_width - 2 * margin
    content_h = page_height - 2 * margin

    # Khung viền ngoài
    c.setStrokeColor(colors.black)
    c.setLineWidth(1.2)
    c.rect(margin, margin, content_w, content_h)

    # =========================================================================
    # 1. HEADER (Y: 147mm -> 130mm)
    # =========================================================================
    y_top = page_height - margin
    header_h = 16 * mm
    y_h_bottom = y_top - header_h

    # Khung logo SPX Express đơn sắc (Solid Black Pill)
    c.setFillColor(colors.black)
    c.roundRect(margin + 1.5 * mm, y_h_bottom + 2.5 * mm, 38 * mm, 11 * mm, 2 * mm, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont(FONT_BOLD, 15)
    c.drawString(margin + 3.5 * mm, y_h_bottom + 5.5 * mm, "SPX")
    c.setFont(FONT_BOLD, 8)
    c.drawString(margin + 18.5 * mm, y_h_bottom + 5.8 * mm, "EXPRESS")

    # Phân loại dịch vụ & Mã Sort Code góc phải
    c.setFillColor(colors.black)
    c.setFont(FONT_BOLD, 8)
    c.drawRightString(page_width - margin - 2 * mm, y_h_bottom + 11.5 * mm, "SPX TIÊU CHUẨN")
    c.setFont(FONT_BOLD, 14)
    c.drawRightString(page_width - margin - 2 * mm, y_h_bottom + 4 * mm, sort_code)

    # Đường phân cách 1
    c.setLineWidth(1.0)
    c.line(margin, y_h_bottom, page_width - margin, y_h_bottom)

    # =========================================================================
    # 2. MÃ VẠCH VẬN ĐƠN (BARCODE) (Y: 131mm -> 104mm)
    # =========================================================================
    barcode_val = tracking_no.upper().strip()
    bc = code128.Code128(barcode_val, barHeight=15 * mm, barWidth=1.15, humanReadable=False)
    bc_x = (page_width - bc.width) / 2
    bc_y = y_h_bottom - 17 * mm
    bc.drawOn(c, bc_x, bc_y)

    # Text mã vận đơn to rõ
    c.setFont(FONT_BOLD, 11.5)
    c.drawCentredString(page_width / 2, y_h_bottom - 21.5 * mm, f"Mã VĐ: {barcode_val}")
    if order_code and order_code != barcode_val:
        c.setFont(FONT_REGULAR, 7.5)
        c.drawCentredString(page_width / 2, y_h_bottom - 25 * mm, f"Mã đơn hàng: {order_code}")
        y2 = y_h_bottom - 27 * mm
    else:
        y2 = y_h_bottom - 24 * mm

    # Đường phân cách 2
    c.setLineWidth(0.8)
    c.line(margin, y2, page_width - margin, y2)

    # =========================================================================
    # 3. THÔNG TIN NGƯỜI GỬI (FROM) & NGƯỜI NHẬN (TO) (Y: y2 -> 62mm)
    # =========================================================================
    # Phần Người Gửi (From) - Chiều cao ~14mm
    c.setFont(FONT_BOLD, 7.5)
    c.drawString(margin + 2 * mm, y2 - 4 * mm, "Từ / From:")
    c.setFont(FONT_BOLD, 8)
    c.drawString(margin + 18 * mm, y2 - 4 * mm, f"{sender_name}")
    c.setFont(FONT_REGULAR, 7.5)
    c.drawString(margin + 58 * mm, y2 - 4 * mm, f"SĐT: {sender_phone}")

    # Địa chỉ gửi
    s_addr_lines = _wrap_text(sender_address, max_chars=55)
    curr_sy = y2 - 7.5 * mm
    for line in s_addr_lines[:2]:
        c.drawString(margin + 2 * mm, curr_sy, line)
        curr_sy -= 3.5 * mm

    # Dòng phân cách giữa Người gửi và Người nhận
    y_from_to = y2 - 14 * mm
    c.setLineWidth(0.5)
    c.line(margin, y_from_to, page_width - margin, y_from_to)

    # Phần Người Nhận (To) - Rất to và nổi bật
    c.setFont(FONT_BOLD, 8.5)
    c.drawString(margin + 2 * mm, y_from_to - 4.5 * mm, "Đến / To:")
    
    # Tên người nhận IN HOA ĐẬM
    c.setFont(FONT_BOLD, 11)
    rec_name_display = recipient_name.upper() if recipient_name else "KHÁCH HÀNG SPX"
    c.drawString(margin + 18 * mm, y_from_to - 4.5 * mm, rec_name_display)

    # Số điện thoại người nhận
    c.setFont(FONT_BOLD, 11.5)
    rec_phone_display = f"ĐT: {recipient_phone}" if recipient_phone else "ĐT: (Cập nhật trên hệ thống SPX)"
    c.drawString(margin + 2 * mm, y_from_to - 9.5 * mm, rec_phone_display)

    # Địa chỉ người nhận (Wrap text rõ ràng)
    c.setFont(FONT_REGULAR, 8.5)
    r_addr_lines = _wrap_text(recipient_address if recipient_address else "Việt Nam", max_chars=46)
    curr_ry = y_from_to - 14 * mm
    for line in r_addr_lines[:4]:
        c.drawString(margin + 2 * mm, curr_ry, line)
        curr_ry -= 4.0 * mm

    # =========================================================================
    # 4. KHUNG THU TIỀN (COD) & KHỐI LƯỢNG / THÔNG TIN KIỆN (Y: 62mm -> 25mm)
    # =========================================================================
    y3 = 62 * mm
    c.setLineWidth(1.0)
    c.line(margin, y3, page_width - margin, y3)

    # Chia cột: Cột trái (62mm) là COD & Lưu ý | Cột phải (32mm) là QR Code
    col_split = margin + 61 * mm
    c.setLineWidth(0.6)
    c.line(col_split, y3, col_split, 25 * mm)

    # Khung Tiền Thu Hộ (COD) nổi bật
    c.setFont(FONT_BOLD, 8)
    c.drawString(margin + 2 * mm, y3 - 4.5 * mm, "TIỀN THU HỘ (COD):")

    if cod_amount and cod_amount > 0:
        c.setFont(FONT_BOLD, 13)
        c.drawString(margin + 2 * mm, y3 - 11 * mm, f"{cod_amount:,.0f} VNĐ")
    else:
        c.setFont(FONT_BOLD, 10.5)
        c.drawString(margin + 2 * mm, y3 - 11 * mm, "0 VNĐ (KHÔNG THU TIỀN)")

    # Khối lượng & Nội dung
    c.setFont(FONT_REGULAR, 7.5)
    c.drawString(margin + 2 * mm, y3 - 16.5 * mm, f"Khối lượng: {weight_gram} g")
    c.drawString(margin + 2 * mm, y3 - 21 * mm, f"Nội dung: {item_description[:35]}")
    c.setFont(FONT_BOLD, 7.5)
    c.drawString(margin + 2 * mm, y3 - 26 * mm, f"Chỉ dẫn: {note[:35]}")

    # QR Code tra cứu (Cột phải)
    qr_url = f"https://spx.vn/track?{tracking_no}"
    qr_img = qrcode.make(qr_url, box_size=3, border=1)
    qr_buf = io.BytesIO()
    qr_img.save(qr_buf, format="PNG")
    qr_buf.seek(0)

    from reportlab.lib.utils import ImageReader
    qr_reader = ImageReader(qr_buf)
    c.drawImage(qr_reader, col_split + 3 * mm, 27.5 * mm, width=28 * mm, height=28 * mm)
    c.setFont(FONT_REGULAR, 6)
    c.drawCentredString(col_split + 17 * mm, 26 * mm, "Quét tra cứu đơn")

    # =========================================================================
    # 5. FOOTER & CHỮ KÝ XÁC NHẬN (Y: 25mm -> margin)
    # =========================================================================
    y4 = 25 * mm
    c.setLineWidth(0.8)
    c.line(margin, y4, page_width - margin, y4)

    c.setFont(FONT_REGULAR, 7)
    now_str = datetime.now().strftime("%d/%m/%Y %H:%M")
    c.drawString(margin + 2 * mm, 19 * mm, f"Ngày in: {now_str}")
    c.drawString(margin + 2 * mm, 14.5 * mm, "Chữ ký người nhận:")
    c.setFont(FONT_REGULAR, 6)
    c.drawString(margin + 2 * mm, 9 * mm, "(Xác nhận hàng nguyên vẹn, không móp méo)")

    c.setFont(FONT_BOLD, 7.5)
    c.drawRightString(page_width - margin - 3 * mm, 19 * mm, "SPX EXPRESS VIETNAM")
    c.setFont(FONT_REGULAR, 6.5)
    c.drawRightString(page_width - margin - 3 * mm, 14.5 * mm, "Tổng đài hỗ trợ: 1900 6885")
    c.drawRightString(page_width - margin - 3 * mm, 9 * mm, "Website: https://spx.vn")

    c.showPage()
    c.save()

    buffer.seek(0)
    return buffer.getvalue()


def _wrap_text(text: str, max_chars: int = 45) -> list[str]:
    """Cắt dòng văn bản dài thành nhiều dòng vừa vặn tem nhãn."""
    if not text:
        return []
    words = text.split()
    lines = []
    current = []
    curr_len = 0
    for w in words:
        if curr_len + len(w) + 1 <= max_chars:
            current.append(w)
            curr_len += len(w) + 1
        else:
            if current:
                lines.append(" ".join(current))
            current = [w]
            curr_len = len(w)
    if current:
        lines.append(" ".join(current))
    return lines
