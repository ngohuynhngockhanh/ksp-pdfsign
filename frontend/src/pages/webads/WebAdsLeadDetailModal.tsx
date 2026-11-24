import { useId } from "react";
import type { WebAdsLeadDetail, WebLeadStatus } from "../../api";
import {
  AppButton,
  AppIcon,
  AppModal,
  EmptyState,
  FormField,
  FormGrid,
  InlineAlert,
  SectionCard,
  SkeletonBlock,
  StatusBadge,
} from "../../components/ui";
import { safeHttpUrl } from "../../utils/url";
import {
  EVENT_META,
  STATUS_META,
  STATUS_ORDER,
  extractAiAnswerText,
  fmtDateTime,
  fmtVnd,
  phoneDigits,
  resolveLeadStatus,
  zaloUrl,
} from "./webAdsMeta";

export interface WebAdsLeadDetailModalProps {
  selectedLeadId: number | null;
  detail: WebAdsLeadDetail | null;
  loading: boolean;
  error: string;
  noteDraft: string;
  savingNote: boolean;
  statusBusyId: number | null;
  copiedLeadId: number | null;
  actionBusy: "customer" | "quote" | "delete" | null;
  onClose: () => void;
  onNoteDraftChange: (value: string) => void;
  onCopyPhone: (leadId: number, phone: string) => void;
  onCreateCustomer: () => void;
  onDraftQuote: () => void;
  onStatusChange: (leadId: number, status: WebLeadStatus) => void;
  onSaveNote: () => void;
  onDeleteLead: () => void;
}

