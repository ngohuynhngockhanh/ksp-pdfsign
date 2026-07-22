import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  TaxFinding,
  TaxGrid,
  TaxReviewItem,
  TaxReviewSummary,
  TaxReport,
  TaxPolicy,
} from "../api";

function vnd(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString("vi-VN");
}

const thisYear = new Date().getFullYear();
const KY_OPTS: string[] = [];
for (const y of [thisYear, thisYear - 1]) {
  for (const q of [4, 3, 2, 1]) KY_OPTS.push(`${y}-Q${q}`);
}
const curQuarter = Math.floor(new Date().getMonth() / 3) + 1;
const DEFAULT_KY = `${thisYear}-Q${curQuarter}`;

/** Mã chỉ tiêu bị đánh lỗi -> tô đỏ ô trong grid. */
function flaggedCodes(findings: TaxFinding[]): Set<string> {
  const s = new Set<string>();
  for (const f of findings)
    for (const c of f.cells) if (/^\d+[a-z]?$/.test(c)) s.add(c);
  return s;
}

function Findings({ findings, active, onSelect }: { findings: TaxFinding[]; active: number; onSelect: (index: number) => void }) {
  if (!findings.length)
    return (
      <div className="panel" style={{ borderLeft: "4px solid var(--green, #16a34a)" }}>
        ✅ Không phát hiện lỗi tự động. Vẫn nên soát lại chứng từ gốc.
      </div>
    );
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {findings.map((f, i) => (
        <button
          key={i}
          className={`panel finding-card${active === i ? " active" : ""}`}
          onClick={() => onSelect(i)}
          style={{
            borderLeft: `4px solid ${f.level === "do" ? "#dc2626" : "#d97706"}`,
          }}
        >
          <div style={{ fontWeight: 600 }}>
            <span className={`chip ${f.level === "do" ? "red" : "amber"}`}>
              {f.level === "do" ? "ĐỎ" : "VÀNG"}
            </span>{" "}
            {f.title}
          </div>
          <div className="muted" style={{ marginTop: 4 }}>
            {f.detail}
          </div>
          <span className="finding-open">Xem vùng lỗi trong Excel →</span>
        </button>
      ))}
    </div>
  );
}

function Summary({ s }: { s: TaxReviewSummary }) {
  const items: [string, string][] = [
    ["Doanh thu bán ra", vnd(s.ban_ra_dt)],
    ["Thuế bán ra [35]", vnd(s.ban_ra_thue)],
    ["Mua vào [23]", vnd(s.mua_vao_dt)],
    ["Thuế mua vào [25]", vnd(s.mua_vao_thue)],
    ["Khấu trừ kỳ trước [22]", vnd(s.khau_tru_ky_truoc)],
    ["Phát sinh [36]", vnd(s.ct_36)],
    ["Phải nộp [40]", vnd(s.ct_40)],
    ["Chuyển kỳ sau [43]", vnd(s.ct_43)],
    ["Số HĐ bán / mua", `${s.so_hd_ban} / ${s.so_hd_mua}`],
  ];
  return (
    <div className="tax-sum">
      {items.map(([k, v]) => (
        <div key={k} className="tax-sum-i">
          <div className="muted">{k}</div>
          <div style={{ fontWeight: 600 }}>{v}</div>
        </div>
      ))}
    </div>
  );
}

