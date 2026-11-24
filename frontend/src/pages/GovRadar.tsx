import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import {
  AppButton,
  AppIcon,
  DataView,
  EmptyState,
  FilterBar,
  InlineAlert,
  MobileCard,
  MobileCardActions,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  PageHeader,
  PageShell,
  SectionCard,
  StatusBadge,
  TableSkeleton,
  useToast,
  type StatusBadgeTone,
} from "../components/ui";
import { safeHttpUrl } from "../utils/url";

interface GovSource {
  id: string;
  name: string;
  jurisdiction: string;
  portal_url: string;
  fb_url: string;
  badge: string;
}

interface GovDocItem {
  id: number;
  source_key: string;
  source_portal: string;
  source_label: string;
  doc_number: string;
  doc_type: string;
  published_date: string;
  title: string;
  detail_url: string;
  pdf_url: string;
  category: string;
  relevance_score: number;
  applies_to_inut: boolean;
  impact_summary: string;
  matched_keywords: string;
  notified: boolean;
  notify_count: number;
  first_notified_at: string;
  last_notified_at: string;
  acknowledged: boolean;
  created_at: string;
}

interface VerifyResult {
  ok: boolean;
  query: string;
  found_in_gov: boolean;
  applies_to_inut: boolean;
  verdict_badge: string;
  verdict_color: string;
  origin: string;
  root_legal_basis: string;
  daklak_equivalent: string;
  inut_action: string;
  matches: {
    doc_number: string;
    title: string;
    source_label: string;
    detail_url: string;
    pdf_url?: string;
    impact_summary: string;
    applies_to_inut: boolean;
  }[];
}

const CATEGORY_LABELS: Record<string, { label: string; tone: StatusBadgeTone }> = {
  thue_ke_toan: { label: "Thuế & Kế toán (CS7)", tone: "warning" },
  lao_dong_y_te: { label: "Lao động & Y tế", tone: "brand" },
  cong_nghe_ai_iot: { label: "KHCN · AI · Solar", tone: "info" },
  doanh_nghiep_tuy_hoa: { label: "ĐB Tuy Hòa · Đắk Lắk", tone: "neutral" },
  khac: { label: "Hành chính chung", tone: "neutral" },
};

const QUICK_VERIFY_SAMPLES = [
  { q: "16093/SYT-NVY", label: "CV 16093/SYT-NVY (Video Sơn Kế Toán)" },
  { q: "7006/SYT-NVY", label: "CV 7006/SYT-NVY (Hà Nội)" },
  { q: "1858/QĐ-UBND", label: "QĐ 1858/QĐ-UBND (KSK Đắk Lắk)" },
  { q: "25/2026/TT-BYT", label: "Thông tư 25/2026/TT-BYT" },
  { q: "880/TB-CT", label: "Thuế cơ sở 7 Tuy Hòa" },
];

function relevanceTone(score: number): StatusBadgeTone {
  if (score >= 60) return "brand";
  if (score >= 35) return "warning";
  return "neutral";
}

