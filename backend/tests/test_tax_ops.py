from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import tax_ops
from app.db import Base, InvPurchase, InvSale, InvSaleLine


def _db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)()


def test_report_keeps_8_and_10_separate_and_never_negative_40():
    db = _db()
    sale = InvSale(ngay="2026-04-10", status="reviewed", tong_truoc_thue=300, tong_thue=26, tong_tien=326)
    sale.lines = [
        InvSaleLine(stt=1, ten_raw="A", thanh_tien=100, thue_suat=8),
        InvSaleLine(stt=2, ten_raw="B", thanh_tien=200, thue_suat=10),
    ]
    db.add(sale)
    db.add(InvPurchase(ngay="2026-05-01", status="posted", tong_truoc_thue=500, tong_thue=50, tong_tien=550))
    db.commit()

    snap, warnings = tax_ops.build_report(db, "2026-Q2")
    assert snap["split_8_base"] == 100
    assert snap["split_8_tax"] == 8
    assert snap["split_10_base"] == 200
    assert snap["split_10_tax"] == 20
    assert snap["40"] == 0
    assert snap["41"] == 22
    assert not [w for w in warnings if w["level"] == "do"]


def test_document_state_distinguishes_missing_source(tmp_path, monkeypatch):
    class Invoice:
        doc_id = ""
        doc_suffix = ".xml"

    assert tax_ops.document_state(Invoice()) == "missing"
