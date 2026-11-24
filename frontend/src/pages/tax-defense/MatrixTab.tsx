import type { TaxDefenseOverview, TaxDefenseSummaryItem } from "../../api";
import { DataView, EmptyState, FormGrid, SectionCard, StatusBadge } from "../../components/ui";
import { formatVND } from "./helpers";

interface MatrixTabProps {
  overview: TaxDefenseOverview;
  matrixRows: TaxDefenseSummaryItem[];
  selectedYear: string;
  onSelectedYearChange: (year: string) => void;
  totRevPretax: number;
}

const TIER_DEFS = [
  { key: "tier_1_under_10m", name: "Nhỏ (< 10 triệu)", desc: "Bán lẻ linh kiện, cáp, phụ kiện" },
  { key: "tier_2_10m_to_50m", name: "Vừa (10 - 50 triệu)", desc: "Đơn hàng bộ điều khiển, gateway đại lý" },
  { key: "tier_3_50m_to_100m", name: "Lớn (50 - 100 triệu)", desc: "Hợp đồng trạm quan trắc, tủ điện SCADA" },
  { key: "tier_4_over_100m", name: "Rất lớn (> 100 triệu)", desc: "Hợp đồng dự án nền tảng phần mềm lõi" },
];

const RATE_DEFS = [
  { key: "kct", name: "Không chịu thuế (KCT Phần mềm)", note: "Chỉ tiêu [26] - Khoản 21 Điều 4 TT219" },
  { key: "0%", name: "Thuế suất 0% (HĐ xuất khẩu / Ghi nhầm)", note: "Chỉ tiêu [29] - HĐ phần mềm cũ 2022-2023" },
  { key: "8%", name: "Thuế suất giảm 8% (NQ Quốc hội)", note: "Chỉ tiêu [32] - NQ 43, 101, 142, 204" },
  { key: "10%", name: "Thuế suất chuẩn 10%", note: "Chỉ tiêu [32] - Thiết bị phần cứng, camera" },
];

const TOP_CUSTOMERS = [
  { mst: "3702549702", name: "CÔNG TY CỔ PHẦN THƯƠNG MẠI ĐIỆN TỬ ALOHA", count: 4, amount: 1561100000, years: "2022 - 2023", desc: "Nền tảng phần mềm iNut Platform, SmartCity" },
  { mst: "0315862038", name: "CÔNG TY CỔ PHẦN CÔNG NGHỆ PHENIKAA MAAS", count: 32, amount: 732302946, years: "2022 - 2024", desc: "Thiết bị IoT, camera AI, bo mạch điều khiển" },
  { mst: "2800817718", name: "CÔNG TY CP ĐẦU TƯ PHÁT TRIỂN CÔNG NGHỆ TÂN THANH PHƯƠNG", count: 16, amount: 1052730000, years: "2023 - 2026", desc: "Hệ thống truyền thanh thông minh VN-MAP, License" },
  { mst: "5500649200", name: "CÔNG TY CỔ PHẦN KỸ THUẬT TỰ ĐỘNG HOÁ IOT", count: 23, amount: 581057344, years: "2024 - 2026", desc: "Thiết bị điều khiển nhà yến/nấm iNut Muro v2, cảm biến" },
  { mst: "0316764844", name: "CÔNG TY TNHH TM DV KHÁNH LỢI", count: 9, amount: 159060000, years: "2024", desc: "Thiết bị phần cứng công nghiệp, phụ kiện" },
];

function yearAuditFocus(year: string): string {
  if (year === "2022") return "88,6% DT Aloha phần mềm (KCT Chỉ tiêu [26])";
  if (year === "2023") return "Đỉnh cao Phenikaa Maas (589M) & HĐ thay thế #40-#41";
  if (year === "2024") return "Tái cấu trúc sang đại lý (Khánh Lợi, IOT), 100% HĐ < 50M";
  if (year === "2025") return "Phục hồi IoT (+31,6%), áp dụng giảm thuế 8% (NQ 204)";
  if (year === "2026") return "Doanh thu > 1 tỷ, chi phí 66,8% DT, khấu trừ 86,2% thuế";
  return "Đối soát chứng từ theo hóa đơn điện tử có mã CQT";
}

