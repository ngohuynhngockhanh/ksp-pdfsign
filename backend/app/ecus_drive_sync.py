"""Extract ECUS PDF attachments and copy them to mapped customs Drive folders.

The ECUS database is snapshotted over SCP and opened read-only. This module only
reads ``DCHUNGTU_BS`` attachments; it never opens ECUS, signs a message, or sends
anything to VNACCS.
"""
from __future__ import annotations

import base64
import gzip
import hashlib
import re
import shutil
import sqlite3
import subprocess
import tempfile
import zlib
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Iterator
from urllib.parse import quote
from xml.etree import ElementTree

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import storage
from .config import Settings
from .db import InvCustomsDecl, InvCustomsDriveFolder, InvCustomsEcusExport

_DECLARATION_RE = re.compile(r"(?<!\d)(\d{12})(?!\d)")
_MAX_PDF_BYTES = 50 * 1024 * 1024
_PDF_MAGIC = b"%PDF"


@dataclass(frozen=True)
class EcusPdfArtifact:
    declaration_number: str
    source_row_id: str
    source_time: str
    filename: str
    content: bytes
    sha256: str


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _declaration_numbers(root: ElementTree.Element) -> set[str]:
    refs: set[str] = set()
    for parent in root.iter():
        if _local_name(parent.tag) != "DeclarationDocument":
            continue
        for child in parent:
            if _local_name(child.tag) == "reference":
                refs.update(_DECLARATION_RE.findall(child.text or ""))
    if refs:
        return refs
    raw = ElementTree.tostring(root, encoding="unicode")
    return set(_DECLARATION_RE.findall(raw))


def _pdf_bytes(encoded: str) -> bytes | None:
    value = "".join((encoded or "").split())
    if "," in value and value.lower().startswith("data:"):
        value = value.split(",", 1)[1]
    if not value:
        return None
    try:
        raw = base64.b64decode(value, validate=False)
    except (ValueError, TypeError):
        return None

    candidates = [raw]
    # Some ECUS versions wrap uploaded bytes in a short length prefix before gzip.
    if len(raw) > 6 and raw[4:6] in (b"\x1f\x8b", b"x\x9c", b"x\xda"):
        candidates.append(raw[4:])
    for candidate in candidates:
        decoded = candidate
        try:
            if decoded.startswith(b"\x1f\x8b"):
                decoded = gzip.decompress(decoded)
            elif len(decoded) > 2 and decoded[0] == 0x78:
                decoded = zlib.decompress(decoded)
        except (OSError, zlib.error):
            continue
        if decoded.startswith(_PDF_MAGIC) and len(decoded) <= _MAX_PDF_BYTES:
            return decoded
    return None


def _safe_original_name(value: str) -> str:
    name = Path((value or "").replace("\\", "/")).name
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")
    if not name:
        name = "attachment.pdf"
    if not name.lower().endswith(".pdf"):
        name += ".pdf"
    return name[:180]


def extract_attached_pdfs(
    db_path: Path,
    declaration_numbers: set[str] | None = None,
) -> list[EcusPdfArtifact]:
    """Read ECUS ``DCHUNGTU_BS`` rows and return unique attached PDFs."""
    encoded_path = quote(str(Path(db_path).resolve()), safe="/:")
    con = sqlite3.connect(f"file:{encoded_path}?mode=ro", uri=True)
    seen: set[tuple[str, str]] = set()
    artifacts: list[EcusPdfArtifact] = []
    try:
        rows = con.execute(
            """
            select DCHUNGTUID, THOI_GIAN_GUI, NOI_DUNG
            from DCHUNGTU
            where LOAI_CT = 'DCHUNGTU_BS'
            order by DCHUNGTUID
            """
        )
        for row_id, source_time, payload in rows:
            try:
                root = ElementTree.fromstring(payload or "")
            except ElementTree.ParseError:
                continue
            refs = _declaration_numbers(root)
            if len(refs) != 1:
                continue
            declaration_number = next(iter(refs))
            if declaration_numbers and declaration_number not in declaration_numbers:
                continue
            for attached in root.iter():
                if _local_name(attached.tag) != "AttachedFile":
                    continue
                values = {_local_name(child.tag): (child.text or "") for child in attached}
                content = _pdf_bytes(values.get("content", ""))
                if not content:
                    continue
                digest = hashlib.sha256(content).hexdigest()
                key = (declaration_number, digest)
                if key in seen:
                    continue
                seen.add(key)
                artifacts.append(
                    EcusPdfArtifact(
                        declaration_number=declaration_number,
                        source_row_id=str(row_id),
                        source_time=str(source_time or ""),
                        filename=_safe_original_name(values.get("fileName", "")),
                        content=content,
                        sha256=digest,
                    )
                )
    finally:
        con.close()
    return artifacts


