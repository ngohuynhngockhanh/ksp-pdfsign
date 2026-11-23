import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type WebAdsDraftQuote,
  type WebAdsLead,
  type WebAdsLeadDetail,
  type WebAdsOverview,
  type WebLeadStatus,
} from "../api";
import { AppModal, DataView, FormGrid } from "../components/ui";
import { copyText } from "../util";
import { safeHttpUrl } from "../utils/url";

const STATUS_META: Record<
  WebLeadStatus,
  { label: string; chipClass: string; bg: string; fg: string }
> = {
  new: { label: "Mới", chipClass: "blue", bg: "var(--primary-soft, #e2f2ec)", fg: "var(--primary-dark, #0f655d)" },
  contacted: { label: "Đã liên hệ", chipClass: "amber", bg: "#fef3c7", fg: "#92400e" },
  quoted: { label: "Đã báo giá", chipClass: "indigo", bg: "#f5efe2", fg: "#6e4b12" },
  won: { label: "Chốt đơn", chipClass: "green", bg: "#dcfce7", fg: "#166534" },
  lost: { label: "Hủy", chipClass: "gray", bg: "var(--surface-subtle, #f4f8f6)", fg: "var(--ink-2, #164b45)" },
};

const STATUS_ORDER: WebLeadStatus[] = ["new", "contacted", "quoted", "won", "lost"];

const PRODUCT_OPTIONS = [
  { value: "", label: "Tất cả sản phẩm" },
  { value: "datalogger", label: "iNut Datalogger" },
  { value: "rs485", label: "iNut RS485 Gateway" },
];

const DAY_OPTIONS = [7, 30, 90] as const;

const CANONICAL_SKUS: Array<{ sku: string; productKey: string; label: string }> = [
  { sku: "INUT-SC-DL10", productKey: "datalogger", label: "Datalogger DL10 (Tiêu chuẩn)" },
  { sku: "INUT-SC-DL11", productKey: "datalogger", label: "Datalogger DL11 (Phổ biến)" },
  { sku: "INUT-SC-DL20", productKey: "datalogger", label: "Datalogger DL20 (Cao cấp)" },
  { sku: "INUT-SC-R4WF", productKey: "rs485", label: "RS485 Gateway WiFi" },
  { sku: "INUT-SC-R4WF4G", productKey: "rs485", label: "RS485 Gateway WiFi + 4G" },
];

const EVENT_LABELS: Record<string, { icon: string; label: string; tone: string }> = {
  pageview: { icon: "🌐", label: "Xem trang", tone: "gray" },
  view_price: { icon: "💰", label: "Xem bảng giá (#price)", tone: "amber" },
  select_sku: { icon: "📦", label: "Chọn model SKU", tone: "blue" },
  apply_coupon: { icon: "🏷️", label: "Áp mã ưu đãi", tone: "purple" },
  click_call: { icon: "📞", label: "Bấm nút Gọi", tone: "green" },
  click_zalo: { icon: "💬", label: "Bấm nút Zalo", tone: "indigo" },
  submit_lead: { icon: "📝", label: "Gửi form nhận báo giá", tone: "green" },
};

function fmtVnd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  return `${Math.round(value).toLocaleString("vi-VN")} đ`;
}

function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "0.0%";
  return `${value.toFixed(1)}%`;
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function phoneDigits(phone: string | null | undefined): string {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.startsWith("84") && digits.length >= 10) {
    return `0${digits.slice(2)}`;
  }
  return digits;
}

function zaloUrl(phone: string | null | undefined): string | null {
  const d = phoneDigits(phone);
  return d.length >= 8 ? `https://zalo.me/${d}` : null;
}

function extractAiAnswerText(raw: unknown): string {
  if (!raw) return "";
  if (typeof raw === "string") return raw;
  let current: unknown = raw;
  for (let i = 0; i < 3; i += 1) {
    if (!current || typeof current !== "object") break;
    const obj = current as Record<string, unknown>;
    if (typeof obj.answer === "string") return obj.answer;
    if (typeof obj.text === "string") return obj.text;
    current = obj.answer;
  }
  return "";
}

