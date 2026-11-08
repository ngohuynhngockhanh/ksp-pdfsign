"""Bộ dựng xem trước (Preview) tài liệu Markdown (.md) chuẩn INUT Operations Design System cho ksp-pdfsign.

Hỗ trợ:
- Phân tích cú pháp CommonMark + GFM Tables + Strikethrough qua markdown-it-py.
- Tô màu cú pháp (Syntax Highlighting) tự chứa cho khối mã nguồn qua Pygments.
- Tự động dựng sơ đồ vector SVG sắc nét cho khối `mermaid` (`sequenceDiagram`) không cần CDN ngoài (tương thích tuyệt đối CSP `default-src 'self'` và xuất PDF qua WeasyPrint).
- Tự động trích xuất Mục lục điều hướng (Table of Contents) đa cấp `H1..H3`, tìm kiếm nhanh nội bộ, thu phóng trang, sao chép nhanh khối lệnh và xuất bản in PDF khổ A4.
"""
from __future__ import annotations

import html
import re
import unicodedata
from pathlib import Path
from typing import Any

from markdown_it import MarkdownIt
from pygments import highlight
from pygments.formatters import HtmlFormatter
from pygments.lexers import TextLexer, get_lexer_by_name
from pygments.util import ClassNotFound


def is_valid_markdown(data: bytes, filename: str = "") -> bool:
    """Kiểm tra nhanh dữ liệu UTF-8 hợp lệ và không phải nhị phân PDF/ZIP."""
    if not data:
        return False
    if data.startswith((b"%PDF", b"PK\x03\x04", b"\x89PNG", b"\xff\xd8\xff")):
        return False
    if b"\x00" in data[:4096]:
        return False
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return False
    if filename and filename.lower().endswith((".md", ".markdown")):
        return True
    return bool(re.search(r"(^#{1,6}\s+.+|```|\|.+\|)", text, flags=re.MULTILINE))


def _slugify(text: str, index: int) -> str:
    norm = unicodedata.normalize("NFKD", text)
    ascii_str = "".join(c for c in norm if not unicodedata.combining(c))
    ascii_str = ascii_str.replace("đ", "d").replace("Đ", "d").lower()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_str).strip("-")
    return f"sec-{index}-{slug[:48]}" if slug else f"sec-{index}"


