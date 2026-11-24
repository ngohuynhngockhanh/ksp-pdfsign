import { useEffect, useMemo, useState } from "react";
import { api, type Customer } from "../api";
import {
  ActionBar,
  AppButton,
  AppModal,
  DataView,
  EmptyState,
  FilterBar,
  FormField,
  FormGrid,
  InlineAlert,
  MobileCard,
  MobileCardActions,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  PageHeader,
  PageShell,
  StatusBadge,
  TableSkeleton,
  useConfirm,
  useToast,
} from "../components/ui";
import { copyText, defaultPassword, slugUsername } from "../util";

export function Customers() {
  const toast = useToast();
  const askConfirm = useConfirm();

  const [list, setList] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Create customer modal
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    tax_code: "",
    contact: "",
    note: "",
    account_username: "",
    account_password: "",
  });

  // Manual account modal
  const [accountTarget, setAccountTarget] = useState<Customer | null>(null);
  const [accUser, setAccUser] = useState("");
  const [accPass, setAccPass] = useState("");
  const [accBusy, setAccBusy] = useState(false);

  // Merge 2 companies
  const [selected, setSelected] = useState<number[]>([]);
  const [mergeOpen, setMergeOpen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await api.listCustomers();
      setList(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setCreating(true);
    try {
      await api.createCustomer(form);
      setForm({
        name: "",
        tax_code: "",
        contact: "",
        note: "",
        account_username: "",
        account_password: "",
      });
      setCreateOpen(false);
      toast.success("Đã tạo khách hàng mới.");
      load();
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setCreating(false);
    }
  }

  function toggleSelect(id: number) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 2 ? [...prev, id] : prev,
    );
  }

  async function handleAutoAccount(c: Customer) {
    setErr("");
    try {
      const r = await api.createAccountAuto(c.id);
      const link = await api.createCustomerLoginLink(c.id, 7);
      const invite = `Cổng chứng từ INUT\nNhấn link để đăng nhập ngay (hiệu lực 7 ngày):\n${link.url}\n\nHoặc đăng nhập tại ${r.login_url}\nTài khoản: ${r.username}\nMật khẩu tạm: ${r.password}\nVui lòng đổi mật khẩu sau lần đăng nhập đầu tiên.`;
      await copyText(invite);
      toast.success(`Đã cấp tài khoản ${r.username} và sao chép thông tin gửi khách.`);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function openManualAccount(c: Customer) {
    setAccountTarget(c);
    setAccUser(c.account_usernames[0] || slugUsername(c.name));
    setAccPass("");
  }

  async function submitManualAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!accountTarget || !accUser.trim() || !accPass.trim()) return;
    setAccBusy(true);
    try {
      await api.createAccount(accountTarget.id, accUser.trim(), accPass.trim());
      toast.success(`Đã lưu tài khoản ${accUser.trim()} cho ${accountTarget.name}.`);
      setAccountTarget(null);
      setAccUser("");
      setAccPass("");
      load();
    } catch (ex) {
      toast.error((ex as Error).message);
    } finally {
      setAccBusy(false);
    }
  }

  async function handleDelete(c: Customer) {
    const ok = await askConfirm({
      title: "Xóa khách hàng",
      message: `Xóa khách hàng "${c.name}"? Các hồ sơ liên quan sẽ được bỏ gán.`,
      confirmLabel: "Xóa khách hàng",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.deleteCustomer(c.id);
      setSelected((prev) => prev.filter((id) => id !== c.id));
      toast.success(`Đã xóa khách hàng "${c.name}".`);
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.tax_code || "").toLowerCase().includes(q) ||
        (c.contact || "").toLowerCase().includes(q) ||
        c.account_usernames.some((u) => u.toLowerCase().includes(q)) ||
        c.aliases.some((a) => a.toLowerCase().includes(q)),
    );
  }, [list, searchQuery]);

  const selectedCustomers = selected
    .map((id) => list.find((c) => c.id === id))
    .filter((c): c is Customer => !!c);

  return (
    <PageShell data-page="customers">
      <PageHeader
        variant="compact"
        icon="users"
        title="Khách hàng"
        subtitle="Quản lý danh bạ công ty, cấp tài khoản cổng chứng từ và gộp bản ghi trùng lặp."
        actions={
          <AppButton variant="primary" leftIcon="user-plus" onClick={() => setCreateOpen(true)}>
            Thêm khách hàng
          </AppButton>
        }
      />

      {err && (
        <InlineAlert tone="danger" onDismiss={() => setErr("")}>
          {err}
        </InlineAlert>
      )}

      <FilterBar
        collapsibleMobile={false}
        search={{
          value: searchQuery,
          onChange: setSearchQuery,
          placeholder: "Tìm theo tên công ty, MST, liên hệ, tài khoản…",
          ariaLabel: "Tìm khách hàng",
        }}
        activeCount={searchQuery ? 1 : 0}
        onReset={() => setSearchQuery("")}
        actions={
          <StatusBadge tone="neutral" size="sm">
            {searchQuery ? `${filtered.length}/${list.length} khách hàng` : `${list.length} khách hàng`}
          </StatusBadge>
        }
      />

      {selected.length > 0 && (
        <ActionBar
          selectedCount={selected.length}
          selectedLabel={`Đã chọn ${selected.length}/2 công ty để gộp`}
          onClearSelection={() => setSelected([])}
          primaryActions={
            <AppButton
              variant="primary"
              size="sm"
              leftIcon="layers"
              disabled={selected.length !== 2}
              onClick={() => setMergeOpen(true)}
            >
              Gộp 2 công ty
            </AppButton>
          }
        />
      )}

      {loading && list.length === 0 ? (
        <TableSkeleton rows={6} cols={6} />
      ) : (
        <DataView
          mobileMode="card"
          empty={
            filtered.length === 0 ? (
              <EmptyState
                icon="users"
                title={searchQuery ? "Không tìm thấy khách hàng phù hợp" : "Chưa có khách hàng nào"}
                description={
                  searchQuery
                    ? "Thử thay đổi từ khóa hoặc xóa bộ lọc tìm kiếm."
                    : 'Bấm "Thêm khách hàng" để khởi tạo danh bạ đầu tiên.'
                }
                action={
                  searchQuery ? (
                    <AppButton variant="secondary" size="sm" leftIcon="rotate-ccw" onClick={() => setSearchQuery("")}>
                      Xóa tìm kiếm
                    </AppButton>
                  ) : (
                    <AppButton variant="primary" size="sm" leftIcon="user-plus" onClick={() => setCreateOpen(true)}>
                      Thêm khách hàng
                    </AppButton>
                  )
                }
              />
            ) : undefined
          }
          desktop={
            <div className="ui-table-scroll-wrap" tabIndex={0}>
              <table className="ui-table">
                <thead>
                  <tr>
                    <th className="ui-col-chk"></th>
                    <th>Khách hàng</th>
                    <th>MST / Liên hệ</th>
                    <th className="num">Hồ sơ</th>
                    <th>Tài khoản cổng</th>
                    <th className="col-act">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => {
                    const isChecked = selected.includes(c.id);
                    const selectDisabled = selected.length >= 2 && !isChecked;
                    return (
                      <tr key={c.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={selectDisabled}
                            onChange={() => toggleSelect(c.id)}
                            aria-label={`Chọn ${c.name} để gộp`}
                            title="Chọn tối đa 2 công ty để gộp"
                          />
                        </td>
                        <td className="ui-col-wide">
                          <strong>{c.name}</strong>
                          {c.aliases.length > 0 && (
                            <div className="ui-row ui-mt-2">
                              {c.aliases.map((a) => (
                                <StatusBadge key={a} tone="neutral" size="sm">
                                  aka: {a}
                                </StatusBadge>
                              ))}
                            </div>
                          )}
                        </td>
                        <td>
                          <div>{c.tax_code ? `MST: ${c.tax_code}` : <span className="muted">Chưa có MST</span>}</div>
                          {c.contact && <div className="muted">{c.contact}</div>}
                        </td>
                        <td className="num">
                          <StatusBadge tone={c.document_count > 0 ? "brand" : "neutral"} size="sm">
                            {c.document_count}
                          </StatusBadge>
                        </td>
                        <td>
                          {c.account_usernames.length > 0 ? (
                            <div className="ui-row">
                              {c.account_usernames.map((u) => (
                                <StatusBadge key={u} tone="success" size="sm" icon="user">
                                  {u}
                                </StatusBadge>
                              ))}
                            </div>
                          ) : (
                            <span className="muted">Chưa có tài khoản</span>
                          )}
                        </td>
                        <td className="col-act">
                          <div className="ui-row-end">
                            <AppButton
                              variant="primary"
                              size="sm"
                              leftIcon="copy"
                              onClick={() => handleAutoAccount(c)}
                            >
                              {c.account_usernames.length ? "Cấp lại & sao chép" : "Tạo TK & sao chép"}
                            </AppButton>
                            <AppButton
                              variant="secondary"
                              size="sm"
                              leftIcon="key"
                              onClick={() => openManualAccount(c)}
                            >
                              Cấp / đổi MK
                            </AppButton>
                            <AppButton
                              variant="ghost"
                              size="sm"
                              iconOnly
                              leftIcon="trash"
                              aria-label={`Xóa khách hàng ${c.name}`}
                              title="Xóa khách hàng"
                              onClick={() => handleDelete(c)}
                            />
                          </div>
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
              {filtered.map((c) => {
                const isChecked = selected.includes(c.id);
                const selectDisabled = selected.length >= 2 && !isChecked;
                return (
                  <MobileCard key={c.id} active={isChecked}>
                    <MobileCardHeader
                      title={
                        <label className="ui-check-label">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={selectDisabled}
                            onChange={() => toggleSelect(c.id)}
                            aria-label={`Chọn ${c.name} để gộp`}
                          />
                          <span>{c.name}</span>
                        </label>
                      }
                      badge={
                        <StatusBadge tone={c.document_count > 0 ? "brand" : "neutral"} size="sm">
                          {c.document_count} hồ sơ
                        </StatusBadge>
                      }
                    />
                    <MobileCardGrid>
                      <MobileCardRow label="MST" value={c.tax_code || "—"} mono />
                      <MobileCardRow label="Liên hệ" value={c.contact || "—"} />
                      <MobileCardRow
                        label="Tài khoản"
                        value={c.account_usernames.length ? c.account_usernames.join(", ") : "(chưa có)"}
                        fullWidth
                      />
                    </MobileCardGrid>
                    {c.aliases.length > 0 && (
                      <div className="ui-row">
                        {c.aliases.map((a) => (
                          <StatusBadge key={a} tone="neutral" size="sm">
                            aka: {a}
                          </StatusBadge>
                        ))}
                      </div>
                    )}
                    <MobileCardActions>
                      <AppButton
                        variant="primary"
                        size="sm"
                        leftIcon="copy"
                        onClick={() => handleAutoAccount(c)}
                      >
                        {c.account_usernames.length ? "Cấp lại & sao chép" : "Tạo TK & sao chép"}
                      </AppButton>
                      <AppButton
                        variant="secondary"
                        size="sm"
                        leftIcon="key"
                        onClick={() => openManualAccount(c)}
                      >
                        Cấp / đổi MK
                      </AppButton>
                      <AppButton
                        variant="ghost"
                        size="sm"
                        iconOnly
                        leftIcon="trash"
                        aria-label={`Xóa khách hàng ${c.name}`}
                        onClick={() => handleDelete(c)}
                      />
                    </MobileCardActions>
                  </MobileCard>
                );
              })}
            </div>
          }
        />
      )}

      {/* Create Customer Modal */}
      <AppModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Thêm khách hàng"
        subtitle="Tài khoản đăng nhập cổng chứng từ là tùy chọn và sẽ tự gợi ý theo tên/MST."
        size="md"
        footer={
          <>
            <AppButton variant="secondary" onClick={() => setCreateOpen(false)} disabled={creating}>
              Hủy
            </AppButton>
            <AppButton type="submit" form="create-customer-form" variant="primary" loading={creating} leftIcon="user-plus">
              Tạo khách hàng
            </AppButton>
          </>
        }
      >
        <form id="create-customer-form" onSubmit={create} className="ui-stack">
          <FormGrid cols={2}>
            <FormField label="Tên khách hàng" htmlFor="cust-name" required fullWidth>
              <input
                id="cust-name"
                className="ui-input"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onBlur={(e) => {
                  const name = e.target.value;
                  setForm((f) => ({
                    ...f,
                    account_username: f.account_username || slugUsername(name),
                    account_password: f.account_password || defaultPassword(f.tax_code),
                  }));
                }}
              />
            </FormField>
            <FormField label="Mã số thuế" htmlFor="cust-tax">
              <input
                id="cust-tax"
                className="ui-input"
                value={form.tax_code}
                onChange={(e) => setForm({ ...form, tax_code: e.target.value })}
                onBlur={(e) =>
                  setForm((f) => ({
                    ...f,
                    account_password: f.account_password || defaultPassword(e.target.value),
                  }))
                }
              />
            </FormField>
            <FormField label="Liên hệ" htmlFor="cust-contact">
              <input
                id="cust-contact"
                className="ui-input"
                value={form.contact}
                onChange={(e) => setForm({ ...form, contact: e.target.value })}
              />
            </FormField>
            <FormField label="Ghi chú" htmlFor="cust-note" fullWidth>
              <input
                id="cust-note"
                className="ui-input"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </FormField>
            <FormField label="Tên đăng nhập (tùy chọn)" htmlFor="cust-user">
              <input
                id="cust-user"
                className="ui-input"
                value={form.account_username}
                onChange={(e) => setForm({ ...form, account_username: e.target.value })}
              />
            </FormField>
            <FormField label="Mật khẩu (tùy chọn)" htmlFor="cust-pass">
              <input
                id="cust-pass"
                className="ui-input"
                type="text"
                value={form.account_password}
                onChange={(e) => setForm({ ...form, account_password: e.target.value })}
              />
            </FormField>
          </FormGrid>
        </form>
      </AppModal>

      {/* Manual Account Modal */}
      <AppModal
        open={!!accountTarget}
        onClose={() => setAccountTarget(null)}
        title="Cấp / đổi mật khẩu cổng khách hàng"
        subtitle={accountTarget ? accountTarget.name : undefined}
        size="sm"
        footer={
          <>
            <AppButton variant="secondary" onClick={() => setAccountTarget(null)} disabled={accBusy}>
              Hủy
            </AppButton>
            <AppButton
              type="submit"
              form="manual-account-form"
              variant="primary"
              loading={accBusy}
              disabled={!accUser.trim() || !accPass.trim()}
              leftIcon="key"
            >
              Lưu tài khoản
            </AppButton>
          </>
        }
      >
        <form id="manual-account-form" onSubmit={submitManualAccount} className="ui-stack">
          <FormField label="Tên đăng nhập" htmlFor="acc-username" required>
            <input
              id="acc-username"
              className="ui-input"
              required
              placeholder="tên đăng nhập"
              value={accUser}
              onChange={(e) => setAccUser(e.target.value)}
            />
          </FormField>
          <FormField label="Mật khẩu mới" htmlFor="acc-password" required>
            <input
              id="acc-password"
              className="ui-input"
              required
              placeholder="mật khẩu"
              value={accPass}
              onChange={(e) => setAccPass(e.target.value)}
            />
          </FormField>
        </form>
      </AppModal>

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
    </PageShell>
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
  const toast = useToast();
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
      toast.success(
        `Đã gộp "${drop.name}" vào "${keep.name}" (${moved.users ?? 0} TK · ${moved.orders ?? 0} đơn · ${moved.documents ?? 0} hồ sơ · ${moved.sales ?? 0} HĐ bán · ${moved.issues ?? 0} phiếu xuất).`,
        6500,
      );
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppModal
      open
      onClose={onClose}
      title="Gộp 2 công ty"
      subtitle="Chọn công ty muốn GIỮ LẠI. Công ty còn lại sẽ bị xóa và chuyển thành alias."
      size="md"
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose} disabled={busy}>
            Hủy
          </AppButton>
          <AppButton variant="danger" leftIcon="layers" onClick={doMerge} loading={busy}>
            Gộp &ldquo;{drop.name}&rdquo; vào &ldquo;{keep.name}&rdquo;
          </AppButton>
        </>
      }
    >
      <div className="ui-stack--sm">
        {[a, b].map((c) => (
          <label key={c.id} className="ui-choice-card">
            <input type="radio" name="keep" checked={keepId === c.id} onChange={() => setKeepId(c.id)} />
            <div>
              <strong>{c.name}</strong>
              <div className="muted">
                {c.tax_code ? `MST: ${c.tax_code} · ` : ""}
                {c.document_count} hồ sơ
              </div>
            </div>
          </label>
        ))}

        <InlineAlert tone="warning" title="Thao tác không thể hoàn tác">
          Toàn bộ hồ sơ, tài khoản, đơn hàng, hóa đơn bán, phiếu xuất của <b>{drop.name}</b> sẽ chuyển sang{" "}
          <b>{keep.name}</b>; tên &ldquo;{drop.name}&rdquo; sẽ thành alias của &ldquo;{keep.name}&rdquo;; công ty &ldquo;
          {drop.name}&rdquo; sẽ bị xóa.
        </InlineAlert>

        {err && <InlineAlert tone="danger">{err}</InlineAlert>}
      </div>
    </AppModal>
  );
}
