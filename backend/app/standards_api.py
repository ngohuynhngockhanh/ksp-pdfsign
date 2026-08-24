"""FastAPI router cho Phan he Tra cuu Hop Chuan, Hop Quy (QCVN/TCVN) va HS Code."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from typing import Any
from pydantic import BaseModel, Field

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import standards
from . import tqc_cnhq
from .audit import record as audit_record
from .auth import CurrentUser, require_admin, require_user
from .config import Settings, get_settings
from .db import TqcCertificate, get_session

router = APIRouter(prefix="/api/standards", tags=["standards"])


class CrDeclarationRequest(BaseModel):
    company_name: str = "CÔNG TY TNHH CÔNG NGHỆ INUT"
    tax_code: str = "4401053694"
    address: str = "Tỉnh Phú Yên, Việt Nam"
    representative_name: str = "Ngô Huỳnh Ngọc Khánh"
    representative_title: str = "Giám đốc"
    product_name: str = "Thiết bị IoT Gateway 4G Công nghiệp"
    model_name: str = "iNut-GW4G-Pro"
    manufacturer: str = "CÔNG TY TNHH CÔNG NGHỆ INUT"
    country_of_origin: str = "Việt Nam"
    applicable_standards: list[str] = ["QCVN 117:2020/BTTTT", "QCVN 54:2020/BTTTT", "QCVN 18:2022/BTTTT", "QCVN 132:2022/BTTTT"]
    test_report_number: str = "VNTA-TR-2026/0842"
    test_lab_name: str = "Trung tâm Đo lường Chất lượng Viễn thông (Cục Viễn thông)"


class TqcImportEntry(BaseModel):
    certificate_no: str = ""
    qr_input: str = ""


class TqcImportRequest(BaseModel):
    entries: list[TqcImportEntry] = Field(default_factory=list, max_length=100)
    refresh_existing: bool = False


@router.get("/statistics")
def get_standards_statistics(
    user: CurrentUser = Depends(require_user),
) -> dict[str, Any]:
    """Thong ke tong so quy chuan QCVN/TCVN theo Bo va linh vuc."""
    return standards.StandardsRegistryService.get_statistics()


@router.get("/search")
def search_standards(
    q: str = Query("", description="Tu khoa tim kiem ma QCVN, ten quy chuan, ten thiet bi"),
    ministry: str = Query("", description="Bo chu quan: BTTTT, BKHCN, BTNMT, BCT, BYT"),
    category: str = Query("", description="Linh vuc: radio_telecom, emc, electrical_safety, environment, metrology, iso_management"),
    procedure_type: str = Query("", description="Loai thu tuc: mandatory_cert_and_cr, mandatory_cr_declaration, voluntary_system_cert"),
    user: CurrentUser = Depends(require_user),
) -> list[dict[str, Any]]:
    """Tra cuu danh sach quy chuan QCVN / TCVN da tieu chi."""
    return standards.StandardsRegistryService.search(
        query=q,
        ministry=ministry,
        category=category,
        procedure_type=procedure_type,
    )


def _tqc_http_error(exc: tqc_cnhq.TqcCnhqError) -> HTTPException:
    code = exc.code
    http_status = exc.status if 400 <= exc.status <= 599 else status.HTTP_502_BAD_GATEWAY
    return HTTPException(
        status_code=http_status,
        detail={"code": code, "message": str(exc)},
    )


def _cached_certificate(row: TqcCertificate) -> dict[str, Any]:
    return tqc_cnhq._model_to_dict(row)


@router.get("/tqc/status")
def get_tqc_status(
    user: CurrentUser = Depends(require_user),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Return safe TQC connector configuration and local index health."""
    return {
        "enabled": bool(settings.tqc_cnhq_base_url),
        "base_url": settings.tqc_cnhq_base_url,
        "api_key_configured": bool(settings.tqc_cnhq_api_key),
        "rate_limit_per_minute": settings.tqc_cnhq_rate_limit_per_minute,
        "cache_ttl_seconds": settings.tqc_cnhq_cache_ttl_seconds,
        "search_mode": "official_exact_plus_local_index",
    }


