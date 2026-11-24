import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  api,
  type BiddingAIAnalysisData,
  type BiddingAIAnalysisResult,
  type BiddingBookmarkCreate,
  type BiddingBookmarkItem,
  type BiddingContractorItem,
  type BiddingCrmScanResult,
  type BiddingDossierReviewDetail,
  type BiddingDossierReviewItem,
  type BiddingSearchResult,
  type BiddingTenderDetail,
  type BiddingTenderSummary,
  type BiddingWatchlistCreate,
  type BiddingWatchlistItem,
} from "../api";
import {
  AppButton,
  EmptyState,
  KpiStrip,
  PageHeader,
  PageShell,
  PromptDialog,
  ResponsiveTabs,
  SectionCard,
  SkeletonBlock,
  StatusBadge,
  useConfirm,
  useToast,
} from "../components/ui";
import { openExternalSafe, safeHttpUrl } from "../utils/url";
import { AiAnalysisModal } from "./bidding/AiAnalysisModal";
import {
  BookmarkFormModal,
  ContractorDetailModal,
  ImportDriveModal,
  WatchlistFormModal,
} from "./bidding/BiddingModals";
import { BookmarksTab } from "./bidding/BookmarksTab";
import { ContractorsTab } from "./bidding/ContractorsTab";
import { DossierReviewTab } from "./bidding/DossierReviewTab";
import { SearchTab } from "./bidding/SearchTab";
import { TenderDetailModal } from "./bidding/TenderDetailModal";
import { WatchlistTab } from "./bidding/WatchlistTab";
import {
  BOOKMARK_STATUS_MAP,
  formatDate,
  formatVnd,
  type BiddingMainTab,
  type BookmarkModalState,
  type BookmarkStatusKey,
  type ContractorSubTab,
  type DetailModalTab,
  type DossierSubTab,
  type WonPackagesState,
} from "./bidding/biddingUtils";

