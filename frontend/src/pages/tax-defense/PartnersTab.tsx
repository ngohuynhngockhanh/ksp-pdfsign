import type { FormEvent } from "react";
import type {
  TaxDefenseInvestigationReport,
  TaxDefensePartnerItem,
  TaxDefensePartnerStatusReport,
} from "../../api";
import {
  AppButton,
  AppIcon,
  AppModal,
  DataView,
  EmptyState,
  FormGrid,
  InlineAlert,
  KpiStrip,
  SectionCard,
  StatusBadge,
  TableSkeleton,
} from "../../components/ui";
import { safeHttpUrl } from "../../utils/url";
import { formatVND, OFFICIAL_REFERERS, type SingleMstResult } from "./helpers";

interface PartnersTabProps {
  partnerReport: TaxDefensePartnerStatusReport | null;
  investigationReport: TaxDefenseInvestigationReport | null;
  loadingPartners: boolean;
  syncingGdt: boolean;
  onSyncGdt: () => void;
  singleMstQuery: string;
  onSingleMstQueryChange: (val: string) => void;
  singleMstResult: SingleMstResult | null;
  checkingMst: boolean;
  onCheckSingleMst: (e: FormEvent) => void;
  partnerFilter: "all" | "risk_only";
  onPartnerFilterChange: (f: "all" | "risk_only") => void;
  selectedPartnerModal: TaxDefensePartnerItem | null;
  onSelectPartnerModal: (p: TaxDefensePartnerItem | null) => void;
}

