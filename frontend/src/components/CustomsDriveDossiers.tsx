import { useEffect, useMemo, useState } from "react";
import { api, CustomsDriveFolder, CustomsDriveSource, InvCustomsDecl } from "../api";

const statusLabel: Record<string, string> = {
  linked: "Đã liên kết", waiting_declaration: "Chờ tờ khai", ambiguous: "Chờ gán thủ công",
  complete: "Đủ hồ sơ", needs_review: "Cần review", missing_documents: "Thiếu chứng từ",
};
const kindLabel: Record<string, string> = {
  customs_declaration: "Tờ khai", ci: "CI", pl: "PL", coo: "C/O", bill_of_lading: "Vận đơn",
  tax_receipt: "Giấy nộp thuế", payment: "Thanh toán", contract_po: "Hợp đồng/PO", other: "Khác",
};

export function CustomsDriveDossiers() {
  const [year, setYear] = useState(2026);
  const [source, setSource] = useState<CustomsDriveSource | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [folders, setFolders] = useState<CustomsDriveFolder[]>([]);
  const [declarations, setDeclarations] = useState<InvCustomsDecl[]>([]);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    const [sources, rows, decls] = await Promise.all([
      api.customsDriveSources(), api.customsDriveFolders(year), api.invCustomsList(),
    ]);
    const current = sources.find((item) => item.year === year) ?? null;
    setSource(current); setSourceId(current?.folder_id ?? ""); setFolders(rows); setDeclarations(decls);
  }
  useEffect(() => { load().catch((error) => setMessage((error as Error).message)); }, [year]);

  async function sync() {
    try { setBusy(true); setMessage(""); const result = await api.customsDriveSync(year);
      setMessage(`Đã đồng bộ ${result.stats.folders ?? 0} folder; liên kết ${result.stats.linked ?? 0}; chờ xử lý ${result.stats.waiting ?? 0}.`);
      await load();
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  async function saveSource() {
    try { setBusy(true); await api.customsDriveSaveSource({ year, folder_id: sourceId.trim() }); setMessage("Đã lưu nguồn Drive theo năm."); await load(); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  async function assign(folderId: number, value: string) {
    if (!value) return;
    try { setBusy(true); await api.customsDriveAssign(folderId, Number(value)); setMessage("Đã gán folder vào tờ khai."); await load(); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  async function review(folderId: number) {
    try { setBusy(true); await api.customsDriveReview(folderId); await load(); setMessage("Đã kiểm tra lại checklist hồ sơ."); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }

  const counts = useMemo(() => folders.reduce<Record<string, number>>((all, row) => {
    all[row.link_status] = (all[row.link_status] ?? 0) + 1;
    all[row.dossier_status] = (all[row.dossier_status] ?? 0) + 1;
    return all;
  }, {}), [folders]);
  const visible = folders.filter((row) => filter === "all" || row.link_status === filter || row.dossier_status === filter);

  return <section className="customs-drive-dossiers">
    <header className="customs-drive-head">
      <div><p className="eyebrow">HỒ SƠ NHẬP KHẨU · DRIVE</p><h2>Bộ hồ sơ theo tờ khai</h2>
        <p>Đồng bộ chỉ đọc, tự ghép theo số tờ khai và đưa hồ sơ thiếu vào hàng chờ.</p></div>
      <div className="customs-drive-tools"><label>Năm<select aria-label="Năm hồ sơ nhập khẩu" value={year} onChange={(e) => setYear(Number(e.target.value))}><option value={2026}>2026</option><option value={2027}>2027</option><option value={2028}>2028</option></select></label>
        <button disabled={busy || !source} onClick={sync}>{busy ? "Đang đồng bộ…" : "Đồng bộ Drive"}</button></div>
    </header>
    {message && <div className="payroll-message" aria-live="polite">{message}</div>}
    <div className="customs-drive-source"><label>Folder Drive năm {year}<input aria-label={`Folder Drive năm ${year}`} value={sourceId} placeholder="Dán folder ID Google Drive" onChange={(e) => setSourceId(e.target.value)} /></label><button className="secondary" disabled={busy || !sourceId.trim()} onClick={saveSource}>Lưu nguồn</button>
      {source && <a href={`https://drive.google.com/drive/folders/${source.folder_id}`} target="_blank" rel="noreferrer">Mở folder Drive ↗</a>}
    </div>
    <div className="customs-drive-stats"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}><b>{folders.length}</b><span>Tổng folder</span></button><button className={filter === "linked" ? "active" : ""} onClick={() => setFilter("linked")}><b>{counts.linked ?? 0}</b><span>Đã liên kết</span></button><button className={filter === "waiting_declaration" ? "active" : ""} onClick={() => setFilter("waiting_declaration")}><b>{counts.waiting_declaration ?? 0}</b><span>Chờ tờ khai</span></button><button className={filter === "ambiguous" ? "active" : ""} onClick={() => setFilter("ambiguous")}><b>{counts.ambiguous ?? 0}</b><span>Chờ gán</span></button><button className={filter === "missing_documents" ? "active" : ""} onClick={() => setFilter("missing_documents")}><b>{counts.missing_documents ?? 0}</b><span>Thiếu chứng từ</span></button></div>
    {!visible.length ? <p className="muted customs-drive-empty">Chưa có dữ liệu. Hãy kiểm tra folder ID rồi bấm Đồng bộ Drive.</p> : <div className="customs-drive-list">{visible.map((row) => <article key={row.id} className={`customs-drive-card ${row.link_status}`}>
      <header><div><strong>{row.name}</strong><small>{row.path}</small></div><div className="customs-drive-badges"><span className={`chip sm ${row.link_status === "linked" ? "green" : "amber"}`}>{statusLabel[row.link_status] ?? row.link_status}</span><span className={`chip sm ${row.dossier_status === "complete" ? "green" : row.dossier_status === "missing_documents" ? "red" : "amber"}`}>{statusLabel[row.dossier_status] ?? row.dossier_status}</span></div></header>
      <p className="customs-drive-reason">{row.match_reason}</p>
      <div className="customs-drive-checklist">{Object.entries(row.checklist).map(([key, value]) => <span className={value.state} key={key}>{value.state === "ok" ? "✓" : value.state === "missing" ? "!" : "•"} {key}</span>)}</div>
      <div className="customs-drive-files">{row.documents.map((doc) => <a key={doc.id} href={doc.file_url || row.drive_url} target="_blank" rel="noreferrer"><b>{kindLabel[doc.kind] ?? doc.kind}</b> {doc.name}</a>)}</div>
      {row.findings.map((finding) => <div className={`finding ${finding.level}`} key={finding.code}>{finding.message}</div>)}
      <footer><a href={row.drive_url} target="_blank" rel="noreferrer">Mở folder Drive ↗</a><button className="secondary" disabled={busy} onClick={() => review(row.id)}>Kiểm tra lại</button>{row.link_status !== "linked" && <select aria-label={`Gán tờ khai cho ${row.name}`} defaultValue="" disabled={busy} onChange={(e) => assign(row.id, e.target.value)}><option value="">Gán vào tờ khai…</option>{declarations.map((decl) => <option key={decl.id} value={decl.id}>{decl.so_to_khai}</option>)}</select>}</footer>
    </article>)}</div>}
  </section>;
}
