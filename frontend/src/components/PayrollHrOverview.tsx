import { useEffect, useState } from "react";
import { api, PayrollHrEmployee, PayrollHrSummary } from "../api";
import { PayrollEmployeeCharts } from "./PayrollEmployeeCharts";

const money = (value = 0) => new Intl.NumberFormat("vi-VN").format(value);

const statusLabel = (status: string) => ({
  pending_revision: "Chờ chốt bảng lương",
  missing_evidence: "Thiếu chứng từ",
  paid: "Đã đối chiếu",
  partial: "Đã trả một phần",
  unpaid: "Chưa thanh toán",
}[status] || status);

interface Props {
  year: number;
  summary: PayrollHrSummary | null;
  reload: () => Promise<void>;
  setMessage: (message: string) => void;
}

export function PayrollHrOverview({ year, summary, reload, setMessage }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [paymentMonth, setPaymentMonth] = useState("");
  const [amount, setAmount] = useState("");
  const [bankName, setBankName] = useState("");
  const [transactionRef, setTransactionRef] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const selected = summary?.employees.find((item) => item.employee_id === selectedId) ?? null;

  useEffect(() => {
    if (!selected && summary?.employees.length) setSelectedId(summary.employees[0].employee_id);
  }, [selected, summary]);

  useEffect(() => {
    if (!selected) return;
    const month = selected.months.find((item) => item.outstanding > 0 && item.reconciliation_status !== "pending_revision")
      ?? selected.months[selected.months.length - 1];
    if (month) {
      setPaymentMonth(month.month);
      setAmount(String(month.outstanding || ""));
    }
  }, [selectedId, summary]);

  async function recordPayment() {
    if (!selected || !paymentMonth || Number(amount) <= 0) {
      setMessage("Vui lòng chọn kỳ lương và nhập số tiền đã chuyển hợp lệ.");
      return;
    }
    try {
      setBusy(true);
      await api.payrollCreatePayment({
        employee_id: selected.employee_id, month: paymentMonth, amount: Number(amount),
        status: "completed", paid_at: `${paidAt}T12:00:00+07:00`,
        bank_name: bankName, transaction_ref: transactionRef,
        note: "HR xác nhận đã chuyển; bổ sung chứng từ nếu còn thiếu",
      });
      setMessage("Đã ghi nhận thanh toán. Hãy bổ sung chứng từ chuyển khoản nếu còn thiếu.");
      await reload();
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  async function uploadEvidence(paymentId: number, file?: File) {
    if (!file) return;
    try {
      setBusy(true);
      await api.payrollUploadPaymentEvidence(paymentId, file);
      setMessage("Đã bổ sung chứng từ chuyển khoản.");
      await reload();
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  if (!summary) return <section className="hr-overview loading">Đang tổng hợp dữ liệu HR…</section>;

  return <section className="hr-overview" aria-label="Tổng quan thanh toán và thuế năm">
    <header className="hr-overview-head">
      <div><p className="eyebrow">SỔ LƯƠNG · THANH TOÁN · TNCN</p><h2>Bức tranh HR năm {year}</h2>
        <p>Tách rõ số phải trả theo bảng lương, tiền đã chuyển thực tế và nghĩa vụ thuế tạm tính.</p></div>
      <span>{summary.employees.length} người lao động</span>
    </header>
    <div className="hr-total-grid">
      <article><small>Phải trả</small><strong>{money(summary.totals.net_payable)}</strong></article>
      <article className="paid"><small>Đã chuyển</small><strong>{money(summary.totals.paid)}</strong></article>
      <article className="due"><small>Còn phải trả</small><strong>{money(summary.totals.outstanding)}</strong></article>
      <article><small>TNCN đã khấu trừ</small><strong>{money(summary.totals.pit_withheld)}</strong></article>
      <article><small>TNCN tạm tính năm</small><strong>{money(summary.totals.annual_pit)}</strong></article>
    </div>
    {!!summary.employees.length && <PayrollEmployeeCharts employees={summary.employees} />}
    {!summary.employees.length ? <p className="muted">Chưa có dữ liệu lương để tổng hợp.</p> :
      <div className="hr-workspace">
        <div className="hr-employee-list">{summary.employees.map((employee) =>
          <button key={employee.employee_id} className={selectedId === employee.employee_id ? "active" : ""}
            onClick={() => setSelectedId(employee.employee_id)}>
            <span><strong>{employee.name}</strong><small>{employee.position || employee.code}</small></span>
            <b>{money(employee.outstanding)}<small>Còn phải trả</small></b>
          </button>)}</div>
        {selected && <EmployeeDetail employee={selected} paymentMonth={paymentMonth} setPaymentMonth={setPaymentMonth}
          amount={amount} setAmount={setAmount} bankName={bankName} setBankName={setBankName}
          transactionRef={transactionRef} setTransactionRef={setTransactionRef} busy={busy}
          paidAt={paidAt} setPaidAt={setPaidAt} recordPayment={recordPayment}
          uploadEvidence={uploadEvidence} reload={reload} setMessage={setMessage} />}
      </div>}
    <footer>Thuế năm chỉ tạm tính theo dữ liệu công ty đang quản lý. Thu nhập nơi khác và giảm trừ giáo dục cần được bổ sung khi cá nhân quyết toán.</footer>
  </section>;
}

function EmployeeDetail({ employee, paymentMonth, setPaymentMonth, amount, setAmount, bankName,
  setBankName, transactionRef, setTransactionRef, paidAt, setPaidAt, busy, recordPayment,
  uploadEvidence, reload, setMessage }: {
  employee: PayrollHrEmployee; paymentMonth: string; setPaymentMonth: (value: string) => void;
  amount: string; setAmount: (value: string) => void; bankName: string; setBankName: (value: string) => void;
  transactionRef: string; setTransactionRef: (value: string) => void; busy: boolean;
  paidAt: string; setPaidAt: (value: string) => void;
  recordPayment: () => void; uploadEvidence: (paymentId: number, file?: File) => void;
  reload: () => Promise<void>; setMessage: (message: string) => void;
}) {
  const taxBalance = employee.tax.balance;
  return <div className="hr-employee-detail">
    <header><div><h3>{employee.name}</h3><span>{employee.position}</span></div>
      <div className="hr-person-totals"><b>{money(employee.paid)}<small>Đã nhận</small></b><b>{money(employee.outstanding)}<small>Còn lại</small></b></div></header>
    <div className="hr-tax-strip">
      <span><small>Thuế đã khấu trừ</small><b>{money(employee.tax.withheld)}</b></span>
      <span><small>Thuế tạm tính năm</small><b>{money(employee.tax.annual_pit)}</b></span>
      <span><small>{taxBalance > 0 ? "Dự kiến nộp thêm" : "Dự kiến nộp thừa"}</small><b>{money(Math.abs(taxBalance))}</b></span>
    </div>
    <div className="hr-months">{employee.months.map((month) => <article key={month.month}>
      <header><strong>{month.month}</strong><span className={`hr-reconcile ${month.reconciliation_status}`}>{statusLabel(month.reconciliation_status)}</span></header>
      <div><span>Thực lĩnh <b>{money(month.net_payable)}</b></span><span>Đã trả <b>{money(month.paid)}</b></span><span>Còn lại <b>{money(month.outstanding)}</b></span></div>
      {month.payments.filter((payment) => payment.status === "completed").map((payment) => <div className="hr-payment" key={payment.id}>
        <span>{money(payment.amount)} · {payment.transaction_ref || "Chưa có mã giao dịch"}</span>
        {payment.evidence_missing ? <label className="evidence-upload">Bổ sung chứng từ<input aria-label="Chứng từ chuyển khoản" type="file" accept=".pdf,.png,.jpg,.jpeg" disabled={busy}
          onChange={(event) => uploadEvidence(payment.id, event.target.files?.[0])} /></label> :
          <a href={api.payrollPaymentEvidenceUrl(payment.id)}>{payment.evidence_name || "Xem chứng từ"}</a>}
        <button className="hr-cancel-payment" disabled={busy} onClick={async () => {
          const reason = window.prompt("Nhập lý do hủy giao dịch thanh toán");
          if (!reason) return;
          try { await api.payrollCancelPayment(payment.id, reason); setMessage("Đã hủy giao dịch thanh toán."); await reload(); }
          catch (error) { setMessage((error as Error).message); }
        }}>Hủy</button>
      </div>)}
    </article>)}</div>
    <div className="hr-payment-form">
      <h4>Ghi nhận chuyển lương</h4>
      <label>Kỳ lương<select value={paymentMonth} onChange={(event) => {
        const value = event.target.value; setPaymentMonth(value);
        const month = employee.months.find((item) => item.month === value); setAmount(String(month?.outstanding || ""));
      }}>{employee.months.map((month) => <option value={month.month} key={month.month}>{month.month}</option>)}</select></label>
      <label>Số tiền đã chuyển<input aria-label="Số tiền đã chuyển" type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      <label>Ngày chuyển<input aria-label="Ngày chuyển lương" type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} /></label>
      <label>Ngân hàng<input value={bankName} onChange={(event) => setBankName(event.target.value)} /></label>
      <label>Mã giao dịch<input value={transactionRef} onChange={(event) => setTransactionRef(event.target.value)} /></label>
      <button disabled={busy || employee.months.find((item) => item.month === paymentMonth)?.reconciliation_status === "pending_revision"} onClick={recordPayment}>Ghi nhận đã chuyển</button>
    </div>
  </div>;
}
