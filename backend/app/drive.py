"""Business logic for Google Drive-style Folder & Share system.

Includes:
- Folder hierarchy management (max depth 5, cycle detection, root_id propagation, solar_handover preset)
- Recursive stats aggregation & tree builder
- Safe delete & orphaned asset/thumbnail GC (never deletes underlying Document rows)
- Public share lifecycle (active/revoked/expired/max_views, PBKDF2 passcode + HttpOnly JWT cookie
  bound to passcode hash digest, 5-fail/15-min brute-force lock, strict IDOR ancestor checks)
- HMAC one-time telemetry nonces, access logging, CSV export, Telegram notifications & QR SVG
"""
from __future__ import annotations

import csv
import hashlib
import hmac
import io
import json
import logging
import re
import secrets
import threading
import time
import unicodedata
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

import jwt
import qrcode
import qrcode.image.svg
from fastapi import HTTPException, Request, status
from jwt import PyJWTError
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from . import storage, storage_drive
from .config import Settings
from .db import (
    Customer,
    Document,
    Folder,
    FolderAccessLog,
    FolderItem,
    FolderShare,
    get_session,
)
from .security import hash_password, verify_password

logger = logging.getLogger("ksp.drive")

MAX_FOLDER_DEPTH = 5
MAX_SHARE_DAYS = 365
UNLOCK_COOKIE_TTL_SECONDS = 8 * 3600  # 8 hours
CI_PREVIEW_ROOT_CODE = "__CI_PREVIEWS__"
CI_PREVIEW_ROOT_NAME = "CI Previews (Tự xóa 7 ngày)"

SOLAR_HANDOVER_SECTIONS: list[tuple[str, str, int]] = [
    ("01_Hop_Dong_Va_Phap_Ly", "Hợp đồng, hóa đơn & chứng từ pháp lý", 10),
    ("02_Bao_Cao_Va_Bien_Ban_Nghiem_Thu_16_Tram", "Báo cáo & biên bản nghiệm thu 16 trạm", 20),
    ("03_Minh_Chung_16_Tram_VNPT_NMS", "Ảnh minh chứng 16 trạm trên VNPT NMS", 30),
    ("04_Video_Nghiem_Thu", "Video nghiệm thu hệ thống", 40),
    ("05_Tai_Lieu_Huong_Dan", "Tài liệu hướng dẫn vận hành", 50),
]

# Brute-force protection: 5 failures / 15 min per (IP, token)
_PASSCODE_FAIL_LIMIT = 5
_PASSCODE_WINDOW_SECONDS = 900.0
_passcode_lock = threading.Lock()
_passcode_failures: dict[str, list[float]] = {}

# NEAC verification rate limit: 5 req / 60s per (IP, token)
_NEAC_RATE_LIMIT = 5
_NEAC_RATE_WINDOW = 60.0
_neac_lock = threading.Lock()
_neac_buckets: dict[str, list[float]] = {}

# Telemetry HMAC nonce (one-time, 60s TTL)
_NONCE_TTL = 60
_nonce_lock = threading.Lock()
_used_nonces: dict[str, float] = {}
_last_nonce_cleanup = 0.0

# Telegram notification cooldown & burst cap:
# - 300s (5 min) per (IP, share_id, action, folder_id) for folder_open / subfolder_open
# - 300s (5 min) per (IP, share_id, action, item_id) for item_view / video_play
# - Download, NEAC, passcode events notify immediately (bounded by per-IP burst cap)
# - Per-IP 10-min burst cap: 25 alerts so full customer browsing reports without spam flood
_TG_COOLDOWN_SECONDS = 300.0
_TG_BURST_WINDOW = 600.0
_TG_MAX_PER_IP = 25
_TG_NOTIFY_ACTIONS = frozenset(
    {
        "folder_open",
        "subfolder_open",
        "item_view",
        "video_play",
        "item_download",
        "zip_download",
        "item_neac",
        "passcode_fail",
        "passcode_ok",
    }
)
_tg_lock = threading.Lock()
_tg_cooldown: dict[str, float] = {}
_tg_ip_counts: dict[str, list[float]] = {}
_tg_executor: ThreadPoolExecutor | None = None

# GeoIP session enrichment cache: 30-min TTL keyed by (share_id, server_ip, ua_hash_short(ua))
_GEO_CACHE_TTL_SECONDS = 1800.0
_geo_lock = threading.Lock()
_geo_cache: dict[tuple[int, str, str], tuple[float, dict[str, str]]] = {}

_SLUG_CLEAN_RE = re.compile(r"[^a-z0-9]+")


def reset_runtime_caches_for_tests() -> None:
    """Clear in-memory rate-limit/nonce/geo caches for isolated unit tests."""
    with _passcode_lock:
        _passcode_failures.clear()
    with _neac_lock:
        _neac_buckets.clear()
    with _nonce_lock:
        _used_nonces.clear()
    with _tg_lock:
        _tg_cooldown.clear()
        _tg_ip_counts.clear()
    with _geo_lock:
        _geo_cache.clear()


