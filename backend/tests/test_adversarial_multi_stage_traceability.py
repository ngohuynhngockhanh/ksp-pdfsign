"""Adversarial Verification Suite for Multi-Stage Production, Forward/Backward Traceability & Multi-Pass Cost Rollup.

Challenger 2 Empirical Verification:
1. Multi-stage manufacturing:
   - Stage 1 produces Sub-assembly (BTP with Lot L1)
   - Stage 2 consumes BTP L1 + NVL4 + Labor + Overhead to produce Final Product (TP with Lot L2 & Serials SN001..SN005)
2. Forward Traceability:
   - Querying Lot L1 resolves consumption in Stage 2 producing Lot L2
   - Querying raw materials resolves downstream BTP and TP
3. Backward Traceability:
   - Querying Lot L2 or Serial resolves source BTP Lot L1 and original raw materials
4. Multi-Stage Cost Rollup:
   - Accurate cost rollup through Stage 1 -> Stage 2 -> Finished Goods -> Issue COGS
   - Backdated raw material price adjustment replaying across all stages
5. Adversarial Stress & Edge Cases:
   - Branching / Split consumption of BTP Lot L1 across multiple downstream Stage 2 batches
   - Interlocking void/unpost safety
   - Search robustness on serials / batches (case, whitespace, unicode, non-existent)
"""
from __future__ import annotations