def _render_mermaid_sequence_svg(code: str) -> str:
    """Chuyển đổi khối mermaid sequenceDiagram thành SVG vector tự chứa (tương thích CSP & WeasyPrint)."""
    lines = [ln.strip() for ln in code.splitlines() if ln.strip() and not ln.strip().startswith("%%")]
    if not lines or not lines[0].startswith("sequenceDiagram"):
        escaped = html.escape(code)
        return f'<pre class="md-code-pre"><code class="language-mermaid">{escaped}</code></pre>'

    participants: list[tuple[str, str]] = []
    part_idx: dict[str, int] = {}
    events: list[dict[str, Any]] = []

    def _ensure_part(pid: str, label: str = "") -> int:
        if pid not in part_idx:
            part_idx[pid] = len(participants)
            participants.append((pid, label or pid))
        elif label and participants[part_idx[pid]][1] == pid:
            participants[part_idx[pid]] = (pid, label)
        return part_idx[pid]

    part_re = re.compile(r"^(?:participant|actor)\s+([A-Za-z0-9_.-]+)(?:\s+as\s+(.+))?$")
    note_re = re.compile(r"^Note\s+over\s+([^:]+):\s*(.+)$", re.IGNORECASE)
    msg_re = re.compile(r"^([A-Za-z0-9_.-]+)\s*(-->>|->>|-->|->)\s*([A-Za-z0-9_.-]+)\s*:\s*(.+)$")

    msg_num = 0
    for ln in lines[1:]:
        if ln == "autonumber":
            continue
        m_p = part_re.match(ln)
        if m_p:
            _ensure_part(m_p.group(1).strip(), (m_p.group(2) or "").strip())
            continue
        m_n = note_re.match(ln)
        if m_n:
            targets = [t.strip() for t in m_n.group(1).split(",") if t.strip()]
            for t in targets:
                _ensure_part(t)
            events.append({"kind": "note", "targets": targets, "text": m_n.group(2).strip()})
            continue
        m_m = msg_re.match(ln)
        if m_m:
            src, arrow, dst, txt = m_m.group(1), m_m.group(2), m_m.group(3), m_m.group(4).strip()
            _ensure_part(src)
            _ensure_part(dst)
            msg_num += 1
            events.append({
                "kind": "msg",
                "num": msg_num,
                "src": src,
                "dst": dst,
                "dashed": arrow.startswith("--"),
                "text": txt,
            })

    if not participants:
        escaped = html.escape(code)
        return f'<pre class="md-code-pre"><code class="language-mermaid">{escaped}</code></pre>'

    n_cols = len(participants)
    col_w = 230
    pad_x = 120
    width = max(720, pad_x * 2 + (n_cols - 1) * col_w)
    header_y = 24
    header_h = 44
    cur_y = header_y + header_h + 26
    row_h = 52
    total_h = cur_y + len(events) * row_h + 36

    def _cx(pid: str) -> int:
        idx = part_idx.get(pid, 0)
        return pad_x + idx * col_w

    svg_parts = [
        f'<div class="md-diagram-card" role="figure" aria-label="Sơ đồ luồng giao thức">',
        f'<svg viewBox="0 0 {width} {total_h}" width="100%" height="auto" xmlns="http://www.w3.org/2000/svg">',
        '<defs>',
        '<marker id="md-arrow-solid" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">',
        '<path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#157d72"/>',
        '</marker>',
        '<marker id="md-arrow-dashed" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">',
        '<path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#0f655d"/>',
        '</marker>',
        '</defs>',
    ]

    # Lifelines
    for pid, label in participants:
        cx = _cx(pid)
        svg_parts.append(
            f'<line x1="{cx}" y1="{header_y + header_h}" x2="{cx}" y2="{total_h - 18}" '
            f'stroke="#c8d5cf" stroke-width="1.5" stroke-dasharray="4 4"/>'
        )

    # Participant boxes
    for pid, label in participants:
        cx = _cx(pid)
        bw = min(210, max(130, len(label) * 7 + 24))
        bx = cx - bw // 2
        svg_parts.append(
            f'<rect x="{bx}" y="{header_y}" width="{bw}" height="{header_h}" rx="8" '
            f'fill="#102e2c" stroke="#157d72" stroke-width="1.5"/>'
        )
        short_lbl = label if len(label) <= 28 else label[:26] + "…"
        svg_parts.append(
            f'<text x="{cx}" y="{header_y + 27}" text-anchor="middle" fill="#f7f4ec" '
            f'font-family="Inter, system-ui, sans-serif" font-size="12" font-weight="600">'
            f'{html.escape(short_lbl)}</text>'
        )

    # Events
    y = cur_y
    for ev in events:
        if ev["kind"] == "note":
            t_list = ev["targets"]
            xs = [_cx(t) for t in t_list]
            x_min = min(xs) - 85
            x_max = max(xs) + 85
            nw = max(240, x_max - x_min)
            svg_parts.append(
                f'<rect x="{x_min}" y="{y - 14}" width="{nw}" height="30" rx="6" '
                f'fill="#e2f2ec" stroke="#157d72" stroke-width="1"/>'
            )
            svg_parts.append(
                f'<text x="{x_min + nw // 2}" y="{y + 5}" text-anchor="middle" fill="#102e2c" '
                f'font-family="Inter, system-ui, sans-serif" font-size="12" font-weight="700">'
                f'{html.escape(ev["text"])}</text>'
            )
            y += row_h
        elif ev["kind"] == "msg":
            x1 = _cx(ev["src"])
            x2 = _cx(ev["dst"])
            dashed = ev["dashed"]
            line_y = y + 10
            dash_attr = ' stroke-dasharray="5 4"' if dashed else ""
            marker = "url(#md-arrow-dashed)" if dashed else "url(#md-arrow-solid)"
            color = "#0f655d" if dashed else "#157d72"
            svg_parts.append(
                f'<line x1="{x1}" y1="{line_y}" x2="{x2}" y2="{line_y}" '
                f'stroke="{color}" stroke-width="1.8"{dash_attr} marker-end="{marker}"/>'
            )
            mid_x = (x1 + x2) // 2
            lbl = f'[{ev["num"]}] {ev["text"]}'
            if len(lbl) > 74:
                lbl = lbl[:72] + "…"
            svg_parts.append(
                f'<text x="{mid_x}" y="{line_y - 7}" text-anchor="middle" fill="#173b38" '
                f'font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="11.5" font-weight="600">'
                f'{html.escape(lbl)}</text>'
            )
            y += row_h

    svg_parts.append("</svg></div>")
    return "".join(svg_parts)