# ---------------------------------------------------------------------------
# Time, JSON & Slug Helpers
# ---------------------------------------------------------------------------
def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def iso_or_none(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return _as_utc(dt).isoformat()


def parse_json_dict(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def dump_json_dict(data: dict[str, Any] | None) -> str:
    if not data or not isinstance(data, dict):
        return "{}"
    return json.dumps(data, ensure_ascii=False)


def make_slug(name: str) -> str:
    text = (name or "").strip().replace("đ", "d").replace("Đ", "D")
    norm = unicodedata.normalize("NFKD", text)
    ascii_only = "".join(ch for ch in norm if not unicodedata.combining(ch)).lower()
    slug = _SLUG_CLEAN_RE.sub("-", ascii_only).strip("-")[:120]
    return slug or "thu-muc"


def unique_slug(
    db: Session,
    name: str,
    parent_id: int | None,
    *,
    exclude_folder_id: int | None = None,
) -> str:
    base = make_slug(name)
    stmt = select(Folder.slug)
    if parent_id is None:
        stmt = stmt.where(Folder.parent_id.is_(None))
    else:
        stmt = stmt.where(Folder.parent_id == parent_id)
    if exclude_folder_id is not None:
        stmt = stmt.where(Folder.id != exclude_folder_id)
    existing = set(db.scalars(stmt).all())
    if base not in existing:
        return base
    n = 2
    while True:
        cand = f"{base[:110]}-{n}"
        if cand not in existing:
            return cand
        n += 1


def extract_client_ip(request: Request) -> str:
    """Resolve client IP safely (trust X-Forwarded-For/X-Real-IP only from local reverse proxy)."""
    direct = (request.client.host if request.client else "").replace("::ffff:", "").strip()
    if direct in {"127.0.0.1", "::1"}:
        xff = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
        if xff:
            return xff[:45]
        xri = (request.headers.get("x-real-ip") or "").strip()
        if xri:
            return xri[:45]
    return (direct or "unknown")[:45]


def is_mobile_ua(ua: str) -> bool:
    u = (ua or "").lower()
    return any(k in u for k in ("mobile", "android", "iphone", "ipad"))


def ua_hash_short(ua: str) -> str:
    return hashlib.sha256((ua or "").encode("utf-8")).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Hierarchy Helpers (Depth, Cycles, Breadcrumbs, Subtrees)
# ---------------------------------------------------------------------------
def get_folder_depth(db: Session, folder: Folder) -> int:
    depth = 1
    curr_parent = folder.parent_id
    visited = {folder.id}
    while curr_parent is not None and depth <= MAX_FOLDER_DEPTH + 2:
        if curr_parent in visited:
            break
        visited.add(curr_parent)
        parent = db.get(Folder, curr_parent)
        if not parent:
            break
        depth += 1
        curr_parent = parent.parent_id
    return depth


def get_subtree_folders(db: Session, folder: Folder) -> list[Folder]:
    """Return folder and all its descendants (BFS order)."""
    candidates = list(db.scalars(select(Folder).where(Folder.root_id == folder.root_id)).all())
    by_parent: dict[int | None, list[Folder]] = defaultdict(list)
    by_id: dict[int, Folder] = {}
    for f in candidates:
        by_id[f.id] = f
        by_parent[f.parent_id].append(f)

    if folder.id not in by_id:
        by_id[folder.id] = folder

    result: list[Folder] = []
    queue: list[Folder] = [by_id[folder.id]]
    seen: set[int] = set()
    while queue:
        curr = queue.pop(0)
        if curr.id in seen:
            continue
        seen.add(curr.id)
        result.append(curr)
        children = sorted(by_parent.get(curr.id, []), key=lambda x: (x.sort_order, x.name.lower(), x.id))
        queue.extend(children)
    return result


def get_subtree_height(db: Session, folder: Folder) -> int:
    """Return max depth of subtree rooted at folder (leaf = 1)."""
    nodes = get_subtree_folders(db, folder)
    children_map: dict[int, list[int]] = defaultdict(list)
    for n in nodes:
        if n.parent_id is not None and n.id != folder.id:
            children_map[n.parent_id].append(n.id)

    def _height(fid: int, seen: set[int]) -> int:
        if fid in seen:
            return 1
        seen.add(fid)
        kids = children_map.get(fid, [])
        if not kids:
            return 1
        return 1 + max(_height(k, seen) for k in kids)

    return _height(folder.id, set())


def build_breadcrumbs(
    db: Session,
    folder: Folder,
    *,
    stop_at_folder_id: int | None = None,
) -> list[dict[str, Any]]:
    chain: list[dict[str, Any]] = []
    curr: Folder | None = folder
    visited: set[int] = set()
    while curr is not None and len(chain) <= MAX_FOLDER_DEPTH + 2:
        if curr.id in visited:
            break
        visited.add(curr.id)
        chain.append({"id": curr.id, "name": curr.name, "slug": curr.slug})
        if stop_at_folder_id is not None and curr.id == stop_at_folder_id:
            break
        curr = db.get(Folder, curr.parent_id) if curr.parent_id is not None else None
    chain.reverse()
    return chain


def validate_folder_move(db: Session, folder: Folder, new_parent_id: int | None) -> Folder | None:
    """Validate moving folder under new_parent_id (cycle + max depth 5)."""
    if new_parent_id is None:
        return None
    if new_parent_id == folder.id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Không thể di chuyển thư mục vào chính nó",
        )
    new_parent = db.get(Folder, new_parent_id)
    if not new_parent:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy thư mục đích")

    # Cycle check: walk ancestors of new_parent
    curr: Folder | None = new_parent
    hops = 0
    while curr is not None and hops <= MAX_FOLDER_DEPTH + 3:
        if curr.id == folder.id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Không thể di chuyển thư mục vào thư mục con của chính nó",
            )
        curr = db.get(Folder, curr.parent_id) if curr.parent_id is not None else None
        hops += 1

    parent_depth = get_folder_depth(db, new_parent)
    sub_height = get_subtree_height(db, folder)
    if parent_depth + sub_height > MAX_FOLDER_DEPTH:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Di chuyển sẽ vượt quá giới hạn tối đa {MAX_FOLDER_DEPTH} cấp thư mục",
        )
    return new_parent


def create_folder_with_optional_preset(
    db: Session,
    *,
    name: str,
    parent_id: int | None = None,
    customer_id: int | None = None,
    order_id: int | None = None,
    customer_name: str = "",
    project_code: str = "",
    description: str = "",
    cover_meta: dict[str, Any] | None = None,
    sort_order: int = 0,
    preset: str = "",
    created_by: int | None = None,
) -> Folder:
    clean_name = (name or "").strip()
    if not clean_name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Tên thư mục không được để trống")

    parent: Folder | None = None
    if parent_id is not None:
        parent = db.get(Folder, parent_id)
        if not parent:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy thư mục cha")
        p_depth = get_folder_depth(db, parent)
        needed = 2 if preset == "solar_handover" else 1
        if p_depth + needed > MAX_FOLDER_DEPTH:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Thư mục đạt giới hạn tối đa {MAX_FOLDER_DEPTH} cấp",
            )

    resolved_customer_id = customer_id if customer_id is not None else (parent.customer_id if parent else None)
    resolved_customer_name = (customer_name or "").strip()
    if not resolved_customer_name and resolved_customer_id:
        cust = db.get(Customer, resolved_customer_id)
        if cust:
            resolved_customer_name = cust.name
    elif not resolved_customer_name and parent:
        resolved_customer_name = parent.customer_name

    resolved_project_code = (project_code or "").strip() or (parent.project_code if parent else "")
    slug = unique_slug(db, clean_name, parent_id)

    folder = Folder(
        parent_id=parent_id,
        root_id=parent.root_id if parent else 0,
        slug=slug,
        name=clean_name[:255],
        customer_id=resolved_customer_id,
        order_id=order_id if order_id is not None else (parent.order_id if parent else None),
        customer_name=resolved_customer_name[:255],
        project_code=resolved_project_code[:80],
        description=(description or "").strip(),
        cover_meta=dump_json_dict(cover_meta),
        sort_order=int(sort_order or 0),
        is_archived=False,
        created_by=created_by,
    )
    db.add(folder)
    db.flush()
    if parent is None:
        folder.root_id = folder.id
    else:
        folder.root_id = parent.root_id

    if (preset or "").strip().lower() == "solar_handover":
        for sec_name, sec_desc, sec_order in SOLAR_HANDOVER_SECTIONS:
            sec_slug = unique_slug(db, sec_name, folder.id)
            db.add(
                Folder(
                    parent_id=folder.id,
                    root_id=folder.root_id,
                    slug=sec_slug,
                    name=sec_name,
                    customer_id=folder.customer_id,
                    order_id=folder.order_id,
                    customer_name=folder.customer_name,
                    project_code=folder.project_code,
                    description=sec_desc,
                    cover_meta="{}",
                    sort_order=sec_order,
                    is_archived=False,
                    created_by=created_by,
                )
            )

    db.commit()
    db.refresh(folder)
    return folder


# ---------------------------------------------------------------------------
# Recursive Stats, Tree & Serialization
# ---------------------------------------------------------------------------
def empty_stats() -> dict[str, int]:
    return {
        "total_items": 0,
        "subfolder_count": 0,
        "signed_pdfs": 0,
        "pdfs": 0,
        "images": 0,
        "videos": 0,
        "others": 0,
        "total_bytes": 0,
        "active_shares": 0,
        "views_7d": 0,
    }