import json
import pytest
from fastapi.testclient import TestClient

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
    so_hd: str = "HD-PUR-01",
    mst: str = "0102030405",
) -> int:
    r = client.post(
        "/api/inv/purchase",
        json={
            "so_hd": so_hd,
            "mst_ban": mst,
            "ten_ban": "Nhà cung cấp vật tư công nghệ",
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


def _get_stock(
    client: TestClient, item_id: int, warehouse_id: int | None = None
) -> tuple[float, float]:
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
# Test Suite
# ===========================================================================

def test_adv_multi_stage_manufacturing_flow(client: TestClient):
    """
    Adversarially verify Stage 1 (BTP Lot L1) and Stage 2 (TP Lot L2 + Serials SN001..SN005).
    """
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    # Items
    raw_mcu = _mk_item(client, "RAW-MCU-01", "Chip MCU ESP32-S3", "Con")
    raw_pcb = _mk_item(client, "RAW-PCB-01", "Bo mạch 4 lớp FR4", "Miếng")
    raw_passives = _mk_item(client, "RAW-PAS-01", "Set linh kiện dán SMD 0603", "Bộ")
    btp_pcba = _mk_item(client, "BTP-PCBA-01", "Bán thành phẩm Bo Mạch SMT", "Bo")
    raw_enclosure = _mk_item(client, "RAW-ENC-01", "Vỏ nhôm Anode IP67", "Cái")
    tp_iot = _mk_item(client, "TP-IOT-GATEWAY", "iNut IoT Gateway Pro 2026", "Bộ")

    # Purchase raw materials on 2026-08-01
    _purchase(
        client,
        "2026-08-01",
        [
            (raw_mcu, wh_nvl, 100, 80_000),      # 8,000,000
            (raw_pcb, wh_nvl, 100, 30_000),      # 3,000,000
            (raw_passives, wh_nvl, 100, 10_000), # 1,000,000
            (raw_enclosure, wh_nvl, 50, 60_000), # 3,000,000
        ],
        so_hd="HD-RAW-001",
    )

    # -----------------------------------------------------------------------
    # Stage 1: Produce 20 units of BTP-PCBA with Lot L1 = "LOT-BTP-2026-L1"
    # Consumes 20 raw_mcu, 20 raw_pcb, 20 raw_passives
    # -----------------------------------------------------------------------
    lot_l1 = "LOT-BTP-2026-L1"
    r_stage1 = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-05",
            "note": "Công đoạn 1: Dán SMT và hàn reflow bo PCBA",
            "lot_number": lot_l1,
            "mfg_date": "2026-08-05",
            "exp_date": "2031-08-05",
            "lines": [
                {"chieu": "vao", "item_id": raw_mcu, "warehouse_id": wh_nvl, "so_luong": 20},
                {"chieu": "vao", "item_id": raw_pcb, "warehouse_id": wh_nvl, "so_luong": 20},
                {"chieu": "vao", "item_id": raw_passives, "warehouse_id": wh_nvl, "so_luong": 20},
                {"chieu": "ra", "item_id": btp_pcba, "warehouse_id": wh_nvl, "so_luong": 20, "lot_number": lot_l1},
            ],
        },
    )
    assert r_stage1.status_code == 200, f"Stage 1 creation failed: {r_stage1.text}"
    pid1 = r_stage1.json()["id"]

    r_stage1_post = client.post(f"/api/inv/productions/{pid1}/post")
    assert r_stage1_post.status_code == 200, f"Stage 1 post failed: {r_stage1_post.text}"
    st1_data = r_stage1_post.json()

    # Stage 1 Cost: 20 * (80k + 30k + 10k) = 20 * 120,000 = 2,400,000 VND -> Unit cost = 120,000 VND
    assert st1_data["tong_gia_thanh"] == 2_400_000
    assert st1_data["lot_number"] == lot_l1

    ton_btp, gt_btp = _get_stock(client, btp_pcba, wh_nvl)
    assert ton_btp == 20.0
    assert gt_btp == 2_400_000

    # -----------------------------------------------------------------------
    # Stage 2: Consume 5 units of BTP-PCBA (Lot L1) + 5 raw_enclosure + Labor (100k) + Overhead (50k)
    # Output: 5 units of TP-IOT-GATEWAY with Lot L2 = "LOT-TP-2026-L2" & Serials SN001..SN005
    # -----------------------------------------------------------------------
    lot_l2 = "LOT-TP-2026-L2"
    serials_l2 = [f"SN00{i}" for i in range(1, 6)]  # ['SN001', 'SN002', 'SN003', 'SN004', 'SN005']

    r_stage2 = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-10",
            "note": "Công đoạn 2: Lắp ráp vỏ nhôm, nạp firmware, kiểm định QA",
            "lot_number": lot_l2,
            "serial_numbers": json.dumps(serials_l2),
            "mfg_date": "2026-08-10",
            "exp_date": "2031-08-10",
            "cp_nhan_cong": 100_000,
            "cp_sxc": 50_000,
            "lines": [
                {"chieu": "vao", "item_id": btp_pcba, "warehouse_id": wh_nvl, "so_luong": 5, "lot_number": lot_l1},
                {"chieu": "vao", "item_id": raw_enclosure, "warehouse_id": wh_nvl, "so_luong": 5},
                {"chieu": "ra", "item_id": tp_iot, "warehouse_id": wh_tp, "so_luong": 5, "lot_number": lot_l2, "serial_numbers": json.dumps(serials_l2)},
            ],
        },
    )
    assert r_stage2.status_code == 200, f"Stage 2 creation failed: {r_stage2.text}"
    pid2 = r_stage2.json()["id"]

    r_stage2_post = client.post(f"/api/inv/productions/{pid2}/post")
    assert r_stage2_post.status_code == 200, f"Stage 2 post failed: {r_stage2_post.text}"
    st2_data = r_stage2_post.json()

    # Stage 2 Cost calculation:
    # Consumed BTP: 5 * 120,000 = 600,000
    # Consumed Enclosure: 5 * 60,000 = 300,000
    # Labor: 100,000
    # Overhead: 50,000
    # Total Stage 2 Cost = 600,000 + 300,000 + 100,000 + 50,000 = 1,050,000 VND
    # TP Unit Cost = 1,050,000 / 5 = 210,000 VND
    assert st2_data["tong_gia_thanh"] == 1_050_000
    assert st2_data["lot_number"] == lot_l2

    # Verify Stock balances
    ton_btp_after, gt_btp_after = _get_stock(client, btp_pcba, wh_nvl)
    ton_enc_after, gt_enc_after = _get_stock(client, raw_enclosure, wh_nvl)
    ton_tp_after, gt_tp_after = _get_stock(client, tp_iot, wh_tp)

    assert ton_btp_after == 15.0  # 20 - 5
    assert gt_btp_after == 15 * 120_000
    assert ton_enc_after == 45.0  # 50 - 5
    assert gt_enc_after == 45 * 60_000
    assert ton_tp_after == 5.0
    assert gt_tp_after == 1_050_000

    # -----------------------------------------------------------------------
    # Forward Traceability Verification:
    # Querying Lot L1 must resolve Stage 1 production and Stage 2 consumption (producing Lot L2)
    # -----------------------------------------------------------------------
    r_trace_l1 = client.get(f"/api/inv/traceability?batch_no={lot_l1}")
    assert r_trace_l1.status_code == 200, f"Traceability L1 query failed: {r_trace_l1.text}"
    records_l1 = r_trace_l1.json()["records"]

    # Both Stage 1 (output has L1) and Stage 2 (consumed input has L1) should match
    prod_ids_l1 = {rec["production_id"] for rec in records_l1}
    assert pid1 in prod_ids_l1, "Stage 1 production must be resolved when querying Lot L1"
    assert pid2 in prod_ids_l1, "Stage 2 consumption must be resolved when querying Lot L1"

    # In Stage 2 record, output item must be TP with Lot L2 and serials
    rec_stage2 = next(r for r in records_l1 if r["production_id"] == pid2)
    assert rec_stage2["lot_number"] == lot_l2
    assert rec_stage2["output_item"]["id"] == tp_iot
    assert any("SN001" in s for s in rec_stage2["serial_numbers"])

    # -----------------------------------------------------------------------
    # Backward Traceability Verification:
    # 1. Querying Lot L2 resolves Stage 2 order and consumed material with Lot L1
    # -----------------------------------------------------------------------
    r_trace_l2 = client.get(f"/api/inv/traceability?batch_no={lot_l2}")
    assert r_trace_l2.status_code == 200
    records_l2 = r_trace_l2.json()["records"]
    assert len(records_l2) >= 1
    rec_l2 = next(r for r in records_l2 if r["production_id"] == pid2)
    assert rec_l2["output_item"]["id"] == tp_iot
    consumed_l2 = {c["item_id"]: c for c in rec_l2["consumed_materials"]}
    assert btp_pcba in consumed_l2
    assert consumed_l2[btp_pcba]["lot_number"] == lot_l1

    # 2. Querying Serial "SN003" resolves Stage 2 order
    r_trace_sn = client.get("/api/inv/traceability?serial_no=SN003")
    assert r_trace_sn.status_code == 200
    records_sn = r_trace_sn.json()["records"]
    assert len(records_sn) >= 1
    assert records_sn[0]["production_id"] == pid2
    assert "SN003" in records_sn[0]["serial_numbers"]

    # 3. Querying by Raw Material Item ID resolves downstream production
    r_trace_mcu = client.get(f"/api/inv/traceability?item_id={raw_mcu}")
    assert r_trace_mcu.status_code == 200
    records_mcu = r_trace_mcu.json()["records"]
    assert any(r["production_id"] == pid1 for r in records_mcu)


