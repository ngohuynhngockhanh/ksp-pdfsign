"""Dong bo hoa don da phat hanh tu iHOADON vao cong khach hang."""
from __future__ import annotations

import fcntl
import io
import json
import re
import zipfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import storage
from .db import Customer, IhoadonInvoice, JobRun
from .ihoadon import Client, IhoadonError


class SyncBusy(RuntimeError):
    pass


class XmlUnavailable(RuntimeError):
    pass


def normalize_tax_code(value: str) -> str:
    return "".join(re.findall(r"\d", value or ""))


def _date(value: str) -> str:
    return (value or "")[:10]


def _safe_filename(value: str, fallback: str) -> str:
    name = Path(value or "").name.strip() or fallback
    return re.sub(r"[^A-Za-z0-9._ -]+", "_", name)[:240]


def _extract_xml(content: bytes) -> tuple[str, bytes]:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            entries = [x for x in zf.infolist() if not x.is_dir() and x.filename.lower().endswith(".xml")]
            if len(entries) != 1:
                raise IhoadonError("Gói XML phải chứa đúng một file XML")
            raw = zf.read(entries[0])
            name = _safe_filename(entries[0].filename, "hoa-don.xml")
    except zipfile.BadZipFile as e:
        raise IhoadonError("iHOADON trả gói XML không hợp lệ") from e
    # Một số hóa đơn cũ chứa XML ký số/encoding mà ElementTree không parse được;
    # giữ nguyên byte pháp lý do iHOADON xuất thay vì sửa hoặc loại bỏ file.
    if not raw.strip():
        raise XmlUnavailable("iHOADON không cung cấp XML cho hóa đơn cũ")
    return name, raw


@contextmanager
def sync_lock(data_path: Path):
    lock_path = data_path / "ihoadon-sync.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+") as fh:
        try:
            fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as e:
            raise SyncBusy("Một phiên đồng bộ iHOADON đang chạy") from e
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def _customer_matches(db: Session) -> dict[str, list[int]]:
    out: dict[str, list[int]] = {}
    for customer in db.scalars(select(Customer)):
        code = normalize_tax_code(customer.tax_code)
        if code:
            out.setdefault(code, []).append(customer.id)
    return out


def _upsert_metadata(db: Session, source: dict, matches: dict[str, list[int]]) -> tuple[IhoadonInvoice, bool]:
    external_id = str(source.get("id") or "")
    if not external_id:
        raise IhoadonError("Hóa đơn thiếu ID iHOADON")
    row = db.scalar(select(IhoadonInvoice).where(IhoadonInvoice.external_id == external_id))
    created = row is None
    if row is None:
        row = IhoadonInvoice(external_id=external_id)
        db.add(row)

    tax_code = str(source.get("buyer_tax_code") or "").strip()
    tax_norm = normalize_tax_code(tax_code)
    row.invoice_number = str(source.get("invoice_number") or "")
    row.invoice_series = str(source.get("invoice_series") or "")
    row.invoice_date = _date(str(source.get("invoice_date") or ""))
    row.buyer_tax_code = tax_code
    row.buyer_tax_code_norm = tax_norm
    row.buyer_name = str(source.get("customer_name") or source.get("buyer_name") or "")
    row.total_payment = float(source.get("total_payment") or 0)
    row.status = str(source.get("status") or "")
    row.adjustment_type = str(source.get("adjustment_type") or "")
    row.source_updated_at = str(source.get("updated_at") or "")
    row.synced_at = datetime.now(timezone.utc)
    if row.match_source != "manual":
        ids = matches.get(tax_norm, []) if tax_norm else []
        row.customer_id = ids[0] if len(ids) == 1 else None
        row.match_source = "auto" if row.customer_id else ""
    return row, created


def run_sync(db: Session, settings) -> JobRun:
    """Quet metadata toan bo; chi tai file moi, thay doi hoac con thieu."""
    with sync_lock(settings.data_path):
        job = JobRun(kind="ihoadon_customer_sync", status="running")
        db.add(job)
        db.commit()
        db.refresh(job)
        stats = {"seen": 0, "created": 0, "updated": 0, "files": 0, "errors": 0, "unmatched": 0}
        try:
            matches = _customer_matches(db)
            with Client(settings) as client:
                page = 1
                while True:
                    data = client.issued_page(page=page, limit=100)
                    invoices = list(data.get("invoices") or [])
                    for source in invoices:
                        stats["seen"] += 1
                        external_id = str(source.get("id") or "")
                        existing = db.scalar(
                            select(IhoadonInvoice).where(IhoadonInvoice.external_id == external_id)
                        ) if external_id else None
                        old_updated = existing.source_updated_at if existing else ""
                        row, created = _upsert_metadata(db, source, matches)
                        changed = created or (old_updated != row.source_updated_at)
                        stats["created" if created else "updated"] += int(created or changed)
                        try:
                            if changed or not row.pdf_doc_id:
                                pdf_name, pdf = client.invoice_pdf(row.external_id)
                                if not pdf.startswith(b"%PDF"):
                                    raise IhoadonError("File PDF hóa đơn không hợp lệ")
                                row.pdf_doc_id = storage.save_upload(pdf, suffix=".pdf")
                                row.pdf_filename = _safe_filename(pdf_name, "hoa-don.pdf")
                                stats["files"] += 1
                            if changed or (not row.xml_doc_id and row.xml_filename != "__unavailable__"):
                                try:
                                    _zip_name, packed = client.invoice_xml_zip(row.external_id)
                                    xml_name, xml = _extract_xml(packed)
                                    row.xml_doc_id = storage.save_upload(xml, suffix=".xml")
                                    row.xml_filename = xml_name
                                    stats["files"] += 1
                                except XmlUnavailable:
                                    row.xml_filename = "__unavailable__"
                            row.sync_error = ""
                        except Exception as e:  # keep metadata visible and retry next run
                            row.sync_error = str(e)[:500]
                            stats["errors"] += 1
                        db.commit()
                    total = int((data.get("meta") or {}).get("total") or 0)
                    if not invoices or page * 100 >= total:
                        break
                    page += 1

            stats["unmatched"] = db.query(IhoadonInvoice).filter(
                IhoadonInvoice.customer_id.is_(None)
            ).count()
            job.status = "needs_action" if stats["errors"] or stats["unmatched"] else "success"
            job.needs_action = job.status == "needs_action"
        except Exception as e:
            db.rollback()
            job = db.get(JobRun, job.id)
            job.status = "failed"
            job.error = str(e)[:2000]
        job.stats = json.dumps(stats, ensure_ascii=False)
        job.finished_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(job)
        return job
