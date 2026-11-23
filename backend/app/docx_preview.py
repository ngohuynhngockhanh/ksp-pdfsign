"""Bộ dựng xem trước (Preview) tài liệu Microsoft Word (.docx) chuẩn trang A4 cho ksp-pdfsign.

Chuyển đổi trực tiếp cấu trúc OOXML (Paragraphs, Runs, Hyperlinks, Tables có gộp ô ngang/dọc,
màu nền ô w:shd, viền bảng, màu chữ RGB, kích thước font, ảnh nhúng base64, Header/Footer)
sang giao diện đọc trang giấy A4 sắc nét (HTML5 tự chứa, không phụ thuộc CDN ngoài) và hỗ trợ
kết xuất sang PDF qua WeasyPrint khi cần in ấn/lưu trữ.
"""
from __future__ import annotations

import base64
import html
import io
from typing import Any

import docx
from docx.document import Document as DocxDocument
from docx.oxml.ns import qn
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table
from docx.text.paragraph import Paragraph


def is_valid_docx(data: bytes) -> bool:
    """Kiểm tra nhanh magic bytes ZIP và sự tồn tại của word/document.xml."""
    if not data or not data.startswith(b"PK"):
        return False
    import zipfile

    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            return "word/document.xml" in zf.namelist()
    except Exception:
        return False


def _luminance(hex_rgb: str) -> float:
    h = hex_rgb.lstrip("#")
    if len(h) != 6:
        return 1.0
    try:
        r, g, b = int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    except ValueError:
        return 1.0


def _clean_hex(val: str | None) -> str | None:
    if not val:
        return None
    v = val.strip().lstrip("#").upper()
    if v in ("AUTO", "NONE", "NIL", "00000000"):
        return None
    if len(v) == 6 and all(c in "0123456789ABCDEF" for c in v):
        return f"#{v}"
    return None


def _extract_run_images(run_el, doc_part) -> list[str]:
    """Trích xuất các ảnh inline/anchor trong w:r thành thẻ <img> data URI."""
    imgs: list[str] = []
    blips = run_el.xpath(".//*[local-name()='blip']")
    extents = run_el.xpath(".//*[local-name()='extent']")
    width_px: int | None = None
    if extents:
        cx = extents[0].get("cx")
        if cx and cx.isdigit():
            width_px = max(24, min(680, round(int(cx) / 9525)))

    rel_attr = qn("r:embed")
    for blip in blips:
        r_id = blip.get(rel_attr)
        if not r_id or r_id not in doc_part.related_parts:
            continue
        img_part = doc_part.related_parts[r_id]
        ctype = getattr(img_part, "content_type", "image/png") or "image/png"
        b64 = base64.b64encode(img_part.blob).decode("ascii")
        w_style = f"width:{width_px}px;max-width:100%;height:auto;" if width_px else "max-width:100%;height:auto;"
        imgs.append(f'<img src="data:{html.escape(ctype)};base64,{b64}" alt="" style="{w_style}" />')
    return imgs