def test_adv_backdated_cost_replay_across_multiple_stages(client: TestClient):
    """
    Stress test: Multi-stage cost rollup & retroactive cost replay.
    
    Setup:
      - 2026-08-01: Purchase 10 NVL-A @ 10,000 VND
      - 2026-08-05: Stage 1 produces 10 BTP from 10 NVL-A (BTP cost = 10,000 VND)
      - 2026-08-10: Stage 2 produces 5 Final TP from 5 BTP (TP cost = 10,000 VND)
      - 2026-08-15: Issue 2 Final TP to customer (Issue COGS = 20,000 VND)
      - 2026-08-03 (BACKDATED): Purchase 10 NVL-A @ 30,000 VND
        -> New NVL-A moving average before Stage 1: (10*10k + 10*30k)/20 = 20,000 VND!
    When:
      - Trigger /api/inv/recalc-cost
    Then:
      - Stage 1 BTP cost updates to 20,000 VND / unit (Total = 200,000 VND)
      - Stage 2 TP cost updates to 20,000 VND / unit (Total = 100,000 VND)
      - Final Stock of TP = 3 units @ 20,000 = 60,000 VND
      - Remaining BTP = 5 units @ 20,000 = 100,000 VND
      - Remaining NVL-A = 10 units @ 20,000 = 200,000 VND
    """
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    nvl_a = _mk_item(client, "REP-STAGE-NVL", "Nguyên liệu Replay Đa Cấp", "Kg")
    btp = _mk_item(client, "REP-STAGE-BTP", "Bán thành phẩm Replay Đa Cấp", "Kg")
    tp = _mk_item(client, "REP-STAGE-TP", "Thành phẩm Replay Đa Cấp", "Hộp")

    # Step 1: 2026-08-01: Buy 10 NVL-A @ 10,000
    _purchase(client, "2026-08-01", [(nvl_a, wh_nvl, 10, 10_000)], so_hd="HD-REP-1")

    # Step 2: 2026-08-05: Stage 1 produces 10 BTP from 10 NVL-A
    r_p1 = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-05",
            "lines": [
                {"chieu": "vao", "item_id": nvl_a, "warehouse_id": wh_nvl, "so_luong": 10},
                {"chieu": "ra", "item_id": btp, "warehouse_id": wh_nvl, "so_luong": 10},
            ],
        },
    )
    pid1 = r_p1.json()["id"]
    assert client.post(f"/api/inv/productions/{pid1}/post").status_code == 200

    # Step 3: 2026-08-10: Stage 2 produces 5 TP from 5 BTP
    r_p2 = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-10",
            "lines": [
                {"chieu": "vao", "item_id": btp, "warehouse_id": wh_nvl, "so_luong": 5},
                {"chieu": "ra", "item_id": tp, "warehouse_id": wh_tp, "so_luong": 5},
            ],
        },
    )
    pid2 = r_p2.json()["id"]
    assert client.post(f"/api/inv/productions/{pid2}/post").status_code == 200

    # Step 4: 2026-08-15: Issue 2 TP
    r_iss = client.post(
        "/api/inv/issues",
        json={
            "ngay": "2026-08-15",
            "lines": [{"item_id": tp, "warehouse_id": wh_tp, "so_luong": 2}],
        },
    )
    iid = r_iss.json()["id"]
    assert client.post(f"/api/inv/issues/{iid}/post").status_code == 200

    # Step 5: Backdated purchase on 2026-08-03: 10 NVL-A @ 30,000
    _purchase(client, "2026-08-03", [(nvl_a, wh_nvl, 10, 30_000)], so_hd="HD-REP-BACKDATE-2")

    # Step 6: Trigger full cost replay
    r_recalc = client.post("/api/inv/recalc-cost")
    assert r_recalc.status_code == 200

    # Check updated production order values
    p1_updated = client.get(f"/api/inv/productions/{pid1}").json()
    p2_updated = client.get(f"/api/inv/productions/{pid2}").json()

    assert p1_updated["tong_gia_thanh"] == 200_000  # 10 * 20k
    assert p2_updated["tong_gia_thanh"] == 100_000  # 5 * 20k

    # Check final stock values
    ton_nvl, gt_nvl = _get_stock(client, nvl_a, wh_nvl)
    ton_btp, gt_btp = _get_stock(client, btp, wh_nvl)
    ton_tp, gt_tp = _get_stock(client, tp, wh_tp)

    assert ton_nvl == 10.0
    assert gt_nvl == 200_000  # 10 * 20k
    assert ton_btp == 5.0
    assert gt_btp == 100_000  # 5 * 20k
    assert ton_tp == 3.0
    assert gt_tp == 60_000    # 3 * 20k


