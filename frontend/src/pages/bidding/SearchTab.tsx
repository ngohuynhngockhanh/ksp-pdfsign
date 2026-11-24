import type {
  BiddingBookmarkItem,
  BiddingSearchResult,
  BiddingTenderSummary,
} from "../../api";
import {
  AppButton,
  AppIcon,
  EmptyState,
  FilterBar,
  FormField,
  FormGrid,
  InlineAlert,
  SectionCard,
  SkeletonBlock,
  StatusBadge,
} from "../../components/ui";
import {
  FIELDS,
  PRICE_PRESETS,
  PROVINCES,
  formatDate,
  formatVnd,
  getDeadlineMeta,
  getFieldBadge,
  type BookmarkModalState,
} from "./biddingUtils";

export interface SearchTabProps {
  keyword: string;
  setKeyword: (val: string) => void;
  province: string;
  setProvince: (val: string) => void;
  field: string;
  setField: (val: string) => void;
  minPrice: number | "";
  setMinPrice: (val: number | "") => void;
  maxPrice: number | "";
  setMaxPrice: (val: number | "") => void;
  biddingMethod: string;
  statusFilter: "all" | "open" | "closed";
  setStatusFilter: (val: "all" | "open" | "closed") => void;
  showAdvancedFilters: boolean;
  setShowAdvancedFilters: (val: boolean) => void;
  page: number;
  searchLoading: boolean;
  searchResult: BiddingSearchResult | null;
  searchError: string | null;
  bookmarks: BiddingBookmarkItem[];
  onSearch: (targetPage?: number) => void;
  onResetFilters: () => void;
  onSetPricePreset: (min: number | "", max: number | "") => void;
  onOpenDetail: (tbmtCode: string) => void;
  onOpenAiAnalysis: (tender: BiddingTenderSummary) => void;
  onOpenBookmarkModal: (state: BookmarkModalState) => void;
  onOpenExternalPortal: (tbmtCode: string, sourceUrl?: string) => void;
}

