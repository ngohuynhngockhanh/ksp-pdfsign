"""Test to khai nhap khau: parse Excel VNACCS 7N + PDF giay nop tien/MT103 + ghi so."""
from __future__ import annotations

from pathlib import Path

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("openpyxl")

from fastapi.testclient import TestClient  # noqa: E402

from app import customs  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures" / "customs"


@pytest.fixture
def client(tmp_path, monkeypatch):
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
    assert r.status_code == 200
    return c


def _wh(client, code):
    r = client.get("/api/inv/warehouses")
    return {w["code"]: w["id"] for w in r.json()}[code]


# ---------------------------------------------------------------------------
# 1) parse_customs_xlsx — tren file that
# ---------------------------------------------------------------------------
def test_parse_customs_xlsx_tk1():
    data = (FIXTURES / "ToKhaiHQ7N_108286660050.xlsx").read_bytes()
    r = customs.parse_customs_xlsx(data)
    assert r["so_to_khai"] == "108286660050"
    assert r["ma_loai_hinh"] == "A12"
    assert r["phan_luong"] == "3"
    assert r["incoterm"] == "DAP"
    assert r["nguyen_te"] == "USD"
    assert r["tri_gia_nt"] == 1530
    assert r["phi_ship_nt"] == 50
    assert r["ti_gia"] == 26161
    assert r["tri_gia_tinh_thue"] == 41334380
    assert abs(r["tong_thue_vat"] - 3306750) < 1
    assert len(r["lines"]) == 1
    ln = r["lines"][0]
    assert ln["ma_hs"] == "84733010"
    assert ln["so_luong"] == 100
    assert ln["dvt"] == "PCE"
    assert ln["tri_gia_tinh_thue"] == 41334380
    assert ln["thue_suat_nk"] == 0


def test_parse_customs_xlsx_tk2():
    data = (FIXTURES / "ToKhaiHQ7N_108328404660_vang.xlsx").read_bytes()
    r = customs.parse_customs_xlsx(data)
    assert r["so_to_khai"] == "108328404660"
    assert r["ma_loai_hinh"] == "A11"
    assert r["phan_luong"] == "2"
    assert r["tri_gia_tinh_thue"] == 24136728
    assert len(r["lines"]) == 1
    assert r["lines"][0]["ma_hs"] == "90271000"
    assert r["lines"][0]["so_luong"] == 1


# ---------------------------------------------------------------------------
# 2) parse_giay_nop_tien
# ---------------------------------------------------------------------------
def test_parse_giay_nop_tien_le_phi():
    data = (FIXTURES / "giay_nop_tien_tk2_phi.pdf").read_bytes()
    r = customs.parse_giay_nop_tien(data)
    assert "108328404660"[:11] == r["so_to_khai_prefix"]
    assert len(r["khoan_nop"]) == 1
    assert r["khoan_nop"][0]["phan_loai"] == "le_phi"
    assert r["khoan_nop"][0]["so_tien"] == 20000


def test_parse_giay_nop_tien_vat():
    data = (FIXTURES / "giay_nop_tien_tk2_vat.pdf").read_bytes()
    r = customs.parse_giay_nop_tien(data)
    assert "108328404660"[:11] == r["so_to_khai_prefix"]
    assert len(r["khoan_nop"]) == 1
    assert r["khoan_nop"][0]["phan_loai"] == "vat"
    assert abs(r["khoan_nop"][0]["so_tien"] - 1930938) < 1


# ---------------------------------------------------------------------------
# 3) parse_mt103
# ---------------------------------------------------------------------------
def test_parse_mt103():
    data = (FIXTURES / "mt103.pdf").read_bytes()
    r = customs.parse_mt103(data)
    assert r["nguyen_te"] == "USD"
    assert r["so_tien_nt"] == 924.0
    assert r["ngay"] == "2026-05-27"


