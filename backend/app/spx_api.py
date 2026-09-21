"""FastAPI router cho phan he Van don SPX Express (spx.vn)."""

from __future__ import annotations

import io
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from . import db as db_module, spx
from .auth import CurrentUser, require_admin
from .db import get_session
from .schemas import (
    CustomLabelPrintIn,
    SpxBatchPrintIn,
    SpxOrderCreateIn,
    SpxOrderListOut,
    SpxOrderOut,
    SpxQuickPrintIn,
    SpxSettingsIn,
    SpxSettingsOut,
    SpxStatsOut,
    SpxSyncOrdersIn,
    SpxTestIn,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/spx", tags=["spx"])


def _shipment_to_out(s: db_module.SpxShipment) -> SpxOrderOut:
    return SpxOrderOut(
        id=s.id,
        tracking_no=s.tracking_no,
        order_code=s.order_code or "",
        recipient_name=s.recipient_name or "",
        recipient_phone=s.recipient_phone or "",
        recipient_address=s.recipient_address or "",
        province=s.province or "",
        district=s.district or "",
        ward=s.ward or "",
        cod_amount=float(s.cod_amount or 0.0),
        weight_gram=int(s.weight_gram or 500),
        length_cm=int(s.length_cm or 10),
        width_cm=int(s.width_cm or 10),
        height_cm=int(s.height_cm or 10),
        item_description=s.item_description or "",
        note=s.note or "",
        payer=s.payer or "sender",
        status=s.status or "ready_to_ship",
        shipping_fee=float(s.shipping_fee or 0.0),
        label_doc_id=s.label_doc_id or "",
        sender_name=s.sender_name or "",
        sender_phone=s.sender_phone or "",
        sender_address=s.sender_address or "",
        is_printed=bool(s.is_printed),
        printed_at=s.printed_at.isoformat() if s.printed_at else "",
        created_at=s.created_at.isoformat() if s.created_at else "",
        updated_at=s.updated_at.isoformat() if s.updated_at else "",
    )


@router.get("/settings", response_model=SpxSettingsOut)
def get_settings(
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Doc cau hinh SPX Express."""
    data = spx.get_spx_settings(db, mask_secrets=True)
    return SpxSettingsOut(**data)


@router.post("/settings", response_model=SpxSettingsOut)
def save_settings(
    payload: SpxSettingsIn,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Luu cau hinh SPX Express (ma hoa mat khau / token)."""
    data = spx.save_spx_settings(db, payload.model_dump())
    return SpxSettingsOut(**data)


@router.post("/test-connection")
def test_connection(
    payload: SpxTestIn,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Kiem tra ket noi voi tai khoan SPX."""
    return spx.test_spx_connection(
        db,
        username=payload.username,
        password=payload.password,
        shop_id=payload.shop_id,
        api_token=payload.api_token,
        cookies=payload.cookies,
    )


@router.get("/stats", response_model=SpxStatsOut)
def get_stats(
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Thong ke tong quan van don va tinh trang in."""
    data = spx.get_spx_stats(db)
    return SpxStatsOut(**data)


@router.post("/quick-print")
def quick_print(
    payload: SpxQuickPrintIn,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Nhap ma van don / Order SN -> In ngay ra may TP732H (.158) hoac tai ve."""
    try:
        return spx.quick_print_by_code(
            db,
            payload.tracking_no,
            printer_name=payload.printer_name,
            host=payload.host,
            print_remote=payload.print_remote,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Loi in nhanh SPX: %s", e)
        raise HTTPException(status_code=500, detail=f"Lỗi in nhanh: {e}")



@router.post("/custom-label/print")
def print_custom_label(
    payload: CustomLabelPrintIn,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """In tem nhan giao hang tu do (ngoai san, chanh xe) sang may in nhiet TP732H."""
    try:
        return spx.print_custom_shipping_label(
            db=db,
            code=payload.code,
            recipient_name=payload.recipient_name,
            recipient_phone=payload.recipient_phone,
            recipient_address=payload.recipient_address,
            item_desc=payload.item_desc,
            note=payload.note,
            sender_name=payload.sender_name,
            sender_phone=payload.sender_phone,
            sender_address=payload.sender_address,
            printer_name=payload.printer_name,
            host=payload.host,
            print_remote=payload.print_remote,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Loi in tem nhan giao hang: %s", e)
        raise HTTPException(status_code=500, detail=f"Loi in tem nhan giao hang: {e}")

@router.post("/sync-orders")
def sync_orders(
    payload: SpxSyncOrdersIn,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Dong bo danh sach ma van don / Order SN (dan danh sach ma)."""
    try:
        return spx.sync_spx_orders_batch(db, payload.raw_text)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Loi dong bo SPX: %s", e)
        raise HTTPException(status_code=500, detail=f"Lỗi đồng bộ: {e}")


@router.post("/batch-print")
def batch_print(
    payload: SpxBatchPrintIn,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """In hang loat cac don hang chua in."""
    try:
        return spx.batch_print_unprinted(
            db,
            tracking_numbers=payload.tracking_numbers if payload.tracking_numbers else None,
            from_date=payload.from_date if payload.from_date else None,
            to_date=payload.to_date if payload.to_date else None,
            printer_name=payload.printer_name,
            host=payload.host,
        )
    except Exception as e:
        logger.exception("Loi in hang loat SPX: %s", e)
        raise HTTPException(status_code=500, detail=f"Lỗi in hàng loạt: {e}")



@router.post("/orders", response_model=SpxOrderOut)
def create_order(
    payload: SpxOrderCreateIn,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Tao van don SPX Express moi, tu dong sinh ma van don va tem nhan A6 PDF."""
    try:
        shipment = spx.create_spx_order(db, payload.model_dump())
        return _shipment_to_out(shipment)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Loi tao van don SPX: %s", e)
        raise HTTPException(status_code=500, detail=f"Lỗi tạo vận đơn: {e}")


@router.get("/orders", response_model=SpxOrderListOut)
def list_orders(
    status: str = Query(default="all"),
    is_printed: bool | None = Query(default=None),
    from_date: str | None = Query(default=None),
    to_date: str | None = Query(default=None),
    search: str = Query(default=""),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Lay danh sach cac van don SPX kem bo loc in an va thoi gian."""
    items, total, unprinted_count, printed_count = spx.list_spx_orders(
        db,
        status=status,
        is_printed=is_printed,
        from_date=from_date,
        to_date=to_date,
        search=search,
        limit=limit,
        offset=offset,
    )
    return SpxOrderListOut(
        items=[_shipment_to_out(s) for s in items],
        total=total,
        unprinted_count=unprinted_count,
        printed_count=printed_count,
    )


@router.get("/orders/{tracking_no}", response_model=SpxOrderOut)
def get_order(
    tracking_no: str,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Chi tiet 1 van don SPX."""
    shipment = spx.get_spx_order(db, tracking_no)
    if not shipment:
        raise HTTPException(status_code=404, detail="Không tìm thấy vận đơn.")
    return _shipment_to_out(shipment)


@router.get("/orders/{tracking_no}/label")
def get_order_label(
    tracking_no: str,
    db: Session = Depends(get_session),
):
    """Tai hoac in tem nhan A6 PDF (100x150mm) cua van don."""
    try:
        pdf_bytes = spx.get_spx_order_label(db, tracking_no)
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f"inline; filename=SPX_{tracking_no}_A6.pdf"
            },
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.exception("Loi xuat tem nhan SPX: %s", e)
        raise HTTPException(status_code=500, detail=f"Lỗi tải tem nhãn: {e}")


@router.post("/orders/{tracking_no}/mark-printed", response_model=SpxOrderOut)
def mark_order_printed(
    tracking_no: str,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Danh dau don hang da in."""
    try:
        shipment = spx.mark_spx_order_printed(db, tracking_no, is_printed=True)
        return _shipment_to_out(shipment)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/orders/{tracking_no}/mark-unprinted", response_model=SpxOrderOut)
def mark_order_unprinted(
    tracking_no: str,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Danh dau don hang chua in."""
    try:
        shipment = spx.mark_spx_order_printed(db, tracking_no, is_printed=False)
        return _shipment_to_out(shipment)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/orders/{tracking_no}/cancel", response_model=SpxOrderOut)
def cancel_order(
    tracking_no: str,
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Huy van don SPX."""
    try:
        shipment = spx.cancel_spx_order(db, tracking_no)
        return _shipment_to_out(shipment)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Loi huy van don SPX: %s", e)
        raise HTTPException(status_code=500, detail=f"Lỗi hủy vận đơn: {e}")


@router.get("/printers")
def get_printers(
    host: str = Query(default="192.168.1.10"),
    user: CurrentUser = Depends(require_admin),
):
    """Lay danh sach may in tren may Windows."""
    return spx.list_remote_printers(host=host)


@router.post("/orders/{tracking_no}/print-remote")
def print_order_remote(
    tracking_no: str,
    host: str = Query(default="192.168.1.10"),
    printer_name: str = Query(default="TP732H"),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Gui lenh in tem nhan A6 sang may in Windows (TP732H tai 192.168.1.10)."""
    try:
        return spx.print_spx_order_remote(
            db, tracking_no, host=host, printer_name=printer_name
        )
    except Exception as e:
        logger.exception("Loi in tu xa: %s", e)
        raise HTTPException(status_code=500, detail=f"Lỗi in từ xa: {e}")