def compute_stats_for_roots(db: Session, root_ids: set[int]) -> dict[int, dict[str, int]]:
    """Compute recursive stats for every folder under the given root_ids in bulk queries."""
    if not root_ids:
        return {}

    all_folders = list(
        db.scalars(select(Folder).where(Folder.root_id.in_(root_ids))).all()
    )
    if not all_folders:
        return {}

    folder_ids = [f.id for f in all_folders]
    children_map: dict[int, list[int]] = defaultdict(list)
    for f in all_folders:
        if f.parent_id is not None:
            children_map[f.parent_id].append(f.id)

    # Direct item metrics per folder
    direct: dict[int, dict[str, int]] = {fid: empty_stats() for fid in folder_ids}
    for fid in folder_ids:
        direct[fid]["subfolder_count"] = len(children_map.get(fid, []))

    item_rows = db.execute(
        select(
            FolderItem.folder_id,
            FolderItem.item_kind,
            FolderItem.file_ext,
            FolderItem.file_size,
            FolderItem.media_meta_json,
            Document.signed,
            Document.signed_upload_id,
        )
        .outerjoin(Document, FolderItem.document_id == Document.id)
        .where(FolderItem.folder_id.in_(folder_ids))
    ).all()

    for fid, item_kind, file_ext, file_size, meta_json, doc_signed, doc_signed_up in item_rows:
        st = direct.get(fid)
        if st is None:
            continue
        st["total_items"] += 1
        st["total_bytes"] += int(file_size or 0)
        cat = storage_drive.file_category_for_ext(file_ext or "")
        if cat == "pdf":
            st["pdfs"] += 1
            is_signed = False
            if item_kind == "document":
                is_signed = bool(doc_signed or doc_signed_up)
            else:
                is_signed = bool(parse_json_dict(meta_json).get("sig_valid"))
            if is_signed:
                st["signed_pdfs"] += 1
        elif cat == "image":
            st["images"] += 1
        elif cat == "video":
            st["videos"] += 1
        else:
            st["others"] += 1

    # Active share count per folder
    now = utc_now()
    shares = list(
        db.scalars(
            select(FolderShare).where(
                FolderShare.folder_id.in_(folder_ids),
                FolderShare.revoked.is_(False),
            )
        ).all()
    )
    for sh in shares:
        if sh.expires_at is not None and _as_utc(sh.expires_at) <= now:
            continue
        if sh.max_views is not None and sh.view_count >= sh.max_views:
            continue
        if sh.folder_id in direct:
            direct[sh.folder_id]["active_shares"] += 1

    # 7-day views per folder
    cutoff_7d = (now - timedelta(days=7)).replace(tzinfo=None)
    log_counts = db.execute(
        select(FolderAccessLog.folder_id, func.count(FolderAccessLog.id))
        .where(
            FolderAccessLog.folder_id.in_(folder_ids),
            FolderAccessLog.created_at >= cutoff_7d,
        )
        .group_by(FolderAccessLog.folder_id)
    ).all()
    for fid, cnt in log_counts:
        if fid in direct:
            direct[fid]["views_7d"] += int(cnt or 0)

    # Memoized recursive roll-up
    rolled: dict[int, dict[str, int]] = {}
    agg_keys = (
        "total_items",
        "signed_pdfs",
        "pdfs",
        "images",
        "videos",
        "others",
        "total_bytes",
        "active_shares",
        "views_7d",
    )

    def _rollup(fid: int, visiting: set[int]) -> dict[str, int]:
        if fid in rolled:
            return rolled[fid]
        res = dict(direct.get(fid, empty_stats()))
        if fid in visiting:
            return res
        visiting.add(fid)
        for cid in children_map.get(fid, []):
            c_stats = _rollup(cid, visiting)
            for k in agg_keys:
                res[k] += c_stats[k]
        visiting.remove(fid)
        rolled[fid] = res
        return res

    for fid in folder_ids:
        _rollup(fid, set())

    return rolled


def serialize_folder_summary(
    folder: Folder,
    stats: dict[str, int] | None = None,
) -> dict[str, Any]:
    return {
        "id": folder.id,
        "parent_id": folder.parent_id,
        "root_id": folder.root_id,
        "slug": folder.slug,
        "name": folder.name,
        "customer_id": folder.customer_id,
        "order_id": folder.order_id,
        "customer_name": folder.customer_name or (folder.customer.name if folder.customer else ""),
        "project_code": folder.project_code,
        "description": folder.description,
        "cover_meta": parse_json_dict(folder.cover_meta),
        "sort_order": folder.sort_order,
        "is_archived": bool(folder.is_archived),
        "created_by": folder.created_by,
        "created_at": iso_or_none(folder.created_at),
        "updated_at": iso_or_none(folder.updated_at),
        "stats": stats if stats is not None else empty_stats(),
    }


def serialize_public_folder_summary(
    folder: Folder,
    stats: dict[str, int] | None = None,
) -> dict[str, Any]:
    return {
        "id": folder.id,
        "parent_id": folder.parent_id,
        "slug": folder.slug,
        "name": folder.name,
        "customer_name": folder.customer_name or (folder.customer.name if folder.customer else ""),
        "project_code": folder.project_code,
        "description": folder.description,
        "cover_meta": parse_json_dict(folder.cover_meta),
        "sort_order": folder.sort_order,
        "created_at": iso_or_none(folder.created_at),
        "updated_at": iso_or_none(folder.updated_at),
        "stats": stats if stats is not None else empty_stats(),
    }


def serialize_item(
    item: FolderItem,
    *,
    doc: Document | None = None,
    public_token: str | None = None,
    allow_download: bool = True,
    allow_neac_verify: bool = True,
) -> dict[str, Any]:
    d = doc if doc is not None else item.document
    ext = (item.file_ext or "").lower()
    if not ext and d is not None:
        ext = Path(d.filename or "").suffix.lower() or ".pdf"
    category = storage_drive.file_category_for_ext(ext)
    meta = parse_json_dict(item.media_meta_json)

    signed = False
    signer_name = ""
    doc_type = ""
    if item.item_kind == "document" and d is not None:
        signed = bool(d.signed or d.signed_upload_id)
        signer_name = d.signer_name or ""
        doc_type = d.doc_type or ""
    else:
        signed = bool(meta.get("sig_valid"))
        signer_name = str(meta.get("signer_summary") or "")

    has_thumb = bool(item.thumb_doc_id) or (category == "image")

    if public_token is not None:
        tok_q = quote(public_token, safe="")
        base = f"/api/public/drive/{tok_q}/items/{item.id}"
        thumb_url = f"{base}/thumb" if has_thumb else None
        view_url = f"{base}/view"
        download_url = f"{base}/download" if allow_download else None
        verify_neac_url = (
            f"{base}/verify-neac" if (category == "pdf" and allow_neac_verify) else None
        )
    else:
        base = f"/api/drive/items/{item.id}"
        thumb_url = f"{base}/thumb" if has_thumb else None
        view_url = f"{base}/file"
        download_url = f"{base}/file?download=1"
        verify_neac_url = None

    return {
        "id": item.id,
        "folder_id": item.folder_id,
        "item_kind": item.item_kind,
        "document_id": item.document_id,
        "display_name": item.display_name or item.original_filename or (d.filename if d else f"item-{item.id}"),
        "original_filename": item.original_filename or (d.filename if d else ""),
        "section_tag": item.section_tag or "",
        "mime_type": item.mime_type or storage_drive.mime_for_ext(ext),
        "file_ext": ext,
        "file_category": category,
        "file_size": int(item.file_size or 0),
        "sha256": item.sha256 or "",
        "media_meta": meta,
        "note": item.note or "",
        "sort_order": item.sort_order,
        "is_pinned": bool(item.is_pinned),
        "signed": signed,
        "signer_name": signer_name,
        "doc_type": doc_type,
        "has_thumb": has_thumb,
        "thumb_url": thumb_url,
        "view_url": view_url,
        "download_url": download_url,
        "verify_neac_url": verify_neac_url,
        "created_at": iso_or_none(item.created_at),
        "updated_at": iso_or_none(item.updated_at),
    }


