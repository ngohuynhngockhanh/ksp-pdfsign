"""Van han dong bo thue, dashboard chung tu va to khai noi bo."""
from __future__ import annotations

import io
import json
import smtplib
from datetime import date, datetime, timedelta, timezone
from email.message import EmailMessage

from openpyxl import Workbook
from sqlalchemy import select

from . import crypto, storage, tax
from .db import AppSetting, InvPurchase, InvSale, JobRun, TaxReport


def document_state(inv) -> str:
    if not inv.doc_id or not storage.exists(inv.doc_id, inv.doc_suffix or ".pdf"):
        return "missing"
    if storage.exists(inv.doc_id, ".pdf") or (inv.doc_suffix or ".pdf") == ".pdf":
        return "ready"
    return "renderable" if storage.exists(inv.doc_id, ".html") else "source_only"


def dashboard(db) -> dict:
    purchases = list(db.scalars(select(InvPurchase)))
    sales = list(db.scalars(select(InvSale)))
    states = {"missing": 0, "renderable": 0, "source_only": 0, "ready": 0}
    queue = []
    for kind, rows in (("purchase", purchases), ("sale", sales)):
        for inv in rows:
            state = document_state(inv)
            states[state] += 1
            if state != "ready":
                queue.append({
                    "kind": kind, "id": inv.id, "state": state, "ngay": inv.ngay,
                    "so_hd": inv.so_hd, "partner": inv.ten_ban if kind == "purchase" else inv.ten_mua,
                    "status": inv.status,
                })
    latest = db.scalar(select(JobRun).where(JobRun.kind == "tax_sync").order_by(JobRun.id.desc()))
    report = db.scalar(select(TaxReport).order_by(TaxReport.id.desc()))
    return {
        "purchases": len(purchases), "purchase_drafts": sum(x.status == "draft" for x in purchases),
        "sales": len(sales), "sale_drafts": sum(x.status == "draft" for x in sales),
        "documents": states, "document_queue": queue[:100],
        "latest_sync": serialize_run(latest) if latest else None,
        "latest_report": serialize_report(report) if report else None,
    }


def serialize_run(run: JobRun) -> dict:
    return {
        "id": run.id, "kind": run.kind, "status": run.status,
        "period_from": run.period_from, "period_to": run.period_to,
        "stats": json.loads(run.stats or "{}"), "error": run.error,
        "needs_action": run.needs_action,
        "started_at": run.started_at.isoformat(),
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
    }


def _setting(db, key: str, secret: bool = False) -> str:
    row = db.get(AppSetting, key)
    if not row:
        return ""
    value = row.value or ""
    if secret and value.startswith("enc:"):
        return crypto.decrypt(value[4:])
    return value


def send_alert_email(db, subject: str, body: str) -> bool:
    host, recipient = _setting(db, "smtp_host"), _setting(db, "smtp_to")
    if not host or not recipient:
        return False
    port = int(_setting(db, "smtp_port") or 587)
    username = _setting(db, "smtp_username")
    password = _setting(db, "smtp_password", secret=True)
    sender = _setting(db, "smtp_from") or username
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = subject, sender, recipient
    msg.set_content(body)
    with smtplib.SMTP(host, port, timeout=15) as client:
        client.starttls()
        if username:
            client.login(username, password)
        client.send_message(msg)
    return True


def daily_range(today: date | None = None) -> tuple[str, str]:
    today = today or date.today()
    first = today.replace(day=1) - timedelta(days=7)
    return first.isoformat(), today.isoformat()