def _highlight_code_block(code: str, lang: str) -> str:
    clean_lang = (lang or "").strip().lower()
    if clean_lang == "mermaid":
        return _render_mermaid_sequence_svg(code)

    try:
        lexer = get_lexer_by_name(clean_lang, stripall=False) if clean_lang else TextLexer()
    except ClassNotFound:
        lexer = TextLexer()
    formatter = HtmlFormatter(nowrap=True)
    highlighted = highlight(code, lexer, formatter)
    badge = html.escape(clean_lang.upper() if clean_lang else "TEXT")
    return (
        f'<div class="md-code-card">'
        f'<div class="md-code-bar">'
        f'<span class="md-code-lang">{badge}</span>'
        f'<button type="button" class="md-copy-btn" onclick="copyCodeBlock(this)" aria-label="Sao chép mã nguồn">Sao chép</button>'
        f'</div>'
        f'<pre class="md-code-pre" tabindex="0"><code>{highlighted}</code></pre>'
        f'</div>'
    )


def render_markdown_body_parts(md_input: bytes | str) -> dict[str, Any]:
    """Phân tích tài liệu Markdown và trả về HTML phần thân + Mục lục + Metadata."""
    if isinstance(md_input, bytes):
        text = md_input.decode("utf-8", errors="replace")
    else:
        text = str(md_input)

    # Chuẩn hóa công thức toán học nhẹ ($r_i$, $\to$, $\leftrightarrow$, $\bmod$, $\le$) sang ký hiệu Unicode rõ nét
    math_replacements = {
        r"\to": "→",
        r"\rightarrow": "→",
        r"\leftrightarrow": "↔",
        r"\bmod": " mod ",
        r"\pmod": " mod ",
        r"\le": "≤",
        r"\ge": "≥",
        r"\dots": "…",
        r"\in": "∈",
        r"\big(": "(",
        r"\big)": ")",
    }

    md = MarkdownIt("commonmark").enable(["table", "strikethrough"])
    raw_html = md.render(text)

    # Thay thế code blocks bằng khối tô màu cú pháp hoặc sơ đồ SVG
    code_count = 0

    def _replace_pre_code(match: re.Match[str]) -> str:
        nonlocal code_count
        code_count += 1
        cls_attr = match.group(1) or ""
        inner_escaped = match.group(2) or ""
        lang_m = re.search(r"language-([A-Za-z0-9_+-]+)", cls_attr)
        lang = lang_m.group(1) if lang_m else ""
        raw_code = html.unescape(inner_escaped)
        return _highlight_code_block(raw_code, lang)

    body_html = re.sub(
        r"<pre><code([^>]*)>([\s\S]*?)</code></pre>",
        _replace_pre_code,
        raw_html,
    )

    # Bọc bảng trong .md-table-wrap để cuộn ngang mượt trên di động
    table_count = len(re.findall(r"<table>", body_html))
    body_html = body_html.replace("<table>", '<div class="md-table-wrap" tabindex="0"><table class="md-table">').replace(
        "</table>", "</table></div>"
    )

    # Xử lý các biểu thức LaTeX inline $...$ và $$...$$ ngoài code block
    def _clean_latex(m: re.Match[str]) -> str:
        expr = m.group(1).strip()
        for k, v in math_replacements.items():
            expr = expr.replace(k, v)
        expr = re.sub(r"\\text\{([^}]*)\}", r"\1", expr)
        expr = expr.replace("{", "").replace("}", "")
        return f'<span class="md-math">{expr}</span>'

    body_html = re.sub(r"\$\$([\s\S]+?)\$\$", lambda m: f'<div class="md-math-block">{_clean_latex(m)}</div>', body_html)
    body_html = re.sub(r"\$([^$\n]+?)\$", _clean_latex, body_html)

    # Trích xuất Heading H1..H3 để tạo Mục lục (TOC) và gắn id neo
    toc_items: list[dict[str, Any]] = []
    doc_title = ""
    sec_counter = 0

    def _add_heading_id(match: re.Match[str]) -> str:
        nonlocal sec_counter, doc_title
        level = int(match.group(1))
        inner = match.group(2)
        plain = re.sub(r"<[^>]+>", "", inner).strip()
        plain_unescaped = html.unescape(plain)
        if level == 1 and not doc_title:
            doc_title = plain_unescaped
        sec_counter += 1
        hid = _slugify(plain_unescaped, sec_counter)
        if level in (1, 2, 3):
            toc_items.append({"id": hid, "level": level, "text": plain_unescaped})
        return f'<h{level} id="{hid}" class="md-h{level}">{inner}</h{level}>'

    body_html = re.sub(r"<h([1-4])>([\s\S]*?)</h\1>", _add_heading_id, body_html)

    word_count = len(re.findall(r"\S+", text))
    read_min = max(1, round(word_count / 220))

    return {
        "body_html": body_html,
        "toc": toc_items,
        "doc_title": doc_title,
        "section_count": len(toc_items),
        "table_count": table_count,
        "code_count": code_count,
        "word_count": word_count,
        "read_min": read_min,
    }


