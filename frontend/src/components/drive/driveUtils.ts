import { api, type DriveItem } from "../../api";
import type { IconName, StatusBadgeTone } from "../ui";

export type DriveItemCategory = "pdf" | "image" | "video" | "office" | "other";

export function formatBytes(bytes: number | null | undefined): string {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let val = n;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val >= 100 || idx === 0 ? Math.round(val) : val.toFixed(1)} ${units[idx]}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "Không giới hạn";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function getItemExt(item: Pick<DriveItem, "file_ext" | "original_filename" | "display_name">): string {
  if (item.file_ext) return item.file_ext.toLowerCase();
  const src = (item.original_filename || item.display_name || "").toLowerCase();
  const dot = src.lastIndexOf(".");
  return dot >= 0 ? src.slice(dot) : "";
}

export function classifyDriveItem(item: DriveItem): DriveItemCategory {
  if (
    item.file_category === "pdf" ||
    item.file_category === "image" ||
    item.file_category === "video" ||
    item.file_category === "office" ||
    item.file_category === "other"
  ) {
    return item.file_category;
  }
  const mime = (item.mime_type || "").toLowerCase();
  const ext = getItemExt(item);
  if (mime === "application/pdf" || ext === ".pdf") return "pdf";
  if (mime.startsWith("image/") || [".png", ".jpg", ".jpeg", ".webp"].includes(ext)) return "image";
  if (mime.startsWith("video/") || ext === ".mp4") return "video";
  if ([".docx", ".xlsx", ".xls", ".md", ".markdown"].includes(ext)) return "office";
  return "other";
}

export function isItemSignedPdf(item: DriveItem): boolean {
  if (classifyDriveItem(item) !== "pdf") return false;
  if (item.signed === true) return true;
  if (item.media_meta?.sig_valid === true) return true;
  if ((item.media_meta?.sig_count ?? 0) > 0) return true;
  return false;
}

export function getDriveItemBadge(item: DriveItem): {
  label: string;
  tone: StatusBadgeTone;
  icon: IconName;
} {
  const cat = classifyDriveItem(item);
  if (cat === "pdf") {
    if (isItemSignedPdf(item)) {
      return { label: "Đã ký số hợp lệ", tone: "success", icon: "shield-check" };
    }
    return { label: "Chờ ký", tone: "warning", icon: "file-text" };
  }
  if (cat === "image") {
    return { label: "Ảnh trạm", tone: "info", icon: "image" };
  }
  if (cat === "video") {
    return { label: "Video MP4", tone: "brand", icon: "video" };
  }
  if (cat === "office") {
    const ext = getItemExt(item);
    return {
      label: ext === ".xlsx" || ext === ".xls" ? "Bảng tính" : "Tài liệu",
      tone: "info",
      icon: ext === ".xlsx" || ext === ".xls" ? "file-spreadsheet" : "file-text",
    };
  }
  return { label: "Tài liệu", tone: "neutral", icon: "file-text" };
}

export function getDriveItemIcon(item: DriveItem): IconName {
  const cat = classifyDriveItem(item);
  if (cat === "pdf") return isItemSignedPdf(item) ? "file-check" : "file-text";
  if (cat === "image") return "image";
  if (cat === "video") return "film";
  if (cat === "office") {
    const ext = getItemExt(item);
    return ext === ".xlsx" || ext === ".xls" ? "file-spreadsheet" : "file-text";
  }
  const ext = getItemExt(item);
  if (ext === ".zip") return "file-archive";
  return "file-text";
}

export function buildHandoverMessage(opts: {
  folderName: string;
  customerName?: string | null;
  url: string;
  passcode?: string;
  expiresAt?: string | null;
}): string {
  const lines = [
    `Kính gửi ${opts.customerName ? `Quý khách hàng ${opts.customerName}` : "Quý khách hàng"},`,
    "",
    `Công ty Cổ phần Đầu tư và Phát triển Công nghệ iNut (iNut JSC) trân trọng gửi đường dẫn bộ hồ sơ trực tuyến:`,
    `- Bộ hồ sơ: ${opts.folderName}`,
    `- Đường dẫn truy cập: ${opts.url}`,
  ];
  if (opts.passcode) {
    lines.push(`- Mã PIN truy cập: ${opts.passcode}`);
  }
  if (opts.expiresAt) {
    lines.push(`- Hiệu lực liên kết đến: ${formatDateTime(opts.expiresAt)}`);
  }
  lines.push(
    "",
    "Quý khách có thể xem trực tiếp tài liệu PDF (kèm nút thẩm định chữ ký số NEAC), hình ảnh minh chứng, video và tải trọn bộ (.zip) ngay trên đường dẫn trên.",
    "",
    "Trân trọng,",
    "iNut JSC",
  );
  return lines.join("\n");
}

