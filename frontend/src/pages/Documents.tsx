import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  api,
  DOC_TYPES,
  type Customer,
  type DocRecord,
  type DriveFolderSummary,
  type OrderRec,
} from "../api";
import {
  ActionBar,
  AppButton,
  AppIcon,
  AppModal,
  DataView,
  EmptyState,
  FilterBar,
  FormField,
  InlineAlert,
  KpiStrip,
  MobileCard,
  MobileCardActions,
  PageHeader,
  PageShell,
  PromptDialog,
  StatusBadge,
  TableSkeleton,
  useConfirm,
  useToast,
  type ActionBarOverflowItem,
  type KpiItem,
  type StatusBadgeTone,
} from "../components/ui";
import { copyText, defaultPassword, slugUsername } from "../util";

function isHtmlDocPreview(filename: string): boolean {
  return /\.(html?|docx|xlsx?|md|markdown)$/i.test(filename || "");
}

function getFileFormat(filename: string): "DOCX" | "MD" | "PDF" {
  const lower = (filename || "").toLowerCase();
  if (lower.endsWith(".docx")) return "DOCX";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "MD";
  return "PDF";
}

function isLioWaiting(status?: string | null): boolean {
  return (
    status === "pending" ||
    status === "waiting_approval" ||
    status === "processing"
  );
}

const DOC_TYPE_TONE: Record<string, StatusBadgeTone> = {
  hop_dong: "brand",
  bbbg: "info",
  bao_gia: "info",
  bbnt: "danger",
  de_nghi_tt: "success",
  hoa_don: "warning",
  khac: "neutral",
};

