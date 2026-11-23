import React, { useEffect, useState } from "react";
import {
  BkhcnRiskClassifyResult,
  BkhcnRiskItem,
  BkhcnRiskStatistics,
  api,
} from "../api";
import { TqcCertificateLookup } from "../components/TqcCertificateLookup";
import { AppModal, DataView, FormGrid, ResponsiveTabs } from "../components/ui";
import { safeHttpUrl } from "../utils/url";

interface StandardItem {
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

interface TestingLab {
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

interface HsMapping {
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

interface PlaybookItem {
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

interface GameQuest {
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

interface GameState {
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

type StandardsTabId =
  | "game"
  | "playbooks"
  | "emc_guide"
  | "search"
  | "hs_lookup"
  | "cr_generator"
  | "labs"
  | "tqc"
  | "risk_classification";

export function StandardsConformity() {
  const [activeTab, setActiveTab] = useState<StandardsTabId>("game");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMinistry, setSelectedMinistry] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedProcedure, setSelectedProcedure] = useState("");

  const [standardsList, setStandardsList] = useState<StandardItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<any>(null);

  // Detail Modal
  const [detailStandard, setDetailStandard] = useState<StandardItem | null>(null);

  // HS Lookup State
  const [hsCodeInput, setHsCodeInput] = useState("8473.30.10");
  const [hsResult, setHsResult] = useState<HsMapping | null>(null);
  const [allHsMappings, setAllHsMappings] = useState<HsMapping[]>([]);

  // Labs State
  const [labs, setLabs] = useState<TestingLab[]>([]);

  // Playbooks State
  const [playbooks, setPlaybooks] = useState<PlaybookItem[]>([]);
  const [selectedPlaybookId, setSelectedPlaybookId] = useState<string>("inut_rockchip_embedded_pc");

  // Game Gamification State
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [activeQuestNote, setActiveQuestNote] = useState<{ [id: number]: string }>({});

  // CR Generator State
  const [crForm, setCrForm] = useState({
    company_name: "CÔNG TY TNHH CÔNG NGHỆ INUT",
    tax_code: "4401053694",
    address: "Tỉnh Phú Yên, Việt Nam",
    representative_name: "Ngô Huỳnh Ngọc Khánh",
    representative_title: "Giám đốc",
    product_name: "Máy tính nhúng công nghiệp iNut Rockchip (Wi-Fi 2.4G/5G, BLE)",
    model_name: "iNut-RK3568-Industrial-PC",
    manufacturer: "CÔNG TY TNHH CÔNG NGHỆ INUT",
    country_of_origin: "Việt Nam",
    applicable_standards: ["QCVN 54:2020/BTTTT", "QCVN 65:2020/BTTTT", "QCVN 18:2022/BTTTT", "QCVN 132:2022/BTTTT"],
    test_report_number: "VNTA-TR-2026/0842",
    test_lab_name: "Trung tâm Đo lường Chất lượng Viễn thông (Cục Viễn thông)",
  });
  const [generatingPdf, setGeneratingPdf] = useState(false);

  // Risk Classification State (Thông tư 36/2026/TT-BKHCN)
  const [riskStats, setRiskStats] = useState<BkhcnRiskStatistics | null>(null);
  const [riskCatalog, setRiskCatalog] = useState<BkhcnRiskItem[]>([]);
  const [riskCatalogTotal, setRiskCatalogTotal] = useState(0);
  const [riskCatalogPage, setRiskCatalogPage] = useState(1);
  const [riskCatalogLimit] = useState(50);
  const [riskLevelFilter, setRiskLevelFilter] = useState<string>("");
  const [riskGroupFilter, setRiskGroupFilter] = useState<string>("");
  const [riskSearchQuery, setRiskSearchQuery] = useState<string>("");
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskClassifyInput, setRiskClassifyInput] = useState("8517.62.59");
  const [riskClassifyResult, setRiskClassifyResult] = useState<BkhcnRiskClassifyResult | null>(null);
  const [riskClassifying, setRiskClassifying] = useState(false);

