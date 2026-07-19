import { useEffect, useState } from "react";
import { api, type Customer, type DocRecord } from "../api";
import { copyText, quickCreateCustomer, shareDocument } from "../util";

export function Documents({ onVerify }: { onVerify: (docPk: number) => void }) {
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filter, setFilter] = useState<"all" | "unassigned" | number>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());

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
    try {
      const opts: Parameters<typeof api.listDocuments>[0] = {
        search,
        page,
        perPage,
      };
      if (filter === "unassigned") opts.unassigned = true;
      else if (typeof filter === "number") opts.customerId = filter;
      const [d, c] = await Promise.all([api.listDocuments(opts), api.listCustomers()]);
      setDocs(d.items);
      setTotal(d.total);
      setCustomers(c);
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, [filter, page, perPage]);

  // Tìm kiếm: reset về trang 1
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

  return (
    <div className="page-1col">
      <div className="toolbar-row">
        <h3>Hồ sơ ({total})</h3>
        <div className="filters">
          <input
            className="search"
            placeholder="Tìm tên file / người ký…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            value={typeof filter === "number" ? `c${filter}` : filter}
            onChange={(e) => {
              const v = e.target.value;
              setPage(1);
              setFilter(v === "all" || v === "unassigned" ? v : Number(v.slice(1)));
            }}
          >
            <option value="all">Tất cả khách hàng</option>
            <option value="unassigned">Chưa phân loại</option>
            {customers.map((c) => (
              <option key={c.id} value={`c${c.id}`}>
                {c.name}
              </option>
            ))}
          </select>
          <select value={perPage} onChange={(e) => { setPage(1); setPerPage(Number(e.target.value)); }}>
            {[10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}/trang
              </option>
            ))}
          </select>
        </div>
      </div>
      {err && <div className="error">{err}</div>}

      {sel.size > 0 && (
        <div className="bulk-bar">
          <span>Đã chọn {sel.size}</span>
          <select defaultValue="" onChange={(e) => bulkAssignTo(e.target.value)}>
            <option value="">Gán khách hàng…</option>
            <option value="none">— Bỏ phân loại —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button onClick={bulkShare}>Chia sẻ</button>
          <button className="danger-link" onClick={bulkDelete}>
            Xoá
          </button>
          <button className="link-btn" onClick={() => setSel(new Set())}>
            Bỏ chọn
          </button>
        </div>
      )}

      <table className="doc-table">
        <thead>
          <tr>
            <th className="chk">
              <input type="checkbox" checked={allChecked} onChange={toggleAll} />
            </th>
            <th>Tên file</th>
            <th>Người ký</th>
            <th>Thời gian</th>
            <th>Khách hàng (phân loại)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id} className={d.customer_id ? "" : "unassigned-row"}>
              <td className="chk">
                <input type="checkbox" checked={sel.has(d.id)} onChange={() => toggle(d.id)} />
              </td>
              <td>{d.filename}</td>
              <td className="muted">{d.signer_name}</td>
              <td className="muted">{new Date(d.created_at).toLocaleString("vi-VN")}</td>
              <td>
                <select value={d.customer_id ?? ""} onChange={(e) => assign(d.id, e.target.value)}>
                  <option value="">— chưa phân loại —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value="__new__">+ Tạo khách hàng mới…</option>
                </select>
              </td>
              <td className="actions">
                <a href={d.download_url}>Tải</a>
                <button className="link-btn" onClick={() => shareOne(d.id)}>
                  Chia sẻ
                </button>
                <button className="link-btn" onClick={() => onVerify(d.id)}>
                  Kiểm tra
                </button>
                <button
                  className="danger-link"
                  onClick={async () => {
                    if (confirm("Xoá hồ sơ này?")) {
                      await api.deleteDocument(d.id);
                      load();
                    }
                  }}
                >
                  Xoá
                </button>
              </td>
            </tr>
          ))}
          {docs.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                Không có hồ sơ.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {pages > 1 && (
        <div className="pager">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ‹ Trước
          </button>
          <span>
            Trang {page}/{pages}
          </span>
          <button disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Sau ›
          </button>
        </div>
      )}
    </div>
  );
}
