import { useEffect, useState } from "react";
import { api } from "../api";

type Row = Awaited<ReturnType<typeof api.auditLog>>["items"][number];

const ACTION_CHIP: Record<string, string> = {
  login: "green",
  login_fail: "red",
  sign: "indigo",
  bbbg_generate: "indigo",
  delete_doc: "red",
  customer_delete: "red",
  bulk_delete: "red",
  password_change: "amber",
  password_reset: "amber",
};

export function AuditLog() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [err, setErr] = useState("");
  const perPage = 50;
  const pages = Math.max(1, Math.ceil(total / perPage));

  async function load() {
    setErr("");
    try {
      const r = await api.auditLog({ search, page, perPage });
      setRows(r.items);
      setTotal(r.total);
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, [page]);
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      load();
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div className="docs-page">
      <div className="docs-toolbar">
        <h3>
          Nhật ký thao tác <span className="count">{total}</span>
        </h3>
        <div className="tb-group">
          <input
            className="search"
            placeholder="🔍 Tìm user / đối tượng…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      {err && <div className="error">{err}</div>}

      <div className="table-wrap">
        <table className="dt">
          <thead>
            <tr>
              <th className="nowrap">Thời gian</th>
              <th>Người dùng</th>
              <th>Thao tác</th>
              <th>Đối tượng</th>
              <th className="col-hide-sm">Chi tiết</th>
              <th className="col-hide-sm">IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="muted nowrap">{new Date(r.ts).toLocaleString("vi-VN")}</td>
                <td>
                  {r.username}
                  {r.role === "admin" && <span className="chip gray sm"> admin</span>}
                </td>
                <td>
                  <span className={"chip sm " + (ACTION_CHIP[r.action] || "gray")}>
                    {r.action_label}
                  </span>
                </td>
                <td className="fname">
                  <span className="ft">{r.target}</span>
                </td>
                <td className="muted col-hide-sm">{r.detail}</td>
                <td className="muted col-hide-sm nowrap">{r.ip}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <div className="empty">
                    <div className="empty-ic">📜</div>
                    <div>Chưa có nhật ký.</div>
                  </div>
                </td>
              </tr>
            )}
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