export function WebAdsLeadDetailModal({
  selectedLeadId,
  detail,
  loading,
  error,
  noteDraft,
  savingNote,
  statusBusyId,
  copiedLeadId,
  actionBusy,
  onClose,
  onNoteDraftChange,
  onCopyPhone,
  onCreateCustomer,
  onDraftQuote,
  onStatusChange,
  onSaveNote,
  onDeleteLead,
}: WebAdsLeadDetailModalProps) {
  const statusSelectId = useId();
  const noteTextareaId = useId();

  const events = Array.isArray(detail?.events) ? detail.events : [];
  const trainingQueries = Array.isArray(detail?.training_queries)
    ? detail.training_queries
    : [];
  const zUrl = detail ? safeHttpUrl(zaloUrl(detail.phone)) : undefined;
  const digits = detail ? phoneDigits(detail.phone) : "";
  const statusKey = detail ? resolveLeadStatus(detail.status) : "new";

  return (
    <AppModal
      open={selectedLeadId !== null}
      onClose={onClose}
      title={
        <>
          {detail?.name || "Chi tiết Lead Website"}
          {detail?.company ? ` — ${detail.company}` : ""}
        </>
      }
      subtitle={`WEB LEAD #${selectedLeadId ?? ""} · ${detail ? fmtDateTime(detail.created_at) : "Đang tải…"}`}
      size="lg"
    >
      {loading && <SkeletonBlock variant="card" lines={3} />}
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}

      {!loading && detail && (
        <div className="ui-stack">
          {/* Primary CRM Actions Bar */}
          <div className="ui-subpanel ui-row-between ui-pad-3">
            <div className="ui-row">
              <span className="ui-text-strong ui-wrap ui-inline">
                <AppIcon name="phone" size={16} />
                <code className="ui-mono ui-text-brand">
                  {detail.phone ||
                    (detail.phone_last4 ? `••••${detail.phone_last4}` : "—")}
                </code>
              </span>
              {detail.phone && (
                <AppButton
                  variant="secondary"
                  size="sm"
                  leftIcon={copiedLeadId === detail.id ? "check" : "copy"}
                  onClick={() => onCopyPhone(detail.id, detail.phone)}
                >
                  {copiedLeadId === detail.id ? "Đã copy SĐT" : "Copy SĐT"}
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
                  <span className="ui-btn-label">Nhắn Zalo</span>
                </a>
              )}
              {digits && (
                <a
                  href={`tel:${digits}`}
                  className="ui-btn ui-btn--secondary ui-btn--sm ui-link"
                >
                  <AppIcon name="phone" size={14} />
                  <span className="ui-btn-label">Gọi ngay</span>
                </a>
              )}
            </div>

            <div className="ui-row">
              <AppButton
                variant="secondary"
                size="sm"
                leftIcon={detail.customer_id ? "user-check" : "user-plus"}
                loading={actionBusy === "customer"}
                disabled={actionBusy !== null && actionBusy !== "customer"}
                onClick={onCreateCustomer}
              >
                {detail.customer_id
                  ? `KH CRM #${detail.customer_id} (Đồng bộ lại)`
                  : "Tạo KH CRM"}
              </AppButton>
              <AppButton
                variant="primary"
                size="sm"
                leftIcon="file-text"
                loading={actionBusy === "quote"}
                disabled={actionBusy !== null && actionBusy !== "quote"}
                onClick={onDraftQuote}
              >
                Tạo Báo Giá PDF
              </AppButton>
            </div>
          </div>

          {/* Summary Info Grid */}
          <FormGrid cols={2}>
            <SectionCard
              padding="compact"
              tone="subtle"
              icon="package"
              title="Nhu cầu sản phẩm & Giá dự kiến"
            >
              <div className="ui-stack--sm">
                <div className="ui-row-between">
                  <span className="ui-muted">Sản phẩm</span>
                  <strong className="ui-text-strong ui-wrap">
                    {detail.product_name || detail.product_key || "—"}
                  </strong>
                </div>
                <div className="ui-row-between">
                  <span className="ui-muted">Model / SKU</span>
                  <div className="ui-row">
                    {detail.sku ? (
                      <StatusBadge tone="info" size="sm">
                        {detail.sku}
                      </StatusBadge>
                    ) : (
                      <span className="ui-muted">Chưa chọn</span>
                    )}
                    <span className="ui-text-strong ui-wrap">SL: {detail.quantity || 1}</span>
                  </div>
                </div>
                <div className="ui-row-between">
                  <span className="ui-muted">Giá dự kiến</span>
                  <span className="ui-text-brand ui-tabular">
                    {fmtVnd(detail.quoted_price_vnd)}
                  </span>
                </div>
                <div className="ui-row-between">
                  <span className="ui-muted">Mã ưu đãi</span>
                  {detail.coupon_code ? (
                    <StatusBadge tone="warning" size="sm" icon="tag">
                      {detail.coupon_code}
                      {detail.discount_percent
                        ? ` (-${detail.discount_percent}%)`
                        : ""}
                    </StatusBadge>
                  ) : (
                    <span className="ui-muted">—</span>
                  )}
                </div>
                <div className="ui-row-between">
                  <span className="ui-muted">Email</span>
                  <span className="ui-wrap">{detail.email || "—"}</span>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              padding="compact"
              tone="subtle"
              icon="target"
              title="Nguồn quảng cáo & Tín hiệu"
            >
              <div className="ui-stack--sm">
                <div className="ui-row-between">
                  <span className="ui-muted">Chiến dịch</span>
                  <strong className="ui-text-strong ui-wrap">
                    {detail.utm_campaign || "Trực tiếp / Organic"}
                  </strong>
                </div>
                <div className="ui-row-between">
                  <span className="ui-muted">Nguồn / Kênh</span>
                  <span>
                    {[detail.utm_source, detail.utm_medium]
                      .filter(Boolean)
                      .join(" / ") || "—"}
                  </span>
                </div>
                {(detail.utm_content || detail.utm_term) && (
                  <div className="ui-muted ui-wrap">
                    Content/Term:{" "}
                    {[detail.utm_content, detail.utm_term]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                )}
                <div className="ui-row">
                  <StatusBadge tone="warning" size="sm" icon="eye">
                    Xem giá {detail.price_view_count ?? 0}x
                  </StatusBadge>
                  <StatusBadge tone="neutral" size="sm">
                    {detail.visit_count ?? 0} lượt vào
                  </StatusBadge>
                </div>
                <div className="ui-muted ui-wrap">
                  Trang: {detail.page_path || "—"}
                  {detail.referrer ? ` · Ref: ${detail.referrer}` : ""}
                </div>
              </div>
            </SectionCard>
          </FormGrid>

          {/* Full Message / Device / Need */}
          <SectionCard
            padding="compact"
            icon="message-square"
            title="Thông tin thiết bị, nhu cầu & lời nhắn của khách"
          >
            <div className="ui-stack--sm">
              {detail.device_info && (
                <div>
                  <strong className="ui-text-strong ui-wrap">Thiết bị / PLC / Hệ thống: </strong>
                  <span>{detail.device_info}</span>
                </div>
              )}
              {detail.need && (
                <div>
                  <strong className="ui-text-strong ui-wrap">Nhu cầu triển khai: </strong>
                  <span>{detail.need}</span>
                </div>
              )}
              <div>
                <strong className="ui-text-strong ui-wrap">Lời nhắn chi tiết: </strong>
                <span className="wa-pre">
                  {detail.message || "(Khách không nhập thêm lời nhắn)"}
                </span>
              </div>
            </div>
          </SectionCard>

          {/* Status + Internal Note Editor */}
          <SectionCard
            padding="compact"
            icon="clipboard-list"
            title="Trạng thái & Ghi chú nội bộ KSP"
            actions={
              <AppButton
                variant="danger"
                size="sm"
                leftIcon="trash"
                loading={actionBusy === "delete"}
                disabled={actionBusy !== null && actionBusy !== "delete"}
                onClick={onDeleteLead}
              >
                Xóa lead
              </AppButton>
            }
          >
            <FormGrid cols={2}>
              <FormField label="Trạng thái phễu" htmlFor={statusSelectId}>
                <select
                  id={statusSelectId}
                  className={`ui-select wa-st-${statusKey}`}
                  value={statusKey}
                  disabled={statusBusyId === detail.id}
                  onChange={(e) =>
                    onStatusChange(detail.id, e.target.value as WebLeadStatus)
                  }
                >
                  {STATUS_ORDER.map((st) => (
                    <option key={st} value={st}>
                      {STATUS_META[st].label}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField
                label="Ghi chú sales / kỹ thuật"
                htmlFor={noteTextareaId}
                fullWidth
              >
                <textarea
                  id={noteTextareaId}
                  className="ui-textarea"
                  rows={3}
                  placeholder="Đã gọi lúc mấy giờ, khách cần gửi báo giá công ty nào, tiến độ chốt…"
                  value={noteDraft}
                  onChange={(e) => onNoteDraftChange(e.target.value)}
                />
              </FormField>
            </FormGrid>

            <div className="ui-row">
              <AppButton
                variant="primary"
                size="sm"
                leftIcon="save"
                loading={savingNote}
                onClick={onSaveNote}
              >
                Lưu ghi chú
              </AppButton>
            </div>
          </SectionCard>

          {/* Visitor Event Timeline */}
          <SectionCard
            padding="compact"
            icon="compass"
            title={`Hành trình khách truy cập (${events.length} sự kiện)`}
          >
            {events.length === 0 ? (
              <EmptyState
                compact
                icon="compass"
                title="Chưa có sự kiện trình duyệt"
                description="Chưa ghi nhận chuỗi hành vi truy cập cho visitor này."
              />
            ) : (
              <div className="ui-stack--sm ui-scroll-sm">
                {events.map((ev) => {
                  const meta = EVENT_META[ev.event_type] || {
                    icon: "circle-dot" as const,
                    label: ev.event_type,
                    tone: "neutral" as const,
                  };
                  return (
                    <div key={ev.id} className="ui-subpanel ui-row-between">
                      <div className="ui-row">
                        <StatusBadge
                          tone={meta.tone}
                          size="sm"
                          icon={meta.icon}
                        >
                          {meta.label}
                        </StatusBadge>
                        {ev.sku && (
                          <StatusBadge tone="info" size="sm">
                            {ev.sku}
                          </StatusBadge>
                        )}
                        {ev.coupon && (
                          <StatusBadge tone="warning" size="sm" icon="tag">
                            {ev.coupon}
                          </StatusBadge>
                        )}
                        <span className="ui-muted ui-wrap">{ev.page_path}</span>
                      </div>
                      <span className="ui-muted ui-nowrap">
                        {fmtDateTime(ev.created_at)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* Matched AI Widget Chat History */}
          {(detail.training_session_id || trainingQueries.length > 0) && (
            <SectionCard
              padding="compact"
              tone="subtle"
              icon="bot"
              title={`Lịch sử hỏi đáp Trợ lý AI iNut.vn (${trainingQueries.length} câu hỏi)`}
              subtitle={
                detail.training_session_id
                  ? `Session #${detail.training_session_id}`
                  : undefined
              }
            >
              {trainingQueries.length === 0 ? (
                <EmptyState
                  compact
                  icon="bot"
                  title="Chưa có câu hỏi lưu lại"
                  description="Đã khớp số điện thoại với phiên AI Widget nhưng chưa có câu hỏi."
                />
              ) : (
                <div className="ui-stack--sm ui-scroll-sm">
                  {trainingQueries.map((q, idx) => {
                    const answerText = q.answer_text || extractAiAnswerText(q);
                    return (
                      <div key={q.job_id || q.id || idx} className="ui-subpanel ui-subpanel--1">
                        <div className="ui-muted">
                          {fmtDateTime(q.created_at)} · {q.status}
                        </div>
                        <div className="ui-text-strong ui-wrap ui-inline">
                          <AppIcon name="help-circle" size={14} />
                          <span>{q.question}</span>
                        </div>
                        {answerText && (
                          <div className="wa-ans wa-pre">{answerText}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          )}
        </div>
      )}
    </AppModal>
  );
}
