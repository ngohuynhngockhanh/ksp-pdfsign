from __future__ import annotations

from app.customs_drive import (
    classify_customs_document,
    extract_declaration_numbers,
    review_dossier,
)
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


FIXTURES = Path(__file__).parent / "fixtures" / "customs"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("NAS_ENABLED", "false")
    from app.config import get_settings
    from app import db as dbmod
    from app.auth import ensure_admin_seed

    get_settings.cache_clear()
    dbmod.reset_engine_for_tests()
    dbmod.init_db()
    gen = dbmod.get_session(); session = next(gen)
    ensure_admin_seed(session, get_settings()); gen.close()
    from app.main import app

    result = TestClient(app)
    login = result.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})
    assert login.status_code == 200
    return result


def test_extract_declaration_numbers_only_accepts_12_digits():
    assert extract_declaration_numbers("2026/108286660050/CI-108286660050.pdf") == {"108286660050"}
    assert extract_declaration_numbers("invoice-2026-001.pdf") == set()


def test_classify_core_customs_documents_from_names_and_content():
    assert classify_customs_document("Commercial Invoice 01.pdf", "") == "ci"
    assert classify_customs_document("PACKING-LIST.xlsx", "") == "pl"
    assert classify_customs_document("CO form E.pdf", "CERTIFICATE OF ORIGIN") == "coo"
    assert classify_customs_document("bill.pdf", "BILL OF LADING") == "bill_of_lading"
    assert classify_customs_document("ToKhaiHQ7N.xlsx", "") == "customs_declaration"


def test_review_dossier_accepts_coo_or_origin_china_and_flags_missing_docs():
    complete = review_dossier([
        {"kind": "customs_declaration", "text": ""},
        {"kind": "ci", "text": "COMMERCIAL INVOICE ORIGIN: CHINA"},
        {"kind": "pl", "text": "PACKING LIST"},
    ])
    assert complete["status"] == "needs_review"
    assert complete["checklist"]["origin"]["state"] == "review"
    assert complete["checklist"]["ci"]["state"] == "ok"

    missing = review_dossier([{"kind": "customs_declaration", "text": ""}])
    assert missing["status"] == "missing_documents"
    assert {item["code"] for item in missing["findings"]} >= {"missing_ci", "missing_pl", "missing_origin"}


def test_review_dossier_flags_conflicting_origin_between_ci_and_pl():
    result = review_dossier([
        {"kind": "customs_declaration", "text": ""},
        {"kind": "ci", "text": "ORIGIN CHINA"},
        {"kind": "pl", "text": "MADE IN VIETNAM"},
    ])
    assert any(item["code"] == "origin_conflict" for item in result["findings"])


def test_drive_sync_auto_imports_declaration_and_queues_unmatched_folder(client, monkeypatch):
    from app import customs_drive_api

    declaration = (FIXTURES / "ToKhaiHQ7N_108286660050.xlsx").read_bytes()
    entries = [
        {"Path": "108286660050", "Name": "108286660050", "ID": "folder-a", "IsDir": True},
        {"Path": "108286660050/ToKhaiHQ7N_108286660050.xlsx", "Name": "ToKhaiHQ7N_108286660050.xlsx", "ID": "tk-a", "IsDir": False, "Size": len(declaration)},
        {"Path": "108286660050/Commercial Invoice Origin China.txt", "Name": "Commercial Invoice Origin China.txt", "ID": "ci-a", "IsDir": False, "Size": 40},
        {"Path": "108286660050/Packing List.txt", "Name": "Packing List.txt", "ID": "pl-a", "IsDir": False, "Size": 20},
        {"Path": "Chua co to khai", "Name": "Chua co to khai", "ID": "folder-b", "IsDir": True},
        {"Path": "Chua co to khai/Commercial Invoice.txt", "Name": "Commercial Invoice.txt", "ID": "ci-b", "IsDir": False, "Size": 20},
    ]
    contents = {
        "108286660050/ToKhaiHQ7N_108286660050.xlsx": declaration,
        "108286660050/Commercial Invoice Origin China.txt": b"COMMERCIAL INVOICE ORIGIN: CHINA",
        "108286660050/Packing List.txt": b"PACKING LIST",
        "Chua co to khai/Commercial Invoice.txt": b"COMMERCIAL INVOICE",
    }
    monkeypatch.setattr(customs_drive_api, "_rclone_list", lambda folder_id: entries)
    monkeypatch.setattr(customs_drive_api, "_rclone_download", lambda folder_id, path: contents[path])

    source = client.post("/api/inv/customs-drive/sources", json={
        "year": 2026, "folder_id": "1yg_TqCrWS4dDx-O-bYYhfktFq1OdNk9z",
    })
    assert source.status_code == 200, source.text
    started = client.post("/api/inv/customs-drive/sync/2026")
    assert started.status_code == 200, started.text

    folders = client.get("/api/inv/customs-drive/folders?year=2026").json()
    linked = next(item for item in folders if item["drive_folder_id"] == "folder-a")
    waiting = next(item for item in folders if item["drive_folder_id"] == "folder-b")
    assert linked["link_status"] == "linked"
    assert linked["customs_id"] > 0
    assert linked["dossier_status"] == "needs_review"
    assert waiting["link_status"] == "waiting_declaration"

    declarations = client.get("/api/inv/customs").json()
    assert any(item["so_to_khai"] == "108286660050" and item["status"] == "draft" for item in declarations)
