"""Create customer-safe delivery files from an iHOADON GHI_TAM PDF."""
from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass
from datetime import date

from pypdf import PdfReader, PdfWriter
from weasyprint import HTML


@dataclass(frozen=True)
class DeliveryBundle:
    pdf: bytes
    zip_bytes: bytes
    pdf_filename: str
    zip_filename: str


def _display_date(value: str) -> str:
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("Ngày xuất dự kiến phải có định dạng YYYY-MM-DD") from exc
    return parsed.strftime("%d/%m/%Y")


def _stamp_overlay(expected_issue_date: str) -> bytes:
    display_date = _display_date(expected_issue_date)
    page = f"""<!doctype html><html><head><style>
      @page {{ size: A4; margin: 0; }}
      html, body {{ margin: 0; width: 210mm; height: 297mm; background: transparent; }}
      .stamp {{ position: absolute; top: 13mm; left: 42mm; width: 126mm;
        padding: 3mm 2mm; border: 1.2mm solid rgba(180,20,20,.72);
        color: rgba(180,20,20,.84); background: rgba(255,245,160,.78);
        font: 700 13pt DejaVu Sans; text-align: center; transform: rotate(-4deg); }}
    </style></head><body><div class="stamp">BẢN NHÁP · DỰ KIẾN XUẤT {display_date}</div></body></html>"""
    return HTML(string=page).write_pdf()


def build_delivery_bundle(
    source_pdf: bytes, *, expected_issue_date: str, basename: str
) -> DeliveryBundle:
    if not source_pdf.startswith(b"%PDF"):
        raise ValueError("File nguồn phải là PDF hợp lệ")
    safe_basename = basename.strip().removesuffix(".pdf")
    if not safe_basename or "/" in safe_basename or "\\" in safe_basename:
        raise ValueError("Tên file PDF không hợp lệ")

    try:
        source = PdfReader(io.BytesIO(source_pdf))
        overlay = PdfReader(io.BytesIO(_stamp_overlay(expected_issue_date))).pages[0]
        writer = PdfWriter()
        for source_page in source.pages:
            source_page.merge_page(overlay)
            writer.add_page(source_page)
        stamped = io.BytesIO()
        writer.write(stamped)
    except Exception as exc:
        raise ValueError("Không thể đóng dấu PDF nháp") from exc

    pdf_filename = f"{safe_basename}.pdf"
    zip_filename = f"{safe_basename}.zip"
    packed = io.BytesIO()
    with zipfile.ZipFile(packed, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(pdf_filename, stamped.getvalue())
        archive.writestr(f"{safe_basename}-ihoadon-goc.pdf", source_pdf)
    return DeliveryBundle(
        pdf=stamped.getvalue(),
        zip_bytes=packed.getvalue(),
        pdf_filename=pdf_filename,
        zip_filename=zip_filename,
    )