def serialize_share(share: FolderShare, settings: Settings) -> dict[str, Any]:
    now = utc_now()
    expired = bool(share.expires_at is not None and _as_utc(share.expires_at) <= now)
    public_path = f"/d/{share.token}"
    share_url = f"{settings.public_base_url.rstrip('/')}{public_path}"
    return {
        "id": share.id,
        "folder_id": share.folder_id,
        "token": share.token,
        "share_url": share_url,
        "url": share_url,
        "public_path": public_path,
        "qr_svg_url": f"/api/drive/shares/{share.id}/qr.svg",
        "label": share.label or "",
        "has_passcode": bool(share.passcode_hash),
        "permission": share.permission or "view_download",
        "allow_zip_download": bool(share.allow_zip_download),
        "allow_neac_verify": bool(share.allow_neac_verify),
        "include_subfolders": bool(share.include_subfolders),
        "notify_telegram": bool(share.notify_telegram),
        "expires_at": iso_or_none(share.expires_at),
        "expired": expired,
        "max_views": share.max_views,
        "view_count": int(share.view_count or 0),
        "revoked": bool(share.revoked),
        "revoked_at": iso_or_none(share.revoked_at),
        "created_at": iso_or_none(share.created_at),
        "last_accessed_at": iso_or_none(share.last_accessed_at),
    }


def build_folder_tree_node(
    db: Session,
    root_folder: Folder,
    *,
    include_archived: bool = False,
) -> dict[str, Any]:
    folders = list(
        db.scalars(select(Folder).where(Folder.root_id == root_folder.root_id)).all()
    )
    if not include_archived:
        folders = [f for f in folders if not f.is_archived or f.id == root_folder.id]

    fids = [f.id for f in folders]
    counts = dict(
        db.execute(
            select(FolderItem.folder_id, func.count(FolderItem.id))
            .where(FolderItem.folder_id.in_(fids))
            .group_by(FolderItem.folder_id)
        ).all()
    ) if fids else {}

    children_map: dict[int | None, list[Folder]] = defaultdict(list)
    by_id: dict[int, Folder] = {}
    for f in folders:
        by_id[f.id] = f
        children_map[f.parent_id].append(f)

    def _build(f: Folder, seen: set[int]) -> dict[str, Any]:
        kids = []
        if f.id not in seen:
            seen.add(f.id)
            for child in sorted(children_map.get(f.id, []), key=lambda x: (x.sort_order, x.name.lower(), x.id)):
                kids.append(_build(child, seen))
        return {
            "id": f.id,
            "parent_id": f.parent_id,
            "root_id": f.root_id,
            "name": f.name,
            "slug": f.slug,
            "customer_id": f.customer_id,
            "customer_name": f.customer_name or "",
            "project_code": f.project_code or "",
            "is_archived": bool(f.is_archived),
            "sort_order": f.sort_order,
            "item_count": int(counts.get(f.id, 0)),
            "children": kids,
        }

    return _build(by_id.get(root_folder.id, root_folder), set())


# ---------------------------------------------------------------------------
# Physical Path Resolution & Safe Asset GC
# ---------------------------------------------------------------------------
def resolve_item_physical_file(item: FolderItem) -> tuple[Path, str, str] | None:
    """Resolve ``(path, ext, download_filename)`` for a FolderItem."""
    if item.item_kind == "document":
        doc = item.document
        if not doc:
            return None
        # Prefer countersigned upload if present? No, doc.doc_id is canonical; match view_document behavior.
        found = storage.find_doc_path(doc.doc_id)
        if not found:
            return None
        fpath, suffix = found
        dl_name = item.display_name or doc.filename or f"document-{doc.id}{suffix}"
        if suffix and not dl_name.lower().endswith(suffix.lower()):
            dl_name = f"{dl_name}{suffix}"
        return fpath, suffix.lower(), dl_name

    found = storage_drive.find_asset_path(item.storage_doc_id, item.file_ext)
    if not found:
        return None
    fpath, suffix = found
    dl_name = item.display_name or item.original_filename or f"file-{item.id}{suffix}"
    if suffix and not dl_name.lower().endswith(suffix.lower()):
        dl_name = f"{dl_name}{suffix}"
    return fpath, suffix.lower(), dl_name


def gc_unreferenced_drive_assets(
    db: Session,
    storage_doc_ids: set[str],
    thumb_doc_ids: set[str],
) -> int:
    """Delete Drive asset & thumbnail files no longer referenced by any FolderItem."""
    removed = 0
    for sid in storage_doc_ids:
        if not sid:
            continue
        still = db.scalar(
            select(func.count(FolderItem.id)).where(
                FolderItem.item_kind == "asset",
                FolderItem.storage_doc_id == sid,
            )
        )
        if not still and storage_drive.delete_asset_file(sid):
            removed += 1

    for tid in thumb_doc_ids:
        if not tid:
            continue
        still = db.scalar(
            select(func.count(FolderItem.id)).where(FolderItem.thumb_doc_id == tid)
        )
        if not still:
            storage_drive.delete_thumb_file(tid)
    return removed


def delete_folder_cascade(db: Session, folder: Folder) -> tuple[int, int]:
    """Delete a folder subtree + items + shares + logs; NEVER delete Document rows; GC orphan assets."""
    subtree = get_subtree_folders(db, folder)
    fids = [f.id for f in subtree]

    items = list(db.scalars(select(FolderItem).where(FolderItem.folder_id.in_(fids))).all())
    asset_ids = {it.storage_doc_id for it in items if it.item_kind == "asset" and it.storage_doc_id}
    thumb_ids = {it.thumb_doc_id for it in items if it.thumb_doc_id}
    removed_items = len(items)

    db.execute(delete(FolderAccessLog).where(FolderAccessLog.folder_id.in_(fids)))
    db.execute(delete(FolderShare).where(FolderShare.folder_id.in_(fids)))
    db.execute(delete(FolderItem).where(FolderItem.folder_id.in_(fids)))
    # Delete deepest folders first using Core DELETE (avoids SAWarning with SQLite ON DELETE CASCADE)
    for f in reversed(subtree):
        db.execute(delete(Folder).where(Folder.id == f.id))
    db.commit()

    gc_count = gc_unreferenced_drive_assets(db, asset_ids, thumb_ids)
    return removed_items, gc_count


