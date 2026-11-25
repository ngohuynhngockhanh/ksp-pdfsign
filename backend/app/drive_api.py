"""FastAPI router for Google Drive-style Folder & Share APIs (Admin + Public).

- Admin endpoints (`/api/drive/...`): require_admin
- Public endpoints (`/api/public/drive/{token}...`): no admin login required
- Redirect alias: `GET /share/folder/{token}` -> 302 `/d/{token}`
"""
from __future__ import annotations

import html
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from . import (
    audit,
    docx_preview,
    drive,
    markdown_preview,
    security_utils,
    storage_drive,
    verify,
    xlsx_preview,
)
from .auth import CurrentUser, require_admin
from .config import Settings, get_settings
from .db import (
    Customer,
    Document,
    Folder,
    FolderAccessLog,
    FolderItem,
    FolderShare,
    get_session,
)
from .security import verify_password

logger = logging.getLogger("ksp.drive.api")

router = APIRouter(tags=["drive"])


# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------
class FolderCreateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    parent_id: int | None = None
    customer_id: int | None = None
    order_id: int | None = None
    customer_name: str = ""
    project_code: str = ""
    description: str = ""
    cover_meta: dict[str, Any] | None = None
    sort_order: int = 0
    preset: str = ""  # "" | "solar_handover"


class FolderPatchIn(BaseModel):
    name: str | None = None
    parent_id: int | None = None
    move_to_root: bool = False
    customer_id: int | None = None
    clear_customer: bool = False
    order_id: int | None = None
    customer_name: str | None = None
    project_code: str | None = None
    description: str | None = None
    cover_meta: dict[str, Any] | None = None
    sort_order: int | None = None
    is_archived: bool | None = None


class AttachDocumentsIn(BaseModel):
    document_ids: list[int] = Field(default_factory=list)
    section_tag: str = ""


class ChunkedUploadInitIn(BaseModel):
    folder_id: int
    filename: str = Field(..., min_length=1, max_length=255)
    file_size: int = Field(..., gt=0)
    mime_type: str = ""
    chunk_size: int | None = None
    total_chunks: int | None = None
    section_tag: str = ""
    note: str = ""
    display_name: str = ""


class ChunkedUploadCompleteIn(BaseModel):
    sha256: str = ""
    display_name: str | None = None
    section_tag: str | None = None
    note: str | None = None


class ItemPatchIn(BaseModel):
    display_name: str | None = None
    folder_id: int | None = None
    section_tag: str | None = None
    note: str | None = None
    sort_order: int | None = None
    is_pinned: bool | None = None
    media_meta: dict[str, Any] | None = None


class FolderReorderIn(BaseModel):
    item_ids: list[int] | None = None
    subfolder_ids: list[int] | None = None


class ShareCreateIn(BaseModel):
    label: str = ""
    passcode: str = ""
    permission: str = "view_download"  # view_only | view_download
    allow_zip_download: bool = True
    allow_neac_verify: bool = True
    include_subfolders: bool = True
    notify_telegram: bool = True
    expires_days: int | None = None
    expires_at: str | None = None
    max_views: int | None = None


class SharePatchIn(BaseModel):
    label: str | None = None
    passcode: str | None = None
    clear_passcode: bool = False
    permission: str | None = None
    allow_zip_download: bool | None = None
    allow_neac_verify: bool | None = None
    include_subfolders: bool | None = None
    notify_telegram: bool | None = None
    expires_days: int | None = None
    expires_at: str | None = None
    clear_expiry: bool = False
    max_views: int | None = None
    clear_max_views: bool = False
    revoked: bool | None = None


class PublicUnlockIn(BaseModel):
    passcode: str = Field(..., min_length=1, max_length=64)


class PublicTelemetryIn(BaseModel):
    nonce: str = ""
    action: str = "folder_open"
    item_id: int | None = None
    ip: str = ""
    city: str = ""
    region: str = ""
    isp: str = ""
    country_code: str = ""
    device_type: str = ""
    fingerprint: str = ""


# ---------------------------------------------------------------------------
# Shared Helpers
# ---------------------------------------------------------------------------
def _audit(db: Session, user: CurrentUser, action: str, target: str = "", detail: str = "") -> None:
    audit.record(db, user.username, user.role, user.ip, action, target, detail)


def _inject_viewer_nonce(html_out: str, csp_nonce: str) -> str:
    if not csp_nonce or not html_out:
        return html_out
    idx = html_out.rfind("<script>")
    if idx == -1:
        return html_out
    safe_nonce = html.escape(csp_nonce, quote=True)
    return html_out[:idx] + f'<script nonce="{safe_nonce}">' + html_out[idx + len("<script>"):]


def _render_folder_detail(
    db: Session,
    folder: Folder,
    settings: Settings,
) -> dict[str, Any]:
    stats_map = drive.compute_stats_for_roots(db, {folder.root_id})
    subfolders = list(
        db.scalars(
            select(Folder)
            .where(Folder.parent_id == folder.id, Folder.is_archived.is_(False))
            .order_by(Folder.sort_order.asc(), Folder.name.asc(), Folder.id.asc())
        ).all()
    )
    items = list(
        db.scalars(
            select(FolderItem)
            .where(FolderItem.folder_id == folder.id)
            .order_by(FolderItem.is_pinned.desc(), FolderItem.sort_order.asc(), FolderItem.id.asc())
        ).all()
    )
    shares = list(
        db.scalars(
            select(FolderShare)
            .where(FolderShare.folder_id == folder.id)
            .order_by(FolderShare.revoked.asc(), FolderShare.created_at.desc(), FolderShare.id.desc())
        ).all()
    )
    return {
        "folder": drive.serialize_folder_summary(folder, stats_map.get(folder.id)),
        "breadcrumbs": drive.build_breadcrumbs(db, folder),
        "subfolders": [drive.serialize_folder_summary(sf, stats_map.get(sf.id)) for sf in subfolders],
        "items": [drive.serialize_item(it) for it in items],
        "shares": [drive.serialize_share(sh, settings) for sh in shares],
    }


