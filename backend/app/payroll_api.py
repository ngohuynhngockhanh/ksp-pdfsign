from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from datetime import date, datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from openpyxl import Workbook
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .auth import CurrentUser, require_admin
from .config import get_settings
from .db import JobRun, PayrollEmployee, PayrollImport, PayrollLine, PayrollPeriod, get_session
from .payroll import PayrollInput, calculate_payroll, review_workbook
from . import audit

router = APIRouter(prefix="/api/payroll", tags=["payroll"])


class EmployeeIn(BaseModel):
    code: str
    name: str
    position: str = ""
    base_salary: float = Field(ge=0)
    insurance_salary: float = Field(ge=0)
    meal_allowance: float = Field(default=0, ge=0)
    phone_allowance: float = Field(default=0, ge=0)
    fuel_allowance: float = Field(default=0, ge=0)
    responsibility_allowance: float = Field(default=0, ge=0)
    dependents: int = Field(default=0, ge=0)


class PeriodIn(BaseModel):
    month: str = Field(pattern=r"^20\d\d-(0[1-9]|1[0-2])$")


class LineIn(BaseModel):
    standard_days: float | None = Field(default=None, gt=0)
    actual_days: float | None = Field(default=None, ge=0)
    overtime_pay: float | None = Field(default=None, ge=0)
    bonus: float | None = Field(default=None, ge=0)
    other_taxable: float | None = Field(default=None, ge=0)
    unpaid_deduction: float | None = Field(default=None, ge=0)
    override_net: float | None = Field(default=None, ge=0)
    override_reason: str = ""

    @model_validator(mode="after")
    def require_reason(self):
        if self.override_net is not None and not self.override_reason.strip():
            raise ValueError("Override phai co ly do")
        return self


def _loads(value: str, default):
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return default


def _employee(row: PayrollEmployee):
    return {key: getattr(row, key) for key in (
        "id", "code", "name", "position", "base_salary", "insurance_salary",
        "meal_allowance", "phone_allowance", "fuel_allowance",
        "responsibility_allowance", "dependents", "active",
    )}


def _recalculate(period: PayrollPeriod, line: PayrollLine):
    employee = _loads(line.employee_snapshot, {})
    month = date.fromisoformat(period.month + "-01")
    result = calculate_payroll(PayrollInput(
        month=month, base_salary=employee["base_salary"],
        insurance_salary=employee["insurance_salary"], standard_days=line.standard_days,
        actual_days=line.actual_days, meal_allowance=employee.get("meal_allowance", 0),
        phone_allowance=employee.get("phone_allowance", 0), fuel_allowance=employee.get("fuel_allowance", 0),
        responsibility_allowance=employee.get("responsibility_allowance", 0),
        dependents=employee.get("dependents", 0), overtime_pay=line.overtime_pay,
        bonus=line.bonus, other_taxable=line.other_taxable, unpaid_deduction=line.unpaid_deduction,
    )).to_dict()
    overrides = _loads(line.overrides, {})
    if "net_income" in overrides:
        result["canonical_net_income"] = result["net_income"]
        result["net_income"] = overrides["net_income"]
    line.computed = json.dumps(result)
    return result


def _period(db: Session, row: PayrollPeriod):
    lines = db.scalars(select(PayrollLine).where(PayrollLine.period_id == row.id).order_by(PayrollLine.id)).all()
    return {"id": row.id, "month": row.month, "version": row.version, "status": row.status,
            "findings": _loads(row.findings, []), "lines": [
                {"id": line.id, "employee_id": line.employee_id,
                 "employee": _loads(line.employee_snapshot, {}), "standard_days": line.standard_days,
                 "actual_days": line.actual_days, "overtime_pay": line.overtime_pay, "bonus": line.bonus,
                 "other_taxable": line.other_taxable, "unpaid_deduction": line.unpaid_deduction,
                 "computed": _loads(line.computed, {}), "overrides": _loads(line.overrides, {}),
                 "override_reason": line.override_reason} for line in lines]}


