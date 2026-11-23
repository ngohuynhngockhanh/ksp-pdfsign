import { useEffect, useMemo, useState } from "react";
import { api, PymidCatalog, PymidOrder, PymidStaffAccount } from "../api";
import { DataView } from "../components/ui";
import { safeHttpUrl } from "../utils/url";

const money = (value: number) => Math.round(value || 0).toLocaleString("vi-VN") + "đ";
const today = new Date().toISOString().slice(0, 10);
const statusName: Record<string, string> = { draft: "Nháp", submitted: "Chờ INUT duyệt", approved: "Đã duyệt" };

export function PymidCoop({ isAdmin, canManageStaff }: { isAdmin: boolean; canManageStaff: boolean }) {
  const [catalog, setCatalog] = useState<PymidCatalog | null>(null);
  const [orders, setOrders] = useState<PymidOrder[]>([]);
  const [level, setLevel] = useState(1);
  const [documentDate, setDocumentDate] = useState(today);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [staff, setStaff] = useState<PymidStaffAccount[]>([]);
  const [staffName, setStaffName] = useState("");
  const [staffUsername, setStaffUsername] = useState("");
  const [staffPassword, setStaffPassword] = useState("");

  async function load(date = documentDate) {
    const [catalogData, orderData] = await Promise.all([api.pymidCatalog(date), api.pymidOrders()]);
    setCatalog(catalogData);
    setOrders(Array.isArray(orderData) ? orderData : []);
    setQuantities((current) => {
      if (Object.keys(current).length) return current;
      const base = (catalogData?.items || []).find((item) => item.level === level);
      return base ? { [base.id]: 1 } : {};
    });
  }
  useEffect(() => { load().catch((error) => setMessage((error as Error).message)); }, []);
  useEffect(() => {
    if (canManageStaff) {
      api.pymidStaff().then((rows) => setStaff(Array.isArray(rows) ? rows : [])).catch((error) => setMessage((error as Error).message));
    }
  }, [canManageStaff]);

  async function createStaff(event: React.FormEvent) {
    event.preventDefault();
    try {
      setBusy(true); setMessage("");
      const created = await api.pymidCreateStaff({
        username: staffUsername.trim(), display_name: staffName.trim(), password: staffPassword,
      });
      setStaff((rows) => [...rows, created].sort((a, b) => a.username.localeCompare(b.username)));
      setStaffName(""); setStaffUsername(""); setStaffPassword("");
      setMessage(`Đã tạo tài khoản ${created.username}. Nhân viên chỉ được vào khu vực CO.OP.`);
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }

  async function changeDate(value: string) {
    setDocumentDate(value);
    try { setCatalog(await api.pymidCatalog(value)); } catch (error) { setMessage((error as Error).message); }
  }
  function changeLevel(value: number) {
    setLevel(value);
    if (!catalog) return;
    const levelIds = new Set(catalog.items.filter((item) => item.level).map((item) => item.id));
    const base = catalog.items.find((item) => item.level === value);
    setQuantities((current) => ({ ...Object.fromEntries(Object.entries(current).filter(([id]) => !levelIds.has(Number(id)))), ...(base ? { [base.id]: 1 } : {}) }));
  }
  const selected = useMemo(() => catalog?.items.filter((item) => (quantities[item.id] || 0) > 0).map((item) => ({ ...item, quantity: quantities[item.id] })) ?? [], [catalog, quantities]);
  const preview = useMemo(() => {
    const hardware = selected.filter((item) => item.category === "hardware");
    const software = selected.filter((item) => item.category === "software");
    const hardwareGross = hardware.reduce((sum, item) => sum + item.gross_price * item.quantity, 0);
    const softwareGross = software.reduce((sum, item) => sum + item.gross_price * item.quantity, 0);
    return { hardware, software, hardwareGross, softwareGross, total: hardwareGross + softwareGross };
  }, [selected]);

  async function saveDraft() {
    if (!selected.length) return setMessage("Hãy chọn ít nhất một hạng mục.");
    try {
      setBusy(true); setMessage("");
      const body = { level, document_date: documentDate, customer_reference: reference.trim(), note: note.trim(), items: selected.map((item) => ({ product_id: item.id, quantity: item.quantity })) };
      const order = editingId ? await api.pymidUpdateOrder(editingId, body) : await api.pymidCreateOrder(body);
      setOrders((rows) => [order, ...rows.filter((row) => row.id !== order.id)]);
      setMessage(editingId ? `Đã cập nhật đơn nháp #${order.id}` : `Đã lưu đơn nháp #${order.id}`);
      setEditingId(null);
    } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  function editDraft(order: PymidOrder) {
    setEditingId(order.id);
    setLevel(order.level);
    setDocumentDate(order.document_date);
    setReference(order.customer_reference);
    setNote(order.note);
    setQuantities(Object.fromEntries(order.items.map((item) => [item.product_id, item.quantity])));
    setMessage(`Đang sửa đơn nháp #${order.id}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function submit(order: PymidOrder) {
    try { setBusy(true); const updated = await api.pymidSubmitOrder(order.id); setOrders((rows) => rows.map((row) => row.id === updated.id ? updated : row)); setMessage("Đã gửi INUT duyệt"); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }
  async function approve(order: PymidOrder) {
    try { setBusy(true); const updated = await api.pymidApproveOrder(order.id); setOrders((rows) => rows.map((row) => row.id === updated.id ? updated : row)); setMessage(`INUT đã duyệt đơn #${order.id}`); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  }

  return <div className="pymid-coop-page">
    <section className="pymid-hero"><div><span>KHÔNG GIAN HỢP TÁC RIÊNG</span><h1>INUT – PYMID CO.OP</h1><p>Cấu hình giải pháp nhà yến, xem giá hợp tác và xuất bảng kê cho Nhanh.vn.</p></div><div className="pymid-policy"><b>{catalog?.policy?.label ?? "Đang tải chính sách thuế"}</b><span>{catalog?.policy?.valid_to ? `VAT 8% đến 31/12/2026` : "Thuế suất theo ngày chứng từ"}</span><small>Phần mềm được tách riêng và ghi KCT.</small></div></section>
    {message && <div className="payroll-message" aria-live="polite">{message}</div>}
    <div className="pymid-layout">
      <section className="pymid-builder">
        <header><div><span>BƯỚC 1</span><h2>Chọn cấu hình Nebi</h2></div><div className="pymid-levels">{[1, 2, 3].map((value) => <button key={value} type="button" className={`ui-btn-chip${level === value ? " active" : ""}`} onClick={() => changeLevel(value)}>Level {value}</button>)}</div></header>
        <div className="pymid-order-meta"><label>Ngày dự kiến xuất<input className="ui-input" type="date" value={documentDate} onChange={(e) => changeDate(e.target.value)} /></label><label>Tham chiếu công trình<input className="ui-input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ví dụ: Nhà yến Hòa Bình" /></label></div>
        <div className="pymid-catalog">{(catalog?.items || []).map((item) => <article key={item.id} className={`${item.category} ${item.level === level ? "level-base" : ""}`}><div><span>{item.code} · {item.category === "software" ? "PHẦN MỀM" : item.level ? `LEVEL ${item.level}` : "PHẦN CỨNG"}</span><strong>{item.name}</strong><small>{item.vat_label} · {money(item.gross_price)}/{item.unit}</small></div><label>Số lượng<input className="ui-input" aria-label={item.name} type="number" min="0" step={item.unit === "Mét" ? "0.1" : "1"} value={quantities[item.id] ?? 0} onChange={(e) => setQuantities((rows) => ({ ...rows, [item.id]: Math.max(0, Number(e.target.value)) }))} /></label></article>)}</div>
      </section>
      <aside className="pymid-summary"><span>BƯỚC 2</span><h2>Bảng kê xuất hóa đơn</h2>{preview.hardware.length > 0 && <div className="pymid-invoice-line"><b>iNut Nebi - Bộ giải pháp nhà yến</b><small>Model Level {level} · Bộ × 1 · {catalog?.policy?.label}</small><strong>{money(preview.hardwareGross)}</strong></div>}{preview.software.map((item) => <div className="pymid-invoice-line software" key={item.id}><b>iNut Nebi Software: License {item.name}</b><small>Gói × {item.quantity} · KCT</small><strong>{money(item.gross_price * item.quantity)}</strong></div>)}<div className="pymid-total"><span>Tổng thanh toán</span><b>{money(preview.total)}</b></div><label>Ghi chú<textarea className="ui-textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Yêu cầu tùy chỉnh của khách hàng" /></label><button type="button" disabled={busy || !selected.length} onClick={saveDraft}>{editingId ? "Cập nhật nháp" : "Lưu nháp"}</button><a className="pymid-catalog-download" href={safeHttpUrl(api.pymidCatalogXlsxUrl(documentDate))} download>Tải danh mục giá</a></aside>
    </div>
    <section className="pymid-orders">
      <header><div><span>BƯỚC 3</span><h2>Đơn hàng và file bàn giao</h2></div></header>
      {!orders.length ? (
        <p className="muted">Chưa có đơn hàng nào.</p>
      ) : (
        <DataView
          mobileMode="card"
          desktop={
            <>
              {orders.map((order) => (
                <article key={order.id}>
                  <div><b>Đơn #{order.id} · Nebi Level {order.level}</b><span>{order.customer_reference || "Chưa có tham chiếu"} · {order.document_date}</span></div>
                  <strong>{money(order.total_gross)}</strong>
                  <span className={`pymid-status ${order.status}`}>{statusName[order.status] ?? order.status}</span>
                  <div className="pymid-order-actions">
                    <a href={safeHttpUrl(api.pymidOrderXlsxUrl(order.id))} download>Tải Excel</a>
                    {order.status === "draft" && <button type="button" disabled={busy} onClick={() => editDraft(order)}>Sửa nháp</button>}
                    {order.status === "draft" && <button type="button" disabled={busy} onClick={() => submit(order)}>Gửi INUT duyệt</button>}
                    {isAdmin && order.status !== "approved" && <button type="button" disabled={busy} onClick={() => approve(order)}>INUT duyệt</button>}
                  </div>
                  <div className="pymid-order-lines">{order.invoice_lines.map((line, index) => <small key={index}>{line.name} · {line.vat_label} · {money(line.gross_amount)}</small>)}</div>
                </article>
              ))}
            </>
          }
          mobileCards={
            <div className="ui-mobile-card-list">
              {orders.map((order) => (
                <article key={order.id} className="ui-mobile-card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ color: "var(--ink)", display: "block" }}>Đơn #{order.id} · Nebi Level {order.level}</strong>
                      <small className="muted">{order.customer_reference || "Chưa có tham chiếu"} · {order.document_date}</small>
                    </div>
                    <span className={`pymid-status ${order.status}`}>{statusName[order.status] ?? order.status}</span>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 16, fontWeight: 800, color: "var(--primary-dark)" }}>
                    {money(order.total_gross)}
                  </div>
                  {order.invoice_lines.length > 0 && (
                    <div style={{ display: "grid", gap: 3, marginTop: 6 }}>
                      {order.invoice_lines.map((line, index) => (
                        <small key={index} className="muted">{line.name} · {line.vat_label} · {money(line.gross_amount)}</small>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                    <a className="btn-sm ui-btn-chip" href={safeHttpUrl(api.pymidOrderXlsxUrl(order.id))} download style={{ textDecoration: "none" }}>Tải Excel</a>
                    {order.status === "draft" && <button type="button" className="btn-sm ui-btn-chip" disabled={busy} onClick={() => editDraft(order)}>Sửa nháp</button>}
                    {order.status === "draft" && <button type="button" className="btn-sm primary ui-btn-chip" disabled={busy} onClick={() => submit(order)}>Gửi INUT duyệt</button>}
                    {isAdmin && order.status !== "approved" && <button type="button" className="btn-sm primary ui-btn-chip" disabled={busy} onClick={() => approve(order)}>INUT duyệt</button>}
                  </div>
                </article>
              ))}
            </div>
          }
        />
      )}
    </section>
    {canManageStaff && <section className="pymid-staff"><header><div><span>PHÂN QUYỀN</span><h2>Tài khoản nhân viên PYMID</h2><p>Nhân viên chỉ xem và thao tác trong INUT – PYMID CO.OP, không truy cập hồ sơ hoặc hóa đơn.</p></div></header><form onSubmit={createStaff}><label>Tên nhân viên<input className="ui-input" required maxLength={150} value={staffName} onChange={(e) => setStaffName(e.target.value)} placeholder="Ví dụ: Nguyễn Văn An" /></label><label>Tên đăng nhập<input className="ui-input" required minLength={4} maxLength={50} value={staffUsername} onChange={(e) => setStaffUsername(e.target.value)} placeholder="pymid.nguyenvanan" /></label><label>Mật khẩu tạm<input className="ui-input" required type="password" minLength={10} maxLength={128} value={staffPassword} onChange={(e) => setStaffPassword(e.target.value)} placeholder="Tối thiểu 10 ký tự" /></label><button type="submit" disabled={busy}>Tạo tài khoản nhân viên</button></form><div className="pymid-staff-list">{staff.length ? staff.map((row) => <article key={row.id}><div><b>{row.display_name}</b><span>{row.username}</span></div><small>Chỉ CO.OP</small></article>) : <p className="muted">Chưa có tài khoản nhân viên.</p>}</div></section>}
  </div>;
}