def _render_run_el(run_el, doc_part, *, dark_bg: bool = False) -> tuple[str, bool]:
    """Render một phần tử w:r thành HTML và báo có chứa ngắt trang hay không."""
    has_page_break = False
    rPr = run_el.find(qn("w:rPr"))
    bold = False
    italic = False
    underline = False
    strike = False
    vert_align = ""
    color_hex: str | None = None
    highlight_hex: str | None = None
    size_pt: float | None = None

    if rPr is not None:
        def _flag(tag: str) -> bool:
            el = rPr.find(qn(tag))
            if el is None:
                return False
            val = el.get(qn("w:val"))
            return val not in ("0", "false", "none")

        bold = _flag("w:b")
        italic = _flag("w:i")
        underline = _flag("w:u")
        strike = _flag("w:strike")

        va = rPr.find(qn("w:vertAlign"))
        if va is not None:
            vert_align = va.get(qn("w:val")) or ""

        c_el = rPr.find(qn("w:color"))
        if c_el is not None:
            color_hex = _clean_hex(c_el.get(qn("w:val")))

        shd_el = rPr.find(qn("w:shd"))
        if shd_el is not None:
            highlight_hex = _clean_hex(shd_el.get(qn("w:fill")))

        sz_el = rPr.find(qn("w:sz"))
        if sz_el is not None:
            sz_val = sz_el.get(qn("w:val"))
            if sz_val and sz_val.isdigit():
                size_pt = int(sz_val) / 2.0

    chunks: list[str] = []
    for child in run_el:
        tag = child.tag
        if tag == qn("w:t"):
            txt = html.escape(child.text or "")
            chunks.append(txt)
        elif tag == qn("w:tab"):
            chunks.append("&emsp;")
        elif tag in (qn("w:br"), qn("w:cr")):
            br_type = child.get(qn("w:type"))
            if br_type == "page":
                has_page_break = True
            else:
                chunks.append("<br/>")

    chunks.extend(_extract_run_images(run_el, doc_part))
    inner = "".join(chunks)
    if not inner:
        return "", has_page_break

    styles: list[str] = []
    if bold:
        styles.append("font-weight:700")
    if italic:
        styles.append("font-style:italic")
    decos: list[str] = []
    if underline:
        decos.append("underline")
    if strike:
        decos.append("line-through")
    if decos:
        styles.append("text-decoration:" + " ".join(decos))
    if size_pt:
        styles.append(f"font-size:{size_pt:.1f}pt")
    if color_hex:
        if dark_bg and _luminance(color_hex) < 0.2:
            styles.append("color:#FFFFFF")
        else:
            styles.append(f"color:{color_hex}")
    elif dark_bg:
        styles.append("color:#FFFFFF")
    if highlight_hex and highlight_hex != "#FFFFFF":
        styles.append(f"background-color:{highlight_hex}")

    if vert_align == "superscript":
        inner = f"<sup>{inner}</sup>"
    elif vert_align == "subscript":
        inner = f"<sub>{inner}</sub>"

    if styles:
        return f'<span style="{";".join(styles)}">{inner}</span>', has_page_break
    return inner, has_page_break


