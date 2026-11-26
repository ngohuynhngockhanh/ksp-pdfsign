"""Ephemeral 7-day CI Visual Preview publisher & auto-purge endpoints (/api/ci-preview/*)."""
from __future__ import annotations

import hmac
import logging
import re
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit, drive, service_keys, storage_drive, telegram
from .auth import CurrentUser, authenticate_loopback_bearer, require_user
from .config import Settings, get_settings
from .db import FolderItem, FolderShare, ServiceApiKey, get_session

logger = logging.getLogger("ksp.ci_preview")

router = APIRouter(tags=["ci-preview"])

MAX_CI_FILES_PER_RUN = 60
DEFAULT_CI_TTL_DAYS = 7
MAX_CI_TTL_DAYS = 14
_SWEEP_INTERVAL_SECONDS = 3600

_SAFE_META_RE = re.compile(r"[^A-Za-z0-9._:/-]+")
_sweeper_lock = threading.Lock()
_sweeper_started = False


def _sanitize_tag(raw: str, default: str, max_len: int) -> str:
    cleaned = _SAFE_META_RE.sub("-", (raw or "").strip()).strip("-.")
    return (cleaned or default)[:max_len]


def _normalize_verdict(raw: str) -> str:
    v = (raw or "").strip().upper()
    return "FAIL" if v in {"FAIL", "FAILED", "ERROR"} else "PASS"


def _section_and_sort_base(ext: str) -> tuple[str, int]:
    e = (ext or "").lower()
    if e in {".md", ".pdf"}:
        return "Báo cáo", 10
    if e in storage_drive.VIDEO_EXTS:
        return "Video E2E", 100
    if e in storage_drive.IMAGE_EXTS:
        return "Ảnh chụp", 200
    return "Tệp đính kèm", 300


def require_ci_publish_access(
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
) -> CurrentUser:
    """Allow scoped `ci:publish` Service API Key, loopback service token, or Admin user."""
    ip = request.client.host if request.client else ""
    svc = service_keys.authenticate_service_key(request, db, "ci:publish")
    if svc is not None:
        return CurrentUser(
            id=0,
            username=f"svc:{svc.name}#{svc.id}",
            role="service",
            customer_id=None,
            training_access=False,
            ip=ip,
        )

    raw_svc = service_keys.extract_service_key(request)
    if raw_svc:
        digest = service_keys.hash_service_key(raw_svc)
        existing_row = db.scalar(
            select(ServiceApiKey).where(
                ServiceApiKey.key_hash == digest,
                ServiceApiKey.is_active.is_(True),
                ServiceApiKey.revoked_at.is_(None),
            )
        )
        if existing_row is not None and hmac.compare_digest(existing_row.key_hash, digest):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Service key không có quyền ci:publish",
            )
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Service key không hợp lệ hoặc đã bị thu hồi",
        )

    lb_user = authenticate_loopback_bearer(request, db)
    if lb_user is not None:
        return lb_user

    user = require_user(request=request, settings=settings, db=db)
    if not user.is_admin:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Chỉ admin mới có quyền xuất bản bản xem trước CI",
        )
    return user


@router.post("/api/ci-preview/purge")
def ci_preview_purge(
    request: Request,
    user: CurrentUser = Depends(require_ci_publish_access),
    db: Session = Depends(get_session),
):
    """Purge all expired temporary folders whose auto_delete_at has passed."""
    result = drive.purge_expired_ephemeral_folders(db)
    try:
        audit.record(
            db,
            user.username,
            user.role,
            user.ip,
            "ci_preview_purge",
            "CI Previews",
            f"folders={result['folders_deleted']} items={result['items_deleted']} assets_gc={result['assets_gc']}",
        )
    except Exception:
        pass
    return {"ok": True, **result}