def get_or_create_ci_preview_root(db: Session) -> Folder:
    """Return or create the dedicated root folder holding temporary CI preview folders."""
    existing = db.scalar(
        select(Folder)
        .where(
            Folder.parent_id.is_(None),
            Folder.project_code == CI_PREVIEW_ROOT_CODE,
        )
        .order_by(Folder.id.asc())
    )
    if existing is not None:
        changed = False
        if existing.is_archived:
            existing.is_archived = False
            changed = True
        if existing.auto_delete_at is not None:
            existing.auto_delete_at = None
            changed = True
        if changed:
            db.commit()
            db.refresh(existing)
        return existing

    return create_folder_with_optional_preset(
        db,
        name=CI_PREVIEW_ROOT_NAME,
        parent_id=None,
        project_code=CI_PREVIEW_ROOT_CODE,
        description="Kho lưu tạm video & ảnh chụp kiểm thử CI (mỗi phiên tự động xóa sau 7 ngày).",
        sort_order=999,
        created_by=None,
    )


def purge_expired_ephemeral_folders(db: Session) -> dict[str, int]:
    """Cascade-delete temporary folders whose auto_delete_at <= current UTC time.

    Normal folders always have ``auto_delete_at IS NULL`` and are never touched.
    """
    now_aware = utc_now()
    now_naive = now_aware.replace(tzinfo=None)
    candidates = list(
        db.scalars(
            select(Folder)
            .where(
                Folder.auto_delete_at.is_not(None),
                Folder.auto_delete_at <= now_naive,
                Folder.project_code != CI_PREVIEW_ROOT_CODE,
            )
            .order_by(Folder.id.asc())
        ).all()
    )
    folders_deleted = 0
    items_deleted = 0
    assets_gc = 0
    for folder in candidates:
        if folder.auto_delete_at is None or folder.project_code == CI_PREVIEW_ROOT_CODE:
            continue
        exp_utc = _as_utc(folder.auto_delete_at)
        if exp_utc is None or exp_utc > now_aware:
            continue
        removed_items, gc_count = delete_folder_cascade(db, folder)
        folders_deleted += 1
        items_deleted += removed_items
        assets_gc += gc_count
    return {
        "folders_deleted": folders_deleted,
        "items_deleted": items_deleted,
        "assets_gc": assets_gc,
    }


def attach_documents_to_folder(
    db: Session,
    folder: Folder,
    document_ids: list[int],
    *,
    section_tag: str = "",
    created_by: int | None = None,
) -> tuple[list[FolderItem], list[int]]:
    """Attach existing Document rows to folder (deduplicated per folder)."""
    clean_ids: list[int] = []
    seen_req: set[int] = set()
    for raw_id in document_ids:
        try:
            did = int(raw_id)
        except (TypeError, ValueError):
            continue
        if did > 0 and did not in seen_req:
            seen_req.add(did)
            clean_ids.append(did)

    if not clean_ids:
        return [], []

    existing_doc_ids = set(
        db.scalars(
            select(FolderItem.document_id).where(
                FolderItem.folder_id == folder.id,
                FolderItem.item_kind == "document",
                FolderItem.document_id.in_(clean_ids),
            )
        ).all()
    )

    max_sort = (
        db.scalar(select(func.max(FolderItem.sort_order)).where(FolderItem.folder_id == folder.id))
        or 0
    )

    attached: list[FolderItem] = []
    skipped: list[int] = []
    clean_tag = (section_tag or "").strip()[:64]

    for did in clean_ids:
        if did in existing_doc_ids:
            skipped.append(did)
            continue
        doc = db.get(Document, did)
        if not doc:
            skipped.append(did)
            continue

        found = storage.find_doc_path(doc.doc_id)
        ext = Path(doc.filename or "").suffix.lower() or ".pdf"
        file_size = 0
        sha256_hex = ""
        thumb_doc_id = ""
        media_meta: dict[str, Any] = {}
        if found:
            fpath, suffix = found
            ext = suffix.lower()
            try:
                file_size = fpath.stat().st_size
                h = hashlib.sha256()
                with open(fpath, "rb") as fh:
                    while True:
                        blk = fh.read(storage_drive.CHUNK_READ_SIZE)
                        if not blk:
                            break
                        h.update(blk)
                sha256_hex = h.hexdigest()
                if ext in storage_drive.IMAGE_EXTS:
                    try:
                        thumb_doc_id, media_meta = storage_drive.generate_webp_thumbnail(fpath)
                    except HTTPException:
                        pass
            except OSError:
                pass

        max_sort += 10
        item = FolderItem(
            folder_id=folder.id,
            item_kind="document",
            document_id=doc.id,
            storage_doc_id="",
            thumb_doc_id=thumb_doc_id,
            display_name=(doc.filename or f"document-{doc.id}{ext}")[:255],
            original_filename=(doc.filename or f"document-{doc.id}{ext}")[:255],
            section_tag=clean_tag,
            mime_type=storage_drive.mime_for_ext(ext),
            file_ext=ext,
            file_size=file_size,
            sha256=sha256_hex,
            media_meta_json=dump_json_dict(media_meta),
            note=(doc.note or "")[:1000],
            sort_order=max_sort,
            is_pinned=False,
            created_by=created_by,
        )
        db.add(item)
        attached.append(item)

    db.commit()
    for it in attached:
        db.refresh(it)
    return attached, skipped


# ---------------------------------------------------------------------------
# Public Share Auth, Passcode Cookie, Brute-Force Lock & IDOR Guards
# ---------------------------------------------------------------------------
def generate_share_token() -> str:
    return secrets.token_urlsafe(24)


def drive_cookie_name(token: str) -> str:
    return "ksp_drive_" + hashlib.sha256(token.encode("utf-8")).hexdigest()[:12]


def _passcode_binding_digest(passcode_hash: str) -> str:
    """16-hex digest of the full PBKDF2 hash (changes whenever passcode changes)."""
    return hashlib.sha256((passcode_hash or "").encode("utf-8")).hexdigest()[:16]


def _unlock_secret(settings: Settings) -> str:
    return "drive_unlock:" + settings.effective_jwt_secret()


def mint_unlock_cookie_token(share: FolderShare, settings: Settings) -> str:
    now = utc_now()
    payload = {
        "typ": "drive_unlock",
        "sid": share.id,
        "tok": share.token,
        "ph": _passcode_binding_digest(share.passcode_hash),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=UNLOCK_COOKIE_TTL_SECONDS)).timestamp()),
    }
    return jwt.encode(payload, _unlock_secret(settings), algorithm="HS256")


def is_share_unlocked(request: Request, share: FolderShare, settings: Settings) -> bool:
    if not share.passcode_hash:
        return True
    raw_cookie = request.cookies.get(drive_cookie_name(share.token)) or ""
    if not raw_cookie:
        return False
    try:
        payload = jwt.decode(raw_cookie, _unlock_secret(settings), algorithms=["HS256"])
    except PyJWTError:
        return False
    if payload.get("typ") != "drive_unlock":
        return False
    if int(payload.get("sid", -1)) != share.id:
        return False
    if not hmac.compare_digest(str(payload.get("tok") or ""), share.token):
        return False
    expected_ph = _passcode_binding_digest(share.passcode_hash)
    if not hmac.compare_digest(str(payload.get("ph") or ""), expected_ph):
        return False
    return True


