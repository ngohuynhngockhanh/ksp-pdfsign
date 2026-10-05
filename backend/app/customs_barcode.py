"""Module tu dong tra cuu va tai Ma Vach Hai Quan tu Cong Thong Tin Hai Quan Viet Nam (pus1.customs.gov.vn).

Quy trinh:
1. GET BarcodeContainer.aspx lay __VIEWSTATE, __EVENTVALIDATION.
2. GET GenerateCaptcha.aspx lay anh captcha, tu dong giai bang ddddocr.
3. POST form tra cuu theo:
   - Ma doanh nghiep (MST)
   - So to khai
   - Ma Hai quan (4 ky tu dau dia diem luu kho, vd: 06DS)
   - Ngay to khai (DD/MM/YYYY)
4. Trich xuat noi dung bang ke ma vach, render ra file PDF A4 bang WeasyPrint.
5. Luu vao ksp-pdfsign va dong bo len Google Drive qua rclone.
"""

from __future__ import annotations

import json
import logging
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from bs4 import BeautifulSoup
from weasyprint import HTML

from . import customs_drive, storage
from .config import get_settings
from sqlalchemy.orm import Session
from .db import (
    InvCustomsDecl,
    InvCustomsDriveDocument,
    InvCustomsDriveFolder,
)

logger = logging.getLogger(__name__)

BARCODE_URL = "https://pus1.customs.gov.vn/BarcodeContainer/BarcodeContainer.aspx"
CAPTCHA_URL = "https://pus1.customs.gov.vn/BarcodeContainer/GenerateCaptcha.aspx"


class CustomsBarcodeError(RuntimeError):
    pass


def _solve_captcha(image_bytes: bytes) -> str:
    """Giai ma captcha bang thu vien ddddocr."""
    try:
        import ddddocr

        ocr = ddddocr.DdddOcr(show_ad=False)
        res = ocr.classification(image_bytes)
        return str(res).strip()
    except Exception as e:
        logger.warning(f"Loi giai captcha ddddocr: {e}")
        return ""


def _send_telegram_captcha(image_bytes: bytes, caption: str = "Nhập mã Captcha Hải Quan") -> None:
    """Gui anh captcha qua Telegram bot neu co cau hinh de ho tro thu cong khi can."""
    settings = get_settings()
    if not settings.telegram_enabled or not settings.telegram_bot_token:
        return
    try:
        url = f"{settings.telegram_api_base_url}/bot{settings.telegram_bot_token}/sendPhoto"
        files = {"photo": ("captcha.png", image_bytes, "image/png")}
        data = {"caption": caption}
        httpx.post(url, data=data, files=files, timeout=10.0)
    except Exception as e:
        logger.warning(f"Khong the gui captcha toi Telegram: {e}")


