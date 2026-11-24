import type { IconName } from "../../components/ui";

export type TaxDefenseTabId = "matrix" | "costs" | "partners" | "dossier" | "import";

export interface SingleMstResult {
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
}

export interface TaxDefenseTabDef {
  id: TaxDefenseTabId;
  label: string;
  icon: IconName;
}

export const TAX_DEFENSE_TABS: TaxDefenseTabDef[] = [
  { id: "matrix", label: "Ma trận Doanh thu & Phân bổ", icon: "bar-chart" },
  { id: "costs", label: "Cơ cấu Chi phí & Thuế mua", icon: "briefcase" },
  { id: "partners", label: "Rà Soát MST & Bỏ Địa Chỉ (TT 06)", icon: "shield-alert" },
  { id: "dossier", label: "Thuyết minh Giải trình Pháp lý", icon: "file-text" },
  { id: "import", label: "Nạp Bảng kê Mua vào Excel", icon: "upload" },
];

export const OFFICIAL_REFERERS = [
  {
    title: "Tổng Cục Thuế - Chuyên trang Công khai NNT",
    desc: "Chuyên trang chính thức công khai NNT thuộc Trạng thái 06 (bỏ địa chỉ), Trạng thái 03, 05",
    url: "https://congkhaithongtin.gdt.gov.vn",
    linkLabel: "Truy cập congkhaithongtin.gdt.gov.vn",
  },
  {
    title: "Cổng Tra Cứu Thông Tin NNT (GDT)",
    desc: "Tra cứu ghi chú tình trạng hoạt động mã số thuế doanh nghiệp và hộ kinh doanh",
    url: "https://tracuunnt.gdt.gov.vn/tcnnt/mstdn.jsp",
    linkLabel: "Truy cập tracuunnt.gdt.gov.vn",
  },
  {
    title: "Cổng Quốc Gia Đăng Ký Doanh Nghiệp",
    desc: "Cơ sở dữ liệu gốc Bộ KH&ĐT về tình trạng pháp lý doanh nghiệp (Đang hoạt động/Tạm ngừng)",
    url: "https://dangkykinhdoanh.gov.vn",
    linkLabel: "Truy cập dangkykinhdoanh.gov.vn",
  },
];

export function formatVND(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return "0\u00A0đ";
  return Math.round(val).toLocaleString("vi-VN") + "\u00A0đ";
}

export function formatNumber(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return "0";
  return Math.round(val).toLocaleString("vi-VN");
}