def render_markdown_preview_html(
    md_input: bytes | str,
    *,
    title: str = "Tài liệu kỹ thuật (.md)",
    download_url: str = "",
    pdf_url: str = "",
    print_mode: bool = False,
) -> str:
    """Sinh trang HTML5 hoàn chỉnh hiển thị tài liệu Markdown (.md) chuẩn INUT Operations Design System."""
    parsed = render_markdown_body_parts(md_input)
    display_title = parsed["doc_title"] or title or "Tài liệu Markdown (.md)"
    safe_title = html.escape(display_title)
    safe_file = html.escape(title or display_title)

    pygments_css = HtmlFormatter(style="friendly").get_style_defs(".md-code-pre")

    toc_links_html = "".join(
        f'<a href="#{item["id"]}" class="md-toc-link lv-{item["level"]}">{html.escape(item["text"])}</a>'
        for item in parsed["toc"]
    )
    toc_aside_html = (
        ""
        if print_mode or not parsed["toc"]
        else f"""
<aside class="md-toc-sidebar" aria-label="Mục lục tài liệu">
  <div class="md-toc-card">
    <div class="md-toc-head">Mục lục tài liệu ({parsed["section_count"]})</div>
    <nav class="md-toc-nav" id="mdTocNav">
      {toc_links_html}
    </nav>
  </div>
</aside>"""
    )

    actions_html = ""
    if not print_mode:
        dl_btn = (
            f'<a class="tb-btn primary" href="{html.escape(download_url, quote=True)}" aria-label="Tải tệp Markdown (.md)">'
            f'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
            f'<span>Tải bản .MD</span></a>'
            if download_url
            else ""
        )
        pdf_btn = (
            f'<a class="tb-btn" href="{html.escape(pdf_url, quote=True)}" target="_blank" rel="noopener" aria-label="Xuất bản in PDF">'
            f'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
            f'<span>Bản PDF</span></a>'
            if pdf_url
            else ""
        )
        actions_html = f"""
<header class="md-toolbar" aria-label="Thanh công cụ đọc tài liệu Markdown">
  <div class="md-tb-left">
    <span class="md-format-pill">MARKDOWN · MD</span>
    <h1 class="md-tb-title" title="{safe_title}">{safe_file}</h1>
    <span class="md-tb-meta">{parsed["section_count"]} mục · {parsed["table_count"]} bảng · {parsed["code_count"]} khối mã · ~{parsed["read_min"]} phút đọc</span>
  </div>
  <div class="md-tb-right">
    <div class="md-search-wrap">
      <input type="search" id="mdSearchInput" class="md-search-input" placeholder="Tìm nhanh từ khóa..." aria-label="Tìm nhanh từ khóa trong tài liệu" oninput="filterMarkdownSections(this.value)" />
    </div>
    <div class="md-zoom-group" role="group" aria-label="Thu phóng trang">
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
  var sheet = document.getElementById('mdSheet');
  var label = document.getElementById('zoomLabel');
  function apply(){
    if(!sheet || !label) return;
    sheet.style.zoom = (zoom / 100).toString();
    label.textContent = zoom + '%';
  }
  window.stepZoom = function(delta){
    zoom = Math.max(70, Math.min(150, zoom + delta));
    apply();
  };
  window.resetZoom = function(){
    zoom = 100;
    apply();
  };
  window.copyCodeBlock = function(btn){
    var card = btn && btn.closest('.md-code-card');
    var pre = card && card.querySelector('pre');
    if(!pre) return;
    var text = pre.innerText || pre.textContent || '';
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){
        var old = btn.textContent;
        btn.textContent = 'Đã chép ✓';
        setTimeout(function(){ btn.textContent = old; }, 1600);
      });
    }
  };
  window.filterMarkdownSections = function(q){
    var term = (q || '').trim().toLowerCase();
    var links = document.querySelectorAll('#mdTocNav .md-toc-link');
    for(var i = 0; i < links.length; i++){
      var txt = (links[i].textContent || '').toLowerCase();
      links[i].style.display = (!term || txt.indexOf(term) !== -1) ? '' : 'none';
    }
  };
})();
</script>"""
    )

    return f"""<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>{safe_title} — KSP Markdown Viewer</title>
<style>
:root {{
  --ink: #102e2c;
  --primary: #157d72;
  --primary-dark: #0f655d;
  --primary-soft: #e2f2ec;
  --paper: #f7f4ec;
  --panel: #fffefa;
  --bg: #eef3f0;
  --text: #173b38;
  --muted: #475954;
  --border: #d5dfd9;
  --border-strong: #b8c9c1;
  --gold: #dda044;
}}
@page {{
  size: 210mm 297mm;
  margin: 14mm 14mm 16mm 14mm;
}}
* {{ box-sizing: border-box; }}
html, body {{
  margin: 0;
  padding: 0;
  background: {"#ffffff" if print_mode else "var(--bg)"};
  color: var(--text);
  font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14.5px;
  line-height: 1.62;
  -webkit-font-smoothing: antialiased;
}}
.md-toolbar {{
  position: sticky;
  top: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 18px;
  background: var(--ink);
  color: #f3f7f5;
  border-bottom: 1px solid rgba(255,255,255,0.12);
}}
.md-tb-left {{
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}}
.md-format-pill {{
  flex-shrink: 0;
  padding: 4px 9px;
  border-radius: 6px;
  background: var(--primary-dark);
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}}
.md-tb-title {{
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #f8fafc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}}
.md-tb-meta {{
  flex-shrink: 0;
  font-size: 12px;
  color: #b7d6cd;
}}
.md-tb-right {{
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}}
.md-search-input {{
  height: 32px;
  width: 190px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.22);
  background: rgba(255,255,255,0.08);
  color: #ffffff;
  font-size: 12.5px;
  outline: none;
}}
.md-search-input::placeholder {{
  color: #b7d6cd;
}}
.md-search-input:focus {{
  border-color: var(--gold);
  background: rgba(255,255,255,0.14);
}}
.md-zoom-group {{
  display: inline-flex;
  align-items: center;
  border: 1px solid #2b5450;
  border-radius: 8px;
  overflow: hidden;
  background: #0b2220;
}}
.tb-icon, .tb-zoom-val {{
  background: transparent;
  color: #f3f7f5;
  border: 0;
  height: 32px;
  padding: 0 10px;
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
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid #2b5450;
  background: #0b2220;
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
  background: var(--primary-dark);
  border-color: var(--primary-dark);
  color: #ffffff;
}}
.tb-btn.primary:hover {{
  background: var(--primary-dark);
}}
.md-layout {{
  max-width: 1440px;
  margin: 0 auto;
  padding: {"0" if print_mode else "24px 20px 56px"};
  display: flex;
  align-items: flex-start;
  gap: 24px;
}}
.md-toc-sidebar {{
  width: 280px;
  flex-shrink: 0;
  position: sticky;
  top: 68px;
  max-height: calc(100vh - 88px);
  overflow-y: auto;
}}
.md-toc-card {{
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 14px 14px;
}}
.md-toc-head {{
  font-size: 12px;
  font-weight: 700;
  color: var(--ink);
  padding-bottom: 10px;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--border);
}}
.md-toc-nav {{
  display: flex;
  flex-direction: column;
  gap: 3px;
}}
.md-toc-link {{
  display: block;
  text-decoration: none;
  color: var(--text);
  font-size: 12.5px;
  line-height: 1.4;
  padding: 5px 8px;
  border-radius: 7px;
  overflow-wrap: break-word;
}}
.md-toc-link:hover {{
  background: var(--primary-soft);
  color: var(--ink);
}}
.md-toc-link.lv-1 {{
  font-weight: 700;
  color: var(--ink);
}}
.md-toc-link.lv-2 {{
  padding-left: 12px;
  font-weight: 600;
}}
.md-toc-link.lv-3 {{
  padding-left: 22px;
  color: var(--muted);
}}
.md-sheet {{
  flex: 1;
  min-width: 0;
  background: var(--panel);
  border: {"0" if print_mode else "1px solid var(--border)"};
  border-radius: {"0" if print_mode else "16px"};
  padding: {"0" if print_mode else "32px 38px 44px"};
  overflow-wrap: break-word;
}}
.md-h1 {{
  font-family: Georgia, "Times New Roman", serif;
  font-size: 26px;
  font-weight: 600;
  color: var(--ink);
  margin: 0 0 16px;
  padding-bottom: 12px;
  border-bottom: 2px solid var(--border);
  line-height: 1.28;
}}
.md-h2 {{
  font-family: Georgia, "Times New Roman", serif;
  font-size: 20px;
  font-weight: 600;
  color: var(--ink);
  margin: 28px 0 12px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
  line-height: 1.34;
}}
.md-h3 {{
  font-size: 16px;
  font-weight: 700;
  color: var(--primary-dark);
  margin: 22px 0 8px;
  line-height: 1.4;
}}
.md-h4 {{
  font-size: 14.5px;
  font-weight: 700;
  color: var(--ink);
  margin: 16px 0 6px;
}}
.md-sheet p {{
  margin: 0 0 12px;
}}
.md-sheet ul, .md-sheet ol {{
  margin: 0 0 14px;
  padding-left: 22px;
}}
.md-sheet li {{
  margin-bottom: 5px;
}}
.md-sheet hr {{
  border: 0;
  border-top: 1px solid var(--border);
  margin: 26px 0;
}}
.md-sheet blockquote {{
  margin: 14px 0 18px;
  padding: 12px 16px;
  background: var(--paper);
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  color: var(--ink);
}}
.md-sheet blockquote p:last-child {{
  margin-bottom: 0;
}}
.md-sheet a {{
  color: var(--primary-dark);
  font-weight: 600;
  text-decoration: underline;
}}
.md-sheet code {{
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12.8px;
  background: #eaf1ee;
  color: #0f3d39;
  padding: 2px 5px;
  border-radius: 5px;
}}
.md-code-card {{
  margin: 14px 0 18px;
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  overflow: hidden;
  background: #f8faf9;
}}
.md-code-bar {{
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: #e6efec;
  border-bottom: 1px solid var(--border);
}}
.md-code-lang {{
  font-size: 12px;
  font-weight: 700;
  color: var(--ink);
  letter-spacing: 0.04em;
}}
.md-copy-btn {{
  height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--border-strong);
  background: #ffffff;
  color: var(--ink);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}}
.md-copy-btn:hover {{
  background: var(--primary-soft);
}}
.md-code-pre {{
  margin: 0;
  padding: 14px 16px;
  overflow-x: auto;
  font-size: 12.8px;
  line-height: 1.52;
}}
.md-code-pre code {{
  background: transparent;
  padding: 0;
  color: inherit;
}}
.md-diagram-card {{
  margin: 16px 0 20px;
  padding: 14px;
  background: #fbfdfc;
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  overflow-x: auto;
}}
.md-table-wrap {{
  width: 100%;
  margin: 14px 0 20px;
  overflow-x: auto;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
}}
.md-table {{
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  line-height: 1.48;
}}
.md-table th, .md-table td {{
  border-bottom: 1px solid var(--border);
  border-right: 1px solid var(--border);
  padding: 9px 11px;
  vertical-align: top;
  text-align: left;
}}
.md-table th:last-child, .md-table td:last-child {{
  border-right: 0;
}}
.md-table tr:last-child td {{
  border-bottom: 0;
}}
.md-table th {{
  background: #eaf2ee;
  color: var(--ink);
  font-weight: 700;
}}
.md-table tbody tr:nth-child(even) {{
  background: #fafcfb;
}}
.md-math {{
  font-family: Georgia, "Times New Roman", serif;
  font-style: italic;
  color: var(--ink);
}}
.md-math-block {{
  margin: 12px 0;
  padding: 10px 14px;
  background: var(--paper);
  border-radius: 8px;
  text-align: center;
  font-size: 15px;
}}
{pygments_css}
.md-code-pre .mi, .md-code-pre .m, .md-code-pre .mf, .md-code-pre .mh, .md-code-pre .il, .md-code-pre .mo {{ color: #0b583f !important; font-weight: 600; }}
.md-code-pre .c, .md-code-pre .c1, .md-code-pre .cm, .md-code-pre .cp {{ color: #475954 !important; }}
.md-code-pre .s, .md-code-pre .s1, .md-code-pre .s2, .md-code-pre .sb, .md-code-pre .sc {{ color: #8a2a17 !important; }}
.md-code-pre .k, .md-code-pre .kd, .md-code-pre .kn, .md-code-pre .kp, .md-code-pre .kr, .md-code-pre .kt {{ color: #0d4a3e !important; font-weight: 700; }}
.md-code-pre .nn, .md-code-pre .nc, .md-code-pre .nf, .md-code-pre .na {{ color: #163e6c !important; }}
.md-code-pre .nt, .md-code-pre .nv {{ color: #102e2c !important; font-weight: 600; }}
.md-code-pre .o, .md-code-pre .p {{ color: #173b38 !important; }}
@media (max-width: 1080px) {{
  .md-layout {{
    flex-direction: column;
    padding: 14px 12px 36px;
  }}
  .md-toc-sidebar {{
    width: 100%;
    position: static;
    max-height: 240px;
  }}
}}
@media (max-width: 760px) {{
  .md-tb-meta, .md-search-wrap {{ display: none; }}
  .md-toolbar {{ padding: 8px 10px; flex-wrap: wrap; }}
  .md-sheet {{ padding: 18px 14px 28px; border-radius: 12px; }}
  .md-h1 {{ font-size: 18px; }}
  .md-h2 {{ font-size: 16px; }}
  .md-h3 {{ font-size: 14.5px; }}
  .tb-btn span {{ display: none; }}
  .tb-btn.primary span {{ display: inline; }}
}}
@media print {{
  html, body {{ background: #ffffff !important; }}
  .md-toolbar, .md-toc-sidebar, .md-copy-btn {{ display: none !important; }}
  .md-layout {{ padding: 0 !important; display: block !important; max-width: 100% !important; }}
  .md-sheet {{
    width: 100% !important;
    padding: 0 !important;
    border: 0 !important;
    zoom: 1 !important;
  }}
  .md-table tr, .md-code-card, .md-diagram-card {{ page-break-inside: avoid; }}
}}
</style>
</head>
<body>
{actions_html}
<div class="md-layout">
  {toc_aside_html}
  <main class="md-sheet" id="mdSheet">
    {parsed["body_html"]}
  </main>
</div>
{script_html}
</body>
</html>"""


