import type { FormEvent } from "react";
import type { BiddingContractorItem, BiddingWatchlistItem } from "../../api";
import {
  AppButton,
  AppIcon,
  AppModal,
  DataView,
  EmptyState,
  FormField,
  FormGrid,
  MobileCard,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  SectionCard,
  StatusBadge,
} from "../../components/ui";
import {
  BOOKMARK_STATUS_MAP,
  FIELDS,
  PROVINCES,
  WinRateProgressBar,
  formatVnd,
  generateContractorDossierMarkdown,
  type BookmarkModalState,
  type BookmarkStatusKey,
  type DetailModalTab,
} from "./biddingUtils";

/* ── Contractor Detail Modal ─────────────────────────────────────────────── */
export interface ContractorDetailModalProps {
  contractor: BiddingContractorItem | null;
  onClose: () => void;
  onOpenTenderDetail: (tbmtCode: string, initialTab?: DetailModalTab) => void;
  onCopyMarkdown: (md: string, contractorName: string) => void;
  onShareTelegram: (contractor: BiddingContractorItem) => void;
}

export function ContractorDetailModal({
  contractor,
  onClose,
  onOpenTenderDetail,
  onCopyMarkdown,
  onShareTelegram,
}: ContractorDetailModalProps) {
  return (
    <AppModal
      open={Boolean(contractor)}
      onClose={onClose}
      size="lg"
      title={
        contractor ? (
          <span className="ui-row">
            <span>{contractor.name}</span>
            <StatusBadge
              tone={contractor.total_won > 0 ? "danger" : "neutral"}
              size="sm"
            >
              {contractor.bidding_status_label}
            </StatusBadge>
          </span>
        ) : (
          ""
        )
      }
      subtitle={
        contractor ? (
          <span>
            Mã số thuế: <strong className="ui-mono">{contractor.tax_code}</strong>
            {contractor.address ? ` • ${contractor.address}` : ""}
          </span>
        ) : undefined
      }
      footer={
        contractor ? (
          <div className="ui-row-between ui-w-full">
            <div className="ui-row">
              <AppButton
                variant="secondary"
                size="sm"
                leftIcon="copy"
                title="Sao chép toàn bộ hồ sơ năng lực và danh sách gói thầu dạng Markdown"
                onClick={() =>
                  onCopyMarkdown(
                    generateContractorDossierMarkdown(contractor),
                    contractor.name,
                  )
                }
              >
                Xuất Báo Cáo Markdown / Sao chép
              </AppButton>
              <AppButton
                variant="primary"
                size="sm"
                leftIcon="send"
                title="Gửi cảnh báo hồ sơ nhà thầu qua Telegram"
                onClick={() => onShareTelegram(contractor)}
              >
                Gửi cảnh báo Telegram
              </AppButton>
            </div>
            <AppButton variant="secondary" size="sm" onClick={onClose}>
              Đóng
            </AppButton>
          </div>
        ) : undefined
      }
    >
      {contractor && (
        <div className="ui-stack--lg">
          <div className="ui-subpanel ui-subpanel--md ui-meta-grid">
            <div className="ui-meta-item">
              <span className="ui-inline ui-kicker">Tổng Gói Tham Gia</span>
              <span className="bid-price">{contractor.total_bids} gói</span>
            </div>
            <div className="ui-meta-item">
              <span className="ui-inline ui-kicker">Gói Đã Trúng Thầu</span>
              <span className="bid-price">{contractor.total_won} gói</span>
            </div>
            <div className="ui-meta-item">
              <span className="ui-inline ui-kicker">Tiến Độ Thắng Thầu (Win Rate)</span>
              <WinRateProgressBar
                won={contractor.total_won}
                total={contractor.total_bids}
                rate={contractor.win_rate_percent}
              />
            </div>
            <div className="ui-meta-item">
              <span className="ui-inline ui-kicker">Tổng Giá Trị Thắng</span>
              <span className="bid-price bid-price--won ui-mono">
                {contractor.total_won_value_formatted}
              </span>
            </div>
          </div>

          <SectionCard
            title="Danh Sách Gói Thầu Tiêu Biểu & Quyết Định Phê Duyệt"
            icon="clipboard-list"
            padding={
              contractor.highlight_won_packages &&
              contractor.highlight_won_packages.length > 0
                ? "flush"
                : "default"
            }
          >
            {contractor.highlight_won_packages &&
            contractor.highlight_won_packages.length > 0 ? (
              <DataView
                mobileMode="card"
                desktop={
                  <div className="table-wrap">
                    <table className="dt ui-table">
                      <thead>
                        <tr>
                          <th>Số TBMT</th>
                          <th>Tên Gói Thầu</th>
                          <th>Bên Mời Thầu</th>
                          <th className="ui-text-right">Giá Trúng Thầu</th>
                          <th className="ui-text-right">Tiết Kiệm</th>
                          <th>Quyết Định</th>
                        </tr>
                      </thead>
                      <tbody>
                        {contractor.highlight_won_packages.map((pkg, idx) => (
                          <tr key={idx}>
                            <td>
                              <AppButton
                                variant="secondary"
                                size="sm"
                                leftIcon="tag"
                                rightIcon="external-link"
                                title={`Bấm để xem chi tiết & E-HSMT ${pkg.tbmt_code}`}
                                onClick={() => onOpenTenderDetail(pkg.tbmt_code, "iframe")}
                              >
                                <span className="ui-mono">{pkg.tbmt_code}</span>
                              </AppButton>
                            </td>
                            <td>
                              <strong className="ui-meta-value">{pkg.tender_name}</strong>
                            </td>
                            <td>{pkg.procuring_entity}</td>
                            <td className="ui-text-right num">
                              <strong className="bid-price--won">
                                {formatVnd(pkg.won_price)}
                              </strong>
                            </td>
                            <td className="ui-text-right num">{pkg.discount_percent}%</td>
                            <td className="ui-mono ui-muted">
                              {pkg.decision_number} ({pkg.award_date})
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                }
                mobileCards={
                  <div className="ui-mobile-card-list">
                    {contractor.highlight_won_packages.map((pkg, idx) => (
                      <MobileCard key={idx}>
                        <MobileCardHeader
                          title={pkg.tender_name}
                          subtitle={pkg.procuring_entity}
                          badge={
                            <StatusBadge tone="success" size="sm">
                              Tiết kiệm {pkg.discount_percent}%
                            </StatusBadge>
                          }
                        />
                        <MobileCardGrid cols={2}>
                          <MobileCardRow
                            label="Số TBMT"
                            value={
                              <AppButton
                                variant="secondary"
                                size="sm"
                                leftIcon="tag"
                                rightIcon="external-link"
                                onClick={() => onOpenTenderDetail(pkg.tbmt_code, "iframe")}
                              >
                                <span className="ui-mono">{pkg.tbmt_code}</span>
                              </AppButton>
                            }
                            fullWidth
                          />
                          <MobileCardRow
                            label="Giá trúng thầu"
                            value={formatVnd(pkg.won_price)}
                            mono
                          />
                          <MobileCardRow
                            label="Quyết định"
                            value={`${pkg.decision_number} (${pkg.award_date})`}
                            mono
                          />
                        </MobileCardGrid>
                      </MobileCard>
                    ))}
                  </div>
                }
              />
            ) : (
              <EmptyState
                compact
                icon="building-2"
                title="Chưa ghi nhận gói thầu công lập trực tiếp"
                description="Đơn vị thường tham gia dưới tư cách nhà thầu phụ hoặc đối tác OEM trên e-GP."
              />
            )}
          </SectionCard>

          {contractor.ai_insight && (
            <div className="ui-subpanel ui-subpanel--md ui-stack--xs ui-subpanel--brand">
              <span className="ui-inline ui-text-xs ui-text-strong">
                <AppIcon name="bot" size={15} /> Đánh Giá Chiến Lược &amp; Cơ Hội Hợp Tác Bằng AI
              </span>
              <span>{contractor.ai_insight}</span>
            </div>
          )}
        </div>
      )}
    </AppModal>
  );
}

/* ── Bookmark Create / Edit Modal ────────────────────────────────────────── */
export interface BookmarkFormModalProps {
  item: BookmarkModalState | null;
  setItem: (val: BookmarkModalState | null) => void;
  onSave: () => void;
}

export function BookmarkFormModal({
  item,
  setItem,
  onSave,
}: BookmarkFormModalProps) {
  return (
    <AppModal
      open={Boolean(item)}
      onClose={() => setItem(null)}
      size="md"
      title={
        item
          ? item.existingId
            ? "Cập Nhật Thông Tin Gói Thầu"
            : "Thêm Vào Danh Sách Quan Tâm"
          : ""
      }
      subtitle="QUẢN LÝ CƠ HỘI DỰ THẦU"
      footer={
        <>
          <AppButton variant="secondary" onClick={() => setItem(null)}>
            Hủy
          </AppButton>
          <AppButton variant="primary" leftIcon="star" onClick={onSave}>
            Lưu vào theo dõi
          </AppButton>
        </>
      }
    >
      {item && (
        <div className="ui-stack">
          <div className="ui-subpanel ui-subpanel--md ui-stack--xs">
            <strong className="ui-meta-value">{item.tender.tender_name}</strong>
            <span className="ui-muted">
              Mã TBMT: {item.tender.tbmt_code} · Giá gói: {formatVnd(item.tender.bid_price)}
            </span>
          </div>

          <FormField label="Trạng thái pipeline dự thầu">
            <select
              className="ui-select"
              value={item.status}
              onChange={(e) =>
                setItem({ ...item, status: e.target.value as BookmarkStatusKey })
              }
            >
              {(Object.keys(BOOKMARK_STATUS_MAP) as BookmarkStatusKey[]).map((sKey) => (
                <option key={sKey} value={sKey}>
                  {BOOKMARK_STATUS_MAP[sKey].label} ({BOOKMARK_STATUS_MAP[sKey].desc})
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Ghi chú nội bộ (Chiến lược / Giá / Liên danh)">
            <textarea
              className="ui-textarea"
              rows={4}
              value={item.note}
              onChange={(e) => setItem({ ...item, note: e.target.value })}
              placeholder="Ghi chú phân công nhân sự lập E-HSDT, tính toán dự toán thiết bị, thỏa thuận liên danh..."
            />
          </FormField>
        </div>
      )}
    </AppModal>
  );
}

/* ── Watchlist Rule Create / Edit Modal ──────────────────────────────────── */
export interface WatchlistFormModalProps {
  rule: Partial<BiddingWatchlistItem> | null;
  setRule: (val: Partial<BiddingWatchlistItem> | null) => void;
  onSave: () => void;
}

export function WatchlistFormModal({
  rule,
  setRule,
  onSave,
}: WatchlistFormModalProps) {
  return (
    <AppModal
      open={Boolean(rule)}
      onClose={() => setRule(null)}
      size="md"
      title={
        rule ? (rule.id ? "Sửa Quy Tắc Săn Thầu" : "Tạo Quy Tắc Săn Thầu Mới") : ""
      }
      subtitle="BỘ LỌC SĂN THẦU TỰ ĐỘNG"
      footer={
        rule ? (
          <>
            <AppButton variant="secondary" onClick={() => setRule(null)}>
              Hủy
            </AppButton>
            <AppButton variant="primary" leftIcon="save" onClick={onSave}>
              {rule.id ? "Lưu thay đổi" : "Tạo quy tắc mới"}
            </AppButton>
          </>
        ) : undefined
      }
    >
      {rule && (
        <div className="ui-stack">
          <FormField label="Tên quy tắc bộ lọc" required>
            <input
              className="ui-input"
              type="text"
              value={rule.name || ""}
              onChange={(e) => setRule({ ...rule, name: e.target.value })}
              placeholder="VD: Thiết bị SCADA & IoT TP.HCM"
            />
          </FormField>

          <FormGrid cols={2}>
            <FormField label="Từ khóa tìm kiếm">
              <input
                className="ui-input"
                type="text"
                value={rule.keyword || ""}
                onChange={(e) => setRule({ ...rule, keyword: e.target.value })}
                placeholder="VD: SCADA, IoT, quan trắc"
              />
            </FormField>

            <FormField label="Lĩnh vực">
              <select
                className="ui-select"
                value={rule.field || ""}
                onChange={(e) => setRule({ ...rule, field: e.target.value })}
              >
                {FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </FormField>
          </FormGrid>

          <FormField label="Tỉnh / Thành phố mục tiêu">
            <select
              className="ui-select"
              value={rule.province || ""}
              onChange={(e) => setRule({ ...rule, province: e.target.value })}
            >
              {PROVINCES.map((p) => (
                <option key={p} value={p === "Tất cả" ? "" : p}>
                  {p}
                </option>
              ))}
            </select>
          </FormField>

          <FormGrid cols={2}>
            <FormField label="Giá tối thiểu (VND)">
              <input
                className="ui-input"
                type="number"
                value={rule.min_price ?? ""}
                onChange={(e) =>
                  setRule({
                    ...rule,
                    min_price: e.target.value ? Number(e.target.value) : null,
                  })
                }
                placeholder="0"
              />
            </FormField>

            <FormField label="Giá tối đa (VND)">
              <input
                className="ui-input"
                type="number"
                value={rule.max_price ?? ""}
                onChange={(e) =>
                  setRule({
                    ...rule,
                    max_price: e.target.value ? Number(e.target.value) : null,
                  })
                }
                placeholder="Không giới hạn"
              />
            </FormField>
          </FormGrid>

          <div className="ui-subpanel ui-subpanel--md ui-stack--xs">
            <div className="ui-row">
              <label className="ui-check-label">
                <input
                  type="checkbox"
                  checked={rule.is_active ?? true}
                  onChange={(e) => setRule({ ...rule, is_active: e.target.checked })}
                />
                <span>Kích hoạt tự động quét</span>
              </label>

              <label className="ui-check-label">
                <input
                  type="checkbox"
                  checked={rule.notify_telegram ?? true}
                  onChange={(e) =>
                    setRule({ ...rule, notify_telegram: e.target.checked })
                  }
                />
                <AppIcon name="send" size={14} />
                <span>Bắn tin cảnh báo Telegram</span>
              </label>
            </div>
          </div>
        </div>
      )}
    </AppModal>
  );
}

/* ── Import Dossier From Google Drive Modal ──────────────────────────────── */
export interface ImportDriveModalProps {
  open: boolean;
  url: string;
  setUrl: (val: string) => void;
  notes: string;
  setNotes: (val: string) => void;
  loading: boolean;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
}

export function ImportDriveModal({
  open,
  url,
  setUrl,
  notes,
  setNotes,
  loading,
  onClose,
  onSubmit,
}: ImportDriveModalProps) {
  return (
    <AppModal
      open={open}
      onClose={onClose}
      size="md"
      title="Nhập Hồ Sơ Thầu Từ Google Drive"
      subtitle="TỰ ĐỘNG HÓA THẨM ĐỊNH THẦU"
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose}>
            Hủy
          </AppButton>
          <AppButton
            type="submit"
            form="bidding-import-drive-form"
            variant="primary"
            leftIcon="zap"
            loading={loading}
          >
            {loading ? "Đang thẩm định..." : "Bắt Đầu Thẩm Định Đa Tác Nhân"}
          </AppButton>
        </>
      }
    >
      <form
        id="bidding-import-drive-form"
        onSubmit={onSubmit}
        className="ui-stack"
      >
        <FormField
          label="Đường dẫn thư mục Google Drive chứa hồ sơ thầu (DOCX / PDF)"
          required
          hint="Hỗ trợ đọc tự động toàn bộ tài liệu thuyết minh pháp lý, hợp đồng tương tự, BCTC, đối chiếu kỹ thuật, bảng giá Mẫu 12.1A."
        >
          <input
            className="ui-input"
            type="url"
            required
            placeholder="https://drive.google.com/drive/folders/..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </FormField>

        <FormField label="Ghi chú chỉ đạo thẩm định (nếu có)">
          <textarea
            className="ui-textarea"
            rows={3}
            placeholder="Ví dụ: Kiểm tra kỹ tính hợp lệ cty IoT, đối chiếu thiết bị iNut, kiểm tra lỗi placeholder..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </FormField>
      </form>
    </AppModal>
  );
}
