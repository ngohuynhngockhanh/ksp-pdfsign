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
  type BiddingDossierReviewItem,
  type BiddingDossierReviewDetail,
  type BiddingDossierFileReviewItem,
  type BiddingDossierItemReviewItem,
} from "../api";
import {
  AppModal,
  DataView,
  FormGrid,
  PromptDialog,
  ResponsiveTabs,
} from "../components/ui";
import { openExternalSafe, safeHttpUrl } from "../utils/url";

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
  HH: { label: "Hàng hóa", color: "var(--primary-dark)", bg: "var(--primary-soft)" },
  "Hàng hóa": { label: "Hàng hóa", color: "var(--primary-dark)", bg: "var(--primary-soft)" },
  XL: { label: "Xây lắp", color: "color-mix(in srgb, var(--amber) 74%, var(--ink))", bg: "color-mix(in srgb, var(--gold) 18%, var(--panel))" },
  "Xây lắp": { label: "Xây lắp", color: "color-mix(in srgb, var(--amber) 74%, var(--ink))", bg: "color-mix(in srgb, var(--gold) 18%, var(--panel))" },
  TV: { label: "Tư vấn", color: "var(--ink)", bg: "var(--mint, var(--primary-soft))" },
  "Tư vấn": { label: "Tư vấn", color: "var(--ink)", bg: "var(--mint, var(--primary-soft))" },
  PTV: { label: "Phi tư vấn", color: "color-mix(in srgb, var(--red) 82%, var(--ink))", bg: "color-mix(in srgb, var(--coral) 15%, var(--panel))" },
  "Phi tư vấn": { label: "Phi tư vấn", color: "color-mix(in srgb, var(--red) 82%, var(--ink))", bg: "color-mix(in srgb, var(--coral) 15%, var(--panel))" },
  HHOP: { label: "Hỗn hợp", color: "var(--ink-2, var(--text))", bg: "var(--surface-subtle, var(--paper))" },
  "Hỗn hợp": { label: "Hỗn hợp", color: "var(--ink-2, var(--text))", bg: "var(--surface-subtle, var(--paper))" },
};

