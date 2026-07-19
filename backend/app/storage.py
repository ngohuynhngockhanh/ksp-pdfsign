"""Luu tru tam file PDF theo doc_id trong thu muc data."""
from __future__ import annotations

import uuid
from pathlib import Path

from .config import get_settings


def _docs_dir() -> Path:
    d = get_settings().data_path / "docs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_upload(content: bytes, suffix: str = ".pdf") -> str:
    """Luu file, tra ve doc_id."""
    doc_id = uuid.uuid4().hex
    (_docs_dir() / f"{doc_id}{suffix}").write_bytes(content)
    return doc_id


def path_for(doc_id: str, suffix: str = ".pdf") -> Path:
    # Chan path traversal: doc_id phai la hex.
    if not doc_id.isalnum():
        raise ValueError("doc_id khong hop le")
    return _docs_dir() / f"{doc_id}{suffix}"


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
