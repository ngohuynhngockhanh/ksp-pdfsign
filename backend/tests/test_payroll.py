from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from openpyxl import Workbook, load_workbook

from app.payroll import (
    PayrollInput,
    apply_workbook_changes,
    calculate_payroll,
    calculate_pit,
    review_workbook,
)


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
    gen = dbmod.get_session()
    session = next(gen)
    ensure_admin_seed(session, get_settings())
    gen.close()
    from app.main import app

    return TestClient(app)


def _login(client):
    response = client.post(
        "/api/login", json={"username": "admin", "password": "NhapHang123@"}
    )
    assert response.status_code == 200


def test_pit_2026_uses_five_bands_and_new_family_deductions():
    assert calculate_pit(10_000_000) == 500_000
    assert calculate_pit(30_000_000) == 2_500_000
    assert calculate_pit(60_000_000) == 8_500_000
    assert calculate_pit(100_000_000) == 20_500_000
    assert calculate_pit(110_000_000) == 24_000_000


def test_july_meal_allowance_caps_exempt_amount_and_overtime_is_exempt():
    result = calculate_payroll(
        PayrollInput(
            month=date(2026, 7, 1),
            base_salary=20_000_000,
            actual_days=22,
            standard_days=22,
            meal_allowance=1_500_000,
            overtime_pay=2_000_000,
        )
    )
    assert result.gross_income == 23_500_000
    assert result.taxable_income_before_deductions == 20_300_000
    assert result.employee_insurance == 2_100_000
    assert result.pit_taxable_income == 2_700_000
    assert result.pit == 135_000


def test_meal_allowance_before_july_uses_730k_cap():
    result = calculate_payroll(PayrollInput(
        month=date(2026, 6, 1), base_salary=20_000_000, standard_days=22,
        actual_days=22, meal_allowance=1_000_000,
    ))
    assert result.taxable_income_before_deductions == 20_270_000


def test_employer_cost_includes_insurance_and_trade_union_fee():
    result = calculate_payroll(
        PayrollInput(
            month=date(2026, 6, 1),
            base_salary=10_000_000,
            actual_days=22,
            standard_days=22,
            insurance_salary=10_000_000,
        )
    )
    assert result.employer_insurance == 2_150_000
    assert result.trade_union_fee == 200_000
    assert result.total_employer_cost == 12_350_000


def test_review_legacy_workbook_flags_missing_kpcd_and_july_meal_cap(tmp_path):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Thang 7-2026"
    sheet.cell(15, 2, "NV-DEMO")
    sheet.cell(15, 3, "Nhan vien mau")
    sheet.cell(15, 8, 1_500_000)
    path = tmp_path / "bang-luong-an-danh.xlsx"
    workbook.save(path)

    review = review_workbook(path)
    assert review["rows"] == [{"row": 15, "code": "NV-DEMO", "has_name": True}]
    assert {finding["code"] for finding in review["findings"]} == {"missing_kpcd", "meal_cap"}

    sheet.title = "Thang 8-2026"
    workbook.save(path)
    august = review_workbook(path)
    assert august["month"] == "2026-08"
    assert any(finding["code"] == "meal_cap" for finding in august["findings"])


def test_review_empty_workbook_does_not_crash(tmp_path):
    workbook = Workbook()
    path = tmp_path / "empty.xlsx"
    workbook.save(path)
    review = review_workbook(path)
    assert review["rows"] == []
    assert review["findings"] == []


def test_payroll_period_workflow_and_override_reason(client):
    _login(client)
    employee = client.post(
        "/api/payroll/employees",
        json={
            "code": "NV-TEST-01",
            "name": "Nhan vien A",
            "base_salary": 12_000_000,
            "insurance_salary": 12_000_000,
            "dependents": 0,
        },
    )
    assert employee.status_code == 200, employee.text

    period = client.post("/api/payroll/periods", json={"month": "2026-07"})
    assert period.status_code == 200, period.text
    period_id = period.json()["id"]
    line_id = period.json()["lines"][0]["id"]

    no_reason = client.put(
        f"/api/payroll/periods/{period_id}/lines/{line_id}",
        json={"override_net": 99_000_000},
    )
    assert no_reason.status_code == 422

    updated = client.put(
        f"/api/payroll/periods/{period_id}/lines/{line_id}",
        json={"actual_days": 22, "standard_days": 22},
    )
    assert updated.status_code == 200, updated.text

    reviewed = client.post(f"/api/payroll/periods/{period_id}/review")
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["status"] == "reviewed"

    locked = client.post(f"/api/payroll/periods/{period_id}/lock")
    assert locked.status_code == 200, locked.text
    assert locked.json()["status"] == "locked"

    rejected = client.put(
        f"/api/payroll/periods/{period_id}/lines/{line_id}",
        json={"actual_days": 21, "standard_days": 22},
    )
    assert rejected.status_code == 409


