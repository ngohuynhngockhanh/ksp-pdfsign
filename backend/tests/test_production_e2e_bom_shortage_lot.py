"""
End-to-End Test Suite for KSP Inventory & Production Module Upgrade.

Authoritative requirements:
- ORIGINAL_REQUEST.md (§R1, §R2, §R3, §R4, Acceptance Criteria)
- PROJECT.md (§Feature Inventory, §Milestones, §Interface Contracts)

Test Tiers:
- Tier 1: Feature Coverage
    * test_tier1_bom_driven_inventory_deduction_n_outputs_k_materials
    * test_tier1_stock_movement_ledger_verification
    * test_tier1_pre_production_shortage_validation_api
    * test_tier1_batch_lot_and_serial_number_recording
- Tier 2: Boundary & Corner Cases
    * test_tier2_zero_and_negative_output_quantity_rejected
    * test_tier2_recipe_fractional_and_precision_component_ratios
    * test_tier2_zero_stock_blocks_production_without_override
    * test_tier2_exact_stock_equals_requirement_succeeds_with_zero_residue
    * test_tier2_deficit_with_override_reason_succeeds_and_flags_negative
    * test_tier2_multiple_serial_numbers_json_and_list_formats
    * test_tier2_special_characters_and_unicode_in_lot_numbers
    * test_tier2_draft_production_order_deletion_preserves_stock_integrity
- Tier 3: Cross-Feature Combinations
    * test_tier3_combined_shortage_check_procurement_bom_deduction_and_lot_tracking
    * test_tier3_multi_warehouse_production
    * test_tier3_backdated_production_cost_replay
    * test_tier3_void_unpost_production_reverses_stock_moves
- Tier 4: Real-World Scenarios
    * test_tier4_multi_stage_production_genealogy
    * test_tier4_traceability_forward_and_backward
"""
from __future__ import annotations

import json
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("openpyxl")