def run_tax_sync(db) -> JobRun:
    tu, den = daily_range()
    run = JobRun(kind="tax_sync", period_from=tu, period_to=den)
    db.add(run); db.commit(); db.refresh(run)
    try:
        token_row = db.get(AppSetting, "tax_token_enc")
        token = crypto.decrypt(token_row.value) if token_row else ""
        if not tax.check_token(token):
            raise PermissionError("Phiên cổng thuế hết hạn; cần nhập captcha lại trong CRM")
        invoices = tax.fetch_invoices(token, tu, den)
        result = tax.reconcile(db, invoices, tu, den)
        result["import"] = tax.import_missing_purchases(db, token, result["missing_mua"])
        result["attach"] = tax.attach_missing_xml(db, token, invoices.get("mua", []))
        run.status = "success"
        run.stats = json.dumps(result, ensure_ascii=False)
    except PermissionError as exc:
        run.status, run.needs_action, run.error = "needs_action", True, str(exc)
        try:
            send_alert_email(db, "[KSP CRM] Cần đăng nhập lại cổng thuế", str(exc))
        except Exception:
            pass
    except Exception as exc:  # noqa: BLE001
        run.status, run.error = "failed", f"{type(exc).__name__}: {exc}"[:2000]
        try:
            send_alert_email(db, "[KSP CRM] Đồng bộ thuế thất bại", run.error)
        except Exception:
            pass
    run.finished_at = datetime.now(timezone.utc)
    db.commit(); db.refresh(run)
    return run


def _quarter_range(ky: str) -> tuple[str, str]:
    year, q = ky.upper().split("-Q")
    start_month = (int(q) - 1) * 3 + 1
    start = date(int(year), start_month, 1)
    end_month = start_month + 2
    next_month = date(int(year) + (end_month == 12), 1 if end_month == 12 else end_month + 1, 1)
    return start.isoformat(), (next_month - timedelta(days=1)).isoformat()


def previous_quarter(ky: str) -> str:
    year, q = ky.upper().split("-Q"); y, n = int(year), int(q)
    return f"{y - 1}-Q4" if n == 1 else f"{y}-Q{n - 1}"


def build_report(db, ky: str) -> tuple[dict, list[dict]]:
    tu, den = _quarter_range(ky)
    sales = list(db.scalars(select(InvSale).where(InvSale.ngay >= tu, InvSale.ngay <= den, InvSale.status != "void")))
    purchases = list(db.scalars(select(InvPurchase).where(InvPurchase.ngay >= tu, InvPurchase.ngay <= den, InvPurchase.status != "void")))
    buckets = {"kct": 0.0, "0": 0.0, "5": 0.0, "8": 0.0, "10": 0.0, "other": 0.0}
    tax_buckets = {k: 0.0 for k in buckets}
    warnings = []
    for inv in sales:
        if inv.is_dieu_chinh:
            continue
        if not inv.lines:
            warnings.append({"level": "do", "invoice_id": inv.id, "message": "Hóa đơn bán chưa có dòng hàng"})
        for line in inv.lines:
            rate = float(line.thue_suat or 0)
            key = "kct" if getattr(line, "thue_kct", False) else str(int(rate)) if rate in {0, 5, 8, 10} else "other"
            buckets[key] += line.thanh_tien or 0
            tax_buckets[key] += (line.thanh_tien or 0) * rate / 100
            if key == "0" and not getattr(line, "thue_kct", False):
                warnings.append({"level": "vang", "invoice_id": inv.id, "message": "Thuế 0% cần xác nhận không phải KCT"})
    mua_base = sum(x.tong_truoc_thue or 0 for x in purchases)
    mua_tax = sum(x.tong_thue or 0 for x in purchases)
    prev = db.scalar(select(TaxReport).where(TaxReport.ky == previous_quarter(ky), TaxReport.status == "locked").order_by(TaxReport.version.desc()))
    ct22 = float(json.loads(prev.snapshot).get("43", 0)) if prev else 0.0
    ct26 = buckets["kct"]
    ct29, ct30, ct31 = buckets["0"], buckets["5"], tax_buckets["5"]
    ct32 = buckets["8"] + buckets["10"]
    ct33 = tax_buckets["8"] + tax_buckets["10"]
    ct27, ct28 = ct29 + ct30 + ct32, ct31 + ct33
    ct34, ct35, ct25 = ct26 + ct27, ct28, mua_tax
    ct36 = ct35 - ct25
    tmp = ct36 - ct22
    ct40, ct41 = (tmp, 0.0) if tmp >= 0 else (0.0, -tmp)
    snap = {
        "22": ct22, "23": mua_base, "24": mua_tax, "25": ct25,
        "26": ct26, "27": ct27, "28": ct28, "29": ct29, "30": ct30,
        "31": ct31, "32": ct32, "33": ct33, "34": ct34, "35": ct35,
        "36": ct36, "40": ct40, "41": ct41, "43": ct41,
        "split_8_base": buckets["8"], "split_8_tax": tax_buckets["8"],
        "split_10_base": buckets["10"], "split_10_tax": tax_buckets["10"],
        "so_hd_ban": len(sales), "so_hd_mua": len(purchases), "tu": tu, "den": den,
    }
    if buckets["other"]:
        warnings.append({"level": "do", "message": f"Có {buckets['other']:,.0f}đ doanh thu thuế suất chưa hỗ trợ"})
    return snap, warnings