function getFieldBadge(field?: string) {
  if (!field) return { label: "Khác", color: "var(--ink-2, var(--text))", bg: "var(--surface-subtle, var(--paper))" };
  return FIELD_MAP[field] || { label: field, color: "var(--primary-dark)", bg: "var(--primary-soft)" };
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
  const badgeColor = isHigh
    ? "color-mix(in srgb, var(--green) 76%, var(--ink))"
    : isMid
    ? "color-mix(in srgb, var(--amber) 74%, var(--ink))"
    : "color-mix(in srgb, var(--red) 82%, var(--ink))";
  const badgeBg = isHigh
    ? "color-mix(in srgb, var(--green) 14%, var(--panel))"
    : isMid
    ? "color-mix(in srgb, var(--gold) 18%, var(--panel))"
    : "color-mix(in srgb, var(--red) 12%, var(--panel))";
  const badgeBorder = isHigh
    ? "color-mix(in srgb, var(--green) 36%, var(--border))"
    : isMid
    ? "color-mix(in srgb, var(--gold) 45%, var(--border))"
    : "color-mix(in srgb, var(--red) 35%, var(--border))";
  const barGradient = isHigh
    ? "linear-gradient(90deg, var(--green) 0%, var(--primary) 100%)"
    : isMid
    ? "linear-gradient(90deg, var(--gold) 0%, var(--amber) 100%)"
    : "linear-gradient(90deg, var(--coral) 0%, var(--red) 100%)";

  const height = size === "lg" ? "12px" : size === "sm" ? "7px" : "9px";

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "5px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px", flexWrap: "wrap", fontSize: size === "lg" ? "13px" : "11px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontWeight: 700, color: "var(--ink-2, var(--text))" }}>
            🏆 Trúng: <strong style={{ color: "var(--ink)" }}>{won}</strong> / {total} gói
          </span>
          {lost > 0 && (
            <span style={{ fontSize: "10px", color: "var(--muted)" }}>
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
          background: "var(--border)",
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
  const [activeTab, setActiveTab] = useState<"search" | "bookmarks" | "watchlist" | "contractors" | "dossier_reviews">("search");

  // Tab 5: Dossier Reviews State (Thẩm Định Hồ Sơ Thầu Toàn Diện)
  const [dossierReviews, setDossierReviews] = useState<BiddingDossierReviewItem[]>([]);
  const [activeDossierReview, setActiveDossierReview] = useState<BiddingDossierReviewDetail | null>(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [dossierSubTab, setDossierSubTab] = useState<"executive" | "files" | "items" | "pricing">("executive");
  const [showImportDriveModal, setShowImportDriveModal] = useState(false);
  const [importDriveUrl, setImportDriveUrl] = useState("https://drive.google.com/drive/folders/1l17rxMHd4-B988GJ3cwIBmFGCC3oazHV");
  const [importDriveNotes, setImportDriveNotes] = useState("");
  const [importDriveLoading, setImportDriveLoading] = useState(false);
  const [dossierCopiedToast, setDossierCopiedToast] = useState(false);

  const fetchDossierReviews = async (selectFirst = true) => {
    setDossierLoading(true);
    try {
      const rawList = await api.bidding.listDossierReviews();
      const list = Array.isArray(rawList) ? rawList : ((rawList as any)?.items || []);
      setDossierReviews(list);
      if (selectFirst && list.length > 0) {
        const detail = await api.bidding.getDossierReview(list[0].id);
        setActiveDossierReview(detail);
      }
    } catch (e: any) {
      console.error("Lỗi tải danh sách thẩm định thầu:", e);
    } finally {
      setDossierLoading(false);
    }
  };

  const handleSelectDossierReview = async (id: number) => {
    setDossierLoading(true);
    try {
      const detail = await api.bidding.getDossierReview(id);
      setActiveDossierReview(detail);
    } catch (e: any) {
      alert("Lỗi tải chi tiết thẩm định: " + e.message);
    } finally {
      setDossierLoading(false);
    }
  };

  const handleImportDossierFromDrive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importDriveUrl.trim()) return;
    setImportDriveLoading(true);
    try {
      const res = await api.bidding.importDossierFromDrive(importDriveUrl, importDriveNotes);
      setShowImportDriveModal(false);
      alert("✓ " + res.message);
      await fetchDossierReviews(true);
    } catch (e: any) {
      alert("Lỗi nhập hồ sơ thầu: " + e.message);
    } finally {
      setImportDriveLoading(false);
    }
  };

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
  const [notePromptBookmark, setNotePromptBookmark] = useState<BiddingBookmarkItem | null>(null);

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
    } else if (pathname.includes("/dossier") || pathname.includes("/tham-dinh") || pathname.includes("/review")) {
      setActiveTab("dossier_reviews");
      fetchDossierReviews(true);
    } else if (pathname.includes("/search") || pathname.includes("/tra-cuu")) {
      setActiveTab("search");
    }
    fetchDossierReviews(false);
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
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(safeHttpUrl(tender?.source_url) || "https://muasamcong.mpi.gov.vn")}&text=${encodeURIComponent(tgText)}`;
    openExternalSafe(shareUrl);
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
    openExternalSafe(shareUrl);
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
    tab: "search" | "bookmarks" | "watchlist" | "contractors" | "dossier_reviews",
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
    } else if (tab === "dossier_reviews") {
      path = "/bidding/dossier-reviews";
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
    openExternalSafe(safeHttpUrl(sourceUrl) || "https://muasamcong.mpi.gov.vn/web/guest/contractor-selection");
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
            bottom: "max(16px, env(safe-area-inset-bottom))",
            right: "16px",
            maxWidth: "calc(100vw - 32px)",
            zIndex: 9999,
            padding: "14px 20px",
            borderRadius: "14px",
            color: "#fff",
            background: toast.type === "success" ? "var(--primary)" : toast.type === "error" ? "var(--red)" : "var(--ink)",
            boxShadow: "var(--shadow-md)",
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
          <span className="eyebrow" style={{ color: "var(--mint, var(--primary-soft))", fontSize: "11px", letterSpacing: ".18em", fontWeight: 900 }}>
            MẠNG ĐẤU THẦU QUỐC GIA (E-GP) — MUASAMCONG.MPI.GOV.VN
          </span>
          <h1 style={{ fontFamily: "var(--font-serif, Georgia, serif)", margin: "6px 0 10px", fontSize: "clamp(26px, 3.5vw, 42px)" }}>
            Săn Gói Thầu & Phân Tích E-HSMT Bằng AI
          </h1>
          <p style={{ maxWidth: "780px", color: "rgba(255, 255, 255, 0.84)", fontSize: "14px", lineHeight: 1.6 }}>
            Hệ thống tự động quét, trích xuất dữ liệu năng lực, tính điểm tương thích chiến lược INUT{" "}
            <strong style={{ color: "var(--gold)" }}>(MST 4401053694)</strong> và gửi cảnh báo thời gian thực qua Telegram Bot.
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", zIndex: 1 }}>
          <button
            className="btn"
            onClick={handleScanAll}
            disabled={scanningId !== null}
            style={{
              background: "linear-gradient(135deg, var(--gold), color-mix(in srgb, var(--amber) 85%, var(--gold)))",
              color: "var(--ink)",
              border: "0",
              fontWeight: 800,
              minHeight: "44px",
              padding: "11px 18px",
              borderRadius: "12px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              boxShadow: "var(--shadow)",
              cursor: "pointer",
            }}
          >
            <span>{scanningId === "all" ? "⏳ Đang quét..." : "⚡ Quét Tự Động Ngay"}</span>
          </button>
        </div>
      </section>

      {/* ─── Main Navigation Tabs ──────────────────────────────────────────────── */}
      <div style={{ marginBottom: "20px" }}>
        <ResponsiveTabs
          ariaLabel="Chuyển mục săn thầu & thẩm định"
          active={activeTab}
          onChange={(tabId) => {
            setActiveTab(tabId);
            syncBiddingUrl(tabId, contractorSubTab);
            if (tabId === "bookmarks") {
              fetchBookmarks();
            } else if (tabId === "contractors") {
              if (!crmScanResult) handleScanCrmContractors();
              if (!wonPackagesResult) handleFetchWonPackages();
            } else if (tabId === "watchlist") {
              fetchWatchlist();
            } else if (tabId === "dossier_reviews") {
              fetchDossierReviews();
            }
          }}
          tabs={[
            {
              id: "search",
              label: "🔎 Tra Cứu Gói Thầu",
              badge: searchResult ? searchResult.total : undefined,
            },
            {
              id: "bookmarks",
              label: "⭐ Gói Thầu Quan Tâm",
              badge: bookmarks.length,
            },
            {
              id: "contractors",
              label: "🏢 Năng Lực Nhà Thầu & CRM",
              badge: crmScanResult ? crmScanResult.total_won_contractors : "CRM",
            },
            {
              id: "watchlist",
              label: "⚙️ Bộ Lọc Tự Động & Cảnh Báo",
              badge: watchlists.length,
            },
            {
              id: "dossier_reviews",
              label: "📑 Thẩm Định Hồ Sơ Thầu",
              badge: dossierReviews.length > 0 ? `${dossierReviews[0].overall_score}/100` : "Mới",
            },
          ]}
        />
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
              background: "var(--panel)",
              borderRadius: "18px",
              padding: "clamp(14px, 2.5vw, 22px)",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow)",
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
                <div style={{ flex: "1 1 240px", minWidth: 0, position: "relative" }}>
                  <input
                    className="ui-input"
                    type="text"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="Nhập tên gói thầu, số TBMT (VD: IB2600...), bên mời thầu, từ khóa IoT / SCADA..."
                    style={{
                      width: "100%",
                      minHeight: "44px",
                      padding: "11px 16px",
                      borderRadius: "12px",
                      border: "1px solid var(--border-strong)",
                      background: "var(--panel)",
                      color: "var(--ink)",
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
                      minHeight: "44px",
                      padding: "11px 22px",
                      borderRadius: "12px",
                      background: "var(--primary)",
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
                      minHeight: "44px",
                      padding: "11px 16px",
                      borderRadius: "12px",
                      background: showAdvancedFilters ? "var(--primary-soft)" : "var(--surface-subtle, var(--paper))",
                      color: showAdvancedFilters ? "var(--primary-dark)" : "var(--ink-2, var(--text))",
                      border: "1px solid var(--border-strong)",
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
                        minHeight: "44px",
                        padding: "11px 14px",
                        borderRadius: "12px",
                        background: "transparent",
                        color: "color-mix(in srgb, var(--red) 82%, var(--ink))",
                        border: "1px solid color-mix(in srgb, var(--red) 35%, var(--border))",
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
                    borderTop: "1px dashed var(--border)",
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))",
                    gap: "14px",
                  }}
                >
                  {/* Province */}
                  <div style={{ minWidth: 0 }}>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 800, color: "var(--primary-dark)", marginBottom: "5px" }}>
                      📍 TỈNH / THÀNH PHỐ
                    </label>
                    <select
                      className="ui-select"
                      value={province}
                      onChange={(e) => setProvince(e.target.value)}
                      style={{
                        width: "100%",
                        minHeight: "44px",
                        padding: "10px 12px",
                        borderRadius: "10px",
                        border: "1px solid var(--border-strong)",
                        background: "var(--panel)",
                        color: "var(--ink)",
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
                  <div style={{ minWidth: 0 }}>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 800, color: "var(--primary-dark)", marginBottom: "5px" }}>
                      📂 LĨNH VỰC
                    </label>
                    <select
                      className="ui-select"
                      value={field}
                      onChange={(e) => setField(e.target.value)}
                      style={{
                        width: "100%",
                        minHeight: "44px",
                        padding: "10px 12px",
                        borderRadius: "10px",
                        border: "1px solid var(--border-strong)",
                        background: "var(--panel)",
                        color: "var(--ink)",
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
                  <div style={{ minWidth: 0 }}>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 800, color: "var(--primary-dark)", marginBottom: "5px" }}>
                      ⏳ TRẠNG THÁI MỞ / ĐÓNG THẦU
                    </label>
                    <select
                      className="ui-select"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value as any)}
                      style={{
                        width: "100%",
                        minHeight: "44px",
                        padding: "10px 12px",
                        borderRadius: "10px",
                        border: "1px solid var(--border-strong)",
                        background: "var(--panel)",
                        color: "var(--ink)",
                      }}
                    >
                      <option value="all">Tất cả trạng thái</option>
                      <option value="open">Đang mở thầu (Còn hạn)</option>
                      <option value="closed">Đã đóng thầu</option>
                    </select>
                  </div>

                  {/* Price Presets & Range */}
                  <div style={{ gridColumn: "1 / -1", minWidth: 0 }}>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: 800, color: "var(--primary-dark)", marginBottom: "6px" }}>
                      💰 KHOẢNG GIÁ GÓI THẦU (VND)
                    </label>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="ui-btn-chip"
                          onClick={() => handleSetPricePreset(0, 500_000_000)}
                          style={{
                            minHeight: "40px",
                            padding: "8px 12px",
                            borderRadius: "999px",
                            fontSize: "12px",
                            fontWeight: 700,
                            border: "1px solid var(--border-strong)",
                            background: minPrice === 0 && maxPrice === 500_000_000 ? "var(--primary)" : "var(--panel)",
                            color: minPrice === 0 && maxPrice === 500_000_000 ? "#fff" : "var(--ink-2, var(--text))",
                            cursor: "pointer",
                          }}
                        >
                          &lt; 500 Triệu
                        </button>
                        <button
                          type="button"
                          className="ui-btn-chip"
                          onClick={() => handleSetPricePreset(500_000_000, 2_000_000_000)}
                          style={{
                            minHeight: "40px",
                            padding: "8px 12px",
                            borderRadius: "999px",
                            fontSize: "12px",
                            fontWeight: 700,
                            border: "1px solid var(--border-strong)",
                            background: minPrice === 500_000_000 && maxPrice === 2_000_000_000 ? "var(--primary)" : "var(--panel)",
                            color: minPrice === 500_000_000 && maxPrice === 2_000_000_000 ? "#fff" : "var(--ink-2, var(--text))",
                            cursor: "pointer",
                          }}
                        >
                          500 Tr – 2 Tỷ
                        </button>
                        <button
                          type="button"
                          className="ui-btn-chip"
                          onClick={() => handleSetPricePreset(2_000_000_000, 10_000_000_000)}
                          style={{
                            minHeight: "40px",
                            padding: "8px 12px",
                            borderRadius: "999px",
                            fontSize: "12px",
                            fontWeight: 700,
                            border: "1px solid var(--border-strong)",
                            background: minPrice === 2_000_000_000 && maxPrice === 10_000_000_000 ? "var(--primary)" : "var(--panel)",
                            color: minPrice === 2_000_000_000 && maxPrice === 10_000_000_000 ? "#fff" : "var(--ink-2, var(--text))",
                            cursor: "pointer",
                          }}
                        >
                          2 Tỷ – 10 Tỷ
                        </button>
                        <button
                          type="button"
                          className="ui-btn-chip"
                          onClick={() => handleSetPricePreset(10_000_000_000, "")}
                          style={{
                            minHeight: "40px",
                            padding: "8px 12px",
                            borderRadius: "999px",
                            fontSize: "12px",
                            fontWeight: 700,
                            border: "1px solid var(--border-strong)",
                            background: minPrice === 10_000_000_000 && maxPrice === "" ? "var(--primary)" : "var(--panel)",
                            color: minPrice === 10_000_000_000 && maxPrice === "" ? "#fff" : "var(--ink-2, var(--text))",
                            cursor: "pointer",
                          }}
                        >
                          &gt; 10 Tỷ (Liên danh)
                        </button>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", marginLeft: "auto", maxWidth: "100%" }}>
                        <input
                          className="ui-input"
                          type="number"
                          value={minPrice}
                          onChange={(e) => setMinPrice(e.target.value ? Number(e.target.value) : "")}
                          placeholder="Giá từ (VND)"
                          style={{
                            width: "min(100%, 150px)",
                            minHeight: "44px",
                            padding: "8px 10px",
                            borderRadius: "8px",
                            border: "1px solid var(--border-strong)",
                            background: "var(--panel)",
                            color: "var(--ink)",
                          }}
                        />
                        <span>–</span>
                        <input
                          className="ui-input"
                          type="number"
                          value={maxPrice}
                          onChange={(e) => setMaxPrice(e.target.value ? Number(e.target.value) : "")}
                          placeholder="Đến (VND)"
                          style={{
                            width: "min(100%, 150px)",
                            minHeight: "44px",
                            padding: "8px 10px",
                            borderRadius: "8px",
                            border: "1px solid var(--border-strong)",
                            background: "var(--panel)",
                            color: "var(--ink)",
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
            <div style={{ fontSize: "14px", color: "var(--ink-2, var(--text))" }}>
              {searchLoading ? (
                <span>⏳ Đang kết nối Mạng Đấu Thầu Quốc Gia...</span>
              ) : searchResult ? (
                <span>
                  Tìm thấy <strong style={{ color: "var(--primary-dark)" }}>{searchResult.total}</strong> gói thầu phù hợp
                  {searchResult.is_mock && (
                    <span
                      style={{
                        marginLeft: "8px",
                        padding: "2px 8px",
                        borderRadius: "999px",
                        fontSize: "11px",
                        background: "color-mix(in srgb, var(--gold) 18%, var(--panel))",
                        color: "color-mix(in srgb, var(--amber) 74%, var(--ink))",
                        border: "1px solid color-mix(in srgb, var(--gold) 45%, var(--border))",
                      }}
                    >
                      🧪 Smart Resilient Mock
                    </span>
                  )}
                </span>
              ) : null}
            </div>

            {searchResult && searchResult.total_pages > 1 && (
              <div style={{ fontSize: "12px", color: "var(--muted)" }}>
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
                background: "color-mix(in srgb, var(--red) 10%, var(--panel))",
                border: "1px solid color-mix(in srgb, var(--red) 35%, var(--border))",
                color: "color-mix(in srgb, var(--red) 82%, var(--ink))",
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
                    padding: "clamp(14px, 2.5vw, 22px)",
                    borderRadius: "16px",
                    background: "var(--panel)",
                    border: "1px solid var(--border)",
                    boxShadow: "var(--shadow)",
                  }}
                >
                  <div style={{ height: "20px", width: "40%", background: "var(--surface-subtle, var(--paper))", borderRadius: "4px", marginBottom: "12px" }} />
                  <div style={{ height: "28px", width: "80%", background: "var(--surface-subtle, var(--paper))", borderRadius: "4px", marginBottom: "16px" }} />
                  <div style={{ height: "16px", width: "60%", background: "var(--surface-subtle, var(--paper))", borderRadius: "4px" }} />
                </div>
              ))}
            </div>
          )}

          {/* Empty Results */}
          {!searchLoading && searchResult && searchResult.items.length === 0 && (
            <div
              style={{
                padding: "clamp(24px, 5vw, 48px) 20px",
                textAlign: "center",
                background: "var(--panel)",
                borderRadius: "20px",
                border: "1px dashed var(--border-strong)",
                color: "var(--muted)",
              }}
            >
              <div style={{ fontSize: "42px", marginBottom: "10px" }}>🏛️</div>
              <h3 style={{ fontFamily: "var(--font-serif, Georgia, serif)", color: "var(--ink)", margin: "0 0 8px" }}>
                Không tìm thấy gói thầu phù hợp
              </h3>
              <p style={{ maxWidth: "480px", margin: "0 auto 16px", fontSize: "13px" }}>
                Hãy thử mở rộng tiêu chí tìm kiếm, xóa bớt bộ lọc khoảng giá hoặc thử các từ khóa chuyên ngành như "SCADA", "IoT", "quan trắc", "tủ điện".
              </p>
              <button
                className="btn"
                onClick={handleResetFilters}
                style={{
                  background: "var(--primary)",
                  color: "#fff",
                  minHeight: "44px",
                  padding: "10px 18px",
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
                      background: "var(--panel)",
                      borderRadius: "18px",
                      padding: "clamp(14px, 2.5vw, 22px)",
                      border: "1px solid var(--border)",
                      boxShadow: "var(--shadow)",
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
                            background: "var(--primary-soft)",
                            color: "var(--primary-dark)",
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
                              background: "var(--surface-subtle, var(--paper))",
                              color: "var(--ink-2, var(--text))",
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
                                ? "color-mix(in srgb, var(--red) 12%, var(--panel))"
                                : deadlineMeta.status === "urgent"
                                ? "color-mix(in srgb, var(--gold) 20%, var(--panel))"
                                : "color-mix(in srgb, var(--green) 14%, var(--panel))",
                            color:
                              deadlineMeta.status === "closed"
                                ? "color-mix(in srgb, var(--red) 82%, var(--ink))"
                                : deadlineMeta.status === "urgent"
                                ? "color-mix(in srgb, var(--amber) 74%, var(--ink))"
                                : "color-mix(in srgb, var(--green) 76%, var(--ink))",
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
                        fontFamily: "var(--font-serif, Georgia, serif)",
                        fontSize: "18px",
                        fontWeight: 600,
                        color: "var(--ink)",
                        margin: "0 0 12px",
                        lineHeight: 1.4,
                        cursor: "pointer",
                        overflowWrap: "anywhere",
                      }}
                      title="Bấm xem chi tiết gói thầu"
                    >
                      {item.tender_name}
                    </h3>

                    {/* Meta Grid */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
                        gap: "8px 18px",
                        padding: "14px 16px",
                        borderRadius: "12px",
                        background: "var(--surface-subtle, var(--paper))",
                        border: "1px solid var(--border)",
                        marginBottom: "16px",
                        fontSize: "13px",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <span style={{ color: "var(--muted)", fontSize: "11px", display: "block", fontWeight: 700 }}>
                          🏢 BÊN MỜI THẦU
                        </span>
                        <strong style={{ color: "var(--ink)" }}>{item.procuring_entity || "—"}</strong>
                      </div>

                      {item.investor && (
                        <div style={{ minWidth: 0 }}>
                          <span style={{ color: "var(--muted)", fontSize: "11px", display: "block", fontWeight: 700 }}>
                            🏛️ CHỦ ĐẦU TƯ
                          </span>
                          <span style={{ color: "var(--ink-2, var(--text))" }}>{item.investor}</span>
                        </div>
                      )}

                      <div style={{ minWidth: 0 }}>
                        <span style={{ color: "var(--muted)", fontSize: "11px", display: "block", fontWeight: 700 }}>
                          💰 GIÁ GÓI THẦU (DỰ TOÁN)
                        </span>
                        <strong
                          style={{
                            color: "var(--primary-dark)",
                            fontSize: "16px",
                            fontFamily: "var(--font-serif, Georgia, serif)",
                            fontWeight: 700,
                          }}
                        >
                          {formatVnd(item.bid_price)}
                        </strong>
                      </div>

                      <div style={{ minWidth: 0 }}>
                        <span style={{ color: "var(--muted)", fontSize: "11px", display: "block", fontWeight: 700 }}>
                          ⏳ THỜI ĐIỂM ĐÓNG THẦU
                        </span>
                        <span style={{ color: "var(--ink)", fontWeight: 600 }}>{formatDate(item.bid_deadline)}</span>
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
                          className="ui-btn-chip"
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
                            minHeight: "44px",
                            padding: "9px 14px",
                            borderRadius: "10px",
                            fontSize: "12px",
                            fontWeight: 750,
                            border: "1px solid var(--border-strong)",
                            background: isBookmarked ? "color-mix(in srgb, var(--gold) 18%, var(--panel))" : "var(--panel)",
                            color: isBookmarked ? "color-mix(in srgb, var(--amber) 74%, var(--ink))" : "var(--ink)",
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
                          className="ui-btn-chip"
                          onClick={() => handleOpenAiAnalysis(item)}
                          style={{
                            minHeight: "44px",
                            padding: "9px 15px",
                            borderRadius: "10px",
                            fontSize: "12px",
                            fontWeight: 800,
                            border: "1px solid color-mix(in srgb, var(--primary) 35%, var(--border))",
                            background: "linear-gradient(110deg, var(--primary-soft), var(--paper))",
                            color: "var(--primary-dark)",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            boxShadow: "var(--shadow)",
                          }}
                        >
                          <span>🧠</span>
                          <span>AI Phân tích</span>
                        </button>

                        {/* Details Button */}
                        <button
                          className="ui-btn-chip"
                          onClick={() => handleOpenTenderDetail(item.tbmt_code)}
                          style={{
                            minHeight: "44px",
                            padding: "9px 13px",
                            borderRadius: "10px",
                            fontSize: "12px",
                            fontWeight: 700,
                            border: "1px solid var(--border-strong)",
                            background: "var(--panel)",
                            color: "var(--ink-2, var(--text))",
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
                          className="ui-btn-chip"
                          onClick={() => handleOpenExternalPortal(item.tbmt_code, item.source_url)}
                          style={{
                            minHeight: "44px",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                            fontSize: "12px",
                            fontWeight: 700,
                            color: "var(--primary-dark)",
                            border: "1px solid color-mix(in srgb, var(--primary) 30%, var(--border))",
                            padding: "9px 14px",
                            borderRadius: "10px",
                            background: "var(--primary-soft)",
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
                className="ui-btn-chip"
                disabled={page <= 1}
                onClick={() => handleSearch(1)}
                style={{
                  minHeight: "44px",
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: "1px solid var(--border-strong)",
                  background: "var(--panel)",
                  color: "var(--ink)",
                  cursor: page <= 1 ? "not-allowed" : "pointer",
                  opacity: page <= 1 ? 0.5 : 1,
                  fontWeight: 700,
                  fontSize: "12px",
                }}
              >
                « Đầu
              </button>

              <button
                className="ui-btn-chip"
                disabled={page <= 1}
                onClick={() => handleSearch(page - 1)}
                style={{
                  minHeight: "44px",
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: "1px solid var(--border-strong)",
                  background: "var(--panel)",
                  color: "var(--ink)",
                  cursor: page <= 1 ? "not-allowed" : "pointer",
                  opacity: page <= 1 ? 0.5 : 1,
                  fontWeight: 700,
                  fontSize: "12px",
                }}
              >
                ‹ Trước
              </button>

              <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--primary-dark)", padding: "0 8px" }}>
                Trang {page} / {searchResult.total_pages}
              </span>

              <button
                className="ui-btn-chip"
                disabled={page >= searchResult.total_pages}
                onClick={() => handleSearch(page + 1)}
                style={{
                  minHeight: "44px",
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: "1px solid var(--border-strong)",
                  background: "var(--panel)",
                  color: "var(--ink)",
                  cursor: page >= searchResult.total_pages ? "not-allowed" : "pointer",
                  opacity: page >= searchResult.total_pages ? 0.5 : 1,
                  fontWeight: 700,
                  fontSize: "12px",
                }}
              >
                Sau ›
              </button>

              <button
                className="ui-btn-chip"
                disabled={page >= searchResult.total_pages}
                onClick={() => handleSearch(searchResult.total_pages)}
                style={{
                  minHeight: "44px",
                  padding: "8px 14px",
                  borderRadius: "8px",
                  border: "1px solid var(--border-strong)",
                  background: "var(--panel)",
                  color: "var(--ink)",
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
              className="ui-btn-chip"
              onClick={() => setBookmarkPipelineFilter("all")}
              style={{
                minHeight: "44px",
                padding: "8px 14px",
                borderRadius: "999px",
                fontSize: "12px",
                fontWeight: 800,
                border: "1px solid",
                borderColor: bookmarkPipelineFilter === "all" ? "var(--primary)" : "var(--border-strong)",
                background: bookmarkPipelineFilter === "all" ? "var(--primary)" : "var(--panel)",
                color: bookmarkPipelineFilter === "all" ? "#fff" : "var(--ink-2, var(--text))",
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
                  className="ui-btn-chip"
                  onClick={() => setBookmarkPipelineFilter(stKey)}
                  style={{
                    minHeight: "44px",
                    padding: "8px 14px",
                    borderRadius: "999px",
                    fontSize: "12px",
                    fontWeight: 800,
                    border: "1px solid",
                    borderColor: isActive ? "var(--primary)" : "var(--border-strong)",
                    background: isActive ? "var(--primary)" : "var(--panel)",
                    color: isActive ? "#fff" : "var(--ink-2, var(--text))",
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
                      background: isActive ? "rgba(255,255,255,0.2)" : "var(--surface-subtle, var(--paper))",
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
              className="ui-input"
              type="text"
              value={bookmarkSearchKeyword}
              onChange={(e) => setBookmarkSearchKeyword(e.target.value)}
              placeholder="🔍 Tìm nhanh trong danh sách quan tâm (tên gói thầu, mã TBMT, bên mời thầu)..."
              style={{
                width: "100%",
                minHeight: "44px",
                padding: "11px 16px",
                borderRadius: "12px",
                border: "1px solid var(--border-strong)",
                background: "var(--panel)",
                color: "var(--ink)",
              }}
            />
          </div>

          {/* Bookmarks Loading / Empty */}
          {bookmarksLoading && (
            <div style={{ textAlign: "center", padding: "40px", color: "var(--muted)" }}>
              ⏳ Đang tải danh sách cơ hội dự thầu...
            </div>
          )}

          {!bookmarksLoading && filteredBookmarks.length === 0 && (
            <div
              style={{
                padding: "clamp(24px, 5vw, 48px) 20px",
                textAlign: "center",
                background: "var(--panel)",
                borderRadius: "20px",
                border: "1px dashed var(--border-strong)",
                color: "var(--muted)",
              }}
            >
              <div style={{ fontSize: "40px", marginBottom: "8px" }}>⭐</div>
              <h3 style={{ fontFamily: "var(--font-serif, Georgia, serif)", color: "var(--ink)", margin: "0 0 8px" }}>
                Chưa có gói thầu nào trong danh sách này
              </h3>
              <p style={{ maxWidth: "440px", margin: "0 auto 16px", fontSize: "13px" }}>
                Hãy chuyển sang tab <strong>🔎 Tra Cứu Gói Thầu</strong> và bấm nút "⭐ Lưu theo dõi" để thêm các gói thầu tiềm năng vào pipeline theo dõi.
              </p>
              <button
                className="btn"
                onClick={() => { setActiveTab("search"); syncBiddingUrl("search", contractorSubTab); }}
                style={{
                  background: "var(--primary)",
                  color: "#fff",
                  minHeight: "44px",
                  padding: "10px 18px",
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
                const safeSourceUrl = safeHttpUrl(b.source_url);

                return (
                  <div
                    key={b.id}
                    style={{
                      background: "var(--panel)",
                      borderRadius: "18px",
                      padding: "clamp(14px, 2.5vw, 22px)",
                      border: "1px solid var(--border)",
                      boxShadow: "var(--shadow)",
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
                            background: "var(--primary-soft)",
                            color: "var(--primary-dark)",
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
                              background: "var(--surface-subtle, var(--paper))",
                              color: "var(--ink-2, var(--text))",
                            }}
                          >
                            📍 {b.province}
                          </span>
                        )}
                      </div>

                      {/* Status Selector Dropdown */}
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        <label style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted)" }}>Pipeline:</label>
                        <select
                          className="ui-select"
                          value={b.status}
                          onChange={(e) => handleUpdateBookmarkStatus(b.id, e.target.value as any)}
                          style={{
                            minHeight: "44px",
                            padding: "8px 12px",
                            borderRadius: "8px",
                            fontWeight: 800,
                            border: "1px solid var(--border-strong)",
                            background: "var(--panel)",
                            color:
                              b.status === "won"
                                ? "color-mix(in srgb, var(--green) 76%, var(--ink))"
                                : b.status === "lost"
                                ? "color-mix(in srgb, var(--red) 82%, var(--ink))"
                                : b.status === "submitted"
                                ? "var(--primary-dark)"
                                : b.status === "preparing"
                                ? "var(--primary)"
                                : "color-mix(in srgb, var(--amber) 74%, var(--ink))",
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
                        fontFamily: "var(--font-serif, Georgia, serif)",
                        fontSize: "18px",
                        fontWeight: 600,
                        color: "var(--ink)",
                        margin: "0 0 10px",
                        cursor: "pointer",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {b.tender_name}
                    </h3>

                    {/* Metadata Strip */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))",
                        gap: "8px 16px",
                        padding: "12px 14px",
                        borderRadius: "10px",
                        background: "var(--surface-subtle, var(--paper))",
                        border: "1px solid var(--border)",
                        marginBottom: "12px",
                        fontSize: "12px",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <span style={{ color: "var(--muted)", display: "block" }}>🏢 Bên mời thầu:</span>
                        <strong style={{ color: "var(--ink)" }}>{b.procuring_entity || "—"}</strong>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <span style={{ color: "var(--muted)", display: "block" }}>💰 Giá gói thầu:</span>
                        <strong style={{ color: "var(--primary-dark)", fontSize: "15px", fontFamily: "var(--font-serif, Georgia, serif)" }}>
                          {formatVnd(b.bid_price)}
                        </strong>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <span style={{ color: "var(--muted)", display: "block" }}>⏳ Hạn nộp E-HSDT:</span>
                        <span style={{ color: "var(--ink)", fontWeight: 600 }}>
                          {formatDate(b.bid_deadline)} ({deadlineMeta.label})
                        </span>
                      </div>
                    </div>

                    {/* Internal Notes Display / Editor */}
                    <div
                      style={{
                        padding: "10px 14px",
                        borderRadius: "10px",
                        background: "var(--paper)",
                        border: "1px solid color-mix(in srgb, var(--gold) 45%, var(--border))",
                        marginBottom: "14px",
                        fontSize: "13px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "4px" }}>
                        <span style={{ fontSize: "11px", fontWeight: 800, color: "color-mix(in srgb, var(--amber) 74%, var(--ink))" }}>
                          📝 GHI CHÚ NỘI BỘ (CHIẾN LƯỢC DỰ THẦU):
                        </span>
                        <button
                          type="button"
                          className="ui-btn-chip"
                          onClick={() => setNotePromptBookmark(b)}
                          style={{
                            minHeight: "40px",
                            padding: "6px 10px",
                            borderRadius: "8px",
                            border: "1px solid color-mix(in srgb, var(--primary) 28%, var(--border))",
                            background: "var(--panel)",
                            color: "var(--primary-dark)",
                            fontSize: "12px",
                            fontWeight: 800,
                            cursor: "pointer",
                          }}
                        >
                          ✏️ Sửa ghi chú
                        </button>
                      </div>
                      <p style={{ margin: 0, color: "var(--ink-2, var(--text))", fontStyle: b.note ? "normal" : "italic" }}>
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
                          className="ui-btn-chip"
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
                            minHeight: "44px",
                            padding: "9px 14px",
                            borderRadius: "8px",
                            fontSize: "12px",
                            fontWeight: 800,
                            border: "1px solid color-mix(in srgb, var(--primary) 35%, var(--border))",
                            background: "var(--primary-soft)",
                            color: "var(--primary-dark)",
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
                          className="ui-btn-chip"
                          onClick={() => handleOpenTenderDetail(b.tbmt_code)}
                          style={{
                            minHeight: "44px",
                            padding: "9px 14px",
                            borderRadius: "8px",
                            fontSize: "12px",
                            fontWeight: 700,
                            border: "1px solid var(--border-strong)",
                            background: "var(--panel)",
                            color: "var(--ink-2, var(--text))",
                            cursor: "pointer",
                          }}
                        >
                          👁️ Chi tiết
                        </button>
                      </div>

                      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                        {safeSourceUrl ? (
                          <a
                            href={safeSourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ui-btn-chip"
                            style={{
                              minHeight: "44px",
                              display: "inline-flex",
                              alignItems: "center",
                              fontSize: "12px",
                              fontWeight: 700,
                              color: "var(--primary-dark)",
                              textDecoration: "none",
                              padding: "9px 12px",
                              borderRadius: "8px",
                              background: "var(--primary-soft)",
                            }}
                          >
                            🔗 Mua Sắm Công ↗
                          </a>
                        ) : (
                          <span
                            style={{
                              minHeight: "44px",
                              display: "inline-flex",
                              alignItems: "center",
                              fontSize: "12px",
                              fontWeight: 600,
                              color: "var(--muted)",
                              padding: "9px 12px",
                              borderRadius: "8px",
                              background: "var(--surface-subtle, var(--paper))",
                            }}
                          >
                            🔗 Không có link nguồn
                          </span>
                        )}

                        <button
                          className="ui-btn-icon"
                          onClick={() => handleDeleteBookmark(b.id, b.tender_name)}
                          style={{
                            minHeight: "44px",
                            minWidth: "44px",
                            padding: "9px 12px",
                            borderRadius: "8px",
                            fontSize: "14px",
                            fontWeight: 700,
                            border: "1px solid color-mix(in srgb, var(--red) 35%, var(--border))",
                            background: "color-mix(in srgb, var(--red) 10%, var(--panel))",
                            color: "color-mix(in srgb, var(--red) 82%, var(--ink))",
                            cursor: "pointer",
                          }}
                          title="Xóa khỏi danh sách quan tâm"
                          aria-label="Xóa khỏi danh sách quan tâm"
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
              <h2 style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontSize: "20px", margin: "0 0 4px", color: "var(--ink)" }}>
                Quy Tắc Quét Tự Động & Bắn Tin Telegram
              </h2>
              <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)" }}>
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
                  minHeight: "44px",
                  padding: "11px 18px",
                  borderRadius: "12px",
                  background: "var(--primary)",
                  color: "#fff",
                  border: "0",
                  fontWeight: 800,
                  fontSize: "13px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  boxShadow: "var(--shadow)",
                }}
              >
                <span>➕</span>
                <span>Thêm Quy Tắc Mới</span>
              </button>

              <button
                onClick={handleScanAll}
                disabled={scanningId !== null}
                style={{
                  minHeight: "44px",
                  padding: "11px 18px",
                  borderRadius: "12px",
                  background: "var(--gold)",
                  color: "var(--ink)",
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
            <div style={{ textAlign: "center", padding: "40px", color: "var(--muted)" }}>
              ⏳ Đang tải danh sách bộ lọc tự động...
            </div>
          )}

          {!watchlistLoading && watchlists.length === 0 && (
            <div
              style={{
                padding: "clamp(24px, 5vw, 48px) 20px",
                textAlign: "center",
                background: "var(--panel)",
                borderRadius: "20px",
                border: "1px dashed var(--border-strong)",
                color: "var(--muted)",
              }}
            >
              <div style={{ fontSize: "40px", marginBottom: "8px" }}>⚙️</div>
              <h3 style={{ fontFamily: "var(--font-serif, Georgia, serif)", color: "var(--ink)", margin: "0 0 8px" }}>
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
                  background: "var(--primary)",
                  color: "#fff",
                  minHeight: "44px",
                  padding: "10px 18px",
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
                    background: "var(--panel)",
                    borderRadius: "18px",
                    padding: "clamp(14px, 2.5vw, 22px)",
                    border: "1px solid var(--border)",
                    boxShadow: "var(--shadow)",
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
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "4px" }}>
                        <h3
                          style={{
                            fontFamily: "var(--font-serif, Georgia, serif)",
                            fontSize: "18px",
                            fontWeight: 600,
                            color: "var(--ink)",
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
                            background: rule.is_active
                              ? "color-mix(in srgb, var(--green) 14%, var(--panel))"
                              : "color-mix(in srgb, var(--red) 12%, var(--panel))",
                            color: rule.is_active
                              ? "color-mix(in srgb, var(--green) 76%, var(--ink))"
                              : "color-mix(in srgb, var(--red) 82%, var(--ink))",
                            textTransform: "uppercase",
                            letterSpacing: ".06em",
                          }}
                        >
                          {rule.is_active ? "● Đang hoạt động" : "○ Tạm dừng"}
                        </span>
                      </div>

                      <div style={{ fontSize: "12px", color: "var(--muted)" }}>
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
                          gap: "8px",
                          minHeight: "44px",
                          fontSize: "13px",
                          fontWeight: 700,
                          color: "var(--ink-2, var(--text))",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={rule.is_active}
                          onChange={() => handleToggleWatchlistActive(rule)}
                          style={{ width: "18px", height: "18px", cursor: "pointer" }}
                        />
                        <span>Tự động quét</span>
                      </label>

                      {/* Telegram Toggle */}
                      <label
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          minHeight: "44px",
                          fontSize: "13px",
                          fontWeight: 700,
                          color: rule.notify_telegram ? "var(--primary-dark)" : "var(--muted)",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={rule.notify_telegram}
                          onChange={() => handleToggleWatchlistTelegram(rule)}
                          style={{ width: "18px", height: "18px", cursor: "pointer" }}
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
                      background: "var(--surface-subtle, var(--paper))",
                      border: "1px solid var(--border)",
                      marginBottom: "14px",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontSize: "11px", fontWeight: 800, color: "var(--primary-dark)" }}>TIÊU CHÍ LỌC:</span>

                    {rule.keyword && (
                      <span
                        style={{
                          fontSize: "12px",
                          padding: "3px 8px",
                          borderRadius: "6px",
                          background: "var(--primary-soft)",
                          color: "var(--primary-dark)",
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
                          background: "var(--panel)",
                          border: "1px solid var(--border)",
                          color: "var(--ink-2, var(--text))",
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
                          background: "color-mix(in srgb, var(--gold) 18%, var(--panel))",
                          color: "color-mix(in srgb, var(--amber) 74%, var(--ink))",
                          fontWeight: 700,
                        }}
                      >
                        💰 {formatVndShort(rule.min_price)} – {rule.max_price ? formatVndShort(rule.max_price) : "∞"}
                      </span>
                    )}
                  </div>

                  {/* Actions Strip */}
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", flexWrap: "wrap" }}>
                    <button
                      className="ui-btn-chip"
                      onClick={() => handleScanRule(rule.id)}
                      disabled={scanningId === rule.id}
                      style={{
                        minHeight: "44px",
                        padding: "9px 14px",
                        borderRadius: "8px",
                        fontSize: "12px",
                        fontWeight: 800,
                        border: "1px solid var(--primary)",
                        background: "var(--primary-soft)",
                        color: "var(--primary-dark)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "5px",
                      }}
                    >
                      <span>{scanningId === rule.id ? "⏳ Đang quét..." : "⚡ Quét ngay"}</span>
                    </button>

                    <button
                      className="ui-btn-chip"
                      onClick={() => setWatchlistModalRule(rule)}
                      style={{
                        minHeight: "44px",
                        padding: "9px 14px",
                        borderRadius: "8px",
                        fontSize: "12px",
                        fontWeight: 700,
                        border: "1px solid var(--border-strong)",
                        background: "var(--panel)",
                        color: "var(--ink-2, var(--text))",
                        cursor: "pointer",
                      }}
                    >
                      ✏️ Sửa
                    </button>

                    <button
                      className="ui-btn-chip"
                      onClick={() => handleDeleteWatchlist(rule.id, rule.name)}
                      style={{
                        minHeight: "44px",
                        padding: "9px 14px",
                        borderRadius: "8px",
                        fontSize: "12px",
                        fontWeight: 700,
                        border: "1px solid color-mix(in srgb, var(--red) 35%, var(--border))",
                        background: "color-mix(in srgb, var(--red) 10%, var(--panel))",
                        color: "color-mix(in srgb, var(--red) 82%, var(--ink))",
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
              background: "var(--panel)",
              padding: "clamp(14px, 2.5vw, 22px)",
              borderRadius: "18px",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow)",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <h2 style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontSize: "22px", margin: 0, color: "var(--ink)" }}>
                  Hồ Sơ Năng Lực Nhà Thầu & Đối Soát Khách Hàng CRM
                </h2>
                <span className="chip green sm" style={{ fontWeight: 800 }}>
                  ● Dữ liệu e-GP & Quyết định LCNT
                </span>
              </div>
              <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--muted)" }}>
                Tự động rà soát toàn bộ khách hàng trong CSDL INUT, thống kê lịch sử trúng thầu, win rate và các chủ đầu tư ruột.
              </p>
            </div>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button
                onClick={handleScanCrmContractors}
                disabled={crmScanLoading}
                style={{
                  minHeight: "44px",
                  padding: "11px 20px",
                  borderRadius: "12px",
                  background: "linear-gradient(135deg, var(--primary), var(--primary-dark))",
                  color: "#fff",
                  border: "0",
                  fontWeight: 800,
                  fontSize: "13px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  boxShadow: "var(--shadow)",
                }}
              >
                <span>{crmScanLoading ? "⏳ Đang Quét..." : "⚡ Quét Lại Năng Lực CRM"}</span>
              </button>
            </div>
          </div>

          {/* Sub-Tabs Switcher */}
          <ResponsiveTabs
            ariaLabel="Chuyển mục nhà thầu"
            active={contractorSubTab}
            onChange={(subId) => {
              setContractorSubTab(subId);
              syncBiddingUrl("contractors", subId);
              if (subId === "won_packages_playbook") {
                if (!wonPackagesResult) handleFetchWonPackages();
              } else {
                if (!crmScanResult) handleScanCrmContractors();
              }
            }}
            tabs={[
              {
                id: "won_packages_playbook",
                label: "📚 Kho Gói Thầu Đã Trúng & Cẩm Nang INUT",
                badge: wonPackagesResult ? wonPackagesResult.total_packages : undefined,
              },
              {
                id: "crm_contractors",
                label: "🏢 Danh Sách Khách Hàng CRM",
                badge: crmScanResult ? crmScanResult.total_crm_customers : 14,
              },
            ]}
          />

          {/* ══════════════════════════════════════════════════════════════════════════ */}
          {/* SUB-VIEW A: 📚 KHO GÓI THẦU ĐÃ TRÚNG & CẨM NANG ĐẤU THẦU INUT              */}
          {/* ══════════════════════════════════════════════════════════════════════════ */}
          {contractorSubTab === "won_packages_playbook" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* Playbook Highlight Banner */}
              <div
                style={{
                  background: "linear-gradient(135deg, var(--ink), var(--primary))",
                  borderRadius: "18px",
                  padding: "clamp(16px, 3vw, 24px)",
                  color: "#fff",
                  boxShadow: "var(--shadow-md)",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div style={{ position: "relative", zIndex: 1, maxWidth: "880px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 900, textTransform: "uppercase", letterSpacing: ".15em", color: "var(--mint, var(--primary-soft))" }}>
                    CẨM NANG HÀNH ĐỘNG ĐẤU THẦU THỰC CHIẾN • DÀNH CHO INUT (MST 4401053694)
                  </span>
                  <h3 style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontSize: "22px", margin: "6px 0 10px", color: "#fff" }}>
                    Công Thức Định Giá Dự Thầu & 3 Bộ Kit Hồ Sơ Chuẩn Mẫu
                  </h3>
                  <p style={{ fontSize: "13px", color: "rgba(255, 255, 255, 0.86)", lineHeight: 1.6, margin: 0 }}>
                    Phân tích từ hơn 100 gói thầu đã trúng của các nhà thầu lớn (Gdata, Tân Thanh Phương, Merap): Mức giảm giá tối ưu luôn nằm ở vùng <strong>3.2% - 4.5%</strong> so với Giá dự toán gói thầu để tối đa hóa điểm số tài chính mà vẫn giữ biên lợi nhuận ròng $\ge 30\%$.
                  </p>
                </div>

                {/* 3 Standard E-HSDT Kits */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: "12px", marginTop: "18px" }}>
                  <div style={{ minWidth: 0, background: "rgba(255,255,255,0.12)", backdropFilter: "blur(8px)", padding: "14px 16px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.2)" }}>
                    <div style={{ fontWeight: 800, fontSize: "13px", color: "var(--gold)" }}>💧 Kit 1: Quan Trắc Môi Trường TT10</div>
                    <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.88)", marginTop: "4px" }}>Datalogger 4G + Web SCADA truyền FTP/MQTT chuẩn Sở TN&MT. (Mẫu: 1,15 Tỷ ₫)</div>
                  </div>

                  <div style={{ minWidth: 0, background: "rgba(255,255,255,0.12)", backdropFilter: "blur(8px)", padding: "14px 16px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.2)" }}>
                    <div style={{ fontWeight: 800, fontSize: "13px", color: "var(--mint, var(--primary-soft))" }}>⚡ Kit 2: Đo Xa Điện Năng AMR/AMI</div>
                    <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.88)", marginTop: "4px" }}>Modem đọc xa công tơ điện tử Elster/Gelex + MDMS biểu đồ phụ tải. (Mẫu: 760 Tr ₫)</div>
                  </div>

                  <div style={{ minWidth: 0, background: "rgba(255,255,255,0.12)", backdropFilter: "blur(8px)", padding: "14px 16px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.2)" }}>
                    <div style={{ fontWeight: 800, fontSize: "13px", color: "var(--mint, var(--primary-soft))" }}>🏭 Kit 3: Tự Động Hóa SCADA FUXA</div>
                    <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.88)", marginTop: "4px" }}>Tủ điều khiển PLC/Inverter + FUXA Web SCADA trạm bơm & cấp nước. (Mẫu: 945 Tr ₫)</div>
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
                  background: "var(--panel)",
                  padding: "16px",
                  borderRadius: "16px",
                  border: "1px solid var(--border)",
                }}
              >
                <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                  <input
                    className="ui-input"
                    type="text"
                    value={wonPackagesQuery}
                    onChange={(e) => {
                      setWonPackagesQuery(e.target.value);
                      handleFetchWonPackages(e.target.value, wonPackagesFieldFilter);
                    }}
                    placeholder="Tìm gói thầu đã trúng: Nhập tên gói, số TBMT, đơn vị trúng (Gdata, Tân Thanh Phương, Merap...)"
                    style={{
                      width: "100%",
                      minHeight: "44px",
                      padding: "0 14px",
                      borderRadius: "10px",
                      border: "1px solid var(--border-strong)",
                      background: "var(--surface-subtle, var(--paper))",
                      color: "var(--ink)",
                      outline: "none",
                    }}
                  />
                </div>

                <select
                  className="ui-select"
                  value={wonPackagesFieldFilter}
                  onChange={(e) => {
                    setWonPackagesFieldFilter(e.target.value);
                    handleFetchWonPackages(wonPackagesQuery, e.target.value);
                  }}
                  style={{
                    minHeight: "44px",
                    padding: "0 14px",
                    borderRadius: "10px",
                    border: "1px solid var(--border-strong)",
                    background: "var(--panel)",
                    color: "var(--ink)",
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
                    minHeight: "44px",
                    padding: "0 18px",
                    borderRadius: "10px",
                    background: "var(--primary)",
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
                <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--muted)", background: "var(--panel)", borderRadius: "18px", border: "1px solid var(--border)" }}>
                  <span className="animate-spin" style={{ fontSize: "28px", display: "inline-block", marginBottom: "10px" }}>⏳</span>
                  <p style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "var(--ink)" }}>Đang tải danh sách gói thầu đã trúng...</p>
                </div>
              ) : !wonPackagesResult || wonPackagesResult.packages.length === 0 ? (
                <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--muted)", background: "var(--panel)", borderRadius: "18px", border: "1px solid var(--border)" }}>
                  <p style={{ margin: 0, fontSize: "15px", fontWeight: 700 }}>Không tìm thấy gói thầu đã trúng phù hợp</p>
                </div>
              ) : (
                <div style={{ display: "grid", gap: "16px" }}>
                  {wonPackagesResult.packages.map((pkg) => (
                    <div
                      key={pkg.id}
                      style={{
                        background: "var(--panel)",
                        borderRadius: "18px",
                        border: "1px solid color-mix(in srgb, var(--gold) 45%, var(--border))",
                        padding: "clamp(14px, 2.5vw, 22px)",
                        boxShadow: "var(--shadow)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                      }}
                    >
                      {/* Top row */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
                        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "4px" }}>
                            <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", fontWeight: 800, color: "var(--primary-dark)", background: "var(--primary-soft)", padding: "2px 8px", borderRadius: "6px" }}>
                              {pkg.tbmt_code}
                            </span>
                            <span style={{ fontSize: "11px", fontWeight: 800, padding: "2px 8px", borderRadius: "6px", background: "color-mix(in srgb, var(--gold) 18%, var(--panel))", color: "color-mix(in srgb, var(--amber) 74%, var(--ink))" }}>
                              📂 {pkg.field_label || pkg.field}
                            </span>
                            <span style={{ fontSize: "11px", fontWeight: 800, padding: "2px 8px", borderRadius: "999px", background: "color-mix(in srgb, var(--green) 14%, var(--panel))", color: "color-mix(in srgb, var(--green) 76%, var(--ink))" }}>
                              ✓ ĐÃ TRÚNG THẦU
                            </span>
                          </div>

                          <h3
                            onClick={() => handleOpenTenderDetail(pkg.tbmt_code, "info")}
                            style={{
                              margin: 0,
                              fontSize: "16px",
                              fontWeight: 800,
                              color: "var(--ink)",
                              lineHeight: 1.4,
                              cursor: "pointer",
                              overflowWrap: "anywhere",
                              transition: "color 0.15s ease",
                            }}
                            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--primary)")}
                            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--ink)")}
                          >
                            {pkg.tender_name} ↗
                          </h3>

                          <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px" }}>
                            Chủ đầu tư: <strong style={{ color: "var(--ink-2, var(--text))" }}>{pkg.procuring_entity}</strong>
                          </div>
                        </div>

                        <div style={{ textAlign: "right", minWidth: 0 }}>
                          <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 700, textTransform: "uppercase" }}>Giá Trúng Thầu</span>
                          <div style={{ fontSize: "18px", fontWeight: 800, color: "color-mix(in srgb, var(--coral) 82%, var(--ink))", fontFamily: "var(--font-mono)" }}>
                            {formatVnd(pkg.won_price)}
                          </div>
                          <div style={{ fontSize: "11px", color: "color-mix(in srgb, var(--green) 76%, var(--ink))", fontWeight: 700 }}>
                            Dự toán: {formatVnd(pkg.bid_price)} (Giảm {pkg.discount_percent}%)
                          </div>
                        </div>
                      </div>

                      {/* Contractor & Decision Strip */}
                      <div style={{ display: "flex", gap: "14px", fontSize: "12px", background: "var(--surface-subtle, var(--paper))", padding: "10px 14px", borderRadius: "10px", border: "1px solid var(--border)", flexWrap: "wrap", alignItems: "center", color: "var(--ink-2, var(--text))" }}>
                        <span>🏆 Đơn vị trúng: <strong style={{ color: "var(--ink)" }}>{pkg.contractor_name}</strong></span>
                        <span>📜 Quyết định: <strong style={{ color: "var(--ink-2, var(--text))", fontFamily: "var(--font-mono)" }}>{pkg.decision_number}</strong> ({pkg.award_date})</span>
                      </div>

                      {/* Winning Factors */}
                      {pkg.winning_factors && pkg.winning_factors.length > 0 && (
                        <div style={{ background: "color-mix(in srgb, var(--green) 10%, var(--panel))", padding: "12px 14px", borderRadius: "10px", border: "1px solid color-mix(in srgb, var(--green) 32%, var(--border))", fontSize: "12px", color: "color-mix(in srgb, var(--green) 76%, var(--ink))" }}>
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
                        <div style={{ background: "var(--paper)", padding: "12px 14px", borderRadius: "10px", border: "1px solid color-mix(in srgb, var(--gold) 45%, var(--border))", fontSize: "12px", color: "var(--ink-2, var(--text))", display: "flex", gap: "8px", alignItems: "flex-start" }}>
                          <span style={{ fontSize: "16px" }}>💡</span>
                          <div>
                            <strong style={{ color: "color-mix(in srgb, var(--amber) 74%, var(--ink))" }}>Bài học & Cơ hội hợp tác cho INUT: </strong>
                            {pkg.inut_playbook_takeaway}
                          </div>
                        </div>
                      )}

                      {/* Action Bar for Won Package */}
                      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "4px", borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
                        <button
                          type="button"
                          className="ui-btn-chip"
                          onClick={() => handleOpenTenderDetail(pkg.tbmt_code, "info")}
                          style={{
                            minHeight: "44px",
                            padding: "9px 16px",
                            borderRadius: "10px",
                            border: "none",
                            background: "var(--primary)",
                            color: "#fff",
                            fontWeight: 700,
                            fontSize: "12px",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            boxShadow: "var(--shadow)",
                          }}
                        >
                          <span>👁️</span>
                          <span>Xem Chi Tiết Gói Thầu</span>
                        </button>

                        <button
                          type="button"
                          className="ui-btn-chip"
                          onClick={() => handleOpenTenderDetail(pkg.tbmt_code, "attachments")}
                          style={{
                            minHeight: "44px",
                            padding: "9px 16px",
                            borderRadius: "10px",
                            border: "1px solid var(--primary)",
                            background: "var(--primary-soft)",
                            color: "var(--primary-dark)",
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
                          className="ui-btn-chip"
                          onClick={() => handleOpenTenderDetail(pkg.tbmt_code, "competitors")}
                          style={{
                            minHeight: "44px",
                            padding: "9px 16px",
                            borderRadius: "10px",
                            border: "1px solid color-mix(in srgb, var(--coral) 50%, var(--border))",
                            background: "color-mix(in srgb, var(--coral) 11%, var(--panel))",
                            color: "color-mix(in srgb, var(--coral) 82%, var(--ink))",
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
                          href={safeHttpUrl(api.bidding.getFullDossierZipUrl(pkg.tbmt_code))}
                          download
                          className="ui-btn-chip"
                          style={{
                            minHeight: "44px",
                            padding: "9px 16px",
                            borderRadius: "10px",
                            background: "color-mix(in srgb, var(--gold) 24%, var(--panel))",
                            color: "var(--ink)",
                            border: "1px solid color-mix(in srgb, var(--gold) 55%, var(--border))",
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "14px" }}>
            <div
              className="metric-card teal"
              style={{ minWidth: 0, padding: "18px 20px", borderRadius: "16px", background: "var(--panel)", border: "1px solid var(--border)", cursor: "pointer" }}
              onClick={() => setContractorCategoryFilter("all")}
            >
              <span style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", color: "var(--muted)" }}>
                Tổng Khách Hàng CRM
              </span>
              <b style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontSize: "28px", color: "var(--ink)", margin: "8px 0 4px", display: "block" }}>
                {crmScanResult ? crmScanResult.total_crm_customers : "..."}
              </b>
              <small style={{ color: "var(--muted)" }}>Doanh nghiệp trong CSDL</small>
            </div>

            <div
              className="metric-card coral"
              style={{ minWidth: 0, padding: "18px 20px", borderRadius: "16px", background: "var(--panel)", border: "1px solid var(--border)", cursor: "pointer" }}
              onClick={() => setContractorCategoryFilter("won")}
            >
              <span style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", color: "color-mix(in srgb, var(--coral) 82%, var(--ink))" }}>
                🏆 Khách Hàng Trúng Thầu
              </span>
              <b style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontSize: "28px", color: "color-mix(in srgb, var(--coral) 82%, var(--ink))", margin: "8px 0 4px", display: "block" }}>
                {crmScanResult ? crmScanResult.total_won_contractors : "..."}
              </b>
              <small style={{ color: "color-mix(in srgb, var(--coral) 82%, var(--ink))" }}>Trúng thầu cấp Bộ & Tỉnh</small>
            </div>

            <div
              className="metric-card amber"
              style={{ minWidth: 0, padding: "18px 20px", borderRadius: "16px", background: "var(--panel)", border: "1px solid var(--border)", cursor: "pointer" }}
              onClick={() => setContractorCategoryFilter("won")}
            >
              <span style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", color: "color-mix(in srgb, var(--green) 76%, var(--ink))" }}>
                💰 Tổng Giá Trị Trúng Thầu
              </span>
              <b style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontSize: "26px", color: "color-mix(in srgb, var(--green) 76%, var(--ink))", margin: "8px 0 4px", display: "block" }}>
                {crmScanResult ? crmScanResult.total_won_value_formatted : "..."}
              </b>
              <small style={{ color: "color-mix(in srgb, var(--green) 76%, var(--ink))" }}>Giá trị gói thầu thắng lũy kế</small>
            </div>

            <div
              className="metric-card ink"
              style={{ minWidth: 0, padding: "18px 20px", borderRadius: "16px", background: "var(--panel)", border: "1px solid var(--border)", cursor: "pointer" }}
              onClick={() => setContractorCategoryFilter("registered")}
            >
              <span style={{ fontSize: "11px", fontWeight: 800, textTransform: "uppercase", color: "var(--primary-dark)" }}>
                📝 Nhà Thầu Công Nghệ / OEM
              </span>
              <b style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontSize: "28px", color: "var(--primary-dark)", margin: "8px 0 4px", display: "block" }}>
                {crmScanResult
                  ? crmScanResult.items.filter((i) => i.bidding_status === "REGISTERED_BIDDER" || i.bidding_status === "OEM_SUBCONTRACTOR").length
                  : "..."}
              </b>
              <small style={{ color: "var(--primary-dark)" }}>Đối tác sản xuất & lắp đặt IoT</small>
            </div>
          </div>

          {/* Search & Filter Bar */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              background: "var(--panel)",
              padding: "16px",
              borderRadius: "16px",
              border: "1px solid var(--border)",
            }}
          >
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ flex: "1 1 240px", minWidth: 0, position: "relative" }}>
                <input
                  className="ui-input"
                  type="text"
                  value={contractorSearchQuery}
                  onChange={(e) => setContractorSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearchContractorsDirect(contractorSearchQuery)}
                  placeholder="Tra cứu bất kỳ doanh nghiệp / đối thủ nào: Nhập Tên công ty hoặc Mã Số Thuế (VD: Gdata, 0105365128, Tân Thanh Phương...)"
                  style={{
                    width: "100%",
                    minHeight: "44px",
                    padding: "0 46px 0 14px",
                    borderRadius: "12px",
                    border: "1px solid var(--border-strong)",
                    background: "var(--surface-subtle, var(--paper))",
                    color: "var(--ink)",
                    outline: "none",
                  }}
                />
                {contractorSearchQuery && (
                  <button
                    type="button"
                    className="ui-btn-icon"
                    aria-label="Xóa từ khóa tìm kiếm"
                    onClick={() => {
                      setContractorSearchQuery("");
                      handleScanCrmContractors();
                    }}
                    style={{
                      position: "absolute",
                      right: "4px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: "36px",
                      height: "36px",
                      minWidth: "36px",
                      minHeight: "36px",
                      background: "none",
                      border: "none",
                      color: "var(--muted)",
                      cursor: "pointer",
                      fontSize: "15px",
                      display: "inline-grid",
                      placeItems: "center",
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>

              <button
                onClick={() => handleSearchContractorsDirect(contractorSearchQuery)}
                style={{
                  minHeight: "44px",
                  padding: "0 22px",
                  borderRadius: "12px",
                  background: "var(--primary)",
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
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", paddingTop: "8px", borderTop: "1px solid var(--border)" }}>
              <span style={{ fontSize: "11px", fontWeight: 800, color: "var(--muted)", textTransform: "uppercase" }}>Gợi ý nhanh:</span>
              <button
                onClick={() => {
                  setContractorCategoryFilter("all");
                  handleScanCrmContractors();
                }}
                className={`ui-btn-chip btn-date ${contractorCategoryFilter === "all" ? "active" : ""}`}
                style={{ minHeight: "40px", padding: "6px 12px", fontSize: "12px", borderRadius: "8px", border: "1px solid var(--border-strong)", background: contractorCategoryFilter === "all" ? "var(--primary)" : "var(--surface-subtle, var(--paper))", color: contractorCategoryFilter === "all" ? "#fff" : "var(--ink-2, var(--text))", cursor: "pointer" }}
              >
                ⚡ Tất cả KH CRM ({crmScanResult ? crmScanResult.total_crm_customers : 14})
              </button>

              <button
                className="ui-btn-chip"
                onClick={() => {
                  setContractorCategoryFilter("won");
                }}
                style={{ minHeight: "40px", padding: "6px 12px", fontSize: "12px", borderRadius: "8px", border: "1px solid color-mix(in srgb, var(--coral) 45%, var(--border))", background: contractorCategoryFilter === "won" ? "color-mix(in srgb, var(--coral) 82%, var(--ink))" : "color-mix(in srgb, var(--coral) 11%, var(--panel))", color: contractorCategoryFilter === "won" ? "#fff" : "color-mix(in srgb, var(--coral) 82%, var(--ink))", fontWeight: 700, cursor: "pointer" }}
              >
                🏆 Top Trúng Thầu (Gdata, Tân Thanh Phương, Merap)
              </button>

              <button
                className="ui-btn-chip"
                onClick={() => handleSearchContractorsDirect("4401053694")}
                style={{ minHeight: "40px", padding: "6px 12px", fontSize: "12px", borderRadius: "8px", border: "1px solid color-mix(in srgb, var(--green) 36%, var(--border))", background: "color-mix(in srgb, var(--green) 11%, var(--panel))", color: "color-mix(in srgb, var(--green) 76%, var(--ink))", fontWeight: 700, cursor: "pointer" }}
              >
                🌟 iNut Technology (4401053694)
              </button>

              <button
                className="ui-btn-chip"
                onClick={() => handleSearchContractorsDirect("5500649200")}
                style={{ minHeight: "40px", padding: "6px 12px", fontSize: "12px", borderRadius: "8px", border: "1px solid color-mix(in srgb, var(--primary) 35%, var(--border))", background: "var(--primary-soft)", color: "var(--primary-dark)", fontWeight: 700, cursor: "pointer" }}
              >
                ⚙️ Tự Động Hóa IoT Sơn La (5500649200)
              </button>

              <button
                className="ui-btn-chip"
                onClick={() => handleSearchContractorsDirect("0314360282")}
                style={{ minHeight: "40px", padding: "6px 12px", fontSize: "12px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--surface-subtle, var(--paper))", color: "var(--ink-2, var(--text))", fontWeight: 700, cursor: "pointer" }}
              >
                ⚙️ Bảo Toàn Tech (0314360282)
              </button>
            </div>
          </div>

          {/* Contractors Cards List */}
          {crmScanLoading ? (
            <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--muted)", background: "var(--panel)", borderRadius: "18px", border: "1px solid var(--border)" }}>
              <span className="animate-spin" style={{ fontSize: "28px", display: "inline-block", marginBottom: "10px" }}>⏳</span>
              <p style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "var(--ink)" }}>Đang quét và đối soát hồ sơ đấu thầu từ e-GP...</p>
            </div>
          ) : !crmScanResult || crmScanResult.items.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--muted)", background: "var(--panel)", borderRadius: "18px", border: "1px solid var(--border)" }}>
              <span style={{ fontSize: "36px", display: "block", marginBottom: "10px" }}>🏢</span>
              <p style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "var(--ink)" }}>Chưa có dữ liệu nhà thầu</p>
              <button
                onClick={handleScanCrmContractors}
                style={{ marginTop: "14px", minHeight: "44px", padding: "10px 18px", borderRadius: "10px", background: "var(--primary)", color: "#fff", border: 0, fontWeight: 700, cursor: "pointer" }}
              >
                ⚡ Quét Ngay
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
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
                      background: "var(--panel)",
                      borderRadius: "18px",
                      border: c.total_won > 0 ? "1px solid color-mix(in srgb, var(--gold) 48%, var(--border))" : "1px solid var(--border)",
                      padding: "clamp(14px, 2.5vw, 22px)",
                      boxShadow: "var(--shadow)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "14px",
                    }}
                  >
                    {/* Header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
                      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 800, color: "var(--ink)", overflowWrap: "anywhere" }}>
                            {c.name}
                          </h3>
                          <span
                            style={{
                              padding: "3px 10px",
                              borderRadius: "999px",
                              fontSize: "11px",
                              fontWeight: 800,
                              background: c.total_won > 0
                                ? "color-mix(in srgb, var(--coral) 12%, var(--panel))"
                                : c.bidding_status === "REGISTERED_BIDDER"
                                ? "var(--primary-soft)"
                                : "var(--surface-subtle, var(--paper))",
                              color: c.total_won > 0
                                ? "color-mix(in srgb, var(--coral) 82%, var(--ink))"
                                : c.bidding_status === "REGISTERED_BIDDER"
                                ? "var(--primary-dark)"
                                : "var(--ink-2, var(--text))",
                              border: c.total_won > 0
                                ? "1px solid color-mix(in srgb, var(--coral) 40%, var(--border))"
                                : "1px solid var(--border-strong)",
                            }}
                          >
                            {c.bidding_status_label}
                          </span>
                        </div>

                        <div style={{ display: "flex", gap: "14px", marginTop: "4px", fontSize: "12px", color: "var(--muted)", flexWrap: "wrap" }}>
                          <span>
                            Mã số thuế: <strong style={{ color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{c.tax_code}</strong>
                          </span>
                          {c.address && <span>📍 {c.address}</span>}
                          {c.email && <span>✉️ {c.email}</span>}
                        </div>
                      </div>

                      <button
                        className="ui-btn-chip"
                        onClick={() => { setSelectedContractorDetail(c); syncBiddingUrl(activeTab, contractorSubTab, null, "info", c.tax_code); }}
                        style={{
                          minHeight: "44px",
                          padding: "9px 16px",
                          borderRadius: "10px",
                          background: c.total_won > 0
                            ? "linear-gradient(135deg, color-mix(in srgb, var(--coral) 82%, var(--ink)), var(--ink))"
                            : "var(--primary)",
                          color: "#fff",
                          border: 0,
                          fontWeight: 700,
                          fontSize: "12px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          boxShadow: "var(--shadow)",
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
                        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 170px), 1fr))",
                        gap: "12px",
                        background: "var(--surface-subtle, var(--paper))",
                        padding: "12px 16px",
                        borderRadius: "14px",
                        border: "1px solid var(--border)",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 700, textTransform: "uppercase" }}>Số Gói Tham Gia</span>
                        <div style={{ fontSize: "16px", fontWeight: 800, color: "var(--ink)", marginTop: "2px" }}>
                          {c.total_bids} gói <span style={{ fontSize: "12px", color: "color-mix(in srgb, var(--green) 76%, var(--ink))", fontWeight: 700 }}>({c.total_won} trúng)</span>
                        </div>
                      </div>

                      <div style={{ minWidth: 0 }}>
                        <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 700, textTransform: "uppercase" }}>Tỷ Lệ Trúng Thầu (Win Rate)</span>
                        <div style={{ marginTop: "4px" }}>
                          <WinRateProgressBar won={c.total_won} total={c.total_bids} rate={c.win_rate_percent} size="sm" />
                        </div>
                      </div>

                      <div style={{ minWidth: 0 }}>
                        <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 700, textTransform: "uppercase" }}>Tổng Tiền Trúng Thầu</span>
                        <div style={{ fontSize: "16px", fontWeight: 800, color: "color-mix(in srgb, var(--coral) 82%, var(--ink))", fontFamily: "var(--font-mono)", marginTop: "2px" }}>
                          {c.total_won_value_formatted}
                        </div>
                      </div>

                      <div style={{ minWidth: 0 }}>
                        <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 700, textTransform: "uppercase" }}>Giảm Giá TB</span>
                        <div style={{ fontSize: "16px", fontWeight: 800, color: "var(--primary-dark)", marginTop: "2px" }}>
                          {c.average_discount_percent > 0 ? `${c.average_discount_percent}%` : "—"}
                        </div>
                      </div>
                    </div>

                    {/* Top Procuring Entities & Won Highlights */}
                    {c.top_procuring_entities && c.top_procuring_entities.length > 0 && (
                      <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "11px", fontWeight: 800, color: "var(--ink-2, var(--text))", textTransform: "uppercase" }}>Chủ đầu tư quen thuộc:</span>
                        {c.top_procuring_entities.map((p, idx) => (
                          <span
                            key={idx}
                            style={{
                              fontSize: "11px",
                              padding: "3px 8px",
                              borderRadius: "6px",
                              background: "var(--surface-subtle, var(--paper))",
                              border: "1px solid var(--border)",
                              color: "var(--ink-2, var(--text))",
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
                          background: "linear-gradient(135deg, var(--primary-soft), var(--paper))",
                          padding: "12px 16px",
                          borderRadius: "12px",
                          border: "1px solid color-mix(in srgb, var(--green) 32%, var(--border))",
                          fontSize: "12px",
                          color: "var(--ink)",
                          lineHeight: 1.5,
                          display: "flex",
                          gap: "10px",
                          alignItems: "flex-start",
                        }}
                      >
                        <span style={{ fontSize: "16px" }}>💡</span>
                        <div>
                          <strong style={{ color: "var(--primary-dark)" }}>Gợi ý chiến lược & Cơ hội hợp tác INUT: </strong>
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
      {/* TAB 5: 📑 THẨM ĐỊNH HỒ SƠ THẦU (DOSSIER REVIEW & STRATEGIC COMPLIANCE)     */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "dossier_reviews" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {dossierLoading && !activeDossierReview ? (
            <div className="panel" style={{ padding: "40px 20px", textAlign: "center", color: "var(--muted)" }}>
              ⏳ Đang tải báo cáo thẩm định hồ sơ thầu đa tác nhân...
            </div>
          ) : !activeDossierReview ? (
            <div className="panel" style={{ padding: "40px 20px", textAlign: "center", color: "var(--muted)" }}>
              <h3 style={{ color: "var(--ink)" }}>Chưa có báo cáo thẩm định hồ sơ thầu nào.</h3>
              <button
                type="button"
                className="btn primary"
                style={{ background: "var(--primary)", color: "#fff", marginTop: "12px", minHeight: "44px" }}
                onClick={() => setShowImportDriveModal(true)}
              >
                ➕ Thẩm Định Thầu Mới (Nhập Link Google Drive)
              </button>
            </div>
          ) : (
            <>
              {/* Hero Banner Card */}
              <div
                className="bidding-dossier-hero"
                style={{
                  background: "linear-gradient(135deg, var(--ink) 0%, var(--primary-dark) 100%)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
                  <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "var(--primary)", color: "#fff", padding: "4px 10px", borderRadius: "8px", fontSize: "11px", fontWeight: 800, textTransform: "uppercase" }}>
                      🏛️ THẨM ĐỊNH HỒ SƠ DỰ THẦU CHUYÊN SÂU · MULTI-AGENT REVIEW
                    </div>
                    <h2 style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontSize: "22px", margin: "10px 0 6px 0", color: "#fff", lineHeight: 1.3, overflowWrap: "anywhere" }}>
                      {activeDossierReview.package_name}
                    </h2>
                    <div style={{ fontSize: "13px", color: "rgba(255, 255, 255, 0.85)" }}>
                      Mã TBMT: <b style={{ color: "var(--gold)" }}>{activeDossierReview.tbmt_code}</b> · Bên mời thầu: <b>{activeDossierReview.procuring_entity}</b>
                    </div>
                    <div style={{ fontSize: "12.5px", color: "rgba(255, 255, 255, 0.78)", marginTop: "4px" }}>
                      Nhà thầu lập hồ sơ: <b>{activeDossierReview.contractor_name}</b> (MST: {activeDossierReview.contractor_tax_code}) · Đối tác công nghệ lõi: <b style={{ color: "var(--mint, var(--primary-soft))" }}>INUT Technology</b>
                    </div>
                  </div>

                  {/* Dossier Selector Dropdown if multiple */}
                  {dossierReviews.length > 1 && (
                    <select
                      className="ui-select"
                      value={activeDossierReview.id}
                      onChange={(e) => handleSelectDossierReview(Number(e.target.value))}
                      style={{ minHeight: "44px", padding: "8px 12px", borderRadius: "8px", background: "var(--ink)", color: "#fff", border: "1px solid rgba(255,255,255,0.28)", maxWidth: "100%" }}
                    >
                      {dossierReviews.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.tbmt_code} - {r.package_name.slice(0, 40)}... ({r.overall_score}/100)
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* KPI Grid */}
                <div className="bidding-dossier-kpi-grid">
                  <div className="bidding-dossier-kpi-card" style={{ borderColor: "var(--green)" }}>
                    <div style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--mint, var(--primary-soft))", fontWeight: 700 }}>Điểm số tuân thủ tổng thể</div>
                    <div style={{ fontSize: "28px", fontWeight: 900, color: "#fff", margin: "4px 0" }}>
                      {activeDossierReview.overall_score} / 100
                    </div>
                    <div style={{ fontSize: "11.5px", color: "var(--mint, var(--primary-soft))", fontWeight: 600 }}>🟢 Tiềm năng trúng thầu số 1</div>
                  </div>

                  <div className="bidding-dossier-kpi-card">
                    <div style={{ fontSize: "11px", textTransform: "uppercase", color: "rgba(255,255,255,0.78)", fontWeight: 700 }}>Giá dự thầu (Mẫu 12.1A)</div>
                    <div style={{ fontSize: "22px", fontWeight: 800, color: "#fff", margin: "4px 0" }}>
                      {formatVnd(activeDossierReview.total_bid_price)}
                    </div>
                    <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.78)" }}>
                      Dự toán: {formatVnd(activeDossierReview.estimated_package_price)} (Giảm 0.39%)
                    </div>
                  </div>

                  <div className="bidding-dossier-kpi-card" style={{ borderColor: activeDossierReview.files.some(f => f.compliance_status === "fail") ? "var(--coral)" : "var(--mint, var(--primary-soft))" }}>
                    <div style={{ fontSize: "11px", textTransform: "uppercase", color: "rgba(255,255,255,0.85)", fontWeight: 700 }}>Đánh giá 9 tài liệu</div>
                    <div style={{ fontSize: "22px", fontWeight: 800, color: "var(--gold)", margin: "4px 0" }}>
                      {activeDossierReview.files.filter(f => f.compliance_status === "pass").length} Đạt · 1 Cảnh báo · 1 Lỗi
                    </div>
                    <div style={{ fontSize: "11px", color: "rgba(255, 224, 214, 0.96)" }}>🚨 File 06 có 12 ô placeholder cần sửa</div>
                  </div>

                  <div className="bidding-dossier-kpi-card">
                    <div style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--gold)", fontWeight: 700 }}>Lợi nhuận gộp dự kiến</div>
                    <div style={{ fontSize: "22px", fontWeight: 800, color: "var(--gold)", margin: "4px 0" }}>
                      ~759.900.000 ₫ (63.6%)
                    </div>
                    <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.84)" }}>Nhờ tự chủ công nghệ iNut & SCADA</div>
                  </div>
                </div>

                {/* Action Toolbar */}
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "8px", borderTop: "1px solid rgba(255,255,255,0.14)", paddingTop: "14px" }}>
                  <a
                    href={safeHttpUrl(api.bidding.getDossierExportMarkdownUrl(activeDossierReview.id))}
                    download={`Bao_cao_tham_dinh_${activeDossierReview.tbmt_code}.md`}
                    className="ui-btn-chip"
                    style={{ minHeight: "44px", background: "var(--primary)", color: "#fff", textDecoration: "none", padding: "9px 14px", borderRadius: "8px", fontSize: "12.5px", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    📥 Tải Báo Cáo Markdown
                  </a>

                  <button
                    type="button"
                    className="ui-btn-chip"
                    onClick={() => window.print()}
                    style={{ minHeight: "44px", background: "rgba(255,255,255,0.12)", color: "#fff", border: "1px solid rgba(255,255,255,0.24)", padding: "9px 14px", borderRadius: "8px", fontSize: "12.5px", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    🖨️ In Báo Cáo
                  </button>

                  <button
                    type="button"
                    className="ui-btn-chip"
                    onClick={() => {
                      const text = `Kính gửi anh Thắng Cty IoT, INUT Technology gửi kết quả thẩm định hồ sơ thầu Sơn La (${activeDossierReview.tbmt_code}): Điểm tuân thủ 96/100. Lưu ý sửa ngay 12 ô placeholder ở File 06 và nhận Giấy cam kết kỹ thuật của INUT để thắng thầu. Xem chi tiết: ${window.location.origin}/bidding/dossier-reviews`;
                      const zaloUrl = `https://zalo.me/share?url=${encodeURIComponent(window.location.href)}&message=${encodeURIComponent(text)}`;
                      openExternalSafe(zaloUrl);
                    }}
                    style={{ minHeight: "44px", background: "var(--gold)", color: "var(--ink)", border: "0", padding: "9px 14px", borderRadius: "8px", fontSize: "12.5px", fontWeight: 800, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    💬 Gửi Zalo Cho Anh Thắng Cty IoT
                  </button>

                  <button
                    type="button"
                    className="ui-btn-chip"
                    onClick={() => {
                      const subject = `Kết quả Thẩm định Hồ sơ thầu Sơn La IB2600557773 - INUT & Cty IOT`;
                      const body = `Kính gửi anh Thắng,\n\nHội đồng kỹ thuật INUT Technology đã thẩm định toàn diện 9 tài liệu dự thầu gói thầu Sơn La (IB2600557773):\n- Điểm tuân thủ tổng thể: 96/100 điểm.\n- Giá dự thầu: 1.194.900.000 đ.\n\nĐặc biệt lưu ý 3 điểm cần sửa gấp trước khi nộp thầu:\n1. Điền cự ly và tuyến đường cụ thể vào File 06 (hiện đang để [CẦN XÁC NHẬN]).\n2. Kẹp Giấy cam kết hỗ trợ kỹ thuật và bảo hành 5 năm của INUT Technology.\n3. Sửa lỗi chính tả cơ quan cấp ĐKKD trong File 01.\n\nChi tiết báo cáo tại: ${window.location.href}`;
                      window.location.href = `mailto:${activeDossierReview.contractor_tax_code ? "kythuattudonghoaiot@gmail.com" : ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                    }}
                    style={{ minHeight: "44px", background: "color-mix(in srgb, var(--coral) 82%, var(--ink))", color: "#fff", border: "0", padding: "9px 14px", borderRadius: "8px", fontSize: "12.5px", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    ✉️ Gửi Email
                  </button>

                  <button
                    type="button"
                    className="ui-btn-chip"
                    onClick={() => setShowImportDriveModal(true)}
                    style={{ minHeight: "44px", background: "rgba(255,255,255,0.16)", color: "#fff", border: "1px solid rgba(255,255,255,0.3)", padding: "9px 14px", borderRadius: "8px", fontSize: "12.5px", fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "6px", marginLeft: "auto" }}
                  >
                    ➕ Nhập Hồ Sơ Thầu Mới (Google Drive)
                  </button>
                </div>
              </div>

              {/* Dossier Sub-Tabs Bar */}
              <ResponsiveTabs
                ariaLabel="Chuyển mục thẩm định hồ sơ thầu"
                active={dossierSubTab}
                onChange={setDossierSubTab}
                tabs={[
                  { id: "executive", label: "📋 Tóm Tắt Chiến Lược & 3 Điểm Nóng" },
                  { id: "files", label: "📁 Thẩm Định 9 Tài Liệu", badge: activeDossierReview.files.length },
                  { id: "items", label: "🛠️ Ma Trận Kỹ Thuật 18 Hạng Mục", badge: activeDossierReview.items.length },
                  { id: "pricing", label: "💰 Cơ Cấu Giá & Thư Giảm Giá" },
                ]}
              />

              {/* SUBTAB 1: EXECUTIVE BRIEFING */}
              {dossierSubTab === "executive" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {/* RED ALERT CALLOUT BOX */}
                  <div style={{ background: "color-mix(in srgb, var(--red) 9%, var(--panel))", border: "2px solid var(--red)", borderRadius: "14px", padding: "clamp(14px, 2.5vw, 22px)", color: "color-mix(in srgb, var(--red) 82%, var(--ink))" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                      <span style={{ fontSize: "28px" }}>🚨</span>
                      <div>
                        <h3 style={{ margin: 0, fontSize: "16px", color: "color-mix(in srgb, var(--red) 85%, var(--ink))", fontWeight: 800, textTransform: "uppercase" }}>
                          CẢNH BÁO ĐỎ: 3 ĐIỂM CHÍ MẠNG CẦN SỬA GẤP TRƯỚC KHI NỘP THẦU
                        </h3>
                        <div style={{ fontSize: "12.5px", color: "var(--ink)", marginTop: "2px" }}>
                          Nếu không sửa ngay, Tổ chuyên gia chấm thầu có căn cứ đánh LOẠI BỎ (FAIL) hồ sơ dự thầu!
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      <div style={{ background: "var(--panel)", padding: "14px 16px", borderRadius: "10px", border: "1px solid color-mix(in srgb, var(--red) 32%, var(--border))" }}>
                        <div style={{ fontWeight: 800, color: "color-mix(in srgb, var(--red) 85%, var(--ink))", fontSize: "13.5px" }}>
                          1. Lỗi Placeholder chưa điền trong File 06 (Biện pháp vận chuyển) — NGUY HIỂM NHẤT!
                        </div>
                        <div style={{ fontSize: "12.5px", color: "var(--ink-2, var(--text))", marginTop: "4px", lineHeight: 1.5 }}>
                          Bảng cung đường Table 2 File 06 còn để nguyên văn các dòng mẫu <code>[CẦN NHÀ THẦU XÁC NHẬN TUYẾN ĐƯỜNG THỰC TẾ]</code> và <code>[CẦN XÁC NHẬN] km</code>. Nộp lên E-GP sẽ bị đánh Không Đạt ngay tại Tiêu chí 2.2!
                        </div>
                        <div style={{ marginTop: "6px", padding: "8px 12px", background: "color-mix(in srgb, var(--green) 11%, var(--panel))", borderRadius: "6px", color: "color-mix(in srgb, var(--green) 76%, var(--ink))", fontSize: "12px", fontWeight: 600 }}>
                          👉 Khắc phục ngay: Điền cự ly chuẩn: Bản Mòn <b>22 km</b> (xe tải 1.5T), Chiềng Khoi <b>64 km</b> (xe tải 2.5T), Suối Chiếu <b>128 km</b> (xe 2.5T gầm cao), Suối Hòm <b>145 km</b> (xe 2.5T gầm cao).
                        </div>
                      </div>

                      <div style={{ background: "var(--panel)", padding: "14px 16px", borderRadius: "10px", border: "1px solid color-mix(in srgb, var(--red) 32%, var(--border))" }}>
                        <div style={{ fontWeight: 800, color: "color-mix(in srgb, var(--red) 85%, var(--ink))", fontSize: "13.5px" }}>
                          2. Bổ sung Giấy xác nhận hỗ trợ kỹ thuật của Hãng INUT cho Mục 4 & Mục 17 (File 04)
                        </div>
                        <div style={{ fontSize: "12.5px", color: "var(--ink-2, var(--text))", marginTop: "4px", lineHeight: 1.5 }}>
                          Bảng đối chiếu kỹ thuật ghi rõ: <i>"CHƯA ĐỦ CĂN CỨ VỀ LAN/P2P"</i> và <i>"CẦN XÁC NHẬN GIẢI PHÁP CHỐNG SÉT"</i>. Cần tài liệu chứng minh chính thức từ nhà sản xuất.
                        </div>
                        <div style={{ marginTop: "6px", padding: "8px 12px", background: "color-mix(in srgb, var(--green) 11%, var(--panel))", borderRadius: "6px", color: "color-mix(in srgb, var(--green) 76%, var(--ink))", fontSize: "12px", fontWeight: 600 }}>
                          👉 Khắc phục ngay: INUT Technology (MST 4401053694) ký số và cung cấp ngay Văn bản Cam kết kỹ thuật P2P/LAN và giải pháp chống sét SPD tích hợp để kẹp vào hồ sơ.
                        </div>
                      </div>

                      <div style={{ background: "var(--panel)", padding: "14px 16px", borderRadius: "10px", border: "1px solid color-mix(in srgb, var(--red) 32%, var(--border))" }}>
                        <div style={{ fontWeight: 800, color: "color-mix(in srgb, var(--red) 85%, var(--ink))", fontSize: "13.5px" }}>
                          3. Sửa lỗi chính tả cơ quan cấp ĐKKD trong File 01 (Pháp lý)
                        </div>
                        <div style={{ fontSize: "12.5px", color: "var(--ink-2, var(--text))", marginTop: "4px", lineHeight: 1.5 }}>
                          Kê khai nhầm thành "Phòng ĐKKD - Sở Tài chính tỉnh Sơn La". Thẩm quyền chuẩn theo Nghị định 01/2021/NĐ-CP là Sở Kế hoạch và Đầu tư.
                        </div>
                        <div style={{ marginTop: "6px", padding: "8px 12px", background: "color-mix(in srgb, var(--green) 11%, var(--panel))", borderRadius: "6px", color: "color-mix(in srgb, var(--green) 76%, var(--ink))", fontSize: "12px", fontWeight: 600 }}>
                          👉 Khắc phục ngay: Đổi lại thành <b>"Phòng Đăng ký kinh doanh - Sở Kế hoạch và Đầu tư tỉnh Sơn La"</b>.
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Executive Summary Narrative */}
                  <div className="panel" style={{ padding: "clamp(14px, 2.5vw, 24px)" }}>
                    <h3 style={{ margin: "0 0 12px 0", fontSize: "17px", color: "var(--ink)", fontFamily: "var(--font-serif, Georgia, serif)" }}>
                      1. Tổng Quan Đánh Giá & Điểm Mạnh Vượt Trội Của Nhà Thầu
                    </h3>
                    <div style={{ fontSize: "13.5px", color: "var(--ink-2, var(--text))", lineHeight: 1.6 }}>
                      {activeDossierReview.executive_summary}
                    </div>

                    <div style={{ marginTop: "18px" }}>
                      <h4 style={{ margin: "0 0 8px 0", fontSize: "14px", color: "var(--ink)" }}>
                        Các Khuyến Nghị Chiến Lược Cốt Lõi:
                      </h4>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {activeDossierReview.recommendations.map((rec, idx) => (
                          <div key={idx} style={{ display: "flex", gap: "10px", alignItems: "flex-start", background: "var(--surface-subtle, var(--paper))", padding: "10px 14px", borderRadius: "8px", border: "1px solid var(--border)", fontSize: "13px" }}>
                            <span style={{ fontWeight: 800, color: "var(--primary-dark)" }}>#{idx + 1}</span>
                            <span style={{ color: "var(--ink-2, var(--text))" }}>{rec}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* SUBTAB 2: INDEPENDENT 9 FILES AUDIT */}
              {dossierSubTab === "files" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  {activeDossierReview.files.map((f) => {
                    const isPass = f.compliance_status === "pass";
                    const isWarning = f.compliance_status === "warning";
                    const isFail = f.compliance_status === "fail";
                    return (
                      <div key={f.id} className="bidding-dossier-file-card" style={{ borderLeft: `5px solid ${isPass ? "var(--green)" : (isWarning ? "var(--amber)" : "var(--red)")}` }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "8px" }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: "11.5px", color: "var(--muted)", fontWeight: 700 }}>
                              TÀI LIỆU {f.file_code} · {f.file_name}
                            </div>
                            <div style={{ fontSize: "16px", fontWeight: 800, color: "var(--ink)", marginTop: "2px", overflowWrap: "anywhere" }}>
                              {f.file_title}
                            </div>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                            <span style={{ fontSize: "14px", fontWeight: 900, color: isPass ? "color-mix(in srgb, var(--green) 76%, var(--ink))" : (isWarning ? "color-mix(in srgb, var(--amber) 74%, var(--ink))" : "color-mix(in srgb, var(--red) 82%, var(--ink))") }}>
                              {f.score}/100 điểm
                            </span>
                            <span style={{ padding: "4px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: 800, background: isPass ? "color-mix(in srgb, var(--green) 14%, var(--panel))" : (isWarning ? "color-mix(in srgb, var(--gold) 18%, var(--panel))" : "color-mix(in srgb, var(--red) 12%, var(--panel))"), color: isPass ? "color-mix(in srgb, var(--green) 76%, var(--ink))" : (isWarning ? "color-mix(in srgb, var(--amber) 74%, var(--ink))" : "color-mix(in srgb, var(--red) 82%, var(--ink))") }}>
                              {isPass ? "✓ ĐẠT" : (isWarning ? "⚠️ CẢNH BÁO" : "🚨 CẦN SỬA GẤP")}
                            </span>
                          </div>
                        </div>

                        <FormGrid cols={2} style={{ marginTop: "6px", fontSize: "13px" }}>
                          <div style={{ minWidth: 0, background: "var(--surface-subtle, var(--paper))", padding: "10px 14px", borderRadius: "8px", border: "1px solid var(--border)" }}>
                            <div style={{ fontWeight: 700, color: "var(--ink)", marginBottom: "4px" }}>🔍 Phát hiện chính:</div>
                            <div style={{ color: "var(--ink-2, var(--text))", lineHeight: 1.45 }}>{f.findings}</div>
                          </div>

                          <div style={{ minWidth: 0, background: isFail ? "color-mix(in srgb, var(--red) 9%, var(--panel))" : "var(--panel)", padding: "10px 14px", borderRadius: "8px", border: `1px solid ${isFail ? "color-mix(in srgb, var(--red) 35%, var(--border))" : "var(--border)"}` }}>
                            <div style={{ fontWeight: 700, color: isFail ? "color-mix(in srgb, var(--red) 82%, var(--ink))" : "color-mix(in srgb, var(--amber) 74%, var(--ink))", marginBottom: "4px" }}>
                              {isFail ? "🚨 Rủi ro loại thầu:" : "⚠️ Rủi ro cần lưu ý:"}
                            </div>
                            <div style={{ color: isFail ? "color-mix(in srgb, var(--red) 82%, var(--ink))" : "var(--ink-2, var(--text))", lineHeight: 1.45 }}>{f.critical_risks}</div>
                          </div>
                        </FormGrid>

                        <div style={{ background: "color-mix(in srgb, var(--green) 11%, var(--panel))", padding: "10px 14px", borderRadius: "8px", border: "1px solid color-mix(in srgb, var(--green) 32%, var(--border))", fontSize: "12.5px" }}>
                          <b style={{ color: "color-mix(in srgb, var(--green) 76%, var(--ink))" }}>💡 Biện pháp khắc phục / Khuyến nghị: </b>
                          <span style={{ color: "var(--ink)" }}>{f.remediation}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* SUBTAB 3: TECHNICAL MATRIX (18 EQUIPMENT ITEMS) */}
              {dossierSubTab === "items" && (
                <DataView
                  mobileMode="card"
                  desktop={
                    <div className="ui-table-scroll-wrap" style={{ background: "var(--panel)", borderRadius: "14px", border: "1px solid var(--border)", overflowX: "auto", boxShadow: "var(--shadow)" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px", minWidth: "980px" }}>
                        <thead>
                          <tr style={{ background: "var(--surface-subtle, var(--paper))", borderBottom: "1px solid var(--border)", color: "var(--ink-2, var(--text))", fontSize: "12px" }}>
                            <th style={{ padding: "12px 14px", width: "40px" }}>STT</th>
                            <th style={{ padding: "12px 14px" }}>Tên thiết bị & Thông số</th>
                            <th style={{ padding: "12px 14px" }}>Ký mã hiệu & Hãng SX</th>
                            <th style={{ padding: "12px 14px", textAlign: "center" }}>SL</th>
                            <th style={{ padding: "12px 14px", textAlign: "right" }}>Đơn giá (VNĐ)</th>
                            <th style={{ padding: "12px 14px", textAlign: "right" }}>Thành tiền (VNĐ)</th>
                            <th style={{ padding: "12px 14px" }}>Vai trò INUT</th>
                            <th style={{ padding: "12px 14px", textAlign: "center" }}>Trạng thái</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeDossierReview.items.map((it) => {
                            const isOk = it.compliance_status === "compliant";
                            return (
                              <tr key={it.id} style={{ borderBottom: "1px solid var(--border)" }}>
                                <td style={{ padding: "12px 14px", fontWeight: 700, color: "var(--muted)" }}>{it.item_no}</td>
                                <td style={{ padding: "12px 14px", maxWidth: "260px" }}>
                                  <div style={{ fontWeight: 700, color: "var(--ink)" }}>{it.item_name}</div>
                                  <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>Id: {it.system_id}</div>
                                  <div style={{ fontSize: "11.5px", color: "var(--primary-dark)", marginTop: "2px" }}>{it.notes}</div>
                                </td>
                                <td style={{ padding: "12px 14px" }}>
                                  <div style={{ fontWeight: 600, color: "var(--ink-2, var(--text))" }}>{it.proposed_model}</div>
                                  <div style={{ fontSize: "12px", color: "var(--muted)" }}>{it.manufacturer} ({it.origin})</div>
                                </td>
                                <td style={{ padding: "12px 14px", textAlign: "center", fontWeight: 600 }}>
                                  {it.quantity} {it.unit}
                                </td>
                                <td style={{ padding: "12px 14px", textAlign: "right" }}>
                                  {it.unit_price.toLocaleString("vi-VN")} đ
                                </td>
                                <td style={{ padding: "12px 14px", textAlign: "right", fontWeight: 800, color: "var(--ink)" }}>
                                  {it.total_price.toLocaleString("vi-VN")} đ
                                </td>
                                <td style={{ padding: "12px 14px" }}>
                                  <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "4px", background: it.inut_role.includes("OEM") ? "color-mix(in srgb, var(--green) 14%, var(--panel))" : "var(--surface-subtle, var(--paper))", color: it.inut_role.includes("OEM") ? "color-mix(in srgb, var(--green) 76%, var(--ink))" : "var(--ink-2, var(--text))", fontWeight: 700 }}>
                                    {it.inut_role}
                                  </span>
                                </td>
                                <td style={{ padding: "12px 14px", textAlign: "center" }}>
                                  <span style={{ fontSize: "11.5px", padding: "4px 8px", borderRadius: "6px", background: isOk ? "color-mix(in srgb, var(--green) 14%, var(--panel))" : "color-mix(in srgb, var(--gold) 18%, var(--panel))", color: isOk ? "color-mix(in srgb, var(--green) 76%, var(--ink))" : "color-mix(in srgb, var(--amber) 74%, var(--ink))", fontWeight: 700 }}>
                                    {isOk ? "✓ ĐÁP ỨNG" : "⚠️ CẦN XÁC NHẬN"}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  }
                  mobileCards={
                    <div className="ui-mobile-card-list" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      {activeDossierReview.items.map((it) => {
                        const isOk = it.compliance_status === "compliant";
                        return (
                          <div
                            key={it.id}
                            className="ui-mobile-card"
                            style={{
                              background: "var(--panel)",
                              borderRadius: "14px",
                              border: "1px solid var(--border)",
                              padding: "14px",
                              display: "flex",
                              flexDirection: "column",
                              gap: "10px",
                            }}
                          >
                            {/* Band 1: Header */}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                              <div style={{ minWidth: 0 }}>
                                <span style={{ fontSize: "11px", fontWeight: 800, color: "var(--muted)" }}>#{it.item_no} · Id: {it.system_id}</span>
                                <div style={{ fontWeight: 800, fontSize: "14px", color: "var(--ink)", marginTop: "2px", overflowWrap: "anywhere" }}>
                                  {it.item_name}
                                </div>
                              </div>
                              <span style={{ flexShrink: 0, fontSize: "11px", padding: "4px 8px", borderRadius: "6px", background: isOk ? "color-mix(in srgb, var(--green) 14%, var(--panel))" : "color-mix(in srgb, var(--gold) 18%, var(--panel))", color: isOk ? "color-mix(in srgb, var(--green) 76%, var(--ink))" : "color-mix(in srgb, var(--amber) 74%, var(--ink))", fontWeight: 700 }}>
                                {isOk ? "✓ ĐÁP ỨNG" : "⚠️ XÁC NHẬN"}
                              </span>
                            </div>

                            {/* Band 2: Specs & Quantity */}
                            <div style={{ background: "var(--surface-subtle, var(--paper))", padding: "10px 12px", borderRadius: "10px", border: "1px solid var(--border)", fontSize: "12.5px", display: "flex", flexDirection: "column", gap: "4px" }}>
                              <div style={{ color: "var(--ink-2, var(--text))" }}>
                                <strong>Model:</strong> {it.proposed_model} — {it.manufacturer} ({it.origin})
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap", color: "var(--muted)" }}>
                                <span>SL: <strong style={{ color: "var(--ink)" }}>{it.quantity} {it.unit}</strong></span>
                                <span>Đơn giá: <strong style={{ color: "var(--ink)" }}>{it.unit_price.toLocaleString("vi-VN")} đ</strong></span>
                              </div>
                              {it.notes && (
                                <div style={{ fontSize: "11.5px", color: "var(--primary-dark)", marginTop: "2px" }}>{it.notes}</div>
                              )}
                            </div>

                            {/* Band 3: Role & Total */}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap", paddingTop: "4px", borderTop: "1px solid var(--border)" }}>
                              <span style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", background: it.inut_role.includes("OEM") ? "color-mix(in srgb, var(--green) 14%, var(--panel))" : "var(--surface-subtle, var(--paper))", color: it.inut_role.includes("OEM") ? "color-mix(in srgb, var(--green) 76%, var(--ink))" : "var(--ink-2, var(--text))", fontWeight: 700 }}>
                                {it.inut_role}
                              </span>
                              <div style={{ fontWeight: 800, fontSize: "15px", color: "var(--ink)", fontFamily: "var(--font-mono)" }}>
                                {it.total_price.toLocaleString("vi-VN")} đ
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  }
                />
              )}

              {/* SUBTAB 4: PRICING BREAKDOWN & DISCOUNT STRATEGY */}
              {dossierSubTab === "pricing" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {/* Cost Structure Cards */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "12px" }}>
                    <div style={{ minWidth: 0, background: "var(--panel)", padding: "16px", borderRadius: "12px", border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: "11.5px", color: "var(--muted)", fontWeight: 700 }}>PHẦN MỀM SCADA (MỤC 18)</div>
                      <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--primary)", marginTop: "4px" }}>302.400.000 đ</div>
                      <div style={{ fontSize: "12px", color: "color-mix(in srgb, var(--green) 76%, var(--ink))", marginTop: "2px" }}>Chiếm 25.31% · Lãi gộp ~90%</div>
                    </div>
                    <div style={{ minWidth: 0, background: "var(--panel)", padding: "16px", borderRadius: "12px", border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: "11.5px", color: "var(--muted)", fontWeight: 700 }}>THIẾT BỊ INUT (MỤC 4 & 17)</div>
                      <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--primary-dark)", marginTop: "4px" }}>237.600.000 đ</div>
                      <div style={{ fontSize: "12px", color: "color-mix(in srgb, var(--green) 76%, var(--ink))", marginTop: "2px" }}>Chiếm 19.88% · Tự chủ OEM</div>
                    </div>
                    <div style={{ minWidth: 0, background: "var(--panel)", padding: "16px", borderRadius: "12px", border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: "11.5px", color: "var(--muted)", fontWeight: 700 }}>CẢM BIẾN QUAN TRẮC (MỤC 1-3, 14)</div>
                      <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--ink)", marginTop: "4px" }}>329.400.000 đ</div>
                      <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>Chiếm 27.57% · Radar, gầu lật</div>
                    </div>
                    <div style={{ minWidth: 0, background: "var(--panel)", padding: "16px", borderRadius: "12px", border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: "11.5px", color: "var(--muted)", fontWeight: 700 }}>MÁY CHỦ DELL & CAMERA</div>
                      <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--ink)", marginTop: "4px" }}>325.500.000 đ</div>
                      <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>Chiếm 27.24% · Dell + Hikvision</div>
                    </div>
                  </div>

                  {/* Strategic Discount Letter Template Box */}
                  <div className="panel" style={{ padding: "clamp(14px, 2.5vw, 24px)", border: "1.5px solid var(--primary)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
                      <div>
                        <span style={{ fontSize: "11px", fontWeight: 800, color: "var(--primary-dark)", textTransform: "uppercase" }}>CHIẾN LƯỢC TRÚNG THẦU TUYỆT ĐỐI</span>
                        <h3 style={{ margin: "2px 0 0 0", fontSize: "17px", color: "var(--ink)" }}>
                          Mẫu Thư Giảm Giá Chiến Lược (Đề Xuất Giảm 6% ~ 71.694.000 VNĐ)
                        </h3>
                      </div>
                      <button
                        type="button"
                        className="btn secondary"
                        style={{ minHeight: "44px" }}
                        onClick={() => {
                          const letter = `THƯ GIẢM GIÁ\nKính gửi: Công ty TNHH MTV Quản lý, khai thác công trình thủy lợi Sơn La\nGói thầu: Lắp đặt thiết bị quan trắc khí tượng thuỷ văn chuyên dùng và tài nguyên nước các hồ chứa (Bản Mòn, Suối Hòm, Suối Chiếu, Chiềng Khoi)\nMã TBMT: IB2600557773\n\nNhà thầu CÔNG TY CỔ PHẦN KỸ THUẬT TỰ ĐỘNG HÓA IOT tự nguyện giảm giá 6.0% trên tổng giá dự thầu.\nGiá sau giảm giá: 1.123.206.000 VNĐ (Một tỷ một trăm hai mươi ba triệu hai trăm linh sáu nghìn đồng).`;
                          navigator.clipboard.writeText(letter).then(() => alert("✓ Đã sao chép Mẫu Thư giảm giá vào Clipboard!"));
                        }}
                      >
                        📋 Sao Chép Mẫu Thư Giảm Giá
                      </button>
                    </div>
                    <div style={{ background: "var(--surface-subtle, var(--paper))", padding: "16px", borderRadius: "8px", border: "1px solid var(--border-strong)", fontSize: "13px", fontFamily: "var(--font-mono, monospace)", color: "var(--ink)", whiteSpace: "pre-line", lineHeight: 1.6, overflowWrap: "anywhere" }}>
                      {`CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nĐộc lập - Tự do - Hạnh phúc\n\nTHƯ GIẢM GIÁ DỰ THẦU\nKính gửi: Công ty TNHH MTV Quản lý, khai thác công trình thủy lợi Sơn La\n\nCăn cứ E-HSMT gói thầu IB2600557773;\nNhà thầu Công ty Cổ phần Kỹ thuật Tự động hóa IOT xin đề xuất mức giảm giá tự nguyện như sau:\n- Tỷ lệ giảm giá: 6,0% (Sáu phần trăm) trên tổng giá dự thầu ghi tại Mẫu số 12.1A.\n- Giá trị giảm giá: 71.694.000 VNĐ (Bảy mươi mốt triệu sáu trăm chín mươi tư nghìn đồng).\n- GIÁ DỰ THẦU SAU GIẢM GIÁ: 1.123.206.000 VNĐ (Một tỷ một trăm hai mươi ba triệu hai trăm linh sáu nghìn đồng chẵn).\n\n(Mức giá này đảm bảo Cty IOT chiến thắng tuyệt đối trước mọi đối thủ cạnh tranh mà vẫn duy trì biên lợi nhuận ròng >55%).`}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL: HỒ SƠ CHI TIẾT NHÀ THẦU & DANH SÁCH GÓI THẦU                        */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      <AppModal
        open={Boolean(selectedContractorDetail)}
        onClose={() => setSelectedContractorDetail(null)}
        size="lg"
        title={
          selectedContractorDetail ? (
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <span style={{ fontFamily: "var(--font-serif, Georgia, serif)", color: "var(--ink)" }}>
                {selectedContractorDetail.name}
              </span>
              <span
                style={{
                  padding: "3px 10px",
                  borderRadius: "999px",
                  fontSize: "11px",
                  fontWeight: 800,
                  background: selectedContractorDetail.total_won > 0
                    ? "color-mix(in srgb, var(--coral) 12%, var(--panel))"
                    : "var(--surface-subtle, var(--paper))",
                  color: selectedContractorDetail.total_won > 0
                    ? "color-mix(in srgb, var(--coral) 82%, var(--ink))"
                    : "var(--ink-2, var(--text))",
                  border: selectedContractorDetail.total_won > 0
                    ? "1px solid color-mix(in srgb, var(--coral) 40%, var(--border))"
                    : "1px solid var(--border-strong)",
                }}
              >
                {selectedContractorDetail.bidding_status_label}
              </span>
            </div>
          ) : (
            ""
          )
        }
        subtitle={
          selectedContractorDetail ? (
            <span>
              Mã số thuế:{" "}
              <strong style={{ color: "var(--ink)", fontFamily: "var(--font-mono)" }}>
                {selectedContractorDetail.tax_code}
              </strong>
              {selectedContractorDetail.address ? ` • ${selectedContractorDetail.address}` : ""}
            </span>
          ) : undefined
        }
        footer={
          selectedContractorDetail ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", width: "100%" }}>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                <button
                  type="button"
                  className="ui-btn-chip"
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
                    minHeight: "44px",
                    padding: "10px 16px",
                    borderRadius: "10px",
                    background: "var(--primary-soft)",
                    color: "var(--primary-dark)",
                    border: "1px solid color-mix(in srgb, var(--primary) 35%, var(--border))",
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
                  className="ui-btn-chip"
                  onClick={() => handleShareContractorTelegram(selectedContractorDetail)}
                  style={{
                    minHeight: "44px",
                    padding: "10px 16px",
                    borderRadius: "10px",
                    background: "linear-gradient(135deg, var(--primary), var(--primary-dark))",
                    color: "#fff",
                    border: 0,
                    fontWeight: 800,
                    fontSize: "13px",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    boxShadow: "var(--shadow)",
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
                  minHeight: "44px",
                  padding: "10px 22px",
                  borderRadius: "10px",
                  background: "var(--primary)",
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
          ) : undefined
        }
      >
        {selectedContractorDetail && (
          <>
            {/* Metrics Overview */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
                gap: "12px",
                background: "var(--surface-subtle, var(--paper))",
                padding: "16px",
                borderRadius: "14px",
                border: "1px solid var(--border)",
                marginBottom: "20px",
                alignItems: "center",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 700, textTransform: "uppercase" }}>Tổng Gói Tham Gia</span>
                <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--ink)", marginTop: "2px" }}>
                  {selectedContractorDetail.total_bids} gói
                </div>
              </div>

              <div style={{ minWidth: 0 }}>
                <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 700, textTransform: "uppercase" }}>Gói Đã Trúng Thầu</span>
                <div style={{ fontSize: "20px", fontWeight: 800, color: "color-mix(in srgb, var(--green) 76%, var(--ink))", marginTop: "2px" }}>
                  {selectedContractorDetail.total_won} gói
                </div>
              </div>

              <div style={{ minWidth: 0 }}>
                <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 700, textTransform: "uppercase" }}>Tiến Độ Thắng Thầu (Win Rate)</span>
                <div style={{ marginTop: "6px" }}>
                  <WinRateProgressBar
                    won={selectedContractorDetail.total_won}
                    total={selectedContractorDetail.total_bids}
                    rate={selectedContractorDetail.win_rate_percent}
                    size="md"
                  />
                </div>
              </div>

              <div style={{ minWidth: 0 }}>
                <span style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 700, textTransform: "uppercase" }}>Tổng Giá Trị Thắng</span>
                <div style={{ fontSize: "18px", fontWeight: 800, color: "color-mix(in srgb, var(--coral) 82%, var(--ink))", fontFamily: "var(--font-mono)", marginTop: "2px" }}>
                  {selectedContractorDetail.total_won_value_formatted}
                </div>
              </div>
            </div>

            {/* List of Won Packages Table */}
            <div style={{ marginBottom: "20px" }}>
              <h3 style={{ fontSize: "14px", fontWeight: 800, color: "var(--ink)", marginBottom: "10px", display: "flex", alignItems: "center", gap: "6px" }}>
                <span>📋</span> Danh Sách Gói Thầu Tiêu Biểu & Quyết Định Phê Duyệt
              </h3>

              {selectedContractorDetail.highlight_won_packages && selectedContractorDetail.highlight_won_packages.length > 0 ? (
                <DataView
                  mobileMode="card"
                  desktop={
                    <div className="ui-table-scroll-wrap" style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: "12px" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", textAlign: "left" }}>
                        <thead>
                          <tr style={{ background: "var(--surface-subtle, var(--paper))", borderBottom: "1px solid var(--border)", color: "var(--ink-2, var(--text))" }}>
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
                            <tr key={idx} style={{ borderBottom: "1px solid var(--border)" }}>
                              <td style={{ padding: "10px 12px" }}>
                                <button
                                  type="button"
                                  className="ui-btn-chip"
                                  onClick={() => handleOpenTenderDetail(pkg.tbmt_code, "iframe")}
                                  style={{
                                    minHeight: "38px",
                                    background: "var(--primary-soft)",
                                    border: "1px solid var(--border-strong)",
                                    color: "var(--primary-dark)",
                                    padding: "6px 10px",
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
                              <td style={{ padding: "10px 12px", fontWeight: 600, color: "var(--ink)", maxWidth: "260px" }}>
                                {pkg.tender_name}
                              </td>
                              <td style={{ padding: "10px 12px", color: "var(--ink-2, var(--text))" }}>
                                {pkg.procuring_entity}
                              </td>
                              <td style={{ padding: "10px 12px", fontFamily: "var(--font-mono)", fontWeight: 800, color: "color-mix(in srgb, var(--coral) 82%, var(--ink))" }}>
                                {formatVnd(pkg.won_price)}
                              </td>
                              <td style={{ padding: "10px 12px", color: "color-mix(in srgb, var(--green) 76%, var(--ink))", fontWeight: 700 }}>
                                {pkg.discount_percent}%
                              </td>
                              <td style={{ padding: "10px 12px", fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--muted)" }}>
                                {pkg.decision_number} ({pkg.award_date})
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  }
                  mobileCards={
                    <div className="ui-mobile-card-list" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      {selectedContractorDetail.highlight_won_packages.map((pkg, idx) => (
                        <div
                          key={idx}
                          className="ui-mobile-card"
                          style={{
                            background: "var(--panel)",
                            borderRadius: "12px",
                            border: "1px solid var(--border)",
                            padding: "12px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px",
                          }}
                        >
                          {/* Band 1: TBMT & Discount */}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                            <button
                              type="button"
                              className="ui-btn-chip"
                              onClick={() => handleOpenTenderDetail(pkg.tbmt_code, "iframe")}
                              style={{
                                minHeight: "40px",
                                background: "var(--primary-soft)",
                                border: "1px solid var(--border-strong)",
                                color: "var(--primary-dark)",
                                padding: "6px 10px",
                                borderRadius: "6px",
                                fontFamily: "var(--font-mono, monospace)",
                                fontWeight: 800,
                                fontSize: "12px",
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                            >
                              <span>🏷️</span>
                              <span style={{ textDecoration: "underline" }}>{pkg.tbmt_code}</span>
                              <span>↗</span>
                            </button>
                            <span style={{ fontSize: "11px", fontWeight: 800, padding: "3px 8px", borderRadius: "999px", background: "color-mix(in srgb, var(--green) 14%, var(--panel))", color: "color-mix(in srgb, var(--green) 76%, var(--ink))" }}>
                              Tiết kiệm {pkg.discount_percent}%
                            </span>
                          </div>

                          {/* Band 2: Tender Name & Procuring Entity */}
                          <div>
                            <div style={{ fontWeight: 700, fontSize: "13.5px", color: "var(--ink)", lineHeight: 1.4, overflowWrap: "anywhere" }}>
                              {pkg.tender_name}
                            </div>
                            <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "3px" }}>
                              🏛️ {pkg.procuring_entity}
                            </div>
                          </div>

                          {/* Band 3: Won Price & Decision */}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap", paddingTop: "6px", borderTop: "1px solid var(--border)" }}>
                            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 800, fontSize: "14px", color: "color-mix(in srgb, var(--coral) 82%, var(--ink))" }}>
                              {formatVnd(pkg.won_price)}
                            </span>
                            <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--muted)" }}>
                              {pkg.decision_number} ({pkg.award_date})
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  }
                />
              ) : (
                <div style={{ padding: "20px", textAlign: "center", color: "var(--muted)", background: "var(--surface-subtle, var(--paper))", borderRadius: "12px" }}>
                  Chưa ghi nhận gói thầu công lập trực tiếp trên cổng e-GP (Đơn vị thường tham gia dưới tư cách thầu phụ/OEM).
                </div>
              )}
            </div>

            {/* AI Strategic Analysis Box */}
            {selectedContractorDetail.ai_insight && (
              <div
                style={{
                  background: "linear-gradient(135deg, var(--primary-soft), var(--paper))",
                  padding: "16px",
                  borderRadius: "14px",
                  border: "1px solid color-mix(in srgb, var(--green) 32%, var(--border))",
                  fontSize: "13px",
                  color: "var(--ink)",
                  lineHeight: 1.6,
                }}
              >
                <div style={{ fontWeight: 800, color: "var(--primary-dark)", marginBottom: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>🤖</span> Đánh Giá Chiến Lược & Cơ Hội Hợp Tác Bằng AI:
                </div>
                <div>{selectedContractorDetail.ai_insight}</div>
              </div>
            )}
          </>
        )}
      </AppModal>

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 1: CHI TIẾT GÓI THẦU (TENDER DETAILS MODAL)                         */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      <AppModal
        open={Boolean(detailModalTender)}
        onClose={() => {
          setDetailModalTender(null);
          syncBiddingUrl(activeTab, contractorSubTab, null);
        }}
        size="lg"
        title={
          detailModalTender ? (
            <span style={{ fontFamily: "var(--font-serif, Georgia, serif)", color: "var(--ink)" }}>
              {detailModalTender.tender_name}
            </span>
          ) : (
            ""
          )
        }
        subtitle={
          detailModalTender ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
              <span
                style={{
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: "12px",
                  fontWeight: 900,
                  color: "var(--primary-dark)",
                  padding: "3px 8px",
                  borderRadius: "6px",
                  background: "var(--primary-soft)",
                }}
              >
                🏷️ {detailModalTender.tbmt_code}
              </span>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 800,
                  padding: "3px 8px",
                  borderRadius: "6px",
                  background: getFieldBadge(detailModalTender.field).bg,
                  color: getFieldBadge(detailModalTender.field).color,
                }}
              >
                {getFieldBadge(detailModalTender.field).label}
              </span>
            </span>
          ) : undefined
        }
        footer={
          detailModalTender ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", width: "100%" }}>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="ui-btn-chip"
                  onClick={() => {
                    const tender = detailModalTender;
                    setDetailModalTender(null);
                    handleOpenAiAnalysis(tender);
                  }}
                  style={{
                    minHeight: "44px",
                    padding: "10px 18px",
                    borderRadius: "10px",
                    background: "linear-gradient(110deg, var(--primary), var(--primary-dark))",
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
                  className="ui-btn-chip"
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
                    minHeight: "44px",
                    padding: "10px 16px",
                    borderRadius: "10px",
                    background: "color-mix(in srgb, var(--gold) 18%, var(--panel))",
                    color: "color-mix(in srgb, var(--amber) 74%, var(--ink))",
                    border: "1px solid color-mix(in srgb, var(--gold) 45%, var(--border))",
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
                  className="ui-btn-chip"
                  onClick={() => handleOpenExternalPortal(detailModalTender.tbmt_code, detailModalTender.source_url)}
                  style={{
                    minHeight: "44px",
                    fontSize: "13px",
                    fontWeight: 700,
                    color: "var(--primary-dark)",
                    border: "1px solid color-mix(in srgb, var(--primary) 30%, var(--border))",
                    padding: "9px 14px",
                    borderRadius: "8px",
                    background: "var(--primary-soft)",
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
          ) : undefined
        }
      >
        {detailModalTender && (
          <>
            {/* Tab Navigation inside Detail Modal */}
            <div style={{ marginBottom: "18px" }}>
              <ResponsiveTabs
                ariaLabel="Chuyển mục chi tiết gói thầu"
                active={detailModalTab}
                onChange={(t) => {
                  setDetailModalTab(t);
                  syncBiddingUrl(activeTab, contractorSubTab, detailModalTender.tbmt_code, t);
                }}
                tabs={[
                  { id: "info", label: "📋 Tóm Tắt Thông Tin" },
                  { id: "iframe", label: "📄 Toàn Văn E-HSMT (Trình Xem iFrame)" },
                  ...(detailModalTab === "attachments" || modalAttachments.length > 0
                    ? [{ id: "attachments" as const, label: "📎 Hồ Sơ Mời Thầu", badge: modalAttachments.length || undefined }]
                    : []),
                  ...(detailModalTab === "competitors" || modalCompetitors.length > 0
                    ? [{ id: "competitors" as const, label: "👥 Nhà Thầu Đối Thủ", badge: modalCompetitors.length || undefined }]
                    : []),
                ]}
              />
            </div>

            {detailModalTab === "competitors" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                {/* Full Competitors ZIP Download Banner */}
                <div
                  style={{
                    background: "linear-gradient(135deg, var(--ink), color-mix(in srgb, var(--coral) 82%, var(--ink)))",
                    borderRadius: "16px",
                    padding: "clamp(14px, 2.5vw, 22px)",
                    color: "#fff",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "14px",
                    boxShadow: "var(--shadow)",
                  }}
                >
                  <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                    <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 800, color: "#fff" }}>
                      📦 Tải Trọn Bộ E-HSDT Của Tất Cả Nhà Thầu Tham Gia (Full Competitors ZIP)
                    </h3>
                    <p style={{ margin: "4px 0 0", fontSize: "12px", color: "rgba(255,255,255,0.85)" }}>
                      Bao gồm toàn bộ đề xuất kỹ thuật, biểu giá chào thầu và hồ sơ năng lực của cả 3 nhà thầu (Thắng / Xếp hạng 2 / Bị loại).
                    </p>
                  </div>

                  <a
                    href={safeHttpUrl(api.bidding.getAllCompetitorsZipUrl(detailModalTender.tbmt_code))}
                    download
                    className="ui-btn-chip"
                    style={{
                      minHeight: "44px",
                      padding: "11px 22px",
                      borderRadius: "12px",
                      background: "var(--gold)",
                      color: "var(--ink)",
                      textDecoration: "none",
                      fontWeight: 800,
                      fontSize: "13px",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      boxShadow: "var(--shadow)",
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
                        background: "var(--panel)",
                        borderRadius: "16px",
                        border: comp.ranking === 1
                          ? "1px solid color-mix(in srgb, var(--green) 36%, var(--border))"
                          : comp.ranking === 2
                          ? "1px solid color-mix(in srgb, var(--gold) 45%, var(--border))"
                          : "1px solid color-mix(in srgb, var(--red) 35%, var(--border))",
                        padding: "clamp(14px, 2vw, 18px)",
                        boxShadow: "var(--shadow)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                      }}
                    >
                      {/* Competitor Header */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
                        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                            <strong style={{ fontSize: "15px", color: "var(--ink)" }}>{comp.contractor_name}</strong>
                            <span
                              style={{
                                fontSize: "11px",
                                fontWeight: 800,
                                padding: "3px 10px",
                                borderRadius: "999px",
                                background: comp.ranking === 1
                                  ? "color-mix(in srgb, var(--green) 14%, var(--panel))"
                                  : comp.ranking === 2
                                  ? "color-mix(in srgb, var(--coral) 12%, var(--panel))"
                                  : "color-mix(in srgb, var(--red) 12%, var(--panel))",
                                color: comp.ranking === 1
                                  ? "color-mix(in srgb, var(--green) 76%, var(--ink))"
                                  : comp.ranking === 2
                                  ? "color-mix(in srgb, var(--coral) 82%, var(--ink))"
                                  : "color-mix(in srgb, var(--red) 82%, var(--ink))",
                                border: comp.ranking === 1
                                  ? "1px solid color-mix(in srgb, var(--green) 36%, var(--border))"
                                  : comp.ranking === 2
                                  ? "1px solid color-mix(in srgb, var(--coral) 38%, var(--border))"
                                  : "1px solid color-mix(in srgb, var(--red) 35%, var(--border))",
                              }}
                            >
                              {comp.status_label}
                            </span>
                          </div>
                          <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>
                            MST: <strong style={{ color: "var(--ink-2, var(--text))", fontFamily: "var(--font-mono)" }}>{comp.tax_code}</strong> • {comp.address}
                          </div>
                        </div>

                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: "15px", fontWeight: 800, color: "color-mix(in srgb, var(--coral) 82%, var(--ink))", fontFamily: "var(--font-mono)" }}>
                            {comp.bid_price_formatted}
                          </div>
                          <div style={{ fontSize: "11px", color: "color-mix(in srgb, var(--green) 76%, var(--ink))", fontWeight: 700 }}>
                            Điểm kỹ thuật: {comp.tech_score}/100 • Giảm {comp.discount_percent}%
                          </div>
                        </div>
                      </div>

                      {/* Evaluation note */}
                      <div style={{ background: "var(--surface-subtle, var(--paper))", padding: "10px 14px", borderRadius: "10px", fontSize: "12px", color: "var(--ink-2, var(--text))", border: "1px solid var(--border)" }}>
                        <strong>Nhận xét Tổ chuyên gia:</strong> {comp.eval_result}
                      </div>

                      {/* Individual Files of this Competitor */}
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        {comp.files.map((f: any) => (
                          <a
                            key={f.file_id}
                            href={safeHttpUrl(api.bidding.getCompetitorFileDownloadUrl(detailModalTender.tbmt_code, comp.tax_code, f.file_id))}
                            download
                            className="ui-btn-chip"
                            style={{
                              minHeight: "40px",
                              padding: "8px 12px",
                              borderRadius: "8px",
                              border: "1px solid var(--border-strong)",
                              background: "var(--panel)",
                              color: "var(--ink)",
                              textDecoration: "none",
                              fontSize: "12px",
                              fontWeight: 700,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "5px",
                            }}
                          >
                            <span>📥</span>
                            <span>{f.title}</span>
                            <span style={{ color: "var(--muted)" }}>({f.size})</span>
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
                    background: "linear-gradient(135deg, var(--ink), var(--primary))",
                    borderRadius: "16px",
                    padding: "clamp(14px, 2.5vw, 22px)",
                    color: "#fff",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "14px",
                    boxShadow: "var(--shadow)",
                  }}
                >
                  <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                    <h3 style={{ margin: 0, fontSize: "17px", fontWeight: 800, color: "#fff" }}>
                      📦 Tải Trọn Bộ Hồ Sơ Mời Thầu & Biểu Mẫu (Full Package ZIP)
                    </h3>
                    <p style={{ margin: "4px 0 0", fontSize: "12px", color: "rgba(255,255,255,0.85)" }}>
                      Gói nén ZIP bao gồm tất cả 5 file: E-HSMT Yêu cầu kỹ thuật, Tiêu chuẩn đánh giá, Biểu mẫu Word và Quyết định pháp lý.
                    </p>
                  </div>

                  <a
                    href={safeHttpUrl(api.bidding.getFullDossierZipUrl(detailModalTender.tbmt_code))}
                    download
                    className="ui-btn-chip"
                    style={{
                      minHeight: "44px",
                      padding: "11px 22px",
                      borderRadius: "12px",
                      background: "var(--gold)",
                      color: "var(--ink)",
                      textDecoration: "none",
                      fontWeight: 800,
                      fontSize: "13px",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      boxShadow: "var(--shadow)",
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
                        background: "var(--panel)",
                        borderRadius: "14px",
                        border: "1px solid var(--border)",
                        padding: "14px 16px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "14px",
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ display: "flex", gap: "12px", alignItems: "center", flex: "1 1 240px", minWidth: 0 }}>
                        <span style={{ fontSize: "28px" }}>{att.icon || (att.file_type === "docx" ? "📝" : "📄")}</span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                            <strong style={{ fontSize: "14px", color: "var(--ink)" }}>{att.title}</strong>
                            <span style={{ fontSize: "10px", fontWeight: 800, padding: "2px 7px", borderRadius: "6px", background: att.file_type === "docx" ? "var(--primary-soft)" : "color-mix(in srgb, var(--green) 14%, var(--panel))", color: att.file_type === "docx" ? "var(--primary-dark)" : "color-mix(in srgb, var(--green) 76%, var(--ink))" }}>
                              {att.badge || att.file_type.toUpperCase()}
                            </span>
                            <span style={{ fontSize: "11px", color: "var(--muted)" }}>({att.file_size})</span>
                          </div>
                          <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>
                            {att.description}
                          </div>
                        </div>
                      </div>

                      <a
                        href={safeHttpUrl(api.bidding.getAttachmentDownloadUrl(detailModalTender.tbmt_code, att.file_id))}
                        download
                        className="ui-btn-chip"
                        style={{
                          minHeight: "44px",
                          padding: "9px 16px",
                          borderRadius: "10px",
                          background: att.file_type === "docx" ? "var(--primary-dark)" : "var(--primary)",
                          color: "#fff",
                          textDecoration: "none",
                          fontWeight: 700,
                          fontSize: "12px",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          boxShadow: "var(--shadow)",
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
              <div style={{ marginBottom: "10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginBottom: "8px", fontSize: "12px", color: "var(--muted)" }}>
                  <span>Trình xem trực quan E-HSMT định dạng Cổng Mua Sắm Công:</span>
                  <a
                    href={safeHttpUrl(api.bidding.getHtmlPreviewUrl(detailModalTender.tbmt_code))}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--primary-dark)", fontWeight: 700, textDecoration: "none" }}
                  >
                    🌐 Mở tab toàn màn hình ↗
                  </a>
                </div>
                <div style={{ borderRadius: "12px", overflow: "hidden", border: "1px solid var(--border-strong)", height: "min(540px, 60dvh)", background: "var(--surface-subtle, var(--paper))" }}>
                  <iframe
                    src={safeHttpUrl(api.bidding.getHtmlPreviewUrl(detailModalTender.tbmt_code))}
                    sandbox=""
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
                    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
                    gap: "14px",
                    padding: "16px 20px",
                    borderRadius: "14px",
                    background: "linear-gradient(135deg, var(--ink), var(--primary-dark))",
                    color: "#fff",
                    marginBottom: "20px",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontSize: "11px", color: "var(--mint, var(--primary-soft))", display: "block", fontWeight: 700 }}>
                      GIÁ GÓI THẦU (DỰ TOÁN)
                    </span>
                    <strong style={{ fontSize: "22px", fontFamily: "var(--font-serif, Georgia, serif)", color: "var(--gold)" }}>
                      {formatVnd(detailModalTender.bid_price)}
                    </strong>
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontSize: "11px", color: "var(--mint, var(--primary-soft))", display: "block", fontWeight: 700 }}>
                      THỜI ĐIỂM ĐÓNG THẦU
                    </span>
                    <strong style={{ fontSize: "14px", color: "#fff" }}>
                      {formatDate(detailModalTender.bid_deadline)}
                    </strong>
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontSize: "11px", color: "var(--mint, var(--primary-soft))", display: "block", fontWeight: 700 }}>
                      ĐỊA BÀN THỰC HIỆN
                    </span>
                    <strong style={{ fontSize: "14px", color: "#fff" }}>
                      {detailModalTender.province || "Toàn quốc"}
                    </strong>
                  </div>
                </div>

                {/* Specifications Grid */}
                <FormGrid cols={2} style={{ marginBottom: "20px", fontSize: "13px" }}>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ color: "var(--primary-dark)" }}>Bên mời thầu:</strong>
                    <div style={{ color: "var(--ink)", marginTop: "2px" }}>{detailModalTender.procuring_entity || "—"}</div>
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <strong style={{ color: "var(--primary-dark)" }}>Chủ đầu tư:</strong>
                    <div style={{ color: "var(--ink)", marginTop: "2px" }}>{detailModalTender.investor || "—"}</div>
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <strong style={{ color: "var(--primary-dark)" }}>Hình thức lựa chọn:</strong>
                    <div style={{ color: "var(--ink)", marginTop: "2px" }}>{detailModalTender.bidding_method || "Đấu thầu rộng rãi qua mạng"}</div>
                  </div>

                  {detailModalTender.decision_number && (
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ color: "var(--primary-dark)" }}>Số quyết định phê duyệt:</strong>
                      <div style={{ color: "var(--ink)", marginTop: "2px" }}>{detailModalTender.decision_number}</div>
                    </div>
                  )}

                  {detailModalTender.bid_validity_period_days != null && (
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ color: "var(--primary-dark)" }}>Hiệu lực HSDT:</strong>
                      <div style={{ color: "var(--ink)", marginTop: "2px" }}>{detailModalTender.bid_validity_period_days} ngày</div>
                    </div>
                  )}

                  {detailModalTender.execution_period_days != null && (
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ color: "var(--primary-dark)" }}>Thời gian thực hiện hợp đồng:</strong>
                      <div style={{ color: "var(--ink)", marginTop: "2px" }}>{detailModalTender.execution_period_days} ngày</div>
                    </div>
                  )}
                </FormGrid>

                {/* Description / Summary if available */}
                {detailModalTender.description && (
                  <div
                    style={{
                      padding: "14px 16px",
                      borderRadius: "12px",
                      background: "var(--surface-subtle, var(--paper))",
                      border: "1px solid var(--border)",
                      marginBottom: "8px",
                      fontSize: "13px",
                      lineHeight: 1.6,
                      color: "var(--ink-2, var(--text))",
                    }}
                  >
                    <strong style={{ display: "block", color: "var(--primary-dark)", marginBottom: "6px" }}>MÔ TẢ PHẠM VI CÔNG VIỆC:</strong>
                    {detailModalTender.description}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </AppModal>

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 2: BÁO CÁO AI PHÂN TÍCH HSMT & ĐIỂM CHIẾN LƯỢC INUT                */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      <AppModal
        open={Boolean(aiModalTender || aiModalResult || aiLoading)}
        dismissible={!aiLoading}
        onClose={() => {
          if (!aiLoading) {
            setAiModalTender(null);
            setAiModalResult(null);
          }
        }}
        size="lg"
        title={
          <span style={{ fontFamily: "var(--font-serif, Georgia, serif)", color: "var(--ink)" }}>
            Phân Tích Hồ Sơ Mời Thầu & Độ Phù Hợp Chiến Lược
          </span>
        }
        subtitle={
          <span>
            <span
              style={{
                display: "block",
                fontSize: "11px",
                fontWeight: 900,
                letterSpacing: ".12em",
                color: "var(--primary-dark)",
                textTransform: "uppercase",
              }}
            >
              🧠 AI TENDER STRATEGIC RADAR — INUT CORPS (MST 4401053694)
            </span>
            {aiModalTender && (
              <span style={{ display: "block", marginTop: "3px" }}>
                Gói thầu: <strong>{aiModalTender.tender_name}</strong> ({aiModalTender.tbmt_code})
              </span>
            )}
          </span>
        }
        footer={
          !aiLoading && aiModalResult ? (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", width: "100%" }}>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                <button
                  type="button"
                  className="ui-btn-chip"
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
                    minHeight: "44px",
                    padding: "10px 16px",
                    borderRadius: "10px",
                    background: "var(--primary-soft)",
                    color: "var(--primary-dark)",
                    border: "1px solid color-mix(in srgb, var(--primary) 35%, var(--border))",
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
                  className="ui-btn-chip"
                  onClick={() => handleShareAiTelegram(aiModalTender, aiModalResult.analysis)}
                  style={{
                    minHeight: "44px",
                    padding: "10px 16px",
                    borderRadius: "10px",
                    background: "linear-gradient(135deg, var(--primary), var(--primary-dark))",
                    color: "#fff",
                    border: 0,
                    fontWeight: 800,
                    fontSize: "13px",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    boxShadow: "var(--shadow)",
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
                  className="ui-btn-chip"
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
                    minHeight: "44px",
                    padding: "10px 18px",
                    borderRadius: "10px",
                    background: "var(--primary)",
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
                  className="ui-btn-chip"
                  onClick={() => {
                    setAiModalTender(null);
                    setAiModalResult(null);
                  }}
                  style={{
                    minHeight: "44px",
                    padding: "10px 16px",
                    borderRadius: "10px",
                    background: "var(--surface-subtle, var(--paper))",
                    color: "var(--ink-2, var(--text))",
                    border: "1px solid var(--border-strong)",
                    fontWeight: 700,
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  Đóng
                </button>
              </div>
            </div>
          ) : undefined
        }
      >
        {/* AI Loading State */}
        {aiLoading && (
          <div
            style={{
              padding: "48px 20px",
              textAlign: "center",
              background: "linear-gradient(135deg, var(--surface-subtle, var(--paper)), var(--paper))",
              borderRadius: "18px",
              border: "1px solid var(--border)",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                border: "4px solid var(--primary)",
                borderTopColor: "transparent",
                margin: "0 auto 18px",
                animation: "spin 1s linear infinite",
              }}
            />
            <h3 style={{ fontFamily: "var(--font-serif, Georgia, serif)", color: "var(--ink)", margin: "0 0 8px" }}>
              AI Đang Bóc Tách & Đánh Giá E-HSMT...
            </h3>
            <p style={{ maxWidth: "520px", margin: "0 auto", fontSize: "13px", color: "var(--muted)" }}>
              Trích xuất điều kiện năng lực, doanh thu, thời hạn nộp thầu và đối chiếu với năng lực sản xuất IoT / SCADA của INUT.
            </p>
          </div>
        )}

        {/* AI Error */}
        {aiError && (
          <div
            style={{
              padding: "18px 20px",
              borderRadius: "14px",
              background: "color-mix(in srgb, var(--red) 10%, var(--panel))",
              border: "1px solid color-mix(in srgb, var(--red) 35%, var(--border))",
              color: "color-mix(in srgb, var(--red) 82%, var(--ink))",
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
              const scoreColor =
                score >= 80
                  ? "color-mix(in srgb, var(--green) 76%, var(--ink))"
                  : score >= 60
                  ? "color-mix(in srgb, var(--amber) 74%, var(--ink))"
                  : "color-mix(in srgb, var(--red) 82%, var(--ink))";
              const scoreBg =
                score >= 80
                  ? "var(--primary-soft)"
                  : score >= 60
                  ? "color-mix(in srgb, var(--gold) 22%, var(--panel))"
                  : "color-mix(in srgb, var(--red) 14%, var(--panel))";

              return (
                <div
                  style={{
                    padding: "clamp(14px, 2.5vw, 22px)",
                    borderRadius: "18px",
                    background: "linear-gradient(135deg, var(--ink), var(--primary-dark) 65%, var(--amber))",
                    color: "#fff",
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: "18px 24px",
                    boxShadow: "var(--shadow-md)",
                  }}
                >
                  {/* Big Score Radial Badge */}
                  <div
                    style={{
                      flex: "0 0 auto",
                      width: "96px",
                      height: "96px",
                      borderRadius: "50%",
                      background: "rgba(255,255,255,0.12)",
                      border: "3px solid var(--gold)",
                      display: "grid",
                      placeItems: "center",
                      textAlign: "center",
                    }}
                  >
                    <div>
                      <span style={{ fontSize: "28px", fontWeight: 900, fontFamily: "var(--font-serif, Georgia, serif)", color: "var(--gold)", lineHeight: 1 }}>
                        {score}
                      </span>
                      <span style={{ fontSize: "10px", display: "block", color: "rgba(255,255,255,0.82)", letterSpacing: ".1em" }}>
                        / 100 ĐIỂM
                      </span>
                    </div>
                  </div>

                  {/* Score Summary Copy */}
                  <div style={{ flex: "1 1 220px", minWidth: 0 }}>
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

                      <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--gold)" }}>
                        Khuyến nghị: {fit?.recommendation || (score >= 80 ? "Nên tham gia độc lập" : "Khuyến nghị liên danh")}
                      </span>
                    </div>

                    <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.88)", lineHeight: 1.55 }}>
                      {aiModalResult.analysis.executive_summary || aiModalResult.analysis.summary || "Đánh giá chi tiết năng lực dự thầu."}
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* ─── Capacity & Financial Requirements 2-Column ─────────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: "16px" }}>
              {/* Capacity & Experience */}
              <div
                style={{
                  minWidth: 0,
                  padding: "16px 18px",
                  borderRadius: "14px",
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                }}
              >
                <h4 style={{ color: "var(--primary-dark)", fontSize: "14px", margin: "0 0 10px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>📜</span> Yêu Cầu Năng Lực & Kinh Nghiệm
                </h4>
                {Array.isArray(aiModalResult.analysis.capacity_requirements) ? (
                  <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "var(--ink-2, var(--text))", lineHeight: 1.6 }}>
                    {aiModalResult.analysis.capacity_requirements.map((req, idx) => (
                      <li key={idx}>{req}</li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ margin: 0, fontSize: "13px", color: "var(--ink-2, var(--text))", lineHeight: 1.6 }}>
                    {aiModalResult.analysis.capacity_requirements || "Không có yêu cầu đặc biệt."}
                  </p>
                )}
              </div>

              {/* Financial Requirements */}
              <div
                style={{
                  minWidth: 0,
                  padding: "16px 18px",
                  borderRadius: "14px",
                  background: "var(--panel)",
                  border: "1px solid var(--border)",
                }}
              >
                <h4 style={{ color: "var(--primary-dark)", fontSize: "14px", margin: "0 0 10px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>💰</span> Điều Kiện Tài Chính & Doanh Thu
                </h4>
                {typeof aiModalResult.analysis.financial_requirements === "object" && aiModalResult.analysis.financial_requirements !== null ? (
                  <div style={{ fontSize: "13px", color: "var(--ink-2, var(--text))", display: "grid", gap: "6px" }}>
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
                      <div style={{ color: "var(--muted)", marginTop: "4px" }}>
                        {aiModalResult.analysis.financial_requirements.summary}
                      </div>
                    )}
                  </div>
                ) : (
                  <p style={{ margin: 0, fontSize: "13px", color: "var(--ink-2, var(--text))", lineHeight: 1.6 }}>
                    {aiModalResult.analysis.revenue_requirements || String(aiModalResult.analysis.financial_requirements || "Đáp ứng theo quy định e-GP.")}
                  </p>
                )}
              </div>
            </div>

            {/* ─── Strengths & Challenges / Action Plan ───────────────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: "16px" }}>
              {/* Strengths */}
              <div
                style={{
                  minWidth: 0,
                  padding: "16px 18px",
                  borderRadius: "14px",
                  background: "var(--primary-soft)",
                  border: "1px solid color-mix(in srgb, var(--green) 32%, var(--border))",
                }}
              >
                <h4 style={{ color: "color-mix(in srgb, var(--green) 76%, var(--ink))", fontSize: "14px", margin: "0 0 10px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>✅</span> Lợi Thế Cạnh Tranh Của INUT
                </h4>
                <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "var(--ink)", lineHeight: 1.6 }}>
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
                  minWidth: 0,
                  padding: "16px 18px",
                  borderRadius: "14px",
                  background: "var(--paper)",
                  border: "1px solid color-mix(in srgb, var(--gold) 45%, var(--border))",
                }}
              >
                <h4 style={{ color: "color-mix(in srgb, var(--amber) 74%, var(--ink))", fontSize: "14px", margin: "0 0 10px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>⚠️</span> Thách Thức & Kế Hoạch Hành Động
                </h4>
                {aiModalResult.analysis.inut_fit_analysis?.strategic_action_plan ? (
                  <p style={{ margin: 0, fontSize: "13px", color: "var(--ink-2, var(--text))", lineHeight: 1.6 }}>
                    {aiModalResult.analysis.inut_fit_analysis.strategic_action_plan}
                  </p>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "var(--ink-2, var(--text))", lineHeight: 1.6 }}>
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
          </div>
        )}
      </AppModal>

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 3: LƯU / SỬA GÓI THẦU QUAN TÂM (BOOKMARK MODAL)                     */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      <AppModal
        open={Boolean(bookmarkModalItem)}
        onClose={() => setBookmarkModalItem(null)}
        size="md"
        title={
          bookmarkModalItem ? (
            <span style={{ fontFamily: "var(--font-serif, Georgia, serif)", color: "var(--ink)" }}>
              {bookmarkModalItem.existingId ? "Cập Nhật Thông Tin Gói Thầu" : "Thêm Vào Danh Sách Quan Tâm"}
            </span>
          ) : (
            ""
          )
        }
        subtitle={
          <span style={{ fontSize: "11px", fontWeight: 900, color: "var(--primary-dark)", letterSpacing: ".12em" }}>
            ⭐ QUẢN LÝ CƠ HỘI DỰ THẦU
          </span>
        }
        footer={
          <>
            <button
              type="button"
              onClick={() => setBookmarkModalItem(null)}
              style={{
                minHeight: "44px",
                padding: "10px 16px",
                borderRadius: "10px",
                background: "var(--surface-subtle, var(--paper))",
                color: "var(--ink-2, var(--text))",
                border: "1px solid var(--border-strong)",
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
                minHeight: "44px",
                padding: "10px 20px",
                borderRadius: "10px",
                background: "var(--primary)",
                color: "#fff",
                border: "0",
                fontWeight: 800,
                fontSize: "13px",
                cursor: "pointer",
              }}
            >
              Lưu vào theo dõi ⭐
            </button>
          </>
        }
      >
        {bookmarkModalItem && (
          <>
            <div style={{ marginBottom: "16px", fontSize: "13px", color: "var(--ink-2, var(--text))" }}>
              <strong>{bookmarkModalItem.tender.tender_name}</strong>
              <div style={{ color: "var(--muted)", marginTop: "2px" }}>
                Mã TBMT: {bookmarkModalItem.tender.tbmt_code} · Giá gói: {formatVnd(bookmarkModalItem.tender.bid_price)}
              </div>
            </div>

            <div style={{ display: "grid", gap: "14px" }}>
              {/* Status Select */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "var(--primary-dark)", marginBottom: "5px" }}>
                  TRẠNG THÁI PIPELINE DỰ THẦU:
                </label>
                <select
                  className="ui-select"
                  value={bookmarkModalItem.status}
                  onChange={(e) =>
                    setBookmarkModalItem({
                      ...bookmarkModalItem,
                      status: e.target.value as any,
                    })
                  }
                  style={{
                    width: "100%",
                    minHeight: "44px",
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid var(--border-strong)",
                    background: "var(--panel)",
                    color: "var(--ink)",
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
                <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "var(--primary-dark)", marginBottom: "5px" }}>
                  GHI CHÚ NỘI BỘ (CHIẾN LƯỢC / GIÁ / LIÊN DANH):
                </label>
                <textarea
                  className="ui-textarea"
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
                    border: "1px solid var(--border-strong)",
                    background: "var(--panel)",
                    color: "var(--ink)",
                    fontFamily: "inherit",
                  }}
                />
              </div>
            </div>
          </>
        )}
      </AppModal>

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL 4: THÊM / SỬA QUY TẮC WATCHLIST (WATCHLIST MODAL)                    */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      <AppModal
        open={Boolean(watchlistModalRule)}
        onClose={() => setWatchlistModalRule(null)}
        size="md"
        title={
          watchlistModalRule ? (
            <span style={{ fontFamily: "var(--font-serif, Georgia, serif)", color: "var(--ink)" }}>
              {watchlistModalRule.id ? "Sửa Quy Tắc Săn Thầu" : "Tạo Quy Tắc Săn Thầu Mới"}
            </span>
          ) : (
            ""
          )
        }
        subtitle={
          <span style={{ fontSize: "11px", fontWeight: 900, color: "var(--primary-dark)", letterSpacing: ".12em" }}>
            ⚙️ BỘ LỌC SĂN THẦU TỰ ĐỘNG
          </span>
        }
        footer={
          watchlistModalRule ? (
            <>
              <button
                type="button"
                onClick={() => setWatchlistModalRule(null)}
                style={{
                  minHeight: "44px",
                  padding: "10px 16px",
                  borderRadius: "10px",
                  background: "var(--surface-subtle, var(--paper))",
                  color: "var(--ink-2, var(--text))",
                  border: "1px solid var(--border-strong)",
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
                  minHeight: "44px",
                  padding: "10px 20px",
                  borderRadius: "10px",
                  background: "var(--primary)",
                  color: "#fff",
                  border: "0",
                  fontWeight: 800,
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                {watchlistModalRule.id ? "Lưu thay đổi" : "Tạo quy tắc mới"}
              </button>
            </>
          ) : undefined
        }
      >
        {watchlistModalRule && (
          <div style={{ display: "grid", gap: "14px" }}>
            {/* Name */}
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "var(--primary-dark)", marginBottom: "5px" }}>
                TÊN QUY TẮC BỘ LỌC (*):
              </label>
              <input
                className="ui-input"
                type="text"
                value={watchlistModalRule.name || ""}
                onChange={(e) => setWatchlistModalRule({ ...watchlistModalRule, name: e.target.value })}
                placeholder="VD: Thiết bị SCADA & IoT TP.HCM"
                style={{
                  width: "100%",
                  minHeight: "44px",
                  padding: "10px 12px",
                  borderRadius: "10px",
                  border: "1px solid var(--border-strong)",
                  background: "var(--panel)",
                  color: "var(--ink)",
                }}
              />
            </div>

            {/* Keyword & Field Grid */}
            <FormGrid cols={2}>
              <div style={{ minWidth: 0 }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "var(--primary-dark)", marginBottom: "5px" }}>
                  TỪ KHÓA TÌM KIẾM:
                </label>
                <input
                  className="ui-input"
                  type="text"
                  value={watchlistModalRule.keyword || ""}
                  onChange={(e) => setWatchlistModalRule({ ...watchlistModalRule, keyword: e.target.value })}
                  placeholder="VD: SCADA, IoT, quan trắc"
                  style={{
                    width: "100%",
                    minHeight: "44px",
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid var(--border-strong)",
                    background: "var(--panel)",
                    color: "var(--ink)",
                  }}
                />
              </div>

              <div style={{ minWidth: 0 }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "var(--primary-dark)", marginBottom: "5px" }}>
                  LĨNH VỰC:
                </label>
                <select
                  className="ui-select"
                  value={watchlistModalRule.field || ""}
                  onChange={(e) => setWatchlistModalRule({ ...watchlistModalRule, field: e.target.value })}
                  style={{
                    width: "100%",
                    minHeight: "44px",
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid var(--border-strong)",
                    background: "var(--panel)",
                    color: "var(--ink)",
                  }}
                >
                  {FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            </FormGrid>

            {/* Province */}
            <div>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "var(--primary-dark)", marginBottom: "5px" }}>
                TỈNH / THÀNH PHỐ MỤC TIÊU:
              </label>
              <select
                className="ui-select"
                value={watchlistModalRule.province || ""}
                onChange={(e) => setWatchlistModalRule({ ...watchlistModalRule, province: e.target.value })}
                style={{
                  width: "100%",
                  minHeight: "44px",
                  padding: "10px 12px",
                  borderRadius: "10px",
                  border: "1px solid var(--border-strong)",
                  background: "var(--panel)",
                  color: "var(--ink)",
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
            <FormGrid cols={2}>
              <div style={{ minWidth: 0 }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "var(--primary-dark)", marginBottom: "5px" }}>
                  GIÁ TỐI THIỂU (VND):
                </label>
                <input
                  className="ui-input"
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
                    minHeight: "44px",
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid var(--border-strong)",
                    background: "var(--panel)",
                    color: "var(--ink)",
                  }}
                />
              </div>

              <div style={{ minWidth: 0 }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 800, color: "var(--primary-dark)", marginBottom: "5px" }}>
                  GIÁ TỐI ĐA (VND):
                </label>
                <input
                  className="ui-input"
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
                    minHeight: "44px",
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid var(--border-strong)",
                    background: "var(--panel)",
                    color: "var(--ink)",
                  }}
                />
              </div>
            </FormGrid>

            {/* Toggles */}
            <div
              style={{
                display: "flex",
                gap: "16px",
                flexWrap: "wrap",
                padding: "10px 14px",
                borderRadius: "10px",
                background: "var(--surface-subtle, var(--paper))",
                border: "1px solid var(--border)",
              }}
            >
              <label style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "44px", fontSize: "13px", fontWeight: 700, color: "var(--ink)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={watchlistModalRule.is_active ?? true}
                  onChange={(e) => setWatchlistModalRule({ ...watchlistModalRule, is_active: e.target.checked })}
                  style={{ width: "18px", height: "18px" }}
                />
                <span>Kích hoạt tự động quét</span>
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "44px", fontSize: "13px", fontWeight: 700, color: "var(--primary-dark)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={watchlistModalRule.notify_telegram ?? true}
                  onChange={(e) => setWatchlistModalRule({ ...watchlistModalRule, notify_telegram: e.target.checked })}
                  style={{ width: "18px", height: "18px" }}
                />
                <span>✈️ Bắn tin cảnh báo Telegram</span>
              </label>
            </div>
          </div>
        )}
      </AppModal>

      {/* MODAL: NHẬP HỒ SƠ THẦU MỚI TỪ GOOGLE DRIVE */}
      <AppModal
        open={showImportDriveModal}
        onClose={() => setShowImportDriveModal(false)}
        size="md"
        title={
          <span style={{ fontFamily: "var(--font-serif, Georgia, serif)", color: "var(--ink)" }}>
            Nhập Hồ Sơ Thầu Từ Google Drive
          </span>
        }
        subtitle={
          <span style={{ fontSize: "11px", fontWeight: 800, color: "var(--primary-dark)", textTransform: "uppercase" }}>
            TỰ ĐỘNG HÓA THẨM ĐỊNH THẦU
          </span>
        }
        footer={
          <>
            <button
              type="button"
              className="btn secondary"
              style={{ minHeight: "44px" }}
              onClick={() => setShowImportDriveModal(false)}
            >
              Hủy
            </button>
            <button
              type="submit"
              form="bidding-import-drive-form"
              className="btn primary"
              style={{ minHeight: "44px", background: "var(--primary)", color: "#fff" }}
              disabled={importDriveLoading}
            >
              {importDriveLoading ? "⏳ Đang thẩm định..." : "⚡ Bắt Đầu Thẩm Định Đa Tác Nhân"}
            </button>
          </>
        }
      >
        <form id="bidding-import-drive-form" onSubmit={handleImportDossierFromDrive} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div>
            <label style={{ display: "block", fontSize: "12.5px", fontWeight: 700, color: "var(--ink-2, var(--text))", marginBottom: "4px" }}>
              Đường dẫn thư mục Google Drive chứa hồ sơ thầu (DOCX / PDF):
            </label>
            <input
              className="ui-input"
              type="url"
              required
              placeholder="https://drive.google.com/drive/folders/..."
              value={importDriveUrl}
              onChange={(e) => setImportDriveUrl(e.target.value)}
              style={{ width: "100%", minHeight: "44px", padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--border-strong)", background: "var(--panel)", color: "var(--ink)", boxSizing: "border-box" }}
            />
            <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "4px" }}>
              💡 Hỗ trợ đọc tự động toàn bộ tài liệu thuyết minh pháp lý, hợp đồng tương tự, BCTC, đối chiếu kỹ thuật, bảng giá Mẫu 12.1A.
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "12.5px", fontWeight: 700, color: "var(--ink-2, var(--text))", marginBottom: "4px" }}>
              Ghi chú chỉ đạo thẩm định (nếu có):
            </label>
            <textarea
              className="ui-textarea"
              rows={3}
              placeholder="Ví dụ: Kiểm tra kỹ tính hợp lệ cty IoT, đối chiếu thiết bị iNut, kiểm tra lỗi placeholder..."
              value={importDriveNotes}
              onChange={(e) => setImportDriveNotes(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--border-strong)", background: "var(--panel)", color: "var(--ink)", boxSizing: "border-box", fontFamily: "inherit" }}
            />
          </div>
        </form>
      </AppModal>

      {/* PROMPT DIALOG: CHỈNH SỬA GHI CHÚ CHIẾN LƯỢC BOOKMARK */}
      <PromptDialog
        open={Boolean(notePromptBookmark)}
        title="Sửa ghi chú chiến lược dự thầu"
        label="Nhập ghi chú chiến lược dự thầu:"
        defaultValue={notePromptBookmark?.note || ""}
        placeholder="Nhập phân công, phương án tính giá hoặc ghi nhớ đối tác..."
        confirmLabel="Lưu ghi chú"
        onCancel={() => setNotePromptBookmark(null)}
        onConfirm={(newNote) => {
          if (!notePromptBookmark) return;
          const target = notePromptBookmark;
          setNotePromptBookmark(null);
          api.bidding
            .updateBookmark(target.id, { note: newNote })
            .then((up) => {
              setBookmarks((prev) => prev.map((item) => (item.id === target.id ? up : item)));
              showToast("Đã cập nhật ghi chú", "success");
            })
            .catch((e) => showToast(e.message, "error"));
        }}
      />
    </div>
  );
}
