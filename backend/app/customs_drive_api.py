"""API dong bo va quan tri bo ho so nhap khau tu Google Drive (chi doc)."""
from __future__ import annotations

import io
import json
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from openpyxl import load_workbook
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit, classify, customs_drive, inv_import, storage
from .auth import CurrentUser, require_admin
from .config import get_settings
from .db import (InvCustomsDecl, InvCustomsDriveDocument, InvCustomsDriveFolder,
                 InvCustomsDriveSource, JobRun, get_session)

router = APIRouter(prefix="/api/inv/customs-drive", tags=["customs-drive"])


class SourceIn(BaseModel):
    year: int = Field(ge=2020, le=2100)
    folder_id: str = Field(min_length=10, max_length=255, pattern=r"^[A-Za-z0-9_-]+$")


class AssignIn(BaseModel):
    customs_id: int = Field(gt=0)


class DocumentKindIn(BaseModel):
    kind: Literal[
        "customs_declaration", "ci", "pl", "coo", "bill_of_lading",
        "tax_receipt", "payment", "contract_po", "datasheet", "arrival_notice",
        "product_photo", "other",
    ]


def _loads(value: str, default):
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return default


def _rclone_binary() -> str:
    local = Path.home() / ".local" / "bin" / "rclone"
    binary = shutil.which("rclone") or (str(local) if local.is_file() else "")
    if not binary:
        raise HTTPException(503, "Không tìm thấy rclone trên máy chủ")
    return binary


def _safe_drive_path(path: str) -> str:
    parsed = PurePosixPath(path)
    if parsed.is_absolute() or ".." in parsed.parts or not path.strip():
        raise ValueError("Đường dẫn Drive không hợp lệ")
    return parsed.as_posix()


def _rclone_list(folder_id: str) -> list[dict]:
    settings = get_settings()
    command = [_rclone_binary(), "lsjson", settings.customs_drive_remote, "--recursive",
               "--drive-root-folder-id", folder_id, "--bind", settings.customs_drive_bind]
    result = subprocess.run(command, capture_output=True, text=True, timeout=180, check=False)
    if result.returncode:
        raise RuntimeError(f"Không đọc được Drive: {result.stderr[-300:]}")
    value = json.loads(result.stdout or "[]")
    return value if isinstance(value, list) else []


def _rclone_download(folder_id: str, path: str) -> bytes:
    settings = get_settings()
    safe_path = _safe_drive_path(path)
    suffix = Path(safe_path).suffix
    with tempfile.TemporaryDirectory() as temp_dir:
        target = Path(temp_dir) / f"download{suffix}"
        command = [_rclone_binary(), "copyto", f"{settings.customs_drive_remote}{safe_path}",
                   str(target), "--drive-root-folder-id", folder_id,
                   "--bind", settings.customs_drive_bind]
        result = subprocess.run(command, capture_output=True, text=True, timeout=180, check=False)
        if result.returncode or not target.is_file():
            raise RuntimeError(f"Không tải được file Drive: {result.stderr[-300:]}")
        return target.read_bytes()


def _ocr_pil_image(image) -> str:
    try:
        import pytesseract  # type: ignore

        return pytesseract.image_to_string(image, lang="vie+eng")
    except Exception:
        pass
    try:
        import numpy as np
        from rapidocr_onnxruntime import RapidOCR  # type: ignore

        engine = RapidOCR()
        result, _ = engine(np.array(image))
        return " ".join(row[1] for row in (result or []))
    except Exception:
        return ""


def _ocr_image(content: bytes) -> str:
    from PIL import Image

    return _ocr_pil_image(Image.open(io.BytesIO(content)).convert("RGB"))


def _ocr_pdf_pages(content: bytes, max_pages: int = 3) -> str:
    import pypdfium2 as pdfium

    document = pdfium.PdfDocument(content)
    return "\n".join(
        _ocr_pil_image(document[index].render(scale=2.0).to_pil())
        for index in range(min(len(document), max_pages))
    )


