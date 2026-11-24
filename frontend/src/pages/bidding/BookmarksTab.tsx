import type { BiddingBookmarkItem, BiddingTenderSummary } from "../../api";
import {
  AppButton,
  AppIcon,
  EmptyState,
  FilterBar,
  KpiStrip,
  SectionCard,
  SkeletonBlock,
  StatusBadge,
} from "../../components/ui";
import { safeHttpUrl } from "../../utils/url";
import {
  BOOKMARK_STATUS_MAP,
  formatDate,
  formatVnd,
  getDeadlineMeta,
  getFieldBadge,
  type BookmarkStatusKey,
} from "./biddingUtils";

export interface BookmarksTabProps {
  bookmarks: BiddingBookmarkItem[];
  filteredBookmarks: BiddingBookmarkItem[];
  bookmarksLoading: boolean;
  pipelineFilter: string;
  setPipelineFilter: (val: string) => void;
  searchKeyword: string;
  setSearchKeyword: (val: string) => void;
  onUpdateStatus: (id: number, status: BookmarkStatusKey) => void;
  onEditNote: (b: BiddingBookmarkItem) => void;
  onDelete: (id: number, name: string) => void;
  onOpenDetail: (tbmtCode: string) => void;
  onOpenAiAnalysis: (tender: BiddingTenderSummary) => void;
  onGoSearch: () => void;
}

