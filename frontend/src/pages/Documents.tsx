import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, DOC_TYPES, type Customer, type DocRecord, type OrderRec } from "../api";
import { AppModal, DataView, PromptDialog } from "../components/ui";
import { copyText, quickCreateCustomer, shareDocument } from "../util";

function isHtmlDocPreview(filename: string): boolean {
  return /\.(html?|docx|xlsx?|md|markdown)$/i.test(filename || "");
}

// ── Ô "Loại" dạng badge màu, bấm để sửa ──────────────────────────────
function TypeCell({ d, onChanged }: { d: DocRecord; onChanged: () => void }) {
  const [edit, setEdit] = useState(false);
  const k = d.doc_type || "";
  if (edit)
    return (
      <select
        autoFocus
        className="cell-edit"
        value={k}
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
  return (
    <button className={"badge tb-" + (k || "khac")} onClick={() => setEdit(true)} title="Đổi loại">
      {DOC_TYPES[k]}
    </button>
  );
}

// ── Ô "Khách hàng" dạng pill, bấm để sửa ─────────────────────────────
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
  if (edit)
    return (
      <select
        autoFocus
        className="cell-edit"
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
  return d.customer_id ? (
    <button className="pill cust" onClick={() => setEdit(true)} title="Đổi khách hàng">
      {d.customer_name}
    </button>
  ) : (
    <button className="pill cust none" onClick={() => setEdit(true)}>
      + phân loại
    </button>
  );
}

// ── Ô đơn hàng: chip bấm để gán/đổi ─────────────────────────────────
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
  if (edit)
    return (
      <select
        autoFocus
        className="cell-edit"
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
  return (
    <button
      className={"chip sm " + (d.order_id ? "indigo" : "gray")}
      onClick={() => setEdit(true)}
      title="Gán đơn hàng (gom bộ hồ sơ)"
    >
      {d.order_code ? `📦 ${d.order_code}` : "📦 +"}
    </button>
  );
}

// ── Menu "⋯" cho hành động phụ (viewport-clamped trên desktop, bottom sheet trên mobile) ──
function RowMenu({ title, children }: { title?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  function toggleMenu() {
    if (open) {
      setOpen(false);
      return;
    }
    const mobile = typeof window !== "undefined" && window.innerWidth <= 820;
    setIsMobile(mobile);
    if (!mobile && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const estHeight = 280;
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
    <span className="rowmenu">
      <button
        ref={btnRef}
        type="button"
        className="kebab ui-btn-icon"
        title="Thêm thao tác"
        aria-label={title ? `Thêm thao tác cho ${title}` : "Thêm thao tác"}
        onClick={toggleMenu}
      >
        ⋯
      </button>
      {open && isMobile && (
        <AppModal
          open
          onClose={() => setOpen(false)}
          title={title || "Thao tác hồ sơ"}
          size="sm"
        >
          <div className="row-action-sheet" style={{ display: "flex", flexDirection: "column", gap: 8 }} onClick={() => setOpen(false)}>
            {children}
          </div>
        </AppModal>
      )}
      {open && !isMobile && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div
            className="menu"
            style={
              pos
                ? {
                    position: "fixed",
                    top: pos.top,
                    right: pos.right,
                    maxHeight: "min(360px, calc(100vh - 24px))",
                    overflowY: "auto",
                    zIndex: 1100,
                  }
                : undefined
            }
            onClick={() => setOpen(false)}
          >
            {children}
          </div>
        </>
      )}
    </span>
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
  const [nas, setNas] = useState<Awaited<ReturnType<typeof api.nasStatus>> | null>(null);
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

  async function confirmRename(nextName: string) {
    if (!renameTarget) return;
    const trimmed = nextName.trim();
    const target = renameTarget;
    setRenameTarget(null);
    if (!trimmed || trimmed === target.filename) return;
    try {
      await api.renameDocument(target.id, trimmed);
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
        alert("⚪ Đã tắt theo dõi lượt xem");
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
      setTrackTarget(null);
      alert("✅ Đã bật theo dõi lượt xem");
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    if (!previewDoc) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setPreviewDoc(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewDoc]);

  async function loadNas() {
    try {
      setNas(await api.nasStatus());
    } catch {
      /* bỏ qua */
    }
  }
  async function testNas() {
    setNasMsg("Đang kiểm tra…");
    try {
      const r = await api.nasTest();
      setNasMsg(r.ok ? "✅ " + r.message : "❌ " + r.message);
    } catch (e) {
      setNasMsg("❌ " + (e as Error).message);
    }
  }
  async function syncAllNas() {
    setNasMsg("Đang đồng bộ tất cả…");
    try {
      const r = await api.nasSyncAll();
      setNasMsg(`✅ Đã đồng bộ ${r.synced}, lỗi ${r.failed}`);
      loadNas();
      load();
    } catch (e) {
      setNasMsg("❌ " + (e as Error).message);
    }
  }

  const pages = Math.max(1, Math.ceil(total / perPage));
  const allChecked = docs.length > 0 && docs.every((d) => sel.has(d.id));

  function toggle(id: number) {
    const s = new Set(sel);
    s.has(id) ? s.delete(id) : s.add(id);
    setSel(s);
  }
  function toggleAll() {
    setSel(allChecked ? new Set() : new Set(docs.map((d) => d.id)));
  }

  async function shareOne(id: number) {
    try {
      const text = await shareDocument(id);
      if (text) window.alert("Đã tạo link & copy vào clipboard:\n\n" + text);
    } catch (e) {
      window.alert((e as Error).message);
    }
  }

  async function bulkShare() {
    const ids = [...sel];
    if (!ids.length) return;
    const includeAccount = window.confirm("Kèm tài khoản đăng nhập mặc định cho khách?");
    const lines: string[] = [];
    for (const id of ids) {
      const s = await api.createShare(id, 7, includeAccount);
      const exp = new Date(s.expires_at).toLocaleString("vi-VN");
      let t = `• ${s.filename}: ${s.url} (hết hạn ${exp})`;
      if (s.account) t += ` — TK: ${s.account.username}${s.account.password ? ` / MK tạm: ${s.account.password}` : " / giữ MK hiện tại"}`;
      lines.push(t);
    }
    await copyText(lines.join("\n"));
    window.alert(`Đã tạo ${ids.length} link & copy vào clipboard:\n\n` + lines.join("\n"));
  }

  async function bulkAssignTo(value: string) {
    if (value === "") return;
    const cid = value === "none" ? null : Number(value);
    await api.bulkAssign([...sel], cid);
    setSel(new Set());
    load();
  }

  async function bulkDelete() {
    if (!confirm(`Xoá ${sel.size} hồ sơ đã chọn?`)) return;
    await api.bulkDelete([...sel]);
    setSel(new Set());
    load();
  }

  async function load() {
    setErr("");
    setLoading(true);
    try {
      const opts: Parameters<typeof api.listDocuments>[0] = { search, page, perPage };
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
  }, [search]);

  // Ho so vua ky xong tu tab Ky so: neu dang o trang hien tai -> cuon toi + highlight
  // vai giay. Khong thay (VD o trang khac) thi bo qua, khong lam gi phuc tap them.
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
  }, [docs, highlightId]);

  async function assign(docPk: number, value: string) {
    if (value === "__new__") {
      const created = await quickCreateCustomer();
      if (created) await api.assignDocument(docPk, created.id);
      load();
      return;
    }
    await api.assignDocument(docPk, value === "" ? null : Number(value));
    load();
  }

  async function uploadSigned(id: number, f: File) {
    setErr("");
    setLioBusyId(id);
    try {
      const updated = await api.uploadSigned(id, f);
      setDocs((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
      if (previewDoc?.id === updated.id) setPreviewDoc(updated);
      if (updated.lio_countersigned_status === "sent") {
        const sigs = (updated.lio_countersigned_signatures || [])
          .map((s) => `• ${s.signer} (${s.serial ? s.serial.slice(0, 12) + "…" : "hợp lệ"})`)
          .join("\n");
        window.alert(
          `🤝 Đã lưu bản đã ký và tự động gửi bản đủ 2 chữ ký về LIO thành công!\n` +
            `• Phiên LIO: ${updated.lio_session_id}\n` +
            `• Mã file LIO: ${updated.lio_countersigned_file_id || "ok"}\n` +
            (sigs ? `• Chữ ký được LIO xác nhận:\n${sigs}` : "")
        );
      } else if (updated.lio_session_id && updated.lio_countersigned_status === "failed") {
        window.alert(
          `📎 Đã lưu bản đã ký vào kho, nhưng gửi tự động bản 2 chữ ký về LIO chưa thành công:\n` +
            `${updated.lio_countersigned_error || "Vui lòng kiểm tra file đã có chữ ký số thứ 2 nối tiếp sau chữ ký LIO."}`
        );
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
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleLioSign(d: DocRecord, forceNew = false) {
    if (d.filename.toLowerCase().endsWith(".docx") || d.filename.toLowerCase().endsWith(".md")) return;
    setErr("");
    setLioBusyId(d.id);
    try {
      const updated = await api.requestLioSign(d.id, forceNew);
      setDocs((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
      if (previewDoc?.id === updated.id) setPreviewDoc(updated);
      if (updated.lio_status === "signed") {
        window.alert(`✅ Hồ sơ "${updated.filename}" đã được LIO ký số hoàn tất!`);
      } else {
        window.alert(
          `📲 Đã gửi "${updated.filename}" sang LIO Signer!\n` +
            `• Mã phiên: ${updated.lio_session_id}\n` +
            `• Trạng thái: ${updated.lio_status} (chờ duyệt trên điện thoại)\n` +
            `• Nhận diện chỗ ký: ${updated.lio_placement_method || "auto"}\n\n` +
            `Hệ thống sẽ tự động kiểm tra định kỳ mỗi 15–20 giây và tải bản đã ký về ngay khi bên LIO duyệt.`
        );
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLioBusyId(null);
    }
  }

  async function handleLioPoll(d: DocRecord) {
    setErr("");
    setLioBusyId(d.id);
    try {
      const updated = await api.pollLioSign(d.id);
      setDocs((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
      if (previewDoc?.id === updated.id) setPreviewDoc(updated);
      if (updated.lio_status === "signed") {
        window.alert(`✅ Hồ sơ "${updated.filename}" đã được LIO ký số hoàn tất và lưu vào kho!`);
      }
    } catch (e) {
      setErr((e as Error).message);
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
      setDocs((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
      if (previewDoc?.id === updated.id) setPreviewDoc(updated);
      const sigs = (updated.lio_countersigned_signatures || [])
        .map((s) => `• ${s.signer} (Serial: ${s.serial || "?"} · ${s.signed_at || ""})`)
        .join("\n");
      window.alert(
        `🤝 Đã gửi bản hợp đồng đủ 2 chữ ký về LIO thành công!\n` +
          `• Hồ sơ: ${updated.filename}\n` +
          `• Phiên LIO: ${updated.lio_session_id}\n` +
          `• File ID: ${updated.lio_countersigned_file_id || "ok"}\n` +
          `• Thời điểm nhận: ${updated.lio_countersigned_at || "vừa xong"}\n` +
          (sigs ? `\nDanh sách chữ ký LIO đã đối soát hợp lệ:\n${sigs}` : "")
      );
    } catch (e) {
      setErr((e as Error).message);
      window.alert(`❌ Không gửi được bản 2 chữ ký về LIO:\n${(e as Error).message}`);
    } finally {
      setLioBusyId(null);
    }
  }

  const hasPendingLioOnPage = docs.some(
    (d) => d.lio_status === "pending" || d.lio_status === "waiting_approval" || d.lio_status === "processing"
  );
  useEffect(() => {
    if (!hasPendingLioOnPage) return;
    const timer = setInterval(async () => {
      const waiting = docs.filter(
        (d) => d.lio_status === "pending" || d.lio_status === "waiting_approval" || d.lio_status === "processing"
      );
      for (const w of waiting) {
        try {
          const updated = await api.pollLioSign(w.id);
          setDocs((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
        } catch {
          /* ignore background poll error */
        }
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [hasPendingLioOnPage, docs]);

  const unassignedOnPage = docs.filter((doc) => !doc.customer_id).length;
  const signedOnPage = docs.filter((doc) => Boolean(doc.signed_upload_name)).length;

  return (
    <div className="docs-page document-vault">
      <section className="document-vault-hero">
        <div><span>INUT · DOCUMENT CONTROL</span><h1>Kho hồ sơ vận hành.</h1><p>Phân loại, gắn khách hàng, gom theo đơn hàng và kiểm tra trạng thái lưu trữ từ một mặt bàn duy nhất.</p></div>
        <div className="document-vault-metrics" aria-label="Tóm tắt kho hồ sơ">
          <article><strong>{total} hồ sơ</strong><small>trong phạm vi hiện tại</small></article>
          <article className={unassignedOnPage ? "attention" : ""}><strong>{unassignedOnPage} chưa phân loại</strong><small>trên trang đang xem</small></article>
          <article><strong>{signedOnPage} bản ký</strong><small>đã tải lên trang này</small></article>
          <article className={nas?.pending ? "attention" : ""}><strong>{nas?.enabled ? `${nas.pending} chờ NAS` : "NAS đang tắt"}</strong><small>{nas?.enabled ? `${nas.synced}/${nas.total} đã đồng bộ` : "kiểm tra cấu hình lưu trữ"}</small></article>
        </div>
      </section>
      {/* Toolbar */}
      <div className="docs-toolbar">
        <h2>
          Bộ lọc hồ sơ <span className="count">{total}</span>
        </h2>
        <div className="tb-group">
          <input
            className="search"
            placeholder="🔍 Tìm tên file / người ký…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="tb-select"
            aria-label="Lọc theo khách hàng"
            value={typeof filter === "number" ? `c${filter}` : filter}
            onChange={(e) => {
              const v = e.target.value;
              setPage(1);
              setFilter(v === "all" || v === "unassigned" ? v : Number(v.slice(1)));
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
            className="tb-select"
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
                📦 {o.code} · {o.name} ({o.document_count})
              </option>
            ))}
          </select>
          <select
            className="tb-select"
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
          <label className={"vault-upload-btn" + (uploading ? " busy" : "")} title="Tải tệp PDF, Word (.docx) hoặc Markdown (.md) lên kho hồ sơ">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>{uploading ? "Đang tải…" : "Tải lên PDF / DOCX / MD"}</span>
            <input
              type="file"
              accept=".pdf,.docx,.md,.markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) handleVaultUpload(f);
              }}
            />
          </label>
        </div>
      </div>

      {/* NAS status */}
      {nas && (
        <div className="nas-bar">
          <span className={"chip " + (nas.enabled ? (nas.pending ? "amber" : "green") : "gray")}>
            🗄️ NAS
          </span>
          <span className="muted">
            {nas.host}/{nas.share} ·{" "}
            {nas.enabled ? (
              <>
                đồng bộ <b>{nas.synced}/{nas.total}</b>
                {nas.pending > 0 ? ` · chờ ${nas.pending}` : ""}
              </>
            ) : (
              <b>đang tắt</b>
            )}
          </span>
          <button className="btn-sm" onClick={testNas}>
            Kiểm tra
          </button>
          <button className="btn-sm" onClick={syncAllNas} disabled={!nas.enabled}>
            Đồng bộ tất cả
          </button>
          {nasMsg && <span className="muted">{nasMsg}</span>}
        </div>
      )}

      {/* Bulk bar */}
      {sel.size > 0 && (
        <div className="bulk-bar">
          <b>Đã chọn {sel.size}</b>
          <select className="tb-select" defaultValue="" onChange={(e) => bulkAssignTo(e.target.value)}>
            <option value="">Gán khách hàng…</option>
            <option value="none">— Bỏ phân loại —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button className="btn-sm" onClick={bulkShare}>
            Chia sẻ
          </button>
          <button className="btn-sm danger" onClick={bulkDelete}>
            Xoá
          </button>
          <button className="btn-sm ghost" onClick={() => setSel(new Set())}>
            Bỏ chọn
          </button>
        </div>
      )}

      {err && <div className="error">{err}</div>}

      {/* Table / Mobile Cards */}
      <DataView
        mobileMode="card"
        desktop={
          <div className="table-wrap document-vault-table-wrap">
            <table className="dt document-vault-table">
              <thead>
                <tr>
                  <th className="chk" aria-label="Chọn">
                    <input type="checkbox" aria-label="Chọn tất cả hồ sơ" checked={allChecked} onChange={toggleAll} />
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
                    style={flashId === d.id ? { background: "#fdf3de" } : undefined}
                  >
                    <td className="chk">
                      <input type="checkbox" aria-label={`Chọn ${d.filename}`} checked={sel.has(d.id)} onChange={() => toggle(d.id)} />
                    </td>
                    <td className="fname">
                      <button
                        type="button"
                        className="doc-fname-trigger ft"
                        title="Bấm để xem trước trực tiếp"
                        onClick={() => setPreviewDoc(d)}
                      >
                        {d.filename}
                      </button>
                      <button
                        type="button"
                        className="rename-btn ui-btn-icon"
                        title="Đổi tên bộ hồ sơ"
                        aria-label={`Đổi tên ${d.filename}`}
                        onClick={() => setRenameTarget(d)}
                      >
                        ✏️
                      </button>
                      <span className="chips">
                        {d.filename.toLowerCase().endsWith(".docx") && (
                          <span className="chip docx-fmt sm" title="Tài liệu Microsoft Word (.docx)">
                            DOCX
                          </span>
                        )}
                        {d.filename.toLowerCase().endsWith(".md") && (
                          <span className="chip md-fmt sm" title="Tài liệu kỹ thuật Markdown (.md)">
                            MD
                          </span>
                        )}
                        {d.nas_synced && (
                          <span className="chip green sm" title="Đã sao lưu NAS">
                            NAS ✓
                          </span>
                        )}
                        {d.signed_upload_name && (
                          <span className="chip indigo sm" title={d.signed_upload_name}>
                            📎 đã ký
                          </span>
                        )}
                        {d.lio_status === "signed" && (
                          <span
                            className="chip green sm"
                            title={`Đã ký số từ xa LIO (${d.lio_session_id || ""} · vị trí: ${d.lio_placement_method || "auto"})`}
                          >
                            ✍️ LIO đã ký
                          </span>
                        )}
                        {d.lio_countersigned_status === "sent" && (
                          <span
                            className="chip indigo sm"
                            title={`Đã gửi bản đủ 2 chữ ký về LIO (${d.lio_countersigned_file_id || ""} · lúc ${d.lio_countersigned_at || ""})`}
                          >
                            🤝 Đã gửi 2CK LIO
                          </span>
                        )}
                        {d.lio_countersigned_status === "failed" && (
                          <button
                            type="button"
                            className="chip amber sm"
                            disabled={lioBusyId === d.id}
                            onClick={() => handleLioCountersigned(d)}
                            title={`Chưa gửi được bản 2 chữ ký về LIO: ${d.lio_countersigned_error || ""} — bấm để gửi lại`}
                          >
                            ⚠️ Lỗi gửi 2CK LIO ↻
                          </button>
                        )}
                        {(d.lio_status === "pending" ||
                          d.lio_status === "waiting_approval" ||
                          d.lio_status === "processing") && (
                          <button
                            type="button"
                            className="chip amber sm"
                            disabled={lioBusyId === d.id}
                            onClick={() => handleLioPoll(d)}
                            title={`Phiên ${d.lio_session_id} đang chờ duyệt trên điện thoại (vị trí: ${d.lio_placement_method || "auto"}) — bấm để kiểm tra ngay`}
                          >
                            {lioBusyId === d.id ? "⏳ Đang hỏi LIO…" : "⏳ LIO chờ duyệt ↻"}
                          </button>
                        )}
                        {(d.lio_status === "rejected" ||
                          d.lio_status === "failed" ||
                          d.lio_status === "expired") && (
                          <button
                            type="button"
                            className="chip red sm"
                            disabled={lioBusyId === d.id}
                            onClick={() => handleLioSign(d, true)}
                            title={`Phiên LIO ${d.lio_status} (${d.lio_reason || "hết hạn/lỗi"}) — bấm để tạo phiên ký mới`}
                          >
                            ⚠️ LIO {d.lio_status} ↻
                          </button>
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
                    </td>
                    <td>
                      <TypeCell d={d} onChanged={load} />
                    </td>
                    <td className="muted col-hide-sm">{d.signer_name}</td>
                    <td className="muted col-hide-sm nowrap">
                      {new Date(d.created_at).toLocaleString("vi-VN")}
                    </td>
                    <td>
                      <CustomerCell d={d} customers={customers} onAssign={assign} />
                    </td>
                    <td className="col-act">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="ui-btn-chip"
                          onClick={() => setPreviewDoc(d)}
                          title="Xem trước trực tiếp"
                          aria-label={`Xem trước ${d.filename}`}
                        >
                          Xem
                        </button>
                        <a className="ui-btn-icon" href={d.download_url} title="Tải xuống" aria-label={`Tải xuống ${d.filename}`}>
                          ⬇
                        </a>
                        <button type="button" className="ui-btn-icon" onClick={() => shareOne(d.id)} title="Chia sẻ" aria-label={`Chia sẻ ${d.filename}`}>
                          🔗
                        </button>
                        {d.filename.toLowerCase().endsWith(".pdf") && (
                          <button type="button" className="ui-btn-icon" onClick={() => onVerify(d.id)} title="Kiểm tra chữ ký" aria-label={`Kiểm tra chữ ký ${d.filename}`}>
                            ✔
                          </button>
                        )}
                        {d.filename.toLowerCase().endsWith(".pdf") && (
                          <button
                            type="button"
                            className="ui-btn-chip"
                            disabled={lioBusyId === d.id}
                            onClick={() =>
                              d.lio_status === "pending" ||
                              d.lio_status === "waiting_approval" ||
                              d.lio_status === "processing"
                                ? handleLioPoll(d)
                                : handleLioSign(d, d.lio_status === "signed")
                            }
                            title={
                              d.lio_status === "pending" || d.lio_status === "waiting_approval"
                                ? "Kiểm tra trạng thái duyệt ký LIO ngay"
                                : "Gửi sang LIO Signer để ký số từ xa (CAS CERT)"
                            }
                            aria-label={`Ký số LIO ${d.filename}`}
                          >
                            {lioBusyId === d.id
                              ? "…"
                              : d.lio_status === "pending" || d.lio_status === "waiting_approval"
                                ? "↻ LIO"
                                : "✍️ LIO"}
                          </button>
                        )}
                        {d.filename.toLowerCase().endsWith(".pdf") && d.lio_status === "signed" && (
                          <button
                            type="button"
                            className="ui-btn-chip"
                            disabled={lioBusyId === d.id}
                            onClick={() => handleLioCountersigned(d)}
                            title="Gửi bản hợp đồng đã đủ 2 chữ ký về LIO (POST /v1/sessions/{session_id}/countersigned)"
                            aria-label={`Gửi bản 2 chữ ký về LIO cho ${d.filename}`}
                          >
                            {lioBusyId === d.id ? "…" : d.lio_countersigned_status === "sent" ? "🤝 2CK ✓" : "📤 2 bên"}
                          </button>
                        )}
                        <RowMenu title={d.filename}>
                          <button type="button" onClick={() => setRenameTarget(d)}>
                            ✏️ Đổi tên
                          </button>
                          <button type="button" onClick={() => openTrackingDialog(d)}>
                            👁 Theo dõi lượt xem
                          </button>
                          {d.filename.toLowerCase().endsWith(".pdf") && (
                            <button
                              type="button"
                              onClick={() =>
                                d.lio_status === "pending" ||
                                d.lio_status === "waiting_approval" ||
                                d.lio_status === "processing"
                                  ? handleLioPoll(d)
                                  : handleLioSign(d, Boolean(d.lio_session_id))
                              }
                            >
                              {d.lio_status === "pending" || d.lio_status === "waiting_approval"
                                ? "🔄 Kiểm tra trạng thái ký LIO"
                                : d.lio_session_id
                                  ? "✍️ Gửi lại phiên ký LIO mới"
                                  : "✍️ Gửi LIO ký số (CAS CERT)"}
                            </button>
                          )}
                          {d.filename.toLowerCase().endsWith(".pdf") && d.lio_status === "signed" && (
                            <>
                              <button type="button" onClick={() => handleLioCountersigned(d)}>
                                {d.lio_countersigned_status === "sent"
                                  ? "🤝 Gửi lại bản 2 chữ ký về LIO"
                                  : "📤 Gửi bản đủ 2 chữ ký về LIO"}
                              </button>
                              <label className="menu-file">
                                📤 Chọn PDF 2 chữ ký & gửi LIO
                                <input
                                  type="file"
                                  accept="application/pdf"
                                  hidden
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) handleLioCountersigned(d, f);
                                  }}
                                />
                              </label>
                            </>
                          )}
                          {d.filename.toLowerCase().endsWith(".pdf") && onCountersign && (
                            <button type="button" onClick={() => onCountersign(d)}>
                              🖊 Ký tiếp bằng USB Token (iNut)
                            </button>
                          )}
                          {d.signed_upload_name && (
                            <a href={api.signedFileUrl(d.id, true)} target="_blank" rel="noopener noreferrer">
                              📎 Xem bản đã ký
                            </a>
                          )}
                          <label className="menu-file">
                            {d.signed_upload_name ? "🖊 Thay bản đã ký" : "🖊 Tải bản đã ký lên"}
                            <input
                              type="file"
                              accept="application/pdf"
                              hidden
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) uploadSigned(d.id, f);
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            className="menu-danger"
                            onClick={async () => {
                              if (confirm("Xoá hồ sơ này?")) {
                                await api.deleteDocument(d.id);
                                load();
                              }
                            }}
                          >
                            🗑 Xoá hồ sơ
                          </button>
                        </RowMenu>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && docs.length === 0 && (
                  <tr>
                    <td colSpan={7}>
                      <div className="empty">
                        <div className="empty-ic">🗂️</div>
                        <div>Không có hồ sơ nào khớp.</div>
                        {(search || filter !== "all") && (
                          <button
                            className="btn-sm"
                            onClick={() => {
                              setSearch("");
                              setFilter("all");
                              setPage(1);
                            }}
                          >
                            Xoá bộ lọc
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                {loading &&
                  docs.length === 0 &&
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={"sk" + i} className="skel-row">
                      <td colSpan={7}>
                        <div className="skel" />
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
              <article
                key={d.id}
                className="ui-mobile-card"
                style={flashId === d.id ? { background: "#fdf3de" } : undefined}
              >
                <div className="ui-mobile-card-head">
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
                    <input type="checkbox" aria-label={`Chọn ${d.filename}`} checked={sel.has(d.id)} onChange={() => toggle(d.id)} />
                    <button
                      type="button"
                      className="doc-fname-trigger ui-mobile-card-title"
                      style={{ textAlign: "left" }}
                      onClick={() => setPreviewDoc(d)}
                    >
                      {d.filename}
                    </button>
                  </label>
                  <TypeCell d={d} onChanged={load} />
                </div>
                <div className="ui-mobile-card-meta">
                  <CustomerCell d={d} customers={customers} onAssign={assign} />
                  <OrderCell
                    d={d}
                    orders={orders}
                    onAssign={async (id, v) => {
                      await api.setDocumentOrder(id, v === "" ? null : Number(v));
                      load();
                    }}
                  />
                  {d.nas_synced && <span className="chip green sm">NAS ✓</span>}
                  {d.signed_upload_name && <span className="chip indigo sm">📎 đã ký</span>}
                  {d.lio_status === "signed" && <span className="chip green sm">✍️ LIO đã ký</span>}
                  <span className="muted">{new Date(d.created_at).toLocaleDateString("vi-VN")}</span>
                </div>
                <div className="ui-mobile-card-actions">
                  <button type="button" className="ui-btn-chip" onClick={() => setPreviewDoc(d)}>
                    Xem
                  </button>
                  <a className="ui-btn-icon" href={d.download_url} title="Tải xuống" aria-label={`Tải xuống ${d.filename}`}>
                    ⬇
                  </a>
                  <button type="button" className="ui-btn-icon" onClick={() => shareOne(d.id)} title="Chia sẻ" aria-label={`Chia sẻ ${d.filename}`}>
                    🔗
                  </button>
                  {d.filename.toLowerCase().endsWith(".pdf") && (
                    <button type="button" className="ui-btn-icon" onClick={() => onVerify(d.id)} title="Kiểm tra chữ ký" aria-label={`Kiểm tra chữ ký ${d.filename}`}>
                      ✔
                    </button>
                  )}
                  {d.filename.toLowerCase().endsWith(".pdf") && (
                    <button
                      type="button"
                      className="ui-btn-chip"
                      disabled={lioBusyId === d.id}
                      onClick={() =>
                        d.lio_status === "pending" ||
                        d.lio_status === "waiting_approval" ||
                        d.lio_status === "processing"
                          ? handleLioPoll(d)
                          : handleLioSign(d, d.lio_status === "signed")
                      }
                    >
                      {lioBusyId === d.id ? "…" : d.lio_status === "pending" || d.lio_status === "waiting_approval" ? "↻ LIO" : "✍️ LIO"}
                    </button>
                  )}
                  <RowMenu title={d.filename}>
                    <button type="button" onClick={() => setRenameTarget(d)}>✏️ Đổi tên</button>
                    <button type="button" onClick={() => openTrackingDialog(d)}>👁 Theo dõi lượt xem</button>
                    {d.filename.toLowerCase().endsWith(".pdf") && onCountersign && (
                      <button type="button" onClick={() => onCountersign(d)}>🖊 Ký tiếp bằng USB Token (iNut)</button>
                    )}
                    {d.signed_upload_name && (
                      <a href={api.signedFileUrl(d.id, true)} target="_blank" rel="noopener noreferrer">📎 Xem bản đã ký</a>
                    )}
                    <button
                      type="button"
                      className="menu-danger"
                      onClick={async () => {
                        if (confirm("Xoá hồ sơ này?")) {
                          await api.deleteDocument(d.id);
                          load();
                        }
                      }}
                    >
                      🗑 Xoá hồ sơ
                    </button>
                  </RowMenu>
                </div>
              </article>
            ))}
            {!loading && docs.length === 0 && (
              <div className="empty">
                <div className="empty-ic">🗂️</div>
                <div>Không có hồ sơ nào khớp.</div>
              </div>
            )}
          </div>
        }
      />

      {pages > 1 && (
        <div className="pager">
          <button className="btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ‹ Trước
          </button>
          <span className="muted">
            Trang {page}/{pages}
          </span>
          <button className="btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Sau ›
          </button>
        </div>
      )}

      {previewDoc && (
        <div
          className="doc-preview-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={`Xem trước ${previewDoc.filename}`}
          onClick={() => setPreviewDoc(null)}
        >
          <div className="doc-preview-shell" onClick={(e) => e.stopPropagation()}>
            <header className="doc-preview-head">
              <div className="doc-preview-title-group">
                <span
                  className={
                    "doc-preview-badge" +
                    (previewDoc.filename.toLowerCase().endsWith(".docx")
                      ? " is-docx"
                      : previewDoc.filename.toLowerCase().endsWith(".md")
                        ? " is-md"
                        : "")
                  }
                >
                  {previewDoc.filename.toLowerCase().endsWith(".docx")
                    ? "DOCX"
                    : previewDoc.filename.toLowerCase().endsWith(".md")
                      ? "MD"
                      : "PDF"}
                </span>
                <span className="doc-preview-title" title={previewDoc.filename}>
                  {previewDoc.filename}
                </span>
              </div>
              <div className="doc-preview-actions">
                {previewDoc.filename.toLowerCase().endsWith(".pdf") && (
                  <button
                    type="button"
                    className="doc-pv-btn"
                    disabled={lioBusyId === previewDoc.id}
                    onClick={() =>
                      previewDoc.lio_status === "pending" ||
                      previewDoc.lio_status === "waiting_approval" ||
                      previewDoc.lio_status === "processing"
                        ? handleLioPoll(previewDoc)
                        : handleLioSign(previewDoc, previewDoc.lio_status === "signed")
                    }
                  >
                    {lioBusyId === previewDoc.id
                      ? "Đang xử lý LIO…"
                      : previewDoc.lio_status === "pending" || previewDoc.lio_status === "waiting_approval"
                        ? "🔄 Kiểm tra ký LIO"
                        : "✍️ Gửi LIO ký số"}
                  </button>
                )}
                {previewDoc.filename.toLowerCase().endsWith(".pdf") &&
                  previewDoc.lio_status === "signed" && (
                    <button
                      type="button"
                      className="doc-pv-btn"
                      disabled={lioBusyId === previewDoc.id}
                      onClick={() => handleLioCountersigned(previewDoc)}
                    >
                      {lioBusyId === previewDoc.id
                        ? "Đang gửi LIO…"
                        : previewDoc.lio_countersigned_status === "sent"
                          ? "🤝 Đã gửi 2CK LIO (Gửi lại)"
                          : "📤 Gửi bản 2 chữ ký về LIO"}
                    </button>
                  )}
                <a
                  className="doc-pv-btn"
                  href={previewDoc.view_url || api.documentViewUrl(previewDoc.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Mở tab mới
                </a>
                <button
                  type="button"
                  className="doc-pv-btn"
                  onClick={() => shareOne(previewDoc.id)}
                >
                  Chia sẻ link
                </button>
                <a className="doc-pv-btn primary" href={previewDoc.download_url}>
                  Tải xuống
                </a>
                <button
                  type="button"
                  className="doc-pv-btn"
                  onClick={() => setPreviewDoc(null)}
                  aria-label="Đóng xem trước"
                >
                  Đóng
                </button>
              </div>
            </header>
            <iframe
              className="doc-preview-frame"
              src={previewDoc.view_url || api.documentViewUrl(previewDoc.id)}
              title={previewDoc.filename}
              sandbox={isHtmlDocPreview(previewDoc.filename) ? "" : undefined}
            />
          </div>
        </div>
      )}

      <PromptDialog
        open={!!renameTarget}
        title="Đổi tên bộ hồ sơ"
        label="Tên mới cho bộ hồ sơ"
        defaultValue={renameTarget?.filename || ""}
        placeholder="Nhập tên tệp mới…"
        onConfirm={confirmRename}
        onCancel={() => setRenameTarget(null)}
      />

      <AppModal
        open={!!trackTarget}
        onClose={() => setTrackTarget(null)}
        title="👁 Bật theo dõi lượt xem"
        subtitle={trackTarget?.doc.filename}
        size="sm"
        footer={
          <>
            <button type="button" className="ghost" onClick={() => setTrackTarget(null)}>Hủy</button>
            <button type="button" className="primary" onClick={saveTrackingDialog}>Lưu theo dõi</button>
          </>
        }
      >
        {trackTarget && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label>
              Ghi chú ngữ cảnh
              <input
                className="ui-input"
                value={trackTarget.note}
                placeholder="VD: Gửi ngày 28/10 · HĐ kế toán"
                onChange={(e) => setTrackTarget({ ...trackTarget, note: e.target.value })}
              />
            </label>
            <label>
              Ngày mốc (YYYY-MM-DD, để trống nếu không cần)
              <input
                className="ui-input"
                value={trackTarget.milestone}
                placeholder="YYYY-MM-DD"
                onChange={(e) => setTrackTarget({ ...trackTarget, milestone: e.target.value })}
              />
            </label>
            <label>
              Hạn báo Telegram (số ngày, 0 = vô thời hạn)
              <input
                className="ui-input"
                type="number"
                min={0}
                value={trackTarget.days}
                onChange={(e) => setTrackTarget({ ...trackTarget, days: e.target.value })}
              />
            </label>
          </div>
        )}
      </AppModal>
    </div>
  );
}
