import { useEffect, useState } from "react";
import {
  api,
  IhoadonDashboard,
  IhoadonDraft,
  IhoadonDraftDeliveryResult,
  IhoadonDraftSyncResult,
  InvItem,
  SaleDraftLine,
  TaxPolicy,
} from "../api";
import { SmartPartyPaste } from "../components/SmartPartyPaste";
import {
  AppButton,
  AppIcon,
  DataView,
  EmptyState,
  FormField,
  FormGrid,
  InlineAlert,
  KpiStrip,
  MobileCard,
  MobileCardActions,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  PageHeader,
  PageShell,
  SectionCard,
  StatusBadge,
  useConfirm,
  useToast,
} from "../components/ui";
import { safeHttpUrl } from "../utils/url";

function vnd(n: number): string {
  return Math.round(n || 0).toLocaleString("vi-VN");
}

function dateTime(s: string): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 16).replace("T", " ");
  return d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" });
}

function parseNum(s: string | number): number {
  if (typeof s === "number") return s;
  return Number(String(s).replace(/[^\d.-]/g, "")) || 0;
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/đ/g, "d").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
}

type StockInfo = { ma_hang: string; ten: string; dvt: string; qty: number; cost: number };

const VAT_OPTIONS = ["10%", "8%", "5%", "0%", "10%x70%", "5%x70%", "Không chịu thuế"];

