import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type IpTrademark,
  type TrademarkLookupResult,
} from "../api";
import {
  AppButton,
  AppIcon,
  AppModal,
  DataView,
  EmptyState,
  FilterBar,
  FormGrid,
  InlineAlert,
  KpiStrip,
  MobileCard,
  MobileCardHeader,
  PageHeader,
  PageShell,
  ResponsiveTabs,
  SectionCard,
  SkeletonBlock,
  StatusBadge,
  type StatusBadgeTone,
  TableSkeleton,
  useToast,
} from "../components/ui";
import { safeHttpUrl } from "../utils/url";

const DEFAULT_FEE_ITEMS = [
  {
    code: "LP-GH",
    name: "Lệ phí gia hạn hiệu lực văn bằng bảo hộ",
    note: "100.000 đ × 2 nhóm Nice (9, 42)",
    amount: 200000,
  },
  {
    code: "P-SD",
    name: "Phí sử dụng văn bằng bảo hộ (duy trì 10 năm)",
    note: "250.000 đ nhóm đầu + 150.000 đ nhóm tiếp theo",
    amount: 400000,
  },
  {
    code: "P-TD",
    name: "Phí thẩm định yêu cầu gia hạn",
    note: "160.000 đ / 1 văn bằng",
    amount: 160000,
  },
  {
    code: "P-CB",
    name: "Phí công bố quyết định gia hạn",
    note: "120.000 đ / 1 đơn",
    amount: 120000,
  },
  {
    code: "P-DB",
    name: "Phí đăng bạ thông tin gia hạn",
    note: "120.000 đ / 1 văn bằng",
    amount: 120000,
  },
];

function resolvePhaseTone(phase?: string): StatusBadgeTone {
  if (phase === "expired" || phase === "grace_period") return "danger";
  if (phase === "renewal_window" || phase === "expiring_soon") return "warning";
  return "success";
}

function calculateTimelineProgress(daysRemaining?: number): number {
  const totalDays = 3652;
  const remaining = daysRemaining ?? 0;
  if (remaining <= 0) return 100;
  const elapsed = totalDays - remaining;
  return Math.min(100, Math.max(0, Math.round((elapsed / totalDays) * 100)));
}