def _safe_drive_path(path: str) -> str:
    parsed = PurePosixPath(path)
    if parsed.is_absolute() or ".." in parsed.parts or not path.strip():
        raise ValueError("Đường dẫn Drive không hợp lệ")
    return parsed.as_posix()


def _rclone_binary() -> str:
    local = Path.home() / ".local" / "bin" / "rclone"
    binary = shutil.which("rclone") or (str(local) if local.is_file() else "")
    if not binary:
        raise RuntimeError("Không tìm thấy rclone trên máy chủ")
    return binary


def _export_filename(declaration_number: str, original_name: str, digest: str) -> str:
    stem = Path(original_name).stem or "attachment"
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._") or "attachment"
    return f"ECUS-{declaration_number}-{stem}-{digest[:12]}.pdf"


def _upload_to_drive(
    settings: Settings,
    root_id: str,
    folder_path: str,
    filename: str,
    content: bytes,
) -> None:
    safe_folder = _safe_drive_path(folder_path)
    remote_target = f"{settings.customs_drive_remote}{safe_folder}/{filename}"
    with tempfile.TemporaryDirectory(prefix="ecus-pdf-") as temp_dir:
        source = Path(temp_dir) / filename
        source.write_bytes(content)
        command = [
            _rclone_binary(),
            "copyto",
            str(source),
            remote_target,
            "--drive-root-folder-id",
            root_id,
            "--bind",
            settings.customs_drive_bind,
        ]
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=180,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("Upload PDF lên Drive quá thời gian chờ") from exc
        if result.returncode:
            raise RuntimeError(f"Upload PDF lên Drive thất bại: {result.stderr[-300:]}")


def _mapped_folders(db: Session) -> dict[str, tuple[InvCustomsDecl, InvCustomsDriveFolder]]:
    result: dict[str, tuple[InvCustomsDecl, InvCustomsDriveFolder]] = {}
    rows = db.scalars(
        select(InvCustomsDriveFolder).where(InvCustomsDriveFolder.customs_id.is_not(None))
    )
    for folder in rows:
        declaration = db.get(InvCustomsDecl, folder.customs_id)
        if declaration and declaration.so_to_khai not in result:
            result[declaration.so_to_khai] = (declaration, folder)
    return result


