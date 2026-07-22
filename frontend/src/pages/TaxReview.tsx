import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  TaxFinding,
  TaxGrid,
  TaxReviewItem,
  TaxReviewSummary,
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

function Findings({ findings }: { findings: TaxFinding[] }) {
  if (!findings.length)
    return (
      <div className="panel" style={{ borderLeft: "4px solid var(--green, #16a34a)" }}>
        ✅ Không phát hiện lỗi tự động. Vẫn nên soát lại chứng từ gốc.
      </div>
    );
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {findings.map((f, i) => (
        <div
          key={i}
          className="panel"
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
        </div>
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

function GridView({ grid, flags }: { grid: TaxGrid; flags: Set<string> }) {
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
                    rowSpan={a?.rs}
                    colSpan={a?.cs}
                    className={
                      (flagged || (prevFlag && cell.trim()) ? "flag " : "") +
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
  const fileRef = useRef<HTMLInputElement>(null);

  async function reload() {
    try {
      setList(await api.taxReviewList(kyFilter));
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    reload();
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

  return (
    <div className="docs-page">
      <h2>Review tờ khai thuế (BCT)</h2>
      <p className="muted">
        Kế toán gửi file Excel BCT — hệ thống tự soát lỗi và cho xem ngay tại đây.
        Mỗi lần gửi lưu thành một phiên bản để đối chiếu.
      </p>

      <div className="tax-rule-note">
        <strong>Quy tắc thuế suất:</strong> hệ thống lấy 10% làm mức thuế GTGT phổ thông và
        vẫn nhận diện 8% cho hàng hóa, dịch vụ thuộc diện được giảm thuế. Cảnh báo 0% không
        tự kết luận phải áp 8% hay 10% mà yêu cầu đối chiếu loại hàng hóa, dịch vụ và hồ sơ.
      </div>

      <div className="panel tax-up">
        <label>
          Kỳ:{" "}
          <select value={ky} onChange={(e) => setKy(e.target.value)}>
            {KY_OPTS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <input
          placeholder="Ghi chú (vd: bản kế toán gửi lần 1)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ flex: 1, minWidth: 180 }}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx"
          hidden
          onChange={(e) => upload(e.target.files)}
        />
        <div
          className={`tax-drop${dragging ? " dragging" : ""}${busy ? " busy" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => !busy && fileRef.current?.click()}
          onKeyDown={(e) => {
            if (!busy && (e.key === "Enter" || e.key === " ")) fileRef.current?.click();
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!busy) upload(e.dataTransfer.files);
          }}
        >
          <span className="tax-drop-icon">{busy ? "…" : "XLSX"}</span>
          <span>
            <strong>{busy ? "Đang đọc và soát file…" : "Kéo file BCT vào đây"}</strong>
            <small>hoặc bấm để chọn file .xlsx</small>
          </span>
        </div>
      </div>

      {err && <div className="error">{err}</div>}

      <div className="tax-toolbar">
        <label>
          Lọc kỳ:{" "}
          <select value={kyFilter} onChange={(e) => setKyFilter(e.target.value)}>
            <option value="">Tất cả</option>
            {KY_OPTS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
      </div>

      {list.length === 0 ? (
        <div className="empty">
          <div className="empty-ic">📄</div>
          Chưa có file nào. Úp file BCT kế toán gửi để bắt đầu.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kỳ</th>
                <th>File</th>
                <th>Ghi chú</th>
                <th className="num">Lỗi</th>
                <th>Người / lúc</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr
                  key={r.id}
                  className={sel?.id === r.id ? "row-sel" : ""}
                  style={{ cursor: "pointer" }}
                  onClick={() => open(r.id)}
                >
                  <td>{r.ky || "—"}</td>
                  <td>{r.ten_file}</td>
                  <td className="muted">{r.note}</td>
                  <td className="num">
                    {r.n_do > 0 && <span className="chip red">{r.n_do} đỏ</span>}{" "}
                    {r.n_vang > 0 && (
                      <span className="chip amber">{r.n_vang} vàng</span>
                    )}
                    {r.n_do + r.n_vang === 0 && (
                      <span className="chip green">OK</span>
                    )}
                  </td>
                  <td className="muted">
                    {r.uploaded_by}
                    <br />
                    {r.uploaded_at?.slice(0, 16).replace("T", " ")}
                  </td>
                  <td>
                    <a
                      href={api.taxReviewFileUrl(r.id)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      Tải
                    </a>{" "}
                    <button
                      className="btn-sm danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        del(r.id);
                      }}
                    >
                      Xóa
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sel && (
        <div className="tax-detail">
          <h3>
            {sel.ten_file} <span className="muted">— {sel.ky}</span>
          </h3>
          <Summary s={sel.summary} />
          <h4>Kết quả soát ({sel.findings.length})</h4>
          <Findings findings={sel.findings} />

          <h4 style={{ marginTop: 16 }}>Xem file</h4>
          <div className="tax-sheets">
            {sel.grids.map((g, i) => (
              <button
                key={i}
                className={i === sheet ? "primary" : "ghost"}
                onClick={() => setSheet(i)}
              >
                {g.name}
              </button>
            ))}
          </div>
          {sel.grids[sheet] && <GridView grid={sel.grids[sheet]} flags={flags} />}
        </div>
      )}
    </div>
  );
}