def check_passcode_lockout(client_ip: str, token: str) -> int | None:
    """Return retry_after_seconds if (client_ip, token) is currently locked out, else None."""
    key = f"{client_ip}:{token}"
    now = time.monotonic()
    with _passcode_lock:
        fails = [t for t in _passcode_failures.get(key, []) if now - t < _PASSCODE_WINDOW_SECONDS]
        _passcode_failures[key] = fails
        if len(fails) >= _PASSCODE_FAIL_LIMIT:
            oldest = fails[0]
            return max(1, int(_PASSCODE_WINDOW_SECONDS - (now - oldest)))
    return None


def record_passcode_failure(client_ip: str, token: str) -> int:
    """Record a failed passcode attempt and return remaining attempts before 429 lockout."""
    key = f"{client_ip}:{token}"
    now = time.monotonic()
    with _passcode_lock:
        fails = [t for t in _passcode_failures.get(key, []) if now - t < _PASSCODE_WINDOW_SECONDS]
        fails.append(now)
        _passcode_failures[key] = fails
        return max(0, _PASSCODE_FAIL_LIMIT - len(fails))


def clear_passcode_failures(client_ip: str, token: str) -> None:
    key = f"{client_ip}:{token}"
    with _passcode_lock:
        _passcode_failures.pop(key, None)


def check_drive_neac_rate_limit(client_ip: str, token: str) -> None:
    key = f"{client_ip}:{token}"
    now = time.monotonic()
    with _neac_lock:
        hits = [t for t in _neac_buckets.get(key, []) if now - t < _NEAC_RATE_WINDOW]
        if len(hits) >= _NEAC_RATE_LIMIT:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Quá nhiều lượt yêu cầu thẩm định NEAC — vui lòng thử lại sau 1 phút",
            )
        hits.append(now)
        _neac_buckets[key] = hits


def load_active_share(
    db: Session,
    token: str,
    *,
    strict_max_views: bool = False,
) -> FolderShare:
    """Load FolderShare and enforce existence (404) & active status (410 Gone)."""
    share = db.scalar(select(FolderShare).where(FolderShare.token == token))
    if not share:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Link chia sẻ không tồn tại")
    if share.revoked:
        raise HTTPException(status.HTTP_410_GONE, "Link chia sẻ đã bị thu hồi")
    now = utc_now()
    if share.expires_at is not None and _as_utc(share.expires_at) <= now:
        raise HTTPException(status.HTTP_410_GONE, "Link chia sẻ đã hết hạn")
    if share.folder is None or share.folder.is_archived:
        raise HTTPException(status.HTTP_410_GONE, "Thư mục chia sẻ không còn khả dụng")
    if share.max_views is not None:
        if strict_max_views and share.view_count >= share.max_views:
            raise HTTPException(status.HTTP_410_GONE, "Link chia sẻ đã đạt giới hạn lượt xem")
        if not strict_max_views and share.view_count > share.max_views:
            raise HTTPException(status.HTTP_410_GONE, "Link chia sẻ đã đạt giới hạn lượt xem")
    return share


def resolve_authorized_folder(
    db: Session,
    share: FolderShare,
    target_folder_id: int,
) -> Folder:
    """Strict IDOR guard: verify target_folder_id is share.folder or a descendant within share scope."""
    root_shared = share.folder
    if root_shared is None or root_shared.is_archived:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Thư mục không tồn tại")

    if target_folder_id == share.folder_id:
        return root_shared

    if not share.include_subfolders:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Thư mục không tồn tại")

    target = db.get(Folder, target_folder_id)
    if not target or target.is_archived:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Thư mục không tồn tại")

    # Fast O(1) cross-tree rejection
    if target.root_id != root_shared.root_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Thư mục không tồn tại")

    # Walk ancestor chain upward to confirm share.folder_id is an ancestor
    curr: Folder | None = target
    visited: set[int] = set()
    hops = 0
    while curr is not None and hops <= MAX_FOLDER_DEPTH + 2:
        if curr.id in visited:
            break
        visited.add(curr.id)
        if curr.is_archived:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Thư mục không tồn tại")
        if curr.id == share.folder_id:
            return target
        if curr.parent_id is None:
            break
        curr = db.get(Folder, curr.parent_id)
        hops += 1

    raise HTTPException(status.HTTP_404_NOT_FOUND, "Thư mục không tồn tại")


def resolve_authorized_item(
    db: Session,
    share: FolderShare,
    item_id: int,
) -> tuple[FolderItem, Folder]:
    """Strict IDOR guard: verify item resides in share.folder or an authorized subfolder."""
    item = db.get(FolderItem, item_id)
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tệp không tồn tại")
    folder = resolve_authorized_folder(db, share, item.folder_id)
    return item, folder


# ---------------------------------------------------------------------------
# ZIP Entry Collector
# ---------------------------------------------------------------------------
def collect_folder_zip_entries(
    db: Session,
    base_folder: Folder,
    *,
    include_subfolders: bool = True,
) -> list[tuple[list[str], str, Path, str]]:
    """Collect ``(relative_folder_parts, display_name, physical_path, ext)`` for ZIP streaming."""
    entries: list[tuple[list[str], str, Path, str]] = []

    if include_subfolders:
        subtree = get_subtree_folders(db, base_folder)
        subtree = [f for f in subtree if not f.is_archived or f.id == base_folder.id]
    else:
        subtree = [base_folder]

    by_id = {f.id: f for f in subtree}
    fids = list(by_id.keys())

    # Compute relative path parts from base_folder for each folder
    rel_parts: dict[int, list[str]] = {base_folder.id: []}
    for f in subtree:
        if f.id == base_folder.id:
            continue
        parts: list[str] = []
        curr: Folder | None = f
        guard = 0
        while curr is not None and curr.id != base_folder.id and guard <= MAX_FOLDER_DEPTH + 2:
            parts.append(curr.name)
            curr = by_id.get(curr.parent_id) if curr.parent_id is not None else None
            guard += 1
        parts.reverse()
        rel_parts[f.id] = parts

    items = list(
        db.scalars(
            select(FolderItem)
            .where(FolderItem.folder_id.in_(fids))
            .order_by(FolderItem.folder_id.asc(), FolderItem.sort_order.asc(), FolderItem.id.asc())
        ).all()
    )

    for it in items:
        resolved = resolve_item_physical_file(it)
        if not resolved:
            continue
        fpath, ext, dl_name = resolved
        entries.append((rel_parts.get(it.folder_id, []), dl_name, fpath, ext))
    return entries


# ---------------------------------------------------------------------------
# Telemetry Nonce, Access Logging, Telegram Notify & QR SVG
# ---------------------------------------------------------------------------
def _telemetry_secret(settings: Settings) -> str:
    return "drivetrack:" + settings.effective_jwt_secret()