def _render_paragraph(p: Paragraph, doc_part, *, in_table: bool = False, dark_bg: bool = False) -> str:
    p_el = p._p
    pPr = p_el.find(qn("w:pPr"))
    align_css = ""
    bg_hex: str | None = None
    indent_px = 0
    is_list_item = False
    space_before_pt: float | None = None
    space_after_pt: float | None = None

    if pPr is not None:
        jc = pPr.find(qn("w:jc"))
        if jc is not None:
            jv = (jc.get(qn("w:val")) or "").lower()
            if jv in ("center", "right", "justify", "both"):
                align_css = "justify" if jv == "both" else jv
        shd = pPr.find(qn("w:shd"))
        if shd is not None:
            bg_hex = _clean_hex(shd.get(qn("w:fill")))
        ind = pPr.find(qn("w:ind"))
        if ind is not None:
            left_twips = ind.get(qn("w:left"))
            if left_twips and left_twips.lstrip("-").isdigit():
                indent_px = max(0, min(160, round(int(left_twips) / 15)))
        if pPr.find(qn("w:numPr")) is not None:
            is_list_item = True
        spacing = pPr.find(qn("w:spacing"))
        if spacing is not None:
            bef = spacing.get(qn("w:before"))
            aft = spacing.get(qn("w:after"))
            if bef and bef.isdigit():
                space_before_pt = min(24.0, int(bef) / 20.0)
            if aft and aft.isdigit():
                space_after_pt = min(24.0, int(aft) / 20.0)

    style_name = (p.style.name if p.style and p.style.name else "").lower()
    eff_dark = dark_bg or bool(bg_hex and _luminance(bg_hex) < 0.35)

    parts: list[str] = []
    page_break = False
    rel_id_attr = qn("r:id")

    for child in p_el:
        if child.tag == qn("w:r"):
            frag, pb = _render_run_el(child, doc_part, dark_bg=eff_dark)
            if frag:
                parts.append(frag)
            if pb:
                page_break = True
        elif child.tag == qn("w:hyperlink"):
            r_id = child.get(rel_id_attr)
            href = ""
            if r_id and r_id in doc_part.rels:
                href = doc_part.rels[r_id].target_ref or ""
            link_chunks: list[str] = []
            for sub in child.findall(qn("w:r")):
                frag, pb = _render_run_el(sub, doc_part, dark_bg=eff_dark)
                if frag:
                    link_chunks.append(frag)
                if pb:
                    page_break = True
            link_html = "".join(link_chunks)
            if link_html:
                if href.startswith(("http://", "https://", "mailto:")):
                    parts.append(
                        f'<a href="{html.escape(href, quote=True)}" target="_blank" rel="noopener noreferrer" class="docx-link">{link_html}</a>'
                    )
                else:
                    parts.append(link_html)

    content = "".join(parts)
    if not content.strip():
        if page_break:
            return '<div class="docx-page-break" aria-hidden="true"></div>'
        if in_table:
            return ""
        return '<div class="docx-empty-line" aria-hidden="true"></div>'

    p_styles: list[str] = []
    if align_css:
        p_styles.append(f"text-align:{align_css}")
    if bg_hex and bg_hex != "#FFFFFF":
        p_styles.append(f"background:{bg_hex};padding:6px 10px;border-radius:4px")
    if indent_px > 0:
        p_styles.append(f"padding-left:{indent_px}px")
    if space_before_pt is not None:
        p_styles.append(f"margin-top:{space_before_pt:.1f}pt")
    if space_after_pt is not None:
        p_styles.append(f"margin-bottom:{space_after_pt:.1f}pt")

    cls = "docx-p-cell" if in_table else "docx-p"
    tag = "p"
    if not in_table:
        if "heading 1" in style_name or style_name == "title":
            tag = "h2"
            cls = "docx-h1"
        elif "heading 2" in style_name or style_name == "subtitle":
            tag = "h3"
            cls = "docx-h2"
        elif "heading 3" in style_name:
            tag = "h4"
            cls = "docx-h3"

    if is_list_item and not content.lstrip().startswith(("•", "-", "–")):
        content = f'<span class="docx-bullet">•</span> {content}'

    style_attr = f' style="{";".join(p_styles)}"' if p_styles else ""
    out = f'<{tag} class="{cls}"{style_attr}>{content}</{tag}>'
    if page_break:
        out += '<div class="docx-page-break" aria-hidden="true"></div>'
    return out


