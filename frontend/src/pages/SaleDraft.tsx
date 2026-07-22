import { useEffect, useState } from "react";
import { api, IhoadonDashboard, IhoadonDraft, InvItem, SaleDraftLine, TaxPolicy } from "../api";
import { SmartPartyPaste } from "../components/SmartPartyPaste";

function vnd(n: number): string {
  return Math.round(n || 0).toLocaleString("vi-VN");
}
function parseNum(s: string | number): number {
  if (typeof s === "number") return s;
  return Number(String(s).replace(/[^\d.-]/g, "")) || 0;
}
function norm(s: string): string {
  return s.trim().toLowerCase().replace(/đ/g, "d").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
}
type StockInfo = { ma_hang: string; ten: string; dvt: string; qty: number; cost: number };

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
  const now = new Date().toISOString().slice(0, 10);
  const reduced = now >= "2025-07-01" && now <= "2026-12-31";
  return { ma_hang: "", ten: "", dvt: "", so_luong: 1, don_gia: 0, thanh_tien: 0, vat_name: reduced ? "8%" : "10%", is_dich_vu: false };
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
  const [stockByCode, setStockByCode] = useState<Record<string, number>>({});
  const [stockCatalog, setStockCatalog] = useState<StockInfo[]>([]);
  const [stockBusy, setStockBusy] = useState(false);
  const [stockCheckedAt, setStockCheckedAt] = useState("");
  const [policy, setPolicy] = useState<TaxPolicy | null>(null);
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
    const stockProblems = valid.filter((l) => !l.is_dich_vu && (!l.ma_hang || stockByCode[l.ma_hang] == null || stockByCode[l.ma_hang] < l.so_luong));
    if (stockProblems.length && !window.confirm(
      `${stockProblems.length} dòng chưa map kho hoặc không đủ tồn. Vẫn tạo bản GHI_TẠM trên iHOADON?\n\n` +
      stockProblems.map((l) => `• ${l.ma_hang || "Chưa có mã"} · cần ${l.so_luong}, tồn ${l.ma_hang && stockByCode[l.ma_hang] != null ? stockByCode[l.ma_hang] : "chưa rõ"}`).join("\n")
    )) return;
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
    loadStock().catch(() => undefined);
    api.taxPolicy().then(setPolicy).catch(() => undefined);
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
      setStockByCode((old) => ({ ...old, [it.ma_hang]: c.ton_hien_tai }));
      if (c.don_gia_bq) setLine(i, { don_gia: Math.round(c.don_gia_bq) });
    } catch {
      /* ignore — van sua tay duoc */
    }
  }

  async function loadStock(): Promise<StockInfo[]> {
    setStockBusy(true);
    try {
      const date = new Date().toISOString().slice(0, 10);
      const report = await api.invAvailability(date);
      const byCode = new Map<string, StockInfo>();
      for (const row of report.rows) {
        const current = byCode.get(row.ma_hang);
        const qty = row.kha_dung ?? row.ton;
        byCode.set(row.ma_hang, {
          ma_hang: row.ma_hang,
          ten: current?.ten || row.ten,
          dvt: current?.dvt || row.dvt,
          qty: (current?.qty || 0) + qty,
          cost: row.don_gia_bq || current?.cost || 0,
        });
      }
      const catalog = [...byCode.values()];
      setStockCatalog(catalog);
      setStockByCode(Object.fromEntries(catalog.map((item) => [item.ma_hang, item.qty])));
      setStockCheckedAt(new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }));
      return catalog;
    } finally {
      setStockBusy(false);
    }
  }

  async function syncLinesFromStock() {
    try {
      const catalog = stockCatalog.length ? stockCatalog : await loadStock();
      let matched = 0;
      setLines((current) => current.map((line) => {
        if (line.is_dich_vu || !line.ten.trim()) return line;
        const hit = catalog.find((item) => item.ma_hang === line.ma_hang)
          || catalog.find((item) => norm(item.ten) === norm(line.ten));
        if (!hit) return line;
        matched += 1;
        const donGia = line.don_gia || Math.round(hit.cost);
        return { ...line, ma_hang: hit.ma_hang, ten: hit.ten, dvt: hit.dvt || line.dvt, don_gia: donGia, thanh_tien: Math.round(line.so_luong * donGia) };
      }));
      setAiNote(`Đã đồng bộ ${matched} dòng từ kho. Số lượng bán được giữ nguyên; giá chỉ bổ sung cho dòng đang bằng 0.`);
    } catch (e) {
      setErr(`Không đọc được tồn kho: ${(e as Error).message}`);
    }
  }

  async function checkStock() {
    try {
      await loadStock();
      setAiNote("Đã cập nhật tồn khả dụng mới nhất từ kho CRM.");
    } catch (e) {
      setErr(`Không kiểm tra được kho: ${(e as Error).message}`);
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
  const stockWarnings = lines.filter((l) => l.ten.trim() && !l.is_dich_vu).map((l) => {
    if (!l.ma_hang || stockByCode[l.ma_hang] == null) return { line: l, level: "unknown", text: "Chưa map mã kho" };
    const ton = stockByCode[l.ma_hang];
    return ton + 1e-6 < l.so_luong
      ? { line: l, level: "short", text: `Thiếu ${vnd(l.so_luong - ton)} (tồn ${vnd(ton)})` }
      : { line: l, level: "ok", text: `Đủ tồn: ${vnd(ton)}` };
  });

  return (
    <div className="docs-page sale-draft-studio">
      <header className="sale-draft-hero">
        <div><span className="eyebrow">INVOICE WORKBENCH</span><h1>Tạo hóa đơn nháp</h1><p>Soạn, kiểm tra kho và đồng bộ sang iHOADON ở trạng thái GHI_TAM.</p></div>
        <div className="sale-draft-hero-actions"><button onClick={syncIhoadon}>Đồng bộ iHOADON</button>{ihd && <a href={ihd.web_url} target="_blank" rel="noreferrer">Mở iHOADON ↗</a>}</div>
      </header>
      {policy && <div className="tax-policy-checkpoint">
        <b>Checkpoint thuế theo ngày {new Date(policy.date).toLocaleDateString("vi-VN")}</b>
        <span>Nhóm vốn chịu 10% và đủ điều kiện giảm: <strong>{policy.standard_eligible_rate}%</strong> đến {new Date(policy.reduction_to).toLocaleDateString("vi-VN")}.</span>
        <span>Phần mềm thuộc diện không chịu thuế: chọn <strong>Không chịu thuế</strong>, không chọn 0%.</span>
        <small>Căn cứ: {policy.legal_basis.join(" · ")}. Nhóm bị loại trừ vẫn áp 10%.</small>
      </div>}
      {err && <div className="error">{err}</div>}
      {aiNote && <div className="warn-banner">🤖 {aiNote}</div>}

      {ihdErr && <div className="error">{ihdErr} — kiểm tra cấu hình trong Cài đặt.</div>}
      {ihd && (
        <div className="ihd-stats sale-draft-stats">
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

      <div className="panel ihd-customer sale-customer-card">
        <div className="sale-section-head"><div><span>01 · NGƯỜI MUA</span><h3>Thông tin xuất hóa đơn</h3></div><small>Các trường này sẽ đi thẳng sang bản nháp iHOADON</small></div>
        <SmartPartyPaste onApply={(data) => setCustomer((current) => ({
          ...current,
          customer_name: data.name || current.customer_name,
          buyer_tax_code: data.mst || current.buyer_tax_code,
          buyer_name: data.nguoi_nhan || data.dai_dien || current.buyer_name,
          buyer_email: data.email || current.buyer_email,
          buyer_address: data.address || current.buyer_address,
        }))} />
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

      <div className="draft-command-bar">
        <button className="btn-sm" onClick={() => setAiOpen((o) => !o)}>
          AI gợi ý dòng hàng
        </button>
        <button className="btn-sm stock-command" disabled={stockBusy} onClick={checkStock}>{stockBusy ? "Đang kiểm tra…" : "Check kho"}</button>
        <button className="btn-sm stock-command" disabled={stockBusy} onClick={syncLinesFromStock}>Sync từ kho</button>
        <button className="btn-sm primary" disabled={busy} onClick={exportXlsx}>
          {busy ? "Đang xuất…" : "Xuất Excel"}
        </button>
        <button className="btn-sm primary" disabled={busy} onClick={pushDraft}>
          {busy ? "Đang gửi…" : "Tạo nháp trên iHOADON"}
        </button>
        <span className="stock-check-time">{stockCheckedAt ? `Kho kiểm tra lúc ${stockCheckedAt}` : "Kho chưa được kiểm tra"}</span>
      </div>
      {stockWarnings.length > 0 && <div className="stock-warning-strip">
        <strong>Kiểm tra tồn kho trước khi tạo nháp</strong>
        <div>{stockWarnings.map((w, i) => <span key={i} className={`stock-check ${w.level}`}>{w.line.ma_hang || w.line.ten}: {w.text}</span>)}</div>
      </div>}

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

      <div className="sale-section-head sale-lines-head"><div><span>02 · NỘI DUNG HÓA ĐƠN</span><h3>Dòng hàng và dịch vụ</h3></div><small>Sync kho không thay đổi số lượng anh đã nhập</small></div>
      <div className="table-wrap sale-lines-table">
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
                  {l.ma_hang && stockByCode[l.ma_hang] != null && <span className={`chip sm ${stockByCode[l.ma_hang] + 1e-6 >= l.so_luong ? "green" : "red"}`}>Kho: {vnd(stockByCode[l.ma_hang])} {l.dvt}</span>}
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
                  <input className={l.ten.trim() && !l.is_dich_vu && !l.dvt.trim() ? "field-missing" : ""} style={{ width: 60 }} value={l.dvt} placeholder={!l.is_dich_vu ? "Thiếu" : ""} onChange={(e) => setLine(i, { dvt: e.target.value })} />
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

      <div className="sale-draft-totals">
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
