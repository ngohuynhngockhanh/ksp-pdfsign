"""Tinh luong Viet Nam 2026 va review file Excel luong hien huu."""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path
import re
from typing import Any

from openpyxl import load_workbook


SELF_DEDUCTION = 15_500_000
DEPENDENT_DEDUCTION = 6_200_000


@dataclass
class PayrollInput:
    month: date
    base_salary: float
    standard_days: float
    actual_days: float
    insurance_salary: float | None = None
    meal_allowance: float = 0
    phone_allowance: float = 0
    fuel_allowance: float = 0
    responsibility_allowance: float = 0
    overtime_pay: float = 0
    bonus: float = 0
    other_taxable: float = 0
    unpaid_deduction: float = 0
    dependents: int = 0


@dataclass
class PayrollResult:
    prorated_salary: float
    gross_income: float
    insurance_salary: float
    employee_insurance: float
    employer_insurance: float
    trade_union_fee: float
    taxable_income_before_deductions: float
    pit_taxable_income: float
    pit: float
    net_income: float
    total_employer_cost: float

    def to_dict(self) -> dict[str, float]:
        return asdict(self)


def _money(value: float) -> float:
    return float(round(max(value, 0)))


def calculate_pit(taxable_income: float) -> float:
    """Bieu thue luy tien 5 bac ap dung thu nhap tien luong tu nam 2026."""
    remaining = max(taxable_income, 0)
    tax = 0.0
    previous = 0.0
    for ceiling, rate in ((10e6, .05), (30e6, .10), (60e6, .20), (100e6, .30)):
        portion = min(remaining, ceiling - previous)
        tax += portion * rate
        remaining -= portion
        previous = ceiling
        if remaining <= 0:
            return _money(tax)
    return _money(tax + remaining * .35)


def calculate_payroll(data: PayrollInput) -> PayrollResult:
    if data.standard_days <= 0 or data.actual_days < 0:
        raise ValueError("Ngay cong khong hop le")
    salary = data.base_salary * min(data.actual_days, data.standard_days) / data.standard_days
    gross = salary + data.meal_allowance + data.phone_allowance + data.fuel_allowance
    gross += data.responsibility_allowance + data.overtime_pay + data.bonus + data.other_taxable
    insurance_base = data.insurance_salary if data.insurance_salary is not None else data.base_salary
    employee_insurance = insurance_base * .105
    employer_insurance = insurance_base * .215
    trade_union_fee = insurance_base * .02
    meal_exempt_cap = 1_200_000 if data.month >= date(2026, 7, 1) else 730_000
    taxable_before = gross - min(data.meal_allowance, meal_exempt_cap) - data.overtime_pay
    # Dien thoai/xang chi duoc mien khi co quy che/chung tu; mac dinh bao thu de review.
    pit_base = taxable_before - employee_insurance - SELF_DEDUCTION
    pit_base -= max(data.dependents, 0) * DEPENDENT_DEDUCTION
    pit = calculate_pit(pit_base)
    net = gross - employee_insurance - pit - data.unpaid_deduction
    employer_cost = gross + employer_insurance + trade_union_fee
    return PayrollResult(*map(_money, (
        salary, gross, insurance_base, employee_insurance, employer_insurance,
        trade_union_fee, taxable_before, pit_base, pit, net, employer_cost,
    )))


def detect_month(*texts: str) -> str:
    combined = " ".join(texts).lower()
    match = re.search(r"(?:th[aá]ng\s*)?(1[0-2]|0?[1-9])\D+(20\d{2})", combined)
    if not match:
        match = re.search(r"(20\d{2})\D+(1[0-2]|0?[1-9])", combined)
        if match:
            return f"{int(match.group(1)):04d}-{int(match.group(2)):02d}"
        return ""
    return f"{int(match.group(2)):04d}-{int(match.group(1)):02d}"


def review_workbook(path: Path) -> dict[str, Any]:
    """Doc bo cuc Excel cu va tra ve snapshot toi thieu, khong luu ten NV vao log."""
    workbook = load_workbook(path, data_only=False, read_only=True)
    sheet = workbook[workbook.sheetnames[0]]
    findings: list[dict[str, str]] = []
    max_row = sheet.max_row or 0
    if max_row >= 15 and all(sheet.cell(row, 19).value in (None, "") for row in range(15, max_row + 1)):
        findings.append({"level": "do", "code": "missing_kpcd", "message": "Cot KPCD 2% dang trong."})
    month = detect_month(sheet.title, path.name)
    rows = []
    for row in range(15, min(max_row, 200) + 1):
        code = sheet.cell(row, 2).value
        name = sheet.cell(row, 3).value
        if not code and not name:
            continue
        rows.append({"row": row, "code": str(code or ""), "has_name": bool(name)})
        meal = sheet.cell(row, 8).value
        if month >= "2026-07" and isinstance(meal, (int, float)) and meal > 1_200_000:
            findings.append({"level": "vang", "code": "meal_cap", "message": "Tien an vuot 1,2 trieu tu 01/07/2026."})
    return {"sheet": sheet.title, "month": month, "rows": rows, "findings": findings}
