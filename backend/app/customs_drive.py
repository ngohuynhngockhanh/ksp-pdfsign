"""Phan loai va review bo ho so nhap khau dong bo tu Google Drive."""
from __future__ import annotations

import re
from pathlib import Path

from .inventory import normalize_name


DECLARATION_RE = re.compile(r"(?<!\d)(\d{12})(?!\d)")
CHINA_MARKERS = ("origin china", "origin: china", "made in china", "country of origin china")
VIETNAM_MARKERS = ("origin vietnam", "origin: vietnam", "made in vietnam")


def extract_declaration_numbers(value: str) -> set[str]:
    return set(DECLARATION_RE.findall(value or ""))


def classify_customs_document(filename: str, text: str) -> str:
    name = re.sub(r"[^a-z0-9]+", " ", normalize_name(Path(filename).stem)).strip()
    content = re.sub(r"[^a-z0-9]+", " ", normalize_name(text)).strip()
    combined = f"{name} {content}"
    suffix = Path(filename).suffix.lower()
    if suffix in (".xlsx", ".xls") and any(token in name for token in ("tokhai", "to khai", "vnaccs", "tkn")):
        return "customs_declaration"
    if any(token in combined for token in ("commercial invoice", "invoice thuong mai")) or re.search(r"(^|\s)ci($|\s|-)", name):
        return "ci"
    if "packing list" in combined or re.search(r"(^|\s)pl($|\s|-)", name):
        return "pl"
    if any(token in combined for token in ("certificate of origin", "chung nhan xuat xu", "form e")) or re.search(r"(^|\s)(co|coo)($|\s|-)", name):
        return "coo"
    if any(token in combined for token in ("bill of lading", "air waybill", "sea waybill")) or re.search(r"(^|\s)(bl|awb)($|\s|-)", name):
        return "bill_of_lading"
    if any(token in combined for token in ("giay nop tien", "nop ngan sach", "c1 02 ns")):
        return "tax_receipt"
    if any(token in combined for token in ("mt103", "payment", "swift")):
        return "payment"
    if any(token in combined for token in ("purchase order", "sales contract", "hop dong")) or re.search(r"(^|\s)po($|\s|-)", name):
        return "contract_po"
    return "other"


def _has_marker(text: str, markers: tuple[str, ...]) -> bool:
    normalized = normalize_name(text)
    return any(marker in normalized for marker in markers)


def review_dossier(files: list[dict]) -> dict:
    kinds = {str(item.get("kind", "")) for item in files}
    texts = {str(item.get("kind", "")): str(item.get("text", "")) for item in files}
    findings: list[dict[str, str]] = []

    def missing(kind: str, code: str, label: str, level: str = "do") -> None:
        if kind not in kinds:
            findings.append({"level": level, "code": code, "message": f"Thiếu {label}."})

    missing("customs_declaration", "missing_declaration", "tờ khai hải quan")
    missing("ci", "missing_ci", "Commercial Invoice (CI)")
    missing("pl", "missing_pl", "Packing List (PL)", "vang")

    has_coo = "coo" in kinds
    ci_china = _has_marker(texts.get("ci", ""), CHINA_MARKERS)
    pl_china = _has_marker(texts.get("pl", ""), CHINA_MARKERS)
    ci_vietnam = _has_marker(texts.get("ci", ""), VIETNAM_MARKERS)
    pl_vietnam = _has_marker(texts.get("pl", ""), VIETNAM_MARKERS)
    if (ci_china and pl_vietnam) or (pl_china and ci_vietnam):
        findings.append({"level": "do", "code": "origin_conflict",
                         "message": "Xuất xứ trên CI và PL không thống nhất."})
    if not has_coo and not (ci_china or pl_china):
        findings.append({"level": "do", "code": "missing_origin",
                         "message": "Chưa có C/O hoặc dòng Origin/Made in China trên CI/PL."})
    elif not has_coo:
        findings.append({"level": "vang", "code": "origin_statement_only",
                         "message": "Đã thấy Origin China trên CI/PL; cần review mục đích ưu đãi C/O."})

    checklist = {
        "declaration": {"state": "ok" if "customs_declaration" in kinds else "missing"},
        "ci": {"state": "ok" if "ci" in kinds else "missing"},
        "pl": {"state": "ok" if "pl" in kinds else "missing"},
        "origin": {"state": "ok" if has_coo else "review" if ci_china or pl_china else "missing"},
        "bill_of_lading": {"state": "ok" if "bill_of_lading" in kinds else "conditional"},
        "tax_receipt": {"state": "ok" if "tax_receipt" in kinds else "conditional"},
        "contract_po": {"state": "ok" if "contract_po" in kinds else "conditional"},
        "payment": {"state": "ok" if "payment" in kinds else "conditional"},
    }
    if any(item["level"] == "do" for item in findings):
        status = "missing_documents"
    elif findings:
        status = "needs_review"
    else:
        status = "complete"
    return {"status": status, "checklist": checklist, "findings": findings}
