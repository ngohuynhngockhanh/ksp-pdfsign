"""Test suite for Tax Defense & Audit Justification feature."""
from __future__ import annotations

import io
from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.auth import COOKIE_NAME, create_token
from app.config import get_settings
from app.db import User, get_session
from app.main import app

def _auth_client() -> TestClient:
    from app.db import init_db
    from app.auth import ensure_admin_seed
    init_db()
    gen = get_session()
    db = next(gen)
    settings = get_settings()
    ensure_admin_seed(db, settings)
    admin = db.query(User).filter(User.username == "admin").first()
    token = create_token(admin, settings)
    client = TestClient(app)
    client.cookies.set(COOKIE_NAME, token)
    gen.close()
    return client


def test_tax_defense_overview():
    client = _auth_client()
    r = client.get("/api/tax-defense/overview?years=2022,2023,2024,2025")
    assert r.status_code == 200
    data = r.json()
    assert "summary_matrix" in data
    assert len(data["summary_matrix"]) == 4
    # Verify year 2022
    y22 = next(m for m in data["summary_matrix"] if m["year"] == "2022")
    assert y22["year"] == "2022"
    if y22["sale_invoices_count"] > 0:
        assert y22["sale_invoices_count"] == 19
        assert y22["revenue_pretax"] > 1_000_000_000

    # Verify year 2023
    y23 = next(m for m in data["summary_matrix"] if m["year"] == "2023")
    assert y23["year"] == "2023"
    if y23["sale_invoices_count"] > 0:
        assert y23["sale_invoices_count"] == 49
        assert y23["revenue_pretax"] > 1_300_000_000

def test_tax_defense_justification_dossier():
    client = _auth_client()
    r = client.get("/api/tax-defense/justification-dossier?years=2022,2023,2024,2025")
    assert r.status_code == 200
    data = r.json()
    assert "markdown_content" in data
    assert "4401053694" in data["markdown_content"]
    assert "Thông tư 219/2013/TT-BTC" in data["markdown_content"]
    assert "KHÔNG PHỤ THUỘC TỒN KHO" in data["markdown_content"]


def test_tax_defense_export_excel():
    client = _auth_client()
    r = client.get("/api/tax-defense/export-excel?years=2022,2023,2024,2025")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert len(r.content) > 5000


def test_tax_defense_import_historical_purchase():
    client = _auth_client()
    
    # Create sample Excel workbook in memory
    wb = Workbook()
    ws = wb.active
    ws.title = "Bang_ke_mua_vao"
    import random
    unique_so_hd = random.randint(100000, 999999)
    ws.append(["STT", "Ký hiệu hóa đơn", "Số hóa đơn", "Ngày lập", "Tên người bán", "Mã số thuế người bán", "Doanh số mua chưa thuế", "Thuế GTGT", "Tổng thanh toán"])
    ws.append([1, "1C24TBB", str(unique_so_hd), "15/05/2024", "CÔNG TY TNHH LINH KIỆN MẪU", "0312345678", 50000000, 4000000, 54000000])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    
    files = {"file": ("bang_ke_mua_2024.xlsx", buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    r = client.post("/api/tax-defense/import-historical-purchase?year=2024", files=files)
    assert r.status_code == 200
    res = r.json()
    assert res["success"] is True
    assert res["imported"] >= 1


def test_check_single_mst():
    client = _auth_client()
    # Test active company
    r1 = client.get("/api/tax-defense/check-mst?mst=4401053694")
    assert r1.status_code == 200
    d1 = r1.json()
    assert d1["clean_mst"] == "4401053694"
    assert "INUT" in d1["company_name"]
    assert d1["status_code"] == "00"
    assert d1["is_active"] is True
    assert "gdt_public_portal" in d1["referers"]

    # Test Status 06 company (Khanh Loi)
    r2 = client.get("/api/tax-defense/check-mst?mst=0316764844")
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2["clean_mst"] == "0316764844"
    assert d2["status_code"] == "06"
    assert d2["is_abandoned"] is True
    assert d2["risk_level"] == "high"
    assert "Trạng thái 06" in d2["defense_note"]


def test_partner_status_audit():
    client = _auth_client()
    r = client.get("/api/tax-defense/partner-status?years=2024&limit=10")
    assert r.status_code == 200
    data = r.json()
    assert "total_checked" in data
    assert "referers" in data
    assert "gdt_public_portal" in data["referers"]
    assert "partners" in data
    assert data["referers"]["gdt_public_portal"]["url"] == "https://congkhaithongtin.gdt.gov.vn"


def test_investigation_blacklist_report():
    client = _auth_client()
    r = client.get("/api/tax-defense/investigation-blacklist")
    assert r.status_code == 200
    data = r.json()
    assert "input_risks" in data
    assert "output_risks" in data
    assert "official_referers" in data
    assert len(data["legal_basis"]) >= 3
    # Check guidance notes exist
    assert "đầu vào" in data["input_risks"]["guidance"].lower()
    assert "đầu ra" in data["output_risks"]["guidance"].lower()
