"""Streaming disk-backed storage, WebP thumbnails, chunked uploads & safe ZIP builder for Drive.

Security & performance invariants:
- Assets stored strictly under ``data_path/drive/{uuid_hex}{ext}``
- WebP thumbnails stored strictly under ``data_path/drive_thumbs/{uuid_hex}.webp``
- Chunked uploads & temporary ZIPs under ``data_path/drive_tmp/``
- Strict hex ID validation + extension allowlist + dangerous extension hard-block + magic bytes check
- Zero full-file RAM buffering: 64 KB chunk streaming for upload, chunk stitching, and ZIP creation
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import re
import shutil
import time
import uuid
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

from fastapi import HTTPException, UploadFile, status
from PIL import Image, ImageOps, UnidentifiedImageError

from .config import get_settings

logger = logging.getLogger("ksp.drive.storage")

CHUNK_READ_SIZE = 65536  # 64 KB streaming block
MAX_DIRECT_UPLOAD_BYTES = 100 * 1024 * 1024  # 100 MB default per direct multipart file
MAX_DIRECT_VIDEO_BYTES = 512 * 1024 * 1024  # 512 MB direct MP4 upload
MAX_CHUNK_BYTES = 16 * 1024 * 1024  # 16 MB per chunk (safely under Nginx 50 MB limit)
MIN_CHUNK_BYTES = 1024  # 1 KB min (allows fast tests)
DEFAULT_CHUNK_BYTES = 16 * 1024 * 1024
MAX_CHUNKED_TOTAL_BYTES = 2 * 1024 * 1024 * 1024  # 2 GB
CHUNK_UPLOAD_TTL_SECONDS = 6 * 3600  # 6 hours

MAX_ZIP_FILES = 500
MAX_ZIP_BYTES = 2 * 1024 * 1024 * 1024  # 2 GB

THUMB_MAX_DIM = 480
THUMB_WEBP_QUALITY = 82

_HEX_ID_RE = re.compile(r"^[0-9a-f]{32}$")
_SAFE_ARC_SEGMENT_RE = re.compile(r"[^A-Za-z0-9À-ỹ._() -]+")

ALLOWED_EXTS: dict[str, str] = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".md": "text/markdown; charset=utf-8",
    ".xml": "application/xml",
    ".zip": "application/zip",
}

BLOCKED_EXTS: frozenset[str] = frozenset(
    {
        ".html",
        ".htm",
        ".xhtml",
        ".svg",
        ".svgz",
        ".js",
        ".mjs",
        ".cjs",
        ".jsx",
        ".ts",
        ".tsx",
        ".exe",
        ".dll",
        ".bat",
        ".cmd",
        ".ps1",
        ".sh",
        ".bash",
        ".zsh",
        ".php",
        ".phtml",
        ".py",
        ".rb",
        ".pl",
        ".jar",
        ".msi",
        ".com",
        ".scr",
        ".vbs",
        ".hta",
    }
)

IMAGE_EXTS: frozenset[str] = frozenset({".png", ".jpg", ".jpeg", ".webp"})
VIDEO_EXTS: frozenset[str] = frozenset({".mp4"})
OFFICE_EXTS: frozenset[str] = frozenset({".docx", ".xlsx", ".xls", ".md"})
ZIP_STORED_EXTS: frozenset[str] = frozenset(
    {".mp4", ".png", ".jpg", ".jpeg", ".webp", ".pdf", ".zip"}
)


@dataclass
class StoredDriveFile:
    storage_doc_id: str
    thumb_doc_id: str
    file_ext: str
    mime_type: str
    file_size: int
    sha256: str
    media_meta: dict = field(default_factory=dict)


def _drive_dir() -> Path:
    d = get_settings().data_path / "drive"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _thumbs_dir() -> Path:
    d = get_settings().data_path / "drive_thumbs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _tmp_dir() -> Path:
    d = get_settings().data_path / "drive_tmp"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _validate_hex_id(doc_id: str, label: str = "storage_doc_id") -> str:
    if not isinstance(doc_id, str) or not _HEX_ID_RE.fullmatch(doc_id):
        raise ValueError(f"{label} khong hop le")
    return doc_id


def validate_filename_extension(filename: str) -> str:
    """Validate and return normalized lowercase extension from filename."""
    clean_name = Path((filename or "").replace("\\", "/")).name.strip()
    if not clean_name:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Tên tệp không hợp lệ",
        )
    ext = Path(clean_name).suffix.lower()
    if ext in BLOCKED_EXTS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Định dạng tệp '{ext}' bị chặn vì lý do bảo mật",
        )
    if ext not in ALLOWED_EXTS:
        allowed_list = ", ".join(sorted(ALLOWED_EXTS.keys()))
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Định dạng tệp '{ext or '(không có)'}' không được hỗ trợ. Hỗ trợ: {allowed_list}",
        )
    return ext


def mime_for_ext(ext: str) -> str:
    return ALLOWED_EXTS.get((ext or "").lower(), "application/octet-stream")


def file_category_for_ext(ext: str) -> str:
    e = (ext or "").lower()
    if e == ".pdf":
        return "pdf"
    if e in IMAGE_EXTS:
        return "image"
    if e in VIDEO_EXTS:
        return "video"
    if e in OFFICE_EXTS:
        return "office"
    return "other"


def validate_magic_bytes(head: bytes, ext: str) -> None:
    """Verify actual binary file header matches the declared whitelisted extension.

    Hard-blocks disguised HTML/SVG/JS/script payloads even when renamed to an allowed ext.
    """
    if not head:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Tệp trống (0 byte)")

    e = (ext or "").lower()
    stripped_bom = head.lstrip(b"\xef\xbb\xbf")
    lower_lead = stripped_bom.lstrip()[:256].lower()

    # Reject obvious scriptable HTML/SVG/JS masquerading as text/xml/media
    if e in {".md", ".xml"}:
        if (
            lower_lead.startswith(b"<!doctype html")
            or lower_lead.startswith(b"<html")
            or lower_lead.startswith(b"<svg")
            or lower_lead.startswith(b"<script")
            or b"<script" in stripped_bom[:4096].lower()
        ):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Nội dung tệp chứa thẻ HTML/SVG/Script bị chặn vì lý do bảo mật",
            )

    if e == ".pdf":
        if not stripped_bom.startswith(b"%PDF"):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Tệp PDF không hợp lệ (sai chữ ký định dạng %PDF)",
            )
    elif e == ".png":
        if not head.startswith(b"\x89PNG\r\n\x1a\n"):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Tệp ảnh PNG không hợp lệ (sai định dạng đầu tệp)",
            )
    elif e in {".jpg", ".jpeg"}:
        if not head.startswith(b"\xff\xd8\xff"):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Tệp ảnh JPEG không hợp lệ (sai định dạng đầu tệp)",
            )
    elif e == ".webp":
        if len(head) < 12 or head[:4] != b"RIFF" or head[8:12] != b"WEBP":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Tệp ảnh WebP không hợp lệ (sai định dạng RIFF/WEBP)",
            )
    elif e == ".mp4":
        if len(head) < 12 or head[4:8] != b"ftyp":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Tệp video MP4 không hợp lệ (thiếu box ftyp chuẩn ISO BMFF)",
            )
    elif e in {".docx", ".xlsx", ".zip"}:
        if not head.startswith((b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08")):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"Tệp {e} không hợp lệ (sai chữ ký cấu trúc ZIP/OOXML)",
            )
    elif e == ".xls":
        if not (
            head.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")
            or head.startswith(b"PK\x03\x04")
        ):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Tệp Excel .xls không hợp lệ (sai chữ ký OLE2/OOXML)",
            )
    elif e == ".xml":
        if not (lower_lead.startswith(b"<?xml") or lower_lead.startswith(b"<")):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Tệp XML không hợp lệ",
            )
        if b"<!entity" in stripped_bom[:4096].lower():
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Tệp XML chứa khai báo ENTITY không được phép",
            )
    elif e == ".md":
        if b"\x00" in head[:1024]:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Tệp Markdown không hợp lệ (chứa dữ liệu nhị phân)",
            )
        try:
            head[:1024].decode("utf-8", errors="strict")
        except UnicodeDecodeError:
            # Trim potentially truncated multibyte sequence at the 1024 boundary
            try:
                head[:1020].decode("utf-8", errors="strict")
            except UnicodeDecodeError as exc:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    "Tệp Markdown phải có bảng mã UTF-8 hợp lệ",
                ) from exc
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Định dạng tệp không được hỗ trợ")


def asset_path_for(storage_doc_id: str, ext: str) -> Path:
    """Resolve and strictly confine a Drive asset path under data_path/drive/."""
    clean_id = _validate_hex_id(storage_doc_id, "storage_doc_id")
    clean_ext = (ext or "").strip().lower()
    if clean_ext not in ALLOWED_EXTS:
        raise ValueError("ext khong hop le")
    base = _drive_dir().resolve()
    target = (base / f"{clean_id}{clean_ext}").resolve()
    try:
        target.relative_to(base)
    except ValueError as exc:
        raise ValueError("duong dan khong hop le") from exc
    return target


def find_asset_path(storage_doc_id: str, ext: str = "") -> tuple[Path, str] | None:
    """Locate an existing Drive asset safely."""
    try:
        clean_id = _validate_hex_id(storage_doc_id, "storage_doc_id")
    except ValueError:
        return None
    if ext:
        try:
            p = asset_path_for(clean_id, ext)
            if p.is_file():
                return p, ext.lower()
        except ValueError:
            return None
    base = _drive_dir().resolve()
    for match in base.glob(f"{clean_id}.*"):
        try:
            resolved = match.resolve()
            resolved.relative_to(base)
            if resolved.is_file() and resolved.suffix.lower() in ALLOWED_EXTS:
                return resolved, resolved.suffix.lower()
        except (OSError, ValueError):
            continue
    return None


def thumb_path_for(thumb_doc_id: str) -> Path:
    """Resolve and strictly confine a Drive thumbnail path under data_path/drive_thumbs/."""
    clean_id = _validate_hex_id(thumb_doc_id, "thumb_doc_id")
    base = _thumbs_dir().resolve()
    target = (base / f"{clean_id}.webp").resolve()
    try:
        target.relative_to(base)
    except ValueError as exc:
        raise ValueError("duong dan thumbnail khong hop le") from exc
    return target


def find_thumb_path(thumb_doc_id: str) -> Path | None:
    if not thumb_doc_id:
        return None
    try:
        p = thumb_path_for(thumb_doc_id)
    except ValueError:
        return None
    return p if p.is_file() else None


def delete_asset_file(storage_doc_id: str) -> bool:
    """Safely delete all Drive asset files matching storage_doc_id."""
    try:
        clean_id = _validate_hex_id(storage_doc_id, "storage_doc_id")
    except ValueError:
        return False
    base = _drive_dir().resolve()
    removed = False
    for match in base.glob(f"{clean_id}.*"):
        try:
            resolved = match.resolve()
            resolved.relative_to(base)
            if resolved.is_file():
                resolved.unlink()
                removed = True
        except (OSError, ValueError):
            continue
    return removed


def delete_thumb_file(thumb_doc_id: str) -> bool:
    """Safely delete a Drive WebP thumbnail file."""
    p = find_thumb_path(thumb_doc_id)
    if not p:
        return False
    try:
        p.unlink()
        return True
    except OSError:
        return False


def generate_webp_thumbnail(src_path: Path, thumb_doc_id: str | None = None) -> tuple[str, dict]:
    """Generate a <=480px WebP thumbnail from an image file and extract dimensions.

    Returns ``(thumb_doc_id, {"width": w, "height": h})``.
    Raises HTTP 400 if the file is not a valid image decodable by Pillow.
    """
    tid = _validate_hex_id(thumb_doc_id, "thumb_doc_id") if thumb_doc_id else uuid.uuid4().hex
    dest = thumb_path_for(tid)
    tmp_dest = dest.with_suffix(".webp.part")
    try:
        with Image.open(src_path) as img:
            img = ImageOps.exif_transpose(img)
            orig_w, orig_h = img.size
            meta = {"width": int(orig_w), "height": int(orig_h)}
            thumb = img.copy()
            thumb.thumbnail((THUMB_MAX_DIM, THUMB_MAX_DIM), Image.Resampling.LANCZOS)
            if thumb.mode not in ("RGB", "RGBA"):
                thumb = thumb.convert("RGBA" if "A" in thumb.getbands() else "RGB")
            thumb.save(tmp_dest, format="WEBP", quality=THUMB_WEBP_QUALITY, method=4)
        os.replace(tmp_dest, dest)
        return tid, meta
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        try:
            if tmp_dest.exists():
                tmp_dest.unlink()
        except OSError:
            pass
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Không thể đọc dữ liệu ảnh (tệp ảnh bị lỗi hoặc không hợp lệ)",
        ) from exc


def ensure_thumbnail_for_existing_image(src_path: Path, cache_seed: str) -> Path | None:
    """Generate/reuse a deterministic WebP thumbnail for an attached Document image."""
    if not src_path.is_file():
        return None
    tid = hashlib.sha256(f"doc_thumb:{cache_seed}".encode("utf-8")).hexdigest()[:32]
    existing = find_thumb_path(tid)
    if existing:
        return existing
    try:
        generate_webp_thumbnail(src_path, thumb_doc_id=tid)
        return find_thumb_path(tid)
    except HTTPException:
        return None


def _finalize_saved_file(
    tmp_path: Path,
    storage_doc_id: str,
    ext: str,
    total_bytes: int,
    sha256_hex: str,
) -> StoredDriveFile:
    final_path = asset_path_for(storage_doc_id, ext)
    os.replace(tmp_path, final_path)

    thumb_doc_id = ""
    media_meta: dict = {}
    if ext in IMAGE_EXTS:
        try:
            thumb_doc_id, media_meta = generate_webp_thumbnail(final_path)
        except HTTPException:
            try:
                final_path.unlink(missing_ok=True)
            except OSError:
                pass
            raise

    return StoredDriveFile(
        storage_doc_id=storage_doc_id,
        thumb_doc_id=thumb_doc_id,
        file_ext=ext,
        mime_type=mime_for_ext(ext),
        file_size=total_bytes,
        sha256=sha256_hex,
        media_meta=media_meta,
    )


async def stream_upload_to_drive(
    upload: UploadFile,
    *,
    filename: str | None = None,
    max_bytes: int | None = None,
) -> StoredDriveFile:
    """Stream an UploadFile directly to disk in 64 KB chunks with incremental SHA-256."""
    orig_name = (filename or upload.filename or "").strip()
    ext = validate_filename_extension(orig_name)
    limit = max_bytes or (
        MAX_DIRECT_VIDEO_BYTES if ext in VIDEO_EXTS else MAX_DIRECT_UPLOAD_BYTES
    )

    storage_doc_id = uuid.uuid4().hex
    tmp_path = _drive_dir().resolve() / f"{storage_doc_id}{ext}.part"
    hasher = hashlib.sha256()
    head_buf = bytearray()
    total_bytes = 0
    magic_checked = False

    try:
        with open(tmp_path, "wb") as out:
            while True:
                chunk = await upload.read(CHUNK_READ_SIZE)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > limit:
                    raise HTTPException(
                        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        f"Tệp tải lên vượt quá giới hạn tối đa ({limit // (1024 * 1024)} MB)",
                    )
                if len(head_buf) < 4096:
                    head_buf.extend(chunk[: 4096 - len(head_buf)])
                    if not magic_checked and len(head_buf) >= 16:
                        validate_magic_bytes(bytes(head_buf), ext)
                        magic_checked = True
                hasher.update(chunk)
                out.write(chunk)

        # Always re-validate full collected header (up to 4096 bytes) at EOF
        validate_magic_bytes(bytes(head_buf), ext)
        return _finalize_saved_file(
            tmp_path, storage_doc_id, ext, total_bytes, hasher.hexdigest()
        )
    except Exception:
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except OSError:
            pass
        raise


# ---------------------------------------------------------------------------
# Chunked Upload Support (init -> chunk <= 16MB -> complete)
# ---------------------------------------------------------------------------
def _upload_session_dir(upload_id: str) -> Path:
    clean_id = _validate_hex_id(upload_id, "upload_id")
    base = _tmp_dir().resolve()
    target = (base / clean_id).resolve()
    try:
        target.relative_to(base)
    except ValueError as exc:
        raise ValueError("duong dan upload khong hop le") from exc
    return target


def cleanup_expired_uploads() -> int:
    """Remove abandoned chunked upload directories older than CHUNK_UPLOAD_TTL_SECONDS."""
    now = time.time()
    removed = 0
    base = _tmp_dir().resolve()
    for entry in base.iterdir():
        if not entry.is_dir() or not _HEX_ID_RE.fullmatch(entry.name):
            continue
        meta_file = entry / "meta.json"
        expired = False
        try:
            if meta_file.is_file():
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
                exp_ts = float(meta.get("expires_ts", 0))
                expired = exp_ts > 0 and now > exp_ts
            else:
                expired = (now - entry.stat().st_mtime) > CHUNK_UPLOAD_TTL_SECONDS
        except Exception:
            expired = True
        if expired:
            shutil.rmtree(entry, ignore_errors=True)
            removed += 1
    return removed


def init_chunked_upload(
    *,
    folder_id: int,
    filename: str,
    file_size: int,
    chunk_size: int | None = None,
    mime_type: str = "",
    section_tag: str = "",
    note: str = "",
    display_name: str = "",
    created_by: int | None = None,
) -> dict:
    """Initialize a chunked upload session on disk."""
    cleanup_expired_uploads()
    ext = validate_filename_extension(filename)
    if file_size <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Kích thước tệp phải lớn hơn 0")
    if file_size > MAX_CHUNKED_TOTAL_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            "Tệp vượt quá giới hạn tối đa 2 GB",
        )

    eff_chunk = chunk_size or DEFAULT_CHUNK_BYTES
    eff_chunk = max(MIN_CHUNK_BYTES, min(MAX_CHUNK_BYTES, int(eff_chunk)))
    total_chunks = max(1, math.ceil(file_size / eff_chunk))
    if total_chunks > 2048:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Số phân mảnh quá lớn (vui lòng tăng kích thước mỗi chunk)",
        )

    upload_id = uuid.uuid4().hex
    sess_dir = _upload_session_dir(upload_id)
    sess_dir.mkdir(parents=True, exist_ok=True)

    expires_dt = datetime.now(timezone.utc) + timedelta(seconds=CHUNK_UPLOAD_TTL_SECONDS)
    clean_orig = Path((filename or "").replace("\\", "/")).name.strip()
    meta = {
        "upload_id": upload_id,
        "folder_id": int(folder_id),
        "filename": clean_orig,
        "display_name": (display_name or clean_orig).strip(),
        "file_ext": ext,
        "mime_type": mime_type or mime_for_ext(ext),
        "file_size": int(file_size),
        "chunk_size": eff_chunk,
        "total_chunks": total_chunks,
        "section_tag": (section_tag or "").strip()[:64],
        "note": (note or "").strip()[:1000],
        "created_by": created_by,
        "expires_at": expires_dt.isoformat(),
        "expires_ts": expires_dt.timestamp(),
    }
    (sess_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return {
        "upload_id": upload_id,
        "chunk_size": eff_chunk,
        "total_chunks": total_chunks,
        "expires_at": meta["expires_at"],
    }


def load_chunked_meta(upload_id: str) -> tuple[Path, dict]:
    try:
        sess_dir = _upload_session_dir(upload_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Phiên tải lên không tồn tại") from exc
    meta_path = sess_dir / "meta.json"
    if not meta_path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Phiên tải lên không tồn tại hoặc đã hết hạn")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if time.time() > float(meta.get("expires_ts", 0)):
        shutil.rmtree(sess_dir, ignore_errors=True)
        raise HTTPException(status.HTTP_410_GONE, "Phiên tải lên đã hết hạn")
    return sess_dir, meta


async def write_upload_chunk_stream(
    upload_id: str,
    index: int,
    byte_iter,
) -> dict:
    """Write a single chunk (<= 16 MB) directly to disk from an async byte iterator."""
    sess_dir, meta = load_chunked_meta(upload_id)
    total_chunks = int(meta["total_chunks"])
    if index < 0 or index >= total_chunks:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Chỉ số phân mảnh không hợp lệ (0..{total_chunks - 1})",
        )

    chunk_file = sess_dir / f"chunk_{index:06d}.part"
    tmp_chunk = sess_dir / f"chunk_{index:06d}.writing"
    hasher = hashlib.sha256()
    received = 0
    max_allowed = min(MAX_CHUNK_BYTES, int(meta["chunk_size"]) + 1024 * 1024)

    try:
        with open(tmp_chunk, "wb") as out:
            async for piece in byte_iter:
                if not piece:
                    continue
                received += len(piece)
                if received > max_allowed:
                    raise HTTPException(
                        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        "Phân mảnh vượt quá kích thước cho phép (tối đa 16 MB)",
                    )
                hasher.update(piece)
                out.write(piece)
        if received <= 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Phân mảnh trống (0 byte)")
        os.replace(tmp_chunk, chunk_file)
    except Exception:
        try:
            tmp_chunk.unlink(missing_ok=True)
        except OSError:
            pass
        raise

    return {
        "upload_id": upload_id,
        "index": index,
        "bytes_received": received,
        "sha256": hasher.hexdigest(),
    }


def complete_chunked_upload(
    upload_id: str,
    *,
    expected_sha256: str = "",
) -> tuple[StoredDriveFile, dict]:
    """Assemble all uploaded chunks in 64 KB blocks, validate magic bytes & SHA-256."""
    sess_dir, meta = load_chunked_meta(upload_id)
    total_chunks = int(meta["total_chunks"])
    ext = meta["file_ext"]

    chunk_paths: list[Path] = []
    missing: list[int] = []
    for idx in range(total_chunks):
        cp = sess_dir / f"chunk_{idx:06d}.part"
        if not cp.is_file():
            missing.append(idx)
        else:
            chunk_paths.append(cp)
    if missing:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Thiếu phân mảnh tải lên: {missing[:10]}",
        )

    storage_doc_id = uuid.uuid4().hex
    tmp_path = _drive_dir().resolve() / f"{storage_doc_id}{ext}.part"
    hasher = hashlib.sha256()
    head_buf = bytearray()
    total_bytes = 0
    magic_checked = False

    try:
        with open(tmp_path, "wb") as out:
            for cp in chunk_paths:
                with open(cp, "rb") as src:
                    while True:
                        block = src.read(CHUNK_READ_SIZE)
                        if not block:
                            break
                        total_bytes += len(block)
                        if total_bytes > MAX_CHUNKED_TOTAL_BYTES:
                            raise HTTPException(
                                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                                "Tổng dung lượng tệp vượt quá 2 GB",
                            )
                        if len(head_buf) < 4096:
                            head_buf.extend(block[: 4096 - len(head_buf)])
                            if not magic_checked and len(head_buf) >= 16:
                                validate_magic_bytes(bytes(head_buf), ext)
                                magic_checked = True
                        hasher.update(block)
                        out.write(block)

        # Always re-validate full collected header (up to 4096 bytes) across chunk boundaries
        validate_magic_bytes(bytes(head_buf), ext)

        digest = hasher.hexdigest()
        exp_clean = (expected_sha256 or "").strip().lower()
        if exp_clean and digest != exp_clean:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Mã kiểm tra SHA-256 không khớp sau khi ghép tệp",
            )

        stored = _finalize_saved_file(tmp_path, storage_doc_id, ext, total_bytes, digest)
        shutil.rmtree(sess_dir, ignore_errors=True)
        return stored, meta
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------------------
# Memory-safe Disk-backed Streaming ZIP Builder
# ---------------------------------------------------------------------------
def sanitize_zip_segment(segment: str, fallback: str = "item") -> str:
    clean = Path((segment or "").replace("\\", "/")).name.strip()
    clean = clean.replace("\x00", "").strip(". ")
    clean = _SAFE_ARC_SEGMENT_RE.sub("_", clean)[:180].strip(". ")
    if not clean or clean in {".", ".."}:
        return fallback
    return clean


def build_zip_arcname(folder_parts: Iterable[str], filename: str, fallback: str) -> str:
    """Build a safe, traversal-free archive member path."""
    safe_parts = [sanitize_zip_segment(p, "folder") for p in folder_parts if (p or "").strip()]
    safe_name = sanitize_zip_segment(filename, fallback)
    return "/".join([*safe_parts, safe_name]) if safe_parts else safe_name


def build_drive_zip_file(
    entries: list[tuple[list[str], str, Path, str]],
) -> tuple[Path, int, int]:
    """Stream files into a temporary disk-backed ZIP archive (RAM < 10 MB).

    Each entry is ``(rel_folder_parts, display_filename, physical_path, file_ext)``.
    Uses ``ZIP_STORED`` for already-compressed media/PDF/ZIP and ``ZIP_DEFLATED`` for text/XML/Office.
    Returns ``(temp_zip_path, file_count, total_source_bytes)``.
    """
    if not entries:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Thư mục chưa có tệp nào để tải xuống")

    if len(entries) > MAX_ZIP_FILES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"Thư mục vượt quá giới hạn nén ZIP ({MAX_ZIP_FILES} tệp)",
        )

    total_src_bytes = 0
    valid_entries: list[tuple[list[str], str, Path, str, int]] = []
    for folder_parts, display_name, src_path, ext in entries:
        if not src_path.is_file():
            continue
        fsize = src_path.stat().st_size
        total_src_bytes += fsize
        if total_src_bytes > MAX_ZIP_BYTES:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                "Tổng dung lượng vượt quá giới hạn nén ZIP (2 GB)",
            )
        valid_entries.append((folder_parts, display_name, src_path, (ext or src_path.suffix).lower(), fsize))

    if not valid_entries:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy tệp vật lý nào để đóng gói ZIP")

    tmp_zip = _tmp_dir().resolve() / f"zip_{uuid.uuid4().hex}.zip"
    used_arcnames: set[str] = set()

    try:
        with zipfile.ZipFile(tmp_zip, mode="w", allowZip64=True) as zf:
            for idx, (folder_parts, display_name, src_path, ext, _fsize) in enumerate(valid_entries, start=1):
                fallback = f"file_{idx}{ext}"
                fname = display_name or fallback
                if ext and not fname.lower().endswith(ext):
                    fname = f"{fname}{ext}"
                arc = build_zip_arcname(folder_parts, fname, fallback)
                # Deduplicate colliding arcnames cleanly
                if arc.lower() in used_arcnames:
                    p_arc = Path(arc)
                    stem, suf = p_arc.stem, p_arc.suffix
                    parent_str = str(p_arc.parent)
                    n = 2
                    while True:
                        cand_name = f"{stem} ({n}){suf}"
                        cand = f"{parent_str}/{cand_name}" if parent_str not in ("", ".") else cand_name
                        if cand.lower() not in used_arcnames:
                            arc = cand
                            break
                        n += 1
                used_arcnames.add(arc.lower())

                compress_type = (
                    zipfile.ZIP_STORED if ext in ZIP_STORED_EXTS else zipfile.ZIP_DEFLATED
                )
                zi = zipfile.ZipInfo(filename=arc)
                zi.compress_type = compress_type
                zi.date_time = time.localtime(src_path.stat().st_mtime)[:6]
                with zf.open(zi, mode="w", force_zip64=True) as dst, open(src_path, "rb") as src:
                    while True:
                        block = src.read(CHUNK_READ_SIZE)
                        if not block:
                            break
                        dst.write(block)
        return tmp_zip, len(valid_entries), total_src_bytes
    except Exception:
        try:
            tmp_zip.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def cleanup_temp_file(path: Path) -> None:
    """BackgroundTask helper to remove a temporary ZIP file after FileResponse completes."""
    try:
        resolved = path.resolve()
        resolved.relative_to(_tmp_dir().resolve())
        resolved.unlink(missing_ok=True)
    except (OSError, ValueError):
        pass