def _serve_item_file_or_preview(
    request: Request,
    item: FolderItem,
    *,
    download: bool = False,
    format_param: str = "",
    download_url: str,
    pdf_url: str,
) -> Response:
    resolved = drive.resolve_item_physical_file(item)
    if not resolved:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tệp vật lý không tồn tại")
    fpath, ext, dl_name = resolved
    fmt = (format_param or "").strip().lower()
    csp_nonce = getattr(request.state, "csp_nonce", "")

    if download:
        return FileResponse(
            fpath,
            media_type=storage_drive.mime_for_ext(ext),
            headers={
                "Content-Disposition": security_utils.safe_content_disposition(
                    dl_name, disposition="attachment"
                ),
                "Accept-Ranges": "bytes",
                "X-Accel-Buffering": "no",
            },
        )

    # Office / Markdown inline preview (or PDF export) — cap in-memory read at 25 MB
    _max_preview_bytes = 25 * 1024 * 1024
    file_size = fpath.stat().st_size if fpath.is_file() else 0
    if ext == ".docx" and file_size <= _max_preview_bytes:
        raw = fpath.read_bytes()
        if docx_preview.is_valid_docx(raw):
            try:
                if fmt == "pdf":
                    pdf_bytes = docx_preview.render_docx_to_pdf_bytes(raw, title=dl_name)
                    pdf_name = Path(dl_name).stem + ".pdf"
                    return Response(
                        content=pdf_bytes,
                        media_type="application/pdf",
                        headers={
                            "Content-Disposition": security_utils.safe_content_disposition(
                                pdf_name, disposition="inline"
                            )
                        },
                    )
                html_out = docx_preview.render_docx_preview_html(
                    raw, title=dl_name, download_url=download_url, pdf_url=pdf_url
                )
                return HTMLResponse(content=_inject_viewer_nonce(html_out, csp_nonce))
            except Exception:
                logger.warning("DOCX preview fallback to file download for item %s", item.id, exc_info=True)

    if ext in {".xlsx", ".xls"} and file_size <= _max_preview_bytes:
        raw = fpath.read_bytes()
        if xlsx_preview.is_valid_xlsx(raw):
            try:
                if fmt == "pdf":
                    pdf_bytes = xlsx_preview.render_xlsx_to_pdf_bytes(raw, title=dl_name)
                    pdf_name = Path(dl_name).stem + ".pdf"
                    return Response(
                        content=pdf_bytes,
                        media_type="application/pdf",
                        headers={
                            "Content-Disposition": security_utils.safe_content_disposition(
                                pdf_name, disposition="inline"
                            )
                        },
                    )
                html_out = xlsx_preview.render_xlsx_preview_html(
                    raw, title=dl_name, download_url=download_url, pdf_url=pdf_url
                )
                return HTMLResponse(content=_inject_viewer_nonce(html_out, csp_nonce))
            except Exception:
                logger.warning("XLSX preview fallback to file download for item %s", item.id, exc_info=True)

    if ext == ".md" and file_size <= _max_preview_bytes:
        raw = fpath.read_bytes()
        if markdown_preview.is_valid_markdown(raw, dl_name):
            try:
                if fmt == "pdf":
                    pdf_bytes = markdown_preview.render_markdown_to_pdf_bytes(raw, title=dl_name)
                    pdf_name = Path(dl_name).stem + ".pdf"
                    return Response(
                        content=pdf_bytes,
                        media_type="application/pdf",
                        headers={
                            "Content-Disposition": security_utils.safe_content_disposition(
                                pdf_name, disposition="inline"
                            )
                        },
                    )
                html_out = markdown_preview.render_markdown_preview_html(
                    raw,
                    title=dl_name,
                    download_url=download_url,
                    pdf_url=pdf_url,
                    csp_nonce=csp_nonce,
                )
                return HTMLResponse(content=html_out)
            except Exception:
                logger.warning("Markdown preview fallback to file download for item %s", item.id, exc_info=True)

    # Inline media (PDF, images, MP4) via Starlette FileResponse (native HTTP Range 206 support)
    mime = storage_drive.mime_for_ext(ext)
    is_inline_safe = ext in {".pdf", ".mp4"} or ext in storage_drive.IMAGE_EXTS
    disp_mode = "inline" if is_inline_safe else "attachment"
    headers = {
        "Content-Disposition": security_utils.safe_content_disposition(
            dl_name, disposition=disp_mode
        ),
        "Accept-Ranges": "bytes",
        "X-Accel-Buffering": "no",
    }
    if ext in storage_drive.IMAGE_EXTS:
        headers["Cache-Control"] = "private, max-age=3600"
    return FileResponse(fpath, media_type=mime, headers=headers)


def _serve_item_thumb(item: FolderItem) -> FileResponse:
    if item.thumb_doc_id:
        tp = storage_drive.find_thumb_path(item.thumb_doc_id)
        if tp:
            return FileResponse(
                tp,
                media_type="image/webp",
                headers={"Cache-Control": "private, max-age=3600"},
            )
    resolved = drive.resolve_item_physical_file(item)
    if resolved:
        fpath, ext, _ = resolved
        if ext in storage_drive.IMAGE_EXTS:
            tp = storage_drive.ensure_thumbnail_for_existing_image(
                fpath, f"{item.id}:{fpath.name}"
            )
            if tp:
                return FileResponse(
                    tp,
                    media_type="image/webp",
                    headers={"Cache-Control": "private, max-age=3600"},
                )
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Không có ảnh thu nhỏ cho tệp này")


# ---------------------------------------------------------------------------
# Redirect Alias: /share/folder/{token} -> /d/{token}
# ---------------------------------------------------------------------------
@router.get("/share/folder/{token}")
def redirect_legacy_folder_share(token: str):
    return RedirectResponse(url=f"/d/{quote(token, safe='')}", status_code=302)