export function SearchTab({
  keyword,
  setKeyword,
  province,
  setProvince,
  field,
  setField,
  minPrice,
  setMinPrice,
  maxPrice,
  setMaxPrice,
  biddingMethod,
  statusFilter,
  setStatusFilter,
  showAdvancedFilters,
  setShowAdvancedFilters,
  page,
  searchLoading,
  searchResult,
  searchError,
  bookmarks,
  onSearch,
  onResetFilters,
  onSetPricePreset,
  onOpenDetail,
  onOpenAiAnalysis,
  onOpenBookmarkModal,
  onOpenExternalPortal,
}: SearchTabProps) {
  const activeFilterCount =
    (province ? 1 : 0) +
    (field ? 1 : 0) +
    (minPrice !== "" || maxPrice !== "" ? 1 : 0) +
    (biddingMethod ? 1 : 0) +
    (statusFilter !== "all" ? 1 : 0);

  const hasAnyFilter = Boolean(keyword || activeFilterCount > 0);

  return (
    <div className="ui-stack--lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSearch(1);
        }}
        className="ui-stack"
      >
        <FilterBar
          collapsibleMobile={false}
          search={{
            value: keyword,
            onChange: setKeyword,
            placeholder:
              "Nhập tên gói thầu, số TBMT (VD: IB2600...), bên mời thầu, từ khóa IoT / SCADA...",
            ariaLabel: "Tìm kiếm gói thầu theo tên, số TBMT hoặc từ khóa",
          }}
          activeCount={hasAnyFilter ? Math.max(1, activeFilterCount) : 0}
          onReset={hasAnyFilter ? onResetFilters : undefined}
          actions={
            <>
              <AppButton
                type="submit"
                variant="primary"
                leftIcon="search"
                loading={searchLoading}
              >
                {searchLoading ? "Đang tìm..." : "Tìm kiếm"}
              </AppButton>
              <AppButton
                variant={showAdvancedFilters ? "primary" : "secondary"}
                leftIcon="sliders-horizontal"
                aria-expanded={showAdvancedFilters}
                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              >
                Bộ lọc {showAdvancedFilters ? "▲" : "▼"}
              </AppButton>
            </>
          }
        />

        {showAdvancedFilters && (
          <SectionCard padding="compact" tone="subtle">
            <div className="ui-stack">
              <FormGrid cols={3}>
                <FormField label="Tỉnh / Thành phố">
                  <select
                    className="ui-select"
                    value={province}
                    onChange={(e) => setProvince(e.target.value)}
                  >
                    {PROVINCES.map((p) => (
                      <option key={p} value={p === "Tất cả" ? "" : p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField label="Lĩnh vực">
                  <select
                    className="ui-select"
                    value={field}
                    onChange={(e) => setField(e.target.value)}
                  >
                    {FIELDS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField label="Trạng thái mở / đóng thầu">
                  <select
                    className="ui-select"
                    value={statusFilter}
                    onChange={(e) =>
                      setStatusFilter(e.target.value as "all" | "open" | "closed")
                    }
                  >
                    <option value="all">Tất cả trạng thái</option>
                    <option value="open">Đang mở thầu (Còn hạn)</option>
                    <option value="closed">Đã đóng thầu</option>
                  </select>
                </FormField>
              </FormGrid>

              <FormField label="Khoảng giá gói thầu (VND)">
                <div className="ui-row-between">
                  <div className="ui-row">
                    {PRICE_PRESETS.map((preset) => {
                      const active = minPrice === preset.min && maxPrice === preset.max;
                      return (
                        <AppButton
                          key={preset.label}
                          variant={active ? "primary" : "secondary"}
                          size="sm"
                          onClick={() => onSetPricePreset(preset.min, preset.max)}
                        >
                          {preset.label}
                        </AppButton>
                      );
                    })}
                  </div>

                  <div className="ui-row">
                    <input
                      className="ui-input bid-price-input"
                      type="number"
                      value={minPrice}
                      onChange={(e) =>
                        setMinPrice(e.target.value ? Number(e.target.value) : "")
                      }
                      placeholder="Giá từ (VND)"
                      aria-label="Giá tối thiểu VND"
                    />
                    <span className="ui-muted">–</span>
                    <input
                      className="ui-input bid-price-input"
                      type="number"
                      value={maxPrice}
                      onChange={(e) =>
                        setMaxPrice(e.target.value ? Number(e.target.value) : "")
                      }
                      placeholder="Đến (VND)"
                      aria-label="Giá tối đa VND"
                    />
                  </div>
                </div>
              </FormField>
            </div>
          </SectionCard>
        )}
      </form>

      {/* Search Meta & Count */}
      <div className="ui-row-between">
        <div className="ui-row">
          {searchLoading ? (
            <span className="ui-muted">
              Đang kết nối Mạng Đấu Thầu Quốc Gia...
            </span>
          ) : searchResult ? (
            <>
              <span>
                Tìm thấy <strong>{searchResult.total}</strong> gói thầu phù hợp
              </span>
              {searchResult.is_mock && (
                <StatusBadge tone="warning" size="sm" icon="activity">
                  Smart Resilient Mock
                </StatusBadge>
              )}
            </>
          ) : null}
        </div>

        {searchResult && searchResult.total_pages > 1 && (
          <span className="ui-muted">
            Trang {searchResult.page} / {searchResult.total_pages}
          </span>
        )}
      </div>

      {searchError && (
        <InlineAlert tone="danger" title="Lỗi tra cứu">
          {searchError}
        </InlineAlert>
      )}

      {searchLoading && (
        <div className="ui-stack">
          {[1, 2, 3].map((i) => (
            <div key={i} className="ui-subpanel ui-subpanel--card ui-stack">
              <SkeletonBlock variant="title" />
              <SkeletonBlock variant="line" lines={2} />
            </div>
          ))}
        </div>
      )}

      {!searchLoading && searchResult && searchResult.items.length === 0 && (
        <SectionCard>
          <EmptyState
            icon="search"
            title="Không tìm thấy gói thầu phù hợp"
            description='Hãy thử mở rộng tiêu chí tìm kiếm, xóa bớt bộ lọc khoảng giá hoặc thử các từ khóa chuyên ngành như "SCADA", "IoT", "quan trắc", "tủ điện".'
            action={
              <AppButton variant="primary" leftIcon="rotate-ccw" onClick={onResetFilters}>
                Đặt lại bộ lọc
              </AppButton>
            }
          />
        </SectionCard>
      )}

      {!searchLoading && searchResult && searchResult.items.length > 0 && (
        <div className="ui-stack">
          {searchResult.items.map((item) => {
            const deadlineMeta = getDeadlineMeta(item.bid_deadline);
            const fieldBadge = getFieldBadge(item.field);
            const isBookmarked =
              item.is_bookmarked ||
              bookmarks.some((b) => b.tbmt_code === item.tbmt_code);

            return (
              <article key={item.tbmt_code} className="ui-subpanel ui-subpanel--card ui-stack">
                <div className="ui-row-between">
                  <div className="ui-row">
                    <StatusBadge tone="brand" icon="tag" size="sm">
                      <span className="ui-mono">{item.tbmt_code}</span>
                    </StatusBadge>
                    <StatusBadge tone={fieldBadge.tone} size="sm">
                      {fieldBadge.label}
                    </StatusBadge>
                    {item.province && (
                      <StatusBadge tone="neutral" icon="map-pin" size="sm">
                        {item.province}
                      </StatusBadge>
                    )}
                  </div>
                  <StatusBadge tone={deadlineMeta.tone} dot size="sm">
                    {deadlineMeta.label}
                  </StatusBadge>
                </div>

                <h3
                  className="bid-card-title"
                  tabIndex={0}
                  title="Bấm xem chi tiết gói thầu"
                  onClick={() => onOpenDetail(item.tbmt_code)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenDetail(item.tbmt_code);
                    }
                  }}
                >
                  {item.tender_name}
                </h3>

                <div className="ui-subpanel ui-subpanel--md ui-meta-grid">
                  <div className="ui-meta-item">
                    <span className="ui-inline ui-kicker">
                      <AppIcon name="building-2" size={12} /> Bên mời thầu
                    </span>
                    <span className="ui-meta-value">{item.procuring_entity || "—"}</span>
                  </div>

                  {item.investor && (
                    <div className="ui-meta-item">
                      <span className="ui-inline ui-kicker">
                        <AppIcon name="landmark" size={12} /> Chủ đầu tư
                      </span>
                      <span className="ui-meta-value">{item.investor}</span>
                    </div>
                  )}

                  <div className="ui-meta-item">
                    <span className="ui-inline ui-kicker">
                      <AppIcon name="coins" size={12} /> Giá gói thầu (Dự toán)
                    </span>
                    <strong className="bid-price">{formatVnd(item.bid_price)}</strong>
                  </div>

                  <div className="ui-meta-item">
                    <span className="ui-inline ui-kicker">
                      <AppIcon name="clock" size={12} /> Thời điểm đóng thầu
                    </span>
                    <span className="ui-meta-value">{formatDate(item.bid_deadline)}</span>
                  </div>
                </div>

                <div className="ui-row-between ui-divider-top">
                  <div className="ui-row">
                    <AppButton
                      variant={isBookmarked ? "gold" : "secondary"}
                      size="sm"
                      leftIcon={isBookmarked ? "star" : "bookmark"}
                      onClick={() => {
                        const existing = bookmarks.find(
                          (b) => b.tbmt_code === item.tbmt_code,
                        );
                        onOpenBookmarkModal({
                          tender: item,
                          status: existing?.status || "watching",
                          note: existing?.note || "",
                          existingId: existing?.id,
                        });
                      }}
                    >
                      {isBookmarked ? "Đang theo dõi" : "Lưu theo dõi"}
                    </AppButton>

                    <AppButton
                      variant="primary"
                      size="sm"
                      leftIcon="sparkles"
                      onClick={() => onOpenAiAnalysis(item)}
                    >
                      AI Phân tích
                    </AppButton>

                    <AppButton
                      variant="secondary"
                      size="sm"
                      leftIcon="eye"
                      onClick={() => onOpenDetail(item.tbmt_code)}
                    >
                      Chi tiết
                    </AppButton>
                  </div>

                  <AppButton
                    variant="ghost"
                    size="sm"
                    leftIcon="globe"
                    rightIcon="external-link"
                    title="Tự động sao chép mã TBMT và mở Cổng Mua Sắm Công"
                    onClick={() => onOpenExternalPortal(item.tbmt_code, item.source_url)}
                  >
                    Xem trên Mua Sắm Công
                  </AppButton>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {!searchLoading && searchResult && searchResult.total_pages > 1 && (
        <div className="ui-pager">
          <AppButton
            variant="secondary"
            size="sm"
            leftIcon="chevrons-left"
            disabled={page <= 1}
            onClick={() => onSearch(1)}
          >
            Đầu
          </AppButton>
          <AppButton
            variant="secondary"
            size="sm"
            leftIcon="chevron-left"
            disabled={page <= 1}
            onClick={() => onSearch(page - 1)}
          >
            Trước
          </AppButton>
          <StatusBadge tone="brand" size="md">
            Trang {page} / {searchResult.total_pages}
          </StatusBadge>
          <AppButton
            variant="secondary"
            size="sm"
            rightIcon="chevron-right"
            disabled={page >= searchResult.total_pages}
            onClick={() => onSearch(page + 1)}
          >
            Sau
          </AppButton>
          <AppButton
            variant="secondary"
            size="sm"
            rightIcon="chevrons-right"
            disabled={page >= searchResult.total_pages}
            onClick={() => onSearch(searchResult.total_pages)}
          >
            Cuối
          </AppButton>
        </div>
      )}
    </div>
  );
}
