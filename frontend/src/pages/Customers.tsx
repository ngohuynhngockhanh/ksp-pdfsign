import { useEffect, useState } from "react";
import { api, type Customer } from "../api";
import { defaultPassword, slugUsername } from "../util";

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
  // Gop 2 cong ty
  const [selected, setSelected] = useState<number[]>([]);
  const [mergeOpen, setMergeOpen] = useState(false);

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

  function toggleSelect(id: number) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 2 ? [...prev, id] : prev
    );
  }

  const selectedCustomers = selected
    .map((id) => list.find((c) => c.id === id))
    .filter((c): c is Customer => !!c);

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
              onBlur={(e) => {
                // Tự điền tài khoản mặc định nếu còn trống
                const name = e.target.value;
                setForm((f) => ({
                  ...f,
                  account_username: f.account_username || slugUsername(name),
                  account_password: f.account_password || defaultPassword(f.tax_code),
                }));
              }}
            />
          </label>
          <label>
            Mã số thuế
            <input
              value={form.tax_code}
              onChange={(e) => setForm({ ...form, tax_code: e.target.value })}
              onBlur={(e) =>
                setForm((f) => ({
                  ...f,
                  account_password: f.account_password || defaultPassword(e.target.value),
                }))
              }
            />
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
        <div className="row-between">
          <h3>Danh sách khách hàng ({list.length})</h3>
          {selected.length === 2 && (
            <button className="primary" onClick={() => setMergeOpen(true)}>
              🔀 Gộp 2 công ty
            </button>
          )}
        </div>
        {list.map((c) => (
          <CustomerCard
            key={c.id}
            c={c}
            onChange={load}
            selected={selected.includes(c.id)}
            selectDisabled={selected.length >= 2 && !selected.includes(c.id)}
            onToggleSelect={() => toggleSelect(c.id)}
          />
        ))}
      </div>

      {mergeOpen && selectedCustomers.length === 2 && (
        <MergeModal
          a={selectedCustomers[0]}
          b={selectedCustomers[1]}
          onClose={() => setMergeOpen(false)}
          onDone={() => {
            setMergeOpen(false);
            setSelected([]);
            load();
          }}
        />
      )}
    </div>
  );
}

function CustomerCard({
  c,
  onChange,
  selected,
  selectDisabled,
  onToggleSelect,
}: {
  c: Customer;
  onChange: () => void;
  selected: boolean;
  selectDisabled: boolean;
  onToggleSelect: () => void;
}) {
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
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={selected}
            disabled={selectDisabled}
            onChange={onToggleSelect}
            title="Chọn để gộp"
          />
          <b>{c.name}</b>
        </label>
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
      {c.aliases.length > 0 && (
        <div className="muted">
          {c.aliases.map((a) => (
            <span key={a} className="chip sm gray" style={{ marginRight: 4 }}>
              aka: {a}
            </span>
          ))}
        </div>
      )}
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

function MergeModal({
  a,
  b,
  onClose,
  onDone,
}: {
  a: Customer;
  b: Customer;
  onClose: () => void;
  onDone: () => void;
}) {
  // Mac dinh giu lai cong ty tao truoc (created_at som hon)
  const aFirst = new Date(a.created_at).getTime() <= new Date(b.created_at).getTime();
  const [keepId, setKeepId] = useState<number>(aFirst ? a.id : b.id);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const keep = keepId === a.id ? a : b;
  const drop = keepId === a.id ? b : a;

  async function doMerge() {
    setErr("");
    setBusy(true);
    try {
      const res = await api.mergeCustomers(drop.id, keep.id);
      const moved = res.moved;
      window.alert(
        `Đã gộp "${drop.name}" vào "${keep.name}".\n\n` +
          `Chuyển sang "${keep.name}": ${moved.users ?? 0} tài khoản · ${moved.orders ?? 0} đơn hàng · ` +
          `${moved.documents ?? 0} hồ sơ · ${moved.sales ?? 0} HĐ bán · ${moved.issues ?? 0} phiếu xuất.`
      );
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <h3>🔀 Gộp 2 công ty</h3>
        <p className="muted">Chọn công ty muốn GIỮ LẠI. Công ty còn lại sẽ bị xoá.</p>

        {[a, b].map((c) => (
          <label key={c.id} style={{ display: "block", marginTop: 8 }}>
            <input
              type="radio"
              name="keep"
              checked={keepId === c.id}
              onChange={() => setKeepId(c.id)}
            />{" "}
            <b>{c.name}</b>{" "}
            {c.tax_code && <span className="muted">(MST: {c.tax_code})</span>}{" "}
            <span className="muted">— {c.document_count} hồ sơ</span>
          </label>
        ))}

        <div className="error" style={{ marginTop: 12 }}>
          Toàn bộ hồ sơ, tài khoản, đơn hàng, hoá đơn bán, phiếu xuất của <b>{drop.name}</b> sẽ
          chuyển sang <b>{keep.name}</b>; tên "{drop.name}" sẽ thành alias của "{keep.name}"; công
          ty "{drop.name}" sẽ bị XOÁ. Không thể hoàn tác.
        </div>
        {err && <div className="error">{err}</div>}

        <div className="modal-actions">
          <button onClick={onClose} disabled={busy}>
            Hủy
          </button>
          <button className="primary" onClick={doMerge} disabled={busy}>
            🔀 Gộp "{drop.name}" → "{keep.name}"
          </button>
        </div>
      </div>
    </div>
  );
}
