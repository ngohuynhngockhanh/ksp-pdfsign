from __future__ import annotations

import base64
import sqlite3
from pathlib import Path
from xml.sax.saxutils import escape

import pytest


PDF_BYTES = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n"


def _ecus_db(path: Path, rows: list[tuple[int, str]]) -> None:
    con = sqlite3.connect(path)
    con.execute(
        """
        create table DCHUNGTU (
            DCHUNGTUID integer primary key,
            LOAI_CT text,
            THOI_GIAN_GUI text,
            NOI_DUNG text
        )
        """
    )
    for row_id, declaration in rows:
        content = base64.b64encode(PDF_BYTES).decode()
        xml = (
            "<Declaration><DeclarationDocument><reference>"
            f"{declaration}"
            "</reference></DeclarationDocument><AttachedFile>"
            "<fileName>awb.pdf</fileName><content>"
            f"{content}"
            "</content></AttachedFile></Declaration>"
        )
        con.execute(
            "insert into DCHUNGTU values (?, 'DCHUNGTU_BS', '2026-07-16 20:56:17', ?)",
            (row_id, xml),
        )
    con.commit()
    con.close()


def _customs_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "app-data"))
    monkeypatch.setenv("NAS_ENABLED", "false")
    from app.config import get_settings
    from app import db as dbmod

    get_settings.cache_clear()
    dbmod.reset_engine_for_tests()
    dbmod.init_db()
    return dbmod, get_settings()


def _map_declaration(dbmod, number: str):
    from app.db import InvCustomsDecl, InvCustomsDriveFolder, InvCustomsDriveSource

    with dbmod._SessionLocal() as db:
        source = InvCustomsDriveSource(year=2026, folder_id="source-folder")
        db.add(source)
        db.flush()
        declaration = InvCustomsDecl(
            so_to_khai=number,
            ngay_dang_ky="2026-07-16",
            ma_loai_hinh="A11",
            phan_luong="1",
        )
        db.add(declaration)
        db.flush()
        folder = InvCustomsDriveFolder(
            source_id=source.id,
            drive_folder_id="target-folder",
            name="Hồ sơ nhập khẩu",
            path="Hồ sơ nhập khẩu",
            customs_id=declaration.id,
            link_status="linked",
        )
        db.add(folder)
        db.commit()


def test_extract_attached_pdfs_uses_declaration_reference_and_deduplicates(tmp_path):
    from app.ecus_drive_sync import extract_attached_pdfs

    db_path = tmp_path / "ecus.db"
    _ecus_db(db_path, [(1, "108441630360"), (2, "108441630360")])

    artifacts = extract_attached_pdfs(db_path)

    assert len(artifacts) == 1
    assert artifacts[0].declaration_number == "108441630360"
    assert artifacts[0].filename == "awb.pdf"
    assert artifacts[0].content == PDF_BYTES


def test_sync_dry_run_does_not_write_export_rows(tmp_path, monkeypatch):
    from app.ecus_drive_sync import sync_ecus_pdfs
    from app.db import InvCustomsEcusExport

    dbmod, settings = _customs_db(tmp_path, monkeypatch)
    _map_declaration(dbmod, "108441630360")
    ecus_path = tmp_path / "ecus.db"
    _ecus_db(ecus_path, [(1, "108441630360")])

    with dbmod._SessionLocal() as db:
        result = sync_ecus_pdfs(db, settings, db_path=ecus_path, dry_run=True)
        assert result["would_upload"] == 1
        assert db.query(InvCustomsEcusExport).count() == 0


def test_sync_upload_is_idempotent(tmp_path, monkeypatch):
    from app import ecus_drive_sync
    from app.db import InvCustomsEcusExport

    dbmod, settings = _customs_db(tmp_path, monkeypatch)
    _map_declaration(dbmod, "108441630360")
    ecus_path = tmp_path / "ecus.db"
    _ecus_db(ecus_path, [(1, "108441630360")])
    uploads: list[tuple[str, str]] = []
    monkeypatch.setattr(
        ecus_drive_sync,
        "_upload_to_drive",
        lambda settings, root_id, folder_path, filename, content: uploads.append(
            (folder_path, filename)
        ),
    )

    with dbmod._SessionLocal() as db:
        first = ecus_drive_sync.sync_ecus_pdfs(db, settings, db_path=ecus_path)
        second = ecus_drive_sync.sync_ecus_pdfs(db, settings, db_path=ecus_path)
        assert first["uploaded"] == 1
        assert second["skipped"] == 1
        assert len(uploads) == 1
        assert db.query(InvCustomsEcusExport).count() == 1