def _render_table(tbl: Table, doc: DocxDocument) -> str:
    """Render w:tbl chuẩn xác cả gộp cột (gridSpan), gộp hàng (vMerge), màu nền ô và độ rộng cột."""
    tbl_el = tbl._tbl
    doc_part = doc.part

    grid_cols = [
        int(gc.get(qn("w:w")))
        for gc in tbl_el.findall(f"./{qn('w:tblGrid')}/{qn('w:gridCol')}")
        if (gc.get(qn("w:w")) or "").isdigit()
    ]
    total_grid_w = sum(grid_cols) if grid_cols else 0

    tr_els = tbl_el.findall(f"./{qn('w:tr')}")
    if not tr_els:
        return ""

    parsed_rows: list[list[dict[str, Any]]] = []
    active_vmerge: dict[int, dict[str, Any]] = {}

    for r_idx, tr_el in enumerate(tr_els):
        col_cursor = 0
        row_cells: list[dict[str, Any]] = []
        for tc_el in tr_el.findall(f"./{qn('w:tc')}"):
            tcPr = tc_el.find(qn("w:tcPr"))
            colspan = 1
            vmerge_mode: str | None = None
            bg_hex: str | None = None
            valign = ""
            tc_w = 0

            if tcPr is not None:
                gs = tcPr.find(qn("w:gridSpan"))
                if gs is not None and (gs.get(qn("w:val")) or "").isdigit():
                    colspan = max(1, int(gs.get(qn("w:val"))))
                vm = tcPr.find(qn("w:vMerge"))
                if vm is not None:
                    v_attr = vm.get(qn("w:val"))
                    vmerge_mode = "restart" if v_attr == "restart" else "continue"
                shd = tcPr.find(qn("w:shd"))
                if shd is not None:
                    bg_hex = _clean_hex(shd.get(qn("w:fill")))
                va = tcPr.find(qn("w:vAlign"))
                if va is not None:
                    valign = (va.get(qn("w:val")) or "").lower()
                tw = tcPr.find(qn("w:tcW"))
                if tw is not None and (tw.get(qn("w:w")) or "").isdigit():
                    tc_w = int(tw.get(qn("w:w")))

            if vmerge_mode == "continue" and col_cursor in active_vmerge:
                active_vmerge[col_cursor]["rowspan"] += 1
                col_cursor += colspan
                continue

            for c_i in range(col_cursor, col_cursor + colspan):
                active_vmerge.pop(c_i, None)

            cell_info: dict[str, Any] = {
                "tc_el": tc_el,
                "col_idx": col_cursor,
                "colspan": colspan,
                "rowspan": 1,
                "bg_hex": bg_hex,
                "valign": valign,
                "tc_w": tc_w,
                "is_header": r_idx == 0 and len(tr_els) > 1,
            }
            if vmerge_mode == "restart":
                active_vmerge[col_cursor] = cell_info

            row_cells.append(cell_info)
            col_cursor += colspan

        parsed_rows.append(row_cells)

    if len(parsed_rows) == 1 and len(parsed_rows[0]) == 1:
        c0 = parsed_rows[0][0]
        bg = c0["bg_hex"] or "#F8FAFC"
        dark = _luminance(bg) < 0.35
        p_htmls = [
            _render_paragraph(Paragraph(p_el, doc), doc_part, in_table=True, dark_bg=dark)
            for p_el in c0["tc_el"].findall(f"./{qn('w:p')}")
        ]
        inner_html = "".join(x for x in p_htmls if x)
        return f'<div class="docx-callout" style="background:{bg}">{inner_html}</div>'

    colgroup_html = ""
    if total_grid_w > 0 and grid_cols:
        cols = "".join(f'<col style="width:{(w / total_grid_w) * 100:.2f}%" />' for w in grid_cols)
        colgroup_html = f"<colgroup>{cols}</colgroup>"

    tr_html_list: list[str] = []
    for r_idx, row_cells in enumerate(parsed_rows):
        td_list: list[str] = []
        for c in row_cells:
            bg = c["bg_hex"]
            dark = bool(bg and _luminance(bg) < 0.35)
            is_th = bool(c["is_header"] and (dark or r_idx == 0))
            tag = "th" if is_th else "td"

            attrs: list[str] = []
            if c["colspan"] > 1:
                attrs.append(f'colspan="{c["colspan"]}"')
            if c["rowspan"] > 1:
                attrs.append(f'rowspan="{c["rowspan"]}"')

            c_styles: list[str] = []
            if bg:
                c_styles.append(f"background-color:{bg}")
            if dark:
                c_styles.append("color:#FFFFFF")
            if c["valign"] in ("center", "bottom", "top"):
                va_css = "middle" if c["valign"] == "center" else c["valign"]
                c_styles.append(f"vertical-align:{va_css}")
            if not grid_cols and c["tc_w"] > 0:
                c_styles.append(f"width:{round(c['tc_w'] / 15)}px")

            if c_styles:
                attrs.append(f'style="{";".join(c_styles)}"')

            cell_blocks: list[str] = []
            for sub in c["tc_el"]:
                if sub.tag == qn("w:p"):
                    ph = _render_paragraph(Paragraph(sub, doc), doc_part, in_table=True, dark_bg=dark)
                    if ph:
                        cell_blocks.append(ph)
                elif sub.tag == qn("w:tbl"):
                    cell_blocks.append(_render_table(Table(sub, doc), doc))

            inner = "".join(cell_blocks) or "&nbsp;"
            attr_str = (" " + " ".join(attrs)) if attrs else ""
            td_list.append(f"<{tag}{attr_str}>{inner}</{tag}>")

        tr_html_list.append(f"<tr>{''.join(td_list)}</tr>")

    return f'<div class="docx-table-wrap"><table class="docx-table">{colgroup_html}<tbody>{"".join(tr_html_list)}</tbody></table></div>'