# ---------------------------------------------------------------------------
# ADMIN ENDPOINTS (/api/drive/...)
# ---------------------------------------------------------------------------
@router.get("/api/drive/folders")
def admin_list_folders(
    parent_id: int | None = Query(default=None),
    customer_id: int | None = Query(default=None),
    search: str = Query(default=""),
    archived: bool = Query(default=False),
    all: bool = Query(default=False),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    q = select(Folder).where(Folder.is_archived.is_(archived))
    if customer_id is not None:
        q = q.where(Folder.customer_id == customer_id)

    clean_search = (search or "").strip()
    if clean_search:
        like = f"%{clean_search}%"
        q = q.where(
            Folder.name.ilike(like)
            | Folder.customer_name.ilike(like)
            | Folder.project_code.ilike(like)
            | Folder.description.ilike(like)
        )
    elif parent_id is not None:
        q = q.where(Folder.parent_id == parent_id)
    elif not all:
        q = q.where(Folder.parent_id.is_(None))

    folders = list(
        db.scalars(
            q.order_by(Folder.sort_order.asc(), Folder.updated_at.desc(), Folder.id.desc())
        ).all()
    )

    root_ids = {f.root_id for f in folders if f.root_id}
    # Compute KPI across non-archived root folders (scoped to customer_id when filtered)
    kpi_q = select(Folder).where(Folder.parent_id.is_(None), Folder.is_archived.is_(False))
    if customer_id is not None:
        kpi_q = kpi_q.where(Folder.customer_id == customer_id)
    all_active_roots = list(db.scalars(kpi_q).all())
    kpi_root_ids = root_ids | {f.root_id for f in all_active_roots if f.root_id}
    stats_map = drive.compute_stats_for_roots(db, kpi_root_ids)

    kpi = {
        "total_folders": len(all_active_roots),
        "total_items": 0,
        "signed_pdfs": 0,
        "images": 0,
        "videos": 0,
        "total_bytes": 0,
        "active_shares": 0,
        "views_7d": 0,
    }
    for rf in all_active_roots:
        st = stats_map.get(rf.id, drive.empty_stats())
        kpi["total_items"] += st["total_items"]
        kpi["signed_pdfs"] += st["signed_pdfs"]
        kpi["images"] += st["images"]
        kpi["videos"] += st["videos"]
        kpi["total_bytes"] += st["total_bytes"]
        kpi["active_shares"] += st["active_shares"]
        kpi["views_7d"] += st["views_7d"]

    items = [drive.serialize_folder_summary(f, stats_map.get(f.id)) for f in folders]
    return {"items": items, "total": len(items), "kpi": kpi}


@router.get("/api/drive/tree")
def admin_full_tree(
    customer_id: int | None = Query(default=None),
    archived: bool = Query(default=False),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    q = select(Folder).where(Folder.parent_id.is_(None), Folder.is_archived.is_(archived))
    if customer_id is not None:
        q = q.where(Folder.customer_id == customer_id)
    roots = list(
        db.scalars(q.order_by(Folder.sort_order.asc(), Folder.name.asc(), Folder.id.asc())).all()
    )
    return {
        "items": [drive.build_folder_tree_node(db, rf, include_archived=archived) for rf in roots]
    }


@router.post("/api/drive/folders")
def admin_create_folder(
    body: FolderCreateIn,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    folder = drive.create_folder_with_optional_preset(
        db,
        name=body.name,
        parent_id=body.parent_id,
        customer_id=body.customer_id,
        order_id=body.order_id,
        customer_name=body.customer_name,
        project_code=body.project_code,
        description=body.description,
        cover_meta=body.cover_meta,
        sort_order=body.sort_order,
        preset=body.preset,
        created_by=user.id,
    )
    _audit(db, user, "drive_folder_create", folder.name, f"id={folder.id} preset={body.preset or '-'}")
    return _render_folder_detail(db, folder, settings)


@router.get("/api/drive/folders/{folder_id}")
def admin_get_folder(
    folder_id: int,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    folder = db.get(Folder, folder_id)
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy thư mục")
    return _render_folder_detail(db, folder, settings)


@router.get("/api/drive/folders/{folder_id}/tree")
def admin_get_folder_tree(
    folder_id: int,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    folder = db.get(Folder, folder_id)
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy thư mục")
    return drive.build_folder_tree_node(db, folder, include_archived=folder.is_archived)


@router.patch("/api/drive/folders/{folder_id}")
def admin_patch_folder(
    folder_id: int,
    body: FolderPatchIn,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    folder = db.get(Folder, folder_id)
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy thư mục")

    target_parent_changed = False
    new_parent_id = folder.parent_id
    new_parent: Folder | None = None

    if body.move_to_root:
        if folder.parent_id is not None:
            target_parent_changed = True
            new_parent_id = None
    elif body.parent_id is not None and body.parent_id != folder.parent_id:
        new_parent = drive.validate_folder_move(db, folder, body.parent_id)
        target_parent_changed = True
        new_parent_id = body.parent_id

    if body.name is not None:
        clean_name = body.name.strip()
        if not clean_name:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Tên thư mục không được để trống")
        folder.name = clean_name[:255]

    if target_parent_changed or body.name is not None:
        folder.slug = drive.unique_slug(
            db, folder.name, new_parent_id, exclude_folder_id=folder.id
        )

    if target_parent_changed:
        subtree = drive.get_subtree_folders(db, folder)
        folder.parent_id = new_parent_id
        new_root_id = folder.id if new_parent is None else new_parent.root_id
        for node in subtree:
            node.root_id = new_root_id

    if body.clear_customer:
        folder.customer_id = None
    elif body.customer_id is not None:
        cust = db.get(Customer, body.customer_id)
        if not cust:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy khách hàng")
        folder.customer_id = cust.id
        if body.customer_name is None and not folder.customer_name:
            folder.customer_name = cust.name

    if body.order_id is not None:
        folder.order_id = body.order_id
    if body.customer_name is not None:
        folder.customer_name = body.customer_name.strip()[:255]
    if body.project_code is not None:
        folder.project_code = body.project_code.strip()[:80]
    if body.description is not None:
        folder.description = body.description.strip()
    if body.cover_meta is not None:
        folder.cover_meta = drive.dump_json_dict(body.cover_meta)
    if body.sort_order is not None:
        folder.sort_order = int(body.sort_order)
    if body.is_archived is not None:
        folder.is_archived = bool(body.is_archived)

    folder.updated_at = drive.utc_now()
    db.commit()
    db.refresh(folder)
    _audit(db, user, "drive_folder_update", folder.name, f"id={folder.id}")
    stats_map = drive.compute_stats_for_roots(db, {folder.root_id})
    return drive.serialize_folder_summary(folder, stats_map.get(folder.id))


@router.delete("/api/drive/folders/{folder_id}")
def admin_delete_folder(
    folder_id: int,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    folder = db.get(Folder, folder_id)
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy thư mục")
    fname = folder.name
    removed_items, gc_assets = drive.delete_folder_cascade(db, folder)
    _audit(
        db,
        user,
        "drive_folder_delete",
        fname,
        f"id={folder_id} items={removed_items} gc={gc_assets}",
    )
    return {
        "ok": True,
        "deleted_folder_id": folder_id,
        "removed_items": removed_items,
        "gc_assets": gc_assets,
    }


@router.post("/api/drive/folders/{folder_id}/attach-documents")
def admin_attach_documents(
    folder_id: int,
    body: AttachDocumentsIn,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    folder = db.get(Folder, folder_id)
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy thư mục")
    attached, skipped = drive.attach_documents_to_folder(
        db,
        folder,
        body.document_ids,
        section_tag=body.section_tag,
        created_by=user.id,
    )
    folder.updated_at = drive.utc_now()
    db.commit()
    _audit(
        db,
        user,
        "drive_attach_docs",
        folder.name,
        f"attached={len(attached)} skipped={len(skipped)}",
    )
    return {
        "attached": [drive.serialize_item(it) for it in attached],
        "skipped_document_ids": skipped,
        "total_attached": len(attached),
    }


@router.post("/api/drive/folders/{folder_id}/upload")
async def admin_upload_files(
    folder_id: int,
    files: list[UploadFile] | None = File(default=None),
    file: UploadFile | None = File(default=None),
    section_tag: str = Form(default=""),
    note: str = Form(default=""),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    folder = db.get(Folder, folder_id)
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy thư mục")

    uploads: list[UploadFile] = []
    if files:
        uploads.extend(files)
    if file is not None:
        uploads.append(file)
    if not uploads:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Chưa chọn tệp tải lên")

    max_sort = (
        db.scalar(select(func.max(FolderItem.sort_order)).where(FolderItem.folder_id == folder.id))
        or 0
    )

    created_items: list[FolderItem] = []
    saved_assets: list[storage_drive.StoredDriveFile] = []
    clean_tag = (section_tag or "").strip()[:64]
    clean_note = (note or "").strip()[:1000]

    try:
        for up in uploads:
            orig_name = Path((up.filename or "file").replace("\\", "/")).name.strip()
            stored = await storage_drive.stream_upload_to_drive(up, filename=orig_name)
            saved_assets.append(stored)
            max_sort += 10
            item = FolderItem(
                folder_id=folder.id,
                item_kind="asset",
                document_id=None,
                storage_doc_id=stored.storage_doc_id,
                thumb_doc_id=stored.thumb_doc_id,
                display_name=orig_name[:255],
                original_filename=orig_name[:255],
                section_tag=clean_tag,
                mime_type=stored.mime_type,
                file_ext=stored.file_ext,
                file_size=stored.file_size,
                sha256=stored.sha256,
                media_meta_json=drive.dump_json_dict(stored.media_meta),
                note=clean_note,
                sort_order=max_sort,
                is_pinned=False,
                created_by=user.id,
            )
            db.add(item)
            created_items.append(item)

        folder.updated_at = drive.utc_now()
        db.commit()
        for it in created_items:
            db.refresh(it)
    except Exception:
        db.rollback()
        for s in saved_assets:
            storage_drive.delete_asset_file(s.storage_doc_id)
            if s.thumb_doc_id:
                storage_drive.delete_thumb_file(s.thumb_doc_id)
        raise

    _audit(db, user, "drive_upload", folder.name, f"files={len(created_items)}")
    return {
        "items": [drive.serialize_item(it) for it in created_items],
        "count": len(created_items),
    }


@router.post("/api/drive/uploads/init")
def admin_chunked_upload_init(
    body: ChunkedUploadInitIn,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    folder = db.get(Folder, body.folder_id)
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy thư mục")
    return storage_drive.init_chunked_upload(
        folder_id=folder.id,
        filename=body.filename,
        file_size=body.file_size,
        chunk_size=body.chunk_size,
        mime_type=body.mime_type,
        section_tag=body.section_tag,
        note=body.note,
        display_name=body.display_name,
        created_by=user.id,
    )


@router.put("/api/drive/uploads/{upload_id}/chunk")
async def admin_chunked_upload_chunk(
    upload_id: str,
    request: Request,
    index: int | None = Query(default=None),
    chunk_index: int | None = Query(default=None),
    user: CurrentUser = Depends(require_admin),
):
    idx = index if index is not None else chunk_index
    if idx is None:
        hdr = request.headers.get("x-chunk-index")
        if hdr is not None and hdr.isdigit():
            idx = int(hdr)
    if idx is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Thiếu tham số chỉ số phân mảnh (index)")

    ctype = (request.headers.get("content-type") or "").lower()
    if ctype.startswith("multipart/form-data"):
        form = await request.form()
        up = form.get("file") or form.get("chunk")
        if not isinstance(up, UploadFile) and not hasattr(up, "read"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Thiếu dữ liệu phân mảnh (file)")

        async def _file_iter():
            while True:
                blk = await up.read(storage_drive.CHUNK_READ_SIZE)
                if not blk:
                    break
                yield blk

        return await storage_drive.write_upload_chunk_stream(upload_id, idx, _file_iter())

    return await storage_drive.write_upload_chunk_stream(upload_id, idx, request.stream())


@router.post("/api/drive/uploads/{upload_id}/complete")
def admin_chunked_upload_complete(
    upload_id: str,
    body: ChunkedUploadCompleteIn | None = None,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    req = body or ChunkedUploadCompleteIn()
    stored, meta = storage_drive.complete_chunked_upload(
        upload_id, expected_sha256=req.sha256
    )
    folder = db.get(Folder, int(meta["folder_id"]))
    if not folder:
        storage_drive.delete_asset_file(stored.storage_doc_id)
        if stored.thumb_doc_id:
            storage_drive.delete_thumb_file(stored.thumb_doc_id)
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy thư mục đích")

    max_sort = (
        db.scalar(select(func.max(FolderItem.sort_order)).where(FolderItem.folder_id == folder.id))
        or 0
    )
    display_name = (req.display_name or meta.get("display_name") or meta["filename"]).strip()[:255]
    section_tag = (req.section_tag or meta.get("section_tag", "")).strip()[:64]
    note = (req.note or meta.get("note", "")).strip()[:1000]

    item = FolderItem(
        folder_id=folder.id,
        item_kind="asset",
        document_id=None,
        storage_doc_id=stored.storage_doc_id,
        thumb_doc_id=stored.thumb_doc_id,
        display_name=display_name,
        original_filename=meta["filename"][:255],
        section_tag=section_tag,
        mime_type=stored.mime_type,
        file_ext=stored.file_ext,
        file_size=stored.file_size,
        sha256=stored.sha256,
        media_meta_json=drive.dump_json_dict(stored.media_meta),
        note=note,
        sort_order=max_sort + 10,
        is_pinned=False,
        created_by=user.id,
    )
    try:
        db.add(item)
        folder.updated_at = drive.utc_now()
        db.commit()
        db.refresh(item)
    except Exception:
        db.rollback()
        storage_drive.delete_asset_file(stored.storage_doc_id)
        if stored.thumb_doc_id:
            storage_drive.delete_thumb_file(stored.thumb_doc_id)
        raise
    _audit(db, user, "drive_chunked_upload", display_name, f"folder={folder.id} size={stored.file_size}")
    return drive.serialize_item(item)


@router.patch("/api/drive/items/{item_id}")
def admin_patch_item(
    item_id: int,
    body: ItemPatchIn,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    item = db.get(FolderItem, item_id)
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy tệp")

    if body.folder_id is not None and body.folder_id != item.folder_id:
        dest = db.get(Folder, body.folder_id)
        if not dest:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy thư mục đích")
        if item.item_kind == "document" and item.document_id is not None:
            dup = db.scalar(
                select(FolderItem.id).where(
                    FolderItem.folder_id == dest.id,
                    FolderItem.item_kind == "document",
                    FolderItem.document_id == item.document_id,
                    FolderItem.id != item.id,
                )
            )
            if dup is not None:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    "Tài liệu này đã có trong thư mục đích",
                )
        item.folder_id = dest.id

    if body.display_name is not None:
        clean = body.display_name.strip()
        if not clean:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Tên hiển thị không được để trống")
        item.display_name = clean[:255]
    if body.section_tag is not None:
        item.section_tag = body.section_tag.strip()[:64]
    if body.note is not None:
        item.note = body.note.strip()[:1000]
    if body.sort_order is not None:
        item.sort_order = int(body.sort_order)
    if body.is_pinned is not None:
        item.is_pinned = bool(body.is_pinned)
    if body.media_meta is not None:
        merged = drive.parse_json_dict(item.media_meta_json)
        merged.update(body.media_meta)
        item.media_meta_json = drive.dump_json_dict(merged)

    item.updated_at = drive.utc_now()
    db.commit()
    db.refresh(item)
    return drive.serialize_item(item)


@router.post("/api/drive/folders/{folder_id}/reorder")
def admin_reorder_folder(
    folder_id: int,
    body: FolderReorderIn,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    folder = db.get(Folder, folder_id)
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy thư mục")

    if body.item_ids is not None:
        for idx, iid in enumerate(body.item_ids):
            it = db.get(FolderItem, int(iid))
            if it and it.folder_id == folder.id:
                it.sort_order = (idx + 1) * 10
    if body.subfolder_ids is not None:
        for idx, sfid in enumerate(body.subfolder_ids):
            sf = db.get(Folder, int(sfid))
            if sf and sf.parent_id == folder.id:
                sf.sort_order = (idx + 1) * 10

    db.commit()
    return {"ok": True}


@router.delete("/api/drive/items/{item_id}")
def admin_delete_item(
    item_id: int,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    item = db.get(FolderItem, item_id)
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy tệp")
    asset_ids = {item.storage_doc_id} if (item.item_kind == "asset" and item.storage_doc_id) else set()
    thumb_ids = {item.thumb_doc_id} if item.thumb_doc_id else set()
    name = item.display_name
    db.delete(item)
    db.commit()
    drive.gc_unreferenced_drive_assets(db, asset_ids, thumb_ids)
    _audit(db, user, "drive_item_delete", name, f"item_id={item_id}")
    return {"ok": True, "deleted_item_id": item_id}


@router.get("/api/drive/items/{item_id}/file")
def admin_get_item_file(
    item_id: int,
    request: Request,
    download: int = Query(default=0),
    format: str = Query(default=""),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    item = db.get(FolderItem, item_id)
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy tệp")
    return _serve_item_file_or_preview(
        request,
        item,
        download=bool(download),
        format_param=format,
        download_url=f"/api/drive/items/{item.id}/file?download=1",
        pdf_url=f"/api/drive/items/{item.id}/file?format=pdf",
    )


@router.get("/api/drive/items/{item_id}/thumb")
def admin_get_item_thumb(
    item_id: int,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    item = db.get(FolderItem, item_id)
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy tệp")
    return _serve_item_thumb(item)


@router.get("/api/drive/folders/{folder_id}/download.zip")
def admin_download_folder_zip(
    folder_id: int,
    include_subfolders: bool = Query(default=True),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    folder = db.get(Folder, folder_id)
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy thư mục")
    entries = drive.collect_folder_zip_entries(db, folder, include_subfolders=include_subfolders)
    tmp_zip, file_count, _total_bytes = storage_drive.build_drive_zip_file(entries)
    zip_name = f"{storage_drive.sanitize_zip_segment(folder.name, 'drive-folder')}.zip"
    _audit(db, user, "drive_zip_download", folder.name, f"files={file_count}")
    return FileResponse(
        tmp_zip,
        media_type="application/zip",
        headers={
            "Content-Disposition": security_utils.safe_content_disposition(
                zip_name, disposition="attachment"
            ),
            "X-Accel-Buffering": "no",
        },
        background=BackgroundTask(storage_drive.cleanup_temp_file, tmp_zip),
    )


# ---------------------------------------------------------------------------
# ADMIN SHARES, QR & ACCESS LOGS
# ---------------------------------------------------------------------------
@router.get("/api/drive/folders/{folder_id}/shares")
def admin_list_shares(
    folder_id: int,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    folder = db.get(Folder, folder_id)
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy thư mục")
    shares = list(
        db.scalars(
            select(FolderShare)
            .where(FolderShare.folder_id == folder.id)
            .order_by(FolderShare.revoked.asc(), FolderShare.created_at.desc(), FolderShare.id.desc())
        ).all()
    )
    return {"items": [drive.serialize_share(sh, settings) for sh in shares]}


@router.post("/api/drive/folders/{folder_id}/shares")
def admin_create_share(
    folder_id: int,
    body: ShareCreateIn,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    folder = db.get(Folder, folder_id)
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy thư mục")
    if body.permission not in {"view_only", "view_download"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Quyền chia sẻ không hợp lệ")
    if body.max_views is not None and body.max_views < 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Giới hạn lượt xem phải >= 1")

    passcode_hash = drive.validate_passcode(body.passcode)
    expires_at = drive.parse_share_expiry(
        expires_days=body.expires_days, expires_at=body.expires_at
    )

    share = FolderShare(
        folder_id=folder.id,
        token=drive.generate_share_token(),
        label=(body.label or "").strip()[:150],
        passcode_hash=passcode_hash,
        permission=body.permission,
        allow_zip_download=bool(body.allow_zip_download),
        allow_neac_verify=bool(body.allow_neac_verify),
        include_subfolders=bool(body.include_subfolders),
        notify_telegram=bool(body.notify_telegram),
        expires_at=expires_at,
        max_views=body.max_views,
        view_count=0,
        revoked=False,
        created_by=user.id,
    )
    db.add(share)
    db.commit()
    db.refresh(share)
    _audit(db, user, "drive_share_create", folder.name, f"share_id={share.id} perm={share.permission}")
    return drive.serialize_share(share, settings)


@router.patch("/api/drive/shares/{share_id}")
def admin_patch_share(
    share_id: int,
    body: SharePatchIn,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    share = db.get(FolderShare, share_id)
    if not share:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy liên kết chia sẻ")

    if body.label is not None:
        share.label = body.label.strip()[:150]
    if body.clear_passcode:
        share.passcode_hash = ""
    elif body.passcode is not None and body.passcode.strip() != "":
        share.passcode_hash = drive.validate_passcode(body.passcode)
    if body.permission is not None:
        if body.permission not in {"view_only", "view_download"}:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Quyền chia sẻ không hợp lệ")
        share.permission = body.permission
    if body.allow_zip_download is not None:
        share.allow_zip_download = bool(body.allow_zip_download)
    if body.allow_neac_verify is not None:
        share.allow_neac_verify = bool(body.allow_neac_verify)
    if body.include_subfolders is not None:
        share.include_subfolders = bool(body.include_subfolders)
    if body.notify_telegram is not None:
        share.notify_telegram = bool(body.notify_telegram)
    if body.clear_expiry:
        share.expires_at = None
    elif body.expires_at is not None or body.expires_days is not None:
        share.expires_at = drive.parse_share_expiry(
            expires_days=body.expires_days, expires_at=body.expires_at
        )
    if body.clear_max_views:
        share.max_views = None
    elif body.max_views is not None:
        if body.max_views < 1:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Giới hạn lượt xem phải >= 1")
        share.max_views = int(body.max_views)
    if body.revoked is not None:
        share.revoked = bool(body.revoked)
        share.revoked_at = drive.utc_now().replace(tzinfo=None) if share.revoked else None

    db.commit()
    db.refresh(share)
    _audit(db, user, "drive_share_update", str(share.id), f"revoked={share.revoked}")
    return drive.serialize_share(share, settings)


@router.delete("/api/drive/shares/{share_id}")
def admin_revoke_share(
    share_id: int,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    share = db.get(FolderShare, share_id)
    if not share:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy liên kết chia sẻ")
    share.revoked = True
    share.revoked_at = drive.utc_now().replace(tzinfo=None)
    db.commit()
    _audit(db, user, "drive_share_revoke", str(share.id), share.label)
    return {"ok": True, "id": share.id, "revoked": True}


@router.get("/api/drive/shares/{share_id}/qr.svg")
def admin_share_qr_svg(
    share_id: int,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    share = db.get(FolderShare, share_id)
    if not share:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy liên kết chia sẻ")
    share_url = f"{settings.public_base_url.rstrip('/')}/d/{share.token}"
    svg_bytes = drive.generate_share_qr_svg(share_url)
    return Response(
        content=svg_bytes,
        media_type="image/svg+xml",
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.get("/api/drive/folders/{folder_id}/access-logs")
def admin_folder_access_logs(
    folder_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    share_id: int | None = Query(default=None),
    action: str = Query(default=""),
    format: str = Query(default="json"),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    folder = db.get(Folder, folder_id)
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy thư mục")

    subtree_ids = [f.id for f in drive.get_subtree_folders(db, folder)]
    q = select(FolderAccessLog).where(FolderAccessLog.folder_id.in_(subtree_ids))
    if share_id is not None:
        q = q.where(FolderAccessLog.share_id == share_id)
    if action.strip():
        q = q.where(FolderAccessLog.action == action.strip())

    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    ordered = q.order_by(FolderAccessLog.created_at.desc(), FolderAccessLog.id.desc())

    if format.strip().lower() == "csv":
        logs = list(db.scalars(ordered.limit(5000)).all())
    else:
        logs = list(db.scalars(ordered.offset((page - 1) * page_size).limit(page_size)).all())

    share_ids = {row.share_id for row in logs if row.share_id is not None}
    share_labels = (
        dict(
            db.execute(
                select(FolderShare.id, FolderShare.label).where(FolderShare.id.in_(share_ids))
            ).all()
        )
        if share_ids
        else {}
    )

    serialized = [
        {
            "id": row.id,
            "folder_id": row.folder_id,
            "share_id": row.share_id,
            "share_label": share_labels.get(row.share_id, "") if row.share_id else "",
            "item_id": row.item_id,
            "action": row.action,
            "item_name": row.item_name,
            "ip": row.ip,
            "city": row.city,
            "region": row.region,
            "isp": row.isp,
            "country_code": row.country_code,
            "device_type": row.device_type,
            "notified": bool(row.notified),
            "created_at": drive.iso_or_none(row.created_at),
        }
        for row in logs
    ]

    if format.strip().lower() == "csv":
        csv_bytes = drive.export_access_logs_csv(serialized)
        csv_name = f"nhat-ky-truy-cap-{storage_drive.sanitize_zip_segment(folder.slug, 'drive')}.csv"
        return Response(
            content=csv_bytes,
            media_type="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": security_utils.safe_content_disposition(
                    csv_name, disposition="attachment"
                )
            },
        )

    return {
        "items": serialized,
        "total": int(total),
        "page": page,
        "page_size": page_size,
    }


# ---------------------------------------------------------------------------
# PUBLIC DRIVE ENDPOINTS (/api/public/drive/{token}...)
# ---------------------------------------------------------------------------
def _public_branding(settings: Settings) -> dict[str, str]:
    return {
        "company": settings.bbbg_company,
        "logo_url": "/api/logo",
    }


def _public_share_info(share: FolderShare) -> dict[str, Any]:
    return {
        "label": share.label or "",
        "permission": share.permission or "view_download",
        "allow_zip_download": bool(share.allow_zip_download and share.permission != "view_only"),
        "allow_neac_verify": bool(share.allow_neac_verify),
        "include_subfolders": bool(share.include_subfolders),
        "expires_at": drive.iso_or_none(share.expires_at),
        "max_views": share.max_views,
        "view_count": int(share.view_count or 0),
    }


def _render_public_folder_payload(
    db: Session,
    request: Request,
    share: FolderShare,
    current_folder: Folder,
    settings: Settings,
) -> dict[str, Any]:
    stats_map = drive.compute_stats_for_roots(db, {share.folder.root_id})
    subfolders: list[Folder] = []
    if share.include_subfolders:
        subfolders = list(
            db.scalars(
                select(Folder)
                .where(Folder.parent_id == current_folder.id, Folder.is_archived.is_(False))
                .order_by(Folder.sort_order.asc(), Folder.name.asc(), Folder.id.asc())
            ).all()
        )
    items = list(
        db.scalars(
            select(FolderItem)
            .where(FolderItem.folder_id == current_folder.id)
            .order_by(FolderItem.is_pinned.desc(), FolderItem.sort_order.asc(), FolderItem.id.asc())
        ).all()
    )
    allow_dl = share.permission != "view_only"
    cur_stats = stats_map.get(current_folder.id, drive.empty_stats())
    ua = request.headers.get("user-agent", "")
    nonce = drive.generate_telemetry_nonce(
        settings,
        share_token=share.token,
        folder_id=current_folder.id,
        user_agent=ua,
    )
    return {
        "locked": False,
        "has_passcode": bool(share.passcode_hash),
        "share": _public_share_info(share),
        "branding": _public_branding(settings),
        "root_folder": drive.serialize_public_folder_summary(
            share.folder, stats_map.get(share.folder.id)
        ),
        "folder": drive.serialize_public_folder_summary(current_folder, cur_stats),
        "breadcrumbs": drive.build_breadcrumbs(
            db, current_folder, stop_at_folder_id=share.folder_id
        ),
        "subfolders": [
            drive.serialize_public_folder_summary(sf, stats_map.get(sf.id))
            for sf in subfolders
        ],
        "items": [
            drive.serialize_item(
                it,
                public_token=share.token,
                allow_download=allow_dl,
                allow_neac_verify=bool(share.allow_neac_verify),
            )
            for it in items
        ],
        "stats": cur_stats,
        "telemetry_nonce": nonce,
    }


def _require_public_unlocked(
    request: Request, share: FolderShare, settings: Settings
) -> None:
    if not drive.is_share_unlocked(request, share, settings):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Thư mục yêu cầu mã truy cập để mở khóa",
        )


@router.get("/api/public/drive/{token}")
def public_get_drive_root(
    token: str,
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    share = drive.load_active_share(db, token, strict_max_views=True)
    if not drive.is_share_unlocked(request, share, settings):
        # ZERO leakage of files, subfolders, breadcrumbs or telemetry_nonce while locked!
        folder = share.folder
        return {
            "locked": True,
            "has_passcode": True,
            "folder_name": folder.name,
            "customer_name": folder.customer_name or (folder.customer.name if folder.customer else ""),
            "project_code": folder.project_code,
            "description": folder.description,
            "cover_meta": drive.parse_json_dict(folder.cover_meta),
            "label": share.label or "",
            "expires_at": drive.iso_or_none(share.expires_at),
            "branding": _public_branding(settings),
        }

    share.view_count = int(share.view_count or 0) + 1
    share.last_accessed_at = drive.utc_now().replace(tzinfo=None)
    db.commit()
    return _render_public_folder_payload(db, request, share, share.folder, settings)


@router.post("/api/public/drive/{token}/unlock")
def public_unlock_drive(
    token: str,
    body: PublicUnlockIn,
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    share = drive.load_active_share(db, token, strict_max_views=True)
    client_ip = drive.extract_client_ip(request)
    ua = request.headers.get("user-agent", "")

    if not share.passcode_hash:
        return {"ok": True, "unlocked": True}

    retry_after = drive.check_passcode_lockout(client_ip, token)
    if retry_after is not None:
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={
                "detail": "Nhập sai mã truy cập quá nhiều lần. Vui lòng thử lại sau 15 phút.",
                "retry_after_seconds": retry_after,
                "remaining_attempts": 0,
            },
            headers={"Retry-After": str(retry_after)},
        )

    if not verify_password(body.passcode, share.passcode_hash):
        remaining = drive.record_passcode_failure(client_ip, token)
        geo = drive.enrich_geo_from_cache(share.id, client_ip, ua)
        drive.record_access_log(
            db,
            settings,
            folder_id=share.folder_id,
            share=share,
            action="passcode_fail",
            ip=geo["ip"],
            rate_limit_ip=client_ip,
            city=geo["city"],
            region=geo["region"],
            isp=geo["isp"],
            country_code=geo["country_code"],
            device_type=geo["device_type"],
            user_agent=ua,
            fingerprint_hash=geo["fingerprint_hash"],
            allow_notify=True,
        )
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={
                "detail": (
                    f"Mã truy cập không đúng (còn {remaining} lần thử)"
                    if remaining > 0
                    else "Mã truy cập không đúng. Đã tạm khóa 15 phút."
                ),
                "remaining_attempts": remaining,
            },
        )

    drive.clear_passcode_failures(client_ip, token)
    geo = drive.enrich_geo_from_cache(share.id, client_ip, ua)
    drive.record_access_log(
        db,
        settings,
        folder_id=share.folder_id,
        share=share,
        action="passcode_ok",
        ip=geo["ip"],
        rate_limit_ip=client_ip,
        city=geo["city"],
        region=geo["region"],
        isp=geo["isp"],
        country_code=geo["country_code"],
        device_type=geo["device_type"],
        user_agent=ua,
        fingerprint_hash=geo["fingerprint_hash"],
        allow_notify=True,
    )
    jwt_val = drive.mint_unlock_cookie_token(share, settings)
    is_https = (
        request.url.scheme == "https"
        or (request.headers.get("x-forwarded-proto") or "").lower() == "https"
    )
    resp = JSONResponse({"ok": True, "unlocked": True})
    resp.set_cookie(
        key=drive.drive_cookie_name(share.token),
        value=jwt_val,
        httponly=True,
        samesite="lax",
        secure=is_https,
        max_age=drive.UNLOCK_COOKIE_TTL_SECONDS,
        path="/",
    )
    return resp


@router.get("/api/public/drive/{token}/folders/{sub_id}")
def public_get_subfolder(
    token: str,
    sub_id: int,
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    share = drive.load_active_share(db, token, strict_max_views=False)
    _require_public_unlocked(request, share, settings)
    target = drive.resolve_authorized_folder(db, share, sub_id)
    share.last_accessed_at = drive.utc_now().replace(tzinfo=None)
    client_ip = drive.extract_client_ip(request)
    ua = request.headers.get("user-agent", "")
    geo = drive.enrich_geo_from_cache(share.id, client_ip, ua)
    drive.record_access_log(
        db,
        settings,
        folder_id=target.id,
        share=share,
        action="subfolder_open",
        item_name=target.name,
        ip=geo["ip"],
        rate_limit_ip=client_ip,
        city=geo["city"],
        region=geo["region"],
        isp=geo["isp"],
        country_code=geo["country_code"],
        device_type=geo["device_type"],
        user_agent=ua,
        fingerprint_hash=geo["fingerprint_hash"],
        allow_notify=True,
    )
    return _render_public_folder_payload(db, request, share, target, settings)


@router.get("/api/public/drive/{token}/items/{item_id}/view")
def public_view_item(
    token: str,
    item_id: int,
    request: Request,
    format: str = Query(default=""),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    share = drive.load_active_share(db, token, strict_max_views=False)
    _require_public_unlocked(request, share, settings)
    item, _folder = drive.resolve_authorized_item(db, share, item_id)

    # Avoid spamming access log on mid-stream video Range seeks
    range_hdr = (request.headers.get("range") or "").strip().lower()
    if not range_hdr or range_hdr.startswith("bytes=0-"):
        client_ip = drive.extract_client_ip(request)
        ua = request.headers.get("user-agent", "")
        geo = drive.enrich_geo_from_cache(share.id, client_ip, ua)
        act = "video_play" if item.file_ext.lower() == ".mp4" else "item_view"
        drive.record_access_log(
            db,
            settings,
            folder_id=item.folder_id,
            share=share,
            action=act,
            item_id=item.id,
            item_name=item.display_name,
            ip=geo["ip"],
            rate_limit_ip=client_ip,
            city=geo["city"],
            region=geo["region"],
            isp=geo["isp"],
            country_code=geo["country_code"],
            device_type=geo["device_type"],
            user_agent=ua,
            fingerprint_hash=geo["fingerprint_hash"],
            allow_notify=True,
        )

    tok_q = quote(token, safe="")
    allow_dl = share.permission != "view_only"
    dl_url = f"/api/public/drive/{tok_q}/items/{item.id}/download" if allow_dl else ""
    pdf_url = f"/api/public/drive/{tok_q}/items/{item.id}/view?format=pdf"
    return _serve_item_file_or_preview(
        request,
        item,
        download=False,
        format_param=format,
        download_url=dl_url,
        pdf_url=pdf_url,
    )


@router.get("/api/public/drive/{token}/items/{item_id}/thumb")
def public_item_thumb(
    token: str,
    item_id: int,
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    share = drive.load_active_share(db, token, strict_max_views=False)
    _require_public_unlocked(request, share, settings)
    item, _folder = drive.resolve_authorized_item(db, share, item_id)
    return _serve_item_thumb(item)


@router.get("/api/public/drive/{token}/items/{item_id}/download")
def public_download_item(
    token: str,
    item_id: int,
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    share = drive.load_active_share(db, token, strict_max_views=False)
    _require_public_unlocked(request, share, settings)
    if share.permission == "view_only":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Link chia sẻ chỉ cho phép xem trực tuyến, không cho phép tải xuống",
        )
    item, _folder = drive.resolve_authorized_item(db, share, item_id)
    client_ip = drive.extract_client_ip(request)
    ua = request.headers.get("user-agent", "")
    geo = drive.enrich_geo_from_cache(share.id, client_ip, ua)
    drive.record_access_log(
        db,
        settings,
        folder_id=item.folder_id,
        share=share,
        action="item_download",
        item_id=item.id,
        item_name=item.display_name,
        ip=geo["ip"],
        rate_limit_ip=client_ip,
        city=geo["city"],
        region=geo["region"],
        isp=geo["isp"],
        country_code=geo["country_code"],
        device_type=geo["device_type"],
        user_agent=ua,
        fingerprint_hash=geo["fingerprint_hash"],
        allow_notify=True,
    )
    tok_q = quote(token, safe="")
    return _serve_item_file_or_preview(
        request,
        item,
        download=True,
        download_url=f"/api/public/drive/{tok_q}/items/{item.id}/download",
        pdf_url=f"/api/public/drive/{tok_q}/items/{item.id}/view?format=pdf",
    )


@router.get("/api/public/drive/{token}/items/{item_id}/verify-neac")
def public_verify_item_neac(
    token: str,
    item_id: int,
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    client_ip = drive.extract_client_ip(request)
    drive.check_drive_neac_rate_limit(client_ip, token)

    share = drive.load_active_share(db, token, strict_max_views=False)
    _require_public_unlocked(request, share, settings)
    if not share.allow_neac_verify:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Liên kết này không bật tính năng thẩm định chữ ký số NEAC",
        )
    item, _folder = drive.resolve_authorized_item(db, share, item_id)
    resolved = drive.resolve_item_physical_file(item)
    if not resolved:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tệp vật lý không tồn tại")
    fpath, ext, dl_name = resolved
    if ext.lower() != ".pdf":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Chỉ hỗ trợ thẩm định chữ ký số NEAC trên tệp PDF",
        )
    if fpath.stat().st_size > storage_drive.MAX_DIRECT_UPLOAD_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            "Tệp PDF vượt quá giới hạn dung lượng thẩm định NEAC (100 MB)",
        )
    pdf_bytes = fpath.read_bytes()
    if not pdf_bytes.lstrip(b"\xef\xbb\xbf").startswith(b"%PDF"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Chỉ hỗ trợ thẩm định chữ ký số NEAC trên tệp PDF",
        )

    ref_id = item.document.doc_id if item.document else (item.storage_doc_id or f"item-{item.id}")
    internal_check = verify.verify_document(settings, pdf_bytes, ref_id)
    internal_sigs = [sig.model_dump() for sig in internal_check.signatures]

    neac_res = None
    try:
        import httpx

        files = {"file": (dl_name or "document.pdf", pdf_bytes, "application/pdf")}
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Referer": "https://neac.gov.vn/vi",
            "X-Requested-With": "XMLHttpRequest",
        }
        with httpx.Client(timeout=45.0) as client:
            r = client.post(
                "https://neac.gov.vn/vi/Home/VerifyFileByNeac",
                files=files,
                headers=headers,
            )
            if r.status_code == 200:
                neac_res = r.json()
    except Exception:
        pass

    ua = request.headers.get("user-agent", "")
    geo = drive.enrich_geo_from_cache(share.id, client_ip, ua)
    drive.record_access_log(
        db,
        settings,
        folder_id=item.folder_id,
        share=share,
        action="item_neac",
        item_id=item.id,
        item_name=item.display_name,
        ip=geo["ip"],
        rate_limit_ip=client_ip,
        city=geo["city"],
        region=geo["region"],
        isp=geo["isp"],
        country_code=geo["country_code"],
        device_type=geo["device_type"],
        user_agent=ua,
        fingerprint_hash=geo["fingerprint_hash"],
        allow_notify=True,
    )

    return {
        "ok": True,
        "item_id": item.id,
        "doc_label": dl_name,
        "internal_verification": {
            "valid": bool(
                internal_sigs
                and all(
                    sig.get("valid") and sig.get("intact") and sig.get("trusted")
                    for sig in internal_sigs
                )
            ),
            "signatures": internal_sigs,
        },
        "neac_result": neac_res,
        "verified_at": datetime.now(timezone(timedelta(hours=7))).strftime("%H:%M:%S %d/%m/%Y"),
        "neac_portal_url": "https://neac.gov.vn/vi",
    }


@router.get("/api/public/drive/{token}/download.zip")
def public_download_zip(
    token: str,
    request: Request,
    subfolder_id: int | None = Query(default=None),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    share = drive.load_active_share(db, token, strict_max_views=False)
    _require_public_unlocked(request, share, settings)
    if share.permission == "view_only" or not share.allow_zip_download:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Liên kết này không cho phép tải xuống tệp nén (.zip)",
        )

    target_folder = (
        drive.resolve_authorized_folder(db, share, subfolder_id)
        if subfolder_id is not None
        else share.folder
    )
    entries = drive.collect_folder_zip_entries(
        db,
        target_folder,
        include_subfolders=bool(share.include_subfolders),
    )
    tmp_zip, file_count, _total_bytes = storage_drive.build_drive_zip_file(entries)
    zip_name = f"{storage_drive.sanitize_zip_segment(target_folder.name, 'bo-ho-so')}.zip"

    client_ip = drive.extract_client_ip(request)
    ua = request.headers.get("user-agent", "")
    geo = drive.enrich_geo_from_cache(share.id, client_ip, ua)
    drive.record_access_log(
        db,
        settings,
        folder_id=target_folder.id,
        share=share,
        action="zip_download",
        item_name=f"{zip_name} ({file_count} tệp)",
        ip=geo["ip"],
        rate_limit_ip=client_ip,
        city=geo["city"],
        region=geo["region"],
        isp=geo["isp"],
        country_code=geo["country_code"],
        device_type=geo["device_type"],
        user_agent=ua,
        fingerprint_hash=geo["fingerprint_hash"],
        allow_notify=True,
    )

    return FileResponse(
        tmp_zip,
        media_type="application/zip",
        headers={
            "Content-Disposition": security_utils.safe_content_disposition(
                zip_name, disposition="attachment"
            ),
            "X-Accel-Buffering": "no",
        },
        background=BackgroundTask(storage_drive.cleanup_temp_file, tmp_zip),
    )


@router.post("/api/public/drive/{token}/telemetry")
def public_drive_telemetry(
    token: str,
    body: PublicTelemetryIn,
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    share = drive.load_active_share(db, token, strict_max_views=False)
    _require_public_unlocked(request, share, settings)

    ua = request.headers.get("user-agent", "")
    target_folder_id = share.folder_id
    item_name = ""
    valid_item_id: int | None = None

    if body.item_id is not None:
        item, folder = drive.resolve_authorized_item(db, share, body.item_id)
        target_folder_id = folder.id
        valid_item_id = item.id
        item_name = item.display_name

    # Verify HMAC one-time nonce against either target folder or shared root folder
    nonce_ok = drive.verify_telemetry_nonce(
        settings,
        body.nonce,
        share_token=share.token,
        folder_id=target_folder_id,
        user_agent=ua,
    )
    if not nonce_ok and target_folder_id != share.folder_id:
        nonce_ok = drive.verify_telemetry_nonce(
            settings,
            body.nonce,
            share_token=share.token,
            folder_id=share.folder_id,
            user_agent=ua,
        )
    if not nonce_ok:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Mã xác thực telemetry không hợp lệ hoặc đã được sử dụng",
        )

    allowed_actions = {
        "folder_open",
        "subfolder_open",
        "item_view",
        "item_download",
        "item_neac",
        "zip_download",
        "video_play",
    }
    act = body.action if body.action in allowed_actions else "folder_open"
    server_ip = drive.extract_client_ip(request)
    raw_client_ip = (body.ip or "").strip()[:45]
    clean_city = (body.city or "").strip()[:100]
    clean_region = (body.region or "").strip()[:100]
    clean_isp = (body.isp or "").strip()[:200]
    clean_cc = (body.country_code or "").strip()[:5]
    clean_device = (body.device_type or "").strip()[:20]
    clean_fp = (body.fingerprint or "").strip()[:64]

    drive.cache_visitor_geo(
        share.id,
        server_ip,
        ua,
        ip=raw_client_ip,
        city=clean_city,
        region=clean_region,
        isp=clean_isp,
        country_code=clean_cc,
        device_type=clean_device,
        fingerprint_hash=clean_fp,
    )
    geo = drive.enrich_geo_from_cache(
        share.id,
        server_ip,
        ua,
        ip=raw_client_ip,
        city=clean_city,
        region=clean_region,
        isp=clean_isp,
        country_code=clean_cc,
        device_type=clean_device,
        fingerprint_hash=clean_fp,
    )

    drive.record_access_log(
        db,
        settings,
        folder_id=target_folder_id,
        share=share,
        action=act,
        item_id=valid_item_id,
        item_name=item_name,
        ip=geo["ip"],
        rate_limit_ip=server_ip,
        city=geo["city"],
        region=geo["region"],
        isp=geo["isp"],
        country_code=geo["country_code"],
        device_type=geo["device_type"],
        user_agent=ua,
        fingerprint_hash=geo["fingerprint_hash"],
        allow_notify=True,
    )
    next_nonce = drive.generate_telemetry_nonce(
        settings,
        share_token=share.token,
        folder_id=target_folder_id,
        user_agent=ua,
    )
    return {"ok": True, "next_nonce": next_nonce}
