import React, { useEffect, useRef, useState } from "react";
import { api, TqcCertificate, TqcSearchResponse } from "../api";

const panelStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #dbe5e1",
  borderRadius: 18,
  padding: 20,
  boxShadow: "0 8px 24px rgba(15, 118, 110, 0.06)",
};

function provenanceLabel(value: string) {
  if (value === "verified_live") return "Đã xác minh live";
  if (value === "verified_cached") return "Cache đã xác minh";
  if (value === "not_found_in_local_index") return "Chưa có trong index";
  return value;
}

function statusColor(value: string) {
  if (value === "active") return { bg: "#dcfce7", fg: "#166534" };
  if (value === "expired" || value === "cancelled") return { bg: "#fee2e2", fg: "#991b1b" };
  return { bg: "#fef3c7", fg: "#92400e" };
}

function statusLabel(value: string) {
  if (value === "active") return "Còn hiệu lực";
  if (value === "expired") return "Hết hiệu lực";
  if (value === "cancelled") return "Đã hủy/thu hồi";
  return "Chưa xác định";
}

export function TqcCertificateLookup() {
  const [query, setQuery] = useState("");
  const [model, setModel] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [applicant, setApplicant] = useState("");
  const [certificateNo, setCertificateNo] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [validOn, setValidOn] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(false);
  const [result, setResult] = useState<TqcSearchResponse | null>(null);
  const [selected, setSelected] = useState<TqcCertificate | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");
  const [importReady, setImportReady] = useState(false);
  const [pendingCsv, setPendingCsv] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [apiMode, setApiMode] = useState("");
  const mountedRef = useRef(true);
  const [failedImportJobId, setFailedImportJobId] = useState<number | null>(null);

  const pollTqcImportJob = async (jobId: number) => {
    let consecutiveFailures = 0;
    while (mountedRef.current) {
      let job;
      try {
        job = await api.standards.getTqcImportJob(jobId);
        consecutiveFailures = 0;
      } catch (error) {
        consecutiveFailures += 1;
        if (consecutiveFailures >= 10) throw error;
        const retryDelay = Math.min(5000, 500 * (2 ** (consecutiveFailures - 1)));
        setMessage(`Mất kết nối job CSV; đang thử lại (${consecutiveFailures}/10).`);
        await new Promise((resolve) => window.setTimeout(resolve, retryDelay));
        continue;
      }
      if (job.status === "failed") {
        setFailedImportJobId(job.job_id);
        throw new Error(job.error || "Import CSV TQC nền thất bại.");
      }
      if (job.status === "success" && job.result) return job.result;
      setMessage(`Đang import CSV: ${job.progress}% (${job.requested} dòng).`);
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
    return null;
  };

  useEffect(() => {
    mountedRef.current = true;
    api.standards.getTqcStatus().then((status) => setApiMode(status.search_mode)).catch(() => setApiMode("offline"));
    api.standards.getLatestTqcImportJob().then(async ({ job }) => {
      if (!job || !mountedRef.current) return;
      if (job.status === "failed") {
        setFailedImportJobId(job.job_id);
        setMessage(job.error || "Import CSV TQC nền thất bại.");
        return;
      }
      if (job.status !== "running") return;
      setImporting(true);
      setMessage(`Đang nối lại job CSV #${job.job_id}.`);
      try {
        const completed = await pollTqcImportJob(job.job_id);
        if (completed && mountedRef.current) {
          setMessage(`CSV: xác minh ${completed.verified}, cache ${completed.cached}, không thấy ${completed.not_found}, lỗi ${completed.errors.length}.`);
        }
      } catch (error: any) {
        if (mountedRef.current) setMessage(error?.message || "Import CSV TQC thất bại.");
      } finally {
        if (mountedRef.current) setImporting(false);
      }
    }).catch(() => {});
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const search = async (targetPage = 1) => {
    if (![query, model, manufacturer, applicant, certificateNo, statusFilter, validOn].some((value) => value.trim())) {
      setMessage("Nhập ít nhất một điều kiện tìm kiếm.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const response = await api.standards.searchTqc({
        q: query,
        model,
        manufacturer,
        applicant,
        certificate_no: certificateNo,
        status: statusFilter,
        valid_on: validOn,
        page: targetPage,
        page_size: 20,
      });
      setResult(response);
      setPage(targetPage);
      setSelected(null);
      if (!response.items.length) setMessage(response.warning || "Chưa thấy trong chỉ mục nội bộ.");
    } catch (error: any) {
      setMessage(error?.message || "Không thể tra cứu TQC.");
    } finally {
      setLoading(false);
    }
  };

  const lookupExact = async () => {
    if (!certificateNo.trim()) {
      setMessage("Nhập số GCN để kiểm tra live.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const response = await api.standards.getTqcCertificate(certificateNo.trim(), refresh);
      setSelected(response.certificate);
      setResult(null);
    } catch (error: any) {
      setSelected(null);
      setMessage(error?.message || "TQC không tìm thấy số GCN này.");
    } finally {
      setLoading(false);
    }
  };

  const previewEntries = importText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => (
    /^[A-Za-z0-9]{6,120}$/.test(line) ? { certificate_no: line } : { qr_input: line }
  ));

  const importPastedEntries = async () => {
    const entries = previewEntries;
    if (!entries.length) {
      setMessage("Dán ít nhất một số GCN hoặc QR URL.");
      return;
    }
    setImporting(true);
    setMessage("");
    try {
      const response = await api.standards.importTqc(entries, refresh);
      setMessage(`Đã xử lý ${response.requested}: xác minh ${response.verified}, cache ${response.cached}, không thấy ${response.not_found}, lỗi ${response.errors.length}.`);
      setImportText("");
      setImportReady(false);
    } catch (error: any) {
      setMessage(error?.message || "Import TQC thất bại.");
    } finally {
      setImporting(false);
    }
  };

  const importCsv = async (file: File | null) => {
    if (!file) return;
    setImporting(true);
    setFailedImportJobId(null);
    setMessage("");
    try {
      const started = await api.standards.importTqcCsv(file, refresh);
      setMessage(`Đã xếp hàng import ${started.requested} dòng CSV.`);
      const completed = await pollTqcImportJob(started.job_id);
      if (!completed) return;
      setMessage(`CSV: xác minh ${completed.verified}, cache ${completed.cached}, không thấy ${completed.not_found}, lỗi ${completed.errors.length}.`);
      setPendingCsv(null);
    } catch (error: any) {
      setMessage(error?.message || "Import CSV TQC thất bại.");
    } finally {
      setImporting(false);
    }
  };

  const retryCsvImport = async () => {
    if (failedImportJobId === null) return;
    setImporting(true);
    setFailedImportJobId(null);
    setMessage(`Đang thử lại job CSV #${failedImportJobId}.`);
    try {
      await api.standards.retryTqcImportJob(failedImportJobId);
      const completed = await pollTqcImportJob(failedImportJobId);
      if (completed) {
        setMessage(`CSV: xác minh ${completed.verified}, cache ${completed.cached}, không thấy ${completed.not_found}, lỗi ${completed.errors.length}.`);
      }
    } catch (error: any) {
      setMessage(error?.message || "Không thể thử lại import CSV TQC.");
    } finally {
      setImporting(false);
    }
  };

  const renderCertificate = (certificate: TqcCertificate) => {
    const color = statusColor(certificate.derived_status);
    return (
      <article key={certificate.certificate_no} style={{ ...panelStyle, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <strong style={{ color: "#0f766e", fontFamily: "var(--font-mono)" }}>{certificate.certificate_no}</strong>
          <span style={{ background: color.bg, color: color.fg, borderRadius: 999, padding: "4px 9px", fontSize: 11, fontWeight: 800 }}>
            {statusLabel(certificate.derived_status)}
          </span>
        </div>
        <h3 style={{ margin: "12px 0 7px", color: "#0f172a" }}>{certificate.model || "Chưa có model"}</h3>
        <div style={{ color: "#475569", fontSize: 13, lineHeight: 1.65 }}>
          <div><strong>Hãng:</strong> {certificate.manufacturer || "-"}</div>
          <div><strong>Doanh nghiệp:</strong> {certificate.applicant_name || "-"}</div>
          <div><strong>Sản phẩm:</strong> {certificate.product_name || "-"}</div>
          <div><strong>QCVN:</strong> {certificate.technical_regulations.join(", ") || "-"}</div>
          <div><strong>Hiệu lực:</strong> {certificate.issue_date || "-"} → {certificate.expiry_date || "-"}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "#64748b" }}>{provenanceLabel(certificate.provenance.verification_status)}</span>
          <button onClick={() => setSelected(certificate)} style={{ border: "1px solid #99f6e4", background: "#f0fdfa", color: "#0f766e", borderRadius: 9, padding: "7px 11px", cursor: "pointer", fontWeight: 800 }}>
            Xem chi tiết
          </button>
        </div>
      </article>
    );
  };

  const fields: Array<[string, string, React.Dispatch<React.SetStateAction<string>>, string]> = [
    ["Từ khóa chung", query, setQuery, "model, sản phẩm, hãng..."],
    ["Model", model, setModel, "T27G16"],
    ["Hãng sản xuất", manufacturer, setManufacturer, "TOMKO"],
    ["Doanh nghiệp nộp hồ sơ", applicant, setApplicant, "Tên doanh nghiệp"],
    ["Số GCN", certificateNo, setCertificateNo, "C0955191224AE15A3"],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <section style={{ ...panelStyle, background: "linear-gradient(135deg, #ecfeff, #f0fdf4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <div style={{ color: "#0f766e", fontSize: 12, fontWeight: 900, letterSpacing: 1 }}>TQC CNHQ INTELLIGENCE</div>
            <h2 style={{ margin: "6px 0", color: "#0f172a" }}>Tra cứu chứng nhận theo model</h2>
            <p style={{ margin: 0, color: "#475569", fontSize: 13, maxWidth: 720 }}>
              Exact lookup kiểm tra live với TQC; tìm model/hãng/doanh nghiệp dùng chỉ mục các GCN đã xác minh. Không thấy trong index không có nghĩa là không tồn tại chứng nhận.
            </p>
          </div>
          <span style={{ background: "#fff", color: "#0f766e", borderRadius: 999, padding: "7px 11px", fontSize: 11, fontWeight: 800 }}>{apiMode || "đang kiểm tra API"}</span>
        </div>
      </section>

      <section style={panelStyle}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
          {fields.map(([label, value, setter, placeholder]) => (
            <label key={String(label)} style={{ display: "flex", flexDirection: "column", gap: 5, color: "#475569", fontSize: 12, fontWeight: 800 }}>
              {label}
              <input value={value} onChange={(event) => setter(event.target.value)} placeholder={placeholder} style={{ border: "1px solid #cbd5e1", borderRadius: 9, padding: "10px 11px", fontSize: 13 }} />
            </label>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: "#475569", fontWeight: 800 }}>Trạng thái&nbsp;
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={{ border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 9px" }}>
              <option value="">Tất cả</option><option value="active">Còn hiệu lực</option><option value="expired">Hết hiệu lực</option><option value="cancelled">Đã hủy</option><option value="unknown">Chưa xác định</option>
            </select>
          </label>
          <label style={{ fontSize: 12, color: "#475569", fontWeight: 800 }}>Có hiệu lực ngày&nbsp;<input aria-label="Có hiệu lực ngày" type="date" value={validOn} onChange={(event) => setValidOn(event.target.value)} style={{ border: "1px solid #cbd5e1", borderRadius: 8, padding: "7px 9px" }} /></label>
          <button onClick={() => search(1)} disabled={loading} style={{ background: "#0f766e", color: "#fff", border: 0, borderRadius: 10, padding: "10px 16px", cursor: "pointer", fontWeight: 900 }}>{loading ? "Đang tìm..." : "Tìm trong index"}</button>
          <button onClick={lookupExact} disabled={loading} style={{ background: "#0f172a", color: "#fff", border: 0, borderRadius: 10, padding: "10px 16px", cursor: "pointer", fontWeight: 900 }}>Kiểm tra số GCN live</button>
          <label style={{ fontSize: 12, color: "#475569" }}><input type="checkbox" checked={refresh} onChange={(event) => setRefresh(event.target.checked)} /> Làm mới cache</label>
        </div>
      </section>

      <section style={panelStyle}>
        <h3 style={{ margin: "0 0 6px", color: "#0f172a" }}>Nhập dữ liệu hợp pháp để mở rộng index</h3>
        <p style={{ margin: "0 0 10px", color: "#64748b", fontSize: 12 }}>Dán mỗi dòng một số GCN hoặc QR URL chính thức của TQC, hoặc upload CSV có cột `certificate_no`/`qr_url`.</p>
        <textarea aria-label="Danh sách GCN hoặc QR TQC" value={importText} onChange={(event) => { setImportText(event.target.value); setImportReady(false); }} rows={4} placeholder="C0955191224AE15A3\nhttps://data-cnhq.tqc.gov.vn/?q=..." style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 10, padding: 11, fontSize: 13, resize: "vertical" }} />
        {importReady && <div style={{ marginTop: 8, padding: 10, borderRadius: 9, background: "#f8fafc", color: "#475569", fontSize: 12 }}>Xem trước: {previewEntries.length} entry. {previewEntries.slice(0, 3).map((entry) => entry.certificate_no || entry.qr_input).join(" · ")}{previewEntries.length > 3 ? " · ..." : ""}</div>}
        {pendingCsv && <div style={{ marginTop: 8, padding: 10, borderRadius: 9, background: "#f8fafc", color: "#475569", fontSize: 12 }}>CSV chờ import: {pendingCsv.name} ({Math.ceil(pendingCsv.size / 1024)} KB)</div>}
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          {!importReady ? <button onClick={() => setImportReady(true)} disabled={importing || !previewEntries.length} style={{ background: "#fff7ed", color: "#9a3412", border: "1px solid #fed7aa", borderRadius: 10, padding: "10px 15px", cursor: "pointer", fontWeight: 900 }}>Xem trước dữ liệu dán</button> : <button onClick={importPastedEntries} disabled={importing} style={{ background: "#f97316", color: "#fff", border: 0, borderRadius: 10, padding: "10px 15px", cursor: "pointer", fontWeight: 900 }}>{importing ? "Đang import..." : `Xác nhận import ${previewEntries.length} entry`}</button>}
          <label style={{ background: "#fff7ed", color: "#9a3412", border: "1px solid #fed7aa", borderRadius: 10, padding: "9px 12px", cursor: "pointer", fontWeight: 800, fontSize: 12 }}>
            Chọn CSV
            <input type="file" accept=".csv,text/csv" onChange={(event) => setPendingCsv(event.target.files?.[0] || null)} style={{ display: "none" }} />
          </label>
          {pendingCsv && <button onClick={() => importCsv(pendingCsv)} disabled={importing} style={{ background: "#f97316", color: "#fff", border: 0, borderRadius: 10, padding: "10px 15px", cursor: "pointer", fontWeight: 900 }}>Xác nhận import CSV</button>}
        </div>
      </section>

      {message && <div style={{ background: "#fff7ed", color: "#9a3412", border: "1px solid #fed7aa", borderRadius: 12, padding: "11px 13px", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><span>{message}</span>{failedImportJobId !== null && <button onClick={retryCsvImport} disabled={importing} style={{ background: "#9a3412", color: "#fff", border: 0, borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontWeight: 800 }}>{importing ? "Đang thử lại..." : "Thử lại import CSV"}</button>}</div>}
      {result && <section><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, color: "#64748b", fontSize: 12 }}><strong>{result.total} bản ghi trong local index</strong><span>{result.index_last_updated_at ? `Cập nhật ${result.index_last_updated_at}` : "Chưa có dữ liệu"}</span></div><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>{result.items.map(renderCertificate)}</div>{result.total > result.page_size && <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10, marginTop: 14 }}><button disabled={page <= 1 || loading} onClick={() => search(page - 1)}>Trang trước</button><span style={{ fontSize: 12, color: "#64748b" }}>Trang {page}/{Math.ceil(result.total / result.page_size)}</span><button disabled={page >= Math.ceil(result.total / result.page_size) || loading} onClick={() => search(page + 1)}>Trang sau</button></div>}</section>}
      {selected && <section style={{ ...panelStyle, borderColor: "#5eead4" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><h3 style={{ margin: 0, color: "#0f172a" }}>Chi tiết {selected.certificate_no}</h3><button onClick={() => setSelected(null)} style={{ border: 0, background: "transparent", cursor: "pointer", color: "#64748b" }}>Đóng</button></div>{renderCertificate(selected)}<div style={{ marginTop: 10, fontSize: 11, color: "#64748b", wordBreak: "break-all" }}>Nguồn: {selected.provenance.source_url || "local index"}</div></section>}
    </div>
  );
}
