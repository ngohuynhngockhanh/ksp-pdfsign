import type {
  BkhcnRiskClassifyResult,
  BkhcnRiskItem,
  BkhcnRiskStatistics,
} from "../../api";
import {
  AppButton,
  AppIcon,
  DataView,
  EmptyState,
  FilterBar,
  FormField,
  FormGrid,
  InlineAlert,
  KpiStrip,
  MobileCard,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  SectionCard,
  StatusBadge,
} from "../../components/ui";
import { safeHttpUrl } from "../../utils/url";
import type { HsMapping } from "./types";

interface HsLookupTabProps {
  hsCodeInput: string;
  hsResult: HsMapping | null;
  onHsCodeInputChange: (val: string) => void;
  onLookup: (code?: string) => void;
  onOpenStandardByCode: (stdCode: string) => void;
  onNavigateRisk: () => void;
}

const SAMPLE_HS_CODES = [
  { code: "8473.30.10", label: "8473.30.10 (Bo mạch Rockchip)" },
  { code: "8471.41.90", label: "8471.41.90 (Máy tính nhúng)" },
  { code: "8517.62.59", label: "8517.62.59 (IoT Gateway 4G)" },
  { code: "8507.60.90", label: "8507.60.90 (Pin Lithium)" },
  { code: "9026.10.10", label: "9026.10.10 (Cảm biến đo mức)" },
  { code: "9028.30.10", label: "9028.30.10 (Công tơ điện tử)" },
];

