"""Phan loai va review bo ho so nhap khau dong bo tu Google Drive."""
from __future__ import annotations

import re
from pathlib import Path

from .inventory import normalize_name


DECLARATION_RE = re.compile(r"(?<!\d)(\d{12})(?!\d)")
CHINA_MARKERS = ("origin china", "origin: china", "made in china", "country of origin china")
VIETNAM_MARKERS = ("origin vietnam", "origin: vietnam", "made in vietnam")
ORIGIN_STATEMENT_MARKERS = ("country of origin", "origin:", "made in")
DOCUMENT_KINDS = (
    "customs_declaration", "ci", "pl", "coo", "bill_of_lading",
    "tax_receipt", "payment", "contract_po", "datasheet", "arrival_notice",
    "product_photo", "other",
)


def extract_declaration_numbers(value: str) -> set[str]:
    return set(DECLARATION_RE.findall(value or ""))


def classify_customs_document(filename: str, text: str) -> str:
    name = re.sub(r"[^a-z0-9]+", " ", normalize_name(Path(filename).stem)).strip()
    content = re.sub(r"[^a-z0-9]+", " ", normalize_name(text)).strip()
    combined = f"{name} {content}"
    suffix = Path(filename).suffix.lower()
    if suffix in (".xlsx", ".xls") and any(token in name for token in ("tokhai", "to khai", "vnaccs", "tkn")):
        return "customs_declaration"
    if any(token in combined for token in ("arrival notice", "notice of arrival", "arrival notification", "thong bao hang den")) or re.search(r"(^|\s)an($|\s)", name):
        return "arrival_notice"
    if any(token in name for token in ("datasheet", "data sheet", "specification", "spec sheet", "technical data", "thong so ky thuat", "tai lieu ky thuat")):
        return "datasheet"
    if any(token in content for token in ("technical data sheet", "product data sheet", "technical specification", "thong so ky thuat")):
        return "datasheet"
    if any(token in name for token in (
        "product photo", "product image", "hinh chup san pham",
        "hinh anh san pham", "anh san pham", "tem nhan san pham",
        "pcb front", "pcb back",
    )):
        return "product_photo"
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
    if any(token in combined for token in (
        "mt103", "payment", "swift", "debit note", "debitnote",
        "debit advice", "phieu bao no", "chung tu tt",
    )):
        return "payment"
    if any(token in combined for token in ("purchase order", "sales contract", "hop dong")) or re.search(r"(^|\s)po($|\s|-)", name):
        return "contract_po"
    return "other"


def _has_marker(text: str, markers: tuple[str, ...]) -> bool:
    normalized = normalize_name(text)
    return any(marker in normalized for marker in markers)


def _has_origin_statement(text: str) -> bool:
    normalized = normalize_name(text)
    return any(marker in normalized for marker in ORIGIN_STATEMENT_MARKERS) or bool(
        re.search(r"(^|\s)coo($|\s|:)", normalized)
    )


def _has_embedded_packing_details(text: str) -> bool:
    normalized = normalize_name(text)
    if "packing list" in normalized:
        return True
    packing_fields = (
        "no of packages", "number of packages", "gross weight",
        "net weight", "description of goods",
    )
    return sum(marker in normalized for marker in packing_fields) >= 3


def review_dossier(files: list[dict]) -> dict:
    kinds = {str(item.get("kind", "")) for item in files}
    texts = {
        kind: "\n".join(str(item.get("text", "")) for item in files if item.get("kind") == kind)
        for kind in kinds
    }
    findings: list[dict[str, str]] = []

    def missing(kind: str, code: str, label: str, level: str = "do") -> None:
        if kind not in kinds:
            findings.append({"level": level, "code": code, "message": f"Thiếu {label}."})

    missing("customs_declaration", "missing_declaration", "tờ khai hải quan")
    missing("ci", "missing_ci", "Commercial Invoice (CI)")
    embedded_pl = "pl" not in kinds and any(
        _has_embedded_packing_details(text) for text in texts.values()
    )
    if "pl" not in kinds and not embedded_pl:
        findings.append({"level": "vang", "code": "missing_pl", "message": "Thiếu Packing List (PL)."})
    elif embedded_pl:
        findings.append({
            "level": "vang", "code": "embedded_pl",
            "message": "Đã thấy thông tin đóng gói/PL nằm trong chứng từ gộp; cần review trước khi khai.",
        })

    has_coo = "coo" in kinds
    ci_china = _has_marker(texts.get("ci", ""), CHINA_MARKERS)
    pl_china = _has_marker(texts.get("pl", ""), CHINA_MARKERS)
    ci_vietnam = _has_marker(texts.get("ci", ""), VIETNAM_MARKERS)
    pl_vietnam = _has_marker(texts.get("pl", ""), VIETNAM_MARKERS)
    ci_has_origin = _has_origin_statement(texts.get("ci", ""))
    pl_has_origin = _has_origin_statement(texts.get("pl", ""))
    label_has_origin = _has_origin_statement(texts.get("product_photo", ""))
    origin_is_confirmed = has_coo or ci_china or pl_china
    if (ci_china and pl_vietnam) or (pl_china and ci_vietnam):
        findings.append({"level": "do", "code": "origin_conflict",
                         "message": "Xuất xứ trên CI và PL không thống nhất."})
    if not origin_is_confirmed and not (ci_has_origin or pl_has_origin or label_has_origin):
        findings.append({"level": "do", "code": "missing_origin",
                         "message": "Chưa có C/O hoặc thông tin Country of Origin/COO/Origin trên CI/PL/nhãn sản phẩm."})
    elif not origin_is_confirmed:
        source = "nhãn sản phẩm" if label_has_origin and not (ci_has_origin or pl_has_origin) else "CI/PL"
        findings.append({"level": "vang", "code": "origin_statement_only",
                         "message": f"Đã thấy thông tin xuất xứ trên {source}; cần review nếu hồ sơ cần ưu đãi C/O."})

    checklist = {
        "declaration": {"state": "ok" if "customs_declaration" in kinds else "missing"},
        "ci": {"state": "ok" if "ci" in kinds else "missing"},
        "pl": {"state": "ok" if "pl" in kinds else "review" if embedded_pl else "missing"},
        "origin": {"state": "ok" if origin_is_confirmed else "review" if ci_has_origin or pl_has_origin or label_has_origin else "missing"},
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
