"""Bộ dựng xem trước (Preview) tài liệu Microsoft Excel (.xlsx/.xls) chuẩn giao diện KSP.

Hỗ trợ:
- Phân tích cú pháp bảng tính đa sheet qua openpyxl (giá trị đã tính toán, ô gộp rowspan/colspan, định dạng).
- Giao diện xem trước trực tuyến (HTML5 tự chứa, zero CDN ngoài, tương thích tuyệt đối CSP):
  + Thanh điều hướng chuyển Sheet linh hoạt (Tabs đa bảng tính).
  + Khung lưới bảng tính hiển thị hàng/cột rõ ràng, hỗ trợ cuộn ngang/dọc mượt mà.
  + Nút tải file Excel gốc (.xlsx) và kết xuất PDF khổ in văn bản.
- Kết xuất bản in PDF sắc nét thông qua LibreOffice headless hoặc WeasyPrint dự phòng.
"""
from __future__ import annotations

import html
import io
import os
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import Any

import openpyxl


def is_valid_xlsx(data: bytes) -> bool:
    """Kiểm tra nhanh magic bytes ZIP và sự tồn tại của xl/workbook.xml."""
    if not data or not data.startswith(b"PK"):
        return False
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            names = zf.namelist()
            return "xl/workbook.xml" in names or any(n.startswith("xl/") for n in names)
    except Exception:
        return False


def render_xlsx_to_pdf_bytes(xlsx_bytes: bytes, *, title: str = "Bảng tính Excel (.xlsx)") -> bytes:
    """Kết xuất file .xlsx sang bản PDF chuẩn qua LibreOffice headless."""
    soffice_bin = shutil.which("soffice") or shutil.which("libreoffice") or "/home/ksp/.local/bin/soffice"
    if soffice_bin and Path(soffice_bin).exists():
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_in = Path(tmpdir) / "document.xlsx"
            tmp_in.write_bytes(xlsx_bytes)
            cmd = [
                str(soffice_bin),
                "--headless",
                "--convert-to",
                "pdf",
                "--outdir",
                tmpdir,
                str(tmp_in),
            ]
            try:
                proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45, check=True)
                pdf_out = Path(tmpdir) / "document.pdf"
                if pdf_out.exists():
                    return pdf_out.read_bytes()
            except Exception:
                pass

    # Fallback WeasyPrint nếu LibreOffice gặp sự cố
    try:
        import weasyprint
        html_content = render_xlsx_preview_html(xlsx_bytes, title=title, is_print=True)
        return weasyprint.HTML(string=html_content).write_pdf()
    except Exception as e:
        raise RuntimeError(f"Không thể kết xuất PDF từ file Excel: {e}") from e


def _format_cell_value(val: Any) -> str:
    if val is None:
        return ""
    if isinstance(val, float):
        if val.is_integer():
            return f"{int(val):,}".replace(",", ".")
        return f"{val:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    if isinstance(val, int):
        return f"{val:,}".replace(",", ".")
    s = str(val).strip()
    return html.escape(s).replace("\n", "<br/>")


