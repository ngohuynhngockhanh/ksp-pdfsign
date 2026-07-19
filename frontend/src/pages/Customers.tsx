import { useEffect, useState } from "react";
import { api, type Customer } from "../api";

export function Customers() {
  const [list, setList] = useState<Customer[]>([]);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({
    name: "",
    tax_code: "",
    contact: "",
    note: "",
    account_username: "",
    account_password: "",
  });

  async function load() {
    try {
      setList(await api.listCustomers());
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await api.createCustomer(form);
      setForm({ name: "", tax_code: "", contact: "", note: "", account_username: "", account_password: "" });
      load();
    } catch (ex) {
      setErr((ex as Error).message);
    }
  }

  return (
    <div className="page-2col">
      <div className="panel">
        <h3>Thêm khách hàng</h3>
        <form onSubmit={create}>
          <label>
            Tên khách hàng *
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Mã số thuế
            <input value={form.tax_code} onChange={(e) => setForm({ ...form, tax_code: e.target.value })} />
          </label>
          <label>
            Liên hệ
            <input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
          </label>
          <label>
            Ghi chú
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
          <div className="sub">Tài khoản đăng nhập cho khách hàng (tuỳ chọn)</div>
          <label>
            Tên đăng nhập
            <input
              value={form.account_username}
              onChange={(e) => setForm({ ...form, account_username: e.target.value })}
            />
          </label>
          <label>
            Mật khẩu
            <input
              type="text"
              value={form.account_password}
              onChange={(e) => setForm({ ...form, account_password: e.target.value })}
            />
          </label>
          {err && <div className="error">{err}</div>}
          <button className="primary" type="submit">
            Tạo khách hàng
          </button>
        </form>
      </div>

      <div className="list-col">
        <h3>Danh sách khách hàng ({list.length})</h3>
        {list.map((c) => (
          <CustomerCard key={c.id} c={c} onChange={load} />
        ))}
      </div>
    </div>
  );
}

function CustomerCard({ c, onChange }: { c: Customer; onChange: () => void }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [msg, setMsg] = useState("");

  async function addAccount() {
    setMsg("");
    try {
      await api.createAccount(c.id, u, p);
      setMsg("Đã lưu tài khoản " + u);
      setU("");
      setP("");
      onChange();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <div className="card">
      <div className="row-between">
        <b>{c.name}</b>
        <button
          className="danger-link"
          onClick={async () => {
            if (confirm(`Xoá khách hàng "${c.name}"? Hồ sơ sẽ được bỏ gán.`)) {
              await api.deleteCustomer(c.id);
              onChange();
            }
          }}
        >
          Xoá
        </button>
      </div>
      <div className="muted">
        {c.tax_code && `MST: ${c.tax_code} · `}
        {c.contact && `${c.contact} · `}
        {c.document_count} hồ sơ
      </div>
      <div className="muted">
        Tài khoản: {c.account_usernames.length ? c.account_usernames.join(", ") : "(chưa có)"}
      </div>
      <div className="account-add">
        <input placeholder="tên đăng nhập" value={u} onChange={(e) => setU(e.target.value)} />
        <input placeholder="mật khẩu" value={p} onChange={(e) => setP(e.target.value)} />
        <button disabled={!u || !p} onClick={addAccount}>
          Cấp / đổi mật khẩu
        </button>
      </div>
      {msg && <div className="muted">{msg}</div>}
    </div>
  );
}
