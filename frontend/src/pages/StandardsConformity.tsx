import React, { useEffect, useState } from "react";
import { api } from "../api";
import { TqcCertificateLookup } from "../components/TqcCertificateLookup";

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

export function StandardsConformity() {
  const [activeTab, setActiveTab] = useState<"game" | "playbooks" | "emc_guide" | "search" | "hs_lookup" | "cr_generator" | "labs" | "tqc">("game");
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
  const [showConfetti, setShowConfetti] = useState(false);

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
    } else {
      setActiveTab("game");
    }
  }, []);

  const fetchStats = async () => {
    try {
      const s = await api.standards.getStatistics();
      setStats(s);
    } catch {}
  };

  const fetchGameState = async () => {
    try {
      const g = await api.standards.getGameState();
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
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 4000);
      showToast(`🎉 CHÚC MỪNG! Đã hoàn thành Ải ${questId} (+500 EXP)!`, "success");
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
      setStandardsList(res);
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
        return { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe", label: "Bộ Thông tin & Truyền thông" };
      case "BKHCN":
        return { bg: "#f0fdf4", color: "#15803d", border: "#bbf7d0", label: "Bộ Khoa học & Công nghệ" };
      case "BTNMT":
        return { bg: "#f0fdfa", color: "#0f766e", border: "#99f6e4", label: "Bộ Tài nguyên & Môi trường" };
      case "BCT":
        return { bg: "#fff7ed", color: "#c2410c", border: "#fed7aa", label: "Bộ Công Thương" };
      default:
        return { bg: "#f8fafc", color: "#475569", border: "#e2e8f0", label: ministry };
    }
  };

  const currentPlaybook = playbooks.find((p) => p.id === selectedPlaybookId) || playbooks[0];

  return (
    <div style={{ padding: "24px 32px", maxWidth: "1400px", margin: "0 auto", position: "relative" }}>
      {/* Confetti Firework Animation Effect */}
      {showConfetti && (
        <div
          style={{
            position: "fixed",
            top: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10000,
            background: "linear-gradient(135deg, #f59e0b 0%, #ef4444 50%, #8b5cf6 100%)",
            color: "#fff",
            padding: "16px 36px",
            borderRadius: "999px",
            fontWeight: 900,
            fontSize: "18px",
            boxShadow: "0 12px 36px rgba(0,0,0,0.3)",
            animation: "toastIn 0.55s cubic-bezier(0.16, 1, 0.3, 1) both",
          }}
        >
          🎉 LEVEL UP! +500 EXP • BẠN VỪA VƯỢT ẢI THÀNH CÔNG! 🚀
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            zIndex: 9999,
            padding: "12px 20px",
            borderRadius: "12px",
            background: toast.type === "success" ? "#0f766e" : toast.type === "error" ? "#be123c" : "#1e293b",
            color: "#fff",
            fontWeight: 700,
            fontSize: "13px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
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
          background: "linear-gradient(135deg, #0f4c3a 0%, #168579 50%, #0d9488 100%)",
          borderRadius: "20px",
          padding: "30px 36px",
          color: "#fff",
          marginBottom: "28px",
          boxShadow: "0 10px 30px rgba(15, 76, 58, 0.25)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "20px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <span style={{ fontSize: "24px" }}>📜</span>
            <span style={{ textTransform: "uppercase", fontSize: "12px", fontWeight: 800, letterSpacing: "1px", background: "rgba(255,255,255,0.2)", padding: "4px 10px", borderRadius: "999px" }}>
              KSP Quality & Standards Intelligence
            </span>
          </div>
          <h1 style={{ fontFamily: "Georgia, serif", fontSize: "28px", margin: "0 0 8px", color: "#fff", fontWeight: 700 }}>
            Hành Trình Chinh Phục Hợp Quy & Cẩm Nang Chứng Nhận Thiết Bị iNut (QCVN / TCVN)
          </h1>
          <p style={{ margin: 0, fontSize: "14px", color: "#e6fffa", maxWidth: "850px", lineHeight: 1.5 }}>
            Game tương tác thực chiến 6 Ải: Lắp ráp mẫu, Nạp RF Test Tool, Bắn Zalo phòng Lab, Chinh phục buồng câm EMC & Cấp Giấy CNHQ BTTTT cho iNut Rockchip.
          </p>
        </div>

        {/* Macro Stat Chips */}
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <div style={{ background: "rgba(255,255,255,0.15)", backdropFilter: "blur(8px)", padding: "12px 18px", borderRadius: "14px", border: "1px solid rgba(255,255,255,0.25)", textAlign: "center" }}>
            <div style={{ fontSize: "20px", fontWeight: 800, color: "#fef08a", fontFamily: "var(--font-mono)" }}>
              {gameState ? `Lv.${gameState.current_level}` : "Lv.1"}
            </div>
            <div style={{ fontSize: "11px", color: "#ccfbf1", fontWeight: 700 }}>Cấp Độ Hợp Quy</div>
          </div>

          <div style={{ background: "rgba(255,255,255,0.15)", backdropFilter: "blur(8px)", padding: "12px 18px", borderRadius: "14px", border: "1px solid rgba(255,255,255,0.25)", textAlign: "center" }}>
            <div style={{ fontSize: "20px", fontWeight: 800, color: "#fff", fontFamily: "var(--font-mono)" }}>
              {gameState ? `${gameState.current_exp} / ${gameState.max_exp}` : "500 / 3000"} EXP
            </div>
            <div style={{ fontSize: "11px", color: "#ccfbf1", fontWeight: 700 }}>Điểm Kinh Nghiệm</div>
          </div>

          <div style={{ background: "rgba(255,255,255,0.15)", backdropFilter: "blur(8px)", padding: "12px 18px", borderRadius: "14px", border: "1px solid rgba(255,255,255,0.25)", textAlign: "center" }}>
            <div style={{ fontSize: "20px", fontWeight: 800, color: "#fed7aa", fontFamily: "var(--font-mono)" }}>
              {gameState ? `${gameState.progress_percent}%` : "16%"}
            </div>
            <div style={{ fontSize: "11px", color: "#ccfbf1", fontWeight: 700 }}>Tiến Độ Hoàn Thành</div>
          </div>
        </div>
      </div>

      {/* Main Tab Navigation */}
      <div style={{ display: "flex", gap: "8px", borderBottom: "2px solid #e2e8f0", marginBottom: "24px", flexWrap: "wrap" }}>
        <button
          onClick={() => { setActiveTab("game"); syncUrl("game"); }}
          style={{
            padding: "12px 18px",
            border: "none",
            borderRadius: "12px 12px 0 0",
            fontSize: "14px",
            fontWeight: activeTab === "game" ? 800 : 600,
            background: activeTab === "game" ? "#fff" : "transparent",
            color: activeTab === "game" ? "#0f766e" : "#64748b",
            boxShadow: activeTab === "game" ? "0 -2px 10px rgba(0,0,0,0.05)" : "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "7px",
          }}
        >
          <span>🎮</span>
          <span>Game Chinh Phục Hợp Quy</span>
          <span style={{ fontSize: "11px", padding: "2px 7px", borderRadius: "999px", background: "#fef08a", color: "#854d0e", fontWeight: 800 }}>
            {gameState ? `${gameState.completed_quests_count}/${gameState.total_quests} Ải` : "1/6 Ải"}
          </span>
        </button>

        <button
          onClick={() => { setActiveTab("playbooks"); syncUrl("playbooks"); }}
          style={{
            padding: "12px 18px",
            border: "none",
            borderRadius: "12px 12px 0 0",
            fontSize: "14px",
            fontWeight: activeTab === "playbooks" ? 800 : 600,
            background: activeTab === "playbooks" ? "#fff" : "transparent",
            color: activeTab === "playbooks" ? "#0f766e" : "#64748b",
            boxShadow: activeTab === "playbooks" ? "0 -2px 10px rgba(0,0,0,0.05)" : "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "7px",
          }}
        >
          <span>📘</span>
          <span>Cẩm Nang & Case Study Thực Chiến</span>
          <span style={{ fontSize: "11px", padding: "2px 7px", borderRadius: "999px", background: "#fee2e2", color: "#b91c1c", fontWeight: 800 }}>
            ⭐ iNut Rockchip
          </span>
        </button>

        <button
          onClick={() => { setActiveTab("emc_guide"); syncUrl("emc_guide"); }}
          style={{
            padding: "12px 18px",
            border: "none",
            borderRadius: "12px 12px 0 0",
            fontSize: "14px",
            fontWeight: activeTab === "emc_guide" ? 800 : 600,
            background: activeTab === "emc_guide" ? "#fff" : "transparent",
            color: activeTab === "emc_guide" ? "#0f766e" : "#64748b",
            boxShadow: activeTab === "emc_guide" ? "0 -2px 10px rgba(0,0,0,0.05)" : "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "7px",
          }}
        >
          <span>🛡️</span>
          <span>Bí Kíp Đo Đậu EMC & Tĩnh Điện (ESD)</span>
        </button>

        <button
          onClick={() => { setActiveTab("search"); syncUrl("search"); }}
          style={{
            padding: "12px 18px",
            border: "none",
            borderRadius: "12px 12px 0 0",
            fontSize: "14px",
            fontWeight: activeTab === "search" ? 800 : 600,
            background: activeTab === "search" ? "#fff" : "transparent",
            color: activeTab === "search" ? "#0f766e" : "#64748b",
            boxShadow: activeTab === "search" ? "0 -2px 10px rgba(0,0,0,0.05)" : "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "7px",
          }}
        >
          <span>🔍</span>
          <span>Tra Cứu Quy Chuẩn QCVN & TCVN</span>
        </button>

        <button
          onClick={() => { setActiveTab("tqc"); syncUrl("tqc"); }}
          style={{
            padding: "12px 18px",
            border: "none",
            borderRadius: "12px 12px 0 0",
            fontSize: "14px",
            fontWeight: activeTab === "tqc" ? 800 : 600,
            background: activeTab === "tqc" ? "#fff" : "transparent",
            color: activeTab === "tqc" ? "#0f766e" : "#64748b",
            boxShadow: activeTab === "tqc" ? "0 -2px 10px rgba(0,0,0,0.05)" : "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "7px",
          }}
        >
          <span>🧾</span>
          <span>Tra Cứu GCN TQC Theo Model</span>
        </button>

        <button
          onClick={() => { setActiveTab("hs_lookup"); syncUrl("hs_lookup"); }}
          style={{
            padding: "12px 18px",
            border: "none",
            borderRadius: "12px 12px 0 0",
            fontSize: "14px",
            fontWeight: activeTab === "hs_lookup" ? 800 : 600,
            background: activeTab === "hs_lookup" ? "#fff" : "transparent",
            color: activeTab === "hs_lookup" ? "#0f766e" : "#64748b",
            boxShadow: activeTab === "hs_lookup" ? "0 -2px 10px rgba(0,0,0,0.05)" : "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "7px",
          }}
        >
          <span>📦</span>
          <span>Đối Soát Mã HS Code</span>
        </button>

        <button
          onClick={() => { setActiveTab("cr_generator"); syncUrl("cr_generator"); }}
          style={{
            padding: "12px 18px",
            border: "none",
            borderRadius: "12px 12px 0 0",
            fontSize: "14px",
            fontWeight: activeTab === "cr_generator" ? 800 : 600,
            background: activeTab === "cr_generator" ? "#fff" : "transparent",
            color: activeTab === "cr_generator" ? "#0f766e" : "#64748b",
            boxShadow: activeTab === "cr_generator" ? "0 -2px 10px rgba(0,0,0,0.05)" : "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "7px",
          }}
        >
          <span>📝</span>
          <span>Sinh Bản Công Bố Hợp Quy (CR)</span>
        </button>

        <button
          onClick={() => { setActiveTab("labs"); syncUrl("labs"); }}
          style={{
            padding: "12px 18px",
            border: "none",
            borderRadius: "12px 12px 0 0",
            fontSize: "14px",
            fontWeight: activeTab === "labs" ? 800 : 600,
            background: activeTab === "labs" ? "#fff" : "transparent",
            color: activeTab === "labs" ? "#0f766e" : "#64748b",
            boxShadow: activeTab === "labs" ? "0 -2px 10px rgba(0,0,0,0.05)" : "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "7px",
          }}
        >
          <span>🏛️</span>
          <span>Đầu Mối Zalo & Danh Bạ Lab</span>
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB: 🎮 GAME CHINH PHỤC HỢP QUY                                           */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "game" && gameState && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Level Header & Progress Card */}
          <div
            style={{
              background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
              borderRadius: "20px",
              padding: "24px 30px",
              color: "#fff",
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
              display: "flex",
              flexDirection: "column",
              gap: "18px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <div
                  style={{
                    width: "56px",
                    height: "56px",
                    borderRadius: "16px",
                    background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "26px",
                    boxShadow: "0 4px 14px rgba(245,158,11,0.4)",
                  }}
                >
                  🏆
                </div>
                <div>
                  <div style={{ fontSize: "12px", color: "#94a3b8", textTransform: "uppercase", fontWeight: 800, letterSpacing: "1px" }}>
                    Danh Hiệu Người Chơi
                  </div>
                  <div style={{ fontSize: "20px", fontWeight: 800, color: "#fef08a", fontFamily: "Georgia, serif" }}>
                    {gameState.current_level_title}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <button
                  onClick={handleResetGame}
                  style={{
                    padding: "8px 14px",
                    borderRadius: "10px",
                    border: "1px solid #475569",
                    background: "rgba(255,255,255,0.05)",
                    color: "#cbd5e1",
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
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "6px", fontWeight: 700 }}>
                <span style={{ color: "#38bdf8" }}>Tiến Độ Hoàn Thành 6 Ải: {gameState.completed_quests_count} / {gameState.total_quests} Ải</span>
                <span style={{ color: "#fef08a", fontFamily: "var(--font-mono)" }}>{gameState.current_exp} / {gameState.max_exp} EXP ({gameState.progress_percent}%)</span>
              </div>
              <div style={{ width: "100%", height: "12px", borderRadius: "999px", background: "#334155", overflow: "hidden" }}>
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: "999px",
                    background: "linear-gradient(90deg, #10b981 0%, #38bdf8 50%, #f59e0b 100%)",
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
                background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: "14px",
                padding: "14px 18px",
                display: "flex",
                alignItems: "center",
                gap: "14px",
              }}
            >
              <div style={{ fontSize: "28px" }}>🤖</div>
              <div style={{ fontSize: "13px", color: "#e2e8f0", lineHeight: 1.5 }}>
                <strong style={{ color: "#38bdf8" }}>Trợ Lý AI Đồng Hành (Antigravity Partner): </strong>
                "{gameState.ai_companion_cheer}"
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
                    background: "#fff",
                    borderRadius: "18px",
                    border: isCompleted
                      ? "2px solid #10b981"
                      : isInProgress
                      ? "2px solid #0f766e"
                      : "1px solid #cbd5e1",
                    padding: "24px 28px",
                    boxShadow: isInProgress
                      ? "0 8px 24px rgba(15,118,110,0.12)"
                      : "0 4px 12px rgba(0,0,0,0.03)",
                    opacity: isPending ? 0.75 : 1,
                    display: "flex",
                    flexDirection: "column",
                    gap: "14px",
                  }}
                >
                  {/* Quest Header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div
                        style={{
                          width: "36px",
                          height: "36px",
                          borderRadius: "10px",
                          background: isCompleted ? "#10b981" : isInProgress ? "#0f766e" : "#94a3b8",
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: 900,
                          fontSize: "14px",
                        }}
                      >
                        {isCompleted ? "✓" : quest.quest_id}
                      </div>

                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontSize: "11px", fontWeight: 800, padding: "2px 8px", borderRadius: "6px", background: isCompleted ? "#dcfce7" : isInProgress ? "#e0f2fe" : "#f1f5f9", color: isCompleted ? "#166534" : isInProgress ? "#0369a1" : "#64748b" }}>
                            Ải {quest.quest_id} • {isCompleted ? "ĐÃ HOÀN THÀNH" : isInProgress ? "ĐANG THỰC HIỆN" : "CHƯA MỞ KHÓA"}
                          </span>
                          <span style={{ fontSize: "11px", fontWeight: 800, color: "#d97706" }}>+{quest.exp_reward} EXP</span>
                        </div>
                        <h3 style={{ margin: "4px 0 0", fontSize: "17px", color: "#0f172a", fontWeight: 800 }}>
                          {quest.title}
                        </h3>
                      </div>
                    </div>

                    {/* Action Button */}
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      {isCompleted ? (
                        <div style={{ fontSize: "12px", color: "#166534", fontWeight: 800, background: "#dcfce7", padding: "6px 12px", borderRadius: "8px" }}>
                          ✓ Đạt danh hiệu: {quest.level_title}
                        </div>
                      ) : (
                        <button
                          onClick={() => handleCompleteQuest(quest.quest_id)}
                          style={{
                            padding: "10px 18px",
                            borderRadius: "10px",
                            border: "none",
                            background: isInProgress ? "#0f766e" : "#64748b",
                            color: "#fff",
                            fontWeight: 800,
                            fontSize: "13px",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            boxShadow: isInProgress ? "0 4px 12px rgba(15,118,110,0.25)" : "none",
                          }}
                        >
                          <span>⚔️</span>
                          <span>Hoàn Thành Ải Này (+500 EXP)</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Quest Description */}
                  <div style={{ fontSize: "13px", color: "#334155", lineHeight: 1.5, background: "#f8fafc", padding: "12px 16px", borderRadius: "12px", border: "1px solid #f1f5f9" }}>
                    <strong>🎯 Nhiệm vụ chính:</strong> {quest.description}
                  </div>

                  {/* AI Tip & Secret Cheatsheet */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div style={{ background: "#f0fdfa", border: "1px solid #99f6e4", padding: "12px 16px", borderRadius: "12px", fontSize: "12px", color: "#0f766e" }}>
                      <strong>🤖 Lời khuyên của Trợ lý AI:</strong> {quest.ai_companion_tip}
                    </div>

                    <div style={{ background: "#fffbeb", border: "1px solid #fde68a", padding: "12px 16px", borderRadius: "12px", fontSize: "12px", color: "#854d0e" }}>
                      <strong>🛡️ Bí kíp bỏ túi:</strong> {quest.secret_cheatsheet}
                    </div>
                  </div>

                  {/* Personal Note Box */}
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input
                      type="text"
                      placeholder="Ghi chú tác chiến của bạn cho ải này (vd: Ngày gửi mẫu, số tracking bưu điện, mã test report, lưu ý riêng)..."
                      value={activeQuestNote[quest.quest_id] !== undefined ? activeQuestNote[quest.quest_id] : (quest.personal_note || "")}
                      onChange={(e) => setActiveQuestNote({ ...activeQuestNote, [quest.quest_id]: e.target.value })}
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        borderRadius: "8px",
                        border: "1px solid #cbd5e1",
                        fontSize: "12px",
                      }}
                    />
                    <button
                      onClick={() => handleSaveNote(quest.quest_id)}
                      style={{
                        padding: "8px 14px",
                        borderRadius: "8px",
                        border: "1px solid #0f766e",
                        background: "#f0fdfa",
                        color: "#0f766e",
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
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Sub-navigation of Case Studies */}
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {playbooks.map((pb) => (
              <button
                key={pb.id}
                onClick={() => setSelectedPlaybookId(pb.id)}
                style={{
                  padding: "10px 18px",
                  borderRadius: "12px",
                  border: selectedPlaybookId === pb.id ? "2px solid #0f766e" : "1px solid #cbd5e1",
                  background: selectedPlaybookId === pb.id ? "#f0fdfa" : "#fff",
                  color: selectedPlaybookId === pb.id ? "#0f766e" : "#334155",
                  fontWeight: selectedPlaybookId === pb.id ? 800 : 600,
                  fontSize: "13px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  boxShadow: selectedPlaybookId === pb.id ? "0 4px 12px rgba(15,118,110,0.15)" : "none",
                }}
              >
                <span>{pb.id.includes("rockchip") ? "⭐" : pb.id.includes("display") ? "🖥️" : pb.id.includes("gateway") ? "📡" : "💧"}</span>
                <span>{pb.title.split("(")[0]}</span>
                <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: selectedPlaybookId === pb.id ? "#0f766e" : "#e2e8f0", color: selectedPlaybookId === pb.id ? "#fff" : "#475569", fontWeight: 800 }}>
                  {pb.badge}
          </span>
        </button>

            ))}
          </div>

          {currentPlaybook && (
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* Playbook Header Box */}
              <div style={{ background: "#fff", padding: "28px 32px", borderRadius: "20px", border: "1px solid #e2e8f0", boxShadow: "0 6px 20px rgba(0,0,0,0.04)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap", marginBottom: "14px" }}>
                  <div>
                    <span style={{ fontSize: "11px", fontWeight: 800, background: "#fee2e2", color: "#b91c1c", padding: "4px 10px", borderRadius: "999px", textTransform: "uppercase" }}>
                      {currentPlaybook.badge}
                    </span>
                    <h2 style={{ fontFamily: "Georgia, serif", fontSize: "22px", color: "#0f172a", margin: "10px 0 4px" }}>
                      {currentPlaybook.title}
                    </h2>
                    <div style={{ fontSize: "14px", color: "#64748b" }}>{currentPlaybook.subtitle}</div>
                  </div>

                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    <button
                      onClick={copyZaloMessage}
                      style={{
                        padding: "12px 18px",
                        borderRadius: "12px",
                        border: "1px solid #0f766e",
                        background: "#f0fdfa",
                        color: "#0f766e",
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
                        padding: "12px 20px",
                        borderRadius: "12px",
                        border: "none",
                        background: "#0f766e",
                        color: "#fff",
                        fontWeight: 800,
                        fontSize: "13px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        boxShadow: "0 4px 12px rgba(15,118,110,0.25)",
                      }}
                    >
                      <span>📝</span>
                      <span>Tạo Bản Công Bố CR</span>
                    </button>
                  </div>
                </div>

                {/* Section 1: HS Codes & Taxes Table */}
                <h3 style={{ fontSize: "16px", color: "#0f766e", margin: "20px 0 10px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>🏷️</span> 1. Mã HS Code & Thuế Suất Nhập Khẩu
                </h3>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc", textAlign: "left", borderBottom: "2px solid #e2e8f0" }}>
                        <th style={{ padding: "10px 14px" }}>Mã HS Code</th>
                        <th style={{ padding: "10px 14px" }}>Mô tả hàng hóa</th>
                        <th style={{ padding: "10px 14px" }}>Thuế NK ưu đãi (MFN)</th>
                        <th style={{ padding: "10px 14px" }}>Thuế Form E (Trung Quốc)</th>
                        <th style={{ padding: "10px 14px" }}>Thuế VAT</th>
                        <th style={{ padding: "10px 14px" }}>Đánh giá & Lưu ý</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentPlaybook.hs_codes.map((h) => (
                        <tr key={h.code} style={{ borderBottom: "1px solid #f1f5f9", background: h.recommended ? "#f0fdfa" : "#fff" }}>
                          <td style={{ padding: "12px 14px", fontFamily: "var(--font-mono)", fontWeight: 800, color: "#0f766e" }}>{h.code}</td>
                          <td style={{ padding: "12px 14px", color: "#334155" }}>{h.description}</td>
                          <td style={{ padding: "12px 14px", fontWeight: 700 }}>{h.import_tax_mfn}</td>
                          <td style={{ padding: "12px 14px", fontWeight: 700, color: "#166534" }}>{h.import_tax_form_e}</td>
                          <td style={{ padding: "12px 14px", fontWeight: 700 }}>{h.vat_rate}</td>
                          <td style={{ padding: "12px 14px" }}>
                            {h.recommended ? (
                              <span style={{ background: "#dcfce7", color: "#166534", padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 800 }}>
                                ✓ Khuyên dùng (Miễn KTCL BTTTT)
                              </span>
                            ) : (
                              <span style={{ color: "#94a3b8", fontSize: "11px" }}>Tham khảo</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Section 2: Required Standards Cards */}
                <h3 style={{ fontSize: "16px", color: "#0f766e", margin: "24px 0 10px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>📜</span> 2. Danh Mục Các Quy Chuẩn Kỹ Thuật (QCVN BTTTT) Bắt Buộc
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "14px" }}>
                  {currentPlaybook.required_standards.map((std) => (
                    <div key={std.code} style={{ background: "#f8fafc", padding: "16px", borderRadius: "14px", border: "1px solid #e2e8f0" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 900, color: "#0f766e", fontSize: "13px" }}>
                          🏷️ {std.code}
                        </span>
                        <span style={{ fontSize: "11px", fontWeight: 800, padding: "2px 7px", borderRadius: "6px", background: std.procedure.includes("Chứng nhận") ? "#fee2e2" : "#fef3c7", color: std.procedure.includes("Chứng nhận") ? "#991b1b" : "#92400e" }}>
                          {std.procedure}
                        </span>
                      </div>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "#1e293b", marginBottom: "6px" }}>{std.name}</div>
                      <div style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.4 }}><strong>Chỉ tiêu thử nghiệm:</strong> {std.test_scope}</div>
                    </div>
                  ))}
                </div>

                {/* Section 3: 6-Step Workflow */}
                {currentPlaybook.six_step_workflow && (
                  <>
                    <h3 style={{ fontSize: "16px", color: "#0f766e", margin: "28px 0 12px", display: "flex", alignItems: "center", gap: "6px" }}>
                      <span>🔄</span> 3. Sơ Đồ Quy Trình Từng Bước Thực Hiện
                    </h3>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "14px" }}>
                      {currentPlaybook.six_step_workflow.map((st) => (
                        <div key={st.step} style={{ background: "#fff", border: "1px solid #cbd5e1", borderRadius: "14px", padding: "16px", position: "relative", boxShadow: "0 2px 8px rgba(0,0,0,0.02)" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                            <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: "#0f766e", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "12px" }}>
                              {st.step}
                            </div>
                            <strong style={{ fontSize: "13px", color: "#0f172a" }}>{st.title}</strong>
                          </div>
                          <div style={{ fontSize: "12px", color: "#475569", lineHeight: 1.5 }}>{st.description}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Section 4: Cost Breakdown */}
                <h3 style={{ fontSize: "16px", color: "#0f766e", margin: "28px 0 12px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>💰</span> 4. Bảng Dự Toán Chi Phí & Lệ Phí Nhà Nước
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px" }}>
                  {/* State Fees */}
                  <div style={{ background: "#f0fdfa", padding: "18px", borderRadius: "14px", border: "1px solid #99f6e4" }}>
                    <h4 style={{ margin: "0 0 10px", fontSize: "14px", color: "#0f766e" }}>🏛️ Lệ Phí Nhà Nước (Thông tư 285/2016/TT-BTC)</h4>
                    {currentPlaybook.cost_estimate.state_fees?.map((fee, idx) => (
                      <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", padding: "6px 0", borderBottom: "1px dashed #99f6e4" }}>
                        <span>{fee.name}</span>
                        <strong style={{ color: "#0f766e" }}>{fee.cost}</strong>
                      </div>
                    ))}
                    <div style={{ marginTop: "10px", fontSize: "12px", color: "#047857", fontWeight: 700 }}>
                      ✓ Tổng lệ phí nhà nước: <strong>300.000 ₫</strong>
                    </div>
                  </div>

                  {/* Lab Fees */}
                  <div style={{ background: "#fff7ed", padding: "18px", borderRadius: "14px", border: "1px solid #fed7aa" }}>
                    <h4 style={{ margin: "0 0 10px", fontSize: "14px", color: "#c2410c" }}>🧪 Chi Phí Đo Kiểm Phòng Lab Chỉ Định</h4>
                    {currentPlaybook.cost_estimate.lab_testing_fees?.map((lab, idx) => (
                      <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", padding: "6px 0", borderBottom: "1px dashed #fed7aa" }}>
                        <span>{lab.scope}</span>
                        <strong style={{ color: "#ea580c" }}>{lab.cost}</strong>
                      </div>
                    ))}
                    <div style={{ marginTop: "10px", fontSize: "12px", color: "#c2410c", fontWeight: 800 }}>
                      Tổng đo kiểm 1 model: <strong>{currentPlaybook.cost_estimate.total_lab_cost_range}</strong>
                    </div>
                  </div>
                </div>

                {/* Section 5: Practical Tips */}
                <h3 style={{ fontSize: "16px", color: "#0f766e", margin: "28px 0 10px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>💡</span> 5. Lời Khuyên & Kinh Nghiệm Thực Chiến Tiết Kiệm Chi Phí
                </h3>
                <div style={{ background: "#f8fafc", padding: "16px 20px", borderRadius: "14px", border: "1px solid #e2e8f0" }}>
                  <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "#334155", lineHeight: 1.6 }}>
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
          <div style={{ background: "#fff", padding: "28px 32px", borderRadius: "20px", border: "1px solid #e2e8f0" }}>
            <span style={{ fontSize: "11px", fontWeight: 800, background: "#fef3c7", color: "#92400e", padding: "4px 10px", borderRadius: "999px", textTransform: "uppercase" }}>
              Cẩm Nang Kỹ Thuật Phần Cứng
            </span>
            <h2 style={{ fontFamily: "Georgia, serif", fontSize: "22px", color: "#0f172a", margin: "10px 0 6px" }}>
              Bí Kíp Thiết Kế Phần Cứng & Kinh Nghiệm Đo Đạt EMC 100% Đậu Trong Lần Thử Đầu Tiên
            </h2>
            <p style={{ fontSize: "14px", color: "#64748b", margin: "0 0 20px", lineHeight: 1.5 }}>
              Hơn 70% thiết bị rớt kiểm định BTTTT là do không đạt Phát xạ bức xạ (Radiated Emissions) hoặc bị treo/reset khi bắn tĩnh điện (ESD). Dưới đây là các giải pháp chống nhiễu phần cứng cho bo mạch Rockchip.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px", marginBottom: "24px" }}>
              {/* Card 1: Radiated Emissions */}
              <div style={{ background: "#f8fafc", padding: "20px", borderRadius: "16px", border: "1px solid #e2e8f0" }}>
                <h3 style={{ fontSize: "16px", color: "#0f766e", margin: "0 0 10px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>📡</span> 1. Vượt Qua Phát Xạ Bức Xạ (RE: 30MHz - 6GHz)
                </h3>
                <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "#334155", lineHeight: 1.6 }}>
                  <li><strong>Lồng Faraday vỏ nhôm:</strong> Các mặt ghép vỏ nhôm phải tiếp xúc điện trực tiếp, không bị lớp sơn tĩnh điện cách điện ở chân ốc.</li>
                  <li><strong>Kẹp Lõi Ferit (Ferrite Bead):</strong> Luôn kẹp 1 - 2 cục lọc Ferit ở sát đầu dây nguồn DC và dây mạng để triệt tiêu bức xạ ngoài ý muốn.</li>
                  <li><strong>Tuyệt chiêu Firmware:</strong> Bật <em>Spread Spectrum Clocking (SSC)</em> trong Device Tree Rockchip (rk3568.dtsi) để giảm ngay 3 - 6 dB năng lượng đỉnh sóng hài!</li>
                </ul>
              </div>

              {/* Card 2: ESD Protection */}
              <div style={{ background: "#f8fafc", padding: "20px", borderRadius: "16px", border: "1px solid #e2e8f0" }}>
                <h3 style={{ fontSize: "16px", color: "#0f766e", margin: "0 0 10px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>⚡</span> 2. Vượt Qua Phóng Tĩnh Điện (ESD ±4kV / ±8kV)
                </h3>
                <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "#334155", lineHeight: 1.6 }}>
                  <li><strong>Tách biệt Mass Vỏ & Mass Mạch:</strong> Vỏ nhôm nối Chassis Ground (PE). Digital GND nối với vỏ qua cầu nối: Tụ cao áp 1nF/2kV song song Điện trở 1MΩ.</li>
                  <li><strong>Diode TVS bảo vệ cổng:</strong> Gắn chip TVS (USBLC6-2SC6, SM712) trên tất cả các chân USB D+/D-, RS485 A/B, Ethernet.</li>
                  <li><strong>Chân ren Anten SMA:</strong> Bắt ốc siết chặt tiếp xúc kim loại 100% vào vỏ nhôm để tĩnh điện thoát ngay ra ngoài đất.</li>
                </ul>
              </div>
            </div>

            {/* Rescue Toolbag */}
            <div style={{ background: "#fff7ed", padding: "20px 24px", borderRadius: "16px", border: "1px solid #fed7aa" }}>
              <h3 style={{ fontSize: "15px", color: "#c2410c", margin: "0 0 10px", display: "flex", alignItems: "center", gap: "6px" }}>
                <span>🧰</span> Bộ Đồ Nghề "Cứu Hộ Thần Tốc" Mang Theo Vào Phòng Lab
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px", fontSize: "13px", color: "#7c2d12" }}>
                <div style={{ background: "#fff", padding: "10px 14px", borderRadius: "10px", border: "1px solid #fed7aa" }}>
                  <strong>1. Túi Lõi Ferit kẹp dây:</strong> Kích cỡ 3.5mm, 5mm, 7mm kẹp ngay khi bức xạ vượt vạch đỏ.
                </div>
                <div style={{ background: "#fff", padding: "10px 14px", borderRadius: "10px", border: "1px solid #fed7aa" }}>
                  <strong>2. Băng keo đồng dẫn điện:</strong> Dán bọc các khe hở tiếp xúc nắp vỏ nhôm nếu bị rò sóng.
                </div>
                <div style={{ background: "#fff", padding: "10px 14px", borderRadius: "10px", border: "1px solid #fed7aa" }}>
                  <strong>3. 02 Cục Nguồn Adapter xịn:</strong> Loại đạt chuẩn CE/FCC công nghiệp để tránh nhiễu nguồn trôi nổi.
                </div>
                <div style={{ background: "#fff", padding: "10px 14px", borderRadius: "10px", border: "1px solid #fed7aa" }}>
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
          <div style={{ background: "#f0fdfa", padding: "20px 24px", borderRadius: "16px", border: "1px solid #99f6e4", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
            <div>
              <h3 style={{ margin: "0 0 4px", fontSize: "16px", color: "#0f766e" }}>📋 Mẫu Tin Nhắn Soạn Sẵn Gửi Zalo / Email Cho Phòng Lab</h3>
              <p style={{ margin: 0, fontSize: "13px", color: "#334155" }}>Bấm nút sao chép để paste ngay vào Zalo hoặc Email gửi cho chuyên viên phòng Lab.</p>
            </div>
            <button
              onClick={copyZaloMessage}
              style={{
                padding: "10px 18px",
                borderRadius: "10px",
                border: "none",
                background: "#0f766e",
                color: "#fff",
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

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: "18px" }}>
            {/* Lab 1: VNTA Lab */}
            <div style={{ background: "#fff", borderRadius: "18px", border: "2px solid #0f766e", padding: "20px 24px", display: "flex", flexDirection: "column", gap: "12px", boxShadow: "0 4px 16px rgba(15,118,110,0.08)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                <h3 style={{ margin: 0, fontSize: "16px", color: "#0f766e" }}>Trung tâm Đo lường Chất lượng Viễn thông (Cục Viễn thông — VNTA Lab)</h3>
                <span style={{ fontSize: "11px", fontWeight: 800, background: "#dcfce7", color: "#166534", padding: "3px 8px", borderRadius: "6px" }}>
                  🌟 Chỉ định Số 1 BTTTT
                </span>
              </div>

              <div style={{ fontSize: "13px", color: "#334155" }}>
                📍 <strong>TP.HCM:</strong> Số 60 Tân Canh, Phường 1, Quận Tân Bình, TP.HCM<br />
                📍 <strong>Hà Nội:</strong> Tòa nhà VNTA, Đường Dương Đình Nghệ, Cầu Giấy, Hà Nội
              </div>

              <div style={{ background: "#f8fafc", padding: "12px", borderRadius: "10px", fontSize: "13px" }}>
                📞 <strong>Hotline Tiếp Nhận TP.HCM:</strong> <a href="tel:02839919191" style={{ color: "#0f766e", fontWeight: 800 }}>028.39919191</a> / <a href="tel:02437820990" style={{ color: "#0f766e", fontWeight: 800 }}>024.37820990</a><br />
                ✉️ <strong>Email:</strong> <a href="mailto:testing@vnta.gov.vn">testing@vnta.gov.vn</a>
              </div>

              <div style={{ fontSize: "12px", color: "#475569" }}>
                <strong>Phạm vi đo kiểm:</strong> QCVN 54 (Wi-Fi 2.4G/BT), QCVN 65 (Wi-Fi 5G), QCVN 117 (4G LTE), QCVN 18 (EMC), QCVN 132 (An toàn).
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", borderTop: "1px solid #f1f5f9", paddingTop: "10px" }}>
                <span>⏱️ Thời gian: <strong>5 - 7 ngày</strong></span>
                <span style={{ color: "#ea580c" }}>💰 Trọn gói 1 model: <strong>~15 - 22 Triệu ₫</strong></span>
              </div>
            </div>

            {/* Lab 2: Quatest 3 */}
            <div style={{ background: "#fff", borderRadius: "18px", border: "1px solid #e2e8f0", padding: "20px 24px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                <h3 style={{ margin: 0, fontSize: "16px", color: "#0f172a" }}>Trung tâm Kỹ thuật Tiêu chuẩn Đo lường Chất lượng 3 (QUATEST 3)</h3>
                <span style={{ fontSize: "11px", fontWeight: 800, background: "#eff6ff", color: "#1d4ed8", padding: "3px 8px", borderRadius: "6px" }}>
                  Zalo CSKH Nhanh
                </span>
              </div>

              <div style={{ fontSize: "13px", color: "#334155" }}>
                📍 <strong>Trụ sở:</strong> 49 Pasteur, Phường Nguyễn Thái Bình, Quận 1, TP.HCM<br />
                📍 <strong>Khu Thí nghiệm:</strong> KCN Biên Hòa 1, Đồng Nai
              </div>

              <div style={{ background: "#f8fafc", padding: "12px", borderRadius: "10px", fontSize: "13px" }}>
                💬 <strong>Zalo CSKH Quatest 3:</strong> <strong style={{ color: "#0f766e" }}>0903.003.528</strong> hoặc <strong style={{ color: "#0f766e" }}>0908.574.629</strong><br />
                📞 <strong>Tổng đài:</strong> 028.38294274 • ✉️ <strong>Email:</strong> info@quatest3.com.vn
              </div>

              <div style={{ fontSize: "12px", color: "#475569" }}>
                <strong>Phạm vi đo kiểm:</strong> Đo kiểm vô tuyến, EMC, an toàn điện, kiểm định môi trường.
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", borderTop: "1px solid #f1f5f9", paddingTop: "10px" }}>
                <span>⏱️ Thời gian: <strong>5 - 8 ngày</strong></span>
                <span style={{ color: "#ea580c" }}>💰 Trọn gói 1 model: <strong>~16 - 24 Triệu ₫</strong></span>
              </div>
            </div>

            {/* Consulting: ExtendMax */}
            <div style={{ background: "#fff", borderRadius: "18px", border: "1px solid #e2e8f0", padding: "20px 24px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                <h3 style={{ margin: 0, fontSize: "16px", color: "#0f172a" }}>ExtendMax Vietnam (Tư Vấn Hợp Quy Trọn Gói)</h3>
                <span style={{ fontSize: "11px", fontWeight: 800, background: "#fef3c7", color: "#92400e", padding: "3px 8px", borderRadius: "6px" }}>
                  Ủy Thác A-Z
                </span>
              </div>

              <div style={{ fontSize: "13px", color: "#334155" }}>
                📍 Tòa nhà CIC, Phố Nguyễn Thị Duệ, Cầu Giấy, Hà Nội
              </div>

              <div style={{ background: "#f8fafc", padding: "12px", borderRadius: "10px", fontSize: "13px" }}>
                💬 <strong>Hotline / Zalo Trực Tiếp:</strong> <strong style={{ color: "#ea580c" }}>0915.837.255</strong> (hoặc 024.6666.3066)<br />
                ✉️ <strong>Email:</strong> consultant@extendmax.vn
              </div>

              <div style={{ fontSize: "12px", color: "#475569" }}>
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
          <div style={{ background: "#fff", padding: "20px 24px", borderRadius: "16px", border: "1px solid #e2e8f0", boxShadow: "0 4px 14px rgba(0,0,0,0.04)" }}>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "14px" }}>
              <div style={{ flex: "1 1 320px", position: "relative" }}>
                <input
                  type="text"
                  placeholder="Gõ mã QCVN (vd: 117, 54, 101, TT10), tên quy chuẩn hoặc tên thiết bị (Màn hình, IoT Gateway, Pin, Công tơ)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  style={{
                    width: "100%",
                    padding: "12px 16px 12px 42px",
                    borderRadius: "12px",
                    border: "1px solid #cbd5e1",
                    fontSize: "14px",
                    outline: "none",
                  }}
                />
                <span style={{ position: "absolute", left: "14px", top: "12px", fontSize: "16px", color: "#94a3b8" }}>🔍</span>
              </div>

              <button
                onClick={handleSearch}
                style={{
                  padding: "12px 24px",
                  borderRadius: "12px",
                  border: "none",
                  background: "#0f766e",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: "14px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  boxShadow: "0 4px 12px rgba(15,118,110,0.25)",
                }}
              >
                <span>Tìm Kiếm</span>
              </button>
            </div>

            {/* Quick Filters */}
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center", paddingTop: "12px", borderTop: "1px solid #f1f5f9" }}>
              <span style={{ fontSize: "12px", fontWeight: 800, color: "#64748b" }}>Bộ Quản Lý:</span>
              {[
                { label: "Tất cả", val: "" },
                { label: "Bộ TT&TT (BTTTT)", val: "BTTTT" },
                { label: "Bộ KH&CN (BKHCN)", val: "BKHCN" },
                { label: "Bộ TN&MT (BTNMT)", val: "BTNMT" },
                { label: "Bộ Công Thương (BCT)", val: "BCT" },
              ].map((m) => (
                <button
                  key={m.val}
                  onClick={() => { setSelectedMinistry(m.val); }}
                  style={{
                    padding: "6px 14px",
                    borderRadius: "8px",
                    border: "1px solid",
                    borderColor: selectedMinistry === m.val ? "#0f766e" : "#e2e8f0",
                    background: selectedMinistry === m.val ? "#f0fdfa" : "#fff",
                    color: selectedMinistry === m.val ? "#0f766e" : "#475569",
                    fontWeight: selectedMinistry === m.val ? 800 : 600,
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  {m.label}
                </button>
              ))}

              <button
                onClick={() => { setSelectedMinistry(""); setSelectedCategory(""); setSelectedProcedure(""); setSearchQuery(""); }}
                style={{ marginLeft: "auto", border: "none", background: "transparent", color: "#dc2626", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}
              >
                Đặt lại bộ lọc
              </button>
            </div>
          </div>

          {/* Standards Cards Grid */}
          {loading ? (
            <div style={{ textAlign: "center", padding: "60px", color: "#64748b" }}>Đang tải dữ liệu quy chuẩn...</div>
          ) : standardsList.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px", background: "#fff", borderRadius: "16px", border: "1px solid #e2e8f0", color: "#64748b" }}>
              Không tìm thấy quy chuẩn nào phù hợp với từ khóa "{searchQuery}"
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: "18px" }}>
              {standardsList.map((std) => {
                const badge = getMinistryBadge(std.ministry);
                return (
                  <div
                    key={std.code}
                    style={{
                      background: "#fff",
                      borderRadius: "18px",
                      border: "1px solid #e2e8f0",
                      padding: "20px 24px",
                      boxShadow: "0 4px 16px rgba(0,0,0,0.03)",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      gap: "14px",
                    }}
                  >
                    <div>
                      {/* Top Header of Card */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", marginBottom: "10px" }}>
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: "13px",
                            fontWeight: 900,
                            color: "#0f766e",
                            background: "#e6fffa",
                            padding: "4px 10px",
                            borderRadius: "8px",
                            border: "1px solid #99f6e4",
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
                          color: "#0f172a",
                          lineHeight: 1.4,
                          cursor: "pointer",
                        }}
                      >
                        {std.name} ↗
                      </h3>

                      <div style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.5, marginBottom: "8px" }}>
                        📜 Văn bản: <strong style={{ color: "#334155" }}>{std.circular}</strong>
                      </div>

                      <div style={{ fontSize: "12px", color: "#475569", background: "#f8fafc", padding: "10px 12px", borderRadius: "10px", border: "1px solid #f1f5f9", marginBottom: "8px" }}>
                        <strong>Thiết bị áp dụng:</strong> {std.target_equipment}
                      </div>

                      {/* Applicable HS codes */}
                      {std.applicable_hs_codes && std.applicable_hs_codes.length > 0 && (
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center", fontSize: "11px" }}>
                          <span style={{ color: "#94a3b8", fontWeight: 700 }}>Mã HS Code:</span>
                          {std.applicable_hs_codes.map((hs) => (
                            <span key={hs} style={{ background: "#fef3c7", color: "#92400e", fontWeight: 800, padding: "2px 6px", borderRadius: "4px", fontFamily: "var(--font-mono)" }}>
                              {hs}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", borderTop: "1px solid #f1f5f9", paddingTop: "12px" }}>
                      <button
                        onClick={() => handleOpenDetail(std)}
                        style={{
                          padding: "8px 14px",
                          borderRadius: "10px",
                          border: "none",
                          background: "#0f766e",
                          color: "#fff",
                          fontWeight: 700,
                          fontSize: "12px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "5px",
                        }}
                      >
                        <span>👁️</span>
                        <span>Xem Chi Tiết</span>
                      </button>

                      <a
                        href={api.standards.getStandardPdfUrl(std.code)}
                        download
                        style={{
                          padding: "8px 14px",
                          borderRadius: "10px",
                          border: "1px solid #0f766e",
                          background: "#f0fdfa",
                          color: "#0f766e",
                          fontWeight: 700,
                          fontSize: "12px",
                          textDecoration: "none",
                          display: "flex",
                          alignItems: "center",
                          gap: "5px",
                        }}
                      >
                        <span>📄</span>
                        <span>Tải Toàn Văn PDF</span>
                      </a>
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
          <div style={{ background: "#fff", padding: "24px", borderRadius: "16px", border: "1px solid #e2e8f0" }}>
            <h2 style={{ fontFamily: "Georgia, serif", fontSize: "20px", color: "#0f766e", margin: "0 0 8px" }}>
              Tra Cứu Thủ Tục Kiểm Tra Chuyên Ngành Theo Mã HS Code
            </h2>
            <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 16px" }}>
              Nhập mã HS Code của linh kiện / thiết bị nhập khẩu để kiểm tra diện quản lý chuyên ngành của Bộ TT&TT, Bộ KH&CN, Bộ TN&MT.
            </p>

            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
              <input
                type="text"
                placeholder="Nhập mã HS Code (vd: 8473.30.10, 8471.41.90, 8517.62.59, 8507.60.90)..."
                value={hsCodeInput}
                onChange={(e) => setHsCodeInput(e.target.value)}
                style={{ flex: "1 1 300px", padding: "12px 16px", borderRadius: "12px", border: "1px solid #cbd5e1", fontSize: "14px", fontFamily: "var(--font-mono)" }}
              />
              <button
                onClick={() => handleHsLookup()}
                style={{ padding: "12px 24px", borderRadius: "12px", border: "none", background: "#0f766e", color: "#fff", fontWeight: 800, fontSize: "14px", cursor: "pointer" }}
              >
                Tra Cứu Ngay
              </button>
            </div>

            {/* Quick Sample HS Buttons */}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: "12px", color: "#64748b", fontWeight: 700 }}>Gợi ý mã phổ biến:</span>
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
                  onClick={() => { setHsCodeInput(sample.code); handleHsLookup(sample.code); }}
                  style={{ padding: "4px 10px", borderRadius: "6px", border: "1px solid #cbd5e1", background: "#f8fafc", fontSize: "12px", cursor: "pointer", fontFamily: "var(--font-mono)" }}
                >
                  {sample.label}
                </button>
              ))}
            </div>
          </div>

          {/* HS Lookup Result Card */}
          {hsResult && (
            <div style={{ background: "#fff", borderRadius: "18px", border: "1px solid #bbf7d0", padding: "24px", boxShadow: "0 6px 20px rgba(22,101,52,0.06)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
                <div>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "14px", fontWeight: 900, background: "#dcfce7", color: "#166534", padding: "4px 10px", borderRadius: "6px" }}>
                    Mã HS: {hsResult.hs_code}
                  </span>
                  <h3 style={{ margin: "8px 0 0", fontSize: "18px", color: "#0f172a" }}>{hsResult.hs_description}</h3>
                </div>

                <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", padding: "8px 14px", borderRadius: "10px", fontSize: "12px", color: "#1d4ed8" }}>
                  <strong>Cơ quan quản lý:</strong> {hsResult.customs_inspection_agency}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "14px", marginBottom: "16px" }}>
                <div style={{ background: "#f8fafc", padding: "14px", borderRadius: "12px", border: "1px solid #f1f5f9" }}>
                  <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 700 }}>Loại hình kiểm tra:</div>
                  <div style={{ fontSize: "14px", fontWeight: 800, color: "#0f766e", marginTop: "2px" }}>{hsResult.inspection_type}</div>
                </div>

                <div style={{ background: "#f8fafc", padding: "14px", borderRadius: "12px", border: "1px solid #f1f5f9" }}>
                  <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 700 }}>Thủ tục bắt buộc:</div>
                  <div style={{ fontSize: "14px", fontWeight: 800, color: "#ea580c", marginTop: "2px" }}>{hsResult.required_procedure}</div>
                </div>
              </div>

              {/* Applicable Standards Tags */}
              <div style={{ marginBottom: "16px" }}>
                <strong style={{ fontSize: "13px", color: "#334155" }}>Quy Chuẩn Kỹ Thuật Bắt Buộc Áp Dụng:</strong>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "6px" }}>
                  {hsResult.applicable_standards.map((stdCode) => (
                    <span
                      key={stdCode}
                      onClick={() => {
                        api.standards.search({ q: stdCode }).then((r) => { if (r.length > 0) handleOpenDetail(r[0]); });
                      }}
                      style={{ padding: "6px 12px", borderRadius: "8px", background: "#f0fdfa", color: "#0f766e", border: "1px solid #99f6e4", fontWeight: 800, fontSize: "12px", cursor: "pointer" }}
                    >
                      📜 {stdCode} ↗
                    </span>
                  ))}
                </div>
              </div>

              {/* Customs Notes */}
              <div style={{ background: "#fffbeb", border: "1px solid #fde68a", padding: "14px 18px", borderRadius: "12px", fontSize: "13px", color: "#854d0e", lineHeight: 1.5, marginBottom: "12px" }}>
                <strong>📌 Lưu ý Hải quan & Giải phóng hàng:</strong> {hsResult.customs_notes}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* TAB: 📝 SINH BẢN CÔNG BỐ HỢP QUY (CR)                                     */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "cr_generator" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          {/* Form Configuration */}
          <div style={{ background: "#fff", padding: "24px", borderRadius: "18px", border: "1px solid #e2e8f0" }}>
            <h2 style={{ fontFamily: "Georgia, serif", fontSize: "18px", color: "#0f766e", margin: "0 0 16px" }}>
              Cấu Hình Bản Công Bố Hợp Quy (Mẫu 02 - TT 28/2012/TT-BKHCN)
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 700, color: "#475569" }}>Tên Doanh Nghiệp</label>
                <input
                  type="text"
                  value={crForm.company_name}
                  onChange={(e) => setCrForm({ ...crForm, company_name: e.target.value })}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "13px" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "#475569" }}>Mã Số Thuế (MST)</label>
                  <input
                    type="text"
                    value={crForm.tax_code}
                    onChange={(e) => setCrForm({ ...crForm, tax_code: e.target.value })}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "13px", fontFamily: "var(--font-mono)" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "#475569" }}>Người Đại Diện</label>
                  <input
                    type="text"
                    value={crForm.representative_name}
                    onChange={(e) => setCrForm({ ...crForm, representative_name: e.target.value })}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "13px" }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "#475569" }}>Tên Sản Phẩm / Thiết Bị</label>
                  <input
                    type="text"
                    value={crForm.product_name}
                    onChange={(e) => setCrForm({ ...crForm, product_name: e.target.value })}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "13px" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "#475569" }}>Model / Ký Hiệu</label>
                  <input
                    type="text"
                    value={crForm.model_name}
                    onChange={(e) => setCrForm({ ...crForm, model_name: e.target.value })}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "13px", fontFamily: "var(--font-mono)" }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 700, color: "#475569" }}>Quy Chuẩn Kỹ Thuật Áp Dụng (Phân cách bằng dấu phẩy)</label>
                <input
                  type="text"
                  value={crForm.applicable_standards.join(", ")}
                  onChange={(e) => setCrForm({ ...crForm, applicable_standards: e.target.value.split(",").map((s) => s.trim()) })}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "13px", fontFamily: "var(--font-mono)" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "#475569" }}>Số Phiếu Kết Quả Thử Nghiệm</label>
                  <input
                    type="text"
                    value={crForm.test_report_number}
                    onChange={(e) => setCrForm({ ...crForm, test_report_number: e.target.value })}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "13px" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "#475569" }}>Phòng Lab Thử Nghiệm</label>
                  <input
                    type="text"
                    value={crForm.test_lab_name}
                    onChange={(e) => setCrForm({ ...crForm, test_lab_name: e.target.value })}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "13px" }}
                  />
                </div>
              </div>

              {/* Action Export Buttons */}
              <div style={{ display: "flex", gap: "10px", marginTop: "14px" }}>
                <button
                  onClick={handleDownloadCrPdf}
                  disabled={generatingPdf}
                  style={{
                    flex: 1,
                    padding: "12px",
                    borderRadius: "10px",
                    border: "none",
                    background: "#0f766e",
                    color: "#fff",
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
                  onClick={handleDownloadCrDocx}
                  style={{
                    flex: 1,
                    padding: "12px",
                    borderRadius: "10px",
                    border: "1px solid #0f766e",
                    background: "#f0fdfa",
                    color: "#0f766e",
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
          <div style={{ background: "#fff", padding: "28px 32px", borderRadius: "18px", border: "1px solid #cbd5e1", boxShadow: "0 6px 20px rgba(0,0,0,0.06)", fontFamily: "'Times New Roman', serif", lineHeight: 1.5 }}>
            <div style={{ textAlign: "center", marginBottom: "16px" }}>
              <div style={{ fontWeight: "bold", fontSize: "13px", textTransform: "uppercase" }}>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
              <div style={{ fontWeight: "bold", fontSize: "13px" }}>Độc lập - Tự do - Hạnh phúc</div>
              <div style={{ fontSize: "11px", marginTop: "2px" }}>────────────────</div>
            </div>

            <div style={{ textAlign: "center", fontWeight: "bold", fontSize: "16px", textTransform: "uppercase", color: "#0f766e", margin: "14px 0 4px" }}>
              BẢN CÔNG BỐ HỢP QUY
            </div>
            <div style={{ textAlign: "center", fontSize: "11px", fontStyle: "italic", marginBottom: "16px" }}>
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
              <div style={{ height: "40px", color: "#0f766e", fontWeight: "bold", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                [KÝ SỐ ĐIỆN TỬ]
              </div>
              <strong>{crForm.representative_name}</strong>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {/* MODAL: CHI TIẾT TOÀN VĂN QUY CHUẨN                                         */}
      {/* ══════════════════════════════════════════════════════════════════════════ */}
      {detailStandard && (
        <div className="modal-backdrop" onClick={handleCloseDetail}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "800px", padding: "28px 32px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "14px", fontWeight: 900, color: "#0f766e", background: "#e6fffa", padding: "4px 10px", borderRadius: "8px" }}>
                🏷️ {detailStandard.code}
              </span>
              <button onClick={handleCloseDetail} style={{ border: 0, background: "#f1f5f9", borderRadius: "50%", width: "32px", height: "32px", cursor: "pointer" }}>✕</button>
            </div>

            <h2 style={{ fontFamily: "Georgia, serif", fontSize: "20px", color: "#0f172a", margin: "0 0 14px" }}>
              {detailStandard.name}
            </h2>

            <div style={{ background: "#f8fafc", padding: "14px 18px", borderRadius: "12px", border: "1px solid #f1f5f9", fontSize: "13px", lineHeight: 1.6, marginBottom: "16px" }}>
              <div><strong>Cơ quan ban hành:</strong> {detailStandard.ministry_label}</div>
              <div><strong>Văn bản pháp lý:</strong> {detailStandard.circular}</div>
              <div><strong>Thủ tục áp dụng:</strong> {detailStandard.procedure_label}</div>
              <div><strong>Thiết bị áp dụng:</strong> {detailStandard.target_equipment}</div>
            </div>

            <h3 style={{ fontSize: "15px", color: "#0f766e", margin: "0 0 8px" }}>Mục 1. Chỉ Tiêu Kỹ Thuật Cốt Lõi Bắt Buộc</h3>
            <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "14px 18px", borderRadius: "12px", fontSize: "13px", color: "#166534", marginBottom: "16px" }}>
              <ul style={{ margin: 0, paddingLeft: "18px", lineHeight: 1.6 }}>
                {detailStandard.key_technical_requirements.map((req, idx) => (
                  <li key={idx}>{req}</li>
                ))}
              </ul>
            </div>

            <div style={{ display: "flex", gap: "10px", borderTop: "1px solid #f1f5f9", paddingTop: "16px" }}>
              <a
                href={api.standards.getStandardPdfUrl(detailStandard.code)}
                download
                style={{ flex: 1, padding: "10px", borderRadius: "10px", background: "#0f766e", color: "#fff", textDecoration: "none", textAlign: "center", fontWeight: 800, fontSize: "13px" }}
              >
                📥 Tải Toàn Văn PDF
              </a>
              <button
                onClick={handleCloseDetail}
                style={{ padding: "10px 20px", borderRadius: "10px", border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", fontWeight: 700, fontSize: "13px" }}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
