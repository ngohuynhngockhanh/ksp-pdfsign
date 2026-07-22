"""Test cham loi file BCT (to khai GTGT) ke toan up len.

Fixture = file quy 2/2026 that -> phai bat dung: 1 loi DO ([40] am) + 2 VANG
(HD ban 0% cho DN noi dia; nhom [32]/[33] ghi 10% nhung thue thuc ~6%).
"""
from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

pytest.importorskip("openpyxl")

from app import tax_review  # noqa: E402
from app.db import Base, InvSale, InvSaleLine  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "tax" / "bct_quy2_2026.xlsx"


@pytest.fixture
def result():
    return tax_review.review_bytes(FIXTURE.read_bytes())


def test_parse_chi_tieu(result):
    ct = result["ct"]
    assert ct["22"] == pytest.approx(4275034)
    assert ct["23"] == pytest.approx(145215937)
    assert ct["25"] == pytest.approx(12059273.64)
    assert ct["35"] == pytest.approx(11890521)
    assert ct["36"] == pytest.approx(-168752.64, abs=1)
    # ke toan de nham so am o [40a]/[40]
    assert ct["40a"] == pytest.approx(-4443786.64, abs=1)


def test_parse_bang_ke_counts(result):
    # 11 dong ban thuc, 46 dong mua thuc (dong trong bi loai)
    assert result["summary"]["so_hd_ban"] == 11
    assert result["summary"]["so_hd_mua"] == 46


def test_cross_check_khop(result):
    # tong bang ke = chi tieu to khai -> KHONG duoc sinh finding lech
    titles = [f["title"] for f in result["findings"]]
    assert not any("≠ tờ khai" in t for t in titles)


def test_finding_40_am(result):
    do = [f for f in result["findings"] if f["level"] == "do"]
    assert len(do) == 1
    f = do[0]
    assert "âm" in f["title"]
    assert "41" in f["cells"] and "43" in f["cells"]


def test_finding_ban_0pct(result):
    vang = [f for f in result["findings"] if f["level"] == "vang"]
    assert any("0%" in f["title"] for f in vang)
    # 2 HD 0% = 45.512.500
    f = next(f for f in vang if "0%" in f["title"])
    assert "45.512.500" in f["detail"]
    assert "phần mềm" in f["detail"]
    assert "[26]" in f["detail"]
    assert "01/07/2025–31/12/2026" in f["detail"]


def test_finding_ty_le_gop_sai(result):
    vang = [f for f in result["findings"] if f["level"] == "vang"]
    f = next(f for f in vang if "6.12%" in f["title"])
    assert "148.631.516" in f["detail"]
    assert "45.512.500" in f["detail"]


def test_grids_serializable(result):
    grids = result["grids"]
    assert [g["name"] for g in grids] == ["Tờ khai", "Bảng kê bán ra", "Bảng kê mua vào"]
    # o [40a] phai xuat hien trong grid to khai (de FE to do)
    assert any(c.strip() == "[40a]" for row in grids[0]["rows"] for c in row)


def test_summary_counts(result):
    s = result["summary"]
    assert s["do"] == 1
    assert s["vang"] == 2


def test_crosscheck_confirms_software_kct(result):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as db:
        for so, ngay, amount in (("6", "2026-04-28", 30000000), ("14", "2026-06-22", 15512500)):
            inv = InvSale(so_hd=so, ngay=ngay, status="reviewed")
            inv.lines = [InvSaleLine(stt=1, ten_raw="Phần mềm", thanh_tien=amount, thue_suat=0, thue_kct=True)]
            db.add(inv)
        db.commit()
        tax_review.crosscheck_sales(db, result)
    finding = next(f for f in result["findings"] if "phần mềm KCT" in f["title"])
    assert "HĐ 6, 14" in finding["detail"]
    assert "[26]" in finding["detail"]
