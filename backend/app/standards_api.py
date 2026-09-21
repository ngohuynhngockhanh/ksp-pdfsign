"""FastAPI router cho Phan he Tra cuu Hop Chuan, Hop Quy (QCVN/TCVN) va HS Code."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import threading
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
from .db import JobRun, TqcCertificate, get_session

router = APIRouter(prefix="/api/standards", tags=["standards"])
_TQC_IMPORT_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="tqc-csv-import")
_TQC_IMPORT_LOCK = threading.Lock()
_TQC_IMPORT_ACTIVE: set[int] = set()


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


@router.get("/lookup/model")
def lookup_standards_by_model(
    query: str = Query("", max_length=150, description="Tên thiết bị, model hoặc từ khóa kỹ thuật"),
    q: str = Query("", max_length=150, description="Alias cho query"),
    model: str = Query("", max_length=150, description="Alias cho model"),
    model_code: str = Query("", max_length=150, description="Alias cho model_code"),
    hs_code: str = Query("", max_length=150, description="Mã HS Code Hải quan"),
    ministry: str = Query("", max_length=150, description="Bộ quản lý chuyên ngành: BTTTT, BKHCN, BTNMT, BCT, BGTVT"),
    mandatory_only: bool = Query(False, description="Chỉ lấy quy chuẩn bắt buộc"),
    fuzzy: bool = Query(True, description="Bật tìm kiếm mờ (Fuzzy matching)"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    """Direction 1: Tra cứu quy chuẩn kỹ thuật QCVN/TCVN áp dụng theo Model thiết bị hoặc HS Code."""
    effective_query = query or q or model or model_code
    return standards.TwoWayLookupService.lookup_by_model(
        query=effective_query,
        hs_code=hs_code,
        ministry=ministry,
        mandatory_only=mandatory_only,
        fuzzy=fuzzy,
        limit=limit,
        offset=offset,
        db=db,
    )


@router.get("/lookup/tax-code")
def lookup_standards_by_tax_code(
    tax_code: str = Query("", max_length=150, description="Mã số thuế doanh nghiệp (MST)"),
    mst: str = Query("", max_length=150, description="Alias cho tax_code"),
    company_name: str = Query("", max_length=150, description="Tên công ty hoặc từ khóa tìm kiếm"),
    company: str = Query("", max_length=150, description="Alias cho company_name"),
    status: str = Query("", max_length=150, description="Lọc theo trạng thái hiệu lực hồ sơ: active, expired, all"),
    ministry: str = Query("", max_length=150, description="Lọc theo Bộ quản lý chuyên ngành"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    """Direction 2: Tra cứu hồ sơ chứng nhận/công bố hợp quy và danh mục QCVN theo MST hoặc Tên doanh nghiệp."""
    effective_tax = tax_code or mst
    effective_company = company_name or company
    return standards.TwoWayLookupService.lookup_by_tax_code(
        tax_code=effective_tax,
        company_name=effective_company,
        status=status,
        ministry=ministry,
        limit=limit,
        offset=offset,
        db=db,
    )


@router.get("/lookup/enterprise/{tax_code}")
def lookup_standards_by_enterprise_tax_code(
    tax_code: str,
    status: str = Query("", max_length=150, description="Lọc theo trạng thái hồ sơ"),
    ministry: str = Query("", max_length=150, description="Lọc theo Bộ quản lý"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    """Tra cứu hồ sơ hợp quy và danh mục tiêu chuẩn của một doanh nghiệp cụ thể theo MST."""
    return standards.TwoWayLookupService.lookup_by_tax_code(
        tax_code=tax_code,
        company_name="",
        status=status,
        ministry=ministry,
        limit=limit,
        offset=offset,
        db=db,
    )


@router.get("/suggest")
def suggest_standards(
    q: str = Query("", max_length=150, description="Từ khóa gợi ý tìm kiếm"),
    type: str = Query("all", max_length=150, description="Loại gợi ý: all, model, tax_code, company, qcvn, hs_code"),
    limit: int = Query(10, ge=1, le=50),
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    """Gợi ý thông minh (Auto-complete) cho Models, MST, Doanh nghiệp, QCVN và HS Code."""
    return standards.TwoWayLookupService.suggest(
        q=q,
        type=type,
        limit=limit,
        db=db,
    )


@router.get("/rules")
def get_inference_rules(
    user: CurrentUser = Depends(require_user),
) -> dict[str, Any]:
    """Danh mục toàn bộ các luật suy luận quy chuẩn kỹ thuật (Rule-based inference engine)."""
    rules = standards.RuleInferenceEngine.get_all_rules()
    return {
        "total_rules": len(rules),
        "rules": rules,
    }


def _tqc_http_error(exc: tqc_cnhq.TqcCnhqError) -> HTTPException:
    code = exc.code
    http_status = exc.status if 400 <= exc.status <= 599 else status.HTTP_502_BAD_GATEWAY
    return HTTPException(
        status_code=http_status,
        detail={"code": code, "message": str(exc)},
    )


def _cached_certificate(row: TqcCertificate) -> dict[str, Any]:
    return tqc_cnhq.certificate_to_dict(row, verification_status="verified_cached")


def _empty_tqc_import_result(requested: int) -> dict[str, Any]:
    return {
        "requested": requested,
        "processed": 0,
        "verified": 0,
        "cached": 0,
        "not_found": 0,
        "errors": [],
        "items": [],
    }


def _merge_tqc_import_result(current: dict[str, Any], batch: dict[str, Any], index: int) -> dict[str, Any]:
    errors = [*current.get("errors", [])]
    errors.extend({**error, "index": index} for error in batch.get("errors", []))
    return {
        "requested": current["requested"],
        "processed": int(current.get("processed", 0)) + int(batch.get("processed", 0)),
        "verified": int(current.get("verified", 0)) + int(batch.get("verified", 0)),
        "cached": int(current.get("cached", 0)) + int(batch.get("cached", 0)),
        "not_found": int(current.get("not_found", 0)) + int(batch.get("not_found", 0)),
        "errors": errors,
        "items": [*current.get("items", []), *batch.get("items", [])],
    }


def _run_tqc_csv_import(job_id: int) -> None:
    session_gen = get_session()
    db = next(session_gen)
    client = None
    try:
        job = db.get(JobRun, job_id)
        if job is None:
            return
        state = json.loads(job.stats or "{}")
        payload = state.get("payload") or {}
        entries = payload.get("entries") or []
        refresh_existing = bool(payload.get("refresh_existing"))
        requested = len(entries)
        cursor = min(requested, max(0, int(state.get("cursor", 0))))
        result = state.get("result") or _empty_tqc_import_result(requested)
        if not entries:
            raise tqc_cnhq.TqcCnhqError("Job import TQC thiếu payload", code="missing_job_payload")
        client = tqc_cnhq.get_client(get_settings(), wait_on_rate_limit=True)
        step_interval = max(1, requested // 50)
        for index in range(cursor, requested):
            batch = tqc_cnhq.import_entries(
                db,
                [entries[index]],
                client=client,
                refresh_existing=refresh_existing,
                max_entries=1,
                commit=False,
            )
            result = _merge_tqc_import_result(result, batch, index)
            cursor = index + 1
            if cursor == requested or cursor % step_interval == 0 or cursor == 1:
                job = db.get(JobRun, job_id)
                if job is None:
                    return
                job.stats = json.dumps({
                    "phase": "running",
                    "progress": 5 + round(cursor / requested * 90),
                    "requested": requested,
                    "payload": payload,
                    "cursor": cursor,
                    "result": result,
                }, ensure_ascii=False)
                db.commit()
        job = db.get(JobRun, job_id)
        if job is None:
            return
        job.status = "success"
        job.stats = json.dumps({"phase": "done", "progress": 100, "result": result}, ensure_ascii=False)
        job.finished_at = datetime.now(timezone.utc)
        db.commit()
    except Exception as exc:  # Background boundary must leave a queryable safe failure.
        db.rollback()
        job = db.get(JobRun, job_id)
        if job is not None:
            job.status = "failed"
            job.error = str(exc)[:1000] if isinstance(exc, tqc_cnhq.TqcCnhqError) else "Import TQC nền thất bại"
            job.finished_at = datetime.now(timezone.utc)
            db.commit()
    finally:
        if client is not None:
            client.close()
        session_gen.close()
        with _TQC_IMPORT_LOCK:
            _TQC_IMPORT_ACTIVE.discard(job_id)


def _submit_tqc_import_job(job_id: int) -> bool:
    with _TQC_IMPORT_LOCK:
        if job_id in _TQC_IMPORT_ACTIVE:
            return False
        _TQC_IMPORT_ACTIVE.add(job_id)
    try:
        _TQC_IMPORT_EXECUTOR.submit(_run_tqc_csv_import, job_id)
    except RuntimeError:
        with _TQC_IMPORT_LOCK:
            _TQC_IMPORT_ACTIVE.discard(job_id)
        raise
    return True


def resume_tqc_import_jobs() -> int:
    """Resume durable CSV imports left running by a process restart."""
    session_gen = get_session()
    db = next(session_gen)
    try:
        job_ids = list(db.scalars(
            select(JobRun.id)
            .where(JobRun.kind == "tqc_csv_import", JobRun.status == "running")
            .order_by(JobRun.id.asc())
        ))
    finally:
        session_gen.close()
    return sum(1 for job_id in job_ids if _submit_tqc_import_job(job_id))


def _tqc_job_payload(job: JobRun) -> dict[str, Any]:
    stats_payload = json.loads(job.stats or "{}")
    return {
        "job_id": job.id,
        "status": job.status,
        "phase": stats_payload.get("phase", ""),
        "progress": int(stats_payload.get("progress", 0)),
        "requested": int(stats_payload.get("requested", 0)),
        "result": stats_payload.get("result") if job.status == "success" else None,
        "error": job.error,
        "started_at": job.started_at.isoformat(),
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
    }


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
    if not any((q.strip(), model.strip(), manufacturer.strip(), applicant.strip(), certificate_no.strip(), certificate_status.strip(), valid_on.strip())):
        raise HTTPException(status_code=422, detail="Cần ít nhất một điều kiện tìm kiếm")
    try:
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
    except tqc_cnhq.TqcCnhqError as exc:
        raise _tqc_http_error(exc) from exc
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
    try:
        normalized = tqc_cnhq.normalize_certificate_no(certificate_no)
    except tqc_cnhq.TqcCnhqError as exc:
        raise _tqc_http_error(exc) from exc
    row = db.scalar(select(TqcCertificate).where(TqcCertificate.certificate_no == normalized))
    cache_age = None
    if row and row.last_verified_at:
        cache_age = (datetime.now(timezone.utc) - row.last_verified_at.replace(tzinfo=timezone.utc)).total_seconds()
    if row and not refresh and cache_age is not None and cache_age <= settings.tqc_cnhq_cache_ttl_seconds:
        certificate = _cached_certificate(row)
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


@router.post("/tqc/import/csv", status_code=status.HTTP_202_ACCEPTED)
def import_tqc_csv(
    file: UploadFile = File(...),
    refresh_existing: bool = Query(False),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    """Import a bounded CSV containing certificate numbers or TQC QR payloads."""
    content = file.file.read(5 * 1024 * 1024 + 1)
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="CSV vượt quá giới hạn 5 MB")
    try:
        entries = tqc_cnhq.parse_import_csv(content.decode("utf-8-sig"))
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=422, detail="CSV phải dùng UTF-8") from exc
    job = JobRun(
        kind="tqc_csv_import",
        status="running",
        stats=json.dumps({
            "phase": "queued",
            "progress": 1,
            "requested": len(entries),
            "payload": {"entries": entries, "refresh_existing": refresh_existing},
            "cursor": 0,
            "result": _empty_tqc_import_result(len(entries)),
        }, ensure_ascii=False),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    audit_record(
        db,
        user.username,
        user.role,
        user.ip,
        "tqc_import_queued",
        target=f"job:{job.id}",
        detail=json.dumps({"requested": len(entries)}),
    )
    _submit_tqc_import_job(job.id)
    return {"job_id": job.id, "status": "running", "requested": len(entries)}


@router.get("/tqc/import/jobs/latest")
def get_latest_tqc_import_job(
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    job = db.scalar(
        select(JobRun)
        .where(JobRun.kind == "tqc_csv_import")
        .order_by(JobRun.id.desc())
        .limit(1)
    )
    return {"job": _tqc_job_payload(job) if job else None}


@router.get("/tqc/import/jobs/{job_id}")
def get_tqc_import_job(
    job_id: int,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    job = db.get(JobRun, job_id)
    if job is None or job.kind != "tqc_csv_import":
        raise HTTPException(status_code=404, detail="Không tìm thấy job import TQC")
    return _tqc_job_payload(job)


@router.post("/tqc/import/jobs/{job_id}/retry", status_code=status.HTTP_202_ACCEPTED)
def retry_tqc_import_job(
    job_id: int,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    job = db.get(JobRun, job_id)
    if job is None or job.kind != "tqc_csv_import":
        raise HTTPException(status_code=404, detail="Không tìm thấy job import TQC")
    if job.status == "success":
        return _tqc_job_payload(job)
    if job.status == "running":
        raise HTTPException(status_code=409, detail="Job import TQC đang chạy")
    if job.status != "failed":
        raise HTTPException(status_code=409, detail="Trạng thái job import TQC không thể retry")
    with _TQC_IMPORT_LOCK:
        if job.id in _TQC_IMPORT_ACTIVE:
            raise HTTPException(status_code=409, detail="Worker cũ đang hoàn tất dọn dẹp; hãy retry lại")
    job.status = "running"
    job.error = ""
    job.finished_at = None
    db.commit()
    _submit_tqc_import_job(job.id)
    return _tqc_job_payload(job)


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

@router.get("/risk-classification/statistics")
def get_risk_classification_statistics(
    user: CurrentUser = Depends(require_user),
) -> dict[str, Any]:
    """Thống kê danh mục phân loại rủi ro theo Thông tư số 36/2026/TT-BKHCN."""
    return standards.BkhcnRiskClassificationService.get_statistics()


@router.get("/risk-classification/classify")
def classify_product_risk(
    hs_code: str = Query("", description="Mã HS Code"),
    q: str = Query("", description="Tên mặt hàng hoặc từ khóa"),
    user: CurrentUser = Depends(require_user),
) -> dict[str, Any]:
    """Phân loại mức độ rủi ro (CAO / TRUNG BÌNH / THẤP) theo Thông tư số 36/2026/TT-BKHCN."""
    return standards.BkhcnRiskClassificationService.classify(hs_code=hs_code, query=q)


@router.get("/risk-classification/catalog")
def get_risk_classification_catalog(
    risk_level: str = Query("", description="Lọc: CAO hoặc TRUNG_BINH"),
    group: str = Query("", description="Lọc theo nhóm sản phẩm"),
    q: str = Query("", description="Từ khóa tìm kiếm"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=300),
    user: CurrentUser = Depends(require_user),
) -> dict[str, Any]:
    """Lấy danh mục sản phẩm có mức độ rủi ro trung bình, rủi ro cao theo Thông tư 36/2026/TT-BKHCN."""
    items = standards.BkhcnRiskClassificationService.get_catalog()
    filtered = items

    if risk_level.strip():
        r_norm = risk_level.strip().upper()
        filtered = [i for i in filtered if i.get("risk_level") == r_norm or (r_norm == "CAO" and i.get("annex") == 1) or (r_norm in ("TRUNG_BINH", "TRUNGBINH") and i.get("annex") == 2)]

    if group.strip():
        g_norm = group.strip().lower()
        filtered = [i for i in filtered if g_norm in (i.get("group") or "").lower()]

    if q.strip():
        q_norm = q.strip().lower()
        filtered = [
            i for i in filtered
            if q_norm in (i.get("product_name") or "").lower()
            or q_norm in (i.get("description") or "").lower()
            or q_norm in (i.get("qcvn") or "").lower()
            or any(q_norm in h.lower() for h in i.get("hs_codes", []))
        ]

    total = len(filtered)
    start_idx = (page - 1) * limit
    paged_items = filtered[start_idx : start_idx + limit]
    total_pages = max(1, (total + limit - 1) // limit)

    return {
        "total": total,
        "page": page,
        "limit": limit,
        "total_pages": total_pages,
        "items": paged_items,
    }


@router.get("/risk-classification/pdf")
def download_risk_circular_pdf(
    user: CurrentUser = Depends(require_user),
):
    """Tải toàn văn Thông tư số 36/2026/TT-BKHCN (bản ký số chính thức của Bộ KH&CN)."""
    from fastapi.responses import FileResponse
    pdf_path = Path(__file__).resolve().parent / "assets" / "36-bkhcn.signed.pdf"
    if not pdf_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy tệp văn bản Thông tư 36/2026/TT-BKHCN trên máy chủ",
        )
    return FileResponse(
        path=str(pdf_path),
        media_type="application/pdf",
        filename="36-bkhcn.signed.pdf",
    )


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
