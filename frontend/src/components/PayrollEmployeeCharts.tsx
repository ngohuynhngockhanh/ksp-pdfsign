import { useEffect, useMemo, useState } from "react";
import { PayrollHrEmployee, PayrollHrMonth } from "../api";

const money = (value = 0) => new Intl.NumberFormat("vi-VN").format(value);

interface Props {
  employees: PayrollHrEmployee[];
}

interface Series {
  key: keyof Pick<PayrollHrMonth, "gross_income" | "net_payable" | "employee_insurance" | "pit_withheld">;
  label: string;
  className: string;
}

const salarySeries: Series[] = [
  { key: "gross_income", label: "Tổng thu nhập", className: "gross" },
  { key: "net_payable", label: "Thực lĩnh", className: "net" },
];

const deductionSeries: Series[] = [
  { key: "employee_insurance", label: "BHXH người lao động", className: "insurance" },
  { key: "pit_withheld", label: "Thuế TNCN", className: "pit" },
];

export function PayrollEmployeeCharts({ employees }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<number> | null>(null);
  const employeeIds = useMemo(() => new Set(employees.map((employee) => employee.employee_id)), [employees]);

  useEffect(() => {
    setSelectedIds((current) => {
      if (current === null) return new Set(employeeIds);
      return new Set([...current].filter((id) => employeeIds.has(id)));
    });
  }, [employeeIds]);

  const selected = employees.filter((employee) => selectedIds?.has(employee.employee_id));
  const toggleEmployee = (employeeId: number) => {
    setSelectedIds((current) => {
      const next = new Set(current ?? []);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  };

  return <section className="hr-charts" aria-labelledby="hr-charts-title">
    <header className="hr-charts-head">
      <div>
        <p className="eyebrow">SO SÁNH THEO THÁNG</p>
        <h3 id="hr-charts-title">Biểu đồ lương và thuế</h3>
        <p>Mỗi nhân viên dùng thang đo riêng để theo dõi biến động qua các tháng.</p>
      </div>
      <div className="hr-chart-actions">
        <button type="button" onClick={() => setSelectedIds(new Set(employeeIds))}>Chọn tất cả</button>
        <button type="button" onClick={() => setSelectedIds(new Set())}>Bỏ chọn</button>
      </div>
    </header>
    <fieldset className="hr-chart-selector">
      <legend>Nhân viên hiển thị</legend>
      {employees.map((employee) => <label key={employee.employee_id}>
        <input type="checkbox" checked={selectedIds?.has(employee.employee_id) ?? false}
          onChange={() => toggleEmployee(employee.employee_id)} />
        <span>Hiển thị {employee.name}</span>
      </label>)}
    </fieldset>
    {!selected.length ? <p className="hr-chart-empty">Chọn ít nhất một nhân viên để xem biểu đồ.</p> :
      <div className="hr-chart-rows">{selected.map((employee) => <EmployeeChartRow key={employee.employee_id} employee={employee} />)}</div>}
  </section>;
}

function EmployeeChartRow({ employee }: { employee: PayrollHrEmployee }) {
  const months = [...employee.months].sort((left, right) => left.month.localeCompare(right.month));
  return <article className="hr-chart-row" aria-label={`Biểu đồ của ${employee.name}`}>
    <header><div><h4>{employee.name}</h4><span>{employee.position || employee.code}</span></div>
      <strong>{months.length} tháng có dữ liệu</strong></header>
    <div className="hr-chart-pair">
      <PayrollBarChart title="Thu nhập: tổng thu nhập và thực lĩnh" months={months} series={salarySeries} />
      <PayrollBarChart title="Khấu trừ: bảo hiểm và thuế TNCN" months={months} series={deductionSeries} />
    </div>
  </article>;
}

function PayrollBarChart({ title, months, series }: { title: string; months: PayrollHrMonth[]; series: Series[] }) {
  const width = Math.max(520, months.length * 92 + 76);
  const height = 230;
  const chartTop = 24;
  const chartBottom = 174;
  const chartHeight = chartBottom - chartTop;
  const maxValue = Math.max(1, ...months.flatMap((month) => series.map((item) => month[item.key])));
  const groupWidth = (width - 76) / Math.max(1, months.length);
  const barWidth = Math.min(24, (groupWidth - 18) / series.length);

  return <section className="hr-chart-card" aria-label={title}>
    <header><h5>{title}</h5><div className="hr-chart-legend">{series.map((item) =>
      <span key={item.key}><i className={item.className} />{item.label}</span>)}</div></header>
    <div className="hr-chart-scroll" tabIndex={0} aria-label={`${title}, cuộn ngang để xem đủ các tháng`}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ minWidth: width }} role="img" aria-label={title}>
        <line className="hr-chart-axis" x1="54" y1={chartBottom} x2={width - 12} y2={chartBottom} />
        {[0, 0.5, 1].map((ratio) => <g key={ratio}>
          <line className="hr-chart-grid" x1="54" y1={chartBottom - chartHeight * ratio} x2={width - 12} y2={chartBottom - chartHeight * ratio} />
          <text className="hr-chart-scale" x="48" y={chartBottom - chartHeight * ratio + 4} textAnchor="end">
            {money(Math.round(maxValue * ratio))}
          </text>
        </g>)}
        {months.map((month, monthIndex) => {
          const groupX = 64 + monthIndex * groupWidth;
          return <g key={month.month} tabIndex={0} aria-label={`${month.month}: ${series.map((item) => `${item.label} ${money(month[item.key])} đồng`).join(", ")}`}>
            <title>{month.month}: {series.map((item) => `${item.label} ${money(month[item.key])} đồng`).join(", ")}</title>
            {series.map((item, seriesIndex) => {
              const value = month[item.key];
              const barHeight = value === 0 ? 2 : Math.max(3, value / maxValue * chartHeight);
              return <rect key={item.key} className={`hr-chart-bar ${item.className}`}
                x={groupX + seriesIndex * (barWidth + 5)} y={chartBottom - barHeight}
                width={barWidth} height={barHeight} rx="3" />;
            })}
            <text className="hr-chart-month" x={groupX + (barWidth * series.length + 5) / 2} y="194" textAnchor="middle">
              {month.month.slice(5, 7)}/{month.month.slice(2, 4)}
            </text>
          </g>;
        })}
      </svg>
    </div>
    <div className="hr-chart-values">{months.map((month) => <div key={month.month}>
      <strong>{month.month}</strong>{series.map((item) => <span key={item.key}>{item.label}<b>{money(month[item.key])}</b></span>)}
    </div>)}</div>
  </section>;
}
