import { api } from "../../api";
import {
  AppButton,
  AppIcon,
  DataView,
  EmptyState,
  FilterBar,
  MobileCard,
  MobileCardActions,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  SectionCard,
  StatusBadge,
} from "../../components/ui";
import { safeHttpUrl } from "../../utils/url";
import { getMinistryTone, type StandardItem } from "./types";

interface StandardsSearchTabProps {
  searchQuery: string;
  selectedMinistry: string;
  standardsList: StandardItem[];
  loading: boolean;
  onSearchQueryChange: (value: string) => void;
  onMinistryChange: (value: string) => void;
  onSearch: () => void;
  onReset: () => void;
  onOpenDetail: (std: StandardItem) => void;
}

const MINISTRY_OPTIONS = [
  { value: "", label: "Tất cả Bộ quản lý" },
  { value: "BTTTT", label: "Bộ TT&TT (BTTTT)" },
  { value: "BKHCN", label: "Bộ KH&CN (BKHCN)" },
  { value: "BTNMT", label: "Bộ TN&MT (BTNMT)" },
  { value: "BCT", label: "Bộ Công Thương (BCT)" },
];

export function StandardsSearchTab({
  searchQuery,
  selectedMinistry,
  standardsList,
  loading,
  onSearchQueryChange,
  onMinistryChange,
  onSearch,
  onReset,
  onOpenDetail,
}: StandardsSearchTabProps) {
  const activeCount = (searchQuery.trim() ? 1 : 0) + (selectedMinistry ? 1 : 0);

  return (
    <div className="ui-stack--lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSearch();
        }}
      >
        <FilterBar
          collapsibleMobile
          search={{
            value: searchQuery,
            onChange: onSearchQueryChange,
            placeholder: "Gõ mã QCVN (117, 54, 101, TT10), tên quy chuẩn hoặc thiết bị...",
            ariaLabel: "Tìm quy chuẩn QCVN và TCVN",
          }}
          filters={
            <select
              className="ui-select"
              aria-label="Lọc theo Bộ quản lý"
              value={selectedMinistry}
              onChange={(e) => onMinistryChange(e.target.value)}
            >
              {MINISTRY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          }
          activeCount={activeCount}
          onReset={onReset}
          resetLabel="Đặt lại bộ lọc"
          actions={
            <AppButton type="submit" variant="primary" size="sm" leftIcon="search" loading={loading}>
              Tìm kiếm
            </AppButton>
          }
        />
      </form>

      <SectionCard
        title="Danh mục Quy chuẩn Kỹ thuật (QCVN / TCVN)"
        subtitle={`Hiển thị ${standardsList.length} quy chuẩn phù hợp`}
        icon="shield-check"
        padding="flush"
      >
        <DataView
          mobileMode="card"
          loading={loading}
          skeletonRows={5}
          skeletonCols={5}
          empty={
            standardsList.length === 0 ? (
              <EmptyState
                icon="file-search"
                title="Không tìm thấy quy chuẩn phù hợp"
                description={
                  searchQuery
                    ? `Không có quy chuẩn nào khớp từ khóa "${searchQuery}". Thử bỏ bộ lọc hoặc tìm theo mã số (vd: 54, 65, 117).`
                    : "Chưa có dữ liệu quy chuẩn cho bộ lọc hiện tại."
                }
                action={
                  activeCount > 0 ? (
                    <AppButton variant="secondary" size="sm" leftIcon="rotate-ccw" onClick={onReset}>
                      Đặt lại bộ lọc
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
                    <th>Mã QCVN</th>
                    <th>Tên quy chuẩn &amp; văn bản</th>
                    <th>Bộ QL</th>
                    <th>Thiết bị áp dụng &amp; HS Code</th>
                    <th className="col-act">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {standardsList.map((std) => {
                    const stdPdfUrl = safeHttpUrl(api.standards.getStandardPdfUrl(std.code));
                    return (
                      <tr key={std.code}>
                        <td>
                          <StatusBadge tone="brand" icon="tag">
                            <span className="ui-mono ui-wrap">{std.code}</span>
                          </StatusBadge>
                        </td>
                        <td>
                          <div className="ui-text-strong ui-wrap">{std.name}</div>
                          <div className="ui-muted">Văn bản: {std.circular}</div>
                        </td>
                        <td>
                          <StatusBadge tone={getMinistryTone(std.ministry)} size="sm">
                            {std.ministry}
                          </StatusBadge>
                        </td>
                        <td>
                          <div className="ui-text-body">{std.target_equipment}</div>
                          {std.applicable_hs_codes && std.applicable_hs_codes.length > 0 && (
                            <div className="ui-row">
                              {std.applicable_hs_codes.map((hs) => (
                                <StatusBadge key={hs} tone="warning" size="sm">
                                  <span className="ui-mono ui-wrap">{hs}</span>
                                </StatusBadge>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="col-act">
                          <div className="ui-row">
                            <AppButton
                              variant="secondary"
                              size="sm"
                              leftIcon="eye"
                              onClick={() => onOpenDetail(std)}
                            >
                              Chi tiết
                            </AppButton>
                            {stdPdfUrl && (
                              <a
                                href={stdPdfUrl}
                                download
                                className="ui-btn ui-btn--ghost ui-btn--sm"
                                aria-label={`Tải toàn văn PDF ${std.code}`}
                              >
                                <AppIcon name="file-down" size={14} />
                                <span>PDF</span>
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          }
          mobileCards={
            <div className="ui-mobile-card-list">
              {standardsList.map((std) => {
                const stdPdfUrl = safeHttpUrl(api.standards.getStandardPdfUrl(std.code));
                return (
                  <MobileCard key={std.code}>
                    <MobileCardHeader
                      title={std.name}
                      subtitle={<span className="ui-mono ui-wrap">{std.code}</span>}
                      badge={
                        <StatusBadge tone={getMinistryTone(std.ministry)} size="sm">
                          {std.ministry}
                        </StatusBadge>
                      }
                    />
                    <MobileCardGrid cols={1}>
                      <MobileCardRow label="Văn bản pháp lý" value={std.circular} fullWidth />
                      <MobileCardRow label="Thiết bị áp dụng" value={std.target_equipment} fullWidth />
                      {std.applicable_hs_codes && std.applicable_hs_codes.length > 0 && (
                        <MobileCardRow
                          label="Mã HS Code"
                          value={std.applicable_hs_codes.join(", ")}
                          mono
                          fullWidth
                        />
                      )}
                    </MobileCardGrid>
                    <MobileCardActions>
                      <AppButton
                        variant="primary"
                        size="sm"
                        leftIcon="eye"
                        onClick={() => onOpenDetail(std)}
                      >
                        Xem chi tiết
                      </AppButton>
                      {stdPdfUrl && (
                        <a href={stdPdfUrl} download className="ui-btn ui-btn--secondary ui-btn--sm">
                          <AppIcon name="file-down" size={14} />
                          <span>Tải toàn văn PDF</span>
                        </a>
                      )}
                    </MobileCardActions>
                  </MobileCard>
                );
              })}
            </div>
          }
        />
      </SectionCard>
    </div>
  );
}
