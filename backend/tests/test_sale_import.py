"""Test import hoa don BAN RA (iNut ban): parse XML, phan loai dong, chan trung, HD dieu chinh."""
from __future__ import annotations

import pytest

pytest.importorskip("fastapi")

from fastapi.testclient import TestClient  # noqa: E402


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


def _hdon_xml(so_hd: str, ngay: str, lines: list[dict], tchdon: str = "", mst_ban: str = "4401053694") -> bytes:
    hh = ""
    for i, ln in enumerate(lines, start=1):
        hh += (
            f"<HHDVu><STT>{i}</STT><THHDVu>{ln['ten']}</THHDVu>"
            f"<DVTinh>{ln.get('dvt', 'Cai')}</DVTinh><SLuong>{ln.get('sl', 1)}</SLuong>"
            f"<DGia>{ln.get('dg', 1000)}</DGia><ThTien>{ln.get('tt', 1000)}</ThTien>"
            f"<TSuat>{ln.get('ts', '8%')}</TSuat></HHDVu>"
        )
    tchdon_tag = f"<TCHDon>{tchdon}</TCHDon>" if tchdon else ""
    return (
        f"<HDon><DLHDon><TTChung><KHHDon>C26TPK</KHHDon><SHDon>{so_hd}</SHDon>"
        f"<NLap>{ngay}</NLap>{tchdon_tag}</TTChung>"
        f"<NDHDon><NBan><Ten>CONG TY INUT</Ten><MST>{mst_ban}</MST></NBan>"
        f"<NMua><Ten>KHACH HANG ABC</Ten><MST>0100108945</MST></NMua>"
        f"<DSHHDVu>{hh}</DSHHDVu>"
        f"<TToan><TgTCThue>1000</TgTCThue><TgTThue>80</TgTThue><TgTTTBSo>1080</TgTTTBSo></TToan>"
        f"</NDHDon></DLHDon></HDon>"
    ).encode("utf-8")


def _upload(client: TestClient, name: str, content: bytes) -> dict:
    r = client.post("/api/inv/sale/upload", files=[("files", (name, content, "application/xml"))])
    assert r.status_code == 200, r.text
    return r.json()


def test_classify_and_import(client):
    xml = _hdon_xml("1", "2026-01-19", [
        {"ten": "iNut Muro v2 - giam sat nha nam", "dvt": "Bo", "ts": "8%"},
        {"ten": "iNut Manager Prime v2: License Phan mem", "dvt": "Goi", "ts": "KCT"},
        {"ten": "Camera quan sat DH-H3AE", "dvt": "Cai", "ts": "8%"},
    ])
    res = _upload(client, "ihoadon_4401053694_1_1_19012026_0.xml", xml)
    assert res["results"][0]["ok"], res
    sid = res["results"][0]["sale_id"]

    inv = client.get(f"/api/inv/sale/{sid}").json()
    assert inv["so_hd"] == "1"
    assert inv["ngay"] == "2026-01-19"
    assert inv["is_dieu_chinh"] is False
    # iNut hardware -> inut/sx; License -> phan_mem/doanh_thu; Camera -> camera
    assert any(ln["ten_raw"].startswith("iNut Muro") and ln["line_class"] == "inut" for ln in inv["lines"])
    assert any(ln["line_class"] == "phan_mem" and ln["fulfil_kind"] == "doanh_thu" for ln in inv["lines"])
    assert any(ln["line_class"] == "camera" for ln in inv["lines"])
    # dong KCT phai co thue_kct=True
    assert any(ln["thue_kct"] for ln in inv["lines"])


def test_dieu_chinh_skipped(client):
    xml = _hdon_xml("3", "2026-02-11", [
        {"ten": "Dieu chinh ten hang cua hoa don so 22", "sl": 0, "dg": 0, "tt": 0, "ts": ""},
    ], tchdon="2")
    res = _upload(client, "ihoadon_4401053694_3_1_11022026_3.xml", xml)
    sid = res["results"][0]["sale_id"]
    inv = client.get(f"/api/inv/sale/{sid}").json()
    assert inv["is_dieu_chinh"] is True
    # dong cua HD dieu chinh khong duoc phan loai vao kho
    assert all(ln["fulfil_kind"] == "none" for ln in inv["lines"])
    assert "điều chỉnh" in inv["lines"][0]["de_xuat"].lower()