@router.get("/employees")
def list_employees(db: Session = Depends(get_session), _: CurrentUser = Depends(require_admin)):
    return [_employee(x) for x in db.scalars(select(PayrollEmployee).order_by(PayrollEmployee.code)).all()]


@router.post("/employees")
def create_employee(payload: EmployeeIn, db: Session = Depends(get_session), _: CurrentUser = Depends(require_admin)):
    if db.scalar(select(PayrollEmployee).where(PayrollEmployee.code == payload.code.strip())):
        raise HTTPException(409, "Ma nhan vien da ton tai")
    values = payload.model_dump()
    values.update(code=payload.code.strip(), name=payload.name.strip())
    row = PayrollEmployee(**values)
    db.add(row); db.commit(); db.refresh(row)
    return _employee(row)


@router.get("/periods")
def list_periods(db: Session = Depends(get_session), _: CurrentUser = Depends(require_admin)):
    rows = db.scalars(select(PayrollPeriod).order_by(PayrollPeriod.month.desc(), PayrollPeriod.version.desc())).all()
    return [_period(db, row) for row in rows]


@router.post("/periods")
def create_period(payload: PeriodIn, db: Session = Depends(get_session), user: CurrentUser = Depends(require_admin)):
    version = (db.scalar(select(func.max(PayrollPeriod.version)).where(PayrollPeriod.month == payload.month)) or 0) + 1
    row = PayrollPeriod(month=payload.month, version=version, created_by=user.id,
                        policy_snapshot=json.dumps({"pit": "109/2025/QH15", "self": 15500000,
                                                    "dependent": 6200000, "kpcd": .02}))
    db.add(row); db.flush()
    employees = db.scalars(select(PayrollEmployee).where(PayrollEmployee.active.is_(True))).all()
    for employee in employees:
        line = PayrollLine(period_id=row.id, employee_id=employee.id,
                           employee_snapshot=json.dumps(_employee(employee), ensure_ascii=False),
                           standard_days=22, actual_days=0, overtime_pay=0, bonus=0,
                           other_taxable=0, unpaid_deduction=0, overrides="{}")
        _recalculate(row, line); db.add(line)
    db.commit(); db.refresh(row)
    return _period(db, row)


def _get_period(db: Session, period_id: int):
    row = db.get(PayrollPeriod, period_id)
    if not row: raise HTTPException(404, "Khong tim thay ky luong")
    return row


@router.put("/periods/{period_id}/lines/{line_id}")
def update_line(period_id: int, line_id: int, payload: LineIn, db: Session = Depends(get_session), user: CurrentUser = Depends(require_admin)):
    period = _get_period(db, period_id)
    if period.status == "locked": raise HTTPException(409, "Ky luong da khoa")
    line = db.get(PayrollLine, line_id)
    if not line or line.period_id != period.id: raise HTTPException(404, "Khong tim thay dong luong")
    for field in ("standard_days", "actual_days", "overtime_pay", "bonus", "other_taxable", "unpaid_deduction"):
        value = getattr(payload, field)
        if value is not None: setattr(line, field, value)
    if payload.override_net is not None:
        line.overrides = json.dumps({"net_income": payload.override_net})
        line.override_reason = payload.override_reason.strip()
        audit.record(db, user.username, user.role, user.ip, "payroll_override",
                     f"period:{period.id}/line:{line.id}", line.override_reason)
    line.updated_at = datetime.now(timezone.utc); _recalculate(period, line)
    period.status = "draft"; db.commit()
    return _period(db, period)


