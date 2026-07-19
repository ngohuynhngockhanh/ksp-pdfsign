r"""Dong bo ho so len NAS qua SMB (1 chieu, backup). Dung smbprotocol/smbclient.

Sap xep theo khach hang: \\host\share\{base}\{ten khach}\{file}. Ho so chua
phan loai vao thu muc _chua-phan-loai. Loi NAS KHONG lam hong viec ky (best-effort).
"""
from __future__ import annotations

from datetime import datetime, timezone

import smbclient

from . import storage
from .config import Settings

_registered_host: str | None = None
_last_error: str = ""

_ILLEGAL = set('\\/:*?"<>|')


class NasDisabled(RuntimeError):
    pass


class NasError(RuntimeError):
    pass


_MAX_READ = 100 * 1024 * 1024  # 100MB


def _safe_relpath(relpath: str) -> str:
    """Chuan hoa duong dan tuong doi trong share, chan .. (path traversal)."""
    relpath = (relpath or "").replace("/", "\\").strip("\\")
    parts = []
    for seg in relpath.split("\\"):
        seg = seg.strip()
        if seg in ("", "."):
            continue
        if seg == "..":
            raise NasError("Duong dan khong hop le")
        parts.append(seg)
    return "\\".join(parts)


def list_dir(settings: Settings, relpath: str = ""):
    """Liet ke 1 thu muc trong share. Tra ve (rel, [ {name,is_dir,size} ])."""
    _ensure_session(settings)
    rel = _safe_relpath(relpath)
    full = _root(settings) + ("\\" + rel if rel else "")
    entries = []
    for e in smbclient.scandir(full):
        try:
            size = 0 if e.is_dir() else e.stat().st_size
        except Exception:  # noqa: BLE001
            size = 0
        entries.append({"name": e.name, "is_dir": e.is_dir(), "size": size})
    entries.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
    return rel, entries


def read_file(settings: Settings, relpath: str) -> bytes:
    _ensure_session(settings)
    rel = _safe_relpath(relpath)
    if not rel:
        raise NasError("Thieu duong dan file")
    full = _root(settings) + "\\" + rel
    with smbclient.open_file(full, mode="rb") as f:
        data = f.read(_MAX_READ + 1)
    if len(data) > _MAX_READ:
        raise NasError("File qua lon de xem (>100MB), hay tai bang cong cu khac")
    return data


def _ensure_session(settings: Settings) -> None:
    global _registered_host
    if not settings.nas_enabled:
        raise NasDisabled("NAS dang tat (NAS_ENABLED=false)")
    if _registered_host != settings.nas_host:
        smbclient.register_session(
            settings.nas_host,
            username=settings.nas_user,
            password=settings.nas_password,
            connection_timeout=settings.nas_timeout,
        )
        _registered_host = settings.nas_host


def _base(settings: Settings) -> str:
    return rf"\\{settings.nas_host}\{settings.nas_share}"


def _root(settings: Settings) -> str:
    """Goc duyet NAS: chi trong thu muc ho-so (khong cho xem file khac cua NAS)."""
    return rf"{_base(settings)}\{settings.nas_base_path}"


def _sanitize(name: str) -> str:
    name = "".join("_" if c in _ILLEGAL else c for c in (name or "")).strip().strip(".")
    return name or "_chua-phan-loai"


def remote_path(settings: Settings, customer_name: str, filename: str) -> str:
    folder = _sanitize(customer_name)
    fname = _sanitize(filename) or "document.pdf"
    return rf"{_base(settings)}\{settings.nas_base_path}\{folder}\{fname}"


def test_connection(settings: Settings) -> tuple[bool, str]:
    try:
        _ensure_session(settings)
        smbclient.listdir(_base(settings))
        return True, "Ket noi NAS thanh cong"
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"


def _upload(settings: Settings, path: str, data: bytes) -> None:
    _ensure_session(settings)
    parent = path.rsplit("\\", 1)[0]
    smbclient.makedirs(parent, exist_ok=True)
    with smbclient.open_file(path, mode="wb") as f:
        f.write(data)


def sync_document(settings: Settings, db_session, doc) -> tuple[bool, str]:
    """Day 1 ho so len NAS. Tra ve (ok, path|error). Khong raise ra ngoai."""
    global _last_error
    try:
        data = storage.read_doc(doc.doc_id)
    except Exception as e:  # noqa: BLE001
        _last_error = f"Ho so {doc.id}: khong doc duoc file ({e})"
        return False, _last_error
    cust = doc.customer.name if doc.customer else ""
    target = remote_path(settings, cust, doc.filename)
    try:
        old = doc.nas_path
        if old and old != target:  # doi thu muc -> xoa ban cu
            try:
                smbclient.remove(old)
            except Exception:  # noqa: BLE001
                pass
        _upload(settings, target, data)
        doc.nas_path = target
        doc.nas_synced_at = datetime.now(timezone.utc)
        db_session.commit()
        return True, target
    except Exception as e:  # noqa: BLE001
        _last_error = f"Ho so {doc.id}: {type(e).__name__}: {e}"
        return False, _last_error


def last_error() -> str:
    return _last_error