function GridView({ grid, flags, focusCode }: { grid: TaxGrid; flags: Set<string>; focusCode: string }) {
  // Ô bị merge (không phải góc trên-trái) -> bỏ qua khi render.
  const covered = new Set<string>();
  const anchor = new Map<string, { rs: number; cs: number }>();
  for (const [r1, c1, r2, c2] of grid.merges) {
    anchor.set(`${r1},${c1}`, { rs: r2 - r1 + 1, cs: c2 - c1 + 1 });
    for (let r = r1; r <= r2; r++)
      for (let c = c1; c <= c2; c++)
        if (!(r === r1 && c === c1)) covered.add(`${r},${c}`);
  }
  return (
    <div className="table-wrap xls-wrap">
      <table className="xls">
        <tbody>
          {grid.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => {
                if (covered.has(`${r},${c}`)) return null;
                const a = anchor.get(`${r},${c}`);
                const code = cell.trim().replace(/^\[|\]$/g, "");
                const flagged = /^\[\d+[a-z]?\]$/.test(cell.trim()) && flags.has(code);
                // tô cả ô giá trị liền phải nhãn bị lỗi
                const prev = c > 0 ? row[c - 1].trim() : "";
                const prevFlag =
                  /^\[\d+[a-z]?\]$/.test(prev) && flags.has(prev.replace(/^\[|\]$/g, ""));
                const num = /^[\d.,\-]+$/.test(cell.trim()) && cell.trim() !== "";
                return (
                  <td
                    key={c}
                    id={/^\[\d+[a-z]?\]$/.test(cell.trim()) ? `tax-cell-${code}` : undefined}
                    rowSpan={a?.rs}
                    colSpan={a?.cs}
                    className={
                      (flagged || (prevFlag && cell.trim()) ? "flag " : "") +
                      (focusCode === code ? "focus-cell " : "") +
                      (num ? "num" : "")
                    }
                  >
                    {cell}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FindingSnapshot({ grid, code }: { grid: TaxGrid; code: string }) {
  const hit = grid.rows.findIndex((row) => row.some((cell) => cell.trim() === `[${code}]`));
  if (hit < 0) return null;
  const from = Math.max(0, hit - 2);
  return (
    <div className="finding-snapshot">
      <div className="snapshot-label">Ảnh chụp vùng Excel liên quan · [{code}]</div>
      <div className="table-wrap"><table className="xls"><tbody>
        {grid.rows.slice(from, hit + 3).map((row, i) => (
          <tr key={from + i}>{row.map((cell, c) => (
            <td key={c} className={cell.trim() === `[${code}]` ? "focus-cell" : ""}>{cell}</td>
          ))}</tr>
        ))}
      </tbody></table></div>
    </div>
  );
}

export function TaxReview() {
  const [kyFilter, setKyFilter] = useState("");
  const [list, setList] = useState<TaxReviewItem[]>([]);
  const [sel, setSel] = useState<{
    id: number;
    ky: string;
    ten_file: string;
    note: string;
    findings: TaxFinding[];
    summary: TaxReviewSummary;
    grids: TaxGrid[];
  } | null>(null);
  const [sheet, setSheet] = useState(0);
  const [ky, setKy] = useState(DEFAULT_KY);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [err, setErr] = useState("");
  const [reports, setReports] = useState<TaxReport[]>([]);
  const [diffs, setDiffs] = useState<{ indicator: string; crm: number; accountant: number; difference: number; match: boolean }[]>([]);
  const [activeFinding, setActiveFinding] = useState(-1);
  const [focusCode, setFocusCode] = useState("");
  const [policy, setPolicy] = useState<TaxPolicy | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function reload() {
    try {
      const [uploads, reportRows] = await Promise.all([api.taxReviewList(kyFilter), api.taxReports()]);
      setList(uploads); setReports(reportRows);
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    reload();
    api.taxPolicy().then(setPolicy).catch(() => undefined);
  }, [kyFilter]);

  async function upload(files: FileList | null) {
    if (!files || !files.length) return;
    setErr("");
    setBusy(true);
    try {
      const r = await api.taxReviewUpload(files[0], ky, note);
      setNote("");
      await reload();
      await open(r.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function open(id: number) {
    setErr("");
    try {
      const d = await api.taxReviewDetail(id);
      setSel(d);
      setSheet(0);
      setActiveFinding(-1);
      setFocusCode("");
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function del(id: number) {
    if (!confirm("Xóa phiên bản này?")) return;
    try {
      await api.taxReviewDelete(id);
      if (sel?.id === id) setSel(null);
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const flags = useMemo(
    () => (sel ? flaggedCodes(sel.findings) : new Set<string>()),
    [sel],
  );
  const matchingReport = sel ? reports.find((r) => r.ky === sel.ky) : undefined;
  async function compare() {
    if (!sel || !matchingReport) return;
    try { setDiffs((await api.compareTaxReport(matchingReport.id, sel.id)).differences); }
    catch (e) { setErr((e as Error).message); }
  }
  async function lockReport() {
    if (!matchingReport || !confirm(`Khóa bản đối chiếu ${matchingReport.ky}? Job tự động sẽ không sửa bản này.`)) return;
    await api.lockTaxReport(matchingReport.id); await reload();
  }
  function selectFinding(index: number) {
    if (!sel) return;
    const code = sel.findings[index].cells.find((c) => /^\d+[a-z]?$/.test(c)) || "";
    setActiveFinding(index);
    setFocusCode(code);
    if (!code) return;
    const gridIndex = sel.grids.findIndex((g) =>
      g.rows.some((row) => row.some((cell) => cell.trim() === `[${code}]`)),
    );
    if (gridIndex >= 0) setSheet(gridIndex);
    window.setTimeout(() => {
      document.getElementById(`tax-cell-${code}`)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }, 100);
  }

  const currentReport = reports.find((r) => r.ky === ky);
  return (
    <div className="tax-studio">
      <header className="tax-studio-hero">
        <div>
          <span className="tax-kicker">VAT CONTROL ROOM</span>
          <h1>Review tờ khai quý</h1>
          <p>Đối chiếu file kế toán với XML hóa đơn, chính sách theo ngày và dữ liệu CRM.</p>
        </div>
        <div className="tax-hero-score">
          <span>Kỳ đang làm</span><strong>{ky}</strong>
          <small>{policy?.reduction_active ? "Checkpoint giảm thuế 8% đang hiệu lực" : "Áp chính sách theo ngày hóa đơn"}</small>
        </div>
      </header>

      <section className="tax-policy-bar">
        <span className="policy-mark">§</span>
        <div><b>Phần mềm KCT → [26]</b><small>Không đưa vào 0% [29]. Nhóm đủ điều kiện giảm còn 8% đến 31/12/2026; nhóm loại trừ vẫn 10%.</small></div>
        {policy && <span className="policy-law">{policy.legal_basis.join(" · ")}</span>}
      </section>

      <section className="tax-command-grid">
        <div className="tax-command-card upload-card">
          <div className="command-head"><span>01</span><div><b>Nhận file kế toán</b><small>Upload và lưu từng phiên bản</small></div></div>
          <div className="command-fields">
            <select value={ky} onChange={(e) => setKy(e.target.value)}>{KY_OPTS.map((k) => <option key={k}>{k}</option>)}</select>
            <input placeholder="Ghi chú phiên bản" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={(e) => upload(e.target.files)} />
          <div className={`studio-drop${dragging ? " dragging" : ""}${busy ? " busy" : ""}`} role="button" tabIndex={0}
            onClick={() => !busy && fileRef.current?.click()}
            onKeyDown={(e) => !busy && (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
            onDragEnter={(e) => { e.preventDefault(); if (!busy) setDragging(true); }} onDragOver={(e) => e.preventDefault()}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
            onDrop={(e) => { e.preventDefault(); setDragging(false); if (!busy) upload(e.dataTransfer.files); }}>
            <span className="drop-badge">{busy ? "···" : "XLSX"}</span><div><b>{busy ? "Đang rà soát…" : "Thả file vào đây"}</b><small>hoặc bấm để chọn từ máy</small></div>
          </div>
        </div>
        <div className="tax-command-card crm-card">
          <div className="command-head"><span>02</span><div><b>Bản tính từ CRM</b><small>Tách KCT · 8% · 10% theo hóa đơn</small></div></div>
          <div className="crm-report-state"><strong>{currentReport ? `v${currentReport.version}` : "Chưa sinh"}</strong><span>{currentReport?.status === "locked" ? "Đã khóa" : "Bản nháp tự cập nhật"}</span></div>
          <div className="command-actions"><button className="studio-primary" onClick={async () => { await api.generateTaxReport(ky); await reload(); }}>Sinh / cập nhật {ky}</button>{currentReport && <a href={api.taxReportFileUrl(currentReport.id)}>Tải XLSX</a>}</div>
        </div>
      </section>

      {err && <div className="error tax-studio-error">{err}</div>}

      <section className={`tax-workspace${sel ? " has-selection" : ""}`}>
        <aside className="tax-review-rail">
          <div className="rail-head"><div><span className="tax-kicker">PHIÊN BẢN</span><h2>File kế toán</h2></div><select value={kyFilter} onChange={(e) => setKyFilter(e.target.value)}><option value="">Tất cả</option>{KY_OPTS.map((k) => <option key={k}>{k}</option>)}</select></div>
          <div className="version-list">
            {list.length === 0 && <div className="rail-empty">Chưa có file BCT.</div>}
            {list.map((r) => <div key={r.id} className={`version-card${sel?.id === r.id ? " active" : ""}`} role="button" tabIndex={0} onClick={() => open(r.id)} onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(r.id); }
            }}>
              <div className="version-top"><strong>{r.ky || "Chưa rõ kỳ"}</strong><span>{r.n_do ? `${r.n_do} đỏ` : r.n_vang ? `${r.n_vang} vàng` : "OK"}</span></div>
              <b className="version-file">{r.ten_file}</b><small>{r.note || "Không có ghi chú"}</small>
              <div className="version-meta"><span>{r.uploaded_at?.slice(0, 16).replace("T", " ")}</span><span className="version-actions" onClick={(e) => e.stopPropagation()}><a href={api.taxReviewFileUrl(r.id)}>Tải</a><button type="button" onClick={() => del(r.id)}>Xóa</button></span></div>
            </div>)}
          </div>
          {sel && <div className="rail-findings"><div className="rail-section-title"><span>KẾT QUẢ RÀ SOÁT</span><b>{sel.findings.length}</b></div><Findings findings={sel.findings} active={activeFinding} onSelect={selectFinding} /></div>}
        </aside>

        <main className="tax-review-stage">
          {!sel ? <div className="tax-stage-empty"><span>↖</span><h2>Chọn một phiên bản để bắt đầu</h2><p>Hoặc tải file Excel mới ở khu vực phía trên. CRM sẽ dò sai nhóm thuế, công thức và chỉ tiêu.</p></div> : <>
            <header className="stage-head"><div><span className="tax-kicker">ĐANG REVIEW · {sel.ky}</span><h2>{sel.ten_file}</h2></div><div className="stage-verdict"><span className={sel.summary.do ? "bad" : "ok"}>{sel.summary.do ? `${sel.summary.do} lỗi cần sửa` : "Không có lỗi đỏ"}</span><small>{sel.summary.vang} điểm cần xác nhận</small></div></header>
            <Summary s={sel.summary} />

            {matchingReport && <section className="compare-strip"><div><b>CRM v{matchingReport.version}</b><span>↔</span><b>File kế toán</b></div><div><button onClick={compare}>So sánh chỉ tiêu</button>{matchingReport.status === "draft" && <button onClick={lockReport}>Khóa bản CRM</button>}</div></section>}
            {diffs.length > 0 && <div className="compare-results"><table className="dt"><thead><tr><th>Chỉ tiêu</th><th>CRM</th><th>Kế toán</th><th>Kết quả</th></tr></thead><tbody>{diffs.map((d) => <tr key={d.indicator} className={d.match ? "" : "row-neg"}><td>[{d.indicator}]</td><td className="num">{vnd(d.crm)}</td><td className="num">{vnd(d.accountant)}</td><td>{d.match ? "Khớp" : `Lệch ${vnd(d.difference)}`}</td></tr>)}</tbody></table></div>}
            {activeFinding >= 0 && focusCode && sel.grids[sheet] && <FindingSnapshot grid={sel.grids[sheet]} code={focusCode} />}

            <div className="excel-toolbar"><div className="tax-sheets">{sel.grids.map((g, i) => <button key={g.name} className={i === sheet ? "active" : ""} onClick={() => setSheet(i)}>{g.name}</button>)}</div><span>{focusCode ? `Đang xem chỉ tiêu [${focusCode}]` : "Bấm cảnh báo để nhảy tới ô liên quan"}</span></div>
            {sel.grids[sheet] && <GridView grid={sel.grids[sheet]} flags={flags} focusCode={focusCode} />}
          </>}
        </main>
      </section>
    </div>
  );
}
