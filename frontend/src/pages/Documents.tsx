import { useEffect, useState } from "react";
import { api, type Customer, type DocRecord } from "../api";
import { quickCreateCustomer } from "../util";

export function Documents({ onVerify }: { onVerify: (docPk: number) => void }) {
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filter, setFilter] = useState<"all" | "unassigned" | number>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [err, setErr] = useState("");

  const pages = Math.max(1, Math.ceil(total / perPage));

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

      <table className="doc-table">
        <thead>
          <tr>
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
                <button className="link-btn" onClick={() => onVerify(d.id)}>
                  Kiểm tra chữ ký
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
              <td colSpan={5} className="muted">
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