def generate_telemetry_nonce(
    settings: Settings,
    *,
    share_token: str,
    folder_id: int,
    user_agent: str = "",
) -> str:
    ts = int(time.time())
    uah = ua_hash_short(user_agent)
    payload = f"{share_token}:{folder_id}:{ts}:{uah}"
    mac = hmac.new(
        _telemetry_secret(settings).encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{mac}:{ts}"


def verify_telemetry_nonce(
    settings: Settings,
    nonce: str,
    *,
    share_token: str,
    folder_id: int,
    user_agent: str = "",
) -> bool:
    global _last_nonce_cleanup
    if not nonce or ":" not in nonce:
        return False
    mac_given, ts_str = nonce.split(":", 1)
    try:
        ts = int(ts_str)
    except ValueError:
        return False

    now = time.time()
    if now - ts > _NONCE_TTL or ts - now > 30:
        return False

    uah = ua_hash_short(user_agent)
    payload = f"{share_token}:{folder_id}:{ts}:{uah}"
    expected = hmac.new(
        _telemetry_secret(settings).encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(mac_given, expected):
        return False

    with _nonce_lock:
        if now - _last_nonce_cleanup >= 300:
            _last_nonce_cleanup = now
            for k in [k for k, exp in _used_nonces.items() if exp < now]:
                del _used_nonces[k]
        if nonce in _used_nonces:
            return False
        _used_nonces[nonce] = now + _NONCE_TTL + 10
    return True


def cache_visitor_geo(
    share_id: int,
    server_ip: str,
    ua: str,
    *,
    ip: str = "",
    city: str = "",
    region: str = "",
    isp: str = "",
    country_code: str = "",
    device_type: str = "",
    fingerprint_hash: str = "",
) -> None:
    """Cache browser-resolved GeoIP snapshot for 30 min so server-side endpoints inherit it."""
    key = (int(share_id), (server_ip or "").strip()[:45], ua_hash_short(ua))
    now = time.monotonic()
    snapshot = {
        "ip": (ip or "").strip()[:45],
        "city": (city or "").strip()[:100],
        "region": (region or "").strip()[:100],
        "isp": (isp or "").strip()[:200],
        "country_code": (country_code or "").strip()[:5],
        "device_type": (device_type or "").strip()[:20],
        "fingerprint_hash": (fingerprint_hash or "").strip()[:64],
    }
    with _geo_lock:
        if len(_geo_cache) > 5000:
            stale = [k for k, (exp, _) in _geo_cache.items() if exp < now]
            for k in stale:
                _geo_cache.pop(k, None)
        prev = _geo_cache.get(key)
        merged: dict[str, str] = {}
        if prev is not None and prev[0] >= now:
            merged.update(prev[1])
        for field, val in snapshot.items():
            if val:
                merged[field] = val
        if merged:
            _geo_cache[key] = (now + _GEO_CACHE_TTL_SECONDS, merged)


def enrich_geo_from_cache(
    share_id: int,
    server_ip: str,
    ua: str,
    *,
    ip: str = "",
    city: str = "",
    region: str = "",
    isp: str = "",
    country_code: str = "",
    device_type: str = "",
    fingerprint_hash: str = "",
) -> dict[str, str]:
    """Attach cached browser GeoIP + device + fingerprint onto server-side Drive requests."""
    clean_server_ip = (server_ip or "").strip()[:45]
    key = (int(share_id), clean_server_ip, ua_hash_short(ua))
    now = time.monotonic()
    cached: dict[str, str] = {}
    with _geo_lock:
        entry = _geo_cache.get(key)
        if entry is not None:
            exp, data = entry
            if exp >= now:
                cached = dict(data)
            else:
                _geo_cache.pop(key, None)

    resolved_ip = (ip or "").strip()[:45] or cached.get("ip") or clean_server_ip
    resolved_device = (
        (device_type or "").strip()[:20]
        or cached.get("device_type")
        or ("mobile" if is_mobile_ua(ua) else "desktop")
    )
    return {
        "ip": resolved_ip,
        "city": (city or "").strip()[:100] or cached.get("city", ""),
        "region": (region or "").strip()[:100] or cached.get("region", ""),
        "isp": (isp or "").strip()[:200] or cached.get("isp", ""),
        "country_code": (country_code or "").strip()[:5] or cached.get("country_code", ""),
        "device_type": resolved_device,
        "fingerprint_hash": (fingerprint_hash or "").strip()[:64] or cached.get("fingerprint_hash", ""),
    }


def _should_notify_telegram(
    ip: str,
    share_id: int,
    action: str,
    *,
    folder_id: int = 0,
    item_id: int | None = None,
) -> bool:
    now = time.monotonic()
    with _tg_lock:
        ip_hits = [t for t in _tg_ip_counts.get(ip, []) if now - t < _TG_BURST_WINDOW]
        if len(ip_hits) >= _TG_MAX_PER_IP:
            _tg_ip_counts[ip] = ip_hits
            return False

        if action in {"folder_open", "subfolder_open"}:
            key = f"{ip}:{share_id}:{action}:{folder_id}"
            last = _tg_cooldown.get(key)
            if last is not None and (now - last) < _TG_COOLDOWN_SECONDS:
                _tg_ip_counts[ip] = ip_hits
                return False
            _tg_cooldown[key] = now
        elif action in {"item_view", "video_play"}:
            key = f"{ip}:{share_id}:{action}:{item_id or 0}"
            last = _tg_cooldown.get(key)
            if last is not None and (now - last) < _TG_COOLDOWN_SECONDS:
                _tg_ip_counts[ip] = ip_hits
                return False
            _tg_cooldown[key] = now

        if len(_tg_cooldown) > 5000:
            stale = [k for k, ts in _tg_cooldown.items() if now - ts >= _TG_COOLDOWN_SECONDS]
            for k in stale:
                _tg_cooldown.pop(k, None)

        ip_hits.append(now)
        _tg_ip_counts[ip] = ip_hits
        return True


def record_access_log(
    db: Session,
    settings: Settings,
    *,
    folder_id: int,
    share: FolderShare | None,
    action: str,
    item_id: int | None = None,
    item_name: str = "",
    ip: str = "",
    rate_limit_ip: str = "",
    city: str = "",
    region: str = "",
    isp: str = "",
    country_code: str = "",
    device_type: str = "",
    user_agent: str = "",
    fingerprint_hash: str = "",
    allow_notify: bool = True,
) -> FolderAccessLog:
    log_row = FolderAccessLog(
        folder_id=folder_id,
        share_id=share.id if share else None,
        item_id=item_id,
        action=(action or "")[:40],
        item_name=(item_name or "")[:255],
        ip=(ip or "")[:45],
        city=(city or "")[:100],
        region=(region or "")[:100],
        isp=(isp or "")[:200],
        country_code=(country_code or "")[:5],
        device_type=(device_type or ("mobile" if is_mobile_ua(user_agent) else "desktop"))[:20],
        user_agent_hash=ua_hash_short(user_agent),
        fingerprint_hash=(fingerprint_hash or "")[:64],
        notified=False,
    )
    db.add(log_row)

    should_tg = False
    if (
        allow_notify
        and share is not None
        and share.notify_telegram
        and action in _TG_NOTIFY_ACTIONS
    ):
        cooldown_ip = (rate_limit_ip or ip or "unknown").strip()
        if _should_notify_telegram(
            cooldown_ip,
            share.id,
            action,
            folder_id=folder_id,
            item_id=item_id,
        ):
            should_tg = True
            log_row.notified = True

    db.commit()
    db.refresh(log_row)

    if should_tg and share is not None:
        _enqueue_drive_telegram(settings, log_row.id, folder_id, share.id)

    return log_row


def _esc_html(text: str) -> str:
    return (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _enqueue_drive_telegram(settings: Settings, log_id: int, folder_id: int, share_id: int) -> None:
    global _tg_executor
    if not settings.telegram_enabled or not settings.telegram_bot_token:
        return
    if _tg_executor is None:
        _tg_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="drivetrack-tg")
    _tg_executor.submit(_send_drive_telegram_alert, settings, log_id, folder_id, share_id)


def _send_drive_telegram_alert(settings: Settings, log_id: int, folder_id: int, share_id: int) -> None:
    from .telegram import TelegramClient, TelegramError, admin_chat_ids

    gen = get_session()
    db = next(gen)
    try:
        chat_ids = admin_chat_ids(db)
        if not chat_ids:
            return
        log_row = db.get(FolderAccessLog, log_id)
        folder = db.get(Folder, folder_id)
        share = db.get(FolderShare, share_id)
        if not log_row or not folder:
            return

        action_headers = {
            "folder_open": "📂 <b>[Drive] Đang mở thư mục</b>",
            "subfolder_open": "📁 <b>[Drive] Mở thư mục con</b>",
            "item_view": "👁️ <b>[Drive] Đang xem tệp</b>",
            "video_play": "🎬 <b>[Drive] Đang phát video</b>",
            "item_download": "⬇️ <b>[Drive] Tải xuống tệp</b>",
            "zip_download": "📦 <b>[Drive] Tải toàn bộ (.zip)</b>",
            "item_neac": "🏛️ <b>[Drive] Thẩm định chữ ký số NEAC</b>",
            "passcode_ok": "🔓 <b>[Drive] Mở khóa mã PIN thành công</b>",
            "passcode_fail": "⚠️ <b>[Drive] Nhập sai mã PIN</b>",
        }
        header = action_headers.get(
            log_row.action, f"📂 <b>[Drive] {_esc_html(log_row.action)}</b>"
        )

        root_folder = share.folder if (share and share.folder is not None) else folder
        customer_name = (
            folder.customer_name
            or root_folder.customer_name
            or (root_folder.customer.name if root_folder.customer else "")
        )

        lines = [
            header,
            f"🗂️ <b>{_esc_html(root_folder.name)}</b>",
        ]
        if folder.id != root_folder.id:
            crumbs = build_breadcrumbs(db, folder, stop_at_folder_id=root_folder.id)
            sub_path = (
                " / ".join(c["name"] for c in crumbs[1:])
                if len(crumbs) > 1
                else folder.name
            )
            lines.append(f"📁 Thư mục con: <b>{_esc_html(sub_path)}</b>")
        if customer_name:
            lines.append(f"🏢 {_esc_html(customer_name)}")
        if share and share.label:
            lines.append(f"🏷️ {_esc_html(share.label)}")
        if log_row.item_name and log_row.action != "subfolder_open":
            lines.append(f"📄 Tệp: <b>{_esc_html(log_row.item_name)}</b>")
        elif log_row.item_name and folder.id == root_folder.id:
            lines.append(f"📁 <b>{_esc_html(log_row.item_name)}</b>")

        lines.append("")
        if log_row.ip:
            lines.append(f"🌐 IP: <b>{_esc_html(log_row.ip)}</b>")

        geo_parts = [p for p in (log_row.city, log_row.region, log_row.isp) if p]
        dev_raw = (log_row.device_type or "").strip().lower()
        device_icon = "📱" if dev_raw == "mobile" else "🖥️"
        if dev_raw == "mobile":
            device_label = "Mobile"
        elif dev_raw == "desktop":
            device_label = "Desktop"
        elif log_row.device_type:
            device_label = log_row.device_type.capitalize()
        else:
            device_label = "Desktop"

        if geo_parts:
            lines.append(
                f"📍 {_esc_html(' · '.join(geo_parts))} · {device_icon} {_esc_html(device_label)}"
            )
        else:
            lines.append(f"{device_icon} {_esc_html(device_label)}")

        ts_str = (
            (_as_utc(log_row.created_at) + timedelta(hours=7)).strftime("%H:%M:%S %d/%m/%Y")
            if log_row.created_at
            else ""
        )
        if ts_str:
            lines.append(f"⏰ {ts_str}")
        lines.append("")
        base_url = settings.public_base_url.rstrip("/")
        lines.append(f'🔗 <a href="{base_url}/drive">Mở quản trị Drive KSP</a>')

        body = "\n".join(lines)
        client = TelegramClient(settings)
        try:
            for cid in chat_ids:
                try:
                    client.send_message(cid, body, parse_mode="HTML")
                except TelegramError:
                    continue
        finally:
            client.close()
    except Exception:
        logger.exception("Failed to send Drive Telegram alert")
    finally:
        gen.close()


def generate_share_qr_svg(url: str) -> bytes:
    """Generate clean XML SVG QR code for a Drive share URL."""
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=8,
        border=2,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(image_factory=qrcode.image.svg.SvgPathImage)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue()


def export_access_logs_csv(rows: list[dict[str, Any]]) -> bytes:
    """Render access log rows as UTF-8 BOM CSV for Excel handover audit."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "Thời gian (UTC)",
            "Hành động",
            "Nhãn liên kết",
            "Tên tệp",
            "IP",
            "Thành phố",
            "Tỉnh/Vùng",
            "Nhà mạng (ISP)",
            "Quốc gia",
            "Thiết bị",
        ]
    )
    for r in rows:
        writer.writerow(
            [
                r.get("created_at") or "",
                r.get("action") or "",
                r.get("share_label") or "",
                r.get("item_name") or "",
                r.get("ip") or "",
                r.get("city") or "",
                r.get("region") or "",
                r.get("isp") or "",
                r.get("country_code") or "",
                r.get("device_type") or "",
            ]
        )
    return ("\ufeff" + buf.getvalue()).encode("utf-8")


# ---------------------------------------------------------------------------
# Share creation/update helpers
# ---------------------------------------------------------------------------
def parse_share_expiry(
    *,
    expires_days: int | None = None,
    expires_at: str | None = None,
) -> datetime | None:
    if expires_at is not None and str(expires_at).strip():
        raw = str(expires_at).strip()
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError as exc:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Định dạng ngày hết hạn expires_at không hợp lệ (dùng ISO-8601)",
            ) from exc
        dt_utc = _as_utc(dt)
        max_dt = utc_now() + timedelta(days=MAX_SHARE_DAYS + 1)
        if dt_utc > max_dt:
            dt_utc = utc_now() + timedelta(days=MAX_SHARE_DAYS)
        return dt_utc.replace(tzinfo=None)

    if expires_days is not None:
        days = max(1, min(int(expires_days), MAX_SHARE_DAYS))
        return (utc_now() + timedelta(days=days)).replace(tzinfo=None)
    return None


def validate_passcode(raw: str | None) -> str:
    pw = (raw or "").strip()
    if not pw:
        return ""
    if len(pw) < 4 or len(pw) > 64:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Mã truy cập phải có từ 4 đến 64 ký tự",
        )
    return hash_password(pw)