function activeDetailYears(selectedYear: string): string[] {
  if (selectedYear === "all" || selectedYear === "2022_2025") return ["2022", "2023", "2024", "2025"];
  if (selectedYear === "2018_2022") return ["2018", "2019", "2020", "2021", "2022"];
  return [selectedYear];
}

export function MatrixTab({
  overview,
  matrixRows,
  selectedYear,
  onSelectedYearChange,
  totRevPretax,
}: MatrixTabProps) {
  const detailYears = activeDetailYears(selectedYear);

  return (
    <div className="ui-stack--lg">
      <SectionCard
        title="Ma Trận Đối Chiếu Doanh Thu & Nghĩa Vụ Thuế Từng Năm"
        icon="bar-chart"
        padding="flush"
        actions={
          <div className="ui-row">
            <StatusBadge tone="brand" size="sm" icon="badge-check">
              100% khớp hóa đơn có mã CQT
            </StatusBadge>
            <select
              id="td-year-filter"
              aria-label="Lọc năm giải trình thuế"
              className="ui-select td-year-select"
              value={selectedYear}
              onChange={(e) => onSelectedYearChange(e.target.value)}
            >
              <option value="all">Toàn bộ chu kỳ (2018 – 2025)</option>
              <option value="2018_2022">Giai đoạn 2018 – 2022</option>
              <option value="2022_2025">Giai đoạn 2022 – 2025</option>
              <option value="2018">Năm 2018</option>
              <option value="2019">Năm 2019</option>
              <option value="2020">Năm 2020</option>
              <option value="2021">Năm 2021</option>
              <option value="2022">Năm 2022</option>
              <option value="2023">Năm 2023</option>
              <option value="2024">Năm 2024</option>
              <option value="2025">Năm 2025</option>
              <option value="2026">Năm 2026 (Tham chiếu)</option>
            </select>
          </div>
        }
      >
        <DataView
          mobileMode="scroll"
          empty={
            matrixRows.length === 0 ? (
              <EmptyState
                compact
                icon="bar-chart"
                title="Chưa có dữ liệu cho năm đã chọn"
                description="Chọn giai đoạn khác ở bộ lọc năm phía trên để đối chiếu ma trận doanh thu và nghĩa vụ thuế."
              />
            ) : undefined
          }
          desktop={
            <table className="ui-table ui-table-sticky-col td-matrix-table">
              <thead>
                <tr>
                  <th>Năm</th>
                  <th className="ui-text-center">Số HĐ Net</th>
                  <th className="ui-text-right">Doanh thu trước thuế</th>
                  <th className="ui-text-right">Thuế GTGT đầu ra</th>
                  <th className="ui-text-right">Tổng tiền thanh toán</th>
                  <th className="ui-text-center">Số HĐ Mua</th>
                  <th className="ui-text-right">Chi phí mua vào</th>
                  <th className="ui-text-right">Thuế vào khấu trừ</th>
                  <th className="ui-text-right">Tỷ lệ Chi phí/DT</th>
                  <th>Trọng tâm giải trình thanh tra</th>
                </tr>
              </thead>
              <tbody>
                {matrixRows.map((m) => (
                  <tr key={m.year}>
                    <td>{m.year}</td>
                    <td className="ui-text-center ui-text-strong">{m.sale_invoices_count}</td>
                    <td className="ui-text-right ui-mono ui-nowrap ui-text-brand">{formatVND(m.revenue_pretax)}</td>
                    <td className="ui-text-right ui-mono ui-nowrap ui-text-warning">{formatVND(m.revenue_vat)}</td>
                    <td className="ui-text-right ui-mono ui-nowrap ui-text-strong">{formatVND(m.revenue_payment)}</td>
                    <td className={`ui-text-center ${m.purchase_invoices_count > 0 ? "ui-mono ui-nowrap ui-text-brand" : "ui-muted"}`}>
                      {m.purchase_invoices_count > 0 ? m.purchase_invoices_count : "—"}
                    </td>
                    <td className="ui-text-right ui-mono ui-nowrap">
                      {m.cost_pretax > 0 ? formatVND(m.cost_pretax) : <span className="ui-text-italic">Định mức ~60%</span>}
                    </td>
                    <td className="ui-text-right ui-mono ui-nowrap">
                      {m.cost_vat_input > 0 ? formatVND(m.cost_vat_input) : "—"}
                    </td>
                    <td className={`ui-text-right ${m.cost_to_revenue_pct > 0 ? "ui-text-strong" : "ui-muted"}`}>
                      {m.cost_to_revenue_pct > 0 ? `${m.cost_to_revenue_pct}%` : "55 - 65% (ĐM)"}
                    </td>
                    <td className="ui-text-xs">{yearAuditFocus(m.year)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        />
      </SectionCard>

      <FormGrid cols={2}>
        <SectionCard title="Phân Bổ Phân Khúc Hóa Đơn (Tiers Analysis)" icon="layers" padding="compact">
          <div className="ui-stack--sm">
            {TIER_DEFS.map((tier) => {
              let cnt = 0;
              let amt = 0;
              detailYears.forEach((y) => {
                const tData = overview.revenue_details[y]?.tiers[tier.key];
                if (tData) {
                  cnt += tData.count;
                  amt += tData.amount;
                }
              });
              return (
                <div key={tier.key} className="ui-subpanel ui-stack--xs">
                  <div className="ui-row-between">
                    <span className="ui-text-strong">{tier.name}</span>
                    <span className="ui-mono ui-nowrap ui-text-brand">{formatVND(amt)}</span>
                  </div>
                  <div className="ui-row-between ui-muted">
                    <span>{tier.desc}</span>
                    <span>{cnt} hóa đơn</span>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard title="Cơ Cấu Doanh Thu Theo Thuế Suất" icon="percent" padding="compact">
          <div className="ui-stack--sm">
            {RATE_DEFS.map((rItem) => {
              let pAmt = 0;
              detailYears.forEach((y) => {
                const rData = overview.revenue_details[y]?.tax_rates[rItem.key];
                if (rData) pAmt += rData.pretax;
              });
              const pct = totRevPretax > 0 ? ((pAmt / totRevPretax) * 100).toFixed(1) : "0";
              return (
                <div key={rItem.key} className="ui-subpanel ui-stack--xs">
                  <div className="ui-row-between">
                    <span className="ui-text-strong">{rItem.name}</span>
                    <span className="ui-mono ui-nowrap ui-text-warning">{formatVND(pAmt)} ({pct}%)</span>
                  </div>
                  <div className="ui-muted">{rItem.note}</div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      </FormGrid>

      <SectionCard
        title="Top Khách Hàng Đóng Góp Doanh Thu Trọng Yếu (Cần Lưu Trữ UNC/Sao Kê)"
        icon="building-2"
        padding="flush"
      >
        <DataView
          mobileMode="scroll"
          desktop={
            <table className="ui-table ui-table-sticky-col td-matrix-table">
              <thead>
                <tr>
                  <th>Mã số thuế</th>
                  <th>Tên doanh nghiệp đối tác</th>
                  <th className="ui-text-center">Số HĐ</th>
                  <th className="ui-text-right">Tổng giá trị thanh toán</th>
                  <th>Giai đoạn phát sinh</th>
                  <th>Nội dung cung cấp</th>
                </tr>
              </thead>
              <tbody>
                {TOP_CUSTOMERS.map((cust) => (
                  <tr key={cust.mst}>
                    <td className="ui-mono ui-nowrap">{cust.mst}</td>
                    <td className="ui-text-strong">{cust.name}</td>
                    <td className="ui-text-center">{cust.count}</td>
                    <td className="ui-text-right ui-mono ui-nowrap ui-text-brand">{formatVND(cust.amount)}</td>
                    <td className="ui-muted">{cust.years}</td>
                    <td className="ui-text-xs">{cust.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        />
      </SectionCard>
    </div>
  );
}