def test_dup_guard(client):
    xml = _hdon_xml("5", "2026-03-01", [{"ten": "Camera X", "ts": "8%"}])
    name = "ihoadon_4401053694_5_1_01032026_0.xml"
    _upload(client, name, xml)
    res2 = _upload(client, name, xml)  # import lai -> phai bao trung
    sid2 = res2["results"][0]["sale_id"]
    inv2 = client.get(f"/api/inv/sale/{sid2}").json()
    assert inv2["dup_of"] is not None
    assert any(w.get("code") == "trung_hd" for w in inv2["warnings"])


def test_generate_requires_reviewed(client):
    xml = _hdon_xml("11", "2026-03-10", [{"ten": "Camera Z", "ts": "8%"}])
    res = _upload(client, "ihoadon_4401053694_11_1_10032026_0.xml", xml)
    sid = res["results"][0]["sale_id"]
    # chua duyet -> 400
    r = client.post(f"/api/inv/sale/{sid}/generate")
    assert r.status_code == 400
    assert "duyệt" in r.json()["detail"].lower()


def test_generate_warns_missing_recipe(client):
    # tao mat hang iNut de dong ban khop exact (co item_id) nhung khong co ton/cong thuc
    it = client.post("/api/inv/items", json={"ma_hang": "TP001", "ten": "iNut Muro v2 giam sat", "dvt": "Bo"})
    assert it.status_code == 200, it.text

    xml = _hdon_xml("12", "2026-03-11", [{"ten": "iNut Muro v2 giam sat", "dvt": "Bo", "ts": "8%"}])
    res = _upload(client, "ihoadon_4401053694_12_1_11032026_0.xml", xml)
    sid = res["results"][0]["sale_id"]
    inv = client.get(f"/api/inv/sale/{sid}").json()
    ln = inv["lines"][0]
    assert ln["line_class"] == "inut"
    assert ln["item_id"] is not None  # khop exact

    client.patch(f"/api/inv/sale/{sid}", json={"status": "reviewed"})
    r = client.post(f"/api/inv/sale/{sid}/generate")
    assert r.status_code == 200, r.text
    body = r.json()
    # khong co cong thuc -> khong tao lenh SX, co canh bao
    assert body["productions"] == []
    assert any("công thức" in w for w in body["warnings"])