function computeClientFingerprint(): string {
  try {
    const raw = [
      navigator.userAgent || "",
      navigator.language || "",
      `${window.screen?.width || 0}x${window.screen?.height || 0}`,
      Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    ].join("|");
    let h = 2166136261;
    for (let i = 0; i < raw.length; i += 1) {
      h ^= raw.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `fp_${(h >>> 0).toString(16).padStart(8, "0")}`;
  } catch {
    return "";
  }
}

interface GeoSnapshot {
  ip?: string;
  city?: string;
  region?: string;
  isp?: string;
  country_code?: string;
}

let cachedGeoPromise: Promise<GeoSnapshot> | null = null;

function resolveGeoBestEffort(): Promise<GeoSnapshot> {
  if (cachedGeoPromise) return cachedGeoPromise;
  cachedGeoPromise = (async () => {
    try {
      const ctrl = new AbortController();
      const t = window.setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch("https://ipwho.is/", { mode: "cors", signal: ctrl.signal });
      window.clearTimeout(t);
      if (r.ok) {
        const d = (await r.json()) as {
          ip?: string;
          city?: string;
          region?: string;
          country_code?: string;
          connection?: { isp?: string };
          org?: string;
        };
        if (d && (d.ip || d.city)) {
          return {
            ip: d.ip || "",
            city: d.city || "",
            region: d.region || "",
            isp: d.connection?.isp || d.org || "",
            country_code: d.country_code || "",
          };
        }
      }
    } catch {
      /* fallback below */
    }
    try {
      const ctrl = new AbortController();
      const t = window.setTimeout(() => ctrl.abort(), 3500);
      const r = await fetch("https://1.1.1.1/cdn-cgi/trace", { signal: ctrl.signal });
      window.clearTimeout(t);
      if (r.ok) {
        const txt = await r.text();
        const map: Record<string, string> = {};
        for (const line of txt.split("\n")) {
          const idx = line.indexOf("=");
          if (idx > 0) map[line.slice(0, idx)] = line.slice(idx + 1).trim();
        }
        return {
          ip: map.ip || "",
          city: "",
          region: "",
          isp: "",
          country_code: map.loc || "",
        };
      }
    } catch {
      /* ignore */
    }
    return {};
  })();
  return cachedGeoPromise;
}

export async function firePublicDriveTelemetry(
  token: string,
  nonce: string,
  action = "folder_open",
  itemId?: number | null,
): Promise<string | null> {
  if (!token || !nonce) return null;
  try {
    const geo = await resolveGeoBestEffort();
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || "");
    const res = await api.publicDriveTelemetry(token, {
      nonce,
      action,
      item_id: itemId ?? null,
      fingerprint: computeClientFingerprint(),
      device_type: isMobile ? "mobile" : "desktop",
      ip: geo.ip || "",
      city: geo.city || "",
      region: geo.region || "",
      isp: geo.isp || "",
      country_code: geo.country_code || "",
    });
    return res?.next_nonce || null;
  } catch {
    return null;
  }
}

export const DRIVE_ACCESS_ACTION_LABEL: Record<string, { label: string; tone: StatusBadgeTone }> = {
  folder_open: { label: "Mở thư mục", tone: "info" },
  subfolder_open: { label: "Mở thư mục con", tone: "info" },
  passcode_ok: { label: "Mở khóa PIN", tone: "success" },
  passcode_fail: { label: "Sai mã PIN", tone: "danger" },
  item_view: { label: "Xem tệp", tone: "brand" },
  item_download: { label: "Tải tệp", tone: "success" },
  item_neac: { label: "Thẩm định NEAC", tone: "brand" },
  zip_download: { label: "Tải ZIP", tone: "warning" },
  video_play: { label: "Phát video", tone: "info" },
};