def report_xlsx(ky: str, snapshot: dict, sales, purchases) -> bytes:
    wb = Workbook(); ws = wb.active; ws.title = "Tờ khai 01-GTGT"
    ws.append(["TỜ KHAI THUẾ GTGT NỘI BỘ", ky]); ws.append([]); ws.append(["Chỉ tiêu", "Giá trị"])
    for key in ("22", "23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "33", "34", "35", "36", "40", "41", "43"):
        ws.append([f"[{key}]", snapshot.get(key, 0)])
    ws.append([]); ws.append(["Tách 8%", snapshot.get("split_8_base", 0), snapshot.get("split_8_tax", 0)])
    ws.append(["Tách 10%", snapshot.get("split_10_base", 0), snapshot.get("split_10_tax", 0)])
    for title, rows, partner in (("Bảng kê bán ra", sales, "ten_mua"), ("Bảng kê mua vào", purchases, "ten_ban")):
        sh = wb.create_sheet(title); sh.append(["Ngày", "Ký hiệu", "Số HĐ", "Đối tác", "Trước thuế", "Thuế", "Tổng"])
        for inv in rows:
            sh.append([inv.ngay, inv.ky_hieu, inv.so_hd, getattr(inv, partner), inv.tong_truoc_thue, inv.tong_thue, inv.tong_tien])
    out = io.BytesIO(); wb.save(out); return out.getvalue()


def generate_report(db, ky: str, actor: str = "system") -> TaxReport:
    snap, warnings = build_report(db, ky); tu, den = _quarter_range(ky)
    current = db.scalar(select(TaxReport).where(TaxReport.ky == ky, TaxReport.status == "draft").order_by(TaxReport.version.desc()))
    if current is None:
        version = (db.scalar(select(TaxReport.version).where(TaxReport.ky == ky).order_by(TaxReport.version.desc())) or 0) + 1
        current = TaxReport(ky=ky, tu=tu, den=den, version=version, created_by=actor)
        db.add(current)
    sales = list(db.scalars(select(InvSale).where(InvSale.ngay >= tu, InvSale.ngay <= den, InvSale.status != "void")))
    purchases = list(db.scalars(select(InvPurchase).where(InvPurchase.ngay >= tu, InvPurchase.ngay <= den, InvPurchase.status != "void")))
    data = report_xlsx(ky, snap, sales, purchases)
    current.doc_id = storage.save_upload(data, suffix=".xlsx")
    current.snapshot, current.warnings = json.dumps(snap, ensure_ascii=False), json.dumps(warnings, ensure_ascii=False)
    current.updated_at = datetime.now(timezone.utc)
    db.commit(); db.refresh(current); return current


def serialize_report(report: TaxReport) -> dict:
    return {
        "id": report.id, "ky": report.ky, "tu": report.tu, "den": report.den,
        "version": report.version, "status": report.status,
        "snapshot": json.loads(report.snapshot or "{}"),
        "warnings": json.loads(report.warnings or "[]"),
        "created_by": report.created_by, "updated_at": report.updated_at.isoformat(),
    }
