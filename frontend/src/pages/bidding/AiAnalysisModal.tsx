import type {
  BiddingAIAnalysisData,
  BiddingAIAnalysisResult,
  BiddingBookmarkItem,
  BiddingTenderSummary,
} from "../../api";
import {
  AppButton,
  AppIcon,
  AppModal,
  FormGrid,
  InlineAlert,
  SectionCard,
  SkeletonBlock,
  StatusBadge,
} from "../../components/ui";
import {
  formatVnd,
  generateAiAnalysisMarkdown,
  type BookmarkModalState,
} from "./biddingUtils";

export interface AiAnalysisModalProps {
  tender: BiddingTenderSummary | null;
  result: BiddingAIAnalysisResult | null;
  loading: boolean;
  error: string | null;
  bookmarks: BiddingBookmarkItem[];
  onClose: () => void;
  onCopyMarkdown: (md: string) => void;
  onShareTelegram: (
    tender: BiddingTenderSummary | null,
    analysis: BiddingAIAnalysisData,
  ) => void;
  onSaveToBookmark: (state: BookmarkModalState) => void;
}

export function AiAnalysisModal({
  tender,
  result,
  loading,
  error,
  bookmarks,
  onClose,
  onCopyMarkdown,
  onShareTelegram,
  onSaveToBookmark,
}: AiAnalysisModalProps) {
  const open = Boolean(tender || result || loading);
  const analysis = result?.analysis;
  const fit = analysis?.inut_fit_analysis;
  const score = fit?.score ?? analysis?.inut_compatibility_score ?? 85;
  const scoreTone = score >= 80 ? "success" : score >= 60 ? "warning" : "danger";
  const matchLevel =
    fit?.match_level || (score >= 80 ? "RẤT CAO" : score >= 60 ? "TRUNG BÌNH" : "THẤP");
  const recommendation =
    fit?.recommendation || (score >= 80 ? "Nên tham gia độc lập" : "Khuyến nghị liên danh");

  return (
    <AppModal
      open={open}
      dismissible={!loading}
      onClose={() => {
        if (!loading) onClose();
      }}
      size="lg"
      title="Phân Tích Hồ Sơ Mời Thầu & Độ Phù Hợp Chiến Lược"
      subtitle={
        <span>
          AI TENDER STRATEGIC RADAR — INUT CORPS (MST 4401053694)
          {tender ? ` · ${tender.tender_name} (${tender.tbmt_code})` : ""}
        </span>
      }
      footer={
        !loading && result && analysis ? (
          <div className="ui-row-between ui-w-full">
            <div className="ui-row">
              <AppButton
                variant="secondary"
                size="sm"
                leftIcon="copy"
                title="Sao chép toàn bộ báo cáo phân tích AI dạng Markdown"
                onClick={() => onCopyMarkdown(generateAiAnalysisMarkdown(tender, analysis))}
              >
                Xuất Báo Cáo Markdown / Sao chép
              </AppButton>
              <AppButton
                variant="primary"
                size="sm"
                leftIcon="send"
                title="Gửi cảnh báo phân tích HSMT qua Telegram"
                onClick={() => onShareTelegram(tender, analysis)}
              >
                Gửi cảnh báo Telegram
              </AppButton>
            </div>

            <div className="ui-row">
              <AppButton
                variant="gold"
                size="sm"
                leftIcon="star"
                onClick={() => {
                  if (!tender) return;
                  const existing = bookmarks.find((b) => b.tbmt_code === tender.tbmt_code);
                  onSaveToBookmark({
                    tender,
                    status: existing?.status || "preparing",
                    note: `[AI Score: ${score}/100 - ${recommendation}]\n${existing?.note || ""}`,
                    existingId: existing?.id,
                  });
                  onClose();
                }}
              >
                Lưu Vào Theo Dõi
              </AppButton>
              <AppButton variant="secondary" size="sm" onClick={onClose}>
                Đóng
              </AppButton>
            </div>
          </div>
        ) : undefined
      }
    >
      {loading && (
        <SectionCard tone="subtle">
          <div className="ui-stack">
            <div className="ui-row">
              <AppIcon name="sparkles" size={18} />
              <h3 className="bid-card-heading">AI Đang Bóc Tách &amp; Đánh Giá E-HSMT...</h3>
            </div>
            <p className="ui-muted">
              Trích xuất điều kiện năng lực, doanh thu, thời hạn nộp thầu và đối chiếu với năng lực
              sản xuất IoT / SCADA của INUT.
            </p>
            <SkeletonBlock variant="card" />
            <SkeletonBlock variant="line" lines={3} />
          </div>
        </SectionCard>
      )}

      {error && (
        <InlineAlert tone="danger" title="Không thể phân tích">
          {error}
        </InlineAlert>
      )}

      {!loading && analysis && (
        <div className="ui-stack--lg">
          {/* INUT Strategic Fit Score Banner */}
          <div className="ui-banner">
            <div className="ui-row">
              <div className="bid-score-ring">
                <div>
                  <span className="bid-score-val">{score}</span>
                  <span className="bid-score-unit">/ 100 ĐIỂM</span>
                </div>
              </div>

              <div className="ui-grow ui-stack">
                <span className="ui-banner-eyebrow">
                  <AppIcon name="target" size={13} />
                  Đánh Giá Độ Tương Thích Với Năng Lực INUT
                </span>
                <div className="ui-row">
                  <StatusBadge tone={scoreTone} size="sm">
                    ĐỘ PHÙ HỢP: {matchLevel}
                  </StatusBadge>
                  <span className="ui-banner-gold">Khuyến nghị: {recommendation}</span>
                </div>
                <p className="ui-banner-sub">
                  {analysis.executive_summary ||
                    analysis.summary ||
                    "Đánh giá chi tiết năng lực dự thầu."}
                </p>
              </div>
            </div>
          </div>

          <FormGrid cols={2}>
            <SectionCard title="Yêu Cầu Năng Lực & Kinh Nghiệm" icon="file-badge" padding="compact">
              {Array.isArray(analysis.capacity_requirements) ? (
                <ul className="ui-bullet-list">
                  {analysis.capacity_requirements.map((req, idx) => (
                    <li key={idx}>{req}</li>
                  ))}
                </ul>
              ) : (
                <div>{analysis.capacity_requirements || "Không có yêu cầu đặc biệt."}</div>
              )}
            </SectionCard>

            <SectionCard title="Điều Kiện Tài Chính & Doanh Thu" icon="coins" padding="compact">
              {typeof analysis.financial_requirements === "object" &&
              analysis.financial_requirements !== null ? (
                <div className="ui-stack">
                  {analysis.financial_requirements.min_annual_revenue && (
                    <div>
                      <strong>Doanh thu bình quân:</strong>{" "}
                      {formatVnd(analysis.financial_requirements.min_annual_revenue)}
                    </div>
                  )}
                  {analysis.financial_requirements.bid_security_amount && (
                    <div>
                      <strong>Bảo lãnh dự thầu:</strong>{" "}
                      {formatVnd(analysis.financial_requirements.bid_security_amount)}
                    </div>
                  )}
                  {analysis.financial_requirements.summary && (
                    <div className="ui-muted">{analysis.financial_requirements.summary}</div>
                  )}
                </div>
              ) : (
                <div>
                  {analysis.revenue_requirements ||
                    String(analysis.financial_requirements || "Đáp ứng theo quy định e-GP.")}
                </div>
              )}
            </SectionCard>
          </FormGrid>

          <FormGrid cols={2}>
            <div className="ui-subpanel ui-subpanel--md ui-stack--xs ui-subpanel--success">
              <span className="ui-inline ui-text-xs ui-text-strong">
                <AppIcon name="check-circle" size={15} /> Lợi Thế Cạnh Tranh Của INUT
              </span>
              <ul className="ui-bullet-list">
                {(
                  fit?.strengths ||
                  analysis.strengths || [
                    "Làm chủ 100% công nghệ phần cứng Gateway 4G và nền tảng Web SCADA",
                    "Giá thành sản xuất trong nước tối ưu hơn các giải pháp ngoại nhập",
                    "Đội ngũ kỹ thuật hỗ trợ triển khai và bảo hành tận nơi nhanh chóng",
                  ]
                ).map((str, idx) => (
                  <li key={idx}>{str}</li>
                ))}
              </ul>
            </div>

            <div className="ui-subpanel ui-subpanel--md ui-stack--xs ui-subpanel--warning">
              <span className="ui-inline ui-text-xs ui-text-strong">
                <AppIcon name="alert-triangle" size={15} /> Thách Thức &amp; Kế Hoạch Hành Động
              </span>
              {fit?.strategic_action_plan ? (
                <div>{fit.strategic_action_plan}</div>
              ) : (
                <ul className="ui-bullet-list">
                  {(
                    fit?.challenges ||
                    analysis.risks || [
                      "Kiểm tra yêu cầu số lượng hợp đồng tương tự trước khi lập E-HSDT",
                      "Liên hệ ngân hàng chuẩn bị thư bảo lãnh dự thầu trước thời hạn 48 giờ",
                    ]
                  ).map((chk, idx) => (
                    <li key={idx}>{chk}</li>
                  ))}
                </ul>
              )}
            </div>
          </FormGrid>
        </div>
      )}
    </AppModal>
  );
}