def fetch_customs_barcode_pdf(
    mst: str,
    so_to_khai: str,
    ma_hq: str,
    ngay_to_khai: str,
    max_retries: int = 10,
) -> tuple[bytes, str, dict[str, Any]]:
    """Tra cuu va tao file PDF Ma vach hai quan tu pus1.customs.gov.vn.

    Args:
        mst: Ma so thue doanh nghiep (vd: 4401053694)
        so_to_khai: So to khai 12 chu so (vd: 108557295010)
        ma_hq: Ma Hai quan tiep nhan (vd: 06DS)
        ngay_to_khai: Ngay dang ky to khai dinh dang DD/MM/YYYY (vd: 23/08/2026)
        max_retries: So lan thu lai neu captcha sai

    Returns:
        (pdf_bytes, filename, meta_dict)
    """
    mst = mst.strip()
    so_to_khai = so_to_khai.strip()
    ma_hq = ma_hq.strip()
    ngay_to_khai = ngay_to_khai.strip()

    # Chuan hoa ngay neu truyen vao YYYY-MM-DD
    if "-" in ngay_to_khai and len(ngay_to_khai) == 10:
        parts = ngay_to_khai.split("-")
        if len(parts[0]) == 4:  # YYYY-MM-DD -> DD/MM/YYYY
            ngay_to_khai = f"{parts[2]}/{parts[1]}/{parts[0]}"

    client = httpx.Client(verify=False, timeout=30.0, follow_redirects=True)

    for attempt in range(1, max_retries + 1):
        try:
            # 1. GET page
            r1 = client.get(BARCODE_URL)
            soup1 = BeautifulSoup(r1.text, "html.parser")

            viewstate_el = soup1.find("input", {"id": "__VIEWSTATE"})
            viewgen_el = soup1.find("input", {"id": "__VIEWSTATEGENERATOR"})
            eventval_el = soup1.find("input", {"id": "__EVENTVALIDATION"})

            if not viewstate_el or not viewgen_el or not eventval_el:
                time.sleep(1)
                continue

            viewstate = viewstate_el.get("value", "")
            viewgen = viewgen_el.get("value", "")
            eventval = eventval_el.get("value", "")

            # 2. GET captcha
            r2 = client.get(CAPTCHA_URL)
            captcha_code = _solve_captcha(r2.content)

            if not captcha_code:
                time.sleep(1)
                continue

            # 3. POST form
            data = {
                "__VIEWSTATE": viewstate,
                "__VIEWSTATEGENERATOR": viewgen,
                "__EVENTVALIDATION": eventval,
                "MaDoanhNghiep": mst,
                "SoToKhai": so_to_khai,
                "MaHQ": ma_hq,
                "txtNgayToKhai": ngay_to_khai,
                "txtCaptcha": captcha_code,
                "Button1": "Lấy thông tin",
            }

            r3 = client.post(BARCODE_URL, data=data)
            soup3 = BeautifulSoup(r3.text, "html.parser")

            err_span = soup3.find("span", {"id": "lblException"})
            err_text = err_span.text.strip() if err_span else ""

            if "Chưa nhập đúng mã" in err_text:
                time.sleep(0.5)
                continue

            if err_text and "không tìm thấy" in err_text.lower():
                raise CustomsBarcodeError(f"Cổng Hải Quan thông báo: {err_text}")

            # 4. Trich xuat noi dung ket qua tra cuu
            ketqua = soup3.find("div", {"id": "KetQuaTraCuu"})
            if not ketqua:
                if err_text:
                    raise CustomsBarcodeError(f"Lỗi tra cứu mã vạch: {err_text}")
                time.sleep(0.5)
                continue

            # Xoa nut "Trang de in" khoi noi dung in
            lbl_banin = ketqua.find("label", {"id": "lbl_BanIn"})
            if lbl_banin:
                lbl_banin.decompose()

            # Render HTML to PDF
            html_content = f"""
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>BẢNG KÊ MÃ VẠCH PHƯƠNG TIỆN CHỨA HÀNG - {so_to_khai}</title>
<style>
@page {{
    size: A4 portrait;
    margin: 12mm 15mm 12mm 15mm;
}}
body, table, th, td, div, span, p, label, .TextMediumBold, .TextLargeBold, .GridView {{
    font-family: 'Times New Roman', 'Times', 'Liberation Serif', 'DejaVu Serif', serif;
}}
body {{
    font-size: 13px;
    color: #000;
    background: #fff;
    line-height: 1.4;
}}
table {{
    width: 100%;
    border-collapse: collapse;
}}
.TextMediumBold {{
    font-weight: bold;
    font-size: 13px;
}}
.TextLargeBold {{
    font-weight: bold;
    font-size: 16px;
}}
.GridView {{
    width: 100%;
    border-collapse: collapse;
    margin-top: 10px;
}}
.GridView th, .GridView td {{
    border: 1px solid #000;
    padding: 6px 8px;
    text-align: center;
}}
.GridView th {{
    background-color: #f2f2f2;
    font-weight: bold;
}}
img {{
    max-width: 100%;
    height: auto;
    display: block;
    margin: 0 auto;
}}
</style>
</head>
<body>
{str(ketqua)}
</body>
</html>
"""

            pdf_bytes = HTML(string=html_content).write_pdf()
            filename = f"MaVach_{so_to_khai}.pdf"
            meta = {
                "mst": mst,
                "so_to_khai": so_to_khai,
                "ma_hq": ma_hq,
                "ngay_to_khai": ngay_to_khai,
                "status": "success",
                "attempt": attempt,
                "fetched_at": datetime.now(timezone.utc).isoformat(),
            }
            return pdf_bytes, filename, meta

        except CustomsBarcodeError:
            raise
        except Exception as e:
            logger.warning(f"Attempt {attempt} error: {e}")
            time.sleep(1)

    raise CustomsBarcodeError(
        f"Không thể lấy mã vạch cho tờ khai {so_to_khai} sau {max_retries} lần thử (kiểm tra lại thông tin hoặc mạng pus1.customs.gov.vn)."
    )


