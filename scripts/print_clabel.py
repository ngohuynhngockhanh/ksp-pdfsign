#!/usr/bin/env python3
"""CLI in tem nhan nhiet sang may in Clabel CT221B-X420 qua BLE Gateway (root@77.88.207.23).

Su dung:
    # 1. In tem chuan iNut (Logo iNut + Text + QR Code tren kho giay 400x300 / 40x30mm):
    ./scripts/print_clabel.py \
        --title "iNut JSC" \
        --subtitle "IoT & Edge Computing" \
        --line "Gateway: 77.88.207.23" \
        --line "Printer: CT221B-X420" \
        --line "Size: 400x300 (320x240px)" \
        --badge "INUT-BLE GATEWAY READY" \
        --qr "https://inut.vn"

    # 2. In file anh bat ky (PNG/JPG) hoac DSL JSON tuy chinh:
    ./scripts/print_clabel.py --image backend/app/assets/logo.png
    ./scripts/print_clabel.py --elements-json '[{"type":"logo","x":10,"y":10,"size":100},{"type":"text","x":120,"y":20,"text":"Hello Clabel","font_size":20,"bold":true}]'

    # 3. Kiem tra trang thai BLE Gateway & quet thiet bi BLE:
    ./scripts/print_clabel.py --status
    ./scripts/print_clabel.py --scan
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent

venv_python = ROOT_DIR / "backend" / ".venv" / "bin" / "python3"
if venv_python.exists() and sys.executable != str(venv_python):
    os.execv(str(venv_python), [str(venv_python)] + sys.argv)

sys.path.insert(0, str(ROOT_DIR / "backend"))

from app import clabel  # noqa: E402
from app.config import get_settings  # noqa: E402


def main() -> int:
    s = get_settings()
    parser = argparse.ArgumentParser(
        description="In tem nhan nhiet Clabel CT221B-X420 qua BLE Gateway (root@77.88.207.23)"
    )
    parser.add_argument("--status", action="store_true", help="Kiem tra trang thai BLE Gateway va may in")
    parser.add_argument("--scan", action="store_true", help="Quet danh sach thiet bi BLE tren gateway")
    parser.add_argument(
        "--sanxuat-v1.1",
        "--sanxuat",
        "--device-id",
        dest="device_id",
        default=None,
        help="In Mau Xuat Xuong v1.1 Rockchip (400x300) theo ma thiet bi (vd: inut_207_153)",
    )
    parser.add_argument(
        "--usb-hub",
        action="store_true",
        help="In tem 2 dong USB HUB (400x300): USB HUB 0 => va USB HUB 1 =>",
    )
    parser.add_argument(
        "--line1",
        default="USB HUB 0 =>",
        help="Dong 1 cho tem USB HUB (mac dinh: 'USB HUB 0 =>')",
    )
    parser.add_argument(
        "--line2",
        default="USB HUB 1 =>",
        help="Dong 2 cho tem USB HUB (mac dinh: 'USB HUB 1 =>')",
    )
    parser.add_argument("--sub1", default=None, help="Dong phu duoi dong 1 (tem USB HUB)")
    parser.add_argument("--sub2", default=None, help="Dong phu duoi dong 2 (tem USB HUB)")
    parser.add_argument("--hub-header", default=None, help="Tieu de tren cung tem USB HUB")
    parser.add_argument("--align", choices=["center", "left"], default="center", help="Can le chu tem USB HUB")
    parser.add_argument(
        "--mfg-date",
        default=None,
        help="Ngay san xuat DD/MM/YYYY tren tem xuat xuong (mac dinh: ngay goi lenh in)",
    )
    parser.add_argument(
        "--model-name",
        default="iNut Smartcity - Data Logger v1.1 - Rockchip",
        help="Ten san pham xuat hoa don tren tem xuat xuong",
    )
    parser.add_argument("--product-line", default="Rockchip · Xuất xưởng v1.1 ©", help="Dong phu tren tem xuat xuong")
    parser.add_argument(
        "--a-thang",
        "--iot",
        dest="a_thang_iot",
        action="store_true",
        help="Mau xuat xuong cho anh Thang (Cty IoT): ten chuan hoa don 'iNut Smartcity - Data Logger v1.1'",
    )
    parser.add_argument("--wifi-pass", default="inut12345", help="Mat khau Wi-Fi mac dinh (mac dinh: inut12345)")
    parser.add_argument("--serial-number", default=None, help="So serial / Ma thiet bi")
    parser.add_argument("--no-qr-logo", action="store_true", help="Tat logo iNut mini o tam ma QR")
    parser.add_argument("--title", default="iNut JSC", help="Tieu de chinh tren tem")
    parser.add_argument("--subtitle", default="IoT & Edge Computing", help="Tieu de phu")
    parser.add_argument(
        "--line",
        action="append",
        dest="lines",
        help="Dong noi dung (co the truyen nhieu lan --line)",
    )
    parser.add_argument("--badge", default="INUT-BLE GATEWAY READY", help="Chu tren nhan den (badge)")
    parser.add_argument("--footer-title", default="Đắk Lắk - TP.HCM", help="Tieu de chan trang")
    parser.add_argument(
        "--footer-line",
        action="append",
        dest="footer_lines",
        help="Dong chan trang (co the truyen nhieu lan --footer-line)",
    )
    parser.add_argument("--qr", default="https://inut.vn", help="Noi dung ma QR (truyen '' de tat QR)")
    parser.add_argument("--barcode", default=None, help="Noi dung ma vach Code128 (tuy chon)")
    parser.add_argument("--logo", default=None, help="Duong dan file logo (mac dinh logo iNut)")
    parser.add_argument("--no-logo", action="store_true", help="Khong hien thi logo")
    parser.add_argument("--no-border", action="store_true", help="Khong ve khung vien")
    parser.add_argument("--image", default=None, help="In truc tiep 1 file anh (PNG/JPG) len tem")
    parser.add_argument("--dither", action="store_true", help="Dung Floyd-Steinberg dithering cho anh chup")
    parser.add_argument("--threshold", type=int, default=172, help="Nguong den/trang (0-255, mac dinh 172)")
    parser.add_argument("--elements-json", default=None, help="Chuoi JSON hoac duong dan file .json chua elements")
    parser.add_argument("--width", type=int, default=s.clabel_default_width, help="Chieu rong giay (400 hoac 40mm)")
    parser.add_argument("--height", type=int, default=s.clabel_default_height, help="Chieu cao giay (300 hoac 30mm)")
    parser.add_argument("--copies", type=int, default=1, help="So ban in")
    parser.add_argument("--density", type=int, default=s.clabel_default_density, help="Do dam nhiet (1-15)")
    parser.add_argument("--speed", type=int, default=s.clabel_default_speed, help="Toc do in (1-5)")
    parser.add_argument("--gateway", default=s.ble_gateway_host, help="IP/Host cua BLE Gateway (mac dinh 77.88.207.23)")
    parser.add_argument("--mac", default=s.clabel_printer_mac, help="Dia chi MAC BLE cua Clabel CT221B-X420")
    parser.add_argument("--preview-out", default=None, help="Luu file anh PNG xem truoc ra duong dan nay")
    parser.add_argument("--tspl-out", default=None, help="Luu goi byte TSPL ra file")
    parser.add_argument("--dry-run", action="store_true", help="Chi tao anh xem truoc va TSPL, khong gui lenh in BLE")

    args = parser.parse_args()
    if args.a_thang_iot:
        if args.model_name == "iNut Smartcity - Data Logger v1.1 - Rockchip":
            args.model_name = "iNut Smartcity - Data Logger v1.1"
        if args.product_line == "Rockchip · Xuất xưởng v1.1 ©":
            args.product_line = "iNut Smartcity · Xuất xưởng v1.1 ©"
    gw = clabel.ClabelBLEGateway(host=args.gateway)

    if args.status:
        st = gw.get_gateway_status()
        print(json.dumps(st, indent=2, ensure_ascii=False))
        return 0

    if args.scan:
        devs = gw.scan_printers(scan_seconds=5)
        print(json.dumps({"gateway": args.gateway, "devices": devs}, indent=2, ensure_ascii=False))
        return 0

    w_mm, h_mm, w_dots, h_dots = clabel.normalize_paper_size(args.width, args.height)

    if args.image:
        img = clabel.render_monochrome_image(
            args.image,
            width=w_dots,
            height=h_dots,
            threshold=args.threshold,
            dither=args.dither,
            preserve_outline=True,
        )
    elif args.elements_json:
        raw_el = args.elements_json
        if os.path.exists(raw_el):
            raw_el = Path(raw_el).read_text(encoding="utf-8")
        elements = json.loads(raw_el)
        img = clabel.render_elements_canvas(
            elements,
            width=args.width,
            height=args.height,
            border=not args.no_border,
        )
    elif args.usb_hub:
        img = clabel.render_usb_hub_label(
            line1=args.line1,
            line2=args.line2,
            sub1=args.sub1,
            sub2=args.sub2,
            header=args.hub_header,
            align=args.align,
            border=not args.no_border,
            width=args.width,
            height=args.height,
        )
    elif args.device_id:
        dev_ids = [d.strip() for d in args.device_id.split(",") if d.strip()]
        if len(dev_ids) > 1:
            payloads: list[bytes] = []
            for idx, did in enumerate(dev_ids):
                im_i = clabel.render_sanxuat_v1_1_label(
                    device_id=did,
                    mfg_date=args.mfg_date,
                    model_name=args.model_name,
                    product_line=args.product_line,
                    wifi_pass=args.wifi_pass,
                    serial_number=args.serial_number,
                    qr_data=did,
                    qr_logo=not args.no_qr_logo,
                    logo_path=args.logo,
                    width=args.width,
                    height=args.height,
                )
                if idx == 0 and args.preview_out:
                    im_i.save(args.preview_out)
                    print(f"[PREVIEW] Da luu anh xem truoc mau dau ({w_dots}x{h_dots}px): {args.preview_out}")
                payloads.append(
                    clabel.build_label_tspl(
                        im_i,
                        width=args.width,
                        height=args.height,
                        copies=args.copies,
                        density=args.density,
                        speed=args.speed,
                        threshold=args.threshold,
                    )
                )
            if args.dry_run:
                print(f"[DRY-RUN] Batch {len(dev_ids)} tem ({', '.join(dev_ids)}), tong {sum(len(p) for p in payloads)} bytes.")
                return 0
            batch_res = gw.send_tspl_batch(payloads, labels=dev_ids, mac=args.mac)
            print(
                f"[SUCCESS] Da in thanh cong {batch_res['printed_count']}/{len(dev_ids)} tem sang Clabel ({batch_res['mac']}) "
                f"qua BLE Gateway {batch_res['gateway_host']} trong {batch_res['total_elapsed_sec']}s!"
            )
            for item in batch_res.get("items", []):
                print(f"  - [{item['index']:02d}] {item['label']}: {item['bytes_sent']} bytes ({item['chunks_sent']} chunks) in {item['elapsed_sec']}s")
            try:
                from contextlib import closing
                from app.db import get_session, init_db

                init_db()
                with closing(next(get_session())) as db:
                    for did in dev_ids:
                        clabel.record_clabel_device_print(
                            db,
                            did,
                            mfg_date=args.mfg_date,
                            model_name=args.model_name,
                            wifi_pass=args.wifi_pass,
                        )
            except Exception:
                pass
            return 0

        qr_override = args.qr if (args.qr and args.qr != "https://inut.vn") else dev_ids[0]
        img = clabel.render_sanxuat_v1_1_label(
            device_id=dev_ids[0],
            mfg_date=args.mfg_date,
            model_name=args.model_name,
            product_line=args.product_line,
            wifi_pass=args.wifi_pass,
            serial_number=args.serial_number,
            qr_data=qr_override,
            qr_logo=not args.no_qr_logo,
            logo_path=args.logo,
            width=args.width,
            height=args.height,
        )
    else:
        img = clabel.render_inut_label(
            title=args.title,
            subtitle=args.subtitle,
            lines=args.lines,
            badge=args.badge,
            footer_title=args.footer_title,
            footer_lines=args.footer_lines,
            qr_data=args.qr if args.qr else None,
            barcode_data=args.barcode,
            logo_path=args.logo,
            show_logo=not args.no_logo,
            border=not args.no_border,
            width=args.width,
            height=args.height,
        )
    if args.preview_out:
        img.save(args.preview_out)
        print(f"[PREVIEW] Da luu anh xem truoc ({w_dots}x{h_dots}px): {args.preview_out}")

    tspl_bytes = clabel.build_label_tspl(
        img,
        width=args.width,
        height=args.height,
        copies=args.copies,
        density=args.density,
        speed=args.speed,
        threshold=args.threshold,
    )

    if args.tspl_out:
        Path(args.tspl_out).write_bytes(tspl_bytes)
        print(f"[TSPL] Da luu {len(tspl_bytes)} bytes TSPL: {args.tspl_out}")

    if args.dry_run:
        print(
            f"[DRY-RUN] Kho giay {w_mm}x{h_mm}mm ({w_dots}x{h_dots} dots), "
            f"TSPL payload = {len(tspl_bytes)} bytes."
        )
        return 0

    res = gw.send_tspl(tspl_bytes, mac=args.mac)
    print(f"[SUCCESS] Da in thanh cong sang Clabel ({res['mac']}) qua BLE Gateway {res['gateway_host']}!")
    print(f"  - Kho giay: {w_mm}x{h_mm}mm ({w_dots}x{h_dots} dots)")
    print(f"  - Dung luong TSPL: {res['bytes_sent']} bytes ({res['chunks_sent']} BLE GATT chunks)")
    print(f"  - Negotiated MTU: {res['negotiated_mtu']} | Thoi gian truyen: {res['elapsed_sec']}s")
    if args.device_id:
        try:
            from contextlib import closing
            from app.db import get_session, init_db

            init_db()
            with closing(next(get_session())) as db:
                clabel.record_clabel_device_print(
                    db,
                    args.device_id.strip(),
                    mfg_date=args.mfg_date,
                    model_name=args.model_name,
                    wifi_pass=args.wifi_pass,
                )
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
