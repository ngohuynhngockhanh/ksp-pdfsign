"""Test suite for Tax Defense & Audit Justification feature (isolated tmp_path DB)."""
from __future__ import annotations

import io

import pytest
from openpyxl import Workbook

from app.db import IhoadonInvoice, get_session


@pytest.fixture
def tax_defense_client(client):
    """Authenticated admin client backed by an isolated tmp_path database."""
    r = client.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})
    assert r.status_code == 200, r.text

    # Seed deterministic historical iHOADON invoices in 2022 & 2023 inside isolated tmp_path DB
    gen = get_session()
    db = next(gen)
    try:
        for i in range(3):
            db.add(
                IhoadonInvoice(
                    external_id=f"td-2022-{i + 1}",
                    invoice_number=f"2200{i + 1}",
                    invoice_series="1C22TIN",
                    invoice_date=f"2022-06-0{i + 1}",
                    buyer_tax_code="0312345678",
                    buyer_name="CONG TY MAU 2022",
                    status="DA_XUAT",
                    total_payment=432_000_000,
                )
            )
        for i in range(4):
            db.add(
                IhoadonInvoice(
                    external_id=f"td-2023-{i + 1}",
                    invoice_number=f"2300{i + 1}",
                    invoice_series="1C23TIN",
                    invoice_date=f"2023-07-0{i + 1}",
                    buyer_tax_code="0316764844",
                    buyer_name="CONG TY MAU 2023",
                    status="DA_XUAT",
                    total_payment=378_000_000,
                )
            )
        db.commit()
    finally:
        gen.close()

    return client


def test_tax_defense_overview(tax_defense_client):
    r = tax_defense_client.get("/api/tax-defense/overview?years=2022,2023,2024,2025")
    assert r.status_code == 200
    data = r.json()
    assert "summary_matrix" in data
    assert len(data["summary_matrix"]) == 4

    y22 = next(m for m in data["summary_matrix"] if m["year"] == "2022")
    assert y22["sale_invoices_count"] == 3
    assert y22["revenue_pretax"] > 1_000_000_000

    y23 = next(m for m in data["summary_matrix"] if m["year"] == "2023")
    assert y23["sale_invoices_count"] == 4
    assert y23["revenue_pretax"] > 1_300_000_000


def test_tax_defense_justification_dossier(tax_defense_client):
    r = tax_defense_client.get("/api/tax-defense/justification-dossier?years=2022,2023,2024,2025")
    assert r.status_code == 200
    data = r.json()
    assert "markdown_content" in data
    assert "4401053694" in data["markdown_content"]
    assert "Thông tư 219/2013/TT-BTC" in data["markdown_content"]
    assert "KHÔNG PHỤ THUỘC TỒN KHO" in data["markdown_content"]


def test_tax_defense_export_excel(tax_defense_client):
    r = tax_defense_client.get("/api/tax-defense/export-excel?years=2022,2023,2024,2025")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert len(r.content) > 5000


def test_tax_defense_import_historical_purchase(tax_defense_client):
    wb = Workbook()
    ws = wb.active
    ws.title = "Bang_ke_mua_vao"
    ws.append([
        "STT", "Ký hiệu hóa đơn", "Số hóa đơn", "Ngày lập", "Tên người bán",
        "Mã số thuế người bán", "Doanh số mua chưa thuế", "Thuế GTGT", "Tổng thanh toán",
    ])
    ws.append([
        1, "1C24TBB", "900123", "15/05/2024", "CÔNG TY TNHH LINH KIỆN MẪU",
        "0312345678", 50000000, 4000000, 54000000,
    ])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    files = {
        "file": (
            "bang_ke_mua_2024.xlsx",
            buf.getvalue(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    }
    r = tax_defense_client.post("/api/tax-defense/import-historical-purchase?year=2024", files=files)
    assert r.status_code == 200
    res = r.json()
    assert res["success"] is True
    assert res["imported"] >= 1


def test_check_single_mst(tax_defense_client):
    r1 = tax_defense_client.get("/api/tax-defense/check-mst?mst=4401053694")
    assert r1.status_code == 200
    d1 = r1.json()
    assert d1["clean_mst"] == "4401053694"
    assert "INUT" in d1["company_name"]
    assert d1["status_code"] == "00"
    assert d1["is_active"] is True
    assert "gdt_public_portal" in d1["referers"]

    r2 = tax_defense_client.get("/api/tax-defense/check-mst?mst=0316764844")
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2["clean_mst"] == "0316764844"
    assert d2["status_code"] == "06"
    assert d2["is_abandoned"] is True
    assert d2["risk_level"] == "high"
    assert "Trạng thái 06" in d2["defense_note"]


def test_partner_status_audit(tax_defense_client):
    r = tax_defense_client.get("/api/tax-defense/partner-status?years=2023,2024&limit=10")
    assert r.status_code == 200
    data = r.json()
    assert "total_checked" in data
    assert "referers" in data
    assert "gdt_public_portal" in data["referers"]
    assert "partners" in data
    assert data["referers"]["gdt_public_portal"]["url"] == "https://congkhaithongtin.gdt.gov.vn"


def test_investigation_blacklist_report(tax_defense_client):
    r = tax_defense_client.get("/api/tax-defense/investigation-blacklist")
    assert r.status_code == 200
    data = r.json()
    assert "input_risks" in data
    assert "output_risks" in data
    assert "official_referers" in data
    assert len(data["legal_basis"]) >= 3
    assert "đầu vào" in data["input_risks"]["guidance"].lower()
    assert "đầu ra" in data["output_risks"]["guidance"].lower()
