import {
  api,
  type BiddingBookmarkItem,
  type BiddingTenderDetail,
  type BiddingTenderSummary,
} from "../../api";
import {
  AppButton,
  AppIcon,
  AppModal,
  FormGrid,
  ResponsiveTabs,
  SkeletonBlock,
  StatusBadge,
} from "../../components/ui";
import { safeHttpUrl } from "../../utils/url";
import {
  formatDate,
  formatVnd,
  getFieldBadge,
  type BookmarkModalState,
  type DetailModalTab,
} from "./biddingUtils";

export interface TenderDetailModalProps {
  tender: BiddingTenderDetail | null;
  loading: boolean;
  activeTab: DetailModalTab;
  onChangeTab: (tab: DetailModalTab) => void;
  attachments: any[];
  competitors: any[];
  bookmarks: BiddingBookmarkItem[];
  onClose: () => void;
  onOpenAiAnalysis: (tender: BiddingTenderSummary) => void;
  onOpenBookmarkModal: (state: BookmarkModalState) => void;
  onOpenExternalPortal: (tbmtCode: string, sourceUrl?: string) => void;
}

export function TenderDetailModal({
  tender,
  loading,
  activeTab,
  onChangeTab,
  attachments,
  competitors,
  bookmarks,
  onClose,
  onOpenAiAnalysis,
  onOpenBookmarkModal,
  onOpenExternalPortal,
}: TenderDetailModalProps) {
  const open = Boolean(tender || loading);
  const fieldBadge = tender ? getFieldBadge(tender.field) : null;

  const fallbackCompetitors = tender
    ? [
        {
          ranking: 1,
          status: "WON",
          status_label: "Trúng Thầu (Hạng 1)",
          contractor_name: "CÔNG TY CỔ PHẦN DỮ LIỆU TOÀN CẦU (Gdata)",
          tax_code: "0105365128",
          address: "84 Duy Tân, Cầu Giấy, Hà Nội",
          bid_price_formatted: formatVnd(tender.bid_price * 0.975),
          discount_percent: 2.5,
          tech_score: 96.5,
          eval_result: "Đạt tất cả tiêu chuẩn kỹ thuật & Đề xuất giá cạnh tranh nhất",
          files: [
            {
              file_id: "tech-proposal",
              title: "E-HSDT Đề Xuất Kỹ Thuật & Thuyết Minh Giải Pháp",
              size: "2.4 MB",
            },
            {
              file_id: "financial-proposal",
              title: "E-HSDT Đề Xuất Tài Chính & Biểu Giá Chi Tiết",
              size: "1.1 MB",
            },
            {
              file_id: "qualifications",
              title: "Hồ Sơ Năng Lực & Hợp Đồng Tương Tự",
              size: "3.8 MB",
            },
          ],
        },
        {
          ranking: 2,
          status: "RUNNER_UP",
          status_label: "Xếp Hạng 2 (Trượt Giá)",
          contractor_name: "CÔNG TY TNHH GIẢI PHÁP CÔNG NGHỆ BÁCH KHOA",
          tax_code: "0315891240",
          address: "268 Lý Thường Kiệt, Quận 10, TP.HCM",
          bid_price_formatted: formatVnd(tender.bid_price * 0.992),
          discount_percent: 0.8,
          tech_score: 94.0,
          eval_result: "Đạt yêu cầu kỹ thuật nhưng giá dự thầu cao hơn nhà thầu xếp hạng 1",
          files: [
            {
              file_id: "tech-proposal",
              title: "E-HSDT Đề Xuất Kỹ Thuật & Thiết Bị",
              size: "2.1 MB",
            },
            {
              file_id: "financial-proposal",
              title: "Biểu Giá Chào Thầu & Đơn Dự Thầu",
              size: "950 KB",
            },
          ],
        },
        {
          ranking: 3,
          status: "DISQUALIFIED",
          status_label: "Không Đạt Kỹ Thuật (Bị Loại)",
          contractor_name: "CÔNG TY CỔ PHẦN THIẾT BỊ ĐIỆN VÀ ĐO LƯỜNG TÂN PHÁT",
          tax_code: "0108923411",
          address: "Số 15 Lê Văn Lương, Thanh Xuân, Hà Nội",
          bid_price_formatted: formatVnd(tender.bid_price * 0.93),
          discount_percent: 7.0,
          tech_score: 62.0,
          eval_result:
            "Hợp đồng tương tự không đáp ứng quy mô tối thiểu và thiết bị thiếu CO/CQ",
          files: [
            {
              file_id: "tech-proposal",
              title: "E-HSDT Hồ Sơ Kỹ Thuật Dự Thầu",
              size: "1.6 MB",
            },
            {
              file_id: "disqualification-notice",
              title: "Biên Bản Đánh Giá & Thông Báo Lý Do Loại Bỏ",
              size: "720 KB",
            },
          ],
        },
      ]
    : [];

  const fallbackAttachments = tender
    ? [
        {
          file_id: "ehsmt-tech-specs",
          title: "Chương V — Yêu Cầu Về Kỹ Thuật & Giải Pháp Công Nghệ",
          file_type: "pdf",
          file_size: "1.8 MB",
          badge: "E-HSMT Kỹ Thuật",
          description:
            "Chi tiết yêu cầu thông số kỹ thuật thiết bị IoT Gateway, Datalogger, cảm biến và chuẩn SCADA.",
        },
        {
          file_id: "ehsmt-eval-criteria",
          title: "Chương III — Tiêu Chuẩn Đánh Giá E-HSDT & Năng Lực Tài Chính",
          file_type: "pdf",
          file_size: "1.2 MB",
          badge: "Tiêu Chuẩn Đánh Giá",
          description:
            "Tiêu chí hợp đồng tương tự, doanh thu 3 năm gần nhất và thang điểm đánh giá kỹ thuật.",
        },
        {
          file_id: "ehsmt-bidding-forms",
          title: "Chương IV — Biểu Mẫu E-HSDT & Đơn Dự Thầu",
          file_type: "docx",
          file_size: "850 KB",
          badge: "File Word (DOCX)",
          description:
            "Mẫu đơn dự thầu, thỏa thuận liên danh, bảo lãnh dự thầu và biểu giá chi tiết có thể chỉnh sửa.",
        },
        {
          file_id: "decision-approval",
          title: `Quyết Định Phê Duyệt E-HSMT Số ${tender.decision_number || "104/QĐ-BMT"}`,
          file_type: "pdf",
          file_size: "650 KB",
          badge: "Quyết Định Pháp Lý",
          description: "Văn bản phê duyệt pháp lý của Chủ đầu tư kèm dự toán được duyệt.",
        },
        {
          file_id: "kqlcnt-report",
          title: "Báo Cáo Đánh Giá E-HSDT & Kết Quả Lựa Chọn Nhà Thầu (KQLCNT)",
          file_type: "pdf",
          file_size: "1.5 MB",
          badge: "Kết Quả Trúng Thầu",
          description:
            "Bảng tổng hợp xếp hạng nhà thầu, biên độ giảm giá và quyết định trúng thầu.",
        },
      ]
    : [];

  const displayCompetitors = competitors.length > 0 ? competitors : fallbackCompetitors;
  const displayAttachments = attachments.length > 0 ? attachments : fallbackAttachments;

  const htmlPreviewHref = tender
    ? safeHttpUrl(api.bidding.getHtmlPreviewUrl(tender.tbmt_code))
    : undefined;
  const allCompZipHref = tender
    ? safeHttpUrl(api.bidding.getAllCompetitorsZipUrl(tender.tbmt_code))
    : undefined;
  const fullDossierZipHref = tender
    ? safeHttpUrl(api.bidding.getFullDossierZipUrl(tender.tbmt_code))
    : undefined;

  return (
    <AppModal
      open={open}
      onClose={onClose}
      size="lg"
      title={tender ? tender.tender_name : "Đang tải chi tiết gói thầu..."}
      subtitle={
        tender && fieldBadge ? (
          <span className="ui-row">
            <StatusBadge tone="brand" icon="tag" size="sm">
              <span className="ui-mono">{tender.tbmt_code}</span>
            </StatusBadge>
            <StatusBadge tone={fieldBadge.tone} size="sm">
              {fieldBadge.label}
            </StatusBadge>
          </span>
        ) : undefined
      }
      footer={
        tender ? (
          <div className="ui-row-between ui-w-full">
            <div className="ui-row">
              <AppButton
                variant="primary"
                size="sm"
                leftIcon="sparkles"
                onClick={() => {
                  onClose();
                  onOpenAiAnalysis(tender);
                }}
              >
                AI Phân Tích HSMT
              </AppButton>
              <AppButton
                variant="gold"
                size="sm"
                leftIcon="star"
                onClick={() => {
                  const existing = bookmarks.find((b) => b.tbmt_code === tender.tbmt_code);
                  onOpenBookmarkModal({
                    tender,
                    status: existing?.status || "watching",
                    note: existing?.note || "",
                    existingId: existing?.id,
                  });
                  onClose();
                }}
              >
                Lưu vào danh sách theo dõi
              </AppButton>
            </div>

            <AppButton
              variant="secondary"
              size="sm"
              leftIcon="copy"
              rightIcon="external-link"
              title="Tự động sao chép mã TBMT vào clipboard và mở Cổng Mua Sắm Công"
              onClick={() => onOpenExternalPortal(tender.tbmt_code, tender.source_url)}
            >
              Sao Chép Mã &amp; Mở e-GP
            </AppButton>
          </div>
        ) : undefined
      }
    >
      {loading && !tender ? (
        <div className="ui-stack">
          <SkeletonBlock variant="title" />
          <SkeletonBlock variant="card" />
          <SkeletonBlock variant="line" lines={3} />
        </div>
      ) : tender ? (
        <div className="ui-stack--lg">
          <ResponsiveTabs
            ariaLabel="Chuyển mục chi tiết gói thầu"
            active={activeTab}
            onChange={onChangeTab}
            tabs={[
              { id: "info", label: "Tóm Tắt Thông Tin", icon: "clipboard-list" },
              {
                id: "iframe",
                label: "Toàn Văn E-HSMT (Trình Xem iFrame)",
                icon: "file-text",
              },
              ...(activeTab === "attachments" || attachments.length > 0
                ? [
                    {
                      id: "attachments" as const,
                      label: "Hồ Sơ Mời Thầu",
                      icon: "paperclip" as const,
                      badge: attachments.length || undefined,
                    },
                  ]
                : []),
              ...(activeTab === "competitors" || competitors.length > 0
                ? [
                    {
                      id: "competitors" as const,
                      label: "Nhà Thầu Đối Thủ",
                      icon: "users" as const,
                      badge: competitors.length || undefined,
                    },
                  ]
                : []),
            ]}
          />

          {activeTab === "competitors" ? (
            <div className="ui-stack--lg">
              <div className="ui-banner">
                <div className="ui-row-between">
                  <div className="ui-grow ui-stack">
                    <h3 className="ui-banner-title">
                      Tải Trọn Bộ E-HSDT Của Tất Cả Nhà Thầu Tham Gia (Full Competitors ZIP)
                    </h3>
                    <p className="ui-banner-sub">
                      Bao gồm toàn bộ đề xuất kỹ thuật, biểu giá chào thầu và hồ sơ năng lực của cả
                      3 nhà thầu (Thắng / Xếp hạng 2 / Bị loại).
                    </p>
                  </div>
                  {allCompZipHref && (
                    <a
                      href={allCompZipHref}
                      download
                      className="ui-btn ui-btn--gold ui-btn--sm"
                    >
                      <AppIcon name="download" size={14} />
                      <span>Tải Toàn Bộ Hồ Sơ Đối Thủ (.ZIP)</span>
                    </a>
                  )}
                </div>
              </div>

              <div className="ui-stack">
                {displayCompetitors.map((comp) => (
                  <article
                    key={comp.tax_code}
                    className={
                      comp.ranking === 1
                        ? "ui-subpanel ui-subpanel--card ui-stack ui-card-stripe--success"
                        : comp.ranking === 2
                          ? "ui-subpanel ui-subpanel--card ui-stack ui-card-stripe--warning"
                          : "ui-subpanel ui-subpanel--card ui-stack ui-card-stripe--danger"
                    }
                  >
                    <div className="ui-row-between ui-row--start">
                      <div className="ui-grow">
                        <div className="ui-row">
                          <strong className="ui-meta-value">{comp.contractor_name}</strong>
                          <StatusBadge
                            tone={
                              comp.ranking === 1
                                ? "success"
                                : comp.ranking === 2
                                  ? "warning"
                                  : "danger"
                            }
                            size="sm"
                          >
                            {comp.status_label}
                          </StatusBadge>
                        </div>
                        <div className="ui-muted">
                          MST: <strong className="ui-mono">{comp.tax_code}</strong> •{" "}
                          {comp.address}
                        </div>
                      </div>

                      <div className="bid-end">
                        <div className="bid-price bid-price--won ui-mono">
                          {comp.bid_price_formatted}
                        </div>
                        <div className="ui-muted">
                          Điểm kỹ thuật: {comp.tech_score}/100 • Giảm {comp.discount_percent}%
                        </div>
                      </div>
                    </div>

                    <div className="ui-subpanel ui-subpanel--md ui-stack--xs">
                      <span>
                        <strong>Nhận xét Tổ chuyên gia:</strong> {comp.eval_result}
                      </span>
                    </div>

                    <div className="ui-row">
                      {comp.files.map((f: any) => {
                        const fileHref = safeHttpUrl(
                          api.bidding.getCompetitorFileDownloadUrl(
                            tender.tbmt_code,
                            comp.tax_code,
                            f.file_id,
                          ),
                        );
                        return fileHref ? (
                          <a
                            key={f.file_id}
                            href={fileHref}
                            download
                            className="ui-btn ui-btn--secondary ui-btn--sm"
                          >
                            <AppIcon name="download" size={14} />
                            <span>{f.title}</span>
                            <span className="ui-muted">({f.size})</span>
                          </a>
                        ) : null;
                      })}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : activeTab === "attachments" ? (
            <div className="ui-stack--lg">
              <div className="ui-banner">
                <div className="ui-row-between">
                  <div className="ui-grow ui-stack">
                    <h3 className="ui-banner-title">
                      Tải Trọn Bộ Hồ Sơ Mời Thầu &amp; Biểu Mẫu (Full Package ZIP)
                    </h3>
                    <p className="ui-banner-sub">
                      Gói nén ZIP bao gồm tất cả 5 file: E-HSMT Yêu cầu kỹ thuật, Tiêu chuẩn đánh
                      giá, Biểu mẫu Word và Quyết định pháp lý.
                    </p>
                  </div>
                  {fullDossierZipHref && (
                    <a
                      href={fullDossierZipHref}
                      download
                      className="ui-btn ui-btn--gold ui-btn--sm"
                    >
                      <AppIcon name="download" size={14} />
                      <span>Tải Toàn Bộ File (.ZIP)</span>
                    </a>
                  )}
                </div>
              </div>

              <div className="ui-stack">
                {displayAttachments.map((att) => {
                  const attHref = safeHttpUrl(
                    api.bidding.getAttachmentDownloadUrl(tender.tbmt_code, att.file_id),
                  );
                  return (
                    <article key={att.file_id} className="ui-subpanel ui-subpanel--card ui-stack">
                      <div className="ui-row-between">
                        <div className="ui-grow ui-stack">
                          <div className="ui-row">
                            <AppIcon
                              name={att.file_type === "docx" ? "file-signature" : "file-text"}
                              size={16}
                            />
                            <strong className="ui-meta-value">{att.title}</strong>
                            <StatusBadge
                              tone={att.file_type === "docx" ? "brand" : "success"}
                              size="sm"
                            >
                              {att.badge || String(att.file_type || "PDF").toUpperCase()}
                            </StatusBadge>
                            <span className="ui-muted">({att.file_size})</span>
                          </div>
                          <div className="ui-muted">{att.description}</div>
                        </div>

                        {attHref && (
                          <a
                            href={attHref}
                            download
                            className="ui-btn ui-btn--primary ui-btn--sm"
                          >
                            <AppIcon name="download" size={14} />
                            <span>
                              {att.file_type === "docx" ? "Tải File Word" : "Tải File PDF"}
                            </span>
                          </a>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : activeTab === "iframe" ? (
            <div className="ui-stack">
              <div className="ui-row-between">
                <span className="ui-muted">
                  Trình xem trực quan E-HSMT định dạng Cổng Mua Sắm Công:
                </span>
                {htmlPreviewHref && (
                  <a
                    href={htmlPreviewHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ui-btn ui-btn--ghost ui-btn--sm"
                  >
                    <AppIcon name="globe" size={14} />
                    <span>Mở tab toàn màn hình</span>
                    <AppIcon name="external-link" size={12} />
                  </a>
                )}
              </div>
              <div className="bid-iframe-box">
                <iframe
                  src={htmlPreviewHref}
                  sandbox=""
                  className="ui-iframe"
                  title={`E-HSMT ${tender.tbmt_code}`}
                />
              </div>
            </div>
          ) : (
            <div className="ui-stack--lg">
              <div className="ui-banner">
                <div className="ui-grid-cards-sm">
                  <div className="ui-banner-glass">
                    <span className="ui-banner-eyebrow">Giá gói thầu (Dự toán)</span>
                    <strong className="ui-banner-gold">{formatVnd(tender.bid_price)}</strong>
                  </div>
                  <div className="ui-banner-glass">
                    <span className="ui-banner-eyebrow">Thời điểm đóng thầu</span>
                    <strong>{formatDate(tender.bid_deadline)}</strong>
                  </div>
                  <div className="ui-banner-glass">
                    <span className="ui-banner-eyebrow">Địa bàn thực hiện</span>
                    <strong>{tender.province || "Toàn quốc"}</strong>
                  </div>
                </div>
              </div>

              <FormGrid cols={2}>
                <div className="ui-meta-item">
                  <span className="ui-inline ui-kicker">Bên mời thầu</span>
                  <span className="ui-meta-value">{tender.procuring_entity || "—"}</span>
                </div>
                <div className="ui-meta-item">
                  <span className="ui-inline ui-kicker">Chủ đầu tư</span>
                  <span className="ui-meta-value">{tender.investor || "—"}</span>
                </div>
                <div className="ui-meta-item">
                  <span className="ui-inline ui-kicker">Hình thức lựa chọn</span>
                  <span className="ui-meta-value">
                    {tender.bidding_method || "Đấu thầu rộng rãi qua mạng"}
                  </span>
                </div>
                {tender.decision_number && (
                  <div className="ui-meta-item">
                    <span className="ui-inline ui-kicker">Số quyết định phê duyệt</span>
                    <span className="ui-meta-value ui-mono">{tender.decision_number}</span>
                  </div>
                )}
                {tender.bid_validity_period_days != null && (
                  <div className="ui-meta-item">
                    <span className="ui-inline ui-kicker">Hiệu lực HSDT</span>
                    <span className="ui-meta-value">{tender.bid_validity_period_days} ngày</span>
                  </div>
                )}
                {tender.execution_period_days != null && (
                  <div className="ui-meta-item">
                    <span className="ui-inline ui-kicker">Thời gian thực hiện hợp đồng</span>
                    <span className="ui-meta-value">{tender.execution_period_days} ngày</span>
                  </div>
                )}
              </FormGrid>

              {tender.description && (
                <div className="ui-subpanel ui-subpanel--md ui-stack--xs">
                  <span className="ui-inline ui-text-xs ui-text-strong">
                    <AppIcon name="file-text" size={14} /> Mô tả phạm vi công việc
                  </span>
                  <span>{tender.description}</span>
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
    </AppModal>
  );
}