export function GovRadar() {
  const toast = useToast();
  const [sources, setSources] = useState<GovSource[]>([]);
  const [items, setItems] = useState<GovDocItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [syncError, setSyncError] = useState(false);

  // Filters
  const [portalFilter, setPortalFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [appliesOnly, setAppliesOnly] = useState(false);

  // Fact-checker state
  const [verifyInput, setVerifyInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyRes, setVerifyRes] = useState<VerifyResult | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listGovRadar({
        portal: portalFilter || undefined,
        category: categoryFilter || undefined,
        q: searchQ || undefined,
        applies_only: appliesOnly || undefined,
      });
      setSources(data.sources || []);
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [portalFilter, categoryFilter, searchQ, appliesOnly]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg("");
    setSyncError(false);
    try {
      const res = await api.syncGovRadar(true);
      const msg =
        `Đã quét cổng Chính phủ & Thuế CS7 Đắk Lắk: +${res.added} văn bản mới, cập nhật ${res.updated} văn bản (Tổng: ${res.total})` +
        (res.notified_count > 0 ? ` · Đã gửi ${res.notified_count} cảnh báo Telegram` : "") +
        (res.reminder_count ? ` · Đã nhắc lại (sau 3 ngày): ${res.reminder_count}` : "");
      setSyncMsg(msg);
      toast.success(msg);
      await loadData();
    } catch (e: unknown) {
      const errMsg = "Lỗi khi quét: " + (e instanceof Error ? e.message : String(e));
      setSyncError(true);
      setSyncMsg(errMsg);
      toast.error(errMsg);
    } finally {
      setSyncing(false);
    }
  };

  const runVerify = async (qText?: string) => {
    const q = (qText ?? verifyInput).trim();
    if (!q) return;
    if (qText !== undefined) setVerifyInput(qText);
    setVerifying(true);
    try {
      const res = await api.verifyGovDoc(q);
      setVerifyRes(res);
    } catch (e) {
      console.error(e);
      toast.error("Không thể kiểm chứng số công văn lúc này.");
    } finally {
      setVerifying(false);
    }
  };

  const toggleAck = async (doc: GovDocItem) => {
    try {
      const res = await api.ackGovDoc(doc.id, !doc.acknowledged);
      setItems((prev) =>
        prev.map((x) => (x.id === doc.id ? { ...x, acknowledged: res.acknowledged } : x)),
      );
      toast.success(res.acknowledged ? "Đã đánh dấu Đã nắm." : "Đã bỏ trạng thái Đã nắm.");
    } catch (e) {
      console.error(e);
    }
  };

  const activeFilterCount =
    (portalFilter ? 1 : 0) + (categoryFilter ? 1 : 0) + (appliesOnly ? 1 : 0);

  const resetFilters = () => {
    setPortalFilter("");
    setCategoryFilter("");
    setSearchQ("");
    setAppliesOnly(false);
  };

  return (
    <PageShell data-page="gov-radar">
      <div className="ui-stack--lg">
        <PageHeader
          variant="compact"
          icon="landmark"
          eyebrow="INUT · PHÁP LÝ & THUẾ CS7"
          title="Radar Công văn Chính phủ & Thuế cơ sở 7 Đắk Lắk"
          subtitle={
            <>
              Chủ động theo dõi văn bản gốc từ <strong>.gov.vn</strong> &amp;{" "}
              <strong>Thuế cơ sở 7 tỉnh Đắk Lắk (Phường Tuy Hòa)</strong> — tự động phân tích mức
              độ áp dụng cho{" "}
              <strong>INUT (MST 4401053694 · 2 nhân sự Khánh &amp; Nhâm)</strong>.
            </>
          }
          badges={
            <>
              <StatusBadge tone="info" icon="clock">
                Chu kỳ: 1 tuần / lần
              </StatusBadge>
              <StatusBadge tone="neutral" icon="bell" className="ui-wrap">
                Nhắc lại 1 lần sau 3 ngày nếu chưa Đã nắm
              </StatusBadge>
            </>
          }
          actions={
            <AppButton
              variant="primary"
              leftIcon="refresh"
              loading={syncing}
              onClick={handleSync}
            >
              {syncing ? "Đang quét .gov.vn…" : "Quét công văn mới & Báo Telegram"}
            </AppButton>
          }
        />

        {syncMsg && (
          <InlineAlert
            tone={syncError ? "danger" : "success"}
            onDismiss={() => setSyncMsg("")}
          >
            {syncMsg}
          </InlineAlert>
        )}

        {/* Official Portals Cards */}
        {sources.length > 0 && (
          <div className="ui-grid-cards-sm">
            {sources.map((s) => {
              const portalHref = safeHttpUrl(s.portal_url);
              const fbHref = safeHttpUrl(s.fb_url);
              const isSelected = portalFilter === s.id;
              return (
                <article
                  key={s.id}
                  className={[
                    "ui-subpanel ui-subpanel--card gov-portal-card",
                    s.id === "daklak_tax_cs7" ? "is-priority" : "",
                    isSelected ? "is-active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <div>
                    <div className="ui-row-between">
                      <StatusBadge
                        tone={s.id === "daklak_tax_cs7" ? "warning" : "brand"}
                        size="sm"
                      >
                        {s.badge}
                      </StatusBadge>
                      <AppButton
                        variant={isSelected ? "primary" : "ghost"}
                        size="sm"
                        leftIcon={isSelected ? "check" : "filter"}
                        onClick={() => setPortalFilter(isSelected ? "" : s.id)}
                      >
                        {isSelected ? "Đang lọc" : "Lọc nguồn này"}
                      </AppButton>
                    </div>
                    <div className="gov-portal-title">{s.name}</div>
                    <div className="ui-muted">{s.jurisdiction}</div>
                  </div>

                  <div className="ui-row">
                    {portalHref && (
                      <a
                        href={portalHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ui-btn ui-btn--secondary ui-btn--sm"
                      >
                        <AppIcon name="globe" size={14} />
                        <span>Mở Cổng .gov.vn</span>
                        <AppIcon name="external-link" size={12} />
                      </a>
                    )}
                    {fbHref && (
                      <a
                        href={fbHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ui-btn ui-btn--ghost ui-btn--sm"
                      >
                        <AppIcon name="megaphone" size={14} />
                        <span>Fanpage Thuế CS7 Đắk Lắk</span>
                        <AppIcon name="external-link" size={12} />
                      </a>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* Fact-Checker Box */}
        <SectionCard
          title="Kiểm chứng nhanh số hiệu Công văn"
          subtitle="Chống nhiễu thông tin từ TikTok / Facebook — đối chiếu nguồn gốc và mức độ áp dụng cho INUT ở Đắk Lắk."
          icon="search"
          tone="subtle"
          padding="compact"
        >
          <div className="ui-stack--lg">
            <div className="ui-muted">
              Gõ bất kỳ số công văn nào (VD: <code>16093/SYT-NVY</code>, <code>7006/SYT-NVY</code>,{" "}
              <code>1858/QĐ-UBND</code>, <code>25/2026/TT-BYT</code>):
            </div>

            <div className="ui-row">
              <input
                type="text"
                aria-label="Nhập số công văn hoặc từ khóa kiểm chứng"
                className="ui-input ui-grow"
                value={verifyInput}
                onChange={(e) => setVerifyInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runVerify()}
                placeholder="Nhập số công văn hoặc từ khóa (VD: 16093/SYT-NVY, khám sức khỏe, hoàn thuế)..."
              />
              <AppButton
                variant="primary"
                leftIcon="search"
                loading={verifying}
                disabled={!verifyInput.trim()}
                onClick={() => runVerify()}
              >
                {verifying ? "Đang tra cứu…" : "Kiểm chứng ngay"}
              </AppButton>
              {verifyRes && (
                <AppButton variant="ghost" size="sm" onClick={() => setVerifyRes(null)}>
                  Đóng kết quả
                </AppButton>
              )}
            </div>

            <div className="ui-row tp-actions-wrap">
              <span className="ui-muted">Thử nhanh:</span>
              {QUICK_VERIFY_SAMPLES.map((sample) => (
                <AppButton
                  key={sample.q}
                  variant="secondary"
                  size="sm"
                  onClick={() => runVerify(sample.q)}
                >
                  {sample.label}
                </AppButton>
              ))}
            </div>

            {verifyRes && (
              <div
                className={[
                  "ui-subpanel ui-subpanel--card ui-mt-3 ui-stack--sm gov-verify-panel",
                  verifyRes.verdict_color === "warning"
                    ? "is-warning"
                    : verifyRes.verdict_color === "success"
                      ? "is-success"
                      : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className="ui-row">
                  <StatusBadge
                    tone={
                      verifyRes.verdict_color === "warning"
                        ? "warning"
                        : verifyRes.verdict_color === "success"
                          ? "success"
                          : "neutral"
                    }
                  >
                    {verifyRes.verdict_badge}
                  </StatusBadge>
                  <strong className="ui-text-strong">
                    Tra cứu: &ldquo;{verifyRes.query}&rdquo;
                  </strong>
                </div>
                <div>
                  <strong>Nguồn gốc ban hành:</strong> {verifyRes.origin}
                </div>
                <div>
                  <strong>Căn cứ pháp lý gốc:</strong> {verifyRes.root_legal_basis}
                </div>
                <div>
                  <strong>Quy định tại tỉnh Đắk Lắk (Phường Tuy Hòa):</strong>{" "}
                  {verifyRes.daklak_equivalent}
                </div>
                <InlineAlert tone="info" title="Kết luận cho INUT">
                  {verifyRes.inut_action}
                </InlineAlert>
              </div>
            )}
          </div>
        </SectionCard>

        {/* Filter Bar */}
        <FilterBar
          collapsibleMobile
          search={{
            value: searchQ,
            onChange: setSearchQ,
            placeholder: "Lọc theo số hiệu, trích yếu, từ khóa...",
            ariaLabel: "Tìm kiếm công văn",
          }}
          activeCount={activeFilterCount}
          onReset={resetFilters}
          filters={
            <>
              <select
                aria-label="Lọc theo nguồn cổng"
                className="ui-select"
                value={portalFilter}
                onChange={(e) => setPortalFilter(e.target.value)}
              >
                <option value="">Tất cả nguồn ({total})</option>
                <option value="daklak_tax_cs7">
                  Thuế tỉnh Đắk Lắk &amp; Thuế cơ sở 7 (Tuy Hòa)
                </option>
                <option value="daklak_ubnd">UBND Tỉnh Đắk Lắk (Chỉ đạo điều hành)</option>
                <option value="daklak_syt">Sở Y tế Tỉnh Đắk Lắk</option>
                <option value="chinhphu">Chính phủ &amp; Bộ ngành Trung ương</option>
              </select>

              <select
                aria-label="Lọc theo lĩnh vực"
                className="ui-select"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="">Tất cả lĩnh vực</option>
                <option value="thue_ke_toan">Thuế &amp; Kế toán (CS7)</option>
                <option value="lao_dong_y_te">Lao động, BHXH &amp; Khám sức khỏe</option>
                <option value="cong_nghe_ai_iot">KHCN · AI · Chuyển đổi số · Solar</option>
                <option value="doanh_nghiep_tuy_hoa">Địa bàn Tuy Hòa · Đắk Lắk</option>
                <option value="khac">Hành chính khác</option>
              </select>

              <label className="ui-check-label">
                <input
                  type="checkbox"
                  checked={appliesOnly}
                  onChange={(e) => setAppliesOnly(e.target.checked)}
                />
                <span>Chỉ hiện văn bản liên quan INUT</span>
              </label>
            </>
          }
        />

        {/* Document Table / Mobile Cards */}
        {loading ? (
          <SectionCard padding="flush">
            <TableSkeleton rows={6} cols={5} />
          </SectionCard>
        ) : items.length === 0 ? (
          <SectionCard>
            <EmptyState
              icon="file-search"
              title="Không có văn bản nào khớp bộ lọc hiện tại"
              description="Thử xóa bộ lọc hoặc bấm Quét công văn mới để đồng bộ dữ liệu mới nhất."
              action={
                activeFilterCount > 0 || searchQ ? (
                  <AppButton variant="secondary" size="sm" onClick={resetFilters}>
                    Xóa bộ lọc
                  </AppButton>
                ) : undefined
              }
            />
          </SectionCard>
        ) : (
          <DataView
            mobileMode="card"
            desktop={
              <SectionCard padding="flush">
                <div className="table-wrap">
                  <table className="dt ui-table gov-table">
                    <thead>
                      <tr>
                        <th>Số ký hiệu / Ngày</th>
                        <th>Cơ quan &amp; Lĩnh vực</th>
                        <th>Trích yếu văn bản &amp; Đánh giá tác động tới INUT</th>
                        <th className="ui-text-center">Độ liên quan</th>
                        <th>Bản gốc (.gov.vn)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const catMeta = CATEGORY_LABELS[item.category] || CATEGORY_LABELS.khac;
                        const detailHref = safeHttpUrl(item.detail_url);
                        const pdfHref = safeHttpUrl(item.pdf_url);
                        return (
                          <tr key={item.id}>
                            <td>
                              <div className="ui-text-strong">
                                {item.doc_number || item.doc_type}
                              </div>
                              <div className="ui-muted">
                                {item.doc_type} · {item.published_date}
                              </div>
                            </td>
                            <td>
                              <div className="ui-text-strong">{item.source_label}</div>
                              <StatusBadge tone={catMeta.tone} size="sm">
                                {catMeta.label}
                              </StatusBadge>
                            </td>
                            <td>
                              <div className="ui-text-strong">{item.title}</div>
                              <div
                                className={`ui-subpanel ui-mt-2 ui-text-xs${item.applies_to_inut ? " ui-subpanel--brand" : ""}`}
                              >
                                {item.impact_summary}
                              </div>
                              {item.matched_keywords && (
                                <div className="ui-muted">
                                  Từ khóa khớp: <code>{item.matched_keywords}</code>
                                </div>
                              )}
                            </td>
                            <td className="ui-text-center">
                              <StatusBadge tone={relevanceTone(item.relevance_score)} size="sm">
                                {item.relevance_score}%
                              </StatusBadge>
                              <div>
                                {item.acknowledged ? (
                                  <StatusBadge tone="success" size="sm" icon="check">
                                    Đã nắm (Tắt nhắc)
                                  </StatusBadge>
                                ) : item.notify_count >= 2 ? (
                                  <StatusBadge tone="neutral" size="sm" icon="bell">
                                    Đã nhắc đủ 2 lần
                                  </StatusBadge>
                                ) : item.notify_count === 1 || item.notified ? (
                                  <StatusBadge tone="warning" size="sm" icon="bell">
                                    Đã báo L1 (+3 ngày nhắc)
                                  </StatusBadge>
                                ) : null}
                              </div>
                            </td>
                            <td>
                              <div className="ui-stack--sm">
                                {detailHref && (
                                  <a
                                    href={detailHref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ui-btn ui-btn--secondary ui-btn--sm"
                                  >
                                    <AppIcon name="globe" size={14} />
                                    <span>Xem trên Cổng</span>
                                    <AppIcon name="external-link" size={12} />
                                  </a>
                                )}
                                {pdfHref && (
                                  <a
                                    href={pdfHref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ui-btn ui-btn--secondary ui-btn--sm"
                                  >
                                    <AppIcon
                                      name={
                                        pdfHref.includes("facebook.com") ? "megaphone" : "file-text"
                                      }
                                      size={14}
                                    />
                                    <span>
                                      {pdfHref.includes("facebook.com")
                                        ? "Fanpage Thuế CS7"
                                        : "Tải PDF ký số"}
                                    </span>
                                    <AppIcon name="external-link" size={12} />
                                  </a>
                                )}
                                {item.applies_to_inut && (
                                  <AppButton
                                    variant={item.acknowledged ? "secondary" : "ghost"}
                                    size="sm"
                                    leftIcon={item.acknowledged ? "check-circle" : "check"}
                                    onClick={() => toggleAck(item)}
                                  >
                                    {item.acknowledged ? "Đã nắm" : "Đánh dấu Đã nắm"}
                                  </AppButton>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            }
            mobileCards={
              <div className="ui-mobile-card-list">
                {items.map((item) => {
                  const catMeta = CATEGORY_LABELS[item.category] || CATEGORY_LABELS.khac;
                  const detailHref = safeHttpUrl(item.detail_url);
                  const pdfHref = safeHttpUrl(item.pdf_url);
                  return (
                    <MobileCard key={item.id}>
                      <MobileCardHeader
                        title={item.doc_number || item.doc_type}
                        subtitle={`${item.published_date} · ${item.source_label}`}
                        badge={
                          <StatusBadge tone={relevanceTone(item.relevance_score)} size="sm">
                            {item.relevance_score}%
                          </StatusBadge>
                        }
                      />
                      <div className="ui-text-strong">{item.title}</div>
                      <MobileCardGrid cols={2}>
                        <MobileCardRow
                          label="Lĩnh vực"
                          value={
                            <StatusBadge tone={catMeta.tone} size="sm">
                              {catMeta.label}
                            </StatusBadge>
                          }
                        />
                        <MobileCardRow
                          label="Trạng thái"
                          value={
                            item.acknowledged ? (
                              <StatusBadge tone="success" size="sm" icon="check">
                                Đã nắm
                              </StatusBadge>
                            ) : (
                              <StatusBadge tone="neutral" size="sm">
                                Chưa xác nhận
                              </StatusBadge>
                            )
                          }
                        />
                      </MobileCardGrid>
                      <div
                        className={`ui-subpanel ui-mt-2 ui-text-xs${item.applies_to_inut ? " ui-subpanel--brand" : ""}`}
                      >
                        {item.impact_summary}
                      </div>
                      <MobileCardActions>
                        {detailHref && (
                          <a
                            href={detailHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ui-btn ui-btn--secondary ui-btn--sm"
                          >
                            <AppIcon name="globe" size={14} />
                            <span>Xem Cổng</span>
                          </a>
                        )}
                        {pdfHref && (
                          <a
                            href={pdfHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ui-btn ui-btn--secondary ui-btn--sm"
                          >
                            <AppIcon
                              name={pdfHref.includes("facebook.com") ? "megaphone" : "file-text"}
                              size={14}
                            />
                            <span>{pdfHref.includes("facebook.com") ? "Fanpage" : "PDF"}</span>
                          </a>
                        )}
                        {item.applies_to_inut && (
                          <AppButton
                            variant={item.acknowledged ? "secondary" : "ghost"}
                            size="sm"
                            leftIcon={item.acknowledged ? "check-circle" : "check"}
                            onClick={() => toggleAck(item)}
                          >
                            {item.acknowledged ? "Đã nắm" : "Đánh dấu Đã nắm"}
                          </AppButton>
                        )}
                      </MobileCardActions>
                    </MobileCard>
                  );
                })}
              </div>
            }
          />
        )}
      </div>
    </PageShell>
  );
}
