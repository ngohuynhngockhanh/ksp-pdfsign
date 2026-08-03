import { useEffect, useState } from "react";
import { api, PayrollForecast } from "../api";

const money = (value = 0) => new Intl.NumberFormat("vi-VN").format(value);
const monthLabel = (value: string) => {
  const [year, month] = value.split("-");
  return month && year ? `T${Number(month)} · ${year}` : value;
};

function isForecast(value: unknown): value is PayrollForecast {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PayrollForecast>;
  return Array.isArray(row.future_months) && Array.isArray(row.scenarios)
    && Array.isArray(row.employees) && !!row.recommended;
}

export function PayrollForecastPlanner({ year }: { year: number }) {
  const [growthRate, setGrowthRate] = useState(0);
  const [forecast, setForecast] = useState<PayrollForecast | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    setBusy(true);
    setError("");
    api.payrollForecast(year, growthRate)
      .then((result) => {
        if (!current) return;
        if (!isForecast(result)) throw new Error("Dữ liệu dự báo chưa sẵn sàng.");
        setForecast(result);
      })
      .catch((reason) => { if (current) setError((reason as Error).message); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [growthRate, year]);

  return <section className="payroll-forecast" aria-label="Dự báo lương và kịch bản thưởng cuối năm">
    <header className="payroll-forecast-head">
      <div><p className="eyebrow">MÔ PHỎNG DÒNG TIỀN · TNCN</p><h2>Kịch bản lương & thưởng cuối năm</h2>
        <p>Dự phóng các tháng còn lại và so sánh số thưởng thực nhận sau thuế.</p></div>
      <label>Tăng trưởng lương dự kiến
        <select aria-label="Tăng trưởng lương dự kiến" value={growthRate} onChange={(event) => setGrowthRate(Number(event.target.value))}>
          <option value={-0.05}>Giảm 5% / tháng</option><option value={0}>Giữ nguyên</option>
          <option value={0.05}>Tăng 5% / tháng</option><option value={0.1}>Tăng 10% / tháng</option>
        </select>
      </label>
    </header>
    {busy && !forecast && <p className="muted">Đang dựng kịch bản từ dữ liệu lương gần nhất…</p>}
    {error && <div className="payroll-forecast-error">{error}</div>}
    {forecast && <>
      <div className="payroll-recommendation">
        <div><span>PHƯƠNG ÁN CÂN BẰNG</span><strong>{money(forecast.recommended.gross_bonus)}</strong><small>Tổng thưởng đề xuất</small></div>
        <div><span>THUẾ TNCN TĂNG</span><strong>{money(forecast.recommended.additional_pit)}</strong><small>{(forecast.recommended.effective_tax_rate * 100).toLocaleString("vi-VN")}% tiền thưởng</small></div>
        <div className="net"><span>NHÂN VIÊN THỰC NHẬN</span><strong>{money(forecast.recommended.net_bonus)}</strong><small>Thưởng sau thuế ước tính</small></div>
      </div>

      <div className="payroll-forecast-grid">
        <section className="payroll-future-months">
          <header><h3>Các tháng tiếp theo</h3><span>Số thực tế đến {monthLabel(forecast.actual_through)}</span></header>
          <div className="payroll-month-strip" tabIndex={0} aria-label="Dự phóng lương các tháng tiếp theo">{forecast.future_months.map((month) => <article key={month.month}>
            <b>{monthLabel(month.month)}</b><strong>{money(month.net_payable)}</strong><small>Thực lĩnh dự kiến</small>
            <span>Gross {money(month.gross_income)}</span><span>TNCN {money(month.pit_estimate)}</span>
          </article>)}</div>
          {!forecast.future_months.length && <p className="muted">Đã có đủ dữ liệu đến cuối năm.</p>}
        </section>

        <section className="payroll-scenarios">
          <header><h3>So sánh kịch bản thưởng</h3><span>Gross → thuế tăng → thực nhận</span></header>
          <table className="payroll-scenario-table" aria-label="So sánh các kịch bản thưởng">
            <thead><tr className="payroll-scenario-row head"><th>Phương án</th><th>Thưởng</th><th>TNCN tăng</th><th>Thực nhận</th></tr></thead>
            <tbody>{forecast.scenarios.map((scenario) => <tr className="payroll-scenario-row" key={scenario.key}>
              <th>{scenario.label}</th><td>{money(scenario.gross_bonus)}</td>
              <td>{money(scenario.additional_pit)}</td><td><b>{money(scenario.net_bonus)}</b></td>
            </tr>)}</tbody>
          </table>
        </section>
      </div>

      {!!forecast.employees.length && <section className="payroll-bonus-people">
        <header><h3>Đề xuất theo nhân viên</h3><span>Giữ thưởng trong khoảng hợp lý trước bậc thuế kế tiếp</span></header>
        <div className="table-wrap" tabIndex={0} aria-label="Bảng đề xuất thưởng theo nhân viên"><table><thead><tr><th>Nhân viên</th><th>Lương tham chiếu</th><th>Thưởng đề xuất</th><th>TNCN tăng</th><th>Thực nhận</th></tr></thead>
          <tbody>{forecast.employees.map((employee) => <tr key={employee.employee_id}><td><strong>{employee.name}</strong></td>
            <td>{money(employee.reference_monthly_gross)}</td><td>{money(employee.recommended_bonus)}</td>
            <td>{money(employee.additional_pit)}</td><td><b>{money(employee.net_bonus)}</b></td></tr>)}</tbody></table></div>
      </section>}

      <footer className="payroll-forecast-note"><strong>Lưu ý pháp lý:</strong> Đây là mô phỏng để lập ngân sách, không phải cách né thuế. Thưởng thực tế phải đúng quy chế, quyết định và được quyết toán TNCN theo thu nhập cả năm.
        {(forecast.assumptions || []).map((assumption) => <span key={assumption}>• {assumption}</span>)}</footer>
    </>}
  </section>;
}