export function HsLookupTab({
  hsCodeInput,
  hsResult,
  onHsCodeInputChange,
  onLookup,
  onOpenStandardByCode,
  onNavigateRisk,
}: HsLookupTabProps) {
  return (
    <div className="ui-stack--lg">
      <SectionCard
        title="Tra Cứu Thủ Tục Kiểm Tra Chuyên Ngành Theo Mã HS Code"
        subtitle="Nhập mã HS Code của linh kiện hoặc thiết bị nhập khẩu để kiểm tra diện quản lý chuyên ngành của Bộ TT&TT, Bộ KH&CN, Bộ TN&MT."
        icon="package"
      >
        <div className="ui-stack">
          <form
            className="ui-row ui-row--md ui-row--bottom"
            onSubmit={(e) => {
              e.preventDefault();
              onLookup();
            }}
          >
            <div className="ui-grow">
              <FormField label="Mã HS Code" htmlFor="std-hs-code-input">
                <input
                  id="std-hs-code-input"
                  type="text"
                  className="ui-input ui-mono ui-wrap"
                  placeholder="Nhập mã HS Code (vd: 8473.30.10, 8471.41.90, 8517.62.59, 8507.60.90)..."
                  value={hsCodeInput}
                  onChange={(e) => onHsCodeInputChange(e.target.value)}
                />
              </FormField>
            </div>
            <AppButton type="submit" variant="primary" leftIcon="search">
              Tra Cứu Ngay
            </AppButton>
          </form>

          <div className="ui-row">
            <span className="ui-muted">Gợi ý mã phổ biến:</span>
            {SAMPLE_HS_CODES.map((sample) => (
              <AppButton
                key={sample.code}
                variant="secondary"
                size="sm"
                onClick={() => {
                  onHsCodeInputChange(sample.code);
                  onLookup(sample.code);
                }}
              >
                <span className="ui-mono ui-wrap">{sample.label}</span>
              </AppButton>
            ))}
          </div>
        </div>
      </SectionCard>

      {hsResult && (
        <SectionCard
          title={hsResult.hs_description}
          subtitle={`Cơ quan quản lý: ${hsResult.customs_inspection_agency}`}
          icon="shield-check"
          actions={
            <StatusBadge tone="success" icon="tag">
              <span className="ui-mono ui-wrap">Mã HS: {hsResult.hs_code}</span>
            </StatusBadge>
          }
        >
          <div className="ui-stack">
            {hsResult.risk_classification && (
              <InlineAlert
                tone={
                  hsResult.risk_classification.annex === 1
                    ? "danger"
                    : hsResult.risk_classification.annex === 2
                      ? "warning"
                      : "success"
                }
                title={`Phân loại rủi ro (TT 36/2026/TT-BKHCN): ${hsResult.risk_classification.risk_label}`}
                action={
                  <AppButton
                    variant="secondary"
                    size="sm"
                    rightIcon="arrow-right"
                    onClick={onNavigateRisk}
                  >
                    Xem Danh Mục Rủi Ro
                  </AppButton>
                }
              >
                {hsResult.risk_classification.guidance}
              </InlineAlert>
            )}

            <FormGrid cols={2}>
              <div className="ui-subpanel ui-subpanel--md">
                <div className="ui-muted">Loại hình kiểm tra</div>
                <div className="ui-text-strong ui-wrap">{hsResult.inspection_type}</div>
              </div>
              <div className="ui-subpanel ui-subpanel--md">
                <div className="ui-muted">Thủ tục bắt buộc</div>
                <div className="ui-text-strong ui-wrap">{hsResult.required_procedure}</div>
              </div>
            </FormGrid>

            <div className="ui-stack">
              <div className="ui-text-strong ui-wrap">Quy Chuẩn Kỹ Thuật Bắt Buộc Áp Dụng</div>
              <div className="ui-row">
                {hsResult.applicable_standards.map((stdCode) => (
                  <AppButton
                    key={stdCode}
                    variant="secondary"
                    size="sm"
                    leftIcon="file-text"
                    rightIcon="external-link"
                    onClick={() => onOpenStandardByCode(stdCode)}
                  >
                    <span className="ui-mono ui-wrap">{stdCode}</span>
                  </AppButton>
                ))}
              </div>
            </div>

            <InlineAlert tone="warning" title="Lưu ý Hải quan & Giải phóng hàng">
              {hsResult.customs_notes}
            </InlineAlert>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

interface RiskClassificationTabProps {
  riskStats: BkhcnRiskStatistics | null;
  riskCatalog: BkhcnRiskItem[];
  riskCatalogTotal: number;
  riskCatalogPage: number;
  riskCatalogLimit: number;
  riskLevelFilter: string;
  riskGroupFilter: string;
  riskSearchQuery: string;
  riskLoading: boolean;
  riskClassifyInput: string;
  riskClassifyResult: BkhcnRiskClassifyResult | null;
  riskClassifying: boolean;
  onRiskClassifyInputChange: (val: string) => void;
  onClassifyRisk: (val?: string) => void;
  onRiskLevelFilterChange: (level: string) => void;
  onRiskGroupFilterChange: (group: string) => void;
  onRiskSearchQueryChange: (q: string) => void;
  onResetCatalogFilters: () => void;
  onPageChange: (page: number) => void;
}

const RISK_SAMPLE_CHIPS = [
  { code: "8517.62.59", label: "8517.62.59 (IoT Gateway 4G)" },
  { code: "8471.41.90", label: "8471.41.90 (Màn hình A11)" },
  { code: "8504.40.90", label: "8504.40.90 (Nguồn Adapter)" },
  { code: "6506.10.10", label: "6506.10.10 (Mũ bảo hiểm)" },
  { code: "9503.00.10", label: "9503.00.10 (Đồ chơi trẻ em)" },
  { code: "2710.12.21", label: "2710.12.21 (Xăng không chì)" },
  { code: "9026.10.90", label: "9026.10.90 (Cảm biến radar)" },
];

export function RiskClassificationTab({
  riskStats,
  riskCatalog,
  riskCatalogTotal,
  riskCatalogPage,
  riskCatalogLimit,
  riskLevelFilter,
  riskGroupFilter,
  riskSearchQuery,
  riskLoading,
  riskClassifyInput,
  riskClassifyResult,
  riskClassifying,
  onRiskClassifyInputChange,
  onClassifyRisk,
  onRiskLevelFilterChange,
  onRiskGroupFilterChange,
  onRiskSearchQueryChange,
  onResetCatalogFilters,
  onPageChange,
}: RiskClassificationTabProps) {
  const riskCircularPdfUrl = safeHttpUrl("/api/standards/risk-classification/pdf");
  const totalPages = Math.max(1, Math.ceil(riskCatalogTotal / riskCatalogLimit));
  const activeFilterCount =
    (riskSearchQuery.trim() ? 1 : 0) +
    (riskLevelFilter ? 1 : 0) +
    (riskGroupFilter ? 1 : 0);

  return (
    <div className="ui-stack--lg">
      <SectionCard
        eyebrow="Thông tư số 36/2026/TT-BKHCN · Bộ Khoa học và Công nghệ"
        title="Danh Mục Phân Loại Sản Phẩm, Hàng Hóa Mức Độ Rủi Ro Trung Bình & Cao"
        subtitle="Căn cứ Luật Chất lượng sản phẩm, hàng hóa (sửa đổi bởi Luật 78/2025/QH15) và Nghị định 37/2026/NĐ-CP — phân định rõ thẩm quyền KTCL, phương thức PT5/PT7 và điều kiện thông quan."
        icon="scale"
        actions={
          riskCircularPdfUrl ? (
            <a
              href={riskCircularPdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ui-btn ui-btn--gold ui-btn--sm"
            >
              <AppIcon name="file-down" size={14} />
              <span>Tải Bản Ký Số PDF (5.7 MB)</span>
            </a>
          ) : undefined
        }
      >
        {riskStats && (
          <KpiStrip
            columns={4}
            items={[
              {
                label: "Tổng mặt hàng quản lý",
                value: riskStats.total_items,
                sub: "Theo TT 36/2026/TT-BKHCN",
                icon: "layers",
                tone: "brand",
              },
              {
                label: "Rủi ro CAO (Phụ lục I)",
                value: riskStats.high_risk_count,
                sub: "KTCL trước thông quan (PT5/PT7)",
                icon: "alert-circle",
                tone: "danger",
                onClick: () => onRiskLevelFilterChange(riskLevelFilter === "CAO" ? "" : "CAO"),
                active: riskLevelFilter === "CAO",
              },
              {
                label: "Rủi ro TRUNG BÌNH (Phụ lục II)",
                value: riskStats.medium_risk_count,
                sub: "Công bố hợp quy / Hậu kiểm",
                icon: "alert-triangle",
                tone: "warning",
                onClick: () =>
                  onRiskLevelFilterChange(riskLevelFilter === "TRUNG_BINH" ? "" : "TRUNG_BINH"),
                active: riskLevelFilter === "TRUNG_BINH",
              },
              {
                label: "Mã HS Code đối soát",
                value: riskStats.unique_hs_count,
                sub: `${riskStats.groups_count} nhóm ngành kinh tế`,
                icon: "package",
                tone: "info",
              },
            ]}
          />
        )}
      </SectionCard>

      <SectionCard
        title="Tra Cứu Nhanh Cấp Độ Rủi Ro Theo Mã HS Hoặc Tên Hàng"
        subtitle="Nhập mã HS Code hoặc từ khóa thiết bị để bóc tách nghĩa vụ kiểm tra chất lượng (KTCL)."
        icon="search"
      >
        <div className="ui-stack">
          <form
            className="ui-row ui-row--md ui-row--bottom"
            onSubmit={(e) => {
              e.preventDefault();
              onClassifyRisk();
            }}
          >
            <div className="ui-grow">
              <FormField label="Mã HS Code hoặc tên hàng hóa" htmlFor="std-risk-classify-input">
                <input
                  id="std-risk-classify-input"
                  type="text"
                  className="ui-input ui-mono ui-wrap"
                  placeholder="Nhập mã HS Code hoặc từ khóa (vd: 8517.62.59, Gateway, Radar, Mũ bảo hiểm)..."
                  value={riskClassifyInput}
                  onChange={(e) => onRiskClassifyInputChange(e.target.value)}
                />
              </FormField>
            </div>
            <AppButton
              type="submit"
              variant="primary"
              leftIcon="scale"
              loading={riskClassifying}
            >
              Phân Loại Ngay
            </AppButton>
          </form>

          <div className="ui-row">
            <span className="ui-muted">Ví dụ mẫu:</span>
            {RISK_SAMPLE_CHIPS.map((chip) => (
              <AppButton
                key={chip.code}
                variant="secondary"
                size="sm"
                onClick={() => {
                  onRiskClassifyInputChange(chip.code);
                  onClassifyRisk(chip.code);
                }}
              >
                <span className="ui-mono ui-wrap">{chip.label}</span>
              </AppButton>
            ))}
          </div>

          {riskClassifyResult && (
            <SectionCard
              tone="subtle"
              padding="compact"
              title={
                riskClassifyResult.matched_item
                  ? riskClassifyResult.matched_item.product_name
                  : `Hàng hóa mã ${riskClassifyInput}`
              }
              subtitle={
                riskClassifyResult.matched_item?.group
                  ? `Thuộc nhóm: ${riskClassifyResult.matched_item.group}`
                  : undefined
              }
              actions={
                <div className="ui-row">
                  <StatusBadge
                    tone={
                      riskClassifyResult.annex === 1
                        ? "danger"
                        : riskClassifyResult.annex === 2
                          ? "warning"
                          : "success"
                    }
                    variant="solid"
                  >
                    {riskClassifyResult.risk_label}
                  </StatusBadge>
                  {riskClassifyResult.matched_item?.qcvn && (
                    <StatusBadge tone="brand" icon="tag" size="sm">
                      {riskClassifyResult.matched_item.qcvn}
                    </StatusBadge>
                  )}
                </div>
              }
            >
              <div className="ui-stack">
                <InlineAlert
                  tone={
                    riskClassifyResult.annex === 1
                      ? "danger"
                      : riskClassifyResult.annex === 2
                        ? "warning"
                        : "success"
                  }
                  title="Hướng dẫn quản lý & Hải quan"
                >
                  {riskClassifyResult.guidance}
                </InlineAlert>
                {riskClassifyResult.matched_item?.management_requirement && (
                  <div className="ui-muted">
                    <strong>Biện pháp cụ thể:</strong>{" "}
                    {riskClassifyResult.matched_item.management_requirement}
                  </div>
                )}
              </div>
            </SectionCard>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Bảng Danh Mục Chi Tiết Mặt Hàng Quản Lý Rủi Ro"
        subtitle={`Hiển thị ${riskCatalog.length} / ${riskCatalogTotal} mục tìm thấy`}
        icon="clipboard-list"
      >
        <div className="ui-stack">
          <FilterBar
            collapsibleMobile
            search={{
              value: riskSearchQuery,
              onChange: onRiskSearchQueryChange,
              placeholder: "Lọc theo tên hàng, mã HS, QCVN, mô tả...",
              ariaLabel: "Lọc danh mục rủi ro",
            }}
            filters={
              <>
                <select
                  className="ui-select"
                  aria-label="Lọc theo cấp độ rủi ro"
                  value={riskLevelFilter}
                  onChange={(e) => onRiskLevelFilterChange(e.target.value)}
                >
                  <option value="">Tất cả cấp độ</option>
                  <option value="CAO">Rủi ro CAO (Phụ lục I)</option>
                  <option value="TRUNG_BINH">Rủi ro TRUNG BÌNH (Phụ lục II)</option>
                </select>
                {riskStats?.groups && riskStats.groups.length > 0 && (
                  <select
                    className="ui-select"
                    aria-label="Lọc theo nhóm ngành"
                    value={riskGroupFilter}
                    onChange={(e) => onRiskGroupFilterChange(e.target.value)}
                  >
                    <option value="">Tất cả nhóm ngành ({riskStats.groups.length})</option>
                    {riskStats.groups.map((g) => (
                      <option key={g} value={g}>
                        {g.length > 50 ? `${g.slice(0, 50)}...` : g}
                      </option>
                    ))}
                  </select>
                )}
              </>
            }
            activeCount={activeFilterCount}
            onReset={onResetCatalogFilters}
            resetLabel="Xóa lọc"
          />

          <DataView
            mobileMode="card"
            loading={riskLoading}
            skeletonRows={6}
            skeletonCols={7}
            empty={
              riskCatalog.length === 0 ? (
                <EmptyState
                  icon="scale"
                  title="Không tìm thấy mặt hàng phù hợp"
                  description="Thử thay đổi bộ lọc cấp độ rủi ro, nhóm ngành hoặc từ khóa tìm kiếm."
                  action={
                    activeFilterCount > 0 ? (
                      <AppButton
                        variant="secondary"
                        size="sm"
                        leftIcon="rotate-ccw"
                        onClick={onResetCatalogFilters}
                      >
                        Xóa lọc
                      </AppButton>
                    ) : undefined
                  }
                />
              ) : undefined
            }
            desktop={
              <div className="ui-table-scroll-wrap" tabIndex={0}>
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th>STT</th>
                      <th>Cấp độ rủi ro</th>
                      <th>Mã HS Code</th>
                      <th>Tên sản phẩm / hàng hóa</th>
                      <th>Quy chuẩn (QCVN)</th>
                      <th>Yêu cầu quản lý / KTCL</th>
                      <th className="col-num">Trang</th>
                    </tr>
                  </thead>
                  <tbody>
                    {riskCatalog.map((item) => (
                      <tr key={item.id}>
                        <td className="ui-mono ui-wrap">{item.stt}</td>
                        <td>
                          <StatusBadge tone={item.annex === 1 ? "danger" : "warning"} size="sm">
                            {item.annex === 1 ? "Phụ lục I (CAO)" : "Phụ lục II (TB)"}
                          </StatusBadge>
                        </td>
                        <td className="ui-mono ui-wrap ui-text-strong ui-wrap">
                          {item.hs_codes && item.hs_codes.length > 0
                            ? item.hs_codes.join(", ")
                            : item.hs_raw || "—"}
                        </td>
                        <td>
                          <div className="ui-text-strong ui-wrap">{item.product_name}</div>
                          {item.description && item.description !== item.product_name && (
                            <div className="ui-muted">
                              {item.description.length > 120
                                ? `${item.description.slice(0, 120)}...`
                                : item.description}
                            </div>
                          )}
                        </td>
                        <td className="ui-text-strong ui-wrap">{item.qcvn || "—"}</td>
                        <td className="ui-muted">
                          {item.management_requirement
                            ? item.management_requirement.length > 160
                              ? `${item.management_requirement.slice(0, 160)}...`
                              : item.management_requirement
                            : "—"}
                        </td>
                        <td className="col-num ui-mono ui-wrap">p.{item.page}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            }
            mobileCards={
              <div className="ui-mobile-card-list">
                {riskCatalog.map((item) => (
                  <MobileCard key={item.id}>
                    <MobileCardHeader
                      title={item.product_name}
                      subtitle={`#${item.stt} · p.${item.page}`}
                      badge={
                        <StatusBadge tone={item.annex === 1 ? "danger" : "warning"} size="sm">
                          {item.annex === 1 ? "Phụ lục I (CAO)" : "Phụ lục II (TB)"}
                        </StatusBadge>
                      }
                    />
                    <MobileCardGrid cols={1}>
                      <MobileCardRow
                        label="Mã HS Code"
                        value={
                          item.hs_codes && item.hs_codes.length > 0
                            ? item.hs_codes.join(", ")
                            : item.hs_raw || "—"
                        }
                        mono
                        fullWidth
                      />
                      {item.qcvn && <MobileCardRow label="QCVN" value={item.qcvn} fullWidth />}
                      {item.management_requirement && (
                        <MobileCardRow
                          label="Yêu cầu KTCL"
                          value={
                            item.management_requirement.length > 160
                              ? `${item.management_requirement.slice(0, 160)}...`
                              : item.management_requirement
                          }
                          fullWidth
                        />
                      )}
                    </MobileCardGrid>
                  </MobileCard>
                ))}
              </div>
            }
          />

          {riskCatalogTotal > riskCatalogLimit && (
            <div className="ui-row-between ui-divider-top">
              <span className="ui-muted ui-mono ui-wrap">
                Trang {riskCatalogPage} / {totalPages}
              </span>
              <div className="ui-row">
                <AppButton
                  variant="secondary"
                  size="sm"
                  leftIcon="arrow-left"
                  disabled={riskCatalogPage <= 1 || riskLoading}
                  onClick={() => onPageChange(riskCatalogPage - 1)}
                >
                  Trang trước
                </AppButton>
                <AppButton
                  variant="secondary"
                  size="sm"
                  rightIcon="arrow-right"
                  disabled={riskCatalogPage >= totalPages || riskLoading}
                  onClick={() => onPageChange(riskCatalogPage + 1)}
                >
                  Trang sau
                </AppButton>
              </div>
            </div>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
