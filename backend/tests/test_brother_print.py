"""Unit & API tests for Brother HL-L2320D A4 remote printing."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app import brother_print, db as dbmod, spx, storage  # noqa: E402
from app.db import Document  # noqa: E402

SAMPLE_PDF = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n"


def test_build_sumatra_settings_defaults_and_options():
    assert brother_print.build_sumatra_settings() == "paper=A4,simplex,fit,monochrome,1x"
    assert (
        brother_print.build_sumatra_settings(
            paper_size="A4",
            duplex="long",
            copies=3,
            page_range="1-2, 4",
            scale="noscale",
            orientation="landscape",
            tray="manual",
        )
        == "paper=A4,duplexlong,noscale,monochrome,3x,landscape,bin=Manual,1-2,4"
    )
    assert (
        brother_print.build_sumatra_settings(duplex="short", page_range="odd")
        == "paper=A4,duplexshort,fit,monochrome,1x,odd"
    )


@pytest.mark.parametrize(
    "kwargs",
    [
        {"paper_size": "A3"},
        {"duplex": "invalid"},
        {"copies": 0},
        {"copies": 51},
        {"page_range": "1;calc.exe"},
        {"scale": "stretch"},
        {"orientation": "upside"},
        {"tray": "tray99"},
    ],
)
def test_build_sumatra_settings_rejects_invalid(kwargs):
    with pytest.raises(ValueError):
        brother_print.build_sumatra_settings(**kwargs)


def test_print_pdf_bytes_dry_run_and_validation():
    res = brother_print.print_pdf_bytes_a4(
        SAMPLE_PDF,
        filename="Minh_Chung_A4.pdf",
        host="192.168.1.12",
        duplex="long",
        copies=2,
        dry_run=True,
    )
    assert res["success"] is True
    assert res["dry_run"] is True
    assert res["printer_name"] == "Brother HL-L2320D series"
    assert res["print_settings"] == "paper=A4,duplexlong,fit,monochrome,2x"

    # Reject non-PDF payload
    with pytest.raises(ValueError):
        brother_print.print_pdf_bytes_a4(b"NOT A PDF", dry_run=True)

    # Reject disallowed host
    with pytest.raises(ValueError):
        brother_print.print_pdf_bytes_a4(SAMPLE_PDF, host="8.8.8.8", dry_run=True)

    # Reject shell injection in printer_name
    with pytest.raises(ValueError):
        brother_print.print_pdf_bytes_a4(
            SAMPLE_PDF, printer_name="Brother; rm -rf /", dry_run=True
        )


def test_list_remote_printers_preserves_spaces():
    fake_ps_output = [
        {
            "name": "Brother HL-L2320D series",
            "driver": "Brother Laser Type1 Class Driver",
            "port": "USB003",
            "shared": True,
            "share_name": "BrotherHL-L2320D",
            "default": False,
            "work_offline": False,
            "printer_status": 3,
            "paper_size": "A4",
            "duplex_mode": "OneSided",
            "collate": True,
            "dpi": 600,
            "jobs_count": 0,
        },
        {
            "name": "TP732H",
            "driver": "TP732H",
            "port": "USB001",
            "shared": True,
            "share_name": "TP732H",
            "default": False,
            "work_offline": True,
            "printer_status": 3,
            "paper_size": "",
            "duplex_mode": "OneSided",
            "collate": True,
            "dpi": 203,
            "jobs_count": 0,
        },
    ]
    with (
        patch.object(brother_print, "_resolve_host", return_value=("192.168.1.12", "192.168.1.12")),
        patch.object(brother_print, "_run_ps_json", return_value=fake_ps_output),
    ):
        printers = spx.list_remote_printers(host="192.168.1.12")
        assert len(printers) == 2
        brother = printers[0]
        assert brother["name"] == "Brother HL-L2320D series"
        assert brother["is_a4_laser"] is True
        assert brother["is_thermal"] is False
        assert brother["ready"] is True
        assert brother["paper_size"] == "A4"
        assert printers[1]["is_thermal"] is True
        assert printers[1]["ready"] is False


def test_api_print_document_dry_run_and_auth(client: TestClient):
    # Unauthenticated request rejected
    unauth = client.get("/api/brother/printers")
    assert unauth.status_code in (401, 403)

    # Login as seeded admin
    login_r = client.post(
        "/api/login", json={"username": "admin", "password": "NhapHang123@"}
    )
    assert login_r.status_code == 200, login_r.text

    # Create unsigned + signed PDF document in storage and DB
    orig_id = storage.save_upload(SAMPLE_PDF, suffix=".pdf")
    signed_id = storage.save_upload(SAMPLE_PDF + b"%signed\n", suffix=".pdf")
    gen = dbmod.get_session()
    session = next(gen)
    try:
        doc = Document(
            doc_id=orig_id,
            filename="orig_a4.pdf",
            doc_type="ho_so_ky_thuat",
            signed=True,
            signed_upload_id=signed_id,
            signed_upload_name="orig_a4_DA_KY.pdf",
        )
        session.add(doc)
        session.commit()
        session.refresh(doc)
        doc_pk = doc.id
    finally:
        gen.close()

    # Dry-run via /api/documents/{id}/print prefers signed file
    resp = client.post(
        f"/api/documents/{doc_pk}/print",
        json={"paper_size": "A4", "duplex": "long", "copies": 2, "dry_run": True},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    assert body["dry_run"] is True
    assert body["doc_pk"] == doc_pk
    assert body["used_signed_file"] is True
    assert body["filename"] == "orig_a4_DA_KY.pdf"
    assert body["print_settings"] == "paper=A4,duplexlong,fit,monochrome,2x"

    # Prefer unsigned
    resp2 = client.post(
        f"/api/brother/print-document/{doc_pk}",
        json={"prefer_signed": False, "duplex": "simplex", "dry_run": True},
    )
    assert resp2.status_code == 200, resp2.text
    body2 = resp2.json()
    assert body2["used_signed_file"] is False
    assert body2["filename"] == "orig_a4.pdf"

    # Upload endpoint dry-run
    resp3 = client.post(
        "/api/brother/print-upload",
        files={"file": ("test_upload.pdf", SAMPLE_PDF, "application/pdf")},
        data={"duplex": "short", "copies": "1", "dry_run": "true"},
    )
    assert resp3.status_code == 200, resp3.text
    assert resp3.json()["print_settings"] == "paper=A4,duplexshort,fit,monochrome,1x"
