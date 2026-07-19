"""Kiem tra chu ky so trong PDF bang pyHanko."""
from __future__ import annotations

import io

from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.validation import validate_pdf_signature
from pyhanko_certvalidator import ValidationContext

from .config import Settings
from .schemas import SignatureReport, VerifyResponse
from .trust import load_trust_roots


def _coverage_text(status) -> str:
    try:
        if status.coverage is not None and str(status.coverage).endswith("ENTIRE_FILE"):
            return "Ky toan bo tai lieu"
    except Exception:
        pass
    if getattr(status, "modification_level", None) is not None:
        return f"Co thay doi sau khi ky ({status.modification_level})"
    return "Khong xac dinh pham vi ky"


def _one_signature(embedded_sig, vc: ValidationContext) -> SignatureReport:
    problems: list[str] = []
    try:
        status = validate_pdf_signature(embedded_sig, signer_validation_context=vc)
    except Exception as e:  # loi phan tich chu ky
        return SignatureReport(
            field_name=getattr(embedded_sig, "field_name", "?"),
            signer_name="?",
            intact=False,
            valid=False,
            trusted=False,
            coverage="Khong doc duoc",
            summary="Loi khi kiem tra chu ky",
            problems=[str(e)],
        )

    intact = bool(getattr(status, "intact", False))
    valid = bool(getattr(status, "valid", False))
    trusted = bool(getattr(status, "trusted", False))
    revo = getattr(status, "revoked", None)
    revocation_ok = None if revo is None else (not revo)

    signer_name = "?"
    try:
        signer_name = status.signing_cert.subject.native.get("common_name", "?")
    except Exception:
        pass

    signing_time = None
    try:
        if status.signer_reported_dt:
            signing_time = status.signer_reported_dt.isoformat()
    except Exception:
        pass

    if not intact:
        problems.append("Tai lieu da bi sua sau khi ky (byte-range khong khop).")
    if not trusted:
        problems.append("Chuoi chung thu khong dan ve root CA tin cay (kiem tra trust store VN CA).")

    if intact and valid and trusted:
        summary = "HOP LE"
    elif intact and valid and not trusted:
        summary = "Chu ky dung nhung CA chua tin cay"
    else:
        summary = "KHONG HOP LE"

    return SignatureReport(
        field_name=getattr(embedded_sig, "field_name", "?"),
        signer_name=signer_name,
        signing_time=signing_time,
        intact=intact,
        valid=valid,
        trusted=trusted,
        revocation_ok=revocation_ok,
        has_timestamp=bool(getattr(status, "timestamp_validity", None)),
        ltv=str(getattr(status, "ltv", "") or "") or None,
        coverage=_coverage_text(status),
        summary=summary,
        problems=problems,
    )


def verify_document(settings: Settings, pdf_bytes: bytes, doc_id: str) -> VerifyResponse:
    roots = load_trust_roots(settings)
    vc = ValidationContext(trust_roots=roots, allow_fetching=True)

    reader = PdfFileReader(io.BytesIO(pdf_bytes))
    reports = [_one_signature(sig, vc) for sig in reader.embedded_signatures]

    return VerifyResponse(
        doc_id=doc_id,
        signature_count=len(reports),
        signatures=reports,
    )
