import type {
  BiddingAIAnalysisData,
  BiddingContractorItem,
  BiddingTenderDetail,
  BiddingTenderSummary,
} from "../../api";
import {
  AppIcon,
  StatusBadge,
  type IconName,
  type StatusBadgeTone,
} from "../../components/ui";

export type BiddingMainTab =
  | "search"
  | "bookmarks"
  | "watchlist"
  | "contractors"
  | "dossier_reviews";

export type ContractorSubTab = "crm_contractors" | "won_packages_playbook";
export type DossierSubTab = "executive" | "files" | "items" | "pricing";
export type DetailModalTab = "info" | "iframe" | "attachments" | "competitors";
export type BookmarkStatusKey = "watching" | "preparing" | "submitted" | "won" | "lost";

export interface BookmarkModalState {
  tender: BiddingTenderSummary;
  status: BookmarkStatusKey;
  note: string;
  existingId?: number;
}

export interface WonPackagesState {
  total_packages: number;
  total_won_value_vnd: number;
  total_won_value_formatted: string;
  average_discount_percent: number;
  packages: any[];
}

export function formatVnd(val?: number | null): string {
  if (val == null || Number.isNaN(val)) return "0 ₫";
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(val);
}

export function formatVndShort(val?: number | null): string {
  if (val == null || Number.isNaN(val) || val === 0) return "0 ₫";
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

export function formatDate(dStr?: string | null): string {
  if (!dStr) return "—";
  try {
    const d = new Date(dStr);
    if (Number.isNaN(d.getTime())) return dStr;
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

export function getDeadlineMeta(deadlineStr?: string | null): {
  label: string;
  status: "open" | "urgent" | "closed" | "unknown";
  tone: StatusBadgeTone;
  daysLeft: number;
} {
  if (!deadlineStr) {
    return { label: "Chưa xác định", status: "unknown", tone: "neutral", daysLeft: 999 };
  }
  try {
    const target = new Date(deadlineStr).getTime();
    if (Number.isNaN(target)) {
      return { label: deadlineStr, status: "unknown", tone: "neutral", daysLeft: 999 };
    }
    const diff = target - Date.now();
    if (diff <= 0) {
      return { label: "Đã đóng thầu", status: "closed", tone: "danger", daysLeft: -1 };
    }
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days === 0) {
      return { label: `Hết hạn trong ${hours} giờ`, status: "urgent", tone: "warning", daysLeft: 0 };
    }
    if (days <= 3) {
      return { label: `Còn ${days} ngày ${hours}h`, status: "urgent", tone: "warning", daysLeft: days };
    }
    return { label: `Còn ${days} ngày`, status: "open", tone: "success", daysLeft: days };
  } catch {
    return { label: deadlineStr, status: "unknown", tone: "neutral", daysLeft: 999 };
  }
}

const FIELD_MAP: Record<string, { label: string; tone: StatusBadgeTone }> = {
  HH: { label: "Hàng hóa", tone: "brand" },
  "Hàng hóa": { label: "Hàng hóa", tone: "brand" },
  XL: { label: "Xây lắp", tone: "warning" },
  "Xây lắp": { label: "Xây lắp", tone: "warning" },
  TV: { label: "Tư vấn", tone: "info" },
  "Tư vấn": { label: "Tư vấn", tone: "info" },
  PTV: { label: "Phi tư vấn", tone: "danger" },
  "Phi tư vấn": { label: "Phi tư vấn", tone: "danger" },
  HHOP: { label: "Hỗn hợp", tone: "neutral" },
  "Hỗn hợp": { label: "Hỗn hợp", tone: "neutral" },
};

export function getFieldBadge(field?: string): { label: string; tone: StatusBadgeTone } {
  if (!field) return { label: "Khác", tone: "neutral" };
  return FIELD_MAP[field] || { label: field, tone: "brand" };
}

export const BOOKMARK_STATUS_MAP: Record<
  BookmarkStatusKey,
  { label: string; tone: StatusBadgeTone; icon: IconName; desc: string }
> = {
  watching: {
    label: "Đang theo dõi",
    tone: "warning",
    icon: "eye",
    desc: "Nghiên cứu sơ bộ yêu cầu & HSMT",
  },
  preparing: {
    label: "Chuẩn bị hồ sơ",
    tone: "info",
    icon: "file-text",
    desc: "Đang lập E-HSDT, tính toán giá & liên danh",
  },
  submitted: {
    label: "Đã nộp thầu",
    tone: "brand",
    icon: "send",
    desc: "Đã nộp E-HSDT thành công trên mạng e-GP",
  },
  won: {
    label: "Trúng thầu",
    tone: "success",
    icon: "award",
    desc: "Trúng thầu & chuẩn bị ký hợp đồng",
  },
  lost: {
    label: "Trượt thầu",
    tone: "danger",
    icon: "x",
    desc: "Không trúng thầu hoặc hủy thầu",
  },
};

export const PROVINCES = [
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

export const FIELDS = [
  { value: "", label: "Tất cả lĩnh vực" },
  { value: "HH", label: "Hàng hóa (HH)" },
  { value: "XL", label: "Xây lắp (XL)" },
  { value: "TV", label: "Tư vấn (TV)" },
  { value: "PTV", label: "Phi tư vấn (PTV)" },
  { value: "HHOP", label: "Hỗn hợp (HHOP)" },
];

export const PRICE_PRESETS: Array<{ label: string; min: number | ""; max: number | "" }> = [
  { label: "< 500 Triệu", min: 0, max: 500_000_000 },
  { label: "500 Tr – 2 Tỷ", min: 500_000_000, max: 2_000_000_000 },
  { label: "2 Tỷ – 10 Tỷ", min: 2_000_000_000, max: 10_000_000_000 },
  { label: "> 10 Tỷ (Liên danh)", min: 10_000_000_000, max: "" },
];

export function WinRateProgressBar({
  won,
  total,
  rate,
}: {
  won: number;
  total: number;
  rate: number;
}) {
  const percent = Math.min(100, Math.max(0, rate));
  const lost = Math.max(0, total - won);
  const tier = percent >= 60 ? "high" : percent >= 30 ? "mid" : "low";
  const badgeTone: StatusBadgeTone =
    tier === "high" ? "success" : tier === "mid" ? "warning" : "danger";

  return (
    <div className="ui-stack--xs ui-w-full">
      <div className="ui-row-between">
        <span className="ui-row ui-muted">
          <AppIcon name="award" size={14} />
          <span>
            Trúng: <strong>{won}</strong> / {total} gói
            {lost > 0 ? ` (${lost} trượt)` : ""}
          </span>
        </span>
        <StatusBadge tone={badgeTone} size="sm" icon="zap">
          {rate}% Thắng
        </StatusBadge>
      </div>
      <progress
        className={`ui-progress ui-progress--md ${tier === "high" ? "ui-progress--success" : tier === "mid" ? "ui-progress--gold" : "ui-progress--danger"}`}
        value={percent}
        max={100}
        aria-label={`Tỷ lệ trúng thầu ${rate}%`}
      />
    </div>
  );
}

export function generateAiAnalysisMarkdown(
  tender: BiddingTenderSummary | BiddingTenderDetail | null,
  analysis: BiddingAIAnalysisData,
): string {
  const fit = analysis.inut_fit_analysis;
  const score = fit?.score ?? analysis.inut_compatibility_score ?? 85;
  const matchLevel =
    fit?.match_level || (score >= 80 ? "RẤT CAO" : score >= 60 ? "TRUNG BÌNH" : "THẤP");
  const rec =
    fit?.recommendation || (score >= 80 ? "Nên tham gia độc lập" : "Khuyến nghị liên danh");

  const lines: string[] = [
    "# BÁO CÁO PHÂN TÍCH E-HSMT & ĐỘ PHÙ HỢP CHIẾN LƯỢC INUT",
    `**Thời gian trích xuất**: ${new Date().toLocaleString("vi-VN")}`,
    "**Đơn vị đánh giá**: INUT Technology Bidding Strategic Radar (MST 4401053694)",
    "",
    "## 1. Thông Tin Gói Thầu",
    `- **Mã TBMT**: ${tender?.tbmt_code || "—"}`,
    `- **Tên gói thầu**: ${tender?.tender_name || "—"}`,
    `- **Bên mời thầu**: ${tender?.procuring_entity || "—"}`,
    `- **Chủ đầu tư**: ${tender?.investor || "—"}`,
    `- **Giá gói thầu (Dự toán)**: ${formatVnd(tender?.bid_price)}`,
    `- **Thời điểm đóng thầu**: ${formatDate(tender?.bid_deadline)}`,
    `- **Địa bàn thực hiện**: ${tender?.province || "Toàn quốc"}`,
    `- **Lĩnh vực**: ${tender?.field || "—"}`,
    "",
    "## 2. Điểm Số Chiến Lược & Khuyến Nghị INUT",
    `- **Điểm tương thích năng lực INUT**: **${score} / 100 Điểm**`,
    `- **Mức độ phù hợp**: **${matchLevel}**`,
    `- **Khuyến nghị chiến lược**: ${rec}`,
    `- **Đánh giá tổng quan**: ${analysis.executive_summary || analysis.summary || "Đánh giá chi tiết năng lực dự thầu."}`,
    "",
    "## 3. Yêu Cầu Năng Lực & Kinh Nghiệm",
  ];

  if (Array.isArray(analysis.capacity_requirements)) {
    analysis.capacity_requirements.forEach((req) => lines.push(`- ${req}`));
  } else {
    lines.push(`- ${analysis.capacity_requirements || "Đáp ứng theo quy chuẩn e-GP"}`);
  }

  lines.push("", "## 4. Điều Kiện Tài Chính & Doanh Thu");
  if (typeof analysis.financial_requirements === "object" && analysis.financial_requirements !== null) {
    if (analysis.financial_requirements.min_annual_revenue) {
      lines.push(
        `- **Doanh thu bình quân tối thiểu**: ${formatVnd(analysis.financial_requirements.min_annual_revenue)}`,
      );
    }
    if (analysis.financial_requirements.bid_security_amount) {
      lines.push(
        `- **Bảo lãnh dự thầu**: ${formatVnd(analysis.financial_requirements.bid_security_amount)}`,
      );
    }
    if (analysis.financial_requirements.summary) {
      lines.push(`- ${analysis.financial_requirements.summary}`);
    }
  } else {
    lines.push(
      `- ${analysis.revenue_requirements || String(analysis.financial_requirements || "Theo quy định HSMT")}`,
    );
  }

  lines.push("", "## 5. Lợi Thế Cạnh Tranh Của INUT");
  const strengths = fit?.strengths ||
    analysis.strengths || [
      "Làm chủ 100% công nghệ phần cứng Gateway 4G và nền tảng Web SCADA",
      "Giá thành sản xuất trong nước tối ưu hơn các giải pháp ngoại nhập",
      "Đội ngũ kỹ thuật hỗ trợ triển khai và bảo hành tận nơi nhanh chóng",
    ];
  strengths.forEach((s) => lines.push(`- [Lợi thế] ${s}`));

  lines.push("", "## 6. Thách Thức & Kế Hoạch Hành Động");
  if (fit?.strategic_action_plan) {
    lines.push(`- [Kế hoạch] ${fit.strategic_action_plan}`);
  } else {
    const challenges = fit?.challenges ||
      analysis.risks || [
        "Kiểm tra yêu cầu số lượng hợp đồng tương tự trước khi lập E-HSDT",
        "Chuẩn bị thư bảo lãnh dự thầu trước thời hạn 48 giờ",
      ];
    challenges.forEach((c) => lines.push(`- [Lưu ý] ${c}`));
  }

  return lines.join("\n");
}

export function generateContractorDossierMarkdown(c: BiddingContractorItem): string {
  const lines: string[] = [
    "# HỒ SƠ NĂNG LỰC NHÀ THẦU & TÌNH BÁO ĐẤU THẦU",
    `**Doanh nghiệp**: ${c.name}`,
    `**Mã số thuế**: ${c.tax_code}`,
    `**Địa chỉ**: ${c.address || "—"}`,
    `**Phân loại đối tác INUT**: ${c.bidding_status_label}`,
    `**Thời gian trích xuất**: ${new Date().toLocaleString("vi-VN")}`,
    "",
    "## 1. Thống Kê Năng Lực Đấu Thầu",
    `- **Tổng số gói thầu tham gia**: ${c.total_bids} gói`,
    `- **Số gói trúng thầu**: ${c.total_won} gói`,
    `- **Số gói trượt / đang đánh giá**: ${c.total_lost + c.total_evaluating} gói`,
    `- **Tỷ lệ trúng thầu (Win Rate)**: **${c.win_rate_percent}%**`,
    `- **Tổng giá trị trúng thầu lũy kế**: **${c.total_won_value_formatted}**`,
    `- **Mức chiết khấu / giảm giá trung bình**: ${c.average_discount_percent > 0 ? `${c.average_discount_percent}%` : "—"}`,
    "",
  ];

  if (c.top_procuring_entities && c.top_procuring_entities.length > 0) {
    lines.push("## 2. Chủ Đầu Tư / Bên Mời Thầu Quen Thuộc");
    c.top_procuring_entities.forEach((ent) => lines.push(`- ${ent}`));
    lines.push("");
  }

  lines.push("## 3. Danh Mục Gói Thầu Tiêu Biểu & Quyết Định Phê Duyệt");
  if (c.highlight_won_packages && c.highlight_won_packages.length > 0) {
    lines.push(
      "| Số TBMT | Tên Gói Thầu | Bên Mời Thầu | Giá Trúng Thầu | Tiết Kiệm | Quyết Định Phê Duyệt |",
    );
    lines.push("| :--- | :--- | :--- | :--- | :--- | :--- |");
    c.highlight_won_packages.forEach((pkg) => {
      lines.push(
        `| ${pkg.tbmt_code} | ${pkg.tender_name.replace(/\|/g, "/")} | ${pkg.procuring_entity.replace(/\|/g, "/")} | ${formatVnd(pkg.won_price)} | ${pkg.discount_percent}% | ${pkg.decision_number} (${pkg.award_date}) |`,
      );
    });
  } else {
    lines.push(
      "*Chưa ghi nhận gói thầu công lập trực tiếp trên cổng e-GP (thường đóng vai trò thầu phụ / OEM).*",
    );
  }

  if (c.ai_insight) {
    lines.push("", "## 4. Đánh Giá Chiến Lược & Cơ Hội Hợp Tác INUT", c.ai_insight);
  }

  return lines.join("\n");
}
