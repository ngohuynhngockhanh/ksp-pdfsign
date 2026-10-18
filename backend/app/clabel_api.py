"""FastAPI router cho may in nhan nhiet Clabel CT221B qua BLE Gateway (inut-ble)."""
from __future__ import annotations

import base64
import io
import json
import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from . import clabel
from .auth import CurrentUser, require_user
from .config import Settings, get_settings
from .db import get_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/clabel", tags=["clabel"])


def require_clabel_access(
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
) -> CurrentUser:
    """Cho phep goi truc tiep tu loopback (127.0.0.1 / localhost) hoac xac thuc Admin JWT / MCP Bearer."""
    client_host = (request.client.host if request.client else "").replace("::ffff:", "")
    host_header = request.headers.get("host", "").split(":", 1)[0].strip().lower()
    forwarded = request.headers.get("x-forwarded-for") or request.headers.get("x-real-ip")

    # Neu goi truc tiep tren may chu local (127.0.0.1:2032) khong qua reverse proxy / frpc
    if (
        client_host in {"127.0.0.1", "::1", "localhost", "testclient"}
        and host_header in {"127.0.0.1", "localhost", "testserver", ""}
        and not forwarded
        and not request.headers.get("authorization")
        and not request.cookies.get("ksp_session")
    ):
        return CurrentUser(
            id=0,
            username="local-ble-gateway",
            role="admin",
            customer_id=None,
            training_access=True,
            ip=client_host or "127.0.0.1",
        )

    user = require_user(request=request, settings=settings, db=db)
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Chi admin duoc phep su dung may in BLE")
    return user


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


class ClabelRawTSPLRequest(BaseModel):
    tspl: str | None = Field(default=None, description="Chuoi lenh TSPL dang text.")
    tspl_base64: str | None = Field(default=None, description="Goi byte TSPL ma hoa base64.")
    mac: str | None = None
    gateway_host: str | None = None


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


def _execute_print(payload: ClabelPrintRequest) -> dict[str, Any]:
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


@router.get("/status")
def clabel_gateway_status(
    user: CurrentUser = Depends(require_clabel_access),
) -> dict[str, Any]:
    """Kiem tra trang thai BLE Gateway (77.88.207.23) va may in Clabel CT221B-X420."""
    try:
        gw = clabel.ClabelBLEGateway()
        return gw.get_gateway_status()
    except Exception as exc:
        logger.exception("Loi kiem tra trang thai BLE Gateway")
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/scan")
@router.post("/scan")
def clabel_scan_printers(
    scan_seconds: int = Query(default=5, ge=2, le=15),
    user: CurrentUser = Depends(require_clabel_access),
) -> dict[str, Any]:
    """Quet danh sach thiet bi BLE gan gateway 77.88.207.23."""
    try:
        gw = clabel.ClabelBLEGateway()
        devices = gw.scan_printers(scan_seconds=scan_seconds)
        return {
            "gateway_host": gw.host,
            "configured_printer_name": get_settings().clabel_printer_name,
            "configured_printer_mac": get_settings().clabel_printer_mac,
            "devices": devices,
        }
    except Exception as exc:
        logger.exception("Loi quet BLE tren gateway")
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/preview")
def clabel_preview_label_get(
    title: str = Query(default="iNut JSC"),
    subtitle: str = Query(default="IoT & Edge Computing"),
    line: list[str] | None = Query(default=None),
    badge: str = Query(default="INUT-BLE GATEWAY READY"),
    footer_title: str = Query(default="Đắk Lắk - TP.HCM"),
    qr_data: str | None = Query(default="https://inut.vn"),
    barcode_data: str | None = Query(default=None),
    show_logo: bool = Query(default=True),
    border: bool = Query(default=True),
    width: int = Query(default=400),
    height: int = Query(default=300),
    user: CurrentUser = Depends(require_clabel_access),
) -> Response:
    """Xem truoc tem nhan Clabel qua GET query params (tra ve image/png 320x240)."""
    payload = ClabelPrintRequest(
        title=title,
        subtitle=subtitle,
        lines=line,
        badge=badge,
        footer_title=footer_title,
        qr_data=qr_data,
        barcode_data=barcode_data,
        show_logo=show_logo,
        border=border,
        width=width,
        height=height,
        print_remote=False,
    )
    img = _render_from_payload(payload)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