  // Toast State
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const showToast = (message: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Sync browser URL with tab / modal
  const syncUrl = (tab: string, standardCode: string | null = null) => {
    let path = "/standards";
    if (standardCode) {
      path = `/standards/qcvn/${encodeURIComponent(standardCode)}`;
    } else if (tab === "game") {
      path = "/standards/game";
    } else if (tab === "playbooks") {
      path = "/standards/playbooks";
    } else if (tab === "hs_lookup") {
      path = "/standards/hs-lookup";
    } else if (tab === "emc_guide") {
      path = "/standards/emc-guide";
    } else if (tab === "cr_generator") {
      path = "/standards/cr-generator";
    } else if (tab === "labs") {
      path = "/standards/testing-labs";
    } else if (tab === "tqc") {
      path = "/standards/tqc";
    } else if (tab === "risk_classification") {
      path = "/standards/risk-classification";
    } else {
      path = "/standards/search";
    }

    if (window.location.pathname !== path) {
      window.history.pushState({ standardsPath: path }, "", path);
    }
  };

  // Initial Data Fetching & Subpath Mounting
  useEffect(() => {
    fetchStats();
    handleSearch();
    fetchGameState();
    api.standards.getHsMappings().then(setAllHsMappings).catch(() => {});
    api.standards.getTestingLabs().then(setLabs).catch(() => {});
    api.standards.getPlaybooks().then(setPlaybooks).catch(() => {});

    // Parse subpath
    const pathname = window.location.pathname;
    const stdMatch = pathname.match(/(?:\/standards)\/(?:qcvn|detail)\/([^/]+)/);
    if (stdMatch) {
      const code = decodeURIComponent(stdMatch[1]);
      api.standards.search({ q: code }).then((res) => {
        if (res.length > 0) {
          setDetailStandard(res[0]);
        }
      });
      return;
    }

    if (pathname.includes("/game")) {
      setActiveTab("game");
    } else if (pathname.includes("/playbooks") || pathname.includes("/guide")) {
      setActiveTab("playbooks");
    } else if (pathname.includes("/hs-lookup")) {
      setActiveTab("hs_lookup");
    } else if (pathname.includes("/emc-guide") || pathname.includes("/emc")) {
      setActiveTab("emc_guide");
    } else if (pathname.includes("/cr-generator")) {
      setActiveTab("cr_generator");
    } else if (pathname.includes("/testing-labs") || pathname.includes("/labs")) {
      setActiveTab("labs");
    } else if (pathname.includes("/tqc")) {
      setActiveTab("tqc");
    } else if (pathname.includes("/risk") || pathname.includes("/phan-loai-rui-ro")) {
      setActiveTab("risk_classification");
    } else {
      setActiveTab("game");
    }
    fetchRiskStats();
    loadRiskCatalog(1);
    handleClassifyRisk("8517.62.59");
  }, []);

  const fetchStats = async () => {
    try {
      const s = await api.standards.getStatistics();
      if (s && typeof s === "object") setStats(s);
    } catch {}
  };

  const fetchRiskStats = async () => {
    try {
      const s = await api.standards.getRiskStatistics();
      if (s && Array.isArray(s.groups)) setRiskStats(s);
    } catch {}
  };

  const loadRiskCatalog = async (page = 1, rLevel = riskLevelFilter, grp = riskGroupFilter, q = riskSearchQuery) => {
    setRiskLoading(true);
    try {
      const res = await api.standards.getRiskCatalog({
        risk_level: rLevel,
        group: grp,
        q: q,
        page,
        limit: riskCatalogLimit,
      });
      setRiskCatalog(Array.isArray(res?.items) ? res.items : []);
      setRiskCatalogTotal(typeof res?.total === "number" ? res.total : 0);
      setRiskCatalogPage(typeof res?.page === "number" ? res.page : page);
    } catch (e: unknown) {
      showToast((e as Error).message || "Lỗi tải danh mục rủi ro", "error");
    } finally {
      setRiskLoading(false);
    }
  };

  const handleClassifyRisk = async (inputVal?: string) => {
    const val = (inputVal !== undefined ? inputVal : riskClassifyInput).trim();
    if (!val) return;
    setRiskClassifying(true);
    try {
      const isHs = /^[\d.]+$/.test(val);
      const res = await api.standards.classifyRisk({
        hs_code: isHs ? val : undefined,
        q: !isHs ? val : undefined,
      });
      if (res && Array.isArray(res.all_matches)) setRiskClassifyResult(res);
    } catch (e: unknown) {
      showToast((e as Error).message || "Lỗi phân loại rủi ro", "error");
    } finally {
      setRiskClassifying(false);
    }
  };

  const fetchGameState = async () => {
    try {
      const g = await api.standards.getGameState();
      if (!g || !Array.isArray(g.quests)) return;
      setGameState(g);
      const notes: { [id: number]: string } = {};
      g.quests.forEach((q) => {
        notes[q.quest_id] = q.personal_note || "";
      });
      setActiveQuestNote(notes);
    } catch {}
  };

  const handleCompleteQuest = async (questId: number) => {
    try {
      const note = activeQuestNote[questId] || "";
      const updated = await api.standards.completeGameQuest(questId, note);
      setGameState(updated);
      showToast(`Hoàn thành Ải ${questId} (+500 EXP) — đã cập nhật tiến độ hợp quy.`, "success");
    } catch (e: any) {
      showToast(e.message || "Lỗi cập nhật tiến độ", "error");
    }
  };

  const handleSaveNote = async (questId: number) => {
    try {
      const note = activeQuestNote[questId] || "";
      const updated = await api.standards.updateGameNote(questId, note);
      setGameState(updated);
      showToast("💾 Đã lưu ghi chú tác chiến của bạn!", "success");
    } catch (e: any) {
      showToast(e.message || "Lỗi lưu ghi chú", "error");
    }
  };

  const handleResetGame = async () => {
    if (!window.confirm("Bạn có chắc chắn muốn đặt lại tiến độ Game từ đầu không?")) return;
    try {
      const res = await api.standards.resetGame();
      setGameState(res);
      showToast("🔄 Đã đặt lại tiến độ Game về Level 1!", "info");
    } catch (e: any) {
      showToast(e.message || "Lỗi reset game", "error");
    }
  };

  const handleSearch = async () => {
    setLoading(true);
    try {
      const res = await api.standards.search({
        q: searchQuery,
        ministry: selectedMinistry,
        category: selectedCategory,
        procedure_type: selectedProcedure,
      });
      const list = Array.isArray(res)
        ? res
        : Array.isArray((res as unknown as { items?: StandardItem[] })?.items)
          ? (res as unknown as { items: StandardItem[] }).items
          : [];
      setStandardsList(list);
    } catch (e: any) {
      showToast(e.message || "Lỗi tra cứu quy chuẩn", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleHsLookup = async (codeToLookup?: string) => {
    const code = codeToLookup || hsCodeInput;
    if (!code) return;
    try {
      const res = await api.standards.lookupHsCode(code);
      setHsResult(res);
    } catch (e: any) {
      showToast(e.message || "Không tìm thấy dữ liệu HS Code", "error");
      setHsResult(null);
    }
  };

  const handleOpenDetail = (std: StandardItem) => {
    setDetailStandard(std);
    syncUrl(activeTab, std.code);
  };

  const handleCloseDetail = () => {
    setDetailStandard(null);
    syncUrl(activeTab, null);
  };

  const handleDownloadCrPdf = async () => {
    setGeneratingPdf(true);
    try {
      const response = await fetch("/api/standards/generate-cr-declaration/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(crForm),
      });
      if (!response.ok) throw new Error("Không thể tạo file PDF");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Ban_Cong_Bo_Hop_Quy_${crForm.model_name}_${crForm.tax_code}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
      showToast("📄 Đã tải xuống Bản Công Bố Hợp Quy PDF thành công!", "success");
    } catch (e: any) {
      showToast(e.message || "Lỗi tạo file PDF", "error");
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleDownloadCrDocx = async () => {
    try {
      const response = await fetch("/api/standards/generate-cr-declaration/docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(crForm),
      });
      if (!response.ok) throw new Error("Không thể tạo file Word");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Ban_Cong_Bo_Hop_Quy_${crForm.model_name}_${crForm.tax_code}.docx`;
      a.click();
      window.URL.revokeObjectURL(url);
      showToast("📝 Đã tải xuống Bản Công Bố Hợp Quy Word (DOCX) thành công!", "success");
    } catch (e: any) {
      showToast(e.message || "Lỗi tạo file Word", "error");
    }
  };

  const copyZaloMessage = () => {
    const text = `Kính gửi: Bộ phận Tiếp nhận Thử nghiệm Đo kiểm - Phòng Lab,

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

    navigator.clipboard.writeText(text);
    showToast("📋 Đã sao chép Mẫu Tin Nhắn Đăng Ký Đo Kiểm vào Clipboard!", "success");
  };

  const getMinistryBadge = (ministry: string) => {
    switch (ministry.toUpperCase()) {
      case "BTTTT":
        return {
          bg: "var(--primary-soft)",
          color: "var(--primary-dark)",
          border: "color-mix(in srgb, var(--primary) 35%, var(--border))",
          label: "Bộ Thông tin & Truyền thông",
        };
      case "BKHCN":
        return {
          bg: "color-mix(in srgb, var(--green) 14%, var(--panel))",
          color: "color-mix(in srgb, var(--green) 72%, var(--ink))",
          border: "color-mix(in srgb, var(--green) 42%, var(--border))",
          label: "Bộ Khoa học & Công nghệ",
        };
      case "BTNMT":
        return {
          bg: "var(--primary-soft)",
          color: "var(--ink)",
          border: "color-mix(in srgb, var(--primary) 42%, var(--border))",
          label: "Bộ Tài nguyên & Môi trường",
        };
      case "BCT":
        return {
          bg: "color-mix(in srgb, var(--gold) 18%, var(--panel))",
          color: "color-mix(in srgb, var(--amber) 68%, var(--ink))",
          border: "color-mix(in srgb, var(--gold) 55%, var(--border))",
          label: "Bộ Công Thương",
        };
      default:
        return {
          bg: "var(--surface-subtle, var(--paper))",
          color: "var(--ink-2, var(--text))",
          border: "var(--border)",
          label: ministry,
        };
    }
  };

  const currentPlaybook = playbooks.find((p) => p.id === selectedPlaybookId) || playbooks[0];
  const riskCircularPdfUrl = safeHttpUrl("/api/standards/risk-classification/pdf");
  const detailPdfUrl = detailStandard ? safeHttpUrl(api.standards.getStandardPdfUrl(detailStandard.code)) : undefined;

  void stats;
  void allHsMappings;
  void labs;

  return (
    <div
      className="docs-page"
      style={{
        padding: "clamp(12px, 2.5vw, 24px)",
        maxWidth: "1400px",
        margin: "0 auto",
        position: "relative",
      }}
    >
      {/* Subtle INUT Teal Status Toast Notification */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: "max(16px, env(safe-area-inset-bottom))",
            right: "16px",
            left: "auto",
            maxWidth: "min(420px, calc(100vw - 32px))",
            zIndex: 9999,
            padding: "12px 18px",
            borderRadius: "12px",
            background:
              toast.type === "success"
                ? "var(--primary-dark)"
                : toast.type === "error"
                ? "color-mix(in srgb, var(--red) 78%, var(--ink))"
                : "var(--ink)",
            color: "var(--panel)",
            fontWeight: 700,
            fontSize: "13px",
            boxShadow: "var(--shadow-md)",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span>{toast.type === "success" ? "✓" : toast.type === "error" ? "✕" : "ℹ"}</span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Hero Header Banner */}
      <div
        style={{
          background: "linear-gradient(135deg, var(--ink) 0%, var(--primary-dark) 58%, var(--primary) 100%)",
          borderRadius: "20px",
          padding: "clamp(16px, 3vw, 28px)",
          color: "var(--panel)",
          marginBottom: "22px",
          boxShadow: "var(--shadow-md)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "18px",
        }}
      >
        <div style={{ minWidth: 0, flex: "1 1 280px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "22px" }}>📜</span>
            <span
              style={{
                textTransform: "uppercase",
                fontSize: "11px",
                fontWeight: 800,
                letterSpacing: "1px",
                background: "rgba(255, 254, 250, 0.16)",
                color: "var(--panel)",
                padding: "4px 10px",
                borderRadius: "999px",
              }}
            >
              KSP Quality &amp; Standards Intelligence
            </span>
          </div>
          <h1
            style={{
              fontFamily: "var(--font-serif, Georgia, serif)",
              fontSize: "clamp(20px, 3vw, 28px)",
              margin: "0 0 8px",
              color: "var(--panel)",
              fontWeight: 700,
              lineHeight: 1.25,
            }}
          >
            Hành Trình Chinh Phục Hợp Quy &amp; Cẩm Nang Chứng Nhận Thiết Bị iNut (QCVN / TCVN)
          </h1>
          <p style={{ margin: 0, fontSize: "14px", color: "var(--primary-soft)", maxWidth: "850px", lineHeight: 1.55 }}>
            Lộ trình thực chiến 6 Ải: Lắp ráp mẫu, Nạp RF Test Tool, Liên hệ phòng Lab, Chinh phục buồng câm EMC &amp; Cấp Giấy CNHQ BTTTT cho iNut Rockchip.
          </p>
        </div>

        {/* Macro Stat Chips */}
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", minWidth: 0 }}>
          <div
            style={{
              background: "rgba(255, 254, 250, 0.12)",
              padding: "11px 16px",
              borderRadius: "14px",
              border: "1px solid rgba(255, 254, 250, 0.24)",
              textAlign: "center",
              flex: "1 1 110px",
              minWidth: 0,
            }}
          >
            <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--gold)", fontFamily: "var(--font-mono)" }}>
              {gameState ? `Lv.${gameState.current_level}` : "Lv.1"}
            </div>
            <div style={{ fontSize: "11px", color: "var(--primary-soft)", fontWeight: 700 }}>Cấp Độ Hợp Quy</div>
          </div>

          <div
            style={{
              background: "rgba(255, 254, 250, 0.12)",
              padding: "11px 16px",
              borderRadius: "14px",
              border: "1px solid rgba(255, 254, 250, 0.24)",
              textAlign: "center",
              flex: "1 1 120px",
              minWidth: 0,
            }}
          >
            <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--panel)", fontFamily: "var(--font-mono)" }}>
              {gameState ? `${gameState.current_exp} / ${gameState.max_exp}` : "500 / 3000"} EXP
            </div>
            <div style={{ fontSize: "11px", color: "var(--primary-soft)", fontWeight: 700 }}>Điểm Kinh Nghiệm</div>
          </div>

          <div
            style={{
              background: "rgba(255, 254, 250, 0.12)",
              padding: "11px 16px",
              borderRadius: "14px",
              border: "1px solid rgba(255, 254, 250, 0.24)",
              textAlign: "center",
              flex: "1 1 110px",
              minWidth: 0,
            }}
          >
            <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--gold)", fontFamily: "var(--font-mono)" }}>
              {gameState ? `${gameState.progress_percent}%` : "16%"}
            </div>
            <div style={{ fontSize: "11px", color: "var(--primary-soft)", fontWeight: 700 }}>Tiến Độ Hoàn Thành</div>
          </div>
        </div>
      </div>

      {/* Main Tab Navigation (Single Scrollable Strip via ResponsiveTabs) */}
      <div style={{ marginBottom: "22px" }}>
        <ResponsiveTabs<StandardsTabId>
          active={activeTab}
          onChange={(tabId) => {
            setActiveTab(tabId);
            syncUrl(tabId);
          }}
          ariaLabel="Điều hướng tiêu chuẩn và hợp quy"
          tabs={[
            {
              id: "game",
              label: "🎮 Game Chinh Phục Hợp Quy",
              badge: gameState ? `${gameState.completed_quests_count}/${gameState.total_quests} Ải` : "1/6 Ải",
            },
            {
              id: "playbooks",
              label: "📘 Cẩm Nang & Case Study Thực Chiến",
              badge: "⭐ iNut Rockchip",
            },
            { id: "emc_guide", label: "🛡️ Bí Kíp Đo Đậu EMC & Tĩnh Điện (ESD)" },
            { id: "search", label: "🔍 Tra Cứu Quy Chuẩn QCVN & TCVN" },
            { id: "tqc", label: "🧾 Tra Cứu GCN TQC Theo Model" },
            { id: "hs_lookup", label: "📦 Đối Soát Mã HS Code" },
            { id: "cr_generator", label: "📝 Sinh Bản Công Bố Hợp Quy (CR)" },
            { id: "labs", label: "🏛️ Đầu Mối Zalo & Danh Bạ Lab" },
            { id: "risk_classification", label: "⚖️ Phân Loại Rủi Ro (TT 36/2026)", badge: "MỚI" },
          ]}
        />
      </div>

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB: 🎮 GAME CHINH PHỤC HỢP QUY                                           */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "game" && gameState && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Level Header & Progress Card */}
          <div
            style={{
              background: "linear-gradient(135deg, var(--ink) 0%, var(--primary-dark) 100%)",
              borderRadius: "20px",
              padding: "clamp(16px, 2.8vw, 24px)",
              color: "var(--panel)",
              boxShadow: "var(--shadow-md)",
              display: "flex",
              flexDirection: "column",
              gap: "18px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "14px", minWidth: 0 }}>
                <div
                  style={{
                    width: "52px",
                    height: "52px",
                    flexShrink: 0,
                    borderRadius: "16px",
                    background: "var(--gold)",
                    color: "var(--ink)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "24px",
                  }}
                >
                  🏆
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "12px", color: "var(--primary-soft)", textTransform: "uppercase", fontWeight: 800, letterSpacing: "1px" }}>
                    Danh Hiệu Người Chơi
                  </div>
                  <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--gold)", fontFamily: "var(--font-serif, Georgia, serif)" }}>
                    {gameState.current_level_title}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <button
                  type="button"
                  className="ui-btn-chip"
                  onClick={handleResetGame}
                  style={{
                    padding: "8px 14px",
                    minHeight: "44px",
                    borderRadius: "10px",
                    border: "1px solid rgba(255, 254, 250, 0.3)",
                    background: "rgba(255, 254, 250, 0.08)",
                    color: "var(--panel)",
                    fontSize: "12px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  🔄 Đặt Lại Tiến Độ
                </button>
              </div>
            </div>

            {/* EXP Progress Bar */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "6px", fontSize: "13px", marginBottom: "6px", fontWeight: 700 }}>
                <span style={{ color: "var(--primary-soft)" }}>
                  Tiến Độ Hoàn Thành 6 Ải: {gameState.completed_quests_count} / {gameState.total_quests} Ải
                </span>
                <span style={{ color: "var(--gold)", fontFamily: "var(--font-mono)" }}>
                  {gameState.current_exp} / {gameState.max_exp} EXP ({gameState.progress_percent}%)
                </span>
              </div>
              <div style={{ width: "100%", height: "12px", borderRadius: "999px", background: "rgba(255, 254, 250, 0.16)", overflow: "hidden" }}>
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: "999px",
                    background: "linear-gradient(90deg, var(--primary) 0%, var(--gold) 100%)",
                    transform: `scaleX(${Math.max(0, Math.min(100, gameState.progress_percent)) / 100})`,
                    transformOrigin: "left center",
                    transition: "transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)",
                  }}
                />
              </div>
            </div>

            {/* AI Companion Cheer Dialog */}
            <div
              style={{
                background: "rgba(255, 254, 250, 0.08)",
                border: "1px solid rgba(255, 254, 250, 0.18)",
                borderRadius: "14px",
                padding: "14px 16px",
                display: "flex",
                alignItems: "center",
                gap: "12px",
              }}
            >
              <div style={{ fontSize: "26px", flexShrink: 0 }}>🤖</div>
              <div style={{ fontSize: "13px", color: "var(--panel)", lineHeight: 1.55, minWidth: 0 }}>
                <strong style={{ color: "var(--gold)" }}>Trợ Lý AI Đồng Hành (Antigravity Partner): </strong>
                &ldquo;{gameState.ai_companion_cheer}&rdquo;
              </div>
            </div>
          </div>

          {/* 6 Epic Quest Cards Grid */}
          <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            {gameState.quests.map((quest) => {
              const isCompleted = quest.status === "completed";
              const isInProgress = quest.status === "in_progress";
              const isPending = quest.status === "pending";

              return (
                <div
                  key={quest.quest_id}
                  style={{
                    background: "var(--panel)",
                    borderRadius: "18px",
                    border: isCompleted
                      ? "2px solid var(--green)"
                      : isInProgress
                      ? "2px solid var(--primary)"
                      : "1px solid var(--border-strong, var(--border))",
                    padding: "clamp(14px, 2.5vw, 22px)",
                    boxShadow: "var(--shadow)",
                    opacity: isPending ? 0.82 : 1,
                    display: "flex",
                    flexDirection: "column",
                    gap: "14px",
                    minWidth: 0,
                  }}
                >
                  {/* Quest Header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0, flex: "1 1 240px" }}>
                      <div
                        style={{
                          width: "36px",
                          height: "36px",
                          flexShrink: 0,
                          borderRadius: "10px",
                          background: isCompleted ? "var(--green)" : isInProgress ? "var(--primary)" : "var(--muted)",
                          color: "var(--panel)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 900,
                          fontSize: "14px",
                        }}
                      >
                        {isCompleted ? "✓" : quest.quest_id}
                      </div>

                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 800,
                              padding: "2px 8px",
                              borderRadius: "6px",
                              background: isCompleted
                                ? "color-mix(in srgb, var(--green) 14%, var(--panel))"
                                : isInProgress
                                ? "var(--primary-soft)"
                                : "var(--surface-subtle, var(--paper))",
                              color: isCompleted
                                ? "color-mix(in srgb, var(--green) 72%, var(--ink))"
                                : isInProgress
                                ? "var(--primary-dark)"
                                : "var(--muted)",
                            }}
                          >
                            Ải {quest.quest_id} • {isCompleted ? "ĐÃ HOÀN THÀNH" : isInProgress ? "ĐANG THỰC HIỆN" : "CHƯA MỞ KHÓA"}
                          </span>
                          <span style={{ fontSize: "11px", fontWeight: 800, color: "color-mix(in srgb, var(--amber) 72%, var(--ink))" }}>
                            +{quest.exp_reward} EXP
                          </span>
                        </div>
                        <h3 style={{ margin: "4px 0 0", fontSize: "17px", color: "var(--ink)", fontWeight: 800 }}>
                          {quest.title}
                        </h3>
                      </div>
                    </div>

                    {/* Action Button */}
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      {isCompleted ? (
                        <div
                          style={{
                            fontSize: "12px",
                            color: "color-mix(in srgb, var(--green) 72%, var(--ink))",
                            fontWeight: 800,
                            background: "color-mix(in srgb, var(--green) 14%, var(--panel))",
                            padding: "8px 12px",
                            borderRadius: "8px",
                          }}
                        >
                          ✓ Đạt danh hiệu: {quest.level_title}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleCompleteQuest(quest.quest_id)}
                          style={{
                            padding: "10px 18px",
                            minHeight: "44px",
                            borderRadius: "10px",
                            border: "none",
                            background: isInProgress ? "var(--primary)" : "var(--muted)",
                            color: "var(--panel)",
                            fontWeight: 800,
                            fontSize: "13px",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <span>⚔️</span>
                          <span>Hoàn Thành Ải Này (+500 EXP)</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Quest Description */}
                  <div
                    style={{
                      fontSize: "13px",
                      color: "var(--ink-2, var(--text))",
                      lineHeight: 1.55,
                      background: "var(--surface-subtle, var(--paper))",
                      padding: "12px 16px",
                      borderRadius: "12px",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <strong>🎯 Nhiệm vụ chính:</strong> {quest.description}
                  </div>

                  {/* AI Tip & Secret Cheatsheet */}
                  <FormGrid cols={2}>
                    <div
                      style={{
                        background: "var(--primary-soft)",
                        border: "1px solid color-mix(in srgb, var(--primary) 35%, var(--border))",
                        padding: "12px 16px",
                        borderRadius: "12px",
                        fontSize: "12px",
                        color: "var(--primary-dark)",
                        minWidth: 0,
                      }}
                    >
                      <strong>🤖 Lời khuyên của Trợ lý AI:</strong> {quest.ai_companion_tip}
                    </div>

                    <div
                      style={{
                        background: "color-mix(in srgb, var(--gold) 15%, var(--panel))",
                        border: "1px solid color-mix(in srgb, var(--gold) 50%, var(--border))",
                        padding: "12px 16px",
                        borderRadius: "12px",
                        fontSize: "12px",
                        color: "color-mix(in srgb, var(--amber) 65%, var(--ink))",
                        minWidth: 0,
                      }}
                    >
                      <strong>🛡️ Bí kíp bỏ túi:</strong> {quest.secret_cheatsheet}
                    </div>
                  </FormGrid>

                  {/* Personal Note Box */}
                  <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      type="text"
                      className="ui-input"
                      placeholder="Ghi chú tác chiến của bạn cho ải này (vd: Ngày gửi mẫu, số tracking bưu điện, mã test report, lưu ý riêng)..."
                      value={activeQuestNote[quest.quest_id] !== undefined ? activeQuestNote[quest.quest_id] : (quest.personal_note || "")}
                      onChange={(e) => setActiveQuestNote({ ...activeQuestNote, [quest.quest_id]: e.target.value })}
                      style={{
                        flex: "1 1 min(100%, 240px)",
                        minWidth: 0,
                        padding: "9px 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--border-strong, var(--border))",
                        background: "var(--panel)",
                        color: "var(--ink)",
                      }}
                    />
                    <button
                      type="button"
                      className="ui-btn-chip"
                      onClick={() => handleSaveNote(quest.quest_id)}
                      style={{
                        padding: "9px 14px",
                        minHeight: "44px",
                        borderRadius: "8px",
                        border: "1px solid var(--primary)",
                        background: "var(--primary-soft)",
                        color: "var(--primary-dark)",
                        fontWeight: 700,
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      💾 Lưu Ghi Chú
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB: 📘 CẨM NANG & CASE STUDY THỰC CHIẾN                                    */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "playbooks" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Sub-navigation of Case Studies */}
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {playbooks.map((pb) => {
              const isSelected = selectedPlaybookId === pb.id;
              return (
                <button
                  key={pb.id}
                  type="button"
                  className="ui-btn-chip"
                  onClick={() => setSelectedPlaybookId(pb.id)}
                  style={{
                    padding: "10px 16px",
                    minHeight: "44px",
                    borderRadius: "12px",
                    border: isSelected ? "2px solid var(--primary)" : "1px solid var(--border-strong, var(--border))",
                    background: isSelected ? "var(--primary-soft)" : "var(--panel)",
                    color: isSelected ? "var(--primary-dark)" : "var(--ink-2, var(--text))",
                    fontWeight: isSelected ? 800 : 600,
                    fontSize: "13px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <span>{pb.id.includes("rockchip") ? "⭐" : pb.id.includes("display") ? "🖥️" : pb.id.includes("gateway") ? "📡" : "💧"}</span>
                  <span>{pb.title.split("(")[0]}</span>
                  <span
                    style={{
                      fontSize: "10px",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      background: isSelected ? "var(--primary)" : "var(--surface-subtle, var(--paper))",
                      color: isSelected ? "var(--panel)" : "var(--muted)",
                      fontWeight: 800,
                    }}
                  >
                    {pb.badge}
                  </span>
                </button>
              );
            })}
          </div>

          {currentPlaybook && (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* Playbook Header Box */}
              <div
                style={{
                  background: "var(--panel)",
                  padding: "clamp(16px, 2.8vw, 24px)",
                  borderRadius: "20px",
                  border: "1px solid var(--border)",
                  boxShadow: "var(--shadow)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap", marginBottom: "14px" }}>
                  <div style={{ minWidth: 0, flex: "1 1 260px" }}>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 800,
                        background: "color-mix(in srgb, var(--coral) 16%, var(--panel))",
                        color: "color-mix(in srgb, var(--red) 75%, var(--ink))",
                        padding: "4px 10px",
                        borderRadius: "999px",
                        textTransform: "uppercase",
                      }}
                    >
                      {currentPlaybook.badge}
                    </span>
                    <h2 style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontSize: "clamp(18px, 2.6vw, 22px)", color: "var(--ink)", margin: "10px 0 4px" }}>
                      {currentPlaybook.title}
                    </h2>
                    <div style={{ fontSize: "14px", color: "var(--muted)" }}>{currentPlaybook.subtitle}</div>
                  </div>

                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={copyZaloMessage}
                      style={{
                        padding: "10px 16px",
                        minHeight: "44px",
                        borderRadius: "12px",
                        border: "1px solid var(--primary)",
                        background: "var(--primary-soft)",
                        color: "var(--primary-dark)",
                        fontWeight: 800,
                        fontSize: "13px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <span>📋</span>
                      <span>Copy Mẫu Tin Nhắn Zalo Cho Lab</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setCrForm({
                          ...crForm,
                          product_name: currentPlaybook.title.split("(")[0].trim(),
                          model_name: currentPlaybook.id.includes("rockchip") ? "iNut-RK3568-Industrial-PC" : "iNut-SmartDisplay-65",
                          applicable_standards: currentPlaybook.required_standards.map((s) => s.code),
                        });
                        setActiveTab("cr_generator");
                        syncUrl("cr_generator");
                        showToast("📝 Đã tự động điền các quy chuẩn của Case Study vào Bản Công Bố CR!", "success");
                      }}
                      style={{
                        padding: "10px 18px",
                        minHeight: "44px",
                        borderRadius: "12px",
                        border: "none",
                        background: "var(--primary)",
                        color: "var(--panel)",
                        fontWeight: 800,
                        fontSize: "13px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <span>📝</span>
                      <span>Tạo Bản Công Bố CR</span>
                    </button>
                  </div>
                </div>

                {/* Section 1: HS Codes & Taxes Table (Responsive DataView) */}
                <h3 style={{ fontSize: "16px", color: "var(--primary-dark)", margin: "20px 0 10px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>🏷️</span> 1. Mã HS Code &amp; Thuế Suất Nhập Khẩu
                </h3>
                <DataView
                  mobileMode="card"
                  desktop={
                    <div className="ui-table-scroll-wrap" style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                        <thead>
                          <tr style={{ background: "var(--surface-subtle, var(--paper))", textAlign: "left", borderBottom: "2px solid var(--border)" }}>
                            <th style={{ padding: "10px 14px", color: "var(--ink)" }}>Mã HS Code</th>
                            <th style={{ padding: "10px 14px", color: "var(--ink)" }}>Mô tả hàng hóa</th>
                            <th style={{ padding: "10px 14px", color: "var(--ink)" }}>Thuế NK ưu đãi (MFN)</th>
                            <th style={{ padding: "10px 14px", color: "var(--ink)" }}>Thuế Form E (Trung Quốc)</th>
                            <th style={{ padding: "10px 14px", color: "var(--ink)" }}>Thuế VAT</th>
                            <th style={{ padding: "10px 14px", color: "var(--ink)" }}>Đánh giá &amp; Lưu ý</th>
                          </tr>
                        </thead>
                        <tbody>
                          {currentPlaybook.hs_codes.map((h) => (
                            <tr
                              key={h.code}
                              style={{
                                borderBottom: "1px solid var(--border)",
                                background: h.recommended ? "var(--primary-soft)" : "var(--panel)",
                              }}
                            >
                              <td style={{ padding: "12px 14px", fontFamily: "var(--font-mono)", fontWeight: 800, color: "var(--primary-dark)" }}>
                                {h.code}
                              </td>
                              <td style={{ padding: "12px 14px", color: "var(--ink-2, var(--text))" }}>{h.description}</td>
                              <td style={{ padding: "12px 14px", fontWeight: 700, color: "var(--ink)" }}>{h.import_tax_mfn}</td>
                              <td style={{ padding: "12px 14px", fontWeight: 700, color: "color-mix(in srgb, var(--green) 72%, var(--ink))" }}>
                                {h.import_tax_form_e}
                              </td>
                              <td style={{ padding: "12px 14px", fontWeight: 700, color: "var(--ink)" }}>{h.vat_rate}</td>
                              <td style={{ padding: "12px 14px" }}>
                                {h.recommended ? (
                                  <span
                                    style={{
                                      background: "color-mix(in srgb, var(--green) 14%, var(--panel))",
                                      color: "color-mix(in srgb, var(--green) 72%, var(--ink))",
                                      padding: "3px 8px",
                                      borderRadius: "6px",
                                      fontSize: "11px",
                                      fontWeight: 800,
                                    }}
                                  >
                                    ✓ Khuyên dùng (Miễn KTCL BTTTT)
                                  </span>
                                ) : (
                                  <span style={{ color: "var(--muted)", fontSize: "11px" }}>Tham khảo</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  }
                  mobileCards={
                    <div className="ui-mobile-card-list">
                      {currentPlaybook.hs_codes.map((h) => (
                        <article
                          key={h.code}
                          className="ui-mobile-card"
                          style={{
                            background: h.recommended ? "var(--primary-soft)" : "var(--panel)",
                            border: `1px solid ${h.recommended ? "var(--primary)" : "var(--border)"}`,
                            borderRadius: "14px",
                            padding: "14px",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "8px" }}>
                            <strong style={{ fontFamily: "var(--font-mono)", fontSize: "14px", color: "var(--primary-dark)" }}>
                              {h.code}
                            </strong>
                            {h.recommended ? (
                              <span
                                style={{
                                  background: "var(--primary)",
                                  color: "var(--panel)",
                                  padding: "3px 8px",
                                  borderRadius: "6px",
                                  fontSize: "11px",
                                  fontWeight: 800,
                                }}
                              >
                                ✓ Khuyên dùng (Miễn KTCL BTTTT)
                              </span>
                            ) : (
                              <span style={{ color: "var(--muted)", fontSize: "11px", fontWeight: 700 }}>Tham khảo</span>
                            )}
                          </div>
                          <div style={{ fontSize: "13px", color: "var(--ink)", marginBottom: "10px", lineHeight: 1.45 }}>
                            {h.description}
                          </div>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                              gap: "8px",
                              fontSize: "12px",
                              background: "var(--surface-subtle, var(--paper))",
                              padding: "8px 10px",
                              borderRadius: "10px",
                            }}
                          >
                            <div>
                              <div style={{ fontSize: "10px", color: "var(--muted)", fontWeight: 700 }}>MFN</div>
                              <strong style={{ color: "var(--ink)" }}>{h.import_tax_mfn}</strong>
                            </div>
                            <div>
                              <div style={{ fontSize: "10px", color: "var(--muted)", fontWeight: 700 }}>Form E</div>
                              <strong style={{ color: "color-mix(in srgb, var(--green) 72%, var(--ink))" }}>{h.import_tax_form_e}</strong>
                            </div>
                            <div>
                              <div style={{ fontSize: "10px", color: "var(--muted)", fontWeight: 700 }}>VAT</div>
                              <strong style={{ color: "var(--ink)" }}>{h.vat_rate}</strong>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  }
                />

                {/* Section 2: Required Standards Cards */}
                <h3 style={{ fontSize: "16px", color: "var(--primary-dark)", margin: "24px 0 10px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>📜</span> 2. Danh Mục Các Quy Chuẩn Kỹ Thuật (QCVN BTTTT) Bắt Buộc
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: "14px" }}>
                  {currentPlaybook.required_standards.map((std) => {
                    const isCert = std.procedure.includes("Chứng nhận");
                    return (
                      <div
                        key={std.code}
                        style={{
                          background: "var(--surface-subtle, var(--paper))",
                          padding: "16px",
                          borderRadius: "14px",
                          border: "1px solid var(--border)",
                          minWidth: 0,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "6px" }}>
                          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 900, color: "var(--primary-dark)", fontSize: "13px" }}>
                            🏷️ {std.code}
                          </span>
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 800,
                              padding: "2px 7px",
                              borderRadius: "6px",
                              background: isCert
                                ? "color-mix(in srgb, var(--red) 12%, var(--panel))"
                                : "color-mix(in srgb, var(--gold) 18%, var(--panel))",
                              color: isCert
                                ? "color-mix(in srgb, var(--red) 75%, var(--ink))"
                                : "color-mix(in srgb, var(--amber) 68%, var(--ink))",
                            }}
                          >
                            {std.procedure}
                          </span>
                        </div>
                        <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)", marginBottom: "6px" }}>{std.name}</div>
                        <div style={{ fontSize: "12px", color: "var(--muted)", lineHeight: 1.45 }}>
                          <strong>Chỉ tiêu thử nghiệm:</strong> {std.test_scope}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Section 3: 6-Step Workflow */}
                {currentPlaybook.six_step_workflow && (
                  <>
                    <h3 style={{ fontSize: "16px", color: "var(--primary-dark)", margin: "28px 0 12px", display: "flex", alignItems: "center", gap: "6px" }}>
                      <span>🔄</span> 3. Sơ Đồ Quy Trình Từng Bước Thực Hiện
                    </h3>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: "14px" }}>
                      {currentPlaybook.six_step_workflow.map((st) => (
                        <div
                          key={st.step}
                          style={{
                            background: "var(--panel)",
                            border: "1px solid var(--border-strong, var(--border))",
                            borderRadius: "14px",
                            padding: "16px",
                            position: "relative",
                            boxShadow: "var(--shadow)",
                            minWidth: 0,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                            <div
                              style={{
                                width: "26px",
                                height: "26px",
                                flexShrink: 0,
                                borderRadius: "50%",
                                background: "var(--primary)",
                                color: "var(--panel)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontWeight: 800,
                                fontSize: "12px",
                              }}
                            >
                              {st.step}
                            </div>
                            <strong style={{ fontSize: "13px", color: "var(--ink)" }}>{st.title}</strong>
                          </div>
                          <div style={{ fontSize: "12px", color: "var(--ink-2, var(--text))", lineHeight: 1.5 }}>{st.description}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Section 4: Cost Breakdown */}
                <h3 style={{ fontSize: "16px", color: "var(--primary-dark)", margin: "28px 0 12px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>💰</span> 4. Bảng Dự Toán Chi Phí &amp; Lệ Phí Nhà Nước
                </h3>
                <FormGrid cols={2}>
                  {/* State Fees */}
                  <div
                    style={{
                      background: "var(--primary-soft)",
                      padding: "18px",
                      borderRadius: "14px",
                      border: "1px solid color-mix(in srgb, var(--primary) 35%, var(--border))",
                      minWidth: 0,
                    }}
                  >
                    <h4 style={{ margin: "0 0 10px", fontSize: "14px", color: "var(--primary-dark)" }}>
                      🏛️ Lệ Phí Nhà Nước (Thông tư 285/2016/TT-BTC)
                    </h4>
                    {currentPlaybook.cost_estimate.state_fees?.map((fee, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "8px",
                          fontSize: "12px",
                          padding: "6px 0",
                          borderBottom: "1px dashed color-mix(in srgb, var(--primary) 35%, var(--border))",
                          color: "var(--ink-2, var(--text))",
                        }}
                      >
                        <span>{fee.name}</span>
                        <strong style={{ color: "var(--primary-dark)", whiteSpace: "nowrap" }}>{fee.cost}</strong>
                      </div>
                    ))}
                    <div style={{ marginTop: "10px", fontSize: "12px", color: "var(--primary-dark)", fontWeight: 700 }}>
                      ✓ Tổng lệ phí nhà nước: <strong>300.000 ₫</strong>
                    </div>
                  </div>

                  {/* Lab Fees */}
                  <div
                    style={{
                      background: "color-mix(in srgb, var(--gold) 15%, var(--panel))",
                      padding: "18px",
                      borderRadius: "14px",
                      border: "1px solid color-mix(in srgb, var(--gold) 50%, var(--border))",
                      minWidth: 0,
                    }}
                  >
                    <h4 style={{ margin: "0 0 10px", fontSize: "14px", color: "color-mix(in srgb, var(--amber) 68%, var(--ink))" }}>
                      🧪 Chi Phí Đo Kiểm Phòng Lab Chỉ Định
                    </h4>
                    {currentPlaybook.cost_estimate.lab_testing_fees?.map((lab, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "8px",
                          fontSize: "12px",
                          padding: "6px 0",
                          borderBottom: "1px dashed color-mix(in srgb, var(--gold) 50%, var(--border))",
                          color: "var(--ink-2, var(--text))",
                        }}
                      >
                        <span>{lab.scope}</span>
                        <strong style={{ color: "color-mix(in srgb, var(--amber) 68%, var(--ink))", whiteSpace: "nowrap" }}>{lab.cost}</strong>
                      </div>
                    ))}
                    <div style={{ marginTop: "10px", fontSize: "12px", color: "color-mix(in srgb, var(--amber) 68%, var(--ink))", fontWeight: 800 }}>
                      Tổng đo kiểm 1 model: <strong>{currentPlaybook.cost_estimate.total_lab_cost_range}</strong>
                    </div>
                  </div>
                </FormGrid>

                {/* Section 5: Practical Tips */}
                <h3 style={{ fontSize: "16px", color: "var(--primary-dark)", margin: "28px 0 10px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>💡</span> 5. Lời Khuyên &amp; Kinh Nghiệm Thực Chiến Tiết Kiệm Chi Phí
                </h3>
                <div
                  style={{
                    background: "var(--surface-subtle, var(--paper))",
                    padding: "16px 20px",
                    borderRadius: "14px",
                    border: "1px solid var(--border)",
                  }}
                >
                  <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "var(--ink-2, var(--text))", lineHeight: 1.6 }}>
                    {currentPlaybook.practical_tips.map((tip, idx) => (
                      <li key={idx} style={{ marginBottom: "6px" }}>{tip}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB: 🛡️ BÍ KÍP ĐO ĐẬU EMC & TĨNH ĐIỆN (ESD)                                */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "emc_guide" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div
            style={{
              background: "var(--panel)",
              padding: "clamp(16px, 2.8vw, 24px)",
              borderRadius: "20px",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow)",
            }}
          >
            <span
              style={{
                fontSize: "11px",
                fontWeight: 800,
                background: "color-mix(in srgb, var(--gold) 18%, var(--panel))",
                color: "color-mix(in srgb, var(--amber) 68%, var(--ink))",
                padding: "4px 10px",
                borderRadius: "999px",
                textTransform: "uppercase",
              }}
            >
              Cẩm Nang Kỹ Thuật Phần Cứng
            </span>
            <h2 style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontSize: "clamp(18px, 2.6vw, 22px)", color: "var(--ink)", margin: "10px 0 6px" }}>
              Bí Kíp Thiết Kế Phần Cứng &amp; Kinh Nghiệm Đo Đạt EMC 100% Đậu Trong Lần Thử Đầu Tiên
            </h2>
            <p style={{ fontSize: "14px", color: "var(--muted)", margin: "0 0 20px", lineHeight: 1.55 }}>
              Hơn 70% thiết bị rớt kiểm định BTTTT là do không đạt Phát xạ bức xạ (Radiated Emissions) hoặc bị treo/reset khi bắn tĩnh điện (ESD). Dưới đây là các giải pháp chống nhiễu phần cứng cho bo mạch Rockchip.
            </p>

            <FormGrid cols={2} style={{ marginBottom: "24px" }}>
              {/* Card 1: Radiated Emissions */}
              <div
                style={{
                  background: "var(--surface-subtle, var(--paper))",
                  padding: "clamp(14px, 2.2vw, 20px)",
                  borderRadius: "16px",
                  border: "1px solid var(--border)",
                  minWidth: 0,
                }}
              >
                <h3 style={{ fontSize: "16px", color: "var(--primary-dark)", margin: "0 0 10px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>📡</span> 1. Vượt Qua Phát Xạ Bức Xạ (RE: 30MHz - 6GHz)
                </h3>
                <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "var(--ink-2, var(--text))", lineHeight: 1.6 }}>
                  <li><strong>Lồng Faraday vỏ nhôm:</strong> Các mặt ghép vỏ nhôm phải tiếp xúc điện trực tiếp, không bị lớp sơn tĩnh điện cách điện ở chân ốc.</li>
                  <li><strong>Kẹp Lõi Ferit (Ferrite Bead):</strong> Luôn kẹp 1 - 2 cục lọc Ferit ở sát đầu dây nguồn DC và dây mạng để triệt tiêu bức xạ ngoài ý muốn.</li>
                  <li><strong>Tuyệt chiêu Firmware:</strong> Bật <em>Spread Spectrum Clocking (SSC)</em> trong Device Tree Rockchip (rk3568.dtsi) để giảm ngay 3 - 6 dB năng lượng đỉnh sóng hài!</li>
                </ul>
              </div>

              {/* Card 2: ESD Protection */}
              <div
                style={{
                  background: "var(--surface-subtle, var(--paper))",
                  padding: "clamp(14px, 2.2vw, 20px)",
                  borderRadius: "16px",
                  border: "1px solid var(--border)",
                  minWidth: 0,
                }}
              >
                <h3 style={{ fontSize: "16px", color: "var(--primary-dark)", margin: "0 0 10px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>⚡</span> 2. Vượt Qua Phóng Tĩnh Điện (ESD ±4kV / ±8kV)
                </h3>
                <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "var(--ink-2, var(--text))", lineHeight: 1.6 }}>
                  <li><strong>Tách biệt Mass Vỏ &amp; Mass Mạch:</strong> Vỏ nhôm nối Chassis Ground (PE). Digital GND nối với vỏ qua cầu nối: Tụ cao áp 1nF/2kV song song Điện trở 1MΩ.</li>
                  <li><strong>Diode TVS bảo vệ cổng:</strong> Gắn chip TVS (USBLC6-2SC6, SM712) trên tất cả các chân USB D+/D-, RS485 A/B, Ethernet.</li>
                  <li><strong>Chân ren Anten SMA:</strong> Bắt ốc siết chặt tiếp xúc kim loại 100% vào vỏ nhôm để tĩnh điện thoát ngay ra ngoài đất.</li>
                </ul>
              </div>
            </FormGrid>

            {/* Rescue Toolbag */}
            <div
              style={{
                background: "color-mix(in srgb, var(--gold) 15%, var(--panel))",
                padding: "clamp(14px, 2.5vw, 22px)",
                borderRadius: "16px",
                border: "1px solid color-mix(in srgb, var(--gold) 52%, var(--border))",
              }}
            >
              <h3 style={{ fontSize: "15px", color: "color-mix(in srgb, var(--amber) 68%, var(--ink))", margin: "0 0 10px", display: "flex", alignItems: "center", gap: "6px" }}>
                <span>🧰</span> Bộ Đồ Nghề &ldquo;Cứu Hộ Thần Tốc&rdquo; Mang Theo Vào Phòng Lab
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: "12px", fontSize: "13px", color: "var(--ink)" }}>
                <div style={{ background: "var(--panel)", padding: "10px 14px", borderRadius: "10px", border: "1px solid color-mix(in srgb, var(--gold) 45%, var(--border))", minWidth: 0 }}>
                  <strong>1. Túi Lõi Ferit kẹp dây:</strong> Kích cỡ 3.5mm, 5mm, 7mm kẹp ngay khi bức xạ vượt vạch đỏ.
                </div>
                <div style={{ background: "var(--panel)", padding: "10px 14px", borderRadius: "10px", border: "1px solid color-mix(in srgb, var(--gold) 45%, var(--border))", minWidth: 0 }}>
                  <strong>2. Băng keo đồng dẫn điện:</strong> Dán bọc các khe hở tiếp xúc nắp vỏ nhôm nếu bị rò sóng.
                </div>
                <div style={{ background: "var(--panel)", padding: "10px 14px", borderRadius: "10px", border: "1px solid color-mix(in srgb, var(--gold) 45%, var(--border))", minWidth: 0 }}>
                  <strong>3. 02 Cục Nguồn Adapter xịn:</strong> Loại đạt chuẩn CE/FCC công nghiệp để tránh nhiễu nguồn trôi nổi.
                </div>
                <div style={{ background: "var(--panel)", padding: "10px 14px", borderRadius: "10px", border: "1px solid color-mix(in srgb, var(--gold) 45%, var(--border))", minWidth: 0 }}>
                  <strong>4. Laptop + Cáp nạp Debug:</strong> Để chỉnh nhanh công suất phát Tx Power trong file cấu hình nếu cần.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB: 🏛️ ĐẦU MỐI ZALO & DANH BẠ LAB                                         */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "labs" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Quick Copy Message Template Box */}
          <div
            style={{
              background: "var(--primary-soft)",
              padding: "clamp(14px, 2.5vw, 22px)",
              borderRadius: "16px",
              border: "1px solid color-mix(in srgb, var(--primary) 35%, var(--border))",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "12px",
            }}
          >
            <div style={{ minWidth: 0, flex: "1 1 240px" }}>
              <h3 style={{ margin: "0 0 4px", fontSize: "16px", color: "var(--primary-dark)" }}>
                📋 Mẫu Tin Nhắn Soạn Sẵn Gửi Zalo / Email Cho Phòng Lab
              </h3>
              <p style={{ margin: 0, fontSize: "13px", color: "var(--ink-2, var(--text))" }}>
                Bấm nút sao chép để paste ngay vào Zalo hoặc Email gửi cho chuyên viên phòng Lab.
              </p>
            </div>
            <button
              type="button"
              onClick={copyZaloMessage}
              style={{
                padding: "10px 18px",
                minHeight: "44px",
                borderRadius: "10px",
                border: "none",
                background: "var(--primary)",
                color: "var(--panel)",
                fontWeight: 800,
                fontSize: "13px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span>📋</span>
              <span>Sao Chép Mẫu Tin Nhắn</span>
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 1fr))", gap: "18px" }}>
            {/* Lab 1: VNTA Lab */}
            <div
              style={{
                background: "var(--panel)",
                borderRadius: "18px",
                border: "2px solid var(--primary)",
                padding: "clamp(14px, 2.5vw, 22px)",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                boxShadow: "var(--shadow)",
                minWidth: 0,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", flexWrap: "wrap" }}>
                <h3 style={{ margin: 0, fontSize: "16px", color: "var(--primary-dark)", minWidth: 0, flex: "1 1 200px" }}>
                  Trung tâm Đo lường Chất lượng Viễn thông (Cục Viễn thông — VNTA Lab)
                </h3>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 800,
                    background: "color-mix(in srgb, var(--green) 14%, var(--panel))",
                    color: "color-mix(in srgb, var(--green) 72%, var(--ink))",
                    padding: "3px 8px",
                    borderRadius: "6px",
                  }}
                >
                  🌟 Chỉ định Số 1 BTTTT
                </span>
              </div>

              <div style={{ fontSize: "13px", color: "var(--ink-2, var(--text))" }}>
                📍 <strong>TP.HCM:</strong> Số 60 Tân Canh, Phường 1, Quận Tân Bình, TP.HCM<br />
                📍 <strong>Hà Nội:</strong> Tòa nhà VNTA, Đường Dương Đình Nghệ, Cầu Giấy, Hà Nội
              </div>

              <div style={{ background: "var(--surface-subtle, var(--paper))", padding: "12px", borderRadius: "10px", fontSize: "13px", color: "var(--ink)" }}>
                📞 <strong>Hotline Tiếp Nhận TP.HCM:</strong>{" "}
                <a href="tel:02839919191" style={{ color: "var(--primary-dark)", fontWeight: 800 }}>028.39919191</a> /{" "}
                <a href="tel:02437820990" style={{ color: "var(--primary-dark)", fontWeight: 800 }}>024.37820990</a><br />
                ✉️ <strong>Email:</strong>{" "}
                <a href="mailto:testing@vnta.gov.vn" style={{ color: "var(--primary-dark)", fontWeight: 700 }}>testing@vnta.gov.vn</a>
              </div>

              <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                <strong>Phạm vi đo kiểm:</strong> QCVN 54 (Wi-Fi 2.4G/BT), QCVN 65 (Wi-Fi 5G), QCVN 117 (4G LTE), QCVN 18 (EMC), QCVN 132 (An toàn).
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", fontSize: "12px", borderTop: "1px solid var(--border)", paddingTop: "10px", color: "var(--ink-2, var(--text))" }}>
                <span>⏱️ Thời gian: <strong>5 - 7 ngày</strong></span>
                <span style={{ color: "color-mix(in srgb, var(--amber) 68%, var(--ink))" }}>💰 Trọn gói 1 model: <strong>~15 - 22 Triệu ₫</strong></span>
              </div>
            </div>

            {/* Lab 2: Quatest 3 */}
            <div
              style={{
                background: "var(--panel)",
                borderRadius: "18px",
                border: "1px solid var(--border)",
                padding: "clamp(14px, 2.5vw, 22px)",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                boxShadow: "var(--shadow)",
                minWidth: 0,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", flexWrap: "wrap" }}>
                <h3 style={{ margin: 0, fontSize: "16px", color: "var(--ink)", minWidth: 0, flex: "1 1 200px" }}>
                  Trung tâm Kỹ thuật Tiêu chuẩn Đo lường Chất lượng 3 (QUATEST 3)
                </h3>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 800,
                    background: "var(--primary-soft)",
                    color: "var(--primary-dark)",
                    padding: "3px 8px",
                    borderRadius: "6px",
                  }}
                >
                  Zalo CSKH Nhanh
                </span>
              </div>

              <div style={{ fontSize: "13px", color: "var(--ink-2, var(--text))" }}>
                📍 <strong>Trụ sở:</strong> 49 Pasteur, Phường Nguyễn Thái Bình, Quận 1, TP.HCM<br />
                📍 <strong>Khu Thí nghiệm:</strong> KCN Biên Hòa 1, Đồng Nai
              </div>

              <div style={{ background: "var(--surface-subtle, var(--paper))", padding: "12px", borderRadius: "10px", fontSize: "13px", color: "var(--ink)" }}>
                💬 <strong>Zalo CSKH Quatest 3:</strong> <strong style={{ color: "var(--primary-dark)" }}>0903.003.528</strong> hoặc <strong style={{ color: "var(--primary-dark)" }}>0908.574.629</strong><br />
                📞 <strong>Tổng đài:</strong> 028.38294274 • ✉️ <strong>Email:</strong> info@quatest3.com.vn
              </div>

              <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                <strong>Phạm vi đo kiểm:</strong> Đo kiểm vô tuyến, EMC, an toàn điện, kiểm định môi trường.
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", fontSize: "12px", borderTop: "1px solid var(--border)", paddingTop: "10px", color: "var(--ink-2, var(--text))" }}>
                <span>⏱️ Thời gian: <strong>5 - 8 ngày</strong></span>
                <span style={{ color: "color-mix(in srgb, var(--amber) 68%, var(--ink))" }}>💰 Trọn gói 1 model: <strong>~16 - 24 Triệu ₫</strong></span>
              </div>
            </div>

            {/* Consulting: ExtendMax */}
            <div
              style={{
                background: "var(--panel)",
                borderRadius: "18px",
                border: "1px solid var(--border)",
                padding: "clamp(14px, 2.5vw, 22px)",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                boxShadow: "var(--shadow)",
                minWidth: 0,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", flexWrap: "wrap" }}>
                <h3 style={{ margin: 0, fontSize: "16px", color: "var(--ink)", minWidth: 0, flex: "1 1 200px" }}>
                  ExtendMax Vietnam (Tư Vấn Hợp Quy Trọn Gói)
                </h3>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 800,
                    background: "color-mix(in srgb, var(--gold) 18%, var(--panel))",
                    color: "color-mix(in srgb, var(--amber) 68%, var(--ink))",
                    padding: "3px 8px",
                    borderRadius: "6px",
                  }}
                >
                  Ủy Thác A-Z
                </span>
              </div>

              <div style={{ fontSize: "13px", color: "var(--ink-2, var(--text))" }}>
                📍 Tòa nhà CIC, Phố Nguyễn Thị Duệ, Cầu Giấy, Hà Nội
              </div>

              <div style={{ background: "var(--surface-subtle, var(--paper))", padding: "12px", borderRadius: "10px", fontSize: "13px", color: "var(--ink)" }}>
                💬 <strong>Hotline / Zalo Trực Tiếp:</strong> <strong style={{ color: "color-mix(in srgb, var(--amber) 68%, var(--ink))" }}>0915.837.255</strong> (hoặc 024.6666.3066)<br />
                ✉️ <strong>Email:</strong> consultant@extendmax.vn
              </div>

              <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                <strong>Dịch vụ:</strong> Hỗ trợ test trước (Pre-test), xử lý mạch chống rớt EMC và đại diện nộp cấp Giấy CNHQ Cục Viễn Thông tận tay.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB: 🔍 TRA CỨU QUY CHUẨN QCVN & TCVN                                      */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "search" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Search Box & Multi-Filter Bar */}
          <div
            style={{
              background: "var(--panel)",
              padding: "clamp(14px, 2.5vw, 22px)",
              borderRadius: "16px",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow)",
            }}
          >
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "14px" }}>
              <div style={{ flex: "1 1 min(100%, 260px)", minWidth: 0, position: "relative" }}>
                <input
                  type="text"
                  className="ui-input"
                  placeholder="Gõ mã QCVN (vd: 117, 54, 101, TT10), tên quy chuẩn hoặc tên thiết bị (Màn hình, IoT Gateway, Pin, Công tơ)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  style={{
                    width: "100%",
                    padding: "12px 16px 12px 42px",
                    borderRadius: "12px",
                    border: "1px solid var(--border-strong, var(--border))",
                    background: "var(--panel)",
                    color: "var(--ink)",
                  }}
                />
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: "14px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    fontSize: "16px",
                    color: "var(--muted)",
                    pointerEvents: "none",
                  }}
                >
                  🔍
                </span>
              </div>

              <button
                type="button"
                onClick={handleSearch}
                style={{
                  padding: "12px 24px",
                  minHeight: "44px",
                  borderRadius: "12px",
                  border: "none",
                  background: "var(--primary)",
                  color: "var(--panel)",
                  fontWeight: 800,
                  fontSize: "14px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span>Tìm Kiếm</span>
              </button>
            </div>

            {/* Quick Filters */}
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", paddingTop: "12px", borderTop: "1px solid var(--border)" }}>
              <span style={{ fontSize: "12px", fontWeight: 800, color: "var(--muted)" }}>Bộ Quản Lý:</span>
              {[
                { label: "Tất cả", val: "" },
                { label: "Bộ TT&TT (BTTTT)", val: "BTTTT" },
                { label: "Bộ KH&CN (BKHCN)", val: "BKHCN" },
                { label: "Bộ TN&MT (BTNMT)", val: "BTNMT" },
                { label: "Bộ Công Thương (BCT)", val: "BCT" },
              ].map((m) => (
                <button
                  key={m.val}
                  type="button"
                  className="ui-btn-chip"
                  onClick={() => { setSelectedMinistry(m.val); }}
                  style={{
                    padding: "8px 14px",
                    minHeight: "44px",
                    borderRadius: "8px",
                    border: "1px solid",
                    borderColor: selectedMinistry === m.val ? "var(--primary)" : "var(--border)",
                    background: selectedMinistry === m.val ? "var(--primary-soft)" : "var(--panel)",
                    color: selectedMinistry === m.val ? "var(--primary-dark)" : "var(--ink-2, var(--text))",
                    fontWeight: selectedMinistry === m.val ? 800 : 600,
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  {m.label}
                </button>
              ))}

              <button
                type="button"
                className="ui-btn-chip"
                onClick={() => { setSelectedMinistry(""); setSelectedCategory(""); setSelectedProcedure(""); setSearchQuery(""); }}
                style={{
                  marginLeft: "auto",
                  minHeight: "44px",
                  padding: "8px 12px",
                  border: "none",
                  background: "transparent",
                  color: "color-mix(in srgb, var(--red) 75%, var(--ink))",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Đặt lại bộ lọc
              </button>
            </div>
          </div>

          {/* Standards Cards Grid */}
          {loading ? (
            <div style={{ textAlign: "center", padding: "60px 16px", color: "var(--muted)" }}>Đang tải dữ liệu quy chuẩn...</div>
          ) : standardsList.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "48px 16px",
                background: "var(--panel)",
                borderRadius: "16px",
                border: "1px solid var(--border)",
                color: "var(--muted)",
              }}
            >
              Không tìm thấy quy chuẩn nào phù hợp với từ khóa &ldquo;{searchQuery}&rdquo;
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 420px), 1fr))", gap: "18px" }}>
              {standardsList.map((std) => {
                const badge = getMinistryBadge(std.ministry);
                const stdPdfUrl = safeHttpUrl(api.standards.getStandardPdfUrl(std.code));
                return (
                  <div
                    key={std.code}
                    style={{
                      background: "var(--panel)",
                      borderRadius: "18px",
                      border: "1px solid var(--border)",
                      padding: "clamp(14px, 2.5vw, 22px)",
                      boxShadow: "var(--shadow)",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      gap: "14px",
                      minWidth: 0,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      {/* Top Header of Card */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", flexWrap: "wrap", marginBottom: "10px" }}>
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: "13px",
                            fontWeight: 900,
                            color: "var(--primary-dark)",
                            background: "var(--primary-soft)",
                            padding: "4px 10px",
                            borderRadius: "8px",
                            border: "1px solid color-mix(in srgb, var(--primary) 35%, var(--border))",
                          }}
                        >
                          🏷️ {std.code}
                        </span>

                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 800,
                            padding: "3px 9px",
                            borderRadius: "6px",
                            background: badge.bg,
                            color: badge.color,
                            border: `1px solid ${badge.border}`,
                          }}
                        >
                          {std.ministry}
                        </span>
                      </div>

                      <h3
                        onClick={() => handleOpenDetail(std)}
                        style={{
                          margin: "0 0 8px",
                          fontSize: "16px",
                          fontWeight: 800,
                          color: "var(--ink)",
                          lineHeight: 1.4,
                          cursor: "pointer",
                        }}
                      >
                        {std.name} ↗
                      </h3>

                      <div style={{ fontSize: "12px", color: "var(--muted)", lineHeight: 1.5, marginBottom: "8px" }}>
                        📜 Văn bản: <strong style={{ color: "var(--ink-2, var(--text))" }}>{std.circular}</strong>
                      </div>

                      <div
                        style={{
                          fontSize: "12px",
                          color: "var(--ink-2, var(--text))",
                          background: "var(--surface-subtle, var(--paper))",
                          padding: "10px 12px",
                          borderRadius: "10px",
                          border: "1px solid var(--border)",
                          marginBottom: "8px",
                        }}
                      >
                        <strong>Thiết bị áp dụng:</strong> {std.target_equipment}
                      </div>

                      {/* Applicable HS codes */}
                      {std.applicable_hs_codes && std.applicable_hs_codes.length > 0 && (
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center", fontSize: "11px" }}>
                          <span style={{ color: "var(--muted)", fontWeight: 700 }}>Mã HS Code:</span>
                          {std.applicable_hs_codes.map((hs) => (
                            <span
                              key={hs}
                              style={{
                                background: "color-mix(in srgb, var(--gold) 18%, var(--panel))",
                                color: "color-mix(in srgb, var(--amber) 68%, var(--ink))",
                                fontWeight: 800,
                                padding: "2px 6px",
                                borderRadius: "4px",
                                fontFamily: "var(--font-mono)",
                              }}
                            >
                              {hs}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
                      <button
                        type="button"
                        className="ui-btn-chip"
                        onClick={() => handleOpenDetail(std)}
                        style={{
                          padding: "9px 14px",
                          minHeight: "44px",
                          borderRadius: "10px",
                          border: "none",
                          background: "var(--primary)",
                          color: "var(--panel)",
                          fontWeight: 700,
                          fontSize: "12px",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                        }}
                      >
                        <span>👁️</span>
                        <span>Xem Chi Tiết</span>
                      </button>

                      {stdPdfUrl && (
                        <a
                          href={stdPdfUrl}
                          download
                          className="ui-btn-chip"
                          style={{
                            padding: "9px 14px",
                            minHeight: "44px",
                            borderRadius: "10px",
                            border: "1px solid var(--primary)",
                            background: "var(--primary-soft)",
                            color: "var(--primary-dark)",
                            fontWeight: 700,
                            fontSize: "12px",
                            textDecoration: "none",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                          }}
                        >
                          <span>📄</span>
                          <span>Tải Toàn Văn PDF</span>
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === "tqc" && <TqcCertificateLookup />}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB: 📦 ĐỐI SOÁT MÃ HS CODE & HẢI QUAN                                     */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "hs_lookup" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div
            style={{
              background: "var(--panel)",
              padding: "clamp(14px, 2.5vw, 24px)",
              borderRadius: "16px",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow)",
            }}
          >
            <h2 style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontSize: "20px", color: "var(--primary-dark)", margin: "0 0 8px" }}>
              Tra Cứu Thủ Tục Kiểm Tra Chuyên Ngành Theo Mã HS Code
            </h2>
            <p style={{ fontSize: "13px", color: "var(--muted)", margin: "0 0 16px" }}>
              Nhập mã HS Code của linh kiện / thiết bị nhập khẩu để kiểm tra diện quản lý chuyên ngành của Bộ TT&amp;TT, Bộ KH&amp;CN, Bộ TN&amp;MT.
            </p>

            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
              <input
                type="text"
                className="ui-input"
                placeholder="Nhập mã HS Code (vd: 8473.30.10, 8471.41.90, 8517.62.59, 8507.60.90)..."
                value={hsCodeInput}
                onChange={(e) => setHsCodeInput(e.target.value)}
                style={{
                  flex: "1 1 min(100%, 260px)",
                  minWidth: 0,
                  padding: "12px 16px",
                  borderRadius: "12px",
                  border: "1px solid var(--border-strong, var(--border))",
                  fontFamily: "var(--font-mono)",
                  background: "var(--panel)",
                  color: "var(--ink)",
                }}
              />
              <button
                type="button"
                onClick={() => handleHsLookup()}
                style={{
                  padding: "12px 24px",
                  minHeight: "44px",
                  borderRadius: "12px",
                  border: "none",
                  background: "var(--primary)",
                  color: "var(--panel)",
                  fontWeight: 800,
                  fontSize: "14px",
                  cursor: "pointer",
                }}
              >
                Tra Cứu Ngay
              </button>
            </div>

            {/* Quick Sample HS Buttons */}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 700 }}>Gợi ý mã phổ biến:</span>
              {[
                { code: "8473.30.10", label: "8473.30.10 (Bo mạch máy tính nhúng Rockchip)" },
                { code: "8471.41.90", label: "8471.41.90 (Máy tính nhúng hoàn thiện)" },
                { code: "8517.62.59", label: "8517.62.59 (IoT Gateway 4G)" },
                { code: "8507.60.90", label: "8507.60.90 (Pin Lithium)" },
                { code: "9026.10.10", label: "9026.10.10 (Cảm biến đo mức)" },
                { code: "9028.30.10", label: "9028.30.10 (Công tơ điện tử)" },
              ].map((sample) => (
                <button
                  key={sample.code}
                  type="button"
                  className="ui-btn-chip"
                  onClick={() => { setHsCodeInput(sample.code); handleHsLookup(sample.code); }}
                  style={{
                    padding: "8px 12px",
                    minHeight: "44px",
                    borderRadius: "8px",
                    border: "1px solid var(--border-strong, var(--border))",
                    background: "var(--surface-subtle, var(--paper))",
                    color: "var(--ink)",
                    fontSize: "12px",
                    cursor: "pointer",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {sample.label}
                </button>
              ))}
            </div>
          </div>

          {/* HS Lookup Result Card */}
          {hsResult && (
            <div
              style={{
                background: "var(--panel)",
                borderRadius: "18px",
                border: "1px solid color-mix(in srgb, var(--green) 45%, var(--border))",
                padding: "clamp(14px, 2.5vw, 24px)",
                boxShadow: "var(--shadow)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
                <div style={{ minWidth: 0, flex: "1 1 240px" }}>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "14px",
                      fontWeight: 900,
                      background: "color-mix(in srgb, var(--green) 14%, var(--panel))",
                      color: "color-mix(in srgb, var(--green) 72%, var(--ink))",
                      padding: "4px 10px",
                      borderRadius: "6px",
                    }}
                  >
                    Mã HS: {hsResult.hs_code}
                  </span>
                  <h3 style={{ margin: "8px 0 0", fontSize: "18px", color: "var(--ink)" }}>{hsResult.hs_description}</h3>
                </div>

                <div
                  style={{
                    background: "var(--primary-soft)",
                    border: "1px solid color-mix(in srgb, var(--primary) 35%, var(--border))",
                    padding: "8px 14px",
                    borderRadius: "10px",
                    fontSize: "12px",
                    color: "var(--primary-dark)",
                  }}
                >
                  <strong>Cơ quan quản lý:</strong> {hsResult.customs_inspection_agency}
                </div>
              </div>

              {/* TT 36/2026/TT-BKHCN Risk Classification Badge */}
              {hsResult.risk_classification && (
                <div
                  style={{
                    background:
                      hsResult.risk_classification.annex === 1
                        ? "color-mix(in srgb, var(--red) 11%, var(--panel))"
                        : hsResult.risk_classification.annex === 2
                        ? "color-mix(in srgb, var(--gold) 15%, var(--panel))"
                        : "color-mix(in srgb, var(--green) 13%, var(--panel))",
                    border: `1px solid ${
                      hsResult.risk_classification.annex === 1
                        ? "color-mix(in srgb, var(--red) 45%, var(--border))"
                        : hsResult.risk_classification.annex === 2
                        ? "color-mix(in srgb, var(--gold) 55%, var(--border))"
                        : "color-mix(in srgb, var(--green) 45%, var(--border))"
                    }`,
                    padding: "14px 16px",
                    borderRadius: "12px",
                    marginBottom: "16px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "10px",
                  }}
                >
                  <div style={{ minWidth: 0, flex: "1 1 240px" }}>
                    <div
                      style={{
                        fontSize: "11px",
                        fontWeight: 800,
                        textTransform: "uppercase",
                        color:
                          hsResult.risk_classification.annex === 1
                            ? "color-mix(in srgb, var(--red) 75%, var(--ink))"
                            : hsResult.risk_classification.annex === 2
                            ? "color-mix(in srgb, var(--amber) 68%, var(--ink))"
                            : "color-mix(in srgb, var(--green) 72%, var(--ink))",
                      }}
                    >
                      ⚖️ Phân loại rủi ro (Thông tư 36/2026/TT-BKHCN):
                    </div>
                    <div
                      style={{
                        fontSize: "14px",
                        fontWeight: 800,
                        color: "var(--ink)",
                        marginTop: "2px",
                      }}
                    >
                      {hsResult.risk_classification.risk_label}
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--ink-2, var(--text))", marginTop: "4px" }}>
                      {hsResult.risk_classification.guidance}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ui-btn-chip"
                    onClick={() => { setActiveTab("risk_classification"); syncUrl("risk_classification"); }}
                    style={{
                      padding: "8px 14px",
                      minHeight: "44px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-strong, var(--border))",
                      background: "var(--panel)",
                      color: "var(--ink)",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Xem Danh Mục Rủi Ro ↗
                  </button>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: "14px", marginBottom: "16px" }}>
                <div style={{ background: "var(--surface-subtle, var(--paper))", padding: "14px", borderRadius: "12px", border: "1px solid var(--border)", minWidth: 0 }}>
                  <div style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 700 }}>Loại hình kiểm tra:</div>
                  <div style={{ fontSize: "14px", fontWeight: 800, color: "var(--primary-dark)", marginTop: "2px" }}>{hsResult.inspection_type}</div>
                </div>

                <div style={{ background: "var(--surface-subtle, var(--paper))", padding: "14px", borderRadius: "12px", border: "1px solid var(--border)", minWidth: 0 }}>
                  <div style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 700 }}>Thủ tục bắt buộc:</div>
                  <div style={{ fontSize: "14px", fontWeight: 800, color: "color-mix(in srgb, var(--amber) 68%, var(--ink))", marginTop: "2px" }}>
                    {hsResult.required_procedure}
                  </div>
                </div>
              </div>

              {/* Applicable Standards Tags */}
              <div style={{ marginBottom: "16px" }}>
                <strong style={{ fontSize: "13px", color: "var(--ink)" }}>Quy Chuẩn Kỹ Thuật Bắt Buộc Áp Dụng:</strong>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
                  {hsResult.applicable_standards.map((stdCode) => (
                    <button
                      key={stdCode}
                      type="button"
                      className="ui-btn-chip"
                      onClick={() => {
                        api.standards.search({ q: stdCode }).then((r) => { if (r.length > 0) handleOpenDetail(r[0]); });
                      }}
                      style={{
                        padding: "8px 14px",
                        minHeight: "44px",
                        borderRadius: "8px",
                        background: "var(--primary-soft)",
                        color: "var(--primary-dark)",
                        border: "1px solid color-mix(in srgb, var(--primary) 35%, var(--border))",
                        fontWeight: 800,
                        fontSize: "12px",
                        cursor: "pointer",
                      }}
                    >
                      📜 {stdCode} ↗
                    </button>
                  ))}
                </div>
              </div>

              {/* Customs Notes */}
              <div
                style={{
                  background: "color-mix(in srgb, var(--gold) 15%, var(--panel))",
                  border: "1px solid color-mix(in srgb, var(--gold) 50%, var(--border))",
                  padding: "14px 16px",
                  borderRadius: "12px",
                  fontSize: "13px",
                  color: "var(--ink)",
                  lineHeight: 1.55,
                  marginBottom: "12px",
                }}
              >
                <strong>📌 Lưu ý Hải quan &amp; Giải phóng hàng:</strong> {hsResult.customs_notes}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB: ⚖️ PHÂN LOẠI RỦI RO (THÔNG TƯ 36/2026/TT-BKHCN)                       */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "risk_classification" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Hero Banner with Official Circular Download */}
          <div
            style={{
              background: "linear-gradient(135deg, var(--ink) 0%, var(--primary-dark) 100%)",
              borderRadius: "20px",
              padding: "clamp(16px, 2.8vw, 26px)",
              color: "var(--panel)",
              position: "relative",
              overflow: "hidden",
              border: "1px solid rgba(255, 254, 250, 0.14)",
              boxShadow: "var(--shadow-md)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
              <div style={{ maxWidth: "780px", minWidth: 0, flex: "1 1 260px" }}>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "6px",
                    background: "rgba(255, 254, 250, 0.12)",
                    border: "1px solid rgba(255, 254, 250, 0.28)",
                    padding: "4px 12px",
                    borderRadius: "999px",
                    fontSize: "11px",
                    fontWeight: 800,
                    color: "var(--gold)",
                    marginBottom: "12px",
                  }}
                >
                  <span>⚖️ VĂN BẢN QUY PHẠM PHÁP LUẬT MỚI 2026</span>
                  <span>•</span>
                  <span>BỘ KHOA HỌC VÀ CÔNG NGHỆ</span>
                </div>
                <h2 style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontSize: "clamp(18px, 2.6vw, 22px)", margin: "0 0 10px", lineHeight: 1.4, color: "var(--panel)" }}>
                  Danh Mục Phân Loại Sản Phẩm, Hàng Hóa Mức Độ Rủi Ro Trung Bình &amp; Cao (Thông tư số 36/2026/TT-BKHCN)
                </h2>
                <p style={{ fontSize: "13px", color: "var(--primary-soft)", lineHeight: 1.6, margin: 0 }}>
                  Căn cứ Luật Chất lượng sản phẩm, hàng hóa (sửa đổi bởi Luật số 78/2025/QH15) và Nghị định 37/2026/NĐ-CP của Chính phủ.
                  Phân định rõ thẩm quyền kiểm tra nhà nước (KTCL), phương thức chứng nhận hợp quy (PT5 / PT7), và điều kiện giải phóng hàng thông quan tại cửa khẩu.
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {riskCircularPdfUrl && (
                  <a
                    href={riskCircularPdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      minHeight: "44px",
                      background: "var(--gold)",
                      color: "var(--ink)",
                      textDecoration: "none",
                      padding: "11px 20px",
                      borderRadius: "12px",
                      fontWeight: 800,
                      fontSize: "13px",
                      border: "none",
                    }}
                  >
                    <span>📄</span>
                    <span>Tải Bản Ký Số PDF (5.7 MB)</span>
                  </a>
                )}
                <span style={{ fontSize: "11px", color: "var(--primary-soft)", textAlign: "center" }}>
                  Chữ ký số cơ quan: Bộ KH&amp;CN
                </span>
              </div>
            </div>

            {/* KPI Stat Cards */}
            {riskStats && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
                  gap: "12px",
                  marginTop: "22px",
                  paddingTop: "18px",
                  borderTop: "1px solid rgba(255, 254, 250, 0.14)",
                }}
              >
                <div style={{ background: "rgba(255, 254, 250, 0.08)", padding: "14px 16px", borderRadius: "12px", minWidth: 0 }}>
                  <div style={{ fontSize: "11px", color: "var(--primary-soft)", fontWeight: 700, textTransform: "uppercase" }}>Tổng Mặt Hàng Quản Lý</div>
                  <div style={{ fontSize: "24px", fontWeight: 900, color: "var(--panel)", marginTop: "4px", fontFamily: "var(--font-mono)" }}>{riskStats.total_items}</div>
                  <div style={{ fontSize: "11px", color: "var(--primary-soft)", marginTop: "2px" }}>Theo TT 36/2026/TT-BKHCN</div>
                </div>

                <div
                  style={{
                    background: "color-mix(in srgb, var(--coral) 20%, var(--ink))",
                    border: "1px solid color-mix(in srgb, var(--coral) 45%, transparent)",
                    padding: "14px 16px",
                    borderRadius: "12px",
                    minWidth: 0,
                  }}
                >
                  <div style={{ fontSize: "11px", color: "var(--panel)", fontWeight: 700, textTransform: "uppercase" }}>Rủi Ro CAO (Phụ Lục I)</div>
                  <div style={{ fontSize: "24px", fontWeight: 900, color: "color-mix(in srgb, var(--coral) 45%, var(--panel))", marginTop: "4px", fontFamily: "var(--font-mono)" }}>
                    {riskStats.high_risk_count}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--primary-soft)", marginTop: "2px" }}>KTCL trước thông quan (PT5/PT7)</div>
                </div>

                <div
                  style={{
                    background: "color-mix(in srgb, var(--gold) 18%, var(--ink))",
                    border: "1px solid color-mix(in srgb, var(--gold) 45%, transparent)",
                    padding: "14px 16px",
                    borderRadius: "12px",
                    minWidth: 0,
                  }}
                >
                  <div style={{ fontSize: "11px", color: "var(--panel)", fontWeight: 700, textTransform: "uppercase" }}>Rủi Ro TRUNG BÌNH (Phụ Lục II)</div>
                  <div style={{ fontSize: "24px", fontWeight: 900, color: "var(--gold)", marginTop: "4px", fontFamily: "var(--font-mono)" }}>
                    {riskStats.medium_risk_count}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--primary-soft)", marginTop: "2px" }}>Công bố hợp quy / Hậu kiểm</div>
                </div>

                <div style={{ background: "rgba(255, 254, 250, 0.08)", padding: "14px 16px", borderRadius: "12px", minWidth: 0 }}>
                  <div style={{ fontSize: "11px", color: "var(--primary-soft)", fontWeight: 700, textTransform: "uppercase" }}>Mã HS Code Đối Soát</div>
                  <div style={{ fontSize: "24px", fontWeight: 900, color: "var(--primary-soft)", marginTop: "4px", fontFamily: "var(--font-mono)" }}>
                    {riskStats.unique_hs_count}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--primary-soft)", marginTop: "2px" }}>{riskStats.groups_count} nhóm ngành kinh tế</div>
                </div>
              </div>
            )}
          </div>

          {/* Interactive Fast Classifier Card */}
          <div
            style={{
              background: "var(--panel)",
              padding: "clamp(14px, 2.5vw, 24px)",
              borderRadius: "18px",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow)",
            }}
          >
            <h2 style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontSize: "18px", color: "var(--ink)", margin: "0 0 6px" }}>
              🔍 Tra Cứu Nhanh Cấp Độ Rủi Ro Theo Mã HS Hoặc Tên Hàng
            </h2>
            <p style={{ fontSize: "13px", color: "var(--muted)", margin: "0 0 16px" }}>
              Nhập mã HS Code (vd: 8517.62.59, 8526.10.10, 8504.40.90, 8471.41.90, 2710.12.21, 6506.10.10) hoặc từ khóa thiết bị để hệ thống bóc tách chính xác nghĩa vụ KTCL.
            </p>

            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "14px" }}>
              <input
                type="text"
                className="ui-input"
                placeholder="Nhập mã HS Code hoặc từ khóa (vd: 8517.62.59, Gateway, Radar, Mũ bảo hiểm, Đồ chơi)..."
                value={riskClassifyInput}
                onChange={(e) => setRiskClassifyInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleClassifyRisk(); }}
                style={{
                  flex: "1 1 min(100%, 260px)",
                  minWidth: 0,
                  padding: "12px 16px",
                  borderRadius: "12px",
                  border: "1px solid var(--border-strong, var(--border))",
                  fontFamily: "var(--font-mono)",
                  background: "var(--panel)",
                  color: "var(--ink)",
                }}
              />
              <button
                type="button"
                onClick={() => handleClassifyRisk()}
                disabled={riskClassifying}
                style={{
                  padding: "12px 24px",
                  minHeight: "44px",
                  borderRadius: "12px",
                  border: "none",
                  background: "var(--primary)",
                  color: "var(--panel)",
                  fontWeight: 800,
                  fontSize: "14px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                {riskClassifying ? "Đang Phân Loại..." : "Phân Loại Ngay"}
              </button>
            </div>

            {/* Quick Chips */}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginBottom: "16px" }}>
              <span style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 700 }}>Ví dụ mẫu:</span>
              {[
                { code: "8517.62.59", label: "8517.62.59 (IoT Gateway 4G)" },
                { code: "8471.41.90", label: "8471.41.90 (Màn hình máy tính A11)" },
                { code: "8504.40.90", label: "8504.40.90 (Nguồn Adapter)" },
                { code: "6506.10.10", label: "6506.10.10 (Mũ bảo hiểm)" },
                { code: "9503.00.10", label: "9503.00.10 (Đồ chơi trẻ em)" },
                { code: "2710.12.21", label: "2710.12.21 (Xăng không chì)" },
                { code: "9026.10.90", label: "9026.10.90 (Cảm biến radar)" },
              ].map((chip) => (
                <button
                  key={chip.code}
                  type="button"
                  className="ui-btn-chip"
                  onClick={() => { setRiskClassifyInput(chip.code); handleClassifyRisk(chip.code); }}
                  style={{
                    padding: "8px 12px",
                    minHeight: "44px",
                    borderRadius: "8px",
                    border: "1px solid var(--border-strong, var(--border))",
                    background: "var(--surface-subtle, var(--paper))",
                    color: "var(--ink)",
                    fontSize: "12px",
                    cursor: "pointer",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {/* Classification Result Box */}
            {riskClassifyResult && (
              <div
                style={{
                  background:
                    riskClassifyResult.annex === 1
                      ? "color-mix(in srgb, var(--red) 10%, var(--panel))"
                      : riskClassifyResult.annex === 2
                      ? "color-mix(in srgb, var(--gold) 15%, var(--panel))"
                      : "color-mix(in srgb, var(--green) 13%, var(--panel))",
                  border: `1.5px solid ${
                    riskClassifyResult.annex === 1
                      ? "var(--red)"
                      : riskClassifyResult.annex === 2
                      ? "var(--amber)"
                      : "var(--green)"
                  }`,
                  borderRadius: "16px",
                  padding: "clamp(14px, 2.5vw, 22px)",
                  boxShadow: "var(--shadow)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px", marginBottom: "12px" }}>
                  <div style={{ minWidth: 0, flex: "1 1 240px" }}>
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: 900,
                        padding: "4px 10px",
                        borderRadius: "6px",
                        background:
                          riskClassifyResult.annex === 1
                            ? "color-mix(in srgb, var(--red) 80%, var(--ink))"
                            : riskClassifyResult.annex === 2
                            ? "color-mix(in srgb, var(--amber) 72%, var(--ink))"
                            : "var(--primary-dark)",
                        color: "var(--panel)",
                      }}
                    >
                      {riskClassifyResult.risk_label}
                    </span>
                    <h3 style={{ margin: "10px 0 4px", fontSize: "18px", color: "var(--ink)" }}>
                      {riskClassifyResult.matched_item ? riskClassifyResult.matched_item.product_name : `Hàng hóa mã ${riskClassifyInput}`}
                    </h3>
                    {riskClassifyResult.matched_item?.group && (
                      <div style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 700 }}>
                        Thuộc nhóm: {riskClassifyResult.matched_item.group}
                      </div>
                    )}
                  </div>

                  {riskClassifyResult.matched_item?.qcvn && (
                    <div
                      style={{
                        background: "var(--panel)",
                        padding: "8px 14px",
                        borderRadius: "10px",
                        border: "1px solid var(--border-strong, var(--border))",
                        fontSize: "12px",
                        color: "var(--primary-dark)",
                      }}
                    >
                      <strong>Quy chuẩn tương ứng:</strong> {riskClassifyResult.matched_item.qcvn}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    background: "var(--panel)",
                    padding: "14px 16px",
                    borderRadius: "12px",
                    border: "1px solid var(--border)",
                    fontSize: "13px",
                    lineHeight: 1.6,
                    color: "var(--ink-2, var(--text))",
                    marginBottom: "12px",
                  }}
                >
                  <strong>⚖️ Hướng dẫn quản lý &amp; Hải quan:</strong> {riskClassifyResult.guidance}
                </div>

                {riskClassifyResult.matched_item?.management_requirement && (
                  <div style={{ fontSize: "12px", color: "var(--ink-2, var(--text))", lineHeight: 1.55 }}>
                    <strong>Biện pháp cụ thể:</strong> {riskClassifyResult.matched_item.management_requirement}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Full Catalog Table Card */}
          <div
            style={{
              background: "var(--panel)",
              padding: "clamp(14px, 2.5vw, 24px)",
              borderRadius: "18px",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "14px", marginBottom: "18px" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "18px", color: "var(--ink)", fontFamily: "var(--font-serif, Georgia, serif)" }}>
                  Bảng Danh Mục Chi Tiết 275 Mặt Hàng Quản Lý Rủi Ro
                </h3>
                <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                  Hiển thị {riskCatalog.length} / {riskCatalogTotal} mục tìm thấy
                </span>
              </div>

              {/* Filter Pills */}
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {[
                  { key: "", label: "Tất cả" },
                  { key: "CAO", label: "Rủi ro CAO (Phụ lục I)" },
                  { key: "TRUNG_BINH", label: "Rủi ro TRUNG BÌNH (Phụ lục II)" },
                ].map((f) => {
                  const isActive = riskLevelFilter === f.key;
                  const activeBg =
                    f.key === "CAO"
                      ? "color-mix(in srgb, var(--red) 80%, var(--ink))"
                      : f.key === "TRUNG_BINH"
                      ? "color-mix(in srgb, var(--amber) 72%, var(--ink))"
                      : "var(--primary)";
                  return (
                    <button
                      key={f.key}
                      type="button"
                      className="ui-btn-chip"
                      onClick={() => {
                        setRiskLevelFilter(f.key);
                        loadRiskCatalog(1, f.key, riskGroupFilter, riskSearchQuery);
                      }}
                      style={{
                        padding: "8px 14px",
                        minHeight: "44px",
                        borderRadius: "8px",
                        fontSize: "12px",
                        fontWeight: 700,
                        cursor: "pointer",
                        border: "none",
                        background: isActive ? activeBg : "var(--surface-subtle, var(--paper))",
                        color: isActive ? "var(--panel)" : "var(--ink-2, var(--text))",
                      }}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Filter Bar */}
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "16px" }}>
              <input
                type="text"
                className="ui-input"
                placeholder="Lọc theo tên hàng, mã HS, QCVN, mô tả..."
                value={riskSearchQuery}
                onChange={(e) => {
                  setRiskSearchQuery(e.target.value);
                  loadRiskCatalog(1, riskLevelFilter, riskGroupFilter, e.target.value);
                }}
                style={{
                  flex: "1 1 min(100%, 240px)",
                  minWidth: 0,
                  padding: "9px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--border-strong, var(--border))",
                  background: "var(--panel)",
                  color: "var(--ink)",
                }}
              />

              {riskStats?.groups && (
                <select
                  className="ui-select"
                  value={riskGroupFilter}
                  onChange={(e) => {
                    setRiskGroupFilter(e.target.value);
                    loadRiskCatalog(1, riskLevelFilter, e.target.value, riskSearchQuery);
                  }}
                  style={{
                    flex: "1 1 min(100%, 220px)",
                    minWidth: 0,
                    maxWidth: "100%",
                    padding: "9px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--border-strong, var(--border))",
                    background: "var(--panel)",
                    color: "var(--ink)",
                  }}
                >
                  <option value="">-- Tất cả nhóm ngành ({riskStats.groups.length}) --</option>
                  {riskStats.groups.map((g) => (
                    <option key={g} value={g}>{g.slice(0, 45)}...</option>
                  ))}
                </select>
              )}
            </div>

            {/* Responsive Table / Mobile Cards */}
            {riskLoading ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: "var(--muted)" }}>Đang tải danh mục phân loại rủi ro...</div>
            ) : riskCatalog.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: "var(--muted)" }}>Không tìm thấy mặt hàng nào phù hợp với bộ lọc.</div>
            ) : (
              <DataView
                mobileMode="card"
                desktop={
                  <div className="ui-table-scroll-wrap" style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", textAlign: "left" }}>
                      <thead>
                        <tr style={{ background: "var(--surface-subtle, var(--paper))", borderBottom: "2px solid var(--border)" }}>
                          <th style={{ padding: "10px", width: "50px", color: "var(--ink)" }}>STT</th>
                          <th style={{ padding: "10px", width: "115px", color: "var(--ink)" }}>Cấp Độ Rủi Ro</th>
                          <th style={{ padding: "10px", width: "110px", color: "var(--ink)" }}>Mã HS Code</th>
                          <th style={{ padding: "10px", minWidth: "220px", color: "var(--ink)" }}>Tên Sản Phẩm / Hàng Hóa</th>
                          <th style={{ padding: "10px", minWidth: "160px", color: "var(--ink)" }}>Quy Chuẩn (QCVN)</th>
                          <th style={{ padding: "10px", minWidth: "220px", color: "var(--ink)" }}>Yêu Cầu Quản Lý / KTCL</th>
                          <th style={{ padding: "10px", width: "60px", textAlign: "center", color: "var(--ink)" }}>Trang</th>
                        </tr>
                      </thead>
                      <tbody>
                        {riskCatalog.map((item) => (
                          <tr key={item.id} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ padding: "10px", color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{item.stt}</td>
                            <td style={{ padding: "10px" }}>
                              <span
                                style={{
                                  display: "inline-block",
                                  fontSize: "11px",
                                  fontWeight: 800,
                                  padding: "2px 8px",
                                  borderRadius: "6px",
                                  background:
                                    item.annex === 1
                                      ? "color-mix(in srgb, var(--red) 12%, var(--panel))"
                                      : "color-mix(in srgb, var(--gold) 18%, var(--panel))",
                                  color:
                                    item.annex === 1
                                      ? "color-mix(in srgb, var(--red) 75%, var(--ink))"
                                      : "color-mix(in srgb, var(--amber) 68%, var(--ink))",
                                }}
                              >
                                {item.annex === 1 ? "Phụ lục I (CAO)" : "Phụ lục II (TB)"}
                              </span>
                            </td>
                            <td style={{ padding: "10px", fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--primary-dark)" }}>
                              {item.hs_codes && item.hs_codes.length > 0 ? item.hs_codes.join(", ") : (item.hs_raw || "—")}
                            </td>
                            <td style={{ padding: "10px" }}>
                              <strong style={{ color: "var(--ink)" }}>{item.product_name}</strong>
                              {item.description && item.description !== item.product_name && (
                                <div style={{ color: "var(--muted)", fontSize: "11px", marginTop: "2px" }}>
                                  {item.description.slice(0, 120)}...
                                </div>
                              )}
                            </td>
                            <td style={{ padding: "10px", color: "var(--primary-dark)", fontWeight: 700 }}>
                              {item.qcvn || "—"}
                            </td>
                            <td style={{ padding: "10px", color: "var(--ink-2, var(--text))", fontSize: "11px", lineHeight: 1.45 }}>
                              {item.management_requirement ? item.management_requirement.slice(0, 160) + "..." : "—"}
                            </td>
                            <td style={{ padding: "10px", textAlign: "center", color: "var(--muted)" }}>
                              p.{item.page}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                }
                mobileCards={
                  <div className="ui-mobile-card-list">
                    {riskCatalog.map((item) => (
                      <article
                        key={item.id}
                        className="ui-mobile-card"
                        style={{
                          background: "var(--panel)",
                          border: "1px solid var(--border)",
                          borderLeft: `4px solid ${item.annex === 1 ? "var(--red)" : "var(--amber)"}`,
                          borderRadius: "14px",
                          padding: "14px",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "6px" }}>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--muted)", fontWeight: 700 }}>
                            #{item.stt} · p.{item.page}
                          </span>
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 800,
                              padding: "2px 8px",
                              borderRadius: "6px",
                              background:
                                item.annex === 1
                                  ? "color-mix(in srgb, var(--red) 12%, var(--panel))"
                                  : "color-mix(in srgb, var(--gold) 18%, var(--panel))",
                              color:
                                item.annex === 1
                                  ? "color-mix(in srgb, var(--red) 75%, var(--ink))"
                                  : "color-mix(in srgb, var(--amber) 68%, var(--ink))",
                            }}
                          >
                            {item.annex === 1 ? "Phụ lục I (CAO)" : "Phụ lục II (TB)"}
                          </span>
                        </div>
                        <div style={{ fontWeight: 800, fontSize: "14px", color: "var(--ink)", marginBottom: "4px", lineHeight: 1.4 }}>
                          {item.product_name}
                        </div>
                        {item.description && item.description !== item.product_name && (
                          <div style={{ color: "var(--muted)", fontSize: "12px", marginBottom: "8px", lineHeight: 1.45 }}>
                            {item.description.slice(0, 120)}...
                          </div>
                        )}
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", color: "var(--ink-2, var(--text))" }}>
                          <div>
                            <strong style={{ color: "var(--muted)" }}>Mã HS: </strong>
                            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--primary-dark)" }}>
                              {item.hs_codes && item.hs_codes.length > 0 ? item.hs_codes.join(", ") : (item.hs_raw || "—")}
                            </span>
                          </div>
                          {item.qcvn && (
                            <div>
                              <strong style={{ color: "var(--muted)" }}>QCVN: </strong>
                              <span style={{ fontWeight: 700, color: "var(--primary-dark)" }}>{item.qcvn}</span>
                            </div>
                          )}
                          {item.management_requirement && (
                            <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px", lineHeight: 1.45 }}>
                              {item.management_requirement.slice(0, 160)}...
                            </div>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                }
              />
            )}

            {/* Pagination */}
            {riskCatalogTotal > riskCatalogLimit && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", marginTop: "16px", paddingTop: "12px", borderTop: "1px solid var(--border)" }}>
                <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                  Trang {riskCatalogPage} / {Math.ceil(riskCatalogTotal / riskCatalogLimit)}
                </span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    className="ui-btn-chip"
                    disabled={riskCatalogPage <= 1}
                    onClick={() => loadRiskCatalog(riskCatalogPage - 1)}
                    style={{
                      padding: "8px 14px",
                      minHeight: "44px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-strong, var(--border))",
                      background: "var(--panel)",
                      color: "var(--ink)",
                      fontSize: "12px",
                      cursor: riskCatalogPage <= 1 ? "not-allowed" : "pointer",
                    }}
                  >
                    ← Trang Trước
                  </button>
                  <button
                    type="button"
                    className="ui-btn-chip"
                    disabled={riskCatalogPage >= Math.ceil(riskCatalogTotal / riskCatalogLimit)}
                    onClick={() => loadRiskCatalog(riskCatalogPage + 1)}
                    style={{
                      padding: "8px 14px",
                      minHeight: "44px",
                      borderRadius: "8px",
                      border: "1px solid var(--border-strong, var(--border))",
                      background: "var(--panel)",
                      color: "var(--ink)",
                      fontSize: "12px",
                      cursor: riskCatalogPage >= Math.ceil(riskCatalogTotal / riskCatalogLimit) ? "not-allowed" : "pointer",
                    }}
                  >
                    Trang Sau →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB: 📝 SINH BẢN CÔNG BỐ HỢP QUY (CR)                                     */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "cr_generator" && (
        <FormGrid cols={2} style={{ gap: "20px", alignItems: "start" }}>
          {/* Form Configuration */}
          <div
            style={{
              background: "var(--panel)",
              padding: "clamp(14px, 2.5vw, 24px)",
              borderRadius: "18px",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow)",
              minWidth: 0,
            }}
          >
            <h2 style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontSize: "18px", color: "var(--primary-dark)", margin: "0 0 16px" }}>
              Cấu Hình Bản Công Bố Hợp Quy (Mẫu 02 - TT 28/2012/TT-BKHCN)
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ minWidth: 0 }}>
                <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)", marginBottom: "4px" }}>Tên Doanh Nghiệp</label>
                <input
                  type="text"
                  className="ui-input"
                  value={crForm.company_name}
                  onChange={(e) => setCrForm({ ...crForm, company_name: e.target.value })}
                  style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--border-strong, var(--border))", background: "var(--panel)", color: "var(--ink)" }}
                />
              </div>