def test_bo_lap_dat_assemble(client):
    c1 = client.post("/api/inv/items", json={"ma_hang": "HH100", "ten": "Camera DH-H3AE", "dvt": "Cai"}).json()
    c2 = client.post("/api/inv/items", json={"ma_hang": "HH101", "ten": "Dau ghi NVR 8 kenh", "dvt": "Cai"}).json()
    whs = client.get("/api/inv/warehouses").json()
    hh = next(w["id"] for w in whs if w["code"] == "HH")
    tp = next(w["id"] for w in whs if w["code"] == "TP")

    xml = _hdon_xml("20", "2026-04-01", [
        {"ten": "Bo thiet bi camera giam sat lap dat tai Hop Co Billiards Ha Noi", "dvt": "Bo", "dg": 25840000, "tt": 25840000, "ts": "8%"},
    ])
    res = _upload(client, "ihoadon_4401053694_20_1_01042026_0.xml", xml)
    sid = res["results"][0]["sale_id"]
    inv = client.get(f"/api/inv/sale/{sid}").json()
    ln = inv["lines"][0]
    assert ln["line_class"] == "bo"  # nhan dien bo lap dat -> ghep bo

    client.patch(f"/api/inv/sale/{sid}", json={"status": "reviewed"})
    r = client.post(
        f"/api/inv/sale/{sid}/assemble/{ln['id']}",
        json={
            "output_ma_hang": "TP900", "output_warehouse_id": tp,
            "components": [
                {"item_id": c1["id"], "warehouse_id": hh, "so_luong": 4, "note": "4 mắt"},
                {"item_id": c2["id"], "warehouse_id": hh, "so_luong": 1},
            ],
            "save_recipe": True, "recipe_name": "Bo camera 4 mat",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["production_id"] and body["recipe_id"]
    # linh kien chua tung nhap kho -> phai canh bao thoi gian (kha dung = 0 tai ngay HD)
    assert body["warnings"] and any("thiếu tại ngày" in w for w in body["warnings"])
    prods = client.get("/api/inv/productions").json()
    p = next(x for x in prods if x["id"] == body["production_id"])
    assert "Ghép bộ cho HĐ bán" in p["note"]
    assert sum(1 for l in p["lines"] if l["chieu"] == "vao") == 2
    recs = client.get("/api/inv/recipes").json()
    assert any(rr["id"] == body["recipe_id"] for rr in recs)


def test_assemble_existing_tp_item(client):
    """iNut TP0022 da khop mat hang -> dung output_item_id, KHONG tao ma moi;
    cong thuc luu gan dung mat hang do (de generate lan sau tu ap)."""
    tp_item = client.post("/api/inv/items", json={"ma_hang": "TP0022", "ten": "iNut Muro v2", "dvt": "Bo"}).json()
    comp = client.post("/api/inv/items", json={"ma_hang": "HH500", "ten": "Camera dung che iNut", "dvt": "Cai"}).json()
    whs = client.get("/api/inv/warehouses").json()
    hh = next(w["id"] for w in whs if w["code"] == "HH")
    tp = next(w["id"] for w in whs if w["code"] == "TP")

    xml = _hdon_xml("21", "2026-04-05", [{"ten": "iNut Muro v2", "dvt": "Bo", "dg": 2950000, "tt": 2950000, "ts": "8%"}])
    res = _upload(client, "ihoadon_4401053694_21_1_05042026_0.xml", xml)
    sid = res["results"][0]["sale_id"]
    ln = client.get(f"/api/inv/sale/{sid}").json()["lines"][0]
    assert ln["item_id"] == tp_item["id"]  # khop exact voi TP0022

    client.patch(f"/api/inv/sale/{sid}", json={"status": "reviewed"})
    items_before = len(client.get("/api/inv/items").json())
    r = client.post(
        f"/api/inv/sale/{sid}/assemble/{ln['id']}",
        json={
            "output_item_id": tp_item["id"], "output_warehouse_id": tp,
            "components": [{"item_id": comp["id"], "warehouse_id": hh, "so_luong": 2}],
            "save_recipe": True, "recipe_name": "iNut Muro v2 tu camera",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["output_item_id"] == tp_item["id"]  # dung mat hang cu, khong tao moi
    assert len(client.get("/api/inv/items").json()) == items_before  # khong sinh them mat hang
    recs = client.get("/api/inv/recipes").json()
    rec = next(rr for rr in recs if rr["id"] == body["recipe_id"])
    assert rec["output_item_id"] == tp_item["id"]  # cong thuc gan dung TP0022 -> generate lan sau tu ap


def test_ai_only_gets_items_with_stock(client, monkeypatch):
    """stock_items gui cho AI chi duoc chua ma CON TON (SL>0) — khong duoc goi y
    dung ma da het hang (tranh AI 'goi y thua' vao mat hang khong con)."""
    has_stock = client.post("/api/inv/items", json={"ma_hang": "HH300", "ten": "Camera con hang", "dvt": "Cai"}).json()
    no_stock = client.post("/api/inv/items", json={"ma_hang": "HH301", "ten": "Camera het hang", "dvt": "Cai"}).json()
    whs = client.get("/api/inv/warehouses").json()
    hh = next(w["id"] for w in whs if w["code"] == "HH")

    p = client.post("/api/inv/purchase", json={
        "so_hd": "P1", "ky_hieu": "K1", "mst_ban": "0000000001", "ten_ban": "NCC test", "ngay": "2026-01-01",
        "lines": [{"ten_raw": "Camera con hang", "dvt": "Cai", "so_luong": 5, "don_gia": 100000,
                   "item_id": has_stock["id"], "warehouse_id": hh, "match_kind": "manual"}],
    }).json()
    assert client.post(f"/api/inv/purchase/{p['id']}/post").status_code == 200

    xml = _hdon_xml("30", "2026-04-10", [{"ten": "Bo thiet bi lap dat test AI stock filter", "dvt": "Bo", "ts": "8%"}])
    res = _upload(client, "ihoadon_4401053694_30_1_10042026_0.xml", xml)
    sid = res["results"][0]["sale_id"]
    client.patch(f"/api/inv/sale/{sid}", json={"status": "reviewed"})
    ln = client.get(f"/api/inv/sale/{sid}").json()["lines"][0]

    captured = {}

    def fake_suggest_bom(settings, ten_bo, gia_ban, stock_items, context="", existing=None):
        captured["stock_items"] = stock_items
        captured["existing"] = existing
        return {"components": [], "cost_est": 0, "margin_est": 0, "note": ""}

    from app import ai as ai_module

    monkeypatch.setattr(ai_module, "suggest_bom", fake_suggest_bom)
    # "AI goi y THEM": gui kem cac dong da chon -> phai duoc chuyen tiep xuong ai.suggest_bom
    r = client.post(
        f"/api/inv/sale/{sid}/suggest-bom/{ln['id']}",
        json={"existing": [{"ten": "Đầu ghi hình DH-XVR1B08", "so_luong": 1, "dvt": "Cái"}]},
    )
    assert captured["existing"] == [{"ten": "Đầu ghi hình DH-XVR1B08", "so_luong": 1.0, "dvt": "Cái"}]
    assert r.status_code == 200, r.text
    names = {i["ma_hang"] for i in captured["stock_items"]}
    assert has_stock["ma_hang"] in names
    assert no_stock["ma_hang"] not in names


def test_item_cost_endpoint(client):
    it = client.post("/api/inv/items", json={"ma_hang": "HH200", "ten": "Switch PoE 8 cong", "dvt": "Cai"}).json()
    r = client.get(f"/api/inv/items/{it['id']}/cost")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dvt"] == "Cai"
    assert body["don_gia_bq"] == 0  # chua nhap kho lan nao
    assert body["thue_suat_est"] == 8.0  # mac dinh khi chua co lich su mua


def test_seller_not_inut_warns(client):
    xml = _hdon_xml("9", "2026-03-05", [{"ten": "Camera Y", "ts": "8%"}], mst_ban="0999999999")
    res = _upload(client, "ihoadon_0999999999_9_1_05032026_0.xml", xml)
    sid = res["results"][0]["sale_id"]
    inv = client.get(f"/api/inv/sale/{sid}").json()
    assert any(w.get("code") == "khong_phai_inut" for w in inv["warnings"])


def test_lech_dong_blocks_review(client):
    """SL x don gia lech thanh_tien -> khong cho danh dau da duyet (chan cung, giong loi
    HH100... parse PDF nhet don gia vao thanh tien ben mua). Sua dung roi moi duyet duoc."""
    xml = _hdon_xml("40", "2026-05-01", [
        {"ten": "Camera lech gia", "dvt": "Cai", "sl": 2, "dg": 100000, "tt": 100000, "ts": "8%"},
    ])
    res = _upload(client, "ihoadon_4401053694_40_1_01052026_0.xml", xml)
    sid = res["results"][0]["sale_id"]

    inv = client.get(f"/api/inv/sale/{sid}").json()
    ln = inv["lines"][0]
    assert ln["lech_dong"] is True  # 2 x 100.000 = 200.000 != 100.000 da ghi

    r = client.patch(f"/api/inv/sale/{sid}", json={"status": "reviewed"})
    assert r.status_code == 400
    assert "lệch thành tiền" in r.json()["detail"]
    assert client.get(f"/api/inv/sale/{sid}").json()["status"] == "draft"  # van con draft

    # Sua dung SL x don gia = thanh tien roi duyet lai -> phai qua
    r2 = client.patch(
        f"/api/inv/sale/{sid}",
        json={
            "status": "reviewed",
            "lines": [{**ln, "thanh_tien": 200000}],
        },
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["status"] == "reviewed"