def _extract_text(name: str, content: bytes, force_ocr: bool = False,
                  ocr_all_pages: bool = False) -> str:
    suffix = Path(name).suffix.lower()
    if suffix in (".txt", ".csv"):
        return content.decode("utf-8", errors="ignore")[:50_000]
    if suffix == ".pdf":
        try:
            text = inv_import._pdf_all_text(content)
        except Exception:
            text = ""
        if force_ocr or len(text.strip()) < 20:
            try:
                ocr_text = _ocr_pdf_pages(content) if ocr_all_pages else classify._ocr_first_page(content)
                if ocr_text and ocr_text not in text:
                    text = f"{text}\n{ocr_text}".strip()
            except Exception:
                pass
        return text[:50_000]
    if suffix in (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"):
        try:
            return _ocr_image(content)[:50_000]
        except Exception:
            return ""
    if suffix in (".xlsx", ".xlsm"):
        try:
            workbook = load_workbook(io.BytesIO(content), data_only=True, read_only=True)
            sheet = workbook[workbook.sheetnames[0]]
            values = []
            for row in sheet.iter_rows(min_row=1, max_row=min(sheet.max_row or 1, 100),
                                       max_col=min(sheet.max_column or 1, 30), values_only=True):
                values.extend(str(value) for value in row if value not in (None, ""))
            return " ".join(values)[:50_000]
        except Exception:
            return ""
    return ""


def _source_out(row: InvCustomsDriveSource) -> dict:
    return {"id": row.id, "year": row.year, "folder_id": row.folder_id,
            "enabled": row.enabled,
            "last_synced_at": row.last_synced_at.isoformat() if row.last_synced_at else ""}


def _folder_out(row: InvCustomsDriveFolder) -> dict:
    return {"id": row.id, "year": row.source.year, "drive_folder_id": row.drive_folder_id,
            "name": row.name, "path": row.path, "drive_url": f"https://drive.google.com/drive/folders/{row.drive_folder_id}",
            "customs_id": row.customs_id, "link_status": row.link_status,
            "dossier_status": row.dossier_status, "match_reason": row.match_reason,
            "checklist": _loads(row.checklist, {}), "findings": _loads(row.findings, []),
            "synced_at": row.synced_at.isoformat(), "documents": [
                {"id": doc.id, "name": doc.name, "path": doc.path, "kind": doc.kind,
                 "kind_manual": doc.kind_manual,
                 "mime_type": doc.mime_type, "size": doc.size, "parse_error": doc.parse_error,
                 "file_url": f"/api/inv/customs-drive/documents/{doc.id}/file" if doc.doc_id else ""}
                for doc in sorted(row.documents, key=lambda item: item.name.lower())
            ]}


def _sync_source(db: Session, source: InvCustomsDriveSource, user: CurrentUser) -> dict:
    entries = _rclone_list(source.folder_id)
    top_dirs = [item for item in entries if item.get("IsDir") and "/" not in str(item.get("Path", "")).strip("/")]
    directories = []
    for d in top_dirs:
        p = str(d.get("Path", "")).strip("/")
        sub_dirs = [item for item in entries if item.get("IsDir") and str(item.get("Path", "")).startswith(p + "/") and str(item.get("Path", "")).strip("/").count("/") == 1]
        order_sub_dirs = [sd for sd in sub_dirs if not any(skip in str(sd.get("Path", "")).lower() for skip in ("chứng nhận", "bộ chứng từ", "hình ảnh", "gửi các bên", "pcb"))]
        if order_sub_dirs and ("mua cho" in p.lower() or "khach hang" in p.lower() or "khách hàng" in p.lower() or "công ty" in p.lower()):
            directories.extend(order_sub_dirs)
        else:
            directories.append(d)
    files = [item for item in entries if not item.get("IsDir")]
    imported = linked = waiting = 0
    for directory in directories:
        folder_path = _safe_drive_path(str(directory.get("Path") or directory.get("Name") or ""))
        drive_folder_id = str(directory.get("ID") or folder_path)
        folder = db.scalar(select(InvCustomsDriveFolder).where(
            InvCustomsDriveFolder.source_id == source.id,
            InvCustomsDriveFolder.drive_folder_id == drive_folder_id))
        if not folder:
            folder = InvCustomsDriveFolder(source_id=source.id, drive_folder_id=drive_folder_id)
            db.add(folder); db.flush()
        folder.name = str(directory.get("Name") or Path(folder_path).name)
        folder.path = folder_path
        folder.synced_at = datetime.now(timezone.utc)

        file_entries = [item for item in files if str(item.get("Path", "")).startswith(folder_path + "/")]
        dossier_files = []
        declaration_numbers = customs_drive.extract_declaration_numbers(folder_path)
        declaration_file_numbers: set[str] = set()
        declaration_content: tuple[str, bytes] | None = None
        for item in file_entries:
            path = _safe_drive_path(str(item.get("Path") or ""))
            file_id = str(item.get("ID") or path)
            document = db.scalar(select(InvCustomsDriveDocument).where(
                InvCustomsDriveDocument.folder_id == folder.id,
                InvCustomsDriveDocument.drive_file_id == file_id))
            if not document:
                document = InvCustomsDriveDocument(folder_id=folder.id, drive_file_id=file_id)
                db.add(document)
            document.name = str(item.get("Name") or Path(path).name)
            document.path = path
            document.mime_type = str(item.get("MimeType") or "")
            document.size = int(item.get("Size") or 0)
            document.modified_time = str(item.get("ModTime") or "")
            document.synced_at = datetime.now(timezone.utc)
            if document.size < 0:
                document.parse_error = "File Google native chưa hỗ trợ tải bản sao; vẫn giữ liên kết Drive."
                if not document.kind_manual:
                    document.kind = customs_drive.classify_customs_document(document.name, "")
                dossier_files.append({"kind": document.kind, "text": ""})
                continue
            suffix = Path(document.name).suffix.lower() or ".bin"
            if suffix in (".zip", ".rar", ".7z", ".tar", ".gz") and document.size > 5_000_000:
                document.parse_error = "File nén dung lượng lớn; bỏ qua tải bản sao."
                if not document.kind_manual:
                    document.kind = "other"
                dossier_files.append({"kind": document.kind, "text": ""})
                continue
            try:
                content = None
                if document.doc_id:
                    try:
                        content = storage.read_doc(document.doc_id, document.doc_suffix)
                    except Exception:
                        content = None
                if content is None:
                    content = _rclone_download(source.folder_id, path)
                    document.doc_id = storage.save_upload(content, suffix=suffix)
                    document.doc_suffix = suffix
                if not document.extracted_text:
                    document.extracted_text = _extract_text(document.name, content)
                if not document.kind_manual:
                    document.kind = customs_drive.classify_customs_document(document.name, document.extracted_text)
                document.parse_error = ""
                declaration_numbers |= customs_drive.extract_declaration_numbers(document.name + " " + document.extracted_text)
                if document.kind == "customs_declaration":
                    numbers_in_name = customs_drive.extract_declaration_numbers(document.name)
                    declaration_file_numbers |= numbers_in_name or customs_drive.extract_declaration_numbers(
                        document.extracted_text)
                    declaration_content = (document.name, content)
            except Exception as exc:
                document.parse_error = f"Không đọc được file: {type(exc).__name__}"
                if not document.kind_manual:
                    document.kind = customs_drive.classify_customs_document(document.name, "")
            dossier_files.append({"kind": document.kind, "text": document.extracted_text})

        customs_row = None
        match_numbers = declaration_file_numbers or declaration_numbers
        if len(match_numbers) == 1:
            number = next(iter(match_numbers))
            customs_row = db.scalar(select(InvCustomsDecl).where(InvCustomsDecl.so_to_khai == number))
        if not customs_row and declaration_content:
            from .inv_api import _import_one_customs_file
            result = _import_one_customs_file(db, user, declaration_content[0], declaration_content[1])
            if result.get("ok"):
                customs_row = db.get(InvCustomsDecl, result["customs_id"]); imported += 1
            elif len(match_numbers) == 1:
                customs_row = db.scalar(select(InvCustomsDecl).where(
                    InvCustomsDecl.so_to_khai == next(iter(match_numbers))))
        if customs_row:
            folder.customs_id = customs_row.id
            folder.link_status = "linked"
            folder.match_reason = "Khớp số tờ khai 12 chữ số trong folder hoặc chứng từ."
            linked += 1
        elif len(match_numbers) > 1:
            folder.customs_id = None; folder.link_status = "ambiguous"
            folder.match_reason = "Phát hiện nhiều số tờ khai; cần gán thủ công."
            waiting += 1
        else:
            folder.customs_id = None; folder.link_status = "waiting_declaration"
            folder.match_reason = "Chưa tìm thấy tờ khai hoặc số tờ khai 12 chữ số."
            waiting += 1
        review = customs_drive.review_dossier(dossier_files)
        folder.dossier_status = review["status"]
        folder.checklist = json.dumps(review["checklist"], ensure_ascii=False)
        folder.findings = json.dumps(review["findings"], ensure_ascii=False)
        db.commit()
    source.last_synced_at = datetime.now(timezone.utc); db.commit()
    audit.record(db, user.username, user.role, user.ip, "customs_drive_sync",
                 f"year:{source.year}", f"{len(directories)} folder · {linked} đã link · {waiting} chờ")
    return {"folders": len(directories), "linked": linked, "waiting": waiting, "imported": imported}


@router.get("/sources")
def list_sources(db: Session = Depends(get_session), _: CurrentUser = Depends(require_admin)):
    return [_source_out(row) for row in db.scalars(select(InvCustomsDriveSource).order_by(InvCustomsDriveSource.year.desc()))]


@router.post("/sources")
def save_source(payload: SourceIn, db: Session = Depends(get_session), _: CurrentUser = Depends(require_admin)):
    row = db.scalar(select(InvCustomsDriveSource).where(InvCustomsDriveSource.year == payload.year))
    if not row:
        row = InvCustomsDriveSource(year=payload.year, folder_id=payload.folder_id)
        db.add(row)
    else:
        row.folder_id = payload.folder_id; row.enabled = True
    db.commit(); db.refresh(row)
    return _source_out(row)


@router.post("/sync/{year}")
def sync_year(year: int, db: Session = Depends(get_session), user: CurrentUser = Depends(require_admin)):
    source = db.scalar(select(InvCustomsDriveSource).where(
        InvCustomsDriveSource.year == year, InvCustomsDriveSource.enabled.is_(True)))
    if not source:
        raise HTTPException(404, "Chưa cấu hình folder Drive cho năm này")
    job = JobRun(kind="customs_drive_sync", status="running",
                 stats=json.dumps({"year": year, "progress": 5, "message": "Đang đọc Drive"}, ensure_ascii=False))
    db.add(job); db.commit(); db.refresh(job)
    try:
        stats = _sync_source(db, source, user)
        job.status = "success"; job.finished_at = datetime.now(timezone.utc)
        job.stats = json.dumps({**stats, "year": year, "progress": 100, "message": "Đồng bộ hoàn tất"}, ensure_ascii=False)
    except Exception as exc:
        db.rollback(); job = db.get(JobRun, job.id)
        job.status = "failed"; job.error = str(exc)[:1000]; job.finished_at = datetime.now(timezone.utc)
    db.commit()
    if job.status == "failed":
        raise HTTPException(502, f"Đồng bộ Drive thất bại: {job.error}")
    return {"job_id": job.id, "status": job.status, "stats": _loads(job.stats, {})}


@router.get("/status/{job_id}")
def sync_status(job_id: int, db: Session = Depends(get_session), _: CurrentUser = Depends(require_admin)):
    job = db.get(JobRun, job_id)
    if not job or job.kind != "customs_drive_sync":
        raise HTTPException(404, "Không tìm thấy tiến trình đồng bộ")
    return {"id": job.id, "status": job.status, "stats": _loads(job.stats, {}), "error": job.error}


@router.get("/folders")
def list_folders(year: int | None = None, db: Session = Depends(get_session),
                 _: CurrentUser = Depends(require_admin)):
    stmt = select(InvCustomsDriveFolder).join(InvCustomsDriveSource)
    if year:
        stmt = stmt.where(InvCustomsDriveSource.year == year)
    return [_folder_out(row) for row in db.scalars(stmt.order_by(InvCustomsDriveFolder.path))]


@router.post("/folders/{folder_id}/assign")
def assign_folder(folder_id: int, payload: AssignIn, db: Session = Depends(get_session),
                  user: CurrentUser = Depends(require_admin)):
    folder = db.get(InvCustomsDriveFolder, folder_id)
    declaration = db.get(InvCustomsDecl, payload.customs_id)
    if not folder or not declaration:
        raise HTTPException(404, "Không tìm thấy folder hoặc tờ khai")
    folder.customs_id = declaration.id; folder.link_status = "linked"
    folder.match_reason = "Được gán thủ công bởi quản trị viên."
    db.commit(); db.refresh(folder)
    audit.record(db, user.username, user.role, user.ip, "customs_drive_assign",
                 f"folder:{folder.id}", f"Tờ khai {declaration.so_to_khai}")
    return _folder_out(folder)


@router.post("/folders/{folder_id}/review")
def review_folder(folder_id: int, db: Session = Depends(get_session),
                  _: CurrentUser = Depends(require_admin)):
    folder = db.get(InvCustomsDriveFolder, folder_id)
    if not folder:
        raise HTTPException(404, "Không tìm thấy folder hồ sơ")
    for document in folder.documents:
        if not document.doc_id:
            continue
        try:
            content = storage.read_doc(document.doc_id, document.doc_suffix or ".bin")
            document.extracted_text = _extract_text(
                document.name,
                content,
                force_ocr=document.kind in {"ci", "pl", "coo", "arrival_notice", "product_photo"},
                ocr_all_pages=document.kind == "arrival_notice",
            )
            if not document.kind_manual:
                document.kind = customs_drive.classify_customs_document(
                    document.name, document.extracted_text,
                )
            document.parse_error = ""
        except Exception as exc:
            document.parse_error = f"Không thể kiểm tra lại file: {type(exc).__name__}"
    result = customs_drive.review_dossier([
        {"kind": doc.kind, "text": doc.extracted_text} for doc in folder.documents])
    folder.dossier_status = result["status"]
    folder.checklist = json.dumps(result["checklist"], ensure_ascii=False)
    folder.findings = json.dumps(result["findings"], ensure_ascii=False)
    db.commit(); db.refresh(folder)
    return _folder_out(folder)


@router.patch("/documents/{document_id}/kind")
def set_document_kind(document_id: int, payload: DocumentKindIn,
                      db: Session = Depends(get_session),
                      user: CurrentUser = Depends(require_admin)):
    document = db.get(InvCustomsDriveDocument, document_id)
    if not document:
        raise HTTPException(404, "Không tìm thấy chứng từ")
    document.kind = payload.kind
    document.kind_manual = True
    folder = document.folder
    result = customs_drive.review_dossier([
        {"kind": doc.kind, "text": doc.extracted_text} for doc in folder.documents
    ])
    folder.dossier_status = result["status"]
    folder.checklist = json.dumps(result["checklist"], ensure_ascii=False)
    folder.findings = json.dumps(result["findings"], ensure_ascii=False)
    db.commit(); db.refresh(folder)
    audit.record(db, user.username, user.role, user.ip, "customs_drive_classify",
                 f"document:{document.id}", f"{document.name} -> {payload.kind}")
    return _folder_out(folder)


@router.get("/documents/{document_id}/file")
def document_file(document_id: int, db: Session = Depends(get_session),
                  _: CurrentUser = Depends(require_admin)):
    document = db.get(InvCustomsDriveDocument, document_id)
    if not document or not document.doc_id:
        raise HTTPException(404, "Không tìm thấy bản sao chứng từ")
    return Response(storage.read_doc(document.doc_id, document.doc_suffix or ".bin"),
                    media_type=document.mime_type or "application/octet-stream")


@router.post("/declarations/{decl_id}/fetch-barcode")
def fetch_declaration_barcode(decl_id: int,
                             customs_code: str | None = None,
                             db: Session = Depends(get_session),
                             user: CurrentUser = Depends(require_admin)):
    """Tự động tra cứu mã vạch tờ khai từ pus1.customs.gov.vn, lưu PDF và upload lên Google Drive."""
    try:
        from . import customs_barcode
        result = customs_barcode.fetch_and_sync_customs_barcode(
            db=db,
            decl_id=decl_id,
            customs_code_override=customs_code,
        )
        audit.record(db, user.username, user.role, user.ip, "customs_barcode_fetch",
                     f"decl:{decl_id}", f"Fetched barcode: {result.get('filename')}")
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/folders/{folder_id}/fetch-barcode")
def fetch_folder_barcode(folder_id: int,
                        customs_code: str | None = None,
                        db: Session = Depends(get_session),
                        user: CurrentUser = Depends(require_admin)):
    """Tự động tra cứu mã vạch cho folder hồ sơ đã liên kết tờ khai."""
    folder = db.get(InvCustomsDriveFolder, folder_id)
    if not folder:
        raise HTTPException(404, "Không tìm thấy folder")
    if not folder.customs_id:
        raise HTTPException(400, "Folder chưa được liên kết với tờ khai hải quan nào")
    try:
        from . import customs_barcode
        result = customs_barcode.fetch_and_sync_customs_barcode(
            db=db,
            decl_id=folder.customs_id,
            folder_id=folder.drive_folder_id,
            customs_code_override=customs_code,
        )
        audit.record(db, user.username, user.role, user.ip, "customs_barcode_fetch",
                     f"folder:{folder_id}", f"Fetched barcode: {result.get('filename')}")
        db.refresh(folder)
        return _folder_out(folder)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