def test_drive_sync_runs_as_job_and_reports_progress(client, monkeypatch):
    from app.config import get_settings
    from app import payroll_api

    target = get_settings().data_path / "payroll_drive"
    target.mkdir(parents=True, exist_ok=True)
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Thang 7-2026"
    sheet.cell(15, 2, "NV-DEMO")
    workbook.save(target / "payroll-demo.xlsx")
    monkeypatch.setattr(
        payroll_api.subprocess,
        "run",
        lambda *args, **kwargs: payroll_api.subprocess.CompletedProcess(args[0], 0, "", ""),
    )

    _login(client)
    started = client.post("/api/payroll/sync-drive")
    assert started.status_code == 200, started.text
    assert started.json()["job_id"] > 0

    status = client.get("/api/payroll/sync-drive/status")
    assert status.status_code == 200
    job = status.json()["job"]
    assert job["status"] == "success"
    assert job["stats"]["progress"] == 100
    assert job["stats"]["files"] == ["payroll-demo.xlsx"]

    imports = client.get("/api/payroll/imports")
    assert imports.status_code == 200
    assert imports.json()[0]["filename"] == "payroll-demo.xlsx"
    detail = client.get(f"/api/payroll/imports/{imports.json()[0]['id']}")
    assert detail.status_code == 200
    assert detail.json()["snapshot"]["grid"][14][1] == "NV-DEMO"


def test_apply_workbook_changes_updates_meal_bonus_and_overtime_formulas(tmp_path):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Tháng 7"
    sheet["B15"] = "NV-DEMO"
    sheet["C15"] = "Nhân viên mẫu"
    sheet["D15"] = 12_000_000
    sheet["E15"] = 26
    source = tmp_path / "source.xlsx"
    output = tmp_path / "draft.xlsx"
    workbook.save(source)

    apply_workbook_changes(source, output, [{
        "row": 15,
        "meal_allowance": 1_200_000,
        "attendance_bonus": 2_000_000,
        "overtime_weekday_hours": 12,
        "overtime_weekend_hours": 8,
    }])

    changed = load_workbook(output, data_only=False).active
    assert changed["I15"].value == 1_200_000
    assert changed["M15"].value == 2_000_000
    assert changed["N15"].value == "=(D15/E15/8)*1.5*12"
    assert changed["O15"].value == "=(D15/E15/8)*2*8"


def test_import_draft_workflow_save_review_and_upload(client, monkeypatch):
    from app.config import get_settings
    from app import payroll_api

    target = get_settings().data_path / "payroll_drive"
    target.mkdir(parents=True, exist_ok=True)
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Tháng 7"
    sheet["B15"] = "NV-DEMO"
    sheet["C15"] = "Nhân viên mẫu"
    sheet["D15"] = 12_000_000
    sheet["E15"] = 26
    sheet["I15"] = 1_500_000
    sheet["S15"] = 240_000
    workbook.save(target / "payroll-edit-demo.xlsx")
    monkeypatch.setattr(
        payroll_api.subprocess, "run",
        lambda *args, **kwargs: payroll_api.subprocess.CompletedProcess(args[0], 0, "", ""),
    )
    _login(client)
    client.post("/api/payroll/sync-drive")
    imported = next(row for row in client.get("/api/payroll/imports").json()
                    if row["filename"] == "payroll-edit-demo.xlsx")

    saved = client.post(f"/api/payroll/imports/{imported['id']}/draft", json={"changes": [{
        "row": 15, "meal_allowance": 1_200_000, "attendance_bonus": 2_000_000,
        "overtime_weekday_hours": 12, "overtime_weekend_hours": 8,
        "reason": "Tháng có nhiều hợp đồng",
    }]})
    assert saved.status_code == 200, saved.text
    draft_id = saved.json()["id"]
    assert saved.json()["status"] == "draft"

    reviewed = client.post(f"/api/payroll/drafts/{draft_id}/review")
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["status"] == "reviewed"
    assert not any(f["code"] == "meal_cap" for f in reviewed.json()["findings"])

    uploaded = client.post(f"/api/payroll/drafts/{draft_id}/upload-drive")
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["status"] == "uploaded"
    assert "- đã review - bản " in uploaded.json()["drive_filename"]
