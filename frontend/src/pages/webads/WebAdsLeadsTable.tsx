import type { ReactNode } from "react";
import type { WebAdsLead, WebLeadStatus } from "../../api";
import {
  AppButton,
  AppIcon,
  DataView,
  MobileCard,
  MobileCardActions,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  SectionCard,
  StatusBadge,
} from "../../components/ui";
import { safeHttpUrl } from "../../utils/url";
import {
  STATUS_META,
  STATUS_ORDER,
  fmtDateTime,
  fmtVnd,
  resolveLeadStatus,
  zaloUrl,
} from "./webAdsMeta";

export interface WebAdsLeadsTableProps {
  leads: WebAdsLead[];
  leadsTotal: number;
  loading: boolean;
  offset: number;
  limit: number;
  copiedLeadId: number | null;
  statusBusyId: number | null;
  emptyState: ReactNode;
  onPageChange: (nextOffset: number) => void;
  onSelectLead: (leadId: number) => void;
  onStatusChange: (leadId: number, status: WebLeadStatus) => void;
  onCopyPhone: (leadId: number, phone: string) => void;
}

export function WebAdsLeadsTable({
  leads,
  leadsTotal,
  loading,
  offset,
  limit,
  copiedLeadId,
  statusBusyId,
  emptyState,
  onPageChange,
  onSelectLead,
  onStatusChange,
  onCopyPhone,
}: WebAdsLeadsTableProps) {
  const totalPages = Math.max(1, Math.ceil(leadsTotal / limit));
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <SectionCard
      padding="flush"
      title={`Danh sách Lead từ Website (${leadsTotal.toLocaleString("vi-VN")})`}
      subtitle="Chọn từng dòng để xem hành trình truy cập, lịch sử hỏi đáp AI, tạo KH CRM hoặc lập Báo giá PDF."
      icon="users"
      footer={
        leadsTotal > limit ? (
          <div className="ui-row-between">
            <AppButton
              variant="secondary"
              size="sm"
              leftIcon="chevron-left"
              disabled={offset <= 0}
              onClick={() => onPageChange(Math.max(0, offset - limit))}
            >
              Trang trước
            </AppButton>
            <span className="ui-muted">
              Trang {currentPage}/{totalPages} ({leadsTotal.toLocaleString("vi-VN")} lead)
            </span>
            <AppButton
              variant="secondary"
              size="sm"
              rightIcon="chevron-right"
              disabled={offset + limit >= leadsTotal}
              onClick={() => onPageChange(offset + limit)}
            >
              Trang sau
            </AppButton>
          </div>
        ) : undefined
      }
    >
      <DataView
        mobileMode="card"
        loading={loading && leads.length === 0}
        skeletonRows={6}
        skeletonCols={7}
        empty={!loading && leads.length === 0 ? emptyState : undefined}
        desktop={
          <div className="ui-table-scroll-wrap" tabIndex={0}>
            <table className="ui-table">
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Khách hàng</th>
                  <th>Sản phẩm / SKU / Giá dự kiến</th>
                  <th className="col-hide-sm">Nguồn Ads</th>
                  <th>Tín hiệu nóng</th>
                  <th>Trạng thái</th>
                  <th className="col-act">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => {
                  const displayPhone =
                    lead.phone || (lead.phone_last4 ? `••••${lead.phone_last4}` : "—");
                  const zUrl = safeHttpUrl(zaloUrl(lead.phone));
                  const statusKey = resolveLeadStatus(lead.status);
                  const priceViews = lead.price_view_count ?? 0;
                  const hasAiChat =
                    Boolean(lead.training_session_id) ||
                    (lead.training_query_count ?? 0) > 0;

                  return (
                    <tr
                      key={lead.id}
                      className="ui-clickable"
                      onClick={() => onSelectLead(lead.id)}
                    >
                      <td className="ui-nowrap">
                        <div className="ui-muted">{fmtDateTime(lead.created_at)}</div>
                        <div className="ui-muted">#{lead.id}</div>
                      </td>

                      <td>
                        <div className="ui-stack--sm">
                          <div className="ui-text-strong ui-wrap">
                            {lead.name || "(Chưa ghi tên)"}
                          </div>
                          {lead.company && (
                            <div className="ui-muted ui-inline">
                              <AppIcon name="building-2" size={13} />
                              <span>{lead.company}</span>
                            </div>
                          )}
                          <div
                            className="ui-row"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <code className="ui-mono ui-text-brand">{displayPhone}</code>
                            {lead.phone && (
                              <AppButton
                                variant="ghost"
                                size="sm"
                                leftIcon={copiedLeadId === lead.id ? "check" : "copy"}
                                onClick={() => onCopyPhone(lead.id, lead.phone)}
                                title="Sao chép SĐT"
                              >
                                {copiedLeadId === lead.id ? "Đã copy" : "Copy"}
                              </AppButton>
                            )}
                            {zUrl && (
                              <a
                                href={zUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ui-btn ui-btn--secondary ui-btn--sm ui-link"
                              >
                                <AppIcon name="message-square" size={14} />
                                <span className="ui-btn-label">Zalo</span>
                              </a>
                            )}
                          </div>
                          {(lead.customer_id || lead.quote_document_id) && (
                            <div className="ui-row">
                              {lead.customer_id && (
                                <StatusBadge tone="success" size="sm" icon="user-check">
                                  CRM #{lead.customer_id}
                                </StatusBadge>
                              )}
                              {lead.quote_document_id && (
                                <StatusBadge tone="brand" size="sm" icon="file-text">
                                  BG #{lead.quote_document_id}
                                </StatusBadge>
                              )}
                            </div>
                          )}
                        </div>
                      </td>

                      <td>
                        <div className="ui-stack--sm">
                          <div className="ui-row">
                            {lead.sku ? (
                              <StatusBadge tone="info" size="sm">
                                {lead.sku}
                              </StatusBadge>
                            ) : (
                              <StatusBadge tone="neutral" size="sm">
                                {lead.product_name || lead.product_key || "Tư vấn chung"}
                              </StatusBadge>
                            )}
                            {(lead.quantity ?? 0) > 0 && (
                              <span className="ui-text-strong ui-wrap">× {lead.quantity}</span>
                            )}
                          </div>
                          <div className="ui-text-brand ui-tabular">
                            {fmtVnd(lead.quoted_price_vnd)}
                          </div>
                          {lead.coupon_code && (
                            <div>
                              <StatusBadge tone="warning" size="sm" icon="tag">
                                {lead.coupon_code}
                                {lead.discount_percent ? ` -${lead.discount_percent}%` : ""}
                              </StatusBadge>
                            </div>
                          )}
                        </div>
                      </td>

                      <td className="col-hide-sm">
                        <div className="ui-stack--sm">
                          {lead.utm_campaign ? (
                            <div className="ui-text-strong ui-wrap">{lead.utm_campaign}</div>
                          ) : (
                            <div className="ui-muted">Trực tiếp / Organic</div>
                          )}
                          <div className="ui-muted ui-wrap">
                            {[lead.utm_source, lead.utm_medium]
                              .filter(Boolean)
                              .join(" · ") ||
                              lead.page_path ||
                              "—"}
                          </div>
                          {(lead.fbclid || lead.gclid) && (
                            <div className="ui-row">
                              {lead.fbclid && (
                                <StatusBadge tone="info" size="sm">
                                  FB Ads
                                </StatusBadge>
                              )}
                              {lead.gclid && (
                                <StatusBadge tone="warning" size="sm">
                                  Google Ads
                                </StatusBadge>
                              )}
                            </div>
                          )}
                        </div>
                      </td>

                      <td>
                        <div className="ui-stack--sm">
                          <div>
                            <StatusBadge
                              tone={
                                priceViews >= 2
                                  ? "danger"
                                  : priceViews === 1
                                    ? "warning"
                                    : "neutral"
                              }
                              size="sm"
                              icon={priceViews >= 2 ? "zap" : "eye"}
                            >
                              Xem giá {priceViews}x
                            </StatusBadge>
                          </div>
                          <span className="ui-muted">
                            {lead.visit_count ?? 0} lượt truy cập
                          </span>
                          {hasAiChat && (
                            <div>
                              <StatusBadge tone="success" size="sm" icon="bot">
                                Chat AI
                                {(lead.training_query_count ?? 0) > 0
                                  ? ` (${lead.training_query_count})`
                                  : ""}
                              </StatusBadge>
                            </div>
                          )}
                        </div>
                      </td>

                      <td onClick={(e) => e.stopPropagation()}>
                        <select
                          className={`ui-select wa-sel wa-st-${statusKey}`}
                          aria-label={`Trạng thái lead #${lead.id}`}
                          value={statusKey}
                          disabled={statusBusyId === lead.id}
                          onChange={(e) =>
                            onStatusChange(lead.id, e.target.value as WebLeadStatus)
                          }
                        >
                          {STATUS_ORDER.map((st) => (
                            <option key={st} value={st}>
                              {STATUS_META[st].label}
                            </option>
                          ))}
                        </select>
                      </td>

                      <td
                        className="col-act"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <AppButton
                          variant="secondary"
                          size="sm"
                          onClick={() => onSelectLead(lead.id)}
                        >
                          Chi tiết
                        </AppButton>
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
            {leads.map((lead) => {
              const displayPhone =
                lead.phone || (lead.phone_last4 ? `••••${lead.phone_last4}` : "—");
              const zUrl = safeHttpUrl(zaloUrl(lead.phone));
              const statusKey = resolveLeadStatus(lead.status);
              const statusMeta = STATUS_META[statusKey];
              const priceViews = lead.price_view_count ?? 0;
              const hasAiChat =
                Boolean(lead.training_session_id) ||
                (lead.training_query_count ?? 0) > 0;

              return (
                <MobileCard key={lead.id}>
                  <MobileCardHeader
                    title={lead.name || "(Chưa ghi tên)"}
                    subtitle={
                      <>
                        {lead.company ? `${lead.company} · ` : ""}#{lead.id} ·{" "}
                        {fmtDateTime(lead.created_at)}
                      </>
                    }
                    badge={
                      <StatusBadge
                        tone={statusMeta.tone}
                        size="sm"
                        icon={statusMeta.icon}
                      >
                        {statusMeta.label}
                      </StatusBadge>
                    }
                  />

                  <MobileCardGrid cols={2}>
                    <MobileCardRow label="SĐT" value={displayPhone} mono />
                    <MobileCardRow
                      label="Giá dự kiến"
                      value={fmtVnd(lead.quoted_price_vnd)}
                      mono
                    />
                  </MobileCardGrid>

                  <div className="ui-row">
                    {lead.sku ? (
                      <StatusBadge tone="info" size="sm">
                        {lead.sku}
                        {(lead.quantity ?? 0) > 0 ? ` ×${lead.quantity}` : ""}
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral" size="sm">
                        {lead.product_name || lead.product_key || "Tư vấn chung"}
                      </StatusBadge>
                    )}
                    <StatusBadge
                      tone={
                        priceViews >= 2
                          ? "danger"
                          : priceViews === 1
                            ? "warning"
                            : "neutral"
                      }
                      size="sm"
                      icon={priceViews >= 2 ? "zap" : "eye"}
                    >
                      Xem giá {priceViews}x
                    </StatusBadge>
                    {hasAiChat && (
                      <StatusBadge tone="success" size="sm" icon="bot">
                        Chat AI
                      </StatusBadge>
                    )}
                    {lead.customer_id && (
                      <StatusBadge tone="success" size="sm" icon="user-check">
                        CRM #{lead.customer_id}
                      </StatusBadge>
                    )}
                    {lead.quote_document_id && (
                      <StatusBadge tone="brand" size="sm" icon="file-text">
                        BG #{lead.quote_document_id}
                      </StatusBadge>
                    )}
                  </div>

                  <MobileCardActions>
                    <select
                      className={`ui-select wa-sel wa-st-${statusKey}`}
                      aria-label={`Trạng thái lead #${lead.id}`}
                      value={statusKey}
                      disabled={statusBusyId === lead.id}
                      onChange={(e) =>
                        onStatusChange(lead.id, e.target.value as WebLeadStatus)
                      }
                    >
                      {STATUS_ORDER.map((st) => (
                        <option key={st} value={st}>
                          {STATUS_META[st].label}
                        </option>
                      ))}
                    </select>
                    {lead.phone && (
                      <AppButton
                        variant="secondary"
                        size="sm"
                        leftIcon={copiedLeadId === lead.id ? "check" : "copy"}
                        onClick={() => onCopyPhone(lead.id, lead.phone)}
                      >
                        {copiedLeadId === lead.id ? "Đã copy" : "Copy"}
                      </AppButton>
                    )}
                    {zUrl && (
                      <a
                        href={zUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ui-btn ui-btn--secondary ui-btn--sm ui-link"
                      >
                        <AppIcon name="message-square" size={14} />
                        <span className="ui-btn-label">Zalo</span>
                      </a>
                    )}
                    <AppButton
                      variant="primary"
                      size="sm"
                      onClick={() => onSelectLead(lead.id)}
                    >
                      Chi tiết
                    </AppButton>
                  </MobileCardActions>
                </MobileCard>
              );
            })}
          </div>
        }
      />
    </SectionCard>
  );
}
