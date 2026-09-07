"""Unit and integration tests for Inventory & Production Upgrade (M1 & M2).

Covers:
1. Schema & Migration Verification (lot_number, serial_numbers, mfg_date, exp_date).
2. BOM Deduction Engine with automatic component expansion.
3. Pre-Production Stock Shortage API (/api/inv/productions/check-shortage & /api/inv/productions/{id}/readiness).
4. Batch/Lot and Serial number tracking propagation to InvMove (sx_out and sx_in).
5. Forward and Backward Traceability API (/api/inv/traceability).
6. Production Void/Unpost & Draft Cancel Stock Ledger Integrity.
"""
from __future__ import annotations

import json
import pytest

pytest.importorskip("fastapi")

from fastapi.testclient import TestClient
from sqlalchemy import text
from app import db as dbmod


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
            "ten_ban": "NCC Nguyen Vat Lieu Test",
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


def test_schema_migration_columns_exist(client: TestClient):
    """Verify _migrate_add_columns adds lot/serial/date fields to tables."""
    dbmod._init_engine()
    with dbmod._engine.begin() as conn:
        prod_cols = {r[1] for r in conn.execute(text("PRAGMA table_info(inv_productions)"))}
        assert "lot_number" in prod_cols
        assert "serial_numbers" in prod_cols
        assert "mfg_date" in prod_cols
        assert "exp_date" in prod_cols

        line_cols = {r[1] for r in conn.execute(text("PRAGMA table_info(inv_production_lines)"))}
        assert "lot_number" in line_cols
        assert "serial_numbers" in line_cols

        move_cols = {r[1] for r in conn.execute(text("PRAGMA table_info(inv_moves)"))}
        assert "lot_number" in move_cols
        assert "serial_numbers" in move_cols


def test_bom_auto_expansion_on_production_create(client: TestClient):
    """Creating production with recipe_id auto-expands component lines scaled by target output_qty."""
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm1 = _mk_item(client, "RM-EXP-01", "Vỏ nhôm định hình", "Cái")
    rm2 = _mk_item(client, "RM-EXP-02", "Mạch MCU", "Cái")
    fg = _mk_item(client, "FG-EXP-01", "Cảm biến IoT", "Bộ")

    rec = _recipe(
        client,
        "Recipe-IoT-Sensor",
        output_item_id=fg,
        output_qty=2.0,
        lines=[(rm1, wh_nvl, 4.0), (rm2, wh_nvl, 2.0)],  # Ratio: 2 rm1 / 1 fg, 1 rm2 / 1 fg
    )
    rec_id = rec["id"]

    # Create production order requesting 10 finished goods (without explicit lines)
    r_prod = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-20",
            "recipe_id": rec_id,
            "output_qty": 10.0,
            "warehouse_id": wh_tp,
            "note": "Tự động bung định mức",
            "lot_number": "LOT-EXP-100",
            "serial_numbers": "SN-001, SN-002",
        },
    )
    assert r_prod.status_code == 200, f"Auto expand failed: {r_prod.text}"
    prod = r_prod.json()

    assert prod["recipe_id"] == rec_id
    assert prod["lot_number"] == "LOT-EXP-100"
    assert prod["serial_numbers"] == "SN-001, SN-002"

    out_lines = [l for l in prod["lines"] if l["chieu"] == "ra"]
    in_lines = [l for l in prod["lines"] if l["chieu"] == "vao"]

    assert len(out_lines) == 1
    assert out_lines[0]["item_id"] == fg
    assert out_lines[0]["so_luong"] == 10.0

    assert len(in_lines) == 2
    rm_map = {l["item_id"]: l["so_luong"] for l in in_lines}
    assert rm_map[rm1] == 20.0  # (10 / 2) * 4 = 20
    assert rm_map[rm2] == 10.0  # (10 / 2) * 2 = 10


