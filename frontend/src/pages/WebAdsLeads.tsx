import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type WebAdsDraftQuote,
  type WebAdsLead,
  type WebAdsLeadDetail,
  type WebAdsOverview,
  type WebLeadStatus,
} from "../api";
import {
  AppButton,
  EmptyState,
  FilterBar,
  InlineAlert,
  KpiStrip,
  PageHeader,
  PageShell,
  ResponsiveTabs,
  SkeletonBlock,
  StatusBadge,
  TableSkeleton,
  useConfirm,
  useToast,
  type KpiItem,
  type ResponsiveTabItem,
} from "../components/ui";
import { copyText } from "../util";
import { WebAdsAnalyticsSection } from "./webads/WebAdsAnalyticsSection";
import { WebAdsLeadDetailModal } from "./webads/WebAdsLeadDetailModal";
import { WebAdsLeadsTable } from "./webads/WebAdsLeadsTable";
import {
  CANONICAL_SKUS,
  DAY_OPTIONS,
  PRODUCT_OPTIONS,
  STATUS_META,
  STATUS_ORDER,
  fmtPct,
  type SkuDemandRow,
} from "./webads/webAdsMeta";

type WebAdsViewTab = "leads" | "analytics";

export function WebAdsLeads({
  onCreateQuote,
}: {
  onCreateQuote: (draft: WebAdsDraftQuote) => void;
}) {
  const toast = useToast();
  const confirmDialog = useConfirm();

  // Active sub-view tab
  const [activeTab, setActiveTab] = useState<WebAdsViewTab>("leads");

  // Filters
  const [days, setDays] = useState<number>(30);
  const [productKey, setProductKey] = useState<string>("");
  const [utmCampaign, setUtmCampaign] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [searchInput, setSearchInput] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [offset, setOffset] = useState<number>(0);
  const limit = 50;

  // Data
  const [overview, setOverview] = useState<WebAdsOverview | null>(null);
  const [leads, setLeads] = useState<WebAdsLead[]>([]);
  const [leadsTotal, setLeadsTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string>("");
  const [digestBusy, setDigestBusy] = useState<boolean>(false);
  const [copiedLeadId, setCopiedLeadId] = useState<number | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<number | null>(null);

  // Detail modal
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [detail, setDetail] = useState<WebAdsLeadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [detailErr, setDetailErr] = useState<string>("");
  const [noteDraft, setNoteDraft] = useState<string>("");
  const [savingNote, setSavingNote] = useState<boolean>(false);
  const [actionBusy, setActionBusy] = useState<"customer" | "quote" | "delete" | null>(
    null,
  );

  // Debounce search input
  useEffect(() => {
    const t = window.setTimeout(() => {
      setOffset(0);
      setSearchQuery(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const [ov, list] = await Promise.all([
        api.webAdsOverview({
          days,
          product_key: productKey || undefined,
          utm_campaign: utmCampaign || undefined,
        }),
        api.webAdsLeads({
          status: statusFilter || undefined,
          product_key: productKey || undefined,
          utm_campaign: utmCampaign || undefined,
          q: searchQuery || undefined,
          limit,
          offset,
        }),
      ]);
      setOverview(ov && typeof ov === "object" ? ov : null);
      const leadItems = Array.isArray(list?.items) ? list.items : [];
      setLeads(leadItems);
      setLeadsTotal(typeof list?.total === "number" ? list.total : leadItems.length);
    } catch (e) {
      const msg = (e as Error).message || "Không thể tải dữ liệu Ads & Leads";
      setErr(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [days, productKey, utmCampaign, statusFilter, searchQuery, offset, toast]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const openLeadDetail = useCallback(async (leadId: number) => {
    setSelectedLeadId(leadId);
    setDetailLoading(true);
    setDetailErr("");
    try {
      const d = await api.webAdsLeadDetail(leadId);
      setDetail(d);
      setNoteDraft(d?.note || "");
    } catch (e) {
      setDetailErr((e as Error).message || "Không thể tải chi tiết lead");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  async function handleSendDigest() {
    setDigestBusy(true);
    setErr("");
    try {
      const res = await api.sendWebAdsDailyDigest(1);
      const t = res?.summary?.totals;
      const statsText = t
        ? ` (24h: ${t.pageviews ?? 0} xem · ${t.price_views ?? 0} xem giá · ${(t.call_clicks ?? 0) + (t.zalo_clicks ?? 0)} Gọi/Zalo · ${t.leads ?? 0} lead)`
        : "";
      if (res?.sent) {
        toast.success(
          `Đã gửi báo cáo Telegram tới ${res.delivered_count ?? 0} tài khoản.${statsText}`,
        );
      } else {
        toast.info(
          `Đã tổng hợp báo cáo${statsText} — Telegram chưa bật hoặc chưa có tài khoản nhận.`,
        );
      }
    } catch (e) {
      const msg = `Gửi báo cáo Telegram thất bại: ${(e as Error).message}`;
      setErr(msg);
      toast.error(msg);
    } finally {
      setDigestBusy(false);
    }
  }

  async function handleStatusChange(leadId: number, nextStatus: WebLeadStatus) {
    setStatusBusyId(leadId);
    setErr("");
    try {
      const updated = await api.updateWebAdsLead(leadId, { status: nextStatus });
      setLeads((prev) =>
        prev.map((item) =>
          item.id === leadId ? { ...item, ...updated, status: nextStatus } : item,
        ),
      );
      if (detail && detail.id === leadId) {
        setDetail((prev) =>
          prev ? { ...prev, ...updated, status: nextStatus } : prev,
        );
      }
      toast.success(
        `Đã chuyển Lead #${leadId} sang trạng thái "${STATUS_META[nextStatus].label}".`,
      );
    } catch (e) {
      const msg = `Không thể cập nhật trạng thái lead #${leadId}: ${(e as Error).message}`;
      setErr(msg);
      toast.error(msg);
    } finally {
      setStatusBusyId(null);
    }
  }

  async function handleSaveNote() {
    if (!detail) return;
    setSavingNote(true);
    setDetailErr("");
    try {
      const updated = await api.updateWebAdsLead(detail.id, { note: noteDraft });
      setDetail((prev) => (prev ? { ...prev, ...updated, note: noteDraft } : prev));
      setLeads((prev) =>
        prev.map((item) =>
          item.id === detail.id ? { ...item, note: noteDraft } : item,
        ),
      );
      toast.success(`Đã lưu ghi chú nội bộ cho Lead #${detail.id}.`);
    } catch (e) {
      const msg = (e as Error).message || "Không thể lưu ghi chú";
      setDetailErr(msg);
      toast.error(msg);
    } finally {
      setSavingNote(false);
    }
  }

  async function handleCreateCustomer() {
    if (!detail) return;
    setActionBusy("customer");
    setDetailErr("");
    try {
      const res = await api.createCustomerFromWebLead(detail.id);
      const custName = res?.customer?.name || detail.name;
      setDetail((prev) =>
        prev
          ? { ...prev, customer_id: res.customer_id, customer_name: custName }
          : prev,
      );
      setLeads((prev) =>
        prev.map((item) =>
          item.id === detail.id
            ? { ...item, customer_id: res.customer_id, customer_name: custName }
            : item,
        ),
      );
      toast.success(
        res.created
          ? `Đã tạo khách hàng CRM mới #${res.customer_id} (${custName}).`
          : `Đã liên kết khách hàng CRM sẵn có #${res.customer_id} (${custName}).`,
      );
    } catch (e) {
      const msg = (e as Error).message || "Không thể tạo khách hàng CRM";
      setDetailErr(msg);
      toast.error(msg);
    } finally {
      setActionBusy(null);
    }
  }

  async function handleDraftQuote() {
    if (!detail) return;
    setActionBusy("quote");
    setDetailErr("");
    try {
      const draft = await api.draftQuoteFromWebLead(detail.id);
      setSelectedLeadId(null);
      onCreateQuote(draft);
    } catch (e) {
      const msg = (e as Error).message || "Không thể khởi tạo báo giá PDF";
      setDetailErr(msg);
      toast.error(msg);
    } finally {
      setActionBusy(null);
    }
  }

  async function handleDeleteLead() {
    if (!detail) return;
    const accepted = await confirmDialog({
      title: `Xóa Lead #${detail.id}?`,
      message: `Bạn có chắc chắn muốn xóa Lead "${detail.name || detail.phone || `#${detail.id}`}"? Hành động này không thể hoàn tác.`,
      confirmLabel: "Xóa lead",
      cancelLabel: "Hủy",
      tone: "danger",
    });
    if (!accepted) return;

    setActionBusy("delete");
    setDetailErr("");
    try {
      await api.deleteWebAdsLead(detail.id);
      setSelectedLeadId(null);
      setDetail(null);
      toast.success(`Đã xóa Lead #${detail.id}.`);
      await loadAll();
    } catch (e) {
      const msg = (e as Error).message || "Không thể xóa lead";
      setDetailErr(msg);
      toast.error(msg);
    } finally {
      setActionBusy(null);
    }
  }

  async function handleCopyPhone(leadId: number, phone: string) {
    if (!phone) return;
    await copyText(phone);
    setCopiedLeadId(leadId);
    toast.success(`Đã sao chép SĐT ${phone}`);
    window.setTimeout(() => {
      setCopiedLeadId((cur) => (cur === leadId ? null : cur));
    }, 1600);
  }

  const campaigns = useMemo(
    () => (Array.isArray(overview?.by_campaign) ? overview.by_campaign : []),
    [overview?.by_campaign],
  );

  // Distinct campaign options from overview.filters + by_campaign
  const campaignOptions = useMemo(() => {
    const names = new Set<string>();
    const filterCampaigns = Array.isArray(overview?.filters?.utm_campaigns)
      ? overview.filters.utm_campaigns
      : [];
    for (const c of filterCampaigns) {
      if (c && c !== "(direct)" && c !== "direct") names.add(c);
    }
    for (const row of campaigns) {
      if (
        row.utm_campaign &&
        row.utm_campaign !== "(direct)" &&
        row.utm_campaign !== "direct"
      ) {
        names.add(row.utm_campaign);
      }
    }
    if (utmCampaign) names.add(utmCampaign);
    return Array.from(names).sort();
  }, [overview?.filters?.utm_campaigns, campaigns, utmCampaign]);

  // Merge canonical SKUs with backend SKU stats
  const skuRows = useMemo<SkuDemandRow[]>(() => {
    const map = new Map<string, SkuDemandRow>();

    for (const item of CANONICAL_SKUS) {
      if (productKey && item.productKey !== productKey) continue;
      map.set(item.sku, {
        sku: item.sku,
        label: item.label,
        productKey: item.productKey,
        selects: 0,
        leads: 0,
        totalQuantity: 0,
        estimatedRevenue: 0,
      });
    }

    const backendSkus = Array.isArray(overview?.by_sku) ? overview.by_sku : [];
    for (const row of backendSkus) {
      const code = (row.sku || "").trim();
      if (!code) continue;
      const existing = map.get(code);
      const selects = row.sku_selects ?? 0;
      const rowLeads = row.leads ?? 0;
      const qty = row.total_quantity ?? 0;
      const rev = row.estimated_revenue_vnd ?? 0;
      if (existing) {
        existing.selects += selects;
        existing.leads += rowLeads;
        existing.totalQuantity += qty;
        existing.estimatedRevenue += rev;
      } else {
        map.set(code, {
          sku: code,
          label: row.sku_name || code,
          productKey: row.product_key || "",
          selects,
          leads: rowLeads,
          totalQuantity: qty,
          estimatedRevenue: rev,
        });
      }
    }

    return Array.from(map.values()).sort(
      (a, b) =>
        b.leads - a.leads || b.selects - a.selects || a.sku.localeCompare(b.sku),
    );
  }, [overview?.by_sku, productKey]);

  const maxSkuDemand = useMemo(
    () => Math.max(1, ...skuRows.map((r) => r.leads * 3 + r.selects)),
    [skuRows],
  );

  const totals = overview?.totals;
  const contactClicks = (totals?.call_clicks ?? 0) + (totals?.zalo_clicks ?? 0);

  const kpiItems = useMemo<KpiItem[]>(
    () => [
      {
        label: `Lượt xem (${days} ngày)`,
        value: (totals?.pageviews ?? 0).toLocaleString("vi-VN"),
        sub: `${(totals?.unique_visitors ?? 0).toLocaleString("vi-VN")} khách duy nhất`,
        icon: "eye",
        tone: "brand",
      },
      {
        label: "Xem bảng giá (#price)",
        value: (totals?.price_views ?? 0).toLocaleString("vi-VN"),
        delta: fmtPct(totals?.visit_to_price_rate),
        sub: `Chọn SKU: ${(totals?.sku_selects ?? 0).toLocaleString("vi-VN")}`,
        icon: "tag",
        tone: "warning",
      },
      {
        label: "Bấm Gọi / Zalo",
        value: contactClicks.toLocaleString("vi-VN"),
        sub: `Gọi: ${(totals?.call_clicks ?? 0).toLocaleString("vi-VN")} · Zalo: ${(totals?.zalo_clicks ?? 0).toLocaleString("vi-VN")}`,
        icon: "phone",
        tone: "info",
      },
      {
        label: "Lead gửi form",
        value: (totals?.leads ?? 0).toLocaleString("vi-VN"),
        delta: fmtPct(totals?.price_to_lead_rate),
        sub: `Visit → Lead: ${fmtPct(totals?.visit_to_lead_rate)}`,
        icon: "users",
        tone: "success",
      },
    ],
    [totals, days, contactClicks],
  );

  const tabs = useMemo<Array<ResponsiveTabItem<WebAdsViewTab>>>(
    () => [
      {
        id: "leads",
        label: "Danh sách Lead",
        icon: "users",
        badge: leadsTotal,
      },
      {
        id: "analytics",
        label: "Chiến dịch & SKU",
        icon: "bar-chart",
        badge: campaigns.length,
      },
    ],
    [leadsTotal, campaigns.length],
  );

  const activeFilterCount = [
    productKey,
    utmCampaign,
    statusFilter,
    searchInput.trim(),
  ].filter(Boolean).length;

  const resetFilters = () => {
    setProductKey("");
    setUtmCampaign("");
    setStatusFilter("");
    setSearchInput("");
    setSearchQuery("");
    setOffset(0);
  };

  return (
    <PageShell data-page="webads">
      <PageHeader
        variant="compact"
        icon="trending-up"
        title="Ads & Lead Website"
        subtitle="Phễu chuyển đổi quảng cáo iNut.vn, tín hiệu xem giá và chăm sóc Lead tạo báo giá PDF."
        actions={
          <>
            <AppButton
              variant="secondary"
              size="sm"
              leftIcon="refresh"
              loading={loading}
              onClick={() => loadAll()}
            >
              Làm mới
            </AppButton>
            <AppButton
              variant="primary"
              size="sm"
              leftIcon="send"
              loading={digestBusy}
              onClick={handleSendDigest}
            >
              Gửi báo cáo Telegram
            </AppButton>
          </>
        }
      />

      {err && (
        <InlineAlert tone="danger" onDismiss={() => setErr("")}>
          {err}
        </InlineAlert>
      )}

      <KpiStrip
        columns={4}
        loading={loading && !overview}
        items={kpiItems}
      />

      <ResponsiveTabs
        tabs={tabs}
        active={activeTab}
        onChange={setActiveTab}
        ariaLabel="Phân khu Ads & Lead Website"
      />

      <FilterBar
        collapsibleMobile
        search={{
          value: searchInput,
          onChange: setSearchInput,
          placeholder: "Tìm tên, SĐT, công ty, SKU, UTM…",
          ariaLabel: "Tìm kiếm Lead Website",
        }}
        activeCount={activeFilterCount}
        onReset={resetFilters}
        resetLabel="Xóa lọc"
        filters={
          <>
            <select
              aria-label="Khoảng thời gian"
              className="ui-select"
              value={days}
              onChange={(e) => {
                setDays(Number(e.target.value));
                setOffset(0);
              }}
            >
              {DAY_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d} ngày qua
                </option>
              ))}
            </select>

            <select
              aria-label="Lọc theo sản phẩm"
              className="ui-select"
              value={productKey}
              onChange={(e) => {
                setProductKey(e.target.value);
                setOffset(0);
              }}
            >
              {PRODUCT_OPTIONS.map((p) => (
                <option key={p.value || "all"} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>

            <select
              aria-label="Lọc theo chiến dịch"
              className="ui-select"
              value={utmCampaign}
              onChange={(e) => {
                setUtmCampaign(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">Tất cả chiến dịch (UTM)</option>
              {campaignOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <select
              aria-label="Lọc theo trạng thái Lead"
              className="ui-select"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">Tất cả trạng thái</option>
              {STATUS_ORDER.map((st) => (
                <option key={st} value={st}>
                  {STATUS_META[st].label}
                </option>
              ))}
            </select>
          </>
        }
        actions={
          utmCampaign ? (
            <StatusBadge tone="brand" size="sm" icon="target">
              UTM: {utmCampaign}
            </StatusBadge>
          ) : undefined
        }
      />

      {activeTab === "leads" ? (
        loading && !overview && leads.length === 0 ? (
          <TableSkeleton rows={6} cols={7} />
        ) : (
          <WebAdsLeadsTable
            leads={leads}
            leadsTotal={leadsTotal}
            loading={loading}
            offset={offset}
            limit={limit}
            copiedLeadId={copiedLeadId}
            statusBusyId={statusBusyId}
            emptyState={
              <EmptyState
                icon="trending-up"
                title="Chưa có Lead phù hợp bộ lọc"
                description="Lead từ form báo giá trên iNut.vn sẽ tự động đổ về đây kèm nguồn UTM và lịch sử xem giá."
                action={
                  activeFilterCount > 0 ? (
                    <AppButton
                      variant="secondary"
                      size="sm"
                      leftIcon="rotate-ccw"
                      onClick={resetFilters}
                    >
                      Xóa bộ lọc
                    </AppButton>
                  ) : undefined
                }
              />
            }
            onPageChange={setOffset}
            onSelectLead={openLeadDetail}
            onStatusChange={handleStatusChange}
            onCopyPhone={handleCopyPhone}
          />
        )
      ) : loading && !overview ? (
        <SkeletonBlock variant="card" lines={4} />
      ) : (
        <WebAdsAnalyticsSection
          campaigns={campaigns}
          skuRows={skuRows}
          maxSkuDemand={maxSkuDemand}
          utmCampaign={utmCampaign}
          loading={loading && !overview}
          emptyCampaigns={
            <EmptyState
              compact
              icon="target"
              title="Chưa có dữ liệu chiến dịch"
              description={`Chưa ghi nhận lượt truy cập chiến dịch trong ${days} ngày qua.`}
            />
          }
          onToggleCampaign={(campaign) => {
            const next = utmCampaign === campaign ? "" : campaign;
            setUtmCampaign(next);
            setOffset(0);
            if (next) {
              toast.info(`Đang lọc chiến dịch "${next}"`);
            }
          }}
        />
      )}

      <WebAdsLeadDetailModal
        selectedLeadId={selectedLeadId}
        detail={detail}
        loading={detailLoading}
        error={detailErr}
        noteDraft={noteDraft}
        savingNote={savingNote}
        statusBusyId={statusBusyId}
        copiedLeadId={copiedLeadId}
        actionBusy={actionBusy}
        onClose={() => {
          setSelectedLeadId(null);
          setDetail(null);
        }}
        onNoteDraftChange={setNoteDraft}
        onCopyPhone={handleCopyPhone}
        onCreateCustomer={handleCreateCustomer}
        onDraftQuote={handleDraftQuote}
        onStatusChange={handleStatusChange}
        onSaveNote={handleSaveNote}
        onDeleteLead={handleDeleteLead}
      />
    </PageShell>
  );
}
