import type { ReactNode } from "react";
import type { WebAdsCampaignRow } from "../../api";
import {
  DataView,
  MobileCard,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  SectionCard,
  SkeletonBlock,
  StatusBadge,
} from "../../components/ui";
import { fmtPct, fmtVnd, type SkuDemandRow } from "./webAdsMeta";

export interface WebAdsAnalyticsSectionProps {
  campaigns: WebAdsCampaignRow[];
  skuRows: SkuDemandRow[];
  maxSkuDemand: number;
  utmCampaign: string;
  loading: boolean;
  emptyCampaigns: ReactNode;
  onToggleCampaign: (campaign: string) => void;
}

export function WebAdsAnalyticsSection({
  campaigns,
  skuRows,
  maxSkuDemand,
  utmCampaign,
  loading,
  emptyCampaigns,
  onToggleCampaign,
}: WebAdsAnalyticsSectionProps) {
  return (
    <div className="ui-grid-cards-lg">
      <SectionCard
        padding="flush"
        icon="target"
        title="Hiệu quả theo chiến dịch (UTM)"
        subtitle="Bấm vào chiến dịch gắn UTM để lọc nhanh danh sách Lead tương ứng."
        actions={
          <StatusBadge tone="neutral" size="sm">
            {campaigns.length} nguồn
          </StatusBadge>
        }
      >
        <DataView
          mobileMode="card"
          loading={loading}
          skeletonRows={4}
          skeletonCols={6}
          empty={!loading && campaigns.length === 0 ? emptyCampaigns : undefined}
          desktop={
            <div className="ui-table-scroll-wrap" tabIndex={0}>
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Chiến dịch / Nguồn</th>
                    <th className="col-num">Xem</th>
                    <th className="col-num">Xem giá</th>
                    <th className="col-num">Gọi/Zalo</th>
                    <th className="col-num">Lead</th>
                    <th className="col-num">CR%</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((row, idx) => {
                    const cr =
                      row.conversion_rate ??
                      (row.pageviews > 0 ? (row.leads / row.pageviews) * 100 : 0);
                    const rowClicks = (row.call_clicks ?? 0) + (row.zalo_clicks ?? 0);
                    const clickable = Boolean(
                      row.utm_campaign && row.utm_campaign !== "(direct)",
                    );
                    const isSelected = Boolean(
                      utmCampaign && row.utm_campaign === utmCampaign,
                    );
                    const rowCls = [
                      clickable ? "ui-clickable" : "",
                      isSelected ? "ui-row-selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ");

                    return (
                      <tr
                        key={`${row.utm_campaign}-${row.utm_source}-${idx}`}
                        className={rowCls || undefined}
                        onClick={() => {
                          if (!clickable) return;
                          onToggleCampaign(row.utm_campaign);
                        }}
                      >
                        <td>
                          <div className="ui-text-strong ui-wrap">
                            {row.utm_campaign || "(Chưa gắn UTM)"}
                          </div>
                          <div className="ui-muted">
                            {[row.utm_source, row.utm_medium]
                              .filter(Boolean)
                              .join(" / ") || "direct / organic"}
                          </div>
                        </td>
                        <td className="num">
                          {(row.pageviews ?? 0).toLocaleString("vi-VN")}
                        </td>
                        <td className="num">
                          {(row.price_views ?? 0).toLocaleString("vi-VN")}
                        </td>
                        <td className="num">
                          {rowClicks.toLocaleString("vi-VN")}
                        </td>
                        <td className="num">
                          <span className={row.leads > 0 ? "ui-text-brand ui-tabular" : undefined}>
                            {row.leads ?? 0}
                          </span>
                        </td>
                        <td className="num">
                          <StatusBadge
                            tone={cr >= 3 ? "success" : cr > 0 ? "info" : "neutral"}
                            size="sm"
                          >
                            {fmtPct(cr)}
                          </StatusBadge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          }
          mobileCards={
            <div className="ui-mobile-card-list ui-pad-3">
              {campaigns.map((row, idx) => {
                const cr =
                  row.conversion_rate ??
                  (row.pageviews > 0 ? (row.leads / row.pageviews) * 100 : 0);
                const rowClicks = (row.call_clicks ?? 0) + (row.zalo_clicks ?? 0);
                const clickable = Boolean(
                  row.utm_campaign && row.utm_campaign !== "(direct)",
                );
                const isSelected = Boolean(
                  utmCampaign && row.utm_campaign === utmCampaign,
                );

                return (
                  <MobileCard
                    key={`${row.utm_campaign}-${row.utm_source}-${idx}`}
                    active={isSelected}
                    onClick={
                      clickable ? () => onToggleCampaign(row.utm_campaign) : undefined
                    }
                  >
                    <MobileCardHeader
                      title={row.utm_campaign || "(Chưa gắn UTM)"}
                      subtitle={
                        [row.utm_source, row.utm_medium]
                          .filter(Boolean)
                          .join(" / ") || "direct / organic"
                      }
                      badge={
                        <StatusBadge
                          tone={cr >= 3 ? "success" : cr > 0 ? "info" : "neutral"}
                          size="sm"
                        >
                          {fmtPct(cr)}
                        </StatusBadge>
                      }
                    />
                    <MobileCardGrid cols={2}>
                      <MobileCardRow
                        label="Xem"
                        value={(row.pageviews ?? 0).toLocaleString("vi-VN")}
                        mono
                      />
                      <MobileCardRow
                        label="Xem giá"
                        value={(row.price_views ?? 0).toLocaleString("vi-VN")}
                        mono
                      />
                      <MobileCardRow
                        label="Gọi / Zalo"
                        value={rowClicks.toLocaleString("vi-VN")}
                        mono
                      />
                      <MobileCardRow
                        label="Lead"
                        value={(row.leads ?? 0).toLocaleString("vi-VN")}
                        mono
                      />
                    </MobileCardGrid>
                  </MobileCard>
                );
              })}
            </div>
          }
        />
      </SectionCard>

      <SectionCard
        icon="package"
        title="Nhu cầu theo Model / SKU"
        subtitle="Tín hiệu chọn model cấu hình và Lead gửi form theo dòng sản phẩm."
      >
        {loading ? (
          <SkeletonBlock variant="card" lines={4} />
        ) : (
          <div className="ui-stack--sm">
            {skuRows.map((row) => {
              const score = row.leads * 3 + row.selects;
              const pct = Math.max(
                score > 0 ? 8 : 0,
                Math.round((score / maxSkuDemand) * 100),
              );
              const isHot = row.leads > 0;

              return (
                <div
                  key={row.sku}
                  className={`ui-subpanel ui-stack--sm ui-pad-3${isHot ? " ui-stat-tile--accent" : " ui-subpanel--1"}`}
                >
                  <div className="ui-row-between">
                    <div className="ui-row">
                      <code className="ui-mono ui-text-brand">{row.sku}</code>
                      <span className="ui-muted">{row.label}</span>
                    </div>
                    <div className="ui-row">
                      <StatusBadge tone="info" size="sm">
                        Chọn: {row.selects}
                      </StatusBadge>
                      <StatusBadge tone={isHot ? "success" : "neutral"} size="sm">
                        Lead: {row.leads}
                      </StatusBadge>
                      {row.totalQuantity > 0 && (
                        <StatusBadge tone="warning" size="sm">
                          SL: {row.totalQuantity}
                        </StatusBadge>
                      )}
                    </div>
                  </div>
                  <progress
                    className={`ui-progress ui-progress--sm${isHot ? "" : " ui-progress--gold"}`}
                    value={pct}
                    max={100}
                    aria-label={`Mức độ quan tâm ${row.sku}: ${pct}%`}
                  />
                  {row.estimatedRevenue > 0 && (
                    <div className="ui-muted">
                      Giá trị dự kiến:{" "}
                      <strong className="ui-text-strong ui-wrap">
                        {fmtVnd(row.estimatedRevenue)}
                      </strong>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
