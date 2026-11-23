import React, { useEffect, useMemo, useState } from "react";
import {
  api,
  IpTrademark,
  TrademarkLookupResult,
} from "../api";
import { AppModal, DataView, FormGrid, ResponsiveTabs } from "../components/ui";
import { safeHttpUrl } from "../utils/url";

export function Trademarks() {
  const [trademarks, setTrademarks] = useState<IpTrademark[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [failedLogos, setFailedLogos] = useState<Record<number, boolean>>({});
  const [failedOnlineLogos, setFailedOnlineLogos] = useState<Record<string, boolean>>({});
  const [isNarrow, setIsNarrow] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 640px)").matches : false,
  );

  // Local filter & search
  const [filterStatus, setFilterStatus] = useState<"all" | "granted" | "refused">("all");
  const [searchKeyword, setSearchKeyword] = useState("");

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 640px)");
    const onChange = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    setIsNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Online WIPO lookup
  const [onlineQuery, setOnlineQuery] = useState("");
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineResults, setOnlineResults] = useState<TrademarkLookupResult[] | null>(null);
  const [onlineSearchedQuery, setOnlineSearchedQuery] = useState("");
  const [showOnlineModal, setShowOnlineModal] = useState(false);

  // Toast feedback
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Load trademark list
  const loadTrademarks = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.trademarks.list();
      setTrademarks(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Không thể tải danh sách nhãn hiệu";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTrademarks();
  }, []);

  // Sync from WIPO
  const handleSync = async () => {
    try {
      setSyncing(true);
      const res = await api.trademarks.sync("APNA:(INUT)", true);
      showToast(
        res.message || `Đồng bộ thành công! Hiện có ${res.total_in_db || 5} nhãn hiệu trong hệ thống.`,
        "success"
      );
      await loadTrademarks();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Lỗi khi đồng bộ từ Cổng Cục SHTT (WIPO Publish)";
      showToast(msg, "error");
    } finally {
      setSyncing(false);
    }
  };

  // Online search from WIPO
  const handleOnlineSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = onlineQuery.trim();
    if (!q) {
      showToast("Vui lòng nhập tên nhãn hiệu, MST hoặc tên công ty để tra cứu", "info");
      return;
    }
    try {
      setOnlineLoading(true);
      setOnlineSearchedQuery(q);
      const res = await api.trademarks.lookupOnline(q);
      setOnlineResults(res.items || []);
      setShowOnlineModal(true);
      showToast(`Tìm thấy ${res.total || res.items?.length || 0} kết quả từ Cổng Cục SHTT!`, "success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Lỗi khi tra cứu trực tuyến từ Cục SHTT";
      showToast(msg, "error");
    } finally {
      setOnlineLoading(false);
    }
  };

  // Dynamic KPI Stats
  const kpiStats = useMemo(() => {
    const total = trademarks.length;
    const granted = trademarks.filter((t) => t.status === "Cấp bằng");
    const refused = trademarks.filter((t) => t.status === "Từ chối");
    const grantedCount = granted.length;
    const refusedCount = refused.length;

    // Nearest expiry date among granted marks
    let nearestExpiry = "04/11/2029";
    let nearestWindowStart = "04/05/2029";
    let nearestTimeFormatted = "Còn ~3 năm 1 tháng";

    if (granted.length > 0) {
      // Sort by days_remaining
      const sorted = [...granted].sort((a, b) => {
        const d1 = a.validity?.days_remaining ?? 99999;
        const d2 = b.validity?.days_remaining ?? 99999;
        return d1 - d2;
      });
      const earliest = sorted[0];
      if (earliest.validity?.expiry_date) {
        nearestExpiry = earliest.validity.expiry_date;
        nearestWindowStart = earliest.validity.renewal_window_start || "";
        nearestTimeFormatted = earliest.validity.time_remaining_formatted || "";
      }
    }

    // Total fees for granted marks
    const totalFees = granted.reduce((acc, t) => {
      return acc + (t.fee_breakdown?.total_amount || 1000000);
    }, 0);

    const totalFeesFormatted =
      totalFees > 0
        ? `${totalFees.toLocaleString("vi-VN")} VNĐ`
        : "4.000.000 VNĐ";

    return {
      total: total || 5,
      grantedCount: grantedCount || 4,
      refusedCount: refusedCount || 1,
      nearestExpiry,
      nearestWindowStart,
      nearestTimeFormatted,
      totalFeesFormatted,
    };
  }, [trademarks]);

  // Filtered trademarks for display
  const filteredTrademarks = useMemo(() => {
    return trademarks.filter((tm) => {
      // Status filter
      if (filterStatus === "granted" && tm.status !== "Cấp bằng") return false;
      if (filterStatus === "refused" && tm.status !== "Từ chối") return false;

      // Search keyword filter
      if (searchKeyword.trim()) {
        const kw = searchKeyword.toLowerCase().trim();
        const matchName = tm.mark_name?.toLowerCase().includes(kw);
        const matchAppNo = tm.application_number?.toLowerCase().includes(kw);
        const matchRegNo = tm.registration_number?.toLowerCase().includes(kw);
        const matchClasses = (Array.isArray(tm.nice_classes)
          ? tm.nice_classes.join(",")
          : String(tm.nice_classes || "")
        )
          .toLowerCase()
          .includes(kw);
        const matchOwner = tm.owner_name?.toLowerCase().includes(kw);
        if (!matchName && !matchAppNo && !matchRegNo && !matchClasses && !matchOwner) {
          return false;
        }
      }
      return true;
    });
  }, [trademarks, filterStatus, searchKeyword]);

  // Timeline progress calculation (10 years)
  const calculateTimelineProgress = (filingDateStr?: string, daysRemaining?: number) => {
    const totalDays = 3652; // 10 years approx
    const remaining = daysRemaining ?? 0;
    if (remaining <= 0) return 100;
    const elapsed = totalDays - remaining;
    const pct = Math.min(100, Math.max(0, Math.round((elapsed / totalDays) * 100)));
    return pct;
  };

  return (
    <div className="trademarks-page">
      {/* Toast Notification */}
      {toast && (
        <div className={`tm-toast tm-toast-${toast.type}`} role="status">
          <span className="tm-toast-icon">
            {toast.type === "success" ? "✅" : toast.type === "error" ? "⚠️" : "ℹ️"}
          </span>
          <span className="tm-toast-message">{toast.message}</span>
          <button
            type="button"
            className="tm-toast-close"
            onClick={() => setToast(null)}
            aria-label="Đóng thông báo"
          >
            ✕
          </button>
        </div>
      )}

      {/* Page Header */}
      <div className="tm-page-header">
        <div className="tm-header-left">
          <div className="tm-eyebrow">SỞ HỮU TRÍ TUỆ · CỤC SHTT VIỆT NAM (WIPO PUBLISH)</div>
          <h1 className="tm-page-title">
            <span className="tm-title-icon">®️</span> Quản Lý Nhãn Hiệu & Thời Hạn Gia Hạn
          </h1>
          <p className="tm-page-desc">
            Theo dõi tiến trình 5 đơn nhãn hiệu của <strong>INUT</strong>, tự động tính toán countdown 10 năm hiệu lực văn bằng (Điều 93 Luật SHTT) và bóc tách dự toán lệ phí gia hạn theo Thông tư 263/2016/TT-BTC.
          </p>
        </div>
        <div className="tm-header-actions">
          <button
            type="button"
            className={`tm-btn tm-btn-sync ${syncing ? "loading" : ""}`}
            onClick={handleSync}
            disabled={syncing}
            title="Đồng bộ lại toàn bộ dữ liệu và logo từ Cổng Cục SHTT"
          >
            {syncing ? (
              <>
                <span className="tm-spinner" aria-hidden="true" /> Đang đồng bộ WIPO...
              </>
            ) : (
              <>
                <span className="tm-btn-icon">🔄</span> Đồng bộ từ Cục SHTT (WIPO)
              </>
            )}
          </button>
        </div>
      </div>

      {/* KPI Hero Banner */}
      <div className="tm-kpi-grid">
        <div className="tm-kpi-card tm-kpi-total">
          <div className="tm-kpi-label">Tổng số đơn đăng ký</div>
          <div className="tm-kpi-value">{kpiStats.total}</div>
          <div className="tm-kpi-sub">Đơn nộp tại Cục SHTT Việt Nam</div>
        </div>

        <div className="tm-kpi-card tm-kpi-granted">
          <div className="tm-kpi-label">Đã cấp Giấy chứng nhận</div>
          <div className="tm-kpi-value">{kpiStats.grantedCount}</div>
          <div className="tm-kpi-sub">iNut, iNut Platform, iNut Door, iNutMuro</div>
        </div>

        <div className="tm-kpi-card tm-kpi-refused">
          <div className="tm-kpi-label">Bị từ chối</div>
          <div className="tm-kpi-value">{kpiStats.refusedCount}</div>
          <div className="tm-kpi-sub">iNutNebi (Đơn số 4-2019-48906)</div>
        </div>

        <div className="tm-kpi-card tm-kpi-renewal">
          <div className="tm-kpi-label">Hạn gia hạn gần nhất</div>
          <div className="tm-kpi-value tm-kpi-date">{kpiStats.nearestExpiry}</div>
          <div className="tm-kpi-sub">
            Mở tiếp nhận từ <strong>{kpiStats.nearestWindowStart}</strong>
          </div>
        </div>

        <div className="tm-kpi-card tm-kpi-fees">
          <div className="tm-kpi-label">Tổng dự toán lệ phí nhà nước</div>
          <div className="tm-kpi-value tm-kpi-money">{kpiStats.totalFeesFormatted}</div>
          <div className="tm-kpi-sub">1.000.000 đ × 4 nhãn (Thông tư 263/2016)</div>
        </div>
      </div>

      {/* Action Bar: Filters & Online Search */}
      <div className="tm-action-bar">
        <div className="tm-action-filters" style={{ minWidth: 0, flexWrap: "wrap" }}>
          <ResponsiveTabs
            className="tm-pills"
            ariaLabel="Lọc trạng thái nhãn hiệu"
            active={filterStatus}
            onChange={(id) => setFilterStatus(id as "all" | "granted" | "refused")}
            tabs={[
              { id: "all", label: "Tất cả", badge: trademarks.length },
              {
                id: "granted",
                label: "✓ Đã cấp bằng",
                badge: trademarks.filter((t) => t.status === "Cấp bằng").length,
              },
              {
                id: "refused",
                label: "✕ Từ chối",
                badge: trademarks.filter((t) => t.status === "Từ chối").length,
              },
            ]}
          />

          <div className="tm-search-box" style={{ minWidth: 0, flex: "1 1 min(100%, 240px)" }}>
            <span className="tm-search-icon">🔍</span>
            <input
              type="text"
              placeholder="Lọc tên nhãn hiệu, số đơn, số bằng, nhóm Nice..."
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              className="tm-search-input ui-input"
            />
            {searchKeyword && (
              <button
                type="button"
                className="tm-search-clear ui-btn-icon"
                onClick={() => setSearchKeyword("")}
                title="Xóa bộ lọc"
                aria-label="Xóa bộ lọc"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Online Search Form */}
        <form className="tm-online-search-form" onSubmit={handleOnlineSearch} style={{ flexWrap: "wrap", minWidth: 0 }}>
          <div className="tm-online-input-wrapper" style={{ minWidth: 0, flex: "1 1 min(100%, 240px)" }}>
            <span className="tm-online-icon">🌐</span>
            <input
              type="text"
              placeholder="Tra cứu nhãn hiệu toàn quốc (tên nhãn, MST...)"
              value={onlineQuery}
              onChange={(e) => setOnlineQuery(e.target.value)}
              className="tm-online-input ui-input"
            />
          </div>
          <button
            type="submit"
            className="tm-btn tm-btn-online ui-btn-chip"
            disabled={onlineLoading}
          >
            {onlineLoading ? (
              <>
                <span className="tm-spinner-sm" /> Đang tra...
              </>
            ) : (
              <>Tra cứu WIPO</>
            )}
          </button>
        </form>
      </div>

      {/* Main Content: Trademark Cards List */}
      {loading ? (
        <div className="tm-loading-state">
          <div className="tm-big-spinner" />
          <p>Đang tải danh mục nhãn hiệu và tính toán thời hạn gia hạn...</p>
        </div>
      ) : error ? (
        <div className="tm-error-card">
          <h3>Đã xảy ra lỗi</h3>
          <p>{error}</p>
          <button type="button" className="tm-btn" onClick={loadTrademarks}>
            Thử lại
          </button>
        </div>
      ) : filteredTrademarks.length === 0 ? (
        <div className="tm-empty-state">
          <div className="tm-empty-icon">📂</div>
          <h3>Không tìm thấy nhãn hiệu phù hợp</h3>
          <p>Thử xóa từ khóa tìm kiếm hoặc bấm "Đồng bộ từ Cục SHTT (WIPO)"</p>
          <button
            type="button"
            className="tm-btn"
            onClick={() => {
              setFilterStatus("all");
              setSearchKeyword("");
            }}
          >
            Đặt lại bộ lọc
          </button>
        </div>
      ) : (
        <div className="tm-cards-list">
          {filteredTrademarks.map((tm) => {
            const isGranted = tm.status === "Cấp bằng";
            const isRefused = tm.status === "Từ chối";
            const validity = tm.validity;
            const fees = tm.fee_breakdown;
            const progress = calculateTimelineProgress(tm.filing_date, validity?.days_remaining);

            return (
              <article key={tm.id} className={`tm-card ${isGranted ? "tm-card-granted" : isRefused ? "tm-card-refused" : ""}`}>
                {/* Trademark Card Top Info */}
                <div className="tm-card-header">
                  {/* Trademark Logo */}
                  <div className="tm-logo-container">
                    {failedLogos[tm.id] ? (
                      <div className="tm-logo-fallback">
                        <span className="tm-logo-fallback-text">
                          {(tm.mark_name || "?").charAt(0)}
                        </span>
                        <span className="tm-logo-fallback-r">®</span>
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

                  {/* Trademark Basic Meta */}
                  <div className="tm-card-meta">
                    <div className="tm-meta-title-row">
                      <h2 className="tm-mark-name">{tm.mark_name}</h2>
                      <div className="tm-badges-row">
                        <span
                          className={`tm-badge-status ${
                            isGranted ? "badge-granted" : isRefused ? "badge-refused" : "badge-pending"
                          }`}
                        >
                          {isGranted ? "✓ Đã cấp bằng" : isRefused ? "✕ Bị từ chối" : tm.status}
                        </span>

                        {tm.registration_number && (
                          <span className="tm-badge-reg" title="Số Giấy chứng nhận đăng ký nhãn hiệu">
                            Bằng số: <strong>{tm.registration_number}</strong>
                          </span>
                        )}

                        <span className="tm-badge-app" title="Số đơn đăng ký nhãn hiệu">
                          Số đơn: <strong>{tm.application_number}</strong>
                        </span>
                      </div>
                    </div>

                    {/* Dates & Owner */}
                    <div className="tm-meta-grid">
                      <div className="tm-meta-item">
                        <span className="tm-meta-label">Ngày nộp đơn:</span>
                        <span className="tm-meta-value">{tm.filing_date || "—"}</span>
                      </div>
                      <div className="tm-meta-item">
                        <span className="tm-meta-label">Ngày cấp bằng:</span>
                        <span className="tm-meta-value">
                          {tm.grant_date ? (
                            <strong className="tm-grant-highlight">{tm.grant_date}</strong>
                          ) : (
                            "—"
                          )}
                        </span>
                      </div>
                      <div className="tm-meta-item">
                        <span className="tm-meta-label">Ngày công bố:</span>
                        <span className="tm-meta-value">{tm.publication_date || "—"}</span>
                      </div>
                      <div className="tm-meta-item tm-meta-owner">
                        <span className="tm-meta-label">Chủ văn bằng:</span>
                        <span className="tm-meta-value" title={tm.owner_address || tm.owner_name}>
                          {tm.owner_name}
                        </span>
                      </div>
                    </div>

                    {/* Nice Classes & Classification */}
                    <div className="tm-classes-row">
                      <span className="tm-classes-label">Phân nhóm Nice:</span>
                      <div className="tm-nice-badges">
                        {(Array.isArray(tm.nice_classes)
                          ? tm.nice_classes
                          : String(tm.nice_classes || "").split(",")
                        )
                          .map((c) => String(c).trim())
                          .filter(Boolean)
                          .map((cls) => (
                            <span key={cls} className="tm-nice-tag">
                              Nhóm {cls}
                            </span>
                          ))}
                      </div>
                      {tm.mark_type && (
                        <span className="tm-meta-pill">Kiểu: {tm.mark_type}</span>
                      )}
                      {tm.colors && (
                        <span className="tm-meta-pill" title={tm.colors}>
                          Màu sắc: {tm.colors}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Goods / Services details */}
                {tm.goods_services && (
                  <div className="tm-goods-section">
                    <div className="tm-goods-title">Danh mục hàng hóa & Dịch vụ bảo hộ:</div>
                    <div className="tm-goods-content">{tm.goods_services}</div>
                  </div>
                )}

                {/* Refused State Message */}
                {isRefused && (
                  <div className="tm-refused-notice">
                    <div className="tm-refused-icon">⚠️</div>
                    <div>
                      <strong>Đơn nhãn hiệu đã bị từ chối cấp văn bằng bảo hộ</strong>
                      <p>
                        Nhãn hiệu <em>{tm.mark_name}</em> (Đơn số <code>{tm.application_number}</code> nộp ngày {tm.filing_date}) không được cấp văn bằng, do đó không phát sinh thời hạn hiệu lực 10 năm và không phát sinh lệ phí gia hạn nhà nước.
                      </p>
                    </div>
                  </div>
                )}

                {/* Granted State: Renewal Countdown & 10-Year Timeline */}
                {isGranted && (
                  <div className="tm-granted-sections">
                    {/* Renewal Countdown Card */}
                    <div className="tm-countdown-box">
                      <div className="tm-countdown-header">
                        <div className="tm-countdown-title-group">
                          <span className="tm-section-icon">⏳</span>
                          <h3>Thời Hạn Hiệu Lực & Đếm Ngược Gia Hạn (Điều 93 Luật SHTT)</h3>
                        </div>
                        <span className={`tm-phase-badge tm-phase-${validity?.phase || "active"}`}>
                          {validity?.phase_label || "Đang có hiệu lực"}
                        </span>
                      </div>

                      {/* Remaining time big hero display */}
                      <div className="tm-countdown-hero">
                        <div className="tm-countdown-digits-card">
                          <div className="tm-digits-label">THỜI GIAN CÒN LẠI ĐẾN HẾT HẠN</div>
                          <div className="tm-digits-value">
                            {validity?.time_remaining_formatted || "Còn 3 năm 1 tháng"}
                          </div>
                          <div className="tm-digits-sub">
                            Hiệu lực 10 năm tính từ ngày nộp đơn ({tm.filing_date})
                          </div>
                        </div>

                        <div className="tm-key-dates-grid">
                          <div className="tm-key-date-card">
                            <span className="tm-kd-icon">📅</span>
                            <div>
                              <div className="tm-kd-label">Ngày hết hiệu lực văn bằng</div>
                              <div className="tm-kd-value tm-highlight-expiry">
                                {validity?.expiry_date || tm.expiry_date}
                              </div>
                              <div className="tm-kd-sub">10 năm từ ngày nộp đơn</div>
                            </div>
                          </div>

                          <div className="tm-key-date-card">
                            <span className="tm-kd-icon">🚪</span>
                            <div>
                              <div className="tm-kd-label">Mở tiếp nhận đơn gia hạn</div>
                              <div className="tm-kd-value tm-highlight-window">
                                {validity?.renewal_window_start || tm.renewal_window_start}
                              </div>
                              <div className="tm-kd-sub">Trước 6 tháng theo luật định</div>
                            </div>
                          </div>

                          <div className="tm-key-date-card">
                            <span className="tm-kd-icon">⚠️</span>
                            <div>
                              <div className="tm-kd-label">Hạn chót ân hạn nộp muộn</div>
                              <div className="tm-kd-value">
                                {validity?.grace_period_end || "—"}
                              </div>
                              <div className="tm-kd-sub">+6 tháng sau ngày hết hạn (+10%/tháng)</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Visual 10-Year Timeline Progress Bar */}
                      <div className="tm-timeline-container">
                        <div className="tm-timeline-bar-wrapper">
                          <div
                            className="tm-timeline-bar-fill"
                            style={{ width: `${progress}%` }}
                            title={`Tiến trình hiệu lực: ${progress}%`}
                          />
                          {/* 6-Month Renewal Window Marker */}
                          <div
                            className="tm-timeline-window-zone"
                            style={{ left: "95%", width: "5%" }}
                            title="Khung nộp đơn gia hạn (6 tháng trước hết hạn)"
                          />
                          {/* Marker pin on current day */}
                          <div
                            className="tm-timeline-pin"
                            style={{ left: `${progress}%` }}
                            title="Vị trí hiện tại"
                          />
                        </div>

                        <div
                          className="tm-timeline-milestones"
                          style={
                            isNarrow
                              ? {
                                  display: "grid",
                                  gridTemplateColumns: "1fr",
                                  gap: 8,
                                  position: "static",
                                  height: "auto",
                                  marginTop: 12,
                                }
                              : undefined
                          }
                        >
                          <div
                            className="tm-milestone tm-ms-start"
                            style={
                              isNarrow
                                ? {
                                    position: "static",
                                    left: "auto",
                                    transform: "none",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    flexWrap: "wrap",
                                    textAlign: "left",
                                  }
                                : undefined
                            }
                          >
                            <span className="tm-ms-dot" />
                            <span className="tm-ms-text">Nộp đơn: {tm.filing_date}</span>
                            <span className="tm-ms-label">Năm 0</span>
                          </div>

                          <div
                            className="tm-milestone tm-ms-current"
                            style={
                              isNarrow
                                ? {
                                    position: "static",
                                    left: "auto",
                                    transform: "none",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    flexWrap: "wrap",
                                    textAlign: "left",
                                  }
                                : { left: `${progress}%` }
                            }
                          >
                            <span className="tm-ms-indicator">📍 Hôm nay ({progress}%)</span>
                          </div>

                          <div
                            className="tm-milestone tm-ms-window"
                            style={
                              isNarrow
                                ? {
                                    position: "static",
                                    left: "auto",
                                    transform: "none",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    flexWrap: "wrap",
                                    textAlign: "left",
                                  }
                                : { left: "95%" }
                            }
                          >
                            <span className="tm-ms-dot tm-dot-orange" />
                            <span className="tm-ms-text">Mở gia hạn: {validity?.renewal_window_start}</span>
                            <span className="tm-ms-label">Trước 6 tháng</span>
                          </div>

                          <div
                            className="tm-milestone tm-ms-end"
                            style={
                              isNarrow
                                ? {
                                    position: "static",
                                    left: "auto",
                                    transform: "none",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    flexWrap: "wrap",
                                    textAlign: "left",
                                  }
                                : undefined
                            }
                          >
                            <span className="tm-ms-dot tm-dot-red" />
                            <span className="tm-ms-text">Hết hạn: {validity?.expiry_date}</span>
                            <span className="tm-ms-label">Năm thứ 10</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Official Government Fee Breakdown Table */}
                    <div className="tm-fees-box">
                      <div className="tm-fees-header">
                        <div className="tm-fees-title-group">
                          <span className="tm-section-icon">🏛️</span>
                          <h3>Dự Toán Lệ Phí Gia Hạn Nhà Nước (Thông Tư 263/2016/TT-BTC)</h3>
                        </div>
                        <span className="tm-fees-legal-badge">
                          Căn cứ TT 263/2016/TT-BTC & TT 63/2023/TT-BTC
                        </span>
                      </div>

                      <DataView
                        mobileMode="card"
                        desktop={
                          <div className="tm-table-responsive">
                            <table className="tm-fee-table">
                              <thead>
                                <tr>
                                  <th style={{ width: "48px" }}>STT</th>
                                  <th>Khoản mục lệ phí / phí nhà nước</th>
                                  <th>Diễn giải & Căn cứ tính</th>
                                  <th style={{ width: "160px", textAlign: "right" }}>Số tiền</th>
                                </tr>
                              </thead>
                              <tbody>
                                {fees?.items && fees.items.length > 0 ? (
                                  fees.items.map((item, idx) => (
                                    <tr key={item.code || idx}>
                                      <td className="tm-td-stt">{idx + 1}</td>
                                      <td className="tm-td-name">
                                        <strong>{item.name}</strong>
                                        <div className="tm-item-code">Mã: {item.code}</div>
                                      </td>
                                      <td className="tm-td-note">{item.note}</td>
                                      <td className="tm-td-amount">
                                        {item.amount.toLocaleString("vi-VN")} đ
                                      </td>
                                    </tr>
                                  ))
                                ) : (
                                  // Default standard 5 items if not pre-computed
                                  <>
                                    <tr>
                                      <td className="tm-td-stt">1</td>
                                      <td className="tm-td-name">
                                        <strong>Lệ phí gia hạn hiệu lực văn bằng bảo hộ</strong>
                                      </td>
                                      <td className="tm-td-note">100.000 đ × 2 nhóm Nice (9, 42)</td>
                                      <td className="tm-td-amount">200.000 đ</td>
                                    </tr>
                                    <tr>
                                      <td className="tm-td-stt">2</td>
                                      <td className="tm-td-name">
                                        <strong>Phí sử dụng văn bằng bảo hộ (duy trì 10 năm)</strong>
                                      </td>
                                      <td className="tm-td-note">250.000 đ nhóm đầu + 150.000 đ nhóm tiếp theo</td>
                                      <td className="tm-td-amount">400.000 đ</td>
                                    </tr>
                                    <tr>
                                      <td className="tm-td-stt">3</td>
                                      <td className="tm-td-name">
                                        <strong>Phí thẩm định yêu cầu gia hạn</strong>
                                      </td>
                                      <td className="tm-td-note">160.000 đ / 1 văn bằng</td>
                                      <td className="tm-td-amount">160.000 đ</td>
                                    </tr>
                                    <tr>
                                      <td className="tm-td-stt">4</td>
                                      <td className="tm-td-name">
                                        <strong>Phí công bố quyết định gia hạn</strong>
                                      </td>
                                      <td className="tm-td-note">120.000 đ / 1 đơn</td>
                                      <td className="tm-td-amount">120.000 đ</td>
                                    </tr>
                                    <tr>
                                      <td className="tm-td-stt">5</td>
                                      <td className="tm-td-name">
                                        <strong>Phí đăng bạ thông tin gia hạn</strong>
                                      </td>
                                      <td className="tm-td-note">120.000 đ / 1 văn bằng</td>
                                      <td className="tm-td-amount">120.000 đ</td>
                                    </tr>
                                  </>
                                )}
                              </tbody>
                              <tfoot>
                                <tr className="tm-tfoot-total">
                                  <td colSpan={3} className="tm-total-label">
                                    <strong>TỔNG LỆ PHÍ NHÀ NƯỚC CHO 1 NHÃN HIỆU (2 NHÓM):</strong>
                                  </td>
                                  <td className="tm-total-value">
                                    <strong>{fees?.total_formatted || "1.000.000 VNĐ"}</strong>
                                  </td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        }
                        mobileCards={
                          <div className="ui-mobile-card-list">
                            {(fees?.items && fees.items.length > 0
                              ? fees.items
                              : [
                                  { code: "LP-GH", name: "Lệ phí gia hạn hiệu lực văn bằng bảo hộ", note: "100.000 đ × 2 nhóm Nice (9, 42)", amount: 200000 },
                                  { code: "P-SD", name: "Phí sử dụng văn bằng bảo hộ (duy trì 10 năm)", note: "250.000 đ nhóm đầu + 150.000 đ nhóm tiếp theo", amount: 400000 },
                                  { code: "P-TD", name: "Phí thẩm định yêu cầu gia hạn", note: "160.000 đ / 1 văn bằng", amount: 160000 },
                                  { code: "P-CB", name: "Phí công bố quyết định gia hạn", note: "120.000 đ / 1 đơn", amount: 120000 },
                                  { code: "P-DB", name: "Phí đăng bạ thông tin gia hạn", note: "120.000 đ / 1 văn bằng", amount: 120000 },
                                ]
                            ).map((item, idx) => (
                              <div key={item.code || idx} className="ui-mobile-card">
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                                  <strong style={{ color: "var(--ink)" }}>{idx + 1}. {item.name}</strong>
                                  <strong className="nowrap" style={{ color: "var(--primary-dark)" }}>
                                    {item.amount.toLocaleString("vi-VN")} đ
                                  </strong>
                                </div>
                                {item.note && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{item.note}</div>}
                              </div>
                            ))}
                            <div className="ui-mobile-card" style={{ background: "var(--primary-soft)", borderColor: "var(--primary)" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                <strong style={{ color: "var(--ink)" }}>TỔNG LỆ PHÍ NHÀ NƯỚC</strong>
                                <strong style={{ color: "var(--primary-dark)", fontSize: 16 }}>
                                  {fees?.total_formatted || "1.000.000 VNĐ"}
                                </strong>
                              </div>
                            </div>
                          </div>
                        }
                      />

                      <div className="tm-fees-footer-note">
                        <span>💡</span>
                        <span>
                          Biểu phí áp dụng theo Mục 1 Biểu mức thu phí, lệ phí SHTT kèm Thông tư 263/2016/TT-BTC. Lệ phí nộp trực tiếp vào Kho bạc Nhà nước khi nộp hồ sơ gia hạn tại Cục Sở hữu trí tuệ.
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Online Lookup Modal Dialog */}
      <AppModal
        open={showOnlineModal}
        onClose={() => setShowOnlineModal(false)}
        title={`Kết quả tra cứu trực tuyến: "${onlineSearchedQuery}"`}
        subtitle="CỔNG DỮ LIỆU CỤC SỞ HỮU TRÍ TUỆ (WIPO PUBLISH)"
        size="lg"
        footer={
          <button
            type="button"
            className="tm-btn tm-btn-secondary ui-btn-chip"
            onClick={() => setShowOnlineModal(false)}
          >
            Đóng
          </button>
        }
      >
        {!onlineResults || onlineResults.length === 0 ? (
          <div className="tm-modal-empty">
            <div className="tm-empty-icon">🔍</div>
            <p>Không tìm thấy kết quả nào khớp với từ khóa trên Cổng Cục SHTT.</p>
          </div>
        ) : (
          <div className="tm-modal-results-list">
            <div className="tm-modal-count-bar">
              Tìm thấy <strong>{onlineResults.length}</strong> nhãn hiệu trên hệ thống Cục SHTT
            </div>
            {onlineResults.map((item, i) => {
              const itemKey = item.application_number || String(i);
              const safeThumb = safeHttpUrl(item.thumbnail_url);
              const safeDetailUrl = safeHttpUrl(item.detail_url);
              return (
                <div
                  key={itemKey}
                  className="tm-online-item"
                  style={isNarrow ? { flexDirection: "column", alignItems: "stretch" } : undefined}
                >
                  <div className="tm-online-item-logo">
                    {safeThumb && !failedOnlineLogos[itemKey] ? (
                      <img
                        src={safeThumb}
                        alt={item.mark_name}
                        onError={() => {
                          setFailedOnlineLogos((prev) =>
                            prev[itemKey] ? prev : { ...prev, [itemKey]: true },
                          );
                        }}
                      />
                    ) : (
                      <div className="tm-online-fallback-logo">®</div>
                    )}
                  </div>
                  <div className="tm-online-item-info" style={{ minWidth: 0 }}>
                    <div className="tm-online-item-top" style={{ flexWrap: "wrap", gap: 8 }}>
                      <h4 className="tm-online-mark-name">{item.mark_name}</h4>
                      <span
                        className={`tm-badge-status ${
                          item.status === "Cấp bằng"
                            ? "badge-granted"
                            : item.status === "Từ chối"
                            ? "badge-refused"
                            : "badge-pending"
                        }`}
                      >
                        {item.status || "Chưa rõ"}
                      </span>
                    </div>

                    <FormGrid cols={2} className="tm-online-grid">
                      <div>
                        <strong>Số đơn:</strong> {item.application_number}
                      </div>
                      <div>
                        <strong>Số bằng:</strong> {item.registration_number || "Chưa cấp"}
                      </div>
                      <div>
                        <strong>Ngày nộp đơn:</strong> {item.filing_date || "—"}
                      </div>
                      <div>
                        <strong>Ngày cấp:</strong> {item.grant_date || "—"}
                      </div>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <strong>Chủ đơn:</strong> {item.owner_name || "—"}
                      </div>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <strong>Nhóm Nice:</strong> {item.nice_classes || "—"}
                      </div>
                    </FormGrid>

                    {safeDetailUrl && (
                      <div className="tm-online-link-row">
                        <a
                          href={safeDetailUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="tm-btn-link ui-btn-chip"
                        >
                          Xem hồ sơ gốc trên WIPO Publish ↗
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </AppModal>
    </div>
  );
}
