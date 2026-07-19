"""Parse hoa don dien tu (ihoadon.vn) -> du lieu de sinh BBBG.

Hoa don KHONG co XML nhung -> dung pdfplumber lay text theo toa do + bang.
Best-effort: ket qua duoc dua ra FORM cho nguoi dung sua truoc khi sinh BBBG.
"""
from __future__ import annotations

import io
import re
import xml.etree.ElementTree as ET

import pdfplumber


def _num(s: str) -> str:
    """Bo .00 cho so nguyen (1.00 -> 1), giu nguyen so khac."""
    s = (s or "").strip()
    try:
        f = float(s.replace(",", ""))
        return str(int(f)) if f == int(f) else s
    except ValueError:
        return s


def parse_invoice_xml(xml_bytes: bytes) -> dict:
    """Parse hoa don dien tu XML (chuan TT78/QD1450) — chinh xac hon PDF."""
    root = ET.fromstring(xml_bytes)

    def txt(el, tag, default=""):
        if el is None:
            return default
        x = el.find(tag)
        return (x.text or "").strip() if x is not None and x.text else default

    nmua = root.find(".//NMua")
    buyer = {
        "name": txt(nmua, "Ten"),
        "mst": txt(nmua, "MST"),
        "address": txt(nmua, "DChi"),
        "email": txt(nmua, "DCTDTu"),
        "phone": txt(nmua, "SDThoai"),
    }

    ngay = None
    nlap_el = root.find(".//NLap")
    nlap = (nlap_el.text or "").strip() if nlap_el is not None else ""
    m = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", nlap)
    if m:
        ngay = {"year": int(m.group(1)), "month": int(m.group(2)), "day": int(m.group(3))}

    items = []
    for hh in root.findall(".//DSHHDVu/HHDVu"):
        # TSuat: "10%" / "8%" / "KCT" (khong chiu thue)
        items.append({
            "stt": txt(hh, "STT"),
            "ten": txt(hh, "THHDVu"),
            "dvt": txt(hh, "DVTinh"),
            "so_luong": _num(txt(hh, "SLuong")),
            "don_gia": txt(hh, "DGia"),
            "thanh_tien": txt(hh, "ThTien"),
            "thue_suat": txt(hh, "TSuat").replace("%", "").strip(),
        })

    kh = root.find(".//KHHDon")
    return {
        "buyer": buyer,
        "items": items,
        "ngay": ngay,
        "ky_hieu": (kh.text or "").strip() if kh is not None else "",
        "source": "xml",
        "raw_text": "",
    }


def _cluster_lines(words, tol: float = 4.0):
    """Gom words thanh cac dong theo toa do y (top), sap trai->phai."""
    ws = sorted(words, key=lambda w: (w["top"], w["x0"]))
    lines: list[list] = []
    for w in ws:
        if lines and abs(w["top"] - lines[-1][0]["top"]) <= tol:
            lines[-1].append(w)
        else:
            lines.append([w])
    return [sorted(line, key=lambda w: w["x0"]) for line in lines]


def _line_text(line) -> str:
    return " ".join(w["text"] for w in line)


def _value_part(line, xmin: float = 125.0) -> str:
    return " ".join(w["text"] for w in line if w["x0"] >= xmin).strip()


def parse_invoice(pdf_bytes: bytes) -> dict:
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        page = pdf.pages[0]
        raw = page.extract_text() or ""
        tables = page.extract_tables()
        lines = _cluster_lines(page.extract_words(use_text_flow=True))

    buyer = {"name": "", "mst": "", "address": "", "email": "", "phone": ""}
    idx = None
    for i, line in enumerate(lines):
        t = _line_text(line)
        if "người mua hàng" in t or "(Buyer)" in t:
            idx = i
            break
    if idx is not None:
        for line in lines[idx : idx + 6]:
            t = _line_text(line)
            if not buyer["name"] and ("Tên đơn vị" in t or "(Company)" in t):
                buyer["name"] = _value_part(line)
            elif not buyer["mst"] and ("Mã số thuế" in t or "(Tax code)" in t):
                buyer["mst"] = "".join(
                    w["text"] for w in line if w["text"].isdigit()
                )
            elif not buyer["address"] and ("Địa chỉ" in t or "(Address)" in t):
                buyer["address"] = _value_part(line)

    items = []
    for t in tables:
        hdr = None
        for ri, row in enumerate(t):
            joined = " ".join((c or "") for c in row)
            if "Tên hàng hóa" in joined or "Description" in joined:
                hdr = ri
                break
        if hdr is None:
            continue
        for row in t[hdr + 1 :]:
            c0 = (row[0] or "").strip()
            joined = " ".join((c or "") for c in row)
            if "Tổng cộng" in joined or "Total" in joined:
                break
            if not c0.isdigit():
                continue

            def cell(i):
                return (row[i] or "").replace("\n", " ").strip() if i < len(row) else ""

            ten = cell(1)
            if ten.isdigit() and len(ten) <= 2:  # dong danh so cot "1 2 3 4..."
                continue

            items.append({
                "stt": int(c0),
                "ten": cell(1),
                "dvt": cell(2),
                "so_luong": cell(3),
                "don_gia": cell(4),
                "thanh_tien": cell(5),
            })
        if items:
            break

    ngay = None
    m = re.search(r"Ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})", raw)
    if m:
        ngay = {"day": int(m.group(1)), "month": int(m.group(2)), "year": int(m.group(3))}

    kh = re.search(r"Ký hiệu\s*:?\s*([A-Z0-9]+)", raw)
    return {
        "buyer": buyer,
        "items": items,
        "ngay": ngay,
        "ky_hieu": kh.group(1) if kh else "",
        "raw_text": raw,
    }
