from __future__ import annotations

from datetime import date

from app.payroll import PayrollInput, calculate_payroll, calculate_pit


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
