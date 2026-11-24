import { useEffect, useRef, useState } from "react";
import {
  BkhcnRiskClassifyResult,
  BkhcnRiskItem,
  BkhcnRiskStatistics,
  api,
} from "../api";
import { TqcCertificateLookup } from "../components/TqcCertificateLookup";
import {
  AppButton,
  AppIcon,
  AppModal,
  EmptyState,
  PageHeader,
  PageShell,
  ResponsiveTabs,
  SkeletonBlock,
  StatusBadge,
  useConfirm,
  useToast,
} from "../components/ui";
import { safeHttpUrl } from "../utils/url";
import { ComplianceRoadmapTab } from "./standards/ComplianceRoadmapTab";
import { CrGeneratorTab } from "./standards/CrGeneratorTab";
import { EmcGuideTab, TestingLabsTab } from "./standards/EmcLabsTab";
import { HsLookupTab, RiskClassificationTab } from "./standards/HsRiskTab";
import { PlaybooksTab } from "./standards/PlaybooksTab";
import { StandardsSearchTab } from "./standards/StandardsSearchTab";
import {
  DEFAULT_CR_FORM,
  ZALO_LAB_TEMPLATE,
  type CrFormState,
  type GameState,
  type HsMapping,
  type PlaybookItem,
  type StandardItem,
  type StandardsTabId,
  type TestingLab,
} from "./standards/types";

function resolveTabFromPath(pathname: string): StandardsTabId {
  if (pathname.includes("/tqc")) return "tqc";
  if (pathname.includes("/risk") || pathname.includes("/phan-loai-rui-ro")) {
    return "risk_classification";
  }
  if (pathname.includes("/hs-lookup")) return "hs_lookup";
  if (pathname.includes("/cr-generator")) return "cr_generator";
  if (pathname.includes("/playbooks") || pathname.includes("/guide")) return "playbooks";
  if (pathname.includes("/emc-guide") || pathname.includes("/emc")) return "emc_guide";
  if (pathname.includes("/testing-labs") || pathname.includes("/labs")) return "labs";
  if (pathname.includes("/game")) return "game";
  return "search";
}