def render_docx_body_parts(docx_bytes: bytes) -> dict[str, Any]:
    """Phân tích file .docx và trả về HTML phần thân + metadata trang."""
    doc = docx.Document(io.BytesIO(docx_bytes))
    doc_part = doc.part

    page_w_mm = 210.0
    page_h_mm = 297.0
    margin_top_mm = 18.0
    margin_bottom_mm = 18.0
    margin_left_mm = 20.0
    margin_right_mm = 18.0
    header_html = ""
    footer_html = ""

    if doc.sections:
        sec = doc.sections[0]
        if sec.page_width:
            page_w_mm = round(sec.page_width.mm, 1)
        if sec.page_height:
            page_h_mm = round(sec.page_height.mm, 1)
        if sec.top_margin:
            margin_top_mm = max(10.0, min(35.0, round(sec.top_margin.mm, 1)))
        if sec.bottom_margin:
            margin_bottom_mm = max(10.0, min(35.0, round(sec.bottom_margin.mm, 1)))
        if sec.left_margin:
            margin_left_mm = max(12.0, min(35.0, round(sec.left_margin.mm, 1)))
        if sec.right_margin:
            margin_right_mm = max(12.0, min(35.0, round(sec.right_margin.mm, 1)))

        hdr_parts = [
            _render_paragraph(hp, doc_part, in_table=True)
            for hp in sec.header.paragraphs
            if hp.text.strip()
        ]
        if hdr_parts:
            header_html = f'<header class="docx-running-header">{"".join(hdr_parts)}</header>'

        ftr_parts = [
            _render_paragraph(fp, doc_part, in_table=True)
            for fp in sec.footer.paragraphs
            if fp.text.strip()
        ]
        if ftr_parts:
            footer_html = f'<footer class="docx-running-footer">{"".join(ftr_parts)}</footer>'

    blocks: list[str] = []
    para_count = 0
    table_count = 0

    for child in doc.element.body.iterchildren():
        if isinstance(child, CT_P):
            p = Paragraph(child, doc)
            if p.text.strip():
                para_count += 1
            blocks.append(_render_paragraph(p, doc_part))
        elif isinstance(child, CT_Tbl):
            table_count += 1
            blocks.append(_render_table(Table(child, doc), doc))

    return {
        "body_html": "\n".join(b for b in blocks if b),
        "header_html": header_html,
        "footer_html": footer_html,
        "page_w_mm": page_w_mm,
        "page_h_mm": page_h_mm,
        "margins_mm": (margin_top_mm, margin_right_mm, margin_bottom_mm, margin_left_mm),
        "para_count": para_count,
        "table_count": table_count,
        "doc_title": (doc.core_properties.title or "").strip(),
    }


