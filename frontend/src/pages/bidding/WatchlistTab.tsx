import type { BiddingWatchlistItem } from "../../api";
import {
  AppButton,
  AppIcon,
  EmptyState,
  SectionCard,
  SkeletonBlock,
  StatusBadge,
} from "../../components/ui";
import { formatDate, formatVndShort, getFieldBadge } from "./biddingUtils";

export interface WatchlistTabProps {
  watchlists: BiddingWatchlistItem[];
  watchlistLoading: boolean;
  scanningId: number | "all" | null;
  onAddNew: (preset?: Partial<BiddingWatchlistItem>) => void;
  onEdit: (rule: BiddingWatchlistItem) => void;
  onScanAll: () => void;
  onScanRule: (id: number) => void;
  onToggleActive: (rule: BiddingWatchlistItem) => void;
  onToggleTelegram: (rule: BiddingWatchlistItem) => void;
  onDelete: (id: number, name: string) => void;
}

export function WatchlistTab({
  watchlists,
  watchlistLoading,
  scanningId,
  onAddNew,
  onEdit,
  onScanAll,
  onScanRule,
  onToggleActive,
  onToggleTelegram,
  onDelete,
}: WatchlistTabProps) {
  return (
    <div className="ui-stack--lg">
      <SectionCard
        title="Quy Tắc Quét Tự Động & Bắn Tin Telegram"
        subtitle="Hệ thống định kỳ tìm kiếm các gói thầu mới thỏa mãn điều kiện và tự động gửi thông báo đến kênh Telegram của Admin."
        icon="bell"
        padding="compact"
        actions={
          <div className="ui-row">
            <AppButton
              variant="primary"
              size="sm"
              leftIcon="plus"
              onClick={() =>
                onAddNew({
                  name: "",
                  keyword: "",
                  province: "",
                  field: "HH",
                  min_price: null,
                  max_price: null,
                  notify_telegram: true,
                  is_active: true,
                })
              }
            >
              Thêm Quy Tắc Mới
            </AppButton>
            <AppButton
              variant="gold"
              size="sm"
              leftIcon="zap"
              loading={scanningId === "all"}
              disabled={scanningId !== null}
              onClick={onScanAll}
            >
              {scanningId === "all" ? "Đang quét..." : "Quét Tất Cả"}
            </AppButton>
          </div>
        }
      >
        {watchlistLoading && (
          <div className="ui-stack">
            {[1, 2].map((i) => (
              <div key={i} className="ui-subpanel ui-subpanel--card ui-stack">
                <SkeletonBlock variant="title" />
                <SkeletonBlock variant="line" lines={2} />
              </div>
            ))}
          </div>
        )}

        {!watchlistLoading && watchlists.length === 0 && (
          <EmptyState
            icon="sliders-horizontal"
            title="Chưa có quy tắc quét tự động nào"
            description='Tạo quy tắc quét theo từ khóa (như "SCADA", "IoT", "Trạm bơm"), tỉnh thành và khoảng giá để không bao giờ bỏ lỡ cơ hội đấu thầu.'
            action={
              <AppButton
                variant="primary"
                leftIcon="plus"
                onClick={() =>
                  onAddNew({
                    name: "Thiết bị IoT & SCADA Miền Nam",
                    keyword: "SCADA",
                    province: "Hồ Chí Minh",
                    field: "HH",
                    min_price: 100_000_000,
                    max_price: 5_000_000_000,
                    notify_telegram: true,
                    is_active: true,
                  })
                }
              >
                Thêm quy tắc mẫu
              </AppButton>
            }
          />
        )}

        {!watchlistLoading && watchlists.length > 0 && (
          <div className="ui-stack">
            {watchlists.map((rule) => {
              const fieldBadge = rule.field ? getFieldBadge(rule.field) : null;
              return (
                <article key={rule.id} className="ui-subpanel ui-subpanel--card ui-stack">
                  <div className="ui-row-between ui-row--start">
                    <div className="ui-stack">
                      <div className="ui-row">
                        <h3 className="bid-card-heading">{rule.name}</h3>
                        <StatusBadge
                          tone={rule.is_active ? "success" : "danger"}
                          dot
                          size="sm"
                        >
                          {rule.is_active ? "Đang hoạt động" : "Tạm dừng"}
                        </StatusBadge>
                      </div>
                      <span className="ui-muted">
                        Lần quét gần nhất:{" "}
                        {rule.last_checked_at
                          ? formatDate(rule.last_checked_at)
                          : "Chưa quét lần nào"}
                      </span>
                    </div>

                    <div className="ui-row">
                      <label className="ui-check-label">
                        <input
                          type="checkbox"
                          checked={rule.is_active}
                          onChange={() => onToggleActive(rule)}
                        />
                        <span>Tự động quét</span>
                      </label>
                      <label className="ui-check-label">
                        <input
                          type="checkbox"
                          checked={rule.notify_telegram}
                          onChange={() => onToggleTelegram(rule)}
                        />
                        <AppIcon name="send" size={14} />
                        <span>Bắn Telegram</span>
                      </label>
                    </div>
                  </div>

                  <div className="ui-subpanel ui-subpanel--md ui-stack--xs">
                    <div className="ui-row">
                      <span className="ui-inline ui-kicker">Tiêu chí lọc:</span>
                      {rule.keyword && (
                        <StatusBadge tone="brand" icon="search" size="sm">
                          &ldquo;{rule.keyword}&rdquo;
                        </StatusBadge>
                      )}
                      {rule.province && (
                        <StatusBadge tone="neutral" icon="map-pin" size="sm">
                          {rule.province}
                        </StatusBadge>
                      )}
                      {fieldBadge && (
                        <StatusBadge tone={fieldBadge.tone} icon="folder" size="sm">
                          {fieldBadge.label}
                        </StatusBadge>
                      )}
                      {(rule.min_price != null || rule.max_price != null) && (
                        <StatusBadge tone="warning" icon="coins" size="sm">
                          {formatVndShort(rule.min_price)} –{" "}
                          {rule.max_price ? formatVndShort(rule.max_price) : "∞"}
                        </StatusBadge>
                      )}
                    </div>
                  </div>

                  <div className="ui-row ui-divider-top">
                    <div className="ui-row bid-ml-auto">
                      <AppButton
                        variant="primary"
                        size="sm"
                        leftIcon="zap"
                        loading={scanningId === rule.id}
                        disabled={scanningId !== null}
                        onClick={() => onScanRule(rule.id)}
                      >
                        {scanningId === rule.id ? "Đang quét..." : "Quét ngay"}
                      </AppButton>
                      <AppButton
                        variant="secondary"
                        size="sm"
                        leftIcon="edit"
                        onClick={() => onEdit(rule)}
                      >
                        Sửa
                      </AppButton>
                      <AppButton
                        variant="danger"
                        size="sm"
                        leftIcon="trash"
                        onClick={() => onDelete(rule.id, rule.name)}
                      >
                        Xóa
                      </AppButton>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
