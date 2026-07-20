"""Xuat Excel/ZIP cho danh sach ton kho (mua vao / ban ra / xuat kho / san xuat)."""
from __future__ import annotations

import io
import re
import zipfile

from fastapi.responses import StreamingResponse
from openpyxl import Workbook

_BAD_FS_CHARS = re.compile(r'[\\/:*?"<>|]')


def sanitize_arcname(name: str) -> str:
    """Bo ky tu cam trong ten file he thong (giu dau tieng Viet)."""
    return _BAD_FS_CHARS.sub("_", name).strip() or "file"


def _ascii_filename(name: str) -> str:
    """Content-Disposition an toan (bo dau, giu duoi file) - giong _content_disposition o main.py."""
    return name.encode("ascii", "ignore").decode() or "export"


def xlsx_response(sheets: list[tuple[str, list[str], list[list]]], filename: str) -> StreamingResponse:
    """sheets: [(ten_sheet, headers, rows), ...] -> file .xlsx (nhieu sheet)."""
    wb = Workbook()
    wb.remove(wb.active)
    for name, headers, rows in sheets:
        ws = wb.create_sheet(title=name[:31])  # excel gioi han 31 ky tu/sheet
        ws.append(headers)
        for row in rows:
            ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{_ascii_filename(filename)}"'},
    )


def zip_response(files: list[tuple[str, bytes]], filename: str) -> StreamingResponse:
    """files: [(arcname, content), ...] -> zip trong bo nho. Ten trung -> them hau to ' (2)', ' (3)'..."""
    buf = io.BytesIO()
    seen: dict[str, int] = {}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in files:
            if name in seen:
                seen[name] += 1
                stem, dot, ext = name.rpartition(".")
                arc = f"{stem} ({seen[name]}){dot}{ext}" if dot else f"{name} ({seen[name]})"
            else:
                seen[name] = 1
                arc = name
            zf.writestr(arc, content)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{_ascii_filename(filename)}"'},
    )