@router.post("/api/ci-preview/publish")
async def ci_preview_publish(
    request: Request,
    repo: str = Form(default="inut-p2p"),
    commit: str = Form(default="dev"),
    branch: str = Form(default="main"),
    verdict: str = Form(default="PASS"),
    summary: str = Form(default=""),
    ttl_days: int = Form(default=DEFAULT_CI_TTL_DAYS),
    notify_telegram: bool = Form(default=True),
    files: list[UploadFile] | None = File(default=None),
    file: UploadFile | None = File(default=None),
    user: CurrentUser = Depends(require_ci_publish_access),
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
):
    """Upload CI visual artifacts into a 7-day auto-purging Drive folder & return `/d/{token}`."""
    raw_uploads: list[UploadFile] = []
    if files:
        raw_uploads.extend(files)
    if file is not None:
        raw_uploads.append(file)
    if not raw_uploads:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Chưa đính kèm tệp xem trước nào")
    if len(raw_uploads) > MAX_CI_FILES_PER_RUN:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Tối đa {MAX_CI_FILES_PER_RUN} tệp mỗi lần xuất bản CI",
        )

    accepted_uploads: list[tuple[UploadFile, str, str]] = []
    for up in raw_uploads:
        orig_name = Path((up.filename or "").replace("\\", "/")).name.strip()
        if not orig_name:
            continue
        ext = Path(orig_name).suffix.lower()
        if ext in storage_drive.BLOCKED_EXTS or ext not in storage_drive.ALLOWED_EXTS:
            continue
        accepted_uploads.append((up, orig_name, ext))

    if not accepted_uploads:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Không có tệp hợp lệ (chỉ hỗ trợ .mp4, .png, .jpg, .webp, .md, .pdf, .zip)",
        )

    clean_repo = _sanitize_tag(repo, "repo", 80)
    clean_commit = _sanitize_tag(commit, "dev", 40)
    clean_branch = _sanitize_tag(branch, "main", 80)
    clean_verdict = _normalize_verdict(verdict)
    clean_summary = (summary or "").strip()[:1000]
    eff_ttl = max(1, min(int(ttl_days or DEFAULT_CI_TTL_DAYS), MAX_CI_TTL_DAYS))

    purged = drive.purge_expired_ephemeral_folders(db)
    root_folder = drive.get_or_create_ci_preview_root(db)

    now_utc = drive.utc_now().replace(tzinfo=None)
    expires_at = now_utc + timedelta(days=eff_ttl)
    vn_tz = timezone(timedelta(hours=7))
    vn_now = datetime.now(vn_tz)
    vn_exp = (drive._as_utc(expires_at) or datetime.now(timezone.utc)).astimezone(vn_tz)

    created_by_uid = user.id if user.id and user.id > 0 else None
    folder_name = f"[{clean_verdict}] {clean_repo} · {clean_commit} ({vn_now.strftime('%d/%m %H:%M')})"
    desc_parts = [p for p in (clean_summary, f"Tự động xóa sau {eff_ttl} ngày ({vn_exp.strftime('%d/%m/%Y %H:%M')} UTC+7).") if p]
    folder = drive.create_folder_with_optional_preset(
        db,
        name=folder_name[:255],
        parent_id=root_folder.id,
        project_code=f"ci:{clean_repo}"[:80],
        description="\n".join(desc_parts),
        created_by=created_by_uid,
    )
    folder.auto_delete_at = expires_at
    db.commit()
    db.refresh(folder)

    saved_assets: list[storage_drive.StoredDriveFile] = []
    created_items: list[FolderItem] = []
    report_item: FolderItem | None = None
    total_bytes = 0
    mp4_count = 0
    img_count = 0
    report_count = 0
    sort_offsets: dict[int, int] = {}

    try:
        for up, orig_name, ext in accepted_uploads:
            stored = await storage_drive.stream_upload_to_drive(up, filename=orig_name)
            saved_assets.append(stored)
            total_bytes += int(stored.file_size or 0)
            if stored.file_ext in storage_drive.VIDEO_EXTS:
                mp4_count += 1
            elif stored.file_ext in storage_drive.IMAGE_EXTS:
                img_count += 1
            elif stored.file_ext in {".md", ".pdf"}:
                report_count += 1

            section_tag, base_sort = _section_and_sort_base(stored.file_ext)
            offset = sort_offsets.get(base_sort, 0)
            sort_offsets[base_sort] = offset + 1

            is_report_md = stored.file_ext == ".md"
            item = FolderItem(
                folder_id=folder.id,
                item_kind="asset",
                document_id=None,
                storage_doc_id=stored.storage_doc_id,
                thumb_doc_id=stored.thumb_doc_id,
                display_name=orig_name[:255],
                original_filename=orig_name[:255],
                section_tag=section_tag,
                mime_type=stored.mime_type,
                file_ext=stored.file_ext,
                file_size=stored.file_size,
                sha256=stored.sha256,
                media_meta_json=drive.dump_json_dict(stored.media_meta),
                note="",
                sort_order=base_sort + offset,
                is_pinned=(is_report_md and orig_name.upper().startswith("REPORT")),
                created_by=created_by_uid,
            )
            db.add(item)
            created_items.append(item)
            if is_report_md and (report_item is None or item.is_pinned):
                report_item = item

        share = FolderShare(
            folder_id=folder.id,
            token=drive.generate_share_token(),
            label=f"CI {clean_repo} {clean_commit}"[:150],
            passcode_hash="",
            permission="view_download",
            allow_zip_download=True,
            allow_neac_verify=False,
            include_subfolders=False,
            notify_telegram=False,
            expires_at=expires_at,
            max_views=None,
            view_count=0,
            revoked=False,
            created_by=created_by_uid,
        )
        db.add(share)
        db.commit()
        db.refresh(share)
    except Exception:
        db.rollback()
        for asset in saved_assets:
            storage_drive.delete_asset_file(asset.storage_doc_id)
            if asset.thumb_doc_id:
                storage_drive.delete_thumb_file(asset.thumb_doc_id)
        try:
            stale = db.get(type(folder), folder.id)
            if stale is not None:
                drive.delete_folder_cascade(db, stale)
        except Exception:
            db.rollback()
        raise

    short_path = f"/d/{share.token}"
    base_pub = settings.public_base_url.rstrip("/")
    share_url = f"{base_pub}{short_path}"
    report_path = f"{short_path}/report" if report_item is not None else ""
    report_url = f"{base_pub}{report_path}" if report_path else ""

    telegram_sent = 0
    telegram_error = ""
    if notify_telegram and telegram.is_configured(settings):
        try:
            chats = telegram.admin_chat_ids(db)
            if chats:
                icon = "✅" if clean_verdict == "PASS" else "❌"
                lines = [
                    f"{icon} CI Visual {clean_verdict} — {clean_repo} ({clean_commit})",
                    f"Nhánh: {clean_branch} · {mp4_count} video · {img_count} ảnh · {report_count} báo cáo",
                ]
                if clean_summary:
                    lines.append(clean_summary)
                if report_url:
                    lines.extend(
                        [
                            f"📄 Báo cáo tổng hợp (Video TTS + Ảnh): {report_url}",
                            f"📁 Thư mục toàn bộ tệp (.zip): {share_url}",
                        ]
                    )
                else:
                    lines.append(f"🔗 Xem duyệt online: {share_url}")
                lines.append(f"⏳ Tự xóa sau {eff_ttl} ngày ({vn_exp.strftime('%d/%m/%Y %H:%M')})")
                msg_text = "\n".join(lines)
                tg_client = telegram.TelegramClient(settings)
                try:
                    for cid in chats:
                        try:
                            tg_client.send_message(cid, msg_text, speak_tts=False)
                            telegram_sent += 1
                        except Exception as exc:  # noqa: BLE001
                            telegram_error = str(exc)
                finally:
                    tg_client.close()
        except Exception as exc:  # noqa: BLE001
            telegram_error = str(exc)
            logger.warning("Failed sending CI preview Telegram alert: %s", exc)

    try:
        audit.record(
            db,
            user.username,
            user.role,
            user.ip,
            "ci_preview_publish",
            f"{clean_repo}@{clean_commit}",
            f"verdict={clean_verdict} files={len(created_items)} ttl={eff_ttl}d token={share.token[:8]}...",
        )
    except Exception:
        pass

    return {
        "ok": True,
        "share_url": share_url,
        "short_path": short_path,
        "report_url": report_url,
        "report_path": report_path,
        "token": share.token,
        "folder_id": folder.id,
        "expires_at": drive.iso_or_none(expires_at),
        "auto_delete_at": drive.iso_or_none(expires_at),
        "files_uploaded": len(created_items),
        "mp4_count": mp4_count,
        "image_count": img_count,
        "report_count": report_count,
        "total_bytes": total_bytes,
        "purged": purged,
        "telegram_sent": telegram_sent,
        "telegram_error": telegram_error,
    }


def _sweeper_loop() -> None:
    while True:
        threading.Event().wait(_SWEEP_INTERVAL_SECONDS)
        try:
            gen = get_session()
            db = next(gen)
            try:
                res = drive.purge_expired_ephemeral_folders(db)
                if res["folders_deleted"] > 0:
                    logger.info(
                        "[ci_preview] Purged %d expired ephemeral folder(s) (%d item(s), %d asset(s) GC)",
                        res["folders_deleted"],
                        res["items_deleted"],
                        res["assets_gc"],
                    )
            finally:
                gen.close()
        except Exception as exc:  # noqa: BLE001
            logger.warning("[ci_preview] Sweeper loop error: %s", exc)


def start_ci_preview_sweeper(settings: Settings | None = None) -> None:
    """Start daemon sweeper thread once to clean up expired CI preview folders hourly."""
    global _sweeper_started
    _ = settings
    with _sweeper_lock:
        if _sweeper_started:
            return
        _sweeper_started = True
        t = threading.Thread(target=_sweeper_loop, name="ci-preview-sweeper", daemon=True)
        t.start()
