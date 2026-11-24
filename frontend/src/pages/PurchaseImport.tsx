import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";
import { api, BangKeResult, InvItem, InvPurchase, InvPurchaseLine, InvWarehouse } from "../api";
import { DateFilter, DateRange } from "../components/DateFilter";
import { EmailSyncModal } from "../components/EmailSyncModal";
import {
  AppButton,
  AppIcon,
  AppModal,
  DataView,
  EmptyState,
  FilterBar,
  FormField,
  FormGrid,
  InlineAlert,
  type KpiItem,
  KpiStrip,
  MobileCard,
  MobileCardActions,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  PageHeader,
  PageShell,
  PromptDialog,
  SectionCard,
  StatusBadge,
  type StatusBadgeTone,
  TableSkeleton,
  useConfirm,
  useToast,
} from "../components/ui";
import { openExternalSafe, safeHttpUrl } from "../utils/url";
import { getParam, setParam } from "../util";

function vnd(n: number): string {
  return Math.round(n).toLocaleString("vi-VN");
}

// Đọc số kiểu VN: '652.777,77' (phẩy=thập phân), '1.500.000', '652,777.77'
function vnNum(s: string): number {
  const t = (s || "").trim().replace(/\s/g, "");
  if (!t) return 0;
  let x = t;
  const hasDot = x.includes(".");
  const hasComma = x.includes(",");
  if (hasDot && hasComma) {
    x =
      x.lastIndexOf(",") > x.lastIndexOf(".")
        ? x.replace(/\./g, "").replace(",", ".")
        : x.replace(/,/g, "");
  } else if (hasComma) {
    const p = x.split(",");
    x = p.length === 2 ? x.replace(",", ".") : x.replace(/,/g, "");
  } else if (hasDot) {
    const p = x.split(".");
    if (p.length > 2 || (p.length === 2 && p[1].length === 3)) x = x.replace(/\./g, "");
  }
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

const STATUS_META: Record<string, { tone: StatusBadgeTone; label: string }> = {
  draft: { tone: "warning", label: "Nháp — chờ duyệt" },
  posted: { tone: "success", label: "Đã ghi sổ" },
  void: { tone: "neutral", label: "Đã hủy" },
};

const SOURCE_LABEL: Record<string, string> = {
  xml: "XML",
  pdf: "PDF",
  scan_ai: "Scan + AI",
  manual: "Nhập tay",
};

type PurchaseSortKey = "date" | "id" | "invoice" | "seller" | "total" | "source";

const invoiceNumberCollator = new Intl.Collator("vi", { numeric: true, sensitivity: "base" });
const sellerNameCollator = new Intl.Collator("vi", { numeric: true, sensitivity: "base" });
const sourceLabelCollator = new Intl.Collator("vi", { numeric: true, sensitivity: "base" });

export function PurchaseImport({
  openId,
  onConsumed,
}: { openId?: number | null; onConsumed?: () => void } = {}) {
  const askConfirm = useConfirm();
  const toast = useToast();

  const [list, setList] = useState<InvPurchase[]>([]);
  const [search, setSearch] = useState("");
  const [statusF, setStatusF] = useState("");
  const [vatF, setVatF] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>({ tu: "", den: "" });
  const [cur, setCur] = useState<InvPurchase | null>(null);
  const [whs, setWhs] = useState<InvWarehouse[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const bangKeRef = useRef<HTMLInputElement>(null);
  const [itemQuery, setItemQuery] = useState<{ line: number; q: string; results: InvItem[] } | null>(
    null,
  );
  const [urlValue, setUrlValue] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  const [bangKeBusy, setBangKeBusy] = useState(false);
  const [nasBusy, setNasBusy] = useState(false);
  const [bangKe, setBangKe] = useState<BangKeResult | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [listLoaded, setListLoaded] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [sortBy, setSortBy] = useState<PurchaseSortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [hidePre2026, setHidePre2026] = useState(true);
  const [emailSyncOpen, setEmailSyncOpen] = useState(false);
  const [attachBusy, setAttachBusy] = useState(false);
  const [viewPdfMode, setViewPdfMode] = useState<boolean>(true);
  const [createItemPrompt, setCreateItemPrompt] = useState<{
    idx: number;
    label: string;
    suggested: string;
  } | null>(null);
  const autoHdRef = useRef(false);

  const fNgayId = useId();
  const fSoHdId = useId();
  const fKyHieuId = useId();
  const fMstId = useId();
  const fTenBanId = useId();

  const pre2026Count = list.filter((p) => (p.ngay || "") < "2026-01-01").length;
  const from2026Count = list.filter((p) => (p.ngay || "") >= "2026-01-01").length;
  const activeList = useMemo(
    () => (hidePre2026 ? list.filter((p) => (p.ngay || "") >= "2026-01-01") : list),
    [list, hidePre2026],
  );

  function toggleSel(id: number) {
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const dupIds = activeList
    .filter((p) => p.dup_of != null && p.status !== "posted")
    .map((p) => p.id);

  function changeSort(nextKey: PurchaseSortKey) {
    if (sortBy === nextKey) {
      setSortDir((dir) => (dir === "desc" ? "asc" : "desc"));
      return;
    }
    setSortBy(nextKey);
    setSortDir("desc");
  }

  function renderSortBtn(col: PurchaseSortKey, label: string) {
    const active = sortBy === col;
    return (
      <AppButton
        variant="ghost"
        size="sm"
        className="inv-sort-btn"
        onClick={() => changeSort(col)}
      >
        <span>{label}</span>
        {active && (
          <AppIcon name={sortDir === "desc" ? "arrow-down" : "arrow-up"} size={12} />
        )}
      </AppButton>
    );
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? activeList.filter(
          (p) =>
            String(p.id).includes(q) ||
            (p.so_hd || "").toLowerCase().includes(q) ||
            (p.ten_ban || "").toLowerCase().includes(q) ||
            (p.mst_ban || "").toLowerCase().includes(q),
        )
      : activeList;

    return [...base].sort((a, b) => {
      const direction = sortDir === "desc" ? -1 : 1;
      if (sortBy === "id") return (a.id - b.id) * direction;
      if (sortBy === "invoice")
        return invoiceNumberCollator.compare(a.so_hd || "", b.so_hd || "") * direction;
      if (sortBy === "seller")
        return sellerNameCollator.compare(a.ten_ban || "", b.ten_ban || "") * direction;
      if (sortBy === "total") return (a.tong_tien - b.tong_tien || a.id - b.id) * direction;
      if (sortBy === "source")
        return (
          (sourceLabelCollator.compare(
            SOURCE_LABEL[a.source] ?? a.source,
            SOURCE_LABEL[b.source] ?? b.source,
          ) ||
            a.id - b.id) * direction
        );
      const byDate = (a.ngay || "").localeCompare(b.ngay || "");
      return (byDate || a.id - b.id) * direction;
    });
  }, [activeList, search, sortBy, sortDir]);

  function exportParams() {
    return sel.size > 0
      ? { ids: [...sel].join(",") }
      : {
          status_f: statusF,
          tu: dateRange.tu || (hidePre2026 ? "2026-01-01" : ""),
          den: dateRange.den,
        };
  }

  async function bulkDelete(ids: number[], label: string) {
    if (ids.length === 0) return;
    const ok = await askConfirm({
      title: `Xóa ${ids.length} hóa đơn ${label}?`,
      message: "Các hóa đơn đã ghi sổ sẽ tự động được bỏ qua, chỉ xóa các bản nháp.",
      confirmLabel: `Xóa ${ids.length} hóa đơn`,
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setErr("");
    try {
      const r = await api.invPurchaseBulkDelete(ids);
      const msg = `Đã xóa ${r.deleted} hóa đơn${r.skipped ? `, bỏ qua ${r.skipped} đã ghi sổ` : ""}.`;
      setUploadMsg([msg]);
      toast.success(msg);
      setSel(new Set());
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function bulkPost() {
    const ids = [...sel];
    if (ids.length === 0) return;
    const ok = await askConfirm({
      title: `Ghi sổ ${ids.length} hóa đơn đã chọn?`,
      message: "Hệ thống sẽ kiểm tra và ghi nhận tồn kho cho toàn bộ hóa đơn được chọn.",
      confirmLabel: `Ghi sổ (${ids.length})`,
      tone: "primary",
    });
    if (!ok) return;
    setBusy(true);
    setErr("");
    try {
      const r = await api.invPurchaseBulkPost(ids);
      const fail = r.results.filter((x) => !x.ok);
      setUploadMsg([
        `Đã ghi sổ ${r.ok}/${r.total} hóa đơn.`,
        ...fail.map((x) => `Lỗi ${x.ten || "#" + x.id}: ${x.error}`),
      ]);
      if (fail.length === 0) toast.success(`Đã ghi sổ thành công ${r.ok}/${r.total} hóa đơn.`);
      else toast.warning(`Ghi sổ ${r.ok}/${r.total} hóa đơn (${fail.length} lỗi).`);
      setSel(new Set());
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function load() {
    setListLoading(true);
    try {
      const data = await api.invPurchases(statusF, { ...dateRange, vat: vatF });
      setList(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setListLoading(false);
      setListLoaded(true);
    }
  }

  useEffect(() => {
    api.invWarehouses().then(setWhs).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusF, dateRange.tu, dateRange.den, vatF]);

  useEffect(() => {
    if (openId) {
      open(openId);
      onConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  useEffect(() => {
    if (!listLoaded || autoHdRef.current) return;
    autoHdRef.current = true;
    const hd = getParam("hd");
    if (hd) open(Number(hd));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listLoaded]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setErr("");
    try {
      const r = await api.invPurchaseUpload(Array.from(files));
      setUploadMsg(
        r.results.map((x) =>
          x.ok
            ? `${x.filename}: đã tạo bản nháp #${x.purchase_id}${x.dup_of ? ` — TRÙNG với HĐ #${x.dup_of}` : ""}`
            : `Lỗi ${x.filename}: ${x.error}`,
        ),
      );
      const okCount = r.results.filter((x) => x.ok).length;
      if (okCount > 0) toast.success(`Đã tạo ${okCount} bản nháp hóa đơn mới.`);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    void upload(event.dataTransfer.files);
  }

  async function importFromUrl() {
    const url = urlValue.trim();
    if (!url) return;
    setUrlBusy(true);
    setErr("");
    try {
      const r = await api.invPurchaseImportUrl(url);
      setUploadMsg(
        r.results.map((x) =>
          x.ok
            ? `${x.filename}: đã tạo bản nháp #${x.purchase_id}${x.dup_of ? ` — TRÙNG với HĐ #${x.dup_of}` : ""}`
            : `Lỗi ${x.filename}: ${x.error}`,
        ),
      );
      toast.success("Đã nhập hóa đơn từ liên kết.");
      setUrlValue("");
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUrlBusy(false);
    }
  }

  async function uploadBangKe(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBangKeBusy(true);
    setErr("");
    try {
      setBangKe(await api.invPurchaseBangKe(files[0]));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBangKeBusy(false);
      if (bangKeRef.current) bangKeRef.current.value = "";
    }
  }

  async function syncNas() {
    setNasBusy(true);
    setErr("");
    try {
      const r = await api.invPurchaseSyncNas();
      toast.success(
        `Đồng bộ NAS: ${r.synced} mới, ${r.skipped} bỏ qua (đã có), ${r.failed} lỗi.`,
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setNasBusy(false);
    }
  }

  async function open(id: number) {
    try {
      const p = await api.invPurchase(id);
      setCur(p);
      setItemQuery(null);
      setParam("hd", String(id));
      setViewPdfMode(Boolean(p.doc_url));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function onAttachPdf(id: number, file: File) {
    setAttachBusy(true);
    setErr("");
    try {
      await api.attachPurchasePdf(id, file);
      const updated = await api.invPurchase(id);
      setCur(updated);
      setViewPdfMode(true);
      const msg = `Đã nạp bổ sung file PDF thành công cho hóa đơn #${id}.`;
      setUploadMsg([msg]);
      toast.success(msg);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAttachBusy(false);
    }
  }

  function closeCur() {
    setCur(null);
    setParam("hd", null);
  }

  function setLine(idx: number, patch: Partial<InvPurchaseLine>) {
    if (!cur) return;
    const lines = cur.lines.map((ln, i) => {
      if (i !== idx) return ln;
      const next = { ...ln, ...patch };
      if ("so_luong" in patch || "don_gia" in patch) {
        next.thanh_tien = Math.round(next.so_luong * next.don_gia);
      }
      return next;
    });
    setCur({ ...cur, lines });
  }

  async function saveDraft(silent = false): Promise<InvPurchase | null> {
    if (!cur) return null;
    try {
      const saved = await api.invPurchaseSave(cur.id, {
        so_hd: cur.so_hd,
        ky_hieu: cur.ky_hieu,
        mst_ban: cur.mst_ban,
        ten_ban: cur.ten_ban,
        ngay: cur.ngay,
        lines: cur.lines.map((ln) => ({
          stt: ln.stt,
          ten_raw: ln.ten_raw,
          dvt: ln.dvt,
          so_luong: ln.so_luong,
          don_gia: ln.don_gia,
          thanh_tien: ln.thanh_tien,
          thue_suat: ln.thue_suat,
          item_id: ln.item_id,
          warehouse_id: ln.warehouse_id,
          match_kind: ln.item_id ? "manual" : "none",
        })),
      });
      setCur(saved);
      if (!silent) toast.success(`Đã lưu nháp HĐ #${saved.id}.`);
      return saved;
    } catch (e) {
      setErr((e as Error).message);
      return null;
    }
  }

  async function postCur() {
    const saved = await saveDraft(true);
    if (!saved) return;
    try {
      setCur(await api.invPurchasePost(saved.id));
      toast.success(`Đã ghi sổ HĐ #${saved.id}.`);
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function deleteCurrentDraft() {
    if (!cur) return;
    const ok = await askConfirm({
      title: `Xóa bản nháp HĐ #${cur.id}?`,
      message: "Bản nháp hóa đơn mua này sẽ bị xóa vĩnh viễn khỏi sổ mua vào.",
      confirmLabel: "Xóa nháp",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.invPurchaseDelete(cur.id);
      toast.success(`Đã xóa bản nháp HĐ #${cur.id}.`);
      closeCur();
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function voidCurrentPurchase() {
    if (!cur) return;
    const ok = await askConfirm({
      title: `Hủy ghi sổ HĐ #${cur.id}?`,
      message: "Hủy ghi sổ hóa đơn này để sửa lại? Tồn kho sẽ được tính lại tự động.",
      confirmLabel: "Hủy ghi sổ",
      tone: "warning",
    });
    if (!ok) return;
    setBusy(true);
    setErr("");
    try {
      setCur(await api.invPurchaseVoid(cur.id));
      toast.info(`Đã hủy ghi sổ HĐ #${cur.id}. Bạn có thể chỉnh sửa ngay bây giờ.`);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createItemFromLine(idx: number) {
    if (!cur) return;
    const ln = cur.lines[idx];
    let suggested = "";
    try {
      suggested = (await api.invSuggestItemCode()).code;
    } catch {
      /* ignore */
    }
    setCreateItemPrompt({ idx, label: ln.ten_raw, suggested });
  }

  async function confirmCreateItem(ma: string) {
    if (!createItemPrompt || !cur) return;
    const { idx } = createItemPrompt;
    const ln = cur.lines[idx];
    setCreateItemPrompt(null);
    if (!ma.trim() || !ln) return;
    try {
      const it = await api.invCreateItem({ ma_hang: ma.trim(), ten: ln.ten_raw, dvt: ln.dvt });
      setLine(idx, {
        item_id: it.id,
        item_ma_hang: it.ma_hang,
        item_ten: it.ten,
        match_kind: "new",
      });
      toast.success(`Đã tạo mã hàng mới ${it.ma_hang}.`);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function searchItems(idx: number, q: string) {
    setItemQuery({ line: idx, q, results: itemQuery?.results ?? [] });
    if (q.trim().length >= 2) {
      try {
        const results = await api.invItems(q);
        setItemQuery((prev) => (prev && prev.line === idx ? { ...prev, results } : prev));
      } catch {
        /* ignore */
      }
    }
  }

  const isDichVu = cur?.loai === "dich_vu";
  const unmatched = cur && !isDichVu ? cur.lines.filter((ln) => !ln.item_id).length : 0;
  const draftCount = activeList.filter((p) => p.status === "draft").length;
  const postedCount = activeList.filter((p) => p.status === "posted").length;
  const warningCount = activeList.reduce((sum, p) => sum + p.warnings.length, 0);
  const totalValue = activeList.reduce((sum, p) => sum + (p.tong_tien || 0), 0);
  const activeFilterCount =
    (statusF ? 1 : 0) +
    (vatF ? 1 : 0) +
    (dateRange.tu || dateRange.den ? 1 : 0) +
    (!hidePre2026 ? 1 : 0) +
    (search.trim() ? 1 : 0);

  async function toggleLoai() {
    if (!cur) return;
    const next = cur.loai === "dich_vu" ? "hang_hoa" : "dich_vu";
    try {
      setCur(await api.invPurchaseSave(cur.id, { loai: next }));
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const kpiItems = useMemo<KpiItem[]>(
    () => [
      {
        label: "Tất cả hóa đơn",
        value: activeList.length,
        sub: `${vnd(totalValue)} đ`,
        tone: "brand",
        icon: "file-text",
        active: statusF === "",
        onClick: () => setStatusF(""),
      },
      {
        label: "Nháp chờ duyệt",
        value: draftCount,
        sub: "Cần kiểm tra trước khi ghi sổ",
        tone: "warning",
        icon: "clock",
        active: statusF === "draft",
        onClick: () => setStatusF("draft"),
      },
      {
        label: "Đã ghi sổ",
        value: postedCount,
        sub: "Đã cập nhật vào tồn kho",
        tone: "success",
        icon: "check-circle",
        active: statusF === "posted",
        onClick: () => setStatusF("posted"),
      },
      {
        label: "Cảnh báo",
        value: warningCount,
        sub: warningCount > 0 ? "Mở từng HĐ để rà soát" : "Đang sạch dữ liệu",
        tone: warningCount > 0 ? "danger" : "neutral",
        icon: warningCount > 0 ? "alert-triangle" : "shield-check",
      },
    ],
    [activeList.length, totalValue, statusF, draftCount, postedCount, warningCount],
  );

  function resetAllFilters() {
    setSearch("");
    setStatusF("");
    setVatF("");
    setDateRange({ tu: "", den: "" });
    setHidePre2026(true);
  }

  return (
    <PageShell
      data-page="purchase-import"
      className="purchase-page"
    >
      <div
        className="ui-stack"
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setDragActive(false);
        }}
        onDrop={handleDrop}
      >
        {/* Hidden file inputs always mounted for 1-click upload & bảng kê */}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.xml,.zip"
          multiple
          className="ui-hidden"
          onChange={(e) => void upload(e.target.files)}
        />
        <input
          ref={bangKeRef}
          type="file"
          accept=".xlsx"
          className="ui-hidden"
          onChange={(e) => void uploadBangKe(e.target.files)}
        />

        <PageHeader
          variant="compact"
          icon="receipt"
          title="Nhập hàng"
          subtitle="Đưa hóa đơn mua vào sổ, kiểm tra thuế và khớp hàng hóa trước khi ghi nhận tồn kho."
          actions={
            <>
              <AppButton
                variant="secondary"
                leftIcon="sliders-horizontal"
                aria-expanded={toolsOpen}
                onClick={() => setToolsOpen((v) => !v)}
              >
                Công cụ &amp; Email
              </AppButton>
              <AppButton
                variant="primary"
                leftIcon="upload"
                loading={busy}
                onClick={() => fileRef.current?.click()}
              >
                {busy ? "Đang xử lý…" : "Tải hóa đơn lên"}
              </AppButton>
            </>
          }
        />

        {(toolsOpen || dragActive) && (
          <SectionCard
            title="Đưa chứng từ vào sổ & Đối chiếu"
            subtitle="Kéo thả nhiều PDF / XML / ZIP, dán link Drive hoặc đối chiếu bảng kê thuế."
            icon="cloud-upload"
            padding="compact"
            actions={
              <AppButton
                variant="ghost"
                size="sm"
                iconOnly
                leftIcon="x"
                aria-label="Ẩn công cụ nhập"
                onClick={() => {
                  setToolsOpen(false);
                  setDragActive(false);
                }}
              />
            }
          >
            <div className="purchase-intake-tray">
              <div
                className={`ui-dropzone ${dragActive ? "is-dragging" : ""}`}
                onClick={() => fileRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") fileRef.current?.click();
                }}
              >
                <span className="ui-dropzone-icon" aria-hidden="true">
                  <AppIcon name="upload" size={20} />
                </span>
                <div className="ui-dropzone-copy">
                  <strong>Kéo thả file PDF / XML / ZIP vào đây</strong>
                  <span>Hoặc bấm để chọn nhiều chứng từ cùng lúc</span>
                </div>
              </div>

              <div className="ui-stack--sm">
                <FormField label="Nguồn từ link (Drive / PDF / XML / ZIP)" htmlFor="purchase-source-url">
                  <div className="purchase-link-row">
                    <input
                      id="purchase-source-url"
                      className="ui-input"
                      placeholder="Dán link Drive, PDF, XML hoặc ZIP"
                      value={urlValue}
                      onChange={(e) => setUrlValue(e.target.value)}
                    />
                    <AppButton
                      variant="primary"
                      size="sm"
                      leftIcon="link"
                      loading={urlBusy}
                      disabled={!urlValue.trim()}
                      onClick={importFromUrl}
                    >
                      Nhập link
                    </AppButton>
                  </div>
                </FormField>

                <div className="ui-row">
                  <AppButton
                    variant="secondary"
                    size="sm"
                    leftIcon="file-spreadsheet"
                    loading={bangKeBusy}
                    onClick={() => bangKeRef.current?.click()}
                  >
                    Đối chiếu bảng kê thuế
                  </AppButton>
                  <AppButton
                    variant="secondary"
                    size="sm"
                    leftIcon="hard-drive"
                    loading={nasBusy}
                    title="Đồng bộ file gốc HĐ mua lên NAS (chỉ file mới/đã đổi — theo checksum)"
                    onClick={syncNas}
                  >
                    Đồng bộ NAS
                  </AppButton>
                  <AppButton
                    variant="secondary"
                    size="sm"
                    leftIcon="mail"
                    title="Quét và đồng bộ hóa đơn PDF/XML từ hộp thư Zoho Mail (khanhnhn@inut.vn)"
                    onClick={() => setEmailSyncOpen(true)}
                  >
                    Đồng bộ Email Zoho
                  </AppButton>
                </div>
              </div>
            </div>
          </SectionCard>
        )}

        <KpiStrip items={kpiItems} columns={4} loading={listLoading && !listLoaded} />

        {err && !cur && <InlineAlert tone="danger">{err}</InlineAlert>}

        {uploadMsg.length > 0 && (
          <InlineAlert tone="info" onDismiss={() => setUploadMsg([])}>
            <div className="ui-stack--sm">
              {uploadMsg.map((m, i) => (
                <div key={i}>{m}</div>
              ))}
            </div>
          </InlineAlert>
        )}

        <FilterBar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: "Tìm số HĐ, nhà cung cấp, MST, #ID…",
          }}
          filters={
            <>
              <select
                className="ui-select"
                aria-label="Phạm vi năm hóa đơn"
                value={hidePre2026 ? "2026" : "all"}
                onChange={(e) => setHidePre2026(e.target.value === "2026")}
              >
                <option value="2026">Chính thức từ 2026 ({from2026Count})</option>
                <option value="all">
                  Tất cả gồm lịch sử &lt; 2026 ({list.length})
                </option>
              </select>
              <select
                className="ui-select"
                aria-label="Trạng thái hóa đơn"
                value={statusF}
                onChange={(e) => setStatusF(e.target.value)}
              >
                <option value="">Tất cả trạng thái</option>
                <option value="draft">Nháp chờ duyệt</option>
                <option value="posted">Đã ghi sổ</option>
              </select>
              <DateFilter value={dateRange} onChange={setDateRange} />
              <select
                className="ui-select"
                aria-label="Lọc theo thuế suất VAT"
                value={vatF}
                onChange={(e) => setVatF(e.target.value)}
              >
                <option value="">Tất cả VAT</option>
                <option value="0">0% / KCT</option>
                <option value="5">5%</option>
                <option value="8">8%</option>
                <option value="10">10%</option>
              </select>
            </>
          }
          actions={
            <>
              <AppButton
                variant="secondary"
                size="sm"
                leftIcon="file-archive"
                onClick={() => openExternalSafe(api.invExportUrl("purchase", "zip", exportParams()))}
              >
                ZIP gốc
              </AppButton>
              <AppButton
                variant="secondary"
                size="sm"
                leftIcon="download"
                onClick={() => openExternalSafe(api.invExportUrl("purchase", "xlsx", exportParams()))}
              >
                Excel
              </AppButton>
            </>
          }
          activeCount={activeFilterCount}
          onReset={resetAllFilters}
          collapsibleMobile
        />

        {(sel.size > 0 || dupIds.length > 0 || (hidePre2026 && pre2026Count > 0)) && (
          <div
            className={`ui-action-bar${sel.size > 0 ? " is-selection-active" : ""}`}
          >
            <div className="ui-action-bar-info">
              {sel.size > 0 ? (
                <span className="ui-action-bar-count">Đã chọn {sel.size} hóa đơn</span>
              ) : (
                <span className="ui-muted">
                  Hiển thị <b>{shown.length}</b> hóa đơn
                  {hidePre2026 && pre2026Count > 0
                    ? ` (đang ẩn ${pre2026Count} HĐ nháp lịch sử < 2026)`
                    : ""}
                </span>
              )}
            </div>
            <div className="ui-action-bar-actions">
              {sel.size > 0 && (
                <>
                  <AppButton
                    variant="primary"
                    size="sm"
                    leftIcon="check-circle"
                    loading={busy}
                    onClick={bulkPost}
                  >
                    Ghi sổ đã chọn ({sel.size})
                  </AppButton>
                  <AppButton
                    variant="danger"
                    size="sm"
                    leftIcon="trash"
                    disabled={busy}
                    onClick={() => void bulkDelete([...sel], "đã chọn")}
                  >
                    Xóa đã chọn ({sel.size})
                  </AppButton>
                  <AppButton
                    variant="ghost"
                    size="sm"
                    onClick={() => setSel(new Set())}
                  >
                    Bỏ chọn
                  </AppButton>
                </>
              )}
              {dupIds.length > 0 && (
                <AppButton
                  variant="danger"
                  size="sm"
                  leftIcon="trash"
                  disabled={busy}
                  onClick={() => void bulkDelete(dupIds, "TRÙNG")}
                >
                  Xóa hết trùng ({dupIds.length})
                </AppButton>
              )}
            </div>
          </div>
        )}

        {listLoading ? (
          <TableSkeleton rows={6} cols={8} />
        ) : (
          <DataView
            mobileMode="card"
            empty={
              shown.length === 0 ? (
                <EmptyState
                  icon="receipt"
                  title={
                    activeFilterCount > 0
                      ? "Không có hóa đơn khớp bộ lọc"
                      : "Sổ mua vào đang trống"
                  }
                  description={
                    activeFilterCount > 0
                      ? "Thử xóa bộ lọc hoặc mở rộng khoảng ngày để xem thêm chứng từ."
                      : "Tải PDF, XML hoặc ZIP lên để tạo bản nháp đầu tiên."
                  }
                  action={
                    activeFilterCount > 0 ? (
                      <AppButton variant="secondary" leftIcon="rotate-ccw" onClick={resetAllFilters}>
                        Xóa bộ lọc
                      </AppButton>
                    ) : (
                      <AppButton
                        variant="primary"
                        leftIcon="upload"
                        onClick={() => fileRef.current?.click()}
                      >
                        Tải hóa đơn lên
                      </AppButton>
                    )
                  }
                />
              ) : undefined
            }
            desktop={
              <div className="table-wrap">
                <table className="dt">
                  <thead>
                    <tr>
                      <th className="ui-col-chk">
                        <input
                          type="checkbox"
                          aria-label="Chọn tất cả hóa đơn"
                          checked={shown.length > 0 && sel.size === shown.length}
                          onChange={(e) =>
                            setSel(e.target.checked ? new Set(shown.map((p) => p.id)) : new Set())
                          }
                        />
                      </th>
                      <th>{renderSortBtn("id", "#")}</th>
                      <th>{renderSortBtn("date", "Ngày HĐ")}</th>
                      <th>{renderSortBtn("invoice", "Số HĐ")}</th>
                      <th>{renderSortBtn("seller", "Bên bán")}</th>
                      <th className="ui-text-right">{renderSortBtn("total", "Tổng tiền")}</th>
                      <th>{renderSortBtn("source", "Nguồn")}</th>
                      <th>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((p) => {
                      const meta = STATUS_META[p.status] ?? {
                        tone: "neutral" as StatusBadgeTone,
                        label: p.status,
                      };
                      return (
                        <tr
                          key={p.id}
                          className="ui-clickable"
                          onClick={() => void open(p.id)}
                        >
                          <td onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`Chọn hóa đơn #${p.id}`}
                              checked={sel.has(p.id)}
                              onChange={() => toggleSel(p.id)}
                            />
                          </td>
                          <td className="muted num">#{p.id}</td>
                          <td className="ui-nowrap num">
                            {p.ngay || (
                              <StatusBadge tone="danger" size="sm">
                                thiếu ngày
                              </StatusBadge>
                            )}
                          </td>
                          <td className="ui-nowrap">
                            <span className="ui-row">
                              <strong className="num">{p.so_hd}</strong>
                              {p.doc_url ? (
                                <StatusBadge
                                  tone="success"
                                  size="sm"
                                  icon="paperclip"
                                  title="Đã có file PDF/gốc"
                                >
                                  PDF
                                </StatusBadge>
                              ) : (
                                <label
                                  className="ui-btn ui-btn--secondary ui-btn--sm ui-clickable"
                                  title="Bấm để nộp bù file PDF cho hóa đơn này"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <AppIcon name="plus" size={12} />
                                  <span>Bù PDF</span>
                                  <input
                                    type="file"
                                    accept="application/pdf,.pdf"
                                    hidden
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      if (f) void onAttachPdf(p.id, f);
                                    }}
                                  />
                                </label>
                              )}
                            </span>
                          </td>
                          <td className="ui-wrap">
                            <span>{p.ten_ban}</span>
                            {p.loai === "dich_vu" && (
                              <StatusBadge
                                tone="info"
                                size="sm"
                                icon="receipt"
                                className="ui-ml-sm"
                              >
                                Dịch vụ
                              </StatusBadge>
                            )}
                            {p.dup_of && (
                              <StatusBadge
                                tone="danger"
                                size="sm"
                                className="ui-ml-sm"
                              >
                                trùng #{p.dup_of}
                              </StatusBadge>
                            )}
                            {p.warnings.length > 0 && (
                              <StatusBadge
                                tone="warning"
                                size="sm"
                                icon="alert-triangle"
                                className="ui-ml-sm"
                              >
                                {p.warnings.length}
                              </StatusBadge>
                            )}
                          </td>
                          <td className="ui-text-right num ui-text-strong">
                            {vnd(p.tong_tien)}
                          </td>
                          <td>
                            <StatusBadge tone="neutral" size="sm">
                              {SOURCE_LABEL[p.source] ?? p.source}
                            </StatusBadge>
                          </td>
                          <td>
                            <StatusBadge tone={meta.tone} size="sm" dot>
                              {meta.label}
                            </StatusBadge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            }
            mobileCards={
              <div className="ui-mobile-card-list">
                {shown.map((p) => {
                  const meta = STATUS_META[p.status] ?? {
                    tone: "neutral" as StatusBadgeTone,
                    label: p.status,
                  };
                  return (
                    <MobileCard key={p.id}>
                      <MobileCardHeader
                        title={
                          <label
                            className="ui-check-label ui-flex-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={sel.has(p.id)}
                              onChange={() => toggleSel(p.id)}
                              aria-label={`Chọn hóa đơn #${p.id}`}
                            />
                            <span>
                              #{p.id} · {p.so_hd || "Chưa có số"}
                            </span>
                          </label>
                        }
                        subtitle={p.ten_ban || "Chưa rõ nhà cung cấp"}
                        badge={
                          <StatusBadge tone={meta.tone} size="sm" dot>
                            {meta.label}
                          </StatusBadge>
                        }
                      />
                      <MobileCardGrid>
                        <MobileCardRow label="Ngày HĐ" value={p.ngay || "Thiếu ngày"} mono />
                        <MobileCardRow label="Tổng tiền" value={`${vnd(p.tong_tien)} đ`} mono />
                      </MobileCardGrid>
                      <div className="ui-row">
                        <StatusBadge tone="neutral" size="sm">
                          {SOURCE_LABEL[p.source] ?? p.source}
                        </StatusBadge>
                        {p.loai === "dich_vu" && (
                          <StatusBadge tone="info" size="sm">
                            Dịch vụ
                          </StatusBadge>
                        )}
                        {p.dup_of && (
                          <StatusBadge tone="danger" size="sm">
                            trùng #{p.dup_of}
                          </StatusBadge>
                        )}
                        {p.warnings.length > 0 && (
                          <StatusBadge tone="warning" size="sm" icon="alert-triangle">
                            {p.warnings.length} cảnh báo
                          </StatusBadge>
                        )}
                      </div>
                      <MobileCardActions>
                        <AppButton
                          variant="secondary"
                          size="sm"
                          leftIcon="eye"
                          onClick={(e) => {
                            e.stopPropagation();
                            void open(p.id);
                          }}
                        >
                          Mở chi tiết
                        </AppButton>
                        {p.doc_url ? (
                          <StatusBadge tone="success" size="sm" icon="paperclip">
                            Có PDF
                          </StatusBadge>
                        ) : (
                          <label
                            className="ui-btn ui-btn--secondary ui-btn--sm ui-clickable"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <AppIcon name="plus" size={14} />
                            <span>Bù PDF</span>
                            <input
                              type="file"
                              accept="application/pdf,.pdf"
                              hidden
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) void onAttachPdf(p.id, f);
                              }}
                            />
                          </label>
                        )}
                      </MobileCardActions>
                    </MobileCard>
                  );
                })}
              </div>
            }
          />
        )}
      </div>

      {/* Modal Chi tiết hóa đơn mua */}
      <AppModal
        open={!!cur}
        onClose={closeCur}
        size="full"
        title={
          cur ? (
            <span className="ui-inline ui-inline--md ui-inline--wrap">
              <span>Hóa đơn mua #{cur.id}</span>
              <StatusBadge
                tone={(STATUS_META[cur.status] ?? { tone: "neutral" as StatusBadgeTone }).tone}
                size="sm"
                dot
              >
                {(STATUS_META[cur.status] ?? { label: cur.status }).label}
              </StatusBadge>
              <StatusBadge tone="neutral" size="sm">
                {SOURCE_LABEL[cur.source] ?? cur.source}
              </StatusBadge>
              <StatusBadge
                tone={isDichVu ? "info" : "success"}
                size="sm"
                icon={isDichVu ? "receipt" : "package"}
              >
                {isDichVu ? "Dịch vụ / chi phí" : "Hàng hóa (nhập kho)"}
              </StatusBadge>
            </span>
          ) : (
            "Chi tiết hóa đơn mua"
          )
        }
        footer={
          cur ? (
            <>
              {cur.status === "draft" && (
                <>
                  <AppButton
                    variant="danger"
                    size="sm"
                    leftIcon="trash"
                    onClick={deleteCurrentDraft}
                  >
                    Xóa nháp
                  </AppButton>
                  <AppButton
                    variant="secondary"
                    size="sm"
                    leftIcon="calculator"
                    title="Sửa lỗi parse PDF: đặt lại Thành tiền = Số lượng × Đơn giá cho MỌI dòng"
                    onClick={() => {
                      setCur({
                        ...cur,
                        lines: cur.lines.map((ln) => ({
                          ...ln,
                          thanh_tien: Math.round(ln.so_luong * ln.don_gia),
                        })),
                      });
                      toast.info("Đã tính lại Thành tiền = SL × Đơn giá.");
                    }}
                  >
                    Tính lại thành tiền
                  </AppButton>
                  <AppButton
                    variant="secondary"
                    size="sm"
                    leftIcon="refresh"
                    title="Lưu dòng rồi tính lại TỔNG hóa đơn = Σ thành tiền + Σ thuế"
                    onClick={async () => {
                      if (!cur) return;
                      setErr("");
                      try {
                        await saveDraft(true);
                        setCur(await api.invPurchaseRecalcTotals(cur.id));
                        toast.success("Đã tính lại tổng hóa đơn.");
                        load();
                      } catch (e) {
                        setErr((e as Error).message);
                      }
                    }}
                  >
                    Tính lại tổng
                  </AppButton>
                  <AppButton
                    variant="secondary"
                    leftIcon="save"
                    onClick={() => void saveDraft(false)}
                  >
                    Lưu nháp
                  </AppButton>
                  <AppButton
                    variant="primary"
                    leftIcon="check-circle"
                    disabled={unmatched > 0 || !cur.ngay}
                    title={
                      unmatched > 0
                        ? `Còn ${unmatched} dòng chưa khớp mặt hàng`
                        : !cur.ngay
                          ? "Thiếu ngày hóa đơn"
                          : ""
                    }
                    onClick={postCur}
                  >
                    {isDichVu
                      ? "Ghi sổ (dịch vụ, không nhập kho)"
                      : `Ghi sổ (${cur.lines.length} dòng)`}
                  </AppButton>
                </>
              )}
              {cur.status === "posted" && (
                <AppButton
                  variant="danger"
                  size="sm"
                  leftIcon="rotate-ccw"
                  loading={busy}
                  onClick={voidCurrentPurchase}
                >
                  Hủy ghi sổ
                </AppButton>
              )}
              <AppButton variant="secondary" onClick={closeCur}>
                Đóng
              </AppButton>
            </>
          ) : undefined
        }
      >
        {cur && (
          <div className="ui-stack">
            {err && <InlineAlert tone="danger">{err}</InlineAlert>}

            <div className="ui-row">
              {cur.status === "draft" && (
                <AppButton
                  variant="secondary"
                  size="sm"
                  leftIcon="refresh"
                  onClick={toggleLoai}
                >
                  Đổi thành {isDichVu ? "hàng hóa" : "dịch vụ"}
                </AppButton>
              )}
              {safeHttpUrl(cur.doc_url) && (
                <a
                  className="ui-btn ui-btn--secondary ui-btn--sm"
                  href={safeHttpUrl(cur.doc_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <AppIcon name="file-text" size={14} />
                  <span>File gốc</span>
                </a>
              )}
              <label
                className={`ui-btn ui-btn--sm ui-clickable ${cur.doc_url ? "ui-btn--secondary" : "ui-btn--primary"}`}
                title="Tải file PDF gốc bù vào hóa đơn này"
              >
                <AppIcon name="paperclip" size={14} />
                <span>
                  {attachBusy
                    ? "Đang lưu…"
                    : cur.doc_url
                      ? "Úp bù / Thay PDF"
                      : "Úp bù PDF gốc"}
                </span>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  hidden
                  disabled={attachBusy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onAttachPdf(cur.id, f);
                  }}
                />
              </label>
            </div>

            {cur.status === "posted" && (
              <InlineAlert
                tone="warning"
                title="Hóa đơn đã ghi sổ"
                action={
                  <AppButton
                    variant="danger"
                    size="sm"
                    leftIcon="rotate-ccw"
                    loading={busy}
                    onClick={voidCurrentPurchase}
                  >
                    Hủy ghi sổ để sửa
                  </AppButton>
                }
              >
                Các ô đang bị khóa. Muốn sửa đơn giá/số lượng, bấm <b>Hủy ghi sổ để sửa</b> → sửa →
                Ghi sổ lại (tồn kho tự tính lại).
              </InlineAlert>
            )}

            {isDichVu && (
              <InlineAlert tone="info">
                Hóa đơn dịch vụ/chi phí: ghi sổ chỉ để lưu vết và đối chiếu bảng kê thuế,{" "}
                <b>không nhập kho</b> và không cần khớp mặt hàng.
              </InlineAlert>
            )}

            <div className="ui-review-split">
              <div className="ui-review-form">
                {cur.warnings.length > 0 && (
                  <InlineAlert tone="warning" title="Cảnh báo kiểm tra hóa đơn">
                    <ul className="ui-bullet-list">
                      {cur.warnings.map((w, i) => (
                        <li key={i}>{w.msg}</li>
                      ))}
                    </ul>
                  </InlineAlert>
                )}

                <FormGrid cols={5}>
                  <FormField label="Ngày (YYYY-MM-DD)" htmlFor={fNgayId}>
                    <input
                      id={fNgayId}
                      className="ui-input"
                      type="date"
                      value={cur.ngay}
                      disabled={cur.status !== "draft"}
                      onChange={(e) => setCur({ ...cur, ngay: e.target.value })}
                    />
                  </FormField>
                  <FormField label="Số HĐ" htmlFor={fSoHdId}>
                    <input
                      id={fSoHdId}
                      className="ui-input"
                      value={cur.so_hd}
                      disabled={cur.status !== "draft"}
                      onChange={(e) => setCur({ ...cur, so_hd: e.target.value })}
                    />
                  </FormField>
                  <FormField label="Ký hiệu" htmlFor={fKyHieuId}>
                    <input
                      id={fKyHieuId}
                      className="ui-input"
                      value={cur.ky_hieu}
                      disabled={cur.status !== "draft"}
                      onChange={(e) => setCur({ ...cur, ky_hieu: e.target.value })}
                    />
                  </FormField>
                  <FormField label="MST bên bán" htmlFor={fMstId}>
                    <input
                      id={fMstId}
                      className="ui-input"
                      value={cur.mst_ban}
                      disabled={cur.status !== "draft"}
                      onChange={(e) => setCur({ ...cur, mst_ban: e.target.value })}
                    />
                  </FormField>
                  <FormField label="Tên bên bán" htmlFor={fTenBanId}>
                    <input
                      id={fTenBanId}
                      className="ui-input"
                      value={cur.ten_ban}
                      disabled={cur.status !== "draft"}
                      onChange={(e) => setCur({ ...cur, ten_ban: e.target.value })}
                    />
                  </FormField>
                </FormGrid>

                <DataView
                  mobileMode="scroll"
                  desktop={
                    <div className="table-wrap ui-scroll-md">
                      <table className="dt">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Tên trên hóa đơn</th>
                            <th className="ui-col-narrow">ĐVT</th>
                            <th className="ui-text-right">SL</th>
                            <th className="ui-text-right">Đơn giá</th>
                            <th className="ui-text-right">Thành tiền</th>
                            <th className="ui-text-right ui-col-narrow">VAT %</th>
                            <th>Kho</th>
                            <th className="ui-col-wide">Mặt hàng tồn kho</th>
                            <th className="ui-col-chk"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {cur.lines.map((ln, idx) => (
                            <tr key={ln.id ?? idx}>
                              <td className="muted num">{ln.stt}</td>
                              <td className="ui-col-wide">
                                {cur.status === "draft" ? (
                                  <input
                                    className="ui-input"
                                    value={ln.ten_raw}
                                    onChange={(e) => setLine(idx, { ten_raw: e.target.value })}
                                  />
                                ) : (
                                  ln.ten_raw
                                )}
                                {ln.warnings.map((w, i) => (
                                  <div key={i}>
                                    <StatusBadge tone="danger" size="sm">
                                      {w.msg}
                                    </StatusBadge>
                                  </div>
                                ))}
                              </td>
                              <td className="ui-col-narrow">
                                {cur.status === "draft" ? (
                                  <input
                                    className="ui-input ui-input-xs"
                                    placeholder="Cái…"
                                    value={ln.dvt}
                                    onChange={(e) => setLine(idx, { dvt: e.target.value })}
                                  />
                                ) : (
                                  ln.dvt || (
                                    <StatusBadge tone="danger" size="sm">
                                      ?
                                    </StatusBadge>
                                  )
                                )}
                              </td>
                              <td className="ui-text-right ui-col-narrow num">
                                {cur.status === "draft" ? (
                                  <input
                                    className="ui-input ui-input-qty"
                                    value={ln.so_luong}
                                    onChange={(e) =>
                                      setLine(idx, { so_luong: vnNum(e.target.value) })
                                    }
                                  />
                                ) : (
                                  ln.so_luong
                                )}
                              </td>
                              <td className="ui-text-right ui-col-price num">
                                {cur.status === "draft" ? (
                                  <input
                                    className="ui-input ui-input-price"
                                    value={ln.don_gia}
                                    onChange={(e) =>
                                      setLine(idx, { don_gia: vnNum(e.target.value) })
                                    }
                                  />
                                ) : (
                                  vnd(ln.don_gia)
                                )}
                              </td>
                              <td className="ui-text-right num">
                                <div>{vnd(ln.so_luong * ln.don_gia)}</div>
                                {ln.thanh_tien > 0 &&
                                  Math.abs(ln.so_luong * ln.don_gia - ln.thanh_tien) > 1 && (
                                    <StatusBadge
                                      tone="danger"
                                      size="sm"
                                      title="SL×ĐG khác thành tiền trên hóa đơn — sửa lại SL hoặc đơn giá"
                                    >
                                      HĐ ghi {vnd(ln.thanh_tien)}
                                    </StatusBadge>
                                  )}
                              </td>
                              <td className="ui-text-right ui-col-narrow num">
                                {cur.status === "draft" ? (
                                  <input
                                    className="ui-input ui-input-xs ui-text-right"
                                    value={ln.thue_suat}
                                    onChange={(e) =>
                                      setLine(idx, { thue_suat: vnNum(e.target.value) })
                                    }
                                  />
                                ) : (
                                  `${ln.thue_suat}%`
                                )}
                              </td>
                              <td>
                                <select
                                  className="ui-select"
                                  aria-label="Kho nhập"
                                  value={ln.warehouse_id ?? ""}
                                  disabled={cur.status !== "draft"}
                                  onChange={(e) =>
                                    setLine(idx, { warehouse_id: Number(e.target.value) || null })
                                  }
                                >
                                  <option value="">—</option>
                                  {whs.map((w) => (
                                    <option key={w.id} value={w.id}>
                                      {w.code}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="ui-col-wide">
                                {ln.item_id ? (
                                  <span className="ui-row">
                                    <StatusBadge
                                      tone={ln.match_kind === "exact" ? "success" : "info"}
                                      size="sm"
                                      icon={
                                        ln.match_kind === "learned"
                                          ? "sparkles"
                                          : ln.match_kind === "fuzzy"
                                            ? "search"
                                            : "check"
                                      }
                                    >
                                      {ln.match_kind === "exact"
                                        ? "khớp"
                                        : ln.match_kind === "fuzzy"
                                          ? "gợi ý"
                                          : ln.match_kind === "learned"
                                            ? "đã học"
                                            : "đã chọn"}
                                    </StatusBadge>
                                    <span className="ui-text-strong">
                                      {ln.item_ma_hang || `#${ln.item_id}`}
                                    </span>
                                    {cur.status === "draft" && (
                                      <AppButton
                                        variant="ghost"
                                        size="sm"
                                        iconOnly
                                        leftIcon="x"
                                        aria-label="Bỏ khớp mặt hàng"
                                        onClick={() =>
                                          setLine(idx, {
                                            item_id: null,
                                            item_ma_hang: "",
                                            match_kind: "none",
                                          })
                                        }
                                      />
                                    )}
                                  </span>
                                ) : cur.status === "draft" ? (
                                  <div className="ui-stack--sm">
                                    <input
                                      className="ui-input"
                                      placeholder="Tìm mã/tên…"
                                      value={itemQuery?.line === idx ? itemQuery.q : ""}
                                      onChange={(e) => void searchItems(idx, e.target.value)}
                                    />
                                    {itemQuery?.line === idx && itemQuery.results.length > 0 && (
                                      <div className="ui-stack--xs ui-mt-1">
                                        {itemQuery.results.slice(0, 5).map((it) => (
                                          <AppButton
                                            key={it.id}
                                            variant="ghost"
                                            size="sm"
                                            className="ui-wrap-btn"
                                            onClick={() => {
                                              setLine(idx, {
                                                item_id: it.id,
                                                item_ma_hang: it.ma_hang,
                                                item_ten: it.ten,
                                                match_kind: "manual",
                                              });
                                              setItemQuery(null);
                                            }}
                                          >
                                            {it.ma_hang} · {it.ten.slice(0, 45)}
                                          </AppButton>
                                        ))}
                                      </div>
                                    )}
                                    {ln.suggestions.length > 0 && (
                                      <div className="ui-stack--xs ui-mt-1">
                                        <span className="ui-muted">Gợi ý khớp:</span>
                                        {ln.suggestions.map((s) => (
                                          <AppButton
                                            key={s.item_id}
                                            variant="ghost"
                                            size="sm"
                                            className="ui-wrap-btn"
                                            title={s.reason || ""}
                                            onClick={() =>
                                              setLine(idx, {
                                                item_id: s.item_id,
                                                item_ma_hang: s.ma_hang,
                                                item_ten: s.ten,
                                                match_kind: "manual",
                                              })
                                            }
                                          >
                                            {s.reason && (
                                              <StatusBadge
                                                tone={
                                                  (s.score ?? 0) >= 0.99
                                                    ? "success"
                                                    : (s.score ?? 0) >= 0.7
                                                      ? "warning"
                                                      : "neutral"
                                                }
                                                size="sm"
                                              >
                                                {s.reason}
                                              </StatusBadge>
                                            )}
                                            <b>{s.ma_hang}</b> · {s.ten}
                                          </AppButton>
                                        ))}
                                      </div>
                                    )}
                                    <AppButton
                                      variant="secondary"
                                      size="sm"
                                      leftIcon="plus"
                                      onClick={() => void createItemFromLine(idx)}
                                    >
                                      Tạo mã mới
                                    </AppButton>
                                  </div>
                                ) : (
                                  <StatusBadge tone="danger" size="sm">
                                    chưa khớp
                                  </StatusBadge>
                                )}
                              </td>
                              <td>
                                {cur.status === "draft" && (
                                  <AppButton
                                    variant="ghost"
                                    size="sm"
                                    iconOnly
                                    leftIcon="x"
                                    title="Bỏ dòng này (vd phí vận chuyển — không nhập kho)"
                                    aria-label={`Bỏ dòng ${ln.stt}`}
                                    onClick={() =>
                                      setCur({
                                        ...cur,
                                        lines: cur.lines.filter((_, i) => i !== idx),
                                      })
                                    }
                                  />
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  }
                />

                <div className="ui-totals-bar">
                  <span>
                    Cộng trước thuế: <b className="num">{vnd(cur.tong_truoc_thue)} đ</b>
                  </span>
                  <span>
                    Tiền thuế: <b className="num">{vnd(cur.tong_thue)} đ</b>
                  </span>
                  <span className="ui-totals-grand">
                    Tổng thanh toán: <span className="num">{vnd(cur.tong_tien)} đ</span>
                  </span>
                </div>
              </div>

              <div className="ui-review-file">
                <div className="purchase-file-toolbar">
                  {cur.source === "tax_gdt" && (
                    <AppButton
                      variant={!viewPdfMode ? "primary" : "ghost"}
                      size="sm"
                      leftIcon="eye"
                      onClick={() => setViewPdfMode(false)}
                    >
                      Xem HTML
                    </AppButton>
                  )}
                  {cur.doc_url && (
                    <AppButton
                      variant={viewPdfMode ? "primary" : "ghost"}
                      size="sm"
                      leftIcon="file-text"
                      onClick={() => setViewPdfMode(true)}
                    >
                      Xem PDF gốc
                    </AppButton>
                  )}
                  <a
                    className="ui-btn ui-btn--secondary ui-btn--sm"
                    href={`/api/inv/purchase/${cur.id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <AppIcon name="download" size={14} />
                    <span>Tải PDF</span>
                  </a>
                  <label
                    className="ui-btn ui-btn--secondary ui-btn--sm ui-clickable"
                    title="Nộp tệp PDF gốc cho hóa đơn này"
                  >
                    <AppIcon name="paperclip" size={14} />
                    <span>
                      {attachBusy ? "Đang nạp…" : cur.doc_url ? "Thay PDF khác" : "Úp bù PDF gốc"}
                    </span>
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      hidden
                      disabled={attachBusy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void onAttachPdf(cur.id, f);
                      }}
                    />
                  </label>
                </div>

                {/* SECURITY INVARIANT: HTML iframe MUST keep sandbox=""; PDF iframes stay unsandboxed */}
                {viewPdfMode && cur.doc_url ? (
                  <iframe
                    src={cur.doc_url + "#toolbar=0&navpanes=0&scrollbar=0&view=FitH"}
                    title="Hóa đơn gốc (PDF)"
                  />
                ) : cur.source === "tax_gdt" ? (
                  <iframe
                    src={`/api/inv/purchase/${cur.id}/html`}
                    title="Bản thể hiện hóa đơn (cổng thuế)"
                    sandbox=""
                  />
                ) : cur.doc_url ? (
                  <iframe
                    src={cur.doc_url + "#toolbar=0&navpanes=0&scrollbar=0&view=FitH"}
                    title="Hóa đơn gốc"
                  />
                ) : (
                  <div className="no-file">
                    <EmptyState
                      icon="file-text"
                      compact
                      title="Chưa có file PDF gốc để đối chiếu"
                      description="Tải tệp PDF hóa đơn điện tử lên để xem song song khi rà soát."
                      action={
                        <label className="ui-btn ui-btn--primary ui-btn--sm ui-clickable">
                          <AppIcon name="paperclip" size={14} />
                          <span>{attachBusy ? "Đang nạp file…" : "Tải file PDF gốc lên ngay"}</span>
                          <input
                            type="file"
                            accept="application/pdf,.pdf"
                            hidden
                            disabled={attachBusy}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) void onAttachPdf(cur.id, f);
                            }}
                          />
                        </label>
                      }
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </AppModal>

      {/* Modal Đối chiếu bảng kê thuế */}
      <AppModal
        open={!!bangKe}
        onClose={() => setBangKe(null)}
        title="Đối chiếu bảng kê thuế"
        size="lg"
        footer={
          <AppButton variant="secondary" onClick={() => setBangKe(null)}>
            Đóng
          </AppButton>
        }
      >
        {bangKe && (
          <div className="ui-stack">
            <h4 className="ui-subhead ui-mt-4">
              <StatusBadge tone="success" size="sm" icon="check">
                Khớp
              </StatusBadge>
              <span className="count">{bangKe.khop.length}</span>
            </h4>
            {bangKe.khop.length > 0 && (
              <DataView
                mobileMode="scroll"
                desktop={
                  <div className="table-wrap ui-scroll-sm">
                    <table className="dt">
                      <thead>
                        <tr>
                          <th>Số HĐ</th>
                          <th>Ngày</th>
                          <th>Bên bán</th>
                          <th className="ui-text-right">Giá trị</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bangKe.khop.map((r, i) => (
                          <tr key={i}>
                            <td className="num">{r.so_hd}</td>
                            <td className="num">{r.ngay}</td>
                            <td>{r.ten_ban}</td>
                            <td className="ui-text-right num">{vnd(r.gia_tri)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                }
              />
            )}

            <h4 className="ui-subhead ui-mt-4">
              <StatusBadge tone="warning" size="sm" icon="alert-triangle">
                Lệch tiền
              </StatusBadge>
              <span className="count">{bangKe.lech_tien.length}</span>
            </h4>
            {bangKe.lech_tien.length > 0 && (
              <DataView
                mobileMode="scroll"
                desktop={
                  <div className="table-wrap ui-scroll-sm">
                    <table className="dt">
                      <thead>
                        <tr>
                          <th>Số HĐ</th>
                          <th>Ngày</th>
                          <th>Bên bán</th>
                          <th className="ui-text-right">Bảng kê</th>
                          <th className="ui-text-right">Đã import</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bangKe.lech_tien.map((r, i) => (
                          <tr key={i}>
                            <td className="num">{r.so_hd}</td>
                            <td className="num">{r.ngay}</td>
                            <td>{r.ten_ban}</td>
                            <td className="ui-text-right num">{vnd(r.gia_tri)}</td>
                            <td className="ui-text-right num">{vnd(r.purchase_gia_tri ?? 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                }
              />
            )}

            <h4 className="ui-subhead ui-mt-4">
              <StatusBadge tone="danger" size="sm" icon="x">
                Thiếu file
              </StatusBadge>
              <span className="count">{bangKe.thieu_file.length}</span>
            </h4>
            <p className="ui-muted">
              Có trong bảng kê thuế nhưng chưa import file hóa đơn — cần xin lại file từ nhà cung
              cấp.
            </p>
            {bangKe.thieu_file.length > 0 && (
              <DataView
                mobileMode="scroll"
                desktop={
                  <div className="table-wrap ui-scroll-sm">
                    <table className="dt">
                      <thead>
                        <tr>
                          <th>Số HĐ</th>
                          <th>Ngày</th>
                          <th>Bên bán</th>
                          <th className="ui-text-right">Giá trị</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bangKe.thieu_file.map((r, i) => (
                          <tr key={i}>
                            <td className="num">{r.so_hd}</td>
                            <td className="num">{r.ngay}</td>
                            <td>{r.ten_ban}</td>
                            <td className="ui-text-right num">{vnd(r.gia_tri)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                }
              />
            )}

            <h4 className="ui-subhead ui-mt-4">
              <StatusBadge tone="neutral" size="sm" icon="help-circle">
                Ngoài bảng kê
              </StatusBadge>
              <span className="count">{bangKe.ngoai_bang_ke.length}</span>
            </h4>
            {bangKe.ngoai_bang_ke.length > 0 && (
              <DataView
                mobileMode="scroll"
                desktop={
                  <div className="table-wrap ui-scroll-sm">
                    <table className="dt">
                      <thead>
                        <tr>
                          <th>Số HĐ</th>
                          <th>Ngày</th>
                          <th>Bên bán</th>
                          <th className="ui-text-right">Giá trị</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bangKe.ngoai_bang_ke.map((r, i) => (
                          <tr key={i}>
                            <td className="num">{r.so_hd}</td>
                            <td className="num">{r.ngay}</td>
                            <td>{r.ten_ban}</td>
                            <td className="ui-text-right num">{vnd(r.gia_tri)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                }
              />
            )}
          </div>
        )}
      </AppModal>

      <PromptDialog
        open={!!createItemPrompt}
        title="Tạo mã hàng mới"
        label={createItemPrompt ? `Mã hàng mới cho: ${createItemPrompt.label}` : "Mã hàng mới"}
        defaultValue={createItemPrompt?.suggested || ""}
        onConfirm={confirmCreateItem}
        onCancel={() => setCreateItemPrompt(null)}
      />

      <EmailSyncModal
        isOpen={emailSyncOpen}
        onClose={() => setEmailSyncOpen(false)}
        onSyncSuccess={load}
      />
    </PageShell>
  );
}
