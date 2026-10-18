"""FastAPI router cho may in nhan nhiet Clabel CT221B qua BLE Gateway (inut-ble)."""
from __future__ import annotations

import base64
import io
import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from . import clabel
from .auth import CurrentUser, require_admin
from .config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/clabel", tags=["clabel"])


class ClabelPrintRequest(BaseModel):
    title: str = "iNut JSC"
    subtitle: str = "IoT & Edge Computing"
    lines: list[str] | None = None
    badge: str = "INUT-BLE GATEWAY READY"
    footer_title: str = "Đắk Lắk - TP.HCM"
    footer_lines: list[str] | None = None
    qr_data: str | None = "https://inut.vn"
    barcode_data: str | None = None
    show_logo: bool = True
    border: bool = True
    elements: list[dict[str, Any]] | None = Field(
        default=None,
        description="Danh sach phan tu tuy chinh (text, logo, image, qrcode, barcode, box, line, badge, circle, reverse).",
    )
    image_base64: str | None = Field(
        default=None,
        description="Anh PNG/JPEG base64 de in truc tiep len tem (tuy chon).",
    )
    dither: bool = False
    threshold: int = 172
    width: int = 400
    height: int = 300
    copies: int = 1
    density: int | None = None
    speed: int | None = None
    gap_mm: int | None = None
    media_type: Literal["gap", "continuous", "mark"] = "gap"
    mac: str | None = None
    gateway_host: str | None = None
    print_remote: bool = True


def _render_from_payload(payload: ClabelPrintRequest):
    _, _, w_dots, h_dots = clabel.normalize_paper_size(payload.width, payload.height)
    if payload.image_base64:
        b64 = payload.image_base64
        if "," in b64:
            b64 = b64.split(",", 1)[1]
        raw_img = base64.b64decode(b64)
        return clabel.render_monochrome_image(
            raw_img,
            width=w_dots,
            height=h_dots,
            threshold=payload.threshold,
            dither=payload.dither,
            preserve_outline=False,
        )
    if payload.elements:
        return clabel.render_elements_canvas(
            payload.elements,
            width=payload.width,
            height=payload.height,
            border=payload.border,
        )
    return clabel.render_inut_label(
        title=payload.title,
        subtitle=payload.subtitle,
        lines=payload.lines,
        badge=payload.badge,
        footer_title=payload.footer_title,
        footer_lines=payload.footer_lines,
        qr_data=payload.qr_data,
        barcode_data=payload.barcode_data,
        show_logo=payload.show_logo,
        border=payload.border,
        width=payload.width,
        height=payload.height,
    )


@router.get("/status")
def clabel_gateway_status(
    user: CurrentUser = Depends(require_admin),
) -> dict[str, Any]:
    """Kiem tra trang thai BLE Gateway (77.88.207.23) va may in Clabel CT221B-X420."""
    try:
        gw = clabel.ClabelBLEGateway()
        return gw.get_gateway_status()
    except Exception as exc:
        logger.exception("Loi kiem tra trang thai BLE Gateway")
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/scan")
def clabel_scan_printers(
    scan_seconds: int = 5,
    user: CurrentUser = Depends(require_admin),
) -> dict[str, Any]:
    """Quet danh sach thiet bi BLE gan gateway 77.88.207.23."""
    try:
        gw = clabel.ClabelBLEGateway()
        devices = gw.scan_printers(scan_seconds=max(2, min(15, scan_seconds)))
        return {
            "gateway_host": gw.host,
            "configured_printer_name": get_settings().clabel_printer_name,
            "configured_printer_mac": get_settings().clabel_printer_mac,
            "devices": devices,
        }
    except Exception as exc:
        logger.exception("Loi quet BLE tren gateway")
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/preview")
def clabel_preview_label(
    payload: ClabelPrintRequest,
    user: CurrentUser = Depends(require_admin),
) -> Response:
    """Render va xem truoc tem nhan Clabel duoi dang file anh PNG 1-bit."""
    img = _render_from_payload(payload)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


@router.post("/print")
def clabel_print_label(
    payload: ClabelPrintRequest,
    user: CurrentUser = Depends(require_admin),
) -> dict[str, Any]:
    """Render va gui lenh in TSPL qua BLE Gateway sang may in Clabel CT221B-X420."""
    try:
        img = _render_from_payload(payload)
        tspl_bytes = clabel.build_label_tspl(
            img,
            width=payload.width,
            height=payload.height,
            copies=payload.copies,
            density=payload.density,
            speed=payload.speed,
            gap_mm=payload.gap_mm,
            media_type=payload.media_type,
            threshold=payload.threshold,
        )
        png_buf = io.BytesIO()
        img.save(png_buf, format="PNG")
        w_mm, h_mm, w_dots, h_dots = clabel.normalize_paper_size(payload.width, payload.height)
        result: dict[str, Any] = {
            "width_mm": w_mm,
            "height_mm": h_mm,
            "width_dots": w_dots,
            "height_dots": h_dots,
            "tspl_bytes_len": len(tspl_bytes),
            "preview_png_base64": base64.b64encode(png_buf.getvalue()).decode("ascii"),
            "is_printed": False,
        }
        if payload.print_remote:
            gw = clabel.ClabelBLEGateway(host=payload.gateway_host or get_settings().ble_gateway_host)
            send_res = gw.send_tspl(tspl_bytes, mac=payload.mac)
            result.update(send_res)
            result["is_printed"] = True
        return result
    except Exception as exc:
        logger.exception("Loi khi in tem Clabel qua BLE Gateway")
        raise HTTPException(status_code=502, detail=str(exc)) from exc