def sync_ecus_pdfs(
    db: Session,
    settings: Settings,
    *,
    db_path: Path,
    dry_run: bool = False,
    declaration_numbers: set[str] | None = None,
) -> dict:
    """Sync extracted PDFs to mapped Drive folders, safely and idempotently."""
    artifacts = extract_attached_pdfs(db_path, declaration_numbers)
    mapped = _mapped_folders(db)
    stats = {
        "artifacts": len(artifacts),
        "would_upload": 0,
        "uploaded": 0,
        "skipped": 0,
        "unmatched": [],
        "failed": [],
        "files": [],
        "dry_run": dry_run,
    }
    for artifact in artifacts:
        target = mapped.get(artifact.declaration_number)
        if target is None:
            stats["unmatched"].append(artifact.declaration_number)
            continue
        declaration, folder = target
        existing = db.scalar(
            select(InvCustomsEcusExport).where(
                InvCustomsEcusExport.customs_id == declaration.id,
                InvCustomsEcusExport.sha256 == artifact.sha256,
            )
        )
        filename = existing.filename if existing else _export_filename(
            artifact.declaration_number, artifact.filename, artifact.sha256
        )
        if existing and existing.status == "uploaded":
            stats["skipped"] += 1
            stats["files"].append({"declaration": artifact.declaration_number, "filename": filename, "status": "skipped"})
            continue
        if dry_run:
            stats["would_upload"] += 1
            stats["files"].append({"declaration": artifact.declaration_number, "filename": filename, "status": "would_upload"})
            continue

        try:
            if existing is None:
                existing = InvCustomsEcusExport(
                    customs_id=declaration.id,
                    source_row_id=artifact.source_row_id,
                    declaration_number=artifact.declaration_number,
                    original_name=artifact.filename,
                    filename=filename,
                    sha256=artifact.sha256,
                    doc_id=storage.save_upload(artifact.content, suffix=".pdf"),
                    doc_suffix=".pdf",
                    drive_folder_id=folder.drive_folder_id,
                    drive_path=f"{folder.path}/{filename}",
                    source_time=artifact.source_time,
                    status="extracted",
                )
                db.add(existing)
                db.commit()
            _upload_to_drive(
                settings,
                folder.source.folder_id,
                folder.path,
                filename,
                artifact.content,
            )
            existing.status = "uploaded"
            existing.error = ""
            existing.uploaded_at = datetime.now(timezone.utc)
            db.commit()
            stats["uploaded"] += 1
            stats["files"].append({"declaration": artifact.declaration_number, "filename": filename, "status": "uploaded"})
        except Exception as exc:  # keep other declaration files retryable
            db.rollback()
            existing = db.scalar(
                select(InvCustomsEcusExport).where(
                    InvCustomsEcusExport.customs_id == declaration.id,
                    InvCustomsEcusExport.sha256 == artifact.sha256,
                )
            )
            if existing:
                existing.status = "failed"
                existing.error = str(exc)[:500]
                db.commit()
            stats["failed"].append({
                "declaration": artifact.declaration_number,
                "filename": filename,
                "error": type(exc).__name__,
            })
    stats["unmatched"] = sorted(set(stats["unmatched"]))
    return stats


def _validate_snapshot(path: Path) -> None:
    with path.open("rb") as stream:
        header = stream.read(16)
    if header != b"SQLite format 3\x00":
        raise RuntimeError("Ảnh chụp database ECUS không phải SQLite hợp lệ")
    con = sqlite3.connect(f"file:{quote(str(path), safe='/')}?mode=ro", uri=True)
    try:
        result = con.execute("pragma integrity_check").fetchone()
        if not result or result[0] != "ok":
            raise RuntimeError("Database ECUS không vượt qua integrity_check")
    finally:
        con.close()


@contextmanager
def remote_db_snapshot(settings: Settings) -> Iterator[Path]:
    """Copy the ECUS database to a local temporary file without remote writes."""
    key_path = Path(settings.ecus_ssh_key_path).expanduser()
    if not key_path.is_file():
        raise RuntimeError(f"Không tìm thấy SSH key ECUS: {key_path}")
    remote_path = settings.ecus_db_path.replace("\\", "/")
    if ".." in PurePosixPath(remote_path).parts or not remote_path.lower().endswith(".db"):
        raise RuntimeError("Đường dẫn database ECUS không hợp lệ")
    source = f"{settings.ecus_ssh_user}@{settings.ecus_ssh_host}:{remote_path}"
    with tempfile.TemporaryDirectory(prefix="ecus-db-") as temp_dir:
        target = Path(temp_dir) / "ecus.db"
        command = [
            "scp",
            "-q",
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            f"ConnectTimeout={settings.ecus_ssh_timeout}",
            "-i",
            str(key_path),
            source,
            str(target),
        ]
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=settings.ecus_ssh_timeout + 30,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("Sao lưu database ECUS quá thời gian chờ") from exc
        if result.returncode:
            raise RuntimeError(f"Không lấy được database ECUS: {result.stderr[-300:]}")
        _validate_snapshot(target)
        yield target


def sync_from_remote(
    db: Session,
    settings: Settings,
    *,
    dry_run: bool = False,
    declaration_numbers: set[str] | None = None,
) -> dict:
    with remote_db_snapshot(settings) as db_path:
        return sync_ecus_pdfs(
            db,
            settings,
            db_path=db_path,
            dry_run=dry_run,
            declaration_numbers=declaration_numbers,
        )
