"""FastAPI router cho Phan he Tra cuu & San Goi Thau Mua Sam Cong (Bidding Procurement)."""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import HTMLResponse, Response
from sqlalchemy.orm import Session


from . import bidding
from .auth import CurrentUser, require_full_portal, require_user
from .config import Settings, get_settings
from .db import get_session
from .schemas import (
    BiddingAIAnalyzeRequest,
    BiddingAIAnalyzeResponse,
    BiddingBookmarkCreate,
    BiddingBookmarkListOut,
    BiddingBookmarkOut,
    BiddingBookmarkUpdate,
    BiddingScanResultOut,
    BiddingSearchResponse,
    BiddingWatchlistCreate,
    BiddingWatchlistListOut,
    BiddingWatchlistOut,
    BiddingWatchlistUpdate,
    TenderItemOut,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/bidding", tags=["bidding-procurement"])

ALLOWED_BOOKMARK_STATUSES = {"watching", "preparing", "submitted", "won", "lost"}


def _bookmark_to_out(bm: Any) -> BiddingBookmarkOut:
    return BiddingBookmarkOut(
        id=bm.id,
        tbmt_code=bm.tbmt_code or "",
        tender_name=bm.tender_name or "",
        procuring_entity=bm.procuring_entity or "",
        investor=bm.investor or "",
        field=bm.field or "",
        bid_price=float(bm.bid_price or 0.0),
        bid_deadline=bm.bid_deadline or "",
        bid_opening_date=bm.bid_opening_date or "",
        province=bm.province or "",
        bidding_method=bm.bidding_method or "",
        source_url=bm.source_url or "",
        status=bm.status or "watching",
        note=bm.note or "",
        ai_summary=bm.ai_summary or "",
        created_by=bm.created_by,
        created_at=bm.created_at.isoformat() if bm.created_at else "",
        updated_at=bm.updated_at.isoformat() if bm.updated_at else "",
    )


def _watchlist_to_out(wl: Any) -> BiddingWatchlistOut:
    return BiddingWatchlistOut(
        id=wl.id,
        name=wl.name or "",
        keyword=wl.keyword or "",
        province=wl.province or "",
        field=wl.field or "",
        min_price=float(wl.min_price or 0.0),
        max_price=float(wl.max_price or 0.0),
        method=wl.method or "",
        notify_telegram=bool(wl.notify_telegram),
        is_active=bool(wl.is_active),
        last_checked_at=wl.last_checked_at.isoformat() if wl.last_checked_at else None,
        created_by=wl.created_by,
        created_at=wl.created_at.isoformat() if wl.created_at else "",
        updated_at=wl.updated_at.isoformat() if wl.updated_at else "",
    )


@router.get("/search", response_model=BiddingSearchResponse)
def search_tenders(
    keyword: str = Query("", description="Từ khóa tìm kiếm gói thầu/bên mời thầu/mã TBMT"),
    province: str = Query("", description="Địa bàn / Tỉnh thành"),
    field: str = Query("", description="Lĩnh vực (HH, XL, TV, PTV, HHOP)"),
    min_price: float | None = Query(None, description="Giá gói thầu tối thiểu (VND)"),
    max_price: float | None = Query(None, description="Giá gói thầu tối đa (VND)"),
    method: str = Query("", description="Hình thức lựa chọn nhà thầu"),
    page: int = Query(1, ge=1, description="Trang (1-indexed)"),
    page_size: int = Query(10, ge=1, le=100, description="Số kết quả mỗi trang"),
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
) -> BiddingSearchResponse:
    """Tra cuu danh sach goi thau tu Mua Sam Cong e-GP (hoac Smart Mock fallback)."""
    require_full_portal(user)
    if min_price is not None and max_price is not None and min_price > max_price:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Giá tối thiểu không được lớn hơn giá tối đa",
        )

    res = bidding.search_muasamcong_tenders(
        keyword=keyword,
        province=province,
        field=field,
        min_price=min_price,
        max_price=max_price,
        method=method,
        page=page,
        page_size=page_size,
        db=db,
    )
    return BiddingSearchResponse(**res)


@router.get("/tenders/{tbmt_code}", response_model=TenderItemOut)
def get_tender_detail(
    tbmt_code: str,
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
) -> TenderItemOut:
    """Lay chi tiet goi thau theo ma TBMT."""
    require_full_portal(user)
    detail = bidding.get_tender_details(tbmt_code, db=db)
    if detail is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Không tìm thấy thông tin gói thầu {tbmt_code}",
        )
    return TenderItemOut(**detail)


