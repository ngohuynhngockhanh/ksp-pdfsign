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
    assert classify_customs_document("Temperature Controller Datasheet.pdf", "") == "datasheet"
    assert classify_customs_document("RK300-08 Multi-in-one gas Sensor specification v5.1.pdf", "") == "datasheet"
    assert classify_customs_document("tai-lieu.pdf", "TECHNICAL DATA SHEET") == "datasheet"
    assert classify_customs_document("AN-108286660050.pdf", "ARRIVAL NOTICE") == "arrival_notice"
    assert classify_customs_document("Hinh chup san pham RK300-08.jpg", "") == "product_photo"
    assert classify_customs_document("product-photo-controller.png", "") == "product_photo"
    assert classify_customs_document("Chứng từ TT_DebitNote.pdf", "PHIẾU BÁO NỢ Debit advice") == "payment"


def test_review_dossier_accepts_coo_or_origin_china_and_flags_missing_docs():
    complete = review_dossier([
        {"kind": "customs_declaration", "text": ""},
        {"kind": "ci", "text": "COMMERCIAL INVOICE ORIGIN: CHINA"},
        {"kind": "pl", "text": "PACKING LIST"},
    ])
    assert complete["status"] == "complete"
    assert complete["checklist"]["origin"]["state"] == "ok"
    assert complete["checklist"]["ci"]["state"] == "ok"
    assert not any(item["code"] == "origin_statement_only" for item in complete["findings"])

    missing = review_dossier([{"kind": "customs_declaration", "text": ""}])
    assert missing["status"] == "missing_documents"
    assert {item["code"] for item in missing["findings"]} >= {"missing_ci", "missing_pl", "missing_origin"}


def test_review_dossier_recognizes_country_of_origin_or_coo_inside_ci():
    for origin_text in ("Country of Origin: China", "Origin: China"):
        result = review_dossier([
            {"kind": "customs_declaration", "text": ""},
            {"kind": "ci", "text": f"COMMERCIAL INVOICE {origin_text}"},
            {"kind": "pl", "text": "PACKING LIST"},
        ])
        assert result["checklist"]["origin"]["state"] == "ok"
        assert not any(item["code"] == "missing_origin" for item in result["findings"])
        assert not any(item["code"] == "origin_statement_only" for item in result["findings"])


def test_review_dossier_accepts_origin_ocr_from_product_label():
    result = review_dossier([
        {"kind": "customs_declaration", "text": ""},
        {"kind": "ci", "text": "COMMERCIAL INVOICE"},
        {"kind": "pl", "text": "PACKING LIST"},
        {"kind": "product_photo", "text": "MODEL RK300-08 COO: China"},
    ])

    assert result["checklist"]["origin"]["state"] == "review"
    assert not any(item["code"] == "missing_origin" for item in result["findings"])
    assert any("nhãn sản phẩm" in item["message"] for item in result["findings"])


def test_review_dossier_accepts_packing_details_embedded_in_arrival_notice():
    result = review_dossier([
        {"kind": "customs_declaration", "text": ""},
        {"kind": "ci", "text": "COMMERCIAL INVOICE Country of Origin: China"},
        {"kind": "arrival_notice", "text": (
            "ARRIVAL NOTICE No. of Packages 1 Net Weight 0.00 KG "
            "Gross Weight 4.60 KG Description of Goods RK3518 EMCP"
        )},
    ])

    assert result["checklist"]["pl"]["state"] == "review"
    assert not any(item["code"] == "missing_pl" for item in result["findings"])
    assert any(item["code"] == "embedded_pl" for item in result["findings"])


def test_review_dossier_flags_conflicting_origin_between_ci_and_pl():
    result = review_dossier([
        {"kind": "customs_declaration", "text": ""},
        {"kind": "ci", "text": "ORIGIN CHINA"},
        {"kind": "pl", "text": "MADE IN VIETNAM"},
    ])
    assert any(item["code"] == "origin_conflict" for item in result["findings"])