def test_adv_branching_and_partial_batch_consumption(client: TestClient):
    """
    Adversarial scenario:
      Stage 1 produces 100 units of BTP with Lot "LOT-BTP-SPLIT-01".
      Downstream branches into 2 separate product lines:
        - Stage 2A consumes 40 BTP -> Product A (Lot "LOT-PROD-A", Serials A01..A40)
        - Stage 2B consumes 60 BTP -> Product B (Lot "LOT-PROD-B", Serials B01..B60)
      Attempting a 3rd Stage 2C to consume 10 more BTP fails with 400 (stock exhausted).
    """
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm = _mk_item(client, "SPLIT-RM", "Nguyên liệu phân nhánh", "Cái")
    btp = _mk_item(client, "SPLIT-BTP", "BTP phân nhánh", "Cái")
    prod_a = _mk_item(client, "SPLIT-PROD-A", "Thành phẩm Dòng A", "Cái")
    prod_b = _mk_item(client, "SPLIT-PROD-B", "Thành phẩm Dòng B", "Cái")

    _purchase(client, "2026-08-01", [(rm, wh_nvl, 100, 10_000)], so_hd="HD-SPLIT-01")

    # Stage 1: Produce 100 BTP
    lot_btp = "LOT-BTP-SPLIT-01"
    r_p1 = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-05",
            "lot_number": lot_btp,
            "lines": [
                {"chieu": "vao", "item_id": rm, "warehouse_id": wh_nvl, "so_luong": 100},
                {"chieu": "ra", "item_id": btp, "warehouse_id": wh_nvl, "so_luong": 100},
            ],
        },
    )
    pid1 = r_p1.json()["id"]
    assert client.post(f"/api/inv/productions/{pid1}/post").status_code == 200

    # Stage 2A: Consume 40 BTP -> Product A
    lot_a = "LOT-PROD-A"
    serials_a = [f"SER-A-{i:03d}" for i in range(1, 41)]
    r_p2a = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-10",
            "lot_number": lot_a,
            "serial_numbers": json.dumps(serials_a),
            "lines": [
                {"chieu": "vao", "item_id": btp, "warehouse_id": wh_nvl, "so_luong": 40, "lot_number": lot_btp},
                {"chieu": "ra", "item_id": prod_a, "warehouse_id": wh_tp, "so_luong": 40},
            ],
        },
    )
    pid2a = r_p2a.json()["id"]
    assert client.post(f"/api/inv/productions/{pid2a}/post").status_code == 200

    # Stage 2B: Consume 60 BTP -> Product B
    lot_b = "LOT-PROD-B"
    serials_b = [f"SER-B-{i:03d}" for i in range(1, 61)]
    r_p2b = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-11",
            "lot_number": lot_b,
            "serial_numbers": json.dumps(serials_b),
            "lines": [
                {"chieu": "vao", "item_id": btp, "warehouse_id": wh_nvl, "so_luong": 60, "lot_number": lot_btp},
                {"chieu": "ra", "item_id": prod_b, "warehouse_id": wh_tp, "so_luong": 60},
            ],
        },
    )
    pid2b = r_p2b.json()["id"]
    assert client.post(f"/api/inv/productions/{pid2b}/post").status_code == 200

    # Remaining BTP is now exactly 0
    ton_btp, _ = _get_stock(client, btp, wh_nvl)
    assert ton_btp == 0.0

    # Stage 2C: Attempting to produce with 10 BTP fails with 400
    r_p2c = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-12",
            "lines": [
                {"chieu": "vao", "item_id": btp, "warehouse_id": wh_nvl, "so_luong": 10},
                {"chieu": "ra", "item_id": prod_a, "warehouse_id": wh_tp, "so_luong": 10},
            ],
        },
    )
    pid2c = r_p2c.json()["id"]
    r_post_2c = client.post(f"/api/inv/productions/{pid2c}/post")
    assert r_post_2c.status_code == 400, "Should reject posting when stock is 0"

    # Forward Traceability from LOT-BTP-SPLIT-01 returns both Stage 2A and Stage 2B!
    r_trace = client.get(f"/api/inv/traceability?batch_no={lot_btp}")
    assert r_trace.status_code == 200
    rec_ids = {r["production_id"] for r in r_trace.json()["records"]}
    assert pid1 in rec_ids
    assert pid2a in rec_ids
    assert pid2b in rec_ids