def test_pre_production_shortage_api_recipe_and_lines(client: TestClient):
    """Test POST /api/inv/productions/check-shortage with recipe and line inputs."""
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm1 = _mk_item(client, "RM-ST-01", "Pin 3.7V", "Viên")
    rm2 = _mk_item(client, "RM-ST-02", "Antenna", "Cái")
    fg = _mk_item(client, "FG-ST-01", "Thiết bị phát sóng", "Bộ")

    # Seed stock: 15 Pin, 0 Antenna
    _purchase(client, "2026-08-01", [(rm1, wh_nvl, 15, 30_000)])

    rec = _recipe(
        client,
        "Recipe-Radio",
        output_item_id=fg,
        output_qty=1.0,
        lines=[(rm1, wh_nvl, 2.0), (rm2, wh_nvl, 1.0)],
    )

    # Check shortage for 10 units: requires 20 Pin, 10 Antenna
    # Pin: required 20, available 15 -> shortage 5 (amber)
    # Antenna: required 10, available 0 -> shortage 10 (red)
    r_check = client.post(
        "/api/inv/productions/check-shortage",
        json={
            "recipe_id": rec["id"],
            "output_qty": 10.0,
            "warehouse_id": wh_nvl,
            "ngay": "2026-08-10",
        },
    )
    assert r_check.status_code == 200, f"Check shortage failed: {r_check.text}"
    data = r_check.json()

    assert data["has_shortage"] is True
    assert data["can_produce"] is False
    assert len(data["items"]) == 2

    imap = {it["item_id"]: it for it in data["items"]}
    assert imap[rm1]["required_qty"] == 20.0
    assert imap[rm1]["available_qty"] == 15.0
    assert imap[rm1]["shortage_qty"] == 5.0
    assert imap[rm1]["is_shortage"] is True
    assert imap[rm1]["warning_level"] == "amber"

    assert imap[rm2]["required_qty"] == 10.0
    assert imap[rm2]["available_qty"] == 0.0
    assert imap[rm2]["shortage_qty"] == 10.0
    assert imap[rm2]["is_shortage"] is True
    assert imap[rm2]["warning_level"] == "red"

    # Check shortage for 5 units: requires 10 Pin, 5 Antenna
    # Now purchase 10 Antenna
    _purchase(client, "2026-08-05", [(rm2, wh_nvl, 10, 15_000)], so_hd="HD-MUA-ANT")

    r_check_ok = client.post(
        "/api/inv/productions/check-shortage",
        json={
            "recipe_id": rec["id"],
            "output_qty": 5.0,
            "warehouse_id": wh_nvl,
            "ngay": "2026-08-10",
        },
    )
    assert r_check_ok.status_code == 200
    data_ok = r_check_ok.json()
    assert data_ok["has_shortage"] is False
    assert data_ok["can_produce"] is True
    for it in data_ok["items"]:
        assert it["is_shortage"] is False
        assert it["warning_level"] == "ok"


def test_production_readiness_endpoint(client: TestClient):
    """GET /api/inv/productions/{id}/readiness returns stock readiness for draft order."""
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm = _mk_item(client, "RM-RDY-01", "Motor 12V", "Cái")
    fg = _mk_item(client, "FG-RDY-01", "Quạt mini", "Cái")

    _purchase(client, "2026-08-01", [(rm, wh_nvl, 8, 50_000)])

    r_prod = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-10",
            "lines": [
                {"chieu": "vao", "item_id": rm, "warehouse_id": wh_nvl, "so_luong": 10},
                {"chieu": "ra", "item_id": fg, "warehouse_id": wh_tp, "so_luong": 10},
            ],
        },
    )
    pid = r_prod.json()["id"]

    r_rdy = client.get(f"/api/inv/productions/{pid}/readiness")
    assert r_rdy.status_code == 200
    res = r_rdy.json()
    assert res["has_shortage"] is True
    assert res["can_produce"] is False
    assert res["items"][0]["item_id"] == rm
    assert res["items"][0]["shortage_qty"] == 2.0