@router.get("/tenders/{tbmt_code}/html-preview", response_class=HTMLResponse)
def get_tender_html_preview(
    tbmt_code: str,
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
) -> HTMLResponse:
    """Sinh ma HTML giao dien E-HSMT chuan Cổng Mua Sam Cong e-GP de xem truc tiep hoac nhung iframe."""
    require_full_portal(user)
    detail = bidding.get_tender_details(tbmt_code, db=db)
    if detail is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Không tìm thấy thông tin gói thầu {tbmt_code}",
        )
    html_content = bidding.generate_tender_html_preview(detail)
    return HTMLResponse(content=html_content, status_code=200)



@router.post("/tenders/{tbmt_code}/analyze-ai", response_model=BiddingAIAnalyzeResponse)
def analyze_tender_with_ai(
    tbmt_code: str,
    body: BiddingAIAnalyzeRequest = BiddingAIAnalyzeRequest(),
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> BiddingAIAnalyzeResponse:
    """Su dung AI phan tich ho so moi thau & danh gia do phu hop nang luc INUT."""
    require_full_portal(user)
    tender_data = bidding.get_tender_details(tbmt_code, db=db)
    if tender_data is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Không tìm thấy gói thầu {tbmt_code} để phân tích",
        )

    analysis = bidding.ai_analyze_tender(settings, tender_data, body.custom_context)

    # Neu goi thau da duoc bookmark thi tu dong luu AI summary vao bookmark do
    saved_to_bookmark = False
    bm = bidding.get_bookmark_by_tbmt(db, tbmt_code)
    if bm is not None:
        bm.ai_summary = json.dumps(analysis, ensure_ascii=False)
        db.commit()
        saved_to_bookmark = True

    return BiddingAIAnalyzeResponse(
        tbmt_code=tbmt_code,
        analysis=analysis,
        saved_to_bookmark=saved_to_bookmark,
    )


# --- Bookmark Endpoints ---

@router.get("/bookmarks", response_model=BiddingBookmarkListOut)
def list_bookmarks(
    status_filter: str = Query("", alias="status", description="Lọc theo trạng thái pipeline"),
    field: str = Query("", description="Lọc theo lĩnh vực"),
    search: str = Query("", description="Tìm kiếm từ khóa"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
) -> BiddingBookmarkListOut:
    """Lay danh sach cac goi thau dang quan tam / theo doi."""
    require_full_portal(user)
    items, total = bidding.list_bookmarks(
        db, status=status_filter, field=field, search=search, limit=limit, offset=offset
    )
    return BiddingBookmarkListOut(
        items=[_bookmark_to_out(item) for item in items],
        total=total,
    )


@router.post("/bookmarks", response_model=BiddingBookmarkOut, status_code=status.HTTP_201_CREATED)
def create_bookmark(
    body: BiddingBookmarkCreate,
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
) -> BiddingBookmarkOut:
    """Luu 1 goi thau vao danh sach quan tam (Bookmark / Pipeline)."""
    require_full_portal(user)
    if body.status and body.status not in ALLOWED_BOOKMARK_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Trạng thái không hợp lệ: {body.status}. Hợp lệ: {ALLOWED_BOOKMARK_STATUSES}",
        )
    bm = bidding.create_bookmark(db, body.model_dump(), user_id=user.id)
    return _bookmark_to_out(bm)


@router.get("/bookmarks/{id}", response_model=BiddingBookmarkOut)
def get_bookmark(
    id: int,
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
) -> BiddingBookmarkOut:
    """Xem chi tiet 1 bookmark."""
    require_full_portal(user)
    bm = bidding.get_bookmark(db, id)
    if bm is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Không tìm thấy bookmark id={id}",
        )
    return _bookmark_to_out(bm)


@router.put("/bookmarks/{id}", response_model=BiddingBookmarkOut)
def update_bookmark(
    id: int,
    body: BiddingBookmarkUpdate,
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
) -> BiddingBookmarkOut:
    """Cap nhat trang thai pipeline, ghi chu, hoac AI summary cua bookmark."""
    require_full_portal(user)
    if body.status is not None and body.status not in ALLOWED_BOOKMARK_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Trạng thái không hợp lệ: {body.status}. Hợp lệ: {ALLOWED_BOOKMARK_STATUSES}",
        )
    update_data = body.model_dump(exclude_unset=True)
    bm = bidding.update_bookmark(db, id, update_data)
    if bm is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Không tìm thấy bookmark id={id}",
        )
    return _bookmark_to_out(bm)


@router.delete("/bookmarks/{id}")
def delete_bookmark(
    id: int,
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    """Xoa goi thau khoi danh sach bookmark."""
    require_full_portal(user)
    ok = bidding.delete_bookmark(db, id)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Không tìm thấy bookmark id={id}",
        )
    return {"ok": True, "message": "Đã xóa bookmark thành công"}


