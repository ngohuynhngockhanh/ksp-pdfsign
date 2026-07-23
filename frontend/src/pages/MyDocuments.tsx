import { useEffect, useMemo, useState } from "react";
import { api, DOC_TYPES, type CustomerInvoice, type DocRecord } from "../api";
import { copyText } from "../util";

export function MyDocuments({ onVerify }: { onVerify: (docPk: number) => void }) {
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [invoices, setInvoices] = useState<CustomerInvoice[]>([]);
  const [tab, setTab] = useState<"invoices" | "documents">("invoices");
  const [filters, setFilters] = useState({ from: "", to: "", q: "" });
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setErr("");
    setLoading(true);
    try {
      const [invoiceRows, documentRows] = await Promise.all([
        api.myInvoices(filters),
        api.myDocuments(),
      ]);
      setInvoices(invoiceRows);
      setDocs(documentRows);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const shownDocs = useMemo(() => docs.filter((d) => {
    const day = d.created_at.slice(0, 10);
    const text = `${d.filename} ${d.signer_name}`.toLowerCase();
    return (!filters.from || day >= filters.from)
      && (!filters.to || day <= filters.to)
      && (!filters.q || text.includes(filters.q.toLowerCase()));
  }), [docs, filters]);

  async function share(id: number, filename: string) {
    const s = await api.createShare(id, 7, false);
    const exp = new Date(s.expires_at).toLocaleString("vi-VN");
    const text = `${filename}\n${s.url}\n(hết hạn ${exp})`;
    await copyText(text);
    window.alert("Đã tạo link và sao chép:\n\n" + text);
  }

  return (
    <div className="docs-page customer-portal">
      <section className="portal-hero">
        <div><span className="portal-kicker">TRUNG TÂM CHỨNG TỪ</span><h2>Hóa đơn & hồ sơ của tôi</h2><p>Tải hóa đơn điện tử, hợp đồng và biên bản đã được INUT chia sẻ.</p></div>
        <a className="primary portal-zip" href={api.myPortalZipUrl(filters.from, filters.to)}>Tải ZIP theo bộ lọc</a>
      </section>

      <div className="portal-filters panel">
        <label>Từ ngày<input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
        <label>Đến ngày<input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
        <label className="portal-search">Tìm kiếm<input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Số hóa đơn, ký hiệu, tên file..." /></label>
        <button onClick={load} disabled={loading}>{loading ? "Đang tải..." : "Áp dụng"}</button>
      </div>

      <div className="portal-tabs" role="tablist">
        <button className={tab === "invoices" ? "active" : ""} onClick={() => setTab("invoices")}>Hóa đơn <span>{invoices.length}</span></button>
        <button className={tab === "documents" ? "active" : ""} onClick={() => setTab("documents")}>Hồ sơ <span>{shownDocs.length}</span></button>
      </div>
      {err && <div className="error">{err}</div>}

      {tab === "invoices" ? (
        <div className="portal-invoices">
          {invoices.map((inv) => (
            <article className="invoice-ticket" key={inv.id}>
              <div className="invoice-ticket-date"><strong>{inv.invoice_date ? inv.invoice_date.slice(8, 10) : "--"}</strong><span>{inv.invoice_date ? `${inv.invoice_date.slice(5, 7)}/${inv.invoice_date.slice(0, 4)}` : "Chưa rõ"}</span></div>
              <div className="invoice-ticket-main">
                <div className="invoice-ticket-title"><span>HÓA ĐƠN ĐIỆN TỬ</span><strong>{inv.invoice_series || "--"} · {inv.invoice_number || "Chưa có số"}</strong></div>
                <p>{inv.buyer_name || "Khách hàng"} {inv.buyer_tax_code && <small>MST {inv.buyer_tax_code}</small>}</p>
                {inv.sync_error && <div className="invoice-warning">File đang được đồng bộ lại: {inv.sync_error}</div>}
              </div>
              <div className="invoice-ticket-total"><span>Tổng thanh toán</span><strong>{inv.total_payment.toLocaleString("vi-VN")} đ</strong></div>
              <div className="invoice-ticket-actions">
                {inv.pdf_ready ? <a href={api.myInvoiceFileUrl(inv.id, "pdf")}>PDF</a> : <span>PDF</span>}
                {inv.xml_ready ? <a href={api.myInvoiceFileUrl(inv.id, "xml")}>XML</a> : <span>XML</span>}
              </div>
            </article>
          ))}
          {!loading && invoices.length === 0 && <div className="portal-empty">Chưa có hóa đơn nào khớp tài khoản của bạn.</div>}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="dt">
            <thead><tr><th>Tên file</th><th>Loại</th><th className="col-hide-sm">Người ký</th><th className="col-hide-sm">Thời gian</th><th className="col-act"></th></tr></thead>
            <tbody>
              {shownDocs.map((d) => {
                const k = d.doc_type || "";
                return <tr key={d.id}>
                  <td className="fname"><span className="ft">{d.filename}</span>{d.signed_upload_name && <span className="chips"><span className="chip indigo sm">đã ký</span></span>}</td>
                  <td><span className={"badge tb-" + (k || "khac")}>{DOC_TYPES[k]}</span></td>
                  <td className="muted col-hide-sm">{d.signer_name}</td>
                  <td className="muted col-hide-sm nowrap">{new Date(d.created_at).toLocaleString("vi-VN")}</td>
                  <td className="col-act"><div className="row-actions">
                    <a className="iact" href={d.download_url} title="Tải xuống">Tải</a>
                    <button className="iact" onClick={() => share(d.id, d.filename)} title="Chia sẻ">Link</button>
                    <button className="iact" onClick={() => onVerify(d.id)} title="Kiểm tra chữ ký">Kiểm tra</button>
                    {d.signed_upload_name && <a className="iact" href={api.signedFileUrl(d.id, true)} target="_blank" rel="noreferrer">Bản ký</a>}
                  </div></td>
                </tr>;
              })}
              {!loading && shownDocs.length === 0 && <tr><td colSpan={5}><div className="portal-empty">Chưa có hồ sơ nào trong phạm vi đã lọc.</div></td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
