import { useEffect, useMemo, useState } from "react";
import { api, ContractDraft, Customer, DocRecord } from "../api";
import { safeHttpUrl } from "../utils/url";
import {
  AppButton,
  AppIcon,
  EmptyState,
  FormField,
  FormGrid,
  InlineAlert,
  PageHeader,
  PageShell,
  SectionCard,
  SkeletonBlock,
  SplitWorkspace,
  StatusBadge,
  useConfirm,
  useToast,
} from "../components/ui";

type Party = {
  name: string; mst: string; address: string; email: string;
  dai_dien: string; chuc_vu: string; dien_thoai: string; logo_url: string;
};

const emptyParty: Party = { name: "", mst: "", address: "", email: "", dai_dien: "", chuc_vu: "", dien_thoai: "", logo_url: "" };

export function CreateContract() {
  const toast = useToast();
  const confirmAction = useConfirm();
  const now = new Date();
  const [loadingInit, setLoadingInit] = useState(true);
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
  const [finalizedSession, setFinalizedSession] = useState<{ version: number; title: string } | null>(null);

  useEffect(() => {
    Promise.all([api.listCustomers(), api.contractDefaults(), api.contractDrafts(), api.listDocuments({ perPage: 200 })])
      .then(([cs, d, saved, docs]) => {
        setCustomers(cs);
        setBenA(d.ben_a);
        setBank(d.bank);
        setTerms(d.dieu_khoan);
        setDefaultTerms(d.dieu_khoan);
        setDrafts(saved);
        setExistingContracts(docs.items.filter((doc) => doc.doc_type === "hop_dong"));
        const found = cs.find((c) => c.tax_code === d.baotoan.mst);
        setParty(found ? fromCustomer(found) : { ...emptyParty, ...d.baotoan });
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoadingInit(false));
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
    return { name: c.name, mst: c.tax_code, address: c.address || "", email: c.email || "", dai_dien: "", chuc_vu: "", dien_thoai: c.contact || "", logo_url: c.logo_url || "" };
  }

  function setField<K extends keyof Party>(key: K, value: Party[K]) {
    setParty((p) => ({ ...p, [key]: value }));
  }

  async function preview() {
    setBusy("preview");
    setError("");
    try {
      const blob = await api.contractPreview(payload);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy("");
    }
  }

  async function useAI() {
    setBusy("ai");
    setError("");
    try {
      const r = await api.aiContractDraft({ ben_b_name: party.name, dieu_khoan_hien_tai: terms, yeu_cau: aiNote });
      setTerms(r.text);
      toast.success("AI đã cập nhật điều khoản hợp đồng.");
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy("");
    }
  }

  async function generate() {
    if (!party.name.trim() || !party.mst.trim()) {
      setError("Cần nhập tên và MST Bên B.");
      return;
    }
    setBusy("generate");
    setError("");
    try {
      const generated = await api.contractGenerate({ ...payload, draft_id: activeDraftId });
      setResult(generated);
      if (generated.session_finalized && activeDraftId) {
        const finalized = drafts.find((draft) => draft.id === activeDraftId);
        setFinalizedSession({ version: generated.session_version || finalized?.version || 1, title: finalized?.title || draftTitle || number });
        setDrafts((current) => current.map((draft) => draft.id === activeDraftId ? {
          ...draft, status: "finalized", document_id: generated.document_id,
          finalized_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        } : draft));
        setActiveDraftId(null);
      }
      toast.success("Đã phát hành hợp đồng và tạo liên kết gửi khách.");
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy("");
    }
  }

  const selectedCustomer = customers.find((c) => c.tax_code === party.mst);
  const editableDrafts = drafts.filter((draft) => draft.status !== "finalized");
  const visibleDrafts = draftFilter ? editableDrafts.filter((d) => d.customer_id === draftFilter) : editableDrafts;
  const visibleIssued = existingContracts.filter((doc) => !draftFilter || doc.customer_id === draftFilter);

  function newDraft() {
    setActiveDraftId(null);
    setDraftTitle("");
    setParty(emptyParty);
    setTerms(defaultTerms);
    setNumber(`01/${new Date().getFullYear()}/HĐPM-INUT`);
    setDate(new Date().toISOString().slice(0, 10));
    setResult(null);
    setFinalizedSession(null);
    setError("");
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl("");
    }
  }

  function openDraft(draft: ContractDraft) {
    const p = draft.payload as any;
    setActiveDraftId(draft.id);
    setDraftTitle(draft.title);
    setNumber(p.so || "");
    if (p.ngay) setDate(`${p.ngay.year}-${String(p.ngay.month).padStart(2, "0")}-${String(p.ngay.day).padStart(2, "0")}`);
    setParty({ ...emptyParty, ...(p.ben_b || {}) });
    setTerms(p.dieu_khoan || defaultTerms);
    setResult(null);
    setFinalizedSession(null);
    setError("");
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl("");
    }
  }

  async function saveDraft() {
    if (!selectedCustomer) {
      setError("Hãy chọn một khách hàng trong CRM trước khi lưu bản đang soạn.");
      return;
    }
    setBusy("save");
    setError("");
    try {
      const saved = await api.saveContractDraft({
        customer_id: selectedCustomer.id,
        title: draftTitle.trim() || number || `Hợp đồng ${selectedCustomer.name}`,
        payload,
      }, activeDraftId || undefined);
      setActiveDraftId(saved.id);
      setDraftTitle(saved.title);
      setDrafts((old) => [saved, ...old.filter((d) => d.id !== saved.id)]);
      toast.success("Đã lưu bản đang soạn.");
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy("");
    }
  }

  async function removeDraft(draft: ContractDraft) {
    const ok = await confirmAction({
      title: "Xóa bản đang soạn",
      message: `Bạn có chắc chắn muốn xóa bản đang soạn “${draft.title}”?`,
      confirmLabel: "Xóa bản nháp",
      cancelLabel: "Giữ lại",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.deleteContractDraft(draft.id);
      setDrafts((old) => old.filter((d) => d.id !== draft.id));
      if (activeDraftId === draft.id) newDraft();
      toast.info("Đã xóa bản đang soạn.");
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      toast.error(msg);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Đã sao chép liên kết vào bộ nhớ tạm.");
    } catch {
      toast.error("Không thể sao chép tự động — hãy copy thủ công.");
    }
  }

  return (
    <PageShell className="contract-page" data-page="create-contract">
      <PageHeader
        variant="compact"
        icon="file-signature"
        title="Soạn hợp đồng AI"
        subtitle="Tạo bản nháp, xuất PDF và gửi thẳng vào cổng khách hàng · Năm đầu 10.000.000đ (KCT)."
        actions={
          <AppButton variant="primary" size="sm" leftIcon="plus" onClick={newDraft}>
            Hợp đồng mới
          </AppButton>
        }
      />

      {error && <InlineAlert tone="danger" onDismiss={() => setError("")}>{error}</InlineAlert>}

      <SectionCard
        eyebrow="BẢN ĐANG SOẠN"
        title="Hợp đồng theo khách hàng"
        subtitle="Mỗi khách có thể lưu nhiều hợp đồng và mở lại để tiếp tục chỉnh sửa."
        icon="folder-open"
        actions={
          <div className="ui-row">
            <select
              className="ui-select"
              aria-label="Lọc bản đang soạn theo khách hàng"
              value={draftFilter}
              onChange={(e) => setDraftFilter(Number(e.target.value))}
            >
              <option value={0}>Tất cả khách hàng</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <AppButton variant="secondary" size="sm" leftIcon="plus" onClick={newDraft}>
              Hợp đồng mới
            </AppButton>
          </div>
        }
      >
        <div className="ui-stack--lg">
          {loadingInit ? (
            <SkeletonBlock variant="card" lines={2} />
          ) : visibleDrafts.length > 0 ? (
            <div className="ui-draft-grid">
              {visibleDrafts.map((d) => (
                <article key={d.id} className={`ui-draft-card${activeDraftId === d.id ? " is-active" : ""}`}>
                  <AppButton variant="ghost" className="ui-draft-open" onClick={() => openDraft(d)}>
                    <span className="ui-draft-open-inner">
                      <small>{d.customer_name} · Phiên v{d.version || 1}</small>
                      <strong>{d.title}</strong>
                      <span>Cập nhật {new Date(d.updated_at).toLocaleString("vi-VN")}</span>
                    </span>
                  </AppButton>
                  <AppButton
                    variant="ghost"
                    size="sm"
                    iconOnly
                    leftIcon="trash"
                    className="ui-draft-delete"
                    onClick={() => removeDraft(d)}
                    aria-label="Xóa bản đang soạn"
                    title="Xóa bản đang soạn"
                  />
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              icon="file-text"
              title="Chưa có hợp đồng đang soạn trong nhóm này"
              description="Chọn khách hàng khác hoặc tạo hợp đồng mới để bắt đầu phiên làm việc."
            />
          )}

          {visibleIssued.length > 0 && (
            <div className="ui-stack--sm">
              <div className="ui-row-between">
                <strong>Hợp đồng đã tạo ({visibleIssued.length})</strong>
              </div>
              <div className="ui-draft-grid">
                {visibleIssued.map((doc) => (
                  <article key={doc.id} className="ui-draft-card">
                    <a className="ui-draft-link" href={safeHttpUrl(doc.download_url)} target="_blank" rel="noopener noreferrer">
                      <span className="ui-draft-open-inner">
                        <small>{doc.customer_name || "Chưa gắn khách hàng"}</small>
                        <strong>{doc.filename}</strong>
                        <span>{doc.note || "Hồ sơ hợp đồng"} · {new Date(doc.created_at).toLocaleString("vi-VN")}</span>
                      </span>
                    </a>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      <SplitWorkspace
        variant="preview-right"
        stickySecondary={false}
        primary={
          <SectionCard title="Thông tin hợp đồng & Bên B" icon="building-2">
            <div className="ui-stack--lg">
              <FormGrid cols={2}>
                <FormField label="Tên bản đang soạn" htmlFor="contract-draft-title" fullWidth>
                  <input
                    id="contract-draft-title"
                    className="ui-input"
                    placeholder="Ví dụ: Hợp đồng triển khai Pymid đợt 1"
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                  />
                </FormField>
                <FormField label="Số hợp đồng" htmlFor="contract-number">
                  <input id="contract-number" className="ui-input" value={number} onChange={(e) => setNumber(e.target.value)} />
                </FormField>
                <FormField label="Ngày ký" htmlFor="contract-date">
                  <input id="contract-date" className="ui-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </FormField>
              </FormGrid>

              <div className="studio-party-a">
                <strong>Bên A · INUT — {benA.company || "Đang tải"}</strong>
                <span>MST {benA.mst || "—"} · Đại diện {benA.rep || "—"}</span>
                <span>STK {bank.account_number} · {bank.bank_name || "—"}</span>
              </div>

              <FormGrid cols={2}>
                <FormField label="Chọn khách hàng CRM" htmlFor="contract-customer" fullWidth>
                  <select
                    id="contract-customer"
                    className="ui-select"
                    value={customers.find((c) => c.tax_code === party.mst)?.id || ""}
                    onChange={(e) => {
                      const c = customers.find((x) => x.id === Number(e.target.value));
                      if (c) setParty(fromCustomer(c));
                    }}
                  >
                    <option value="">Nhập khách hàng mới</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name} · {c.tax_code}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Tên pháp nhân" htmlFor="contract-party-name" fullWidth required>
                  <input id="contract-party-name" className="ui-input" value={party.name} onChange={(e) => setField("name", e.target.value)} />
                </FormField>
                <FormField label="Mã số thuế" htmlFor="contract-party-mst" required>
                  <input id="contract-party-mst" className="ui-input" value={party.mst} onChange={(e) => setField("mst", e.target.value)} />
                </FormField>
                <FormField label="Email" htmlFor="contract-party-email">
                  <input id="contract-party-email" className="ui-input" value={party.email} onChange={(e) => setField("email", e.target.value)} />
                </FormField>
                <FormField label="Địa chỉ" htmlFor="contract-party-address" fullWidth>
                  <input id="contract-party-address" className="ui-input" value={party.address} onChange={(e) => setField("address", e.target.value)} />
                </FormField>
                <FormField label="Logo Bên B" htmlFor="contract-party-logo" fullWidth>
                  <input id="contract-party-logo" className="ui-input" value={party.logo_url} onChange={(e) => setField("logo_url", e.target.value)} placeholder="https://.../logo.jpg" />
                </FormField>
                <FormField label="Người đại diện" htmlFor="contract-party-rep">
                  <input id="contract-party-rep" className="ui-input" placeholder="Bổ sung trước khi ký" value={party.dai_dien} onChange={(e) => setField("dai_dien", e.target.value)} />
                </FormField>
                <FormField label="Chức vụ" htmlFor="contract-party-role">
                  <input id="contract-party-role" className="ui-input" value={party.chuc_vu} onChange={(e) => setField("chuc_vu", e.target.value)} />
                </FormField>
              </FormGrid>

              {!party.dai_dien && (
                <InlineAlert tone="warning">
                  PDF sẽ có watermark “BẢN NHÁP” đến khi bổ sung người đại diện Bên B.
                </InlineAlert>
              )}
            </div>
          </SectionCard>
        }
        secondary={
          <SectionCard
            title="Điều khoản"
            subtitle="AI không được thay đổi các điều khoản thương mại bắt buộc."
            icon="file-text"
            actions={
              <AppButton
                variant="secondary"
                size="sm"
                leftIcon="sparkles"
                loading={busy === "ai"}
                disabled={!!busy}
                onClick={useAI}
              >
                {busy === "ai" ? "AI đang soạn…" : "AI soạn/chỉnh"}
              </AppButton>
            }
          >
            <div className="ui-stack--sm">
              <FormField label="Yêu cầu thêm cho AI (không bắt buộc)" htmlFor="contract-ai-note">
                <input
                  id="contract-ai-note"
                  className="ui-input"
                  placeholder="Nhập yêu cầu chỉnh sửa điều khoản cho AI…"
                  value={aiNote}
                  onChange={(e) => setAiNote(e.target.value)}
                />
              </FormField>
              <FormField label="Nội dung điều khoản" htmlFor="contract-terms">
                <textarea
                  id="contract-terms"
                  className="ui-textarea studio-terms-area"
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                />
              </FormField>
            </div>
          </SectionCard>
        }
      />

      <div className="ui-row-end">
        <AppButton
          variant="secondary"
          leftIcon="save"
          loading={busy === "save"}
          disabled={!!busy}
          onClick={saveDraft}
        >
          {busy === "save" ? "Đang lưu…" : activeDraftId ? "Lưu thay đổi" : "Lưu bản đang soạn"}
        </AppButton>
        <AppButton
          variant="secondary"
          leftIcon="eye"
          loading={busy === "preview"}
          disabled={!!busy}
          onClick={preview}
        >
          {busy === "preview" ? "Đang tạo…" : "Xem trước PDF"}
        </AppButton>
        <AppButton
          variant="primary"
          leftIcon="file-signature"
          loading={busy === "generate"}
          disabled={!!busy}
          onClick={generate}
        >
          {busy === "generate" ? "Đang phát hành…" : "Lưu hợp đồng & tạo link"}
        </AppButton>
      </div>

      {previewUrl && (
        <SectionCard title="Xem trước hợp đồng PDF" icon="eye" padding="compact">
          <iframe className="ui-iframe-tall" src={previewUrl} title="Xem trước hợp đồng" />
        </SectionCard>
      )}

      {result && (
        <SectionCard
          title={result.filename}
          subtitle={
            finalizedSession
              ? "Phiên này đã khóa để giữ lịch sử. Hãy tạo phiên mới nếu cần soạn hợp đồng tiếp theo."
              : "Hồ sơ đã được gắn vào khách hàng và các hóa đơn cùng MST."
          }
          icon="check-circle"
          actions={
            <StatusBadge tone="success" icon="check-circle">
              {finalizedSession
                ? `Phiên v${finalizedSession.version} đã chốt`
                : `Đã tạo ${result.is_draft ? "bản nháp" : "hợp đồng"}`}
            </StatusBadge>
          }
        >
          <div className="ui-stack--sm">
            <div className="ui-row">
              {finalizedSession && (
                <AppButton variant="primary" size="sm" leftIcon="plus" onClick={newDraft}>
                  Tạo phiên làm việc mới
                </AppButton>
              )}
              <AppButton variant="secondary" size="sm" leftIcon="copy" onClick={() => copy(result.share_url)}>
                Copy link hợp đồng 7 ngày
              </AppButton>
              <AppButton variant="secondary" size="sm" leftIcon="key" onClick={() => copy(result.login_url)}>
                Copy link đăng nhập nhanh
              </AppButton>
              {safeHttpUrl(result.share_url) && (
                <a
                  className="ui-btn ui-btn--secondary ui-btn--sm"
                  href={safeHttpUrl(result.share_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <AppIcon name="external-link" size={14} />
                  <span>Mở link</span>
                </a>
              )}
            </div>
            {result.temporary_password && (
              <InlineAlert tone="info" title="Thông tin đăng nhập khách hàng mới">
                Tài khoản mới: <strong>{result.username}</strong> · Mật khẩu tạm: <strong>{result.temporary_password}</strong>
              </InlineAlert>
            )}
          </div>
        </SectionCard>
      )}
    </PageShell>
  );
}
