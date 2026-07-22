import { useEffect, useState } from "react";
import { api, IhoadonDashboard, IhoadonDraft, InvItem, SaleDraftLine } from "../api";

function vnd(n: number): string {
  return Math.round(n || 0).toLocaleString("vi-VN");
}
function parseNum(s: string | number): number {
  if (typeof s === "number") return s;
  return Number(String(s).replace(/[^\d.-]/g, "")) || 0;
}

// Thue suat theo sheet Danh_muc cua khuon iHoadon
const VAT_OPTIONS = ["10%", "8%", "5%", "0%", "10%x70%", "5%x70%", "Không chịu thuế"];

// Thanh tien va tien thue tu 1 dong
function tienThue(ln: SaleDraftLine): number {
  const tt = ln.thanh_tien || Math.round(ln.so_luong * ln.don_gia);
  const m = /^(\d+(?:[.,]\d+)?)%?(?:x(\d+(?:[.,]\d+)?)%?)?$/.exec(
    ln.vat_name.replace(/\s/g, "").toLowerCase(),
  );
  if (!m) return 0; // KCT / Vat -> 0
  const base = Number(m[1].replace(",", "."));
  const factor = m[2] ? Number(m[2].replace(",", ".")) / 100 : 1;
  return Math.round((tt * base * factor) / 100);
}

function blankLine(): SaleDraftLine {
  return { ma_hang: "", ten: "", dvt: "", so_luong: 1, don_gia: 0, thanh_tien: 0, vat_name: "10%", is_dich_vu: false };
}

