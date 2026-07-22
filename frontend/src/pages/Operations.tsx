import { useEffect, useMemo, useState } from "react";
import { api, OperationsDashboard, TaxReport } from "../api";

function previousQuarter(): string {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return q === 1 ? `${d.getFullYear() - 1}-Q4` : `${d.getFullYear()}-Q${q - 1}`;
}

const stateLabel = {
  missing: "Thiếu file nguồn",
  renderable: "Có thể dựng PDF",
  source_only: "Chỉ có XML",
};

export function Operations({ navigate }: { navigate: (tab: string) => void }) {
  const [data, setData] = useState<OperationsDashboard | null>(null);
  const [reports, setReports] = useState<TaxReport[]>([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [ky, setKy] = useState(previousQuarter());

  async function load() {
    try {
      const [dashboard, reportRows] = await Promise.all([api.operationsDashboard(), api.taxReports()]);
      setData(dashboard); setReports(reportRows); setErr("");
    } catch (e) { setErr((e as Error).message); }
  }
  useEffect(() => { load(); }, []);

  const actionable = useMemo(() => data?.document_queue.slice(0, 12) ?? [], [data]);
  async function runSync() {
    setBusy("sync");
    try { await api.runTaxSyncJob(); await load(); } catch (e) { setErr((e as Error).message); }
    finally { setBusy(""); }
  }
  async function generate() {
    setBusy("report");
    try { await api.generateTaxReport(ky); await load(); } catch (e) { setErr((e as Error).message); }
    finally { setBusy(""); }
  }

  if (!data) return <main className="ops-page"><div className="ops-loading">{err || "Đang tổng hợp trung tâm vận hành…"}</div></main>;
  const sync = data.latest_sync;
  return (
    <main className="ops-page">
      <section className="ops-hero">
        <div><span className="eyebrow">INUT · TRUNG TÂM VẬN HÀNH</span><h1>Mọi việc cần duyệt, ở một chỗ.</h1><p>Hóa đơn, chứng từ và tờ khai được theo dõi liên tục — CRM không tự ghi sổ hay nộp thuế.</p></div>
        <button className="ops-sync" disabled={!!busy} onClick={runSync}>{busy === "sync" ? "Đang đồng bộ…" : "Đồng bộ thuế ngay"}</button>
      </section>
      {err && <div className="error">{err}</div>}
      {sync?.needs_action && <button className="ops-alert critical" onClick={() => navigate("thuesync")}><b>Cần đăng nhập lại cổng thuế</b><span>{sync.error}</span><strong>Mở xử lý →</strong></button>}
      <section className="metric-grid">
        <article className="metric-card teal"><span>HÓA ĐƠN MUA</span><b>{data.purchases}</b><small>{data.purchase_drafts} bản nháp chờ duyệt</small></article>
        <article className="metric-card ink"><span>HÓA ĐƠN BÁN</span><b>{data.sales}</b><small>{data.sale_drafts} bản nháp</small></article>
        <article className="metric-card coral"><span>THIẾU CHỨNG TỪ</span><b>{data.documents.missing}</b><small>Cần tìm hoặc tải lại file gốc</small></article>
        <article className="metric-card amber"><span>CHƯA CÓ PDF</span><b>{data.documents.renderable + data.documents.source_only}</b><small>{data.documents.renderable} bản có thể dựng ngay</small></article>
      </section>
      <section className="ops-grid">
        <article className="ops-panel">
          <header><div><span className="eyebrow">HÀNG CHỜ</span><h2>Chứng từ cần hoàn thiện</h2></div><button className="text-action" onClick={() => navigate("nhaphang")}>Mở Nhập hàng →</button></header>
          <div className="action-list">
            {actionable.length === 0 && <div className="empty-state">Tất cả chứng từ đã sẵn sàng.</div>}
            {actionable.map((x) => <div className={`action-row ${x.state}`} key={`${x.kind}-${x.id}`}>
              <span className="status-dot"/><div className="action-main"><b>{x.so_hd || `#${x.id}`} · {x.partner || "Chưa rõ đối tác"}</b><small>{x.ngay} · {x.kind === "purchase" ? "Mua vào" : "Bán ra"}</small></div>
              <span className="state-pill">{stateLabel[x.state]}</span>
              {x.kind === "purchase" && x.state === "renderable" && <a className="mini-action" href={`/api/inv/purchase/${x.id}/pdf`}>Dựng PDF</a>}
            </div>)}
          </div>
        </article>
        <article className="ops-panel report-panel">
          <header><div><span className="eyebrow">ĐỐI CHIẾU QUÝ</span><h2>Tờ khai nội bộ</h2></div></header>
          <div className="quarter-create"><input value={ky} onChange={(e) => setKy(e.target.value.toUpperCase())}/><button disabled={!!busy} onClick={generate}>{busy === "report" ? "Đang sinh…" : "Sinh / cập nhật"}</button></div>
          {reports.slice(0, 4).map((r) => <div className="report-row" key={r.id}><div><b>{r.ky}</b><small>v{r.version} · {r.snapshot.so_hd_ban ?? 0} bán / {r.snapshot.so_hd_mua ?? 0} mua</small></div><span className={`state-pill ${r.status}`}>{r.status === "locked" ? "Đã khóa" : "Bản nháp"}</span><a className="mini-action" href={api.taxReportFileUrl(r.id)}>Tải XLSX</a></div>)}
          <button className="wide-secondary" onClick={() => navigate("thuebct")}>Review file kế toán và đối chiếu →</button>
        </article>
      </section>
      <section className="sync-foot"><span className={`sync-light ${sync?.status || "none"}`}/><div><b>Lần đồng bộ gần nhất</b><small>{sync ? `${new Date(sync.started_at).toLocaleString("vi-VN")} · ${sync.period_from} → ${sync.period_to}` : "Chưa có lần chạy tự động"}</small></div><span className="sync-status">{sync?.status || "chưa chạy"}</span></section>
    </main>
  );
}