              <FormGrid cols={2}>
                <div style={{ minWidth: 0 }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)", marginBottom: "4px" }}>Mã Số Thuế (MST)</label>
                  <input
                    type="text"
                    className="ui-input"
                    value={crForm.tax_code}
                    onChange={(e) => setCrForm({ ...crForm, tax_code: e.target.value })}
                    style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--border-strong, var(--border))", fontFamily: "var(--font-mono)", background: "var(--panel)", color: "var(--ink)" }}
                  />
                </div>
                <div style={{ minWidth: 0 }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)", marginBottom: "4px" }}>Người Đại Diện</label>
                  <input
                    type="text"
                    className="ui-input"
                    value={crForm.representative_name}
                    onChange={(e) => setCrForm({ ...crForm, representative_name: e.target.value })}
                    style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--border-strong, var(--border))", background: "var(--panel)", color: "var(--ink)" }}
                  />
                </div>
              </FormGrid>

              <FormGrid cols={2}>
                <div style={{ minWidth: 0 }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)", marginBottom: "4px" }}>Tên Sản Phẩm / Thiết Bị</label>
                  <input
                    type="text"
                    className="ui-input"
                    value={crForm.product_name}
                    onChange={(e) => setCrForm({ ...crForm, product_name: e.target.value })}
                    style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--border-strong, var(--border))", background: "var(--panel)", color: "var(--ink)" }}
                  />
                </div>
                <div style={{ minWidth: 0 }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)", marginBottom: "4px" }}>Model / Ký Hiệu</label>
                  <input
                    type="text"
                    className="ui-input"
                    value={crForm.model_name}
                    onChange={(e) => setCrForm({ ...crForm, model_name: e.target.value })}
                    style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--border-strong, var(--border))", fontFamily: "var(--font-mono)", background: "var(--panel)", color: "var(--ink)" }}
                  />
                </div>
              </FormGrid>

              <div style={{ minWidth: 0 }}>
                <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)", marginBottom: "4px" }}>Quy Chuẩn Kỹ Thuật Áp Dụng (Phân cách bằng dấu phẩy)</label>
                <input
                  type="text"
                  className="ui-input"
                  value={crForm.applicable_standards.join(", ")}
                  onChange={(e) => setCrForm({ ...crForm, applicable_standards: e.target.value.split(",").map((s) => s.trim()) })}
                  style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--border-strong, var(--border))", fontFamily: "var(--font-mono)", background: "var(--panel)", color: "var(--ink)" }}
                />
              </div>

              <FormGrid cols={2}>
                <div style={{ minWidth: 0 }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)", marginBottom: "4px" }}>Số Phiếu Kết Quả Thử Nghiệm</label>
                  <input
                    type="text"
                    className="ui-input"
                    value={crForm.test_report_number}
                    onChange={(e) => setCrForm({ ...crForm, test_report_number: e.target.value })}
                    style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--border-strong, var(--border))", background: "var(--panel)", color: "var(--ink)" }}
                  />
                </div>
                <div style={{ minWidth: 0 }}>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)", marginBottom: "4px" }}>Phòng Lab Thử Nghiệm</label>
                  <input
                    type="text"
                    className="ui-input"
                    value={crForm.test_lab_name}
                    onChange={(e) => setCrForm({ ...crForm, test_lab_name: e.target.value })}
                    style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", border: "1px solid var(--border-strong, var(--border))", background: "var(--panel)", color: "var(--ink)" }}
                  />
                </div>
              </FormGrid>

              {/* Action Export Buttons */}
              <div style={{ display: "flex", gap: "10px", marginTop: "14px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={handleDownloadCrPdf}
                  disabled={generatingPdf}
                  style={{
                    flex: "1 1 180px",
                    minHeight: "44px",
                    padding: "12px",
                    borderRadius: "10px",
                    border: "none",
                    background: "var(--primary)",
                    color: "var(--panel)",
                    fontWeight: 800,
                    fontSize: "13px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                  }}
                >
                  <span>📄</span>
                  <span>{generatingPdf ? "Đang tạo PDF..." : "Tải Bản Công Bố PDF"}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadCrDocx}
                  style={{
                    flex: "1 1 180px",
                    minHeight: "44px",
                    padding: "12px",
                    borderRadius: "10px",
                    border: "1px solid var(--primary)",
                    background: "var(--primary-soft)",
                    color: "var(--primary-dark)",
                    fontWeight: 800,
                    fontSize: "13px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                  }}
                >
                  <span>📝</span>
                  <span>Tải File Word (DOCX)</span>
                </button>
              </div>
            </div>
          </div>

          {/* Live Document Preview */}
          <div
            style={{
              background: "var(--panel)",
              padding: "clamp(16px, 2.8vw, 24px)",
              borderRadius: "18px",
              border: "1px solid var(--border-strong, var(--border))",
              boxShadow: "var(--shadow)",
              fontFamily: "'Times New Roman', serif",
              lineHeight: 1.5,
              color: "var(--ink)",
              minWidth: 0,
              overflowWrap: "anywhere",
            }}
          >
            <div style={{ textAlign: "center", marginBottom: "16px" }}>
              <div style={{ fontWeight: "bold", fontSize: "13px", textTransform: "uppercase" }}>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
              <div style={{ fontWeight: "bold", fontSize: "13px" }}>Độc lập - Tự do - Hạnh phúc</div>
              <div style={{ fontSize: "11px", marginTop: "2px" }}>────────────────</div>
            </div>

            <div style={{ textAlign: "center", fontWeight: "bold", fontSize: "16px", textTransform: "uppercase", color: "var(--primary-dark)", margin: "14px 0 4px" }}>
              BẢN CÔNG BỐ HỢP QUY
            </div>
            <div style={{ textAlign: "center", fontSize: "11px", fontStyle: "italic", marginBottom: "16px", color: "var(--muted)" }}>
              (Theo Thông tư số 28/2012/TT-BKHCN và TT 02/2017/TT-BKHCN)
            </div>

            <div style={{ fontSize: "13px", display: "flex", flexDirection: "column", gap: "6px" }}>
              <div><strong>1. Đơn vị công bố:</strong> {crForm.company_name} (MST: <strong>{crForm.tax_code}</strong>)</div>
              <div><strong>2. Sản phẩm hàng hóa:</strong> {crForm.product_name} — Model: <strong>{crForm.model_name}</strong></div>
              <div><strong>3. Phù hợp các Quy chuẩn:</strong> {crForm.applicable_standards.join(", ")}</div>
              <div><strong>4. Căn cứ:</strong> Phiếu kết quả số {crForm.test_report_number} do {crForm.test_lab_name} cấp.</div>
              <div><strong>5. Cam kết:</strong> Doanh nghiệp cam kết chịu trách nhiệm trước pháp luật về chất lượng sản phẩm.</div>
            </div>

            <div style={{ marginTop: "24px", textAlign: "right", fontSize: "12px" }}>
              <em>Ngày ... tháng ... năm ...</em><br />
              <strong>ĐẠI DIỆN HỢP PHÁP</strong><br />
              <div style={{ height: "40px", color: "var(--primary-dark)", fontWeight: "bold", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                [KÝ SỐ ĐIỆN TỬ]
              </div>
              <strong>{crForm.representative_name}</strong>
            </div>
          </div>
        </FormGrid>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL: CHI TIẾT TOÀN VĂN QUY CHUẨN (AppModal)                              */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      <AppModal
        open={Boolean(detailStandard)}
        onClose={handleCloseDetail}
        size="lg"
        title={detailStandard ? detailStandard.name : ""}
        subtitle={
          detailStandard ? (
            <span
              style={{
                display: "inline-block",
                fontFamily: "var(--font-mono)",
                fontSize: "13px",
                fontWeight: 900,
                color: "var(--primary-dark)",
                background: "var(--primary-soft)",
                padding: "3px 9px",
                borderRadius: "8px",
              }}
            >
              🏷️ {detailStandard.code}
            </span>
          ) : undefined
        }
        footer={
          detailStandard ? (
            <div style={{ display: "flex", gap: "10px", width: "100%", flexWrap: "wrap" }}>
              {detailPdfUrl && (
                <a
                  href={detailPdfUrl}
                  download
                  style={{
                    flex: "1 1 200px",
                    minHeight: "44px",
                    padding: "10px 16px",
                    borderRadius: "10px",
                    background: "var(--primary)",
                    color: "var(--panel)",
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 800,
                    fontSize: "13px",
                  }}
                >
                  📥 Tải Toàn Văn PDF
                </a>
              )}
              <button
                type="button"
                onClick={handleCloseDetail}
                style={{
                  minHeight: "44px",
                  padding: "10px 20px",
                  borderRadius: "10px",
                  border: "1px solid var(--border-strong, var(--border))",
                  background: "var(--panel)",
                  color: "var(--ink)",
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: "13px",
                }}
              >
                Đóng
              </button>
            </div>
          ) : undefined
        }
      >
        {detailStandard && (
          <>
            <div
              style={{
                background: "var(--surface-subtle, var(--paper))",
                padding: "14px 16px",
                borderRadius: "12px",
                border: "1px solid var(--border)",
                fontSize: "13px",
                lineHeight: 1.6,
                marginBottom: "16px",
                color: "var(--ink-2, var(--text))",
              }}
            >
              <div><strong>Cơ quan ban hành:</strong> {detailStandard.ministry_label}</div>
              <div><strong>Văn bản pháp lý:</strong> {detailStandard.circular}</div>
              <div><strong>Thủ tục áp dụng:</strong> {detailStandard.procedure_label}</div>
              <div><strong>Thiết bị áp dụng:</strong> {detailStandard.target_equipment}</div>
            </div>

            <h4 style={{ fontSize: "15px", color: "var(--primary-dark)", margin: "0 0 8px" }}>
              Mục 1. Chỉ Tiêu Kỹ Thuật Cốt Lõi Bắt Buộc
            </h4>
            <div
              style={{
                background: "color-mix(in srgb, var(--green) 12%, var(--panel))",
                border: "1px solid color-mix(in srgb, var(--green) 42%, var(--border))",
                padding: "14px 16px",
                borderRadius: "12px",
                fontSize: "13px",
                color: "var(--ink)",
              }}
            >
              <ul style={{ margin: 0, paddingLeft: "18px", lineHeight: 1.6 }}>
                {detailStandard.key_technical_requirements.map((req, idx) => (
                  <li key={idx}>{req}</li>
                ))}
              </ul>
            </div>
          </>
        )}
      </AppModal>
    </div>
  );
}
