"""Tests for accounting tier monitor and alarm thresholds."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from app import accounting_tier
from app.auth import COOKIE_NAME, create_token
from app.config import get_settings
from app.db import User, get_session
from app.main import app


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


def test_evaluate_q3_alarm_trigger_live():
    gen = get_session()
    db = next(gen)
    settings = get_settings()
    admin = db.query(User).filter(User.username == "admin").first()
    token = create_token(admin, settings)
    client = TestClient(app)
    client.cookies.set(COOKIE_NAME, token)
    gen.close()

    res = client.get("/api/tax-defense/accounting-fee-monitor?ky=2026-Q3")
    assert res.status_code == 200
    data = res.json()
    assert "breakdown" in data
    assert "thresholds" in data
    assert data["breakdown"]["sales_count"] >= 25
    assert data["breakdown"]["regular_purchases_count"] >= 29
    assert data["breakdown"]["bank_purchases_billed"] == 0
    assert data["breakdown"]["customs_billed"] >= 5
    assert data["breakdown"]["total_billed_documents"] >= 59
    assert "current_tier" in data
    assert "alarm_gap" in data["thresholds"]