export function WebAdsLeads({
  onCreateQuote,
}: {
  onCreateQuote: (draft: WebAdsDraftQuote) => void;
}) {
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
  const [notice, setNotice] = useState<string>("");
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
  const [actionBusy, setActionBusy] = useState<"customer" | "quote" | "delete" | null>(null);

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
      setOverview(ov);
      const leadItems = Array.isArray(list?.items) ? list.items : [];
      setLeads(leadItems);
      setLeadsTotal(typeof list?.total === "number" ? list.total : leadItems.length);
    } catch (e) {
      setErr((e as Error).message || "Không thể tải dữ liệu Ads & Leads");
    } finally {
      setLoading(false);
    }
  }, [days, productKey, utmCampaign, statusFilter, searchQuery, offset]);

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
      setNoteDraft(d.note || "");
    } catch (e) {
      setDetailErr((e as Error).message || "Không thể tải chi tiết lead");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  async function handleSendDigest() {
    setDigestBusy(true);
    setNotice("");
    setErr("");
    try {
      const res = await api.sendWebAdsDailyDigest(1);
      const t = res.summary?.totals;
      const statsText = t
        ? ` (24h qua: ${t.pageviews} xem · ${t.price_views} xem giá · ${t.call_clicks + t.zalo_clicks} Gọi/Zalo · ${t.leads} lead)`
        : "";
      setNotice(
        res.sent
          ? `Đã gửi báo cáo Ads & Leads qua Telegram tới ${res.delivered_count} tài khoản.${statsText}`
          : `Đã tổng hợp báo cáo${statsText} — Telegram chưa bật hoặc chưa có tài khoản nhận kết nối.`,
      );
    } catch (e) {
      setErr(`Gửi báo cáo Telegram thất bại: ${(e as Error).message}`);
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
        prev.map((item) => (item.id === leadId ? { ...item, ...updated, status: nextStatus } : item)),
      );
      if (detail && detail.id === leadId) {
        setDetail((prev) => (prev ? { ...prev, ...updated, status: nextStatus } : prev));
      }
    } catch (e) {
      setErr(`Không thể cập nhật trạng thái lead #${leadId}: ${(e as Error).message}`);
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
        prev.map((item) => (item.id === detail.id ? { ...item, note: noteDraft } : item)),
      );
      setNotice(`Đã lưu ghi chú nội bộ cho Lead #${detail.id}.`);
    } catch (e) {
      setDetailErr((e as Error).message || "Không thể lưu ghi chú");
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
      const custName = res.customer?.name || detail.name;
      setDetail((prev) =>
        prev ? { ...prev, customer_id: res.customer_id, customer_name: custName } : prev,
      );
      setLeads((prev) =>
        prev.map((item) =>
          item.id === detail.id
            ? { ...item, customer_id: res.customer_id, customer_name: custName }
            : item,
        ),
      );
      setNotice(
        res.created
          ? `Đã tạo khách hàng CRM mới #${res.customer_id} (${custName}).`
          : `Đã liên kết với khách hàng CRM sẵn có #${res.customer_id} (${custName}).`,
      );
    } catch (e) {
      setDetailErr((e as Error).message || "Không thể tạo khách hàng CRM");
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
      setDetailErr((e as Error).message || "Không thể khởi tạo báo giá PDF");
    } finally {
      setActionBusy(null);
    }
  }

  async function handleDeleteLead() {
    if (!detail) return;
    if (!window.confirm(`Xóa Lead #${detail.id} (${detail.name || detail.phone})? Hành động này không thể hoàn tác.`)) {
      return;
    }
    setActionBusy("delete");
    setDetailErr("");
    try {
      await api.deleteWebAdsLead(detail.id);
      setSelectedLeadId(null);
      setDetail(null);
      setNotice(`Đã xóa Lead #${detail.id}.`);
      await loadAll();
    } catch (e) {
      setDetailErr((e as Error).message || "Không thể xóa lead");
    } finally {
      setActionBusy(null);
    }
  }

  async function handleCopyPhone(leadId: number, phone: string) {
    if (!phone) return;
    await copyText(phone);
    setCopiedLeadId(leadId);
    window.setTimeout(() => {
      setCopiedLeadId((cur) => (cur === leadId ? null : cur));
    }, 1600);
  }

  // Distinct campaign options from overview.filters + by_campaign
  const campaignOptions = useMemo(() => {
    const names = new Set<string>();
    for (const c of overview?.filters?.utm_campaigns || []) {
      if (c && c !== "(direct)" && c !== "direct") names.add(c);
    }
    for (const row of overview?.by_campaign || []) {
      if (row.utm_campaign && row.utm_campaign !== "(direct)" && row.utm_campaign !== "direct") {
        names.add(row.utm_campaign);
      }
    }
    if (utmCampaign) names.add(utmCampaign);
    return Array.from(names).sort();
  }, [overview?.filters?.utm_campaigns, overview?.by_campaign, utmCampaign]);

  // Merge canonical SKUs with backend SKU stats so core industrial SKUs are always clearly displayed
  const skuRows = useMemo(() => {
    const map = new Map<
      string,
      {
        sku: string;
        label: string;
        productKey: string;
        selects: number;
        leads: number;
        totalQuantity: number;
        estimatedRevenue: number;
      }
    >();

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

    for (const row of overview?.by_sku || []) {
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
      (a, b) => b.leads - a.leads || b.selects - a.selects || a.sku.localeCompare(b.sku),
    );
  }, [overview?.by_sku, productKey]);

  const maxSkuDemand = useMemo(
    () => Math.max(1, ...skuRows.map((r) => r.leads * 3 + r.selects)),
    [skuRows],
  );

  const totals = overview?.totals;
  const contactClicks = (totals?.call_clicks ?? 0) + (totals?.zalo_clicks ?? 0);
  const totalPages = Math.max(1, Math.ceil(leadsTotal / limit));
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="docs-page document-vault" style={{ paddingBottom: 32 }}>
      {/* Hero + Quick Funnel Summary */}
      <section className="document-vault-hero" style={{ marginBottom: 14 }}>
        <div>
          <span>INUT · ADS ANALYTICS &amp; WEB LEADS CRM</span>
          <h1>Ads &amp; Lead Website.</h1>
          <p>
            Theo dõi phễu chuyển đổi từ chiến dịch quảng cáo tới trang bảng giá iNut.vn, lượt bấm
            Gọi/Zalo, tín hiệu xem giá và chăm sóc Lead tạo báo giá PDF ngay trên KSP.
          </p>
        </div>
        <div className="document-vault-metrics" aria-label="Phễu chuyển đổi Ads">
          <article>
            <strong>
              {(totals?.pageviews ?? 0).toLocaleString("vi-VN")} xem ·{" "}
              {(totals?.unique_visitors ?? 0).toLocaleString("vi-VN")} khách
            </strong>
            <small>LƯỢT XEM &amp; UNIQUE VISITORS ({days} NGÀY)</small>
          </article>
          <article>
            <strong>
              {(totals?.price_views ?? 0).toLocaleString("vi-VN")} lượt xem giá
            </strong>
            <small>
              VISIT → PRICE: {fmtPct(totals?.visit_to_price_rate)} · CHỌN SKU:{" "}
              {(totals?.sku_selects ?? 0).toLocaleString("vi-VN")}
            </small>
          </article>
          <article>
            <strong>{contactClicks.toLocaleString("vi-VN")} bấm Gọi / Zalo</strong>
            <small>
              📞 GỌI: {(totals?.call_clicks ?? 0).toLocaleString("vi-VN")} · 💬 ZALO:{" "}
              {(totals?.zalo_clicks ?? 0).toLocaleString("vi-VN")}
            </small>
          </article>
          <article className={(totals?.leads ?? 0) > 0 ? "attention" : ""}>
            <strong>{(totals?.leads ?? 0).toLocaleString("vi-VN")} Lead gửi form</strong>
            <small>
              PRICE → LEAD: {fmtPct(totals?.price_to_lead_rate)} · VISIT → LEAD:{" "}
              {fmtPct(totals?.visit_to_lead_rate)}
            </small>
          </article>
        </div>
      </section>

      {/* Top Filter & Action Toolbar */}
      <div
        className="panel"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "12px 16px",
          marginBottom: 14,
          borderRadius: 14,
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, minWidth: 0 }}>
          <div
            style={{
              display: "inline-flex",
              background: "var(--surface-subtle, #f4f8f6)",
              padding: 3,
              borderRadius: 8,
              gap: 3,
              border: "1px solid var(--border)",
            }}
            role="group"
            aria-label="Khoảng thời gian"
          >
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                className="ui-btn-chip"
                onClick={() => {
                  setDays(d);
                  setOffset(0);
                }}
                style={{
                  border: "none",
                  borderRadius: 6,
                  fontWeight: 700,
                  cursor: "pointer",
                  background: days === d ? "var(--primary)" : "transparent",
                  color: days === d ? "#fff" : "var(--ink-2)",
                }}
              >
                {d} ngày
              </button>
            ))}
          </div>

          <select
            aria-label="Lọc theo sản phẩm"
            className="tb-select ui-select"
            value={productKey}
            onChange={(e) => {
              setProductKey(e.target.value);
              setOffset(0);
            }}
            style={{ margin: 0, minWidth: 0, maxWidth: "100%" }}
          >
            {PRODUCT_OPTIONS.map((p) => (
              <option key={p.value || "all"} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>

          <select
            aria-label="Lọc theo chiến dịch"
            className="tb-select ui-select"
            value={utmCampaign}
            onChange={(e) => {
              setUtmCampaign(e.target.value);
              setOffset(0);
            }}
            style={{ margin: 0, minWidth: 0, maxWidth: "100%" }}
          >
            <option value="">Tất cả chiến dịch (UTM)</option>
            {campaignOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {(productKey || utmCampaign || statusFilter || searchInput) && (
            <button
              type="button"
              className="btn-sm ghost ui-btn-chip"
              onClick={() => {
                setProductKey("");
                setUtmCampaign("");
                setStatusFilter("");
                setSearchInput("");
                setSearchQuery("");
                setOffset(0);
              }}
            >
              ✕ Xóa bộ lọc
            </button>
          )}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            className="btn-sm ui-btn-chip"
            disabled={loading}
            onClick={() => loadAll()}
          >
            {loading ? "⏳ Đang tải…" : "↻ Làm mới"}
          </button>
          <button
            type="button"
            className="primary ui-btn-chip"
            disabled={digestBusy}
            onClick={handleSendDigest}
          >
            {digestBusy ? "⏳ Đang gửi…" : "📨 Gửi báo cáo Telegram"}
          </button>
        </div>
      </div>

      {err && (
        <div className="error" style={{ marginBottom: 12 }}>
          {err}
        </div>
      )}
      {notice && (
        <div
          style={{
            padding: "10px 14px",
            marginBottom: 12,
            borderRadius: 10,
            background: "var(--primary-soft)",
            border: "1px solid var(--primary)",
            color: "var(--primary-dark)",
            fontSize: 13,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span>✅ {notice}</span>
          <button
            type="button"
            className="btn-sm ghost ui-btn-icon"
            onClick={() => setNotice("")}
            aria-label="Đóng thông báo"
          >
            ✕
          </button>
        </div>
      )}

      {/* 4 Detailed Conversion Funnel KPI Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div className="panel" style={{ margin: 0, padding: "14px 16px", borderRadius: 14, minWidth: 0 }}>
          <div className="muted" style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase" }}>
            1. Lượt xem &amp; Khách truy cập
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "var(--ink)", marginTop: 4 }}>
            {(totals?.pageviews ?? 0).toLocaleString("vi-VN")}
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            <b>{(totals?.unique_visitors ?? 0).toLocaleString("vi-VN")}</b> khách truy cập duy nhất
          </div>
        </div>

        <div className="panel" style={{ margin: 0, padding: "14px 16px", borderRadius: 14, minWidth: 0 }}>
          <div className="muted" style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase" }}>
            2. Xem bảng giá (#price)
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "var(--amber)", marginTop: 4 }}>
            {(totals?.price_views ?? 0).toLocaleString("vi-VN")}
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            Visit → Price: <b style={{ color: "var(--amber)" }}>{fmtPct(totals?.visit_to_price_rate)}</b>
            {" · "}Chọn SKU: <b>{(totals?.sku_selects ?? 0).toLocaleString("vi-VN")}</b>
          </div>
        </div>

        <div className="panel" style={{ margin: 0, padding: "14px 16px", borderRadius: 14, minWidth: 0 }}>
          <div className="muted" style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase" }}>
            3. Bấm Gọi / Zalo
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "var(--primary-dark)", marginTop: 4 }}>
            {contactClicks.toLocaleString("vi-VN")}
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            📞 Gọi: <b>{(totals?.call_clicks ?? 0).toLocaleString("vi-VN")}</b>
            {" · "}💬 Zalo: <b>{(totals?.zalo_clicks ?? 0).toLocaleString("vi-VN")}</b>
          </div>
        </div>

        <div
          className="panel"
          style={{
            margin: 0,
            padding: "14px 16px",
            borderRadius: 14,
            minWidth: 0,
            borderColor: "var(--primary)",
            background: "linear-gradient(180deg, var(--panel, #fffefa), var(--primary-soft, #e2f2ec))",
          }}
        >
          <div className="muted" style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", color: "var(--green)" }}>
            4. Lead gửi form
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "var(--green)", marginTop: 4 }}>
            {(totals?.leads ?? 0).toLocaleString("vi-VN")}
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            Price → Lead: <b style={{ color: "var(--green)" }}>{fmtPct(totals?.price_to_lead_rate)}</b>
            {" · "}Visit → Lead: <b>{fmtPct(totals?.visit_to_lead_rate)}</b>
          </div>
        </div>
      </div>

      {/* Campaign & SKU Breakdown Panels */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
          gap: 14,
          marginBottom: 16,
        }}
      >
        {/* By Campaign */}
        <div className="panel" style={{ margin: 0, borderRadius: 14, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>🎯 Hiệu quả theo Chiến dịch (UTM)</h3>
            <span className="muted" style={{ fontSize: 12 }}>
              {(overview?.by_campaign || []).length} nguồn
            </span>
          </div>
          <DataView
            mobileMode="card"
            desktop={
              <div style={{ overflowX: "auto" }}>
                <table className="dt" style={{ fontSize: 12.5 }}>
                  <thead>
                    <tr>
                      <th>Chiến dịch / Nguồn</th>
                      <th style={{ textAlign: "right" }}>Xem</th>
                      <th style={{ textAlign: "right" }}>Xem giá</th>
                      <th style={{ textAlign: "right" }}>Gọi/Zalo</th>
                      <th style={{ textAlign: "right" }}>Lead</th>
                      <th style={{ textAlign: "right" }}>CR%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(overview?.by_campaign || []).map((row, idx) => {
                      const cr =
                        row.conversion_rate ??
                        (row.pageviews > 0 ? (row.leads / row.pageviews) * 100 : 0);
                      const rowClicks = (row.call_clicks ?? 0) + (row.zalo_clicks ?? 0);
                      const isSelected = Boolean(utmCampaign && row.utm_campaign === utmCampaign);
                      return (
                        <tr
                          key={`${row.utm_campaign}-${row.utm_source}-${idx}`}
                          onClick={() => {
                            if (!row.utm_campaign || row.utm_campaign === "(direct)") return;
                            setUtmCampaign(isSelected ? "" : row.utm_campaign);
                            setOffset(0);
                          }}
                          style={{
                            cursor: row.utm_campaign && row.utm_campaign !== "(direct)" ? "pointer" : "default",
                            background: isSelected ? "var(--primary-soft)" : undefined,
                          }}
                        >
                          <td>
                            <div style={{ fontWeight: 700, color: "var(--ink)" }}>
                              {row.utm_campaign || "(Chưa gắn UTM)"}
                            </div>
                            <div className="muted" style={{ fontSize: 11 }}>
                              {[row.utm_source, row.utm_medium].filter(Boolean).join(" / ") || "direct / organic"}
                            </div>
                          </td>
                          <td style={{ textAlign: "right" }}>{(row.pageviews ?? 0).toLocaleString("vi-VN")}</td>
                          <td style={{ textAlign: "right" }}>{(row.price_views ?? 0).toLocaleString("vi-VN")}</td>
                          <td style={{ textAlign: "right" }}>{rowClicks.toLocaleString("vi-VN")}</td>
                          <td style={{ textAlign: "right", fontWeight: 700, color: row.leads > 0 ? "var(--green)" : undefined }}>
                            {row.leads ?? 0}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <span className={`chip sm ${cr >= 3 ? "green" : cr > 0 ? "blue" : "gray"}`}>
                              {fmtPct(cr)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {!loading && (overview?.by_campaign || []).length === 0 && (
                      <tr>
                        <td colSpan={6} className="muted" style={{ textAlign: "center", padding: 18 }}>
                          Chưa có dữ liệu chiến dịch trong {days} ngày qua.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            }
            mobileCards={
              <div className="ui-mobile-card-list">
                {(overview?.by_campaign || []).map((row, idx) => {
                  const cr =
                    row.conversion_rate ??
                    (row.pageviews > 0 ? (row.leads / row.pageviews) * 100 : 0);
                  const rowClicks = (row.call_clicks ?? 0) + (row.zalo_clicks ?? 0);
                  const isSelected = Boolean(utmCampaign && row.utm_campaign === utmCampaign);
                  const clickable = Boolean(row.utm_campaign && row.utm_campaign !== "(direct)");
                  return (
                    <article
                      key={`${row.utm_campaign}-${row.utm_source}-${idx}`}
                      className="ui-mobile-card"
                      onClick={() => {
                        if (!clickable) return;
                        setUtmCampaign(isSelected ? "" : row.utm_campaign);
                        setOffset(0);
                      }}
                      style={{
                        cursor: clickable ? "pointer" : "default",
                        background: isSelected ? "var(--primary-soft)" : undefined,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <strong style={{ color: "var(--ink)", wordBreak: "break-word" }}>
                            {row.utm_campaign || "(Chưa gắn UTM)"}
                          </strong>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {[row.utm_source, row.utm_medium].filter(Boolean).join(" / ") || "direct / organic"}
                          </div>
                        </div>
                        <span className={`chip sm ${cr >= 3 ? "green" : cr > 0 ? "blue" : "gray"}`}>
                          {fmtPct(cr)}
                        </span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, marginTop: 8, fontSize: 12.5 }}>
                        <span className="muted">Xem: <b style={{ color: "var(--ink)" }}>{(row.pageviews ?? 0).toLocaleString("vi-VN")}</b></span>
                        <span className="muted">Xem giá: <b style={{ color: "var(--ink)" }}>{(row.price_views ?? 0).toLocaleString("vi-VN")}</b></span>
                        <span className="muted">Gọi/Zalo: <b style={{ color: "var(--ink)" }}>{rowClicks.toLocaleString("vi-VN")}</b></span>
                        <span className="muted">Lead: <b style={{ color: row.leads > 0 ? "var(--green)" : "var(--ink)" }}>{row.leads ?? 0}</b></span>
                      </div>
                    </article>
                  );
                })}
                {!loading && (overview?.by_campaign || []).length === 0 && (
                  <div className="muted" style={{ textAlign: "center", padding: 14 }}>
                    Chưa có dữ liệu chiến dịch trong {days} ngày qua.
                  </div>
                )}
              </div>
            }
          />
        </div>

        {/* By SKU */}
        <div className="panel" style={{ margin: 0, borderRadius: 14, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>📦 Nhu cầu theo Model / SKU</h3>
            <span className="muted" style={{ fontSize: 12 }}>
              Chọn gói &amp; Lead gửi form
            </span>
          </div>
          <div style={{ display: "grid", gap: 9 }}>
            {skuRows.map((row) => {
              const score = row.leads * 3 + row.selects;
              const pct = Math.max(score > 0 ? 8 : 0, Math.round((score / maxSkuDemand) * 100));
              return (
                <div
                  key={row.sku}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: "9px 12px",
                    background: row.leads > 0 ? "var(--surface-subtle)" : "var(--panel)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0 }}>
                      <code style={{ fontWeight: 700, fontSize: 12.5, color: "var(--primary-dark)" }}>{row.sku}</code>
                      <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>
                        {row.label}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <span className="chip sm blue">Chọn: {row.selects}</span>
                      <span className={`chip sm ${row.leads > 0 ? "green" : "gray"}`}>
                        Lead: {row.leads}
                      </span>
                      {row.totalQuantity > 0 && (
                        <span className="chip sm amber">SL: {row.totalQuantity}</span>
                      )}
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      height: 6,
                      background: "var(--border)",
                      borderRadius: 99,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        background: row.leads > 0 ? "linear-gradient(90deg, var(--primary), var(--green))" : "var(--gold)",
                        borderRadius: 99,
                      }}
                    />
                  </div>
                  {row.estimatedRevenue > 0 && (
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                      Giá trị dự kiến: <b>{fmtVnd(row.estimatedRevenue)}</b>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Web Leads CRM Table */}
      <div className="table-wrap document-vault-table-wrap">
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>
              📋 Danh sách Lead từ Website ({leadsTotal.toLocaleString("vi-VN")})
            </h3>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              Bấm vào từng dòng để xem hành trình truy cập, lịch sử chat AI Widget, tạo KH CRM hoặc tạo Báo giá PDF.
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, minWidth: 0, maxWidth: "100%" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              <button
                type="button"
                className="btn-sm ui-btn-chip"
                onClick={() => {
                  setStatusFilter("");
                  setOffset(0);
                }}
                style={{
                  background: statusFilter === "" ? "var(--ink)" : "var(--panel)",
                  color: statusFilter === "" ? "#fff" : "var(--ink-2)",
                  borderColor: statusFilter === "" ? "var(--ink)" : undefined,
                }}
              >
                Tất cả
              </button>
              {STATUS_ORDER.map((st) => {
                const meta = STATUS_META[st];
                const active = statusFilter === st;
                return (
                  <button
                    key={st}
                    type="button"
                    className="btn-sm ui-btn-chip"
                    onClick={() => {
                      setStatusFilter(active ? "" : st);
                      setOffset(0);
                    }}
                    style={{
                      background: active ? meta.fg : "var(--panel)",
                      color: active ? "#fff" : "var(--ink-2)",
                      borderColor: active ? meta.fg : undefined,
                    }}
                  >
                    {meta.label}
                  </button>
                );
              })}
            </div>

            <input
              className="ui-input"
              type="search"
              placeholder="Tìm tên, SĐT, công ty, SKU, UTM…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              style={{
                flex: "1 1 min(100%, 220px)",
                minWidth: 0,
                maxWidth: "100%",
                margin: 0,
              }}
            />
          </div>
        </div>

        <DataView
          mobileMode="card"
          desktop={
            <div style={{ overflowX: "auto" }}>
              <table className="dt document-vault-table">
                <thead>
                  <tr>
                    <th>Thời gian</th>
                    <th>Khách hàng</th>
                    <th>Sản phẩm / SKU / Giá dự kiến</th>
                    <th className="col-hide-sm">Nguồn Ads</th>
                    <th>Tín hiệu nóng</th>
                    <th>Trạng thái</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => {
                    const displayPhone = lead.phone || (lead.phone_last4 ? `••••${lead.phone_last4}` : "—");
                    const zUrl = safeHttpUrl(zaloUrl(lead.phone));
                    const statusMeta = STATUS_META[lead.status] || STATUS_META.new;
                    const hasAiChat = Boolean(lead.training_session_id) || (lead.training_query_count ?? 0) > 0;

                    return (
                      <tr
                        key={lead.id}
                        onClick={() => openLeadDetail(lead.id)}
                        style={{ cursor: "pointer" }}
                      >
                        <td className="nowrap muted" style={{ fontSize: 12 }}>
                          <div>{fmtDateTime(lead.created_at)}</div>
                          <div style={{ fontSize: 11 }}>#{lead.id}</div>
                        </td>

                        <td>
                          <div style={{ fontWeight: 700, color: "var(--ink)" }}>
                            {lead.name || "(Chưa ghi tên)"}
                          </div>
                          {lead.company && (
                            <div className="muted" style={{ fontSize: 11.5 }}>
                              🏢 {lead.company}
                            </div>
                          )}
                          <div
                            style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, marginTop: 3 }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <code style={{ fontSize: 12, fontWeight: 600 }}>{displayPhone}</code>
                            {lead.phone && (
                              <button
                                type="button"
                                className="btn-sm ui-btn-chip"
                                onClick={() => handleCopyPhone(lead.id, lead.phone)}
                                title="Sao chép SĐT"
                              >
                                {copiedLeadId === lead.id ? "✓ Đã copy" : "📋 Copy"}
                              </button>
                            )}
                            {zUrl && (
                              <a
                                href={zUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn-sm ui-btn-chip"
                                style={{
                                  textDecoration: "none",
                                  color: "var(--primary-dark)",
                                  borderColor: "var(--primary)",
                                  background: "var(--primary-soft)",
                                }}
                              >
                                💬 Zalo
                              </a>
                            )}
                          </div>
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                            {lead.customer_id && (
                              <span className="chip sm green">✓ CRM #{lead.customer_id}</span>
                            )}
                            {lead.quote_document_id && (
                              <span className="chip sm indigo">📄 BG #{lead.quote_document_id}</span>
                            )}
                          </div>
                        </td>

                        <td>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                            {lead.sku ? (
                              <span className="chip sm blue">{lead.sku}</span>
                            ) : (
                              <span className="chip sm gray">{lead.product_name || lead.product_key || "Tư vấn chung"}</span>
                            )}
                            {(lead.quantity ?? 0) > 0 && (
                              <span style={{ fontSize: 12, fontWeight: 700 }}>× {lead.quantity}</span>
                            )}
                          </div>
                          <div style={{ marginTop: 3, fontSize: 12.5, fontWeight: 700, color: "var(--primary-dark)" }}>
                            {fmtVnd(lead.quoted_price_vnd)}
                          </div>
                          {lead.coupon_code && (
                            <div style={{ marginTop: 2 }}>
                              <span className="chip sm amber">
                                🏷️ {lead.coupon_code}
                                {lead.discount_percent ? ` -${lead.discount_percent}%` : ""}
                              </span>
                            </div>
                          )}
                        </td>

                        <td className="col-hide-sm">
                          {lead.utm_campaign ? (
                            <div style={{ fontWeight: 600, fontSize: 12.5, color: "var(--ink)" }}>
                              {lead.utm_campaign}
                            </div>
                          ) : (
                            <div className="muted" style={{ fontSize: 12 }}>
                              Trực tiếp / Organic
                            </div>
                          )}
                          <div className="muted" style={{ fontSize: 11.5 }}>
                            {[lead.utm_source, lead.utm_medium].filter(Boolean).join(" · ") || lead.page_path || "—"}
                          </div>
                          {(lead.fbclid || lead.gclid) && (
                            <div style={{ marginTop: 2, display: "flex", gap: 4 }}>
                              {lead.fbclid && <span className="chip sm blue">FB Ads</span>}
                              {lead.gclid && <span className="chip sm amber">Google Ads</span>}
                            </div>
                          )}
                        </td>

                        <td>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                            <span
                              className={`chip sm ${
                                (lead.price_view_count ?? 0) >= 2
                                  ? "red"
                                  : (lead.price_view_count ?? 0) === 1
                                    ? "amber"
                                    : "gray"
                              }`}
                            >
                              {(lead.price_view_count ?? 0) >= 2 ? "🔥" : "👁"} Xem giá{" "}
                              {lead.price_view_count ?? 0}x
                            </span>
                            <span className="muted" style={{ fontSize: 11 }}>
                              {lead.visit_count ?? 0} lượt truy cập
                            </span>
                            {hasAiChat && (
                              <span className="chip sm green">
                                🤖 Đã chat AI
                                {(lead.training_query_count ?? 0) > 0
                                  ? ` (${lead.training_query_count} câu)`
                                  : ""}
                              </span>
                            )}
                          </div>
                        </td>

                        <td onClick={(e) => e.stopPropagation()}>
                          <select
                            className="ui-select"
                            aria-label={`Trạng thái lead #${lead.id}`}
                            value={lead.status}
                            disabled={statusBusyId === lead.id}
                            onChange={(e) => handleStatusChange(lead.id, e.target.value as WebLeadStatus)}
                            style={{
                              margin: 0,
                              width: "auto",
                              minWidth: 118,
                              fontWeight: 700,
                              borderRadius: 8,
                              background: statusMeta.bg,
                              color: statusMeta.fg,
                              border: "1px solid var(--border)",
                            }}
                          >
                            {STATUS_ORDER.map((st) => (
                              <option key={st} value={st}>
                                {STATUS_META[st].label}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="btn-sm ui-btn-chip"
                            onClick={() => openLeadDetail(lead.id)}
                          >
                            Chi tiết
                          </button>
                        </td>
                      </tr>
                    );
                  })}

                  {!loading && leads.length === 0 && (
                    <tr>
                      <td colSpan={7}>
                        <div className="empty">
                          <div className="empty-ic">📈</div>
                          <div>
                            Chưa có Lead phù hợp bộ lọc hiện tại. Lead từ form báo giá trên iNut.vn sẽ tự
                            động đổ về đây kèm nguồn UTM &amp; lịch sử xem giá.
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          }
          mobileCards={
            <div className="ui-mobile-card-list" style={{ padding: 12 }}>
              {leads.map((lead) => {
                const displayPhone = lead.phone || (lead.phone_last4 ? `••••${lead.phone_last4}` : "—");
                const zUrl = safeHttpUrl(zaloUrl(lead.phone));
                const statusMeta = STATUS_META[lead.status] || STATUS_META.new;
                const hasAiChat = Boolean(lead.training_session_id) || (lead.training_query_count ?? 0) > 0;
                return (
                  <article key={lead.id} className="ui-mobile-card">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <strong style={{ color: "var(--ink)", display: "block" }}>
                          {lead.name || "(Chưa ghi tên)"}
                        </strong>
                        {lead.company && (
                          <div className="muted" style={{ fontSize: 12 }}>🏢 {lead.company}</div>
                        )}
                        <div className="muted" style={{ fontSize: 11.5 }}>
                          #{lead.id} · {fmtDateTime(lead.created_at)}
                        </div>
                      </div>
                      <span
                        className="chip sm"
                        style={{ background: statusMeta.bg, color: statusMeta.fg, fontWeight: 700 }}
                      >
                        {statusMeta.label}
                      </span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, marginTop: 8, fontSize: 12.5 }}>
                      <div>
                        <span className="muted">SĐT: </span>
                        <code style={{ fontWeight: 600 }}>{displayPhone}</code>
                      </div>
                      <div style={{ textAlign: "right", fontWeight: 700, color: "var(--primary-dark)" }}>
                        {fmtVnd(lead.quoted_price_vnd)}
                      </div>
                      <div style={{ gridColumn: "1 / -1", display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {lead.sku ? (
                          <span className="chip sm blue">{lead.sku}{(lead.quantity ?? 0) > 0 ? ` ×${lead.quantity}` : ""}</span>
                        ) : (
                          <span className="chip sm gray">{lead.product_name || lead.product_key || "Tư vấn chung"}</span>
                        )}
                        <span className={`chip sm ${(lead.price_view_count ?? 0) >= 2 ? "red" : (lead.price_view_count ?? 0) === 1 ? "amber" : "gray"}`}>
                          {(lead.price_view_count ?? 0) >= 2 ? "🔥" : "👁"} Xem giá {lead.price_view_count ?? 0}x
                        </span>
                        {hasAiChat && <span className="chip sm green">🤖 Chat AI</span>}
                        {lead.customer_id && <span className="chip sm green">✓ CRM #{lead.customer_id}</span>}
                        {lead.quote_document_id && <span className="chip sm indigo">📄 BG #{lead.quote_document_id}</span>}
                      </div>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, alignItems: "center" }}>
                      <select
                        className="ui-select"
                        aria-label={`Trạng thái lead #${lead.id}`}
                        value={lead.status}
                        disabled={statusBusyId === lead.id}
                        onChange={(e) => handleStatusChange(lead.id, e.target.value as WebLeadStatus)}
                        style={{ flex: "1 1 130px", margin: 0, fontWeight: 700, background: statusMeta.bg, color: statusMeta.fg }}
                      >
                        {STATUS_ORDER.map((st) => (
                          <option key={st} value={st}>
                            {STATUS_META[st].label}
                          </option>
                        ))}
                      </select>
                      {lead.phone && (
                        <button
                          type="button"
                          className="btn-sm ui-btn-chip"
                          onClick={() => handleCopyPhone(lead.id, lead.phone)}
                        >
                          {copiedLeadId === lead.id ? "✓ Đã copy" : "📋 Copy"}
                        </button>
                      )}
                      {zUrl && (
                        <a
                          href={zUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-sm ui-btn-chip"
                          style={{ textDecoration: "none", color: "var(--primary-dark)", background: "var(--primary-soft)", borderColor: "var(--primary)" }}
                        >
                          💬 Zalo
                        </a>
                      )}
                      <button
                        type="button"
                        className="btn-sm primary ui-btn-chip"
                        onClick={() => openLeadDetail(lead.id)}
                      >
                        Chi tiết
                      </button>
                    </div>
                  </article>
                );
              })}

              {!loading && leads.length === 0 && (
                <div className="empty">
                  <div className="empty-ic">📈</div>
                  <div>
                    Chưa có Lead phù hợp bộ lọc hiện tại. Lead từ form báo giá trên iNut.vn sẽ tự
                    động đổ về đây kèm nguồn UTM &amp; lịch sử xem giá.
                  </div>
                </div>
              )}
            </div>
          }
        />

        {leadsTotal > limit && (
          <div className="pager" style={{ padding: "10px 16px" }}>
            <button
              type="button"
              className="btn-sm ui-btn-chip"
              disabled={offset <= 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              ‹ Trước
            </button>
            <span className="muted">
              Trang {currentPage}/{totalPages} ({leadsTotal} lead)
            </span>
            <button
              type="button"
              className="btn-sm ui-btn-chip"
              disabled={offset + limit >= leadsTotal}
              onClick={() => setOffset(offset + limit)}
            >
              Sau ›
            </button>
          </div>
        )}
      </div>

      {/* Lead Detail Modal */}
      <AppModal
        open={selectedLeadId !== null}
        onClose={() => {
          setSelectedLeadId(null);
          setDetail(null);
        }}
        title={
          <>
            {detail?.name || "Chi tiết Lead Website"}
            {detail?.company ? ` — ${detail.company}` : ""}
          </>
        }
        subtitle={`WEB LEAD #${selectedLeadId ?? ""} · ${detail ? fmtDateTime(detail.created_at) : "Đang tải…"}`}
        size="lg"
      >
        {detailLoading && <div className="muted" style={{ padding: 20 }}>Đang tải chi tiết lead…</div>}
        {detailErr && <div className="error" style={{ marginBottom: 12 }}>{detailErr}</div>}

        {!detailLoading && detail && (
          <div style={{ display: "grid", gap: 16 }}>
            {/* Primary CRM Actions Bar */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                padding: "12px 14px",
                borderRadius: 12,
                background: "var(--surface-subtle)",
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <strong style={{ fontSize: 15, color: "var(--ink)" }}>
                  📞 {detail.phone || (detail.phone_last4 ? `••••${detail.phone_last4}` : "—")}
                </strong>
                {detail.phone && (
                  <button
                    type="button"
                    className="btn-sm ui-btn-chip"
                    onClick={() => handleCopyPhone(detail.id, detail.phone)}
                  >
                    {copiedLeadId === detail.id ? "✓ Đã copy SĐT" : "📋 Copy SĐT"}
                  </button>
                )}
                {safeHttpUrl(zaloUrl(detail.phone)) && (
                  <a
                    href={safeHttpUrl(zaloUrl(detail.phone))}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-sm ui-btn-chip"
                    style={{
                      textDecoration: "none",
                      background: "var(--primary-soft)",
                      color: "var(--primary-dark)",
                      borderColor: "var(--primary)",
                      fontWeight: 700,
                    }}
                  >
                    💬 Nhắn Zalo
                  </a>
                )}
                {phoneDigits(detail.phone) && (
                  <a
                    href={`tel:${phoneDigits(detail.phone)}`}
                    className="btn-sm ui-btn-chip"
                    style={{ textDecoration: "none" }}
                  >
                    ☎️ Gọi ngay
                  </a>
                )}
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  className="btn-sm ui-btn-chip"
                  disabled={actionBusy !== null}
                  onClick={handleCreateCustomer}
                  style={{
                    background: detail.customer_id ? "var(--primary-soft)" : "var(--panel)",
                    color: detail.customer_id ? "var(--green)" : "var(--ink)",
                    borderColor: detail.customer_id ? "var(--green)" : "var(--border)",
                    fontWeight: 700,
                  }}
                >
                  {actionBusy === "customer"
                    ? "⏳ Đang tạo KH…"
                    : detail.customer_id
                      ? `✓ KH CRM #${detail.customer_id} (Đồng bộ lại)`
                      : "👤 Tạo KH CRM"}
                </button>
                <button
                  type="button"
                  className="primary ui-btn-chip"
                  disabled={actionBusy !== null}
                  onClick={handleDraftQuote}
                >
                  {actionBusy === "quote" ? "⏳ Đang chuẩn bị…" : "📄 Tạo Báo Giá PDF"}
                </button>
              </div>
            </div>

            {/* Summary Info Grid */}
            <FormGrid cols={2}>
              <div className="card" style={{ margin: 0, padding: 14, minWidth: 0 }}>
                <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>
                  Nhu cầu sản phẩm &amp; Giá dự kiến
                </div>
                <div style={{ display: "grid", gap: 5, fontSize: 13 }}>
                  <div>
                    Sản phẩm: <b>{detail.product_name || detail.product_key || "—"}</b>
                  </div>
                  <div>
                    Model / SKU:{" "}
                    {detail.sku ? <span className="chip sm blue">{detail.sku}</span> : "Chưa chọn"}
                    {" · "}SL: <b>{detail.quantity || 1}</b>
                  </div>
                  <div>
                    Giá dự kiến: <b style={{ color: "var(--primary-dark)" }}>{fmtVnd(detail.quoted_price_vnd)}</b>
                  </div>
                  <div>
                    Mã ưu đãi:{" "}
                    {detail.coupon_code ? (
                      <span className="chip sm amber">
                        {detail.coupon_code}
                        {detail.discount_percent ? ` (-${detail.discount_percent}%)` : ""}
                      </span>
                    ) : (
                      "—"
                    )}
                  </div>
                  <div>Email: {detail.email || "—"}</div>
                </div>
              </div>

              <div className="card" style={{ margin: 0, padding: 14, minWidth: 0 }}>
                <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>
                  Nguồn quảng cáo &amp; Tín hiệu
                </div>
                <div style={{ display: "grid", gap: 5, fontSize: 13 }}>
                  <div>
                    Chiến dịch: <b>{detail.utm_campaign || "Trực tiếp / Organic"}</b>
                  </div>
                  <div>
                    Nguồn / Kênh: {[detail.utm_source, detail.utm_medium].filter(Boolean).join(" / ") || "—"}
                  </div>
                  {(detail.utm_content || detail.utm_term) && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      Content/Term: {[detail.utm_content, detail.utm_term].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  <div>
                    Tín hiệu:{" "}
                    <span className="chip sm amber">Xem giá {detail.price_view_count ?? 0}x</span>{" "}
                    <span className="chip sm gray">{detail.visit_count ?? 0} lượt vào</span>
                  </div>
                  <div className="muted" style={{ fontSize: 11.5, wordBreak: "break-all" }}>
                    Trang: {detail.page_path || "—"}
                    {detail.referrer ? ` · Ref: ${detail.referrer}` : ""}
                  </div>
                </div>
              </div>
            </FormGrid>

            {/* Full Message / Device / Need */}
            <div className="card" style={{ margin: 0, padding: 14 }}>
              <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>
                Thông tin thiết bị, nhu cầu &amp; lời nhắn của khách
              </div>
              <div style={{ display: "grid", gap: 6, fontSize: 13.5 }}>
                {detail.device_info && (
                  <div>
                    <b>Thiết bị / PLC / Hệ thống:</b> {detail.device_info}
                  </div>
                )}
                {detail.need && (
                  <div>
                    <b>Nhu cầu triển khai:</b> {detail.need}
                  </div>
                )}
                <div>
                  <b>Lời nhắn chi tiết:</b>{" "}
                  <span style={{ whiteSpace: "pre-wrap" }}>
                    {detail.message || "(Khách không nhập thêm lời nhắn)"}
                  </span>
                </div>
              </div>
            </div>

            {/* Status + Internal Note Editor */}
            <div className="card" style={{ margin: 0, padding: 14 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 10,
                  marginBottom: 8,
                }}
              >
                <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>
                  Trạng thái &amp; Ghi chú nội bộ KSP
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <select
                    className="ui-select"
                    value={detail.status}
                    disabled={statusBusyId === detail.id}
                    onChange={(e) => handleStatusChange(detail.id, e.target.value as WebLeadStatus)}
                    style={{ margin: 0, width: "auto" }}
                  >
                    {STATUS_ORDER.map((st) => (
                      <option key={st} value={st}>
                        {STATUS_META[st].label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-sm danger ui-btn-chip"
                    disabled={actionBusy !== null}
                    onClick={handleDeleteLead}
                  >
                    🗑 Xóa lead
                  </button>
                </div>
              </div>
              <textarea
                className="ui-textarea"
                rows={3}
                placeholder="Ghi chú nội bộ sales/kỹ thuật (đã gọi lúc mấy giờ, khách cần gửi báo giá công ty nào, tiến độ chốt…)"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                style={{ width: "100%", marginBottom: 8 }}
              />
              <button
                type="button"
                className="btn-sm ui-btn-chip"
                disabled={savingNote}
                onClick={handleSaveNote}
                style={{ fontWeight: 700 }}
              >
                {savingNote ? "⏳ Đang lưu…" : "💾 Lưu ghi chú"}
              </button>
            </div>

            {/* Visitor Event Timeline */}
            <div className="card" style={{ margin: 0, padding: 14 }}>
              <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>
                🧭 Hành trình khách truy cập ({detail.events?.length || 0} sự kiện)
              </div>
              {!detail.events || detail.events.length === 0 ? (
                <div className="muted" style={{ fontSize: 13 }}>
                  Chưa ghi nhận chuỗi sự kiện trình duyệt cho visitor này.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 6, maxHeight: 240, overflowY: "auto" }}>
                  {detail.events.map((ev) => {
                    const meta = EVENT_LABELS[ev.event_type] || {
                      icon: "•",
                      label: ev.event_type,
                      tone: "gray",
                    };
                    return (
                      <div
                        key={ev.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          flexWrap: "wrap",
                          gap: 8,
                          padding: "7px 10px",
                          borderRadius: 8,
                          background: "var(--surface-subtle)",
                          border: "1px solid var(--border)",
                          fontSize: 12.5,
                        }}
                      >
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                          <span className={`chip sm ${meta.tone}`}>
                            {meta.icon} {meta.label}
                          </span>
                          {ev.sku && <span className="chip sm blue">{ev.sku}</span>}
                          {ev.coupon && <span className="chip sm amber">🏷️ {ev.coupon}</span>}
                          <span className="muted" style={{ fontSize: 11.5, wordBreak: "break-all" }}>
                            {ev.page_path}
                          </span>
                        </div>
                        <span className="muted nowrap" style={{ fontSize: 11.5 }}>
                          {fmtDateTime(ev.created_at)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Matched AI Widget Chat History */}
            {(detail.training_session_id || (detail.training_queries?.length || 0) > 0) && (
              <div
                className="card"
                style={{
                  margin: 0,
                  padding: 14,
                  borderColor: "var(--primary)",
                  background: "var(--primary-soft)",
                }}
              >
                <div
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    color: "var(--primary-dark)",
                    marginBottom: 8,
                  }}
                >
                  🤖 Lịch sử hỏi đáp Trợ lý AI iNut.vn (Session #{detail.training_session_id} ·{" "}
                  {detail.training_queries?.length || 0} câu hỏi)
                </div>
                {!detail.training_queries || detail.training_queries.length === 0 ? (
                  <div className="muted" style={{ fontSize: 13 }}>
                    Đã khớp số điện thoại với phiên AI Widget nhưng chưa có câu hỏi lưu lại.
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 8, maxHeight: 260, overflowY: "auto" }}>
                    {detail.training_queries.map((q, idx) => {
                      const answerText = q.answer_text || extractAiAnswerText(q);
                      return (
                        <div
                          key={q.job_id || q.id || idx}
                          style={{
                            background: "var(--panel)",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            padding: "9px 11px",
                            fontSize: 12.5,
                          }}
                        >
                          <div className="muted" style={{ fontSize: 11, marginBottom: 3 }}>
                            {fmtDateTime(q.created_at)} · {q.status}
                          </div>
                          <div style={{ fontWeight: 700, color: "var(--ink)" }}>
                            ❓ {q.question}
                          </div>
                          {answerText && (
                            <div
                              className="muted"
                              style={{
                                marginTop: 4,
                                whiteSpace: "pre-wrap",
                                maxHeight: 110,
                                overflowY: "auto",
                                color: "var(--ink-2)",
                              }}
                            >
                              {answerText}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </AppModal>
    </div>
  );
}
