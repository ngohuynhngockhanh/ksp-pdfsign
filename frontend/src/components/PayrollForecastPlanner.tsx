import { useEffect, useState } from "react";
import { api, PayrollForecast } from "../api";
import {
  DataView,
  EmptyState,
  FormField,
  InlineAlert,
  KpiStrip,
  SectionCard,
  SkeletonBlock,
  StatusBadge,
} from "./ui";

const money = (value = 0) => new Intl.NumberFormat("vi-VN").format(value);
const monthLabel = (value: string) => {
  const [year, month] = value.split("-");
  return month && year ? `T${Number(month)} · ${year}` : value;
};

function isForecast(value: unknown): value is PayrollForecast {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PayrollForecast>;
  return (
    Array.isArray(row.future_months) &&
    Array.isArray(row.scenarios) &&
    Array.isArray(row.employees) &&
    !!row.recommended
  );
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
    api
      .payrollForecast(year, growthRate)
      .then((result) => {
        if (!current) return;
        if (!isForecast(result)) throw new Error("Dữ liệu dự báo chưa sẵn sàng.");
        setForecast(result);
      })
      .catch((reason) => {
        if (current) setError((reason as Error).message);
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [growthRate, year]);

  return (
    <section aria-label="Dự báo lương và kịch bản thưởng cuối năm">
      <SectionCard
        eyebrow="MÔ PHỎNG DÒNG TIỀN · TNCN"
        title="Kịch bản lương & thưởng cuối năm"
        subtitle="Dự phóng các tháng còn lại và so sánh số thưởng thực nhận sau thuế."
        icon="trending-up"
        actions={
          <FormField label="Tăng trưởng lương dự kiến" htmlFor="payroll-growth-select">
            <select
              id="payroll-growth-select"
              aria-label="Tăng trưởng lương dự kiến"
              className="ui-select"
              value={growthRate}
              onChange={(event) => setGrowthRate(Number(event.target.value))}
            >
              <option value={-0.05}>Giảm 5% / tháng</option>
              <option value={0}>Giữ nguyên</option>
              <option value={0.05}>Tăng 5% / tháng</option>
              <option value={0.1}>Tăng 10% / tháng</option>
            </select>
          </FormField>
        }
      >
        <div className="ui-stack--lg">
          {busy && !forecast && <SkeletonBlock variant="card" lines={3} />}
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}

          {forecast && (
            <>
              <KpiStrip
                columns={3}
                items={[
                  {
                    label: "Phương án cân bằng",
                    value: money(forecast.recommended.gross_bonus),
                    sub: "Tổng thưởng đề xuất",
                    tone: "brand",
                    icon: "award",
                  },
                  {
                    label: "Thuế TNCN tăng",
                    value: money(forecast.recommended.additional_pit),
                    sub: `${(forecast.recommended.effective_tax_rate * 100).toLocaleString("vi-VN")}% tiền thưởng`,
                    tone: "warning",
                    icon: "percent",
                  },
                  {
                    label: "Nhân viên thực nhận",
                    value: money(forecast.recommended.net_bonus),
                    sub: "Thưởng sau thuế ước tính",
                    tone: "success",
                    icon: "wallet",
                  },
                ]}
              />

              <div className="payroll-forecast-grid">
                <SectionCard tone="subtle" padding="compact">
                  <div className="ui-stack--lg">
                    <div className="ui-row-between">
                      <h3 className="ui-text-strong">Các tháng tiếp theo</h3>
                      <StatusBadge tone="neutral" size="sm">
                        Thực tế đến {monthLabel(forecast.actual_through)}
                      </StatusBadge>
                    </div>
                    {forecast.future_months.length > 0 ? (
                      <div
                        className="payroll-month-strip"
                        tabIndex={0}
                        aria-label="Dự phóng lương các tháng tiếp theo"
                      >
                        {forecast.future_months.map((month) => (
                          <article className="ui-stat-tile ui-text-xs" key={month.month}>
                            <StatusBadge tone="brand" size="sm">
                              {monthLabel(month.month)}
                            </StatusBadge>
                            <strong>{money(month.net_payable)}</strong>
                            <span className="ui-muted">Thực lĩnh dự kiến</span>
                            <span className="ui-muted">Gross {money(month.gross_income)}</span>
                            <span className="ui-muted">TNCN {money(month.pit_estimate)}</span>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        compact
                        icon="calendar"
                        title="Đã có đủ dữ liệu đến cuối năm."
                      />
                    )}
                  </div>
                </SectionCard>

                <SectionCard tone="subtle" padding="compact">
                  <div className="ui-stack--lg">
                    <div className="ui-row-between">
                      <h3 className="ui-text-strong">So sánh kịch bản thưởng</h3>
                      <span className="ui-muted">Gross → thuế tăng → thực nhận</span>
                    </div>
                    <DataView
                      mobileMode="scroll"
                      desktop={
                        <table
                          className="dt ui-table"
                          aria-label="So sánh các kịch bản thưởng"
                        >
                          <thead>
                            <tr>
                              <th>Phương án</th>
                              <th className="num">Thưởng</th>
                              <th className="num">TNCN tăng</th>
                              <th className="num">Thực nhận</th>
                            </tr>
                          </thead>
                          <tbody>
                            {forecast.scenarios.map((scenario) => (
                              <tr key={scenario.key}>
                                <td>
                                  <strong>{scenario.label}</strong>
                                </td>
                                <td className="num">{money(scenario.gross_bonus)}</td>
                                <td className="num">{money(scenario.additional_pit)}</td>
                                <td className="num ui-text-success">
                                  {money(scenario.net_bonus)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      }
                    />
                  </div>
                </SectionCard>
              </div>

              {!!forecast.employees.length && (
                <SectionCard tone="subtle" padding="compact">
                  <div className="ui-stack--lg">
                    <div className="ui-row-between">
                      <h3 className="ui-text-strong">Đề xuất theo nhân viên</h3>
                      <span className="ui-muted">
                        Giữ thưởng trong khoảng hợp lý trước bậc thuế kế tiếp
                      </span>
                    </div>
                    <DataView
                      mobileMode="scroll"
                      desktop={
                        <table
                          className="dt ui-table"
                          aria-label="Bảng đề xuất thưởng theo nhân viên"
                        >
                          <thead>
                            <tr>
                              <th>Nhân viên</th>
                              <th className="num">Lương tham chiếu</th>
                              <th className="num">Thưởng đề xuất</th>
                              <th className="num">TNCN tăng</th>
                              <th className="num">Thực nhận</th>
                            </tr>
                          </thead>
                          <tbody>
                            {forecast.employees.map((employee) => (
                              <tr key={employee.employee_id}>
                                <td>
                                  <strong>{employee.name}</strong>
                                </td>
                                <td className="num">{money(employee.reference_monthly_gross)}</td>
                                <td className="num">{money(employee.recommended_bonus)}</td>
                                <td className="num">{money(employee.additional_pit)}</td>
                                <td className="num ui-text-success">
                                  {money(employee.net_bonus)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      }
                    />
                  </div>
                </SectionCard>
              )}

              <InlineAlert tone="warning" title="Lưu ý pháp lý">
                <div>
                  Đây là mô phỏng để lập ngân sách, không phải cách né thuế. Thưởng thực tế phải
                  đúng quy chế, quyết định và được quyết toán TNCN theo thu nhập cả năm.
                </div>
                {(forecast.assumptions || []).map((assumption) => (
                  <div key={assumption}>• {assumption}</div>
                ))}
              </InlineAlert>
            </>
          )}
        </div>
      </SectionCard>
    </section>
  );
}
