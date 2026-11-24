import { useEffect, useState } from "react";
import { api, PayrollHrEmployee, PayrollHrSummary } from "../api";
import { PayrollEmployeeCharts } from "./PayrollEmployeeCharts";
import {
  AppButton,
  AppIcon,
  EmptyState,
  FormField,
  FormGrid,
  InlineAlert,
  KpiStrip,
  PromptDialog,
  SectionCard,
  StatusBadge,
  TableSkeleton,
  type StatusBadgeTone,
} from "./ui";

const money = (value = 0) => new Intl.NumberFormat("vi-VN").format(value);

const statusLabel = (status: string) =>
  ({
    pending_revision: "Chờ chốt bảng lương",
    missing_evidence: "Thiếu chứng từ",
    paid: "Đã đối chiếu",
    partial: "Đã trả một phần",
    unpaid: "Chưa thanh toán",
  })[status] || status;

function statusTone(status: string): StatusBadgeTone {
  if (status === "paid") return "success";
  if (status === "missing_evidence" || status === "pending_revision") return "danger";
  if (status === "partial") return "warning";
  return "neutral";
}

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
    const month =
      selected.months.find(
        (item) => item.outstanding > 0 && item.reconciliation_status !== "pending_revision",
      ) ?? selected.months[selected.months.length - 1];
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
        employee_id: selected.employee_id,
        month: paymentMonth,
        amount: Number(amount),
        status: "completed",
        paid_at: `${paidAt}T12:00:00+07:00`,
        bank_name: bankName,
        transaction_ref: transactionRef,
        note: "HR xác nhận đã chuyển; bổ sung chứng từ nếu còn thiếu",
      });
      setMessage("Đã ghi nhận thanh toán. Hãy bổ sung chứng từ chuyển khoản nếu còn thiếu.");
      await reload();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadEvidence(paymentId: number, file?: File) {
    if (!file) return;
    try {
      setBusy(true);
      await api.payrollUploadPaymentEvidence(paymentId, file);
      setMessage("Đã bổ sung chứng từ chuyển khoản.");
      await reload();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!summary) {
    return (
      <section className="hr-overview" aria-label="Tổng quan thanh toán và thuế năm">
        <SectionCard
          eyebrow="SỔ LƯƠNG · THANH TOÁN · TNCN"
          title={`Bức tranh HR năm ${year}`}
          subtitle="Đang tổng hợp dữ liệu HR…"
          icon="users"
        >
          <TableSkeleton rows={4} cols={5} />
        </SectionCard>
      </section>
    );
  }

  return (
    <section className="hr-overview" aria-label="Tổng quan thanh toán và thuế năm">
      <SectionCard
        eyebrow="SỔ LƯƠNG · THANH TOÁN · TNCN"
        title={`Bức tranh HR năm ${year}`}
        subtitle="Tách rõ số phải trả theo bảng lương, tiền đã chuyển thực tế và nghĩa vụ thuế tạm tính."
        icon="users"
        actions={
          <StatusBadge tone="brand" icon="users">
            {summary.employees.length} người lao động
          </StatusBadge>
        }
      >
        <div className="ui-stack--lg">
          <KpiStrip
            columns={5}
            items={[
              {
                label: "Phải trả",
                value: money(summary.totals.net_payable),
                tone: "brand",
                icon: "wallet",
              },
              {
                label: "Đã chuyển",
                value: money(summary.totals.paid),
                tone: "success",
                icon: "check-circle",
              },
              {
                label: "Còn phải trả",
                value: money(summary.totals.outstanding),
                tone: summary.totals.outstanding > 0 ? "danger" : "success",
                icon: "clock",
              },
              {
                label: "TNCN đã khấu trừ",
                value: money(summary.totals.pit_withheld),
                tone: "info",
                icon: "receipt",
              },
              {
                label: "TNCN tạm tính năm",
                value: money(summary.totals.annual_pit),
                tone: "neutral",
                icon: "calculator",
              },
            ]}
          />

          {!!summary.employees.length && <PayrollEmployeeCharts employees={summary.employees} />}

          {!summary.employees.length ? (
            <EmptyState
              compact
              icon="users"
              title="Chưa có dữ liệu lương để tổng hợp"
              description="Đồng bộ bảng lương từ Google Drive để xem chi tiết từng nhân sự."
            />
          ) : (
            <div className="ui-split-compact">
              <div className="hr-employee-list">
                {summary.employees.map((employee) => (
                  <AppButton
                    key={employee.employee_id}
                    variant="ghost"
                    className={`ui-list-btn payroll-select-btn${selectedId === employee.employee_id ? " is-active" : ""}`}
                    onClick={() => setSelectedId(employee.employee_id)}
                  >
                    <span className="ui-row-between ui-w-full">
                      <span>
                        <strong className="ui-text-strong">{employee.name}</strong>
                        <div className="ui-select-meta">
                          {employee.position || employee.code}
                        </div>
                      </span>
                      <span className="num">
                        <strong
                          className={
                            employee.outstanding > 0 ? "ui-text-danger" : "ui-text-success"
                          }
                        >
                          {money(employee.outstanding)}
                        </strong>
                        <div className="ui-select-meta">Còn phải trả</div>
                      </span>
                    </span>
                  </AppButton>
                ))}
              </div>

              {selected && (
                <EmployeeDetail
                  employee={selected}
                  paymentMonth={paymentMonth}
                  setPaymentMonth={setPaymentMonth}
                  amount={amount}
                  setAmount={setAmount}
                  bankName={bankName}
                  setBankName={setBankName}
                  transactionRef={transactionRef}
                  setTransactionRef={setTransactionRef}
                  busy={busy}
                  paidAt={paidAt}
                  setPaidAt={setPaidAt}
                  recordPayment={recordPayment}
                  uploadEvidence={uploadEvidence}
                  reload={reload}
                  setMessage={setMessage}
                />
              )}
            </div>
          )}

          <InlineAlert tone="warning">
            Thuế năm chỉ tạm tính theo dữ liệu công ty đang quản lý. Thu nhập nơi khác và giảm trừ
            giáo dục cần được bổ sung khi cá nhân quyết toán.
          </InlineAlert>
        </div>
      </SectionCard>
    </section>
  );
}