export function PartnersTab({
  partnerReport,
  investigationReport,
  loadingPartners,
  syncingGdt,
  onSyncGdt,
  singleMstQuery,
  onSingleMstQueryChange,
  singleMstResult,
  checkingMst,
  onCheckSingleMst,
  partnerFilter,
  onPartnerFilterChange,
  selectedPartnerModal,
  onSelectPartnerModal,
}: PartnersTabProps) {
  const filteredPartners = (partnerReport?.partners || []).filter((p) =>
    partnerFilter === "risk_only" ? p.is_abandoned || p.is_closed : true,
  );
  const gdtPublicHref = safeHttpUrl("https://congkhaithongtin.gdt.gov.vn");
  const gdtLookupHref = safeHttpUrl("https://tracuunnt.gdt.gov.vn/tcnnt/mstdn.jsp");

  return (
    <div className="ui-stack--lg">
      <KpiStrip
        columns={4}
        className="td-kpi"
        loading={loadingPartners && !partnerReport}
        items={[
          {
            label: "Tổng đối tác rà soát",
            value: `${partnerReport?.total_checked || 0} doanh nghiệp`,
            sub: "Toàn bộ người mua & người bán",
            icon: "building-2",
            tone: "neutral",
          },
          {
            label: "Đang hoạt động bình thường",
            value: `${partnerReport?.active_count || 0} đối tác`,
            sub: "Trạng thái 00 (Được cấp GCN)",
            icon: "check-circle",
            tone: "success",
          },
          {
            label: "Cảnh báo Trạng thái 06",
            value: `${partnerReport?.abandoned_count || 0} đối tác`,
            sub: "Không hoạt động tại địa chỉ đăng ký",
            icon: "shield-alert",
            tone: "danger",
          },
          {
            label: "Doanh số phát sinh rủi ro",
            value: formatVND(partnerReport?.high_risk_amount || 0),
            sub: "Cần kẹp chứng từ giao hàng & UNC",
            icon: "alert-triangle",
            tone: "warning",
          },
        ]}
      />

      <SectionCard
        title="Cổng Thông Tin Công Quyền Đối Chứng (Official Authority Referers)"
        subtitle="Các cổng tra cứu chính thống của Nhà nước phục vụ trích dẫn số hiệu công văn và ngày công khai khi làm việc với Đoàn Thanh tra Thuế:"
        icon="landmark"
        padding="compact"
      >
        <div className="ui-grid-cards-md">
          {OFFICIAL_REFERERS.map((ref) => {
            const href = safeHttpUrl(ref.url);
            return (
              <div key={ref.url} className="ui-subpanel ui-stack--xs">
                <div className="ui-text-strong">{ref.title}</div>
                <div className="ui-muted">{ref.desc}</div>
                {href && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ui-link"
                  >
                    <AppIcon name="external-link" size={14} />
                    <span>{ref.linkLabel}</span>
                  </a>
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard
        title="Chuyên Đề Rà Soát Doanh Nghiệp Điều Tra Mua Bán Hóa Đơn (Công Văn 1798/TCT-TTKT)"
        subtitle="Đối soát toàn diện giữa Danh sách 524 Doanh nghiệp rủi ro (Chuyên án Công an tỉnh Phú Thọ / Tổng cục Thuế) với CSDL Hóa đơn INUT"
        icon="shield-alert"
        actions={
          <AppButton
            variant="danger"
            size="sm"
            leftIcon="refresh"
            loading={syncingGdt}
            onClick={onSyncGdt}
          >
            {syncingGdt ? "Đang đồng bộ..." : "Đồng Bộ HĐ Mua Cổng Thuế (2022-2025)"}
          </AppButton>
        }
      >
        <FormGrid cols={2}>
          <div className="ui-subpanel ui-subpanel--md ui-stack ui-subpanel--danger">
            <div className="ui-row-between">
              <span className="ui-row ui-mono ui-nowrap ui-text-danger">
                <AppIcon name="arrow-down" size={15} />
                <span>HÓA ĐƠN MUA VÀO (ĐẦU VÀO) — CẦN GIẢI TRÌNH</span>
              </span>
              <StatusBadge tone="danger" variant="outline" size="sm">
                {investigationReport?.input_risks.total_invoices || 13} hóa đơn
              </StatusBadge>
            </div>

            <div className="ui-text-xs">
              Tổng giá trị chưa thuế:{" "}
              <strong>{formatVND(investigationReport?.input_risks.total_pretax || 178552201)}</strong> · Tiền thuế GTGT:{" "}
              <strong>{formatVND(investigationReport?.input_risks.total_vat || 17000534)}</strong>
            </div>

            <InlineAlert tone="danger" title="Căn cứ thanh tra">
              Cơ quan thuế sẽ kiểm tra tính có thật của vật tư. Nếu không chứng minh được, tiền thuế GTGT sẽ bị loại khấu trừ và loại chi phí thuế TNDN.
            </InlineAlert>

            <div className="ui-scroll-sm">
              <DataView
                mobileMode="scroll"
                desktop={
                  <table className="ui-table ui-table-sticky-col td-matrix-table">
                    <thead>
                      <tr>
                        <th>HĐ / Ngày</th>
                        <th>Nhà cung cấp</th>
                        <th className="ui-text-right">Tổng tiền</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(investigationReport?.input_risks.invoices || []).slice(0, 8).map((inv) => (
                        <tr key={inv.id}>
                          <td>HĐ {inv.so_hd} ({inv.ngay})</td>
                          <td>
                            <div className="ui-text-strong">{inv.ten_ban}</div>
                            <div className="ui-muted ui-mono ui-nowrap">MST: {inv.mst_ban}</div>
                          </td>
                          <td className="ui-text-right ui-mono ui-nowrap ui-text-danger">{formatVND(inv.tong_tien)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                }
              />
            </div>
          </div>

          <div className="ui-subpanel ui-subpanel--md ui-stack ui-subpanel--success">
            <div className="ui-row-between">
              <span className="ui-row ui-mono ui-nowrap ui-text-success">
                <AppIcon name="arrow-up" size={15} />
                <span>HÓA ĐƠN BÁN RA (ĐẦU RA) — AN TOÀN TUYỆT ĐỐI</span>
              </span>
              <StatusBadge tone="success" variant="outline" size="sm">
                {investigationReport?.output_risks.total_invoices || 9} hóa đơn
              </StatusBadge>
            </div>

            <div className="ui-text-xs">
              Khách hàng: <strong>CÔNG TY TNHH TM DV KHÁNH LỢI</strong> (MST: 0316764844 - Tên cũ Long Ích Hoa trong DS 524). Tổng tiền thanh toán:{" "}
              <strong>{formatVND(investigationReport?.output_risks.total_payment || 159060000)}</strong> · Thuế GTGT đầu ra:{" "}
              <strong>{formatVND(investigationReport?.output_risks.total_vat || 14460000)}</strong>
            </div>

            <InlineAlert tone="success" title="Bảo vệ pháp lý">
              INUT là bên nộp thuế, đã hoàn thành nộp 100% tiền thuế đầu ra vào NSNN. Việc khách hàng sau đó bị điều tra mua bán hóa đơn không làm ảnh hưởng tính hợp pháp của doanh thu INUT.
            </InlineAlert>

            <div className="ui-scroll-sm">
              <DataView
                mobileMode="scroll"
                desktop={
                  <table className="ui-table ui-table-sticky-col td-matrix-table">
                    <thead>
                      <tr>
                        <th>Số HĐ</th>
                        <th>Ngày lập</th>
                        <th className="ui-text-right">Tổng tiền</th>
                        <th className="ui-text-center">Trạng thái CQT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(investigationReport?.output_risks.invoices || []).map((inv) => (
                        <tr key={inv.id}>
                          <td>HĐ {inv.so_hd}</td>
                          <td>{inv.ngay}</td>
                          <td className="ui-text-right ui-mono ui-nowrap ui-text-success">{formatVND(inv.tong_tien)}</td>
                          <td className="ui-text-center">
                            <StatusBadge tone="success" size="sm" icon="check">
                              Cấp mã CQT
                            </StatusBadge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                }
              />
            </div>
          </div>
        </FormGrid>
      </SectionCard>

      <SectionCard
        title="Tra Cứu Nhanh Tình Trạng Mã Số Thuế Bất Kỳ"
        icon="search"
        padding="compact"
      >
        <div className="ui-stack--lg">
          <form onSubmit={onCheckSingleMst} className="ui-row">
            <input
              type="text"
              className="ui-input ui-grow"
              value={singleMstQuery}
              onChange={(e) => onSingleMstQueryChange(e.target.value)}
              placeholder="Nhập MST doanh nghiệp cần kiểm tra (VD: 0316764844)..."
              aria-label="Mã số thuế doanh nghiệp cần kiểm tra"
            />
            <AppButton
              type="submit"
              variant="primary"
              leftIcon="search"
              loading={checkingMst}
              disabled={checkingMst || !singleMstQuery.trim()}
            >
              {checkingMst ? "Đang tra cứu..." : "Kiểm Tra Trạng Thái"}
            </AppButton>
          </form>

          {singleMstResult && (
            <InlineAlert
              tone={singleMstResult.is_abandoned ? "danger" : "success"}
              title={
                <span className="ui-row">
                  <span>{singleMstResult.company_name}</span>
                  <span className="ui-mono ui-nowrap ui-muted">(MST: {singleMstResult.mst})</span>
                  <StatusBadge
                    tone={singleMstResult.is_abandoned ? "danger" : "success"}
                    size="sm"
                  >
                    {singleMstResult.status_desc}
                  </StatusBadge>
                </span>
              }
            >
              <div>
                <strong>Địa chỉ:</strong> {singleMstResult.address || "Chưa có địa chỉ"}
              </div>
              <div>
                <strong>Hướng giải trình:</strong> {singleMstResult.defense_note}
              </div>
            </InlineAlert>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Bảng Đối Soát Tình Trạng Pháp Lý Toàn Bộ Đối Tác (Người Mua & Người Bán)"
        subtitle="Tự động phân loại rủi ro hóa đơn và đưa ra khuyến nghị đối phó thanh tra"
        icon="users"
        padding="flush"
        actions={
          <div className="ui-row">
            <AppButton
              variant={partnerFilter === "all" ? "primary" : "secondary"}
              size="sm"
              aria-pressed={partnerFilter === "all"}
              onClick={() => onPartnerFilterChange("all")}
            >
              Tất cả ({partnerReport?.total_checked || 0})
            </AppButton>
            <AppButton
              variant={partnerFilter === "risk_only" ? "danger" : "secondary"}
              size="sm"
              leftIcon="shield-alert"
              aria-pressed={partnerFilter === "risk_only"}
              onClick={() => onPartnerFilterChange("risk_only")}
            >
              Cảnh báo Trạng thái 06 ({partnerReport?.abandoned_count || 0})
            </AppButton>
          </div>
        }
      >
        {loadingPartners ? (
          <TableSkeleton rows={5} cols={7} />
        ) : (
          <DataView
            mobileMode="scroll"
            empty={
              filteredPartners.length === 0 ? (
                <EmptyState
                  compact
                  icon="shield-check"
                  title="Không có đối tác phù hợp bộ lọc"
                  description="Chuyển về bộ lọc Tất cả để xem danh mục toàn bộ người mua và người bán."
                />
              ) : undefined
            }
            desktop={
              <table className="ui-table ui-table-sticky-col td-matrix-table">
                <thead>
                  <tr>
                    <th>Mã số thuế</th>
                    <th>Tên đối tác</th>
                    <th>Vai trò</th>
                    <th className="ui-text-right">Tổng giao dịch</th>
                    <th className="ui-text-center">Năm phát sinh</th>
                    <th>Trạng thái hoạt động</th>
                    <th className="ui-text-center">Đánh giá rủi ro</th>
                    <th className="ui-text-center">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPartners.map((p) => {
                    const isKhSo = p.is_abandoned;
                    return (
                      <tr key={p.mst} className={isKhSo ? "td-row-danger" : undefined}>
                        <td className="ui-mono ui-nowrap">{p.mst}</td>
                        <td>
                          <div className={isKhSo ? "ui-mono ui-nowrap ui-text-danger" : "ui-text-strong"}>{p.name}</div>
                          <div className="ui-muted">{p.address}</div>
                        </td>
                        <td className="ui-text-xs">{p.role}</td>
                        <td className={`ui-text-right ${isKhSo ? "ui-mono ui-nowrap ui-text-danger" : "ui-mono ui-nowrap ui-text-brand"}`}>
                          {formatVND(p.total_amount)}
                        </td>
                        <td className="ui-text-center ui-muted">{p.years.join(", ")}</td>
                        <td>
                          <StatusBadge
                            tone={isKhSo ? "danger" : p.is_suspended ? "warning" : "success"}
                            size="sm"
                          >
                            {p.status_desc}
                          </StatusBadge>
                        </td>
                        <td className="ui-text-center">
                          <StatusBadge
                            tone={isKhSo ? "danger" : p.risk_level === "medium" ? "warning" : "success"}
                            variant="solid"
                            size="sm"
                          >
                            {isKhSo ? "CAO (TT 06)" : p.risk_level === "medium" ? "TRUNG BÌNH" : "AN TOÀN"}
                          </StatusBadge>
                        </td>
                        <td className="ui-text-center">
                          <AppButton
                            variant={isKhSo ? "danger" : "secondary"}
                            size="sm"
                            leftIcon={isKhSo ? "shield-alert" : undefined}
                            onClick={() => onSelectPartnerModal(p)}
                          >
                            {isKhSo ? "Xem Giải Trình" : "Chi tiết"}
                          </AppButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            }
          />
        )}
      </SectionCard>

      <AppModal
        open={!!selectedPartnerModal}
        onClose={() => onSelectPartnerModal(null)}
        title={selectedPartnerModal ? selectedPartnerModal.name : ""}
        subtitle={selectedPartnerModal ? `MST: ${selectedPartnerModal.mst} · ${selectedPartnerModal.role}` : undefined}
        size="md"
        footer={
          <AppButton variant="secondary" onClick={() => onSelectPartnerModal(null)}>
            Đóng
          </AppButton>
        }
      >
        {selectedPartnerModal && (
          <div className="ui-stack--lg">
            <div
              className={`ui-subpanel ui-stack--xs${selectedPartnerModal.is_abandoned ? " ui-subpanel--danger" : ""}`}
            >
              <div className={selectedPartnerModal.is_abandoned ? "ui-mono ui-nowrap ui-text-danger" : "ui-text-strong"}>
                Trạng thái thuế: {selectedPartnerModal.status_desc}
              </div>
              <div className="ui-text-xs">
                <strong>Địa chỉ đăng ký:</strong> {selectedPartnerModal.address || "Chưa rõ"}
              </div>
              <div className="ui-text-xs">
                <strong>Giao dịch phát sinh:</strong> {selectedPartnerModal.invoice_count} hóa đơn (
                {formatVND(selectedPartnerModal.total_amount)}) các năm {selectedPartnerModal.years.join(", ")}
              </div>
            </div>

            <div className="ui-stack--sm">
              <div className="ui-row ui-text-strong">
                <AppIcon name="shield-check" size={16} />
                <span>Căn Cứ Giải Trình Bảo Vệ Pháp Lý (Tax Defense Doctrine):</span>
              </div>
              <p className="ui-text-xs">{selectedPartnerModal.defense_note}</p>
              {selectedPartnerModal.mst === "0316764844" && (
                <InlineAlert tone="success" title="Giao dịch bán hàng (Đầu ra):">
                  INUT đã xuất hóa đơn có mã CQT hợp lệ năm 2024 và đã nộp đủ 14,46 triệu VNĐ tiền thuế GTGT vào NSNN. Việc khách hàng Khánh Lợi sau đó bỏ địa chỉ kinh doanh hoàn toàn không ảnh hưởng đến doanh thu hợp pháp của INUT.
                </InlineAlert>
              )}
            </div>

            <div className="ui-stack--sm">
              <span className="ui-muted ui-text-strong">Tra cứu trực tiếp cơ quan thẩm quyền:</span>
              <div className="ui-row">
                {gdtPublicHref && (
                  <a
                    href={gdtPublicHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ui-link"
                  >
                    <AppIcon name="external-link" size={14} />
                    <span>Cổng công khai GDT</span>
                  </a>
                )}
                {gdtLookupHref && (
                  <a
                    href={gdtLookupHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ui-link"
                  >
                    <AppIcon name="external-link" size={14} />
                    <span>Tra cứu NNT</span>
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </AppModal>
    </div>
  );
}
