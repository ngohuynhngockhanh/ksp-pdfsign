import type {
  PieceworkAttachmentInfo,
  PieceworkAttachments,
  PieceworkContractDetail,
  PieceworkContractItem,
  PieceworkDeficiency,
  PieceworkWorkItem,
} from "../../api";
import type { StatusBadgeTone } from "../../components/ui";

export interface PreviewDocState {
  url: string;
  downloadUrl: string;
  title: string;
  isPdf: boolean;
  validationNote?: string;
}

export interface AuditModalState {
  contract_code: string;
  worker_name: string;
  audit: PieceworkDeficiency;
  attachments?: PieceworkAttachments;
  worker_signature_data?: string;
  worker_face_photo_data?: string;
}

export interface ShareModalState {
  contract: PieceworkContractItem | PieceworkContractDetail;
  tab: "signed" | "unsigned" | "portal";
}

export interface DriveSyncModalState {
  contract_code?: string;
  quarter: string;
  remote_dest: string;
  drive_link: string;
  files: string[];
  synced_at?: string;
}

export interface ContractFormState {
  contractor_id: number | null;
  contract_code: string;
  contract_type: string;
  title: string;
  project_name: string;
  location: string;
  contract_date: string;
  worker_name: string;
  worker_id_card: string;
  worker_id_card_date: string;
  worker_id_card_place: string;
  worker_tax_code: string;
  worker_phone: string;
  worker_address: string;
  worker_bank_account: string;
  worker_bank_name: string;
  payment_method: "bank_transfer" | "cash";
  note: string;
  items: PieceworkWorkItem[];
}

export interface ContractorFormState {
  code: string;
  name: string;
  id_card: string;
  id_card_date: string;
  id_card_place: string;
  tax_code: string;
  phone: string;
  address: string;
  bank_account: string;
  bank_name: string;
  skills: string;
  notes: string;
}

export function createDefaultContractForm(): ContractFormState {
  return {
    contractor_id: null,
    contract_code: "",
    contract_type: "thi_cong",
    title: "",
    project_name: "",
    location: "",
    contract_date: new Date().toISOString().slice(0, 10),
    worker_name: "",
    worker_id_card: "",
    worker_id_card_date: "",
    worker_id_card_place: "Cục Cảnh sát QLHC về TTXH",
    worker_tax_code: "",
    worker_phone: "",
    worker_address: "",
    worker_bank_account: "",
    worker_bank_name: "Techcombank",
    payment_method: "bank_transfer",
    note: "",
    items: [
      {
        ten: "Thi công lắp đặt thiết bị theo yêu cầu kỹ thuật",
        dvt: "Gói",
        so_luong: 1,
        don_gia: 4500000,
        thanh_tien: 4500000,
      },
    ],
  };
}

export function createDefaultContractorForm(): ContractorFormState {
  return {
    code: "",
    name: "",
    id_card: "",
    id_card_date: "",
    id_card_place: "Cục Cảnh sát QLHC về TTXH",
    tax_code: "",
    phone: "",
    address: "",
    bank_account: "",
    bank_name: "Techcombank",
    skills: "",
    notes: "",
  };
}

export function formatDateTimeWithSeconds(isoStr?: string | null): string {
  if (!isoStr) return "N/A";
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const seconds = String(d.getSeconds()).padStart(2, "0");
    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
  } catch {
    return isoStr;
  }
}

export function formatVnd(amount?: number | null): string {
  return `${Number(amount || 0).toLocaleString("vi-VN")} đ`;
}

/** Strips leading pictographic emoji prefixes from backend status strings so Linux/kiosk UI never renders tofu glyphs. */
export function stripLeadingEmoji(text?: string | null): string {
  if (!text) return "";
  return text.replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, "").trim() || text;
}

export function contractTypeLabel(contractType: string): string {
  switch (contractType) {
    case "mua_ban_ca_nhan":
      return "Mua bán cá nhân";
    case "thi_cong":
      return "Thi công";
    case "boc_xep":
      return "Bốc xếp";
    case "gia_cong":
      return "Gia công";
    default:
      return "Marketing";
  }
}

export function contractTypeTone(contractType: string): StatusBadgeTone {
  return contractType === "mua_ban_ca_nhan" ? "brand" : "neutral";
}

export function deficiencyStatusTone(def?: PieceworkDeficiency | null): StatusBadgeTone {
  if (!def) return "neutral";
  if (def.status_code === "completed") return "neutral";
  if (def.can_pay || def.status_code === "ready_to_pay") return "success";
  if (def.missing_count > 0 || def.status_code === "pending_docs") return "warning";
  return "neutral";
}

export function isAttachmentPdf(att?: Partial<PieceworkAttachmentInfo> | null): boolean {
  if (!att) return false;
  return Boolean(
    att.is_pdf ||
      att.validation?.kind === "pdf" ||
      att.validation?.format?.toUpperCase() === "PDF" ||
      att.suffix?.toLowerCase() === ".pdf" ||
      att.url?.toLowerCase().endsWith(".pdf") ||
      att.label?.toLowerCase().includes("biên bản") ||
      att.label?.toLowerCase().includes("ủy nhiệm chi") ||
      att.label?.toLowerCase().includes("cam kết"),
  );
}
