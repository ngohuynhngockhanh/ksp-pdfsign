"""FastAPI router cho máy in laser A4 Brother HL-L2320D trên máy Windows."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from . import brother_print
from .auth import CurrentUser, authenticate_loopback_bearer, require_user
from .config import Settings, get_settings
from .db import get_session
from .security_utils import error_detail
from .storage import read_upload_limited

router = APIRouter(tags=["brother-print"])


def require_brother_access(
    request: Request,
    settings: Settings = Depends(get_settings),
    db: Session = Depends(get_session),
) -> CurrentUser:
    """Chỉ cho phép Admin JWT hoặc loopback Bearer token hợp lệ."""
    svc_user = authenticate_loopback_bearer(request, db)
    if svc_user is not None:
        return svc_user
    user = require_user(request=request, settings=settings, db=db)
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Chỉ admin được phép điều khiển máy in A4")
    return user


class BrotherPrintOptions(BaseModel):
    host: str = Field(default=brother_print.DEFAULT_WINDOWS_HOST)
    printer_name: str = Field(default=brother_print.DEFAULT_BROTHER_PRINTER)
    paper_size: Literal["A4", "A5", "A6", "B5", "Letter", "Legal"] = Field(default="A4")
    duplex: Literal["simplex", "long", "short", "duplexlong", "duplexshort"] = Field(
        default="simplex",
        description="simplex (1 mặt), long/duplexlong (2 mặt lật cạnh dài), short/duplexshort (2 mặt lật cạnh ngắn)",
    )
    copies: int = Field(default=1, ge=1, le=50)
    page_range: str | None = Field(
        default=None,
        description="Khoảng trang cần in (vd: '1-3', '1,3,5-7', 'odd', 'even'). Bỏ trống = in tất cả.",
    )
    scale: Literal["fit", "shrink", "noscale"] = Field(default="fit")
    orientation: Literal["auto", "portrait", "landscape"] = Field(default="auto")
    tray: Literal["auto", "tray1", "manual"] = Field(default="auto")
    prefer_signed: bool = Field(
        default=True,
        description="Ưu tiên in bản PDF đã ký số (signed_upload_id) nếu hồ sơ đã có.",
    )
    dry_run: bool = Field(default=False)


class CancelJobsRequest(BaseModel):
    host: str = Field(default=brother_print.DEFAULT_WINDOWS_HOST)
    printer_name: str = Field(default=brother_print.DEFAULT_BROTHER_PRINTER)
    job_id: int | None = Field(default=None, ge=1)


@router.get("/api/brother/printers")
def get_windows_printers(
    host: str = Query(default=brother_print.DEFAULT_WINDOWS_HOST),
    user: CurrentUser = Depends(require_brother_access),
):
    """Liệt kê danh sách máy in thực tế trên Windows kèm khổ giấy, duplex và trạng thái."""
    try:
        return brother_print.list_windows_printers(host=host)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=error_detail("Lỗi kiểm tra danh sách máy in Windows", e, "ksp.brother_print"),
        )


@router.get("/api/brother/jobs")
def get_brother_jobs(
    host: str = Query(default=brother_print.DEFAULT_WINDOWS_HOST),
    printer_name: str = Query(default=brother_print.DEFAULT_BROTHER_PRINTER),
    user: CurrentUser = Depends(require_brother_access),
):
    """Xem hàng đợi lệnh in hiện tại của máy in Brother."""
    try:
        return brother_print.get_printer_jobs(host=host, printer_name=printer_name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=error_detail("Lỗi đọc hàng đợi máy in", e, "ksp.brother_print"),
        )


@router.post("/api/brother/jobs/cancel")
def cancel_brother_jobs(
    payload: CancelJobsRequest,
    user: CurrentUser = Depends(require_brother_access),
):
    """Hủy 1 lệnh in cụ thể hoặc toàn bộ lệnh bị treo trên máy in."""
    try:
        return brother_print.cancel_printer_jobs(
            host=payload.host,
            printer_name=payload.printer_name,
            job_id=payload.job_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=error_detail("Lỗi hủy lệnh in", e, "ksp.brother_print"),
        )


@router.post("/api/brother/print-document/{doc_pk}")
@router.post("/api/documents/{doc_pk}/print")
def print_document_a4(
    doc_pk: int,
    payload: BrotherPrintOptions = BrotherPrintOptions(),
    user: CurrentUser = Depends(require_brother_access),
    db: Session = Depends(get_session),
):
    """In một hồ sơ PDF trong KSP PDFSign (theo ID) ra máy in A4 Brother HL-L2320D."""
    try:
        return brother_print.print_ksp_document_a4(
            db,
            doc_pk,
            prefer_signed=payload.prefer_signed,
            host=payload.host,
            printer_name=payload.printer_name,
            paper_size=payload.paper_size,
            duplex=payload.duplex,
            copies=payload.copies,
            page_range=payload.page_range,
            scale=payload.scale,
            orientation=payload.orientation,
            tray=payload.tray,
            dry_run=payload.dry_run,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        msg = str(e)
        code = 404 if "Không tìm thấy hồ sơ" in msg else 400
        raise HTTPException(status_code=code, detail=msg)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=error_detail("Lỗi gửi lệnh in A4 sang máy Brother", e, "ksp.brother_print"),
        )


@router.post("/api/brother/print-upload")
async def print_uploaded_pdf_a4(
    file: UploadFile = File(...),
    host: str = Form(default=brother_print.DEFAULT_WINDOWS_HOST),
    printer_name: str = Form(default=brother_print.DEFAULT_BROTHER_PRINTER),
    paper_size: str = Form(default="A4"),
    duplex: str = Form(default="simplex"),
    copies: int = Form(default=1),
    page_range: str | None = Form(default=None),
    scale: str = Form(default="fit"),
    orientation: str = Form(default="auto"),
    tray: str = Form(default="auto"),
    dry_run: bool = Form(default=False),
    user: CurrentUser = Depends(require_brother_access),
):
    """Upload trực tiếp 1 tệp PDF và in khổ A4 ra máy in Brother HL-L2320D."""
    pdf_bytes = await read_upload_limited(file, max_bytes=brother_print.MAX_PDF_BYTES)
    try:
        return brother_print.print_pdf_bytes_a4(
            pdf_bytes,
            filename=file.filename or "upload.pdf",
            host=host,
            printer_name=printer_name,
            paper_size=paper_size,
            duplex=duplex,
            copies=copies,
            page_range=page_range,
            scale=scale,
            orientation=orientation,
            tray=tray,
            dry_run=dry_run,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=error_detail("Lỗi in tệp PDF tải lên ra máy Brother", e, "ksp.brother_print"),
        )