function EmployeeDetail({
  employee,
  paymentMonth,
  setPaymentMonth,
  amount,
  setAmount,
  bankName,
  setBankName,
  transactionRef,
  setTransactionRef,
  paidAt,
  setPaidAt,
  busy,
  recordPayment,
  uploadEvidence,
  reload,
  setMessage,
}: {
  employee: PayrollHrEmployee;
  paymentMonth: string;
  setPaymentMonth: (value: string) => void;
  amount: string;
  setAmount: (value: string) => void;
  bankName: string;
  setBankName: (value: string) => void;
  transactionRef: string;
  setTransactionRef: (value: string) => void;
  busy: boolean;
  paidAt: string;
  setPaidAt: (value: string) => void;
  recordPayment: () => void;
  uploadEvidence: (paymentId: number, file?: File) => void;
  reload: () => Promise<void>;
  setMessage: (message: string) => void;
}) {
  const [cancelTargetId, setCancelTargetId] = useState<number | null>(null);
  const taxBalance = employee.tax.balance;

  async function confirmCancelPayment(reason: string) {
    const targetId = cancelTargetId;
    setCancelTargetId(null);
    const trimmed = reason.trim();
    if (!targetId || !trimmed) return;
    try {
      await api.payrollCancelPayment(targetId, trimmed);
      setMessage("Đã hủy giao dịch thanh toán.");
      await reload();
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  return (
    <SectionCard padding="compact">
      <div className="ui-stack--lg">
        <div className="ui-row-between">
          <div>
            <h3 className="ui-text-strong">{employee.name}</h3>
            <span className="ui-muted">{employee.position}</span>
          </div>
          <div className="ui-row">
            <StatusBadge tone="success">Đã nhận: {money(employee.paid)}</StatusBadge>
            <StatusBadge tone={employee.outstanding > 0 ? "danger" : "neutral"}>
              Còn lại: {money(employee.outstanding)}
            </StatusBadge>
          </div>
        </div>

        <div className="ui-grid-3">
          <div className="ui-stat-tile">
            <span className="ui-muted">Thuế đã khấu trừ</span>
            <strong className="num">{money(employee.tax.withheld)}</strong>
          </div>
          <div className="ui-stat-tile">
            <span className="ui-muted">Thuế tạm tính năm</span>
            <strong className="num">{money(employee.tax.annual_pit)}</strong>
          </div>
          <div className="ui-stat-tile">
            <span className="ui-muted">
              {taxBalance > 0 ? "Dự kiến nộp thêm" : "Dự kiến nộp thừa"}
            </span>
            <strong className="num">{money(Math.abs(taxBalance))}</strong>
          </div>
        </div>

        <div className="ui-stack--sm">
          {employee.months.map((month) => (
            <article className="ui-subpanel ui-subpanel--1 ui-stack--sm" key={month.month}>
              <div className="ui-row-between">
                <strong className="ui-text-strong">{month.month}</strong>
                <StatusBadge tone={statusTone(month.reconciliation_status)} size="sm">
                  {statusLabel(month.reconciliation_status)}
                </StatusBadge>
              </div>
              <div className="ui-row-between">
                <span className="ui-muted">
                  Thực lĩnh <strong className="num">{money(month.net_payable)}</strong>
                </span>
                <span className="ui-muted">
                  Đã trả <strong className="num">{money(month.paid)}</strong>
                </span>
                <span className="ui-muted">
                  Còn lại <strong className="num">{money(month.outstanding)}</strong>
                </span>
              </div>

              {month.payments
                .filter((payment) => payment.status === "completed")
                .map((payment) => (
                  <div className="hr-payment-row" key={payment.id}>
                    <span className="num">
                      {money(payment.amount)} · {payment.transaction_ref || "Chưa có mã giao dịch"}
                    </span>
                    <div className="ui-row">
                      {payment.evidence_missing ? (
                        <label className="ui-btn ui-btn--secondary ui-btn--sm ui-file-label">
                          <AppIcon name="upload" size={14} />
                          <span>Bổ sung chứng từ</span>
                          <input
                            aria-label="Chứng từ chuyển khoản"
                            type="file"
                            accept=".pdf,.png,.jpg,.jpeg"
                            disabled={busy}
                            onChange={(event) =>
                              uploadEvidence(payment.id, event.target.files?.[0])
                            }
                          />
                        </label>
                      ) : (
                        <a
                          className="ui-btn ui-btn--secondary ui-btn--sm"
                          href={api.payrollPaymentEvidenceUrl(payment.id)}
                        >
                          <AppIcon name="file-check" size={14} />
                          <span>{payment.evidence_name || "Xem chứng từ"}</span>
                        </a>
                      )}
                      <AppButton
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => setCancelTargetId(payment.id)}
                      >
                        Hủy
                      </AppButton>
                    </div>
                  </div>
                ))}
            </article>
          ))}
        </div>

        <SectionCard tone="subtle" padding="compact">
          <div className="ui-stack--lg">
            <h4 className="ui-text-strong">Ghi nhận chuyển lương</h4>
            <FormGrid cols={3}>
              <FormField label="Kỳ lương" htmlFor="hr-pay-month">
                <select
                  id="hr-pay-month"
                  className="ui-select"
                  value={paymentMonth}
                  onChange={(event) => {
                    const value = event.target.value;
                    setPaymentMonth(value);
                    const month = employee.months.find((item) => item.month === value);
                    setAmount(String(month?.outstanding || ""));
                  }}
                >
                  {employee.months.map((month) => (
                    <option value={month.month} key={month.month}>
                      {month.month}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Số tiền đã chuyển" htmlFor="hr-pay-amount">
                <input
                  id="hr-pay-amount"
                  className="ui-input"
                  aria-label="Số tiền đã chuyển"
                  type="number"
                  min="1"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </FormField>

              <FormField label="Ngày chuyển" htmlFor="hr-pay-date">
                <input
                  id="hr-pay-date"
                  className="ui-input"
                  aria-label="Ngày chuyển lương"
                  type="date"
                  value={paidAt}
                  onChange={(event) => setPaidAt(event.target.value)}
                />
              </FormField>

              <FormField label="Ngân hàng" htmlFor="hr-pay-bank">
                <input
                  id="hr-pay-bank"
                  className="ui-input"
                  value={bankName}
                  onChange={(event) => setBankName(event.target.value)}
                />
              </FormField>

              <FormField label="Mã giao dịch" htmlFor="hr-pay-ref">
                <input
                  id="hr-pay-ref"
                  className="ui-input"
                  value={transactionRef}
                  onChange={(event) => setTransactionRef(event.target.value)}
                />
              </FormField>

              <FormField label="Thao tác">
                <AppButton
                  variant="primary"
                  leftIcon="check"
                  fullWidth
                  loading={busy}
                  disabled={
                    employee.months.find((item) => item.month === paymentMonth)
                      ?.reconciliation_status === "pending_revision"
                  }
                  onClick={recordPayment}
                >
                  Ghi nhận đã chuyển
                </AppButton>
              </FormField>
            </FormGrid>
          </div>
        </SectionCard>

        <PromptDialog
          open={cancelTargetId !== null}
          title="Hủy giao dịch thanh toán"
          label="Lý do hủy"
          placeholder="Nhập lý do hủy giao dịch thanh toán"
          confirmLabel="Xác nhận hủy"
          cancelLabel="Đóng"
          onConfirm={confirmCancelPayment}
          onCancel={() => setCancelTargetId(null)}
        />
      </div>
    </SectionCard>
  );
}