def test_review_folder_rereads_stored_product_image_with_ocr(client, monkeypatch):
    from app import customs_drive_api
    from app.db import InvCustomsDriveDocument, InvCustomsDriveFolder, InvCustomsDriveSource, get_session

    gen = get_session(); session = next(gen)
    source = InvCustomsDriveSource(year=2027, folder_id="drive-folder-source")
    session.add(source); session.flush()
    folder = InvCustomsDriveFolder(
        source_id=source.id, drive_folder_id="folder-label", name="Hồ sơ có nhãn",
    )
    session.add(folder); session.flush()
    for index, (name, kind, text, suffix) in enumerate((
        ("Commercial Invoice.pdf", "ci", "COMMERCIAL INVOICE", ".pdf"),
        ("Packing List.pdf", "pl", "PACKING LIST", ".pdf"),
        ("Tem nhãn sản phẩm.png", "product_photo", "", ".png"),
    ), start=1):
        session.add(InvCustomsDriveDocument(
            folder_id=folder.id, drive_file_id=f"file-{index}", name=name,
            path=f"Hồ sơ có nhãn/{name}", kind=kind, kind_manual=True,
            doc_id=f"doc{index}", doc_suffix=suffix, extracted_text=text,
        ))
    session.commit(); folder_id = folder.id; gen.close()

    monkeypatch.setattr(customs_drive_api.storage, "read_doc", lambda doc_id, suffix: b"stored-file")
    monkeypatch.setattr(
        customs_drive_api,
        "_extract_text",
        lambda name, content, force_ocr=False, ocr_all_pages=False: "PRODUCT LABEL COO: China" if name.endswith(".png") else name,
    )

    response = client.post(f"/api/inv/customs-drive/folders/{folder_id}/review")

    assert response.status_code == 200, response.text
    assert response.json()["checklist"]["origin"]["state"] == "review"
    assert any("nhãn sản phẩm" in item["message"] for item in response.json()["findings"])


def test_extract_text_can_ocr_all_pages_of_bundled_pdf(monkeypatch):
    from app import customs_drive_api

    monkeypatch.setattr(customs_drive_api.inv_import, "_pdf_all_text", lambda content: "ARRIVAL NOTICE")
    monkeypatch.setattr(
        customs_drive_api,
        "_ocr_pdf_pages",
        lambda content: "No. of Packages 1 Gross Weight 4.60 KG Description of Goods RK3518",
    )

    text = customs_drive_api._extract_text(
        "AN_email.pdf", b"pdf", force_ocr=True, ocr_all_pages=True,
    )

    assert "ARRIVAL NOTICE" in text
    assert "No. of Packages" in text


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
        {"Path": "Chua co to khai/Ghi chu Google.docx", "Name": "Ghi chu Google.docx", "ID": "native-b", "IsDir": False, "Size": -1},
    ]
    contents = {
        "108286660050/ToKhaiHQ7N_108286660050.xlsx": declaration,
        "108286660050/Commercial Invoice Origin China.txt": b"COMMERCIAL INVOICE ORIGIN: CHINA PAYMENT REF 178421125810",
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
    assert linked["dossier_status"] == "complete"
    assert waiting["link_status"] == "waiting_declaration"
    native = next(item for item in waiting["documents"] if item["name"] == "Ghi chu Google.docx")
    assert native["parse_error"] == "File Google native chưa hỗ trợ tải bản sao; vẫn giữ liên kết Drive."

    ci = next(item for item in linked["documents"] if item["kind"] == "ci")
    classified = client.patch(
        f"/api/inv/customs-drive/documents/{ci['id']}/kind",
        json={"kind": "payment"},
    )
    assert classified.status_code == 200, classified.text
    assert next(item for item in classified.json()["documents"] if item["id"] == ci["id"])["kind"] == "payment"
    assert classified.json()["checklist"]["ci"]["state"] == "missing"
    assert classified.json()["checklist"]["payment"]["state"] == "ok"

    datasheet = client.patch(
        f"/api/inv/customs-drive/documents/{ci['id']}/kind",
        json={"kind": "datasheet"},
    )
    assert datasheet.status_code == 200, datasheet.text
    assert next(item for item in datasheet.json()["documents"] if item["id"] == ci["id"])["kind"] == "datasheet"

    arrival_notice = client.patch(
        f"/api/inv/customs-drive/documents/{ci['id']}/kind",
        json={"kind": "arrival_notice"},
    )
    assert arrival_notice.status_code == 200, arrival_notice.text

    product_photo = client.patch(
        f"/api/inv/customs-drive/documents/{ci['id']}/kind",
        json={"kind": "product_photo"},
    )
    assert product_photo.status_code == 200, product_photo.text

    assert client.patch(
        f"/api/inv/customs-drive/documents/{ci['id']}/kind",
        json={"kind": "khong_hop_le"},
    ).status_code == 422

    assert client.post("/api/inv/customs-drive/sync/2026").status_code == 200
    refreshed = client.get("/api/inv/customs-drive/folders?year=2026").json()
    refreshed_linked = next(item for item in refreshed if item["drive_folder_id"] == "folder-a")
    assert next(item for item in refreshed_linked["documents"] if item["id"] == ci["id"])["kind"] == "product_photo"

    declarations = client.get("/api/inv/customs").json()
    assert any(item["so_to_khai"] == "108286660050" and item["status"] == "draft" for item in declarations)