@router.post("/periods/{period_id}/review")
def review_period(period_id: int, db: Session = Depends(get_session), _: CurrentUser = Depends(require_admin)):
    row = _get_period(db, period_id)
    if row.status == "locked": raise HTTPException(409, "Ky luong da khoa")
    lines = db.scalars(select(PayrollLine).where(PayrollLine.period_id == row.id)).all()
    findings = []
    if not lines: findings.append({"level": "do", "message": "Ky luong chua co nhan vien."})
    for line in lines:
        employee = _loads(line.employee_snapshot, {})
        stable = employee.get("responsibility_allowance", 0)
        if stable and employee.get("insurance_salary", 0) <= employee.get("base_salary", 0):
            findings.append({"level": "vang", "employee_code": employee.get("code"),
                             "message": "Kiem tra phu cap trach nhiem on dinh trong nen BHXH."})
    row.findings = json.dumps(findings, ensure_ascii=False); row.status = "reviewed"
    row.reviewed_at = datetime.now(timezone.utc); db.commit()
    return _period(db, row)


@router.post("/periods/{period_id}/lock")
def lock_period(period_id: int, db: Session = Depends(get_session), _: CurrentUser = Depends(require_admin)):
    row = _get_period(db, period_id)
    if row.status != "reviewed": raise HTTPException(409, "Phai review truoc khi khoa")
    if any(x.get("level") == "do" for x in _loads(row.findings, [])):
        raise HTTPException(409, "Con loi muc do do")
    row.status = "locked"; row.locked_at = datetime.now(timezone.utc); db.commit()
    return _period(db, row)


@router.post("/imports")
async def upload_import(file: UploadFile = File(...), db: Session = Depends(get_session), user: CurrentUser = Depends(require_admin)):
    data = await file.read()
    if not file.filename or not file.filename.lower().endswith(".xlsx"): raise HTTPException(400, "Chi nhan XLSX")
    root = get_settings().data_path / "payroll_imports"; root.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(data).hexdigest(); path = root / f"{digest}.xlsx"; path.write_bytes(data)
    snapshot = review_workbook(path)
    row = PayrollImport(month=snapshot["month"], filename=Path(file.filename).name, sha256=digest,
                        snapshot=json.dumps(snapshot, ensure_ascii=False),
                        findings=json.dumps(snapshot["findings"], ensure_ascii=False), imported_by=user.id)
    db.add(row); db.commit(); db.refresh(row)
    return {"id": row.id, "filename": row.filename, **snapshot}


def _update_job(db: Session, job: JobRun, **stats) -> None:
    current = _loads(job.stats, {})
    current.update(stats)
    job.stats = json.dumps(current, ensure_ascii=False)
    db.commit()


def _run_drive_sync(job_id: int, user_id: int) -> None:
    gen = get_session()
    db = next(gen)
    job = db.get(JobRun, job_id)
    if not job:
        gen.close()
        return
    try:
        _update_job(db, job, phase="connecting", progress=10, message="Đang kết nối Google Drive")
        result = _sync_drive_files(db, user_id, job)
        job.status = "success"
        job.stats = json.dumps({**result, "phase": "done", "progress": 100,
                                "message": f"Hoàn tất {len(result['files'])} file"}, ensure_ascii=False)
    except Exception as exc:
        db.rollback()
        job = db.get(JobRun, job_id)
        job.status = "failed"
        job.error = str(exc)[:1000]
    job.finished_at = datetime.now(timezone.utc)
    db.commit()
    gen.close()