def render_docx_preview_html(
    docx_bytes: bytes,
    *,
    title: str = "Tài liệu Word (.docx)",
    download_url: str = "",
    pdf_url: str = "",
    print_mode: bool = False,
) -> str:
    """Sinh trang HTML5 hoàn chỉnh hiển thị bản xem trước DOCX theo trang giấy A4."""
    parsed = render_docx_body_parts(docx_bytes)
    safe_title = html.escape(title or parsed["doc_title"] or "Tài liệu Word (.docx)")
    mt, mr, mb, ml = parsed["margins_mm"]
    pw = parsed["page_w_mm"]
    ph = parsed["page_h_mm"]

    actions_html = ""
    if not print_mode:
        dl_btn = (
            f'<a class="tb-btn primary" href="{html.escape(download_url, quote=True)}" aria-label="Tải bản Word (.docx)">'
            f'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
            f'<span>Tải bản Word (.docx)</span></a>'
            if download_url
            else ""
        )
        pdf_btn = (
            f'<a class="tb-btn" href="{html.escape(pdf_url, quote=True)}" target="_blank" rel="noopener" aria-label="Mở bản PDF">'
            f'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
            f'<span>Bản PDF</span></a>'
            if pdf_url
            else ""
        )
        actions_html = f"""
<header class="docx-toolbar" aria-label="Thanh công cụ xem trước Word">
  <div class="docx-tb-left">
    <span class="docx-format-pill">WORD · DOCX</span>
    <h1 class="docx-title" title="{safe_title}">{safe_title}</h1>
    <span class="docx-meta">{parsed["para_count"]} mục · {parsed["table_count"]} bảng</span>
  </div>
  <div class="docx-tb-right">
    <div class="docx-zoom-group" role="group" aria-label="Thu phóng trang">
      <button type="button" class="tb-icon" onclick="stepZoom(-10)" title="Thu nhỏ" aria-label="Thu nhỏ">−</button>
      <button type="button" class="tb-zoom-val" id="zoomLabel" onclick="resetZoom()" title="Đặt lại 100%" aria-label="Tỷ lệ thu phóng hiện tại">100%</button>
      <button type="button" class="tb-icon" onclick="stepZoom(10)" title="Phóng to" aria-label="Phóng to">+</button>
    </div>
    <button type="button" class="tb-btn" onclick="window.print()" aria-label="In tài liệu">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
      <span>In</span>
    </button>
    {pdf_btn}
    {dl_btn}
  </div>
</header>"""

    script_html = (
        ""
        if print_mode
        else """
<script>
(function(){
  var zoom = 100;
  var sheet = document.getElementById('docxSheet');
  var label = document.getElementById('zoomLabel');
  function apply(){
    if(!sheet || !label) return;
    sheet.style.zoom = (zoom / 100).toString();
    label.textContent = zoom + '%';
  }
  window.stepZoom = function(delta){
    zoom = Math.max(60, Math.min(160, zoom + delta));
    apply();
  };
  window.resetZoom = function(){
    zoom = 100;
    apply();
  };
})();
</script>"""
    )

    return f"""<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{safe_title} — KSP Word Preview</title>
<style>
@page {{
  size: {pw}mm {ph}mm;
  margin: {mt}mm {mr}mm {mb}mm {ml}mm;
}}
* {{ box-sizing: border-box; }}
html, body {{
  margin: 0;
  padding: 0;
  background: {"#ffffff" if print_mode else "#e5ebe8"};
  color: #111827;
  font-family: "Times New Roman", "Liberation Serif", "DejaVu Serif", Georgia, serif;
  font-size: 11pt;
  line-height: 1.48;
  -webkit-font-smoothing: antialiased;
}}
.docx-toolbar {{
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 16px;
  background: #102d2b;
  color: #f3f7f5;
  border-bottom: 1px solid rgba(255,255,255,0.12);
  font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}}
.docx-tb-left {{
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}}
.docx-format-pill {{
  flex-shrink: 0;
  padding: 3px 8px;
  border-radius: 6px;
  background: #1d4ed8;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}}
.docx-title {{
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #f8fafc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}}
.docx-meta {{
  flex-shrink: 0;
  font-size: 12px;
  color: #9ec5bb;
}}
.docx-tb-right {{
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}}
.docx-zoom-group {{
  display: inline-flex;
  align-items: center;
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 8px;
  overflow: hidden;
  background: rgba(255,255,255,0.06);
}}
.tb-icon, .tb-zoom-val {{
  background: transparent;
  color: #f3f7f5;
  border: 0;
  height: 30px;
  padding: 0 9px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}}
.tb-icon:hover, .tb-zoom-val:hover {{
  background: rgba(255,255,255,0.14);
}}
.tb-btn {{
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 11px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.2);
  background: rgba(255,255,255,0.08);
  color: #f8fafc;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  white-space: nowrap;
}}
.tb-btn:hover {{
  background: rgba(255,255,255,0.18);
}}
.tb-btn.primary {{
  background: #0f766e;
  border-color: #0f766e;
  color: #ffffff;
}}
.tb-btn.primary:hover {{
  background: #0d5f59;
}}
.docx-stage {{
  padding: {"0" if print_mode else "24px 16px 48px"};
  display: flex;
  justify-content: center;
}}
.docx-sheet {{
  width: {"100%" if print_mode else f"{pw}mm"};
  max-width: 100%;
  min-height: {"auto" if print_mode else f"{ph}mm"};
  background: #ffffff;
  padding: {"0" if print_mode else f"{mt}mm {mr}mm {mb}mm {ml}mm"};
  {"box-shadow: none;" if print_mode else "box-shadow: 0 12px 36px rgba(15, 35, 33, 0.14); border-radius: 3px;"}
  overflow-wrap: break-word;
}}
.docx-running-header {{
  padding-bottom: 8px;
  margin-bottom: 14px;
  border-bottom: 1px solid #cbd5e1;
  color: #475569;
  font-size: 9.5pt;
}}
.docx-running-footer {{
  padding-top: 8px;
  margin-top: 18px;
  border-top: 1px solid #cbd5e1;
  color: #475569;
  font-size: 9.5pt;
}}
.docx-h1 {{
  font-size: 15pt;
  font-weight: 700;
  color: #1e3a8a;
  margin: 14pt 0 6pt;
  line-height: 1.3;
}}
.docx-h2 {{
  font-size: 13pt;
  font-weight: 700;
  color: #1e3a8a;
  margin: 12pt 0 5pt;
  line-height: 1.35;
}}
.docx-h3 {{
  font-size: 11.5pt;
  font-weight: 700;
  color: #0f172a;
  margin: 10pt 0 4pt;
}}
.docx-p {{
  margin: 0 0 6pt;
}}
.docx-p-cell {{
  margin: 0 0 2.5pt;
}}
.docx-p-cell:last-child {{
  margin-bottom: 0;
}}
.docx-empty-line {{
  height: 5pt;
}}
.docx-bullet {{
  display: inline-block;
  width: 12px;
  font-weight: 700;
}}
.docx-link {{
  color: #1d4ed8;
  text-decoration: underline;
}}
.docx-callout {{
  margin: 10pt 0 12pt;
  padding: 10pt 12pt;
  border: 1px solid #d9770644;
  border-radius: 6px;
  font-size: 10.2pt;
  line-height: 1.48;
}}
.docx-table-wrap {{
  width: 100%;
  margin: 6pt 0 12pt;
}}
.docx-table {{
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 9.8pt;
  line-height: 1.38;
}}
.docx-table th,
.docx-table td {{
  border: 1px solid #cbd5e1;
  padding: 5.5pt 6.5pt;
  vertical-align: top;
  text-align: left;
  overflow-wrap: break-word;
  word-break: break-word;
}}
.docx-table th {{
  font-weight: 700;
}}
.docx-page-break {{
  margin: 18pt 0;
  border-top: 1px dashed #94a3b8;
  page-break-after: always;
}}
@media (max-width: 820px) {{
  .docx-meta {{ display: none; }}
  .docx-toolbar {{ padding: 8px 10px; flex-wrap: wrap; }}
  .docx-stage {{ padding: 10px 6px 28px; }}
  .docx-sheet {{ padding: 14px 12px; width: 100%; }}
  .docx-table {{ font-size: 8.8pt; table-layout: auto; }}
  .docx-table th, .docx-table td {{ padding: 4pt 4.5pt; }}
  .tb-btn span {{ display: none; }}
  .tb-btn.primary span {{ display: inline; }}
}}
@media print {{
  html, body {{ background: #ffffff !important; }}
  .docx-toolbar {{ display: none !important; }}
  .docx-stage {{ padding: 0 !important; display: block !important; }}
  .docx-sheet {{
    width: 100% !important;
    min-height: 0 !important;
    padding: 0 !important;
    box-shadow: none !important;
    zoom: 1 !important;
  }}
  .docx-page-break {{ border: 0 !important; margin: 0 !important; }}
  .docx-table tr {{ page-break-inside: avoid; }}
}}
</style>
</head>
<body>
{actions_html}
<main class="docx-stage">
  <article class="docx-sheet" id="docxSheet">
    {parsed["header_html"]}
    {parsed["body_html"]}
    {parsed["footer_html"]}
  </article>
</main>
{script_html}
</body>
</html>"""


def render_docx_to_pdf_bytes(docx_bytes: bytes, *, title: str = "Tài liệu Word (.docx)") -> bytes:
    """Kết xuất file .docx sang bản PDF A4 qua WeasyPrint."""
    import weasyprint

    html_str = render_docx_preview_html(docx_bytes, title=title, print_mode=True)
    return weasyprint.HTML(string=html_str).write_pdf()
