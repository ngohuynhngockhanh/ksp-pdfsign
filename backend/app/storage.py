"""Luu tru tam file PDF theo doc_id trong thu muc data."""
from __future__ import annotations

import re
import uuid
from pathlib import Path

from fastapi import HTTPException, status

from .config import get_settings

_SUFFIX_RE = re.compile(r"^\.[a-z0-9]{1,8}$")
_UPLOAD_CHUNK_SIZE = 65536


def _docs_dir() -> Path:
    d = get_settings().data_path / "docs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _validate_suffix(suffix: str) -> str:
    if not isinstance(suffix, str):
        raise ValueError("suffix khong hop le")
    clean = suffix.strip().lower()
    if not _SUFFIX_RE.fullmatch(clean):
        raise ValueError("suffix khong hop le")
    return clean


def save_upload(content: bytes, suffix: str = ".pdf") -> str:
    """Luu file, tra ve doc_id."""
    clean_suffix = _validate_suffix(suffix)
    doc_id = uuid.uuid4().hex
    (_docs_dir() / f"{doc_id}{clean_suffix}").write_bytes(content)
    return doc_id


def path_for(doc_id: str, suffix: str = ".pdf") -> Path:
    # Chan path traversal: doc_id phai la hex va suffix phai khop ^[a-z0-9]{1,8}$.
    if not isinstance(doc_id, str) or not doc_id or not doc_id.isalnum():
        raise ValueError("doc_id khong hop le")
    clean_suffix = _validate_suffix(suffix)
    base = _docs_dir().resolve()
    target = (base / f"{doc_id}{clean_suffix}").resolve()
    try:
        target.relative_to(base)
    except ValueError as exc:
        raise ValueError("duong dan khong hop le") from exc
    return target


def find_doc_path(doc_id: str) -> tuple[Path, str] | None:
    """Tim file trong thu muc docs theo doc_id ma khong can biet truoc phan mo rong."""
    if not isinstance(doc_id, str) or not doc_id or not doc_id.isalnum():
        return None
    d = _docs_dir()
    p_pdf = d / f"{doc_id}.pdf"
    if p_pdf.exists():
        return p_pdf, ".pdf"
    matches = list(d.glob(f"{doc_id}.*"))
    if matches and matches[0].exists():
        return matches[0], matches[0].suffix.lower()
    return None


def read_doc_any(doc_id: str) -> tuple[bytes, str]:
    """Doc noi dung va tra ve (content, suffix)."""
    res = find_doc_path(doc_id)
    if not res:
        raise FileNotFoundError(f"Khong tim thay tai lieu {doc_id}")
    path, suffix = res
    return path.read_bytes(), suffix


def read_doc(doc_id: str, suffix: str = ".pdf") -> bytes:
    return path_for(doc_id, suffix).read_bytes()


def write_doc(doc_id: str, content: bytes, suffix: str = ".pdf") -> Path:
    p = path_for(doc_id, suffix)
    p.write_bytes(content)
    return p


def exists(doc_id: str, suffix: str = ".pdf") -> bool:
    try:
        return path_for(doc_id, suffix).exists()
    except ValueError:
        return False


def delete_doc_any(doc_id: str) -> bool:
    """Xoa toan bo file vat ly trong thu muc docs khop doc_id (best-effort an toan)."""
    if not isinstance(doc_id, str) or not doc_id or not doc_id.isalnum():
        return False
    base = _docs_dir().resolve()
    removed = False
    for match in base.glob(f"{doc_id}.*"):
        try:
            resolved = match.resolve()
            resolved.relative_to(base)
            if resolved.is_file():
                resolved.unlink()
                removed = True
        except (OSError, ValueError):
            continue
    return removed


async def read_upload_limited(upload, max_bytes: int = 25 * 1024 * 1024) -> bytes:
    """Doc UploadFile theo tung khoi 64KB, chan OOM va tra HTTP 413 ngay khi vuot gioi han."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(_UPLOAD_CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Tệp tải lên vượt quá giới hạn tối đa ({max_bytes // (1024 * 1024)} MB)",
            )
        chunks.append(chunk)
    return b"".join(chunks)


def read_upload_limited_sync(upload, max_bytes: int = 25 * 1024 * 1024) -> bytes:
    """Ban dong bo cua read_upload_limited cho route def (doc truc tiep tu upload.file)."""
    chunks: list[bytes] = []
    total = 0
    stream = upload.file
    while True:
        chunk = stream.read(_UPLOAD_CHUNK_SIZE)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Tệp tải lên vượt quá giới hạn tối đa ({max_bytes // (1024 * 1024)} MB)",
            )
        chunks.append(chunk)
    return b"".join(chunks)