def test_adv_unpost_dependency_protection(client: TestClient):
    """
    Adversarial scenario:
      Stage 1 produces 10 BTP.
      Stage 2 consumes 10 BTP to produce 10 TP.
      If someone tries to unpost Stage 1, BTP stock would drop from 0 to -10 -> MUST BE BLOCKED!
      Once Stage 2 is unposted first, Stage 1 can be cleanly unposted.
    """
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm = _mk_item(client, "PROT-RM", "Vật tư bảo vệ", "Cái")
    btp = _mk_item(client, "PROT-BTP", "BTP bảo vệ", "Cái")
    tp = _mk_item(client, "PROT-TP", "TP bảo vệ", "Cái")

    _purchase(client, "2026-08-01", [(rm, wh_nvl, 10, 50_000)])

    # Stage 1: Produce 10 BTP
    r_p1 = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-05",
            "lines": [
                {"chieu": "vao", "item_id": rm, "warehouse_id": wh_nvl, "so_luong": 10},
                {"chieu": "ra", "item_id": btp, "warehouse_id": wh_nvl, "so_luong": 10},
            ],
        },
    )
    pid1 = r_p1.json()["id"]
    assert client.post(f"/api/inv/productions/{pid1}/post").status_code == 200

    # Stage 2: Consume 10 BTP -> Produce 10 TP
    r_p2 = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-10",
            "lines": [
                {"chieu": "vao", "item_id": btp, "warehouse_id": wh_nvl, "so_luong": 10},
                {"chieu": "ra", "item_id": tp, "warehouse_id": wh_tp, "so_luong": 10},
            ],
        },
    )
    pid2 = r_p2.json()["id"]
    assert client.post(f"/api/inv/productions/{pid2}/post").status_code == 200

    # Current BTP stock is 0. Attempting to unpost Stage 1 would cause BTP to become -10 -> BLOCKED!
    r_void_p1 = client.post(f"/api/inv/productions/{pid1}/void")
    assert r_void_p1.status_code == 400, "Unposting upstream stage that causes negative downstream stock must be blocked!"

    # Unpost Stage 2 first
    r_void_p2 = client.post(f"/api/inv/productions/{pid2}/void")
    assert r_void_p2.status_code == 200
    assert r_void_p2.json()["status"] == "draft"

    # Now BTP stock is back to 10. Unposting Stage 1 now succeeds!
    r_void_p1_retry = client.post(f"/api/inv/productions/{pid1}/void")
    assert r_void_p1_retry.status_code == 200
    assert r_void_p1_retry.json()["status"] == "draft"

    # Stock is back to initial purchase
    ton_rm, _ = _get_stock(client, rm, wh_nvl)
    ton_btp, _ = _get_stock(client, btp, wh_nvl)
    ton_tp, _ = _get_stock(client, tp, wh_tp)
    assert ton_rm == 10.0
    assert ton_btp == 0.0
    assert ton_tp == 0.0