# --- Watchlist Endpoints ---

@router.get("/watchlist", response_model=BiddingWatchlistListOut)
def list_watchlists(
    is_active: bool | None = Query(None, description="Lọc theo trạng thái kích hoạt"),
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
) -> BiddingWatchlistListOut:
    """Lay danh sach cac quy tac theo doi tu dong (Watchlist)."""
    require_full_portal(user)
    watchlists = bidding.list_watchlists(db, is_active=is_active)
    return BiddingWatchlistListOut(
        items=[_watchlist_to_out(wl) for wl in watchlists],
        total=len(watchlists),
    )


@router.post("/watchlist", response_model=BiddingWatchlistOut, status_code=status.HTTP_201_CREATED)
def create_watchlist(
    body: BiddingWatchlistCreate,
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
) -> BiddingWatchlistOut:
    """Tao moi 1 quy tac theo doi tu dong (Watchlist & Canh bao Telegram)."""
    require_full_portal(user)
    if not body.name.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tên bộ lọc không được để trống",
        )
    wl = bidding.create_watchlist(db, body.model_dump(), user_id=user.id)
    return _watchlist_to_out(wl)


@router.get("/watchlist/{id}", response_model=BiddingWatchlistOut)
def get_watchlist(
    id: int,
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
) -> BiddingWatchlistOut:
    """Xem chi tiet 1 quy tac watchlist."""
    require_full_portal(user)
    wl = bidding.get_watchlist(db, id)
    if wl is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Không tìm thấy watchlist id={id}",
        )
    return _watchlist_to_out(wl)


@router.put("/watchlist/{id}", response_model=BiddingWatchlistOut)
def update_watchlist(
    id: int,
    body: BiddingWatchlistUpdate,
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
) -> BiddingWatchlistOut:
    """Sua doi quy tac theo doi watchlist."""
    require_full_portal(user)
    update_data = body.model_dump(exclude_unset=True)
    wl = bidding.update_watchlist(db, id, update_data)
    if wl is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Không tìm thấy watchlist id={id}",
        )
    return _watchlist_to_out(wl)


@router.delete("/watchlist/{id}")
def delete_watchlist(
    id: int,
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    """Xoa quy tac watchlist."""
    require_full_portal(user)
    ok = bidding.delete_watchlist(db, id)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Không tìm thấy watchlist id={id}",
        )
    return {"ok": True, "message": "Đã xóa quy tắc watchlist thành công"}


@router.post("/watchlist/{id}/scan", response_model=BiddingScanResultOut)
def scan_single_watchlist(
    id: int,
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> BiddingScanResultOut:
    """Kich hoat quet thu cong ngay lap tuc cho 1 watchlist."""
    require_full_portal(user)
    wl = bidding.get_watchlist(db, id)
    if wl is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Không tìm thấy watchlist id={id}",
        )
    res = bidding.run_watchlist_scan(db, settings, watchlist_id=id)
    return BiddingScanResultOut(**res)


