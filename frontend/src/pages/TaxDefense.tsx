import { useEffect, useState, type FormEvent } from "react";
import {
  api,
  type TaxDefenseDossier,
  type TaxDefenseInvestigationReport,
  type TaxDefenseOverview,
  type TaxDefensePartnerItem,
  type TaxDefensePartnerStatusReport,
} from "../api";
import {
  AppButton,
  AppIcon,
  EmptyState,
  InlineAlert,
  KpiStrip,
  PageHeader,
  PageShell,
  SectionCard,
  StatusBadge,
  TableSkeleton,
  useConfirm,
  useToast,
} from "../components/ui";
import { safeHttpUrl } from "../utils/url";
import { CostsTab } from "./tax-defense/CostsTab";
import { DossierTab, ImportTab } from "./tax-defense/DossierAndImportTabs";
import {
  formatNumber,
  formatVND,
  TAX_DEFENSE_TABS,
  type SingleMstResult,
  type TaxDefenseTabId,
} from "./tax-defense/helpers";
import { MatrixTab } from "./tax-defense/MatrixTab";
import { PartnersTab } from "./tax-defense/PartnersTab";

const ALL_HIST_YEARS = ["2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025"];
const YEARS_2018_2022 = ["2018", "2019", "2020", "2021", "2022"];
const YEARS_2022_2025 = ["2022", "2023", "2024", "2025"];

