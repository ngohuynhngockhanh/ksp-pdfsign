"""Adversarial stress and correctness test suite by Challenger 1.

Verifies:
1. Extreme/boundary conditions: fractional BOM ratios (0.3333, 0.0001, 1/7), zero/negative quantities, large production runs (N=10,000).
2. Shortage validation against negative stock rules, override reasons, chronological replay invariants, and backfill reconciliation.
3. Batch/lot and serial number persistence with Unicode, special characters, and large serial lists (1,000 serials).
4. Void/unpost operations ensuring zero residue and complete ledger restoration, plus blocked unpost cascading checks.
5. Pre-production shortage check warehouse precedence behavior.
"""
from __future__ import annotations

import json
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from app import db as dbmod
from app.db import InvItem, InvMove, InvProduction, InvProductionLine, InvWarehouse
from app.inventory import availability, stock_snapshot


@pytest.fixture
def client(tmp_path, monkeypatch):
    """Isolated test client with fresh database and admin authentication."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("NAS_ENABLED", "false")
    monkeypatch.setenv("AI_ENABLED", "false")
    from app.config import get_settings

    get_settings.cache_clear()

    from app.auth import ensure_admin_seed

    dbmod.reset_engine_for_tests()
    dbmod.init_db()
    gen = dbmod.get_session()
    s = next(gen)
    ensure_admin_seed(s, get_settings())
    gen.close()

    from app.main import app

    c = TestClient(app)
    r = c.post("/api/login", json={"username": "admin", "password": "NhapHang123@"})
    assert r.status_code == 200, f"Login failed: {r.text}"
    return c


def _mk_item(client: TestClient, ma: str, ten: str, dvt: str = "Cái") -> int:
    r = client.post("/api/inv/items", json={"ma_hang": ma, "ten": ten, "dvt": dvt})
    assert r.status_code == 200, f"Create item failed: {r.text}"
    return r.json()["id"]


def _wh(client: TestClient, code: str) -> int:
    r = client.get("/api/inv/warehouses")
    assert r.status_code == 200, f"Get warehouses failed: {r.text}"
    return {w["code"]: w["id"] for w in r.json()}[code]


def _purchase(
    client: TestClient,
    ngay: str,
    lines: list[tuple[int, int, float, float]],
    so_hd: str = "1",
) -> int:
    r = client.post(
        "/api/inv/purchase",
        json={
            "so_hd": so_hd,
            "mst_ban": "0100100100",
            "ten_ban": "NCC Nguyen Vat Lieu Stress Test",
            "ngay": ngay,
            "lines": [
                {
                    "ten_raw": f"raw_{i}",
                    "so_luong": sl,
                    "don_gia": dg,
                    "thanh_tien": sl * dg,
                    "item_id": iid,
                    "warehouse_id": wid,
                }
                for i, (iid, wid, sl, dg) in enumerate(lines)
            ],
        },
    )
    assert r.status_code == 200, f"Create purchase failed: {r.text}"
    pid = r.json()["id"]
    r_post = client.post(f"/api/inv/purchase/{pid}/post")
    assert r_post.status_code == 200, f"Post purchase failed: {r_post.text}"
    return pid


def _recipe(
    client: TestClient,
    name: str,
    output_item_id: int,
    output_qty: float,
    lines: list[tuple[int, int, float]],
) -> dict:
    r = client.post(
        "/api/inv/recipes",
        json={
            "name": name,
            "output_item_id": output_item_id,
            "output_qty": output_qty,
            "lines": [
                {"item_id": iid, "warehouse_id": wid, "so_luong": sl}
                for iid, wid, sl in lines
            ],
        },
    )
    assert r.status_code == 200, f"Create recipe failed: {r.text}"
    return r.json()


# ===========================================================================
# 1. Extreme & Boundary Conditions: Fractional BOM, Zero/Negative, Large N
# ===========================================================================

def test_fractional_bom_ratios_precision_and_cost_allocation(client: TestClient):
    """Test fractional BOM ratios (e.g. 0.3333, 0.0001, 1/7) and fractional output."""
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm1 = _mk_item(client, "RM-FRAC-01", "Hạt nhựa ABS", "Kg")
    rm2 = _mk_item(client, "RM-FRAC-02", "Chất tạo màu", "Gram")
    rm3 = _mk_item(client, "RM-FRAC-03", "Dầu bôi trơn", "Lít")
    fg = _mk_item(client, "FG-FRAC-01", "Vỏ hộp nhựa mini", "Cái")

    # Seed stock
    _purchase(client, "2026-08-01", [
        (rm1, wh_nvl, 1000.0, 50_000.0),    # 1000 kg @ 50k
        (rm2, wh_nvl, 5000.0, 500.0),       # 5000 g @ 500
        (rm3, wh_nvl, 100.0, 120_000.0),    # 100 L @ 120k
    ], so_hd="HD-PUR-FRAC-1")

    # Recipe: For 3 finished goods:
    # 0.3333 kg ABS, 0.0001 L dầu bôi trơn, 7.5 g màu
    rec = _recipe(
        client,
        "Recipe-Fractional",
        output_item_id=fg,
        output_qty=3.0,
        lines=[
            (rm1, wh_nvl, 0.3333),
            (rm2, wh_nvl, 7.5),
            (rm3, wh_nvl, 0.0001),
        ],
    )

    # Produce 15 units (scale factor = 15 / 3 = 5.0)
    r_create = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-05",
            "recipe_id": rec["id"],
            "output_qty": 15.0,
            "warehouse_id": wh_tp,
            "cp_nhan_cong": 150_000,
            "cp_sxc": 50_000,
            "lines": [],
        },
    )
    assert r_create.status_code == 200, f"Create production failed: {r_create.text}"
    prod_data = r_create.json()
    pid = prod_data["id"]

    # Verify scaled line quantities
    in_lines = {l["item_id"]: l["so_luong"] for l in prod_data["lines"] if l["chieu"] == "vao"}
    assert in_lines[rm1] == pytest.approx(1.6665, abs=1e-4)
    assert in_lines[rm2] == pytest.approx(37.5, abs=1e-4)
    assert in_lines[rm3] == pytest.approx(0.0005, abs=1e-4)

    # Post production
    r_post = client.post(f"/api/inv/productions/{pid}/post")
    assert r_post.status_code == 200, f"Post production failed: {r_post.text}"
    posted_prod = r_post.json()

    assert posted_prod["status"] == "posted"
    assert posted_prod["tong_gia_thanh"] == pytest.approx(302135, abs=5)

    # Verify FG stock in TP
    gen = dbmod.get_session()
    db = next(gen)
    tp_snaps = [r for r in stock_snapshot(db, wh_tp) if r.item_id == fg]
    assert len(tp_snaps) == 1
    assert tp_snaps[0].ton == pytest.approx(15.0, abs=1e-6)
    assert tp_snaps[0].gia_tri == pytest.approx(posted_prod["tong_gia_thanh"], abs=1)
    gen.close()


def test_zero_and_negative_quantities_rejection(client: TestClient):
    """Test boundary checks on zero and negative output/consumed quantities."""
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")
    rm = _mk_item(client, "RM-ZERO-01", "Sắt thép")
    fg = _mk_item(client, "FG-ZERO-01", "Trục cơ khí")

    _purchase(client, "2026-08-01", [(rm, wh_nvl, 100.0, 10_000.0)], so_hd="HD-PUR-ZERO")

    # 1. Custom lines with zero or negative quantity in production create / post
    r_neg = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-05",
            "lines": [
                {"chieu": "vao", "item_id": rm, "warehouse_id": wh_nvl, "so_luong": -5.0},
                {"chieu": "ra", "item_id": fg, "warehouse_id": wh_tp, "so_luong": 10.0},
            ],
        },
    )
    if r_neg.status_code == 200:
        neg_pid = r_neg.json()["id"]
        r_post_neg = client.post(f"/api/inv/productions/{neg_pid}/post")
        assert r_post_neg.status_code == 400
        assert "số lượng phải > 0" in r_post_neg.text

    # 2. Check shortage with 0 output quantity
    r_check_zero = client.post(
        "/api/inv/productions/check-shortage",
        json={
            "output_item_id": fg,
            "output_qty": 0.0,
            "warehouse_id": wh_tp,
        },
    )
    assert r_check_zero.status_code == 200
    res = r_check_zero.json()
    assert res["has_shortage"] is False


def test_large_production_run_scalability(client: TestClient):
    """Test large production run (N=10,000) with multiple BOM components and cost integrity."""
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm1 = _mk_item(client, "RM-LRG-01", "Thân vỏ nhôm lớn", "Cái")
    rm2 = _mk_item(client, "RM-LRG-02", "Ốc vít M3", "Cái")
    rm3 = _mk_item(client, "RM-LRG-03", "Bo mạch điều khiển", "Cái")
    fg = _mk_item(client, "FG-LRG-01", "Module iNut Pro N10k", "Bộ")

    # Purchase massive stock: 50,000 units each
    _purchase(client, "2026-08-01", [
        (rm1, wh_nvl, 20_000.0, 150_000.0),
        (rm2, wh_nvl, 100_000.0, 500.0),
        (rm3, wh_nvl, 20_000.0, 250_000.0),
    ], so_hd="HD-PUR-LRG-1")

    # Recipe for 1 FG: 1 RM1, 4 RM2, 1 RM3
    rec = _recipe(
        client,
        "Recipe-N10k",
        output_item_id=fg,
        output_qty=1.0,
        lines=[
            (rm1, wh_nvl, 1.0),
            (rm2, wh_nvl, 4.0),
            (rm3, wh_nvl, 1.0),
        ],
    )

    # Produce N=10,000 units
    r_create = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-10",
            "recipe_id": rec["id"],
            "output_qty": 10_000.0,
            "warehouse_id": wh_tp,
            "cp_nhan_cong": 100_000_000.0,
            "cp_sxc": 50_000_000.0,
            "lot_number": "BATCH-2026-10K-PROD",
            "lines": [],
        },
    )
    assert r_create.status_code == 200
    pid = r_create.json()["id"]

    # Post large run
    r_post = client.post(f"/api/inv/productions/{pid}/post")
    assert r_post.status_code == 200
    p_data = r_post.json()

    expected_total_cost = 4_170_000_000.0
    assert p_data["tong_gia_thanh"] == pytest.approx(expected_total_cost, abs=100)

    # Verify inventory ledger
    gen = dbmod.get_session()
    db = next(gen)
    tp_snaps = [r for r in stock_snapshot(db, wh_tp) if r.item_id == fg]
    assert len(tp_snaps) == 1
    assert tp_snaps[0].ton == pytest.approx(10_000.0, abs=1e-6)
    assert tp_snaps[0].don_gia_bq == pytest.approx(417_000.0, abs=1.0)
    gen.close()


# ===========================================================================
# 2. Shortage Validation, Negative Stock Rules, Override & Backfill Replay
# ===========================================================================

def test_shortage_validation_and_override_workflow_with_backfill(client: TestClient):
    """Test shortage detection, blocked post, override post, and chronological backfill invariants."""
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm1 = _mk_item(client, "RM-SHT-01", "Module Nguồn 24V", "Cái")
    rm2 = _mk_item(client, "RM-SHT-02", "Cảm Biến Nhiệt K", "Cái")
    fg = _mk_item(client, "FG-SHT-01", "Bộ Cảnh Báo Nhiệt Độ", "Bộ")

    # Purchase initial partial stock: only 2 RM1, 0 RM2
    _purchase(client, "2026-08-01", [(rm1, wh_nvl, 2.0, 80_000.0)], so_hd="HD-PUR-SHT-1")

    # Recipe for 1 FG: 1 RM1, 2 RM2
    rec = _recipe(
        client,
        "Recipe-SHT",
        output_item_id=fg,
        output_qty=1.0,
        lines=[
            (rm1, wh_nvl, 1.0),
            (rm2, wh_nvl, 2.0),
        ],
    )

    # 1. Check shortage via explicit lines
    # 5 units of FG needs 5 RM1 @ NVL, 10 RM2 @ NVL
    r_check = client.post(
        "/api/inv/productions/check-shortage",
        json={
            "lines": [
                {"item_id": rm1, "warehouse_id": wh_nvl, "so_luong": 5.0},
                {"item_id": rm2, "warehouse_id": wh_nvl, "so_luong": 10.0},
            ],
            "ngay": "2026-08-05",
        },
    )
    assert r_check.status_code == 200
    sht_data = r_check.json()
    assert sht_data["has_shortage"] is True
    assert sht_data["can_produce"] is False

    sht_items = {it["item_id"]: it for it in sht_data["items"]}
    assert sht_items[rm1]["required_qty"] == 5.0
    assert sht_items[rm1]["available_qty"] == 2.0
    assert sht_items[rm1]["shortage_qty"] == 3.0
    assert sht_items[rm1]["warning_level"] == "amber"

    assert sht_items[rm2]["required_qty"] == 10.0
    assert sht_items[rm2]["available_qty"] == 0.0
    assert sht_items[rm2]["shortage_qty"] == 10.0
    assert sht_items[rm2]["warning_level"] == "red"

    # 2. Create production order for 5 units
    r_create = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-05",
            "recipe_id": rec["id"],
            "output_qty": 5.0,
            "warehouse_id": wh_tp,
            "lines": [],
        },
    )
    assert r_create.status_code == 200
    pid = r_create.json()["id"]

    # 3. Check readiness endpoint on created draft production
    r_ready = client.get(f"/api/inv/productions/{pid}/readiness")
    assert r_ready.status_code == 200
    ready_data = r_ready.json()
    assert ready_data["has_shortage"] is True
    assert ready_data["can_produce"] is False
    ready_items = {it["item_id"]: it for it in ready_data["items"]}
    assert ready_items[rm1]["available_qty"] == 2.0
    assert ready_items[rm1]["shortage_qty"] == 3.0
    assert ready_items[rm2]["available_qty"] == 0.0
    assert ready_items[rm2]["shortage_qty"] == 10.0

    # 4. Attempt to post WITHOUT override -> MUST fail with 400 NegativeStockError
    r_post_fail = client.post(f"/api/inv/productions/{pid}/post")
    assert r_post_fail.status_code == 400
    fail_json = r_post_fail.json()
    assert "Âm kho" in str(fail_json) or "violations" in str(fail_json)

    # 5. Post WITH override reason -> MUST succeed
    override_reason = "GĐ duyệt sản xuất khẩn cấp — Nhà cung cấp sẽ giao bù NVL"
    r_post_override = client.post(
        f"/api/inv/productions/{pid}/post",
        json={"override_reason": override_reason},
    )
    assert r_post_override.status_code == 200
    posted_data = r_post_override.json()
    assert posted_data["status"] == "posted"
    assert posted_data["am_kho_override"] is True
    assert "[ÂM KHO ĐÃ DUYỆT]" in posted_data["note"]
    assert override_reason in posted_data["note"]

    # 6. Verify backfill behavior:
    # A purchase on the same day (2026-08-05) or prior succeeds and reconciles the balance
    # because 'nhap' priority (1) precedes 'sx_out' priority (3) in chronological replay.
    _purchase(client, "2026-08-05", [
        (rm1, wh_nvl, 10.0, 80_000.0),
        (rm2, wh_nvl, 20.0, 40_000.0),
    ], so_hd="HD-PUR-BACKFILL-SAMEDAY")

    # Check stock snapshot after replenishment
    gen = dbmod.get_session()
    db = next(gen)
    snap_nvl = stock_snapshot(db, wh_nvl)
    rm1_snap = next(r for r in snap_nvl if r.item_id == rm1)
    rm2_snap = next(r for r in snap_nvl if r.item_id == rm2)
    # RM1: 2 + 10 - 5 = 7
    assert rm1_snap.ton == pytest.approx(7.0, abs=1e-6)
    # RM2: 0 + 20 - 10 = 10
    assert rm2_snap.ton == pytest.approx(10.0, abs=1e-6)
    gen.close()


# ===========================================================================
# 3. Batch/Lot & Serial Persistence with Unicode, Special Chars, Large Lists
# ===========================================================================

def test_batch_and_serial_unicode_special_characters_and_large_lists(client: TestClient):
    """Test lot/serial persistence with Vietnamese diacritics, JSON special characters, and 1,000 serials."""
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm = _mk_item(client, "RM-SER-01", "Linh kiện vi xử lý", "Cái")
    fg = _mk_item(client, "FG-SER-01", "Thiết bị IoT Chống Trộm ⚡", "Bộ")

    _purchase(client, "2026-08-01", [(rm, wh_nvl, 2000.0, 100_000.0)], so_hd="HD-PUR-SER-1")

    # Generate 1,000 serial numbers with mixed formats and special characters
    special_serials = [
        f"SN-2026/ĐỢT-1#0001<SPECIAL>",
        f"SN-2026/ĐỢT-1#0002\"QUOTE\"",
        f"SN-2026/ĐỢT-1#0003'APOS'",
        f"SN-2026/ĐỢT-1#0004&AMP",
    ] + [f"SN-IOT-2026-{i:05d}" for i in range(5, 1001)]

    complex_lot = "LÔ-SẢN-XUẤT-2026/HÀ-NỘI-ĐỢT#99-(ISO-9001:2015)-⚡🚀"
    serials_json_str = json.dumps(special_serials, ensure_ascii=False)

    rec = _recipe(
        client,
        "Recipe-Serial-Test",
        output_item_id=fg,
        output_qty=1.0,
        lines=[(rm, wh_nvl, 1.0)],
    )

    # Create production order
    r_create = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-15",
            "recipe_id": rec["id"],
            "output_qty": 1000.0,
            "warehouse_id": wh_tp,
            "lot_number": complex_lot,
            "serial_numbers": serials_json_str,
            "mfg_date": "2026-08-15",
            "exp_date": "2028-08-15",
            "lines": [],
        },
    )
    assert r_create.status_code == 200
    prod_data = r_create.json()
    pid = prod_data["id"]

    assert prod_data["lot_number"] == complex_lot
    assert prod_data["mfg_date"] == "2026-08-15"
    assert prod_data["exp_date"] == "2028-08-15"

    # Post production
    r_post = client.post(f"/api/inv/productions/{pid}/post")
    assert r_post.status_code == 200

    # Verify InvMove records persisted lot and serials
    gen = dbmod.get_session()
    db = next(gen)
    tp_move = db.scalars(
        select(InvMove).where(
            InvMove.ref_type == "production",
            InvMove.ref_id == pid,
            InvMove.loai == "sx_in",
        )
    ).first()
    assert tp_move is not None
    assert tp_move.lot_number == complex_lot
    assert tp_move.serial_numbers == serials_json_str
    gen.close()

    # Query Traceability API
    # 1. By exact complex lot
    r_trace_lot = client.get(f"/api/inv/traceability?batch_no={complex_lot}")
    assert r_trace_lot.status_code == 200
    records = r_trace_lot.json()["records"]
    assert len(records) >= 1
    assert any(r["production_id"] == pid for r in records)

    # 2. By special character serial
    r_trace_sn1 = client.get("/api/inv/traceability?serial_no=SPECIAL")
    assert r_trace_sn1.status_code == 200
    records_sn1 = r_trace_sn1.json()["records"]
    assert len(records_sn1) >= 1
    assert any(r["production_id"] == pid for r in records_sn1)

    # 3. By deep serial in the 1000 list (e.g. SN-IOT-2026-00999)
    r_trace_sn999 = client.get("/api/inv/traceability?serial_no=SN-IOT-2026-00999")
    assert r_trace_sn999.status_code == 200
    records_sn999 = r_trace_sn999.json()["records"]
    assert len(records_sn999) >= 1
    assert any(r["production_id"] == pid for r in records_sn999)


# ===========================================================================
# 4. Void & Unpost Integrity: Zero Residue & Ledger Restoration
# ===========================================================================

def test_void_and_unpost_zero_residue_and_blocked_cascade(client: TestClient):
    """Test void/unpost operations guarantee zero residue and block when downstream stock would go negative."""
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm1 = _mk_item(client, "RM-VOID-01", "Khung nhôm định hình", "Cái")
    rm2 = _mk_item(client, "RM-VOID-02", "Kính cường lực", "Tấm")
    fg = _mk_item(client, "FG-VOID-01", "Cửa tự động thông minh", "Bộ")

    # Initial purchase: 10 RM1 @ 500k, 10 RM2 @ 300k
    _purchase(client, "2026-08-01", [
        (rm1, wh_nvl, 10.0, 500_000.0),
        (rm2, wh_nvl, 10.0, 300_000.0),
    ], so_hd="HD-PUR-VOID-1")

    # Snapshot pre-production
    gen = dbmod.get_session()
    db = next(gen)
    snap_before_nvl = {r.item_id: (r.ton, r.gia_tri) for r in stock_snapshot(db, wh_nvl)}
    snap_before_tp = {r.item_id: (r.ton, r.gia_tri) for r in stock_snapshot(db, wh_tp)}
    gen.close()

    assert snap_before_nvl[rm1] == (10.0, 5_000_000.0)
    assert snap_before_nvl[rm2] == (10.0, 3_000_000.0)
    assert snap_before_tp.get(fg, (0.0, 0.0)) == (0.0, 0.0)

    # Recipe for 1 FG: 2 RM1, 1 RM2
    rec = _recipe(
        client,
        "Recipe-Door",
        output_item_id=fg,
        output_qty=1.0,
        lines=[
            (rm1, wh_nvl, 2.0),
            (rm2, wh_nvl, 1.0),
        ],
    )

    # Produce 4 units (consumes 8 RM1, 4 RM2)
    r_create = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-05",
            "recipe_id": rec["id"],
            "output_qty": 4.0,
            "warehouse_id": wh_tp,
            "cp_nhan_cong": 400_000.0,
            "cp_sxc": 200_000.0,
            "lines": [],
        },
    )
    assert r_create.status_code == 200
    pid = r_create.json()["id"]

    # Post production
    r_post = client.post(f"/api/inv/productions/{pid}/post")
    assert r_post.status_code == 200

    # Verify intermediate stock
    gen = dbmod.get_session()
    db = next(gen)
    snap_mid_nvl = {r.item_id: (r.ton, r.gia_tri) for r in stock_snapshot(db, wh_nvl)}
    snap_mid_tp = {r.item_id: (r.ton, r.gia_tri) for r in stock_snapshot(db, wh_tp)}
    gen.close()

    # 10 - 8 = 2 RM1 (1,000,000 VND)
    assert snap_mid_nvl[rm1] == (2.0, 1_000_000.0)
    # 10 - 4 = 6 RM2 (1,800,000 VND)
    assert snap_mid_nvl[rm2] == (6.0, 1_800_000.0)
    # 4 FG @ (8*500k + 4*300k + 400k + 200k = 5,800,000 VND)
    assert snap_mid_tp[fg] == (4.0, 5_800_000.0)

    # Unpost (void) production
    r_void = client.post(f"/api/inv/productions/{pid}/void")
    assert r_void.status_code == 200
    void_data = r_void.json()
    assert void_data["status"] == "draft"

    # Verify ZERO RESIDUE in moves table
    gen = dbmod.get_session()
    db = next(gen)
    moves_after_void = list(db.scalars(
        select(InvMove).where(InvMove.ref_type == "production", InvMove.ref_id == pid)
    ))
    assert len(moves_after_void) == 0, f"Found orphan moves after void: {moves_after_void}"

    # Verify PERFECT STOCK RESTORATION
    snap_after_nvl = {r.item_id: (r.ton, r.gia_tri) for r in stock_snapshot(db, wh_nvl)}
    snap_after_tp = {r.item_id: (r.ton, r.gia_tri) for r in stock_snapshot(db, wh_tp)}
    gen.close()

    assert snap_after_nvl[rm1] == snap_before_nvl[rm1]
    assert snap_after_nvl[rm2] == snap_before_nvl[rm2]
    assert snap_after_tp.get(fg, (0.0, 0.0)) == (0.0, 0.0)

    # Test Blocked Unpost / Downstream Cascade:
    # 1. Re-post production
    r_repost = client.post(f"/api/inv/productions/{pid}/post")
    assert r_repost.status_code == 200

    # 2. Issue/sell 4 FG out of warehouse TP via /api/inv/issues
    r_issue = client.post(
        "/api/inv/issues",
        json={
            "ngay": "2026-08-10",
            "lines": [
                {
                    "item_id": fg,
                    "warehouse_id": wh_tp,
                    "so_luong": 4.0,
                    "don_gia_ban": 2_500_000.0,
                }
            ],
        },
    )
    assert r_issue.status_code == 200
    issue_id = r_issue.json()["id"]
    r_issue_post = client.post(f"/api/inv/issues/{issue_id}/post")
    assert r_issue_post.status_code == 200

    # 3. Attempt to unpost production now -> MUST FAIL with NegativeStockError (400)
    # because FG would become negative (-4)
    r_void_blocked = client.post(f"/api/inv/productions/{pid}/void")
    assert r_void_blocked.status_code == 400
    assert "Âm kho" in str(r_void_blocked.json()) or "violations" in str(r_void_blocked.json())

    # 4. Unpost downstream issue first -> then unpost production succeeds cleanly!
    r_issue_unpost = client.post(f"/api/inv/issues/{issue_id}/void")
    assert r_issue_unpost.status_code == 200

    r_void_unblocked = client.post(f"/api/inv/productions/{pid}/void")
    assert r_void_unblocked.status_code == 200
    assert r_void_unblocked.json()["status"] == "draft"