def render_markdown_to_pdf_bytes(md_input: bytes | str, *, title: str = "Tài liệu Markdown (.md)") -> bytes:
    """Kết xuất file .md sang bản PDF A4 qua WeasyPrint."""
    import weasyprint

    html_str = render_markdown_preview_html(md_input, title=title, print_mode=True)
    return weasyprint.HTML(string=html_str).write_pdf()


def resolve_repo_markdown_path(repo_root: Path, slug_or_path: str) -> Path | None:
    """Tìm file .md an toàn bên trong repo_root/docs hoặc repo_root (chống path traversal)."""
    cleaned = (slug_or_path or "").strip().lstrip("/")
    if not cleaned or ".." in cleaned:
        return None
    if cleaned.startswith("docs/"):
        rel = cleaned[len("docs/"):]
    else:
        rel = cleaned

    candidates: list[Path] = []
    for base in (repo_root / "docs", repo_root):
        p1 = (base / rel).resolve()
        p2 = (base / f"{rel}.md").resolve()
        candidates.extend([p1, p2])

    root_resolved = repo_root.resolve()
    for cand in candidates:
        try:
            cand.relative_to(root_resolved)
        except ValueError:
            continue
        if cand.is_file() and cand.suffix.lower() in (".md", ".markdown"):
            return cand

    # Fallback tìm không phân biệt hoa thường trong repo_root/docs
    target_names = {Path(rel).name.lower(), f"{Path(rel).name.lower()}.md"}
    docs_dir = (repo_root / "docs").resolve()
    if docs_dir.is_dir():
        for p in docs_dir.rglob("*.md"):
            if p.name.lower() in target_names:
                return p
    return None