@router.post("/preview")
def clabel_preview_label(
    payload: ClabelPrintRequest,
    user: CurrentUser = Depends(require_clabel_access),
) -> Response:
    """Render va xem truoc tem nhan Clabel duoi dang file anh PNG 1-bit."""
    img = _render_from_payload(payload)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


@router.post("/print")
def clabel_print_label(
    payload: ClabelPrintRequest,
    user: CurrentUser = Depends(require_clabel_access),
) -> dict[str, Any]:
    """Render va gui lenh in TSPL qua BLE Gateway sang may in Clabel CT221B-X420."""
    try:
        return _execute_print(payload)
    except Exception as exc:
        logger.exception("Loi khi in tem Clabel qua BLE Gateway")
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/print")
def clabel_print_label_get(
    title: str = Query(default="iNut JSC"),
    subtitle: str = Query(default="IoT & Edge Computing"),
    line: list[str] | None = Query(default=None),
    badge: str = Query(default="INUT-BLE GATEWAY READY"),
    footer_title: str = Query(default="Đắk Lắk - TP.HCM"),
    qr_data: str | None = Query(default="https://inut.vn"),
    barcode_data: str | None = Query(default=None),
    show_logo: bool = Query(default=True),
    border: bool = Query(default=True),
    width: int = Query(default=400),
    height: int = Query(default=300),
    copies: int = Query(default=1, ge=1, le=20),
    print_remote: bool = Query(default=True),
    user: CurrentUser = Depends(require_clabel_access),
) -> dict[str, Any]:
    """In nhanh tem Clabel qua GET query params."""
    payload = ClabelPrintRequest(
        title=title,
        subtitle=subtitle,
        lines=line,
        badge=badge,
        footer_title=footer_title,
        qr_data=qr_data,
        barcode_data=barcode_data,
        show_logo=show_logo,
        border=border,
        width=width,
        height=height,
        copies=copies,
        print_remote=print_remote,
    )
    try:
        return _execute_print(payload)
    except Exception as exc:
        logger.exception("Loi khi in tem Clabel qua BLE Gateway (GET)")
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/print-image")
async def clabel_print_uploaded_image(
    file: UploadFile = File(...),
    width: int = Form(default=400),
    height: int = Form(default=300),
    copies: int = Form(default=1),
    dither: bool = Form(default=False),
    threshold: int = Form(default=172),
    density: int | None = Form(default=None),
    speed: int | None = Form(default=None),
    mac: str | None = Form(default=None),
    gateway_host: str | None = Form(default=None),
    print_remote: bool = Form(default=True),
    user: CurrentUser = Depends(require_clabel_access),
) -> dict[str, Any]:
    """Upload truc tiep file anh (PNG/JPG/WEBP) qua multipart/form-data va in ra Clabel CT221B."""
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="File anh trong")
    payload = ClabelPrintRequest(
        image_base64=base64.b64encode(raw).decode("ascii"),
        width=width,
        height=height,
        copies=copies,
        dither=dither,
        threshold=threshold,
        density=density,
        speed=speed,
        mac=mac,
        gateway_host=gateway_host,
        print_remote=print_remote,
    )
    try:
        return _execute_print(payload)
    except Exception as exc:
        logger.exception("Loi khi in file anh upload qua BLE Gateway")
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/print-tspl")
def clabel_print_raw_tspl(
    payload: ClabelRawTSPLRequest,
    user: CurrentUser = Depends(require_clabel_access),
) -> dict[str, Any]:
    """Gui truc tiep goi lenh TSPL (text hoac base64) qua BLE Gateway toi Clabel CT221B."""
    if payload.tspl_base64:
        raw_bytes = base64.b64decode(payload.tspl_base64)
    elif payload.tspl:
        raw_bytes = payload.tspl.encode("gb2312", errors="replace")
    else:
        raise HTTPException(status_code=400, detail="Can cung cap tspl hoac tspl_base64")
    try:
        gw = clabel.ClabelBLEGateway(host=payload.gateway_host or get_settings().ble_gateway_host)
        res = gw.send_tspl(raw_bytes, mac=payload.mac)
        res["is_printed"] = True
        return res
    except Exception as exc:
        logger.exception("Loi khi gui raw TSPL qua BLE Gateway")
        raise HTTPException(status_code=502, detail=str(exc)) from exc
