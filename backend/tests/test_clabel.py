"""Unit tests cho module Clabel CT221B BLE printing (backend/app/clabel.py & clabel_api.py)."""
from __future__ import annotations

import base64
import io

from PIL import Image

from app import clabel


def test_normalize_paper_size_400x300_and_40x30():
    # 400x300 (don vi 0.1mm) -> 40mm x 30mm -> 320x240 dots @ 203dpi
    assert clabel.normalize_paper_size(400, 300) == (40, 30, 320, 240)
    # 40x30 (don vi mm) -> 40mm x 30mm -> 320x240 dots @ 203dpi
    assert clabel.normalize_paper_size(40, 30) == (40, 30, 320, 240)


def test_crc8_and_ttlv4_frame():
    frame = clabel.build_ttlv4_frame(0x05, 0x07, b"\x01")
    # 0xdd, mark=0x00, main=0x05, sub=0x07, len=0x0001, payload=0x01, crc8, 0xdd
    assert frame[0] == 0xDD
    assert frame[-1] == 0xDD
    assert frame[1:6] == b"\x00\x05\x07\x00\x01"
    assert frame[6] == 0x01
    assert frame[7] == clabel.crc8_poly07(frame[1:7])


def test_render_inut_label_and_tspl_builder():
    img = clabel.render_inut_label(
        title="iNut JSC",
        subtitle="IoT & Edge Computing",
        lines=["Gateway: 77.88.207.23", "Printer: CT221B-X420"],
        badge="INUT-BLE GATEWAY READY",
        qr_data="https://inut.vn",
        width=400,
        height=300,
    )
    assert img.size == (320, 240)
    assert img.mode == "1"

    # Kiem tra co ca pixel den (0) va pixel trang (255/1)
    extrema = img.getextrema()
    assert extrema[0] == 0
    assert extrema[1] > 0

    tspl = clabel.build_label_tspl(img, width=400, height=300, copies=1, density=8, speed=3)
    assert b"SIZE 40 mm,30 mm\r\n" in tspl
    assert b"GAP 2 mm,0 mm\r\n" in tspl
    assert b"DENSITY 8\r\n" in tspl
    assert b"SPEED 3\r\n" in tspl
    assert b"CLS\r\n" in tspl
    assert b"BITMAP 0,0,40,240,1," in tspl
    assert tspl.endswith(b"PRINT 1,1\r\n")
    # 40 bytes/row * 240 rows = 9600 bytes bitmap + header/footer
    assert len(tspl) > 9650


def test_render_elements_canvas_with_barcode_and_shapes():
    elements = [
        {"type": "logo", "x": 10, "y": 10, "size": 80},
        {"type": "text", "x": 100, "y": 14, "text": "Test Clabel", "font_size": 18, "bold": True},
        {"type": "badge", "x": 10, "y": 100, "width": 160, "height": 26, "text": "BADGE"},
        {"type": "barcode", "x": 10, "y": 136, "width": 180, "height": 50, "code": "INUT20723"},
        {"type": "qrcode", "x": 210, "y": 110, "size": 88, "data": "https://inut.vn"},
        {"type": "box", "x": 200, "y": 10, "width": 100, "height": 80, "radius": 6},
    ]
    canvas = clabel.render_elements_canvas(elements, width=400, height=300, border=True)
    assert canvas.size == (320, 240)
    assert canvas.mode == "1"


def test_tspl_native_commands():
    b = clabel.ClabelTSPLBuilder(width=400, height=300, memory_print=True)
    b.text(16, 16, "HELLO", font="TSS24.BF2")
    b.bar(10, 50, 200, 4)
    b.box(5, 5, 315, 235, thickness=2, radius=6)
    b.barcode(20, 80, "12345678", barcode_type="128", height=40)
    b.qrcode(220, 80, "https://inut.vn", ecc="M", cell_width=4)
    b.reverse(10, 10, 100, 30)
    raw = b.build(sets=1, copies=2)
    assert raw.startswith(b"\xdd\x00\x05\x07\x00\x01\x01")
    assert b'TEXT 16,16,"TSS24.BF2",0,1,1,"HELLO"\r\n' in raw
    assert b"BAR 10,50,200,4\r\n" in raw
    assert b"BOX 5,5,315,235,2,6\r\n" in raw
    assert b'BARCODE 20,80,"128",40,1,0,2,2,"12345678"\r\n' in raw
    assert b'QRCODE 220,80,M,4,A,0,"https://inut.vn"\r\n' in raw
    assert raw.endswith(b"PRINT 1,2\r\n")


def test_clabel_api_endpoints():
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)

    # 1. GET /api/clabel/preview
    r_prev = client.get("/api/clabel/preview", params={"title": "iNut JSC", "subtitle": "BLE Endpoint"})
    assert r_prev.status_code == 200
    assert r_prev.headers["content-type"] == "image/png"
    im = Image.open(io.BytesIO(r_prev.content))
    assert im.size == (320, 240)

    # 2. POST /api/clabel/print (dry-run via print_remote=False)
    r_print = client.post(
        "/api/clabel/print",
        json={
            "title": "iNut JSC",
            "subtitle": "IoT & Edge Computing",
            "lines": ["Gateway: 77.88.207.23", "Printer: CT221B-X420"],
            "badge": "INUT-BLE GATEWAY READY",
            "qr_data": "https://inut.vn",
            "width": 400,
            "height": 300,
            "print_remote": False,
        },
    )
    assert r_print.status_code == 200
    body = r_print.json()
    assert body["width_mm"] == 40
    assert body["height_mm"] == 30
    assert body["width_dots"] == 320
    assert body["height_dots"] == 240
    assert body["tspl_bytes_len"] > 9650
    assert body["is_printed"] is False
    assert len(base64.b64decode(body["preview_png_base64"])) > 500

    # 3. POST /api/clabel/print-image (multipart upload, dry-run)
    buf = io.BytesIO()
    Image.new("RGB", (100, 100), (0, 0, 0)).save(buf, format="PNG")
    buf.seek(0)
    r_up = client.post(
        "/api/clabel/print-image",
        files={"file": ("test.png", buf.getvalue(), "image/png")},
        data={"width": "400", "height": "300", "print_remote": "false"},
    )
    assert r_up.status_code == 200
    assert r_up.json()["width_dots"] == 320