def test_batch_serial_metadata_and_traceability_api(client: TestClient):
    """Post production with lot & serial numbers, verify moves, stock card, and GET /api/inv/traceability."""
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm = _mk_item(client, "RM-TR-01", "Cảm biến LiDAR", "Cái")
    fg = _mk_item(client, "FG-TR-01", "Robot điều hướng", "Con")

    _purchase(client, "2026-08-01", [(rm, wh_nvl, 10, 500_000)])

    lot_no = "LOT-ROBOT-2026-B1"
    serials = ["ROBOT-SN-001", "ROBOT-SN-002"]

    r_prod = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-15",
            "lot_number": lot_no,
            "serial_numbers": json.dumps(serials),
            "mfg_date": "2026-08-15",
            "exp_date": "2029-08-15",
            "lines": [
                {
                    "chieu": "vao",
                    "item_id": rm,
                    "warehouse_id": wh_nvl,
                    "so_luong": 2,
                    "lot_number": "LOT-NVL-LIDAR-09",
                    "serial_numbers": "LIDAR-001, LIDAR-002",
                },
                {"chieu": "ra", "item_id": fg, "warehouse_id": wh_tp, "so_luong": 2},
            ],
        },
    )
    assert r_prod.status_code == 200
    pid = r_prod.json()["id"]

    # Post order
    r_post = client.post(f"/api/inv/productions/{pid}/post")
    assert r_post.status_code == 200
    posted = r_post.json()
    assert posted["lot_number"] == lot_no
    assert posted["mfg_date"] == "2026-08-15"

    # Verify Stock Card for finished good
    r_card = client.get(f"/api/inv/items/{fg}/card?warehouse_id={wh_tp}")
    assert r_card.status_code == 200
    card_rows = r_card.json()
    assert len(card_rows) == 1
    assert card_rows[0]["lot_number"] == lot_no
    assert "ROBOT-SN-001" in card_rows[0]["serial_numbers"]

    # Query Traceability by batch_no
    r_tr1 = client.get(f"/api/inv/traceability?batch_no={lot_no}")
    assert r_tr1.status_code == 200
    recs1 = r_tr1.json()["records"]
    assert len(recs1) == 1
    assert recs1[0]["production_id"] == pid
    assert recs1[0]["output_item"]["id"] == fg
    assert len(recs1[0]["consumed_materials"]) == 1
    assert recs1[0]["consumed_materials"][0]["lot_number"] == "LOT-NVL-LIDAR-09"

    # Query Traceability by serial_no
    r_tr2 = client.get("/api/inv/traceability?serial_no=ROBOT-SN-002")
    assert r_tr2.status_code == 200
    recs2 = r_tr2.json()["records"]
    assert len(recs2) == 1
    assert recs2[0]["production_id"] == pid

    # Query Traceability by item_id
    r_tr3 = client.get(f"/api/inv/traceability?item_id={rm}")
    assert r_tr3.status_code == 200
    recs3 = r_tr3.json()["records"]
    assert len(recs3) == 1
    assert recs3[0]["production_id"] == pid


def test_production_void_unpost_and_draft_deletion(client: TestClient):
    """Voiding posted production restores stock; deleting draft does not affect stock."""
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm = _mk_item(client, "RM-VOID-01", "Module LED", "Cái")
    fg = _mk_item(client, "FG-VOID-01", "Đèn pha", "Cái")

    _purchase(client, "2026-08-01", [(rm, wh_nvl, 20, 100_000)])

    # Create draft
    r_prod = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-10",
            "lines": [
                {"chieu": "vao", "item_id": rm, "warehouse_id": wh_nvl, "so_luong": 5},
                {"chieu": "ra", "item_id": fg, "warehouse_id": wh_tp, "so_luong": 5},
            ],
        },
    )
    pid = r_prod.json()["id"]

    # Delete draft order -> stock unaffected
    r_del = client.delete(f"/api/inv/productions/{pid}")
    assert r_del.status_code == 200

    r_stk = client.get(f"/api/inv/stock?all_items=true")
    rm_row = next(x for x in r_stk.json()["rows"] if x["item_id"] == rm)
    assert rm_row["ton"] == 20.0

    # Create again and post
    r_prod2 = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-10",
            "lines": [
                {"chieu": "vao", "item_id": rm, "warehouse_id": wh_nvl, "so_luong": 8},
                {"chieu": "ra", "item_id": fg, "warehouse_id": wh_tp, "so_luong": 4},
            ],
        },
    )
    pid2 = r_prod2.json()["id"]
    assert client.post(f"/api/inv/productions/{pid2}/post").status_code == 200

    # Stock after post: rm = 12, fg = 4
    r_stk2 = client.get(f"/api/inv/stock?all_items=true")
    rm_row2 = next(x for x in r_stk2.json()["rows"] if x["item_id"] == rm)
    fg_row2 = next(x for x in r_stk2.json()["rows"] if x["item_id"] == fg)
    assert rm_row2["ton"] == 12.0
    assert fg_row2["ton"] == 4.0

    # Void / unpost production
    r_void = client.post(f"/api/inv/productions/{pid2}/void")
    assert r_void.status_code == 200
    assert r_void.json()["status"] == "draft"

    # Stock after void: rm = 20, fg = 0
    r_stk3 = client.get(f"/api/inv/stock?all_items=true")
    rm_row3 = next(x for x in r_stk3.json()["rows"] if x["item_id"] == rm)
    fg_rows3 = [x for x in r_stk3.json()["rows"] if x["item_id"] == fg]
    assert rm_row3["ton"] == 20.0
    assert sum(x["ton"] for x in fg_rows3) == 0.0