export function StandardsConformity() {
  const toast = useToast();
  const askConfirm = useConfirm();

  const [activeTab, setActiveTab] = useState<StandardsTabId>(() =>
    resolveTabFromPath(window.location.pathname),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMinistry, setSelectedMinistry] = useState("");
  const [standardsList, setStandardsList] = useState<StandardItem[]>([]);
  const [loading, setLoading] = useState(false);

  const [detailStandard, setDetailStandard] = useState<StandardItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailNotFoundCode, setDetailNotFoundCode] = useState<string | null>(null);

  const [hsCodeInput, setHsCodeInput] = useState("8473.30.10");
  const [hsResult, setHsResult] = useState<HsMapping | null>(null);
  const [allHsMappings, setAllHsMappings] = useState<HsMapping[]>([]);

  const [labs, setLabs] = useState<TestingLab[]>([]);
  const [playbooks, setPlaybooks] = useState<PlaybookItem[]>([]);
  const [playbooksLoading, setPlaybooksLoading] = useState(false);
  const [selectedPlaybookId, setSelectedPlaybookId] = useState("inut_rockchip_embedded_pc");

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [gameLoading, setGameLoading] = useState(false);
  const [activeQuestNote, setActiveQuestNote] = useState<Record<number, string>>({});

  const [crForm, setCrForm] = useState<CrFormState>(DEFAULT_CR_FORM);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const [riskStats, setRiskStats] = useState<BkhcnRiskStatistics | null>(null);
  const [riskCatalog, setRiskCatalog] = useState<BkhcnRiskItem[]>([]);
  const [riskCatalogTotal, setRiskCatalogTotal] = useState(0);
  const [riskCatalogPage, setRiskCatalogPage] = useState(1);
  const riskCatalogLimit = 50;
  const [riskLevelFilter, setRiskLevelFilter] = useState("");
  const [riskGroupFilter, setRiskGroupFilter] = useState("");
  const [riskSearchQuery, setRiskSearchQuery] = useState("");
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskClassifyInput, setRiskClassifyInput] = useState("8517.62.59");
  const [riskClassifyResult, setRiskClassifyResult] = useState<BkhcnRiskClassifyResult | null>(
    null,
  );
  const [riskClassifying, setRiskClassifying] = useState(false);
  const riskInitializedRef = useRef(false);

  const syncUrl = (tab: StandardsTabId, standardCode: string | null = null) => {
    let path = "/standards/search";
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
    }

    if (window.location.pathname !== path) {
      window.history.pushState({ standardsPath: path }, "", path);
    }
  };

  const handleSearch = async (qOverride?: string, ministryOverride?: string) => {
    const q = qOverride !== undefined ? qOverride : searchQuery;
    const ministry = ministryOverride !== undefined ? ministryOverride : selectedMinistry;
    setLoading(true);
    try {
      const res = await api.standards.search({ q, ministry });
      const list = Array.isArray(res)
        ? res
        : Array.isArray((res as unknown as { items?: StandardItem[] })?.items)
          ? (res as unknown as { items: StandardItem[] }).items
          : [];
      setStandardsList(list);
    } catch (e: unknown) {
      toast.error((e as Error)?.message || "Lỗi tra cứu quy chuẩn");
    } finally {
      setLoading(false);
    }
  };

  const fetchGameState = async () => {
    setGameLoading(true);
    try {
      const g = await api.standards.getGameState();
      if (!g || !Array.isArray(g.quests)) return;
      setGameState(g);
      const notes: Record<number, string> = {};
      g.quests.forEach((q) => {
        notes[q.quest_id] = q.personal_note || "";
      });
      setActiveQuestNote(notes);
    } catch {
      // ignore optional game state failure on initial load
    } finally {
      setGameLoading(false);
    }
  };

  const fetchRiskStats = async () => {
    try {
      const s = await api.standards.getRiskStatistics();
      if (s && Array.isArray(s.groups)) setRiskStats(s);
    } catch {
      // ignore optional risk stats failure
    }
  };

  const loadRiskCatalog = async (
    page = 1,
    rLevel = riskLevelFilter,
    grp = riskGroupFilter,
    q = riskSearchQuery,
  ) => {
    setRiskLoading(true);
    try {
      const res = await api.standards.getRiskCatalog({
        risk_level: rLevel,
        group: grp,
        q,
        page,
        limit: riskCatalogLimit,
      });
      setRiskCatalog(Array.isArray(res?.items) ? res.items : []);
      setRiskCatalogTotal(typeof res?.total === "number" ? res.total : 0);
      setRiskCatalogPage(typeof res?.page === "number" ? res.page : page);
    } catch (e: unknown) {
      toast.error((e as Error)?.message || "Lỗi tải danh mục rủi ro");
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
      toast.error((e as Error)?.message || "Lỗi phân loại rủi ro");
    } finally {
      setRiskClassifying(false);
    }
  };

  useEffect(() => {
    api.standards.getStatistics().catch(() => {});
    handleSearch("", "");
    fetchGameState();
    api.standards.getHsMappings().then(setAllHsMappings).catch(() => {});
    api.standards.getTestingLabs().then(setLabs).catch(() => {});

    setPlaybooksLoading(true);
    api.standards
      .getPlaybooks()
      .then(setPlaybooks)
      .catch(() => {})
      .finally(() => setPlaybooksLoading(false));

    const pathname = window.location.pathname;
    const stdMatch = pathname.match(/(?:\/standards)\/(?:qcvn|detail)\/([^/]+)/);
    if (stdMatch) {
      const code = decodeURIComponent(stdMatch[1]);
      setDetailLoading(true);
      api.standards
        .search({ q: code })
        .then((res) => {
          if (Array.isArray(res) && res.length > 0) {
            setDetailStandard(res[0]);
            setDetailNotFoundCode(null);
          } else {
            setDetailNotFoundCode(code);
          }
        })
        .catch(() => setDetailNotFoundCode(code))
        .finally(() => setDetailLoading(false));
    } else {
      setActiveTab(resolveTabFromPath(pathname));
    }
  }, []);

  useEffect(() => {
    if (activeTab !== "risk_classification" || riskInitializedRef.current) return;
    riskInitializedRef.current = true;
    fetchRiskStats();
    loadRiskCatalog(1, "", "", "");
    handleClassifyRisk("8517.62.59");
  }, [activeTab]);

  const handleCompleteQuest = async (questId: number) => {
    try {
      const note = activeQuestNote[questId] || "";
      const updated = await api.standards.completeGameQuest(questId, note);
      setGameState(updated);
      toast.success(`Hoàn thành bước ${questId} — đã cập nhật tiến độ hợp quy.`);
    } catch (e: unknown) {
      toast.error((e as Error)?.message || "Lỗi cập nhật tiến độ");
    }
  };

  const handleSaveNote = async (questId: number) => {
    try {
      const note = activeQuestNote[questId] || "";
      const updated = await api.standards.updateGameNote(questId, note);
      setGameState(updated);
      toast.success("Đã lưu ghi chú triển khai.");
    } catch (e: unknown) {
      toast.error((e as Error)?.message || "Lỗi lưu ghi chú");
    }
  };

  const handleResetGame = async () => {
    const confirmed = await askConfirm({
      title: "Đặt lại tiến độ hợp quy",
      message: "Bạn có chắc chắn muốn đặt lại toàn bộ tiến độ lộ trình 6 bước từ đầu không?",
      confirmLabel: "Đặt lại tiến độ",
      cancelLabel: "Hủy",
      tone: "warning",
    });
    if (!confirmed) return;
    try {
      const res = await api.standards.resetGame();
      setGameState(res);
      toast.info("Đã đặt lại tiến độ lộ trình về Bước 1.");
    } catch (e: unknown) {
      toast.error((e as Error)?.message || "Lỗi đặt lại tiến độ");
    }
  };

  const handleHsLookup = async (codeToLookup?: string) => {
    const code = (codeToLookup ?? hsCodeInput).trim();
    if (!code) return;
    try {
      const res = await api.standards.lookupHsCode(code);
      setHsResult(res);
    } catch (e: unknown) {
      toast.error((e as Error)?.message || "Không tìm thấy dữ liệu HS Code");
      setHsResult(null);
    }
  };

  const handleOpenDetail = (std: StandardItem) => {
    setDetailNotFoundCode(null);
    setDetailStandard(std);
    syncUrl(activeTab, std.code);
  };

  const handleCloseDetail = () => {
    setDetailStandard(null);
    setDetailNotFoundCode(null);
    setDetailLoading(false);
    syncUrl(activeTab, null);
  };

  const handleOpenStandardByCode = (stdCode: string) => {
    api.standards.search({ q: stdCode }).then((r) => {
      if (Array.isArray(r) && r.length > 0) handleOpenDetail(r[0]);
    });
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
      toast.success("Đã tải xuống Bản Công Bố Hợp Quy (PDF).");
    } catch (e: unknown) {
      toast.error((e as Error)?.message || "Lỗi tạo file PDF");
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
      toast.success("Đã tải xuống Bản Công Bố Hợp Quy Word (DOCX).");
    } catch (e: unknown) {
      toast.error((e as Error)?.message || "Lỗi tạo file Word");
    }
  };

  const copyZaloMessage = () => {
    navigator.clipboard.writeText(ZALO_LAB_TEMPLATE);
    toast.success("Đã sao chép mẫu tin nhắn đăng ký đo kiểm vào Clipboard.");
  };

  const detailPdfUrl = detailStandard
    ? safeHttpUrl(api.standards.getStandardPdfUrl(detailStandard.code))
    : undefined;

  void allHsMappings;
  void labs;

  return (
    <PageShell data-page="standards">
      <PageHeader
        variant="compact"
        icon="shield-check"
        title="Hành Trình Chinh Phục Hợp Quy & Cẩm Nang Chứng Nhận Thiết Bị iNut (QCVN / TCVN)"
        subtitle="Tra cứu QCVN/TCVN, xác minh GCN TQC, phân loại rủi ro TT 36/2026, đối soát mã HS và xuất Bản Công Bố Hợp Quy (CR)."
      />

      <ResponsiveTabs<StandardsTabId>
        className="std-tabs"
        active={activeTab}
        onChange={(tabId) => {
          setActiveTab(tabId);
          syncUrl(tabId);
        }}
        ariaLabel="Điều hướng tiêu chuẩn và hợp quy"
        tabs={[
          { id: "search", label: "Tra cứu QCVN & TCVN", icon: "search" },
          { id: "tqc", label: "GCN TQC theo Model", icon: "badge-check" },
          {
            id: "risk_classification",
            label: "Phân loại rủi ro (TT 36/2026)",
            icon: "scale",
            badge: "MỚI",
          },
          { id: "hs_lookup", label: "Đối soát mã HS Code", icon: "package" },
          { id: "cr_generator", label: "Bản Công Bố Hợp Quy (CR)", icon: "file-signature" },
          { id: "playbooks", label: "Cẩm nang thực chiến", icon: "book-open", badge: "Rockchip" },
          { id: "emc_guide", label: "Kỹ thuật EMC & ESD", icon: "shield" },
          { id: "labs", label: "Danh bạ Phòng Lab", icon: "building-2" },
          {
            id: "game",
            label: "Lộ trình 6 bước",
            icon: "clipboard-check",
            badge: gameState ? `${gameState.completed_quests_count}/${gameState.total_quests}` : undefined,
          },
        ]}
      />

      {activeTab === "search" && (
        <StandardsSearchTab
          searchQuery={searchQuery}
          selectedMinistry={selectedMinistry}
          standardsList={standardsList}
          loading={loading}
          onSearchQueryChange={setSearchQuery}
          onMinistryChange={(val) => {
            setSelectedMinistry(val);
            handleSearch(searchQuery, val);
          }}
          onSearch={() => handleSearch()}
          onReset={() => {
            setSearchQuery("");
            setSelectedMinistry("");
            handleSearch("", "");
          }}
          onOpenDetail={handleOpenDetail}
        />
      )}

      {activeTab === "tqc" && <TqcCertificateLookup />}

      {activeTab === "risk_classification" && (
        <RiskClassificationTab
          riskStats={riskStats}
          riskCatalog={riskCatalog}
          riskCatalogTotal={riskCatalogTotal}
          riskCatalogPage={riskCatalogPage}
          riskCatalogLimit={riskCatalogLimit}
          riskLevelFilter={riskLevelFilter}
          riskGroupFilter={riskGroupFilter}
          riskSearchQuery={riskSearchQuery}
          riskLoading={riskLoading}
          riskClassifyInput={riskClassifyInput}
          riskClassifyResult={riskClassifyResult}
          riskClassifying={riskClassifying}
          onRiskClassifyInputChange={setRiskClassifyInput}
          onClassifyRisk={handleClassifyRisk}
          onRiskLevelFilterChange={(lvl) => {
            setRiskLevelFilter(lvl);
            loadRiskCatalog(1, lvl, riskGroupFilter, riskSearchQuery);
          }}
          onRiskGroupFilterChange={(grp) => {
            setRiskGroupFilter(grp);
            loadRiskCatalog(1, riskLevelFilter, grp, riskSearchQuery);
          }}
          onRiskSearchQueryChange={(q) => {
            setRiskSearchQuery(q);
            loadRiskCatalog(1, riskLevelFilter, riskGroupFilter, q);
          }}
          onResetCatalogFilters={() => {
            setRiskLevelFilter("");
            setRiskGroupFilter("");
            setRiskSearchQuery("");
            loadRiskCatalog(1, "", "", "");
          }}
          onPageChange={(nextPage) => loadRiskCatalog(nextPage)}
        />
      )}

      {activeTab === "hs_lookup" && (
        <HsLookupTab
          hsCodeInput={hsCodeInput}
          hsResult={hsResult}
          onHsCodeInputChange={setHsCodeInput}
          onLookup={handleHsLookup}
          onOpenStandardByCode={handleOpenStandardByCode}
          onNavigateRisk={() => {
            setActiveTab("risk_classification");
            syncUrl("risk_classification");
          }}
        />
      )}

      {activeTab === "cr_generator" && (
        <CrGeneratorTab
          crForm={crForm}
          generatingPdf={generatingPdf}
          onChange={setCrForm}
          onDownloadPdf={handleDownloadCrPdf}
          onDownloadDocx={handleDownloadCrDocx}
        />
      )}

      {activeTab === "playbooks" && (
        <PlaybooksTab
          playbooks={playbooks}
          loading={playbooksLoading}
          selectedPlaybookId={selectedPlaybookId}
          onSelectPlaybook={setSelectedPlaybookId}
          onCopyZalo={copyZaloMessage}
          onApplyToCr={(pb) => {
            setCrForm({
              ...crForm,
              product_name: pb.title.split("(")[0].trim(),
              model_name: pb.id.includes("rockchip")
                ? "iNut-RK3568-Industrial-PC"
                : "iNut-SmartDisplay-65",
              applicable_standards: pb.required_standards.map((s) => s.code),
            });
            setActiveTab("cr_generator");
            syncUrl("cr_generator");
            toast.success("Đã tự động điền quy chuẩn từ Cẩm nang vào Bản Công Bố CR.");
          }}
        />
      )}

      {activeTab === "emc_guide" && <EmcGuideTab />}

      {activeTab === "labs" && <TestingLabsTab onCopyZalo={copyZaloMessage} />}

      {activeTab === "game" && (
        <ComplianceRoadmapTab
          gameState={gameState}
          loading={gameLoading}
          activeQuestNote={activeQuestNote}
          onChangeNote={(questId, value) =>
            setActiveQuestNote((prev) => ({ ...prev, [questId]: value }))
          }
          onCompleteQuest={handleCompleteQuest}
          onSaveNote={handleSaveNote}
          onResetGame={handleResetGame}
        />
      )}

      <AppModal
        open={Boolean(detailStandard || detailLoading || detailNotFoundCode)}
        onClose={handleCloseDetail}
        size="lg"
        title={
          detailStandard
            ? detailStandard.name
            : detailLoading
              ? "Đang tải thông tin quy chuẩn..."
              : "Không tìm thấy quy chuẩn"
        }
        subtitle={
          detailStandard ? (
            <StatusBadge tone="brand" icon="tag" size="sm">
              <span className="ui-mono ui-wrap">{detailStandard.code}</span>
            </StatusBadge>
          ) : undefined
        }
        footer={
          detailStandard ? (
            <div className="ui-row">
              {detailPdfUrl && (
                <a href={detailPdfUrl} download className="ui-btn ui-btn--primary ui-btn--md">
                  <AppIcon name="download" size={16} />
                  <span>Tải Toàn Văn PDF</span>
                </a>
              )}
              <AppButton variant="secondary" onClick={handleCloseDetail}>
                Đóng
              </AppButton>
            </div>
          ) : (
            <AppButton variant="secondary" onClick={handleCloseDetail}>
              Đóng
            </AppButton>
          )
        }
      >
        {detailLoading ? (
          <div className="ui-stack">
            <SkeletonBlock variant="title" />
            <SkeletonBlock variant="line" lines={4} />
          </div>
        ) : detailStandard ? (
          <div className="ui-stack">
            <div className="ui-subpanel ui-subpanel--md ui-stack">
              <div>
                <strong>Cơ quan ban hành:</strong> {detailStandard.ministry_label}
              </div>
              <div>
                <strong>Văn bản pháp lý:</strong> {detailStandard.circular}
              </div>
              <div>
                <strong>Thủ tục áp dụng:</strong> {detailStandard.procedure_label}
              </div>
              <div>
                <strong>Thiết bị áp dụng:</strong> {detailStandard.target_equipment}
              </div>
            </div>

            <div className="ui-stack">
              <h3 className="ui-subhead">Chỉ tiêu kỹ thuật cốt lõi bắt buộc</h3>
              <div className="ui-subpanel ui-subpanel--md">
                <ul className="ui-bullet-list">
                  {detailStandard.key_technical_requirements.map((req, idx) => (
                    <li key={idx}>{req}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState
            icon="file-search"
            title="Không tìm thấy mã quy chuẩn"
            description={`Không tìm thấy dữ liệu cho mã "${detailNotFoundCode || ""}".`}
            compact
          />
        )}
      </AppModal>
    </PageShell>
  );
}