export function TaxDefense() {
  const toast = useToast();
  const askConfirm = useConfirm();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<TaxDefenseOverview | null>(null);
  const [dossier, setDossier] = useState<TaxDefenseDossier | null>(null);
  const [activeTab, setActiveTab] = useState<TaxDefenseTabId>("matrix");
  const [selectedYear, setSelectedYear] = useState<string>("all");
  const [copySuccess, setCopySuccess] = useState(false);

  // Partner Status Audit & Investigation state
  const [partnerReport, setPartnerReport] = useState<TaxDefensePartnerStatusReport | null>(null);
  const [loadingPartners, setLoadingPartners] = useState(false);
  const [investigationReport, setInvestigationReport] = useState<TaxDefenseInvestigationReport | null>(null);
  const [syncingGdt, setSyncingGdt] = useState(false);
  const [singleMstQuery, setSingleMstQuery] = useState("");
  const [singleMstResult, setSingleMstResult] = useState<SingleMstResult | null>(null);
  const [checkingMst, setCheckingMst] = useState(false);
  const [partnerFilter, setPartnerFilter] = useState<"all" | "risk_only">("all");
  const [selectedPartnerModal, setSelectedPartnerModal] = useState<TaxDefensePartnerItem | null>(null);

  // Historical Purchase Excel Import state
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importYear, setImportYear] = useState("2024");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: boolean;
    imported: number;
    skipped: number;
    year: string;
  } | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [ov, dos] = await Promise.all([
        api.taxDefenseOverview("2018,2019,2020,2021,2022,2023,2024,2025,2026"),
        api.taxDefenseDossier("2018,2019,2020,2021,2022,2023,2024,2025"),
      ]);
      setOverview(ov);
      setDossier(dos);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Lỗi khi tải dữ liệu giải trình thuế";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadPartnerStatus = async (force = false) => {
    if (!force && partnerReport && investigationReport) return;
    try {
      setLoadingPartners(true);
      const [rep, invRep] = await Promise.all([
        api.taxDefensePartnerStatus("2018,2019,2020,2021,2022,2023,2024,2025,2026", 80),
        api.taxDefenseInvestigationReport(),
      ]);
      setPartnerReport(rep);
      setInvestigationReport(invRep);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Lỗi tải danh mục đối tác và điều tra";
      toast.error(msg);
    } finally {
      setLoadingPartners(false);
    }
  };

  const handleSyncGdtPurchases = async () => {
    const confirmed = await askConfirm({
      title: "Đồng bộ hóa đơn mua vào từ Cổng Thuế",
      message:
        "Bạn có chắc chắn muốn quét và đồng bộ hóa đơn mua vào (2022–2025) từ Cổng Tổng cục Thuế (hoadondientu.gdt.gov.vn)?",
      confirmLabel: "Bắt đầu đồng bộ",
      cancelLabel: "Hủy",
      tone: "warning",
    });
    if (!confirmed) return;

    try {
      setSyncingGdt(true);
      const res = await api.syncGdtPurchases(2022, 2025);
      toast.success(
        `Đồng bộ hoàn tất: quét ${res.total_fetched} HĐ, nạp mới ${res.total_new}, bỏ qua ${res.total_skipped} trùng.`,
      );
      loadData();
      setPartnerReport(null);
      setInvestigationReport(null);
      loadPartnerStatus(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Lỗi khi đồng bộ Cổng Thuế";
      toast.error(msg);
    } finally {
      setSyncingGdt(false);
    }
  };

  const handleCheckSingleMst = async (e: FormEvent) => {
    e.preventDefault();
    const q = singleMstQuery.trim();
    if (!q) return;
    try {
      setCheckingMst(true);
      setSingleMstResult(null);
      const res = await api.taxDefenseCheckMst(q);
      setSingleMstResult(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Không tra cứu được MST";
      toast.error(msg);
    } finally {
      setCheckingMst(false);
    }
  };

  const handleCopyDossier = async () => {
    if (!dossier?.markdown_content) return;
    try {
      await navigator.clipboard.writeText(dossier.markdown_content);
      setCopySuccess(true);
      toast.success("Đã sao chép toàn văn bản thuyết minh giải trình.");
      window.setTimeout(() => setCopySuccess(false), 3000);
    } catch {
      toast.error("Không thể sao chép vào clipboard trên trình duyệt này.");
    }
  };

  const handleImportSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!importFile) {
      toast.warning("Vui lòng chọn file Excel bảng kê mua vào.");
      return;
    }
    try {
      setImporting(true);
      const res = await api.importHistoricalPurchase(importFile, importYear);
      setImportResult(res);
      toast.success(
        `Đã nạp thành công ${res.imported} hóa đơn mua vào cho năm ${res.year} (bỏ qua ${res.skipped} HĐ trùng).`,
      );
      setImportFile(null);
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Lỗi khi import bảng kê mua vào";
      toast.error(msg);
    } finally {
      setImporting(false);
    }
  };

  const headerSubtitle = (
    <>
      Căn cứ Luật Quản lý thuế 38/2019 &amp; Thông tư 219/2013 · Cơ cấu chi phí &amp; Doanh thu dịch vụ công nghệ{" "}
      <strong className="ui-text-brand">KHÔNG PHỤ THUỘC TỒN KHO VẬT LÝ</strong>
    </>
  );

  if (loading) {
    return (
      <PageShell data-page="tax-defense">
        <PageHeader
          variant="compact"
          icon="scale"
          title="Giải Trình Thuế & Thẩm Tra Doanh Thu (2018 – 2025)"
          subtitle={headerSubtitle}
          badges={<StatusBadge tone="brand" size="sm">Phiên Bản 2.0.0</StatusBadge>}
        />
        <KpiStrip columns={4} loading items={[]} />
        <SectionCard
          title="Đang tính toán ma trận giải trình thuế 2018-2025..."
          subtitle="Đối soát dữ liệu hóa đơn điện tử iHoadon, chi phí mua vào và thuế GTGT"
          padding="flush"
        >
          <TableSkeleton rows={5} cols={7} />
        </SectionCard>
      </PageShell>
    );
  }

  if (error || !overview) {
    return (
      <PageShell data-page="tax-defense">
        <PageHeader
          variant="compact"
          icon="scale"
          title="Giải Trình Thuế & Thẩm Tra Doanh Thu (2018 – 2025)"
          subtitle={headerSubtitle}
        />
        <InlineAlert
          tone="danger"
          title="Không thể tải dữ liệu giải trình thuế"
          action={
            <AppButton variant="danger" size="sm" leftIcon="refresh" onClick={loadData}>
              Thử lại
            </AppButton>
          }
        >
          {error || "Không nhận được dữ liệu tổng hợp từ máy chủ."}
        </InlineAlert>
        <EmptyState
          icon="scale"
          title="Chưa có dữ liệu ma trận giải trình"
          description="Kiểm tra kết nối máy chủ hoặc bấm Thử lại để tổng hợp hóa đơn điện tử và chi phí mua vào."
          action={
            <AppButton variant="primary" leftIcon="refresh" onClick={loadData}>
              Tải lại dữ liệu
            </AppButton>
          }
        />
      </PageShell>
    );
  }

  const matrixRows =
    selectedYear === "all"
      ? overview.summary_matrix.filter((m) => ALL_HIST_YEARS.includes(m.year))
      : selectedYear === "2018_2022"
        ? overview.summary_matrix.filter((m) => YEARS_2018_2022.includes(m.year))
        : selectedYear === "2022_2025"
          ? overview.summary_matrix.filter((m) => YEARS_2022_2025.includes(m.year))
          : overview.summary_matrix.filter((m) => m.year === selectedYear);

  const baseYears = overview.summary_matrix.filter((m) => ALL_HIST_YEARS.includes(m.year));
  const totRevPretax = baseYears.reduce((sum, m) => sum + m.revenue_pretax, 0);
  const totRevVat = baseYears.reduce((sum, m) => sum + m.revenue_vat, 0);
  const totCostPretax = baseYears.reduce((sum, m) => sum + m.cost_pretax, 0);
  const totCostVat = baseYears.reduce((sum, m) => sum + m.cost_vat_input, 0);
  const totSaleInvoices = baseYears.reduce((sum, m) => sum + m.sale_invoices_count, 0);
  const excelHref = safeHttpUrl(api.taxDefenseExcelUrl("2022,2023,2024,2025,2026"));

  return (
    <PageShell data-page="tax-defense">
      <PageHeader
        variant="compact"
        icon="scale"
        title="Giải Trình Thuế & Thẩm Tra Doanh Thu (2018 – 2025)"
        subtitle={headerSubtitle}
        badges={<StatusBadge tone="brand" size="sm">Phiên Bản 2.0.0</StatusBadge>}
        actions={
          <>
            <AppButton
              variant={copySuccess ? "primary" : "secondary"}
              leftIcon={copySuccess ? "check" : "copy"}
              onClick={handleCopyDossier}
            >
              {copySuccess ? "Đã chép thuyết minh!" : "Chép Bản Thuyết Minh"}
            </AppButton>
            {excelHref && (
              <a
                href={excelHref}
                target="_blank"
                rel="noopener noreferrer"
                className="ui-btn ui-btn--primary ui-btn--md"
              >
                <AppIcon name="file-spreadsheet" size={16} />
                <span className="ui-btn-label">Xuất Excel Báo Cáo (4 Sheets)</span>
              </a>
            )}
          </>
        }
      />

      <KpiStrip
        columns={4}
        className="td-kpi"
        items={[
          {
            label: "Doanh thu chưa thuế (4 năm)",
            value: formatVND(totRevPretax),
            sub: `${totSaleInvoices > 0 ? formatNumber(totSaleInvoices) : "127"} HĐ có mã CQT · Tổng có thuế: ${formatVND(totRevPretax + totRevVat)}`,
            icon: "trending-up",
            tone: "brand",
          },
          {
            label: "Thuế GTGT đầu ra (4 năm)",
            value: formatVND(totRevVat),
            sub: "51,4% DT thuộc diện Không chịu thuế (KCT phần mềm)",
            icon: "receipt",
            tone: "warning",
          },
          {
            label: "Chi phí mua vào & Thuế vào",
            value: formatVND(totCostPretax),
            sub: `Thuế vào đã khấu trừ: ${formatVND(totCostVat)} (CSDL 2025-2026)`,
            icon: "wallet",
            tone: "neutral",
          },
          {
            label: "Đặc thù Mô hình Công nghệ",
            value: "R&D & Just-In-Time",
            sub: "Không đọng vốn kho · Mua gia công theo dự án",
            icon: "cpu",
            tone: "success",
          },
        ]}
      />

      <nav className="td-tab-nav" aria-label="Phân khu giải trình thuế">
        {TAX_DEFENSE_TABS.map((t) => {
          const isActive = activeTab === t.id;
          return (
            <AppButton
              key={t.id}
              variant="ghost"
              size="sm"
              leftIcon={t.icon}
              aria-pressed={isActive}
              className={`td-tab-btn${isActive ? " is-active" : ""}`}
              onClick={() => {
                setActiveTab(t.id);
                if (t.id === "partners") loadPartnerStatus();
              }}
            >
              {t.label}
            </AppButton>
          );
        })}
      </nav>

      {activeTab === "matrix" && (
        <MatrixTab
          overview={overview}
          matrixRows={matrixRows}
          selectedYear={selectedYear}
          onSelectedYearChange={setSelectedYear}
          totRevPretax={totRevPretax}
        />
      )}

      {activeTab === "costs" && <CostsTab />}

      {activeTab === "partners" && (
        <PartnersTab
          partnerReport={partnerReport}
          investigationReport={investigationReport}
          loadingPartners={loadingPartners}
          syncingGdt={syncingGdt}
          onSyncGdt={handleSyncGdtPurchases}
          singleMstQuery={singleMstQuery}
          onSingleMstQueryChange={setSingleMstQuery}
          singleMstResult={singleMstResult}
          checkingMst={checkingMst}
          onCheckSingleMst={handleCheckSingleMst}
          partnerFilter={partnerFilter}
          onPartnerFilterChange={setPartnerFilter}
          selectedPartnerModal={selectedPartnerModal}
          onSelectPartnerModal={setSelectedPartnerModal}
        />
      )}

      {activeTab === "dossier" && (
        <DossierTab
          dossier={dossier}
          copySuccess={copySuccess}
          onCopy={handleCopyDossier}
        />
      )}

      {activeTab === "import" && (
        <ImportTab
          importYear={importYear}
          onImportYearChange={setImportYear}
          importFile={importFile}
          onImportFileChange={setImportFile}
          importing={importing}
          importResult={importResult}
          onSubmit={handleImportSubmit}
        />
      )}
    </PageShell>
  );
}
