import { DataView, InlineAlert, SectionCard, StatusBadge } from "../../components/ui";
import { formatVND } from "./helpers";

const COST_ROWS = [
  { year: "2025", cat: "Hàng hóa / Vật tư", count: 30, pretax: 25213357, vat: 2015467, nature: "Linh kiện điện tử, dây mạng, adapter nguồn (HĐ Cổng thuế)" },
  { year: "2025", cat: "Dịch vụ / Vận hành", count: 17, pretax: 43305743, vat: 3464458, nature: "Dịch vụ kế toán Nextstep, cước vận chuyển Grab/Be, viễn thông" },
  { year: "2026", cat: "Hàng hóa / Linh kiện", count: 84, pretax: 433852771, vat: 33194063, nature: "Màn hình Tomko (219M), linh kiện BNS (50M), nhôm Kadotech" },
  { year: "2026", cat: "Dịch vụ / Gia công", count: 42, pretax: 249032731, vat: 4697418, nature: "Gia công mạch PCB ZenoPCB (28M), mua ngoại tệ & phí Techcombank" },
  { year: "2026", cat: "Hải quan Nhập khẩu", count: 5, pretax: 171524153, vat: 13721932, nature: "5 tờ khai nhập khẩu A11/A12 (màn hình, cảm biến, bo mạch IoT)" },
];

const HIGH_VALUE_PURCHASES = [
  { so_hd: "773", ngay: "13/08/2026", ncc: "CÔNG TY TNHH TM THIẾT BỊ HIỂN THỊ VIỆT NAM", mst: "0108570238", pretax: 219166667, vat: 17533333, tot: 236700000, note: "UNC Techcombank 236.7M" },
  { so_hd: "402", ngay: "03/08/2026", ncc: "CÔNG TY TNHH NOLULU", mst: "0317735028", pretax: 33544444, vat: 2683556, tot: 36228000, note: "UNC Techcombank 36.2M" },
  { so_hd: "69", ngay: "26/08/2026", ncc: "CÔNG TY TNHH CÔNG NGHỆ ĐIỆN TỬ ZENOPCB", mst: "0318774051", pretax: 23700000, vat: 1896000, tot: 25596000, note: "UNC Techcombank 25.6M" },
];

export function CostsTab() {
  return (
    <div className="ui-stack--lg">
      <SectionCard
        title="Phân Bổ Chi Phí Mua Vào & Thuế GTGT Đầu Vào Khấu Trừ"
        subtitle="Phân loại rạch ròi giữa Hàng hóa (hang_hoa), Dịch vụ vận hành (dich_vu) và Hàng nhập khẩu hải quan"
        icon="briefcase"
        padding="flush"
        actions={<StatusBadge tone="brand" size="sm">Tổng 173 HĐ mua vào + 5 Tờ khai hải quan</StatusBadge>}
      >
        <DataView
          mobileMode="scroll"
          desktop={
            <table className="ui-table ui-table-sticky-col td-matrix-table">
              <thead>
                <tr>
                  <th>Năm</th>
                  <th>Nhóm chi phí</th>
                  <th className="ui-text-center">Số chứng từ</th>
                  <th className="ui-text-right">Giá trị trước thuế</th>
                  <th className="ui-text-right">Thuế GTGT đầu vào</th>
                  <th>Bản chất kinh tế &amp; Chứng từ đối ứng</th>
                </tr>
              </thead>
              <tbody>
                {COST_ROWS.map((row) => (
                  <tr key={`${row.year}-${row.cat}`}>
                    <td>{row.year}</td>
                    <td className="ui-text-strong">{row.cat}</td>
                    <td className="ui-text-center">{row.count}</td>
                    <td className="ui-text-right ui-mono ui-nowrap ui-text-strong">{formatVND(row.pretax)}</td>
                    <td className="ui-text-right ui-mono ui-nowrap ui-text-warning">{formatVND(row.vat)}</td>
                    <td className="ui-text-xs">{row.nature}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        />
      </SectionCard>

      <InlineAlert
        tone="warning"
        title="Quy định bắt buộc lưu chứng từ thanh toán không dùng tiền mặt (Điều 15 TT 219/2013/TT-BTC)"
      >
        Hóa đơn từ 20 triệu đồng trở lên bắt buộc phải có chứng từ thanh toán qua ngân hàng (UNC/Sao kê) để bảo toàn quyền khấu trừ thuế GTGT đầu vào.
      </InlineAlert>

      <SectionCard
        title="Danh Mục Hóa Đơn Mua Vào >= 20 Triệu Đồng (Bắt Buộc Lưu Kèm UNC Ngân Hàng)"
        icon="alert-triangle"
        padding="flush"
      >
        <DataView
          mobileMode="scroll"
          desktop={
            <table className="ui-table ui-table-sticky-col td-matrix-table">
              <thead>
                <tr>
                  <th>Số HĐ / Ngày</th>
                  <th>Nhà cung cấp</th>
                  <th>Mã số thuế</th>
                  <th className="ui-text-right">Giá trị trước thuế</th>
                  <th className="ui-text-right">Thuế GTGT khấu trừ</th>
                  <th className="ui-text-right">Tổng thanh toán</th>
                  <th className="ui-text-center">Hồ sơ bắt buộc</th>
                </tr>
              </thead>
              <tbody>
                {HIGH_VALUE_PURCHASES.map((h) => (
                  <tr key={h.so_hd}>
                    <td>HĐ {h.so_hd} · {h.ngay}</td>
                    <td className="ui-text-strong">{h.ncc}</td>
                    <td className="ui-mono ui-nowrap">{h.mst}</td>
                    <td className="ui-text-right ui-mono ui-nowrap">{formatVND(h.pretax)}</td>
                    <td className="ui-text-right ui-mono ui-nowrap ui-text-warning">{formatVND(h.vat)}</td>
                    <td className="ui-text-right ui-mono ui-nowrap ui-text-brand">{formatVND(h.tot)}</td>
                    <td className="ui-text-center">
                      <StatusBadge tone="success" size="sm" icon="check">
                        {h.note}
                      </StatusBadge>
                    </td>
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