def _sync_drive_files(db: Session, user_id: int, job: JobRun | None = None) -> dict:
    target = get_settings().data_path / "payroll_drive"; target.mkdir(parents=True, exist_ok=True)
    local_rclone = Path.home() / ".local" / "bin" / "rclone"
    rclone = shutil.which("rclone") or (str(local_rclone) if local_rclone.is_file() else "")
    if not rclone:
        raise HTTPException(503, "Khong tim thay rclone tren may chu")
    command = [rclone, "copy", "vnmap-drive:", str(target), "--drive-root-folder-id",
               "1FSWhB8T_yWB2MD6ig181qgM_NnEX3GvI", "--include", "*.xlsx", "--max-depth", "1",
               "--bind", "0.0.0.0"]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=180, check=False)
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(504, "Dong bo Drive qua thoi gian cho") from exc
    if result.returncode: raise HTTPException(502, f"Dong bo Drive loi: {result.stderr[-300:]}")
    if job:
        _update_job(db, job, phase="reviewing", progress=55, message="Đang kiểm tra các file Excel")
    imported = 0
    summaries = []
    paths = [path for path in sorted(target.glob("*.xlsx")) if not path.name.startswith("~$")]
    for index, path in enumerate(paths, 1):
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        try:
            snapshot = review_workbook(path)
        except Exception as exc:  # File loi khong duoc lam hong ca dot sync.
            summaries.append({"filename": path.name, "findings": 0,
                              "error": f"Khong doc duoc Excel: {type(exc).__name__}"})
            continue
        summaries.append({"filename": path.name, "findings": len(snapshot["findings"])})
        if db.scalar(select(PayrollImport).where(PayrollImport.sha256 == digest)):
            continue
        db.add(PayrollImport(month=snapshot["month"], filename=path.name, drive_file_id=path.name,
                             sha256=digest, snapshot=json.dumps(snapshot, ensure_ascii=False),
                             findings=json.dumps(snapshot["findings"], ensure_ascii=False),
                             imported_by=user_id))
        imported += 1
        if job:
            _update_job(db, job, phase="reviewing", progress=55 + round(index / max(len(paths), 1) * 40),
                        message=f"Đang kiểm tra file {index}/{len(paths)}")
    db.commit()
    return {"files": [x["filename"] for x in summaries], "summaries": summaries,
            "imported": imported, "read_only": True}


@router.post("/sync-drive")
def start_drive_sync(background: BackgroundTasks, db: Session = Depends(get_session),
                     user: CurrentUser = Depends(require_admin)):
    running = db.scalar(select(JobRun).where(JobRun.kind == "payroll_drive_sync",
                                               JobRun.status == "running").order_by(JobRun.id.desc()))
    if running:
        return {"job_id": running.id, "status": running.status}
    job = JobRun(kind="payroll_drive_sync", status="running",
                 stats=json.dumps({"phase": "queued", "progress": 2, "message": "Đã xếp hàng đồng bộ"}))
    db.add(job); db.commit(); db.refresh(job)
    background.add_task(_run_drive_sync, job.id, user.id)
    return {"job_id": job.id, "status": job.status}


@router.get("/sync-drive/status")
def drive_sync_status(db: Session = Depends(get_session), _: CurrentUser = Depends(require_admin)):
    job = db.scalar(select(JobRun).where(JobRun.kind == "payroll_drive_sync").order_by(JobRun.id.desc()))
    if not job:
        return {"job": None}
    return {"job": {"id": job.id, "status": job.status, "stats": _loads(job.stats, {}),
                    "error": job.error, "started_at": job.started_at.isoformat(),
                    "finished_at": job.finished_at.isoformat() if job.finished_at else ""}}


@router.get("/periods/{period_id}/export")
def export_period(period_id: int, db: Session = Depends(get_session), _: CurrentUser = Depends(require_admin)):
    period = _get_period(db, period_id); data = _period(db, period)
    workbook = Workbook(); sheet = workbook.active; sheet.title = period.month
    sheet.append(["Ma NV", "Ho ten", "Luong co ban", "Ngay cong", "Tong thu nhap", "BH NV", "TNCN", "Thuc linh", "Chi phi DN"])
    for line in data["lines"]:
        emp, calc = line["employee"], line["computed"]
        sheet.append([emp["code"], emp["name"], emp["base_salary"], line["actual_days"], calc["gross_income"], calc["employee_insurance"], calc["pit"], calc["net_income"], calc["total_employer_cost"]])
    root = get_settings().data_path / "exports"; root.mkdir(parents=True, exist_ok=True)
    path = root / f"bang-luong-{period.month}-v{period.version}.xlsx"; workbook.save(path)
    return FileResponse(path, filename=path.name)
