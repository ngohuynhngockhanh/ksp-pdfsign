import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

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
  thue_ke_toan: { label: "Thuế & Kế toán (CS7)", bg: "#fef3c7", fg: "#92400e" },
  lao_dong_y_te: { label: "Lao động & Y tế", bg: "#dcfce7", fg: "#166534" },
  cong_nghe_ai_iot: { label: "KHCN · AI · Solar", bg: "#dbeafe", fg: "#1e40af" },
  doanh_nghiep_tuy_hoa: { label: "ĐB Tuy Hòa · Đắk Lắk", bg: "#f3e8ff", fg: "#6b21a8" },
  khac: { label: "Hành chính chung", bg: "#f1f5f9", fg: "#475569" },
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
    <div className="page" style={{ maxWidth: 1280, margin: "0 auto", padding: "20px 16px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div>
          <h2 style={{ margin: "0 0 6px", fontSize: 22 }}>
            📡 Radar Công văn Chính phủ &amp; Thuế cơ sở 7 Đắk Lắk
          </h2>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Chủ động theo dõi văn bản gốc từ <strong>.gov.vn</strong> &amp;{" "}
            <strong>Thuế cơ sở 7 tỉnh Đắk Lắk (Phường Tuy Hòa)</strong> — tự động phân tích mức độ áp dụng cho{" "}
            <strong>INUT (MST 4401053694 · 2 nhân sự Khánh &amp; Nhâm)</strong>.
          </p>
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              color: "#1e40af",
              padding: "4px 10px",
              borderRadius: 6,
              fontWeight: 500,
            }}
          >
            <span>⏱️ Chu kỳ tự động: <strong>1 tuần / lần</strong></span>
            <span>·</span>
            <span>Công văn đã báo trong DB không báo trùng — chỉ <strong>nhắc lại 1 lần sau 3 ngày</strong> trong tuần nếu chưa bấm &ldquo;Đã nắm&rdquo;</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            className="primary"
            onClick={handleSync}
            disabled={syncing}
            style={{ padding: "8px 14px", fontWeight: 600 }}
          >
            {syncing ? "⏳ Đang quét .gov.vn…" : "↻ Quét công văn mới & Báo Telegram"}
          </button>
        </div>
      </div>

      {syncMsg && (
        <div
          style={{
            padding: "10px 14px",
            marginBottom: 16,
            borderRadius: 8,
            background: "#ecfdf5",
            border: "1px solid #a7f3d0",
            color: "#065f46",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          ✅ {syncMsg}
        </div>
      )}

      {/* Official Portals Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(275px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        {sources.map((s) => (
          <div
            key={s.id}
            className="card"
            style={{
              padding: 14,
              border:
                portalFilter === s.id
                  ? "2px solid #2563eb"
                  : s.id === "daklak_tax_cs7"
                    ? "1px solid #f59e0b"
                    : "1px solid #e2e8f0",
              background: s.id === "daklak_tax_cs7" ? "#fffbeb" : "#fff",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 99,
                    background: s.id === "daklak_tax_cs7" ? "#fef3c7" : "#eff6ff",
                    color: s.id === "daklak_tax_cs7" ? "#b45309" : "#1d4ed8",
                  }}
                >
                  {s.badge}
                </span>
                <button
                  className="ghost"
                  style={{ fontSize: 11, padding: "2px 8px" }}
                  onClick={() => setPortalFilter(portalFilter === s.id ? "" : s.id)}
                >
                  {portalFilter === s.id ? "✓ Đang lọc" : "Lọc nguồn này"}
                </button>
              </div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{s.name}</div>
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.4 }}>
                {s.jurisdiction}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              <a
                href={s.portal_url}
                target="_blank"
                rel="noreferrer"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#2563eb",
                  textDecoration: "none",
                }}
              >
                🌐 Mở Cổng .gov.vn ↗
              </a>
              {s.fb_url && (
                <a
                  href={s.fb_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#0284c7",
                    textDecoration: "none",
                    background: "#e0f2fe",
                    padding: "2px 8px",
                    borderRadius: 6,
                  }}
                >
                  📘 Fanpage Thuế CS7 Đắk Lắk ↗
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Fact-Checker Box */}
      <div
        className="card"
        style={{
          padding: 16,
          marginBottom: 20,
          background: "#f8fafc",
          border: "1px solid #cbd5e1",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
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
            value={verifyInput}
            onChange={(e) => setVerifyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runVerify()}
            placeholder="Nhập số công văn hoặc từ khóa (VD: 16093/SYT-NVY, khám sức khỏe, hoàn thuế)..."
            style={{ flex: 1, minWidth: 260, padding: "8px 12px" }}
          />
          <button
            className="primary"
            onClick={() => runVerify()}
            disabled={verifying || !verifyInput.trim()}
            style={{ padding: "8px 16px" }}
          >
            {verifying ? "Đang tra cứu…" : "Kiểm chứng ngay"}
          </button>
          {verifyRes && (
            <button className="ghost" onClick={() => setVerifyRes(null)}>
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
              className="ghost"
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 99,
                background: "#fff",
                border: "1px solid #cbd5e1",
              }}
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
              borderRadius: 8,
              background: "#fff",
              border:
                verifyRes.verdict_color === "warning"
                  ? "2px solid #f59e0b"
                  : verifyRes.verdict_color === "success"
                    ? "2px solid #10b981"
                    : "1px solid #cbd5e1",
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
                      ? "#fef3c7"
                      : verifyRes.verdict_color === "success"
                        ? "#dcfce7"
                        : "#f1f5f9",
                  color:
                    verifyRes.verdict_color === "warning"
                      ? "#b45309"
                      : verifyRes.verdict_color === "success"
                        ? "#166534"
                        : "#334155",
                }}
              >
                {verifyRes.verdict_badge}
              </span>
              <strong style={{ fontSize: 14 }}>Tra cứu: &ldquo;{verifyRes.query}&rdquo;</strong>
            </div>
            <div style={{ display: "grid", gap: 6, fontSize: 13, lineHeight: 1.5 }}>
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
                  borderRadius: 6,
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  color: "#14532d",
                }}
              >
                <strong>👉 Kết luận cho INUT:</strong> {verifyRes.inut_action}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Filter Bar */}
      <div
        className="card"
        style={{
          padding: "12px 14px",
          marginBottom: 14,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <select
          value={portalFilter}
          onChange={(e) => setPortalFilter(e.target.value)}
          style={{ padding: "6px 10px", fontSize: 13 }}
        >
          <option value="">Tất cả nguồn ({total})</option>
          <option value="daklak_tax_cs7">Thuế tỉnh Đắk Lắk &amp; Thuế cơ sở 7 (Tuy Hòa)</option>
          <option value="daklak_ubnd">UBND Tỉnh Đắk Lắk (Chỉ đạo điều hành)</option>
          <option value="daklak_syt">Sở Y tế Tỉnh Đắk Lắk</option>
          <option value="chinhphu">Chính phủ &amp; Bộ ngành Trung ương</option>
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{ padding: "6px 10px", fontSize: 13 }}
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
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          placeholder="Lọc theo số hiệu, trích yếu, từ khóa..."
          style={{ flex: 1, minWidth: 200, padding: "6px 10px", fontSize: 13 }}
        />

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={appliesOnly}
            onChange={(e) => setAppliesOnly(e.target.checked)}
          />
          <span>Chỉ hiện văn bản liên quan INUT</span>
        </label>
      </div>

      {/* Document Table */}
      {loading ? (
        <div className="center" style={{ padding: 40 }}>
          Đang tải danh sách công văn Chính phủ &amp; Tỉnh Đắk Lắk…
        </div>
      ) : items.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: "center" }}>
          <p className="muted">Không có văn bản nào khớp bộ lọc hiện tại.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: "auto" }}>
          <table className="table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#f8fafc", textAlign: "left" }}>
                <th style={{ padding: "10px 12px", width: 150 }}>Số ký hiệu / Ngày</th>
                <th style={{ padding: "10px 12px", width: 170 }}>Cơ quan &amp; Lĩnh vực</th>
                <th style={{ padding: "10px 12px" }}>Trích yếu văn bản &amp; Đánh giá tác động tới INUT</th>
                <th style={{ padding: "10px 12px", width: 110, textAlign: "center" }}>Độ liên quan</th>
                <th style={{ padding: "10px 12px", width: 130 }}>Bản gốc (.gov.vn)</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const catMeta = CATEGORY_LABELS[item.category] || CATEGORY_LABELS.khac;
                return (
                  <tr key={item.id} style={{ borderTop: "1px solid #e2e8f0", verticalAlign: "top" }}>
                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ fontWeight: 700, color: "#0f172a" }}>{item.doc_number || item.doc_type}</div>
                      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                        {item.doc_type} · {item.published_date}
                      </div>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
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
                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ fontWeight: 600, color: "#1e293b", marginBottom: 6, lineHeight: 1.4 }}>
                        {item.title}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          padding: "6px 10px",
                          borderRadius: 6,
                          background: item.applies_to_inut ? "#f0fdf4" : "#f8fafc",
                          border: item.applies_to_inut ? "1px solid #bbf7d0" : "1px solid #e2e8f0",
                          color: item.applies_to_inut ? "#166534" : "#475569",
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
                    <td style={{ padding: "10px 12px", textAlign: "center" }}>
                      <span
                        style={{
                          display: "inline-block",
                          fontWeight: 700,
                          fontSize: 12,
                          padding: "3px 8px",
                          borderRadius: 6,
                          background:
                            item.relevance_score >= 60
                              ? "#dcfce7"
                              : item.relevance_score >= 35
                                ? "#fef9c3"
                                : "#f1f5f9",
                          color:
                            item.relevance_score >= 60
                              ? "#15803d"
                              : item.relevance_score >= 35
                                ? "#a16207"
                                : "#64748b",
                        }}
                      >
                        {item.relevance_score}%
                      </span>
                      <div style={{ marginTop: 6 }}>
                        {item.acknowledged ? (
                          <span style={{ fontSize: 11, color: "#15803d", fontWeight: 600 }}>
                            ✓ Đã nắm (Tắt nhắc)
                          </span>
                        ) : item.notify_count >= 2 ? (
                          <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>
                            🔕 Đã nhắc đủ 2 lần
                          </span>
                        ) : item.notify_count === 1 || item.notified ? (
                          <span style={{ fontSize: 11, color: "#b45309", fontWeight: 600 }}>
                            🔔 Đã báo L1 (+3 ngày nhắc)
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {item.detail_url && (
                          <a
                            href={item.detail_url}
                            target="_blank"
                            rel="noreferrer"
                            style={{ fontSize: 12, fontWeight: 600, color: "#2563eb", textDecoration: "none" }}
                          >
                            🌐 Xem trên Cổng ↗
                          </a>
                        )}
                        {item.pdf_url && (
                          <a
                            href={item.pdf_url}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              color: item.pdf_url.includes("facebook.com") ? "#0284c7" : "#dc2626",
                              textDecoration: "none",
                            }}
                          >
                            {item.pdf_url.includes("facebook.com") ? "📘 Fanpage Thuế CS7 ↗" : "📄 Tải PDF ký số ↗"}
                          </a>
                        )}
                        {item.applies_to_inut && (
                          <button
                            className="ghost"
                            onClick={() => toggleAck(item)}
                            style={{
                              fontSize: 11,
                              padding: "3px 8px",
                              borderRadius: 6,
                              border: "1px solid #cbd5e1",
                              background: item.acknowledged ? "#dcfce7" : "#fff",
                              color: item.acknowledged ? "#166534" : "#334155",
                              fontWeight: 600,
                              textAlign: "left",
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
      )}
    </div>
  );
}