def test_adv_traceability_search_edge_cases(client: TestClient):
    """
    Stress test search queries on /api/inv/traceability:
      - Non-existent lot / serial -> empty records list
      - Partial substring matching (e.g. '002' matches 'SN-002')
      - Case-insensitive search
      - Unicode and special symbols
      - Date range filtering
    """
    wh_nvl = _wh(client, "NVL")
    wh_tp = _wh(client, "TP")

    rm = _mk_item(client, "EDGE-RM", "Vật tư Edge Search", "Cái")
    tp = _mk_item(client, "EDGE-TP", "Thành phẩm Edge Search", "Cái")

    _purchase(client, "2026-08-01", [(rm, wh_nvl, 10, 100_000)])

    lot = "LÔ-SẢN-XUẤT/2026.ĐỢT-01"
    serials = ["INUT-GW-001", "INUT-GW-002"]

    r_p = client.post(
        "/api/inv/productions",
        json={
            "ngay": "2026-08-15",
            "lot_number": lot,
            "serial_numbers": json.dumps(serials),
            "lines": [
                {"chieu": "vao", "item_id": rm, "warehouse_id": wh_nvl, "so_luong": 2},
                {"chieu": "ra", "item_id": tp, "warehouse_id": wh_tp, "so_luong": 2},
            ],
        },
    )
    pid = r_p.json()["id"]
    assert client.post(f"/api/inv/productions/{pid}/post").status_code == 200

    # 1. Non-existent lot
    r1 = client.get("/api/inv/traceability?batch_no=NON_EXISTENT_LOT_999")
    assert r1.status_code == 200
    assert len(r1.json()["records"]) == 0

    # 2. Case-insensitive serial search
    r2 = client.get("/api/inv/traceability?serial_no=inut-gw-002")
    assert r2.status_code == 200
    assert len(r2.json()["records"]) == 1
    assert r2.json()["records"][0]["production_id"] == pid

    # 3. Unicode and special char lot search
    r3 = client.get(f"/api/inv/traceability?batch_no=SẢN-XUẤT")
    assert r3.status_code == 200
    assert len(r3.json()["records"]) == 1

    # 4. Date range filter
    r4_in = client.get("/api/inv/traceability?tu=2026-08-01&den=2026-08-20")
    assert r4_in.status_code == 200
    assert any(r["production_id"] == pid for r in r4_in.json()["records"])

    r4_out = client.get("/api/inv/traceability?tu=2026-08-20&den=2026-08-30")
    assert r4_out.status_code == 200
    assert not any(r["production_id"] == pid for r in r4_out.json()["records"])