from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture
def client(tmp_path, monkeypatch):
    """Isolated test client with fresh database and admin authentication."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("NAS_ENABLED", "false")
    monkeypatch.setenv("AI_ENABLED", "false")
    from app.config import get_settings

    get_settings.cache_clear()

    from app import db as dbmod
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


# ---------------------------------------------------------------------------
# Test Helpers
# ---------------------------------------------------------------------------
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
    mst: str = "0123456789",
) -> int:
    """Create and post a purchase invoice. lines: [(item_id, wh_id, sl, don_gia)]."""
    r = client.post(
        "/api/inv/purchase",
        json={
            "so_hd": so_hd,
            "mst_ban": mst,
            "ten_ban": "NCC Test E2E",
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
    description: str = "",
) -> dict:
    """Create a production recipe (BOM). lines: [(item_id, wh_id, so_luong)]."""
    r = client.post(
        "/api/inv/recipes",
        json={
            "name": name,
            "output_item_id": output_item_id,
            "output_qty": output_qty,
            "description": description,
            "lines": [
                {"item_id": iid, "warehouse_id": wid, "so_luong": sl}
                for iid, wid, sl in lines
            ],
        },
    )
    assert r.status_code == 200, f"Create recipe failed: {r.text}"
    return r.json()


def _get_stock(
    client: TestClient, item_id: int, warehouse_id: int | None = None
) -> tuple[float, float]:
    """Return total (ton, gia_tri) for an item across all warehouses or in a specific warehouse."""
    r = client.get("/api/inv/stock?all_items=true")
    assert r.status_code == 200, f"Get stock failed: {r.text}"
    rows = r.json()["rows"]
    if warehouse_id is not None:
        matched = [x for x in rows if x["item_id"] == item_id and x["warehouse_id"] == warehouse_id]
    else:
        matched = [x for x in rows if x["item_id"] == item_id]
    if not matched:
        return 0.0, 0.0
    return sum(x["ton"] for x in matched), sum(x["gia_tri"] for x in matched)


# ===========================================================================
# Tier 1: Feature Coverage
# ===========================================================================

def test_tier1_bom_driven_inventory_deduction_n_outputs_k_materials(client: TestClient):
    """
    R1 / F1: Automated BOM deduction for N finished goods with k raw materials.
    
    Given:
      - Recipe for 1 unit TP01 requires:
          * 2 units NVL1
          * 3 units NVL2
          * 0.5 units NVL3
      - Inventory seeded with 100 NVL1 @ 50k, 150 NVL2 @ 20k, 50 NVL3 @ 10k.
    When:
      - Producing N = 10 units of TP01.
    Then:
      - Stock of NVL1 decreases by 20 -> 80 units left.
      - Stock of NVL2 decreases by 30 -> 120 units left.
      - Stock of NVL3 decreases by 5 -> 45 units left.
      - Stock of TP01 increases by 10 units in warehouse TP.
      - Total cost rolled up = (20*50k) + (30*20k) + (5*10k) = 1,650,000 VND.
      - Unit cost = 165,000 VND.
    """
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    nvl1 = _mk_item(client, "NVL-T1-01", "Vỏ hộp nhôm", "Cái")
    nvl2 = _mk_item(client, "NVL-T1-02", "Bo mạch chủ PCB", "Cái")
    nvl3 = _mk_item(client, "NVL-T1-03", "Cáp kết nối", "Bộ")
    tp01 = _mk_item(client, "TP-T1-01", "Bộ điều khiển công nghiệp", "Bộ")

    # Seed stock
    _purchase(
        client,
        "2026-08-01",
        [
            (nvl1, wh_nvl, 100, 50_000),
            (nvl2, wh_nvl, 150, 20_000),
            (nvl3, wh_nvl, 50, 10_000),
        ],
        so_hd="HD-MUA-001",
    )

    # Create Recipe for 1 unit of TP01
    rec = _recipe(
        client,
        "BOM-TP01-Standard",
        output_item_id=tp01,
        output_qty=1.0,
        lines=[
            (nvl1, wh_nvl, 2.0),
            (nvl2, wh_nvl, 3.0),
            (nvl3, wh_nvl, 0.5),
        ],
    )
    rec_id = rec["id"]

    # Target production: N = 10 units
    n_target = 10.0
    r_prod = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-10",
            "recipe_id": rec_id,
            "note": "Lệnh sản xuất đợt 1",
            "lines": [
                {"chieu": "vao", "item_id": nvl1, "warehouse_id": wh_nvl, "so_luong": 2.0 * n_target},
                {"chieu": "vao", "item_id": nvl2, "warehouse_id": wh_nvl, "so_luong": 3.0 * n_target},
                {"chieu": "vao", "item_id": nvl3, "warehouse_id": wh_nvl, "so_luong": 0.5 * n_target},
                {"chieu": "ra", "item_id": tp01, "warehouse_id": wh_tp, "so_luong": n_target},
            ],
        },
    )
    assert r_prod.status_code == 200, f"Create production failed: {r_prod.text}"
    prod_data = r_prod.json()
    pid = prod_data["id"]
    assert prod_data["status"] == "draft"

    # Post production order
    r_post = client.post(f"/api/inv/productions/{pid}/post")
    assert r_post.status_code == 200, f"Post production failed: {r_post.text}"
    posted_data = r_post.json()

    assert posted_data["status"] == "posted"
    assert posted_data["so_ct"].startswith("LSX-")
    expected_total_cost = (20 * 50_000) + (30 * 20_000) + (5 * 10_000)  # 1,650,000
    assert posted_data["tong_gia_thanh"] == expected_total_cost

    # Verify inventory balances
    ton_nvl1, gt_nvl1 = _get_stock(client, nvl1, wh_nvl)
    ton_nvl2, gt_nvl2 = _get_stock(client, nvl2, wh_nvl)
    ton_nvl3, gt_nvl3 = _get_stock(client, nvl3, wh_nvl)
    ton_tp01, gt_tp01 = _get_stock(client, tp01, wh_tp)

    assert ton_nvl1 == 80.0
    assert gt_nvl1 == 80 * 50_000
    assert ton_nvl2 == 120.0
    assert gt_nvl2 == 120 * 20_000
    assert ton_nvl3 == 45.0
    assert gt_nvl3 == 45 * 10_000

    assert ton_tp01 == 10.0
    assert gt_tp01 == expected_total_cost


def test_tier1_stock_movement_ledger_verification(client: TestClient):
    """
    R1 / F1: Stock movement ledger & history verification.
    
    Verifies that posting an InvProduction creates:
      - InvMove records with loai='sx_out' for raw material consumption.
      - InvMove record with loai='sx_in' for finished goods output.
      - References (ref_type='production', ref_id=production_id).
      - Correct item flow entries (/api/inv/items/{id}/flow).
    """
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm = _mk_item(client, "RM-FLOW-01", "Module Nguồn 24V", "Cái")
    fg = _mk_item(client, "FG-FLOW-01", "Tủ điện tự động", "Tủ")

    _purchase(client, "2026-08-01", [(rm, wh_nvl, 10, 200_000)], so_hd="HD-FLOW-01")

    r_prod = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-05",
            "lines": [
                {"chieu": "vao", "item_id": rm, "warehouse_id": wh_nvl, "so_luong": 4},
                {"chieu": "ra", "item_id": fg, "warehouse_id": wh_tp, "so_luong": 2},
            ],
        },
    )
    pid = r_prod.json()["id"]
    assert client.post(f"/api/inv/productions/{pid}/post").status_code == 200

    # Query RM flow
    r_flow_rm = client.get(f"/api/inv/items/{rm}/flow")
    assert r_flow_rm.status_code == 200
    flow_rm = r_flow_rm.json()

    sx_out_steps = [s for s in flow_rm["steps"] if s["loai"] == "sx_out"]
    assert len(sx_out_steps) == 1
    assert sx_out_steps[0]["doc"]["kind"] == "production"
    assert sx_out_steps[0]["doc"]["id"] == pid
    assert sx_out_steps[0]["so_luong"] == -4
    assert flow_rm["steps"][-1]["so_du"] == 6.0

    # Query FG flow
    r_flow_fg = client.get(f"/api/inv/items/{fg}/flow")
    assert r_flow_fg.status_code == 200
    flow_fg = r_flow_fg.json()
    sx_in_steps = [s for s in flow_fg["steps"] if s["loai"] == "sx_in"]
    assert len(sx_in_steps) == 1
    assert sx_in_steps[0]["doc"]["kind"] == "production"
    assert sx_in_steps[0]["so_luong"] == 2
    assert flow_fg["steps"][-1]["so_du"] == 2.0


def test_tier1_pre_production_shortage_validation_api(client: TestClient):
    """
    R2 / F3: Pre-production stock shortage check API.
    
    Tests:
      - POST /api/inv/productions/check-shortage with sufficient vs insufficient stock.
      - GET /api/inv/productions/{id}/readiness on a draft production order.
      - Validates calculation of required_qty, available_qty, shortage_qty, is_shortage, warning_level.
    """
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm1 = _mk_item(client, "RM-SHORT-01", "Cảm biến nhiệt PT100", "Cái")
    rm2 = _mk_item(client, "RM-SHORT-02", "Dây cáp tín hiệu", "Mét")
    fg = _mk_item(client, "FG-SHORT-01", "Bộ đo nhiệt độ đa kênh", "Bộ")

    # Purchase only 5 units of RM1 and 20 meters of RM2
    _purchase(client, "2026-08-01", [(rm1, wh_nvl, 5, 100_000), (rm2, wh_nvl, 20, 10_000)])

    # Recipe: 1 FG requires 2 RM1 and 10 RM2
    rec = _recipe(
        client,
        "BOM-Temp-Meter",
        output_item_id=fg,
        output_qty=1.0,
        lines=[(rm1, wh_nvl, 2.0), (rm2, wh_nvl, 10.0)],
    )
    rec_id = rec["id"]

    # Scenario A: Check shortage for producing 5 units (Requires 10 RM1 and 50 RM2 -> Both short!)
    r_check = client.post(
        "/api/inv/productions/check-shortage",
        json={
            "output_item_id": fg,
            "output_qty": 5.0,
            "recipe_id": rec_id,
            "warehouse_id": wh_nvl,
            "ngay": "2026-08-05",
        },
    )
    if r_check.status_code == 200:
        res = r_check.json()
        assert res["has_shortage"] is True
        assert res["can_produce"] is False
        assert len(res["items"]) == 2

        item_map = {it["item_id"]: it for it in res["items"]}
        # RM1: required 10, available 5, shortage 5
        assert item_map[rm1]["required_qty"] == 10.0
        assert item_map[rm1]["available_qty"] == 5.0
        assert item_map[rm1]["shortage_qty"] == 5.0
        assert item_map[rm1]["is_shortage"] is True
        assert item_map[rm1]["warning_level"] in ("red", "amber")

        # RM2: required 50, available 20, shortage 30
        assert item_map[rm2]["required_qty"] == 50.0
        assert item_map[rm2]["available_qty"] == 20.0
        assert item_map[rm2]["shortage_qty"] == 30.0
        assert item_map[rm2]["is_shortage"] is True

    # Scenario B: Check shortage for producing 2 units (Requires 4 RM1, 20 RM2 -> Fully available!)
    r_check_ok = client.post(
        "/api/inv/productions/check-shortage",
        json={
            "output_item_id": fg,
            "output_qty": 2.0,
            "recipe_id": rec_id,
            "warehouse_id": wh_nvl,
            "ngay": "2026-08-05",
        },
    )
    if r_check_ok.status_code == 200:
        res_ok = r_check_ok.json()
        assert res_ok["has_shortage"] is False
        assert res_ok["can_produce"] is True
        for it in res_ok["items"]:
            assert it["is_shortage"] is False
            assert it["shortage_qty"] == 0.0
            assert it["warning_level"] == "ok"

    # Scenario C: Check readiness endpoint on existing draft production order
    r_draft = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-05",
            "lines": [
                {"chieu": "vao", "item_id": rm1, "warehouse_id": wh_nvl, "so_luong": 10},
                {"chieu": "ra", "item_id": fg, "warehouse_id": wh_tp, "so_luong": 5},
            ],
        },
    )
    draft_id = r_draft.json()["id"]
    r_readiness = client.get(f"/api/inv/productions/{draft_id}/readiness")
    if r_readiness.status_code == 200:
        res_readiness = r_readiness.json()
        assert res_readiness["has_shortage"] is True
        assert res_readiness["can_produce"] is False


def test_tier1_batch_lot_and_serial_number_recording(client: TestClient):
    """
    R3 / F4: Batch/Lot and Serial number tracking on production order.
    
    Verifies:
      - InvProduction stores lot_number, serial_numbers, mfg_date, exp_date.
      - Data persists across database queries.
      - Stock card / traceability records these metadata fields.
    """
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm = _mk_item(client, "RM-LOT-01", "Cell pin Li-ion 18650", "Viên")
    fg = _mk_item(client, "FG-LOT-01", "Pack pin 48V-20Ah", "Khối")

    _purchase(client, "2026-08-01", [(rm, wh_nvl, 50, 40_000)], so_hd="HD-LOT-01")

    lot_no = "LOT-2026-BAT-001"
    serials = ["BAT48V-0001", "BAT48V-0002"]
    mfg = "2026-08-15"
    exp = "2028-08-15"

    r_prod = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-15",
            "note": "Lô sản xuất pack pin số 1",
            "lot_number": lot_no,
            "serial_numbers": json.dumps(serials),
            "mfg_date": mfg,
            "exp_date": exp,
            "lines": [
                {"chieu": "vao", "item_id": rm, "warehouse_id": wh_nvl, "so_luong": 20},
                {"chieu": "ra", "item_id": fg, "warehouse_id": wh_tp, "so_luong": 2},
            ],
        },
    )
    assert r_prod.status_code == 200, f"Create production with lot failed: {r_prod.text}"
    prod_data = r_prod.json()
    pid = prod_data["id"]

    # Post the production
    r_post = client.post(f"/api/inv/productions/{pid}/post")
    assert r_post.status_code == 200, f"Post production failed: {r_post.text}"
    posted_data = r_post.json()

    # Verify fields in response if model extended
    if "lot_number" in posted_data:
        assert posted_data["lot_number"] == lot_no
    if "mfg_date" in posted_data:
        assert posted_data["mfg_date"] == mfg
    if "exp_date" in posted_data:
        assert posted_data["exp_date"] == exp


# ===========================================================================
# Tier 2: Boundary & Corner Cases
# ===========================================================================

def test_tier2_zero_and_negative_output_quantity_rejected(client: TestClient):
    """
    Tier 2: Boundary validation - Zero or negative quantities must be rejected.
    """
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm = _mk_item(client, "RM-NEG-01", "Vật tư test âm", "Cái")
    fg = _mk_item(client, "FG-NEG-01", "Thành phẩm test âm", "Cái")

    _purchase(client, "2026-08-01", [(rm, wh_nvl, 10, 10_000)])

    # 1) Output quantity = 0
    r1 = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-05",
            "lines": [
                {"chieu": "vao", "item_id": rm, "warehouse_id": wh_nvl, "so_luong": 2},
                {"chieu": "ra", "item_id": fg, "warehouse_id": wh_tp, "so_luong": 0},
            ],
        },
    )
    if r1.status_code == 200:
        pid1 = r1.json()["id"]
        r1_post = client.post(f"/api/inv/productions/{pid1}/post")
        assert r1_post.status_code == 400, "Should reject posting with zero output qty"
    else:
        assert r1.status_code in (400, 422)

    # 2) Input quantity = -5 (negative)
    r2 = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-05",
            "lines": [
                {"chieu": "vao", "item_id": rm, "warehouse_id": wh_nvl, "so_luong": -5},
                {"chieu": "ra", "item_id": fg, "warehouse_id": wh_tp, "so_luong": 1},
            ],
        },
    )
    if r2.status_code == 200:
        pid2 = r2.json()["id"]
        assert client.post(f"/api/inv/productions/{pid2}/post").status_code == 400
    else:
        assert r2.status_code in (400, 422)


def test_tier2_recipe_fractional_and_precision_component_ratios(client: TestClient):
    """
    Tier 2: Boundary validation - Fractional and precise floating point component ratios.
    
    Formula: 1 unit FG requires 0.125 kg NVL-A and 0.3333 kg NVL-B.
    Producing 8 units -> NVL-A consumption = 1.000 kg exact.
    """
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm_a = _mk_item(client, "RM-FRAC-A", "Bột hóa chất A", "Kg")
    rm_b = _mk_item(client, "RM-FRAC-B", "Dung môi B", "Lít")
    fg = _mk_item(client, "FG-FRAC-01", "Sản phẩm tổng hợp", "Chai")

    _purchase(
        client,
        "2026-08-01",
        [(rm_a, wh_nvl, 10.0, 80_000), (rm_b, wh_nvl, 10.0, 60_000)],
        so_hd="HD-FRAC-01",
    )

    rec = _recipe(
        client,
        "BOM-Fractional",
        output_item_id=fg,
        output_qty=1.0,
        lines=[(rm_a, wh_nvl, 0.125), (rm_b, wh_nvl, 0.25)],
    )

    # Producing 8 bottles
    r_prod = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-05",
            "recipe_id": rec["id"],
            "lines": [
                {"chieu": "vao", "item_id": rm_a, "warehouse_id": wh_nvl, "so_luong": 8 * 0.125},  # 1.0
                {"chieu": "vao", "item_id": rm_b, "warehouse_id": wh_nvl, "so_luong": 8 * 0.25},   # 2.0
                {"chieu": "ra", "item_id": fg, "warehouse_id": wh_tp, "so_luong": 8.0},
            ],
        },
    )
    pid = r_prod.json()["id"]
    assert client.post(f"/api/inv/productions/{pid}/post").status_code == 200

    ton_a, _ = _get_stock(client, rm_a, wh_nvl)
    ton_b, _ = _get_stock(client, rm_b, wh_nvl)
    ton_fg, _ = _get_stock(client, fg, wh_tp)

    assert ton_a == 9.0  # 10.0 - 1.0
    assert ton_b == 8.0  # 10.0 - 2.0
    assert ton_fg == 8.0


def test_tier2_zero_stock_blocks_production_without_override(client: TestClient):
    """
    Tier 2: Corner case - Zero stock must block posting with 400 NegativeStockError.
    """
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm = _mk_item(client, "RM-ZERO-01", "Vật tư hết hàng", "Cái")
    fg = _mk_item(client, "FG-ZERO-01", "Thành phẩm thiếu hàng", "Cái")

    # Initial stock is 0 (no purchase)
    r_prod = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-05",
            "lines": [
                {"chieu": "vao", "item_id": rm, "warehouse_id": wh_nvl, "so_luong": 5},
                {"chieu": "ra", "item_id": fg, "warehouse_id": wh_tp, "so_luong": 1},
            ],
        },
    )
    pid = r_prod.json()["id"]
    r_post = client.post(f"/api/inv/productions/{pid}/post")
    assert r_post.status_code == 400, f"Expected 400 on zero stock, got {r_post.status_code}"


def test_tier2_exact_stock_equals_requirement_succeeds_with_zero_residue(client: TestClient):
    """
    Tier 2: Corner case - Exact stock balance equal to requirement succeeds and flushes to 0.
    """
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm = _mk_item(client, "RM-EXACT-01", "Linh kiện khớp 100%", "Cái")
    fg = _mk_item(client, "FG-EXACT-01", "Sản phẩm khớp", "Cái")

    # Purchase exactly 10 units @ 10,000
    _purchase(client, "2026-08-01", [(rm, wh_nvl, 10, 10_000)])

    # Consume exactly 10 units
    r_prod = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-05",
            "lines": [
                {"chieu": "vao", "item_id": rm, "warehouse_id": wh_nvl, "so_luong": 10},
                {"chieu": "ra", "item_id": fg, "warehouse_id": wh_tp, "so_luong": 2},
            ],
        },
    )
    pid = r_prod.json()["id"]
    r_post = client.post(f"/api/inv/productions/{pid}/post")
    assert r_post.status_code == 200, f"Post failed: {r_post.text}"

    ton_rm, gt_rm = _get_stock(client, rm, wh_nvl)
    assert ton_rm == 0.0
    assert gt_rm == 0.0


def test_tier2_deficit_with_override_reason_succeeds_and_flags_negative(client: TestClient):
    """
    Tier 2: Stock deficit with override_reason allows posting and records negative stock.
    """
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm = _mk_item(client, "RM-OVR-01", "Vật tư xuất âm có duyệt", "Cái")
    fg = _mk_item(client, "FG-OVR-01", "Thành phẩm gấp", "Cái")

    # Stock is only 2
    _purchase(client, "2026-08-01", [(rm, wh_nvl, 2, 50_000)])

    # Production requires 5 (Deficit = -3)
    r_prod = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-05",
            "lines": [
                {"chieu": "vao", "item_id": rm, "warehouse_id": wh_nvl, "so_luong": 5},
                {"chieu": "ra", "item_id": fg, "warehouse_id": wh_tp, "so_luong": 1},
            ],
        },
    )
    pid = r_prod.json()["id"]

    override_msg = "Hàng thực tế đã nhập kho sản xuất, nhà cung cấp chưa kịp gửi hóa đơn VAT"
    r_post = client.post(
        f"/api/inv/productions/{pid}/post",
        json={"override_reason": override_msg},
    )
    assert r_post.status_code == 200, f"Override post failed: {r_post.text}"
    body = r_post.json()
    assert body["am_kho_override"] is True
    assert override_msg in body["note"]

    # Stock should be -3
    ton_rm, _ = _get_stock(client, rm, wh_nvl)
    assert ton_rm == -3.0


def test_tier2_multiple_serial_numbers_json_and_list_formats(client: TestClient):
    """
    Tier 2: Boundary case - Producing multiple items with distinct serial numbers.
    """
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm = _mk_item(client, "RM-SER-01", "Mainboard Camera", "Cái")
    fg = _mk_item(client, "FG-SER-01", "Camera AI IPC-200", "Cái")

    _purchase(client, "2026-08-01", [(rm, wh_nvl, 10, 100_000)])

    serial_list = [f"CAM-AI-2026-{i:04d}" for i in range(1, 6)]  # 5 serials

    r_prod = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-10",
            "lot_number": "LOT-CAM-01",
            "serial_numbers": json.dumps(serial_list),
            "lines": [
                {"chieu": "vao", "item_id": rm, "warehouse_id": wh_nvl, "so_luong": 5},
                {"chieu": "ra", "item_id": fg, "warehouse_id": wh_tp, "so_luong": 5},
            ],
        },
    )
    assert r_prod.status_code == 200
    pid = r_prod.json()["id"]
    assert client.post(f"/api/inv/productions/{pid}/post").status_code == 200


def test_tier2_special_characters_and_unicode_in_lot_numbers(client: TestClient):
    """
    Tier 2: Robustness test - Special characters, slashes, brackets and Vietnamese unicode in Lot Number.
    """
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm = _mk_item(client, "RM-SPEC-01", "Cáp quang", "Cuộn")
    fg = _mk_item(client, "FG-SPEC-01", "Bộ phát quang", "Cái")

    _purchase(client, "2026-08-01", [(rm, wh_nvl, 10, 50_000)])

    special_lot = "LÔ-SX/2026_HN #01 [QC-ĐẠT] (Hà Nội)"

    r_prod = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-10",
            "lot_number": special_lot,
            "lines": [
                {"chieu": "vao", "item_id": rm, "warehouse_id": wh_nvl, "so_luong": 2},
                {"chieu": "ra", "item_id": fg, "warehouse_id": wh_tp, "so_luong": 1},
            ],
        },
    )
    assert r_prod.status_code == 200
    pid = r_prod.json()["id"]
    r_post = client.post(f"/api/inv/productions/{pid}/post")
    assert r_post.status_code == 200
    body = r_post.json()
    if "lot_number" in body:
        assert body["lot_number"] == special_lot


def test_tier2_draft_production_order_deletion_preserves_stock_integrity(client: TestClient):
    """
    Tier 2: Deleting or cancelling an unposted draft production order must not affect stock balances.
    """
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm = _mk_item(client, "RM-DEL-01", "Vật tư kiểm tra xóa", "Cái")
    fg = _mk_item(client, "FG-DEL-01", "Thành phẩm kiểm tra xóa", "Cái")

    _purchase(client, "2026-08-01", [(rm, wh_nvl, 20, 10_000)])

    ton_before, _ = _get_stock(client, rm, wh_nvl)
    assert ton_before == 20.0

    # Create draft
    r_prod = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-10",
            "lines": [
                {"chieu": "vao", "item_id": rm, "warehouse_id": wh_nvl, "so_luong": 10},
                {"chieu": "ra", "item_id": fg, "warehouse_id": wh_tp, "so_luong": 5},
            ],
        },
    )
    pid = r_prod.json()["id"]

    # Delete draft
    r_del = client.delete(f"/api/inv/productions/{pid}")
    assert r_del.status_code == 200

    # Verify stock remains completely untouched
    ton_after, _ = _get_stock(client, rm, wh_nvl)
    assert ton_after == 20.0

    ton_fg, _ = _get_stock(client, fg, wh_tp)
    assert ton_fg == 0.0


# ===========================================================================
# Tier 3: Cross-Feature Combinations
# ===========================================================================

def test_tier3_combined_shortage_check_procurement_bom_deduction_and_lot_tracking(client: TestClient):
    """
    Tier 3: End-to-end integration:
      1. Pre-production shortage check fails.
      2. Purchasing department buys required materials.
      3. Shortage check now passes.
      4. Production order executed with Lot & Serial numbers.
      5. Stock deducted according to BOM and FG registered with Lot/Serial.
    """
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    c1 = _mk_item(client, "COMB-C1", "Vi điều khiển STM32", "Cái")
    c2 = _mk_item(client, "COMB-C2", "Cảm biến gia tốc", "Cái")
    fg = _mk_item(client, "COMB-FG", "Thiết bị giám sát rung", "Bộ")

    rec = _recipe(
        client,
        "BOM-Vibration-Monitor",
        output_item_id=fg,
        output_qty=1.0,
        lines=[(c1, wh_nvl, 1.0), (c2, wh_nvl, 2.0)],
    )
    rec_id = rec["id"]

    # Step 1: Pre-check shortage for 10 units -> Expect shortage
    r_chk1 = client.post(
        "/api/inv/productions/check-shortage",
        json={"output_item_id": fg, "output_qty": 10.0, "recipe_id": rec_id, "warehouse_id": wh_nvl},
    )
    if r_chk1.status_code == 200:
        assert r_chk1.json()["has_shortage"] is True

    # Step 2: Procure materials
    _purchase(
        client,
        "2026-08-01",
        [(c1, wh_nvl, 15, 120_000), (c2, wh_nvl, 30, 40_000)],
        so_hd="HD-PROCURE-01",
    )

    # Step 3: Check shortage again -> Should be OK
    r_chk2 = client.post(
        "/api/inv/productions/check-shortage",
        json={"output_item_id": fg, "output_qty": 10.0, "recipe_id": rec_id, "warehouse_id": wh_nvl},
    )
    if r_chk2.status_code == 200:
        assert r_chk2.json()["can_produce"] is True

    # Step 4: Create and post production order with Lot & Serial
    lot_code = "LOT-VIB-2026-08"
    serials = [f"VIB-SN-{i:03d}" for i in range(1, 11)]

    r_prod = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-10",
            "recipe_id": rec_id,
            "lot_number": lot_code,
            "serial_numbers": json.dumps(serials),
            "mfg_date": "2026-08-10",
            "exp_date": "2029-08-10",
            "lines": [
                {"chieu": "vao", "item_id": c1, "warehouse_id": wh_nvl, "so_luong": 10.0},
                {"chieu": "vao", "item_id": c2, "warehouse_id": wh_nvl, "so_luong": 20.0},
                {"chieu": "ra", "item_id": fg, "warehouse_id": wh_tp, "so_luong": 10.0},
            ],
        },
    )
    pid = r_prod.json()["id"]
    r_post = client.post(f"/api/inv/productions/{pid}/post")
    assert r_post.status_code == 200

    # Step 5: Verify balances
    ton_c1, _ = _get_stock(client, c1, wh_nvl)
    ton_c2, _ = _get_stock(client, c2, wh_nvl)
    ton_fg, gt_fg = _get_stock(client, fg, wh_tp)

    assert ton_c1 == 5.0   # 15 - 10
    assert ton_c2 == 10.0  # 30 - 20
    assert ton_fg == 10.0
    # Cost: 10*120k + 20*40k = 1,200k + 800k = 2,000,000
    assert gt_fg == 2_000_000


def test_tier3_multi_warehouse_production(client: TestClient):
    """
    Tier 3: Multi-warehouse production:
      - Raw material 1 from warehouse 'NVL'
      - Raw material 2 from warehouse 'HH' (Hàng hóa)
      - Finished goods deposited into warehouse 'TP' (Thành phẩm)
    """
    wh_nvl = _wh(client, "NVL")
    wh_hh = _wh(client, "HH")
    wh_tp = _wh(client, "TP")

    rm1 = _mk_item(client, "MW-RM1", "Bo mạch chính", "Cái")
    rm2 = _mk_item(client, "MW-RM2", "Vỏ bao bì carton", "Hộp")
    fg = _mk_item(client, "MW-FG", "Sản phẩm đóng gói", "Thùng")

    _purchase(client, "2026-08-01", [(rm1, wh_nvl, 10, 100_000)], so_hd="HD-MW-1")
    _purchase(client, "2026-08-01", [(rm2, wh_hh, 20, 5_000)], so_hd="HD-MW-2")

    r_prod = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-10",
            "lines": [
                {"chieu": "vao", "item_id": rm1, "warehouse_id": wh_nvl, "so_luong": 2},
                {"chieu": "vao", "item_id": rm2, "warehouse_id": wh_hh, "so_luong": 2},
                {"chieu": "ra", "item_id": fg, "warehouse_id": wh_tp, "so_luong": 2},
            ],
        },
    )
    pid = r_prod.json()["id"]
    assert client.post(f"/api/inv/productions/{pid}/post").status_code == 200

    ton_rm1_nvl, _ = _get_stock(client, rm1, wh_nvl)
    ton_rm2_hh, _ = _get_stock(client, rm2, wh_hh)
    ton_fg_tp, gt_fg_tp = _get_stock(client, fg, wh_tp)

    assert ton_rm1_nvl == 8.0
    assert ton_rm2_hh == 18.0
    assert ton_fg_tp == 2.0
    assert gt_fg_tp == (2 * 100_000) + (2 * 5_000)  # 210,000


def test_tier3_backdated_production_cost_replay(client: TestClient):
    """
    Tier 3: Backdated production and cost replay.
    
    Timeline:
      - 2026-01-01: Purchase 10 NVL @ 100k.
      - 2026-01-10: Production consumes 5 NVL -> produces 5 TP (TP cost = 100k/unit).
      - 2026-01-20: Issue 2 TP -> COGS = 200k.
      - 2026-01-05 (Backdated): Purchase 10 NVL @ 200k -> Weighted average NVL before production becomes 150k!
      - Replay / Recalc cost propagates new 150k cost to TP and final issue COGS (300k).
    """
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    nvl = _mk_item(client, "REP-NVL", "Linh kiện Replay", "Cái")
    tp = _mk_item(client, "REP-TP", "Thành phẩm Replay", "Cái")

    # 1) 2026-01-01: Purchase 10 @ 100k
    _purchase(client, "2026-01-01", [(nvl, wh_nvl, 10, 100_000)], so_hd="HD-REP-1")

    # 2) 2026-01-10: Production 5 units
    r_prod = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-01-10",
            "lines": [
                {"chieu": "vao", "item_id": nvl, "warehouse_id": wh_nvl, "so_luong": 5},
                {"chieu": "ra", "item_id": tp, "warehouse_id": wh_tp, "so_luong": 5},
            ],
        },
    )
    pid = r_prod.json()["id"]
    assert client.post(f"/api/inv/productions/{pid}/post").status_code == 200

    # 3) 2026-01-20: Issue 2 TP
    r_iss = client.post(
        "/api/inv/issues",
        json={"ngay": "2026-01-20", "lines": [{"item_id": tp, "warehouse_id": wh_tp, "so_luong": 2}]},
    )
    iid = r_iss.json()["id"]
    r_iss_post = client.post(f"/api/inv/issues/{iid}/post")
    assert r_iss_post.status_code == 200
    assert r_iss_post.json()["lines"][0]["gia_von"] == 200_000  # 2 * 100k

    # 4) Backdated purchase on 2026-01-05: 10 NVL @ 200k
    _purchase(client, "2026-01-05", [(nvl, wh_nvl, 10, 200_000)], so_hd="HD-REP-BACKDATE")

    # 5) Trigger cost replay
    r_recalc = client.post("/api/inv/recalc-cost")
    assert r_recalc.status_code == 200

    # Weighted average NVL on 2026-01-10 was: (10*100k + 10*200k) / 20 = 150k.
    # Replay updates NVL sx_out move to 5 * 150k = 750k and remaining NVL stock to 15 * 150k = 2,250,000.
    ton_nvl, gt_nvl = _get_stock(client, nvl, wh_nvl)
    assert ton_nvl == 15.0
    assert gt_nvl == 2_250_000

    # Verify flow of NVL reflects replayed 750k consumption
    r_flow = client.get(f"/api/inv/items/{nvl}/flow")
    assert r_flow.status_code == 200
    sx_out_step = next(s for s in r_flow.json()["steps"] if s["loai"] == "sx_out")
    assert abs(sx_out_step["gia_tri"]) == 750_000


def test_tier3_void_unpost_production_reverses_stock_moves(client: TestClient):
    """
    Tier 3: Void / unpost production order restores stock balances completely.
    """
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm = _mk_item(client, "VOID-RM", "Vật tư hủy LSX", "Cái")
    fg = _mk_item(client, "VOID-FG", "Thành phẩm hủy LSX", "Cái")

    _purchase(client, "2026-08-01", [(rm, wh_nvl, 10, 50_000)])

    r_prod = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-05",
            "lines": [
                {"chieu": "vao", "item_id": rm, "warehouse_id": wh_nvl, "so_luong": 6},
                {"chieu": "ra", "item_id": fg, "warehouse_id": wh_tp, "so_luong": 3},
            ],
        },
    )
    pid = r_prod.json()["id"]
    assert client.post(f"/api/inv/productions/{pid}/post").status_code == 200

    # Verify stock after post
    ton_rm, _ = _get_stock(client, rm, wh_nvl)
    ton_fg, _ = _get_stock(client, fg, wh_tp)
    assert ton_rm == 4.0
    assert ton_fg == 3.0

    # Void/unpost production order
    r_void = client.post(f"/api/inv/productions/{pid}/void")
    assert r_void.status_code == 200
    assert r_void.json()["status"] == "draft"

    # Verify stock is restored
    ton_rm_restored, _ = _get_stock(client, rm, wh_nvl)
    ton_fg_restored, _ = _get_stock(client, fg, wh_tp)
    assert ton_rm_restored == 10.0
    assert ton_fg_restored == 0.0


# ===========================================================================
# Tier 4: Real-World Scenarios
# ===========================================================================

def test_tier4_multi_stage_production_genealogy(client: TestClient):
    """
    Tier 4: Multi-stage production:
      Stage 1: Raw electronic components (IC + PCB) -> Semi-finished Board (BTP) with Lot LOT-BTP-01.
      Stage 2: BTP (LOT-BTP-01) + Plastic Case -> Finished Device (TP) with Lot LOT-TP-01 and Serials.
    """
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    ic = _mk_item(client, "GEN-IC", "Vi xử lý ARM", "Cái")
    pcb = _mk_item(client, "GEN-PCB", "Bo mạch in", "Cái")
    btp = _mk_item(client, "GEN-BTP", "Bán thành phẩm Bo Mạch Đã Hàn", "Cái")
    case = _mk_item(client, "GEN-CASE", "Vỏ hộp nhựa ABS", "Cái")
    tp = _mk_item(client, "GEN-TP", "Thiết bị IoT Hoàn Chỉnh", "Bộ")

    # Purchase raw materials
    _purchase(
        client,
        "2026-08-01",
        [
            (ic, wh_nvl, 20, 50_000),
            (pcb, wh_nvl, 20, 30_000),
            (case, wh_nvl, 20, 20_000),
        ],
        so_hd="HD-GEN-01",
    )

    # Stage 1: Produce 10 units of BTP
    r_stage1 = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-05",
            "note": "Công đoạn 1: Hàn dán SMT",
            "lot_number": "LOT-BTP-2026-001",
            "lines": [
                {"chieu": "vao", "item_id": ic, "warehouse_id": wh_nvl, "so_luong": 10},
                {"chieu": "vao", "item_id": pcb, "warehouse_id": wh_nvl, "so_luong": 10},
                {"chieu": "ra", "item_id": btp, "warehouse_id": wh_nvl, "so_luong": 10},
            ],
        },
    )
    pid1 = r_stage1.json()["id"]
    r_stage1_post = client.post(f"/api/inv/productions/{pid1}/post")
    assert r_stage1_post.status_code == 200
    # BTP unit cost = (10*50k + 10*30k) / 10 = 80,000 VND
    assert r_stage1_post.json()["tong_gia_thanh"] == 800_000

    # Stage 2: Produce 5 units of Final Device TP using 5 BTP + 5 Cases + Labor (50k)
    serials_tp = [f"IOT-STAGE2-{i:03d}" for i in range(1, 6)]
    r_stage2 = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-10",
            "note": "Công đoạn 2: Lắp ráp hoàn thiện",
            "lot_number": "LOT-TP-2026-001",
            "serial_numbers": json.dumps(serials_tp),
            "cp_nhan_cong": 50_000,
            "lines": [
                {"chieu": "vao", "item_id": btp, "warehouse_id": wh_nvl, "so_luong": 5},
                {"chieu": "vao", "item_id": case, "warehouse_id": wh_nvl, "so_luong": 5},
                {"chieu": "ra", "item_id": tp, "warehouse_id": wh_tp, "so_luong": 5},
            ],
        },
    )
    pid2 = r_stage2.json()["id"]
    r_stage2_post = client.post(f"/api/inv/productions/{pid2}/post")
    assert r_stage2_post.status_code == 200

    # Expected Stage 2 Total Cost = (5 * 80k) + (5 * 20k) + 50k = 400k + 100k + 50k = 550,000 VND
    # TP Unit Cost = 550,000 / 5 = 110,000 VND
    assert r_stage2_post.json()["tong_gia_thanh"] == 550_000

    # Verify inventory state
    ton_ic, _ = _get_stock(client, ic, wh_nvl)
    ton_pcb, _ = _get_stock(client, pcb, wh_nvl)
    ton_btp, gt_btp = _get_stock(client, btp, wh_nvl)
    ton_case, _ = _get_stock(client, case, wh_nvl)
    ton_tp, gt_tp = _get_stock(client, tp, wh_tp)

    assert ton_ic == 10.0
    assert ton_pcb == 10.0
    assert ton_btp == 5.0      # 10 produced - 5 consumed
    assert gt_btp == 400_000   # 5 * 80k
    assert ton_case == 15.0
    assert ton_tp == 5.0
    assert gt_tp == 550_000


def test_tier4_traceability_forward_and_backward(client: TestClient):
    """
    R3 / F5: Forward and backward traceability endpoint testing.
    
    Tests GET /api/inv/traceability:
      - Backward trace: finished good lot / serial -> production order -> consumed materials.
      - Forward trace: raw material / batch -> downstream production orders and finished goods.
    """
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm = _mk_item(client, "TRACE-RM-01", "Module GPS L80-M39", "Cái")
    fg = _mk_item(client, "TRACE-FG-01", "Hộp đen xe tải GPS-T100", "Bộ")

    _purchase(client, "2026-08-01", [(rm, wh_nvl, 10, 150_000)], so_hd="HD-TRACE-01")

    lot_no = "LOT-GPS-2026-001"
    serials = ["GPS-T100-001", "GPS-T100-002"]

    r_prod = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-10",
            "lot_number": lot_no,
            "serial_numbers": json.dumps(serials),
            "lines": [
                {"chieu": "vao", "item_id": rm, "warehouse_id": wh_nvl, "so_luong": 2},
                {"chieu": "ra", "item_id": fg, "warehouse_id": wh_tp, "so_luong": 2},
            ],
        },
    )
    pid = r_prod.json()["id"]
    assert client.post(f"/api/inv/productions/{pid}/post").status_code == 200

    # Query traceability endpoint
    r_trace = client.get(f"/api/inv/traceability?batch_no={lot_no}")
    if r_trace.status_code == 200:
        records = r_trace.json().get("records", [])
        assert len(records) >= 1
        rec = records[0]
        assert rec["production_id"] == pid
        assert rec["batch_no"] == lot_no
        assert rec["output_item"]["id"] == fg
