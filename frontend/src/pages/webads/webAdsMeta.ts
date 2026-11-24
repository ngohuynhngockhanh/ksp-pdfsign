import type { WebLeadStatus } from "../../api";
import type { IconName, StatusBadgeTone } from "../../components/ui";

export const STATUS_META: Record<
  WebLeadStatus,
  { label: string; tone: StatusBadgeTone; icon: IconName }
> = {
  new: { label: "Mới", tone: "info", icon: "sparkles" },
  contacted: { label: "Đã liên hệ", tone: "warning", icon: "phone" },
  quoted: { label: "Đã báo giá", tone: "brand", icon: "file-text" },
  won: { label: "Chốt đơn", tone: "success", icon: "check-circle" },
  lost: { label: "Hủy", tone: "neutral", icon: "ban" },
};

export const STATUS_ORDER: WebLeadStatus[] = [
  "new",
  "contacted",
  "quoted",
  "won",
  "lost",
];

export const PRODUCT_OPTIONS = [
  { value: "", label: "Tất cả sản phẩm" },
  { value: "datalogger", label: "iNut Datalogger" },
  { value: "rs485", label: "iNut RS485 Gateway" },
] as const;

export const DAY_OPTIONS = [7, 30, 90] as const;

export const CANONICAL_SKUS: ReadonlyArray<{
  sku: string;
  productKey: string;
  label: string;
}> = [
  { sku: "INUT-SC-DL10", productKey: "datalogger", label: "Datalogger DL10 (Tiêu chuẩn)" },
  { sku: "INUT-SC-DL11", productKey: "datalogger", label: "Datalogger DL11 (Phổ biến)" },
  { sku: "INUT-SC-DL20", productKey: "datalogger", label: "Datalogger DL20 (Cao cấp)" },
  { sku: "INUT-SC-R4WF", productKey: "rs485", label: "RS485 Gateway WiFi" },
  { sku: "INUT-SC-R4WF4G", productKey: "rs485", label: "RS485 Gateway WiFi + 4G" },
];

export const EVENT_META: Record<
  string,
  { icon: IconName; label: string; tone: StatusBadgeTone }
> = {
  pageview: { icon: "globe", label: "Xem trang", tone: "neutral" },
  view_price: { icon: "dollar-sign", label: "Xem bảng giá (#price)", tone: "warning" },
  select_sku: { icon: "package", label: "Chọn model SKU", tone: "info" },
  apply_coupon: { icon: "tag", label: "Áp mã ưu đãi", tone: "brand" },
  click_call: { icon: "phone", label: "Bấm nút Gọi", tone: "success" },
  click_zalo: { icon: "message-square", label: "Bấm nút Zalo", tone: "brand" },
  submit_lead: { icon: "file-text", label: "Gửi form nhận báo giá", tone: "success" },
};

export interface SkuDemandRow {
  sku: string;
  label: string;
  productKey: string;
  selects: number;
  leads: number;
  totalQuantity: number;
  estimatedRevenue: number;
}

export function fmtVnd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  return `${Math.round(value).toLocaleString("vi-VN")} đ`;
}

export function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "0.0%";
  return `${value.toFixed(1)}%`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function phoneDigits(phone: string | null | undefined): string {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.startsWith("84") && digits.length >= 10) {
    return `0${digits.slice(2)}`;
  }
  return digits;
}

export function zaloUrl(phone: string | null | undefined): string | null {
  const d = phoneDigits(phone);
  return d.length >= 8 ? `https://zalo.me/${d}` : null;
}

export function extractAiAnswerText(raw: unknown): string {
  if (!raw) return "";
  if (typeof raw === "string") return raw;
  let current: unknown = raw;
  for (let i = 0; i < 3; i += 1) {
    if (!current || typeof current !== "object") break;
    const obj = current as Record<string, unknown>;
    if (typeof obj.answer === "string") return obj.answer;
    if (typeof obj.text === "string") return obj.text;
    current = obj.answer;
  }
  return "";
}

export function resolveLeadStatus(status: string | undefined): WebLeadStatus {
  if (status && status in STATUS_META) {
    return status as WebLeadStatus;
  }
  return "new";
}