// ── Ô "Loại" bấm để sửa trực tiếp ───────────────────────────────────────
function TypeCell({ d, onChanged }: { d: DocRecord; onChanged: () => void }) {
  const [edit, setEdit] = useState(false);
  const k = d.doc_type || "khac";

  if (edit) {
    return (
      <select
        autoFocus
        className="ui-select doc-cell-edit"
        aria-label={`Chọn loại cho ${d.filename}`}
        value={d.doc_type || ""}
        onBlur={() => setEdit(false)}
        onChange={async (e) => {
          await api.setDocType(d.id, e.target.value);
          setEdit(false);
          onChanged();
        }}
      >
        {Object.entries(DOC_TYPES).map(([kk, label]) => (
          <option key={kk} value={kk}>
            {label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <AppButton
      variant="ghost"
      size="sm"
      className="doc-inline-trigger"
      onClick={() => setEdit(true)}
      title="Đổi loại hồ sơ"
    >
      <StatusBadge tone={DOC_TYPE_TONE[k] ?? "neutral"} size="sm">
        {DOC_TYPES[d.doc_type || ""] || DOC_TYPES.khac}
      </StatusBadge>
    </AppButton>
  );
}

// ── Ô "Khách hàng" bấm để sửa (ellipsis sạch, không bị cắt cứng) ────────
function CustomerCell({
  d,
  customers,
  onAssign,
}: {
  d: DocRecord;
  customers: Customer[];
  onAssign: (id: number, value: string) => void;
}) {
  const [edit, setEdit] = useState(false);

  if (edit) {
    return (
      <select
        autoFocus
        className="ui-select doc-cell-edit"
        aria-label={`Chọn khách hàng cho ${d.filename}`}
        value={d.customer_id ?? ""}
        onBlur={() => setEdit(false)}
        onChange={(e) => {
          onAssign(d.id, e.target.value);
          setEdit(false);
        }}
      >
        <option value="">— chưa phân loại —</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        <option value="__new__">+ Tạo khách hàng mới…</option>
      </select>
    );
  }

  return d.customer_id ? (
    <AppButton
      variant="ghost"
      size="sm"
      className="doc-cust-trigger"
      onClick={() => setEdit(true)}
      title={d.customer_name || "Đổi khách hàng"}
    >
      <span className="doc-cust-label">{d.customer_name}</span>
    </AppButton>
  ) : (
    <AppButton
      variant="ghost"
      size="sm"
      className="doc-cust-trigger is-unassigned"
      onClick={() => setEdit(true)}
    >
      + phân loại
    </AppButton>
  );
}

// ── Ô "Đơn hàng" bấm để gán/đổi ─────────────────────────────────────────
function OrderCell({
  d,
  orders,
  onAssign,
}: {
  d: DocRecord;
  orders: OrderRec[];
  onAssign: (id: number, value: string) => void;
}) {
  const [edit, setEdit] = useState(false);

  if (edit) {
    return (
      <select
        autoFocus
        className="ui-select doc-cell-edit"
        aria-label={`Chọn đơn hàng cho ${d.filename}`}
        value={d.order_id ?? ""}
        onBlur={() => setEdit(false)}
        onChange={(e) => {
          onAssign(d.id, e.target.value);
          setEdit(false);
        }}
      >
        <option value="">— không đơn hàng —</option>
        {orders.map((o) => (
          <option key={o.id} value={o.id}>
            {o.code} · {o.name}
          </option>
        ))}
      </select>
    );
  }

  return (
    <AppButton
      variant="ghost"
      size="sm"
      leftIcon="package"
      className={`doc-order-trigger${d.order_id ? " is-linked" : ""}`}
      onClick={() => setEdit(true)}
      title="Gán đơn hàng (gom bộ hồ sơ)"
    >
      {d.order_code || "+ Đơn"}
    </AppButton>
  );
}

// ── Menu thao tác bổ sung (viewport-clamped desktop / AppModal mobile) ──
function RowMenu({ title, children }: { title?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open || isMobile) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isMobile]);

  function toggleMenu() {
    if (open) {
      setOpen(false);
      return;
    }
    const mobile = typeof window !== "undefined" && window.innerWidth <= 820;
    setIsMobile(mobile);
    if (!mobile && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const estHeight = 320;
      const spaceBelow = window.innerHeight - rect.bottom;
      const top =
        spaceBelow < estHeight
          ? Math.max(12, rect.top - Math.min(estHeight, rect.top - 12))
          : rect.bottom + 4;
      const right = Math.max(12, window.innerWidth - rect.right);
      setPos({ top, right });
    }
    setOpen(true);
  }

  return (
    <span className="ui-popover">
      <AppButton
        ref={btnRef}
        variant="ghost"
        size="sm"
        iconOnly
        leftIcon="more-horizontal"
        title="Thêm thao tác"
        aria-label={title ? `Thêm thao tác cho ${title}` : "Thêm thao tác"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggleMenu}
      />
      {open && isMobile && (
        <AppModal
          open
          onClose={() => setOpen(false)}
          title={title || "Thao tác hồ sơ"}
          size="sm"
        >
          <div className="ui-stack--sm" onClick={() => setOpen(false)}>
            {children}
          </div>
        </AppModal>
      )}
      {open && !isMobile && (
        <>
          <div className="ui-popover-backdrop" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="ui-popover-panel"
            /* ds-dynamic */
            style={pos ? { top: pos.top, right: pos.right } : undefined}
            onClick={() => setOpen(false)}
          >
            {children}
          </div>
        </>
      )}
    </span>
  );
}

// ── Trạng thái NAS gọn + menu thao tác nhúng trong FilterBar ─────────────
function NasStatusControl({
  nas,
  nasBusy,
  nasMsg,
  onTest,
  onSyncAll,
}: {
  nas: NonNullable<Awaited<ReturnType<typeof api.nasStatus>>>;
  nasBusy: boolean;
  nasMsg: string;
  onTest: () => void;
  onSyncAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (ev: MouseEvent | TouchEvent) => {
      const target = ev.target as Node | null;
      if (wrapRef.current && target && !wrapRef.current.contains(target)) {
        setOpen(false);
      }
    };
    const handleKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside, { passive: true });
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const nasTarget = [nas.host, nas.share].filter(Boolean).join("/");
  const nasStatusText = nas.enabled
    ? nas.pending > 0
      ? `NAS ${nas.synced}/${nas.total} · chờ ${nas.pending}`
      : `NAS ${nas.synced}/${nas.total}`
    : "NAS · đang tắt";
  const nasTitle = [nasTarget, nasMsg].filter(Boolean).join(" · ") || undefined;

  return (
    <div className="doc-nas-inline">
      <StatusBadge
        tone={nas.enabled ? (nas.pending ? "warning" : "success") : "neutral"}
        size="sm"
        icon="hard-drive"
        title={nasTitle}
      >
        {nasStatusText}
      </StatusBadge>
      {nasMsg && (
        <span className="muted doc-nas-msg" title={nasMsg}>
          {nasMsg}
        </span>
      )}
      <div className="ui-overflow-wrap" ref={wrapRef}>
        <AppButton
          ref={triggerRef}
          variant="secondary"
          size="sm"
          leftIcon="more-horizontal"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => setOpen((prev) => !prev)}
        >
          NAS
        </AppButton>
        {open && (
          <div id={menuId} role="menu" className="ui-overflow-menu">
            <AppButton
              variant="ghost"
              size="sm"
              fullWidth
              role="menuitem"
              leftIcon="activity"
              className="ui-popover-item"
              disabled={nasBusy}
              onClick={() => {
                setOpen(false);
                onTest();
              }}
            >
              Kiểm tra kết nối NAS
            </AppButton>
            <AppButton
              variant="ghost"
              size="sm"
              fullWidth
              role="menuitem"
              leftIcon="refresh"
              className="ui-popover-item"
              disabled={nasBusy || !nas.enabled}
              onClick={() => {
                setOpen(false);
                onSyncAll();
              }}
            >
              Đồng bộ tất cả lên NAS
            </AppButton>
          </div>
        )}
      </div>
    </div>
  );
}

export function Documents({
  onVerify,
  highlightId,
  onConsumed,
  onCountersign,
}: {
  onVerify: (docPk: number) => void;
  highlightId?: number | null;
  onConsumed?: () => void;
  onCountersign?: (doc: DocRecord) => void;
}) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const trackNoteId = useId();
  const trackMilestoneId = useId();
  const trackDaysId = useId();
  const newCustNameId = useId();
  const newCustMstId = useId();

  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<OrderRec[]>([]);
  const [orderFilter, setOrderFilter] = useState("");
  const [filter, setFilter] = useState<"all" | "unassigned" | number>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [nas, setNas] = useState<Awaited<ReturnType<typeof api.nasStatus>> | null>(
    null,
  );
  const [nasBusy, setNasBusy] = useState(false);
  const [nasMsg, setNasMsg] = useState("");
  const [flashId, setFlashId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<DocRecord | null>(null);
  const [lioBusyId, setLioBusyId] = useState<number | null>(null);
  const [renameTarget, setRenameTarget] = useState<DocRecord | null>(null);
  const [trackTarget, setTrackTarget] = useState<{
    doc: DocRecord;
    enabled: boolean;
    note: string;
    milestone: string;
    days: string;
  } | null>(null);
  const [sharePrompt, setSharePrompt] = useState<{
    ids: number[];
    label: string;
    busy: boolean;
  } | null>(null);
  const [infoModal, setInfoModal] = useState<{
    title: string;
    subtitle?: string;
    body: string;
    copyable?: string;
  } | null>(null);
  const [newCustModal, setNewCustModal] = useState<{
    docPk: number;
    name: string;
    taxCode: string;
    busy: boolean;
  } | null>(null);
  const [drivePickerOpen, setDrivePickerOpen] = useState(false);
  const [driveFolders, setDriveFolders] = useState<DriveFolderSummary[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveSearch, setDriveSearch] = useState("");
  const [driveTargetId, setDriveTargetId] = useState<number | null>(null);
  const [driveAttaching, setDriveAttaching] = useState(false);

  const rowUploadInputRef = useRef<HTMLInputElement | null>(null);
  const rowUploadTargetRef = useRef<{
    doc: DocRecord;
    mode: "signed" | "lio-countersigned";
  } | null>(null);

  function triggerRowPdfPicker(
    doc: DocRecord,
    mode: "signed" | "lio-countersigned",
  ) {
    rowUploadTargetRef.current = { doc, mode };
    if (rowUploadInputRef.current) {
      rowUploadInputRef.current.value = "";
      rowUploadInputRef.current.click();
    }
  }

  async function confirmRename(nextName: string) {
    if (!renameTarget) return;
    const trimmed = nextName.trim();
    const target = renameTarget;
    setRenameTarget(null);
    if (!trimmed || trimmed === target.filename) return;
    try {
      await api.renameDocument(target.id, trimmed);
      toast.success(`Đã đổi tên thành "${trimmed}".`);
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function openTrackingDialog(d: DocRecord) {
    try {
      const cur = await api.getDocTracking(d.id);
      if (cur.enabled) {
        await api.setDocTracking(d.id, {
          enabled: false,
          note: cur.note,
          milestone_date: cur.milestone_date,
          expires_days: 7,
        });
        toast.info(`Đã tắt theo dõi lượt xem cho "${d.filename}".`);
        return;
      }
      setTrackTarget({
        doc: d,
        enabled: true,
        note: cur.note || "",
        milestone: cur.milestone_date || "",
        days: "7",
      });
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function saveTrackingDialog() {
    if (!trackTarget) return;
    try {
      const daysVal = parseInt(trackTarget.days, 10);
      await api.setDocTracking(trackTarget.doc.id, {
        enabled: trackTarget.enabled,
        note: trackTarget.note,
        milestone_date: trackTarget.milestone,
        expires_days: Number.isNaN(daysVal) ? 7 : daysVal,
      });
      const filename = trackTarget.doc.filename;
      setTrackTarget(null);
      toast.success(`Đã bật theo dõi lượt xem cho "${filename}".`);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function loadNas() {
    try {
      setNas(await api.nasStatus());
    } catch {
      /* ignore */
    }
  }

  async function testNas() {
    setNasBusy(true);
    setNasMsg("Đang kiểm tra kết nối NAS…");
    try {
      const r = await api.nasTest();
      setNasMsg(r.message);
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    } catch (e) {
      const msg = (e as Error).message;
      setNasMsg(msg);
      toast.error(msg);
    } finally {
      setNasBusy(false);
    }
  }

  async function syncAllNas() {
    setNasBusy(true);
    setNasMsg("Đang đồng bộ tất cả…");
    try {
      const r = await api.nasSyncAll();
      const msg = `Đã đồng bộ ${r.synced}, lỗi ${r.failed}`;
      setNasMsg(msg);
      if (r.failed > 0) toast.warning(msg);
      else toast.success(msg);
      loadNas();
      load();
    } catch (e) {
      const msg = (e as Error).message;
      setNasMsg(msg);
      toast.error(msg);
    } finally {
      setNasBusy(false);
    }
  }

  const pages = Math.max(1, Math.ceil(total / perPage));
  const allChecked = docs.length > 0 && docs.every((d) => sel.has(d.id));

  function toggle(id: number) {
    const s = new Set(sel);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setSel(s);
  }

  function toggleAll() {
    setSel(allChecked ? new Set() : new Set(docs.map((d) => d.id)));
  }

  function openSingleShare(d: DocRecord) {
    setSharePrompt({ ids: [d.id], label: d.filename, busy: false });
  }

  function openBulkShare() {
    const ids = [...sel];
    if (!ids.length) return;
    setSharePrompt({
      ids,
      label: `${ids.length} hồ sơ đã chọn`,
      busy: false,
    });
  }

  async function openBulkDrivePicker() {
    if (sel.size === 0) return;
    setDrivePickerOpen(true);
    setDriveSearch("");
    setDriveTargetId(null);
    setDriveLoading(true);
    try {
      const res = await api.driveListFolders({ all: true, archived: false });
      setDriveFolders(res.items || []);
      if (res.items && res.items.length > 0) {
        setDriveTargetId(res.items[0].id);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDriveLoading(false);
    }
  }

  async function submitBulkAttachToDrive() {
    if (!driveTargetId || sel.size === 0) return;
    setDriveAttaching(true);
    try {
      const res = await api.driveAttachDocuments(driveTargetId, [...sel]);
      const target = driveFolders.find((f) => f.id === driveTargetId);
      const skipMsg =
        res.skipped_document_ids.length > 0
          ? ` (${res.skipped_document_ids.length} hồ sơ đã có sẵn được bỏ qua)`
          : "";
      toast.success(
        `Đã gom ${res.total_attached} hồ sơ vào "${target?.name || "Drive"}"${skipMsg}.`,
      );
      setDrivePickerOpen(false);
      setSel(new Set());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDriveAttaching(false);
    }
  }

  async function executeShare(includeAccount: boolean) {
    if (!sharePrompt) return;
    const { ids, label } = sharePrompt;
    setSharePrompt({ ...sharePrompt, busy: true });
    try {
      if (ids.length === 1) {
        const s = await api.createShare(ids[0], 7, includeAccount);
        const exp = new Date(s.expires_at).toLocaleString("vi-VN");
        let text = `Tài liệu: ${s.filename}\nLink tải (hết hạn ${exp}):\n${s.url}`;
        if (s.account) {
          const origin = new URL(s.url).origin;
          text +=
            `\n\nHoặc đăng nhập để xem tất cả hồ sơ tại ${origin}` +
            `\nTài khoản: ${s.account.username}` +
            (s.account.password
              ? `\nMật khẩu tạm: ${s.account.password} (bắt buộc đổi khi đăng nhập)`
              : "\nMật khẩu: giữ nguyên mật khẩu hiện tại");
        }
        await copyText(text);
        setSharePrompt(null);
        toast.success("Đã tạo link chia sẻ và sao chép vào clipboard.");
        setInfoModal({
          title: "Đã tạo link chia sẻ",
          subtitle: s.filename,
          body: text,
          copyable: text,
        });
      } else {
        const lines: string[] = [];
        for (const id of ids) {
          const s = await api.createShare(id, 7, includeAccount);
          const exp = new Date(s.expires_at).toLocaleString("vi-VN");
          let t = `• ${s.filename}: ${s.url} (hết hạn ${exp})`;
          if (s.account) {
            t += ` — TK: ${s.account.username}${
              s.account.password
                ? ` / MK tạm: ${s.account.password}`
                : " / giữ MK hiện tại"
            }`;
          }
          lines.push(t);
        }
        const text = lines.join("\n");
        await copyText(text);
        setSharePrompt(null);
        toast.success(`Đã tạo ${ids.length} link và sao chép vào clipboard.`);
        setInfoModal({
          title: `Đã tạo ${ids.length} link chia sẻ`,
          subtitle: label,
          body: text,
          copyable: text,
        });
      }
    } catch (e) {
      setSharePrompt(null);
      toast.error((e as Error).message);
    }
  }

  async function bulkAssignTo(value: string) {
    if (value === "") return;
    const cid = value === "none" ? null : Number(value);
    try {
      await api.bulkAssign([...sel], cid);
      toast.success(`Đã cập nhật khách hàng cho ${sel.size} hồ sơ.`);
      setSel(new Set());
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function bulkDelete() {
    const ok = await confirmDialog({
      title: "Xoá hồ sơ đã chọn",
      message: `Bạn có chắc chắn muốn xoá vĩnh viễn ${sel.size} hồ sơ đã chọn không?`,
      confirmLabel: "Xoá hồ sơ",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.bulkDelete([...sel]);
      toast.success(`Đã xoá ${sel.size} hồ sơ.`);
      setSel(new Set());
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function deleteSingleDoc(d: DocRecord) {
    const ok = await confirmDialog({
      title: "Xoá hồ sơ",
      message: `Xoá hồ sơ "${d.filename}" khỏi kho? Hành động này không thể hoàn tác.`,
      confirmLabel: "Xoá hồ sơ",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.deleteDocument(d.id);
      if (previewDoc?.id === d.id) setPreviewDoc(null);
      toast.success(`Đã xoá hồ sơ "${d.filename}".`);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function load() {
    setErr("");
    setLoading(true);
    try {
      const opts: Parameters<typeof api.listDocuments>[0] = {
        search,
        page,
        perPage,
      };
      if (filter === "unassigned") opts.unassigned = true;
      else if (typeof filter === "number") opts.customerId = filter;
      if (orderFilter) opts.orderId = Number(orderFilter);
      const [d, c, o] = await Promise.all([
        api.listDocuments(opts),
        api.listCustomers(),
        api.listOrders(),
      ]);
      setDocs(d.items);
      setTotal(d.total);
      setCustomers(c);
      setOrders(o);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, orderFilter, page, perPage]);

  useEffect(() => {
    loadNas();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      load();
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    if (highlightId == null) return;
    if (!docs.some((d) => d.id === highlightId)) return;
    setFlashId(highlightId);
    document
      .getElementById(`doc-row-${highlightId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    onConsumed?.();
    const t = setTimeout(() => setFlashId(null), 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, highlightId]);

  async function assign(docPk: number, value: string) {
    if (value === "__new__") {
      setNewCustModal({ docPk, name: "", taxCode: "", busy: false });
      return;
    }
    try {
      await api.assignDocument(docPk, value === "" ? null : Number(value));
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function submitNewCustomer() {
    if (!newCustModal) return;
    const trimmedName = newCustModal.name.trim();
    if (!trimmedName) {
      toast.warning("Vui lòng nhập tên công ty / khách hàng.");
      return;
    }
    setNewCustModal({ ...newCustModal, busy: true });
    const username = slugUsername(trimmedName);
    const password = defaultPassword(newCustModal.taxCode);
    try {
      const created = await api.createCustomer({
        name: trimmedName,
        tax_code: newCustModal.taxCode.trim(),
        account_username: username,
        account_password: password,
      });
      await api.assignDocument(newCustModal.docPk, created.id);
      setNewCustModal(null);
      toast.success(`Đã tạo khách hàng "${trimmedName}" và gán vào hồ sơ.`);
      const creds =
        `Khách hàng: ${trimmedName}\n` +
        `Tài khoản đăng nhập: ${username}\n` +
        `Mật khẩu tạm: ${password}\n\n` +
        `Khách hàng cần đổi mật khẩu sau khi đăng nhập.`;
      setInfoModal({
        title: "Đã tạo khách hàng mới",
        subtitle: trimmedName,
        body: creds,
        copyable: creds,
      });
      load();
    } catch (e) {
      setNewCustModal((prev) => (prev ? { ...prev, busy: false } : null));
      toast.error((e as Error).message);
    }
  }

  async function uploadSigned(id: number, f: File) {
    setErr("");
    setLioBusyId(id);
    try {
      const updated = await api.uploadSigned(id, f);
      setDocs((prev) =>
        prev.map((it) => (it.id === updated.id ? updated : it)),
      );
      if (previewDoc?.id === updated.id) setPreviewDoc(updated);
      if (updated.lio_countersigned_status === "sent") {
        const sigs = (updated.lio_countersigned_signatures || [])
          .map(
            (s) =>
              `• ${s.signer} (${s.serial ? s.serial.slice(0, 12) + "…" : "hợp lệ"})`,
          )
          .join("\n");
        const detailBody =
          `Đã lưu bản đã ký và tự động gửi bản đủ 2 chữ ký về LIO thành công.\n` +
          `• Phiên LIO: ${updated.lio_session_id}\n` +
          `• Mã file LIO: ${updated.lio_countersigned_file_id || "ok"}\n` +
          (sigs ? `• Chữ ký được LIO xác nhận:\n${sigs}` : "");
        toast.success("Đã lưu bản ký và gửi bản đủ 2 chữ ký về LIO thành công.");
        setInfoModal({
          title: "Hoàn tất gửi bản 2 chữ ký về LIO",
          subtitle: updated.filename,
          body: detailBody,
        });
      } else if (
        updated.lio_session_id &&
        updated.lio_countersigned_status === "failed"
      ) {
        toast.warning(
          `Đã lưu bản đã ký, nhưng gửi tự động về LIO chưa thành công: ${
            updated.lio_countersigned_error ||
            "Vui lòng kiểm tra file đã có chữ ký số thứ 2 nối tiếp sau chữ ký LIO."
          }`,
        );
      } else {
        toast.success(`Đã lưu bản đã ký cho "${updated.filename}".`);
      }
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLioBusyId(null);
    }
  }

  async function handleVaultUpload(f: File) {
    setErr("");
    setUploading(true);
    try {
      const cid = typeof filter === "number" ? filter : null;
      const created = await api.uploadVaultDocument(f, { customerId: cid });
      await load();
      setPreviewDoc(created);
      toast.success(`Đã tải lên "${created.filename}".`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleLioSign(d: DocRecord, forceNew = false) {
    if (
      d.filename.toLowerCase().endsWith(".docx") ||
      d.filename.toLowerCase().endsWith(".md")
    ) {
      return;
    }
    setErr("");
    setLioBusyId(d.id);
    try {
      const updated = await api.requestLioSign(d.id, forceNew);
      setDocs((prev) =>
        prev.map((it) => (it.id === updated.id ? updated : it)),
      );
      if (previewDoc?.id === updated.id) setPreviewDoc(updated);
      if (updated.lio_status === "signed") {
        toast.success(`Hồ sơ "${updated.filename}" đã được LIO ký số hoàn tất.`);
      } else {
        toast.info(
          `Đã gửi "${updated.filename}" sang LIO Signer (phiên ${updated.lio_session_id}). Hệ thống sẽ tự kiểm tra mỗi 15–20 giây.`,
        );
      }
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg);
      toast.error(msg);
    } finally {
      setLioBusyId(null);
    }
  }

  async function handleLioPoll(d: DocRecord) {
    setErr("");
    setLioBusyId(d.id);
    try {
      const updated = await api.pollLioSign(d.id);
      setDocs((prev) =>
        prev.map((it) => (it.id === updated.id ? updated : it)),
      );
      if (previewDoc?.id === updated.id) setPreviewDoc(updated);
      if (updated.lio_status === "signed") {
        toast.success(
          `Hồ sơ "${updated.filename}" đã được LIO ký số hoàn tất và lưu vào kho.`,
        );
      } else {
        toast.info(`Trạng thái LIO hiện tại: ${updated.lio_status || "đang chờ"}.`);
      }
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg);
      toast.error(msg);
    } finally {
      setLioBusyId(null);
    }
  }

  async function handleLioCountersigned(d: DocRecord, file?: File) {
    if (!d.filename.toLowerCase().endsWith(".pdf")) return;
    setErr("");
    setLioBusyId(d.id);
    try {
      const updated = await api.sendLioCountersigned(d.id, file);
      setDocs((prev) =>
        prev.map((it) => (it.id === updated.id ? updated : it)),
      );
      if (previewDoc?.id === updated.id) setPreviewDoc(updated);
      const sigs = (updated.lio_countersigned_signatures || [])
        .map(
          (s) =>
            `• ${s.signer} (Serial: ${s.serial || "?"} · ${s.signed_at || ""})`,
        )
        .join("\n");
      const detailBody =
        `Đã gửi bản hợp đồng đủ 2 chữ ký về LIO thành công.\n` +
        `• Hồ sơ: ${updated.filename}\n` +
        `• Phiên LIO: ${updated.lio_session_id}\n` +
        `• File ID: ${updated.lio_countersigned_file_id || "ok"}\n` +
        `• Thời điểm nhận: ${updated.lio_countersigned_at || "vừa xong"}\n` +
        (sigs ? `\nDanh sách chữ ký LIO đã đối soát hợp lệ:\n${sigs}` : "");
      toast.success("Đã gửi bản hợp đồng đủ 2 chữ ký về LIO thành công.");
      setInfoModal({
        title: "Đã gửi bản 2 chữ ký về LIO",
        subtitle: updated.filename,
        body: detailBody,
      });
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg);
      toast.error(`Không gửi được bản 2 chữ ký về LIO: ${msg}`);
    } finally {
      setLioBusyId(null);
    }
  }

  const hasPendingLioOnPage = docs.some((d) => isLioWaiting(d.lio_status));
  useEffect(() => {
    if (!hasPendingLioOnPage) return;
    const timer = setInterval(async () => {
      const waiting = docs.filter((d) => isLioWaiting(d.lio_status));
      for (const w of waiting) {
        try {
          const updated = await api.pollLioSign(w.id);
          setDocs((prev) =>
            prev.map((it) => (it.id === updated.id ? updated : it)),
          );
        } catch {
          /* ignore background poll error */
        }
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [hasPendingLioOnPage, docs]);

  const unassignedOnPage = docs.filter((doc) => !doc.customer_id).length;
  const signedOnPage = docs.filter((doc) =>
    Boolean(doc.signed_upload_name),
  ).length;

  const activeFilters =
    (filter !== "all" ? 1 : 0) +
    (orderFilter ? 1 : 0) +
    (search.trim() ? 1 : 0);

  function resetFilters() {
    setSearch("");
    setFilter("all");
    setOrderFilter("");
    setPage(1);
  }

  const kpiItems: KpiItem[] = [
    {
      label: "Tổng hồ sơ",
      value: (
        <>
          <span>{total}</span> <span className="doc-kpi-unit">hồ sơ</span>
        </>
      ),
      sub: "trong phạm vi hiện tại",
      tone: "brand",
      icon: "folder-open",
    },
    {
      label: "Chưa phân loại",
      value: (
        <>
          <span>{unassignedOnPage}</span>{" "}
          <span className="doc-kpi-unit">chưa phân loại</span>
        </>
      ),
      sub: "trên trang đang xem",
      tone: unassignedOnPage > 0 ? "warning" : "success",
      icon: "tag",
    },
    {
      label: "Bản đã ký",
      value: (
        <>
          <span>{signedOnPage}</span>{" "}
          <span className="doc-kpi-unit">bản ký</span>
        </>
      ),
      sub: "đã tải lên trang này",
      tone: "info",
      icon: "file-check",
    },
    {
      label: "Lưu trữ NAS",
      value: nas?.enabled ? (
        <>
          <span>{nas.pending}</span>{" "}
          <span className="doc-kpi-unit">chờ NAS</span>
        </>
      ) : (
        "Đang tắt"
      ),
      sub: nas?.enabled
        ? `${nas.synced}/${nas.total} đã đồng bộ`
        : "kiểm tra cấu hình lưu trữ",
      tone: nas?.pending ? "warning" : nas?.enabled ? "success" : "neutral",
      icon: "hard-drive",
    },
  ];

  const bulkOverflowItems: ActionBarOverflowItem[] = [
    {
      label: "Xoá hồ sơ đã chọn",
      icon: "trash",
      danger: true,
      onClick: bulkDelete,
    },
  ];

  function renderRowMenuItems(d: DocRecord) {
    const isPdf = d.filename.toLowerCase().endsWith(".pdf");
    const waiting = isLioWaiting(d.lio_status);
    return (
      <>
        {isPdf && (
          <AppButton
            variant="ghost"
            size="sm"
            fullWidth
            leftIcon="shield-check"
            className="ui-popover-item"
            onClick={() => onVerify(d.id)}
          >
            Kiểm tra chữ ký
          </AppButton>
        )}
        <AppButton
          variant="ghost"
          size="sm"
          fullWidth
          leftIcon="edit"
          className="ui-popover-item"
          onClick={() => setRenameTarget(d)}
        >
          Đổi tên
        </AppButton>
        <AppButton
          variant="ghost"
          size="sm"
          fullWidth
          leftIcon="eye"
          className="ui-popover-item"
          onClick={() => openTrackingDialog(d)}
        >
          Theo dõi lượt xem
        </AppButton>
        {isPdf && (
          <AppButton
            variant="ghost"
            size="sm"
            fullWidth
            leftIcon={waiting ? "refresh" : "file-signature"}
            className="ui-popover-item"
            disabled={lioBusyId === d.id}
            onClick={() =>
              waiting
                ? handleLioPoll(d)
                : handleLioSign(d, Boolean(d.lio_session_id))
            }
          >
            {waiting
              ? "Kiểm tra trạng thái ký LIO"
              : d.lio_session_id
                ? "Gửi lại phiên ký LIO mới"
                : "Gửi LIO ký số (CAS CERT)"}
          </AppButton>
        )}
        {isPdf && d.lio_status === "signed" && (
          <>
            <AppButton
              variant="ghost"
              size="sm"
              fullWidth
              leftIcon="send"
              className="ui-popover-item"
              disabled={lioBusyId === d.id}
              onClick={() => handleLioCountersigned(d)}
            >
              {d.lio_countersigned_status === "sent"
                ? "Gửi lại bản 2 chữ ký về LIO"
                : "Gửi bản đủ 2 chữ ký về LIO"}
            </AppButton>
            <AppButton
              variant="ghost"
              size="sm"
              fullWidth
              leftIcon="upload"
              className="ui-popover-item"
              onClick={() => triggerRowPdfPicker(d, "lio-countersigned")}
            >
              Chọn PDF 2 chữ ký & gửi LIO
            </AppButton>
          </>
        )}
        {isPdf && onCountersign && (
          <AppButton
            variant="ghost"
            size="sm"
            fullWidth
            leftIcon="pen-tool"
            className="ui-popover-item"
            onClick={() => onCountersign(d)}
          >
            Ký tiếp bằng USB Token (iNut)
          </AppButton>
        )}
        {d.signed_upload_name && (
          <a
            className="ui-btn ui-btn--ghost ui-btn--sm ui-btn--full ui-popover-item"
            href={api.signedFileUrl(d.id, true)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <AppIcon name="paperclip" size={14} />
            <span>Xem bản đã ký</span>
          </a>
        )}
        <AppButton
          variant="ghost"
          size="sm"
          fullWidth
          leftIcon="file-up"
          className="ui-popover-item"
          onClick={() => triggerRowPdfPicker(d, "signed")}
        >
          {d.signed_upload_name ? "Thay bản đã ký" : "Tải bản đã ký lên"}
        </AppButton>
        <AppButton
          variant="ghost"
          size="sm"
          fullWidth
          leftIcon="trash"
          className="ui-popover-item is-danger"
          onClick={() => deleteSingleDoc(d)}
        >
          Xoá hồ sơ
        </AppButton>
      </>
    );
  }

  function renderDocBadges(d: DocRecord) {
    const fmt = getFileFormat(d.filename);
    return (
      <span className="ui-row ui-row--xs ui-mt-1">
        {fmt === "DOCX" && (
          <StatusBadge tone="info" size="sm" title="Tài liệu Microsoft Word (.docx)">
            DOCX
          </StatusBadge>
        )}
        {fmt === "MD" && (
          <StatusBadge tone="brand" size="sm" title="Tài liệu kỹ thuật Markdown (.md)">
            MD
          </StatusBadge>
        )}
        {d.nas_synced && (
          <StatusBadge tone="success" size="sm" icon="check" title="Đã sao lưu NAS">
            NAS
          </StatusBadge>
        )}
        {d.signed_upload_name && (
          <StatusBadge tone="brand" size="sm" icon="paperclip" title={d.signed_upload_name}>
            Đã ký
          </StatusBadge>
        )}
        {d.lio_status === "signed" && (
          <StatusBadge
            tone="success"
            size="sm"
            icon="file-signature"
            title={`Đã ký số từ xa LIO (${d.lio_session_id || ""} · vị trí: ${d.lio_placement_method || "auto"})`}
          >
            LIO đã ký
          </StatusBadge>
        )}
        {d.lio_countersigned_status === "sent" && (
          <StatusBadge
            tone="brand"
            size="sm"
            icon="check-circle"
            title={`Đã gửi bản đủ 2 chữ ký về LIO (${d.lio_countersigned_file_id || ""} · lúc ${d.lio_countersigned_at || ""})`}
          >
            Đã gửi 2CK LIO
          </StatusBadge>
        )}
        {d.lio_countersigned_status === "failed" && (
          <AppButton
            variant="ghost"
            size="sm"
            className="doc-inline-trigger"
            disabled={lioBusyId === d.id}
            onClick={() => handleLioCountersigned(d)}
            title={`Chưa gửi được bản 2 chữ ký về LIO: ${d.lio_countersigned_error || ""} — bấm để gửi lại`}
          >
            <StatusBadge tone="warning" size="sm" icon="alert-triangle">
              Lỗi gửi 2CK LIO
            </StatusBadge>
          </AppButton>
        )}
        {isLioWaiting(d.lio_status) && (
          <AppButton
            variant="ghost"
            size="sm"
            className="doc-inline-trigger"
            disabled={lioBusyId === d.id}
            onClick={() => handleLioPoll(d)}
            title={`Phiên ${d.lio_session_id} đang chờ duyệt trên điện thoại (vị trí: ${d.lio_placement_method || "auto"}) — bấm để kiểm tra ngay`}
          >
            <StatusBadge tone="warning" size="sm" icon="clock">
              {lioBusyId === d.id ? "Đang hỏi LIO…" : "LIO chờ duyệt"}
            </StatusBadge>
          </AppButton>
        )}
        {(d.lio_status === "rejected" ||
          d.lio_status === "failed" ||
          d.lio_status === "expired") && (
          <AppButton
            variant="ghost"
            size="sm"
            className="doc-inline-trigger"
            disabled={lioBusyId === d.id}
            onClick={() => handleLioSign(d, true)}
            title={`Phiên LIO ${d.lio_status} (${d.lio_reason || "hết hạn/lỗi"}) — bấm để tạo phiên ký mới`}
          >
            <StatusBadge tone="danger" size="sm" icon="alert-circle">
              LIO {d.lio_status}
            </StatusBadge>
          </AppButton>
        )}
        <OrderCell
          d={d}
          orders={orders}
          onAssign={async (id, v) => {
            await api.setDocumentOrder(id, v === "" ? null : Number(v));
            load();
          }}
        />
      </span>
    );
  }

  const emptyNode =
    !loading && docs.length === 0 ? (
      <EmptyState
        icon="folder-open"
        title="Không có hồ sơ nào khớp."
        description="Thử xóa bộ lọc hoặc tải lên tệp PDF, DOCX, Markdown mới vào kho."
        action={
          activeFilters > 0 ? (
            <AppButton
              variant="secondary"
              size="sm"
              leftIcon="rotate-ccw"
              onClick={resetFilters}
            >
              Xóa bộ lọc
            </AppButton>
          ) : undefined
        }
      />
    ) : undefined;

  return (
    <PageShell data-page="documents">
      <input
        ref={rowUploadInputRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          const target = rowUploadTargetRef.current;
          e.target.value = "";
          rowUploadTargetRef.current = null;
          if (!f || !target) return;
          if (target.mode === "lio-countersigned") {
            handleLioCountersigned(target.doc, f);
          } else {
            uploadSigned(target.doc.id, f);
          }
        }}
      />

      <PageHeader
        variant="compact"
        icon="folder-open"
        eyebrow="INUT · DOCUMENT CONTROL"
        title="Kho hồ sơ vận hành."
        subtitle="Phân loại, gắn khách hàng, gom theo đơn hàng và kiểm tra trạng thái lưu trữ."
        actions={
          <label
            className={`ui-btn ui-btn--primary ui-btn--sm ui-clickable${uploading ? " is-loading" : ""}`}
            title="Tải tệp PDF, Word (.docx) hoặc Markdown (.md) lên kho hồ sơ"
          >
            <AppIcon
              name={uploading ? "loader" : "upload"}
              size={15}
              className={uploading ? "ui-spin" : undefined}
            />
            <span>{uploading ? "Đang tải…" : "Tải lên PDF / DOCX / MD"}</span>
            <input
              type="file"
              accept=".pdf,.docx,.md,.markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown"
              hidden
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) handleVaultUpload(f);
              }}
            />
          </label>
        }
      />

      <KpiStrip items={kpiItems} columns={4} />

      <FilterBar
        collapsibleMobile
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Tìm tên file / người ký…",
          ariaLabel: "Tìm tên file hoặc người ký",
        }}
        filters={
          <>
            <select
              className="ui-select"
              aria-label="Lọc theo khách hàng"
              value={typeof filter === "number" ? `c${filter}` : filter}
              onChange={(e) => {
                const v = e.target.value;
                setPage(1);
                setFilter(
                  v === "all" || v === "unassigned" ? v : Number(v.slice(1)),
                );
              }}
            >
              <option value="all">Mọi khách hàng</option>
              <option value="unassigned">Chưa phân loại</option>
              {customers.map((c) => (
                <option key={c.id} value={`c${c.id}`}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              className="ui-select"
              aria-label="Lọc theo đơn hàng"
              value={orderFilter}
              onChange={(e) => {
                setPage(1);
                setOrderFilter(e.target.value);
              }}
            >
              <option value="">Mọi đơn hàng</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.code} · {o.name} ({o.document_count})
                </option>
              ))}
            </select>
            <select
              className="ui-select"
              aria-label="Số hồ sơ mỗi trang"
              value={perPage}
              onChange={(e) => {
                setPage(1);
                setPerPage(Number(e.target.value));
              }}
            >
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}/trang
                </option>
              ))}
            </select>
          </>
        }
        activeCount={activeFilters}
        onReset={resetFilters}
        actions={
          nas ? (
            <NasStatusControl
              nas={nas}
              nasBusy={nasBusy}
              nasMsg={nasMsg}
              onTest={testNas}
              onSyncAll={syncAllNas}
            />
          ) : undefined
        }
      />

      {sel.size > 0 && (
        <ActionBar
          selectedCount={sel.size}
          selectedLabel={`Đã chọn ${sel.size} hồ sơ`}
          onClearSelection={() => setSel(new Set())}
          secondaryActions={
            <>
              <select
                className="ui-select doc-bulk-select"
                aria-label="Gán khách hàng hàng loạt"
                defaultValue=""
                onChange={(e) => {
                  bulkAssignTo(e.target.value);
                  e.target.value = "";
                }}
              >
                <option value="">Gán khách hàng…</option>
                <option value="none">— Bỏ phân loại —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <AppButton
                variant="secondary"
                size="sm"
                leftIcon="folder-input"
                onClick={openBulkDrivePicker}
              >
                Gom vào Drive
              </AppButton>
            </>
          }
          primaryActions={
            <AppButton
              variant="primary"
              size="sm"
              leftIcon="share"
              onClick={openBulkShare}
            >
              Chia sẻ
            </AppButton>
          }
          overflowItems={bulkOverflowItems}
        />
      )}

      {err && <InlineAlert tone="danger">{err}</InlineAlert>}

      {loading && docs.length === 0 ? (
        <TableSkeleton rows={5} cols={7} />
      ) : (
        <DataView
          mobileMode="card"
          empty={emptyNode}
          desktop={
            <div className="ui-table-scroll-wrap">
              <table className="ui-table ui-w-full">
                <thead>
                  <tr>
                    <th className="ui-col-chk" aria-label="Chọn">
                      <input
                        type="checkbox"
                        aria-label="Chọn tất cả hồ sơ"
                        checked={allChecked}
                        onChange={toggleAll}
                      />
                    </th>
                    <th>Tên file</th>
                    <th>Loại</th>
                    <th className="col-hide-sm">Người ký</th>
                    <th className="col-hide-sm">Thời gian</th>
                    <th>Khách hàng</th>
                    <th className="col-act">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr
                      key={d.id}
                      id={`doc-row-${d.id}`}
                      className={flashId === d.id ? "ui-row-flash" : undefined}
                    >
                      <td className="ui-col-chk">
                        <input
                          type="checkbox"
                          aria-label={`Chọn ${d.filename}`}
                          checked={sel.has(d.id)}
                          onChange={() => toggle(d.id)}
                        />
                      </td>
                      <td className="doc-fname-cell">
                        <div className="doc-fname-row">
                          <AppButton
                            variant="ghost"
                            size="sm"
                            className="doc-fname-trigger"
                            title="Bấm để xem trước trực tiếp"
                            onClick={() => setPreviewDoc(d)}
                          >
                            {d.filename}
                          </AppButton>
                          <AppButton
                            variant="ghost"
                            size="sm"
                            iconOnly
                            leftIcon="edit"
                            className="doc-rename-icon"
                            title="Đổi tên bộ hồ sơ"
                            aria-label={`Đổi tên ${d.filename}`}
                            onClick={() => setRenameTarget(d)}
                          />
                        </div>
                        {renderDocBadges(d)}
                      </td>
                      <td>
                        <TypeCell d={d} onChanged={load} />
                      </td>
                      <td className="muted col-hide-sm doc-signer-cell">
                        <span className="ui-truncate">{d.signer_name || "—"}</span>
                      </td>
                      <td className="muted col-hide-sm nowrap">
                        {new Date(d.created_at).toLocaleString("vi-VN")}
                      </td>
                      <td className="doc-cust-cell">
                        <CustomerCell
                          d={d}
                          customers={customers}
                          onAssign={assign}
                        />
                      </td>
                      <td className="col-act">
                        <div className="ui-inline ui-row--nowrap">
                          <AppButton
                            variant="secondary"
                            size="sm"
                            leftIcon="eye"
                            onClick={() => setPreviewDoc(d)}
                            title="Xem trước trực tiếp"
                            aria-label={`Xem trước ${d.filename}`}
                          >
                            Xem
                          </AppButton>
                          <a
                            className="ui-btn ui-btn--ghost ui-btn--sm ui-btn--icon-only"
                            href={d.download_url}
                            title="Tải xuống"
                            aria-label={`Tải xuống ${d.filename}`}
                          >
                            <AppIcon name="download" size={15} />
                          </a>
                          <AppButton
                            variant="ghost"
                            size="sm"
                            iconOnly
                            leftIcon="share"
                            onClick={() => openSingleShare(d)}
                            title="Chia sẻ"
                            aria-label={`Chia sẻ ${d.filename}`}
                          />
                          <RowMenu title={d.filename}>
                            {renderRowMenuItems(d)}
                          </RowMenu>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          }
          mobileCards={
            <div className="ui-mobile-card-list">
              {docs.map((d) => (
                <MobileCard
                  key={d.id}
                  className={flashId === d.id ? "ui-row-flash" : undefined}
                >
                  <div className="ui-mc-head">
                    <label className="doc-mc-check">
                      <input
                        type="checkbox"
                        aria-label={`Chọn ${d.filename}`}
                        checked={sel.has(d.id)}
                        onChange={() => toggle(d.id)}
                      />
                      <AppButton
                        variant="ghost"
                        size="sm"
                        className="doc-fname-trigger doc-fname-trigger--card"
                        onClick={() => setPreviewDoc(d)}
                      >
                        {d.filename}
                      </AppButton>
                    </label>
                    <TypeCell d={d} onChanged={load} />
                  </div>
                  <div className="ui-row">
                    <CustomerCell
                      d={d}
                      customers={customers}
                      onAssign={assign}
                    />
                    {renderDocBadges(d)}
                    <span className="muted">
                      {new Date(d.created_at).toLocaleDateString("vi-VN")}
                    </span>
                  </div>
                  <MobileCardActions>
                    <AppButton
                      variant="secondary"
                      size="sm"
                      leftIcon="eye"
                      onClick={() => setPreviewDoc(d)}
                    >
                      Xem
                    </AppButton>
                    <a
                      className="ui-btn ui-btn--secondary ui-btn--sm"
                      href={d.download_url}
                      aria-label={`Tải xuống ${d.filename}`}
                    >
                      <AppIcon name="download" size={15} />
                      <span>Tải</span>
                    </a>
                    <AppButton
                      variant="secondary"
                      size="sm"
                      leftIcon="share"
                      onClick={() => openSingleShare(d)}
                      aria-label={`Chia sẻ ${d.filename}`}
                    >
                      Chia sẻ
                    </AppButton>
                    <RowMenu title={d.filename}>
                      {renderRowMenuItems(d)}
                    </RowMenu>
                  </MobileCardActions>
                </MobileCard>
              ))}
            </div>
          }
        />
      )}

      {pages > 1 && (
        <nav className="ui-pager" aria-label="Phân trang kho hồ sơ">
          <AppButton
            variant="secondary"
            size="sm"
            leftIcon="chevron-left"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Trước
          </AppButton>
          <span className="muted num">
            Trang {page}/{pages}
          </span>
          <AppButton
            variant="secondary"
            size="sm"
            rightIcon="chevron-right"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            Sau
          </AppButton>
        </nav>
      )}

      {/* Document Preview Modal (AppModal — preserves iframe.doc-preview-frame & sandbox contract) */}
      <AppModal
        open={Boolean(previewDoc)}
        onClose={() => setPreviewDoc(null)}
        size="full"
        className="ui-modal-preview"
        title={
          previewDoc ? (
            <span className="ui-inline ui-inline--md">
              <StatusBadge
                tone={
                  getFileFormat(previewDoc.filename) === "DOCX"
                    ? "info"
                    : "brand"
                }
                size="sm"
              >
                {getFileFormat(previewDoc.filename)}
              </StatusBadge>
              <span className="ui-truncate">{previewDoc.filename}</span>
            </span>
          ) : (
            ""
          )
        }
        subtitle={
          previewDoc
            ? [previewDoc.customer_name, previewDoc.signer_name]
                .filter(Boolean)
                .join(" · ") || undefined
            : undefined
        }
        footer={
          previewDoc ? (
            <div className="ui-modal-preview-footer">
              {previewDoc.filename.toLowerCase().endsWith(".pdf") && (
                <AppButton
                  variant="secondary"
                  size="sm"
                  leftIcon={
                    isLioWaiting(previewDoc.lio_status)
                      ? "refresh"
                      : "file-signature"
                  }
                  loading={lioBusyId === previewDoc.id}
                  onClick={() =>
                    isLioWaiting(previewDoc.lio_status)
                      ? handleLioPoll(previewDoc)
                      : handleLioSign(
                          previewDoc,
                          previewDoc.lio_status === "signed",
                        )
                  }
                >
                  {isLioWaiting(previewDoc.lio_status)
                    ? "Kiểm tra ký LIO"
                    : "Gửi LIO ký số"}
                </AppButton>
              )}
              {previewDoc.filename.toLowerCase().endsWith(".pdf") &&
                previewDoc.lio_status === "signed" && (
                  <AppButton
                    variant="secondary"
                    size="sm"
                    leftIcon="send"
                    loading={lioBusyId === previewDoc.id}
                    onClick={() => handleLioCountersigned(previewDoc)}
                  >
                    {previewDoc.lio_countersigned_status === "sent"
                      ? "Gửi lại 2CK LIO"
                      : "Gửi bản 2 chữ ký về LIO"}
                  </AppButton>
                )}
              <a
                className="ui-btn ui-btn--secondary ui-btn--sm"
                href={previewDoc.view_url || api.documentViewUrl(previewDoc.id)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <AppIcon name="external-link" size={14} />
                <span>Mở tab mới</span>
              </a>
              <AppButton
                variant="secondary"
                size="sm"
                leftIcon="share"
                onClick={() => openSingleShare(previewDoc)}
              >
                Chia sẻ link
              </AppButton>
              <a
                className="ui-btn ui-btn--primary ui-btn--sm"
                href={previewDoc.download_url}
              >
                <AppIcon name="download" size={14} />
                <span>Tải xuống</span>
              </a>
              <AppButton
                variant="ghost"
                size="sm"
                onClick={() => setPreviewDoc(null)}
              >
                Đóng
              </AppButton>
            </div>
          ) : undefined
        }
      >
        {previewDoc && (
          <iframe
            className="doc-preview-frame"
            src={previewDoc.view_url || api.documentViewUrl(previewDoc.id)}
            title={previewDoc.filename}
            sandbox={isHtmlDocPreview(previewDoc.filename) ? "" : undefined}
          />
        )}
      </AppModal>

      <PromptDialog
        open={Boolean(renameTarget)}
        title="Đổi tên bộ hồ sơ"
        label="Tên mới cho bộ hồ sơ"
        defaultValue={renameTarget?.filename || ""}
        placeholder="Nhập tên tệp mới…"
        onConfirm={confirmRename}
        onCancel={() => setRenameTarget(null)}
      />

      <AppModal
        open={Boolean(trackTarget)}
        onClose={() => setTrackTarget(null)}
        title="Bật theo dõi lượt xem"
        subtitle={trackTarget?.doc.filename}
        size="sm"
        footer={
          <>
            <AppButton
              variant="secondary"
              onClick={() => setTrackTarget(null)}
            >
              Hủy
            </AppButton>
            <AppButton variant="primary" onClick={saveTrackingDialog}>
              Lưu theo dõi
            </AppButton>
          </>
        }
      >
        {trackTarget && (
          <div className="ui-stack">
            <FormField label="Ghi chú ngữ cảnh" htmlFor={trackNoteId}>
              <input
                id={trackNoteId}
                className="ui-input"
                value={trackTarget.note}
                placeholder="VD: Gửi ngày 28/10 · HĐ kế toán"
                onChange={(e) =>
                  setTrackTarget({ ...trackTarget, note: e.target.value })
                }
              />
            </FormField>
            <FormField
              label="Ngày mốc (YYYY-MM-DD, để trống nếu không cần)"
              htmlFor={trackMilestoneId}
            >
              <input
                id={trackMilestoneId}
                className="ui-input"
                value={trackTarget.milestone}
                placeholder="YYYY-MM-DD"
                onChange={(e) =>
                  setTrackTarget({ ...trackTarget, milestone: e.target.value })
                }
              />
            </FormField>
            <FormField
              label="Hạn báo Telegram (số ngày, 0 = vô thời hạn)"
              htmlFor={trackDaysId}
            >
              <input
                id={trackDaysId}
                className="ui-input"
                type="number"
                min={0}
                value={trackTarget.days}
                onChange={(e) =>
                  setTrackTarget({ ...trackTarget, days: e.target.value })
                }
              />
            </FormField>
          </div>
        )}
      </AppModal>

      <AppModal
        open={Boolean(sharePrompt)}
        onClose={() => {
          if (!sharePrompt?.busy) setSharePrompt(null);
        }}
        dismissible={!sharePrompt?.busy}
        title="Tạo liên kết chia sẻ"
        subtitle={sharePrompt?.label}
        size="sm"
        footer={
          <>
            <AppButton
              variant="ghost"
              disabled={sharePrompt?.busy}
              onClick={() => setSharePrompt(null)}
            >
              Hủy
            </AppButton>
            <AppButton
              variant="secondary"
              leftIcon="link"
              loading={sharePrompt?.busy}
              onClick={() => executeShare(false)}
            >
              Chỉ link tải
            </AppButton>
            <AppButton
              variant="primary"
              leftIcon="user-check"
              loading={sharePrompt?.busy}
              onClick={() => executeShare(true)}
            >
              Kèm tài khoản KH
            </AppButton>
          </>
        }
      >
        <p className="ui-text-body">
          Bạn có muốn đính kèm thông tin tài khoản đăng nhập cổng khách hàng cùng
          với liên kết tải hồ sơ (hiệu lực 7 ngày) không?
        </p>
      </AppModal>

      <AppModal
        open={Boolean(newCustModal)}
        onClose={() => {
          if (!newCustModal?.busy) setNewCustModal(null);
        }}
        dismissible={!newCustModal?.busy}
        title="Tạo nhanh khách hàng mới"
        subtitle="Tự động tạo tài khoản đăng nhập cổng khách hàng và gán vào hồ sơ"
        size="sm"
        footer={
          <>
            <AppButton
              variant="secondary"
              disabled={newCustModal?.busy}
              onClick={() => setNewCustModal(null)}
            >
              Hủy
            </AppButton>
            <AppButton
              variant="primary"
              leftIcon="user-plus"
              loading={newCustModal?.busy}
              onClick={submitNewCustomer}
            >
              Tạo & gán hồ sơ
            </AppButton>
          </>
        }
      >
        {newCustModal && (
          <div className="ui-stack">
            <FormField
              label="Tên công ty / khách hàng"
              htmlFor={newCustNameId}
              required
            >
              <input
                id={newCustNameId}
                className="ui-input"
                value={newCustModal.name}
                placeholder="VD: CÔNG TY TNHH ABC"
                onChange={(e) =>
                  setNewCustModal({ ...newCustModal, name: e.target.value })
                }
              />
            </FormField>
            <FormField
              label="Mã số thuế (tùy chọn)"
              htmlFor={newCustMstId}
            >
              <input
                id={newCustMstId}
                className="ui-input"
                value={newCustModal.taxCode}
                placeholder="Để trống nếu chưa có"
                onChange={(e) =>
                  setNewCustModal({ ...newCustModal, taxCode: e.target.value })
                }
              />
            </FormField>
          </div>
        )}
      </AppModal>

      <AppModal
        open={drivePickerOpen}
        onClose={() => {
          if (!driveAttaching) setDrivePickerOpen(false);
        }}
        dismissible={!driveAttaching}
        title="Gom hồ sơ vào Drive"
        subtitle={`Đã chọn ${sel.size} hồ sơ để gắn vào thư mục dự án`}
        size="md"
        footer={
          <>
            <AppButton
              variant="secondary"
              disabled={driveAttaching}
              onClick={() => setDrivePickerOpen(false)}
            >
              Hủy
            </AppButton>
            <AppButton
              variant="primary"
              leftIcon="folder-input"
              loading={driveAttaching}
              disabled={!driveTargetId}
              onClick={submitBulkAttachToDrive}
            >
              Gắn vào thư mục đã chọn
            </AppButton>
          </>
        }
      >
        <div className="ui-stack">
          <input
            type="search"
            className="ui-input"
            value={driveSearch}
            placeholder="Tìm tên thư mục, khách hàng hoặc mã dự án…"
            aria-label="Tìm thư mục Drive"
            onChange={(e) => setDriveSearch(e.target.value)}
          />
          {driveLoading ? (
            <TableSkeleton rows={4} cols={2} />
          ) : driveFolders.length === 0 ? (
            <EmptyState
              compact
              icon="folder-open"
              title="Chưa có thư mục Drive nào."
              description="Vào mục Drive Hồ Sơ để tạo thư mục dự án trước khi gom tệp."
            />
          ) : (
            <div className="ui-stack--xs ui-scroll-md">
              {driveFolders
                .filter((f) => {
                  const q = driveSearch.trim().toLowerCase();
                  if (!q) return true;
                  return `${f.name} ${f.customer_name || ""} ${f.project_code || ""}`
                    .toLowerCase()
                    .includes(q);
                })
                .map((f) => {
                  const selected = driveTargetId === f.id;
                  return (
                    <label
                      key={f.id}
                      className={`ui-choice-card${selected ? " is-active" : ""}`}
                    >
                      <input
                        type="radio"
                        name="drive-picker-target"
                        checked={selected}
                        onChange={() => setDriveTargetId(f.id)}
                      />
                      <div className="ui-stack--xs ui-flex-1">
                        <strong className="ui-text-semibold">{f.name}</strong>
                        <div className="ui-row ui-row--xs">
                          {f.customer_name && (
                            <StatusBadge tone="brand" size="sm">
                              {f.customer_name}
                            </StatusBadge>
                          )}
                          {f.project_code && (
                            <StatusBadge tone="neutral" size="sm" className="num">
                              {f.project_code}
                            </StatusBadge>
                          )}
                          <span className="ui-muted">
                            {f.stats?.total_items ?? 0} tệp
                          </span>
                        </div>
                      </div>
                    </label>
                  );
                })}
            </div>
          )}
        </div>
      </AppModal>

      <AppModal
        open={Boolean(infoModal)}
        onClose={() => setInfoModal(null)}
        title={infoModal?.title || ""}
        subtitle={infoModal?.subtitle}
        size="sm"
        footer={
          <>
            {infoModal?.copyable && (
              <AppButton
                variant="secondary"
                leftIcon="copy"
                onClick={async () => {
                  await copyText(infoModal.copyable || "");
                  toast.success("Đã sao chép nội dung.");
                }}
              >
                Sao chép lại
              </AppButton>
            )}
            <AppButton variant="primary" onClick={() => setInfoModal(null)}>
              Đóng
            </AppButton>
          </>
        }
      >
        {infoModal && <pre className="ui-pre">{infoModal.body}</pre>}
      </AppModal>
    </PageShell>
  );
}
