import { useEffect, useMemo, useState } from "react";
import { api, ContractDraft, Customer, DocRecord } from "../api";

type Party = {
  name: string; mst: string; address: string; email: string;
  dai_dien: string; chuc_vu: string; dien_thoai: string;
};

const emptyParty: Party = { name: "", mst: "", address: "", email: "", dai_dien: "", chuc_vu: "", dien_thoai: "" };

export function CreateContract() {
  const now = new Date();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [party, setParty] = useState<Party>(emptyParty);
  const [terms, setTerms] = useState("");
  const [benA, setBenA] = useState<Record<string, string>>({});
  const [bank, setBank] = useState({ account_name: "", account_number: "79713", bank_name: "" });
  const [number, setNumber] = useState(`01/${now.getFullYear()}/HĐPM-INUT`);
  const [date, setDate] = useState(now.toISOString().slice(0, 10));
  const [aiNote, setAiNote] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.contractGenerate>> | null>(null);
  const [drafts, setDrafts] = useState<ContractDraft[]>([]);
  const [activeDraftId, setActiveDraftId] = useState<number | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftFilter, setDraftFilter] = useState(0);
  const [defaultTerms, setDefaultTerms] = useState("");
  const [existingContracts, setExistingContracts] = useState<DocRecord[]>([]);

  useEffect(() => {
    Promise.all([api.listCustomers(), api.contractDefaults(), api.contractDrafts(), api.listDocuments({ perPage: 200 })]).then(([cs, d, saved, docs]) => {
      setCustomers(cs); setBenA(d.ben_a); setBank(d.bank); setTerms(d.dieu_khoan);
      setDefaultTerms(d.dieu_khoan); setDrafts(saved);
      setExistingContracts(docs.items.filter((doc) => doc.doc_type === "hop_dong"));
      const found = cs.find((c) => c.tax_code === d.baotoan.mst);
      setParty(found ? fromCustomer(found) : { ...emptyParty, ...d.baotoan });
    }).catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const payload = useMemo(() => {
    const d = new Date(`${date}T00:00:00`);
    return {
      so: number, revision: "REVISION 2", ngay: { day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear() },
      noi_lap: "Đắk Lắk", ben_b: party, ten_ung_dung: "Baotoantech IOT",
      ten_mien_p2p: "baotoantech.io.vn", phi_nam_dau: 10000000,
      phi_van_hanh_nam: 3000000, vat_van_hanh: 0, tien_do_ngay: 60,
      thoi_han_thang: 12, dieu_khoan: terms,
      filename: `hop-dong-baotoantech-iot-revision-2-${date}.pdf`,
    };
  }, [number, date, party, terms]);

  function fromCustomer(c: Customer): Party {
    return { name: c.name, mst: c.tax_code, address: c.address || "", email: c.email || "", dai_dien: "", chuc_vu: "", dien_thoai: c.contact || "" };
  }
  function setField<K extends keyof Party>(key: K, value: Party[K]) { setParty((p) => ({ ...p, [key]: value })); }
  async function preview() {
    setBusy("preview"); setError("");
    try { const blob = await api.contractPreview(payload); if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(URL.createObjectURL(blob)); }
    catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }
  async function useAI() {
    setBusy("ai"); setError("");
    try { const r = await api.aiContractDraft({ ben_b_name: party.name, dieu_khoan_hien_tai: terms, yeu_cau: aiNote }); setTerms(r.text); }
    catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }
  async function generate() {
    if (!party.name.trim() || !party.mst.trim()) { setError("Cần nhập tên và MST Bên B."); return; }
    setBusy("generate"); setError("");
    try { setResult(await api.contractGenerate(payload)); }
    catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }
  const selectedCustomer = customers.find((c) => c.tax_code === party.mst);
  const visibleDrafts = draftFilter ? drafts.filter((d) => d.customer_id === draftFilter) : drafts;
  function newDraft() {
    setActiveDraftId(null); setDraftTitle(""); setParty(emptyParty); setTerms(defaultTerms);
    setNumber(`01/${new Date().getFullYear()}/HĐPM-INUT`); setDate(new Date().toISOString().slice(0, 10));
    setResult(null); setError("");
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(""); }
  }
  function openDraft(draft: ContractDraft) {
    const p = draft.payload as any;
    setActiveDraftId(draft.id); setDraftTitle(draft.title); setNumber(p.so || "");
    if (p.ngay) setDate(`${p.ngay.year}-${String(p.ngay.month).padStart(2, "0")}-${String(p.ngay.day).padStart(2, "0")}`);
    setParty({ ...emptyParty, ...(p.ben_b || {}) }); setTerms(p.dieu_khoan || defaultTerms);
    setResult(null); setError("");
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(""); }
  }
  async function saveDraft() {
    if (!selectedCustomer) { setError("Hãy chọn một khách hàng trong CRM trước khi lưu bản đang soạn."); return; }
    setBusy("save"); setError("");
    try {
      const saved = await api.saveContractDraft({
        customer_id: selectedCustomer.id,
        title: draftTitle.trim() || number || `Hợp đồng ${selectedCustomer.name}`,
        payload,
      }, activeDraftId || undefined);
      setActiveDraftId(saved.id); setDraftTitle(saved.title);
      setDrafts((old) => [saved, ...old.filter((d) => d.id !== saved.id)]);
    } catch (e) { setError((e as Error).message); } finally { setBusy(""); }
  }
  async function removeDraft(draft: ContractDraft) {
    if (!window.confirm(`Xóa bản đang soạn “${draft.title}”?`)) return;
    try {
      await api.deleteContractDraft(draft.id);
      setDrafts((old) => old.filter((d) => d.id !== draft.id));
      if (activeDraftId === draft.id) newDraft();
    } catch (e) { setError((e as Error).message); }
  }
  async function copy(text: string) { await navigator.clipboard.writeText(text); }

  return <div className="contract-page">
    <div className="contract-hero">
      <div><span className="eyebrow">INUT · LEGAL STUDIO</span><h1>Soạn hợp đồng AI</h1><p>Tạo bản nháp, xuất PDF và gửi thẳng vào cổng khách hàng.</p></div>
      <div className="contract-value"><small>Giá trị năm đầu</small><strong>10.000.000đ</strong><span>Phần mềm · Không chịu VAT</span></div>
    </div>
    {error && <div className="error-box">{error}</div>}
    <section className="contract-draft-manager">
      <div className="contract-draft-toolbar">
        <div><span className="eyebrow">BẢN ĐANG SOẠN</span><h2>Hợp đồng theo khách hàng</h2><p>Mỗi khách có thể lưu nhiều hợp đồng và mở lại để tiếp tục chỉnh sửa.</p></div>
        <div className="contract-draft-controls">
          <select value={draftFilter} onChange={(e) => setDraftFilter(Number(e.target.value))}><option value={0}>Tất cả khách hàng</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <button onClick={newDraft}>+ Hợp đồng mới</button>
        </div>
      </div>
      {visibleDrafts.length ? <div className="contract-draft-list">{visibleDrafts.map((d) => <article key={d.id} className={activeDraftId === d.id ? "active" : ""}>
        <button className="contract-draft-open" onClick={() => openDraft(d)}><small>{d.customer_name}</small><strong>{d.title}</strong><span>Cập nhật {new Date(d.updated_at).toLocaleString("vi-VN")}</span></button>
        <button className="contract-draft-delete" onClick={() => removeDraft(d)} title="Xóa bản đang soạn">×</button>
      </article>)}</div> : <div className="contract-draft-empty">Chưa có hợp đồng đang soạn trong nhóm này.</div>}
      {existingContracts.filter((doc) => !draftFilter || doc.customer_id === draftFilter).length > 0 && <div className="contract-issued-block"><h3>Hợp đồng đã tạo</h3><div className="contract-draft-list">{existingContracts.filter((doc) => !draftFilter || doc.customer_id === draftFilter).map((doc) => <article key={doc.id}>
        <a className="contract-draft-open" href={doc.download_url} target="_blank" rel="noreferrer"><small>{doc.customer_name || "Chưa gắn khách hàng"}</small><strong>{doc.filename}</strong><span>{doc.note || "Hồ sơ hợp đồng"} · {new Date(doc.created_at).toLocaleString("vi-VN")}</span></a>
      </article>)}</div></div>}
    </section>
    <div className="contract-grid">
      <section className="contract-card">
        <h2>Thông tin hợp đồng</h2>
        <label>Tên bản đang soạn<input placeholder="Ví dụ: Hợp đồng triển khai Pymid đợt 1" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} /></label>
        <div className="form-row"><label>Số hợp đồng<input value={number} onChange={(e) => setNumber(e.target.value)} /></label><label>Ngày ký<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label></div>
        <div className="party-a"><b>Bên A · INUT</b><span>{benA.company}</span><small>MST {benA.mst} · Đại diện {benA.rep}</small><small>STK {bank.account_number} · {bank.bank_name}</small></div>
        <h2>Bên B</h2>
        <label>Chọn khách hàng<select value={customers.find((c) => c.tax_code === party.mst)?.id || ""} onChange={(e) => { const c = customers.find((x) => x.id === Number(e.target.value)); if (c) setParty(fromCustomer(c)); }}><option value="">Nhập khách hàng mới</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.tax_code}</option>)}</select></label>
        <label>Tên pháp nhân<input value={party.name} onChange={(e) => setField("name", e.target.value)} /></label>
        <div className="form-row"><label>Mã số thuế<input value={party.mst} onChange={(e) => setField("mst", e.target.value)} /></label><label>Email<input value={party.email} onChange={(e) => setField("email", e.target.value)} /></label></div>
        <label>Địa chỉ<input value={party.address} onChange={(e) => setField("address", e.target.value)} /></label>
        <div className="form-row"><label>Người đại diện<input placeholder="Bổ sung trước khi ký" value={party.dai_dien} onChange={(e) => setField("dai_dien", e.target.value)} /></label><label>Chức vụ<input value={party.chuc_vu} onChange={(e) => setField("chuc_vu", e.target.value)} /></label></div>
        {!party.dai_dien && <div className="draft-note">PDF sẽ có watermark “BẢN NHÁP” đến khi bổ sung người đại diện Bên B.</div>}
      </section>
      <section className="contract-card terms-card">
        <div className="section-title"><div><h2>Điều khoản</h2><small>AI không được thay đổi các điều khoản thương mại bắt buộc.</small></div><button onClick={useAI} disabled={!!busy}>{busy === "ai" ? "AI đang soạn…" : "AI soạn/chỉnh"}</button></div>
        <input className="ai-note" placeholder="Yêu cầu thêm cho AI (không bắt buộc)" value={aiNote} onChange={(e) => setAiNote(e.target.value)} />
        <textarea value={terms} onChange={(e) => setTerms(e.target.value)} />
      </section>
    </div>
    <div className="contract-actions"><button className="secondary save-draft" onClick={saveDraft} disabled={!!busy}>{busy === "save" ? "Đang lưu…" : activeDraftId ? "Lưu thay đổi" : "Lưu bản đang soạn"}</button><button className="secondary" onClick={preview} disabled={!!busy}>{busy === "preview" ? "Đang tạo…" : "Xem trước PDF"}</button><button className="primary" onClick={generate} disabled={!!busy}>{busy === "generate" ? "Đang phát hành…" : "Lưu hợp đồng & tạo link"}</button></div>
    {previewUrl && <iframe className="contract-preview" src={previewUrl} title="Xem trước hợp đồng" />}
    {result && <section className="share-result"><div><span>Đã tạo {result.is_draft ? "bản nháp" : "hợp đồng"}</span><h2>{result.filename}</h2><p>Hồ sơ đã được gắn vào khách hàng và các hóa đơn cùng MST.</p></div><div className="share-links"><button onClick={() => copy(result.share_url)}>Copy link hợp đồng 7 ngày</button><button onClick={() => copy(result.login_url)}>Copy link đăng nhập nhanh</button><a href={result.share_url} target="_blank" rel="noreferrer">Mở link</a></div>{result.temporary_password && <div className="credential">Tài khoản mới: <b>{result.username}</b> · Mật khẩu tạm: <b>{result.temporary_password}</b></div>}</section>}
  </div>;
}
