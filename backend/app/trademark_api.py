"""FastAPI router cho module Quan ly & Tra cuu Nhan hieu (So huu tri tue)."""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import storage, trademark
from .auth import CurrentUser, require_user
from .db import IpTrademark, get_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/trademarks", tags=["trademarks"])


class TrademarkSyncRequest(BaseModel):
    query: str = Field(default="APNA:(INUT)", description="Truy van WIPO Publish")
    download_logos: bool = Field(default=True, description="Tu dong tai va luu tru logo")


class TrademarkLookupRequest(BaseModel):
    query: str = Field(..., min_length=1, description="Tu khoa tra cuu (Ten nhan hieu, MST, ten cong ty)")


@router.get("", summary="Lay danh sach nhan hieu da luu trong he thong")
def list_trademarks(
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(require_user),
) -> List[Dict[str, Any]]:
    """Tra ve toan bo nhan hieu kem tinh toan thoi han hieu luc va du toan le phi."""
    # Tu dong khoi tao du lieu mau cua INUT neu CSDL chua co ban ghi nao
    trademark.seed_inut_trademarks(db)

    records = db.scalars(
        select(IpTrademark).order_by(IpTrademark.filing_date.desc(), IpTrademark.id.asc())
    ).all()
    return [trademark.trademark_to_dict(tm) for tm in records]


@router.get("/{trademark_id}", summary="Xem chi tiet 1 nhan hieu")
def get_trademark_detail(
    trademark_id: int,
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(require_user),
) -> Dict[str, Any]:
    tm = db.get(IpTrademark, trademark_id)
    if not tm:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Không tìm thấy nhãn hiệu với ID={trademark_id}",
        )
    return trademark.trademark_to_dict(tm)


@router.post("/sync", summary="Dong bo nhan hieu tu Cong Cuc SHTT (WIPO Publish)")
def sync_trademarks(
    req: TrademarkSyncRequest = TrademarkSyncRequest(),
    db: Session = Depends(get_session),
    user: CurrentUser = Depends(require_user),
) -> Dict[str, Any]:
    """Ket noi Cổng Cục SHTT, crawl thong tin nhan hieu va anh logo luu tru noi bo."""
    try:
        result = trademark.sync_trademarks_from_wipo(
            db=db,
            query=req.query,
            download_logos=req.download_logos,
        )
        records = db.scalars(
            select(IpTrademark).order_by(IpTrademark.filing_date.desc(), IpTrademark.id.asc())
        ).all()
        result["items"] = [trademark.trademark_to_dict(tm) for tm in records]
        return result
    except Exception as e:
        logger.exception("Loi khi dong bo nhan hieu: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Lỗi khi đồng bộ từ Cục SHTT: {str(e)}",
        )


@router.post("/lookup-online", summary="Tra cuu nhan hieu truc tuyen tu Cong Cuc SHTT")
def lookup_trademarks_online(
    req: TrademarkLookupRequest,
    user: CurrentUser = Depends(require_user),
) -> Dict[str, Any]:
    """Tra cuu truc tiep theo tu khoa bat ky ma khong can luu vao CSDL truoc."""
    try:
        items = trademark.search_wipo_trademarks(query=req.query)
        return {
            "ok": True,
            "query": req.query,
            "total": len(items),
            "items": items,
        }
    except Exception as e:
        logger.exception("Loi khi tra cuu online: %s", e)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Không thể tra cứu trực tuyến từ Cục SHTT: {str(e)}",
        )


@router.get("/{trademark_id}/logo", summary="Xem anh logo nhan hieu da luu tru")
def get_trademark_logo(
    trademark_id: int,
    db: Session = Depends(get_session),
):
    """Phuc vu file anh logo luu trong KSP Storage. Neu chua co, chuyen huong toi URL goc."""
    tm = db.get(IpTrademark, trademark_id)
    if not tm:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Không tìm thấy nhãn hiệu",
        )

    if tm.logo_doc_id:
        try:
            p = storage.path_for(tm.logo_doc_id, suffix=tm.logo_suffix or ".jpg")
            if p.exists():
                return FileResponse(
                    path=str(p),
                    media_type="image/jpeg",
                    filename=f"trademark_{tm.application_number or trademark_id}.jpg",
                )
        except Exception:
            pass

    if tm.remote_logo_url:
        return RedirectResponse(url=tm.remote_logo_url)

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Nhãn hiệu chưa có ảnh logo",
    )
