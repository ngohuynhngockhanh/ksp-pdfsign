"""Test xem trước bảng tính Excel (.xlsx) qua HTML và PDF."""
from __future__ import annotations

import io
import openpyxl

from app import xlsx_preview


def test_xlsx_preview_html_and_pdf():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Báo cáo SXKD"
    ws.cell(1, 1, "CÔNG TY CP CÔNG NGHỆ INUT")
    ws.cell(1, 1).font = openpyxl.styles.Font(bold=True)
    ws.merge_cells("A1:C1")
    ws.cell(2, 1, "Doanh thu 2025")
    ws.cell(2, 2, 556839575)
    ws.cell(2, 3, "triệu đồng")

    buf = io.BytesIO()
    wb.save(buf)
    xlsx_bytes = buf.getvalue()

    assert xlsx_preview.is_valid_xlsx(xlsx_bytes) is True
    assert xlsx_preview.is_valid_xlsx(b"fake data") is False

    html_out = xlsx_preview.render_xlsx_preview_html(
        xlsx_bytes,
        title="Test_Report.xlsx",
        download_url="/download",
        pdf_url="/pdf",
    )
    assert "CÔNG TY CP CÔNG NGHỆ INUT" in html_out
    assert "Báo cáo SXKD" in html_out
    assert 'colspan="3"' in html_out

    # Test PDF rendering via LibreOffice
    pdf_bytes = xlsx_preview.render_xlsx_to_pdf_bytes(xlsx_bytes, title="Test_Report.xlsx")
    assert pdf_bytes.startswith(b"%PDF")
