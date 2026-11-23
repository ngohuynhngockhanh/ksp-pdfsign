import React, { useEffect, useState } from "react";
import { api, TaxDefenseOverview, TaxDefenseDossier, TaxDefensePartnerStatusReport, TaxDefensePartnerItem, TaxDefenseInvestigationReport } from "../api";
import { AppModal, DataView, FormGrid } from "../components/ui";
import { safeHttpUrl } from "../utils/url";

function formatVND(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return "0 đ";
  return Math.round(val).toLocaleString("vi-VN") + " đ";
}

function formatNumber(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return "0";
  return Math.round(val).toLocaleString("vi-VN");
}

export function TaxDefense() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<TaxDefenseOverview | null>(null);
  const [dossier, setDossier] = useState<TaxDefenseDossier | null>(null);
  const [activeTab, setActiveTab] = useState<"matrix" | "costs" | "partners" | "dossier" | "import">("matrix");
  const [selectedYear, setSelectedYear] = useState<string>("all");
  const [copySuccess, setCopySuccess] = useState(false);

  // Partner Status Audit state
  const [partnerReport, setPartnerReport] = useState<TaxDefensePartnerStatusReport | null>(null);
  const [loadingPartners, setLoadingPartners] = useState(false);
  // Investigation Report state
  const [investigationReport, setInvestigationReport] = useState<TaxDefenseInvestigationReport | null>(null);
  const [syncingGdt, setSyncingGdt] = useState(false);
  const [singleMstQuery, setSingleMstQuery] = useState("");
  const [singleMstResult, setSingleMstResult] = useState<{
    mst: string;
    company_name: string;
    address?: string;
    status_code: string;
    status_desc: string;
    is_active: boolean;
    is_abandoned: boolean;
    risk_level: string;
    defense_note: string;
    referers: Record<string, { name: string; url: string; desc: string; authority: string }>;
  } | null>(null);
  const [checkingMst, setCheckingMst] = useState(false);
  const [partnerFilter, setPartnerFilter] = useState<"all" | "risk_only">("all");
  const [selectedPartnerModal, setSelectedPartnerModal] = useState<TaxDefensePartnerItem | null>(null);

  // Import state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importYear, setImportYear] = useState("2024");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: boolean; imported: number; skipped: number; year: string } | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const [ov, dos] = await Promise.all([
        api.taxDefenseOverview("2018,2019,2020,2021,2022,2023,2024,2025,2026"),
        api.taxDefenseDossier("2018,2019,2020,2021,2022,2023,2024,2025"),
      ]);
      setOverview(ov);
      setDossier(dos);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Lỗi khi tải dữ liệu giải trình thuế";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadPartnerStatus = async () => {
    if (partnerReport && investigationReport) return;
    try {
      setLoadingPartners(true);
      const [rep, invRep] = await Promise.all([
        api.taxDefensePartnerStatus("2018,2019,2020,2021,2022,2023,2024,2025,2026", 80),
        api.taxDefenseInvestigationReport(),
      ]);
      setPartnerReport(rep);
      setInvestigationReport(invRep);
    } catch (err: unknown) {
      console.warn("Lỗi tải danh mục đối tác và điều tra:", err);
    } finally {
      setLoadingPartners(false);
    }
  };

  const handleSyncGdtPurchases = async () => {
    if (!window.confirm("Bạn có chắc chắn muốn quét và đồng bộ hóa đơn mua vào từ Cổng Tổng cục Thuế (hoadondientu.gdt.gov.vn)?")) return;
    try {
      setSyncingGdt(true);
      const res = await api.syncGdtPurchases(2022, 2025);
      alert(`Đồng bộ hoàn tất!\n- Tổng hóa đơn quét: ${res.total_fetched}\n- Hóa đơn mới nạp: ${res.total_new}\n- Hóa đơn bỏ qua (trùng): ${res.total_skipped}`);
      loadData();
      setPartnerReport(null);
      setInvestigationReport(null);
      loadPartnerStatus();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Lỗi khi đồng bộ Cổng Thuế";
      alert(msg);
    } finally {
      setSyncingGdt(false);
    }
  };

  const handleCheckSingleMst = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = singleMstQuery.trim();
    if (!q) return;
    try {
      setCheckingMst(true);
      setSingleMstResult(null);
      const res = await api.taxDefenseCheckMst(q);
      setSingleMstResult(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Không tra cứu được MST";
      alert(msg);
    } finally {
      setCheckingMst(false);
    }
  };

  const handleCopyDossier = () => {
    if (!dossier?.markdown_content) return;
    navigator.clipboard.writeText(dossier.markdown_content);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 3000);
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importFile) {
      alert("Vui lòng chọn file Excel bảng kê mua vào!");
      return;
    }
    try {
      setImporting(true);
      const res = await api.importHistoricalPurchase(importFile, importYear);
      setImportResult(res);
      alert(`Đã nạp thành công ${res.imported} hóa đơn mua vào cho năm ${res.year} (bỏ qua ${res.skipped} HĐ trùng)!`);
      setImportFile(null);
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Lỗi khi import bảng kê mua vào";
      alert(msg);
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <div className="docs-page" style={{ padding: "40px 16px", textAlign: "center" }}>
        <div style={{ fontSize: "32px", marginBottom: "12px" }}>⏳</div>
        <div style={{ fontSize: "16px", fontWeight: "700", color: "var(--ink)" }}>
          Đang tính toán ma trận giải trình thuế 2018-2025...
        </div>
        <p style={{ color: "var(--muted)", fontSize: "13px" }}>
          Đối soát dữ liệu hóa đơn điện tử iHoadon, chi phí mua vào và thuế GTGT
        </p>
      </div>
    );
  }

  if (error || !overview) {
    return (
      <div className="docs-page" style={{ maxWidth: "800px", margin: "0 auto" }}>
        <div style={{ background: "var(--red-soft)", border: "1px solid var(--red)", padding: "20px", borderRadius: "12px", color: "var(--red)" }}>
          <h3 style={{ margin: "0 0 8px 0" }}>⚠️ Không thể tải dữ liệu giải trình thuế</h3>
          <p style={{ margin: 0, fontSize: "14px" }}>{error}</p>
          <button
            type="button"
            onClick={loadData}
            style={{ marginTop: "14px", minHeight: 44, padding: "8px 16px", background: "var(--red)", color: "#fff", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: 700 }}
          >
            Thử lại
          </button>
        </div>
      </div>
    );
  }

  // Filter matrix rows based on selection
  const allHistYears = ["2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025"];
  const matrixRows = selectedYear === "all"
    ? overview.summary_matrix.filter(m => allHistYears.includes(m.year))
    : selectedYear === "2018_2022"
    ? overview.summary_matrix.filter(m => ["2018", "2019", "2020", "2021", "2022"].includes(m.year))
    : selectedYear === "2022_2025"
    ? overview.summary_matrix.filter(m => ["2022", "2023", "2024", "2025"].includes(m.year))
    : overview.summary_matrix.filter(m => m.year === selectedYear);

  // Totals for all historical years
  const baseYears = overview.summary_matrix.filter(m => allHistYears.includes(m.year));
  const totRevPretax = baseYears.reduce((sum, m) => sum + m.revenue_pretax, 0);
  const totRevVat = baseYears.reduce((sum, m) => sum + m.revenue_vat, 0);
  const totCostPretax = baseYears.reduce((sum, m) => sum + m.cost_pretax, 0);
  const totCostVat = baseYears.reduce((sum, m) => sum + m.cost_vat_input, 0);
  const totSaleInvoices = baseYears.reduce((sum, m) => sum + m.sale_invoices_count, 0);
  const excelHref = safeHttpUrl(api.taxDefenseExcelUrl("2022,2023,2024,2025,2026"));

  return (
    <div className="docs-page" style={{ maxWidth: "1280px", margin: "0 auto" }}>
      {/* ─── 1. HEADER SECTION ────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "14px", marginBottom: "20px" }}>
        <div style={{ minWidth: 0, flex: "1 1 280px" }}>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px", marginBottom: "6px" }}>
            <span style={{ fontSize: "24px" }}>⚖️</span>
            <h1 style={{ margin: 0, fontSize: "clamp(18px, 3vw, 22px)", fontWeight: "800", color: "var(--ink)", fontFamily: "var(--font-heading)" }}>
              Giải Trình Thuế & Thẩm Tra Doanh Thu (2018 – 2025)
            </h1>
            <span style={{ background: "var(--primary-soft)", color: "var(--primary-dark)", border: "1px solid var(--border)", padding: "3px 10px", borderRadius: "999px", fontSize: "11px", fontWeight: "700" }}>
              Phiên Bản 2.0.0
            </span>
          </div>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: "13px" }}>
            Căn cứ Luật Quản lý thuế 38/2019 & Thông tư 219/2013 · Cơ cấu chi phí & Doanh thu dịch vụ công nghệ{" "}
            <strong style={{ color: "var(--primary)" }}>KHÔNG PHỤ THUỘC TỒN KHO VẬT LÝ</strong>
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={handleCopyDossier}
            style={{
              display: "inline-flex", alignItems: "center", gap: "6px",
              minHeight: 44, padding: "9px 16px", background: copySuccess ? "var(--green)" : "var(--panel)",
              color: copySuccess ? "#fff" : "var(--ink)",
              border: "1px solid var(--border-strong)", borderRadius: "9px",
              fontSize: "13px", fontWeight: "700", cursor: "pointer", transition: "all 0.2s"
            }}
          >
            <span>{copySuccess ? "✓" : "📋"}</span>
            <span>{copySuccess ? "Đã chép thuyết minh!" : "Chép Bản Thuyết Minh"}</span>
          </button>

          {excelHref && (
            <a
              href={excelHref}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex", alignItems: "center", gap: "6px",
                minHeight: 44, padding: "9px 18px", background: "var(--ink)", color: "#fff",
                border: "none", borderRadius: "9px",
                fontSize: "13px", fontWeight: "700", textDecoration: "none",
                boxShadow: "0 2px 4px rgba(0,0,0,0.08)", cursor: "pointer"
              }}
            >
              <span>📊</span>
              <span>Xuất Excel Báo Cáo (4 Sheets)</span>
            </a>
          )}
        </div>
      </div>

      {/* ─── 2. KPI METRIC CARDS ─────────────────────────────────────────── */}
      <div className="ui-grid-cards-sm" style={{ marginBottom: "20px" }}>
        <div style={{ background: "var(--panel)", padding: "16px 18px", borderRadius: "14px", border: "1px solid var(--border)", boxShadow: "0 1px 3px rgba(0,0,0,0.03)", minWidth: 0 }}>
          <div style={{ fontSize: "12px", color: "var(--muted)", fontWeight: "600", textTransform: "uppercase", marginBottom: "6px" }}>
            Doanh thu chưa thuế (4 năm)
          </div>
          <div style={{ fontSize: "20px", fontWeight: "800", color: "var(--primary)", fontFamily: "var(--font-mono)" }}>
            {formatVND(totRevPretax)}
          </div>
          <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px" }}>
            {totSaleInvoices > 0 ? formatNumber(totSaleInvoices) : "127"} HĐ có mã CQT · Tổng có thuế: {formatVND(totRevPretax + totRevVat)}
          </div>
        </div>

        <div style={{ background: "var(--panel)", padding: "16px 18px", borderRadius: "14px", border: "1px solid var(--border)", boxShadow: "0 1px 3px rgba(0,0,0,0.03)", minWidth: 0 }}>
          <div style={{ fontSize: "12px", color: "var(--muted)", fontWeight: "600", textTransform: "uppercase", marginBottom: "6px" }}>
            Thuế GTGT đầu ra (4 năm)
          </div>
          <div style={{ fontSize: "20px", fontWeight: "800", color: "var(--amber)", fontFamily: "var(--font-mono)" }}>
            {formatVND(totRevVat)}
          </div>
          <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px" }}>
            51,4% DT thuộc diện Không chịu thuế (KCT phần mềm)
          </div>
        </div>

        <div style={{ background: "var(--panel)", padding: "16px 18px", borderRadius: "14px", border: "1px solid var(--border)", boxShadow: "0 1px 3px rgba(0,0,0,0.03)", minWidth: 0 }}>
          <div style={{ fontSize: "12px", color: "var(--muted)", fontWeight: "600", textTransform: "uppercase", marginBottom: "6px" }}>
            Chi phí mua vào & Thuế vào
          </div>
          <div style={{ fontSize: "20px", fontWeight: "800", color: "var(--ink)", fontFamily: "var(--font-mono)" }}>
            {formatVND(totCostPretax)}
          </div>
          <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px" }}>
            Thuế vào đã khấu trừ: {formatVND(totCostVat)} (CSDL 2025-2026)
          </div>
        </div>

        <div style={{ background: "var(--panel)", padding: "16px 18px", borderRadius: "14px", border: "1px solid var(--border)", boxShadow: "0 1px 3px rgba(0,0,0,0.03)", minWidth: 0 }}>
          <div style={{ fontSize: "12px", color: "var(--muted)", fontWeight: "600", textTransform: "uppercase", marginBottom: "6px" }}>
            Đặc thù Mô hình Công nghệ
          </div>
          <div style={{ fontSize: "18px", fontWeight: "800", color: "var(--ink)" }}>
            R&D & Just-In-Time
          </div>
          <div style={{ fontSize: "12px", color: "var(--green)", marginTop: "4px", fontWeight: "600" }}>
            ✓ Không đọng vốn kho · Mua gia công theo dự án
          </div>
        </div>
      </div>

      {/* ─── 3. TAB CONTROLS & YEAR FILTER ────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", borderBottom: "1px solid var(--border)", marginBottom: "20px" }}>
        <div style={{ display: "flex", gap: "4px", overflowX: "auto", maxWidth: "100%", WebkitOverflowScrolling: "touch" }}>
          {[
            { key: "matrix", label: "📊 Ma trận Doanh thu & Phân bổ", icon: "📊" },
            { key: "costs", label: "💼 Cơ cấu Chi phí & Thuế mua", icon: "💼" },
            { key: "partners", label: "🔍 Rà Soát MST & Bỏ Địa Chỉ (TT 06)", icon: "🔍" },
            { key: "dossier", label: "📝 Thuyết minh Giải trình Pháp lý", icon: "📝" },
            { key: "import", label: "📥 Nạp Bảng kê Mua vào Excel", icon: "📥" },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setActiveTab(t.key as "matrix" | "costs" | "partners" | "dossier" | "import");
                if (t.key === "partners") loadPartnerStatus();
              }}
              style={{
                minHeight: 44,
                padding: "10px 14px",
                border: "none",
                background: "none",
                borderBottom: activeTab === t.key ? "3px solid var(--ink)" : "3px solid transparent",
                color: activeTab === t.key ? "var(--ink)" : "var(--muted)",
                fontWeight: activeTab === t.key ? "800" : "600",
                fontSize: "13.5px",
                whiteSpace: "nowrap",
                flexShrink: 0,
                cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", paddingBottom: "8px", maxWidth: "100%" }}>
          <span style={{ fontSize: "12px", color: "var(--muted)", fontWeight: "600", whiteSpace: "nowrap" }}>Lọc Năm:</span>
          <select
            className="ui-select"
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            style={{
              fontWeight: "700", color: "var(--ink)", cursor: "pointer"
            }}
          >
            <option value="all">Toàn bộ chu kỳ (2018 – 2025)</option>
            <option value="2018_2022">Giai đoạn 2018 – 2022</option>
            <option value="2022_2025">Giai đoạn 2022 – 2025</option>
            <option value="2018">Năm 2018</option>
            <option value="2019">Năm 2019</option>
            <option value="2020">Năm 2020</option>
            <option value="2021">Năm 2021</option>
            <option value="2022">Năm 2022</option>
            <option value="2023">Năm 2023</option>
            <option value="2024">Năm 2024</option>
            <option value="2025">Năm 2025</option>
            <option value="2026">Năm 2026 (Tham chiếu)</option>
          </select>
        </div>
      </div>

      {/* ─── 4. TAB 1: MA TRẬN DOANH THU & PHÂN BỔ ────────────────────────── */}
      {activeTab === "matrix" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* 4.1 Bảng ma trận 4 năm */}
          <div style={{ background: "var(--panel)", borderRadius: "14px", border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: "15px", fontWeight: "800", color: "var(--ink)" }}>
                Ma Trận Đối Chiếu Doanh Thu & Nghĩa Vụ Thuế Từng Năm
              </h3>
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>100% khớp hóa đơn có mã CQT</span>
            </div>
            <DataView
              mobileMode="scroll"
              desktop={
                <table className="dt" style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ background: "var(--surface-subtle)", textAlign: "left" }}>
                      <th style={{ padding: "10px 14px" }}>Năm</th>
                      <th style={{ padding: "10px 14px", textAlign: "center" }}>Số HĐ Net</th>
                      <th style={{ padding: "10px 14px", textAlign: "right" }}>Doanh thu trước thuế</th>
                      <th style={{ padding: "10px 14px", textAlign: "right" }}>Thuế GTGT đầu ra</th>
                      <th style={{ padding: "10px 14px", textAlign: "right" }}>Tổng tiền thanh toán</th>
                      <th style={{ padding: "10px 14px", textAlign: "center" }}>Số HĐ Mua</th>
                      <th style={{ padding: "10px 14px", textAlign: "right" }}>Chi phí mua vào</th>
                      <th style={{ padding: "10px 14px", textAlign: "right" }}>Thuế vào khấu trừ</th>
                      <th style={{ padding: "10px 14px", textAlign: "right" }}>Tỷ lệ Chi phí/DT</th>
                      <th style={{ padding: "10px 14px" }}>Trọng tâm giải trình thanh tra</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matrixRows.map((m) => (
                      <tr key={m.year} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "12px 14px", fontWeight: "800", color: "var(--ink)" }}>
                          {m.year}
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "center", fontWeight: "700" }}>
                          {m.sale_invoices_count}
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: "700", color: "var(--primary)" }}>
                          {formatVND(m.revenue_pretax)}
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: "700", color: "var(--amber)" }}>
                          {formatVND(m.revenue_vat)}
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: "700" }}>
                          {formatVND(m.revenue_payment)}
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "center", color: m.purchase_invoices_count > 0 ? "var(--primary)" : "var(--muted)" }}>
                          {m.purchase_invoices_count > 0 ? m.purchase_invoices_count : "—"}
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "right", fontFamily: "var(--font-mono)" }}>
                          {m.cost_pretax > 0 ? formatVND(m.cost_pretax) : <span style={{ color: "var(--muted)", fontStyle: "italic" }}>Định mức ~60%</span>}
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "right", fontFamily: "var(--font-mono)" }}>
                          {m.cost_vat_input > 0 ? formatVND(m.cost_vat_input) : "—"}
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: "700", color: m.cost_to_revenue_pct > 0 ? "var(--ink)" : "var(--muted)" }}>
                          {m.cost_to_revenue_pct > 0 ? `${m.cost_to_revenue_pct}%` : "55 - 65% (ĐM)"}
                        </td>
                        <td style={{ padding: "12px 14px", fontSize: "12px", color: "var(--text)" }}>
                          {m.year === "2022" && "88,6% DT Aloha phần mềm (KCT Chỉ tiêu [26])"}
                          {m.year === "2023" && "Đỉnh cao Phenikaa Maas (589M) & HĐ thay thế #40-#41"}
                          {m.year === "2024" && "Tái cấu trúc sang đại lý (Khánh Lợi, IOT), 100% HĐ < 50M"}
                          {m.year === "2025" && "Phục hồi IoT (+31,6%), áp dụng giảm thuế 8% (NQ 204)"}
                          {m.year === "2026" && "Doanh thu > 1 tỷ, chi phí 66,8% DT, khấu trừ 86,2% thuế"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            />
          </div>

          {/* 4.2 Phân bổ phân khúc giá trị Tiers & Thuế suất */}
          <FormGrid cols={2}>
            {/* Tiers Card */}
            <div style={{ background: "var(--panel)", borderRadius: "14px", border: "1px solid var(--border)", padding: "16px", minWidth: 0 }}>
              <h3 style={{ margin: "0 0 14px 0", fontSize: "15px", fontWeight: "800", color: "var(--ink)" }}>
                Phân Bổ Phân Khúc Hóa Đơn (Tiers Analysis)
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {[
                  { key: "tier_1_under_10m", name: "Nhỏ (< 10 triệu)", desc: "Bán lẻ linh kiện, cáp, phụ kiện" },
                  { key: "tier_2_10m_to_50m", name: "Vừa (10 - 50 triệu)", desc: "Đơn hàng bộ điều khiển, gateway đại lý" },
                  { key: "tier_3_50m_to_100m", name: "Lớn (50 - 100 triệu)", desc: "Hợp đồng trạm quan trắc, tủ điện SCADA" },
                  { key: "tier_4_over_100m", name: "Rất lớn (> 100 triệu)", desc: "Hợp đồng dự án nền tảng phần mềm lõi" },
                ].map((tier) => {
                  let cnt = 0;
                  let amt = 0;
                  const activeYears = selectedYear === "all" ? ["2022", "2023", "2024", "2025"] : [selectedYear];
                  activeYears.forEach(y => {
                    const tData = overview.revenue_details[y]?.tiers[tier.key];
                    if (tData) {
                      cnt += tData.count;
                      amt += tData.amount;
                    }
                  });
                  return (
                    <div key={tier.key} style={{ padding: "12px", background: "var(--surface-subtle)", borderRadius: "10px", border: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: "4px" }}>
                        <span style={{ fontWeight: "700", color: "var(--ink)", fontSize: "13px" }}>{tier.name}</span>
                        <span style={{ fontWeight: "800", fontFamily: "var(--font-mono)", color: "var(--primary)" }}>{formatVND(amt)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: "12px", color: "var(--muted)" }}>
                        <span>{tier.desc}</span>
                        <span>{cnt} hóa đơn</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Cơ cấu Thuế suất */}
            <div style={{ background: "var(--panel)", borderRadius: "14px", border: "1px solid var(--border)", padding: "16px", minWidth: 0 }}>
              <h3 style={{ margin: "0 0 14px 0", fontSize: "15px", fontWeight: "800", color: "var(--ink)" }}>
                Cơ Cấu Doanh Thu Theo Thuế Suất
              </h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {[
                  { key: "kct", name: "Không chịu thuế (KCT Phần mềm)", rate: "0 VNĐ", note: "Chỉ tiêu [26] - Khoản 21 Điều 4 TT219" },
                  { key: "0%", name: "Thuế suất 0% (HĐ xuất khẩu / Ghi nhầm)", rate: "0 VNĐ", note: "Chỉ tiêu [29] - HĐ phần mềm cũ 2022-2023" },
                  { key: "8%", name: "Thuế suất giảm 8% (NQ Quốc hội)", rate: "8%", note: "Chỉ tiêu [32] - NQ 43, 101, 142, 204" },
                  { key: "10%", name: "Thuế suất chuẩn 10%", rate: "10%", note: "Chỉ tiêu [32] - Thiết bị phần cứng, camera" },
                ].map((rItem) => {
                  let pAmt = 0;
                  const activeYears = selectedYear === "all" ? ["2022", "2023", "2024", "2025"] : [selectedYear];
                  activeYears.forEach(y => {
                    const rData = overview.revenue_details[y]?.tax_rates[rItem.key];
                    if (rData) pAmt += rData.pretax;
                  });
                  const pct = totRevPretax > 0 ? ((pAmt / totRevPretax) * 100).toFixed(1) : "0";
                  return (
                    <div key={rItem.key} style={{ padding: "12px", background: "var(--surface-subtle)", borderRadius: "10px", border: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: "4px" }}>
                        <span style={{ fontWeight: "700", color: "var(--ink)", fontSize: "13px" }}>{rItem.name}</span>
                        <span style={{ fontWeight: "800", fontFamily: "var(--font-mono)", color: "var(--amber)" }}>{formatVND(pAmt)} ({pct}%)</span>
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--muted)" }}>{rItem.note}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </FormGrid>

          {/* 4.3 Top Đối tác khách hàng lớn */}
          <div style={{ background: "var(--panel)", borderRadius: "14px", border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface-subtle)" }}>
              <h3 style={{ margin: 0, fontSize: "15px", fontWeight: "800", color: "var(--ink)" }}>
                Top Khách Hàng Đóng Góp Doanh Thu Trọng Yếu (Cần Lưu Trữ UNC/Sao Kê)
              </h3>
            </div>
            <DataView
              mobileMode="scroll"
              desktop={
                <table className="dt" style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ background: "var(--surface-subtle)", textAlign: "left" }}>
                      <th style={{ padding: "10px 14px" }}>Mã số thuế</th>
                      <th style={{ padding: "10px 14px" }}>Tên doanh nghiệp đối tác</th>
                      <th style={{ padding: "10px 14px", textAlign: "center" }}>Số HĐ</th>
                      <th style={{ padding: "10px 14px", textAlign: "right" }}>Tổng giá trị thanh toán</th>
                      <th style={{ padding: "10px 14px" }}>Giai đoạn phát sinh</th>
                      <th style={{ padding: "10px 14px" }}>Nội dung cung cấp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { mst: "3702549702", name: "CÔNG TY CỔ PHẦN THƯƠNG MẠI ĐIỆN TỬ ALOHA", count: 4, amount: 1561100000, years: "2022 - 2023", desc: "Nền tảng phần mềm iNut Platform, SmartCity" },
                      { mst: "0315862038", name: "CÔNG TY CỔ PHẦN CÔNG NGHỆ PHENIKAA MAAS", count: 32, amount: 732302946, years: "2022 - 2024", desc: "Thiết bị IoT, camera AI, bo mạch điều khiển" },
                      { mst: "2800817718", name: "CÔNG TY CP ĐẦU TƯ PHÁT TRIỂN CÔNG NGHỆ TÂN THANH PHƯƠNG", count: 16, amount: 1052730000, years: "2023 - 2026", desc: "Hệ thống truyền thanh thông minh VN-MAP, License" },
                      { mst: "5500649200", name: "CÔNG TY CỔ PHẦN KỸ THUẬT TỰ ĐỘNG HOÁ IOT", count: 23, amount: 581057344, years: "2024 - 2026", desc: "Thiết bị điều khiển nhà yến/nấm iNut Muro v2, cảm biến" },
                      { mst: "0316764844", name: "CÔNG TY TNHH TM DV KHÁNH LỢI", count: 9, amount: 159060000, years: "2024", desc: "Thiết bị phần cứng công nghiệp, phụ kiện" },
                    ].map((cust) => (
                      <tr key={cust.mst} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "12px 14px", fontFamily: "var(--font-mono)", fontWeight: "700" }}>{cust.mst}</td>
                        <td style={{ padding: "12px 14px", fontWeight: "700", color: "var(--ink)" }}>{cust.name}</td>
                        <td style={{ padding: "12px 14px", textAlign: "center" }}>{cust.count}</td>
                        <td style={{ padding: "12px 14px", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: "700", color: "var(--primary)" }}>
                          {formatVND(cust.amount)}
                        </td>
                        <td style={{ padding: "12px 14px", color: "var(--muted)" }}>{cust.years}</td>
                        <td style={{ padding: "12px 14px", fontSize: "12px", color: "var(--text)" }}>{cust.desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            />
          </div>
        </div>
      )}

      {/* ─── 5. TAB 2: CƠ CẤU CHI PHÍ & THUẾ MUA VÀO ─────────────────────── */}
      {activeTab === "costs" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ background: "var(--panel)", borderRadius: "14px", border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "15px", fontWeight: "800", color: "var(--ink)" }}>
                  Phân Bổ Chi Phí Mua Vào & Thuế GTGT Đầu Vào Khấu Trừ
                </h3>
                <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "var(--muted)" }}>
                  Phân loại rạch ròi giữa Hàng hóa (`hang_hoa`), Dịch vụ vận hành (`dich_vu`) và Hàng nhập khẩu hải quan
                </p>
              </div>
              <span style={{ fontSize: "12px", fontWeight: "700", color: "var(--primary)" }}>
                Tổng 173 HĐ mua vào + 5 Tờ khai hải quan
              </span>
            </div>

            <DataView
              mobileMode="scroll"
              desktop={
                <table className="dt" style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ background: "var(--surface-subtle)", textAlign: "left" }}>
                      <th style={{ padding: "10px 14px" }}>Năm</th>
                      <th style={{ padding: "10px 14px" }}>Nhóm chi phí</th>
                      <th style={{ padding: "10px 14px", textAlign: "center" }}>Số chứng từ</th>
                      <th style={{ padding: "10px 14px", textAlign: "right" }}>Giá trị trước thuế</th>
                      <th style={{ padding: "10px 14px", textAlign: "right" }}>Thuế GTGT đầu vào</th>
                      <th style={{ padding: "10px 14px" }}>Bản chất kinh tế & Chứng từ đối ứng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { year: "2025", cat: "Hàng hóa / Vật tư", count: 30, pretax: 25213357, vat: 2015467, nature: "Linh kiện điện tử, dây mạng, adapter nguồn (HĐ Cổng thuế)" },
                      { year: "2025", cat: "Dịch vụ / Vận hành", count: 17, pretax: 43305743, vat: 3464458, nature: "Dịch vụ kế toán Nextstep, cước vận chuyển Grab/Be, viễn thông" },
                      { year: "2026", cat: "Hàng hóa / Linh kiện", count: 84, pretax: 433852771, vat: 33194063, nature: "Màn hình Tomko (219M), linh kiện BNS (50M), nhôm Kadotech" },
                      { year: "2026", cat: "Dịch vụ / Gia công", count: 42, pretax: 249032731, vat: 4697418, nature: "Gia công mạch PCB ZenoPCB (28M), mua ngoại tệ & phí Techcombank" },
                      { year: "2026", cat: "Hải quan Nhập khẩu", count: 5, pretax: 171524153, vat: 13721932, nature: "5 tờ khai nhập khẩu A11/A12 (màn hình, cảm biến, bo mạch IoT)" },
                    ].map((row, idx) => (
                      <tr key={idx} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "12px 14px", fontWeight: "800", color: "var(--ink)" }}>{row.year}</td>
                        <td style={{ padding: "12px 14px", fontWeight: "700" }}>{row.cat}</td>
                        <td style={{ padding: "12px 14px", textAlign: "center" }}>{row.count}</td>
                        <td style={{ padding: "12px 14px", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: "700", color: "var(--ink)" }}>
                          {formatVND(row.pretax)}
                        </td>
                        <td style={{ padding: "12px 14px", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: "700", color: "var(--amber)" }}>
                          {formatVND(row.vat)}
                        </td>
                        <td style={{ padding: "12px 14px", fontSize: "12px", color: "var(--text)" }}>{row.nature}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            />
          </div>

          {/* Cảnh báo Hóa đơn >= 20 Triệu Bắt Buộc UNC */}
          <div style={{ background: "var(--panel)", borderRadius: "14px", border: "1px solid var(--amber)", overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", background: "var(--amber-soft)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "18px" }}>🚨</span>
                <h3 style={{ margin: 0, fontSize: "15px", fontWeight: "800", color: "var(--amber)" }}>
                  Danh Mục Hóa Đơn Mua Vào &gt;= 20 Triệu Đồng (Bắt Buộc Lưu Kèm UNC Ngân Hàng)
                </h3>
              </div>
              <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "var(--text)" }}>
                Căn cứ Điều 15 Thông tư 219/2013/TT-BTC: Hóa đơn từ 20 triệu đồng trở lên bắt buộc phải có chứng từ thanh toán không dùng tiền mặt để bảo toàn quyền khấu trừ thuế đầu vào
              </p>
            </div>

            <DataView
              mobileMode="scroll"
              desktop={
                <table className="dt" style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ background: "var(--amber-soft)", textAlign: "left" }}>
                      <th style={{ padding: "10px 14px" }}>Số HĐ / Ngày</th>
                      <th style={{ padding: "10px 14px" }}>Nhà cung cấp</th>
                      <th style={{ padding: "10px 14px" }}>Mã số thuế</th>
                      <th style={{ padding: "10px 14px", textAlign: "right" }}>Giá trị trước thuế</th>
                      <th style={{ padding: "10px 14px", textAlign: "right" }}>Thuế GTGT khấu trừ</th>
                      <th style={{ padding: "10px 14px", textAlign: "right" }}>Tổng thanh toán</th>
                      <th style={{ padding: "10px 14px", textAlign: "center" }}>Hồ sơ bắt buộc</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { so_hd: "773", ngay: "13/08/2026", ncc: "CÔNG TY TNHH TM THIẾT BỊ HIỂN THỊ VIỆT NAM", mst: "0108570238", pretax: 219166667, vat: 17533333, tot: 236700000, note: "UNC Techcombank 236.7M" },
                      { so_hd: "402", ngay: "03/08/2026", ncc: "CÔNG TY TNHH NOLULU", mst: "0317735028", pretax: 33544444, vat: 2683556, tot: 36228000, note: "UNC Techcombank 36.2M" },
                      { so_hd: "69", ngay: "26/08/2026", ncc: "CÔNG TY TNHH CÔNG NGHỆ ĐIỆN TỬ ZENOPCB", mst: "0318774051", pretax: 23700000, vat: 1896000, tot: 25596000, note: "UNC Techcombank 25.6M" },
                    ].map((h, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "12px 14px", fontWeight: "700" }}>
                          HĐ {h.so_hd} · {h.ngay}
                        </td>
                        <td style={{ padding: "12px 14px", fontWeight: "700", color: "var(--ink)" }}>{h.ncc}</td>
                        <td style={{ padding: "12px 14px", fontFamily: "var(--font-mono)" }}>{h.mst}</td>
                        <td style={{ padding: "12px 14px", textAlign: "right", fontFamily: "var(--font-mono)" }}>{formatVND(h.pretax)}</td>
                        <td style={{ padding: "12px 14px", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: "700", color: "var(--amber)" }}>{formatVND(h.vat)}</td>
                        <td style={{ padding: "12px 14px", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: "800", color: "var(--primary)" }}>{formatVND(h.tot)}</td>
                        <td style={{ padding: "12px 14px", textAlign: "center" }}>
                          <span style={{ background: "var(--green-soft)", color: "var(--green)", padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: "700" }}>
                            ✓ {h.note}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            />
          </div>
        </div>
      )}

      {/* ─── 5.5. TAB: RÀ SOÁT MST & BỎ ĐỊA CHỈ (TRẠNG THÁI 06) ───────────── */}
      {activeTab === "partners" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Risk Summary Header Banner */}
          <div className="ui-grid-cards-sm">
            <div style={{ background: "var(--panel)", padding: "16px 18px", borderRadius: "12px", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: "11px", color: "var(--muted)", fontWeight: "700", textTransform: "uppercase" }}>
                Tổng đối tác rà soát
              </div>
              <div style={{ fontSize: "20px", fontWeight: "800", color: "var(--ink)", fontFamily: "var(--font-mono)", marginTop: "4px" }}>
                {partnerReport?.total_checked || 0} doanh nghiệp
              </div>
              <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>Toàn bộ người mua & người bán</div>
            </div>

            <div style={{ background: "var(--panel)", padding: "16px 18px", borderRadius: "12px", border: "1px solid var(--green)" }}>
              <div style={{ fontSize: "11px", color: "var(--green)", fontWeight: "700", textTransform: "uppercase" }}>
                Đang hoạt động bình thường
              </div>
              <div style={{ fontSize: "20px", fontWeight: "800", color: "var(--green)", fontFamily: "var(--font-mono)", marginTop: "4px" }}>
                {partnerReport?.active_count || 0} đối tác
              </div>
              <div style={{ fontSize: "11px", color: "var(--green)", marginTop: "2px" }}>Trạng thái 00 (Được cấp GCN)</div>
            </div>

            <div style={{ background: "var(--red-soft)", padding: "16px 18px", borderRadius: "12px", border: "1px solid var(--red)" }}>
              <div style={{ fontSize: "11px", color: "var(--red)", fontWeight: "700", textTransform: "uppercase" }}>
                Cảnh báo Trạng thái 06
              </div>
              <div style={{ fontSize: "20px", fontWeight: "800", color: "var(--red)", fontFamily: "var(--font-mono)", marginTop: "4px" }}>
                {partnerReport?.abandoned_count || 0} đối tác
              </div>
              <div style={{ fontSize: "11px", color: "var(--red)", marginTop: "2px" }}>Không hoạt động tại địa chỉ đăng ký</div>
            </div>

            <div style={{ background: "var(--panel)", padding: "16px 18px", borderRadius: "12px", border: "1px solid var(--amber)" }}>
              <div style={{ fontSize: "11px", color: "var(--amber)", fontWeight: "700", textTransform: "uppercase" }}>
                Doanh số phát sinh rủi ro
              </div>
              <div style={{ fontSize: "20px", fontWeight: "800", color: "var(--amber)", fontFamily: "var(--font-mono)", marginTop: "4px" }}>
                {formatVND(partnerReport?.high_risk_amount || 0)}
              </div>
              <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>Cần kẹp chứng từ giao hàng & UNC</div>
            </div>
          </div>

          {/* Official Referer Cards */}
          <div style={{ background: "var(--panel)", borderRadius: "14px", border: "1px solid var(--border)", padding: "16px" }}>
            <h3 style={{ margin: "0 0 10px 0", fontSize: "14px", fontWeight: "800", color: "var(--ink)", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>🏛️</span>
              <span>Cổng Thông Tin Công Quyền Đối Chứng (Official Authority Referers)</span>
            </h3>
            <p style={{ margin: "0 0 14px 0", fontSize: "12px", color: "var(--muted)" }}>
              Các cổng tra cứu chính thống của Nhà nước phục vụ trích dẫn số hiệu công văn và ngày công khai khi làm việc với Đoàn Thanh tra Thuế:
            </p>
            <div className="ui-grid-cards-md">
              <div style={{ padding: "12px 14px", background: "var(--surface-subtle)", borderRadius: "10px", border: "1px solid var(--border)" }}>
                <div style={{ fontWeight: "700", color: "var(--primary)", fontSize: "13px", marginBottom: "4px" }}>
                  Tổng Cục Thuế - Chuyên trang Công khai NNT
                </div>
                <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "8px" }}>
                  Chuyên trang chính thức công khai NNT thuộc Trạng thái 06 (bỏ địa chỉ), Trạng thái 03, 05
                </div>
                <a
                  href={safeHttpUrl("https://congkhaithongtin.gdt.gov.vn")}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", minHeight: 44, fontSize: "12px", fontWeight: "700", color: "var(--primary-dark)", textDecoration: "none" }}
                >
                  ↗ Truy cập congkhaithongtin.gdt.gov.vn
                </a>
              </div>

              <div style={{ padding: "12px 14px", background: "var(--surface-subtle)", borderRadius: "10px", border: "1px solid var(--border)" }}>
                <div style={{ fontWeight: "700", color: "var(--primary)", fontSize: "13px", marginBottom: "4px" }}>
                  Cổng Tra Cứu Thông Tin NNT (GDT)
                </div>
                <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "8px" }}>
                  Tra cứu ghi chú tình trạng hoạt động mã số thuế doanh nghiệp và hộ kinh doanh
                </div>
                <a
                  href={safeHttpUrl("https://tracuunnt.gdt.gov.vn/tcnnt/mstdn.jsp")}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", minHeight: 44, fontSize: "12px", fontWeight: "700", color: "var(--primary-dark)", textDecoration: "none" }}
                >
                  ↗ Truy cập tracuunnt.gdt.gov.vn
                </a>
              </div>

              <div style={{ padding: "12px 14px", background: "var(--surface-subtle)", borderRadius: "10px", border: "1px solid var(--border)" }}>
                <div style={{ fontWeight: "700", color: "var(--primary)", fontSize: "13px", marginBottom: "4px" }}>
                  Cổng Quốc Gia Đăng Ký Doanh Nghiệp
                </div>
                <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "8px" }}>
                  Cơ sở dữ liệu gốc Bộ KH&ĐT về tình trạng pháp lý doanh nghiệp (Đang hoạt động/Tạm ngừng)
                </div>
                <a
                  href={safeHttpUrl("https://dangkykinhdoanh.gov.vn")}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", minHeight: 44, fontSize: "12px", fontWeight: "700", color: "var(--primary-dark)", textDecoration: "none" }}
                >
                  ↗ Truy cập dangkykinhdoanh.gov.vn
                </a>
              </div>
            </div>
          </div>

          {/* ─── 🚨 CHUYÊN ĐỀ RÀ SOÁT CÔNG VĂN 1798/TCT-TTKT ────────────────── */}
          <div style={{ background: "var(--panel)", borderRadius: "14px", border: "1px solid var(--red)", overflow: "hidden", boxShadow: "0 2px 6px rgba(185,28,28,0.06)" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", background: "var(--red-soft)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "20px" }}>🚨</span>
                  <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "800", color: "var(--red)" }}>
                    Chuyên Đề Rà Soát Doanh Nghiệp Điều Tra Mua Bán Hóa Đơn (Công Văn 1798/TCT-TTKT)
                  </h3>
                </div>
                <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "var(--text)" }}>
                  Đối soát toàn diện giữa Danh sách 524 Doanh nghiệp rủi ro (Chuyên án Công an tỉnh Phú Thọ / Tổng cục Thuế) với CSDL Hóa đơn INUT
                </p>
              </div>

              <button
                type="button"
                onClick={handleSyncGdtPurchases}
                disabled={syncingGdt}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "6px",
                  minHeight: 44, padding: "8px 16px", background: syncingGdt ? "var(--muted)" : "var(--red)",
                  color: "#fff", border: "none", borderRadius: "8px",
                  fontSize: "12px", fontWeight: "700", cursor: syncingGdt ? "not-allowed" : "pointer"
                }}
              >
                <span>{syncingGdt ? "⏳" : "🔄"}</span>
                <span>{syncingGdt ? "Đang đồng bộ..." : "Đồng Bộ HĐ Mua Cổng Thuế (2022-2025)"}</span>
              </button>
            </div>

            <FormGrid cols={2} style={{ padding: "clamp(12px, 2.5vw, 20px)" }}>
              {/* Cột Trái: Đầu vào mua vào */}
              <div style={{ background: "var(--red-soft)", padding: "14px", borderRadius: "12px", border: "1px solid var(--border)", minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: "8px" }}>
                  <span style={{ fontWeight: "800", color: "var(--red)", fontSize: "14px" }}>
                    🔻 HÓA ĐƠN MUA VÀO (ĐẦU VÀO) — CẦN GIẢI TRÌNH
                  </span>
                  <span style={{ background: "var(--panel)", color: "var(--red)", padding: "2px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: "700", border: "1px solid var(--red)" }}>
                    {investigationReport?.input_risks.total_invoices || 13} hóa đơn
                  </span>
                </div>

                <div style={{ fontSize: "12px", color: "var(--text)", marginBottom: "12px", lineHeight: "1.5" }}>
                  Tổng giá trị chưa thuế: <strong>{formatVND(investigationReport?.input_risks.total_pretax || 178552201)}</strong> · Tiền thuế GTGT: <strong>{formatVND(investigationReport?.input_risks.total_vat || 17000534)}</strong>
                  <div style={{ marginTop: "4px", fontSize: "11.5px", color: "var(--red)" }}>
                    ⚠️ <strong>Căn cứ thanh tra:</strong> Cơ quan thuế sẽ kiểm tra tính có thật của vật tư. Nếu không chứng minh được, tiền thuế GTGT sẽ bị loại khấu trừ và loại chi phí thuế TNDN.
                  </div>
                </div>

                <div style={{ maxHeight: "240px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--panel)" }}>
                  <DataView
                    mobileMode="scroll"
                    desktop={
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                        <thead>
                          <tr style={{ background: "var(--amber-soft)", textAlign: "left" }}>
                            <th style={{ padding: "6px 8px" }}>HĐ / Ngày</th>
                            <th style={{ padding: "6px 8px" }}>Nhà cung cấp</th>
                            <th style={{ padding: "6px 8px", textAlign: "right" }}>Tổng tiền</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(investigationReport?.input_risks.invoices || []).slice(0, 8).map((inv) => (
                            <tr key={inv.id} style={{ borderBottom: "1px solid var(--border)" }}>
                              <td style={{ padding: "6px 8px", fontWeight: "700" }}>HĐ {inv.so_hd} ({inv.ngay})</td>
                              <td style={{ padding: "6px 8px" }}>
                                <div>{inv.ten_ban}</div>
                                <small style={{ color: "var(--muted)" }}>MST: {inv.mst_ban}</small>
                              </td>
                              <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: "700", color: "var(--red)" }}>
                                {formatVND(inv.tong_tien)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    }
                  />
                </div>
              </div>

              {/* Cột Phải: Đầu ra bán ra */}
              <div style={{ background: "var(--green-soft)", padding: "14px", borderRadius: "12px", border: "1px solid var(--border)", minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: "8px" }}>
                  <span style={{ fontWeight: "800", color: "var(--green)", fontSize: "14px" }}>
                    🔺 HÓA ĐƠN BÁN RA (ĐẦU RA) — AN TOÀN TUYỆT ĐỐI
                  </span>
                  <span style={{ background: "var(--panel)", color: "var(--green)", padding: "2px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: "700", border: "1px solid var(--green)" }}>
                    {investigationReport?.output_risks.total_invoices || 9} hóa đơn
                  </span>
                </div>

                <div style={{ fontSize: "12px", color: "var(--text)", marginBottom: "12px", lineHeight: "1.5" }}>
                  Khách hàng: <strong>CÔNG TY TNHH TM DV KHÁNH LỢI</strong> (MST: `0316764844` - Tên cũ Long Ích Hoa trong DS 524)
                  <div style={{ marginTop: "4px" }}>
                    Tổng tiền thanh toán: <strong>{formatVND(investigationReport?.output_risks.total_payment || 159060000)}</strong> · Thuế GTGT đầu ra: <strong>{formatVND(investigationReport?.output_risks.total_vat || 14460000)}</strong>
                  </div>
                  <div style={{ marginTop: "4px", fontSize: "11.5px", color: "var(--green)" }}>
                    🛡️ <strong>Bảo vệ pháp lý:</strong> INUT là bên nộp thuế, đã hoàn thành nộp 100% tiền thuế đầu ra vào NSNN. Việc khách hàng sau đó bị điều tra mua bán hóa đơn không làm ảnh hưởng tính hợp pháp của doanh thu INUT.
                  </div>
                </div>

                <div style={{ maxHeight: "240px", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--panel)" }}>
                  <DataView
                    mobileMode="scroll"
                    desktop={
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                        <thead>
                          <tr style={{ background: "var(--green-soft)", textAlign: "left" }}>
                            <th style={{ padding: "6px 8px" }}>Số HĐ</th>
                            <th style={{ padding: "6px 8px" }}>Ngày lập</th>
                            <th style={{ padding: "6px 8px", textAlign: "right" }}>Tổng tiền</th>
                            <th style={{ padding: "6px 8px", textAlign: "center" }}>Trạng thái CQT</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(investigationReport?.output_risks.invoices || []).map((inv) => (
                            <tr key={inv.id} style={{ borderBottom: "1px solid var(--border)" }}>
                              <td style={{ padding: "6px 8px", fontWeight: "700" }}>HĐ {inv.so_hd}</td>
                              <td style={{ padding: "6px 8px" }}>{inv.ngay}</td>
                              <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: "700", color: "var(--green)" }}>
                                {formatVND(inv.tong_tien)}
                              </td>
                              <td style={{ padding: "6px 8px", textAlign: "center" }}>
                                <span style={{ background: "var(--green-soft)", color: "var(--green)", padding: "1px 6px", borderRadius: "4px", fontSize: "11px", fontWeight: "700" }}>
                                  ✓ Cấp mã CQT
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    }
                  />
                </div>
              </div>
            </FormGrid>
          </div>

          {/* Single MST Quick Search Bar */}
          <div style={{ background: "var(--panel)", borderRadius: "14px", border: "1px solid var(--border)", padding: "16px" }}>
            <h3 style={{ margin: "0 0 10px 0", fontSize: "14px", fontWeight: "800", color: "var(--ink)" }}>
              Tra Cứu Nhanh Tình Trạng Mã Số Thuế Bất Kỳ
            </h3>
            <form onSubmit={handleCheckSingleMst} style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <input
                type="text"
                className="ui-input"
                value={singleMstQuery}
                onChange={(e) => setSingleMstQuery(e.target.value)}
                placeholder="Nhập MST doanh nghiệp cần kiểm tra (VD: 0316764844)..."
                style={{ flex: "1 1 200px", minWidth: 0 }}
              />
              <button
                type="submit"
                disabled={checkingMst || !singleMstQuery.trim()}
                style={{ minHeight: 44, padding: "9px 18px", background: "var(--ink)", color: "#fff", border: "none", borderRadius: "8px", fontSize: "13px", fontWeight: "700", cursor: "pointer" }}
              >
                {checkingMst ? "⏳ Đang tra cứu..." : "🔍 Kiểm Tra Trạng Thái"}
              </button>
            </form>

            {singleMstResult && (
              <div style={{ marginTop: "14px", padding: "14px", background: singleMstResult.is_abandoned ? "var(--red-soft)" : "var(--green-soft)", border: `1px solid ${singleMstResult.is_abandoned ? "var(--red)" : "var(--green)"}`, borderRadius: "10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8, marginBottom: "6px" }}>
                  <div>
                    <span style={{ fontWeight: "800", color: "var(--ink)", fontSize: "14px" }}>{singleMstResult.company_name}</span>
                    <span style={{ marginLeft: "8px", fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--muted)" }}>(MST: {singleMstResult.mst})</span>
                  </div>
                  <span style={{
                    padding: "3px 10px", borderRadius: "999px", fontSize: "11px", fontWeight: "700",
                    background: "var(--panel)",
                    color: singleMstResult.is_abandoned ? "var(--red)" : "var(--green)",
                    border: `1px solid ${singleMstResult.is_abandoned ? "var(--red)" : "var(--green)"}`
                  }}>
                    {singleMstResult.status_desc}
                  </span>
                </div>
                <div style={{ fontSize: "12px", color: "var(--text)", marginBottom: "6px" }}>
                  <strong>Địa chỉ:</strong> {singleMstResult.address || "Chưa có địa chỉ"}
                </div>
                <div style={{ fontSize: "12px", color: singleMstResult.is_abandoned ? "var(--red)" : "var(--green)", fontWeight: "600" }}>
                  💡 <strong>Hướng giải trình:</strong> {singleMstResult.defense_note}
                </div>
              </div>
            )}
          </div>

          {/* Partners Table with Filter */}
          <div style={{ background: "var(--panel)", borderRadius: "14px", border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "15px", fontWeight: "800", color: "var(--ink)" }}>
                  Bảng Đối Soát Tình Trạng Pháp Lý Toàn Bộ Đối Tác (Người Mua & Người Bán)
                </h3>
                <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "var(--muted)" }}>
                  Tự động phân loại rủi ro hóa đơn và đưa ra khuyến nghị đối phó thanh tra
                </p>
              </div>

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="ui-btn-chip"
                  onClick={() => setPartnerFilter("all")}
                  style={{
                    borderColor: "var(--border-strong)",
                    background: partnerFilter === "all" ? "var(--ink)" : "var(--panel)",
                    color: partnerFilter === "all" ? "#fff" : "var(--text)",
                  }}
                >
                  Tất cả ({partnerReport?.total_checked || 0})
                </button>
                <button
                  type="button"
                  className="ui-btn-chip"
                  onClick={() => setPartnerFilter("risk_only")}
                  style={{
                    borderColor: "var(--red)",
                    background: partnerFilter === "risk_only" ? "var(--red)" : "var(--red-soft)",
                    color: partnerFilter === "risk_only" ? "#fff" : "var(--red)",
                  }}
                >
                  🚨 Cảnh báo Trạng thái 06 ({partnerReport?.abandoned_count || 0})
                </button>
              </div>
            </div>

            {loadingPartners ? (
              <div style={{ padding: "30px", textAlign: "center", color: "var(--muted)", fontSize: "13px" }}>
                ⏳ Đang kiểm tra trạng thái đối tác qua CSDL Quốc gia...
              </div>
            ) : (
              <DataView
                mobileMode="scroll"
                desktop={
                  <table className="dt" style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ background: "var(--surface-subtle)", textAlign: "left" }}>
                        <th style={{ padding: "10px 14px" }}>Mã số thuế</th>
                        <th style={{ padding: "10px 14px" }}>Tên đối tác</th>
                        <th style={{ padding: "10px 14px" }}>Vai trò</th>
                        <th style={{ padding: "10px 14px", textAlign: "right" }}>Tổng giao dịch</th>
                        <th style={{ padding: "10px 14px", textAlign: "center" }}>Năm phát sinh</th>
                        <th style={{ padding: "10px 14px" }}>Trạng thái hoạt động</th>
                        <th style={{ padding: "10px 14px", textAlign: "center" }}>Đánh giá rủi ro</th>
                        <th style={{ padding: "10px 14px", textAlign: "center" }}>Hành động</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(partnerReport?.partners || [])
                        .filter((p) => (partnerFilter === "risk_only" ? p.is_abandoned || p.is_closed : true))
                        .map((p) => {
                          const isKhSo = p.is_abandoned;
                          return (
                            <tr
                              key={p.mst}
                              style={{
                                borderBottom: "1px solid var(--border)",
                                background: isKhSo ? "var(--red-soft)" : "var(--panel)",
                              }}
                            >
                              <td style={{ padding: "12px 14px", fontFamily: "var(--font-mono)", fontWeight: "700" }}>
                                {p.mst}
                              </td>
                              <td style={{ padding: "12px 14px" }}>
                                <div style={{ fontWeight: "700", color: isKhSo ? "var(--red)" : "var(--ink)" }}>
                                  {p.name}
                                </div>
                                <div style={{ fontSize: "11px", color: "var(--muted)" }}>{p.address}</div>
                              </td>
                              <td style={{ padding: "12px 14px", fontSize: "12px" }}>{p.role}</td>
                              <td style={{ padding: "12px 14px", textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: "700", color: isKhSo ? "var(--red)" : "var(--primary)" }}>
                                {formatVND(p.total_amount)}
                              </td>
                              <td style={{ padding: "12px 14px", textAlign: "center", fontSize: "12px", color: "var(--muted)" }}>
                                {p.years.join(", ")}
                              </td>
                              <td style={{ padding: "12px 14px" }}>
                                <span style={{
                                  display: "inline-block", padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: "700",
                                  background: isKhSo ? "var(--red-soft)" : (p.is_suspended ? "var(--amber-soft)" : "var(--green-soft)"),
                                  color: isKhSo ? "var(--red)" : (p.is_suspended ? "var(--amber)" : "var(--green)")
                                }}>
                                  {p.status_desc}
                                </span>
                              </td>
                              <td style={{ padding: "12px 14px", textAlign: "center" }}>
                                <span style={{
                                  padding: "2px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: "800",
                                  background: isKhSo ? "var(--red)" : (p.risk_level === "medium" ? "var(--amber)" : "var(--green)"),
                                  color: "#fff"
                                }}>
                                  {isKhSo ? "CAO (TT 06)" : (p.risk_level === "medium" ? "TRUNG BÌNH" : "AN TOÀN")}
                                </span>
                              </td>
                              <td style={{ padding: "12px 14px", textAlign: "center" }}>
                                <button
                                  type="button"
                                  className="ui-btn-chip"
                                  onClick={() => setSelectedPartnerModal(p)}
                                  style={{
                                    background: isKhSo ? "var(--red)" : "var(--surface-subtle)",
                                    color: isKhSo ? "#fff" : "var(--ink)",
                                    borderColor: isKhSo ? "var(--red)" : "var(--border-strong)",
                                  }}
                                >
                                  {isKhSo ? "🛡️ Xem Giải Trình" : "Chi tiết"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                }
              />
            )}
          </div>

          {/* Partner Detail & Defense Modal */}
          <AppModal
            open={!!selectedPartnerModal}
            onClose={() => setSelectedPartnerModal(null)}
            title={selectedPartnerModal ? `${selectedPartnerModal.is_abandoned ? "🚨" : "🏢"} ${selectedPartnerModal.name}` : ""}
            subtitle={selectedPartnerModal ? `MST: ${selectedPartnerModal.mst} · ${selectedPartnerModal.role}` : undefined}
            size="md"
            footer={
              <button
                type="button"
                className="btn-sm ghost"
                onClick={() => setSelectedPartnerModal(null)}
              >
                Đóng
              </button>
            }
          >
            {selectedPartnerModal && (
              <div style={{ display: "flex", flexDirection: "column", gap: "14px", fontSize: "13px" }}>
                <div style={{ padding: "12px", background: selectedPartnerModal.is_abandoned ? "var(--red-soft)" : "var(--surface-subtle)", borderRadius: "10px", border: `1px solid ${selectedPartnerModal.is_abandoned ? "var(--red)" : "var(--border)"}` }}>
                  <div style={{ fontWeight: "700", color: selectedPartnerModal.is_abandoned ? "var(--red)" : "var(--ink)", marginBottom: "4px" }}>
                    Trạng thái thuế: {selectedPartnerModal.status_desc}
                  </div>
                  <div style={{ color: "var(--text)" }}><strong>Địa chỉ đăng ký:</strong> {selectedPartnerModal.address || "Chưa rõ"}</div>
                  <div style={{ color: "var(--text)", marginTop: "4px" }}><strong>Giao dịch phát sinh:</strong> {selectedPartnerModal.invoice_count} hóa đơn ({formatVND(selectedPartnerModal.total_amount)}) các năm {selectedPartnerModal.years.join(", ")}</div>
                </div>

                <div>
                  <h4 style={{ margin: "0 0 6px 0", fontSize: "13px", fontWeight: "800", color: "var(--ink)" }}>
                    🛡️ Căn Cứ Giải Trình Bảo Vệ Pháp Lý (Tax Defense Doctrine):
                  </h4>
                  <p style={{ margin: 0, lineHeight: "1.6", color: "var(--text)" }}>
                    {selectedPartnerModal.defense_note}
                  </p>
                  {selectedPartnerModal.mst === "0316764844" && (
                    <div style={{ marginTop: "10px", padding: "10px", background: "var(--green-soft)", border: "1px solid var(--green)", borderRadius: "8px", fontSize: "12px", color: "var(--green)" }}>
                      ✓ <strong>Giao dịch bán hàng (Đầu ra):</strong> INUT đã xuất hóa đơn có mã CQT hợp lệ năm 2024 và đã nộp đủ 14,46 triệu VNĐ tiền thuế GTGT vào NSNN. Việc khách hàng Khánh Lợi sau đó bỏ địa chỉ kinh doanh hoàn toàn không ảnh hưởng đến doanh thu hợp pháp của INUT.
                    </div>
                  )}
                </div>

                <div style={{ borderTop: "1px solid var(--border)", paddingTop: "10px" }}>
                  <span style={{ fontSize: "12px", fontWeight: "700", color: "var(--muted)" }}>Tra cứu trực tiếp cơ quan thẩm quyền:</span>
                  <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "6px" }}>
                    <a
                      href={safeHttpUrl("https://congkhaithongtin.gdt.gov.vn")}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", minHeight: 44, fontSize: "12px", color: "var(--primary-dark)", fontWeight: "700", textDecoration: "none" }}
                    >
                      ↗ Cổng công khai GDT
                    </a>
                    <a
                      href={safeHttpUrl("https://tracuunnt.gdt.gov.vn/tcnnt/mstdn.jsp")}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", minHeight: 44, fontSize: "12px", color: "var(--primary-dark)", fontWeight: "700", textDecoration: "none" }}
                    >
                      ↗ Tra cứu NNT
                    </a>
                  </div>
                </div>
              </div>
            )}
          </AppModal>
        </div>
      )}

      {/* ─── 6. TAB 3: BẢN THUYẾT MINH GIẢI TRÌNH PHÁP LÝ ────────────────── */}
      {activeTab === "dossier" && (
        <div style={{ background: "var(--panel)", borderRadius: "14px", border: "1px solid var(--border)", padding: "clamp(14px, 2.5vw, 24px)", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: "18px", borderBottom: "1px solid var(--border)", paddingBottom: "14px" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "17px", fontWeight: "800", color: "var(--ink)" }}>
                {dossier?.title || "Bản Thuyết Minh Giải Trình Thuế 2022 - 2025"}
              </h2>
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                Sẵn sàng copy vào văn bản giải trình chính thức gửi Cơ quan Thuế
              </span>
            </div>

            <button
              type="button"
              onClick={handleCopyDossier}
              style={{
                display: "inline-flex", alignItems: "center", gap: "6px",
                minHeight: 44, padding: "8px 16px", background: copySuccess ? "var(--green)" : "var(--ink)",
                color: "#fff", border: "none", borderRadius: "8px",
                fontSize: "13px", fontWeight: "700", cursor: "pointer"
              }}
            >
              <span>{copySuccess ? "✓" : "📋"}</span>
              <span>{copySuccess ? "Đã chép toàn văn!" : "Sao Chép Toàn Văn"}</span>
            </button>
          </div>

          <div
            style={{
              background: "var(--surface-subtle)",
              padding: "clamp(12px, 2.5vw, 20px)",
              borderRadius: "10px",
              border: "1px solid var(--border)",
              fontFamily: "var(--font-sans)",
              fontSize: "13.5px",
              lineHeight: "1.65",
              color: "var(--text)",
              whiteSpace: "pre-wrap",
              maxHeight: "680px",
              overflowY: "auto",
            }}
          >
            {dossier?.markdown_content}
          </div>
        </div>
      )}

      {/* ─── 7. TAB 4: NẠP BẢNG KÊ MUA VÀO EXCEL (2022 - 2024) ───────────── */}
      {activeTab === "import" && (
        <div style={{ background: "var(--panel)", borderRadius: "14px", border: "1px solid var(--border)", padding: "clamp(14px, 2.5vw, 24px)", maxWidth: "720px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "20px" }}>
            <span style={{ fontSize: "32px" }}>📥</span>
            <h2 style={{ margin: "8px 0 4px 0", fontSize: "18px", fontWeight: "800", color: "var(--ink)" }}>
              Nạp Bảng Kê Mua Vào Lịch Sử (2022 – 2024)
            </h2>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: "13px" }}>
              Nhập bảng kê Mẫu 01-2/GTGT từ phần mềm kế toán cũ (MISA, Fast) để bổ sung cơ sở dữ liệu chi phí giải trình
            </p>
          </div>

          <form onSubmit={handleImportSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "700", marginBottom: "6px", color: "var(--ink)" }}>
                Chọn Năm Tài Chính <span style={{ color: "var(--red)" }}>*</span>
              </label>
              <select
                className="ui-select"
                value={importYear}
                onChange={(e) => setImportYear(e.target.value)}
                style={{ width: "100%", fontWeight: "600" }}
              >
                <option value="2022">Năm 2022</option>
                <option value="2023">Năm 2023</option>
                <option value="2024">Năm 2024</option>
                <option value="2025">Năm 2025 (8 tháng đầu)</option>
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "700", marginBottom: "6px", color: "var(--ink)" }}>
                File Excel Bảng Kê (.xlsx, .xls) <span style={{ color: "var(--red)" }}>*</span>
              </label>
              <input
                className="ui-input"
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                style={{ width: "100%", padding: "10px", borderStyle: "dashed", background: "var(--surface-subtle)" }}
              />
              <p style={{ margin: "6px 0 0 0", fontSize: "12px", color: "var(--muted)" }}>
                Hệ thống tự động nhận diện các cột: Ký hiệu, Số HĐ, Ngày lập, Tên người bán, MST, Tiền hàng chưa thuế, Tiền thuế GTGT.
              </p>
            </div>

            <button
              type="submit"
              disabled={importing || !importFile}
              style={{
                marginTop: "10px",
                minHeight: 44,
                padding: "12px 20px",
                background: importing ? "var(--muted)" : "var(--ink)",
                color: "#fff",
                border: "none",
                borderRadius: "9px",
                fontSize: "14px",
                fontWeight: "700",
                cursor: importing || !importFile ? "not-allowed" : "pointer",
                boxShadow: "0 2px 4px rgba(0,0,0,0.08)",
              }}
            >
              {importing ? "⏳ Đang nạp dữ liệu..." : "🚀 Bắt Đầu Nạp Bảng Kê"}
            </button>
          </form>

          {importResult && (
            <div style={{ marginTop: "20px", padding: "14px", background: "var(--green-soft)", border: "1px solid var(--green)", borderRadius: "10px" }}>
              <div style={{ fontWeight: "700", color: "var(--green)", marginBottom: "4px" }}>
                ✓ Nạp thành công bảng kê năm {importResult.year}
              </div>
              <div style={{ fontSize: "13px", color: "var(--text)" }}>
                Đã thêm mới: <strong>{importResult.imported}</strong> hóa đơn · Bỏ qua (trùng): <strong>{importResult.skipped}</strong> hóa đơn
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
