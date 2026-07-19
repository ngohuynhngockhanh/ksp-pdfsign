"""Phan loai tai lieu theo noi dung trang dau.

Uu tien trich text (pypdfium2 — du cho PDF chu). Neu la PDF scan (text rong)
-> OCR trang dau (pytesseract neu co tesseract, nguoc lai rapidocr-onnxruntime).
"""
from __future__ import annotations

import pypdfium2 as pdfium

# Thu tu uu tien: BBBG truoc hoa_don (BBBG khong chua 'HOA DON', nguoc lai co the).
KEYWORDS: list[tuple[str, list[str]]] = [
    ("bbbg", ["BIÊN BẢN BÀN GIAO", "BIEN BAN BAN GIAO"]),
    ("hop_dong", ["HỢP ĐỒNG", "HOP DONG"]),
    ("bao_gia", ["BÁO GIÁ", "BAO GIA", "BẢNG GIÁ"]),
    ("hoa_don", ["HÓA ĐƠN", "HOA DON", "GIÁ TRỊ GIA TĂNG"]),
]

LABELS = {
    "bbbg": "Biên bản bàn giao",
    "hop_dong": "Hợp đồng",
    "bao_gia": "Báo giá",
    "hoa_don": "Hóa đơn",
    "khac": "Khác",
    "": "Chưa phân loại",
}

_rapid = None


def _first_page_text(pdf_bytes: bytes) -> str:
    d = pdfium.PdfDocument(pdf_bytes)
    return d[0].get_textpage().get_text_range()


def _ocr_first_page(pdf_bytes: bytes) -> str:
    d = pdfium.PdfDocument(pdf_bytes)
    img = d[0].render(scale=2.0).to_pil()
    # 1) Tesseract neu co
    try:
        import pytesseract  # type: ignore

        return pytesseract.image_to_string(img, lang="vie+eng")
    except Exception:
        pass
    # 2) rapidocr (pip, khong can root)
    try:
        import numpy as np
        from rapidocr_onnxruntime import RapidOCR  # type: ignore

        global _rapid
        if _rapid is None:
            _rapid = RapidOCR()
        res, _ = _rapid(np.array(img.convert("RGB")))
        return " ".join(r[1] for r in (res or []))
    except Exception:
        return ""


def classify_text(text: str) -> str:
    up = (text or "").upper()
    for dtype, kws in KEYWORDS:
        if any(k.upper() in up for k in kws):
            return dtype
    return "khac" if (text or "").strip() else ""


def detect_doc_type(pdf_bytes: bytes) -> str:
    try:
        text = _first_page_text(pdf_bytes) or ""
    except Exception:
        text = ""
    if len(text.strip()) < 20:  # PDF scan -> thu OCR
        try:
            text = _ocr_first_page(pdf_bytes) or text
        except Exception:
            pass
    return classify_text(text)
