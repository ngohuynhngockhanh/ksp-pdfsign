import { useEffect, useState, type ReactNode } from "react";
import { api, DOC_TYPES, type Customer, type DocRecord, type OrderRec } from "../api";
import { copyText, quickCreateCustomer, shareDocument } from "../util";

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

// ── Menu "⋯" cho hành động phụ ───────────────────────────────────────
function RowMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="rowmenu">
      <button className="kebab" title="Thêm" onClick={() => setOpen((o) => !o)}>
        ⋯
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu" onClick={() => setOpen(false)}>
            {children}
          </div>
        </>
      )}
    </span>
  );
}

export function Documents({ onVerify }: { onVerify: (docPk: number) => void }) {
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
      if (s.account) t += ` — TK: ${s.account.username} / MK: ${s.account.password}`;
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
    await api.uploadSigned(id, f);
    load();
  }

  return (
    <div className="docs-page">
      {/* Toolbar */}
      <div className="docs-toolbar">
        <h3>
          Hồ sơ <span className="count">{total}</span>
        </h3>
        <div className="tb-group">
          <input
            className="search"
            placeholder="🔍 Tìm tên file / người ký…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="tb-select"
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

      {/* Table */}
      <div className="table-wrap">
        <table className="dt">
          <thead>
            <tr>
              <th className="chk">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} />
              </th>
              <th>Tên file</th>
              <th>Loại</th>
              <th className="col-hide-sm">Người ký</th>
              <th className="col-hide-sm">Thời gian</th>
              <th>Khách hàng</th>
              <th className="col-act"></th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td className="chk">
                  <input type="checkbox" checked={sel.has(d.id)} onChange={() => toggle(d.id)} />
                </td>
                <td className="fname">
                  <span className="ft">{d.filename}</span>
                  <button
                    className="rename-btn"
                    title="Đổi tên bộ hồ sơ"
                    onClick={async () => {
                      const name = window.prompt("Tên mới cho bộ hồ sơ:", d.filename);
                      if (!name || name.trim() === d.filename) return;
                      try {
                        await api.renameDocument(d.id, name.trim());
                        load();
                      } catch (e) {
                        alert((e as Error).message);
                      }
                    }}
                  >
                    ✏️
                  </button>
                  <span className="chips">
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
                    <a className="iact" href={d.download_url} title="Tải xuống">
                      ⬇
                    </a>
                    <button className="iact" onClick={() => shareOne(d.id)} title="Chia sẻ">
                      🔗
                    </button>
                    <button className="iact" onClick={() => onVerify(d.id)} title="Kiểm tra chữ ký">
                      ✔
                    </button>
                    <RowMenu>
                      <button
                        onClick={async () => {
                          const name = window.prompt("Tên mới cho bộ hồ sơ:", d.filename);
                          if (!name || name.trim() === d.filename) return;
                          try {
                            await api.renameDocument(d.id, name.trim());
                            load();
                          } catch (e) {
                            alert((e as Error).message);
                          }
                        }}
                      >
                        ✏️ Đổi tên
                      </button>
                      {d.signed_upload_name && (
                        <a href={api.signedFileUrl(d.id, true)} target="_blank" rel="noreferrer">
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
    </div>
  );
}
