import { useEffect, useState } from "react";
import { api, type Customer, type DocRecord } from "../api";
import { quickCreateCustomer } from "../util";

export function Documents({ onVerify }: { onVerify: (docPk: number) => void }) {
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filter, setFilter] = useState<"all" | "unassigned">("all");
  const [err, setErr] = useState("");

  async function load() {
    setErr("");
    try {
      const [d, c] = await Promise.all([
        api.listDocuments(filter === "unassigned" ? { unassigned: true } : {}),
        api.listCustomers(),
      ]);
      setDocs(d);
      setCustomers(c);
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, [filter]);

  async function assign(docPk: number, value: string) {
    if (value === "__new__") {
      const created = await quickCreateCustomer();
      if (created) {
        await api.assignDocument(docPk, created.id);
      }
      load();
      return;
    }
    await api.assignDocument(docPk, value === "" ? null : Number(value));
    load();
  }

  return (
    <div className="page-1col">
      <div className="toolbar-row">
        <h3>Hồ sơ ({docs.length})</h3>
        <div className="filters">
          <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
            Tất cả
          </button>
          <button
            className={filter === "unassigned" ? "active" : ""}
            onClick={() => setFilter("unassigned")}
          >
            Chưa phân loại
          </button>
          <button onClick={load}>Tải lại</button>
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
                Chưa có hồ sơ nào.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
