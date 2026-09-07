import React, { useEffect, useState, useMemo } from "react";
import {
  api,
  type BiddingTenderSummary,
  type BiddingTenderDetail,
  type BiddingSearchResult,
  type BiddingBookmarkItem,
  type BiddingBookmarkCreate,
  type BiddingWatchlistItem,
  type BiddingWatchlistCreate,
  type BiddingAIAnalysisResult,
  type BiddingAIAnalysisData,
  type BiddingContractorItem,
  type BiddingCrmScanResult,
  type BiddingWonPackage,
} from "../api";

// ─── Helpers: Format tiền tệ, ngày giờ, countdown ───────────────────────────
function formatVnd(val?: number | null): string {
  if (val == null || isNaN(val)) return "0 ₫";
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(val);
}

function formatVndShort(val?: number | null): string {
  if (val == null || isNaN(val) || val === 0) return "0 ₫";
  if (val >= 1_000_000_000) {
    const b = val / 1_000_000_000;
    return `${b % 1 === 0 ? b.toFixed(0) : b.toFixed(2)} Tỷ ₫`;
  }
  if (val >= 1_000_000) {
    const m = val / 1_000_000;
    return `${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)} Tr ₫`;
  }
  return formatVnd(val);
}

function formatDate(dStr?: string | null): string {
  if (!dStr) return "—";
  try {
    const d = new Date(dStr);
    if (isNaN(d.getTime())) return dStr;
    return d.toLocaleString("vi-VN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dStr;
  }
}

function getDeadlineMeta(deadlineStr?: string | null): {
  label: string;
  status: "open" | "urgent" | "closed" | "unknown";
  daysLeft: number;
} {
  if (!deadlineStr) return { label: "Chưa xác định", status: "unknown", daysLeft: 999 };
  try {
    const target = new Date(deadlineStr).getTime();
    if (isNaN(target)) return { label: deadlineStr, status: "unknown", daysLeft: 999 };
    const now = Date.now();
    const diff = target - now;
    if (diff <= 0) {
      return { label: "Đã đóng thầu", status: "closed", daysLeft: -1 };
    }
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days === 0) {
      return {
        label: `Hết hạn trong ${hours} giờ`,
        status: "urgent",
        daysLeft: 0,
      };
    }
    if (days <= 3) {
      return {
        label: `Còn ${days} ngày ${hours}h`,
        status: "urgent",
        daysLeft: days,
      };
    }
    return {
      label: `Còn ${days} ngày`,
      status: "open",
      daysLeft: days,
    };
  } catch {
    return { label: deadlineStr, status: "unknown", daysLeft: 999 };
  }
}

// Map lĩnh vực sang tên và badge style
const FIELD_MAP: Record<string, { label: string; color: string; bg: string }> = {
  HH: { label: "Hàng hóa", color: "#0f5132", bg: "#d1e7dd" },
  "Hàng hóa": { label: "Hàng hóa", color: "#0f5132", bg: "#d1e7dd" },
  XL: { label: "Xây lắp", color: "#664d03", bg: "#fff3cd" },
  "Xây lắp": { label: "Xây lắp", color: "#664d03", bg: "#fff3cd" },
  TV: { label: "Tư vấn", color: "#055160", bg: "#cff4fc" },
  "Tư vấn": { label: "Tư vấn", color: "#055160", bg: "#cff4fc" },
  PTV: { label: "Phi tư vấn", color: "#491217", bg: "#f8d7da" },
  "Phi tư vấn": { label: "Phi tư vấn", color: "#491217", bg: "#f8d7da" },
  HHOP: { label: "Hỗn hợp", color: "#383d41", bg: "#e2e3e5" },
  "Hỗn hợp": { label: "Hỗn hợp", color: "#383d41", bg: "#e2e3e5" },
};

function getFieldBadge(field?: string) {
  if (!field) return { label: "Khác", color: "#495057", bg: "#e9ecef" };
  return FIELD_MAP[field] || { label: field, color: "#145846", bg: "#e7f2ed" };
}

// Pipeline status definitions
const BOOKMARK_STATUS_MAP: Record<
  "watching" | "preparing" | "submitted" | "won" | "lost",
  { label: string; chipClass: string; icon: string; desc: string }
> = {
  watching: {
    label: "Đang theo dõi",
    chipClass: "chip amber",
    icon: "👀",
    desc: "Nghiên cứu sơ bộ yêu cầu & HSMT",
  },
  preparing: {
    label: "Chuẩn bị hồ sơ",
    chipClass: "chip indigo",
    icon: "📝",
    desc: "Đang lập E-HSDT, tính toán giá & liên danh",
  },
  submitted: {
    label: "Đã nộp thầu",
    chipClass: "chip purple",
    icon: "📨",
    desc: "Đã nộp E-HSDT thành công trên mạng e-GP",
  },
  won: {
    label: "Trúng thầu",
    chipClass: "chip green",
    icon: "🏆",
    desc: "Trúng thầu & chuẩn bị ký hợp đồng",
  },
  lost: {
    label: "Trượt thầu",
    chipClass: "chip red",
    icon: "✕",
    desc: "Không trúng thầu hoặc hủy thầu",
  },
};

const PROVINCES = [
  "Tất cả",
  "Hồ Chí Minh",
  "Hà Nội",
  "Đà Nẵng",
  "Bình Dương",
  "Đồng Nai",
  "Bà Rịa - Vũng Tàu",
  "Long An",
  "Cần Thơ",
  "Hải Phòng",
  "Quảng Ninh",
  "Bắc Ninh",
  "Thái Nguyên",
  "Khánh Hòa",
  "Lâm Đồng",
  "Bình Thuận",
  "Quảng Nam",
  "Thừa Thiên Huế",
];

const FIELDS = [
  { value: "", label: "Tất cả lĩnh vực" },
  { value: "HH", label: "Hàng hóa (HH)" },
  { value: "XL", label: "Xây lắp (XL)" },
  { value: "TV", label: "Tư vấn (TV)" },
  { value: "PTV", label: "Phi tư vấn (PTV)" },
  { value: "HHOP", label: "Hỗn hợp (HHOP)" },
];

// ─── Component: Thanh hiển thị tỷ lệ trúng thầu đồ họa trực quan (Dual-tone Win Rate Bar) ──
function WinRateProgressBar({
  won,
  total,
  rate,
  size = "md",
}: {
  won: number;
  total: number;
  rate: number;
  size?: "sm" | "md" | "lg";
}) {
  const percent = Math.min(100, Math.max(0, rate));
  const lost = Math.max(0, total - won);

  // Gradient và màu sắc theo mức độ thắng thầu
  const isHigh = percent >= 60;
  const isMid = percent >= 30;
  const badgeColor = isHigh ? "#065f46" : isMid ? "#92400e" : "#991b1b";
  const badgeBg = isHigh ? "#d1fae5" : isMid ? "#fef3c7" : "#fee2e2";
  const badgeBorder = isHigh ? "#a7f3d0" : isMid ? "#fde68a" : "#fecaca";
  const barGradient = isHigh
    ? "linear-gradient(90deg, #10b981 0%, #059669 100%)"
    : isMid
    ? "linear-gradient(90deg, #f59e0b 0%, #d97706 100%)"
    : "linear-gradient(90deg, #f87171 0%, #dc2626 100%)";

  const height = size === "lg" ? "12px" : size === "sm" ? "7px" : "9px";

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "5px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: size === "lg" ? "13px" : "11px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontWeight: 700, color: "#475569" }}>
            🏆 Trúng: <strong style={{ color: "#0f172a" }}>{won}</strong> / {total} gói
          </span>
          {lost > 0 && (
            <span style={{ fontSize: "10px", color: "#94a3b8" }}>
              ({lost} trượt)
            </span>
          )}
        </div>
        <span
          style={{
            fontWeight: 800,
            fontSize: size === "lg" ? "12px" : "11px",
            padding: "2px 8px",
            borderRadius: "999px",
            background: badgeBg,
            color: badgeColor,
            border: `1px solid ${badgeBorder}`,
            fontFamily: "var(--font-mono, monospace)",
            display: "inline-flex",
            alignItems: "center",
            gap: "3px",
          }}
        >
          <span>⚡</span>
          <span>{rate}% Thắng</span>
        </span>
      </div>

      {/* Dual-tone Progress Track */}
      <div
        style={{
          width: "100%",
          height,
          background: "#e2e8f0",
          borderRadius: "999px",
          overflow: "hidden",
          position: "relative",
          boxShadow: "inset 0 1px 2px rgba(0,0,0,0.06)",
        }}
      >
        <div
          style={{
            width: `${percent}%`,
            height: "100%",
            background: barGradient,
            borderRadius: "999px",
            transition: "width 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
            boxShadow: percent > 0 ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
          }}
        />
      </div>
    </div>
  );
}

// ─── Helpers: Xuất Báo Cáo Markdown cho AI & Nhà Thầu ──────────────────────────
function generateAiAnalysisMarkdown(
  tender: BiddingTenderSummary | BiddingTenderDetail | null,
  analysis: BiddingAIAnalysisData
): string {
  const fit = analysis.inut_fit_analysis;
  const score = fit?.score ?? analysis.inut_compatibility_score ?? 85;
  const matchLevel = fit?.match_level || (score >= 80 ? "RẤT CAO" : score >= 60 ? "TRUNG BÌNH" : "THẤP");
  const rec = fit?.recommendation || (score >= 80 ? "Nên tham gia độc lập" : "Khuyến nghị liên danh");

  const lines: string[] = [
    `# BÁO CÁO PHÂN TÍCH E-HSMT & ĐỘ PHÙ HỢP CHIẾN LƯỢC INUT`,
    `**Thời gian trích xuất**: ${new Date().toLocaleString("vi-VN")}`,
    `**Đơn vị đánh giá**: INUT Technology Bidding Strategic Radar (MST 4401053694)`,
    ``,
    `## 1. Thông Tin Gói Thầu`,
    `- **Mã TBMT**: ${tender?.tbmt_code || "—"}`,
    `- **Tên gói thầu**: ${tender?.tender_name || "—"}`,
    `- **Bên mời thầu**: ${tender?.procuring_entity || "—"}`,
    `- **Chủ đầu tư**: ${tender?.investor || "—"}`,
    `- **Giá gói thầu (Dự toán)**: ${formatVnd(tender?.bid_price)}`,
    `- **Thời điểm đóng thầu**: ${formatDate(tender?.bid_deadline)}`,
    `- **Địa bàn thực hiện**: ${tender?.province || "Toàn quốc"}`,
    `- **Lĩnh vực**: ${tender?.field || "—"}`,
    ``,
    `## 2. Điểm Số Chiến Lược & Khuyến Nghị INUT`,
    `- **Điểm tương thích năng lực INUT**: **${score} / 100 Điểm**`,
    `- **Mức độ phù hợp**: **${matchLevel}**`,
    `- **Khuyến nghị chiến lược**: ${rec}`,
    `- **Đánh giá tổng quan**: ${analysis.executive_summary || analysis.summary || "Đánh giá chi tiết năng lực dự thầu."}`,
    ``,
    `## 3. Yêu Cầu Năng Lực & Kinh Nghiệm`,
  ];

  if (Array.isArray(analysis.capacity_requirements)) {
    analysis.capacity_requirements.forEach((req) => lines.push(`- ${req}`));
  } else {
    lines.push(`- ${analysis.capacity_requirements || "Đáp ứng theo quy chuẩn e-GP"}`);
  }

  lines.push(``, `## 4. Điều Kiện Tài Chính & Doanh Thu`);
  if (typeof analysis.financial_requirements === "object" && analysis.financial_requirements !== null) {
    if (analysis.financial_requirements.min_annual_revenue) {
      lines.push(`- **Doanh thu bình quân tối thiểu**: ${formatVnd(analysis.financial_requirements.min_annual_revenue)}`);
    }
    if (analysis.financial_requirements.bid_security_amount) {
      lines.push(`- **Bảo lãnh dự thầu**: ${formatVnd(analysis.financial_requirements.bid_security_amount)}`);
    }
    if (analysis.financial_requirements.summary) {
      lines.push(`- ${analysis.financial_requirements.summary}`);
    }
  } else {
    lines.push(`- ${analysis.revenue_requirements || String(analysis.financial_requirements || "Theo quy định HSMT")}`);
  }

  lines.push(``, `## 5. Lợi Thế Cạnh Tranh Của INUT`);
  const strengths = fit?.strengths || analysis.strengths || [
    "Làm chủ 100% công nghệ phần cứng Gateway 4G và nền tảng Web SCADA",
    "Giá thành sản xuất trong nước tối ưu hơn các giải pháp ngoại nhập",
    "Đội ngũ kỹ thuật hỗ trợ triển khai và bảo hành tận nơi nhanh chóng",
  ];
  strengths.forEach((s) => lines.push(`- ✅ ${s}`));

  lines.push(``, `## 6. Thách Thức & Kế Hoạch Hành Động`);
  if (fit?.strategic_action_plan) {
    lines.push(`- ⚠️ ${fit.strategic_action_plan}`);
  } else {
    const challenges = fit?.challenges || analysis.risks || [
      "Kiểm tra yêu cầu số lượng hợp đồng tương tự trước khi lập E-HSDT",
      "Chuẩn bị thư bảo lãnh dự thầu trước thời hạn 48 giờ",
    ];
    challenges.forEach((c) => lines.push(`- ⚠️ ${c}`));
  }

  return lines.join("\n");
}

function generateContractorDossierMarkdown(c: BiddingContractorItem): string {
  const lines: string[] = [
    `# HỒ SƠ NĂNG LỰC NHÀ THẦU & TÌNH BÁO ĐẤU THẦU`,
    `**Doanh nghiệp**: ${c.name}`,
    `**Mã số thuế**: ${c.tax_code}`,
    `**Địa chỉ**: ${c.address || "—"}`,
    `**Phân loại đối tác INUT**: ${c.bidding_status_label}`,
    `**Thời gian trích xuất**: ${new Date().toLocaleString("vi-VN")}`,
    ``,
    `## 1. Thống Kê Năng Lực Đấu Thầu`,
    `- **Tổng số gói thầu tham gia**: ${c.total_bids} gói`,
    `- **Số gói trúng thầu**: ${c.total_won} gói`,
    `- **Số gói trượt / đang đánh giá**: ${c.total_lost + c.total_evaluating} gói`,
    `- **Tỷ lệ trúng thầu (Win Rate)**: **${c.win_rate_percent}%**`,
    `- **Tổng giá trị trúng thầu lũy kế**: **${c.total_won_value_formatted}**`,
    `- **Mức chiết khấu / giảm giá trung bình**: ${c.average_discount_percent > 0 ? `${c.average_discount_percent}%` : "—"}`,
    ``,
  ];

  if (c.top_procuring_entities && c.top_procuring_entities.length > 0) {
    lines.push(`## 2. Chủ Đầu Tư / Bên Mời Thầu Quen Thuộc`);
    c.top_procuring_entities.forEach((ent) => lines.push(`- 🏛️ ${ent}`));
    lines.push(``);
  }

  lines.push(`## 3. Danh Mục Gói Thầu Tiêu Biểu & Quyết Định Phê Duyệt`);
  if (c.highlight_won_packages && c.highlight_won_packages.length > 0) {
    lines.push(`| Số TBMT | Tên Gói Thầu | Bên Mời Thầu | Giá Trúng Thầu | Tiết Kiệm | Quyết Định Phê Duyệt |`);
    lines.push(`| :--- | :--- | :--- | :--- | :--- | :--- |`);
    c.highlight_won_packages.forEach((pkg) => {
      lines.push(
        `| ${pkg.tbmt_code} | ${pkg.tender_name.replace(/\|/g, "/")} | ${pkg.procuring_entity.replace(/\|/g, "/")} | ${formatVnd(pkg.won_price)} | ${pkg.discount_percent}% | ${pkg.decision_number} (${pkg.award_date}) |`
      );
    });
  } else {
    lines.push(`*Chưa ghi nhận gói thầu công lập trực tiếp trên cổng e-GP (thường đóng vai trò thầu phụ / OEM).*`);
  }

  if (c.ai_insight) {
    lines.push(``, `## 4. Đánh Giá Chiến Lược & Cơ Hội Hợp Tác INUT`, `${c.ai_insight}`);
  }

  return lines.join("\n");
}