# ---------------------------------------------------------------------------
# 4) E2E: upload -> khop mat hang -> ghi so -> them chi phi -> huy ghi so
# ---------------------------------------------------------------------------
def test_customs_e2e_post_with_cost_and_void(client):
    content = (FIXTURES / "ToKhaiHQ7N_108286660050.xlsx").read_bytes()
    r = client.post(
        "/api/inv/customs/upload",
        files=[("files", ("ToKhaiHQ7N_108286660050.xlsx", content,
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))],
    )
    assert r.status_code == 200, r.text
    res = r.json()["results"][0]
    assert res["ok"] is True
    cid = res["customs_id"]

    r = client.get(f"/api/inv/customs/{cid}")
    assert r.status_code == 200, r.text
    decl = r.json()
    assert decl["status"] == "draft"
    assert decl["so_to_khai"] == "108286660050"
    assert len(decl["lines"]) == 1
    line = decl["lines"][0]
    nvl_id = _wh(client, "NVL")
    assert line["warehouse_id"] == nvl_id  # A12 -> kho NVL mac dinh
    assert line["item_id"] is None  # mat hang moi, chua co trong danh muc

    # Tao mat hang + gan vao dong qua PATCH
    r = client.post("/api/inv/items", json={
        "ma_hang": "PCBA-01", "ten": "Mạch điện tử PCBA RK3518", "dvt": "PCE",
    })
    assert r.status_code == 200, r.text
    item_id = r.json()["id"]

    r = client.patch(f"/api/inv/customs/{cid}", json={
        "lines": [{"id": line["id"], "item_id": item_id}],
    })
    assert r.status_code == 200, r.text
    assert r.json()["lines"][0]["item_id"] == item_id
    assert r.json()["lines"][0]["match_kind"] == "manual"

    # Ghi so — chua co chi phi -> gia von = tri_gia_tinh_thue
    r = client.post(f"/api/inv/customs/{cid}/post")
    assert r.status_code == 200, r.text
    decl = r.json()
    assert decl["status"] == "posted"
    assert decl["lines"][0]["gia_von"] == 41334380

    stock = client.get("/api/inv/stock").json()
    row = [x for x in stock["rows"] if x["item_id"] == item_id][0]
    assert row["ton"] == 100
    assert row["gia_tri"] == 41334380

    # Huy ghi so -> ve draft, ton ve 0
    r = client.post(f"/api/inv/customs/{cid}/void")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "draft"
    stock = client.get("/api/inv/stock").json()
    assert not [x for x in stock["rows"] if x["item_id"] == item_id and x["ton"] != 0]

    # Them chi phi 500k (khong file) qua PATCH -> ghi so lai -> gia von cong them
    r = client.patch(f"/api/inv/customs/{cid}", json={
        "costs": [{"loai": "le_phi_hq", "ten": "Phí hải quan", "so_tien": 500000}],
    })
    assert r.status_code == 200, r.text
    assert r.json()["tong_costs"] == 500000

    r = client.post(f"/api/inv/customs/{cid}/post")
    assert r.status_code == 200, r.text
    decl = r.json()
    assert decl["lines"][0]["gia_von"] == 41334380 + 500000

    stock = client.get("/api/inv/stock").json()
    row = [x for x in stock["rows"] if x["item_id"] == item_id][0]
    assert row["ton"] == 100
    assert row["gia_tri"] == 41834380

    # Huy ghi so lan nua -> tồn về 0
    r = client.post(f"/api/inv/customs/{cid}/void")
    assert r.status_code == 200, r.text
    stock = client.get("/api/inv/stock").json()
    assert not [x for x in stock["rows"] if x["item_id"] == item_id and x["ton"] != 0]


def test_customs_upload_duplicate_so_to_khai_blocked(client):
    content = (FIXTURES / "ToKhaiHQ7N_108286660050.xlsx").read_bytes()
    r = client.post(
        "/api/inv/customs/upload",
        files=[("files", ("a.xlsx", content,
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))],
    )
    assert r.json()["results"][0]["ok"] is True

    r = client.post(
        "/api/inv/customs/upload",
        files=[("files", ("b.xlsx", content,
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))],
    )
    res = r.json()["results"][0]
    assert res["ok"] is False
    assert "108286660050" in res["error"]


def test_customs_attach_giay_nop_tien(client):
    """Dinh kem giay nop tien -> tu tao cost le phi, khong tao cost cho khoan VAT."""
    xlsx = (FIXTURES / "ToKhaiHQ7N_108328404660_vang.xlsx").read_bytes()
    r = client.post(
        "/api/inv/customs/upload",
        files=[("files", ("tk2.xlsx", xlsx,
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))],
    )
    cid = r.json()["results"][0]["customs_id"]

    phi_pdf = (FIXTURES / "giay_nop_tien_tk2_phi.pdf").read_bytes()
    r = client.post(
        f"/api/inv/customs/{cid}/attach",
        files=[("file", ("giay_nop_tien_tk2_phi.pdf", phi_pdf, "application/pdf"))],
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["parse_info"]["kind"] == "giay_nop_tien"
    assert len(body["decl"]["costs"]) == 1
    assert body["decl"]["costs"][0]["so_tien"] == 20000

    vat_pdf = (FIXTURES / "giay_nop_tien_tk2_vat.pdf").read_bytes()
    r = client.post(
        f"/api/inv/customs/{cid}/attach",
        files=[("file", ("giay_nop_tien_tk2_vat.pdf", vat_pdf, "application/pdf"))],
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # Khoan VAT khong tao cost moi (van chi 1 cost cua le phi) — chi bao da nop
    assert len(body["decl"]["costs"]) == 1
    assert len(body["parse_info"]["vat_paid"]) == 1


def test_customs_attach_mismatched_so_to_khai_rejected(client):
    xlsx = (FIXTURES / "ToKhaiHQ7N_108286660050.xlsx").read_bytes()
    r = client.post(
        "/api/inv/customs/upload",
        files=[("files", ("tk1.xlsx", xlsx,
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))],
    )
    cid = r.json()["results"][0]["customs_id"]

    # Giay nop tien nay la cua to khai khac (tk2) -> phai bi tu choi
    phi_pdf = (FIXTURES / "giay_nop_tien_tk2_phi.pdf").read_bytes()
    r = client.post(
        f"/api/inv/customs/{cid}/attach",
        files=[("file", ("giay_nop_tien_tk2_phi.pdf", phi_pdf, "application/pdf"))],
    )
    assert r.status_code == 400


def test_customs_attach_mt103(client):
    xlsx = (FIXTURES / "ToKhaiHQ7N_108328404660_vang.xlsx").read_bytes()
    r = client.post(
        "/api/inv/customs/upload",
        files=[("files", ("tk2.xlsx", xlsx,
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))],
    )
    cid = r.json()["results"][0]["customs_id"]

    mt103 = (FIXTURES / "mt103.pdf").read_bytes()
    r = client.post(
        f"/api/inv/customs/{cid}/attach",
        files=[("file", ("mt103.pdf", mt103, "application/pdf"))],
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["parse_info"]["kind"] == "mt103"
    assert body["parse_info"]["mt103"]["so_tien_nt"] == 924.0
    costs = body["decl"]["costs"]
    assert len(costs) == 1
    assert costs[0]["loai"] == "phi_ngan_hang"
    assert costs[0]["so_tien"] == 0
