import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { DataView, FormGrid, PageHeader } from "../components/ui";
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

const CATEGORY_LABELS: Record<string, { label: string; bg: string; fg: string }> = {
  thue_ke_toan: { label: "Thuế & Kế toán (CS7)", bg: "#fdf3de", fg: "#8a5710" },
  lao_dong_y_te: { label: "Lao động & Y tế", bg: "var(--primary-soft)", fg: "var(--ink)" },
  cong_nghe_ai_iot: { label: "KHCN · AI · Solar", bg: "#e6f2ef", fg: "var(--primary-dark)" },
  doanh_nghiep_tuy_hoa: { label: "ĐB Tuy Hòa · Đắk Lắk", bg: "var(--paper)", fg: "var(--ink)" },
  khac: { label: "Hành chính chung", bg: "var(--bg)", fg: "var(--text)" },
};

export function GovRadar() {
  const [sources, setSources] = useState<GovSource[]>([]);
  const [items, setItems] = useState<GovDocItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

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
    try {
      const res = await api.syncGovRadar(true);
      setSyncMsg(
        `Đã quét cổng Chính phủ & Thuế CS7 Đắk Lắk: +${res.added} văn bản mới, cập nhật ${res.updated} văn bản (Tổng: ${res.total})` +
          (res.notified_count > 0 ? ` · Đã gửi ${res.notified_count} cảnh báo Telegram` : "") +
          (res.reminder_count ? ` · Đã nhắc lại (sau 3 ngày): ${res.reminder_count}` : "")
      );
      await loadData();
    } catch (e: unknown) {
      setSyncMsg("Lỗi khi quét: " + (e instanceof Error ? e.message : String(e)));
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
    } finally {
      setVerifying(false);
    }
  };

  const toggleAck = async (doc: GovDocItem) => {
    try {
      const res = await api.ackGovDoc(doc.id, !doc.acknowledged);
      setItems((prev) =>
        prev.map((x) => (x.id === doc.id ? { ...x, acknowledged: res.acknowledged } : x))
      );
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="docs-page">
      <PageHeader
        eyebrow="INUT · PHÁP LÝ & THUẾ CS7"
        title="📡 Radar Công văn Chính phủ & Thuế cơ sở 7 Đắk Lắk"
        subtitle={
          <>
            Chủ động theo dõi văn bản gốc từ <strong>.gov.vn</strong> &amp;{" "}
            <strong>Thuế cơ sở 7 tỉnh Đắk Lắk (Phường Tuy Hòa)</strong> — tự động phân tích mức độ áp dụng cho{" "}
            <strong>INUT (MST 4401053694 · 2 nhân sự Khánh &amp; Nhâm)</strong>.
          </>
        }
        badges={
          <div
            style={{
              fontSize: 12,
              display: "inline-flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
              background: "rgba(255,254,250,0.12)",
              border: "1px solid rgba(255,254,250,0.24)",
              color: "#eef5f2",
              padding: "5px 10px",
              borderRadius: 8,
              fontWeight: 500,
            }}
          >
            <span>⏱️ Chu kỳ tự động: <strong>1 tuần / lần</strong></span>
            <span>·</span>
            <span>Công văn đã báo trong DB không báo trùng — chỉ <strong>nhắc lại 1 lần sau 3 ngày</strong> trong tuần nếu chưa bấm &ldquo;Đã nắm&rdquo;</span>
          </div>
        }
        actions={
          <button
            className="primary"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? "⏳ Đang quét .gov.vn…" : "↻ Quét công văn mới & Báo Telegram"}
          </button>
        }
      />

      {syncMsg && (
        <div
          style={{
            padding: "10px 14px",
            marginBottom: 16,
            borderRadius: 10,
            background: "var(--primary-soft)",
            border: "1px solid var(--border-strong)",
            color: "var(--ink)",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          ✅ {syncMsg}
        </div>
      )}

      {/* Official Portals Cards */}
      <div className="ui-grid-cards-sm" style={{ marginBottom: 20 }}>
        {sources.map((s) => {
          const portalHref = safeHttpUrl(s.portal_url);
          const fbHref = safeHttpUrl(s.fb_url);
          return (
            <div
              key={s.id}
              className="card"
              style={{
                padding: 14,
                border:
                  portalFilter === s.id
                    ? "2px solid var(--primary)"
                    : s.id === "daklak_tax_cs7"
                      ? "1px solid var(--amber)"
                      : "1px solid var(--border)",
                background: s.id === "daklak_tax_cs7" ? "var(--paper)" : "var(--panel)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: 10,
                minWidth: 0,
              }}
            >
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 99,
                      background: s.id === "daklak_tax_cs7" ? "#fdf3de" : "var(--primary-soft)",
                      color: s.id === "daklak_tax_cs7" ? "#8a5710" : "var(--primary-dark)",
                    }}
                  >
                    {s.badge}
                  </span>
                  <button
                    className="ghost ui-btn-chip"
                    onClick={() => setPortalFilter(portalFilter === s.id ? "" : s.id)}
                  >
                    {portalFilter === s.id ? "✓ Đang lọc" : "Lọc nguồn này"}
                  </button>
                </div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "var(--ink)", marginBottom: 4 }}>{s.name}</div>
                <div className="muted" style={{ fontSize: 12, lineHeight: 1.4 }}>
                  {s.jurisdiction}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                {portalHref && (
                  <a
                    href={portalHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ui-btn-chip"
                    style={{
                      fontWeight: 600,
                      color: "var(--primary-dark)",
                      textDecoration: "none",
                    }}
                  >
                    🌐 Mở Cổng .gov.vn ↗
                  </a>
                )}
                {fbHref && (
                  <a
                    href={fbHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ui-btn-chip"
                    style={{
                      fontWeight: 600,
                      color: "var(--ink)",
                      textDecoration: "none",
                      background: "var(--primary-soft)",
                    }}
                  >
                    📘 Fanpage Thuế CS7 Đắk Lắk ↗
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Fact-Checker Box */}
      <div
        className="card"
        style={{
          padding: 16,
          marginBottom: 20,
          background: "var(--paper)",
          border: "1px solid var(--border-strong)",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15, color: "var(--ink)", marginBottom: 6 }}>
          🔍 Kiểm chứng nhanh số hiệu Công văn (Chống nhiễu thông tin từ TikTok / Facebook)
        </div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          Gõ bất kỳ số công văn nào anh nghe trên mạng (VD: <code>16093/SYT-NVY</code>, <code>7006/SYT-NVY</code>,{" "}
          <code>1858/QĐ-UBND</code>, <code>25/2026/TT-BYT</code>) để đối chiếu nguồn gốc và xem có áp dụng cho INUT ở
          Đắk Lắk hay không:
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <input
            type="text"
            className="ui-input"
            value={verifyInput}
            onChange={(e) => setVerifyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runVerify()}
            placeholder="Nhập số công văn hoặc từ khóa (VD: 16093/SYT-NVY, khám sức khỏe, hoàn thuế)..."
            style={{ flex: "1 1 220px", minWidth: 0 }}
          />
          <button
            className="primary"
            onClick={() => runVerify()}
            disabled={verifying || !verifyInput.trim()}
          >
            {verifying ? "Đang tra cứu…" : "Kiểm chứng ngay"}
          </button>
          {verifyRes && (
            <button className="ghost ui-btn-chip" onClick={() => setVerifyRes(null)}>
              Đóng kết quả
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>
          <span className="muted">Thử nhanh:</span>
          {[
            { q: "16093/SYT-NVY", label: "CV 16093/SYT-NVY (Video Sơn Kế Toán)" },
            { q: "7006/SYT-NVY", label: "CV 7006/SYT-NVY (Hà Nội)" },
            { q: "1858/QĐ-UBND", label: "QĐ 1858/QĐ-UBND (KSK Đắk Lắk)" },
            { q: "25/2026/TT-BYT", label: "Thông tư 25/2026/TT-BYT" },
            { q: "880/TB-CT", label: "Thuế cơ sở 7 Tuy Hòa" },
          ].map((chip) => (
            <button
              key={chip.q}
              className="ghost ui-btn-chip"
              onClick={() => runVerify(chip.q)}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {verifyRes && (
          <div
            style={{
              marginTop: 14,
              padding: 14,
              borderRadius: 10,
              background: "var(--panel)",
              border:
                verifyRes.verdict_color === "warning"
                  ? "2px solid var(--amber)"
                  : verifyRes.verdict_color === "success"
                    ? "2px solid var(--green)"
                    : "1px solid var(--border-strong)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 12,
                  padding: "3px 10px",
                  borderRadius: 99,
                  background:
                    verifyRes.verdict_color === "warning"
                      ? "#fdf3de"
                      : verifyRes.verdict_color === "success"
                        ? "var(--primary-soft)"
                        : "var(--bg)",
                  color:
                    verifyRes.verdict_color === "warning"
                      ? "#8a5710"
                      : verifyRes.verdict_color === "success"
                        ? "var(--ink)"
                        : "var(--text)",
                }}
              >
                {verifyRes.verdict_badge}
              </span>
              <strong style={{ fontSize: 14, color: "var(--ink)" }}>Tra cứu: &ldquo;{verifyRes.query}&rdquo;</strong>
            </div>
            <div style={{ display: "grid", gap: 6, fontSize: 13, lineHeight: 1.5, color: "var(--text)" }}>
              <div>
                <strong>• Nguồn gốc ban hành:</strong> {verifyRes.origin}
              </div>
              <div>
                <strong>• Căn cứ pháp lý gốc:</strong> {verifyRes.root_legal_basis}
              </div>
              <div>
                <strong>• Quy định tại tỉnh Đắk Lắk (Phường Tuy Hòa):</strong> {verifyRes.daklak_equivalent}
              </div>
              <div
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "var(--primary-soft)",
                  border: "1px solid var(--border-strong)",
                  color: "var(--ink)",
                }}
              >
                <strong>👉 Kết luận cho INUT:</strong> {verifyRes.inut_action}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Filter Bar */}
      <div className="card" style={{ padding: "12px 14px", marginBottom: 14 }}>
        <FormGrid cols={3}>
          <select
            className="ui-select"
            value={portalFilter}
            onChange={(e) => setPortalFilter(e.target.value)}
          >
            <option value="">Tất cả nguồn ({total})</option>
            <option value="daklak_tax_cs7">Thuế tỉnh Đắk Lắk &amp; Thuế cơ sở 7 (Tuy Hòa)</option>
            <option value="daklak_ubnd">UBND Tỉnh Đắk Lắk (Chỉ đạo điều hành)</option>
            <option value="daklak_syt">Sở Y tế Tỉnh Đắk Lắk</option>
            <option value="chinhphu">Chính phủ &amp; Bộ ngành Trung ương</option>
          </select>

          <select
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

          <input
            type="text"
            className="ui-input"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Lọc theo số hiệu, trích yếu, từ khóa..."
          />
        </FormGrid>

        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", marginTop: 10 }}>
          <input
            type="checkbox"
            checked={appliesOnly}
            onChange={(e) => setAppliesOnly(e.target.checked)}
          />
          <span>Chỉ hiện văn bản liên quan INUT</span>
        </label>
      </div>

      {/* Document Table / Mobile Cards */}
      {loading ? (
        <div className="panel" style={{ padding: 32, textAlign: "center" }}>
          Đang tải danh sách công văn Chính phủ &amp; Tỉnh Đắk Lắk…
        </div>
      ) : items.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: "center" }}>
          <p className="muted">Không có văn bản nào khớp bộ lọc hiện tại.</p>
        </div>
      ) : (
        <DataView
          mobileMode="card"
          desktop={
            <div className="table-wrap">
              <table className="dt" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ width: 150 }}>Số ký hiệu / Ngày</th>
                    <th style={{ width: 170 }}>Cơ quan &amp; Lĩnh vực</th>
                    <th>Trích yếu văn bản &amp; Đánh giá tác động tới INUT</th>
                    <th style={{ width: 110, textAlign: "center" }}>Độ liên quan</th>
                    <th style={{ width: 140 }}>Bản gốc (.gov.vn)</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const catMeta = CATEGORY_LABELS[item.category] || CATEGORY_LABELS.khac;
                    const detailHref = safeHttpUrl(item.detail_url);
                    const pdfHref = safeHttpUrl(item.pdf_url);
                    return (
                      <tr key={item.id} style={{ borderTop: "1px solid var(--border)", verticalAlign: "top" }}>
                        <td>
                          <div style={{ fontWeight: 700, color: "var(--ink)" }}>{item.doc_number || item.doc_type}</div>
                          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                            {item.doc_type} · {item.published_date}
                          </div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>{item.source_label}</div>
                          <span
                            style={{
                              display: "inline-block",
                              fontSize: 11,
                              fontWeight: 600,
                              padding: "2px 8px",
                              borderRadius: 99,
                              background: catMeta.bg,
                              color: catMeta.fg,
                            }}
                          >
                            {catMeta.label}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, color: "var(--ink)", marginBottom: 6, lineHeight: 1.4 }}>
                            {item.title}
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              padding: "6px 10px",
                              borderRadius: 6,
                              background: item.applies_to_inut ? "var(--primary-soft)" : "var(--paper)",
                              border: "1px solid var(--border)",
                              color: item.applies_to_inut ? "var(--ink)" : "var(--text)",
                              lineHeight: 1.4,
                            }}
                          >
                            {item.impact_summary}
                          </div>
                          {item.matched_keywords && (
                            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                              Từ khóa khớp: <code>{item.matched_keywords}</code>
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <span
                            style={{
                              display: "inline-block",
                              fontWeight: 700,
                              fontSize: 12,
                              padding: "3px 8px",
                              borderRadius: 6,
                              background:
                                item.relevance_score >= 60
                                  ? "var(--primary-soft)"
                                  : item.relevance_score >= 35
                                    ? "#fdf3de"
                                    : "var(--bg)",
                              color:
                                item.relevance_score >= 60
                                  ? "var(--ink)"
                                  : item.relevance_score >= 35
                                    ? "#8a5710"
                                    : "var(--muted)",
                            }}
                          >
                            {item.relevance_score}%
                          </span>
                          <div style={{ marginTop: 6 }}>
                            {item.acknowledged ? (
                              <span style={{ fontSize: 11, color: "var(--green)", fontWeight: 600 }}>
                                ✓ Đã nắm (Tắt nhắc)
                              </span>
                            ) : item.notify_count >= 2 ? (
                              <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>
                                🔕 Đã nhắc đủ 2 lần
                              </span>
                            ) : item.notify_count === 1 || item.notified ? (
                              <span style={{ fontSize: 11, color: "var(--amber)", fontWeight: 600 }}>
                                🔔 Đã báo L1 (+3 ngày nhắc)
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {detailHref && (
                              <a
                                href={detailHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ui-btn-chip"
                                style={{ fontWeight: 600, color: "var(--primary-dark)", textDecoration: "none" }}
                              >
                                🌐 Xem trên Cổng ↗
                              </a>
                            )}
                            {pdfHref && (
                              <a
                                href={pdfHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ui-btn-chip"
                                style={{
                                  fontWeight: 600,
                                  color: pdfHref.includes("facebook.com") ? "var(--primary-dark)" : "var(--red)",
                                  textDecoration: "none",
                                }}
                              >
                                {pdfHref.includes("facebook.com") ? "📘 Fanpage Thuế CS7 ↗" : "📄 Tải PDF ký số ↗"}
                              </a>
                            )}
                            {item.applies_to_inut && (
                              <button
                                className="ghost ui-btn-chip"
                                onClick={() => toggleAck(item)}
                                style={{
                                  background: item.acknowledged ? "var(--primary-soft)" : "var(--panel)",
                                  color: item.acknowledged ? "var(--ink)" : "var(--text)",
                                  fontWeight: 600,
                                }}
                              >
                                {item.acknowledged ? "✓ Đã nắm" : "Đánh dấu Đã nắm"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          }
          mobileCards={
            <div className="ui-mobile-card-list">
              {items.map((item) => {
                const catMeta = CATEGORY_LABELS[item.category] || CATEGORY_LABELS.khac;
                const detailHref = safeHttpUrl(item.detail_url);
                const pdfHref = safeHttpUrl(item.pdf_url);
                return (
                  <article key={item.id} className="ui-mobile-card">
                    <div className="ui-mobile-card-head">
                      <strong className="ui-mobile-card-title">{item.doc_number || item.doc_type}</strong>
                      <span
                        className="chip sm"
                        style={{
                          background: item.relevance_score >= 60 ? "var(--primary-soft)" : "#fdf3de",
                          color: item.relevance_score >= 60 ? "var(--ink)" : "#8a5710",
                        }}
                      >
                        {item.relevance_score}%
                      </span>
                    </div>
                    <div style={{ fontWeight: 600, color: "var(--ink)", lineHeight: 1.4 }}>{item.title}</div>
                    <div className="ui-mobile-card-meta">
                      <span>{item.published_date}</span>
                      <span>{item.source_label}</span>
                      <span style={{ background: catMeta.bg, color: catMeta.fg, padding: "2px 8px", borderRadius: 99, fontWeight: 600 }}>
                        {catMeta.label}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        padding: "6px 10px",
                        borderRadius: 6,
                        background: item.applies_to_inut ? "var(--primary-soft)" : "var(--paper)",
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                        lineHeight: 1.4,
                      }}
                    >
                      {item.impact_summary}
                    </div>
                    <div className="ui-mobile-card-actions">
                      {detailHref && (
                        <a href={detailHref} target="_blank" rel="noopener noreferrer" className="ui-btn-chip">
                          🌐 Xem Cổng ↗
                        </a>
                      )}
                      {pdfHref && (
                        <a href={pdfHref} target="_blank" rel="noopener noreferrer" className="ui-btn-chip">
                          {pdfHref.includes("facebook.com") ? "📘 Fanpage ↗" : "📄 PDF ↗"}
                        </a>
                      )}
                      {item.applies_to_inut && (
                        <button className="ghost ui-btn-chip" onClick={() => toggleAck(item)}>
                          {item.acknowledged ? "✓ Đã nắm" : "Đánh dấu Đã nắm"}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          }
        />
      )}
    </div>
  );
}