export function BookmarksTab({
  bookmarks,
  filteredBookmarks,
  bookmarksLoading,
  pipelineFilter,
  setPipelineFilter,
  searchKeyword,
  setSearchKeyword,
  onUpdateStatus,
  onEditNote,
  onDelete,
  onOpenDetail,
  onOpenAiAnalysis,
  onGoSearch,
}: BookmarksTabProps) {
  const countByStatus = (st: BookmarkStatusKey) =>
    bookmarks.filter((b) => b.status === st).length;

  return (
    <div className="ui-stack--lg">
      <KpiStrip
        columns={5}
        loading={bookmarksLoading && bookmarks.length === 0}
        items={[
          {
            label: "Tất cả cơ hội",
            value: bookmarks.length,
            sub: "Gói thầu trong pipeline",
            icon: "layers",
            tone: "brand",
            active: pipelineFilter === "all",
            onClick: () => setPipelineFilter("all"),
          },
          {
            label: BOOKMARK_STATUS_MAP.watching.label,
            value: countByStatus("watching"),
            sub: "Nghiên cứu HSMT",
            icon: "eye",
            tone: "warning",
            active: pipelineFilter === "watching",
            onClick: () => setPipelineFilter("watching"),
          },
          {
            label: BOOKMARK_STATUS_MAP.preparing.label,
            value: countByStatus("preparing"),
            sub: "Đang lập E-HSDT",
            icon: "file-text",
            tone: "info",
            active: pipelineFilter === "preparing",
            onClick: () => setPipelineFilter("preparing"),
          },
          {
            label: BOOKMARK_STATUS_MAP.submitted.label,
            value: countByStatus("submitted"),
            sub: "Đã nộp trên e-GP",
            icon: "send",
            tone: "neutral",
            active: pipelineFilter === "submitted",
            onClick: () => setPipelineFilter("submitted"),
          },
          {
            label: BOOKMARK_STATUS_MAP.won.label,
            value: countByStatus("won"),
            sub: `Trượt: ${countByStatus("lost")}`,
            icon: "award",
            tone: "success",
            active: pipelineFilter === "won",
            onClick: () => setPipelineFilter("won"),
          },
        ]}
      />

      <FilterBar
        collapsibleMobile
        search={{
          value: searchKeyword,
          onChange: setSearchKeyword,
          placeholder:
            "Tìm nhanh trong danh sách quan tâm (tên gói thầu, mã TBMT, bên mời thầu)...",
          ariaLabel: "Tìm trong gói thầu quan tâm",
        }}
        activeCount={pipelineFilter !== "all" ? 1 : 0}
        onReset={() => {
          setPipelineFilter("all");
          setSearchKeyword("");
        }}
        filters={
          <select
            className="ui-select"
            aria-label="Lọc theo trạng thái pipeline"
            value={pipelineFilter}
            onChange={(e) => setPipelineFilter(e.target.value)}
          >
            <option value="all">Tất cả trạng thái ({bookmarks.length})</option>
            {(Object.keys(BOOKMARK_STATUS_MAP) as BookmarkStatusKey[]).map((key) => (
              <option key={key} value={key}>
                {BOOKMARK_STATUS_MAP[key].label} ({countByStatus(key)})
              </option>
            ))}
          </select>
        }
      />

      {bookmarksLoading && (
        <div className="ui-stack">
          {[1, 2].map((i) => (
            <div key={i} className="ui-subpanel ui-subpanel--card ui-stack">
              <SkeletonBlock variant="title" />
              <SkeletonBlock variant="line" lines={2} />
            </div>
          ))}
        </div>
      )}

      {!bookmarksLoading && filteredBookmarks.length === 0 && (
        <SectionCard>
          <EmptyState
            icon="star"
            title="Chưa có gói thầu nào trong danh sách này"
            description='Hãy chuyển sang tab "Tra Cứu Gói Thầu" và bấm nút "Lưu theo dõi" để thêm các gói thầu tiềm năng vào pipeline theo dõi.'
            action={
              <AppButton variant="primary" leftIcon="search" onClick={onGoSearch}>
                Khám phá gói thầu ngay
              </AppButton>
            }
          />
        </SectionCard>
      )}

      {!bookmarksLoading && filteredBookmarks.length > 0 && (
        <div className="ui-stack">
          {filteredBookmarks.map((b) => {
            const deadlineMeta = getDeadlineMeta(b.bid_deadline);
            const fieldBadge = getFieldBadge(b.field);
            const statusMeta = BOOKMARK_STATUS_MAP[b.status];
            const safeSourceUrl = safeHttpUrl(b.source_url);

            return (
              <article key={b.id} className="ui-subpanel ui-subpanel--card ui-stack">
                <div className="ui-row-between">
                  <div className="ui-row">
                    <StatusBadge tone="brand" icon="tag" size="sm">
                      <span className="ui-mono">{b.tbmt_code}</span>
                    </StatusBadge>
                    <StatusBadge tone={fieldBadge.tone} size="sm">
                      {fieldBadge.label}
                    </StatusBadge>
                    {b.province && (
                      <StatusBadge tone="neutral" icon="map-pin" size="sm">
                        {b.province}
                      </StatusBadge>
                    )}
                    <StatusBadge tone={statusMeta.tone} icon={statusMeta.icon} size="sm">
                      {statusMeta.label}
                    </StatusBadge>
                  </div>

                  <div className="ui-row">
                    <span className="ui-muted">Pipeline:</span>
                    <select
                      className="ui-select"
                      aria-label={`Trạng thái pipeline cho ${b.tbmt_code}`}
                      value={b.status}
                      onChange={(e) =>
                        onUpdateStatus(b.id, e.target.value as BookmarkStatusKey)
                      }
                    >
                      {(Object.keys(BOOKMARK_STATUS_MAP) as BookmarkStatusKey[]).map(
                        (sKey) => (
                          <option key={sKey} value={sKey}>
                            {BOOKMARK_STATUS_MAP[sKey].label}
                          </option>
                        ),
                      )}
                    </select>
                  </div>
                </div>

                <h3
                  className="bid-card-title"
                  tabIndex={0}
                  onClick={() => onOpenDetail(b.tbmt_code)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenDetail(b.tbmt_code);
                    }
                  }}
                >
                  {b.tender_name}
                </h3>

                <div className="ui-subpanel ui-subpanel--md ui-meta-grid">
                  <div className="ui-meta-item">
                    <span className="ui-inline ui-kicker">
                      <AppIcon name="building-2" size={12} /> Bên mời thầu
                    </span>
                    <span className="ui-meta-value">{b.procuring_entity || "—"}</span>
                  </div>
                  <div className="ui-meta-item">
                    <span className="ui-inline ui-kicker">
                      <AppIcon name="coins" size={12} /> Giá gói thầu
                    </span>
                    <strong className="bid-price">{formatVnd(b.bid_price)}</strong>
                  </div>
                  <div className="ui-meta-item">
                    <span className="ui-inline ui-kicker">
                      <AppIcon name="clock" size={12} /> Hạn nộp E-HSDT
                    </span>
                    <span className="ui-meta-value">
                      {formatDate(b.bid_deadline)} ({deadlineMeta.label})
                    </span>
                  </div>
                </div>

                <div className="ui-subpanel ui-subpanel--md ui-stack--xs ui-subpanel--warning">
                  <div className="ui-row-between">
                    <span className="ui-inline ui-text-xs ui-text-strong">
                      <AppIcon name="file-text" size={14} /> Ghi chú nội bộ (Chiến lược dự thầu)
                    </span>
                    <AppButton
                      variant="secondary"
                      size="sm"
                      leftIcon="edit"
                      onClick={() => onEditNote(b)}
                    >
                      Sửa ghi chú
                    </AppButton>
                  </div>
                  <div className={b.note ? undefined : "ui-muted"}>
                    {b.note ||
                      "Chưa có ghi chú nội bộ. Bấm 'Sửa ghi chú' để nhập phân công, tính giá hoặc ghi nhớ đối tác."}
                  </div>
                </div>

                <div className="ui-row-between ui-divider-top">
                  <div className="ui-row">
                    <AppButton
                      variant="primary"
                      size="sm"
                      leftIcon="sparkles"
                      onClick={() =>
                        onOpenAiAnalysis({
                          tbmt_code: b.tbmt_code,
                          tender_name: b.tender_name,
                          procuring_entity: b.procuring_entity,
                          investor: b.investor,
                          field: b.field,
                          bid_price: b.bid_price,
                          bid_deadline: b.bid_deadline,
                          province: b.province,
                          source_url: b.source_url,
                        })
                      }
                    >
                      Báo cáo AI
                    </AppButton>

                    <AppButton
                      variant="secondary"
                      size="sm"
                      leftIcon="eye"
                      onClick={() => onOpenDetail(b.tbmt_code)}
                    >
                      Chi tiết
                    </AppButton>
                  </div>

                  <div className="ui-row">
                    {safeSourceUrl ? (
                      <a
                        href={safeSourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ui-btn ui-btn--secondary ui-btn--sm"
                      >
                        <AppIcon name="globe" size={14} />
                        <span>Mua Sắm Công</span>
                        <AppIcon name="external-link" size={12} />
                      </a>
                    ) : (
                      <StatusBadge tone="neutral" size="sm" icon="link">
                        Không có link nguồn
                      </StatusBadge>
                    )}

                    <AppButton
                      variant="danger"
                      size="sm"
                      iconOnly
                      leftIcon="trash"
                      title="Xóa khỏi danh sách quan tâm"
                      aria-label="Xóa khỏi danh sách quan tâm"
                      onClick={() => onDelete(b.id, b.tender_name)}
                    />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
