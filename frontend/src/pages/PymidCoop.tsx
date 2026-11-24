import { useEffect, useMemo, useState } from "react";
import { api, PymidCatalog, PymidOrder, PymidStaffAccount } from "../api";
import {
  AppButton,
  AppIcon,
  DataView,
  EmptyState,
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
  SectionCard,
  SplitWorkspace,
  StatusBadge,
  StepFlow,
  TableSkeleton,
} from "../components/ui";
import { safeHttpUrl } from "../utils/url";

const money = (value: number) => Math.round(value || 0).toLocaleString("vi-VN") + "đ";
const today = new Date().toISOString().slice(0, 10);
const statusName: Record<string, string> = { draft: "Nháp", submitted: "Chờ INUT duyệt", approved: "Đã duyệt" };

function orderTone(status: string): "neutral" | "warning" | "success" {
  if (status === "approved") return "success";
  if (status === "submitted") return "warning";
  return "neutral";
}

export function PymidCoop({ isAdmin, canManageStaff }: { isAdmin: boolean; canManageStaff: boolean }) {
  const [catalog, setCatalog] = useState<PymidCatalog | null>(null);
  const [loadingInit, setLoadingInit] = useState(true);
  const [orders, setOrders] = useState<PymidOrder[]>([]);
  const [level, setLevel] = useState(1);
  const [documentDate, setDocumentDate] = useState(today);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"info" | "success" | "danger">("info");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [staff, setStaff] = useState<PymidStaffAccount[]>([]);
  const [staffName, setStaffName] = useState("");
  const [staffUsername, setStaffUsername] = useState("");
  const [staffPassword, setStaffPassword] = useState("");

  function notify(text: string, tone: "info" | "success" | "danger" = "info") {
    setMessage(text);
    setMessageTone(tone);
  }

  async function load(date = documentDate) {
    setLoadingInit(true);
    try {
      const [catalogData, orderData] = await Promise.all([api.pymidCatalog(date), api.pymidOrders()]);
      setCatalog(catalogData);
      setOrders(Array.isArray(orderData) ? orderData : []);
      setQuantities((current) => {
        if (Object.keys(current).length) return current;
        const base = (catalogData?.items || []).find((item) => item.level === level);
        return base ? { [base.id]: 1 } : {};
      });
    } finally {
      setLoadingInit(false);
    }
  }

  useEffect(() => {
    load().catch((error) => notify((error as Error).message, "danger"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (canManageStaff) {
      api.pymidStaff()
        .then((rows) => setStaff(Array.isArray(rows) ? rows : []))
        .catch((error) => notify((error as Error).message, "danger"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageStaff]);

  async function createStaff(event: React.FormEvent) {
    event.preventDefault();
    try {
      setBusy(true);
      setMessage("");
      const created = await api.pymidCreateStaff({
        username: staffUsername.trim(),
        display_name: staffName.trim(),
        password: staffPassword,
      });
      setStaff((rows) => [...rows, created].sort((a, b) => a.username.localeCompare(b.username)));
      setStaffName("");
      setStaffUsername("");
      setStaffPassword("");
      notify(`Đã tạo tài khoản ${created.username}. Nhân viên chỉ được vào khu vực CO.OP.`, "success");
    } catch (error) {
      notify((error as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  }

  async function changeDate(value: string) {
    setDocumentDate(value);
    try {
      setCatalog(await api.pymidCatalog(value));
    } catch (error) {
      notify((error as Error).message, "danger");
    }
  }

  function changeLevel(value: number) {
    setLevel(value);
    if (!catalog) return;
    const levelIds = new Set(catalog.items.filter((item) => item.level).map((item) => item.id));
    const base = catalog.items.find((item) => item.level === value);
    setQuantities((current) => ({
      ...Object.fromEntries(Object.entries(current).filter(([id]) => !levelIds.has(Number(id)))),
      ...(base ? { [base.id]: 1 } : {}),
    }));
  }

  const selected = useMemo(
    () => catalog?.items.filter((item) => (quantities[item.id] || 0) > 0).map((item) => ({ ...item, quantity: quantities[item.id] })) ?? [],
    [catalog, quantities],
  );

  const preview = useMemo(() => {
    const hardware = selected.filter((item) => item.category === "hardware");
    const software = selected.filter((item) => item.category === "software");
    const hardwareGross = hardware.reduce((sum, item) => sum + item.gross_price * item.quantity, 0);
    const softwareGross = software.reduce((sum, item) => sum + item.gross_price * item.quantity, 0);
    return { hardware, software, hardwareGross, softwareGross, total: hardwareGross + softwareGross };
  }, [selected]);

  async function saveDraft() {
    if (!selected.length) return notify("Hãy chọn ít nhất một hạng mục.", "danger");
    try {
      setBusy(true);
      setMessage("");
      const body = {
        level,
        document_date: documentDate,
        customer_reference: reference.trim(),
        note: note.trim(),
        items: selected.map((item) => ({ product_id: item.id, quantity: item.quantity })),
      };
      const order = editingId ? await api.pymidUpdateOrder(editingId, body) : await api.pymidCreateOrder(body);
      setOrders((rows) => [order, ...rows.filter((row) => row.id !== order.id)]);
      notify(editingId ? `Đã cập nhật đơn nháp #${order.id}` : `Đã lưu đơn nháp #${order.id}`, "success");
      setEditingId(null);
    } catch (error) {
      notify((error as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  }

  function editDraft(order: PymidOrder) {
    setEditingId(order.id);
    setLevel(order.level);
    setDocumentDate(order.document_date);
    setReference(order.customer_reference);
    setNote(order.note);
    setQuantities(Object.fromEntries(order.items.map((item) => [item.product_id, item.quantity])));
    notify(`Đang sửa đơn nháp #${order.id}`, "info");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(order: PymidOrder) {
    try {
      setBusy(true);
      const updated = await api.pymidSubmitOrder(order.id);
      setOrders((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      notify("Đã gửi INUT duyệt", "success");
    } catch (error) {
      notify((error as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  }

  async function approve(order: PymidOrder) {
    try {
      setBusy(true);
      const updated = await api.pymidApproveOrder(order.id);
      setOrders((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
      notify(`INUT đã duyệt đơn #${order.id}`, "success");
    } catch (error) {
      notify((error as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell className="pymid-coop-page" data-page="pymid-coop">
      <PageHeader
        variant="compact"
        icon="building"
        title="INUT – PYMID CO.OP"
        subtitle="Cấu hình giải pháp nhà yến, xem giá hợp tác và xuất bảng kê cho Nhanh.vn."
        actions={
          <div className="ui-row">
            <StatusBadge tone="brand" icon="percent">
              {catalog?.policy?.label ?? "Chính sách thuế"}
            </StatusBadge>
            <StatusBadge tone="info">
              {catalog?.policy?.valid_to ? "VAT 8% đến 31/12/2026" : "Thuế theo ngày"}
            </StatusBadge>
          </div>
        }
      />

      <StepFlow
        className="studio-step-flow"
        ariaLabel="Quy trình đặt cấu hình CO.OP"
        steps={[
          {
            id: "config",
            label: "Chọn cấu hình Nebi",
            done: selected.length > 0,
            active: selected.length === 0,
            onClick: () => document.getElementById("pymid-step-1")?.scrollIntoView({ behavior: "smooth" }),
          },
          {
            id: "summary",
            label: "Bảng kê xuất hóa đơn",
            done: orders.length > 0,
            active: selected.length > 0 && orders.length === 0,
            onClick: () => document.getElementById("pymid-step-2")?.scrollIntoView({ behavior: "smooth" }),
          },
          {
            id: "orders",
            label: "Đơn hàng & bàn giao",
            done: orders.some((o) => o.status !== "draft"),
            active: orders.length > 0,
            onClick: () => document.getElementById("pymid-step-3")?.scrollIntoView({ behavior: "smooth" }),
          },
        ]}
      />

      {message && (
        <InlineAlert tone={messageTone} onDismiss={() => setMessage("")}>
          {message}
        </InlineAlert>
      )}

      <SplitWorkspace
        variant="preview-right"
        stickySecondary
        primary={
          <SectionCard
            id="pymid-step-1"
            padding="compact"
            title="Bước 1 · Chọn cấu hình Nebi"
            icon="sliders"
            actions={
              <div className="ui-row" role="group" aria-label="Chọn cấp độ Nebi">
                {[1, 2, 3].map((value) => (
                  <AppButton
                    key={value}
                    variant={level === value ? "primary" : "secondary"}
                    size="sm"
                    aria-pressed={level === value}
                    onClick={() => changeLevel(value)}
                  >
                    Level {value}
                  </AppButton>
                ))}
              </div>
            }
          >
            <div className="ui-stack--lg">
              <FormGrid cols={2}>
                <FormField label="Ngày dự kiến xuất" htmlFor="pymid-doc-date">
                  <input
                    id="pymid-doc-date"
                    className="ui-input"
                    type="date"
                    value={documentDate}
                    onChange={(e) => changeDate(e.target.value)}
                  />
                </FormField>
                <FormField label="Tham chiếu công trình" htmlFor="pymid-ref">
                  <input
                    id="pymid-ref"
                    className="ui-input"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="Ví dụ: Nhà yến Hòa Bình"
                  />
                </FormField>
              </FormGrid>

              {loadingInit && !catalog ? (
                <TableSkeleton rows={4} cols={3} />
              ) : (catalog?.items || []).length === 0 ? (
                <EmptyState
                  compact
                  icon="package"
                  title="Chưa có danh mục sản phẩm"
                  description="Thử đổi ngày chứng từ hoặc liên hệ INUT để cập nhật bảng giá hợp tác."
                />
              ) : (
                <div className="ui-catalog-grid">
                  {(catalog?.items || []).map((item) => (
                    <article
                      key={item.id}
                      className={`ui-catalog-item${item.category === "software" ? " is-software" : ""}${item.level === level ? " is-base" : ""}`}
                    >
                      <div className="ui-catalog-meta">
                        <div className="ui-row">
                          <StatusBadge
                            size="sm"
                            tone={item.category === "software" ? "info" : item.level === level ? "brand" : "neutral"}
                          >
                            {item.code} · {item.category === "software" ? "PHẦN MỀM" : item.level ? `LEVEL ${item.level}` : "PHẦN CỨNG"}
                          </StatusBadge>
                        </div>
                        <strong>{item.name}</strong>
                        <small>{item.vat_label} · {money(item.gross_price)}/{item.unit}</small>
                      </div>
                      <label className="ui-qty-box">
                        <span>Số lượng</span>
                        <input
                          className="ui-input"
                          aria-label={item.name}
                          type="number"
                          min="0"
                          step={item.unit === "Mét" ? "0.1" : "1"}
                          value={quantities[item.id] ?? 0}
                          onChange={(e) =>
                            setQuantities((rows) => ({ ...rows, [item.id]: Math.max(0, Number(e.target.value)) }))
                          }
                        />
                      </label>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </SectionCard>
        }
        secondary={
          <SectionCard
            id="pymid-step-2"
            eyebrow="BƯỚC 2"
            title="Bảng kê xuất hóa đơn"
            icon="receipt"
            footer={
              <div className="ui-stack--sm">
                <AppButton
                  variant="primary"
                  size="md"
                  fullWidth
                  leftIcon="save"
                  loading={busy}
                  disabled={busy || !selected.length}
                  onClick={saveDraft}
                >
                  {editingId ? "Cập nhật nháp" : "Lưu nháp"}
                </AppButton>
                <a
                  className="ui-btn ui-btn--secondary ui-btn--md ui-btn--full"
                  href={safeHttpUrl(api.pymidCatalogXlsxUrl(documentDate))}
                  download
                >
                  <AppIcon name="download" size={16} />
                  <span>Tải danh mục giá</span>
                </a>
              </div>
            }
          >
            <div className="ui-stack--sm">
              {selected.length === 0 ? (
                <EmptyState
                  compact
                  icon="calculator"
                  title="Chưa chọn hạng mục"
                  description="Tăng số lượng thiết bị hoặc phần mềm ở Bước 1 để xem bảng kê."
                />
              ) : (
                <>
                  {preview.hardware.length > 0 && (
                    <div className="ui-subpanel ui-stack--xs studio-invoice-line">
                      <strong>iNut Nebi - Bộ giải pháp nhà yến</strong>
                      <span className="ui-muted">Model Level {level} · Bộ × 1 · {catalog?.policy?.label}</span>
                      <strong>{money(preview.hardwareGross)}</strong>
                    </div>
                  )}
                  {preview.software.map((item) => (
                    <div className="ui-subpanel ui-stack--xs studio-invoice-line is-software" key={item.id}>
                      <strong>iNut Nebi Software: License {item.name}</strong>
                      <span className="ui-muted">Gói × {item.quantity} · KCT</span>
                      <strong>{money(item.gross_price * item.quantity)}</strong>
                    </div>
                  ))}
                  <div className="ui-kv-row">
                    <span>Tổng thanh toán</span>
                    <strong className="num">{money(preview.total)}</strong>
                  </div>
                </>
              )}

              <FormField label="Ghi chú" htmlFor="pymid-note">
                <textarea
                  id="pymid-note"
                  className="ui-textarea"
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Yêu cầu tùy chỉnh của khách hàng"
                />
              </FormField>
            </div>
          </SectionCard>
        }
      />

      <SectionCard
        id="pymid-step-3"
        eyebrow="BƯỚC 3"
        title="Đơn hàng và file bàn giao"
        icon="clipboard-list"
      >
        <DataView
          mobileMode="card"
          loading={loadingInit}
          skeletonRows={3}
          skeletonCols={4}
          empty={
            !orders.length ? (
              <EmptyState
                compact
                icon="inbox"
                title="Chưa có đơn hàng nào"
                description="Chọn cấu hình Nebi ở Bước 1 và bấm Lưu nháp để tạo đơn hàng đầu tiên."
              />
            ) : undefined
          }
          desktop={
            <div className="ui-stack--sm">
              {orders.map((order) => (
                <article key={order.id} className="ui-order-row">
                  <div className="ui-stack--xs">
                    <strong>Đơn #{order.id} · Nebi Level {order.level}</strong>
                    <span className="ui-muted">
                      {order.customer_reference || "Chưa có tham chiếu"} · {order.document_date}
                    </span>
                  </div>
                  <strong className="num">{money(order.total_gross)}</strong>
                  <StatusBadge tone={orderTone(order.status)} dot>
                    {statusName[order.status] ?? order.status}
                  </StatusBadge>
                  <div className="ui-row">
                    <a
                      className="ui-btn ui-btn--secondary ui-btn--sm"
                      href={safeHttpUrl(api.pymidOrderXlsxUrl(order.id))}
                      download
                    >
                      <AppIcon name="download" size={14} />
                      <span>Tải Excel</span>
                    </a>
                    {order.status === "draft" && (
                      <AppButton variant="secondary" size="sm" leftIcon="edit" disabled={busy} onClick={() => editDraft(order)}>
                        Sửa nháp
                      </AppButton>
                    )}
                    {order.status === "draft" && (
                      <AppButton variant="primary" size="sm" leftIcon="send" disabled={busy} onClick={() => submit(order)}>
                        Gửi INUT duyệt
                      </AppButton>
                    )}
                    {isAdmin && order.status !== "approved" && (
                      <AppButton variant="primary" size="sm" leftIcon="check" disabled={busy} onClick={() => approve(order)}>
                        INUT duyệt
                      </AppButton>
                    )}
                  </div>
                  {order.invoice_lines.length > 0 && (
                    <div className="ui-order-lines">
                      {order.invoice_lines.map((line, index) => (
                        <span key={index}>{line.name} · {line.vat_label} · {money(line.gross_amount)}</span>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          }
          mobileCards={
            <div className="ui-mobile-card-list">
              {orders.map((order) => (
                <MobileCard key={order.id}>
                  <MobileCardHeader
                    title={`Đơn #${order.id} · Nebi Level ${order.level}`}
                    subtitle={`${order.customer_reference || "Chưa có tham chiếu"} · ${order.document_date}`}
                    badge={
                      <StatusBadge tone={orderTone(order.status)} size="sm" dot>
                        {statusName[order.status] ?? order.status}
                      </StatusBadge>
                    }
                  />
                  <MobileCardGrid cols={1}>
                    <MobileCardRow label="Tổng thanh toán" value={money(order.total_gross)} mono />
                    {order.invoice_lines.map((line, index) => (
                      <MobileCardRow
                        key={index}
                        label={line.vat_label}
                        value={`${line.name} · ${money(line.gross_amount)}`}
                      />
                    ))}
                  </MobileCardGrid>
                  <MobileCardActions>
                    <a
                      className="ui-btn ui-btn--secondary ui-btn--sm"
                      href={safeHttpUrl(api.pymidOrderXlsxUrl(order.id))}
                      download
                    >
                      <AppIcon name="download" size={14} />
                      <span>Tải Excel</span>
                    </a>
                    {order.status === "draft" && (
                      <AppButton variant="secondary" size="sm" leftIcon="edit" disabled={busy} onClick={() => editDraft(order)}>
                        Sửa nháp
                      </AppButton>
                    )}
                    {order.status === "draft" && (
                      <AppButton variant="primary" size="sm" leftIcon="send" disabled={busy} onClick={() => submit(order)}>
                        Gửi INUT duyệt
                      </AppButton>
                    )}
                    {isAdmin && order.status !== "approved" && (
                      <AppButton variant="primary" size="sm" leftIcon="check" disabled={busy} onClick={() => approve(order)}>
                        INUT duyệt
                      </AppButton>
                    )}
                  </MobileCardActions>
                </MobileCard>
              ))}
            </div>
          }
        />
      </SectionCard>

      {canManageStaff && (
        <SectionCard
          eyebrow="PHÂN QUYỀN"
          title="Tài khoản nhân viên PYMID"
          subtitle="Nhân viên chỉ xem và thao tác trong INUT – PYMID CO.OP, không truy cập hồ sơ hoặc hóa đơn."
          icon="users"
        >
          <div className="ui-stack--lg">
            <form onSubmit={createStaff}>
              <FormGrid cols={4}>
                <FormField label="Tên nhân viên" htmlFor="pymid-staff-name" required>
                  <input
                    id="pymid-staff-name"
                    className="ui-input"
                    required
                    maxLength={150}
                    value={staffName}
                    onChange={(e) => setStaffName(e.target.value)}
                    placeholder="Ví dụ: Nguyễn Văn An"
                  />
                </FormField>
                <FormField label="Tên đăng nhập" htmlFor="pymid-staff-user" required>
                  <input
                    id="pymid-staff-user"
                    className="ui-input"
                    required
                    minLength={4}
                    maxLength={50}
                    value={staffUsername}
                    onChange={(e) => setStaffUsername(e.target.value)}
                    placeholder="pymid.nguyenvanan"
                  />
                </FormField>
                <FormField label="Mật khẩu tạm" htmlFor="pymid-staff-pass" required>
                  <input
                    id="pymid-staff-pass"
                    className="ui-input"
                    required
                    type="password"
                    minLength={10}
                    maxLength={128}
                    value={staffPassword}
                    onChange={(e) => setStaffPassword(e.target.value)}
                    placeholder="Tối thiểu 10 ký tự"
                  />
                </FormField>
                <div className="ui-row ui-row--bottom">
                  <AppButton type="submit" variant="primary" fullWidth leftIcon="user-plus" loading={busy}>
                    Tạo tài khoản nhân viên
                  </AppButton>
                </div>
              </FormGrid>
            </form>

            {staff.length > 0 ? (
              <div className="ui-draft-grid">
                {staff.map((row) => (
                  <article key={row.id} className="ui-subpanel ui-row-between">
                    <div className="ui-stack--xs">
                      <strong>{row.display_name}</strong>
                      <span className="ui-muted">{row.username}</span>
                    </div>
                    <StatusBadge tone="success" size="sm">Chỉ CO.OP</StatusBadge>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                compact
                icon="users"
                title="Chưa có tài khoản nhân viên"
                description="Tạo tài khoản riêng để nhân viên cấu hình đơn CO.OP mà không xem hồ sơ công ty."
              />
            )}
          </div>
        </SectionCard>
      )}
    </PageShell>
  );
}