def fetch_and_sync_customs_barcode(
    db: Session,
    decl_id: int,
    folder_id: str | None = None,
    customs_code_override: str | None = None,
) -> dict[str, Any]:
    """Tu dong tra cuu ma vach cho to khai trong DB, luu file vao KSP va sync len Google Drive."""
    decl = db.get(InvCustomsDecl, decl_id)
    if not decl:
        raise CustomsBarcodeError(f"Không tìm thấy tờ khai ID {decl_id}")

    mst = "4401053694"  # Default INUT MST
    so_to_khai = decl.so_to_khai
    ngay_to_khai = decl.ngay_dang_ky  # YYYY-MM-DD hoac DD/MM/YYYY

    # Xac dinh ma Hai quan (uu tien param truyen vao, hoac 4 ky tu dau dia diem luu kho/co quan)
    ma_hq = customs_code_override or "06DS"
    if not customs_code_override and decl.co_quan_hq:
        if "CPN" in decl.co_quan_hq or "06DS" in decl.co_quan_hq:
            ma_hq = "06DS"
        else:
            ma_hq = decl.co_quan_hq[:4]

    # 1. Tai PDF ma vach tu cong Hai quan
    pdf_bytes, filename, meta = fetch_customs_barcode_pdf(
        mst=mst,
        so_to_khai=so_to_khai,
        ma_hq=ma_hq,
        ngay_to_khai=ngay_to_khai,
    )

    # 2. Luu file vao kho storage noi bo cua ksp-pdfsign
    doc_id = storage.save_upload(pdf_bytes, suffix=".pdf")

    # 3. Tim folder lien ket trong database
    folder = None
    if folder_id:
        folder = db.query(InvCustomsDriveFolder).filter_by(drive_folder_id=folder_id).first()
    if not folder:
        folder = db.query(InvCustomsDriveFolder).filter_by(customs_id=decl.id).first()

    if folder:
        # 4. Upload len Google Drive qua rclone
        settings = get_settings()
        target_folder_id = folder.drive_folder_id
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir) / filename
            tmp_path.write_bytes(pdf_bytes)
            cmd = [
                "rclone",
                "copy",
                str(tmpdir),
                settings.customs_drive_remote,
                "--drive-root-folder-id",
                target_folder_id,
                "--bind",
                settings.customs_drive_bind,
                "--retries",
                "2",
            ]
            subprocess.run(cmd, capture_output=True, timeout=180, check=False)

        # 5. Cap nhat ban ghi InvCustomsDriveDocument
        document = (
            db.query(InvCustomsDriveDocument)
            .filter_by(folder_id=folder.id, name=filename)
            .first()
        )
        if not document:
            document = InvCustomsDriveDocument(
                folder_id=folder.id,
                drive_file_id=f"barcode_{so_to_khai}",
                name=filename,
                path=filename,
                mime_type="application/pdf",
                size=len(pdf_bytes),
                kind="barcode",
                doc_id=doc_id,
                doc_suffix=".pdf",
            )
            db.add(document)
        else:
            document.doc_id = doc_id
            document.doc_suffix = ".pdf"
            document.size = len(pdf_bytes)
            document.kind = "barcode"

        # Cap nhat checklist ho so
        dossier_files = [
            {"kind": d.kind, "text": d.extracted_text or ""} for d in folder.documents
        ]
        dossier_files.append({"kind": "barcode", "text": "BẢNG KÊ MÃ VẠCH PHƯƠNG TIỆN CHỨA HÀNG"})
        review = customs_drive.review_dossier(dossier_files)
        folder.dossier_status = review["status"]
        folder.checklist = json.dumps(review["checklist"], ensure_ascii=False)
        folder.findings = json.dumps(review["findings"], ensure_ascii=False)

        db.commit()

    return {
        "ok": True,
        "filename": filename,
        "so_to_khai": so_to_khai,
        "doc_id": doc_id,
        "size": len(pdf_bytes),
        "folder_linked": folder.name if folder else None,
        "meta": meta,
    }
