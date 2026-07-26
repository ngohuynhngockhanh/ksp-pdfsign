import { useEffect, useState } from "react";
import { api, PayrollPeriod } from "../api";

const money = (value = 0) => new Intl.NumberFormat("vi-VN").format(value);

export function Payroll() {
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [selected, setSelected] = useState<PayrollPeriod | null>(null);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [message, setMessage] = useState("");

  async function load(preferred?: number) {
    const rows = await api.payrollPeriods();
    setPeriods(rows);
    setSelected(rows.find((row) => row.id === preferred) ?? rows[0] ?? null);
  }

  useEffect(() => { load().catch((e) => setMessage((e as Error).message)); }, []);

  async function act(action: () => Promise<PayrollPeriod>) {
    try {
      const row = await action();
      setMessage("Đã cập nhật kỳ lương.");
      await load(row.id);
    } catch (error) { setMessage((error as Error).message); }
  }

  return <div className="payroll-page">
    <section className="payroll-hero">
      <div><p className="eyebrow">NHÂN SỰ · 2026</p><h1>Bảng lương & kiểm soát tuân thủ</h1>
        <p>Tính chuẩn từ dữ liệu CRM, review Excel cũ và khóa sổ theo tháng.</p></div>
      <div className="payroll-actions">
        <input aria-label="Tháng lương" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        <button onClick={() => act(() => api.payrollCreatePeriod(month))}>Tạo tháng</button>
        <button className="secondary" onClick={async () => {
          try { const r = await api.payrollSyncDrive(); setMessage(`Đã đọc ${r.files.length} file từ Drive.`); }
          catch (e) { setMessage((e as Error).message); }
        }}>Sync Drive</button>
      </div>
    </section>
    {message && <div className="payroll-message">{message}</div>}
    <div className="payroll-layout">
      <aside className="payroll-periods"><h3>Các kỳ lương</h3>{periods.map((row) =>
        <button key={row.id} className={selected?.id === row.id ? "active" : ""} onClick={() => setSelected(row)}>
          <strong>{row.month}</strong><span>v{row.version} · {row.status}</span>
        </button>)}</aside>
      <section className="payroll-sheet">
        {!selected ? <div className="empty">Chưa có kỳ lương. Tạo tháng đầu tiên để bắt đầu.</div> : <>
          <header><div><h2>Tháng {selected.month}</h2><span className={`status ${selected.status}`}>{selected.status}</span></div>
            <div className="payroll-actions">
              <button disabled={selected.status === "locked"} onClick={() => act(() => api.payrollReview(selected.id))}>Review</button>
              <button disabled={selected.status !== "reviewed"} onClick={() => act(() => api.payrollLock(selected.id))}>Khóa sổ</button>
              <a className="button secondary" href={api.payrollExportUrl(selected.id)}>Xuất Excel</a>
            </div></header>
          {selected.findings.map((finding, i) => <div className={`finding ${finding.level}`} key={i}>{finding.message}</div>)}
          <div className="table-scroll"><table><thead><tr><th>Nhân viên</th><th>Ngày chuẩn</th><th>Ngày công</th><th>Gross</th><th>BH NV</th><th>TNCN</th><th>Thực lĩnh</th><th>Chi phí DN</th></tr></thead>
            <tbody>{selected.lines.map((line) => <tr key={line.id}><td><strong>{line.employee.code}</strong><small>{line.employee.name}</small></td>
              <td>{line.standard_days}</td><td><input aria-label={`Ngày công ${line.employee.code}`} type="number" disabled={selected.status === "locked"} defaultValue={line.actual_days}
                onBlur={(e) => act(() => api.payrollUpdateLine(selected.id, line.id, { actual_days: Number(e.target.value), standard_days: line.standard_days }))} /></td>
              <td>{money(line.computed.gross_income)}</td><td>{money(line.computed.employee_insurance)}</td><td>{money(line.computed.pit)}</td>
              <td className="net">{money(line.computed.net_income)}</td><td>{money(line.computed.total_employer_cost)}</td></tr>)}</tbody></table></div>
          <p className="legal-note">Chính sách 2026: giảm trừ 15,5/6,2 triệu; BH người lao động 10,5%; BH doanh nghiệp 21,5%; KPCĐ 2%; tiền ăn tối đa 1,2 triệu từ 01/07/2026. Kết quả cần kế toán review trước khi khóa.</p>
        </>}
      </section>
    </div>
  </div>;
}