def render_xlsx_preview_html(
    xlsx_bytes: bytes,
    *,
    title: str,
    download_url: str = "",
    pdf_url: str = "",
    is_print: bool = False,
) -> str:
    """Tạo trang HTML xem trước bảng tính Excel đa sheet."""
    try:
        wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), data_only=True)
    except Exception:
        wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), data_only=False)

    escaped_title = html.escape(title)
    sheet_tabs_html = []
    sheet_tables_html = []

    for s_idx, name in enumerate(wb.sheetnames):
        ws = wb[name]
        is_active = s_idx == 0
        active_class = "active" if is_active else ""
        escaped_name = html.escape(name)
        sheet_id = f"sheet-{s_idx}"

        sheet_tabs_html.append(
            f'<button type="button" class="tab-btn {active_class}" onclick="switchSheet(\'{sheet_id}\', this)">'
            f'📊 {escaped_name}'
            f'</button>'
        )

        # Tính merged cells
        merged_map: dict[tuple[int, int], tuple[int, int]] = {}  # (r, c) -> (rowspan, colspan)
        covered_cells: set[tuple[int, int]] = set()

        for rng in ws.merged_cells.ranges:
            min_r, min_c, max_r, max_c = rng.min_row, rng.min_col, rng.max_row, rng.max_col
            merged_map[(min_r, min_c)] = (max_r - min_r + 1, max_c - min_c + 1)
            for r in range(min_r, max_r + 1):
                for c in range(min_c, max_c + 1):
                    if (r, c) != (min_r, min_c):
                        covered_cells.add((r, c))

        # Tìm phạm vi hàng/cột có dữ liệu thực tế
        max_r = ws.max_row
        max_c = ws.max_column
        
        # Bỏ các cột trống vượt quá (giới hạn an toàn)
        actual_max_c = 1
        actual_max_r = 1
        for r in range(1, max_r + 1):
            for c in range(1, min(max_c + 1, 60)):
                if ws.cell(r, c).value is not None:
                    actual_max_c = max(actual_max_c, c)
                    actual_max_r = max(actual_max_r, r)

        rows_html = []
        for r in range(1, actual_max_r + 1):
            cells_html = []
            has_row_data = False
            for c in range(1, actual_max_c + 1):
                if (r, c) in covered_cells:
                    continue
                cell = ws.cell(r, c)
                val_str = _format_cell_value(cell.value)
                if val_str:
                    has_row_data = True
                
                attrs = []
                if (r, c) in merged_map:
                    rowspan, colspan = merged_map[(r, c)]
                    if rowspan > 1:
                        attrs.append(f'rowspan="{rowspan}"')
                    if colspan > 1:
                        attrs.append(f'colspan="{colspan}"')

                # Căn lề sơ bộ: số căn phải, chữ căn trái
                align_style = ""
                if isinstance(cell.value, (int, float)):
                    align_style = "text-align: right;"
                elif r <= 5 or (r, c) in merged_map:
                    align_style = "font-weight: 500;"

                attr_str = " ".join(attrs)
                style_str = f'style="{align_style}"' if align_style else ""
                cells_html.append(f'<td {attr_str} {style_str}>{val_str}</td>')

            # Hàng đầu tiên thêm chỉ mục hàng (Row Index)
            r_idx_td = f'<td class="row-num">{r}</td>'
            rows_html.append(f"<tr>{r_idx_td}{''.join(cells_html)}</tr>")

        # Tiêu đề cột A, B, C...
        col_headers = [f'<th class="col-num">{openpyxl.utils.get_column_letter(c)}</th>' for c in range(1, actual_max_c + 1)]
        col_header_row = f'<tr><th class="corner-cell"></th>{"".join(col_headers)}</tr>'

        display_style = "block" if is_active else "none"
        sheet_tables_html.append(
            f'<div id="{sheet_id}" class="sheet-pane" style="display:{display_style};">'
            f'<div class="table-scroll">'
            f'<table class="excel-table">'
            f'<thead>{col_header_row}</thead>'
            f'<tbody>{"".join(rows_html)}</tbody>'
            f'</table>'
            f'</div>'
            f'</div>'
        )

    action_buttons = []
    if pdf_url:
        action_buttons.append(f'<a class="btn primary" href="{pdf_url}" target="_blank">📑 Bản in PDF</a>')
    if download_url:
        action_buttons.append(f'<a class="btn secondary" href="{download_url}">⬇️ Tải file Excel (.xlsx)</a>')

    return f"""<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escaped_title} — KSP Preview</title>
  <style>
    :root {{
      --bg: #f8fafc;
      --surface: #ffffff;
      --border: #e2e8f0;
      --border-dark: #cbd5e1;
      --text: #0f172a;
      --muted: #64748b;
      --primary: #0284c7;
      --primary-hover: #0369a1;
      --header-bg: #f1f5f9;
      --row-alt: #fcfdfe;
    }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }}
    .topbar {{
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 10px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-shrink: 0;
    }}
    .title-group {{
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }}
    .title-icon {{
      font-size: 20px;
    }}
    .doc-title {{
      font-size: 15px;
      font-weight: 600;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }}
    .actions {{
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }}
    .btn {{
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 500;
      padding: 6px 14px;
      border-radius: 6px;
      text-decoration: none;
      cursor: pointer;
      transition: all 0.15s ease;
      border: 1px solid transparent;
    }}
    .btn.primary {{
      background: #0284c7;
      color: #fff;
    }}
    .btn.primary:hover {{
      background: #0369a1;
    }}
    .btn.secondary {{
      background: var(--surface);
      color: #334155;
      border-color: var(--border-dark);
    }}
    .btn.secondary:hover {{
      background: #f1f5f9;
      color: #0f172a;
    }}
    .tabs-bar {{
      background: #f1f5f9;
      border-bottom: 1px solid var(--border);
      padding: 6px 14px 0 14px;
      display: flex;
      gap: 4px;
      overflow-x: auto;
      flex-shrink: 0;
    }}
    .tab-btn {{
      padding: 7px 16px;
      font-size: 13px;
      font-weight: 500;
      color: var(--muted);
      background: transparent;
      border: 1px solid transparent;
      border-bottom: none;
      border-radius: 6px 6px 0 0;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.12s ease;
    }}
    .tab-btn:hover {{
      color: var(--text);
      background: rgba(255, 255, 255, 0.6);
    }}
    .tab-btn.active {{
      color: #0284c7;
      background: var(--surface);
      border-color: var(--border);
      font-weight: 600;
      box-shadow: 0 -1px 2px rgba(0,0,0,0.03);
    }}
    .main-content {{
      flex: 1;
      position: relative;
      overflow: hidden;
      background: var(--surface);
    }}
    .sheet-pane {{
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
    }}
    .table-scroll {{
      width: 100%;
      height: 100%;
      overflow: auto;
    }}
    .excel-table {{
      border-collapse: collapse;
      font-size: 12.5px;
      background: var(--surface);
      min-width: 100%;
    }}
    .excel-table th, .excel-table td {{
      border: 1px solid var(--border);
      padding: 5px 8px;
      line-height: 1.45;
      vertical-align: middle;
    }}
    .excel-table thead th {{
      position: sticky;
      top: 0;
      background: #e2e8f0;
      color: #475569;
      font-weight: 600;
      text-align: center;
      z-index: 2;
    }}
    .excel-table .row-num {{
      position: sticky;
      left: 0;
      background: #e2e8f0;
      color: #475569;
      font-weight: 600;
      text-align: center;
      width: 38px;
      min-width: 38px;
      user-select: none;
      z-index: 1;
    }}
    .excel-table thead .corner-cell {{
      position: sticky;
      top: 0;
      left: 0;
      background: #cbd5e1;
      z-index: 3;
      width: 38px;
      min-width: 38px;
    }}
    .excel-table tbody tr:nth-child(even) td:not(.row-num) {{
      background: var(--row-alt);
    }}
    .excel-table tbody tr:hover td:not(.row-num) {{
      background: #f0fdf4 !important;
    }}
  </style>
</head>
<body>
  <div class="topbar">
    <div class="title-group">
      <span class="title-icon">📊</span>
      <span class="doc-title">{escaped_title}</span>
    </div>
    <div class="actions">
      {''.join(action_buttons)}
    </div>
  </div>
  <div class="tabs-bar">
    {''.join(sheet_tabs_html)}
  </div>
  <div class="main-content">
    {''.join(sheet_tables_html)}
  </div>
  <script>
    function switchSheet(sheetId, btn) {{
      document.querySelectorAll('.sheet-pane').forEach(function(el) {{
        el.style.display = 'none';
      }});
      document.querySelectorAll('.tab-btn').forEach(function(el) {{
        el.classList.remove('active');
      }});
      var target = document.getElementById(sheetId);
      if (target) {{
        target.style.display = 'block';
      }}
      if (btn) {{
        btn.classList.add('active');
      }}
    }}
  </script>
</body>
</html>
"""