export function SaleDraft() {
  const [lines, setLines] = useState<SaleDraftLine[]>([blankLine()]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState<{ row: number; q: string; results: InvItem[] } | null>(null);
  // AI goi y
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMoTa, setAiMoTa] = useState("");
  const [aiCtx, setAiCtx] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState("");
  const [ihd, setIhd] = useState<IhoadonDashboard | null>(null);
  const [drafts, setDrafts] = useState<IhoadonDraft[]>([]);
  const [ihdErr, setIhdErr] = useState("");
  const [customer, setCustomer] = useState({
    customer_name: "", buyer_tax_code: "", buyer_name: "", buyer_email: "",
    buyer_address: "", payment_method_name: "TM/CK", note: "",
  });

  async function syncIhoadon() {
    setIhdErr("");
    try {
      const [d, ls] = await Promise.all([api.ihoadonDashboard(), api.ihoadonDrafts()]);
      setIhd(d);
      setDrafts(ls.items);
    } catch (e) {
      setIhd(null);
      setDrafts([]);
      setIhdErr((e as Error).message);
    }
  }

  async function pushDraft() {
    const valid = lines.filter((l) => l.ten.trim()).map((l) => ({ ...l, tien_thue: tienThue(l) }));
    if (!customer.customer_name.trim()) return setErr("Chưa nhập tên khách hàng.");
    if (!valid.length) return setErr("Chưa có dòng hàng nào.");
    setBusy(true);
    setErr("");
    try {
      const r = await api.ihoadonCreateDraft({ ...customer, lines: valid });
      setAiNote(`Đã tạo hóa đơn ${r.status} trên iHOADON · mẫu ${r.template_code}/${r.invoice_series}`);
      await syncIhoadon();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    syncIhoadon();
  }, []);

  function setLine(i: number, patch: Partial<SaleDraftLine>) {
    setLines((ls) =>
      ls.map((l, j) => {
        if (j !== i) return l;
        const next = { ...l, ...patch };
        if ("so_luong" in patch || "don_gia" in patch) {
          next.thanh_tien = Math.round(next.so_luong * next.don_gia);
        }
        return next;
      }),
    );
  }
  async function searchRow(i: number, q: string) {
    setSearch({ row: i, q, results: search?.row === i ? search.results : [] });
    if (q.trim().length >= 2) {
      try {
        setSearch({ row: i, q, results: await api.invItems(q) });
      } catch {
        /* ignore */
      }
    }
  }
  async function pickItem(i: number, it: InvItem) {
    setLine(i, { ma_hang: it.ma_hang, ten: it.ten, dvt: it.dvt });
    setSearch(null);
    try {
      const c = await api.invItemCost(it.id, "");
      if (c.don_gia_bq) setLine(i, { don_gia: Math.round(c.don_gia_bq) });
    } catch {
      /* ignore — van sua tay duoc */
    }
  }

  async function exportXlsx() {
    const valid = lines.filter((l) => l.ten.trim());
    if (valid.length === 0) {
      setErr("Chưa có dòng hàng nào (nhập tên hàng).");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await api.invSaleDraftExportXlsx(
        valid.map((l) => ({ ...l, tien_thue: tienThue(l) })),
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function aiSuggest() {
    if (!aiMoTa.trim()) return;
    setAiBusy(true);
    setErr("");
    setAiNote("");
    try {
      const { job_id } = await api.invSaleDraftSuggestStart(aiMoTa, aiCtx);
      // tham do ket qua toi da ~3 phut (giong BOM)
      for (let k = 0; k < 72; k++) {
        await new Promise((r) => setTimeout(r, 2500));
        const j = await api.invSaleDraftSuggestJob(job_id);
        if (j.status === "done" && j.result) {
          const added: SaleDraftLine[] = j.result.lines.map((s) => ({
            ma_hang: s.match?.ma_hang ?? "",
            ten: s.match?.ten ?? s.ten,
            dvt: s.match?.dvt ?? s.dvt ?? "",
            so_luong: s.so_luong || 1,
            don_gia: s.don_gia || 0,
            thanh_tien: Math.round((s.so_luong || 1) * (s.don_gia || 0)),
            vat_name: "10%",
            is_dich_vu: false,
          }));
          setLines((ls) => [...ls.filter((l) => l.ten.trim()), ...added]);
          setAiNote(j.result.note || `AI gợi ý ${added.length} dòng`);
          setAiOpen(false);
          return;
        }
        if (j.status === "error") throw new Error(j.error || "AI lỗi");
      }
      throw new Error("AI xử lý quá lâu, thử lại sau");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  }

  const tongTruoc = lines.reduce((s, l) => s + (l.thanh_tien || Math.round(l.so_luong * l.don_gia)), 0);
  const tongThue = lines.reduce((s, l) => s + tienThue(l), 0);

  return (
    <div className="docs-page">
      <h2>🧾 Xuất hóa đơn · iHOADON</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Soạn dòng hàng rồi đẩy thẳng sang iHOADON ở trạng thái <b>GHI_TAM</b>. CRM không ký hoặc phát hành hóa đơn.
      </p>
      {err && <div className="error">{err}</div>}
      {aiNote && <div className="warn-banner">🤖 {aiNote}</div>}

      <div className="ihd-head">
        <div>
          <h3>Đồng bộ iHOADON</h3>
          <span className="muted">{ihd?.account_name || "Chưa tải trạng thái"}</span>
        </div>
        <button className="btn-sm" onClick={syncIhoadon}>↻ Đồng bộ</button>
        {ihd && <a className="btn-sm primary" href={ihd.web_url} target="_blank" rel="noreferrer">Mở iHOADON ↗</a>}
      </div>
      {ihdErr && <div className="error">{ihdErr} — kiểm tra cấu hình trong Cài đặt.</div>}
      {ihd && (
        <div className="ihd-stats">
          <div><strong>{ihd.issued}</strong><span>Đã xuất</span></div>
          <div><strong>{ihd.draft}</strong><span>Ghi tạm</span></div>
          <div><strong>{ihd.waiting}</strong><span>Chờ xử lý</span></div>
          <div><strong>{ihd.total}</strong><span>Tổng hóa đơn</span></div>
        </div>
      )}
      {drafts.length > 0 && (
        <details className="panel ihd-drafts">
          <summary>Hóa đơn ghi tạm trên iHOADON ({drafts.length} bản mới nhất)</summary>
          <div className="table-wrap">
            <table><thead><tr><th>Khách hàng</th><th>MST</th><th>Mẫu</th><th className="num">Thanh toán</th><th>Ngày tạo</th></tr></thead>
              <tbody>{drafts.map((d) => <tr key={d.id}><td>{d.customer_name}</td><td>{d.buyer_tax_code}</td><td>{d.template_code}/{d.invoice_series}</td><td className="num">{vnd(d.total_payment)}</td><td>{d.created_at.slice(0, 16)}</td></tr>)}</tbody>
            </table>
          </div>
        </details>
      )}

      <div className="panel ihd-customer">
        <h3>Thông tin người mua</h3>
        <div className="form-grid">
          <label className="span-2">Tên khách hàng<input value={customer.customer_name} onChange={(e) => setCustomer({ ...customer, customer_name: e.target.value })} /></label>
          <label>Mã số thuế<input value={customer.buyer_tax_code} onChange={(e) => setCustomer({ ...customer, buyer_tax_code: e.target.value })} /></label>
          <label>Người mua<input value={customer.buyer_name} onChange={(e) => setCustomer({ ...customer, buyer_name: e.target.value })} /></label>
          <label>Email<input type="email" value={customer.buyer_email} onChange={(e) => setCustomer({ ...customer, buyer_email: e.target.value })} /></label>
          <label>Thanh toán<input value={customer.payment_method_name} onChange={(e) => setCustomer({ ...customer, payment_method_name: e.target.value })} /></label>
          <label className="span-2">Địa chỉ<input value={customer.buyer_address} onChange={(e) => setCustomer({ ...customer, buyer_address: e.target.value })} /></label>
          <label className="span-2">Ghi chú<input value={customer.note} onChange={(e) => setCustomer({ ...customer, note: e.target.value })} /></label>
        </div>
      </div>

      <div className="tb-group" style={{ marginBottom: 8 }}>
        <button className="btn-sm" onClick={() => setAiOpen((o) => !o)}>
          🤖 AI gợi ý dòng hàng
        </button>
        <button className="btn-sm primary" disabled={busy} onClick={exportXlsx}>
          {busy ? "Đang xuất…" : "⬇️ Xuất Excel bảng kê"}
        </button>
        <button className="btn-sm primary" disabled={busy} onClick={pushDraft}>
          {busy ? "Đang gửi…" : "Đẩy bản ghi tạm sang iHOADON"}
        </button>
      </div>

      {aiOpen && (
        <div className="panel" style={{ marginBottom: 10 }}>
          <label>
            Mô tả nội dung cần bán
            <input
              style={{ width: "100%" }}
              placeholder="vd: bộ camera 4 mắt cho nhà xưởng, kèm đầu ghi + ổ cứng"
              value={aiMoTa}
              onChange={(e) => setAiMoTa(e.target.value)}
            />
          </label>
          <label>
            Hướng dẫn thêm cho AI (tuỳ chọn)
            <input
              style={{ width: "100%" }}
              placeholder="vd: dùng camera Dahua, thẻ nhớ 64G…"
              value={aiCtx}
              onChange={(e) => setAiCtx(e.target.value)}
            />
          </label>
          <button className="btn-sm primary" disabled={aiBusy || !aiMoTa.trim()} onClick={aiSuggest}>
            {aiBusy ? "⏳ AI đang nghĩ…" : "✨ Gợi ý"}
          </button>
        </div>
      )}

      <div className="table-wrap">
        <table className="doc-table">
          <thead>
            <tr>
              <th style={{ width: "34%" }}>Tên hàng (từ kho)</th>
              <th>ĐVT</th>
              <th style={{ width: 70 }}>SL</th>
              <th style={{ width: 110 }}>Đơn giá</th>
              <th style={{ width: 120 }}>Thành tiền</th>
              <th style={{ width: 130 }}>Thuế</th>
              <th style={{ width: 110 }}>Tiền thuế</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <input
                    style={{ width: "100%" }}
                    value={l.ten}
                    placeholder="gõ ≥2 ký tự để tìm mã kho…"
                    onChange={(e) => {
                      setLine(i, { ten: e.target.value });
                      searchRow(i, e.target.value);
                    }}
                  />
                  {l.ma_hang && <span className="chip green sm">{l.ma_hang}</span>}
                  {l.is_dich_vu && <span className="chip gray sm">dịch vụ</span>}
                  {search?.row === i &&
                    search.results.slice(0, 6).map((it) => (
                      <div key={it.id}>
                        <button className="btn-sm ghost" onClick={() => pickItem(i, it)}>
                          <b>{it.ma_hang}</b> · {it.ten}
                        </button>
                      </div>
                    ))}
                </td>
                <td>
                  <input style={{ width: 60 }} value={l.dvt} onChange={(e) => setLine(i, { dvt: e.target.value })} />
                </td>
                <td>
                  <input
                    style={{ width: 60, textAlign: "right" }}
                    value={l.so_luong}
                    onChange={(e) => setLine(i, { so_luong: parseNum(e.target.value) })}
                  />
                </td>
                <td>
                  <input
                    style={{ width: 100, textAlign: "right" }}
                    value={l.don_gia}
                    onChange={(e) => setLine(i, { don_gia: parseNum(e.target.value) })}
                  />
                </td>
                <td style={{ textAlign: "right" }}>{vnd(l.thanh_tien || l.so_luong * l.don_gia)}</td>
                <td>
                  <select value={l.vat_name} onChange={(e) => setLine(i, { vat_name: e.target.value })}>
                    {!VAT_OPTIONS.includes(l.vat_name) && <option value={l.vat_name}>{l.vat_name}</option>}
                    {VAT_OPTIONS.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ textAlign: "right" }} className="muted">
                  {vnd(tienThue(l))}
                </td>
                <td>
                  <label className="muted" style={{ fontSize: 11, display: "block" }}>
                    <input
                      type="checkbox"
                      checked={l.is_dich_vu}
                      onChange={(e) => setLine(i, { is_dich_vu: e.target.checked })}
                    />{" "}
                    DV
                  </label>
                  <button className="danger-link" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                    Xóa
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn-sm" onClick={() => setLines([...lines, blankLine()])}>
        + Thêm dòng
      </button>

      <div className="warn-banner" style={{ marginTop: 10, display: "flex", gap: 24, flexWrap: "wrap" }}>
        <span>
          Tổng trước thuế: <b>{vnd(tongTruoc)}</b> đ
        </span>
        <span>
          Tổng tiền thuế: <b>{vnd(tongThue)}</b> đ
        </span>
        <span>
          Tổng thanh toán: <b>{vnd(tongTruoc + tongThue)}</b> đ
        </span>
      </div>
    </div>
  );
}