export function BiddingProcurement() {
  // Navigation Tabs
  const [activeTab, setActiveTab] = useState<"search" | "bookmarks" | "watchlist" | "contractors">("search");

  // Tab 1: Search State
  const [keyword, setKeyword] = useState("");
  const [province, setProvince] = useState("");
  const [field, setField] = useState("");
  const [minPrice, setMinPrice] = useState<number | "">("");
  const [maxPrice, setMaxPrice] = useState<number | "">("");
  const [biddingMethod, setBiddingMethod] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "closed">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Search Results
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState<BiddingSearchResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Tab 2: Bookmarks Pipeline State
  const [bookmarks, setBookmarks] = useState<BiddingBookmarkItem[]>([]);
  const [bookmarksLoading, setBookmarksLoading] = useState(false);
  const [bookmarkPipelineFilter, setBookmarkPipelineFilter] = useState<string>("all");
  const [bookmarkSearchKeyword, setBookmarkSearchKeyword] = useState("");

  // Tab 3: Watchlist State
  const [watchlists, setWatchlists] = useState<BiddingWatchlistItem[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [scanningId, setScanningId] = useState<number | "all" | null>(null);

  // Modal Dialogs State
  const [detailModalTender, setDetailModalTender] = useState<BiddingTenderDetail | null>(null);
  const [detailModalLoading, setDetailModalLoading] = useState(false);
  const [detailModalTab, setDetailModalTab] = useState<"info" | "iframe" | "attachments" | "competitors">("info");
  const [modalCompetitors, setModalCompetitors] = useState<any[]>([]);
  const [modalAttachments, setModalAttachments] = useState<any[]>([]);

  // AI Modal State
  const [aiModalResult, setAiModalResult] = useState<BiddingAIAnalysisResult | null>(null);
  const [aiModalTender, setAiModalTender] = useState<BiddingTenderSummary | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiCustomContext, setAiCustomContext] = useState("");
  const [aiError, setAiError] = useState<string | null>(null);

  // Bookmark Create/Edit Modal State
  const [bookmarkModalItem, setBookmarkModalItem] = useState<{
    tender: BiddingTenderSummary;
    status: "watching" | "preparing" | "submitted" | "won" | "lost";
    note: string;
    existingId?: number;
  } | null>(null);

  // Watchlist Create/Edit Modal State
  const [watchlistModalRule, setWatchlistModalRule] = useState<Partial<BiddingWatchlistItem> | null>(null);

  // Won Packages & INUT Playbook State
  const [contractorSubTab, setContractorSubTab] = useState<"crm_contractors" | "won_packages_playbook">("won_packages_playbook");
  const [wonPackagesResult, setWonPackagesResult] = useState<{
    total_packages: number;
    total_won_value_vnd: number;
    total_won_value_formatted: string;
    average_discount_percent: number;
    packages: any[];
  } | null>(null);
  const [wonPackagesLoading, setWonPackagesLoading] = useState(false);
  const [wonPackagesQuery, setWonPackagesQuery] = useState("");
  const [wonPackagesFieldFilter, setWonPackagesFieldFilter] = useState("");
  const [inutPlaybook, setInutPlaybook] = useState<any>(null);
  const [selectedWonPackageDetail, setSelectedWonPackageDetail] = useState<any>(null);

  const handleFetchWonPackages = async (query = "", field = "") => {
    setWonPackagesLoading(true);
    try {
      const [resPackages, resPlaybook] = await Promise.all([
        api.bidding.getWonPackages(query, field),
        api.bidding.getPlaybook(),
      ]);
      setWonPackagesResult(resPackages);
      setInutPlaybook(resPlaybook);
    } catch (e: any) {
      showToast(e.message || "Lỗi tải kho gói thầu đã trúng", "error");
    } finally {
      setWonPackagesLoading(false);
    }
  };

    // Tab 4: Contractor Intelligence & CRM Scan State
  const [crmScanResult, setCrmScanResult] = useState<BiddingCrmScanResult | null>(null);
  const [crmScanLoading, setCrmScanLoading] = useState(false);
  const [contractorSearchQuery, setContractorSearchQuery] = useState("");
  const [contractorCategoryFilter, setContractorCategoryFilter] = useState<"all" | "won" | "registered" | "oem">("all");
  const [selectedContractorDetail, setSelectedContractorDetail] = useState<BiddingContractorItem | null>(null);
  const prevContractorQueryRef = React.useRef<string | null>(null);

  const handleScanCrmContractors = async () => {
    setCrmScanLoading(true);
    try {
      const res = await api.bidding.scanCrmContractors();
      setCrmScanResult(res);
      showToast(`Đã quét đối soát ${res.total_crm_customers} khách hàng CRM!`, "success");
    } catch (e: any) {
      showToast(e.message || "Lỗi quét khách hàng CRM", "error");
    } finally {
      setCrmScanLoading(false);
    }
  };

  const handleSearchContractorsDirect = async (query: string) => {
    const q = query.trim();
    if (!q) {
      handleScanCrmContractors();
      return;
    }
    setCrmScanLoading(true);
    try {
      const list = await api.bidding.searchContractors(q);
      if (list.length > 0) {
        setCrmScanResult((prev) => ({
          total_crm_customers: prev?.total_crm_customers || list.length,
          total_won_contractors: list.filter((i) => i.total_won > 0).length,
          total_won_value_vnd: list.reduce((sum, i) => sum + i.total_won_value_vnd, 0),
          total_won_value_formatted: formatVnd(list.reduce((sum, i) => sum + i.total_won_value_vnd, 0)),
          items: list,
        }));
        showToast(`Tìm thấy ${list.length} nhà thầu phù hợp với "${q}"`, "success");
      } else {
        setCrmScanResult({
          total_crm_customers: 0,
          total_won_contractors: 0,
          total_won_value_vnd: 0,
          total_won_value_formatted: "0 ₫",
          items: [],
        });
        showToast(`Không tìm thấy dữ liệu cho từ khóa "${q}"`, "info");
      }
    } catch (e: any) {
      showToast(e.message || "Lỗi tìm kiếm nhà thầu", "error");
    } finally {
      setCrmScanLoading(false);
    }
  };


  // Deep subpath initialization & browser history listener on mount
  useEffect(() => {
    const pathname = window.location.pathname;

    // Check for tender modal subpath: /bidding/tender/:code or /dau-thau/tender/:code
    const tenderMatch = pathname.match(/(?:\/bidding|\/dau-thau)\/tender\/([^/]+)(?:\/(attachments|competitors|portal|info))?/);
    if (tenderMatch) {
      const code = decodeURIComponent(tenderMatch[1]);
      const sub = tenderMatch[2] === "portal" ? "iframe" : (tenderMatch[2] as any) || "info";
      handleOpenTenderDetail(code, sub, true);
      return;
    }

    // Check for contractor dossier subpath: /bidding/contractor/:tax_code
    const contractorMatch = pathname.match(/(?:\/bidding|\/dau-thau)\/contractor\/([^/]+)/);
    if (contractorMatch) {
      setActiveTab("contractors");
      setContractorSubTab("crm_contractors");
      handleOpenContractorDossier(decodeURIComponent(contractorMatch[1]));
      return;
    }

    // Check for main tab subpaths
    if (pathname.includes("/won-packages") || pathname.includes("/goi-trung")) {
      setActiveTab("contractors");
      setContractorSubTab("won_packages_playbook");
    } else if (pathname.includes("/contractors") || pathname.includes("/nha-thau")) {
      setActiveTab("contractors");
      setContractorSubTab("crm_contractors");
    } else if (pathname.includes("/bookmarks") || pathname.includes("/quan-tam")) {
      setActiveTab("bookmarks");
    } else if (pathname.includes("/watchlists") || pathname.includes("/canh-bao")) {
      setActiveTab("watchlist");
    } else if (pathname.includes("/search") || pathname.includes("/tra-cuu")) {
      setActiveTab("search");
    }
  }, []);

  // Debounced Live Search (300ms) for Contractor Search in Tab 4
  useEffect(() => {
    if (activeTab !== "contractors") return;

    if (!crmScanResult && !contractorSearchQuery.trim()) {
      handleScanCrmContractors();
      return;
    }

    if (prevContractorQueryRef.current !== contractorSearchQuery) {
      prevContractorQueryRef.current = contractorSearchQuery;
      const timer = setTimeout(() => {
        const q = contractorSearchQuery.trim();
        if (q) {
          handleSearchContractorsDirect(q);
        } else {
          handleScanCrmContractors();
        }
      }, 300);

      return () => clearTimeout(timer);
    }
  }, [contractorSearchQuery, activeTab, crmScanResult]);

  // Telegram Sharing Handlers
  const handleShareAiTelegram = (tender: BiddingTenderSummary | null, analysis: BiddingAIAnalysisData) => {
    const fit = analysis.inut_fit_analysis;
    const score = fit?.score ?? analysis.inut_compatibility_score ?? 85;
    const rec = fit?.recommendation || (score >= 80 ? "Nên tham gia độc lập" : "Khuyến nghị liên danh");
    const tgText = [
      `🧠 *[AI BIDDING RADAR]* Cảnh Báo Gói Thầu Tiềm Năng`,
      `📌 *Gói thầu*: ${tender?.tender_name || "—"}`,
      `🏷️ *Mã TBMT*: \`${tender?.tbmt_code || "—"}\``,
      `💰 *Dự toán*: ${formatVnd(tender?.bid_price)}`,
      `⏰ *Hạn nộp*: ${formatDate(tender?.bid_deadline)} (${tender?.province || "Toàn quốc"})`,
      `🎯 *Điểm tương thích INUT*: *${score}/100* (${rec})`,
      `💡 *Đánh giá*: ${analysis.executive_summary || analysis.summary || "Đánh giá chi tiết năng lực dự thầu."}`,
    ].join("\n");

    try {
      if (navigator && navigator.clipboard) {
        navigator.clipboard.writeText(tgText);
      }
    } catch (e) {
      console.warn("Clipboard copy error:", e);
    }
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(tender?.source_url || "https://muasamcong.mpi.gov.vn")}&text=${encodeURIComponent(tgText)}`;
    window.open(shareUrl, "_blank");
    showToast("📨 Đã sao chép nội dung và mở cửa sổ gửi cảnh báo Telegram!", "success");
  };

  const handleShareContractorTelegram = (c: BiddingContractorItem) => {
    const tgText = [
      `🏢 *[TÌNH BÁO NHÀ THẦU]* Hồ Sơ Năng Lực Doanh Nghiệp`,
      `📌 *Doanh nghiệp*: *${c.name}* (MST: \`${c.tax_code}\`)`,
      `🏷️ *Phân loại*: ${c.bidding_status_label}`,
      `📊 *Thống kê*: ${c.total_won}/${c.total_bids} gói (*Win Rate: ${c.win_rate_percent}%*)`,
      `💰 *Tổng giá trị trúng*: *${c.total_won_value_formatted}* (Giảm giá TB: ${c.average_discount_percent > 0 ? `${c.average_discount_percent}%` : "—"})`,
      c.top_procuring_entities && c.top_procuring_entities.length > 0 ? `🏛️ *Chủ đầu tư ruột*: ${c.top_procuring_entities.slice(0, 3).join(", ")}` : "",
      c.ai_insight ? `💡 *AI Insight*: ${c.ai_insight}` : "",
    ].filter(Boolean).join("\n");

    try {
      if (navigator && navigator.clipboard) {
        navigator.clipboard.writeText(tgText);
      }
    } catch (e) {
      console.warn("Clipboard copy error:", e);
    }
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent("https://muasamcong.mpi.gov.vn")}&text=${encodeURIComponent(tgText)}`;
    window.open(shareUrl, "_blank");
    showToast(`📨 Đã sao chép cảnh báo Telegram cho nhà thầu ${c.name}!`, "success");
  };

  // Toast notification feedback
  const [toast, setToast] = useState<{ message: string; type: "success" | "info" | "error" } | null>(null);

  const showToast = (message: string, type: "success" | "info" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // ─── Search Execution ───────────────────────────────────────────────────────
  const handleSearch = async (targetPage = 1) => {
    setSearchLoading(true);
    setSearchError(null);
    try {
      const res = await api.bidding.search({
        keyword: keyword.trim() || undefined,
        province: province && province !== "Tất cả" ? province : undefined,
        field: field || undefined,
        min_price: minPrice !== "" ? Number(minPrice) : null,
        max_price: maxPrice !== "" ? Number(maxPrice) : null,
        method: biddingMethod || undefined,
        status: statusFilter !== "all" ? statusFilter : undefined,
        page: targetPage,
        page_size: pageSize,
      });
      setSearchResult(res);
      setPage(targetPage);
    } catch (e) {
      setSearchError((e as Error).message || "Lỗi khi tra cứu gói thầu");
    } finally {
      setSearchLoading(false);
    }
  };

  // Reset Filters
  const handleResetFilters = () => {
    setKeyword("");
    setProvince("");
    setField("");
    setMinPrice("");
    setMaxPrice("");
    setBiddingMethod("");
    setStatusFilter("all");
    setPage(1);
  };

  // ─── Bookmarks Management ──────────────────────────────────────────────────
  const fetchBookmarks = async () => {
    setBookmarksLoading(true);
    try {
      const res = await api.bidding.listBookmarks();
      const list = Array.isArray(res) ? res : ((res as any)?.items || []);
      setBookmarks(list);
    } catch (e) {
      console.error("Failed to load bookmarks:", e);
    } finally {
      setBookmarksLoading(false);
    }
  };

  const handleUpdateBookmarkStatus = async (
    id: number,
    newStatus: "watching" | "preparing" | "submitted" | "won" | "lost"
  ) => {
    try {
      const updated = await api.bidding.updateBookmark(id, { status: newStatus });
      setBookmarks((prev) => prev.map((b) => (b.id === id ? updated : b)));
      showToast(`Đã chuyển trạng thái sang "${BOOKMARK_STATUS_MAP[newStatus].label}"`, "success");
    } catch (e) {
      showToast((e as Error).message, "error");
    }
  };

  const handleDeleteBookmark = async (id: number, name: string) => {
    if (!window.confirm(`Bạn có chắc muốn xóa gói thầu "${name}" khỏi danh sách theo dõi?`)) {
      return;
    }
    try {
      await api.bidding.deleteBookmark(id);
      setBookmarks((prev) => prev.filter((b) => b.id !== id));
      showToast("Đã xóa gói thầu khỏi danh sách theo dõi", "info");
      // Update search result item bookmark flag if currently viewing
      if (searchResult) {
        setSearchResult({
          ...searchResult,
          items: searchResult.items.map((it) =>
            it.bookmark_id === id ? { ...it, is_bookmarked: false, bookmark_id: null, bookmark_status: null } : it
          ),
        });
      }
    } catch (e) {
      showToast((e as Error).message, "error");
    }
  };

  const handleSaveBookmark = async () => {
    if (!bookmarkModalItem) return;
    try {
      const { tender, status, note, existingId } = bookmarkModalItem;
      if (existingId) {
        const updated = await api.bidding.updateBookmark(existingId, { status, note });
        setBookmarks((prev) => prev.map((b) => (b.id === existingId ? updated : b)));
        showToast("Đã cập nhật thông tin gói thầu quan tâm", "success");
      } else {
        const createPayload: BiddingBookmarkCreate = {
          tbmt_code: tender.tbmt_code,
          tender_name: tender.tender_name,
          procuring_entity: tender.procuring_entity,
          investor: tender.investor,
          field: tender.field,
          bid_price: tender.bid_price,
          bid_deadline: tender.bid_deadline,
          bid_opening_date: tender.bid_opening_date,
          province: tender.province,
          bidding_method: tender.bidding_method,
          source_url: tender.source_url,
          status,
          note,
        };
        const created = await api.bidding.createBookmark(createPayload);
        setBookmarks((prev) => [created, ...prev]);
        showToast("Đã lưu gói thầu vào danh sách quan tâm ⭐", "success");

        // Update search result item bookmark status
        if (searchResult) {
          setSearchResult({
            ...searchResult,
            items: searchResult.items.map((it) =>
              it.tbmt_code === tender.tbmt_code
                ? { ...it, is_bookmarked: true, bookmark_id: created.id, bookmark_status: status }
                : it
            ),
          });
        }
      }
      setBookmarkModalItem(null);
    } catch (e) {
      showToast((e as Error).message, "error");
    }
  };

  // ─── Watchlist Management ──────────────────────────────────────────────────
  const fetchWatchlist = async () => {
    setWatchlistLoading(true);
    try {
      const res = await api.bidding.listWatchlist();
      const list = Array.isArray(res) ? res : ((res as any)?.items || []);
      setWatchlists(list);
    } catch (e) {
      console.error("Failed to load watchlist:", e);
    } finally {
      setWatchlistLoading(false);
    }
  };

  const handleToggleWatchlistActive = async (rule: BiddingWatchlistItem) => {
    try {
      const updated = await api.bidding.updateWatchlist(rule.id, { is_active: !rule.is_active });
      setWatchlists((prev) => prev.map((w) => (w.id === rule.id ? updated : w)));
      showToast(`Đã ${updated.is_active ? "bật" : "tắt"} quét tự động cho "${rule.name}"`, "info");
    } catch (e) {
      showToast((e as Error).message, "error");
    }
  };

  const handleToggleWatchlistTelegram = async (rule: BiddingWatchlistItem) => {
    try {
      const updated = await api.bidding.updateWatchlist(rule.id, { notify_telegram: !rule.notify_telegram });
      setWatchlists((prev) => prev.map((w) => (w.id === rule.id ? updated : w)));
      showToast(`Đã ${updated.notify_telegram ? "bật" : "tắt"} cảnh báo Telegram cho "${rule.name}"`, "info");
    } catch (e) {
      showToast((e as Error).message, "error");
    }
  };

  const handleDeleteWatchlist = async (id: number, name: string) => {
    if (!window.confirm(`Bạn có chắc muốn xóa quy tắc quét "${name}"?`)) return;
    try {
      await api.bidding.deleteWatchlist(id);
      setWatchlists((prev) => prev.filter((w) => w.id !== id));
      showToast("Đã xóa quy tắc quét", "info");
    } catch (e) {
      showToast((e as Error).message, "error");
    }
  };

  const handleScanRule = async (id: number) => {
    setScanningId(id);
    try {
      const res = await api.bidding.scanWatchlist(id);
      const count = res.new_tenders_found ?? res.count_new ?? res.matched_count ?? 0;
      const sent = res.alerts_sent ?? res.new_alerts_sent ?? 0;
      showToast(
        res.message || `Quét thành công! Tìm thấy ${count} gói thầu mới${sent > 0 ? ` (đã gửi ${sent} cảnh báo Telegram)` : ""}`,
        "success"
      );
      fetchWatchlist();
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setScanningId(null);
    }
  };

  const handleScanAll = async () => {
    setScanningId("all");
    try {
      const res = await api.bidding.scanAllWatchlists();
      const count = res.new_tenders_found ?? res.count_new ?? res.matched_count ?? 0;
      const sent = res.alerts_sent ?? res.new_alerts_sent ?? 0;
      showToast(
        res.message || `Quét hoàn tất tất cả bộ lọc! Tìm thấy ${count} gói thầu mới${sent > 0 ? ` (đã gửi ${sent} cảnh báo Telegram)` : ""}`,
        "success"
      );
      fetchWatchlist();
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setScanningId(null);
    }
  };

  const handleSaveWatchlistRule = async () => {
    if (!watchlistModalRule || !watchlistModalRule.name?.trim()) {
      alert("Vui lòng nhập tên quy tắc bộ lọc");
      return;
    }
    try {
      if (watchlistModalRule.id) {
        const updated = await api.bidding.updateWatchlist(watchlistModalRule.id, {
          name: watchlistModalRule.name,
          keyword: watchlistModalRule.keyword || "",
          province: watchlistModalRule.province || "",
          field: watchlistModalRule.field || "",
          min_price: watchlistModalRule.min_price != null ? Number(watchlistModalRule.min_price) : null,
          max_price: watchlistModalRule.max_price != null ? Number(watchlistModalRule.max_price) : null,
          method: watchlistModalRule.method || "",
          notify_telegram: watchlistModalRule.notify_telegram ?? true,
          is_active: watchlistModalRule.is_active ?? true,
        });
        setWatchlists((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
        showToast("Đã cập nhật quy tắc quét", "success");
      } else {
        const createPayload: BiddingWatchlistCreate = {
          name: watchlistModalRule.name,
          keyword: watchlistModalRule.keyword || "",
          province: watchlistModalRule.province || "",
          field: watchlistModalRule.field || "",
          min_price: watchlistModalRule.min_price != null ? Number(watchlistModalRule.min_price) : null,
          max_price: watchlistModalRule.max_price != null ? Number(watchlistModalRule.max_price) : null,
          method: watchlistModalRule.method || "",
          notify_telegram: watchlistModalRule.notify_telegram ?? true,
          is_active: watchlistModalRule.is_active ?? true,
        };
        const created = await api.bidding.createWatchlist(createPayload);
        setWatchlists((prev) => [created, ...prev]);
        showToast("Đã tạo mới quy tắc săn thầu tự động", "success");
      }
      setWatchlistModalRule(null);
    } catch (e) {
      showToast((e as Error).message, "error");
    }
  };

  // ─── AI Analysis ───────────────────────────────────────────────────────────
  const handleOpenAiAnalysis = async (tender: BiddingTenderSummary) => {
    setAiModalTender(tender);
    setAiModalResult(null);
    setAiError(null);
    setAiLoading(true);
    try {
      const res = await api.bidding.analyzeAI(tender.tbmt_code, aiCustomContext);
      setAiModalResult(res);
    } catch (e) {
      setAiError((e as Error).message || "Không thể phân tích AI");
    } finally {
      setAiLoading(false);
    }
  };


  // Helper: Synchronize browser URL with active bidding view / modal
  const syncBiddingUrl = (
    tab: "search" | "bookmarks" | "watchlist" | "contractors",
    subTab: "crm_contractors" | "won_packages_playbook",
    tenderCode: string | null = null,
    tenderTab: "info" | "iframe" | "attachments" | "competitors" = "info",
    contractorTax: string | null = null,
    replace = false,
  ) => {
    let path = "/bidding";
    if (tenderCode) {
      path = `/bidding/tender/${encodeURIComponent(tenderCode)}`;
      if (tenderTab === "attachments") path += "/attachments";
      else if (tenderTab === "competitors") path += "/competitors";
      else if (tenderTab === "iframe") path += "/portal";
    } else if (contractorTax) {
      path = `/bidding/contractor/${encodeURIComponent(contractorTax)}`;
    } else if (tab === "contractors") {
      path = subTab === "won_packages_playbook" ? "/bidding/won-packages" : "/bidding/contractors";
    } else if (tab === "bookmarks") {
      path = "/bidding/bookmarks";
    } else if (tab === "watchlist") {
      path = "/bidding/watchlists";
    } else {
      path = "/bidding/search";
    }

    if (window.location.pathname !== path) {
      if (replace) {
        window.history.replaceState({ biddingPath: path }, "", path);
      } else {
        window.history.pushState({ biddingPath: path }, "", path);
      }
    }
  };


  const handleOpenContractorDossier = async (taxCode: string, skipUrlSync = false) => {
    try {
      const profile = await api.bidding.getContractorProfile(taxCode);
      if (profile) {
        setSelectedContractorDetail(profile as any);
        if (!skipUrlSync) {
          syncBiddingUrl(activeTab, contractorSubTab, null, "info", taxCode);
        }
      }
    } catch (e) {
      showToast((e as Error).message || "Không thể tải hồ sơ nhà thầu", "error");
    }
  };

  const handleOpenTenderDetail = async (
    tbmtCode: string,
    initialTab: "info" | "iframe" | "attachments" | "competitors" = "info",
    skipUrlSync = false,
  ) => {
    setDetailModalLoading(true);
    setDetailModalTender(null);
    setDetailModalTab(initialTab);
    if (!skipUrlSync) {
      syncBiddingUrl(activeTab, contractorSubTab, tbmtCode, initialTab);
    }
    try {
      const [detail, atts, comps] = await Promise.all([
        api.bidding.getTender(tbmtCode),
        api.bidding.getAttachments(tbmtCode).catch(() => []),
        api.bidding.getCompetitors(tbmtCode).catch(() => []),
      ]);
      setDetailModalTender(detail);
      setModalAttachments(atts);
      setModalCompetitors(comps);
    } catch (e) {
      showToast((e as Error).message || "Không thể tải chi tiết gói thầu", "error");
    } finally {
      setDetailModalLoading(false);
    }
  };

  const handleOpenExternalPortal = (tbmtCode: string, sourceUrl?: string) => {
    try {
      if (navigator && navigator.clipboard) {
        navigator.clipboard.writeText(tbmtCode);
      }
    } catch (err) {
      console.warn("Clipboard copy:", err);
    }
    showToast(
      `📋 Đã tự động sao chép mã ${tbmtCode} vào Clipboard! Bạn chỉ cần Paste (Ctrl+V) vào ô tìm kiếm trên Cổng Mua Sắm Công.`,
      "success"
    );
    window.open(sourceUrl || "https://muasamcong.mpi.gov.vn/web/guest/contractor-selection", "_blank");
  };


  // Initial Data Load
  useEffect(() => {
    handleSearch(1);
    fetchBookmarks();
    fetchWatchlist();
  }, []);

  // Filtered Bookmarks List
  const filteredBookmarks = useMemo(() => {
    return bookmarks.filter((b) => {
      const matchStatus = bookmarkPipelineFilter === "all" || b.status === bookmarkPipelineFilter;
      const q = bookmarkSearchKeyword.trim().toLowerCase();
      const matchText =
        !q ||
        b.tender_name.toLowerCase().includes(q) ||
        b.tbmt_code.toLowerCase().includes(q) ||
        b.procuring_entity.toLowerCase().includes(q) ||
        b.province.toLowerCase().includes(q);
      return matchStatus && matchText;
    });
  }, [bookmarks, bookmarkPipelineFilter, bookmarkSearchKeyword]);

  // Price range quick presets for search
  const handleSetPricePreset = (min: number | "", max: number | "") => {
    setMinPrice(min);
    setMaxPrice(max);
  };

  return (
    <div className="bidding-page ops-page" style={{ paddingBottom: "70px" }}>
      {/* Toast Notification */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            zIndex: 9999,
            padding: "14px 20px",
            borderRadius: "14px",
            color: "#fff",
            background: toast.type === "success" ? "#168579" : toast.type === "error" ? "#c53929" : "#173c35",
            boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontSize: "14px",
            fontWeight: 600,
            animation: "fadeIn 0.2s ease",
          }}
        >
          <span>{toast.type === "success" ? "✓" : toast.type === "error" ? "⚠️" : "ℹ️"}</span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* ─── Hero Section ──────────────────────────────────────────────────────── */}
      <section className="ops-hero" style={{ marginBottom: "20px" }}>
        <div>
          <span className="eyebrow" style={{ color: "#79cbb5", fontSize: "11px", letterSpacing: ".18em", fontWeight: 900 }}>
            MẠNG ĐẤU THẦU QUỐC GIA (E-GP) — MUASAMCONG.MPI.GOV.VN
          </span>
          <h1 style={{ fontFamily: "Georgia, serif", margin: "6px 0 10px", fontSize: "clamp(26px, 3.5vw, 42px)" }}>
            Săn Gói Thầu & Phân Tích E-HSMT Bằng AI
          </h1>
          <p style={{ maxWidth: "780px", color: "#bcd0ca", fontSize: "14px", lineHeight: 1.6 }}>
            Hệ thống tự động quét, trích xuất dữ liệu năng lực, tính điểm tương thích chiến lược INUT{" "}
            <strong style={{ color: "#f2bd62" }}>(MST 4401053694)</strong> và gửi cảnh báo thời gian thực qua Telegram Bot.
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", zIndex: 1 }}>
          <button
            className="btn"
            onClick={handleScanAll}
            disabled={scanningId !== null}
            style={{
              background: "linear-gradient(135deg, #e89c3e, #d88e2f)",
              color: "#17342f",
              border: "0",
              fontWeight: 800,
              padding: "11px 18px",
              borderRadius: "12px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              boxShadow: "0 6px 18px rgba(216,142,47,0.3)",
              cursor: "pointer",
            }}
          >
            <span>{scanningId === "all" ? "⏳ Đang quét..." : "⚡ Quét Tự Động Ngay"}</span>
          </button>
        </div>
      </section>

      {/* ─── Main Navigation Tabs ──────────────────────────────────────────────── */}
      <div
        className="portal-tabs"
        style={{
          display: "flex",
          gap: "8px",
          borderBottom: "1px solid #dce4e0",
          marginBottom: "20px",
          overflowX: "auto",
          paddingBottom: "2px",
        }}
      >
        <button
          className={activeTab === "search" ? "active" : ""}
          onClick={() => { setActiveTab("search"); syncBiddingUrl("search", contractorSubTab); }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "7px",
            fontSize: "14px",
            fontWeight: activeTab === "search" ? 800 : 600,
            padding: "12px 18px",
            borderRadius: "12px 12px 0 0",
            border: "0",
            background: activeTab === "search" ? "#fff" : "transparent",
            color: activeTab === "search" ? "#168579" : "#5a6e67",
            boxShadow: activeTab === "search" ? "0 -2px 10px rgba(0,0,0,0.04)" : "none",
            cursor: "pointer",
          }}
        >
          <span>🔎</span> Tra Cứu Gói Thầu
          {searchResult && <span className="chip gray sm" style={{ marginLeft: "4px" }}>{searchResult.total}</span>}
        </button>

        <button
          className={activeTab === "bookmarks" ? "active" : ""}
          onClick={() => {
            setActiveTab("bookmarks");
            syncBiddingUrl("bookmarks", contractorSubTab);
            fetchBookmarks();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "7px",
            fontSize: "14px",
            fontWeight: activeTab === "bookmarks" ? 800 : 600,
            padding: "12px 18px",
            borderRadius: "12px 12px 0 0",
            border: "0",
            background: activeTab === "bookmarks" ? "#fff" : "transparent",
            color: activeTab === "bookmarks" ? "#168579" : "#5a6e67",
            boxShadow: activeTab === "bookmarks" ? "0 -2px 10px rgba(0,0,0,0.04)" : "none",
            cursor: "pointer",
          }}
        >
          <span>⭐</span> Gói Thầu Quan Tâm
          <span
            className="chip amber sm"
            style={{ marginLeft: "4px", background: "#fef3c7", color: "#92400e", fontWeight: 800 }}
          >
            {bookmarks.length}
          </span>
        </button>

        <button
          className={activeTab === "contractors" ? "active" : ""}
          onClick={() => {
            setActiveTab("contractors");
            syncBiddingUrl("contractors", contractorSubTab);
            if (!crmScanResult) handleScanCrmContractors();
            if (!wonPackagesResult) handleFetchWonPackages();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "7px",
            fontSize: "14px",
            fontWeight: activeTab === "contractors" ? 800 : 600,
            padding: "12px 18px",
            borderRadius: "12px 12px 0 0",
            border: "0",
            background: activeTab === "contractors" ? "#fff" : "transparent",
            color: activeTab === "contractors" ? "#168579" : "#5a6e67",
            boxShadow: activeTab === "contractors" ? "0 -2px 10px rgba(0,0,0,0.04)" : "none",
            cursor: "pointer",
          }}
        >
          <span>🏢</span> Năng Lực Nhà Thầu & Khách Hàng CRM
          <span
            className="chip sm"
            style={{ marginLeft: "4px", background: "#ea580c", color: "#fff", fontWeight: 800 }}
          >
            {crmScanResult ? crmScanResult.total_won_contractors : "CRM"}
          </span>
        </button>

        <button
          className={activeTab === "watchlist" ? "active" : ""}
          onClick={() => {
            setActiveTab("watchlist");
            syncBiddingUrl("watchlist", contractorSubTab);
            fetchWatchlist();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "7px",
            fontSize: "14px",
            fontWeight: activeTab === "watchlist" ? 800 : 600,
            padding: "12px 18px",
            borderRadius: "12px 12px 0 0",
            border: "0",
            background: activeTab === "watchlist" ? "#fff" : "transparent",
            color: activeTab === "watchlist" ? "#168579" : "#5a6e67",
            boxShadow: activeTab === "watchlist" ? "0 -2px 10px rgba(0,0,0,0.04)" : "none",
            cursor: "pointer",
          }}
        >
          <span>⚙️</span> Bộ Lọc Tự Động & Cảnh Báo
          <span className="chip indigo sm" style={{ marginLeft: "4px" }}>{watchlists.length}</span>
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB 1: 🔎 TRA CỨU GÓI THẦU (SEARCH & DISCOVERY)                         */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "search" && (
        <div>
          {/* Search Box Panel */}
          <div
            className="panel"
            style={{
              background: "#fff",
              borderRadius: "18px",
              padding: "20px 24px",
              border: "1px solid #dce4df",
              boxShadow: "0 8px 24px rgba(22,133,121,0.05)",
              marginBottom: "20px",
            }}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSearch(1);
              }}
            >
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ flex: "1 1 320px", position: "relative" }}>
                  <input
                    type="text"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="Nhập tên gói thầu, số TBMT (VD: IB2600...), bên mời thầu, từ khóa IoT / SCADA..."
                    style={{
                      width: "100%",
                      padding: "13px 16px",
                      borderRadius: "12px",
                      border: "1px solid #c8dbd3",
                      fontSize: "16px", // >=16px for iOS auto-zoom prevention
                      outline: "none",
                      boxShadow: "inset 0 1px 3px rgba(0,0,0,0.04)",
                    }}
                  />
                </div>

                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button
                    type="submit"
                    disabled={searchLoading}
                    style={{
                      padding: "13px 24px",
                      borderRadius: "12px",
                      background: "#168579",
                      color: "#fff",
                      border: "0",
                      fontWeight: 800,
                      fontSize: "14px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span>{searchLoading ? "⏳" : "🔎"}</span>
                    <span>{searchLoading ? "Đang tìm..." : "Tìm kiếm"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                    style={{
                      padding: "13px 16px",
                      borderRadius: "12px",
                      background: showAdvancedFilters ? "#eaf4f1" : "#f5f8f7",
                      color: showAdvancedFilters ? "#168579" : "#476159",
                      border: "1px solid #d0dfd8",
                      fontWeight: 700,
                      fontSize: "13px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span>⚙️</span>
                    <span>Bộ lọc {showAdvancedFilters ? "▲" : "▼"}</span>
                  </button>

                  {(keyword || province || field || minPrice !== "" || maxPrice !== "" || biddingMethod || statusFilter !== "all") && (
                    <button
                      type="button"
                      onClick={handleResetFilters}
                      style={{
                        padding: "13px 14px",
                        borderRadius: "12px",
                        background: "transparent",
                        color: "#963c2d",
                        border: "1px solid #f1c8bf",
                        fontSize: "13px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Xóa lọc
                    </button>
                  )}
                </div>
              </div>

              {/* Advanced Filters Expandable Grid */}
              {showAdvancedFilters && (
                <div
                  style={{
                    marginTop: "18px",
                    paddingTop: "18px",
                    borderTop: "1px dashed #dce4df",
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                    gap: "14px",
                  }}
                >
                  {/* Province */}
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 800, color: "#168579", marginBottom: "5px" }}>
                      📍 TỈNH / THÀNH PHỐ
                    </label>
                    <select
                      value={province}
                      onChange={(e) => setProvince(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: "10px",
                        border: "1px solid #c8dbd3",
                        fontSize: "16px",
                        background: "#fff",
                      }}
                    >
                      {PROVINCES.map((p) => (
                        <option key={p} value={p === "Tất cả" ? "" : p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Field */}
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 800, color: "#168579", marginBottom: "5px" }}>
                      📂 LĨNH VỰC
                    </label>
                    <select
                      value={field}
                      onChange={(e) => setField(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: "10px",
                        border: "1px solid #c8dbd3",
                        fontSize: "16px",
                        background: "#fff",
                      }}
                    >
                      {FIELDS.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Status */}
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 800, color: "#168579", marginBottom: "5px" }}>
                      ⏳ TRẠNG THÁI MỞ / ĐÓNG THẦU
                    </label>
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value as any)}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: "10px",
                        border: "1px solid #c8dbd3",
                        fontSize: "16px",
                        background: "#fff",
                      }}
                    >
                      <option value="all">Tất cả trạng thái</option>
                      <option value="open">Đang mở thầu (Còn hạn)</option>
                      <option value="closed">Đã đóng thầu</option>
                    </select>
                  </div>

                  {/* Price Presets & Range */}
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 800, color: "#168579", marginBottom: "6px" }}>
                      💰 KHOẢNG GIÁ GÓI THẦU (VND)
                    </label>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => handleSetPricePreset(0, 500_000_000)}
                          style={{
                            padding: "6px 12px",
                            borderRadius: "999px",
                            fontSize: "11px",
                            fontWeight: 700,
                            border: "1px solid #c8dbd3",
                            background: minPrice === 0 && maxPrice === 500_000_000 ? "#168579" : "#fff",
                            color: minPrice === 0 && maxPrice === 500_000_000 ? "#fff" : "#33554d",
                            cursor: "pointer",
                          }}
                        >
                          &lt; 500 Triệu
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSetPricePreset(500_000_000, 2_000_000_000)}
                          style={{
                            padding: "6px 12px",
                            borderRadius: "999px",
                            fontSize: "11px",
                            fontWeight: 700,
                            border: "1px solid #c8dbd3",
                            background: minPrice === 500_000_000 && maxPrice === 2_000_000_000 ? "#168579" : "#fff",
                            color: minPrice === 500_000_000 && maxPrice === 2_000_000_000 ? "#fff" : "#33554d",
                            cursor: "pointer",
                          }}
                        >
                          500 Tr – 2 Tỷ
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSetPricePreset(2_000_000_000, 10_000_000_000)}
                          style={{
                            padding: "6px 12px",
                            borderRadius: "999px",
                            fontSize: "11px",
                            fontWeight: 700,
                            border: "1px solid #c8dbd3",
                            background: minPrice === 2_000_000_000 && maxPrice === 10_000_000_000 ? "#168579" : "#fff",
                            color: minPrice === 2_000_000_000 && maxPrice === 10_000_000_000 ? "#fff" : "#33554d",
                            cursor: "pointer",
                          }}
                        >
                          2 Tỷ – 10 Tỷ
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSetPricePreset(10_000_000_000, "")}
                          style={{
                            padding: "6px 12px",
                            borderRadius: "999px",
                            fontSize: "11px",
                            fontWeight: 700,
                            border: "1px solid #c8dbd3",
                            background: minPrice === 10_000_000_000 && maxPrice === "" ? "#168579" : "#fff",
                            color: minPrice === 10_000_000_000 && maxPrice === "" ? "#fff" : "#33554d",
                            cursor: "pointer",
                          }}
                        >
                          &gt; 10 Tỷ (Liên danh)
                        </button>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: "auto" }}>
                        <input
                          type="number"
                          value={minPrice}
                          onChange={(e) => setMinPrice(e.target.value ? Number(e.target.value) : "")}
                          placeholder="Giá từ (VND)"
                          style={{
                            width: "140px",
                            padding: "8px 10px",
                            borderRadius: "8px",
                            border: "1px solid #c8dbd3",
                            fontSize: "16px",
                          }}
                        />
                        <span>–</span>
                        <input
                          type="number"
                          value={maxPrice}
                          onChange={(e) => setMaxPrice(e.target.value ? Number(e.target.value) : "")}
                          placeholder="Đến (VND)"
                          style={{
                            width: "140px",
                            padding: "8px 10px",
                            borderRadius: "8px",
                            border: "1px solid #c8dbd3",
                            fontSize: "16px",
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </form>
          </div>

          {/* Search Meta & Count */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "14px",
              flexWrap: "wrap",
              gap: "8px",
            }}
          >
            <div style={{ fontSize: "14px", color: "#475e56" }}>
              {searchLoading ? (
                <span>⏳ Đang kết nối Mạng Đấu Thầu Quốc Gia...</span>
              ) : searchResult ? (
                <span>
                  Tìm thấy <strong style={{ color: "#168579" }}>{searchResult.total}</strong> gói thầu phù hợp
                  {searchResult.is_mock && (
                    <span
                      style={{
                        marginLeft: "8px",
                        padding: "2px 8px",
                        borderRadius: "999px",
                        fontSize: "11px",
                        background: "#fff3cd",
                        color: "#856404",
                        border: "1px solid #ffeeba",
                      }}
                    >
                      🧪 Smart Resilient Mock
                    </span>
                  )}
                </span>
              ) : null}
            </div>

            {searchResult && searchResult.total_pages > 1 && (
              <div style={{ fontSize: "12px", color: "#6a7d77" }}>
                Trang {searchResult.page} / {searchResult.total_pages}
              </div>
            )}
          </div>

          {/* Error Banner */}
          {searchError && (
            <div
              style={{
                padding: "16px 20px",
                borderRadius: "14px",
                background: "#fdf2f2",
                border: "1px solid #f8b4b4",
                color: "#9b1c1c",
                marginBottom: "20px",
              }}
            >
              <strong>Lỗi tra cứu:</strong> {searchError}
            </div>
          )}

          {/* Loading Skeletons */}
          {searchLoading && (
            <div style={{ display: "grid", gap: "16px" }}>
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  style={{
                    padding: "24px",
                    borderRadius: "16px",
                    background: "#fff",
                    border: "1px solid #e2e8e5",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.03)",
                  }}
                >
                  <div style={{ height: "20px", width: "40%", background: "#edf2ef", borderRadius: "4px", marginBottom: "12px" }} />
                  <div style={{ height: "28px", width: "80%", background: "#edf2ef", borderRadius: "4px", marginBottom: "16px" }} />
                  <div style={{ height: "16px", width: "60%", background: "#edf2ef", borderRadius: "4px" }} />
                </div>
              ))}
            </div>
          )}

          {/* Empty Results */}
          {!searchLoading && searchResult && searchResult.items.length === 0 && (
            <div
              style={{
                padding: "48px 24px",
                textAlign: "center",
                background: "#fff",
                borderRadius: "20px",
                border: "1px dashed #cdded7",
                color: "#6c7d77",
              }}
            >
              <div style={{ fontSize: "42px", marginBottom: "10px" }}>🏛️</div>
              <h3 style={{ fontFamily: "Georgia, serif", color: "#173c35", margin: "0 0 8px" }}>
                Không tìm thấy gói thầu phù hợp
              </h3>
              <p style={{ maxWidth: "480px", margin: "0 auto 16px", fontSize: "13px" }}>
                Hãy thử mở rộng tiêu chí tìm kiếm, xóa bớt bộ lọc khoảng giá hoặc thử các từ khóa chuyên ngành như "SCADA", "IoT", "quan trắc", "tủ điện".
              </p>
              <button
                className="btn"
                onClick={handleResetFilters}
                style={{
                  background: "#168579",
                  color: "#fff",
                  padding: "9px 18px",
                  borderRadius: "10px",
                  fontWeight: 700,
                }}
              >
                Đặt lại bộ lọc
              </button>
            </div>
          )}

          {/* Tender Cards Grid */}
          {!searchLoading && searchResult && searchResult.items.length > 0 && (
            <div style={{ display: "grid", gap: "16px" }}>
              {searchResult.items.map((item) => {
                const deadlineMeta = getDeadlineMeta(item.bid_deadline);
                const fieldBadge = getFieldBadge(item.field);
                const isBookmarked = item.is_bookmarked || bookmarks.some((b) => b.tbmt_code === item.tbmt_code);

                return (
                  <div
                    key={item.tbmt_code}
                    style={{
                      background: "#fff",
                      borderRadius: "18px",
                      padding: "22px 24px",
                      border: "1px solid #dce4df",
                      boxShadow: "0 4px 18px rgba(16,45,43,0.04)",
                      transition: "transform 0.15s ease, box-shadow 0.15s ease",
                      position: "relative",
                    }}
                  >
                    {/* Top Row: TBMT Code, Field Badge, Deadline Badge */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "8px",
                        marginBottom: "10px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <span
                          style={{
                            fontFamily: "var(--font-mono, monospace)",
                            fontSize: "12px",
                            fontWeight: 800,
                            padding: "4px 9px",
                            borderRadius: "7px",
                            background: "#eaf4f1",
                            color: "#168579",
                            letterSpacing: ".04em",
                          }}
                        >
                          🏷️ {item.tbmt_code}
                        </span>

                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 800,
                            padding: "4px 9px",
                            borderRadius: "7px",
                            background: fieldBadge.bg,
                            color: fieldBadge.color,
                          }}
                        >
                          {fieldBadge.label}
                        </span>

                        {item.province && (
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 700,
                              padding: "4px 8px",
                              borderRadius: "7px",
                              background: "#f0f4f8",
                              color: "#334e68",
                            }}
                          >
                            📍 {item.province}
                          </span>
                        )}
                      </div>

                      {/* Deadline Badge */}
                      <div>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 800,
                            padding: "4px 10px",
                            borderRadius: "999px",
                            background:
                              deadlineMeta.status === "closed"
                                ? "#fbe1da"
                                : deadlineMeta.status === "urgent"
                                ? "#fff0ce"
                                : "#dff3e9",
                            color:
                              deadlineMeta.status === "closed"
                                ? "#9e3e2f"
                                : deadlineMeta.status === "urgent"
                                ? "#8a6417"
                                : "#176448",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                          }}
                        >
                          <span>{deadlineMeta.status === "closed" ? "🔴" : deadlineMeta.status === "urgent" ? "🟠" : "🟢"}</span>
                          <span>{deadlineMeta.label}</span>
                        </span>
                      </div>
                    </div>

                    {/* Title */}
                    <h3
                      onClick={() => handleOpenTenderDetail(item.tbmt_code)}
                      style={{
                        fontFamily: "Georgia, serif",
                        fontSize: "18px",
                        fontWeight: 600,
                        color: "#123b36",
                        margin: "0 0 12px",
                        lineHeight: 1.4,
                        cursor: "pointer",
                      }}
                      title="Bấm xem chi tiết gói thầu"
                    >
                      {item.tender_name}
                    </h3>

                    {/* Meta Grid */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                        gap: "8px 18px",
                        padding: "14px 16px",
                        borderRadius: "12px",
                        background: "#f9fcfa",
                        border: "1px solid #e7f0ec",
                        marginBottom: "16px",
                        fontSize: "13px",
                      }}
                    >
                      <div>
                        <span style={{ color: "#71857f", fontSize: "11px", display: "block", fontWeight: 700 }}>
                          🏢 BÊN MỜI THẦU
                        </span>
                        <strong style={{ color: "#22443c" }}>{item.procuring_entity || "—"}</strong>
                      </div>

                      {item.investor && (
                        <div>
                          <span style={{ color: "#71857f", fontSize: "11px", display: "block", fontWeight: 700 }}>
                            🏛️ CHỦ ĐẦU TƯ
                          </span>
                          <span style={{ color: "#36574f" }}>{item.investor}</span>
                        </div>
                      )}

                      <div>
                        <span style={{ color: "#71857f", fontSize: "11px", display: "block", fontWeight: 700 }}>
                          💰 GIÁ GÓI THẦU (DỰ TOÁN)
                        </span>
                        <strong
                          style={{
                            color: "#168579",
                            fontSize: "16px",
                            fontFamily: "Georgia, serif",
                            fontWeight: 700,
                          }}
                        >
                          {formatVnd(item.bid_price)}
                        </strong>
                      </div>

                      <div>
                        <span style={{ color: "#71857f", fontSize: "11px", display: "block", fontWeight: 700 }}>
                          ⏳ THỜI ĐIỂM ĐÓNG THẦU
                        </span>
                        <span style={{ color: "#22443c", fontWeight: 600 }}>{formatDate(item.bid_deadline)}</span>
                      </div>
                    </div>

                    {/* Actions Bar */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "10px",
                        paddingTop: "6px",
                      }}
                    >
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        {/* Bookmark Button */}
                        <button
                          onClick={() => {
                            const existing = bookmarks.find((b) => b.tbmt_code === item.tbmt_code);
                            setBookmarkModalItem({
                              tender: item,
                              status: existing?.status || "watching",
                              note: existing?.note || "",
                              existingId: existing?.id,
                            });
                          }}
                          style={{
                            padding: "9px 14px",
                            borderRadius: "10px",
                            fontSize: "12px",
                            fontWeight: 750,
                            border: "1px solid #d4dfda",
                            background: isBookmarked ? "#fff8e8" : "#fff",
                            color: isBookmarked ? "#925f17" : "#245247",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "5px",
                          }}
                        >
                          <span>{isBookmarked ? "⭐" : "☆"}</span>
                          <span>{isBookmarked ? "Đang theo dõi" : "Lưu theo dõi"}</span>
                        </button>

                        {/* AI Analyze Button */}
                        <button
                          onClick={() => handleOpenAiAnalysis(item)}
                          style={{
                            padding: "9px 15px",
                            borderRadius: "10px",
                            fontSize: "12px",
                            fontWeight: 800,
                            border: "1px solid #b8dfd4",
                            background: "linear-gradient(110deg, #e9f7f2, #fff9ed)",
                            color: "#146c59",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            boxShadow: "0 2px 8px rgba(22,133,121,0.08)",
                          }}
                        >
                          <span>🧠</span>
                          <span>AI Phân tích</span>
                        </button>

                        {/* Details Button */}
                        <button
                          onClick={() => handleOpenTenderDetail(item.tbmt_code)}
                          style={{
                            padding: "9px 13px",
                            borderRadius: "10px",
                            fontSize: "12px",
                            fontWeight: 700,
                            border: "1px solid #d4dfda",
                            background: "#fff",
                            color: "#3a564e",
                            cursor: "pointer",
                          }}
                        >
                          👁️ Chi tiết
                        </button>
                      </div>

                      {/* Source Link */}
                      <div>
                        <button
                          type="button"
                          onClick={() => handleOpenExternalPortal(item.tbmt_code, item.source_url)}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                            fontSize: "12px",
                            fontWeight: 700,
                            color: "#168579",
                            border: "1px solid #c9e4db",
                            padding: "8px 12px",
                            borderRadius: "8px",
                            background: "#f0f8f5",
                            cursor: "pointer",
                          }}
                          title="Tự động sao chép mã TBMT và mở Cổng Mua Sắm Công"
                        >
                          <span>🔗 Xem trên Mua Sắm Công</span>
                          <span>↗</span>
                        </button>
                      </div>

                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination Controls */}
          {!searchLoading && searchResult && searchResult.total_pages > 1 && (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: "8px",
                marginTop: "24px",
                flexWrap: "wrap",
              }}
            >
              <button
                disabled={page <= 1}
                onClick={() => handleSearch(1)}
                style={{
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: "1px solid #c8dbd3",
                  background: "#fff",
                  cursor: page <= 1 ? "not-allowed" : "pointer",
                  opacity: page <= 1 ? 0.5 : 1,
                  fontWeight: 700,
                  fontSize: "12px",
                }}
              >
                « Đầu
              </button>

              <button
                disabled={page <= 1}
                onClick={() => handleSearch(page - 1)}
                style={{
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: "1px solid #c8dbd3",
                  background: "#fff",
                  cursor: page <= 1 ? "not-allowed" : "pointer",
                  opacity: page <= 1 ? 0.5 : 1,
                  fontWeight: 700,
                  fontSize: "12px",
                }}
              >
                ‹ Trước
              </button>

              <span style={{ fontSize: "13px", fontWeight: 700, color: "#168579", padding: "0 8px" }}>
                Trang {page} / {searchResult.total_pages}
              </span>

              <button
                disabled={page >= searchResult.total_pages}
                onClick={() => handleSearch(page + 1)}
                style={{
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: "1px solid #c8dbd3",
                  background: "#fff",
                  cursor: page >= searchResult.total_pages ? "not-allowed" : "pointer",
                  opacity: page >= searchResult.total_pages ? 0.5 : 1,
                  fontWeight: 700,
                  fontSize: "12px",
                }}
              >
                Sau ›
              </button>

              <button
                disabled={page >= searchResult.total_pages}
                onClick={() => handleSearch(searchResult.total_pages)}
                style={{
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: "1px solid #c8dbd3",
                  background: "#fff",
                  cursor: page >= searchResult.total_pages ? "not-allowed" : "pointer",
                  opacity: page >= searchResult.total_pages ? 0.5 : 1,
                  fontWeight: 700,
                  fontSize: "12px",
                }}
              >
                Cuối »
              </button>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB 2: ⭐ GÓI THẦU QUAN TÂM (OPPORTUNITY PIPELINE)                         */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "bookmarks" && (
        <div>
          {/* Pipeline Status Filter Bar */}
          <div
            style={{
              display: "flex",
              gap: "8px",
              flexWrap: "wrap",
              marginBottom: "18px",
              alignItems: "center",
            }}
          >
            <button
              onClick={() => setBookmarkPipelineFilter("all")}
              style={{
                padding: "8px 14px",
                borderRadius: "999px",
                fontSize: "12px",
                fontWeight: 800,
                border: "1px solid",
                borderColor: bookmarkPipelineFilter === "all" ? "#168579" : "#ccdcd5",
                background: bookmarkPipelineFilter === "all" ? "#168579" : "#fff",
                color: bookmarkPipelineFilter === "all" ? "#fff" : "#37544c",
                cursor: "pointer",
              }}
            >
              Tất cả ({bookmarks.length})
            </button>

            {Object.entries(BOOKMARK_STATUS_MAP).map(([stKey, stMeta]) => {
              const count = bookmarks.filter((b) => b.status === stKey).length;
              const isActive = bookmarkPipelineFilter === stKey;
              return (
                <button
                  key={stKey}
                  onClick={() => setBookmarkPipelineFilter(stKey)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: "999px",
                    fontSize: "12px",
                    fontWeight: 800,
                    border: "1px solid",
                    borderColor: isActive ? "#168579" : "#ccdcd5",
                    background: isActive ? "#168579" : "#fff",
                    color: isActive ? "#fff" : "#37544c",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                  }}
                >
                  <span>{stMeta.icon}</span>
                  <span>{stMeta.label}</span>
                  <span
                    style={{
                      padding: "1px 6px",
                      borderRadius: "999px",
                      fontSize: "10px",
                      background: isActive ? "rgba(255,255,255,0.2)" : "#edf2ef",
                    }}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Quick Search within Bookmarks */}
          <div style={{ marginBottom: "18px" }}>
            <input
              type="text"
              value={bookmarkSearchKeyword}
              onChange={(e) => setBookmarkSearchKeyword(e.target.value)}
              placeholder="🔍 Tìm nhanh trong danh sách quan tâm (tên gói thầu, mã TBMT, bên mời thầu)..."
              style={{
                width: "100%",
                padding: "11px 16px",
                borderRadius: "12px",
                border: "1px solid #c8dbd3",
                fontSize: "16px",
                background: "#fff",
              }}
            />
          </div>

          {/* Bookmarks Loading / Empty */}
          {bookmarksLoading && (
            <div style={{ textAlign: "center", padding: "40px", color: "#60756e" }}>
              ⏳ Đang tải danh sách cơ hội dự thầu...
            </div>
          )}

          {!bookmarksLoading && filteredBookmarks.length === 0 && (
            <div
              style={{
                padding: "48px 24px",
                textAlign: "center",
                background: "#fff",
                borderRadius: "20px",
                border: "1px dashed #cdded7",
                color: "#6c7d77",
              }}
            >
              <div style={{ fontSize: "40px", marginBottom: "8px" }}>⭐</div>
              <h3 style={{ fontFamily: "Georgia, serif", color: "#173c35", margin: "0 0 8px" }}>
                Chưa có gói thầu nào trong danh sách này
              </h3>
              <p style={{ maxWidth: "440px", margin: "0 auto 16px", fontSize: "13px" }}>
                Hãy chuyển sang tab <strong>🔎 Tra Cứu Gói Thầu</strong> và bấm nút "⭐ Lưu theo dõi" để thêm các gói thầu tiềm năng vào pipeline theo dõi.
              </p>
              <button
                className="btn"
                onClick={() => { setActiveTab("search"); syncBiddingUrl("search", contractorSubTab); }}
                style={{
                  background: "#168579",
                  color: "#fff",
                  padding: "9px 18px",
                  borderRadius: "10px",
                  fontWeight: 700,
                }}
              >
                🔎 Khám phá gói thầu ngay
              </button>
            </div>
          )}

          {/* Bookmarks Cards Grid */}
          {!bookmarksLoading && filteredBookmarks.length > 0 && (
            <div style={{ display: "grid", gap: "16px" }}>
              {filteredBookmarks.map((b) => {
                const deadlineMeta = getDeadlineMeta(b.bid_deadline);
                const fieldBadge = getFieldBadge(b.field);
                const statusMeta = BOOKMARK_STATUS_MAP[b.status] || BOOKMARK_STATUS_MAP.watching;

                return (
                  <div
                    key={b.id}
                    style={{
                      background: "#fff",
                      borderRadius: "18px",
                      padding: "22px 24px",
                      border: "1px solid #dce4df",
                      boxShadow: "0 4px 18px rgba(16,45,43,0.04)",
                    }}
                  >
                    {/* Header */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "8px",
                        marginBottom: "10px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <span
                          style={{
                            fontFamily: "var(--font-mono, monospace)",
                            fontSize: "12px",
                            fontWeight: 800,
                            padding: "4px 8px",
                            borderRadius: "7px",
                            background: "#eaf4f1",
                            color: "#168579",
                          }}
                        >
                          🏷️ {b.tbmt_code}
                        </span>

                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 800,
                            padding: "4px 8px",
                            borderRadius: "7px",
                            background: fieldBadge.bg,
                            color: fieldBadge.color,
                          }}
                        >
                          {fieldBadge.label}
                        </span>

                        {b.province && (
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 700,
                              padding: "4px 8px",
                              borderRadius: "7px",
                              background: "#f0f4f8",
                              color: "#334e68",
                            }}
                          >
                            📍 {b.province}
                          </span>
                        )}
                      </div>

                      {/* Status Selector Dropdown */}
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <label style={{ fontSize: "11px", fontWeight: 700, color: "#6a7d77" }}>Pipeline:</label>
                        <select
                          value={b.status}
                          onChange={(e) => handleUpdateBookmarkStatus(b.id, e.target.value as any)}
                          style={{
                            padding: "6px 10px",
                            borderRadius: "8px",
                            fontSize: "13px",
                            fontWeight: 800,
                            border: "1px solid #c8dbd3",
                            background: "#fff",
                            color:
                              b.status === "won"
                                ? "#176448"
                                : b.status === "lost"
                                ? "#9e3e2f"
                                : b.status === "submitted"
                                ? "#5b21b6"
                                : b.status === "preparing"
                                ? "#1e40af"
                                : "#854d0e",
                          }}
                        >
                          {Object.entries(BOOKMARK_STATUS_MAP).map(([sKey, sMeta]) => (
                            <option key={sKey} value={sKey}>
                              {sMeta.icon} {sMeta.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Tender Title */}
                    <h3
                      onClick={() => handleOpenTenderDetail(b.tbmt_code)}
                      style={{
                        fontFamily: "Georgia, serif",
                        fontSize: "18px",
                        fontWeight: 600,
                        color: "#123b36",
                        margin: "0 0 10px",
                        cursor: "pointer",
                      }}
                    >
                      {b.tender_name}
                    </h3>

                    {/* Metadata Strip */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                        gap: "8px 16px",
                        padding: "12px 14px",
                        borderRadius: "10px",
                        background: "#f9fcfa",
                        border: "1px solid #e7f0ec",
                        marginBottom: "12px",
                        fontSize: "12px",
                      }}
                    >
                      <div>
                        <span style={{ color: "#71857f", display: "block" }}>🏢 Bên mời thầu:</span>
                        <strong style={{ color: "#22443c" }}>{b.procuring_entity || "—"}</strong>
                      </div>
                      <div>
                        <span style={{ color: "#71857f", display: "block" }}>💰 Giá gói thầu:</span>
                        <strong style={{ color: "#168579", fontSize: "15px", fontFamily: "Georgia, serif" }}>
                          {formatVnd(b.bid_price)}
                        </strong>
                      </div>
                      <div>
                        <span style={{ color: "#71857f", display: "block" }}>⏳ Hạn nộp E-HSDT:</span>
                        <span style={{ color: "#22443c", fontWeight: 600 }}>
                          {formatDate(b.bid_deadline)} ({deadlineMeta.label})
                        </span>
                      </div>
                    </div>

                    {/* Internal Notes Display / Editor */}
                    <div
                      style={{
                        padding: "10px 14px",
                        borderRadius: "10px",
                        background: "#fffaf0",
                        border: "1px solid #ead8b8",
                        marginBottom: "14px",
                        fontSize: "13px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                        <span style={{ fontSize: "11px", fontWeight: 800, color: "#8a5814" }}>
                          📝 GHI CHÚ NỘI BỘ (CHIẾN LƯỢC DỰ THẦU):
                        </span>
                        <button
                          onClick={() => {
                            const newNote = window.prompt("Nhập ghi chú chiến lược dự thầu:", b.note);
                            if (newNote !== null) {
                              api.bidding
                                .updateBookmark(b.id, { note: newNote })
                                .then((up) => {
                                  setBookmarks((prev) => prev.map((item) => (item.id === b.id ? up : item)));
                                  showToast("Đã cập nhật ghi chú", "success");
                                })
                                .catch((e) => showToast(e.message, "error"));
                            }
                          }}
                          style={{
                            border: "0",
                            background: "transparent",
                            color: "#168579",
                            fontSize: "11px",
                            fontWeight: 800,
                            cursor: "pointer",
                          }}
                        >
                          ✏️ Sửa ghi chú
                        </button>
                      </div>
                      <p style={{ margin: 0, color: "#544633", fontStyle: b.note ? "normal" : "italic" }}>
                        {b.note || "Chưa có ghi chú nội bộ. Bấm 'Sửa ghi chú' để nhập phân công, tính giá hoặc ghi nhớ đối tác."}
                      </p>
                    </div>

                    {/* Action Foot */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "8px",
                      }}
                    >
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button
                          onClick={() =>
                            handleOpenAiAnalysis({
                              tbmt_code: b.tbmt_code,
                              tender_name: b.tender_name,
                              procuring_entity: b.procuring_entity,
                              investor: b.investor,
                              field: b.field,
                              bid_price: b.bid_price,
                              bid_deadline: b.bid_deadline,
                              province: b.province,
                              source_url: b.source_url,
                            })
                          }
                          style={{
                            padding: "8px 14px",
                            borderRadius: "8px",
                            fontSize: "12px",
                            fontWeight: 800,
                            border: "1px solid #b8dfd4",
                            background: "#eaf6f2",
                            color: "#146c59",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "5px",
                          }}
                        >
                          <span>🧠</span>
                          <span>Báo cáo AI</span>
                        </button>

                        <button
                          onClick={() => handleOpenTenderDetail(b.tbmt_code)}
                          style={{
                            padding: "8px 12px",
                            borderRadius: "8px",
                            fontSize: "12px",
                            fontWeight: 700,
                            border: "1px solid #d4dfda",
                            background: "#fff",
                            color: "#3a564e",
                            cursor: "pointer",
                          }}
                        >
                          👁️ Chi tiết
                        </button>
                      </div>

                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <a
                          href={b.source_url}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            fontSize: "12px",
                            fontWeight: 700,
                            color: "#168579",
                            textDecoration: "none",
                            padding: "7px 11px",
                            borderRadius: "8px",
                            background: "#f0f8f5",
                          }}
                        >
                          🔗 Mua Sắm Công ↗
                        </a>

                        <button
                          onClick={() => handleDeleteBookmark(b.id, b.tender_name)}
                          style={{
                            padding: "7px 11px",
                            borderRadius: "8px",
                            fontSize: "12px",
                            fontWeight: 700,
                            border: "1px solid #f1c8bf",
                            background: "#fff0ec",
                            color: "#963c2d",
                            cursor: "pointer",
                          }}
                          title="Xóa khỏi danh sách quan tâm"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB 3: ⚙️ BỘ LỌC TỰ ĐỘNG & CẢNH BÁO TELEGRAM (WATCHLIST)                  */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "watchlist" && (
        <div>
          {/* Top Bar: Action Buttons & Telegram info */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "12px",
              marginBottom: "18px",
            }}
          >
            <div>
              <h2 style={{ fontFamily: "Georgia, serif", fontSize: "20px", margin: "0 0 4px", color: "#143b38" }}>
                Quy Tắc Quét Tự Động & Bắn Tin Telegram
              </h2>
              <p style={{ margin: 0, fontSize: "13px", color: "#617770" }}>
                Hệ thống định kỳ tìm kiếm các gói thầu mới thỏa mãn điều kiện và tự động gửi thông báo đến kênh Telegram của Admin.
              </p>
            </div>

            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                onClick={() =>
                  setWatchlistModalRule({
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
                style={{
                  padding: "11px 18px",
                  borderRadius: "12px",
                  background: "#168579",
                  color: "#fff",
                  border: "0",
                  fontWeight: 800,
                  fontSize: "13px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  boxShadow: "0 4px 14px rgba(22,133,121,0.25)",
                }}
              >
                <span>➕</span>
                <span>Thêm Quy Tắc Mới</span>
              </button>

              <button
                onClick={handleScanAll}
                disabled={scanningId !== null}
                style={{
                  padding: "11px 18px",
                  borderRadius: "12px",
                  background: "#f0a64a",
                  color: "#102d2b",
                  border: "0",
                  fontWeight: 800,
                  fontSize: "13px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span>{scanningId === "all" ? "⏳ Đang quét..." : "⚡ Quét Tất Cả"}</span>
              </button>
            </div>
          </div>

          {/* Watchlist Loading / Empty */}
          {watchlistLoading && (
            <div style={{ textAlign: "center", padding: "40px", color: "#60756e" }}>
              ⏳ Đang tải danh sách bộ lọc tự động...
            </div>
          )}

          {!watchlistLoading && watchlists.length === 0 && (
            <div
              style={{
                padding: "48px 24px",
                textAlign: "center",
                background: "#fff",
                borderRadius: "20px",
                border: "1px dashed #cdded7",
                color: "#6c7d77",
              }}
            >
              <div style={{ fontSize: "40px", marginBottom: "8px" }}>⚙️</div>
              <h3 style={{ fontFamily: "Georgia, serif", color: "#173c35", margin: "0 0 8px" }}>
                Chưa có quy tắc quét tự động nào
              </h3>
              <p style={{ maxWidth: "460px", margin: "0 auto 16px", fontSize: "13px" }}>
                Tạo quy tắc quét theo từ khóa (như "SCADA", "IoT", "Trạm bơm"), tỉnh thành và khoảng giá để không bao giờ bỏ lỡ cơ hội đấu thầu.
              </p>
              <button
                className="btn"
                onClick={() =>
                  setWatchlistModalRule({
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
                style={{
                  background: "#168579",
                  color: "#fff",
                  padding: "9px 18px",
                  borderRadius: "10px",
                  fontWeight: 700,
                }}
              >
                + Thêm quy tắc mẫu
              </button>
            </div>
          )}

          {/* Watchlist Rules Grid */}
          {!watchlistLoading && watchlists.length > 0 && (
            <div style={{ display: "grid", gap: "16px" }}>
              {watchlists.map((rule) => (
                <div
                  key={rule.id}
                  style={{
                    background: "#fff",
                    borderRadius: "18px",
                    padding: "20px 24px",
                    border: "1px solid #dce4df",
                    boxShadow: "0 4px 18px rgba(16,45,43,0.04)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      flexWrap: "wrap",
                      gap: "10px",
                      marginBottom: "12px",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                        <h3
                          style={{
                            fontFamily: "Georgia, serif",
                            fontSize: "18px",
                            fontWeight: 600,
                            color: "#143b38",
                            margin: 0,
                          }}
                        >
                          {rule.name}
                        </h3>

                        <span
                          style={{
                            fontSize: "10px",
                            fontWeight: 900,
                            padding: "3px 8px",
                            borderRadius: "999px",
                            background: rule.is_active ? "#dff3e9" : "#fbe1da",
                            color: rule.is_active ? "#176448" : "#a13f2e",
                            textTransform: "uppercase",
                            letterSpacing: ".06em",
                          }}
                        >
                          {rule.is_active ? "● Đang hoạt động" : "○ Tạm dừng"}
                        </span>
                      </div>

                      <div style={{ fontSize: "12px", color: "#6a7d77" }}>
                        Lần quét gần nhất: {rule.last_checked_at ? formatDate(rule.last_checked_at) : "Chưa quét lần nào"}
                      </div>
                    </div>

                    {/* Switches */}
                    <div style={{ display: "flex", gap: "14px", alignItems: "center", flexWrap: "wrap" }}>
                      {/* Active Toggle */}
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          fontSize: "12px",
                          fontWeight: 700,
                          color: "#37544c",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={rule.is_active}
                          onChange={() => handleToggleWatchlistActive(rule)}
                          style={{ width: "16px", height: "16px", cursor: "pointer" }}
                        />
                        <span>Tự động quét</span>
                      </label>

                      {/* Telegram Toggle */}
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          fontSize: "12px",
                          fontWeight: 700,
                          color: rule.notify_telegram ? "#0088cc" : "#6a7d77",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={rule.notify_telegram}
                          onChange={() => handleToggleWatchlistTelegram(rule)}
                          style={{ width: "16px", height: "16px", cursor: "pointer" }}
                        />
                        <span>✈️ Bắn Telegram</span>
                      </label>
                    </div>
                  </div>

                  {/* Criteria Tags Strip */}
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      flexWrap: "wrap",
                      padding: "12px 14px",
                      borderRadius: "10px",
                      background: "#f9fcfa",
                      border: "1px solid #e7f0ec",
                      marginBottom: "14px",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontSize: "11px", fontWeight: 800, color: "#168579" }}>TIÊU CHÍ LỌC:</span>

                    {rule.keyword && (
                      <span
                        style={{
                          fontSize: "12px",
                          padding: "3px 8px",
                          borderRadius: "6px",
                          background: "#eaf4f1",
                          color: "#168579",
                          fontWeight: 700,
                        }}
                      >
                        🔍 "{rule.keyword}"
                      </span>
                    )}

                    {rule.province && (
                      <span
                        style={{
                          fontSize: "12px",
                          padding: "3px 8px",
                          borderRadius: "6px",
                          background: "#f0f4f8",
                          color: "#334e68",
                          fontWeight: 700,
                        }}
                      >
                        📍 {rule.province}
                      </span>
                    )}

                    {rule.field && (
                      <span
                        style={{
                          fontSize: "12px",
                          padding: "3px 8px",
                          borderRadius: "6px",
                          background: getFieldBadge(rule.field).bg,
                          color: getFieldBadge(rule.field).color,
                          fontWeight: 700,
                        }}
                      >
                        📂 {getFieldBadge(rule.field).label}
                      </span>
                    )}

                    {(rule.min_price != null || rule.max_price != null) && (
                      <span
                        style={{
                          fontSize: "12px",
                          padding: "3px 8px",
                          borderRadius: "6px",
                          background: "#fef3c7",
                          color: "#92400e",
                          fontWeight: 700,
                        }}
                      >
                        💰 {formatVndShort(rule.min_price)} – {rule.max_price ? formatVndShort(rule.max_price) : "∞"}
                      </span>
                    )}
                  </div>

                  {/* Actions Strip */}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                    <button
                      onClick={() => handleScanRule(rule.id)}
                      disabled={scanningId === rule.id}
                      style={{
                        padding: "8px 14px",
                        borderRadius: "8px",
                        fontSize: "12px",
                        fontWeight: 800,
                        border: "1px solid #168579",
                        background: "#eaf6f2",
                        color: "#168579",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "5px",
                      }}
                    >
                      <span>{scanningId === rule.id ? "⏳ Đang quét..." : "⚡ Quét ngay"}</span>
                    </button>

                    <button
                      onClick={() => setWatchlistModalRule(rule)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "8px",
                        fontSize: "12px",
                        fontWeight: 700,
                        border: "1px solid #c8dbd3",
                        background: "#fff",
                        color: "#37544c",
                        cursor: "pointer",
                      }}
                    >
                      ✏️ Sửa
                    </button>

                    <button
                      onClick={() => handleDeleteWatchlist(rule.id, rule.name)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: "8px",
                        fontSize: "12px",
                        fontWeight: 700,
                        border: "1px solid #f1c8bf",
                        background: "#fff0ec",
                        color: "#963c2d",
                        cursor: "pointer",
                      }}
                    >
                      🗑️ Xóa
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}


      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB 4: 🏢 NĂNG LỰC NHÀ THẦU & QUÉT KHÁCH HÀNG CRM                           */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "contractors" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Top Hero Bar */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "14px",
              background: "#fff",
              padding: "20px 24px",
              borderRadius: "18px",
              border: "1px solid #e2e8f0",
              boxShadow: "0 2px 10px rgba(16,45,43,0.04)",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <h2 style={{ fontFamily: "Georgia, serif", fontSize: "22px", margin: 0, color: "#143b38" }}>
                  Hồ Sơ Năng Lực Nhà Thầu & Đối Soát Khách Hàng CRM
                </h2>
                <span className="chip green sm" style={{ fontWeight: 800 }}>
                  ● Dữ liệu e-GP & Quyết định LCNT
                </span>
              </div>
              <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#617770" }}>
                Tự động rà soát toàn bộ khách hàng trong CSDL INUT, thống kê lịch sử trúng thầu, win rate và các chủ đầu tư ruột.
              </p>
            </div>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button
                onClick={handleScanCrmContractors}
                disabled={crmScanLoading}
                style={{
                  padding: "11px 20px",
                  borderRadius: "12px",
                  background: "linear-gradient(135deg, #168579, #0d473f)",
                  color: "#fff",
                  border: "0",
                  fontWeight: 800,
                  fontSize: "13px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  boxShadow: "0 4px 14px rgba(22,133,121,0.25)",
                }}
              >
                <span>{crmScanLoading ? "⏳ Đang Quét..." : "⚡ Quét Lại Năng Lực CRM"}</span>
              </button>
            </div>
          </div>

          {/* Sub-Tabs Switcher */}
          <div
            style={{
              display: "flex",
              gap: "10px",
              background: "#f1f5f9",
              padding: "6px",
              borderRadius: "14px",
              width: "fit-content",
            }}
          >
            <button
              onClick={() => {
                setContractorSubTab("won_packages_playbook");
                syncBiddingUrl("contractors", "won_packages_playbook");
                if (!wonPackagesResult) handleFetchWonPackages();
              }}
              style={{
                padding: "8px 18px",
                borderRadius: "10px",
                border: "none",
                fontSize: "13px",
                fontWeight: contractorSubTab === "won_packages_playbook" ? 800 : 600,
                background: contractorSubTab === "won_packages_playbook" ? "#168579" : "transparent",
                color: contractorSubTab === "won_packages_playbook" ? "#fff" : "#475569",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: contractorSubTab === "won_packages_playbook" ? "0 2px 8px rgba(22,133,121,0.25)" : "none",
              }}
            >
              <span>📚</span>
              <span>Kho Gói Thầu Đã Trúng & Cẩm Nang INUT</span>
              {wonPackagesResult && (
                <span style={{ fontSize: "11px", padding: "2px 7px", borderRadius: "999px", background: "rgba(255,255,255,0.25)", color: "#fff", fontWeight: 800 }}>
                  {wonPackagesResult.total_packages}
                </span>
              )}
            </button>

            <button
              onClick={() => {
                setContractorSubTab("crm_contractors");
                syncBiddingUrl("contractors", "crm_contractors");
                if (!crmScanResult) handleScanCrmContractors();
              }}
              style={{
                padding: "8px 18px",
                borderRadius: "10px",
                border: "none",
                fontSize: "13px",
                fontWeight: contractorSubTab === "crm_contractors" ? 800 : 600,
                background: contractorSubTab === "crm_contractors" ? "#168579" : "transparent",
                color: contractorSubTab === "crm_contractors" ? "#fff" : "#475569",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: contractorSubTab === "crm_contractors" ? "0 2px 8px rgba(22,133,121,0.25)" : "none",
              }}
            >
              <span>🏢</span>
              <span>Danh Sách Khách Hàng CRM ({crmScanResult ? crmScanResult.total_crm_customers : 14})</span>
            </button>
          </div>



          {/* ══════════════════════════════════════════════════════════════════════════ */}
          {/* SUB-VIEW A: 📚 KHO GÓI THẦU ĐÃ TRÚNG & CẨM NANG ĐẤU THẦU INUT              */}
          {/* ══════════════════════════════════════════════════════════════════════════ */}
          {contractorSubTab === "won_packages_playbook" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* Playbook Highlight Banner */}
              <div
                style={{
                  background: "linear-gradient(135deg, #0d473f, #168579)",
                  borderRadius: "18px",
                  padding: "24px",
                  color: "#fff",
                  boxShadow: "0 8px 30px rgba(13,71,63,0.18)",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div style={{ position: "relative", zIndex: 1, maxWidth: "880px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 900, textTransform: "uppercase", letterSpacing: ".15em", color: "#a7f3d0" }}>
                    CẨM NANG HÀNH ĐỘNG ĐẤU THẦU THỰC CHIẾN • DÀNH CHO INUT (MST 4401053694)
                  </span>
                  <h3 style={{ fontFamily: "Georgia, serif", fontSize: "22px", margin: "6px 0 10px", color: "#ffffff" }}>
                    Công Thức Định Giá Dự Thầu & 3 Bộ Kit Hồ Sơ Chuẩn Mẫu
                  </h3>
                  <p style={{ fontSize: "13px", color: "#e2e8f0", lineHeight: 1.6, margin: 0 }}>
                    Phân tích từ hơn 100 gói thầu đã trúng của các nhà thầu lớn (Gdata, Tân Thanh Phương, Merap): Mức giảm giá tối ưu luôn nằm ở vùng <strong>3.2% - 4.5%</strong> so với Giá dự toán gói thầu để tối đa hóa điểm số tài chính mà vẫn giữ biên lợi nhuận ròng $\ge 30\%$.
                  </p>
                </div>

                {/* 3 Standard E-HSDT Kits */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px", marginTop: "18px" }}>
                  <div style={{ background: "rgba(255,255,255,0.12)", backdropFilter: "blur(8px)", padding: "14px 16px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.2)" }}>
                    <div style={{ fontWeight: 800, fontSize: "13px", color: "#fef08a" }}>💧 Kit 1: Quan Trắc Môi Trường TT10</div>
                    <div style={{ fontSize: "11px", color: "#e2e8f0", marginTop: "4px" }}>Datalogger 4G + Web SCADA truyền FTP/MQTT chuẩn Sở TN&MT. (Mẫu: 1,15 Tỷ ₫)</div>
                  </div>

                  <div style={{ background: "rgba(255,255,255,0.12)", backdropFilter: "blur(8px)", padding: "14px 16px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.2)" }}>
                    <div style={{ fontWeight: 800, fontSize: "13px", color: "#bae6fd" }}>⚡ Kit 2: Đo Xa Điện Năng AMR/AMI</div>
                    <div style={{ fontSize: "11px", color: "#e2e8f0", marginTop: "4px" }}>Modem đọc xa công tơ điện tử Elster/Gelex + MDMS biểu đồ phụ tải. (Mẫu: 760 Tr ₫)</div>
                  </div>

                  <div style={{ background: "rgba(255,255,255,0.12)", backdropFilter: "blur(8px)", padding: "14px 16px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.2)" }}>
                    <div style={{ fontWeight: 800, fontSize: "13px", color: "#bbf7d0" }}>🏭 Kit 3: Tự Động Hóa SCADA FUXA</div>
                    <div style={{ fontSize: "11px", color: "#e2e8f0", marginTop: "4px" }}>Tủ điều khiển PLC/Inverter + FUXA Web SCADA trạm bơm & cấp nước. (Mẫu: 945 Tr ₫)</div>
                  </div>
                </div>
              </div>

              {/* Search & Filter Bar for Won Packages */}
              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  flexWrap: "wrap",
                  alignItems: "center",
                  background: "#fff",
                  padding: "16px 20px",
                  borderRadius: "16px",
                  border: "1px solid #e2e8f0",
                }}
              >
                <div style={{ flex: 1, minWidth: "260px" }}>
                  <input
                    type="text"
                    value={wonPackagesQuery}
                    onChange={(e) => {
                      setWonPackagesQuery(e.target.value);
                      handleFetchWonPackages(e.target.value, wonPackagesFieldFilter);
                    }}
                    placeholder="Tìm gói thầu đã trúng: Nhập tên gói, số TBMT, đơn vị trúng (Gdata, Tân Thanh Phương, Merap...)"
                    style={{
                      width: "100%",
                      height: "42px",
                      padding: "0 14px",
                      borderRadius: "10px",
                      border: "1px solid #cbd5e1",
                      background: "#f8fafc",
                      fontSize: "13px",
                      outline: "none",
                    }}
                  />
                </div>

                <select
                  value={wonPackagesFieldFilter}
                  onChange={(e) => {
                    setWonPackagesFieldFilter(e.target.value);
                    handleFetchWonPackages(wonPackagesQuery, e.target.value);
                  }}
                  style={{
                    height: "42px",
                    padding: "0 14px",
                    borderRadius: "10px",
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                    fontSize: "13px",
                    color: "#334155",
                    cursor: "pointer",
                  }}
                >
                  <option value="">Tất cả lĩnh vực</option>
                  <option value="HH">Hàng hóa (HH)</option>
                  <option value="PTV">Phi tư vấn / Dịch vụ CNTT</option>
                  <option value="XL">Xây lắp (XL)</option>
                </select>

                <button
                  onClick={() => handleFetchWonPackages(wonPackagesQuery, wonPackagesFieldFilter)}
                  style={{
                    height: "42px",
                    padding: "0 18px",
                    borderRadius: "10px",
                    background: "#168579",
                    color: "#fff",
                    border: 0,
                    fontWeight: 700,
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  🔍 Lọc
                </button>
              </div>

              {/* Won Packages List */}
              {wonPackagesLoading ? (
                <div style={{ textAlign: "center", padding: "60px", color: "#64748b", background: "#fff", borderRadius: "18px", border: "1px solid #e2e8f0" }}>
                  <span className="animate-spin" style={{ fontSize: "28px", display: "inline-block", marginBottom: "10px" }}>⏳</span>
                  <p style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "#1e293b" }}>Đang tải danh sách gói thầu đã trúng...</p>
                </div>
              ) : !wonPackagesResult || wonPackagesResult.packages.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px", color: "#64748b", background: "#fff", borderRadius: "18px", border: "1px solid #e2e8f0" }}>
                  <p style={{ margin: 0, fontSize: "15px", fontWeight: 700 }}>Không tìm thấy gói thầu đã trúng phù hợp</p>
                </div>
              ) : (
                <div style={{ display: "grid", gap: "16px" }}>
                  {wonPackagesResult.packages.map((pkg) => (
                    <div
                      key={pkg.id}
                      style={{
                        background: "#fff",
                        borderRadius: "18px",
                        border: "1px solid #fed7aa",
                        padding: "20px 24px",
                        boxShadow: "0 4px 20px rgba(234, 88, 12, 0.05)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                      }}
                    >
                      {/* Top row */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "4px" }}>
                            <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", fontWeight: 800, color: "#0f766e", background: "#e6fffa", padding: "2px 8px", borderRadius: "6px" }}>
                              {pkg.tbmt_code}
                            </span>
                            <span style={{ fontSize: "11px", fontWeight: 800, padding: "2px 8px", borderRadius: "6px", background: "#fef3c7", color: "#92400e" }}>
                              📂 {pkg.field_label || pkg.field}
                            </span>
                            <span style={{ fontSize: "11px", fontWeight: 800, padding: "2px 8px", borderRadius: "999px", background: "#dcfce7", color: "#166534" }}>
                              ✓ ĐÃ TRÚNG THẦU
                            </span>
                          </div>

                          <h3
                            onClick={() => handleOpenTenderDetail(pkg.tbmt_code, "info")}
                            style={{
                              margin: 0,
                              fontSize: "16px",
                              fontWeight: 800,
                              color: "#0f172a",
                              lineHeight: 1.4,
                              cursor: "pointer",
                              transition: "color 0.15s ease",
                            }}
                            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#0f766e")}
                            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "#0f172a")}
                          >
                            {pkg.tender_name} ↗
                          </h3>

                          <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                            Chủ đầu tư: <strong style={{ color: "#334155" }}>{pkg.procuring_entity}</strong>
                          </div>
                        </div>

                        <div style={{ textAlign: "right", minWidth: "160px" }}>
                          <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Giá Trúng Thầu</span>
                          <div style={{ fontSize: "18px", fontWeight: 800, color: "#ea580c", fontFamily: "var(--font-mono)" }}>
                            {formatVnd(pkg.won_price)}
                          </div>
                          <div style={{ fontSize: "11px", color: "#047857", fontWeight: 700 }}>
                            Dự toán: {formatVnd(pkg.bid_price)} (Giảm {pkg.discount_percent}%)
                          </div>
                        </div>
                      </div>

                      {/* Contractor & Decision Strip */}
                      <div style={{ display: "flex", gap: "14px", fontSize: "12px", background: "#f8fafc", padding: "10px 14px", borderRadius: "10px", border: "1px solid #f1f5f9", flexWrap: "wrap", alignItems: "center" }}>
                        <span>🏆 Đơn vị trúng: <strong style={{ color: "#0f172a" }}>{pkg.contractor_name}</strong></span>
                        <span>📜 Quyết định: <strong style={{ color: "#475569", fontFamily: "var(--font-mono)" }}>{pkg.decision_number}</strong> ({pkg.award_date})</span>
                      </div>

                      {/* Winning Factors */}
                      {pkg.winning_factors && pkg.winning_factors.length > 0 && (
                        <div style={{ background: "#f0fdf4", padding: "12px 14px", borderRadius: "10px", border: "1px solid #bbf7d0", fontSize: "12px", color: "#166534" }}>
                          <div style={{ fontWeight: 800, marginBottom: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
                            <span>🌟</span> Yếu Tố Quyết Định Trúng Thầu:
                          </div>
                          <ul style={{ margin: 0, paddingLeft: "18px", lineHeight: 1.5 }}>
                            {pkg.winning_factors.map((f: string, idx: number) => (
                              <li key={idx}>{f}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* INUT Takeaway & Action Plan */}
                      {pkg.inut_playbook_takeaway && (
                        <div style={{ background: "linear-gradient(135deg, #fffbeb, #fef2f2)", padding: "12px 14px", borderRadius: "10px", border: "1px solid #fde68a", fontSize: "12px", color: "#854d0e", display: "flex", gap: "8px", alignItems: "flex-start" }}>
                          <span style={{ fontSize: "16px" }}>💡</span>
                          <div>
                            <strong style={{ color: "#713f12" }}>Bài học & Cơ hội hợp tác cho INUT: </strong>
                            {pkg.inut_playbook_takeaway}
                          </div>
                        </div>
                      )}

                      {/* Action Bar for Won Package */}
                      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "4px", borderTop: "1px solid #f1f5f9", paddingTop: "12px" }}>
                        <button
                          type="button"
                          onClick={() => handleOpenTenderDetail(pkg.tbmt_code, "info")}
                          style={{
                            padding: "8px 16px",
                            borderRadius: "10px",
                            border: "none",
                            background: "#0f766e",
                            color: "#fff",
                            fontWeight: 700,
                            fontSize: "12px",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            boxShadow: "0 2px 6px rgba(15,118,110,0.2)",
                          }}
                        >
                          <span>👁️</span>
                          <span>Xem Chi Tiết Gói Thầu</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleOpenTenderDetail(pkg.tbmt_code, "attachments")}
                          style={{
                            padding: "8px 16px",
                            borderRadius: "10px",
                            border: "1px solid #0f766e",
                            background: "#f0fdfa",
                            color: "#0f766e",
                            fontWeight: 700,
                            fontSize: "12px",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <span>📎</span>
                          <span>Tải Hồ Sơ Mời Thầu (5 File)</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleOpenTenderDetail(pkg.tbmt_code, "competitors")}
                          style={{
                            padding: "8px 16px",
                            borderRadius: "10px",
                            border: "1px solid #ea580c",
                            background: "#fff7ed",
                            color: "#ea580c",
                            fontWeight: 700,
                            fontSize: "12px",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <span>👥</span>
                          <span>Hồ Sơ Nhà Thầu Đối Thủ (E-HSDT)</span>
                        </button>

                        <a
                          href={api.bidding.getFullDossierZipUrl(pkg.tbmt_code)}
                          download
                          style={{
                            padding: "8px 16px",
                            borderRadius: "10px",
                            background: "#fef08a",
                            color: "#854d0e",
                            border: "1px solid #fde047",
                            fontWeight: 800,
                            fontSize: "12px",
                            textDecoration: "none",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <span>📦</span>
                          <span>Tải Full ZIP</span>
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════════ */}
          {/* SUB-VIEW B: 🏢 DANH SÁCH KHÁCH HÀNG CRM & ĐỐI SOÁT NĂNG LỰC                */}
          {/* ══════════════════════════════════════════════════════════════════════════ */}
          {contractorSubTab === "crm_contractors" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>


          {/* 4 Metric Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "14px" }}>
            <div
              className="metric-card teal"
              style={{ padding: "18px 20px", borderRadius: "16px", background: "#fff", border: "1px solid #e2e8f0", cursor: "pointer" }}
              onClick={() => setContractorCategoryFilter("all")}
            >
              <span style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", color: "#64748b" }}>
                Tổng Khách Hàng CRM
              </span>
              <b style={{ fontFamily: "Georgia, serif", fontSize: "28px", color: "#0f172a", margin: "8px 0 4px", display: "block" }}>
                {crmScanResult ? crmScanResult.total_crm_customers : "..."}
              </b>
              <small style={{ color: "#64748b" }}>Doanh nghiệp trong CSDL</small>
            </div>

            <div
              className="metric-card coral"
              style={{ padding: "18px 20px", borderRadius: "16px", background: "#fff", border: "1px solid #e2e8f0", cursor: "pointer" }}
              onClick={() => setContractorCategoryFilter("won")}
            >
              <span style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", color: "#ea580c" }}>
                🏆 Khách Hàng Trúng Thầu
              </span>
              <b style={{ fontFamily: "Georgia, serif", fontSize: "28px", color: "#ea580c", margin: "8px 0 4px", display: "block" }}>
                {crmScanResult ? crmScanResult.total_won_contractors : "..."}
              </b>
              <small style={{ color: "#ea580c" }}>Trúng thầu cấp Bộ & Tỉnh</small>
            </div>

            <div
              className="metric-card amber"
              style={{ padding: "18px 20px", borderRadius: "16px", background: "#fff", border: "1px solid #e2e8f0", cursor: "pointer" }}
              onClick={() => setContractorCategoryFilter("won")}
            >
              <span style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", color: "#047857" }}>
                💰 Tổng Giá Trị Trúng Thầu
              </span>
              <b style={{ fontFamily: "Georgia, serif", fontSize: "26px", color: "#047857", margin: "8px 0 4px", display: "block" }}>
                {crmScanResult ? crmScanResult.total_won_value_formatted : "..."}
              </b>
              <small style={{ color: "#047857" }}>Giá trị gói thầu thắng lũy kế</small>
            </div>

            <div
              className="metric-card ink"
              style={{ padding: "18px 20px", borderRadius: "16px", background: "#fff", border: "1px solid #e2e8f0", cursor: "pointer" }}
              onClick={() => setContractorCategoryFilter("registered")}
            >
              <span style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", color: "#4338ca" }}>
                📝 Nhà Thầu Công Nghệ / OEM
              </span>
              <b style={{ fontFamily: "Georgia, serif", fontSize: "28px", color: "#4338ca", margin: "8px 0 4px", display: "block" }}>
                {crmScanResult
                  ? crmScanResult.items.filter((i) => i.bidding_status === "REGISTERED_BIDDER" || i.bidding_status === "OEM_SUBCONTRACTOR").length
                  : "..."}
              </b>
              <small style={{ color: "#4338ca" }}>Đối tác sản xuất & lắp đặt IoT</small>
            </div>
          </div>

          {/* Search & Filter Bar */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              background: "#fff",
              padding: "16px 20px",
              borderRadius: "16px",
              border: "1px solid #e2e8f0",
            }}
          >
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: "260px", position: "relative" }}>
                <input
                  type="text"
                  value={contractorSearchQuery}
                  onChange={(e) => setContractorSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearchContractorsDirect(contractorSearchQuery)}
                  placeholder="Tra cứu bất kỳ doanh nghiệp / đối thủ nào: Nhập Tên công ty hoặc Mã Số Thuế (VD: Gdata, 0105365128, Tân Thanh Phương...)"
                  style={{
                    width: "100%",
                    height: "44px",
                    padding: "0 40px 0 14px",
                    borderRadius: "12px",
                    border: "1px solid #cbd5e1",
                    background: "#f8fafc",
                    fontSize: "13px",
                    outline: "none",
                  }}
                />
                {contractorSearchQuery && (
                  <button
                    onClick={() => {
                      setContractorSearchQuery("");
                      handleScanCrmContractors();
                    }}
                    style={{
                      position: "absolute",
                      right: "12px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      color: "#94a3b8",
                      cursor: "pointer",
                      fontSize: "14px",
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>

              <button
                onClick={() => handleSearchContractorsDirect(contractorSearchQuery)}
                style={{
                  height: "44px",
                  padding: "0 22px",
                  borderRadius: "12px",
                  background: "#168579",
                  color: "#fff",
                  border: "0",
                  fontWeight: 800,
                  fontSize: "13px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span>🔎</span>
                <span>Tìm Kiếm Nhà Thầu</span>
              </button>
            </div>

            {/* Quick Filter Tags */}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", paddingTop: "8px", borderTop: "1px solid #f1f5f9" }}>
              <span style={{ fontSize: "11px", fontWeight: 800, color: "#64748b", textTransform: "uppercase" }}>Gợi ý nhanh:</span>
              <button
                onClick={() => {
                  setContractorCategoryFilter("all");
                  handleScanCrmContractors();
                }}
                className={`btn-date ${contractorCategoryFilter === "all" ? "active" : ""}`}
                style={{ padding: "5px 12px", fontSize: "12px", borderRadius: "8px", border: "1px solid #cbd5e1", background: contractorCategoryFilter === "all" ? "#168579" : "#f8fafc", color: contractorCategoryFilter === "all" ? "#fff" : "#334155", cursor: "pointer" }}
              >
                ⚡ Tất cả KH CRM ({crmScanResult ? crmScanResult.total_crm_customers : 14})
              </button>

              <button
                onClick={() => {
                  setContractorCategoryFilter("won");
                }}
                style={{ padding: "5px 12px", fontSize: "12px", borderRadius: "8px", border: "1px solid #fed7aa", background: contractorCategoryFilter === "won" ? "#ea580c" : "#fff7ed", color: contractorCategoryFilter === "won" ? "#fff" : "#c2410c", fontWeight: 700, cursor: "pointer" }}
              >
                🏆 Top Trúng Thầu (Gdata, Tân Thanh Phương, Merap)
              </button>

              <button
                onClick={() => handleSearchContractorsDirect("4401053694")}
                style={{ padding: "5px 12px", fontSize: "12px", borderRadius: "8px", border: "1px solid #a7f3d0", background: "#ecfdf5", color: "#047857", fontWeight: 700, cursor: "pointer" }}
              >
                🌟 iNut Technology (4401053694)
              </button>

              <button
                onClick={() => handleSearchContractorsDirect("5500649200")}
                style={{ padding: "5px 12px", fontSize: "12px", borderRadius: "8px", border: "1px solid #c7d2fe", background: "#eef2ff", color: "#4338ca", fontWeight: 700, cursor: "pointer" }}
              >
                ⚙️ Tự Động Hóa IoT Sơn La (5500649200)
              </button>

              <button
                onClick={() => handleSearchContractorsDirect("0314360282")}
                style={{ padding: "5px 12px", fontSize: "12px", borderRadius: "8px", border: "1px solid #e2e8f0", background: "#f8fafc", color: "#475569", fontWeight: 700, cursor: "pointer" }}
              >
                ⚙️ Bảo Toàn Tech (0314360282)
              </button>
            </div>
          </div>

          {/* Contractors Cards List */}
          {crmScanLoading ? (
            <div style={{ textAlign: "center", padding: "60px", color: "#64748b", background: "#fff", borderRadius: "18px", border: "1px solid #e2e8f0" }}>
              <span className="animate-spin" style={{ fontSize: "28px", display: "inline-block", marginBottom: "10px" }}>⏳</span>
              <p style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "#1e293b" }}>Đang quét và đối soát hồ sơ đấu thầu từ e-GP...</p>
            </div>
          ) : !crmScanResult || crmScanResult.items.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px", color: "#64748b", background: "#fff", borderRadius: "18px", border: "1px solid #e2e8f0" }}>
              <span style={{ fontSize: "36px", display: "block", marginBottom: "10px" }}>🏢</span>
              <p style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#1e293b" }}>Chưa có dữ liệu nhà thầu</p>
              <button
                onClick={handleScanCrmContractors}
                style={{ marginTop: "14px", padding: "9px 18px", borderRadius: "10px", background: "#168579", color: "#fff", border: 0, fontWeight: 700, cursor: "pointer" }}
              >
                ⚡ Quét Ngay
              </button>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "16px" }}>
              {crmScanResult.items
                .filter((item) => {
                  if (contractorCategoryFilter === "won") return item.total_won > 0;
                  if (contractorCategoryFilter === "registered") return item.bidding_status === "REGISTERED_BIDDER" || item.bidding_status === "OEM_SUBCONTRACTOR";
                  return true;
                })
                .map((c) => (
                  <div
                    key={c.tax_code + (c.customer_id || "")}
                    style={{
                      background: "#ffffff",
                      borderRadius: "18px",
                      border: c.total_won > 0 ? "1px solid #fed7aa" : "1px solid #e2e8f0",
                      padding: "20px 24px",
                      boxShadow: c.total_won > 0 ? "0 4px 20px rgba(234, 88, 12, 0.06)" : "0 2px 8px rgba(16,45,43,0.03)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "14px",
                    }}
                  >
                    {/* Header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 800, color: "#0f172a" }}>
                            {c.name}
                          </h3>
                          <span
                            style={{
                              padding: "3px 10px",
                              borderRadius: "999px",
                              fontSize: "11px",
                              fontWeight: 800,
                              background: c.total_won > 0 ? "#fff7ed" : c.bidding_status === "REGISTERED_BIDDER" ? "#eef2ff" : "#f1f5f9",
                              color: c.total_won > 0 ? "#c2410c" : c.bidding_status === "REGISTERED_BIDDER" ? "#4338ca" : "#475569",
                              border: c.total_won > 0 ? "1px solid #fed7aa" : "1px solid #cbd5e1",
                            }}
                          >
                            {c.bidding_status_label}
                          </span>
                        </div>

                        <div style={{ display: "flex", gap: "14px", marginTop: "4px", fontSize: "12px", color: "#64748b", flexWrap: "wrap" }}>
                          <span>
                            Mã số thuế: <strong style={{ color: "#0f172a", fontFamily: "var(--font-mono)" }}>{c.tax_code}</strong>
                          </span>
                          {c.address && <span>📍 {c.address}</span>}
                          {c.email && <span>✉️ {c.email}</span>}
                        </div>
                      </div>

                      <button
                        onClick={() => { setSelectedContractorDetail(c); syncBiddingUrl(activeTab, contractorSubTab, null, "info", c.tax_code); }}
                        style={{
                          padding: "8px 16px",
                          borderRadius: "10px",
                          background: c.total_won > 0 ? "linear-gradient(135deg, #ea580c, #c2410c)" : "#168579",
                          color: "#fff",
                          border: 0,
                          fontWeight: 700,
                          fontSize: "12px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                        }}
                      >
                        <span>👁️</span>
                        <span>Xem Chi Tiết Hồ Sơ ({c.total_bids} Gói)</span>
                      </button>
                    </div>

                    {/* Stats Metrics Strip */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                        gap: "12px",
                        background: "#f8fafc",
                        padding: "12px 16px",
                        borderRadius: "14px",
                        border: "1px solid #f1f5f9",
                        alignItems: "center",
                      }}
                    >
                      <div>
                        <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Số Gói Tham Gia</span>
                        <div style={{ fontSize: "16px", fontWeight: 800, color: "#0f172a", marginTop: "2px" }}>
                          {c.total_bids} gói <span style={{ fontSize: "12px", color: "#047857", fontWeight: 700 }}>({c.total_won} trúng)</span>
                        </div>
                      </div>

                      <div style={{ minWidth: "190px" }}>
                        <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Tỷ Lệ Trúng Thầu (Win Rate)</span>
                        <div style={{ marginTop: "4px" }}>
                          <WinRateProgressBar won={c.total_won} total={c.total_bids} rate={c.win_rate_percent} size="sm" />
                        </div>
                      </div>

                      <div>
                        <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Tổng Tiền Trúng Thầu</span>
                        <div style={{ fontSize: "16px", fontWeight: 800, color: "#ea580c", fontFamily: "var(--font-mono)", marginTop: "2px" }}>
                          {c.total_won_value_formatted}
                        </div>
                      </div>

                      <div>
                        <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Giảm Giá TB</span>
                        <div style={{ fontSize: "16px", fontWeight: 800, color: "#0f766e", marginTop: "2px" }}>
                          {c.average_discount_percent > 0 ? `${c.average_discount_percent}%` : "—"}
                        </div>
                      </div>
                    </div>

                    {/* Top Procuring Entities & Won Highlights */}
                    {c.top_procuring_entities && c.top_procuring_entities.length > 0 && (
                      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "11px", fontWeight: 800, color: "#475569", textTransform: "uppercase" }}>Chủ đầu tư quen thuộc:</span>
                        {c.top_procuring_entities.map((p, idx) => (
                          <span
                            key={idx}
                            style={{
                              fontSize: "11px",
                              padding: "3px 8px",
                              borderRadius: "6px",
                              background: "#f1f5f9",
                              color: "#334155",
                              fontWeight: 600,
                            }}
                          >
                            🏛️ {p}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* AI Strategic Insight Box */}
                    {c.ai_insight && (
                      <div
                        style={{
                          background: "linear-gradient(135deg, #f0fdf4, #fffbeb)",
                          padding: "12px 16px",
                          borderRadius: "12px",
                          border: "1px solid #bbf7d0",
                          fontSize: "12px",
                          color: "#14532d",
                          lineHeight: 1.5,
                          display: "flex",
                          gap: "10px",
                          alignItems: "flex-start",
                        }}
                      >
                        <span style={{ fontSize: "16px" }}>💡</span>
                        <div>
                          <strong style={{ color: "#166534" }}>Gợi ý chiến lược & Cơ hội hợp tác INUT: </strong>
                          {c.ai_insight}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          )}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL: HỒ SƠ CHI TIẾT NHÀ THẦU & DANH SÁCH GÓI THẦU                        */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {selectedContractorDetail && (
        <div className="modal-backdrop" onClick={() => setSelectedContractorDetail(null)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "920px", padding: "28px 32px" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <h2 style={{ fontFamily: "Georgia, serif", fontSize: "20px", margin: 0, color: "#0f172a" }}>
                    {selectedContractorDetail.name}
                  </h2>
                  <span
                    style={{
                      padding: "3px 10px",
                      borderRadius: "999px",
                      fontSize: "11px",
                      fontWeight: 800,
                      background: selectedContractorDetail.total_won > 0 ? "#fff7ed" : "#f1f5f9",
                      color: selectedContractorDetail.total_won > 0 ? "#c2410c" : "#475569",
                      border: selectedContractorDetail.total_won > 0 ? "1px solid #fed7aa" : "1px solid #cbd5e1",
                    }}
                  >
                    {selectedContractorDetail.bidding_status_label}
                  </span>
                </div>
                <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                  Mã số thuế: <strong style={{ color: "#0f172a", fontFamily: "var(--font-mono)" }}>{selectedContractorDetail.tax_code}</strong> • {selectedContractorDetail.address}
                </div>
              </div>

              <button
                onClick={() => setSelectedContractorDetail(null)}
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: "20px",
                  cursor: "pointer",
                  color: "#94a3b8",
                  padding: "4px 8px",
                }}
              >
                ✕
              </button>
            </div>

            {/* Metrics Overview */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: "12px",
                background: "#f8fafc",
                padding: "16px 20px",
                borderRadius: "14px",
                border: "1px solid #e2e8f0",
                marginBottom: "20px",
                alignItems: "center",
              }}
            >
              <div>
                <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Tổng Gói Tham Gia</span>
                <div style={{ fontSize: "20px", fontWeight: 800, color: "#0f172a", marginTop: "2px" }}>
                  {selectedContractorDetail.total_bids} gói
                </div>
              </div>

              <div>
                <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Gói Đã Trúng Thầu</span>
                <div style={{ fontSize: "20px", fontWeight: 800, color: "#047857", marginTop: "2px" }}>
                  {selectedContractorDetail.total_won} gói
                </div>
              </div>

              <div style={{ minWidth: "220px" }}>
                <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Tiến Độ Thắng Thầu (Win Rate)</span>
                <div style={{ marginTop: "6px" }}>
                  <WinRateProgressBar
                    won={selectedContractorDetail.total_won}
                    total={selectedContractorDetail.total_bids}
                    rate={selectedContractorDetail.win_rate_percent}
                    size="md"
                  />
                </div>
              </div>

              <div>
                <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 700, textTransform: "uppercase" }}>Tổng Giá Trị Thắng</span>
                <div style={{ fontSize: "18px", fontWeight: 800, color: "#ea580c", fontFamily: "var(--font-mono)", marginTop: "2px" }}>
                  {selectedContractorDetail.total_won_value_formatted}
                </div>
              </div>
            </div>

            {/* List of Won Packages Table */}
            <div style={{ marginBottom: "20px" }}>
              <h3 style={{ fontSize: "14px", fontWeight: 800, color: "#0f172a", marginBottom: "10px", display: "flex", alignItems: "center", gap: "6px" }}>
                <span>📋</span> Danh Sách Gói Thầu Tiêu Biểu & Quyết Định Phê Duyệt
              </h3>

              {selectedContractorDetail.highlight_won_packages && selectedContractorDetail.highlight_won_packages.length > 0 ? (
                <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: "12px" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", textAlign: "left" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                        <th style={{ padding: "10px 12px" }}>Số TBMT</th>
                        <th style={{ padding: "10px 12px" }}>Tên Gói Thầu</th>
                        <th style={{ padding: "10px 12px" }}>Bên Mời Thầu</th>
                        <th style={{ padding: "10px 12px" }}>Giá Trúng Thầu</th>
                        <th style={{ padding: "10px 12px" }}>Tiết Kiệm</th>
                        <th style={{ padding: "10px 12px" }}>Quyết Định</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedContractorDetail.highlight_won_packages.map((pkg, idx) => (
                        <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "10px 12px" }}>
                            <button
                              type="button"
                              onClick={() => handleOpenTenderDetail(pkg.tbmt_code, "iframe")}
                              style={{
                                background: "#eaf4f1",
                                border: "1px solid #c8dbd3",
                                color: "#168579",
                                padding: "4px 8px",
                                borderRadius: "6px",
                                fontFamily: "var(--font-mono, monospace)",
                                fontWeight: 800,
                                fontSize: "12px",
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                transition: "all 0.15s ease",
                              }}
                              title={`Bấm để xem chi tiết & E-HSMT ${pkg.tbmt_code}`}
                            >
                              <span>🏷️</span>
                              <span style={{ textDecoration: "underline" }}>{pkg.tbmt_code}</span>
                              <span style={{ fontSize: "10px" }}>↗</span>
                            </button>
                          </td>
                          <td style={{ padding: "10px 12px", fontWeight: 600, color: "#1e293b", maxWidth: "260px" }}>
                            {pkg.tender_name}
                          </td>
                          <td style={{ padding: "10px 12px", color: "#475569" }}>
                            {pkg.procuring_entity}
                          </td>
                          <td style={{ padding: "10px 12px", fontFamily: "var(--font-mono)", fontWeight: 800, color: "#ea580c" }}>
                            {formatVnd(pkg.won_price)}
                          </td>
                          <td style={{ padding: "10px 12px", color: "#047857", fontWeight: 700 }}>
                            {pkg.discount_percent}%
                          </td>
                          <td style={{ padding: "10px 12px", fontFamily: "var(--font-mono)", fontSize: "11px", color: "#64748b" }}>
                            {pkg.decision_number} ({pkg.award_date})
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ padding: "24px", textAlign: "center", color: "#94a3b8", background: "#f8fafc", borderRadius: "12px" }}>
                  Chưa ghi nhận gói thầu công lập trực tiếp trên cổng e-GP (Đơn vị thường tham gia dưới tư cách thầu phụ/OEM).
                </div>
              )}
            </div>

            {/* AI Strategic Analysis Box */}
            {selectedContractorDetail.ai_insight && (
              <div
                style={{
                  background: "linear-gradient(135deg, #f0fdf4, #fffbeb)",
                  padding: "16px",
                  borderRadius: "14px",
                  border: "1px solid #bbf7d0",
                  fontSize: "13px",
                  color: "#14532d",
                  lineHeight: 1.6,
                }}
              >
                <div style={{ fontWeight: 800, color: "#166534", marginBottom: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>🤖</span> Đánh Giá Chiến Lược & Cơ Hội Hợp Tác Bằng AI:
                </div>
                <div>{selectedContractorDetail.ai_insight}</div>
              </div>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "10px",
                marginTop: "20px",
                paddingTop: "16px",
                borderTop: "1px solid #e2e8f0",
              }}
            >
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => {
                    const md = generateContractorDossierMarkdown(selectedContractorDetail);
                    try {
                      if (navigator && navigator.clipboard) {
                        navigator.clipboard.writeText(md);
                      }
                    } catch (err) {
                      console.warn(err);
                    }
                    showToast(`📋 Đã sao chép Hồ sơ Năng lực (Markdown) của ${selectedContractorDetail.name}!`, "success");
                  }}
                  style={{
                    padding: "10px 16px",
                    borderRadius: "10px",
                    background: "#ecfdf5",
                    color: "#065f46",
                    border: "1px solid #a7f3d0",
                    fontWeight: 800,
                    fontSize: "13px",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                  title="Sao chép toàn bộ hồ sơ năng lực và danh sách gói thầu dạng Markdown"
                >
                  <span>📋</span>
                  <span>Xuất Báo Cáo Markdown / Sao chép</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleShareContractorTelegram(selectedContractorDetail)}
                  style={{
                    padding: "10px 16px",
                    borderRadius: "10px",
                    background: "linear-gradient(135deg, #0284c7, #0369a1)",
                    color: "#fff",
                    border: 0,
                    fontWeight: 800,
                    fontSize: "13px",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    boxShadow: "0 2px 8px rgba(2,132,199,0.25)",
                  }}
                  title="Gửi cảnh báo hồ sơ nhà thầu qua Telegram"
                >
                  <span>✈️</span>
                  <span>Gửi cảnh báo Telegram</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setSelectedContractorDetail(null)}
                style={{
                  padding: "10px 22px",
                  borderRadius: "10px",
                  background: "#168579",
                  color: "#fff",
                  border: 0,
                  fontWeight: 700,
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 1: CHI TIẾT GÓI THẦU (TENDER DETAILS MODAL)                         */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {detailModalTender && (
        <div className="modal-backdrop" onClick={() => { setDetailModalTender(null); syncBiddingUrl(activeTab, contractorSubTab, null); }}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "840px", padding: "28px 32px" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
              <div>
                <span
                  style={{
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: "12px",
                    fontWeight: 900,
                    color: "#168579",
                    padding: "4px 8px",
                    borderRadius: "6px",
                    background: "#eaf4f1",
                  }}
                >
                  🏷️ {detailModalTender.tbmt_code}
                </span>
                <span
                  style={{
                    marginLeft: "8px",
                    fontSize: "11px",
                    fontWeight: 800,
                    padding: "4px 8px",
                    borderRadius: "6px",
                    background: getFieldBadge(detailModalTender.field).bg,
                    color: getFieldBadge(detailModalTender.field).color,
                  }}
                >
                  {getFieldBadge(detailModalTender.field).label}
                </span>
              </div>

              <button
                onClick={() => { setDetailModalTender(null); syncBiddingUrl(activeTab, contractorSubTab, null); }}
                style={{
                  border: "0",
                  background: "#f0f4f2",
                  borderRadius: "50%",
                  width: "32px",
                  height: "32px",
                  fontSize: "16px",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>

            <h2
              style={{
                fontFamily: "Georgia, serif",
                fontSize: "22px",
                color: "#123b36",
                margin: "0 0 16px",
                lineHeight: 1.35,
              }}
            >
              {detailModalTender.tender_name}
            </h2>

            {/* Tab Navigation inside Detail Modal */}
            <div style={{ display: "flex", gap: "8px", borderBottom: "1px solid #e2ece7", marginBottom: "18px", paddingBottom: "8px" }}>
              <button
                type="button"
                onClick={() => { setDetailModalTab("info"); if (detailModalTender) syncBiddingUrl(activeTab, contractorSubTab, detailModalTender.tbmt_code, "info"); }}
                style={{
                  padding: "8px 16px",
                  borderRadius: "8px",
                  border: "none",
                  fontWeight: 700,
                  fontSize: "13px",
                  cursor: "pointer",
                  background: detailModalTab === "info" ? "#168579" : "#f0f4f2",
                  color: detailModalTab === "info" ? "#ffffff" : "#4a685f",
                  transition: "all 0.15s ease",
                }}
              >
                📋 Tóm Tắt Thông Tin
              </button>

              <button
                type="button"
                onClick={() => { setDetailModalTab("iframe"); if (detailModalTender) syncBiddingUrl(activeTab, contractorSubTab, detailModalTender.tbmt_code, "iframe"); }}
                style={{
                  padding: "8px 16px",
                  borderRadius: "8px",
                  border: "none",
                  fontWeight: 700,
                  fontSize: "13px",
                  cursor: "pointer",
                  background: detailModalTab === "iframe" ? "#168579" : "#f0f4f2",
                  color: detailModalTab === "iframe" ? "#ffffff" : "#4a685f",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  transition: "all 0.15s ease",
                }}
              >
                <span>📄</span>
                <span>Toàn Văn E-HSMT (Trình Xem iFrame)</span>
              </button>
            </div>

            {detailModalTab === "competitors" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                {/* Full Competitors ZIP Download Banner */}
                <div
                  style={{
                    background: "linear-gradient(135deg, #7c2d12, #ea580c)",
                    borderRadius: "16px",
                    padding: "20px 24px",
                    color: "#fff",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "14px",
                    boxShadow: "0 6px 20px rgba(234,88,12,0.25)",
                  }}
                >
                  <div>
                    <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 800, color: "#fff" }}>
                      📦 Tải Trọn Bộ E-HSDT Của Tất Cả Nhà Thầu Tham Gia (Full Competitors ZIP)
                    </h3>
                    <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#fed7aa" }}>
                      Bao gồm toàn bộ đề xuất kỹ thuật, biểu giá chào thầu và hồ sơ năng lực của cả 3 nhà thầu (Thắng / Xếp hạng 2 / Bị loại).
                    </p>
                  </div>

                  <a
                    href={api.bidding.getAllCompetitorsZipUrl(detailModalTender.tbmt_code)}
                    download
                    style={{
                      padding: "11px 22px",
                      borderRadius: "12px",
                      background: "#fef08a",
                      color: "#78350f",
                      textDecoration: "none",
                      fontWeight: 800,
                      fontSize: "13px",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                    }}
                  >
                    <span>📥</span>
                    <span>Tải Toàn Bộ Hồ Sơ Đối Thủ (.ZIP)</span>
                  </a>
                </div>

                {/* Competitors Dossier Cards */}
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  {(modalCompetitors.length > 0 ? modalCompetitors : [
                    { ranking: 1, status: "WON", status_label: "🥇 Trúng Thầu (Hạng 1)", contractor_name: "CÔNG TY CỔ PHẦN DỮ LIỆU TOÀN CẦU (Gdata)", tax_code: "0105365128", address: "84 Duy Tân, Cầu Giấy, Hà Nội", bid_price_formatted: formatVnd(detailModalTender.bid_price * 0.975), discount_percent: 2.5, tech_score: 96.5, eval_result: "Đạt tất cả tiêu chuẩn kỹ thuật & Đề xuất giá cạnh tranh nhất", files: [{ file_id: "tech-proposal", title: "E-HSDT Đề Xuất Kỹ Thuật & Thuyết Minh Giải Pháp", size: "2.4 MB" }, { file_id: "financial-proposal", title: "E-HSDT Đề Xuất Tài Chính & Biểu Giá Chi Tiết", size: "1.1 MB" }, { file_id: "qualifications", title: "Hồ Sơ Năng Lực & Hợp Đồng Tương Tự", size: "3.8 MB" }] },
                    { ranking: 2, status: "RUNNER_UP", status_label: "🥈 Xếp Hạng 2 (Trượt Giá)", contractor_name: "CÔNG TY TNHH GIẢI PHÁP CÔNG NGHỆ BÁCH KHOA", tax_code: "0315891240", address: "268 Lý Thường Kiệt, Quận 10, TP.HCM", bid_price_formatted: formatVnd(detailModalTender.bid_price * 0.992), discount_percent: 0.8, tech_score: 94.0, eval_result: "Đạt yêu cầu kỹ thuật nhưng giá dự thầu cao hơn nhà thầu xếp hạng 1", files: [{ file_id: "tech-proposal", title: "E-HSDT Đề Xuất Kỹ Thuật & Thiết Bị", size: "2.1 MB" }, { file_id: "financial-proposal", title: "Biểu Giá Chào Thầu & Đơn Dự Thầu", size: "950 KB" }] },
                    { ranking: 3, status: "DISQUALIFIED", status_label: "❌ Không Đạt Kỹ Thuật (Bị Loại)", contractor_name: "CÔNG TY CỔ PHẦN THIẾT BỊ ĐIỆN VÀ ĐO LƯỜNG TÂN PHÁT", tax_code: "0108923411", address: "Số 15 Lê Văn Lương, Thanh Xuân, Hà Nội", bid_price_formatted: formatVnd(detailModalTender.bid_price * 0.930), discount_percent: 7.0, tech_score: 62.0, eval_result: "Hợp đồng tương tự không đáp ứng quy mô tối thiểu và thiết bị thiếu CO/CQ", files: [{ file_id: "tech-proposal", title: "E-HSDT Hồ Sơ Kỹ Thuật Dự Thầu", size: "1.6 MB" }, { file_id: "disqualification-notice", title: "Biên Bản Đánh Giá & Thông Báo Lý Do Loại Bỏ", size: "720 KB" }] },
                  ]).map((comp) => (
                    <div
                      key={comp.tax_code}
                      style={{
                        background: "#fff",
                        borderRadius: "16px",
                        border: comp.ranking === 1 ? "1px solid #bbf7d0" : comp.ranking === 2 ? "1px solid #fed7aa" : "1px solid #fecaca",
                        padding: "18px 20px",
                        boxShadow: comp.ranking === 1 ? "0 4px 14px rgba(22,101,52,0.06)" : "0 2px 8px rgba(0,0,0,0.03)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                      }}
                    >
                      {/* Competitor Header */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                            <strong style={{ fontSize: "15px", color: "#0f172a" }}>{comp.contractor_name}</strong>
                            <span
                              style={{
                                fontSize: "11px",
                                fontWeight: 800,
                                padding: "3px 10px",
                                borderRadius: "999px",
                                background: comp.ranking === 1 ? "#dcfce7" : comp.ranking === 2 ? "#fff7ed" : "#fee2e2",
                                color: comp.ranking === 1 ? "#166534" : comp.ranking === 2 ? "#c2410c" : "#991b1b",
                                border: comp.ranking === 1 ? "1px solid #86efac" : comp.ranking === 2 ? "1px solid #fed7aa" : "1px solid #fca5a5",
                              }}
                            >
                              {comp.status_label}
                            </span>
                          </div>
                          <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                            MST: <strong style={{ color: "#334155", fontFamily: "var(--font-mono)" }}>{comp.tax_code}</strong> • {comp.address}
                          </div>
                        </div>

                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: "15px", fontWeight: 800, color: "#ea580c", fontFamily: "var(--font-mono)" }}>
                            {comp.bid_price_formatted}
                          </div>
                          <div style={{ fontSize: "11px", color: "#047857", fontWeight: 700 }}>
                            Điểm kỹ thuật: {comp.tech_score}/100 • Giảm {comp.discount_percent}%
                          </div>
                        </div>
                      </div>

                      {/* Evaluation note */}
                      <div style={{ background: "#f8fafc", padding: "10px 14px", borderRadius: "10px", fontSize: "12px", color: "#475569", border: "1px solid #f1f5f9" }}>
                        <strong>Nhận xét Tổ chuyên gia:</strong> {comp.eval_result}
                      </div>

                      {/* Individual Files of this Competitor */}
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        {comp.files.map((f: any) => (
                          <a
                            key={f.file_id}
                            href={api.bidding.getCompetitorFileDownloadUrl(detailModalTender.tbmt_code, comp.tax_code, f.file_id)}
                            download
                            style={{
                              padding: "6px 12px",
                              borderRadius: "8px",
                              border: "1px solid #cbd5e1",
                              background: "#ffffff",
                              color: "#1e293b",
                              textDecoration: "none",
                              fontSize: "11px",
                              fontWeight: 700,
                              display: "flex",
                              alignItems: "center",
                              gap: "5px",
                            }}
                          >
                            <span>📥</span>
                            <span>{f.title}</span>
                            <span style={{ color: "#94a3b8" }}>({f.size})</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : detailModalTab === "attachments" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* Full ZIP Download Banner */}
                <div
                  style={{
                    background: "linear-gradient(135deg, #0f4c3a, #168579)",
                    borderRadius: "16px",
                    padding: "20px 24px",
                    color: "#fff",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "14px",
                    boxShadow: "0 6px 20px rgba(15,76,58,0.2)",
                  }}
                >
                  <div>
                    <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 800, color: "#fff" }}>
                      📦 Tải Trọn Bộ Hồ Sơ Mời Thầu & Biểu Mẫu (Full Package ZIP)
                    </h3>
                    <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#e2e8f0" }}>
                      Gói nén ZIP bao gồm tất cả 5 file: E-HSMT Yêu cầu kỹ thuật, Tiêu chuẩn đánh giá, Biểu mẫu Word và Quyết định pháp lý.
                    </p>
                  </div>

                  <a
                    href={api.bidding.getFullDossierZipUrl(detailModalTender.tbmt_code)}
                    download
                    style={{
                      padding: "11px 22px",
                      borderRadius: "12px",
                      background: "#fef08a",
                      color: "#166534",
                      textDecoration: "none",
                      fontWeight: 800,
                      fontSize: "13px",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                    }}
                  >
                    <span>📥</span>
                    <span>Tải Toàn Bộ File (.ZIP)</span>
                  </a>
                </div>

                {/* Individual Attachments List */}
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {(modalAttachments.length > 0 ? modalAttachments : [
                    { file_id: "ehsmt-tech-specs", filename: `E-HSMT_Chuong_V_Yeu_Cau_Ky_Thuat_${detailModalTender.tbmt_code}.pdf`, title: "Chương V — Yêu Cầu Về Kỹ Thuật & Giải Pháp Công Nghệ", file_type: "pdf", file_size: "1.8 MB", badge: "E-HSMT Kỹ Thuật", icon: "📄", description: "Chi tiết yêu cầu thông số kỹ thuật thiết bị IoT Gateway, Datalogger, cảm biến và chuẩn SCADA." },
                    { file_id: "ehsmt-eval-criteria", filename: `E-HSMT_Chuong_III_Tieu_Chuan_Danh_Gia_${detailModalTender.tbmt_code}.pdf`, title: "Chương III — Tiêu Chuẩn Đánh Giá E-HSDT & Năng Lực Tài Chính", file_type: "pdf", file_size: "1.2 MB", badge: "Tiêu Chuẩn Đánh Giá", icon: "📊", description: "Tiêu chí hợp đồng tương tự, doanh thu 3 năm gần nhất và thang điểm đánh giá kỹ thuật." },
                    { file_id: "ehsmt-bidding-forms", filename: `E-HSMT_Chuong_IV_Bieu_Mau_Du_Thau_${detailModalTender.tbmt_code}.docx`, title: "Chương IV — Biểu Mẫu E-HSDT & Đơn Dự Thầu", file_type: "docx", file_size: "850 KB", badge: "File Word (DOCX)", icon: "📝", description: "Mẫu đơn dự thầu, thỏa thuận liên danh, bảo lãnh dự thầu và biểu giá chi tiết có thể chỉnh sửa." },
                    { file_id: "decision-approval", filename: `Quyet_Dinh_Phe_Duyet_E-HSMT_${detailModalTender.tbmt_code}.pdf`, title: `Quyết Định Phê Duyệt E-HSMT Số ${detailModalTender.decision_number || '104/QĐ-BMT'}`, file_type: "pdf", file_size: "650 KB", badge: "Quyết Định Pháp Lý", icon: "📜", description: "Văn bản phê duyệt pháp lý của Chủ đầu tư kèm dự toán được duyệt." },
                    { file_id: "kqlcnt-report", filename: `Bao_Cao_Danh_Gia_E-HSDT_KQLCNT_${detailModalTender.tbmt_code}.pdf`, title: "Báo Cáo Đánh Giá E-HSDT & Kết Quả Lựa Chọn Nhà Thầu (KQLCNT)", file_type: "pdf", file_size: "1.5 MB", badge: "Kết Quả Trúng Thầu", icon: "🏆", description: "Bảng tổng hợp xếp hạng nhà thầu, biên độ giảm giá và quyết định trúng thầu." },
                  ]).map((att) => (
                    <div
                      key={att.file_id}
                      style={{
                        background: "#fff",
                        borderRadius: "14px",
                        border: "1px solid #e2e8f0",
                        padding: "14px 18px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "14px",
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                        <span style={{ fontSize: "28px" }}>{att.icon || (att.file_type === "docx" ? "📝" : "📄")}</span>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                            <strong style={{ fontSize: "14px", color: "#0f172a" }}>{att.title}</strong>
                            <span style={{ fontSize: "10px", fontWeight: 800, padding: "2px 7px", borderRadius: "6px", background: att.file_type === "docx" ? "#eff6ff" : "#f0fdf4", color: att.file_type === "docx" ? "#1d4ed8" : "#15803d" }}>
                              {att.badge || att.file_type.toUpperCase()}
                            </span>
                            <span style={{ fontSize: "11px", color: "#94a3b8" }}>({att.file_size})</span>
                          </div>
                          <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                            {att.description}
                          </div>
                        </div>
                      </div>

                      <a
                        href={api.bidding.getAttachmentDownloadUrl(detailModalTender.tbmt_code, att.file_id)}
                        download
                        style={{
                          padding: "8px 16px",
                          borderRadius: "10px",
                          background: att.file_type === "docx" ? "#2563eb" : "#168579",
                          color: "#fff",
                          textDecoration: "none",
                          fontWeight: 700,
                          fontSize: "12px",
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
                        }}
                      >
                        <span>📥</span>
                        <span>{att.file_type === "docx" ? "Tải File Word" : "Tải File PDF"}</span>
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            ) : detailModalTab === "iframe" ? (
              <div style={{ marginBottom: "20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", fontSize: "12px", color: "#54736b" }}>
                  <span>Trình xem trực quan E-HSMT định dạng Cổng Mua Sắm Công:</span>
                  <a
                    href={api.bidding.getHtmlPreviewUrl(detailModalTender.tbmt_code)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "#168579", fontWeight: 700, textDecoration: "none" }}
                  >
                    🌐 Mở tab toàn màn hình ↗
                  </a>
                </div>
                <div style={{ borderRadius: "12px", overflow: "hidden", border: "1px solid #d4e3dc", height: "540px", background: "#f8fafc" }}>
                  <iframe
                    src={api.bidding.getHtmlPreviewUrl(detailModalTender.tbmt_code)}
                    style={{ width: "100%", height: "100%", border: "none" }}
                    title={`E-HSMT ${detailModalTender.tbmt_code}`}
                  />
                </div>
              </div>
            ) : (
              <>
                {/* Price Highlight Card */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: "14px",
                    padding: "16px 20px",
                    borderRadius: "14px",
                    background: "linear-gradient(135deg, #102e2c, #174f46)",
                    color: "#fff",
                    marginBottom: "20px",
                  }}
                >
                  <div>
                    <span style={{ fontSize: "11px", color: "#a5d8cc", display: "block", fontWeight: 700 }}>
                      GIÁ GÓI THẦU (DỰ TOÁN)
                    </span>
                    <strong style={{ fontSize: "22px", fontFamily: "Georgia, serif", color: "#f4c76b" }}>
                      {formatVnd(detailModalTender.bid_price)}
                    </strong>
                  </div>

                  <div>
                    <span style={{ fontSize: "11px", color: "#a5d8cc", display: "block", fontWeight: 700 }}>
                      THỜI ĐIỂM ĐÓNG THẦU
                    </span>
                    <strong style={{ fontSize: "14px", color: "#fff" }}>
                      {formatDate(detailModalTender.bid_deadline)}
                    </strong>
                  </div>

                  <div>
                    <span style={{ fontSize: "11px", color: "#a5d8cc", display: "block", fontWeight: 700 }}>
                      ĐỊA BÀN THỰC HIỆN
                    </span>
                    <strong style={{ fontSize: "14px", color: "#fff" }}>
                      {detailModalTender.province || "Toàn quốc"}
                    </strong>
                  </div>
                </div>

                {/* Specifications Grid */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "12px 18px",
                    marginBottom: "20px",
                    fontSize: "13px",
                  }}
                >
                  <div>
                    <strong style={{ color: "#168579" }}>Bên mời thầu:</strong>
                    <div style={{ color: "#22443c", marginTop: "2px" }}>{detailModalTender.procuring_entity || "—"}</div>
                  </div>

                  <div>
                    <strong style={{ color: "#168579" }}>Chủ đầu tư:</strong>
                    <div style={{ color: "#22443c", marginTop: "2px" }}>{detailModalTender.investor || "—"}</div>
                  </div>

                  <div>
                    <strong style={{ color: "#168579" }}>Hình thức lựa chọn:</strong>
                    <div style={{ color: "#22443c", marginTop: "2px" }}>{detailModalTender.bidding_method || "Đấu thầu rộng rãi qua mạng"}</div>
                  </div>

                  {detailModalTender.decision_number && (
                    <div>
                      <strong style={{ color: "#168579" }}>Số quyết định phê duyệt:</strong>
                      <div style={{ color: "#22443c", marginTop: "2px" }}>{detailModalTender.decision_number}</div>
                    </div>
                  )}

                  {detailModalTender.bid_validity_period_days != null && (
                    <div>
                      <strong style={{ color: "#168579" }}>Hiệu lực HSDT:</strong>
                      <div style={{ color: "#22443c", marginTop: "2px" }}>{detailModalTender.bid_validity_period_days} ngày</div>
                    </div>
                  )}

                  {detailModalTender.execution_period_days != null && (
                    <div>
                      <strong style={{ color: "#168579" }}>Thời gian thực hiện hợp đồng:</strong>
                      <div style={{ color: "#22443c", marginTop: "2px" }}>{detailModalTender.execution_period_days} ngày</div>
                    </div>
                  )}
                </div>

                {/* Description / Summary if available */}
                {detailModalTender.description && (
                  <div
                    style={{
                      padding: "14px 18px",
                      borderRadius: "12px",
                      background: "#f8faf9",
                      border: "1px solid #e2ece7",
                      marginBottom: "20px",
                      fontSize: "13px",
                      lineHeight: 1.6,
                      color: "#334e46",
                    }}
                  >
                    <strong style={{ display: "block", color: "#168579", marginBottom: "6px" }}>MÔ TẢ PHẠM VI CÔNG VIỆC:</strong>
                    {detailModalTender.description}
                  </div>
                )}
              </>
            )}

            {/* Actions */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "10px",
                paddingTop: "14px",
                borderTop: "1px solid #e7f0ec",
              }}
            >
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => {
                    const tender = detailModalTender;
                    setDetailModalTender(null);
                    handleOpenAiAnalysis(tender);
                  }}
                  style={{
                    padding: "10px 18px",
                    borderRadius: "10px",
                    background: "linear-gradient(110deg, #168579, #126359)",
                    color: "#fff",
                    border: "0",
                    fontWeight: 800,
                    fontSize: "13px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span>🧠</span>
                  <span>AI Phân Tích HSMT</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const tender = detailModalTender;
                    const existing = bookmarks.find((b) => b.tbmt_code === tender.tbmt_code);
                    setBookmarkModalItem({
                      tender,
                      status: existing?.status || "watching",
                      note: existing?.note || "",
                      existingId: existing?.id,
                    });
                    setDetailModalTender(null);
                  }}
                  style={{
                    padding: "10px 16px",
                    borderRadius: "10px",
                    background: "#fff8e8",
                    color: "#925f17",
                    border: "1px solid #eed6a6",
                    fontWeight: 750,
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  ⭐ Lưu vào danh sách theo dõi
                </button>
              </div>

              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => handleOpenExternalPortal(detailModalTender.tbmt_code, detailModalTender.source_url)}
                  style={{
                    fontSize: "13px",
                    fontWeight: 700,
                    color: "#168579",
                    border: "1px solid #c9e4db",
                    padding: "9px 14px",
                    borderRadius: "8px",
                    background: "#f0f8f5",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                  title="Tự động sao chép mã TBMT vào clipboard và mở Cổng Mua Sắm Công"
                >
                  <span>📋 Sao Chép Mã & Mở e-GP</span>
                  <span>↗</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 2: BÁO CÁO AI PHÂN TÍCH HSMT & ĐIỂM CHIẾN LƯỢC INUT                */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {(aiModalTender || aiModalResult || aiLoading) && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!aiLoading) {
              setAiModalTender(null);
              setAiModalResult(null);
            }
          }}
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "920px", padding: "28px 34px" }}
          >
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
              <div>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 900,
                    letterSpacing: ".15em",
                    color: "#168579",
                    textTransform: "uppercase",
                  }}
                >
                  🧠 AI TENDER STRATEGIC RADAR — INUT CORPS (MST 4401053694)
                </span>
                <h2
                  style={{
                    fontFamily: "Georgia, serif",
                    fontSize: "22px",
                    color: "#102f2b",
                    margin: "4px 0 0",
                  }}
                >
                  Phân Tích Hồ Sơ Mời Thầu & Độ Phù Hợp Chiến Lược
                </h2>
                {aiModalTender && (
                  <div style={{ fontSize: "13px", color: "#60756e", marginTop: "4px" }}>
                    Gói thầu: <strong>{aiModalTender.tender_name}</strong> ({aiModalTender.tbmt_code})
                  </div>
                )}
              </div>

              {!aiLoading && (
                <button
                  onClick={() => {
                    setAiModalTender(null);
                    setAiModalResult(null);
                  }}
                  style={{
                    border: "0",
                    background: "#f0f4f2",
                    borderRadius: "50%",
                    width: "32px",
                    height: "32px",
                    fontSize: "16px",
                    cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            {/* AI Loading State */}
            {aiLoading && (
              <div
                style={{
                  padding: "60px 20px",
                  textAlign: "center",
                  background: "linear-gradient(135deg, #f8fbf9, #fbf7ee)",
                  borderRadius: "18px",
                  border: "1px solid #dbeae2",
                }}
              >
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "50%",
                    border: "4px solid #168579",
                    borderTopColor: "transparent",
                    margin: "0 auto 18px",
                    animation: "spin 1s linear infinite",
                  }}
                />
                <h3 style={{ fontFamily: "Georgia, serif", color: "#143b38", margin: "0 0 8px" }}>
                  AI Đang Bóc Tách & Đánh Giá E-HSMT...
                </h3>
                <p style={{ maxWidth: "520px", margin: "0 auto", fontSize: "13px", color: "#627771" }}>
                  Trích xuất điều kiện năng lực, doanh thu, thời hạn nộp thầu và đối chiếu với năng lực sản xuất IoT / SCADA của INUT.
                </p>
              </div>
            )}

            {/* AI Error */}
            {aiError && (
              <div
                style={{
                  padding: "18px 22px",
                  borderRadius: "14px",
                  background: "#fdf2f2",
                  border: "1px solid #f8b4b4",
                  color: "#9b1c1c",
                  marginBottom: "20px",
                }}
              >
                <strong>Không thể phân tích:</strong> {aiError}
              </div>
            )}

            {/* AI Result Content */}
            {!aiLoading && aiModalResult && (
              <div style={{ display: "grid", gap: "18px" }}>
                {/* ─── INUT Strategic Fit Score Banner ──────────────────────────── */}
                {(() => {
                  const fit = aiModalResult.analysis.inut_fit_analysis;
                  const score = fit?.score ?? aiModalResult.analysis.inut_compatibility_score ?? 85;
                  const scoreColor = score >= 80 ? "#176448" : score >= 60 ? "#8a6417" : "#9e3e2f";
                  const scoreBg = score >= 80 ? "#dff3e9" : score >= 60 ? "#fff0ce" : "#fbe1da";

                  return (
                    <div
                      style={{
                        padding: "20px 24px",
                        borderRadius: "18px",
                        background: "linear-gradient(135deg, #102e2c, #164f45 65%, #c88a37)",
                        color: "#fff",
                        display: "grid",
                        gridTemplateColumns: "110px 1fr",
                        alignItems: "center",
                        gap: "24px",
                        boxShadow: "0 14px 40px rgba(16,46,44,0.18)",
                      }}
                    >
                      {/* Big Score Radial Badge */}
                      <div
                        style={{
                          width: "96px",
                          height: "96px",
                          borderRadius: "50%",
                          background: "rgba(255,255,255,0.12)",
                          border: "3px solid #f4c76b",
                          display: "grid",
                          placeItems: "center",
                          textAlign: "center",
                        }}
                      >
                        <div>
                          <span style={{ fontSize: "28px", fontWeight: 900, fontFamily: "Georgia, serif", color: "#f4c76b", lineHeight: 1 }}>
                            {score}
                          </span>
                          <span style={{ fontSize: "10px", display: "block", color: "#bdd6cf", letterSpacing: ".1em" }}>
                            / 100 ĐIỂM
                          </span>
                        </div>
                      </div>

                      {/* Score Summary Copy */}
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "6px" }}>
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 900,
                              padding: "4px 10px",
                              borderRadius: "999px",
                              background: scoreBg,
                              color: scoreColor,
                              letterSpacing: ".08em",
                              textTransform: "uppercase",
                            }}
                          >
                            ĐỘ PHÙ HỢP: {fit?.match_level || (score >= 80 ? "RẤT CAO" : score >= 60 ? "TRUNG BÌNH" : "THẤP")}
                          </span>

                          <span style={{ fontSize: "13px", fontWeight: 700, color: "#ffd899" }}>
                            Khuyến nghị: {fit?.recommendation || (score >= 80 ? "Nên tham gia độc lập" : "Khuyến nghị liên danh")}
                          </span>
                        </div>

                        <p style={{ margin: 0, fontSize: "13px", color: "#d2e5df", lineHeight: 1.55 }}>
                          {aiModalResult.analysis.executive_summary || aiModalResult.analysis.summary || "Đánh giá chi tiết năng lực dự thầu."}
                        </p>
                      </div>
                    </div>
                  );
                })()}

                {/* ─── Capacity & Financial Requirements 2-Column ─────────────────── */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: "16px" }}>
                  {/* Capacity & Experience */}
                  <div
                    style={{
                      padding: "18px 20px",
                      borderRadius: "14px",
                      background: "#fff",
                      border: "1px solid #dce4df",
                    }}
                  >
                    <h4 style={{ color: "#168579", fontSize: "14px", margin: "0 0 10px", display: "flex", alignItems: "center", gap: "6px" }}>
                      <span>📜</span> Yêu Cầu Năng Lực & Kinh Nghiệm
                    </h4>
                    {Array.isArray(aiModalResult.analysis.capacity_requirements) ? (
                      <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "#36534b", lineHeight: 1.6 }}>
                        {aiModalResult.analysis.capacity_requirements.map((req, idx) => (
                          <li key={idx}>{req}</li>
                        ))}
                      </ul>
                    ) : (
                      <p style={{ margin: 0, fontSize: "13px", color: "#36534b", lineHeight: 1.6 }}>
                        {aiModalResult.analysis.capacity_requirements || "Không có yêu cầu đặc biệt."}
                      </p>
                    )}
                  </div>

                  {/* Financial Requirements */}
                  <div
                    style={{
                      padding: "18px 20px",
                      borderRadius: "14px",
                      background: "#fff",
                      border: "1px solid #dce4df",
                    }}
                  >
                    <h4 style={{ color: "#168579", fontSize: "14px", margin: "0 0 10px", display: "flex", alignItems: "center", gap: "6px" }}>
                      <span>💰</span> Điều Kiện Tài Chính & Doanh Thu
                    </h4>
                    {typeof aiModalResult.analysis.financial_requirements === "object" && aiModalResult.analysis.financial_requirements !== null ? (
                      <div style={{ fontSize: "13px", color: "#36534b", display: "grid", gap: "6px" }}>
                        {aiModalResult.analysis.financial_requirements.min_annual_revenue && (
                          <div>
                            <strong>Doanh thu bình quân:</strong> {formatVnd(aiModalResult.analysis.financial_requirements.min_annual_revenue)}
                          </div>
                        )}
                        {aiModalResult.analysis.financial_requirements.bid_security_amount && (
                          <div>
                            <strong>Bảo lãnh dự thầu:</strong> {formatVnd(aiModalResult.analysis.financial_requirements.bid_security_amount)}
                          </div>
                        )}
                        {aiModalResult.analysis.financial_requirements.summary && (
                          <div style={{ color: "#617770", marginTop: "4px" }}>
                            {aiModalResult.analysis.financial_requirements.summary}
                          </div>
                        )}
                      </div>
                    ) : (
                      <p style={{ margin: 0, fontSize: "13px", color: "#36534b", lineHeight: 1.6 }}>
                        {aiModalResult.analysis.revenue_requirements || String(aiModalResult.analysis.financial_requirements || "Đáp ứng theo quy định e-GP.")}
                      </p>
                    )}
                  </div>
                </div>

                {/* ─── Strengths & Challenges / Action Plan ───────────────────────── */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: "16px" }}>
                  {/* Strengths */}
                  <div
                    style={{
                      padding: "18px 20px",
                      borderRadius: "14px",
                      background: "#f3faf7",
                      border: "1px solid #cce8dd",
                    }}
                  >
                    <h4 style={{ color: "#176448", fontSize: "14px", margin: "0 0 10px", display: "flex", alignItems: "center", gap: "6px" }}>
                      <span>✅</span> Lợi Thế Cạnh Tranh Của INUT
                    </h4>
                    <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "#235142", lineHeight: 1.6 }}>
                      {(aiModalResult.analysis.inut_fit_analysis?.strengths || aiModalResult.analysis.strengths || [
                        "Làm chủ 100% công nghệ phần cứng Gateway 4G và nền tảng Web SCADA",
                        "Giá thành sản xuất trong nước tối ưu hơn các giải pháp ngoại nhập",
                        "Đội ngũ kỹ thuật hỗ trợ triển khai và bảo hành tận nơi nhanh chóng",
                      ]).map((str, idx) => (
                        <li key={idx}>{str}</li>
                      ))}
                    </ul>
                  </div>

                  {/* Challenges & Action Plan */}
                  <div
                    style={{
                      padding: "18px 20px",
                      borderRadius: "14px",
                      background: "#fffaf0",
                      border: "1px solid #eed6a6",
                    }}
                  >
                    <h4 style={{ color: "#8a5814", fontSize: "14px", margin: "0 0 10px", display: "flex", alignItems: "center", gap: "6px" }}>
                      <span>⚠️</span> Thách Thức & Kế Hoạch Hành Động
                    </h4>
                    {aiModalResult.analysis.inut_fit_analysis?.strategic_action_plan ? (
                      <p style={{ margin: 0, fontSize: "13px", color: "#59472f", lineHeight: 1.6 }}>
                        {aiModalResult.analysis.inut_fit_analysis.strategic_action_plan}
                      </p>
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "#59472f", lineHeight: 1.6 }}>
                        {(aiModalResult.analysis.inut_fit_analysis?.challenges || aiModalResult.analysis.risks || [
                          "Kiểm tra yêu cầu số lượng hợp đồng tương tự trước khi lập E-HSDT",
                          "Liên hệ ngân hàng chuẩn bị thư bảo lãnh dự thầu trước thời hạn 48 giờ",
                        ]).map((chk, idx) => (
                          <li key={idx}>{chk}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                {/* Foot Actions */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "10px",
                    paddingTop: "14px",
                    borderTop: "1px solid #e7f0ec",
                  }}
                >
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                    <button
                      type="button"
                      onClick={() => {
                        const md = generateAiAnalysisMarkdown(aiModalTender, aiModalResult.analysis);
                        try {
                          if (navigator && navigator.clipboard) {
                            navigator.clipboard.writeText(md);
                          }
                        } catch (err) {
                          console.warn(err);
                        }
                        showToast("📋 Đã sao chép Báo Cáo Phân Tích AI HSMT (Markdown) vào Clipboard!", "success");
                      }}
                      style={{
                        padding: "10px 16px",
                        borderRadius: "10px",
                        background: "#ecfdf5",
                        color: "#065f46",
                        border: "1px solid #a7f3d0",
                        fontWeight: 800,
                        fontSize: "13px",
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                      title="Sao chép toàn bộ báo cáo phân tích AI dạng Markdown"
                    >
                      <span>📋</span>
                      <span>Xuất Báo Cáo Markdown / Sao chép</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleShareAiTelegram(aiModalTender, aiModalResult.analysis)}
                      style={{
                        padding: "10px 16px",
                        borderRadius: "10px",
                        background: "linear-gradient(135deg, #0284c7, #0369a1)",
                        color: "#fff",
                        border: 0,
                        fontWeight: 800,
                        fontSize: "13px",
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        boxShadow: "0 2px 8px rgba(2,132,199,0.25)",
                      }}
                      title="Gửi cảnh báo phân tích HSMT qua Telegram"
                    >
                      <span>✈️</span>
                      <span>Gửi cảnh báo Telegram</span>
                    </button>
                  </div>

                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                    <button
                      type="button"
                      onClick={() => {
                        if (aiModalTender) {
                          const existing = bookmarks.find((b) => b.tbmt_code === aiModalTender.tbmt_code);
                          setBookmarkModalItem({
                            tender: aiModalTender,
                            status: existing?.status || "preparing",
                            note: `[AI Score: ${aiModalResult.analysis.inut_fit_analysis?.score || 85}/100 - ${aiModalResult.analysis.inut_fit_analysis?.recommendation || "Nên tham gia"}]\n${existing?.note || ""}`,
                            existingId: existing?.id,
                          });
                          setAiModalTender(null);
                          setAiModalResult(null);
                        }
                      }}
                      style={{
                        padding: "10px 18px",
                        borderRadius: "10px",
                        background: "#168579",
                        color: "#fff",
                        border: "0",
                        fontWeight: 800,
                        fontSize: "13px",
                        cursor: "pointer",
                      }}
                    >
                      ⭐ Lưu Vào Theo Dõi
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setAiModalTender(null);
                        setAiModalResult(null);
                      }}
                      style={{
                        padding: "10px 16px",
                        borderRadius: "10px",
                        background: "#f0f4f2",
                        color: "#37544c",
                        border: "1px solid #d4dfda",
                        fontWeight: 700,
                        fontSize: "13px",
                        cursor: "pointer",
                      }}
                    >
                      Đóng
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 3: LƯU / SỬA GÓI THẦU QUAN TÂM (BOOKMARK MODAL)                     */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {bookmarkModalItem && (
        <div className="modal-backdrop" onClick={() => setBookmarkModalItem(null)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "600px", padding: "26px 30px" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
              <div>
                <span style={{ fontSize: "11px", fontWeight: 900, color: "#168579", letterSpacing: ".15em" }}>
                  ⭐ QUẢN LÝ CƠ HỘI DỰ THẦU
                </span>
                <h3 style={{ fontFamily: "Georgia, serif", fontSize: "20px", color: "#123b36", margin: "4px 0 0" }}>
                  {bookmarkModalItem.existingId ? "Cập Nhật Thông Tin Gói Thầu" : "Thêm Vào Danh Sách Quan Tâm"}
                </h3>
              </div>

              <button
                onClick={() => setBookmarkModalItem(null)}
                style={{
                  border: "0",
                  background: "#f0f4f2",
                  borderRadius: "50%",
                  width: "30px",
                  height: "30px",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ marginBottom: "16px", fontSize: "13px", color: "#476159" }}>
              <strong>{bookmarkModalItem.tender.tender_name}</strong>
              <div style={{ color: "#71857f", marginTop: "2px" }}>
                Mã TBMT: {bookmarkModalItem.tender.tbmt_code} · Giá gói: {formatVnd(bookmarkModalItem.tender.bid_price)}
              </div>
            </div>

            <div style={{ display: "grid", gap: "14px" }}>
              {/* Status Select */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#168579", marginBottom: "5px" }}>
                  TRẠNG THÁI PIPELINE DỰ THẦU:
                </label>
                <select
                  value={bookmarkModalItem.status}
                  onChange={(e) =>
                    setBookmarkModalItem({
                      ...bookmarkModalItem,
                      status: e.target.value as any,
                    })
                  }
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid #c8dbd3",
                    fontSize: "16px",
                    background: "#fff",
                  }}
                >
                  {Object.entries(BOOKMARK_STATUS_MAP).map(([sKey, sMeta]) => (
                    <option key={sKey} value={sKey}>
                      {sMeta.icon} {sMeta.label} ({sMeta.desc})
                    </option>
                  ))}
                </select>
              </div>

              {/* Note Textarea */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#168579", marginBottom: "5px" }}>
                  GHI CHÚ NỘI BỘ (CHIẾN LƯỢC / GIÁ / LIÊN DANH):
                </label>
                <textarea
                  rows={4}
                  value={bookmarkModalItem.note}
                  onChange={(e) =>
                    setBookmarkModalItem({
                      ...bookmarkModalItem,
                      note: e.target.value,
                    })
                  }
                  placeholder="Ghi chú phân công nhân sự lập E-HSDT, tính toán dự toán thiết bị, thỏa thuận liên danh..."
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid #c8dbd3",
                    fontSize: "16px",
                    fontFamily: "inherit",
                  }}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px" }}>
              <button
                type="button"
                onClick={() => setBookmarkModalItem(null)}
                style={{
                  padding: "10px 16px",
                  borderRadius: "10px",
                  background: "#f0f4f2",
                  color: "#476159",
                  border: "1px solid #d0dfd8",
                  fontWeight: 700,
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                Hủy
              </button>

              <button
                type="button"
                onClick={handleSaveBookmark}
                style={{
                  padding: "10px 20px",
                  borderRadius: "10px",
                  background: "#168579",
                  color: "#fff",
                  border: "0",
                  fontWeight: 800,
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                Lưu vào theo dõi ⭐
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 4: THÊM / SỬA QUY TẮC WATCHLIST (WATCHLIST MODAL)                    */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {watchlistModalRule && (
        <div className="modal-backdrop" onClick={() => setWatchlistModalRule(null)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "640px", padding: "26px 32px" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
              <div>
                <span style={{ fontSize: "11px", fontWeight: 900, color: "#168579", letterSpacing: ".15em" }}>
                  ⚙️ BỘ LỌC SĂN THẦU TỰ ĐỘNG
                </span>
                <h3 style={{ fontFamily: "Georgia, serif", fontSize: "20px", color: "#123b36", margin: "4px 0 0" }}>
                  {watchlistModalRule.id ? "Sửa Quy Tắc Săn Thầu" : "Tạo Quy Tắc Săn Thầu Mới"}
                </h3>
              </div>

              <button
                onClick={() => setWatchlistModalRule(null)}
                style={{
                  border: "0",
                  background: "#f0f4f2",
                  borderRadius: "50%",
                  width: "30px",
                  height: "30px",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: "grid", gap: "14px" }}>
              {/* Name */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#168579", marginBottom: "5px" }}>
                  TÊN QUY TẮC BỘ LỌC (*):
                </label>
                <input
                  type="text"
                  value={watchlistModalRule.name || ""}
                  onChange={(e) => setWatchlistModalRule({ ...watchlistModalRule, name: e.target.value })}
                  placeholder="VD: Thiết bị SCADA & IoT TP.HCM"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid #c8dbd3",
                    fontSize: "16px",
                  }}
                />
              </div>

              {/* Keyword & Field Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#168579", marginBottom: "5px" }}>
                    TỪ KHÓA TÌM KIẾM:
                  </label>
                  <input
                    type="text"
                    value={watchlistModalRule.keyword || ""}
                    onChange={(e) => setWatchlistModalRule({ ...watchlistModalRule, keyword: e.target.value })}
                    placeholder="VD: SCADA, IoT, quan trắc"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: "10px",
                      border: "1px solid #c8dbd3",
                      fontSize: "16px",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#168579", marginBottom: "5px" }}>
                    LĨNH VỰC:
                  </label>
                  <select
                    value={watchlistModalRule.field || ""}
                    onChange={(e) => setWatchlistModalRule({ ...watchlistModalRule, field: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: "10px",
                      border: "1px solid #c8dbd3",
                      fontSize: "16px",
                      background: "#fff",
                    }}
                  >
                    {FIELDS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Province */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#168579", marginBottom: "5px" }}>
                  TỈNH / THÀNH PHỐ MỤC TIÊU:
                </label>
                <select
                  value={watchlistModalRule.province || ""}
                  onChange={(e) => setWatchlistModalRule({ ...watchlistModalRule, province: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid #c8dbd3",
                    fontSize: "16px",
                    background: "#fff",
                  }}
                >
                  {PROVINCES.map((p) => (
                    <option key={p} value={p === "Tất cả" ? "" : p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              {/* Min - Max Price */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#168579", marginBottom: "5px" }}>
                    GIÁ TỐI THIỂU (VND):
                  </label>
                  <input
                    type="number"
                    value={watchlistModalRule.min_price ?? ""}
                    onChange={(e) =>
                      setWatchlistModalRule({
                        ...watchlistModalRule,
                        min_price: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    placeholder="0"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: "10px",
                      border: "1px solid #c8dbd3",
                      fontSize: "16px",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "#168579", marginBottom: "5px" }}>
                    GIÁ TỐI ĐA (VND):
                  </label>
                  <input
                    type="number"
                    value={watchlistModalRule.max_price ?? ""}
                    onChange={(e) =>
                      setWatchlistModalRule({
                        ...watchlistModalRule,
                        max_price: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    placeholder="Không giới hạn"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: "10px",
                      border: "1px solid #c8dbd3",
                      fontSize: "16px",
                    }}
                  />
                </div>
              </div>

              {/* Toggles */}
              <div
                style={{
                  display: "flex",
                  gap: "20px",
                  padding: "12px 14px",
                  borderRadius: "10px",
                  background: "#f9fcfa",
                  border: "1px solid #e7f0ec",
                }}
              >
                <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={watchlistModalRule.is_active ?? true}
                    onChange={(e) => setWatchlistModalRule({ ...watchlistModalRule, is_active: e.target.checked })}
                    style={{ width: "16px", height: "16px" }}
                  />
                  <span>Kích hoạt tự động quét</span>
                </label>

                <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: 700, color: "#0088cc", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={watchlistModalRule.notify_telegram ?? true}
                    onChange={(e) => setWatchlistModalRule({ ...watchlistModalRule, notify_telegram: e.target.checked })}
                    style={{ width: "16px", height: "16px" }}
                  />
                  <span>✈️ Bắn tin cảnh báo Telegram</span>
                </label>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px" }}>
              <button
                type="button"
                onClick={() => setWatchlistModalRule(null)}
                style={{
                  padding: "10px 16px",
                  borderRadius: "10px",
                  background: "#f0f4f2",
                  color: "#476159",
                  border: "1px solid #d0dfd8",
                  fontWeight: 700,
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                Hủy
              </button>

              <button
                type="button"
                onClick={handleSaveWatchlistRule}
                style={{
                  padding: "10px 20px",
                  borderRadius: "10px",
                  background: "#168579",
                  color: "#fff",
                  border: "0",
                  fontWeight: 800,
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                {watchlistModalRule.id ? "Lưu thay đổi" : "Tạo quy tắc mới"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
