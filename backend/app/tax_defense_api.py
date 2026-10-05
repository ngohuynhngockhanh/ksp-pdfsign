"""FastAPI Router cho Phân hệ Giải trình Thuế (Tax Defense & Audit Cockpit)."""
from __future__ import annotations

import logging
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from . import tax_defense
from .auth import CurrentUser, require_admin
from .db import get_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tax-defense", tags=["tax_defense"])


@router.get("/overview")
def get_overview(
    years: str = Query(default="2022,2023,2024,2025,2026", description="Danh sách năm phẩy ngăn cách"),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Ma trận tổng quan Doanh thu, Chi phí, Thuế GTGT và các tỷ số tài chính thuế theo từng năm."""
    year_list = [y.strip() for y in years.split(",") if y.strip()]
    try:
        return tax_defense.get_tax_defense_overview(db, year_list)
    except Exception as e:
        logger.exception("Lỗi tính ma trận giải trình thuế: %s", e)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Lỗi tính toán: {e}")


@router.get("/justification-dossier")
def get_justification_dossier(
    years: str = Query(default="2022,2023,2024,2025", description="Danh sách năm cần giải trình"),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Tự động kết xuất Bản Thuyết Minh Giải Trình Thanh Tra Thuế hoàn chỉnh viện dẫn đầy đủ luật định."""
    year_list = [y.strip() for y in years.split(",") if y.strip()]
    try:
        return tax_defense.generate_tax_justification_dossier(db, year_list)
    except Exception as e:
        logger.exception("Lỗi sinh bản thuyết minh giải trình thuế: %s", e)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Lỗi sinh thuyết minh: {e}")


@router.get("/export-excel")
def export_excel(
    years: str = Query(default="2022,2023,2024,2025,2026"),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Tải tệp Excel Báo cáo Giải trình Thuế Toàn diện 2022-2025 (4 Sheets chuyên nghiệp)."""
    year_list = [y.strip() for y in years.split(",") if y.strip()]
    try:
        buf = tax_defense.export_tax_defense_excel(db, year_list)
        filename = f"BAO_CAO_GIAI_TRINH_THUE_INUT_{'_'.join(year_list[:4])}.xlsx"
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
        )
    except Exception as e:
        logger.exception("Lỗi xuất Excel giải trình thuế: %s", e)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Lỗi xuất Excel: {e}")


@router.post("/import-historical-purchase")
async def import_historical_purchase(
    file: UploadFile = File(...),
    year: str = Query(default="2024", description="Năm của bảng kê mua vào"),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Nạp Bảng kê mua vào Excel (Mẫu 01-2/GTGT) cho các năm cũ để bổ sung cơ sở dữ liệu giải trình."""
    content = await file.read()
    if not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File tải lên rỗng")
    try:
        res = tax_defense.import_purchase_ledger_xlsx(db, content, year.strip())
        return res
    except Exception as e:
        logger.exception("Lỗi import bảng kê mua vào: %s", e)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Không thể đọc file: {e}")


@router.get("/partner-status")
def get_partner_status(
    years: str = Query(default="2022,2023,2024,2025,2026", description="Danh sách năm đối soát đối tác"),
    limit: int = Query(default=50, ge=1, le=200),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Rà soát tình trạng hoạt động (Trạng thái 06, 05, 03) của toàn bộ đối tác mua/bán."""
    year_list = [y.strip() for y in years.split(",") if y.strip()]
    try:
        return tax_defense.batch_check_partners_status(db, year_list, limit)
    except Exception as e:
        logger.exception("Lỗi rà soát tình trạng đối tác: %s", e)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Lỗi rà soát đối tác: {e}")


@router.get("/check-mst")
def check_single_mst(
    mst: str = Query(..., description="Mã số thuế cần kiểm tra"),
    user: CurrentUser = Depends(require_admin),
):
    """Tra cứu trực tiếp tình trạng hoạt động pháp lý của 1 Mã số thuế bất kỳ."""
    if not mst or not mst.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Vui lòng nhập Mã số thuế")
    return tax_defense.check_tax_code_status(mst)


@router.get("/investigation-blacklist")
def get_investigation_report(
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Chuyên đề rà soát doanh nghiệp điều tra mua bán hóa đơn theo Công văn 1798/TCT-TTKT."""
    try:
        return tax_defense.get_invoice_trading_investigation_report(db)
    except Exception as e:
        logger.exception("Lỗi báo cáo chuyên đề điều tra hóa đơn: %s", e)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Lỗi báo cáo: {e}")


@router.post("/sync-gdt-purchases")
def sync_gdt_purchases(
    from_year: int = Query(default=2022, ge=2022, le=2026),
    to_year: int = Query(default=2025, ge=2022, le=2026),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Đồng bộ vét bổ sung hóa đơn mua vào trực tiếp từ Cổng Tổng cục Thuế."""
    try:
        return tax_defense.sync_historical_purchases_from_gdt(db, from_year, to_year)
    except Exception as e:
        logger.exception("Lỗi đồng bộ hóa đơn mua từ Cổng Thuế: %s", e)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Lỗi đồng bộ: {e}")


@router.get("/accounting-fee-monitor")
def get_accounting_fee_monitor(
    ky: str | None = Query(default=None, description="Mã quý YYYY-Qx, ví dụ 2026-Q3. Mặc định là quý hiện tại."),
    count_bank: bool = Query(default=False, description="Đếm hóa đơn ngân hàng (mặc định False vì là chi phí tờ khai)"),
    customs_mode: str = Query(default="each", description="Cách tính tờ khai hải quan (each | one_per_quarter | none)"),
    user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_session),
):
    """Giám sát biểu phí dịch vụ kế toán và cảnh báo sớm khi còn <= 5 hóa đơn trước khi nhảy mốc."""
    from . import accounting_tier
    return accounting_tier.evaluate_accounting_fee_status(
        db, ky=ky, count_bank=count_bank, customs_mode=customs_mode
    )
