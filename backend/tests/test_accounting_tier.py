"""Tests for accounting tier monitor and alarm thresholds (isolated tmp_path DB)."""
from __future__ import annotations

from app import accounting_tier
from app.db import InvCustomsDecl, InvPurchase, InvSale, get_session


def test_find_tier_for_count():
    # 0-5
    t, n = accounting_tier.find_tier_for_count(4)
    assert t["tier"] == 1
    assert t["fee_quarter"] == 2_400_000
    assert n["tier"] == 2

    # 57 -> Tier 3 (31 - 60)
    t, n = accounting_tier.find_tier_for_count(57)
    assert t["tier"] == 3
    assert t["fee_quarter"] == 4_800_000
    assert n["tier"] == 4
    assert n["fee_quarter"] == 6_000_000

    # 65 -> Tier 4 (61 - 80)
    t, n = accounting_tier.find_tier_for_count(65)
    assert t["tier"] == 4
    assert t["fee_quarter"] == 6_000_000


def test_is_bank_partner():
    assert accounting_tier.is_bank_partner("NGÂN HÀNG THƯƠNG MẠI CỔ PHẦN KỸ THƯƠNG VIỆT NAM")
    assert accounting_tier.is_bank_partner("Ngân hàng TMCP Ngoại thương Việt Nam")
    assert not accounting_tier.is_bank_partner("CÔNG TY TNHH CÔNG NGHỆ ĐIỆN TỬ ZENOPCB")


def test_evaluate_q3_alarm_trigger_isolated(client):
    r_login = client.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})
    assert r_login.status_code == 200, r_login.text

    # Seed exact deterministic Q3/2026 document breakdown inside tmp_path DB:
    # 29 sales + 28 regular purchases + 11 bank (excluded) + 2 flight (excluded) + 6 customs = 63 billed
    gen = get_session()
    db = next(gen)
    try:
        for i in range(29):
            db.add(
                InvSale(
                    so_hd=f"S{i + 1:03d}",
                    ky_hieu="1C26TIN",
                    ngay="2026-08-10",
                    mst_mua="0314360282",
                    ten_mua="KHACH MAU",
                    status="posted",
                )
            )
        for i in range(28):
            db.add(
                InvPurchase(
                    so_hd=f"P{i + 1:03d}",
                    ky_hieu="1C26TAA",
                    ngay="2026-08-12",
                    mst_ban="0312345678",
                    ten_ban="CONG TY LINH KIEN DIEN TU",
                    status="posted",
                )
            )
        for i in range(11):
            db.add(
                InvPurchase(
                    so_hd=f"B{i + 1:03d}",
                    ky_hieu="1C26TCB",
                    ngay="2026-08-13",
                    mst_ban="0100230800",
                    ten_ban="NGAN HANG TMCP KY THUONG VIET NAM (TECHCOMBANK)",
                    status="posted",
                )
            )
        for i in range(2):
            db.add(
                InvPurchase(
                    so_hd=f"F{i + 1:03d}",
                    ky_hieu="1C26VNP",
                    ngay="2026-08-14",
                    mst_ban="0102182292",
                    ten_ban="CONG TY CP GIAI PHAP THANH TOAN VIET NAM (VNPAY)",
                    status="posted",
                )
            )
        for i in range(6):
            db.add(
                InvCustomsDecl(
                    so_to_khai=f"10650000000{i + 1}",
                    ngay_dang_ky="2026-08-15",
                    status="posted",
                )
            )
        db.commit()
    finally:
        gen.close()

    res = client.get("/api/tax-defense/accounting-fee-monitor?ky=2026-Q3")
    assert res.status_code == 200
    data = res.json()
    assert "breakdown" in data
    assert "thresholds" in data
    assert data["breakdown"]["sales_count"] == 29
    assert data["breakdown"]["regular_purchases_count"] == 28
    assert data["breakdown"]["bank_purchases_raw"] == 11
    assert data["breakdown"]["bank_purchases_billed"] == 0
    assert data["breakdown"]["flight_purchases_raw"] == 2
    assert data["breakdown"]["flight_purchases_billed"] == 0
    assert data["breakdown"]["customs_billed"] == 6
    assert data["breakdown"]["total_billed_documents"] == 63
    assert data["current_tier"]["tier"] == 4
    assert "alarm_gap" in data["thresholds"]