@router.get("/tqc/search")
def search_tqc_certificates(
    q: str = Query("", max_length=200),
    model: str = Query("", max_length=255),
    manufacturer: str = Query("", max_length=500),
    applicant: str = Query("", max_length=500),
    certificate_no: str = Query("", max_length=120),
    certificate_status: str = Query("", alias="status", max_length=30),
    valid_on: str = Query("", max_length=20),
    page: int = Query(1, ge=1, le=10000),
    page_size: int = Query(20, ge=1, le=100),
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    """Search only records already verified into the local TQC index."""
    if not any((q.strip(), model.strip(), manufacturer.strip(), applicant.strip(), certificate_no.strip())):
        raise HTTPException(status_code=422, detail="Cần ít nhất một điều kiện tìm kiếm")
    result = tqc_cnhq.search_index(
        db,
        q=q,
        model=model,
        manufacturer=manufacturer,
        applicant=applicant,
        certificate_no=certificate_no,
        status=certificate_status,
        valid_on=valid_on,
        page=page,
        page_size=page_size,
    )
    if not result["items"]:
        result["warning"] = "Chưa thấy trong chỉ mục nội bộ; điều này không khẳng định TQC không có chứng nhận."
        result["verification_status"] = "not_found_in_local_index"
    return result


@router.get("/tqc/certificates/{certificate_no}")
def get_tqc_certificate(
    certificate_no: str,
    refresh: bool = Query(False),
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Resolve one certificate live or from a fresh local cache."""
    normalized = tqc_cnhq.normalize_certificate_no(certificate_no)
    row = db.scalar(select(TqcCertificate).where(TqcCertificate.certificate_no == normalized))
    cache_age = None
    if row and row.last_verified_at:
        cache_age = (datetime.now(timezone.utc) - row.last_verified_at.replace(tzinfo=timezone.utc)).total_seconds()
    if row and not refresh and cache_age is not None and cache_age <= settings.tqc_cnhq_cache_ttl_seconds:
        certificate = _cached_certificate(row)
        certificate["provenance"]["verification_status"] = "verified_cached"
        certificate["provenance"]["cache_age_seconds"] = max(0, int(cache_age))
        return {"certificate": certificate}

    client = tqc_cnhq.get_client(settings)
    try:
        fetched = client.lookup(normalized)
    except tqc_cnhq.TqcCnhqError as exc:
        raise _tqc_http_error(exc) from exc
    finally:
        client.close()
    if fetched is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "not_found_live", "message": "TQC không tìm thấy giấy chứng nhận"},
        )
    certificate = tqc_cnhq.upsert_certificate(
        db,
        fetched["raw"],
        verification_status="verified_live",
        source_url=fetched["provenance"]["source_url"],
    )
    return {"certificate": certificate}


@router.post("/tqc/import")
def import_tqc_certificates(
    req: TqcImportRequest,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Import user-supplied certificate numbers or official QR payloads."""
    client = tqc_cnhq.get_client(settings)
    try:
        result = tqc_cnhq.import_entries(
            db,
            [entry.model_dump() for entry in req.entries],
            client=client,
            refresh_existing=req.refresh_existing,
        )
    except tqc_cnhq.TqcCnhqError as exc:
        raise _tqc_http_error(exc) from exc
    finally:
        client.close()
    audit_record(db, user.username, user.role, user.ip, "tqc_import", target="tqc_certificates", detail=json.dumps({"requested": result["requested"], "verified": result["verified"]}))
    return result


@router.post("/tqc/import/csv")
async def import_tqc_csv(
    file: UploadFile = File(...),
    refresh_existing: bool = Query(False),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Import a bounded CSV containing certificate numbers or TQC QR payloads."""
    content = await file.read(5 * 1024 * 1024 + 1)
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="CSV vượt quá giới hạn 5 MB")
    try:
        entries = tqc_cnhq.parse_import_csv(content.decode("utf-8-sig"))
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=422, detail="CSV phải dùng UTF-8") from exc
    client = tqc_cnhq.get_client(settings)
    try:
        result = tqc_cnhq.import_entries(db, entries, client=client, refresh_existing=refresh_existing)
    except tqc_cnhq.TqcCnhqError as exc:
        raise _tqc_http_error(exc) from exc
    finally:
        client.close()
    audit_record(db, user.username, user.role, user.ip, "tqc_import", target="tqc_certificates", detail=json.dumps({"requested": result["requested"], "verified": result["verified"]}))
    return result


@router.get("/hs-lookup/{hs_code}")
def lookup_by_hs_code(
    hs_code: str,
    user: CurrentUser = Depends(require_user),
) -> dict[str, Any]:
    """Tra cuu quy chuan va thu tuc kiem tra chuyen nganh Hai quan theo ma HS Code."""
    res = standards.HsCodeConformityService.lookup_hs_code(hs_code)
    if not res:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Không tìm thấy dữ liệu kiểm tra chuyên ngành cho mã HS Code {hs_code}",
        )
    return res


@router.get("/hs-mappings")
def list_hs_mappings(
    user: CurrentUser = Depends(require_user),
) -> list[dict[str, Any]]:
    """Lay danh sach tat ca cac ma HS Code da duoc anh xa quy chuan."""
    return standards.HsCodeConformityService.HS_CODE_MAPPINGS


@router.get("/testing-labs")
def list_testing_labs(
    user: CurrentUser = Depends(require_user),
) -> list[dict[str, Any]]:
    """Lay danh ba cac phong thu nghiem va to chuc chung nhan chi dinh."""
    return standards.TestingLabRegistryService.list_all()


@router.get("/{code:path}/pdf")
def download_standard_pdf(
    code: str,
    user: CurrentUser = Depends(require_user),
) -> Response:
    """Tai toan van tom tat quy chuan ky thuat QCVN/TCVN duoi dang PDF."""
    std = standards.StandardsRegistryService.get_by_code(code)
    if not std:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Không tìm thấy quy chuẩn {code}",
        )
    pdf_bytes, filename = standards.ConformityDocumentGenerator.generate_standard_summary_pdf(std)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache",
        },
    )


@router.post("/generate-cr-declaration/pdf")
def generate_cr_declaration_pdf(
    req: CrDeclarationRequest,
    user: CurrentUser = Depends(require_user),
) -> Response:
    """Sinh Ban Cong Bo Hop Quy (CR) chuan Mau 02 TT28 dinh dang PDF."""
    pdf_bytes, filename = standards.ConformityDocumentGenerator.generate_cr_declaration_pdf(
        company_name=req.company_name,
        tax_code=req.tax_code,
        address=req.address,
        representative_name=req.representative_name,
        representative_title=req.representative_title,
        product_name=req.product_name,
        model_name=req.model_name,
        manufacturer=req.manufacturer,
        country_of_origin=req.country_of_origin,
        applicable_standards=req.applicable_standards,
        test_report_number=req.test_report_number,
        test_lab_name=req.test_lab_name,
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache",
        },
    )


@router.post("/generate-cr-declaration/docx")
def generate_cr_declaration_docx(
    req: CrDeclarationRequest,
    user: CurrentUser = Depends(require_user),
) -> Response:
    """Sinh Ban Cong Bo Hop Quy (CR) chuan Mau 02 TT28 dinh dang Word (DOCX)."""
    doc_bytes, filename = standards.ConformityDocumentGenerator.generate_cr_declaration_docx(
        company_name=req.company_name,
        tax_code=req.tax_code,
        address=req.address,
        representative_name=req.representative_name,
        representative_title=req.representative_title,
        product_name=req.product_name,
        model_name=req.model_name,
        manufacturer=req.manufacturer,
        country_of_origin=req.country_of_origin,
        applicable_standards=req.applicable_standards,
        test_report_number=req.test_report_number,
        test_lab_name=req.test_lab_name,
    )
    return Response(
        content=doc_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache",
        },
    )


@router.get("/playbooks")
def list_playbooks(
    user: CurrentUser = Depends(require_user),
) -> list[dict[str, Any]]:
    """Lay danh sach cam nang huong dan thuc chien & case study nhap khau."""
    return standards.PracticalPlaybookService.list_all()


@router.get("/playbooks/{playbook_id}")
def get_playbook_detail(
    playbook_id: str,
    user: CurrentUser = Depends(require_user),
) -> dict[str, Any]:
    """Lay chi tiet 1 case study huong dan nhap khau thiet bi."""
    pb = standards.PracticalPlaybookService.get_by_id(playbook_id)
    if not pb:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Không tìm thấy cẩm nang {playbook_id}",
        )
    return pb

# ─── GAMIFICATION: HÀNH TRÌNH CHINH PHỤC HỢP QUY ───
from app.standards_game import StandardsGameService
from pydantic import BaseModel

class CompleteQuestRequest(BaseModel):
    quest_id: int
    note: str = ""

class UpdateNoteRequest(BaseModel):
    quest_id: int
    note: str

@router.get("/game/state")
def get_game_state(
    user: CurrentUser = Depends(require_user),
) -> dict[str, Any]:
    """Lay toan bo trang thai tien do Game, Level, EXP va danh sach 6 Ai."""
    return StandardsGameService.get_game_state()

@router.post("/game/complete")
def complete_game_quest(
    req: CompleteQuestRequest,
    user: CurrentUser = Depends(require_user),
) -> dict[str, Any]:
    """Hoan thanh 1 Ai nhiem vu, cong 500 EXP va mo khoa Ai tiep theo."""
    return StandardsGameService.complete_quest(req.quest_id, req.note)

@router.post("/game/note")
def update_game_note(
    req: UpdateNoteRequest,
    user: CurrentUser = Depends(require_user),
) -> dict[str, Any]:
    """Cap nhat ghi chu tac chien cho 1 Ai."""
    return StandardsGameService.update_quest_note(req.quest_id, req.note)

@router.post("/game/reset")
def reset_game_progress(
    user: CurrentUser = Depends(require_user),
) -> dict[str, Any]:
    """Reset lai toan bo tien do Game."""
    return StandardsGameService.reset_game()
