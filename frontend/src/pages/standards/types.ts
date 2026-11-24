import type { BkhcnRiskClassifyResult } from "../../api";
import type { StatusBadgeTone } from "../../components/ui";

export interface StandardItem {
  code: string;
  name: string;
  ministry: string;
  ministry_label: string;
  category: string;
  category_label: string;
  circular: string;
  effective_date: string;
  status: string;
  procedure_type: string;
  procedure_label: string;
  target_equipment: string;
  applicable_hs_codes: string[];
  managing_agency: string;
  certification_method: string;
  testing_labs: string[];
  key_technical_requirements: string[];
  inut_product_match: string;
}

export interface TestingLab {
  id: number;
  name: string;
  code: string;
  ministry: string;
  address: string;
  branch?: string;
  phone: string;
  email: string;
  scope: string[];
  average_testing_time_days: string;
  estimated_cost_vnd: string;
  badge: string;
}

export interface HsMapping {
  hs_code: string;
  hs_description: string;
  applicable_standards: string[];
  customs_inspection_agency: string;
  inspection_type: string;
  required_procedure: string;
  customs_notes: string;
  exemption_cases: string;
  risk_classification?: BkhcnRiskClassifyResult;
}

export interface PlaybookItem {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  badge: string;
  hs_codes: Array<{
    code: string;
    description: string;
    import_tax_mfn: string;
    import_tax_form_e: string;
    vat_rate: string;
    recommended: boolean;
  }>;
  required_standards: Array<{
    code: string;
    name: string;
    procedure: string;
    test_scope: string;
  }>;
  six_step_workflow?: Array<{
    step: number;
    title: string;
    description: string;
  }>;
  cost_estimate: {
    state_fees?: Array<{ name: string; cost: string; agency: string }>;
    lab_testing_fees?: Array<{ scope: string; cost: string; time: string }>;
    total_lab_cost_range?: string;
    forwarder_service_cost_range?: string;
  };
  practical_tips: string[];
}

export interface GameQuest {
  quest_id: number;
  title: string;
  subtitle: string;
  description: string;
  ai_companion_tip: string;
  secret_cheatsheet: string;
  exp_reward: number;
  level_title: string;
  status: "pending" | "in_progress" | "completed";
  completed_at?: string;
  personal_note?: string;
}

export interface GameState {
  current_level: number;
  current_level_title: string;
  current_exp: number;
  max_exp: number;
  progress_percent: number;
  completed_quests_count: number;
  total_quests: number;
  ai_companion_cheer: string;
  quests: GameQuest[];
}

export type StandardsTabId =
  | "search"
  | "tqc"
  | "risk_classification"
  | "hs_lookup"
  | "cr_generator"
  | "playbooks"
  | "emc_guide"
  | "labs"
  | "game";

export interface CrFormState {
  company_name: string;
  tax_code: string;
  address: string;
  representative_name: string;
  representative_title: string;
  product_name: string;
  model_name: string;
  manufacturer: string;
  country_of_origin: string;
  applicable_standards: string[];
  test_report_number: string;
  test_lab_name: string;
}

export const DEFAULT_CR_FORM: CrFormState = {
  company_name: "CÔNG TY TNHH CÔNG NGHỆ INUT",
  tax_code: "4401053694",
  address: "Tỉnh Phú Yên, Việt Nam",
  representative_name: "Ngô Huỳnh Ngọc Khánh",
  representative_title: "Giám đốc",
  product_name: "Máy tính nhúng công nghiệp iNut Rockchip (Wi-Fi 2.4G/5G, BLE)",
  model_name: "iNut-RK3568-Industrial-PC",
  manufacturer: "CÔNG TY TNHH CÔNG NGHỆ INUT",
  country_of_origin: "Việt Nam",
  applicable_standards: [
    "QCVN 54:2020/BTTTT",
    "QCVN 65:2020/BTTTT",
    "QCVN 18:2022/BTTTT",
    "QCVN 132:2022/BTTTT",
  ],
  test_report_number: "VNTA-TR-2026/0842",
  test_lab_name: "Trung tâm Đo lường Chất lượng Viễn thông (Cục Viễn thông)",
};

export function getMinistryTone(ministry: string): StatusBadgeTone {
  switch (ministry.toUpperCase()) {
    case "BTTTT":
      return "brand";
    case "BKHCN":
      return "success";
    case "BTNMT":
      return "info";
    case "BCT":
      return "warning";
    default:
      return "neutral";
  }
}

export const ZALO_LAB_TEMPLATE = `Kính gửi: Bộ phận Tiếp nhận Thử nghiệm Đo kiểm - Phòng Lab,

Tôi là Khánh, đại diện Công ty TNHH Công Nghệ INUT (MST: 4401053694).
Công ty chúng tôi hiện đang sản xuất thiết bị Máy tính nhúng công nghiệp (Industrial Box PC) tại Việt Nam và có nhu cầu đăng ký đo kiểm để phục vụ xin cấp Giấy Chứng Nhận Hợp Quy của Cục Viễn Thông (BTTTT).

Thông tin sơ bộ về thiết bị của chúng tôi:
- Tên sản phẩm: Máy tính nhúng công nghiệp iNut Rockchip
- Mã Model: iNut-RK3568-Industrial-PC
- Nguồn cấp: 12V - 24V DC (Thiết bị không sử dụng pin)
- Tính năng không dây: Wi-Fi Dual Band (2.4 GHz & 5 GHz) + Bluetooth 5.0 (Anten que SMA ngoài Gain 3 dBi).
- Các quy chuẩn cần đăng ký đo kiểm:
  1. QCVN 54:2020/BTTTT (Wi-Fi 2.4GHz & Bluetooth)
  2. QCVN 65:2020/BTTTT (Wi-Fi 5GHz Dual Band)
  3. QCVN 18:2022/BTTTT (Tương thích điện từ EMC vô tuyến)
  4. QCVN 132:2022/BTTTT (An toàn điện thiết bị CNTT theo IEC 62368-1)

Kính đề nghị Quý Trung tâm gửi giúp chúng tôi:
1. Phiếu yêu cầu thử nghiệm đo kiểm (Mẫu đăng ký của Lab).
2. Báo giá chi tiết các hạng mục và thời gian dự kiến trả kết quả Test Report.
3. Hướng dẫn nộp mẫu thử nghiệm tại TP.HCM.

Thông tin liên hệ của tôi:
- Người liên hệ: Ngô Huỳnh Ngọc Khánh - Giám đốc
- SĐT / Zalo: 09xx.xxx.xxx
- Công ty TNHH Công Nghệ INUT`;