function tienThue(ln: SaleDraftLine): number {
  const tt = ln.thanh_tien || Math.round(ln.so_luong * ln.don_gia);
  const m = /^(\d+(?:[.,]\d+)?)%?(?:x(\d+(?:[.,]\d+)?)%?)?$/.exec(
    ln.vat_name.replace(/\s/g, "").toLowerCase(),
  );
  if (!m) return 0;
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
  const toast = useToast();
  const confirmAction = useConfirm();
  const [lines, setLines] = useState<SaleDraftLine[]>([blankLine()]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState<{ row: number; q: string; results: InvItem[] } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiMoTa, setAiMoTa] = useState("");
  const [aiCtx, setAiCtx] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState("");
  const [ihd, setIhd] = useState<IhoadonDashboard | null>(null);
  const [drafts, setDrafts] = useState<IhoadonDraft[]>([]);
  const [draftSyncing, setDraftSyncing] = useState("");
  const [draftSyncResults, setDraftSyncResults] = useState<Record<string, IhoadonDraftSyncResult>>({});
  const [ihdErr, setIhdErr] = useState("");
  const [stockByCode, setStockByCode] = useState<Record<string, number>>({});
  const [stockCatalog, setStockCatalog] = useState<StockInfo[]>([]);
  const [stockBusy, setStockBusy] = useState(false);
  const [stockCheckedAt, setStockCheckedAt] = useState("");
  const [policy, setPolicy] = useState<TaxPolicy | null>(null);
  const [expectedIssueDate, setExpectedIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [deliveryResult, setDeliveryResult] = useState<IhoadonDraftDeliveryResult | null>(null);
  const [copied, setCopied] = useState(false);
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

  function preparedLines() {
    return lines.filter((line) => line.ten.trim()).map((line) => ({ ...line, tien_thue: tienThue(line) }));
  }

  async function confirmStockProblems(valid: SaleDraftLine[]): Promise<boolean> {
    const problems = valid.filter(
      (line) => !line.is_dich_vu && (!line.ma_hang || stockByCode[line.ma_hang] == null || stockByCode[line.ma_hang] < line.so_luong),
    );
    if (!problems.length) return true;
    const summary = problems
      .map(
        (line) =>
          `• ${line.ma_hang || "Chưa có mã"} · cần ${line.so_luong}, tồn ${
            line.ma_hang && stockByCode[line.ma_hang] != null ? stockByCode[line.ma_hang] : "chưa rõ"
          }`,
      )
      .join("\n");
    return confirmAction({
      title: "Cảnh báo tồn kho trước khi tạo bản GHI_TẠM",
      message: `${problems.length} dòng chưa map kho hoặc không đủ tồn. Vẫn tạo bản GHI_TẠM trên iHOADON?\n${summary}`,
      confirmLabel: "Vẫn tạo GHI_TẠM",
      cancelLabel: "Kiểm tra lại",
      tone: "warning",
    });
  }

  async function pushDraft() {
    const valid = preparedLines();
    if (!customer.customer_name.trim()) return setErr("Chưa nhập tên khách hàng.");
    if (!customer.buyer_tax_code.trim()) return setErr("Chưa nhập mã số thuế bên mua.");
    if (!customer.buyer_address.trim()) return setErr("Chưa nhập địa chỉ bên mua.");
    if (!valid.length) return setErr("Chưa có dòng hàng nào.");
    if (!(await confirmStockProblems(valid))) return;
    setBusy(true);
    setErr("");
    try {
      const r = await api.ihoadonCreateDraft({ ...customer, lines: valid });
      setAiNote(`Đã tạo hóa đơn ${r.status} trên iHOADON · mẫu ${r.template_code}/${r.invoice_series}`);
      await syncIhoadon();
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function createDelivery() {
    const valid = preparedLines();
    if (!customer.customer_name.trim()) return setErr("Chưa nhập tên khách hàng.");
    if (!customer.buyer_tax_code.trim()) return setErr("Chưa nhập mã số thuế bên mua.");
    if (!customer.buyer_address.trim()) return setErr("Chưa nhập địa chỉ bên mua.");
    if (!valid.length) return setErr("Chưa có dòng hàng nào.");
    if (!expectedIssueDate) return setErr("Chưa chọn ngày dự kiến xuất hóa đơn.");
    if (!(await confirmStockProblems(valid))) return;
    setBusy(true);
    setErr("");
    setCopied(false);
    setDeliveryResult(null);
    try {
      const result = await api.ihoadonCreateDraftDelivery({
        ...customer,
        lines: valid,
        expected_issue_date: expectedIssueDate,
        share_days: 7,
      });
      setDeliveryResult(result);
      setAiNote(`Đã tạo ${result.status}, đóng dấu bản nháp và tạo link gửi khách.`);
      await syncIhoadon();
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function syncDraftToCrm(draft: IhoadonDraft) {
    setDraftSyncing(draft.id);
    setErr("");
    try {
      const result = await api.ihoadonSyncDraftToCrm(draft.id);
      setDraftSyncResults((current) => ({ ...current, [draft.id]: result }));
      const customerLabel = draft.customer_name.toLocaleUpperCase("vi").includes("PYMID")
        ? "PYMID"
        : draft.customer_name;
      setAiNote(`Đã đồng bộ bản nháp ${customerLabel} vào hồ sơ CRM.`);
    } catch (error) {
      const msg = (error as Error).message;
      setErr(msg);
      toast.error(msg);
    } finally {
      setDraftSyncing("");
    }
  }

  async function copyDeliveryLink() {
    if (!deliveryResult) return;
    try {
      await navigator.clipboard.writeText(deliveryResult.share_url);
    } catch {
      const input = document.createElement("textarea");
      input.value = deliveryResult.share_url;
      input.className = "sr-only";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    setCopied(true);
    toast.success("Đã sao chép link bản nháp.");
  }

  useEffect(() => {
    syncIhoadon();
    loadStock().catch(() => undefined);
    api.taxPolicy().then(setPolicy).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      /* ignore */
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
      setLines((current) =>
        current.map((line) => {
          if (line.is_dich_vu || !line.ten.trim()) return line;
          const hit =
            catalog.find((item) => item.ma_hang === line.ma_hang) ||
            catalog.find((item) => norm(item.ten) === norm(line.ten));
          if (!hit) return line;
          matched += 1;
          const donGia = line.don_gia || Math.round(hit.cost);
          return {
            ...line,
            ma_hang: hit.ma_hang,
            ten: hit.ten,
            dvt: hit.dvt || line.dvt,
            don_gia: donGia,
            thanh_tien: Math.round(line.so_luong * donGia),
          };
        }),
      );
      const msg = `Đã đồng bộ ${matched} dòng từ kho. Số lượng bán được giữ nguyên; giá chỉ bổ sung cho dòng đang bằng 0.`;
      setAiNote(msg);
      toast.success(msg);
    } catch (e) {
      setErr(`Không đọc được tồn kho: ${(e as Error).message}`);
    }
  }

  async function checkStock() {
    try {
      await loadStock();
      const msg = "Đã cập nhật tồn khả dụng mới nhất từ kho CRM.";
      setAiNote(msg);
      toast.success(msg);
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
      await api.invSaleDraftExportXlsx(valid.map((l) => ({ ...l, tien_thue: tienThue(l) })));
      toast.success("Đã xuất file Excel hóa đơn nháp.");
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg);
      toast.error(msg);
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
          const msg = j.result.note || `AI gợi ý ${added.length} dòng`;
          setAiNote(msg);
          toast.success(msg);
          setAiOpen(false);
          return;
        }
        if (j.status === "error") throw new Error(j.error || "AI lỗi");
      }
      throw new Error("AI xử lý quá lâu, thử lại sau");
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg);
      toast.error(msg);
    } finally {
      setAiBusy(false);
    }
  }

  const tongTruoc = lines.reduce((s, l) => s + (l.thanh_tien || Math.round(l.so_luong * l.don_gia)), 0);
  const tongThue = lines.reduce((s, l) => s + tienThue(l), 0);
  const stockWarnings = lines
    .filter((l) => l.ten.trim() && !l.is_dich_vu)
    .map((l) => {
      if (!l.ma_hang || stockByCode[l.ma_hang] == null) return { line: l, level: "warning" as const, text: "Chưa map mã kho" };
      const ton = stockByCode[l.ma_hang];
      return ton + 1e-6 < l.so_luong
        ? { line: l, level: "danger" as const, text: `Thiếu ${vnd(l.so_luong - ton)} (tồn ${vnd(ton)})` }
        : { line: l, level: "success" as const, text: `Đủ tồn: ${vnd(ton)}` };
    });

  return (
    <PageShell maxWidth="wide" className="sale-draft-studio" data-page="sale-draft">
      <PageHeader
        variant="compact"
        icon="file-spreadsheet"
        title="Tạo hóa đơn nháp"
        subtitle="Soạn, kiểm tra kho và đồng bộ sang iHOADON ở trạng thái GHI_TAM."
        actions={
          <>
            <AppButton variant="secondary" size="sm" leftIcon="refresh" onClick={syncIhoadon}>
              Đồng bộ iHOADON
            </AppButton>
            {safeHttpUrl(ihd?.web_url) && (
              <a
                className="ui-btn ui-btn--secondary ui-btn--sm"
                href={safeHttpUrl(ihd?.web_url)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>Mở iHOADON</span>
                <AppIcon name="external-link" size={14} />
              </a>
            )}
          </>
        }
      />

      <InlineAlert tone="warning">
        <strong>Chỉ tạo bản GHI_TAM</strong> (không ký số, không phát hành).
        {policy && (
          <>
            {" "}
            Checkpoint {new Date(policy.date).toLocaleDateString("vi-VN")}: giảm VAT{" "}
            <strong>{policy.standard_eligible_rate}%</strong> đến{" "}
            {new Date(policy.reduction_to).toLocaleDateString("vi-VN")}; phần mềm chọn{" "}
            <strong>Không chịu thuế</strong>.
          </>
        )}
      </InlineAlert>

      {err && <InlineAlert tone="danger" onDismiss={() => setErr("")}>{err}</InlineAlert>}
      {ihdErr && <InlineAlert tone="danger">{ihdErr} — kiểm tra cấu hình trong Cài đặt.</InlineAlert>}
      {aiNote && <InlineAlert tone="success" onDismiss={() => setAiNote("")}>{aiNote}</InlineAlert>}

      {pasteOpen && (
        <SmartPartyPaste
          onApply={(data) => {
            setCustomer((current) => ({
              ...current,
              customer_name: data.name || current.customer_name,
              buyer_tax_code: data.mst || current.buyer_tax_code,
              buyer_name: data.nguoi_nhan || data.dai_dien || current.buyer_name,
              buyer_email: data.email || current.buyer_email,
              buyer_address: data.address || current.buyer_address,
            }));
          }}
        />
      )}

      <SectionCard
        padding="compact"
        title="Thông tin xuất hóa đơn"
        subtitle="Các trường này đi thẳng sang bản nháp iHOADON."
        icon="building-2"
        actions={
          <AppButton
            variant="secondary"
            size="sm"
            leftIcon="sparkles"
            onClick={() => setPasteOpen((open) => !open)}
          >
            {pasteOpen ? "Ẩn Smart Paste" : "Smart Paste"}
          </AppButton>
        }
      >
        <FormGrid cols={2}>
          <FormField label="Tên khách hàng" htmlFor="sd-customer-name" fullWidth required>
            <input
              id="sd-customer-name"
              className="ui-input"
              value={customer.customer_name}
              onChange={(e) => setCustomer({ ...customer, customer_name: e.target.value })}
            />
          </FormField>
          <FormField label="Mã số thuế" htmlFor="sd-mst" required>
            <input
              id="sd-mst"
              className="ui-input"
              value={customer.buyer_tax_code}
              onChange={(e) => setCustomer({ ...customer, buyer_tax_code: e.target.value })}
            />
          </FormField>
          <FormField label="Người mua" htmlFor="sd-buyer">
            <input
              id="sd-buyer"
              className="ui-input"
              value={customer.buyer_name}
              onChange={(e) => setCustomer({ ...customer, buyer_name: e.target.value })}
            />
          </FormField>
          <FormField label="Email" htmlFor="sd-email">
            <input
              id="sd-email"
              className="ui-input"
              type="email"
              value={customer.buyer_email}
              onChange={(e) => setCustomer({ ...customer, buyer_email: e.target.value })}
            />
          </FormField>
          <FormField label="Thanh toán" htmlFor="sd-pay">
            <input
              id="sd-pay"
              className="ui-input"
              value={customer.payment_method_name}
              onChange={(e) => setCustomer({ ...customer, payment_method_name: e.target.value })}
            />
          </FormField>
          <FormField label="Địa chỉ" htmlFor="sd-address" fullWidth required>
            <input
              id="sd-address"
              className="ui-input"
              value={customer.buyer_address}
              onChange={(e) => setCustomer({ ...customer, buyer_address: e.target.value })}
            />
          </FormField>
          <FormField label="Ghi chú" htmlFor="sd-note" fullWidth>
            <input
              id="sd-note"
              className="ui-input"
              value={customer.note}
              onChange={(e) => setCustomer({ ...customer, note: e.target.value })}
            />
          </FormField>
        </FormGrid>
      </SectionCard>

      <div className="ui-sticky-bar ui-sticky-bar--top">
        <AppButton variant="secondary" size="sm" leftIcon="sparkles" onClick={() => setAiOpen((o) => !o)}>
          AI gợi ý dòng hàng
        </AppButton>
        <AppButton variant="secondary" size="sm" leftIcon="warehouse" loading={stockBusy} onClick={checkStock}>
          {stockBusy ? "Đang kiểm tra…" : "Check kho"}
        </AppButton>
        <AppButton variant="secondary" size="sm" leftIcon="refresh" disabled={stockBusy} onClick={syncLinesFromStock}>
          Sync từ kho
        </AppButton>
        <StatusBadge tone={stockCheckedAt ? "info" : "neutral"} size="sm" icon="clock">
          {stockCheckedAt ? `Kho kiểm tra lúc ${stockCheckedAt}` : "Kho chưa kiểm tra"}
        </StatusBadge>
        <div className="ui-row ui-ml-auto">
          <AppButton variant="secondary" size="sm" leftIcon="file-spreadsheet" loading={busy} onClick={exportXlsx}>
            {busy ? "Đang xuất…" : "Xuất Excel"}
          </AppButton>
          <AppButton variant="primary" size="sm" leftIcon="cloud-upload" loading={busy} onClick={pushDraft}>
            {busy ? "Đang gửi…" : "Tạo nháp trên iHOADON"}
          </AppButton>
        </div>
      </div>

      {aiOpen && (
        <SectionCard title="AI gợi ý dòng hàng" icon="bot" tone="subtle" padding="compact">
          <div className="ui-stack--sm">
            <FormGrid cols={2}>
              <FormField label="Mô tả nội dung cần bán" htmlFor="sd-ai-desc">
                <input
                  id="sd-ai-desc"
                  className="ui-input"
                  placeholder="vd: bộ camera 4 mắt cho nhà xưởng, kèm đầu ghi + ổ cứng"
                  value={aiMoTa}
                  onChange={(e) => setAiMoTa(e.target.value)}
                />
              </FormField>
              <FormField label="Hướng dẫn thêm cho AI (tuỳ chọn)" htmlFor="sd-ai-ctx">
                <input
                  id="sd-ai-ctx"
                  className="ui-input"
                  placeholder="vd: dùng camera Dahua, thẻ nhớ 64G…"
                  value={aiCtx}
                  onChange={(e) => setAiCtx(e.target.value)}
                />
              </FormField>
            </FormGrid>
            <div>
              <AppButton
                variant="primary"
                size="sm"
                leftIcon="sparkles"
                loading={aiBusy}
                disabled={aiBusy || !aiMoTa.trim()}
                onClick={aiSuggest}
              >
                {aiBusy ? "AI đang nghĩ…" : "Gợi ý dòng hàng"}
              </AppButton>
            </div>
          </div>
        </SectionCard>
      )}

      <SectionCard
        eyebrow="02 · NỘI DUNG HÓA ĐƠN"
        title="Dòng hàng và dịch vụ"
        subtitle="Sync từ kho giữ nguyên số lượng đã nhập; chỉ bổ sung đơn giá cho dòng đang bằng 0."
        icon="package"
        actions={
          <AppButton variant="secondary" size="sm" leftIcon="plus" onClick={() => setLines([...lines, blankLine()])}>
            Thêm dòng
          </AppButton>
        }
      >
        <div className="ui-stack--sm">
          {stockWarnings.length > 0 && (
            <div className="ui-row">
              {stockWarnings.map((w, i) => (
                <StatusBadge key={i} tone={w.level} size="sm" dot>
                  {w.line.ma_hang || w.line.ten}: {w.text}
                </StatusBadge>
              ))}
            </div>
          )}

          <DataView
            mobileMode="scroll"
            empty={
              lines.length === 0 ? (
                <EmptyState
                  compact
                  icon="package"
                  title="Chưa có dòng hàng nào"
                  description="Thêm dòng thủ công hoặc dùng AI gợi ý dòng hàng."
                  action={
                    <AppButton variant="secondary" size="sm" leftIcon="plus" onClick={() => setLines([blankLine()])}>
                      Thêm dòng
                    </AppButton>
                  }
                />
              ) : undefined
            }
            desktop={
              <table className="doc-table studio-line-table">
                <thead>
                  <tr>
                    <th>Tên hàng (từ kho)</th>
                    <th className="col-unit">ĐVT</th>
                    <th className="col-qty">SL</th>
                    <th className="col-price">Đơn giá</th>
                    <th className="col-amount">Thành tiền</th>
                    <th className="col-vat">Thuế</th>
                    <th className="col-tax">Tiền thuế</th>
                    <th className="col-act">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td>
                        <div className="ui-stack--xs">
                          <input
                            className="ui-input"
                            aria-label={`Tên hàng hóa, dịch vụ dòng ${i + 1}`}
                            value={l.ten}
                            placeholder="gõ ≥2 ký tự để tìm mã kho…"
                            onChange={(e) => {
                              setLine(i, { ten: e.target.value });
                              searchRow(i, e.target.value);
                            }}
                          />
                          {(l.ma_hang || l.is_dich_vu) && (
                            <div className="ui-row">
                              {l.ma_hang && (
                                <StatusBadge size="sm" tone="success">
                                  {l.ma_hang}
                                </StatusBadge>
                              )}
                              {l.ma_hang && stockByCode[l.ma_hang] != null && (
                                <StatusBadge
                                  size="sm"
                                  tone={stockByCode[l.ma_hang] + 1e-6 >= l.so_luong ? "success" : "danger"}
                                  dot
                                >
                                  Kho: {vnd(stockByCode[l.ma_hang])} {l.dvt}
                                </StatusBadge>
                              )}
                              {l.is_dich_vu && (
                                <StatusBadge size="sm" tone="neutral">
                                  dịch vụ
                                </StatusBadge>
                              )}
                            </div>
                          )}
                          {search?.row === i && search.results.length > 0 && (
                            <div className="ui-subpanel ui-stack--xs ui-mt-1">
                              {search.results.slice(0, 6).map((it) => (
                                <AppButton
                                  key={it.id}
                                  variant="ghost"
                                  size="sm"
                                  className="ui-wrap-btn"
                                  onClick={() => pickItem(i, it)}
                                >
                                  <strong>{it.ma_hang}</strong> · {it.ten}
                                </AppButton>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        <input
                          aria-label={`Đơn vị tính dòng ${i + 1}`}
                          className={`ui-input${l.ten.trim() && !l.is_dich_vu && !l.dvt.trim() ? " field-missing" : ""}`}
                          value={l.dvt}
                          placeholder={!l.is_dich_vu ? "Thiếu" : ""}
                          onChange={(e) => setLine(i, { dvt: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Số lượng dòng ${i + 1}`}
                          className="ui-input ui-num"
                          value={l.so_luong}
                          onChange={(e) => setLine(i, { so_luong: parseNum(e.target.value) })}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Đơn giá dòng ${i + 1}`}
                          className="ui-input ui-num"
                          value={l.don_gia}
                          onChange={(e) => setLine(i, { don_gia: parseNum(e.target.value) })}
                        />
                      </td>
                      <td className="ui-num">{vnd(l.thanh_tien || l.so_luong * l.don_gia)}</td>
                      <td>
                        <select
                          aria-label={`Thuế suất dòng ${i + 1}`}
                          className="ui-select"
                          value={l.vat_name}
                          onChange={(e) => setLine(i, { vat_name: e.target.value })}
                        >
                          {!VAT_OPTIONS.includes(l.vat_name) && <option value={l.vat_name}>{l.vat_name}</option>}
                          {VAT_OPTIONS.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="ui-num ui-muted">{vnd(tienThue(l))}</td>
                      <td>
                        <div className="ui-stack--xs">
                          <label className="ui-check-label ui-text-xs">
                            <input
                              type="checkbox"
                              checked={l.is_dich_vu}
                              onChange={(e) => setLine(i, { is_dich_vu: e.target.checked })}
                            />
                            <span>DV</span>
                          </label>
                          <AppButton
                            variant="ghost"
                            size="sm"
                            leftIcon="trash"
                            onClick={() => setLines(lines.filter((_, j) => j !== i))}
                          >
                            Xóa
                          </AppButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          />

          <div className="ui-totals-grid">
            <div className="ui-total-cell">
              <span>Tổng trước thuế</span>
              <strong>{vnd(tongTruoc)} đ</strong>
            </div>
            <div className="ui-total-cell">
              <span>Tổng tiền thuế</span>
              <strong>{vnd(tongThue)} đ</strong>
            </div>
            <div className="ui-total-cell is-grand">
              <span>Tổng thanh toán</span>
              <strong>{vnd(tongTruoc + tongThue)} đ</strong>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        eyebrow="WORKFLOW GỬI KHÁCH"
        title="Tạo nháp, đóng dấu và lấy link trong một lần"
        subtitle="Hệ thống chỉ tạo trạng thái GHI_TAM, tải PDF từ iHOADON rồi đóng dấu “BẢN NHÁP”. Không ký số và không phát hành hóa đơn."
        icon="send"
      >
        <div className="ui-stack--sm">
          <div className="studio-delivery-grid">
            <div className="studio-delivery-copy ui-muted">
              Đóng gói PDF có dấu bản nháp và bộ ZIP lưu vào hồ sơ khách hàng, trả về link chia sẻ 7 ngày.
            </div>
            <FormField label="Ngày dự kiến xuất" htmlFor="sd-expected-date">
              <input
                id="sd-expected-date"
                className="ui-input"
                type="date"
                value={expectedIssueDate}
                onChange={(event) => setExpectedIssueDate(event.target.value)}
              />
            </FormField>
            <AppButton variant="primary" size="md" leftIcon="send" loading={busy} onClick={createDelivery}>
              {busy ? "Đang tạo bộ hồ sơ…" : "Tạo nháp & lấy link gửi khách"}
            </AppButton>
          </div>

          {deliveryResult && (
            <InlineAlert tone="success" title={`${deliveryResult.status} · ${deliveryResult.template_code}/${deliveryResult.invoice_series}`}>
              <div className="ui-row-between">
                <span>Link hết hạn {dateTime(deliveryResult.share_expires_at)} · PDF đã lưu vào hồ sơ khách hàng</span>
                <div className="ui-row">
                  {safeHttpUrl(deliveryResult.share_url) && (
                    <a
                      className="ui-btn ui-btn--secondary ui-btn--sm"
                      href={safeHttpUrl(deliveryResult.share_url)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <AppIcon name="eye" size={14} />
                      <span>Xem PDF</span>
                    </a>
                  )}
                  <AppButton variant="secondary" size="sm" leftIcon="copy" onClick={copyDeliveryLink}>
                    {copied ? "Đã copy" : "Copy link"}
                  </AppButton>
                  <a
                    className="ui-btn ui-btn--primary ui-btn--sm"
                    href={deliveryResult.zip_url}
                    download={deliveryResult.zip_filename}
                  >
                    <AppIcon name="download" size={14} />
                    <span>Tải ZIP</span>
                  </a>
                </div>
              </div>
            </InlineAlert>
          )}
        </div>
      </SectionCard>

      {ihd && (
        <KpiStrip
          columns={4}
          items={[
            { label: "Đã xuất", value: ihd.issued, tone: "success", icon: "check-circle" },
            { label: "Ghi tạm", value: ihd.draft, tone: "warning", icon: "file-text" },
            { label: "Chờ xử lý", value: ihd.waiting, tone: "info", icon: "clock" },
            { label: "Tổng hóa đơn", value: ihd.total, tone: "brand", icon: "receipt" },
          ]}
        />
      )}

      {drafts.length > 0 && (
        <details className="ui-collapsible">
          <summary>Hóa đơn ghi tạm trên iHOADON ({drafts.length} bản mới nhất)</summary>
          <DataView
            mobileMode="card"
            desktop={
              <table className="doc-table">
                <thead>
                  <tr>
                    <th>Khách hàng</th>
                    <th>MST</th>
                    <th>Mẫu</th>
                    <th className="ui-num">Thanh toán</th>
                    <th>Ngày tạo</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((d) => {
                    const crmHref = safeHttpUrl(draftSyncResults[d.id]?.share_url);
                    const webHref = safeHttpUrl(ihd?.web_url);
                    return (
                      <tr key={d.id}>
                        <td><strong>{d.customer_name || "Khách lẻ"}</strong></td>
                        <td>{d.buyer_tax_code || "—"}</td>
                        <td>
                          <StatusBadge size="sm" tone="neutral">
                            {d.template_code}/{d.invoice_series}
                          </StatusBadge>
                        </td>
                        <td className="ui-num"><strong>{vnd(d.total_payment)} đ</strong></td>
                        <td className="ui-muted">{dateTime(d.created_at)}</td>
                        <td>
                          <div className="ui-row">
                            <AppButton
                              variant="secondary"
                              size="sm"
                              leftIcon="refresh"
                              loading={draftSyncing === d.id}
                              onClick={() => syncDraftToCrm(d)}
                            >
                              {draftSyncing === d.id ? "Đang đồng bộ…" : "Đồng bộ vào hồ sơ"}
                            </AppButton>
                            {crmHref && (
                              <a
                                className="ui-btn ui-btn--primary ui-btn--sm"
                                href={crmHref}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <AppIcon name="eye" size={14} />
                                <span>Mở PDF trong CRM</span>
                              </a>
                            )}
                            {webHref && (
                              <a
                                className="ui-btn ui-btn--ghost ui-btn--sm"
                                href={webHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Mở danh sách ghi tạm để sửa trên iHOADON"
                              >
                                <span>Sửa trên iHOADON</span>
                                <AppIcon name="external-link" size={14} />
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            }
            mobileCards={
              <div className="ui-mobile-card-list">
                {drafts.map((d) => {
                  const crmHref = safeHttpUrl(draftSyncResults[d.id]?.share_url);
                  const webHref = safeHttpUrl(ihd?.web_url);
                  return (
                    <MobileCard key={d.id}>
                      <MobileCardHeader
                        title={d.customer_name || "Khách lẻ"}
                        subtitle={`MST: ${d.buyer_tax_code || "—"} · ${dateTime(d.created_at)}`}
                        badge={<StatusBadge size="sm" tone="neutral">{d.template_code}/{d.invoice_series}</StatusBadge>}
                      />
                      <MobileCardGrid cols={1}>
                        <MobileCardRow label="Thanh toán" value={`${vnd(d.total_payment)} đ`} mono />
                      </MobileCardGrid>
                      <MobileCardActions>
                        <AppButton
                          variant="secondary"
                          size="sm"
                          leftIcon="refresh"
                          loading={draftSyncing === d.id}
                          onClick={() => syncDraftToCrm(d)}
                        >
                          {draftSyncing === d.id ? "Đang đồng bộ…" : "Đồng bộ vào hồ sơ"}
                        </AppButton>
                        {crmHref && (
                          <a
                            className="ui-btn ui-btn--primary ui-btn--sm"
                            href={crmHref}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <AppIcon name="eye" size={14} />
                            <span>Mở PDF trong CRM</span>
                          </a>
                        )}
                        {webHref && (
                          <a
                            className="ui-btn ui-btn--ghost ui-btn--sm"
                            href={webHref}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <span>Sửa trên iHOADON</span>
                            <AppIcon name="external-link" size={14} />
                          </a>
                        )}
                      </MobileCardActions>
                    </MobileCard>
                  );
                })}
              </div>
            }
          />
        </details>
      )}
    </PageShell>
  );
}