@router.post("/watchlist/scan-all", response_model=BiddingScanResultOut)
@router.post("/scan-all", response_model=BiddingScanResultOut)
def scan_all_watchlists(
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> BiddingScanResultOut:
    """Kich hoat quet toan bo cac watchlist dang hoat dong."""
    require_full_portal(user)
    res = bidding.run_watchlist_scan(db, settings)
    return BiddingScanResultOut(**res)


# ─── 🏢 CONTRACTOR BIDDING INTELLIGENCE ENDPOINTS ─────────────────────────────

@router.get("/contractors/crm-scan")
def scan_crm_contractors(
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    """Quet toan bo khach hang CRM cua INUT va doi soat ho so nang luc dau thau."""
    require_full_portal(user)
    return bidding.ContractorBiddingService.scan_crm_contractors(db)


@router.get("/contractors/search")
def search_contractors(
    query: str = Query(..., description="Ten cong ty hoac Ma So Thue can tra cuu"),
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
) -> list[dict[str, Any]]:
    """Tra cuu ho so nha thau theo ten hoac ma so thue."""
    require_full_portal(user)
    return bidding.ContractorBiddingService.search_contractors(query, db)


@router.get("/contractors/{tax_code}")
def get_contractor_profile(
    tax_code: str,
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    """Lay chi tiet ho so nha thau va danh sach goi thau da tham gia."""
    require_full_portal(user)
    profile = bidding.ContractorBiddingService.get_or_create_contractor_profile(tax_code)
    return profile


# ─── 📚 WON PACKAGES & STRATEGIC PLAYBOOK ENDPOINTS ───────────────────────────

@router.get("/won-packages")
def get_won_packages(
    query: str = Query("", description="Tu khoa tim kiem goi thau da trung"),
    field: str = Query("", description="Linh vuc goi thau (HH, XL, TV, PTV, HHOP)"),
    user: CurrentUser = Depends(require_user),
) -> dict[str, Any]:
    """Lay danh sach tat ca cac goi thau da trung cua cac nha thau lon de hoc tap."""
    require_full_portal(user)
    return bidding.BiddingPlaybookService.get_won_packages(query, field)


@router.get("/playbook")
def get_inut_bidding_playbook(
    user: CurrentUser = Depends(require_user),
) -> dict[str, Any]:
    """Lay cam nang chien luoc dau thau, cac bo kit E-HSDT chuan mau danh rieng cho INUT."""
    require_full_portal(user)
    return bidding.BiddingPlaybookService.get_inut_playbook()


# ─── 📎 E-HSMT ATTACHMENTS & FULL DOSSIER DOWNLOAD ENDPOINTS ──────────────────

@router.get("/tenders/{tbmt_code}/attachments")
def list_tender_attachments(
    tbmt_code: str,
    user: CurrentUser = Depends(require_user),
) -> list[dict[str, Any]]:
    """Lay danh sach tat ca cac file dinh kem E-HSMT (PDF/DOCX) co the tai ve."""
    require_full_portal(user)
    tender = bidding.get_tender_detail(tbmt_code) or {}
    return bidding.BiddingAttachmentService.get_attachments(tbmt_code, tender)


@router.get("/tenders/{tbmt_code}/attachments/{file_id}/download")
def download_tender_attachment(
    tbmt_code: str,
    file_id: str,
    user: CurrentUser = Depends(require_user),
) -> Response:
    """Tai file dinh kem cu the (PDF/DOCX) cua goi thau."""
    require_full_portal(user)
    tender = bidding.get_tender_detail(tbmt_code) or {}
    content_bytes, mime_type, filename = bidding.BiddingAttachmentService.generate_attachment_bytes(tbmt_code, file_id, tender)
    return Response(
        content=content_bytes,
        media_type=mime_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache",
        },
    )


@router.get("/tenders/{tbmt_code}/download-all-zip")
def download_full_tender_dossier_zip(
    tbmt_code: str,
    user: CurrentUser = Depends(require_user),
) -> Response:
    """Tai tron bo ho so E-HSMT bao gom tat ca file PDF va Word dinh kem duoi dang file ZIP."""
    require_full_portal(user)
    tender = bidding.get_tender_detail(tbmt_code) or {}
    zip_bytes, zip_filename = bidding.BiddingAttachmentService.generate_full_dossier_zip(tbmt_code, tender)
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{zip_filename}"',
            "Cache-Control": "no-cache",
        },
    )


# ─── 👥 COMPETITOR E-HSDT DOSSIER DOWNLOAD ENDPOINTS ─────────────────────────

@router.get("/tenders/{tbmt_code}/competitors")
def list_tender_competitors(
    tbmt_code: str,
    user: CurrentUser = Depends(require_user),
) -> list[dict[str, Any]]:
    """Lay danh sach cac nha thau doi thu da tham gia nop E-HSDT cho goi thau."""
    require_full_portal(user)
    tender = bidding.get_tender_detail(tbmt_code) or {}
    return bidding.CompetitorDossierService.get_competitors(tbmt_code, tender)


@router.get("/tenders/{tbmt_code}/competitors/{tax_code}/files/{file_id}/download")
def download_competitor_file(
    tbmt_code: str,
    tax_code: str,
    file_id: str,
    user: CurrentUser = Depends(require_user),
) -> Response:
    """Tai 1 file E-HSDT cu the cua nha thau doi thu."""
    require_full_portal(user)
    tender = bidding.get_tender_detail(tbmt_code) or {}
    content_bytes, mime_type, filename = bidding.CompetitorDossierService.generate_competitor_file_bytes(
        tbmt_code, tax_code, file_id, tender
    )
    return Response(
        content=content_bytes,
        media_type=mime_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache",
        },
    )


@router.get("/tenders/{tbmt_code}/competitors/download-all-zip")
def download_all_competitors_dossier_zip(
    tbmt_code: str,
    user: CurrentUser = Depends(require_user),
) -> Response:
    """Tai tron bo E-HSDT cua TAT CA cac nha thau tham gia goi thau (ZIP)."""
    require_full_portal(user)
    tender = bidding.get_tender_detail(tbmt_code) or {}
    zip_bytes, zip_filename = bidding.CompetitorDossierService.generate_all_competitors_zip(tbmt_code, tender)
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{zip_filename}"',
            "Cache-Control": "no-cache",
        },
    )