export function Trademarks() {
  const toast = useToast();
  const [trademarks, setTrademarks] = useState<IpTrademark[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [failedLogos, setFailedLogos] = useState<Record<number, boolean>>({});
  const [failedOnlineLogos, setFailedOnlineLogos] = useState<Record<string, boolean>>({});

  // Local filter & search
  const [filterStatus, setFilterStatus] = useState<"all" | "granted" | "refused">("all");
  const [searchKeyword, setSearchKeyword] = useState("");

  // Online WIPO lookup
  const [onlineQuery, setOnlineQuery] = useState("");
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineResults, setOnlineResults] = useState<TrademarkLookupResult[] | null>(null);
  const [onlineSearchedQuery, setOnlineSearchedQuery] = useState("");
  const [showOnlineModal, setShowOnlineModal] = useState(false);

  const loadTrademarks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.trademarks.list();
      setTrademarks(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Không thể tải danh sách nhãn hiệu";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadTrademarks();
  }, [loadTrademarks]);

  const handleSync = async () => {
    try {
      setSyncing(true);
      const res = await api.trademarks.sync("APNA:(INUT)", true);
      toast.success(
        res.message || `Đồng bộ thành công! Hiện có ${res.total_in_db || trademarks.length} nhãn hiệu trong hệ thống.`,
      );
      await loadTrademarks();
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Lỗi khi đồng bộ từ Cổng Cục SHTT (WIPO Publish)",
      );
    } finally {
      setSyncing(false);
    }
  };

  const handleOnlineSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = onlineQuery.trim();
    if (!q) {
      toast.info("Vui lòng nhập tên nhãn hiệu, MST hoặc tên công ty để tra cứu.");
      return;
    }
    try {
      setOnlineLoading(true);
      setOnlineSearchedQuery(q);
      const res = await api.trademarks.lookupOnline(q);
      setOnlineResults(res.items || []);
      setShowOnlineModal(true);
      toast.success(`Tìm thấy ${res.total || res.items?.length || 0} kết quả từ Cổng Cục SHTT.`);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Lỗi khi tra cứu trực tuyến từ Cục SHTT",
      );
    } finally {
      setOnlineLoading(false);
    }
  };

  const kpiStats = useMemo(() => {
    const granted = trademarks.filter((t) => t.status === "Cấp bằng");
    const refused = trademarks.filter((t) => t.status === "Từ chối");

    let nearestExpiry = "—";
    let nearestWindowStart = "—";
    if (granted.length > 0) {
      const sorted = [...granted].sort(
        (a, b) => (a.validity?.days_remaining ?? 99999) - (b.validity?.days_remaining ?? 99999),
      );
      const earliest = sorted[0];
      if (earliest.validity?.expiry_date) {
        nearestExpiry = earliest.validity.expiry_date;
        nearestWindowStart = earliest.validity.renewal_window_start || "—";
      }
    }

    const totalFees = granted.reduce((acc, t) => acc + (t.fee_breakdown?.total_amount || 1000000), 0);

    return {
      total: trademarks.length,
      grantedCount: granted.length,
      refusedCount: refused.length,
      grantedSub:
        granted.length > 0
          ? granted.map((g) => g.mark_name).slice(0, 4).join(", ")
          : "Chưa có văn bằng cấp",
      refusedSub:
        refused.length > 0
          ? refused.map((r) => `${r.mark_name} (${r.application_number})`).slice(0, 2).join(", ")
          : "Không có đơn từ chối",
      nearestExpiry,
      nearestWindowStart,
      totalFeesFormatted: `${totalFees.toLocaleString("vi-VN")} VNĐ`,
    };
  }, [trademarks]);

  const filteredTrademarks = useMemo(() => {
    return trademarks.filter((tm) => {
      if (filterStatus === "granted" && tm.status !== "Cấp bằng") return false;
      if (filterStatus === "refused" && tm.status !== "Từ chối") return false;

      if (searchKeyword.trim()) {
        const kw = searchKeyword.toLowerCase().trim();
        const classesStr = (
          Array.isArray(tm.nice_classes) ? tm.nice_classes.join(",") : String(tm.nice_classes || "")
        ).toLowerCase();
        const matched =
          tm.mark_name?.toLowerCase().includes(kw) ||
          tm.application_number?.toLowerCase().includes(kw) ||
          tm.registration_number?.toLowerCase().includes(kw) ||
          classesStr.includes(kw) ||
          tm.owner_name?.toLowerCase().includes(kw);
        if (!matched) return false;
      }
      return true;
    });
  }, [trademarks, filterStatus, searchKeyword]);

  const activeFilterCount = (filterStatus !== "all" ? 1 : 0) + (searchKeyword.trim() ? 1 : 0);

  return (
    <PageShell className="trademarks-page" data-page="trademarks">
      <PageHeader
        variant="compact"
        icon="award"
        title="Quản Lý Nhãn Hiệu & Thời Hạn Gia Hạn"
        subtitle="Cục SHTT (WIPO Publish) · Đếm ngược hiệu lực 10 năm (Điều 93 Luật SHTT) và dự toán lệ phí TT 263/2016."
        actions={
          <AppButton
            variant="primary"
            size="sm"
            leftIcon="refresh"
            loading={syncing}
            onClick={handleSync}
            title="Đồng bộ lại toàn bộ dữ liệu và logo từ Cổng Cục SHTT"
          >
            {syncing ? "Đang đồng bộ WIPO..." : "Đồng bộ từ Cục SHTT (WIPO)"}
          </AppButton>
        }
      />

      {/* Unified INUT KPI Strip */}
      <KpiStrip
        columns={5}
        loading={loading}
        items={[
          {
            label: "Tổng số đơn",
            value: kpiStats.total,
            sub: "Đơn nộp tại Cục SHTT",
            icon: "file-badge",
            tone: "brand",
            active: filterStatus === "all",
            onClick: () => setFilterStatus("all"),
          },
          {
            label: "Đã cấp bằng",
            value: kpiStats.grantedCount,
            sub: kpiStats.grantedSub,
            icon: "badge-check",
            tone: "success",
            active: filterStatus === "granted",
            onClick: () => setFilterStatus("granted"),
          },
          {
            label: "Bị từ chối",
            value: kpiStats.refusedCount,
            sub: kpiStats.refusedSub,
            icon: "ban",
            tone: "danger",
            active: filterStatus === "refused",
            onClick: () => setFilterStatus("refused"),
          },
          {
            label: "Hạn gia hạn gần nhất",
            value: kpiStats.nearestExpiry,
            sub: (
              <>
                Mở tiếp nhận từ <strong>{kpiStats.nearestWindowStart}</strong>
              </>
            ),
            icon: "calendar",
            tone: "warning",
          },
          {
            label: "Dự toán lệ phí",
            value: kpiStats.totalFeesFormatted,
            sub: `${kpiStats.grantedCount} nhãn hiệu (TT 263/2016)`,
            icon: "coins",
            tone: "gold",
          },
        ]}
      />

      {/* Local Search, Status Tabs & Online WIPO Lookup Bar */}
      <FilterBar
        collapsibleMobile
        search={{
          value: searchKeyword,
          onChange: setSearchKeyword,
          placeholder: "Lọc tên nhãn hiệu, số đơn, số bằng, nhóm Nice...",
          ariaLabel: "Lọc danh mục nhãn hiệu",
        }}
        activeCount={activeFilterCount}
        onReset={() => {
          setFilterStatus("all");
          setSearchKeyword("");
        }}
        filters={
          <>
            <ResponsiveTabs
              variant="segmented"
              className="tm-tabs-inline"
              ariaLabel="Lọc trạng thái nhãn hiệu"
              active={filterStatus}
              onChange={(id) => setFilterStatus(id as "all" | "granted" | "refused")}
              tabs={[
                { id: "all", label: "Tất cả", badge: trademarks.length },
                {
                  id: "granted",
                  label: "Cấp bằng",
                  icon: "check-circle",
                  badge: kpiStats.grantedCount,
                },
                {
                  id: "refused",
                  label: "Từ chối",
                  icon: "ban",
                  badge: kpiStats.refusedCount,
                },
              ]}
            />
            <form className="tm-wipo-form" onSubmit={handleOnlineSearch}>
              <input
                type="text"
                placeholder="Tra cứu toàn quốc trên WIPO (tên nhãn, MST...)"
                aria-label="Tra cứu nhãn hiệu trực tuyến trên Cục SHTT"
                value={onlineQuery}
                onChange={(e) => setOnlineQuery(e.target.value)}
                className="ui-input tm-wipo-input"
              />
              <AppButton
                type="submit"
                variant="primary"
                size="sm"
                leftIcon="globe"
                loading={onlineLoading}
              >
                {onlineLoading ? "Đang tra..." : "Tra cứu WIPO"}
              </AppButton>
            </form>
          </>
        }
      />

      {/* Main Content */}
      {loading ? (
        <div className="ui-stack--lg">
          <SkeletonBlock variant="card" />
          <TableSkeleton rows={4} cols={4} />
        </div>
      ) : error ? (
        <InlineAlert
          tone="danger"
          title="Không thể tải danh sách nhãn hiệu"
          action={
            <AppButton variant="secondary" size="sm" leftIcon="refresh" onClick={loadTrademarks}>
              Thử lại
            </AppButton>
          }
        >
          {error}
        </InlineAlert>
      ) : filteredTrademarks.length === 0 ? (
        <EmptyState
          icon="award"
          title="Không tìm thấy nhãn hiệu phù hợp"
          description='Thử xóa từ khóa tìm kiếm hoặc bấm "Đồng bộ từ Cục SHTT (WIPO)".'
          action={
            <AppButton
              variant="secondary"
              leftIcon="rotate-ccw"
              onClick={() => {
                setFilterStatus("all");
                setSearchKeyword("");
              }}
            >
              Đặt lại bộ lọc
            </AppButton>
          }
        />
      ) : (
        <div className="ui-stack--lg">
          {filteredTrademarks.map((tm) => {
            const isGranted = tm.status === "Cấp bằng";
            const isRefused = tm.status === "Từ chối";
            const validity = tm.validity;
            const fees = tm.fee_breakdown;
            const feeItems = fees?.items && fees.items.length > 0 ? fees.items : DEFAULT_FEE_ITEMS;
            const progress = calculateTimelineProgress(validity?.days_remaining);
            const niceList = (
              Array.isArray(tm.nice_classes)
                ? tm.nice_classes
                : String(tm.nice_classes || "").split(",")
            )
              .map((c) => String(c).trim())
              .filter(Boolean);

            return (
              <SectionCard key={tm.id}>
                <div className="tm-card-top">
                  <div className="ui-logo-frame ui-logo-frame--md">
                    {failedLogos[tm.id] ? (
                      <div className="ui-logo-fallback tm-logo-fallback" aria-hidden="true">
                        <AppIcon name="award" size={24} />
                      </div>
                    ) : (
                      <img
                        src={api.trademarks.getLogoUrl(tm.id)}
                        alt={tm.mark_name}
                        className="tm-logo-img"
                        loading="lazy"
                        onError={() => {
                          setFailedLogos((prev) => (prev[tm.id] ? prev : { ...prev, [tm.id]: true }));
                        }}
                      />
                    )}
                  </div>

                  <div className="ui-stack ui-flex-1">
                    <div className="ui-row-between">
                      <h2 className="tm-mark-name">{tm.mark_name}</h2>
                      <div className="ui-row">
                        <StatusBadge
                          tone={isGranted ? "success" : isRefused ? "danger" : "warning"}
                          icon={isGranted ? "check-circle" : isRefused ? "ban" : "clock"}
                          dot
                        >
                          {isGranted ? "Đã cấp bằng" : isRefused ? "Bị từ chối" : tm.status}
                        </StatusBadge>

                        {tm.registration_number && (
                          <StatusBadge
                            tone="brand"
                            variant="outline"
                            title="Số Giấy chứng nhận đăng ký nhãn hiệu"
                          >
                            Bằng số: {tm.registration_number}
                          </StatusBadge>
                        )}

                        <StatusBadge tone="neutral" title="Số đơn đăng ký nhãn hiệu">
                          Số đơn: {tm.application_number}
                        </StatusBadge>
                      </div>
                    </div>

                    <div className="ui-grid-4">
                      <div className="ui-meta-item">
                        <span className="ui-meta-label">Ngày nộp đơn</span>
                        <span className="ui-meta-value num">{tm.filing_date || "—"}</span>
                      </div>
                      <div className="ui-meta-item">
                        <span className="ui-meta-label">Ngày cấp bằng</span>
                        <span className="ui-meta-value num">{tm.grant_date || "—"}</span>
                      </div>
                      <div className="ui-meta-item">
                        <span className="ui-meta-label">Ngày công bố</span>
                        <span className="ui-meta-value num">{tm.publication_date || "—"}</span>
                      </div>
                      <div className="ui-meta-item">
                        <span className="ui-meta-label">Chủ văn bằng</span>
                        <span className="ui-meta-value" title={tm.owner_address || tm.owner_name}>
                          {tm.owner_name}
                        </span>
                      </div>
                    </div>

                    <div className="ui-row">
                      <span className="ui-meta-label">Phân nhóm Nice:</span>
                      {niceList.map((cls) => (
                        <StatusBadge key={cls} tone="info" size="sm">
                          Nhóm {cls}
                        </StatusBadge>
                      ))}
                      {tm.mark_type && (
                        <StatusBadge tone="neutral" size="sm">
                          Kiểu: {tm.mark_type}
                        </StatusBadge>
                      )}
                      {tm.colors && (
                        <StatusBadge tone="neutral" size="sm" title={tm.colors}>
                          Màu sắc: {tm.colors}
                        </StatusBadge>
                      )}
                    </div>
                  </div>
                </div>

                {tm.goods_services && (
                  <div className="ui-subpanel ui-mt-3">
                    <div className="ui-meta-label ui-mb-2">Danh mục hàng hóa & Dịch vụ bảo hộ</div>
                    <div className="ui-text-body">{tm.goods_services}</div>
                  </div>
                )}

                {isRefused && (
                  <div className="ui-stack ui-divider-top ui-mt-4">
                    <InlineAlert
                      tone="warning"
                      title="Đơn nhãn hiệu đã bị từ chối cấp văn bằng bảo hộ"
                    >
                      Nhãn hiệu <strong>{tm.mark_name}</strong> (Đơn số <code>{tm.application_number}</code> nộp ngày{" "}
                      {tm.filing_date}) không được cấp văn bằng, nên không phát sinh hiệu lực 10 năm và lệ phí gia hạn nhà nước.
                    </InlineAlert>
                  </div>
                )}

                {isGranted && (
                  <>
                    {/* 10-Year Renewal Countdown & Timeline */}
                    <div className="ui-stack ui-divider-top ui-mt-4">
                      <div className="ui-row-between">
                        <h3 className="ui-subhead">
                          <AppIcon name="clock" size={16} />
                          <span>Thời Hạn Hiệu Lực & Đếm Ngược Gia Hạn (Điều 93 Luật SHTT)</span>
                        </h3>
                        <StatusBadge tone={resolvePhaseTone(validity?.phase)} dot>
                          {validity?.phase_label || "Đang có hiệu lực"}
                        </StatusBadge>
                      </div>

                      <div className="ui-grid-4">
                        <div className="ui-stat-tile ui-stat-tile--accent">
                          <span className="ui-meta-label">Thời gian còn lại</span>
                          <span className="tm-date-val">
                            {validity?.time_remaining_formatted || "—"}
                          </span>
                          <span className="ui-muted">Hiệu lực 10 năm từ {tm.filing_date}</span>
                        </div>

                        <div className="ui-stat-tile">
                          <span className="ui-meta-label">Ngày hết hiệu lực</span>
                          <span className="tm-date-val">{validity?.expiry_date || tm.expiry_date || "—"}</span>
                          <span className="ui-muted">10 năm từ ngày nộp đơn</span>
                        </div>

                        <div className="ui-stat-tile">
                          <span className="ui-meta-label">Mở tiếp nhận gia hạn</span>
                          <span className="tm-date-val">
                            {validity?.renewal_window_start || tm.renewal_window_start || "—"}
                          </span>
                          <span className="ui-muted">Trước 6 tháng theo luật định</span>
                        </div>

                        <div className="ui-stat-tile">
                          <span className="ui-meta-label">Hạn chót ân hạn muộn</span>
                          <span className="tm-date-val">{validity?.grace_period_end || "—"}</span>
                          <span className="ui-muted">+6 tháng sau hết hạn (+10%/tháng)</span>
                        </div>
                      </div>

                      <div className="ui-stack">
                        <progress
                          className="ui-progress"
                          value={progress}
                          max={100}
                          aria-label={`Tiến trình hiệu lực văn bằng ${tm.mark_name}: ${progress}%`}
                        />

                        <div className="ui-milestones">
                          <div className="ui-milestone">
                            <span className="ui-status-dot" aria-hidden="true" />
                            <div className="ui-stack--xs ui-flex-1">
                              <span className="ui-text-xs ui-text-strong">Nộp đơn: {tm.filing_date || "—"}</span>
                              <span className="ui-muted">Năm 0</span>
                            </div>
                          </div>

                          <div className="ui-milestone">
                            <span className="ui-status-dot ui-status-dot--brand" aria-hidden="true" />
                            <div className="ui-stack--xs ui-flex-1">
                              <span className="ui-text-xs ui-text-strong">Hôm nay ({progress}%)</span>
                              <span className="ui-muted">Vị trí hiệu lực hiện tại</span>
                            </div>
                          </div>

                          <div className="ui-milestone">
                            <span className="ui-status-dot ui-status-dot--warning" aria-hidden="true" />
                            <div className="ui-stack--xs ui-flex-1">
                              <span className="ui-text-xs ui-text-strong">
                                Mở gia hạn: {validity?.renewal_window_start || "—"}
                              </span>
                              <span className="ui-muted">Trước 6 tháng</span>
                            </div>
                          </div>

                          <div className="ui-milestone">
                            <span className="ui-status-dot ui-status-dot--danger" aria-hidden="true" />
                            <div className="ui-stack--xs ui-flex-1">
                              <span className="ui-text-xs ui-text-strong">
                                Hết hạn: {validity?.expiry_date || "—"}
                              </span>
                              <span className="ui-muted">Năm thứ 10</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Government Fee Breakdown */}
                    <div className="ui-stack ui-divider-top ui-mt-4">
                      <div className="ui-row-between">
                        <h3 className="ui-subhead">
                          <AppIcon name="landmark" size={16} />
                          <span>Dự Toán Lệ Phí Gia Hạn Nhà Nước</span>
                        </h3>
                        <StatusBadge tone="neutral" size="sm">
                          Căn cứ TT 263/2016/TT-BTC & TT 63/2023/TT-BTC
                        </StatusBadge>
                      </div>

                      <DataView
                        mobileMode="card"
                        desktop={
                          <div className="ui-table-scroll-wrap" tabIndex={0}>
                            <table className="ui-table">
                              <thead>
                                <tr>
                                  <th>STT</th>
                                  <th>Khoản mục lệ phí / phí nhà nước</th>
                                  <th>Diễn giải & Căn cứ tính</th>
                                  <th className="col-num">Số tiền</th>
                                </tr>
                              </thead>
                              <tbody>
                                {feeItems.map((item, idx) => (
                                  <tr key={item.code || idx}>
                                    <td className="num">{idx + 1}</td>
                                    <td>
                                      <strong>{item.name}</strong>
                                      {item.code && <div className="muted">Mã: {item.code}</div>}
                                    </td>
                                    <td className="muted">{item.note}</td>
                                    <td className="col-num">
                                      {item.amount.toLocaleString("vi-VN")} đ
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr className="ui-row-selected ui-text-strong">
                                  <td colSpan={3}>
                                    TỔNG LỆ PHÍ NHÀ NƯỚC CHO 1 NHÃN HIỆU ({niceList.length || 2} NHÓM)
                                  </td>
                                  <td className="col-num">
                                    {fees?.total_formatted || "1.000.000 VNĐ"}
                                  </td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        }
                        mobileCards={
                          <div className="ui-mobile-card-list">
                            {feeItems.map((item, idx) => (
                              <MobileCard key={item.code || idx}>
                                <MobileCardHeader
                                  title={`${idx + 1}. ${item.name}`}
                                  subtitle={item.note}
                                  badge={
                                    <StatusBadge tone="brand" size="sm">
                                      {item.amount.toLocaleString("vi-VN")} đ
                                    </StatusBadge>
                                  }
                                />
                              </MobileCard>
                            ))}
                            <MobileCard className="ui-stat-tile--accent">
                              <MobileCardHeader
                                title="TỔNG LỆ PHÍ NHÀ NƯỚC"
                                badge={
                                  <StatusBadge tone="brand" variant="solid">
                                    {fees?.total_formatted || "1.000.000 VNĐ"}
                                  </StatusBadge>
                                }
                              />
                            </MobileCard>
                          </div>
                        }
                      />

                      <InlineAlert tone="info">
                        Biểu phí áp dụng theo Mục 1 Biểu mức thu phí, lệ phí SHTT kèm Thông tư 263/2016/TT-BTC. Lệ phí nộp trực tiếp vào Kho bạc Nhà nước khi nộp hồ sơ gia hạn tại Cục Sở hữu trí tuệ.
                      </InlineAlert>
                    </div>
                  </>
                )}
              </SectionCard>
            );
          })}
        </div>
      )}

      {/* Online WIPO Lookup Modal */}
      <AppModal
        open={showOnlineModal}
        onClose={() => setShowOnlineModal(false)}
        title={`Kết quả tra cứu trực tuyến: "${onlineSearchedQuery}"`}
        subtitle="CỔNG DỮ LIỆU CỤC SỞ HỮU TRÍ TUỆ (WIPO PUBLISH)"
        size="lg"
        footer={
          <AppButton variant="secondary" onClick={() => setShowOnlineModal(false)}>
            Đóng
          </AppButton>
        }
      >
        {!onlineResults || onlineResults.length === 0 ? (
          <EmptyState
            icon="search"
            compact
            title="Không tìm thấy kết quả"
            description="Không tìm thấy nhãn hiệu nào khớp với từ khóa trên Cổng Cục SHTT."
          />
        ) : (
          <div className="ui-stack">
            <InlineAlert tone="info">
              Tìm thấy <strong>{onlineResults.length}</strong> nhãn hiệu trên hệ thống Cục SHTT.
            </InlineAlert>

            {onlineResults.map((item, i) => {
              const itemKey = item.application_number || String(i);
              const safeThumb = safeHttpUrl(item.thumbnail_url);
              const safeDetailUrl = safeHttpUrl(item.detail_url);
              const badgeTone: StatusBadgeTone =
                item.status === "Cấp bằng"
                  ? "success"
                  : item.status === "Từ chối"
                    ? "danger"
                    : "warning";

              return (
                <article key={itemKey} className="ui-subpanel ui-subpanel--1 ui-row ui-row--md ui-row--start tm-online-card">
                  <div className="ui-logo-frame ui-logo-frame--md">
                    {safeThumb && !failedOnlineLogos[itemKey] ? (
                      <img
                        src={safeThumb}
                        alt={item.mark_name}
                        className="tm-logo-img"
                        onError={() => {
                          setFailedOnlineLogos((prev) =>
                            prev[itemKey] ? prev : { ...prev, [itemKey]: true },
                          );
                        }}
                      />
                    ) : (
                      <div className="ui-logo-fallback tm-logo-fallback" aria-hidden="true">
                        <AppIcon name="award" size={22} />
                      </div>
                    )}
                  </div>

                  <div className="ui-stack--sm ui-flex-1">
                    <div className="ui-row-between">
                      <h3 className="tm-mark-name">{item.mark_name}</h3>
                      <StatusBadge tone={badgeTone} dot size="sm">
                        {item.status || "Chưa rõ"}
                      </StatusBadge>
                    </div>

                    <FormGrid cols={2}>
                      <div className="ui-meta-item">
                        <span className="ui-meta-label">Số đơn</span>
                        <span className="ui-meta-value num">{item.application_number}</span>
                      </div>
                      <div className="ui-meta-item">
                        <span className="ui-meta-label">Số bằng</span>
                        <span className="ui-meta-value num">
                          {item.registration_number || "Chưa cấp"}
                        </span>
                      </div>
                      <div className="ui-meta-item">
                        <span className="ui-meta-label">Ngày nộp đơn</span>
                        <span className="ui-meta-value num">{item.filing_date || "—"}</span>
                      </div>
                      <div className="ui-meta-item">
                        <span className="ui-meta-label">Ngày cấp</span>
                        <span className="ui-meta-value num">{item.grant_date || "—"}</span>
                      </div>
                      <div className="ui-meta-item ui-form-grid-span-full">
                        <span className="ui-meta-label">Chủ đơn</span>
                        <span className="ui-meta-value">{item.owner_name || "—"}</span>
                      </div>
                      <div className="ui-meta-item ui-form-grid-span-full">
                        <span className="ui-meta-label">Nhóm Nice</span>
                        <span className="ui-meta-value">{item.nice_classes || "—"}</span>
                      </div>
                    </FormGrid>

                    {safeDetailUrl && (
                      <div>
                        <a
                          href={safeDetailUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ui-link"
                        >
                          <span>Xem hồ sơ gốc trên WIPO Publish</span>
                          <AppIcon name="external-link" size={14} />
                        </a>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </AppModal>
    </PageShell>
  );
}