export function BiddingProcurement() {
  const toast = useToast();
  const askConfirm = useConfirm();

  // Main Navigation
  const [activeTab, setActiveTab] = useState<BiddingMainTab>("search");

  // Tab 5: Dossier Reviews State
  const [dossierReviews, setDossierReviews] = useState<BiddingDossierReviewItem[]>([]);
  const [activeDossierReview, setActiveDossierReview] =
    useState<BiddingDossierReviewDetail | null>(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [dossierSubTab, setDossierSubTab] = useState<DossierSubTab>("executive");
  const [showImportDriveModal, setShowImportDriveModal] = useState(false);
  const [importDriveUrl, setImportDriveUrl] = useState(
    "https://drive.google.com/drive/folders/1l17rxMHd4-B988GJ3cwIBmFGCC3oazHV",
  );
  const [importDriveNotes, setImportDriveNotes] = useState("");
  const [importDriveLoading, setImportDriveLoading] = useState(false);

  // Tab 1: Search State
  const [keyword, setKeyword] = useState("");
  const [province, setProvince] = useState("");
  const [field, setField] = useState("");
  const [minPrice, setMinPrice] = useState<number | "">("");
  const [maxPrice, setMaxPrice] = useState<number | "">("");
  const [biddingMethod, setBiddingMethod] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "closed">("all");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState<BiddingSearchResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Tab 2: Bookmarks Pipeline State
  const [bookmarks, setBookmarks] = useState<BiddingBookmarkItem[]>([]);
  const [bookmarksLoading, setBookmarksLoading] = useState(false);
  const [bookmarkPipelineFilter, setBookmarkPipelineFilter] = useState<string>("all");
  const [bookmarkSearchKeyword, setBookmarkSearchKeyword] = useState("");

  // Tab 3: Watchlist State
  const [watchlists, setWatchlists] = useState<BiddingWatchlistItem[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [scanningId, setScanningId] = useState<number | "all" | null>(null);

  // Modals State
  const [detailModalTender, setDetailModalTender] = useState<BiddingTenderDetail | null>(null);
  const [detailModalLoading, setDetailModalLoading] = useState(false);
  const [detailModalTab, setDetailModalTab] = useState<DetailModalTab>("info");
  const [modalCompetitors, setModalCompetitors] = useState<any[]>([]);
  const [modalAttachments, setModalAttachments] = useState<any[]>([]);

  const [aiModalResult, setAiModalResult] = useState<BiddingAIAnalysisResult | null>(null);
  const [aiModalTender, setAiModalTender] = useState<BiddingTenderSummary | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiCustomContext] = useState("");
  const [aiError, setAiError] = useState<string | null>(null);

  const [bookmarkModalItem, setBookmarkModalItem] = useState<BookmarkModalState | null>(null);
  const [notePromptBookmark, setNotePromptBookmark] = useState<BiddingBookmarkItem | null>(null);
  const [watchlistModalRule, setWatchlistModalRule] =
    useState<Partial<BiddingWatchlistItem> | null>(null);

  // Tab 4: Contractors & Won Packages State
  const [contractorSubTab, setContractorSubTab] =
    useState<ContractorSubTab>("won_packages_playbook");
  const [wonPackagesResult, setWonPackagesResult] = useState<WonPackagesState | null>(null);
  const [wonPackagesLoading, setWonPackagesLoading] = useState(false);
  const [wonPackagesQuery, setWonPackagesQuery] = useState("");
  const [wonPackagesFieldFilter, setWonPackagesFieldFilter] = useState("");
  const [crmScanResult, setCrmScanResult] = useState<BiddingCrmScanResult | null>(null);
  const [crmScanLoading, setCrmScanLoading] = useState(false);
  const [contractorSearchQuery, setContractorSearchQuery] = useState("");
  const [contractorCategoryFilter, setContractorCategoryFilter] = useState<
    "all" | "won" | "registered" | "oem"
  >("all");
  const [selectedContractorDetail, setSelectedContractorDetail] =
    useState<BiddingContractorItem | null>(null);
  const prevContractorQueryRef = useRef<string | null>(null);

  const copyToClipboard = (text: string) => {
    try {
      if (navigator?.clipboard) {
        navigator.clipboard.writeText(text);
      }
    } catch (err) {
      console.warn("Clipboard copy error:", err);
    }
  };

  const syncBiddingUrl = (
    tab: BiddingMainTab,
    subTab: ContractorSubTab,
    tenderCode: string | null = null,
    tenderTab: DetailModalTab = "info",
    contractorTax: string | null = null,
    replace = false,
  ) => {
    let path = "/bidding";
    if (tenderCode) {
      path = `/bidding/tender/${encodeURIComponent(tenderCode)}`;
      if (tenderTab === "attachments") path += "/attachments";
      else if (tenderTab === "competitors") path += "/competitors";
      else if (tenderTab === "iframe") path += "/portal";
    } else if (contractorTax) {
      path = `/bidding/contractor/${encodeURIComponent(contractorTax)}`;
    } else if (tab === "contractors") {
      path =
        subTab === "won_packages_playbook"
          ? "/bidding/won-packages"
          : "/bidding/contractors";
    } else if (tab === "bookmarks") {
      path = "/bidding/bookmarks";
    } else if (tab === "watchlist") {
      path = "/bidding/watchlists";
    } else if (tab === "dossier_reviews") {
      path = "/bidding/dossier-reviews";
    } else {
      path = "/bidding/search";
    }

    if (window.location.pathname !== path) {
      if (replace) {
        window.history.replaceState({ biddingPath: path }, "", path);
      } else {
        window.history.pushState({ biddingPath: path }, "", path);
      }
    }
  };

  // Dossier Reviews Handlers
  const fetchDossierReviews = async (selectFirst = true) => {
    setDossierLoading(true);
    try {
      const rawList = await api.bidding.listDossierReviews();
      const list = Array.isArray(rawList) ? rawList : (rawList as any)?.items || [];
      setDossierReviews(list);
      if (selectFirst && list.length > 0) {
        const detail = await api.bidding.getDossierReview(list[0].id);
        setActiveDossierReview(detail);
      }
    } catch (e: any) {
      console.error("Lỗi tải danh sách thẩm định thầu:", e);
    } finally {
      setDossierLoading(false);
    }
  };

  const handleSelectDossierReview = async (id: number) => {
    setDossierLoading(true);
    try {
      const detail = await api.bidding.getDossierReview(id);
      setActiveDossierReview(detail);
    } catch (e: any) {
      toast.error("Lỗi tải chi tiết thẩm định: " + e.message);
    } finally {
      setDossierLoading(false);
    }
  };

  const handleImportDossierFromDrive = async (e: FormEvent) => {
    e.preventDefault();
    if (!importDriveUrl.trim()) return;
    setImportDriveLoading(true);
    try {
      const res = await api.bidding.importDossierFromDrive(importDriveUrl, importDriveNotes);
      setShowImportDriveModal(false);
      toast.success(res.message);
      await fetchDossierReviews(true);
    } catch (e: any) {
      toast.error("Lỗi nhập hồ sơ thầu: " + e.message);
    } finally {
      setImportDriveLoading(false);
    }
  };

  // Search Handlers
  const handleSearch = async (targetPage = 1) => {
    setSearchLoading(true);
    setSearchError(null);
    try {
      const res = await api.bidding.search({
        keyword: keyword.trim() || undefined,
        province: province && province !== "Tất cả" ? province : undefined,
        field: field || undefined,
        min_price: minPrice !== "" ? Number(minPrice) : null,
        max_price: maxPrice !== "" ? Number(maxPrice) : null,
        method: biddingMethod || undefined,
        status: statusFilter !== "all" ? statusFilter : undefined,
        page: targetPage,
        page_size: pageSize,
      });
      setSearchResult(res);
      setPage(targetPage);
    } catch (e) {
      setSearchError((e as Error).message || "Lỗi khi tra cứu gói thầu");
    } finally {
      setSearchLoading(false);
    }
  };

  const handleResetFilters = () => {
    setKeyword("");
    setProvince("");
    setField("");
    setMinPrice("");
    setMaxPrice("");
    setBiddingMethod("");
    setStatusFilter("all");
    setPage(1);
  };

  // Bookmarks Handlers
  const fetchBookmarks = async () => {
    setBookmarksLoading(true);
    try {
      const res = await api.bidding.listBookmarks();
      const list = Array.isArray(res) ? res : (res as any)?.items || [];
      setBookmarks(list);
    } catch (e) {
      console.error("Failed to load bookmarks:", e);
    } finally {
      setBookmarksLoading(false);
    }
  };

  const handleUpdateBookmarkStatus = async (id: number, newStatus: BookmarkStatusKey) => {
    try {
      const updated = await api.bidding.updateBookmark(id, { status: newStatus });
      setBookmarks((prev) => prev.map((b) => (b.id === id ? updated : b)));
      toast.success(`Đã chuyển trạng thái sang "${BOOKMARK_STATUS_MAP[newStatus].label}"`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleDeleteBookmark = async (id: number, name: string) => {
    const accepted = await askConfirm({
      title: "Xóa gói thầu quan tâm",
      message: `Bạn có chắc muốn xóa gói thầu "${name}" khỏi danh sách theo dõi?`,
      confirmLabel: "Xóa",
      tone: "danger",
    });
    if (!accepted) return;
    try {
      await api.bidding.deleteBookmark(id);
      setBookmarks((prev) => prev.filter((b) => b.id !== id));
      toast.info("Đã xóa gói thầu khỏi danh sách theo dõi");
      if (searchResult) {
        setSearchResult({
          ...searchResult,
          items: searchResult.items.map((it) =>
            it.bookmark_id === id
              ? { ...it, is_bookmarked: false, bookmark_id: null, bookmark_status: null }
              : it,
          ),
        });
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleSaveBookmark = async () => {
    if (!bookmarkModalItem) return;
    try {
      const { tender, status, note, existingId } = bookmarkModalItem;
      if (existingId) {
        const updated = await api.bidding.updateBookmark(existingId, { status, note });
        setBookmarks((prev) => prev.map((b) => (b.id === existingId ? updated : b)));
        toast.success("Đã cập nhật thông tin gói thầu quan tâm");
      } else {
        const createPayload: BiddingBookmarkCreate = {
          tbmt_code: tender.tbmt_code,
          tender_name: tender.tender_name,
          procuring_entity: tender.procuring_entity,
          investor: tender.investor,
          field: tender.field,
          bid_price: tender.bid_price,
          bid_deadline: tender.bid_deadline,
          bid_opening_date: tender.bid_opening_date,
          province: tender.province,
          bidding_method: tender.bidding_method,
          source_url: tender.source_url,
          status,
          note,
        };
        const created = await api.bidding.createBookmark(createPayload);
        setBookmarks((prev) => [created, ...prev]);
        toast.success("Đã lưu gói thầu vào danh sách quan tâm");

        if (searchResult) {
          setSearchResult({
            ...searchResult,
            items: searchResult.items.map((it) =>
              it.tbmt_code === tender.tbmt_code
                ? { ...it, is_bookmarked: true, bookmark_id: created.id, bookmark_status: status }
                : it,
            ),
          });
        }
      }
      setBookmarkModalItem(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  // Watchlist Handlers
  const fetchWatchlist = async () => {
    setWatchlistLoading(true);
    try {
      const res = await api.bidding.listWatchlist();
      const list = Array.isArray(res) ? res : (res as any)?.items || [];
      setWatchlists(list);
    } catch (e) {
      console.error("Failed to load watchlist:", e);
    } finally {
      setWatchlistLoading(false);
    }
  };

  const handleToggleWatchlistActive = async (rule: BiddingWatchlistItem) => {
    try {
      const updated = await api.bidding.updateWatchlist(rule.id, {
        is_active: !rule.is_active,
      });
      setWatchlists((prev) => prev.map((w) => (w.id === rule.id ? updated : w)));
      toast.info(`Đã ${updated.is_active ? "bật" : "tắt"} quét tự động cho "${rule.name}"`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleToggleWatchlistTelegram = async (rule: BiddingWatchlistItem) => {
    try {
      const updated = await api.bidding.updateWatchlist(rule.id, {
        notify_telegram: !rule.notify_telegram,
      });
      setWatchlists((prev) => prev.map((w) => (w.id === rule.id ? updated : w)));
      toast.info(
        `Đã ${updated.notify_telegram ? "bật" : "tắt"} cảnh báo Telegram cho "${rule.name}"`,
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleDeleteWatchlist = async (id: number, name: string) => {
    const accepted = await askConfirm({
      title: "Xóa quy tắc quét tự động",
      message: `Bạn có chắc muốn xóa quy tắc quét "${name}"?`,
      confirmLabel: "Xóa",
      tone: "danger",
    });
    if (!accepted) return;
    try {
      await api.bidding.deleteWatchlist(id);
      setWatchlists((prev) => prev.filter((w) => w.id !== id));
      toast.info("Đã xóa quy tắc quét");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleScanRule = async (id: number) => {
    setScanningId(id);
    try {
      const res = await api.bidding.scanWatchlist(id);
      const count = res.new_tenders_found ?? res.count_new ?? res.matched_count ?? 0;
      const sent = res.alerts_sent ?? res.new_alerts_sent ?? 0;
      toast.success(
        res.message ||
          `Quét thành công! Tìm thấy ${count} gói thầu mới${sent > 0 ? ` (đã gửi ${sent} cảnh báo Telegram)` : ""}`,
      );
      fetchWatchlist();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setScanningId(null);
    }
  };

  const handleScanAll = async () => {
    setScanningId("all");
    try {
      const res = await api.bidding.scanAllWatchlists();
      const count = res.new_tenders_found ?? res.count_new ?? res.matched_count ?? 0;
      const sent = res.alerts_sent ?? res.new_alerts_sent ?? 0;
      toast.success(
        res.message ||
          `Quét hoàn tất tất cả bộ lọc! Tìm thấy ${count} gói thầu mới${sent > 0 ? ` (đã gửi ${sent} cảnh báo Telegram)` : ""}`,
      );
      fetchWatchlist();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setScanningId(null);
    }
  };

  const handleSaveWatchlistRule = async () => {
    if (!watchlistModalRule || !watchlistModalRule.name?.trim()) {
      toast.warning("Vui lòng nhập tên quy tắc bộ lọc");
      return;
    }
    try {
      const payload: BiddingWatchlistCreate = {
        name: watchlistModalRule.name,
        keyword: watchlistModalRule.keyword || "",
        province: watchlistModalRule.province || "",
        field: watchlistModalRule.field || "",
        min_price:
          watchlistModalRule.min_price != null ? Number(watchlistModalRule.min_price) : null,
        max_price:
          watchlistModalRule.max_price != null ? Number(watchlistModalRule.max_price) : null,
        method: watchlistModalRule.method || "",
        notify_telegram: watchlistModalRule.notify_telegram ?? true,
        is_active: watchlistModalRule.is_active ?? true,
      };
      if (watchlistModalRule.id) {
        const updated = await api.bidding.updateWatchlist(watchlistModalRule.id, payload);
        setWatchlists((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
        toast.success("Đã cập nhật quy tắc quét");
      } else {
        const created = await api.bidding.createWatchlist(payload);
        setWatchlists((prev) => [created, ...prev]);
        toast.success("Đã tạo mới quy tắc săn thầu tự động");
      }
      setWatchlistModalRule(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  // Contractors & Won Packages Handlers
  const handleFetchWonPackages = async (query = "", fieldVal = "") => {
    setWonPackagesLoading(true);
    try {
      const [resPackages] = await Promise.all([
        api.bidding.getWonPackages(query, fieldVal),
        api.bidding.getPlaybook().catch(() => null),
      ]);
      setWonPackagesResult(resPackages);
    } catch (e: any) {
      toast.error(e.message || "Lỗi tải kho gói thầu đã trúng");
    } finally {
      setWonPackagesLoading(false);
    }
  };

  const handleScanCrmContractors = async () => {
    setCrmScanLoading(true);
    try {
      const res = await api.bidding.scanCrmContractors();
      setCrmScanResult(res);
      toast.success(`Đã quét đối soát ${res.total_crm_customers} khách hàng CRM!`);
    } catch (e: any) {
      toast.error(e.message || "Lỗi quét khách hàng CRM");
    } finally {
      setCrmScanLoading(false);
    }
  };

  const handleSearchContractorsDirect = async (query: string) => {
    const q = query.trim();
    if (!q) {
      handleScanCrmContractors();
      return;
    }
    setCrmScanLoading(true);
    try {
      const list = await api.bidding.searchContractors(q);
      if (list.length > 0) {
        const totalWonVal = list.reduce((sum, i) => sum + i.total_won_value_vnd, 0);
        setCrmScanResult((prev) => ({
          total_crm_customers: prev?.total_crm_customers || list.length,
          total_won_contractors: list.filter((i) => i.total_won > 0).length,
          total_won_value_vnd: totalWonVal,
          total_won_value_formatted: formatVnd(totalWonVal),
          items: list,
        }));
        toast.success(`Tìm thấy ${list.length} nhà thầu phù hợp với "${q}"`);
      } else {
        setCrmScanResult({
          total_crm_customers: 0,
          total_won_contractors: 0,
          total_won_value_vnd: 0,
          total_won_value_formatted: "0 ₫",
          items: [],
        });
        toast.info(`Không tìm thấy dữ liệu cho từ khóa "${q}"`);
      }
    } catch (e: any) {
      toast.error(e.message || "Lỗi tìm kiếm nhà thầu");
    } finally {
      setCrmScanLoading(false);
    }
  };

  // Detail & AI Handlers
  const handleOpenAiAnalysis = async (tender: BiddingTenderSummary) => {
    setAiModalTender(tender);
    setAiModalResult(null);
    setAiError(null);
    setAiLoading(true);
    try {
      const res = await api.bidding.analyzeAI(tender.tbmt_code, aiCustomContext);
      setAiModalResult(res);
    } catch (e) {
      setAiError((e as Error).message || "Không thể phân tích AI");
    } finally {
      setAiLoading(false);
    }
  };

  const handleOpenContractorDossier = async (taxCode: string, skipUrlSync = false) => {
    try {
      const profile = await api.bidding.getContractorProfile(taxCode);
      if (profile) {
        setSelectedContractorDetail(profile as any);
        if (!skipUrlSync) {
          syncBiddingUrl(activeTab, contractorSubTab, null, "info", taxCode);
        }
      }
    } catch (e) {
      toast.error((e as Error).message || "Không thể tải hồ sơ nhà thầu");
    }
  };

  const handleOpenTenderDetail = async (
    tbmtCode: string,
    initialTab: DetailModalTab = "info",
    skipUrlSync = false,
  ) => {
    setDetailModalLoading(true);
    setDetailModalTender(null);
    setDetailModalTab(initialTab);
    if (!skipUrlSync) {
      syncBiddingUrl(activeTab, contractorSubTab, tbmtCode, initialTab);
    }
    try {
      const [detail, atts, comps] = await Promise.all([
        api.bidding.getTender(tbmtCode),
        api.bidding.getAttachments(tbmtCode).catch(() => []),
        api.bidding.getCompetitors(tbmtCode).catch(() => []),
      ]);
      setDetailModalTender(detail);
      setModalAttachments(atts);
      setModalCompetitors(comps);
    } catch (e) {
      toast.error((e as Error).message || "Không thể tải chi tiết gói thầu");
    } finally {
      setDetailModalLoading(false);
    }
  };

  const handleOpenExternalPortal = (tbmtCode: string, sourceUrl?: string) => {
    copyToClipboard(tbmtCode);
    toast.success(
      `Đã tự động sao chép mã ${tbmtCode} vào Clipboard! Bạn chỉ cần Paste (Ctrl+V) vào ô tìm kiếm trên Cổng Mua Sắm Công.`,
    );
    openExternalSafe(
      safeHttpUrl(sourceUrl) ||
        "https://muasamcong.mpi.gov.vn/web/guest/contractor-selection",
    );
  };

  const handleShareAiTelegram = (
    tender: BiddingTenderSummary | null,
    analysis: BiddingAIAnalysisData,
  ) => {
    const fit = analysis.inut_fit_analysis;
    const score = fit?.score ?? analysis.inut_compatibility_score ?? 85;
    const rec =
      fit?.recommendation || (score >= 80 ? "Nên tham gia độc lập" : "Khuyến nghị liên danh");
    const tgText = [
      "*[AI BIDDING RADAR]* Cảnh Báo Gói Thầu Tiềm Năng",
      `- *Gói thầu*: ${tender?.tender_name || "—"}`,
      `- *Mã TBMT*: \`${tender?.tbmt_code || "—"}\``,
      `- *Dự toán*: ${formatVnd(tender?.bid_price)}`,
      `- *Hạn nộp*: ${formatDate(tender?.bid_deadline)} (${tender?.province || "Toàn quốc"})`,
      `- *Điểm tương thích INUT*: *${score}/100* (${rec})`,
      `- *Đánh giá*: ${analysis.executive_summary || analysis.summary || "Đánh giá chi tiết năng lực dự thầu."}`,
    ].join("\n");
    copyToClipboard(tgText);
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(safeHttpUrl(tender?.source_url) || "https://muasamcong.mpi.gov.vn")}&text=${encodeURIComponent(tgText)}`;
    openExternalSafe(shareUrl);
    toast.success("Đã sao chép nội dung và mở cửa sổ gửi cảnh báo Telegram!");
  };

  const handleShareContractorTelegram = (c: BiddingContractorItem) => {
    const tgText = [
      "*[TÌNH BÁO NHÀ THẦU]* Hồ Sơ Năng Lực Doanh Nghiệp",
      `- *Doanh nghiệp*: *${c.name}* (MST: \`${c.tax_code}\`)`,
      `- *Phân loại*: ${c.bidding_status_label}`,
      `- *Thống kê*: ${c.total_won}/${c.total_bids} gói (*Win Rate: ${c.win_rate_percent}%*)`,
      `- *Tổng giá trị trúng*: *${c.total_won_value_formatted}* (Giảm giá TB: ${c.average_discount_percent > 0 ? `${c.average_discount_percent}%` : "—"})`,
      c.top_procuring_entities?.length
        ? `- *Chủ đầu tư ruột*: ${c.top_procuring_entities.slice(0, 3).join(", ")}`
        : "",
      c.ai_insight ? `- *AI Insight*: ${c.ai_insight}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    copyToClipboard(tgText);
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent("https://muasamcong.mpi.gov.vn")}&text=${encodeURIComponent(tgText)}`;
    openExternalSafe(shareUrl);
    toast.success(`Đã sao chép cảnh báo Telegram cho nhà thầu ${c.name}!`);
  };

  // Deep subpath initialization
  useEffect(() => {
    const pathname = window.location.pathname;
    const tenderMatch = pathname.match(
      /(?:\/bidding|\/dau-thau)\/tender\/([^/]+)(?:\/(attachments|competitors|portal|info))?/,
    );
    if (tenderMatch) {
      const code = decodeURIComponent(tenderMatch[1]);
      const sub: DetailModalTab =
        tenderMatch[2] === "portal" ? "iframe" : (tenderMatch[2] as DetailModalTab) || "info";
      handleOpenTenderDetail(code, sub, true);
      return;
    }
    const contractorMatch = pathname.match(/(?:\/bidding|\/dau-thau)\/contractor\/([^/]+)/);
    if (contractorMatch) {
      setActiveTab("contractors");
      setContractorSubTab("crm_contractors");
      handleOpenContractorDossier(decodeURIComponent(contractorMatch[1]), true);
      return;
    }
    if (pathname.includes("/won-packages") || pathname.includes("/goi-trung")) {
      setActiveTab("contractors");
      setContractorSubTab("won_packages_playbook");
    } else if (pathname.includes("/contractors") || pathname.includes("/nha-thau")) {
      setActiveTab("contractors");
      setContractorSubTab("crm_contractors");
    } else if (pathname.includes("/bookmarks") || pathname.includes("/quan-tam")) {
      setActiveTab("bookmarks");
    } else if (pathname.includes("/watchlists") || pathname.includes("/canh-bao")) {
      setActiveTab("watchlist");
    } else if (
      pathname.includes("/dossier") ||
      pathname.includes("/tham-dinh") ||
      pathname.includes("/review")
    ) {
      setActiveTab("dossier_reviews");
      fetchDossierReviews(true);
    } else if (pathname.includes("/search") || pathname.includes("/tra-cuu")) {
      setActiveTab("search");
    }
    fetchDossierReviews(false);
  }, []);

  // Debounced live contractor search
  useEffect(() => {
    if (activeTab !== "contractors") return;
    if (!crmScanResult && !contractorSearchQuery.trim()) {
      handleScanCrmContractors();
      return;
    }
    if (prevContractorQueryRef.current !== contractorSearchQuery) {
      prevContractorQueryRef.current = contractorSearchQuery;
      const timer = window.setTimeout(() => {
        const q = contractorSearchQuery.trim();
        if (q) {
          handleSearchContractorsDirect(q);
        } else {
          handleScanCrmContractors();
        }
      }, 300);
      return () => window.clearTimeout(timer);
    }
  }, [contractorSearchQuery, activeTab, crmScanResult]);

  // Initial Data Load
  useEffect(() => {
    handleSearch(1);
    fetchBookmarks();
    fetchWatchlist();
  }, []);

  const filteredBookmarks = useMemo(() => {
    return bookmarks.filter((b) => {
      const matchStatus =
        bookmarkPipelineFilter === "all" || b.status === bookmarkPipelineFilter;
      const q = bookmarkSearchKeyword.trim().toLowerCase();
      const matchText =
        !q ||
        b.tender_name.toLowerCase().includes(q) ||
        b.tbmt_code.toLowerCase().includes(q) ||
        b.procuring_entity.toLowerCase().includes(q) ||
        b.province.toLowerCase().includes(q);
      return matchStatus && matchText;
    });
  }, [bookmarks, bookmarkPipelineFilter, bookmarkSearchKeyword]);

  return (
    <PageShell data-page="bidding">
      <div className="ui-stack--lg">
        <PageHeader
          variant="compact"
          icon="gavel"
          eyebrow="MẠNG ĐẤU THẦU QUỐC GIA (E-GP) — MUASAMCONG.MPI.GOV.VN"
          title="Săn Gói Thầu & Phân Tích E-HSMT Bằng AI"
          subtitle={
            <>
              Hệ thống tự động quét, trích xuất dữ liệu năng lực, tính điểm tương thích chiến lược
              INUT <strong>(MST 4401053694)</strong> và gửi cảnh báo thời gian thực qua Telegram
              Bot.
            </>
          }
          actions={
            <>
              <StatusBadge tone="info" icon="bell" size="sm">
                {watchlists.filter((w) => w.is_active).length} bộ lọc tự động
              </StatusBadge>
              <AppButton
                variant="gold"
                leftIcon="zap"
                loading={scanningId === "all"}
                disabled={scanningId !== null}
                onClick={handleScanAll}
              >
                {scanningId === "all" ? "Đang quét..." : "Quét Tự Động Ngay"}
              </AppButton>
            </>
          }
        />

        <ResponsiveTabs
          ariaLabel="Chuyển mục săn thầu & thẩm định"
          active={activeTab}
          onChange={(tabId) => {
            setActiveTab(tabId);
            syncBiddingUrl(tabId, contractorSubTab);
            if (tabId === "bookmarks") {
              fetchBookmarks();
            } else if (tabId === "contractors") {
              if (!crmScanResult) handleScanCrmContractors();
              if (!wonPackagesResult) handleFetchWonPackages();
            } else if (tabId === "watchlist") {
              fetchWatchlist();
            } else if (tabId === "dossier_reviews") {
              fetchDossierReviews();
            }
          }}
          tabs={[
            {
              id: "search",
              label: "Tra Cứu Gói Thầu",
              icon: "search",
              badge: searchResult ? searchResult.total : undefined,
            },
            {
              id: "bookmarks",
              label: "Gói Thầu Quan Tâm",
              icon: "star",
              badge: bookmarks.length,
            },
            {
              id: "contractors",
              label: "Năng Lực Nhà Thầu & CRM",
              icon: "building-2",
              badge: crmScanResult ? crmScanResult.total_won_contractors : "CRM",
            },
            {
              id: "watchlist",
              label: "Bộ Lọc Tự Động & Cảnh Báo",
              icon: "bell",
              badge: watchlists.length,
            },
            {
              id: "dossier_reviews",
              label: "Thẩm Định Hồ Sơ Thầu",
              icon: "clipboard-check",
              badge:
                dossierReviews.length > 0 ? `${dossierReviews[0].overall_score}/100` : "Mới",
            },
          ]}
        />

        {activeTab === "search" && (
          <SearchTab
            keyword={keyword}
            setKeyword={setKeyword}
            province={province}
            setProvince={setProvince}
            field={field}
            setField={setField}
            minPrice={minPrice}
            setMinPrice={setMinPrice}
            maxPrice={maxPrice}
            setMaxPrice={setMaxPrice}
            biddingMethod={biddingMethod}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            showAdvancedFilters={showAdvancedFilters}
            setShowAdvancedFilters={setShowAdvancedFilters}
            page={page}
            searchLoading={searchLoading}
            searchResult={searchResult}
            searchError={searchError}
            bookmarks={bookmarks}
            onSearch={handleSearch}
            onResetFilters={handleResetFilters}
            onSetPricePreset={(min, max) => {
              setMinPrice(min);
              setMaxPrice(max);
            }}
            onOpenDetail={(code) => handleOpenTenderDetail(code)}
            onOpenAiAnalysis={handleOpenAiAnalysis}
            onOpenBookmarkModal={setBookmarkModalItem}
            onOpenExternalPortal={handleOpenExternalPortal}
          />
        )}

        {activeTab === "bookmarks" && (
          <BookmarksTab
            bookmarks={bookmarks}
            filteredBookmarks={filteredBookmarks}
            bookmarksLoading={bookmarksLoading}
            pipelineFilter={bookmarkPipelineFilter}
            setPipelineFilter={setBookmarkPipelineFilter}
            searchKeyword={bookmarkSearchKeyword}
            setSearchKeyword={setBookmarkSearchKeyword}
            onUpdateStatus={handleUpdateBookmarkStatus}
            onEditNote={setNotePromptBookmark}
            onDelete={handleDeleteBookmark}
            onOpenDetail={(code) => handleOpenTenderDetail(code)}
            onOpenAiAnalysis={handleOpenAiAnalysis}
            onGoSearch={() => {
              setActiveTab("search");
              syncBiddingUrl("search", contractorSubTab);
            }}
          />
        )}

        {activeTab === "watchlist" && (
          <div className="ui-stack--lg">
            <KpiStrip
              columns={3}
              loading={watchlistLoading && watchlists.length === 0}
              items={[
                {
                  label: "Tổng quy tắc quét",
                  value: watchlists.length,
                  sub: "Bộ lọc săn thầu đã cấu hình",
                  icon: "sliders-horizontal",
                  tone: "brand",
                },
                {
                  label: "Đang hoạt động",
                  value: watchlists.filter((w) => w.is_active).length,
                  sub: "Tự động kiểm tra gói mới",
                  icon: "activity",
                  tone: "success",
                },
                {
                  label: "Cảnh báo Telegram",
                  value: watchlists.filter((w) => w.notify_telegram).length,
                  sub: "Gửi tin nhắn thời gian thực",
                  icon: "send",
                  tone: "info",
                },
              ]}
            />
            <WatchlistTab
              watchlists={watchlists}
              watchlistLoading={watchlistLoading}
              scanningId={scanningId}
              onAddNew={(preset) => setWatchlistModalRule(preset || {})}
              onEdit={(rule) => setWatchlistModalRule(rule)}
              onScanAll={handleScanAll}
              onScanRule={handleScanRule}
              onToggleActive={handleToggleWatchlistActive}
              onToggleTelegram={handleToggleWatchlistTelegram}
              onDelete={handleDeleteWatchlist}
            />
          </div>
        )}

        {activeTab === "contractors" && (
          <ContractorsTab
            contractorSubTab={contractorSubTab}
            onChangeSubTab={(subId) => {
              setContractorSubTab(subId);
              syncBiddingUrl("contractors", subId);
              if (subId === "won_packages_playbook") {
                if (!wonPackagesResult) handleFetchWonPackages();
              } else if (!crmScanResult) {
                handleScanCrmContractors();
              }
            }}
            wonPackagesResult={wonPackagesResult}
            wonPackagesLoading={wonPackagesLoading}
            wonPackagesQuery={wonPackagesQuery}
            setWonPackagesQuery={setWonPackagesQuery}
            wonPackagesFieldFilter={wonPackagesFieldFilter}
            setWonPackagesFieldFilter={setWonPackagesFieldFilter}
            onFetchWonPackages={handleFetchWonPackages}
            crmScanResult={crmScanResult}
            crmScanLoading={crmScanLoading}
            contractorSearchQuery={contractorSearchQuery}
            setContractorSearchQuery={setContractorSearchQuery}
            contractorCategoryFilter={contractorCategoryFilter}
            setContractorCategoryFilter={setContractorCategoryFilter}
            onScanCrmContractors={handleScanCrmContractors}
            onSearchContractorsDirect={handleSearchContractorsDirect}
            onOpenTenderDetail={(code, tab) => handleOpenTenderDetail(code, tab)}
            onOpenContractorDetail={(c) => {
              setSelectedContractorDetail(c);
              syncBiddingUrl(activeTab, contractorSubTab, null, "info", c.tax_code);
            }}
          />
        )}

        {activeTab === "dossier_reviews" && (
          <>
            {dossierLoading && !activeDossierReview ? (
              <SectionCard>
                <div className="ui-stack">
                  <SkeletonBlock variant="title" />
                  <SkeletonBlock variant="card" />
                  <SkeletonBlock variant="line" lines={3} />
                </div>
              </SectionCard>
            ) : !activeDossierReview ? (
              <SectionCard>
                <EmptyState
                  icon="clipboard-check"
                  title="Chưa có báo cáo thẩm định hồ sơ thầu nào"
                  description="Nhập đường dẫn thư mục Google Drive chứa hồ sơ dự thầu để khởi chạy quy trình thẩm định đa tác nhân."
                  action={
                    <AppButton
                      variant="primary"
                      leftIcon="plus"
                      onClick={() => setShowImportDriveModal(true)}
                    >
                      Thẩm Định Thầu Mới (Nhập Link Google Drive)
                    </AppButton>
                  }
                />
              </SectionCard>
            ) : (
              <DossierReviewTab
                dossierReviews={dossierReviews}
                activeDossierReview={activeDossierReview}
                dossierSubTab={dossierSubTab}
                setDossierSubTab={setDossierSubTab}
                onSelectDossierReview={handleSelectDossierReview}
                onOpenImportDrive={() => setShowImportDriveModal(true)}
                onCopyDiscountLetter={() => {
                  const letter = `THƯ GIẢM GIÁ\nKính gửi: Công ty TNHH MTV Quản lý, khai thác công trình thủy lợi Sơn La\nGói thầu: Lắp đặt thiết bị quan trắc khí tượng thuỷ văn chuyên dùng và tài nguyên nước các hồ chứa (Bản Mòn, Suối Hòm, Suối Chiếu, Chiềng Khoi)\nMã TBMT: IB2600557773\n\nNhà thầu CÔNG TY CỔ PHẦN KỸ THUẬT TỰ ĐỘNG HÓA IOT tự nguyện giảm giá 6.0% trên tổng giá dự thầu.\nGiá sau giảm giá: 1.123.206.000 VNĐ (Một tỷ một trăm hai mươi ba triệu hai trăm linh sáu nghìn đồng).`;
                  copyToClipboard(letter);
                  toast.success("Đã sao chép Mẫu Thư giảm giá vào Clipboard!");
                }}
              />
            )}
          </>
        )}
      </div>

      {/* Modals */}
      <ContractorDetailModal
        contractor={selectedContractorDetail}
        onClose={() => setSelectedContractorDetail(null)}
        onOpenTenderDetail={(code, tab) => handleOpenTenderDetail(code, tab)}
        onCopyMarkdown={(md, name) => {
          copyToClipboard(md);
          toast.success(`Đã sao chép Hồ sơ Năng lực (Markdown) của ${name}!`);
        }}
        onShareTelegram={handleShareContractorTelegram}
      />

      <TenderDetailModal
        tender={detailModalTender}
        loading={detailModalLoading}
        activeTab={detailModalTab}
        onChangeTab={(t) => {
          setDetailModalTab(t);
          if (detailModalTender) {
            syncBiddingUrl(activeTab, contractorSubTab, detailModalTender.tbmt_code, t);
          }
        }}
        attachments={modalAttachments}
        competitors={modalCompetitors}
        bookmarks={bookmarks}
        onClose={() => {
          setDetailModalTender(null);
          setDetailModalLoading(false);
          syncBiddingUrl(activeTab, contractorSubTab, null);
        }}
        onOpenAiAnalysis={handleOpenAiAnalysis}
        onOpenBookmarkModal={setBookmarkModalItem}
        onOpenExternalPortal={handleOpenExternalPortal}
      />

      <AiAnalysisModal
        tender={aiModalTender}
        result={aiModalResult}
        loading={aiLoading}
        error={aiError}
        bookmarks={bookmarks}
        onClose={() => {
          setAiModalTender(null);
          setAiModalResult(null);
        }}
        onCopyMarkdown={(md) => {
          copyToClipboard(md);
          toast.success("Đã sao chép Báo Cáo Phân Tích AI HSMT (Markdown) vào Clipboard!");
        }}
        onShareTelegram={handleShareAiTelegram}
        onSaveToBookmark={setBookmarkModalItem}
      />

      <BookmarkFormModal
        item={bookmarkModalItem}
        setItem={setBookmarkModalItem}
        onSave={handleSaveBookmark}
      />

      <WatchlistFormModal
        rule={watchlistModalRule}
        setRule={setWatchlistModalRule}
        onSave={handleSaveWatchlistRule}
      />

      <ImportDriveModal
        open={showImportDriveModal}
        url={importDriveUrl}
        setUrl={setImportDriveUrl}
        notes={importDriveNotes}
        setNotes={setImportDriveNotes}
        loading={importDriveLoading}
        onClose={() => setShowImportDriveModal(false)}
        onSubmit={handleImportDossierFromDrive}
      />

      <PromptDialog
        open={Boolean(notePromptBookmark)}
        title="Sửa ghi chú chiến lược dự thầu"
        label="Nhập ghi chú chiến lược dự thầu:"
        defaultValue={notePromptBookmark?.note || ""}
        placeholder="Nhập phân công, phương án tính giá hoặc ghi nhớ đối tác..."
        confirmLabel="Lưu ghi chú"
        onCancel={() => setNotePromptBookmark(null)}
        onConfirm={(newNote) => {
          if (!notePromptBookmark) return;
          const target = notePromptBookmark;
          setNotePromptBookmark(null);
          api.bidding
            .updateBookmark(target.id, { note: newNote })
            .then((up) => {
              setBookmarks((prev) =>
                prev.map((item) => (item.id === target.id ? up : item)),
              );
              toast.success("Đã cập nhật ghi chú");
            })
            .catch((e) => toast.error(e.message));
        }}
      />
    </PageShell>
  );
}
