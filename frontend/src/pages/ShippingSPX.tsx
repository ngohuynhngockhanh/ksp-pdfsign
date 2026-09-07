import React, { useEffect, useState, useRef } from "react";
import {
  SpxOrder,
  fetchSpxOrders,
  quickPrintSpxOrder,
  syncSpxOrders,
  batchPrintSpxOrders,
  markSpxOrderPrinted,
  cancelSpxOrder,
  getSpxOrderLabelUrl,
  printSpxOrderRemote,
} from "../api";

// ─── Web Audio API Sound Generator (Zero External Dependency) ───────────────
function playScannerBeep(type: "success" | "error" = "success", enabled: boolean = true) {
  if (!enabled) return;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === "success") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1760, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.18);
    } else {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(260, ctx.currentTime);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.26);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.26);
    }
  } catch (e) {
    console.warn("Audio playback not allowed:", e);
  }
}

export function ShippingSPX() {
  // Quick Print State
  const [quickCode, setQuickCode] = useState("");
  const [quickPrinting, setQuickPrinting] = useState(false);
  const [quickMsg, setQuickMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const quickInputRef = useRef<HTMLInputElement | null>(null);

  // Settings & Toggles State
  const [autoPrintOnScan, setAutoPrintOnScan] = useState<boolean>(() => {
    return localStorage.getItem("spx_auto_print_on_scan") !== "false";
  });
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    return localStorage.getItem("spx_sound_enabled") !== "false";
  });

  // Sync Modal State
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncRawText, setSyncRawText] = useState("");
  const [syncing, setSyncing] = useState(false);

  // Preview Modal State
  const [previewOrder, setPreviewOrder] = useState<SpxOrder | null>(null);

  // Filter State
  const [isPrintedFilter, setIsPrintedFilter] = useState<"all" | "unprinted" | "printed">("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Orders & Stats State
  const [orders, setOrders] = useState<SpxOrder[]>([]);
  const [totalOrders, setTotalOrders] = useState(0);
  const [unprintedCount, setUnprintedCount] = useState(0);
  const [printedCount, setPrintedCount] = useState(0);
  const [loadingOrders, setLoadingOrders] = useState(false);

  // Batch Print State
  const [batchPrinting, setBatchPrinting] = useState(false);
  const [selectedTrackingNos, setSelectedTrackingNos] = useState<string[]>([]);
  const [actionMsg, setActionMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Printing state per row
  const [printingRowNo, setPrintingRowNo] = useState<string | null>(null);

  // Save settings
  const toggleAutoPrint = () => {
    const next = !autoPrintOnScan;
    setAutoPrintOnScan(next);
    localStorage.setItem("spx_auto_print_on_scan", String(next));
  };

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    localStorage.setItem("spx_sound_enabled", String(next));
    if (next) playScannerBeep("success", true);
  };

  useEffect(() => {
    loadOrders();
  }, [isPrintedFilter, fromDate, toDate, statusFilter]);

  // Focus input on mount
  useEffect(() => {
    quickInputRef.current?.focus();
  }, []);

  const loadOrders = async () => {
    try {
      setLoadingOrders(true);
      const isPrintedParam =
        isPrintedFilter === "unprinted" ? false : isPrintedFilter === "printed" ? true : undefined;

      const res = await fetchSpxOrders({
        status: statusFilter !== "all" ? statusFilter : undefined,
        is_printed: isPrintedParam,
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
        search: searchTerm.trim() || undefined,
        limit: 100,
      });

      setOrders(res.items);
      setTotalOrders(res.total);
      setUnprintedCount(res.unprinted_count ?? res.items.filter((i) => !i.is_printed).length);
      setPrintedCount(res.printed_count ?? res.items.filter((i) => i.is_printed).length);
    } catch (err: any) {
      console.error("Lỗi tải danh sách vận đơn SPX:", err);
    } finally {
      setLoadingOrders(false);
    }
  };

  const executePrint = async (codeToPrint: string, printRemote: boolean = true) => {
    const code = codeToPrint.trim();
    if (!code) {
      setQuickMsg({ type: "error", text: "Vui lòng nhập hoặc quét Mã vận đơn SPX" });
      playScannerBeep("error", soundEnabled);
      return;
    }

    try {
      setQuickPrinting(true);
      setQuickMsg(null);

      const res = await quickPrintSpxOrder({
        tracking_no: code,
        printer_name: "TP732H",
        host: "192.168.1.10",
        print_remote: printRemote,
      });

      playScannerBeep("success", soundEnabled);
      setQuickMsg({
        type: "success",
        text: `✅ ${res.message || `Đã in thành công đơn ${res.tracking_no}!`}`,
      });
      setQuickCode("");
      loadOrders();
    } catch (err: any) {
      playScannerBeep("error", soundEnabled);
      setQuickMsg({
        type: "error",
        text: `❌ ${err.message || "Lỗi khi thực hiện in nhanh đơn SPX"}`,
      });
    } finally {
      setQuickPrinting(false);
      setTimeout(() => {
        quickInputRef.current?.focus();
      }, 50);
    }
  };

  const handleQuickPrint = async (e?: React.FormEvent, printRemote: boolean = true) => {
    if (e) e.preventDefault();
    await executePrint(quickCode, printRemote);
  };

  const handleQuickInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuickCode(val);
  };

  const handleQuickBrowserPrint = (code: string) => {
    const cleanCode = code.trim();
    if (!cleanCode) return;
    const url = getSpxOrderLabelUrl(cleanCode);
    window.open(url, "_blank");
  };

  const handleSyncSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!syncRawText.trim()) return;

    try {
      setSyncing(true);
      const res = await syncSpxOrders({ raw_text: syncRawText });
      playScannerBeep("success", soundEnabled);
      setActionMsg({ type: "success", text: `🎉 ${res.message}` });
      setShowSyncModal(false);
      setSyncRawText("");
      loadOrders();
    } catch (err: any) {
      playScannerBeep("error", soundEnabled);
      alert(err.message || "Không thể đồng bộ danh sách đơn");
    } finally {
      setSyncing(false);
    }
  };

  const handleBatchPrint = async () => {
    const targetCount = selectedTrackingNos.length > 0 ? selectedTrackingNos.length : unprintedCount;
    if (targetCount === 0) {
      alert("Không có đơn hàng nào chưa in để in hàng loạt!");
      return;
    }

    const confirmMsg =
      selectedTrackingNos.length > 0
        ? `Bạn có chắc chắn muốn in ${selectedTrackingNos.length} đơn đã chọn sang máy in TP732H (.10)?`
        : `Bạn có chắc chắn muốn in toàn bộ ${unprintedCount} đơn chưa in sang máy in TP732H (.10)?`;

    if (!window.confirm(confirmMsg)) return;

    try {
      setBatchPrinting(true);
      setActionMsg(null);
      const res = await batchPrintSpxOrders({
        tracking_numbers: selectedTrackingNos.length > 0 ? selectedTrackingNos : undefined,
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
        printer_name: "TP732H",
        host: "192.168.1.10",
      });

      playScannerBeep("success", soundEnabled);
      setActionMsg({
        type: "success",
        text: `🎉 ${res.message}`,
      });
      setSelectedTrackingNos([]);
      loadOrders();
    } catch (err: any) {
      playScannerBeep("error", soundEnabled);
      setActionMsg({
        type: "error",
        text: `❌ ${err.message || "Lỗi in hàng loạt"}`,
      });
    } finally {
      setBatchPrinting(false);
    }
  };

  const handlePrintSingleRemote = async (trackingNo: string) => {
    try {
      setPrintingRowNo(trackingNo);
      setActionMsg(null);
      const res = await printSpxOrderRemote(trackingNo, "192.168.1.10", "TP732H");
      playScannerBeep("success", soundEnabled);
      setActionMsg({ type: "success", text: `🖨️ ${res.message}` });
      loadOrders();
    } catch (err: any) {
      playScannerBeep("error", soundEnabled);
      setActionMsg({ type: "error", text: `❌ ${err.message || "Không thể in đơn này"}` });
    } finally {
      setPrintingRowNo(null);
    }
  };

  const handleTogglePrinted = async (trackingNo: string, currentStatus: boolean) => {
    try {
      await markSpxOrderPrinted(trackingNo, !currentStatus);
      loadOrders();
    } catch (err: any) {
      alert(err.message || "Không thể đổi trạng thái in");
    }
  };

  const handleCancelOrder = async (trackingNo: string) => {
    if (!window.confirm(`Bạn có chắc chắn muốn hủy vận đơn ${trackingNo}?`)) return;
    try {
      await cancelSpxOrder(trackingNo);
      loadOrders();
    } catch (err: any) {
      alert(err.message || "Không thể hủy đơn");
    }
  };

  const handleQuickDate = (type: "today" | "yesterday" | "7days" | "all") => {
    const now = new Date();
    if (type === "all") {
      setFromDate("");
      setToDate("");
    } else if (type === "today") {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      setFromDate(start.toISOString().slice(0, 16));
      setToDate(end.toISOString().slice(0, 16));
    } else if (type === "yesterday") {
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const start = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0);
      const end = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59);
      setFromDate(start.toISOString().slice(0, 16));
      setToDate(end.toISOString().slice(0, 16));
    } else if (type === "7days") {
      const past = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      setFromDate(past.toISOString().slice(0, 16));
      setToDate(now.toISOString().slice(0, 16));
    }
  };

  const toggleSelectAll = () => {
    if (selectedTrackingNos.length === orders.length) {
      setSelectedTrackingNos([]);
    } else {
      setSelectedTrackingNos(orders.map((o) => o.tracking_no));
    }
  };

  const toggleSelectRow = (trackingNo: string) => {
    if (selectedTrackingNos.includes(trackingNo)) {
      setSelectedTrackingNos(selectedTrackingNos.filter((t) => t !== trackingNo));
    } else {
      setSelectedTrackingNos([...selectedTrackingNos, trackingNo]);
    }
  };

  const formatVND = (num: number) => {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(num);
  };

  return (
    <div className="spx-page">
      {/* ─── HEADER: INUT Operations Dark Emerald & SPX Accent ─────────────── */}
      <div className="spx-header-card">
        <div className="spx-brand-block">
          <div className="spx-brand-icon">
            🚚
          </div>
          <div>
            <div className="spx-title-row">
              <h1>Đồng Bộ & In Vận Đơn SPX</h1>
              <span className="spx-pill-orange">
                SPX Express
              </span>
              <span className="spx-pill-emerald">
                ● Máy TP732H (192.168.1.10)
              </span>
            </div>
            <p className="spx-header-desc">
              Quét mã in ngay siêu tốc, đồng bộ danh sách đơn từ SPX portal và theo dõi tiến độ đóng gói
            </p>
          </div>
        </div>

        <div className="spx-header-actions">
          {/* Sound Toggle */}
          <button
            type="button"
            onClick={toggleSound}
            className={`spx-btn-sound ${soundEnabled ? "active" : ""}`}
            title="Bật/Tắt âm thanh Bíp khi quét mã"
          >
            <span>{soundEnabled ? "🔊" : "🔇"}</span>
            <span>{soundEnabled ? "Bíp: Bật" : "Bíp: Tắt"}</span>
          </button>

          {/* Sync Button */}
          <button
            onClick={() => setShowSyncModal(true)}
            className="spx-btn-sync"
          >
            📥 Nhập / Đồng Bộ Đơn
          </button>
        </div>
      </div>

      {/* ─── ⚡ KHU VỰC IN SIÊU TỐC (Quick Print Bar) ───────────────────────── */}
      <div className="spx-quickbar-card">
        <div className="spx-quickbar-head">
          <div className="spx-quickbar-title">
            <span style={{ fontSize: "22px" }}>⚡</span>
            <h2>In Siêu Tốc Theo Mã Vận Đơn</h2>
            <span className="spx-badge-ratio">
              Tỉ Lệ Vàng 65% Lệch Phải
            </span>
          </div>

          {/* Auto Print Switch */}
          <label className={`spx-auto-toggle ${autoPrintOnScan ? "checked" : ""}`}>
            <input
              type="checkbox"
              aria-label="⚡ Tự động in ngay khi quét"
              checked={autoPrintOnScan}
              onChange={toggleAutoPrint}
            />
            <span>⚡ Tự động in ngay khi quét</span>
          </label>
        </div>

        <form onSubmit={(e) => handleQuickPrint(e, true)} className="spx-quick-form">
          <div className="spx-input-wrap">
            <div className="spx-input-icon">🔍</div>
            <input
              ref={quickInputRef}
              type="text"
              value={quickCode}
              onChange={handleQuickInputChange}
              placeholder="Nhập hoặc dùng máy quét Barcode quét mã SPXVN... hoặc VN..."
              className="spx-quick-input"
              autoFocus
            />
            {quickCode && (
              <button
                type="button"
                onClick={() => {
                  setQuickCode("");
                  quickInputRef.current?.focus();
                }}
                className="spx-clear-btn"
              >
                ✕
              </button>
            )}
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="submit"
              disabled={quickPrinting || !quickCode.trim()}
              className="spx-btn-print-action"
            >
              {quickPrinting ? (
                <>
                  <span className="animate-spin">⏳</span> Đang In...
                </>
              ) : (
                <>
                  <span>🖨️</span> In Máy TP732H (.158)
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleQuickBrowserPrint(quickCode)}
              disabled={!quickCode.trim()}
              className="spx-btn-pdf-action"
              title="Xem và in qua trình duyệt"
            >
              <span>📄</span> Xem PDF
            </button>
          </div>
        </form>

        {quickMsg && (
          <div className={quickMsg.type === "success" ? "spx-alert-success" : "spx-alert-error"}>
            <span>{quickMsg.text}</span>
            <button
              onClick={() => setQuickMsg(null)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontWeight: "700" }}
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* ─── 📊 BẢNG THỐNG KÊ NHANH ───────────────────────────────────────── */}
      <div className="spx-stats-grid">
        <div
          onClick={() => setIsPrintedFilter("all")}
          className={`spx-stat-card ${isPrintedFilter === "all" ? "active-all" : ""}`}
        >
          <div className="spx-stat-top">
            <span>Tổng Vận Đơn</span>
            <span style={{ fontSize: "16px" }}>📦</span>
          </div>
          <div className="spx-stat-number">{totalOrders}</div>
          <div className="spx-stat-sub">đơn trong bộ lọc</div>
        </div>

        <div
          onClick={() => setIsPrintedFilter("unprinted")}
          className={`spx-stat-card ${isPrintedFilter === "unprinted" ? "active-unprinted" : ""}`}
        >
          <div className="spx-stat-top">
            <span style={{ color: "#be123c" }}>🔴 Chưa In Tem</span>
            <span style={{ fontSize: "16px" }}>🖨️</span>
          </div>
          <div className="spx-stat-number spx-stat-unprinted-num">{unprintedCount}</div>
          <div className="spx-stat-sub" style={{ color: "#be123c" }}>cần in tem nhãn</div>
        </div>

        <div
          onClick={() => setIsPrintedFilter("printed")}
          className={`spx-stat-card ${isPrintedFilter === "printed" ? "active-printed" : ""}`}
        >
          <div className="spx-stat-top">
            <span style={{ color: "#047857" }}>🟢 Đã In Tem</span>
            <span style={{ fontSize: "16px" }}>✅</span>
          </div>
          <div className="spx-stat-number spx-stat-printed-num">{printedCount}</div>
          <div className="spx-stat-sub" style={{ color: "#047857" }}>đã xuất tem nhiệt</div>
        </div>
      </div>

      {/* ─── 🔄 THANH BỘ LỌC THỜI GIAN & TÌM KIẾM ─────────────────────────── */}
      <div className="spx-filter-card">
        <div className="spx-filter-top">
          <div className="spx-date-shortcuts">
            <span style={{ fontSize: "11px", fontWeight: "800", textTransform: "uppercase", color: "#64748b", marginRight: "4px" }}>
              Thời gian:
            </span>
            <button onClick={() => handleQuickDate("today")} className="spx-btn-date">
              Hôm nay
            </button>
            <button onClick={() => handleQuickDate("yesterday")} className="spx-btn-date">
              Hôm qua
            </button>
            <button onClick={() => handleQuickDate("7days")} className="spx-btn-date">
              7 ngày qua
            </button>
            <button onClick={() => handleQuickDate("all")} className="spx-btn-date">
              Tất cả
            </button>
          </div>

          {/* Batch Print Action */}
          <button
            onClick={handleBatchPrint}
            disabled={batchPrinting || (selectedTrackingNos.length === 0 && unprintedCount === 0)}
            className="spx-btn-batch-print"
          >
            {batchPrinting ? (
              <>
                <span className="animate-spin">⏳</span> Đang In Hàng Loạt...
              </>
            ) : (
              <>
                <span>⚡</span> In Hàng Loạt (
                {selectedTrackingNos.length > 0 ? `${selectedTrackingNos.length} đã chọn` : `${unprintedCount} chưa in`}
                )
              </>
            )}
          </button>
        </div>

        <div className="spx-filter-grid">
          <div className="spx-filter-item">
            <label>Từ ngày / giờ</label>
            <input
              type="datetime-local"
              aria-label="Từ ngày giờ"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>

          <div className="spx-filter-item">
            <label>Đến ngày / giờ</label>
            <input
              type="datetime-local"
              aria-label="Đến ngày giờ"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>

          <div className="spx-filter-item">
            <label>Trạng thái in</label>
            <select
              aria-label="Lọc theo trạng thái in"
              value={isPrintedFilter}
              onChange={(e: any) => setIsPrintedFilter(e.target.value)}
            >
              <option value="all">Tất cả ({totalOrders})</option>
              <option value="unprinted">🔴 Chưa in ({unprintedCount})</option>
              <option value="printed">🟢 Đã in ({printedCount})</option>
            </select>
          </div>

          <div className="spx-filter-item">
            <label>Tìm kiếm đơn</label>
            <div style={{ position: "relative" }}>
              <input
                type="text"
                aria-label="Tìm kiếm mã vận đơn hoặc khách hàng"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadOrders()}
                placeholder="Mã vận đơn, tên, SĐT..."
                style={{ width: "100%" }}
              />
              {searchTerm && (
                <button
                  onClick={() => {
                    setSearchTerm("");
                    loadOrders();
                  }}
                  style={{
                    position: "absolute",
                    right: "8px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    color: "#64748b",
                    cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {actionMsg && (
        <div className={actionMsg.type === "success" ? "spx-alert-success" : "spx-alert-error"}>
          <span>{actionMsg.text}</span>
          <button
            onClick={() => setActionMsg(null)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontWeight: "700" }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ─── 📋 BẢNG DANH SÁCH VẬN ĐƠN SPX COMPACT ────────────────────────── */}
      <div className="spx-table-card">
        <div className="spx-table-head-bar">
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <input
              type="checkbox"
              checked={orders.length > 0 && selectedTrackingNos.length === orders.length}
              onChange={toggleSelectAll}
              aria-label="Chọn tất cả vận đơn"
              style={{ cursor: "pointer", width: "16px", height: "16px" }}
            />
            <span style={{ fontSize: "13px", fontWeight: "700", color: "#1e293b" }}>
              Danh sách Vận Đơn ({orders.length} hiển thị / {totalOrders} tổng)
            </span>
          </div>

          <button
            onClick={loadOrders}
            style={{
              background: "none",
              border: "none",
              color: "#64748b",
              fontWeight: "600",
              fontSize: "12px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <span>🔄</span> Tải lại
          </button>
        </div>

        {loadingOrders ? (
          <div style={{ padding: "48px", textAlign: "center", color: "#64748b" }}>
            <span className="animate-spin" style={{ fontSize: "24px", display: "inline-block", marginBottom: "8px" }}>
              ⏳
            </span>
            <p style={{ margin: 0, fontSize: "14px", fontWeight: "600" }}>Đang tải danh sách vận đơn...</p>
          </div>
        ) : orders.length === 0 ? (
          <div style={{ padding: "48px", textAlign: "center", color: "#64748b" }}>
            <span style={{ fontSize: "36px", display: "block", marginBottom: "8px" }}>📦</span>
            <p style={{ margin: 0, fontSize: "14px", fontWeight: "700", color: "#334155" }}>
              Không tìm thấy vận đơn nào phù hợp
            </p>
            <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#64748b" }}>
              Hãy bấm <strong>"📥 Nhập / Đồng Bộ Đơn"</strong> để dán danh sách mã vận đơn từ SPX portal
            </p>
          </div>
        ) : (
          <div className="spx-table-wrap">
            <table className="spx-data-table">
              <thead>
                <tr>
                  <th style={{ width: "36px" }}>
                    <input
                      type="checkbox"
                      checked={orders.length > 0 && selectedTrackingNos.length === orders.length}
                      onChange={toggleSelectAll}
                      aria-label="Chọn tất cả bảng vận đơn"
                      style={{ cursor: "pointer" }}
                    />
                  </th>
                  <th>Mã Vận Đơn</th>
                  <th>Người Nhận & SĐT</th>
                  <th>Địa Chỉ Giao Hàng</th>
                  <th>Tiền Thu Hộ (COD)</th>
                  <th>Thời Gian Tạo</th>
                  <th style={{ textAlign: "center" }}>Trạng Thái In</th>
                  <th style={{ textAlign: "right" }}>Thao Tác</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const isSelected = selectedTrackingNos.includes(o.tracking_no);
                  const isPrinting = printingRowNo === o.tracking_no;
                  return (
                    <tr
                      key={o.id}
                      style={{
                        background: isSelected ? "#f0fdfa" : !o.is_printed ? "#fff1f215" : undefined,
                      }}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectRow(o.tracking_no)}
                          aria-label={`Chọn đơn ${o.tracking_no}`}
                          style={{ cursor: "pointer" }}
                        />
                      </td>

                      <td>
                        <div
                          onClick={() => setPreviewOrder(o)}
                          role="button"
                          tabIndex={0}
                          className="spx-tracking-link"
                          title="Bấm để xem chi tiết & preview tem nhãn"
                        >
                          <span>{o.tracking_no}</span>
                          <span style={{ fontSize: "11px", color: "#64748b" }}>👁️</span>
                        </div>
                        {o.order_code && o.order_code !== o.tracking_no && (
                          <div style={{ fontSize: "11px", color: "#64748b", fontFamily: "var(--font-mono)" }}>
                            Đơn: {o.order_code}
                          </div>
                        )}
                      </td>

                      <td>
                        <div style={{ fontWeight: "700", color: "#1e293b" }}>{o.recipient_name || "Khách hàng"}</div>
                        <div style={{ color: "#64748b", fontFamily: "var(--font-mono)", fontSize: "11px" }}>
                          {o.recipient_phone || "—"}
                        </div>
                      </td>

                      <td style={{ maxWidth: "260px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={o.recipient_address}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{o.recipient_address || "Theo đơn hàng SPX"}</div>
                        <div style={{ fontSize: "11px", color: "#64748b", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {[o.ward, o.district, o.province].filter(Boolean).join(", ")}
                        </div>
                      </td>

                      <td>
                        {o.cod_amount > 0 ? (
                          <span className="spx-cod-val">{formatVND(o.cod_amount)}</span>
                        ) : (
                          <span style={{ color: "#64748b" }}>0 ₫</span>
                        )}
                      </td>

                      <td style={{ color: "#64748b", whiteSpace: "nowrap", fontFamily: "var(--font-mono)", fontSize: "11px" }}>
                        {o.created_at ? o.created_at.slice(0, 16).replace("T", " ") : "—"}
                      </td>

                      <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                        {o.is_printed ? (
                          <span
                            onClick={() => handleTogglePrinted(o.tracking_no, true)}
                            className="spx-badge-printed"
                            title="Bấm để chuyển về Chưa in"
                          >
                            <span>🟢</span> Đã In
                            {o.printed_at && (
                              <span style={{ fontSize: "10px", opacity: 0.8, marginLeft: "2px" }}>
                                ({o.printed_at.slice(11, 16)} {o.printed_at.slice(8, 10)}/{o.printed_at.slice(5, 7)})
                              </span>
                            )}
                          </span>
                        ) : (
                          <span
                            onClick={() => handleTogglePrinted(o.tracking_no, false)}
                            className="spx-badge-unprinted"
                            title="Bấm để đánh dấu Đã in"
                          >
                            <span>🔴</span> Chưa In
                          </span>
                        )}
                      </td>

                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "6px" }}>
                          <button
                            onClick={() => handlePrintSingleRemote(o.tracking_no)}
                            disabled={isPrinting}
                            className="spx-btn-row-print"
                            title="In ngay ra máy in TP732H tại 192.168.1.10"
                          >
                            {isPrinting ? "⏳" : "🖨️"} In .10
                          </button>

                          <button
                            onClick={() => handleQuickBrowserPrint(o.tracking_no)}
                            className="spx-btn-row-pdf"
                            title="Xem và in qua trình duyệt"
                          >
                            📄 PDF
                          </button>

                          <button
                            onClick={() => handleCancelOrder(o.tracking_no)}
                            style={{
                              background: "none",
                              border: "none",
                              color: "#64748b",
                              cursor: "pointer",
                              padding: "4px 6px",
                              borderRadius: "6px",
                            }}
                            title="Hủy đơn"
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── 📥 MODAL NHẬP / ĐỒNG BỘ MÃ ĐƠN HÀNG HÀNG LOẠT ─────────────────── */}
      {showSyncModal && (
        <div className="spx-modal-backdrop">
          <form onSubmit={handleSyncSubmit} className="spx-modal-card">
            <div className="spx-modal-head">
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "20px" }}>📥</span>
                <h3>Đồng Bộ & Nhập Mã Đơn SPX</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSyncModal(false)}
                style={{ background: "none", border: "none", fontSize: "16px", cursor: "pointer", color: "#64748b" }}
              >
                ✕
              </button>
            </div>

            <div className="spx-modal-body">
              <label style={{ fontSize: "12px", fontWeight: "700", color: "#334155" }}>
                Dán danh sách Mã vận đơn / Mã đơn SPX:
              </label>
              <textarea
                rows={4}
                value={syncRawText}
                onChange={(e) => setSyncRawText(e.target.value)}
                placeholder={`Dán danh sách mã vận đơn (mỗi dòng 1 mã hoặc cách nhau bằng dấu phẩy):\nSPXVN069813371898\nVN2615337004838260\nSPXVN0123456789`}
                className="spx-modal-textarea"
                required
              />
              <p style={{ margin: 0, fontSize: "11px", color: "#64748b" }}>
                Hệ thống tự động phát hiện mã <code>SPXVN...</code> hoặc <code>VN...</code> và đưa vào danh sách chờ in tem.
              </p>
            </div>

            <div className="spx-modal-foot">
              <button
                type="button"
                onClick={() => setShowSyncModal(false)}
                className="spx-btn-date"
                style={{ height: "36px", padding: "0 16px" }}
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={syncing || !syncRawText.trim()}
                className="spx-btn-sync"
                style={{ height: "36px" }}
              >
                {syncing ? "⏳ Đang Đồng Bộ..." : "📥 Đồng Bộ Ngay"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ─── 👁️ MODAL XEM TRƯỚC TEM NHÃN IN (LABEL PREVIEW MODAL) ─────────── */}
      {previewOrder && (
        <div className="spx-modal-backdrop">
          <div className="spx-modal-card" style={{ maxWidth: "680px" }}>
            <div className="spx-modal-head">
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "20px" }}>🏷️</span>
                <div>
                  <h3 style={{ margin: 0 }}>Chi Tiết Vận Đơn & Nhãn In SPX</h3>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "#0f766e", fontWeight: "700" }}>
                    {previewOrder.tracking_no}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewOrder(null)}
                style={{ background: "none", border: "none", fontSize: "16px", cursor: "pointer", color: "#64748b" }}
              >
                ✕
              </button>
            </div>

            <div className="spx-modal-body">
              {/* Order Info Grid */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "10px",
                  background: "#f8fafc",
                  padding: "14px",
                  borderRadius: "12px",
                  border: "1px solid #e2e8f0",
                  fontSize: "12px",
                }}
              >
                <div>
                  <span style={{ color: "#64748b" }}>Người nhận:</span>
                  <div style={{ fontWeight: "700", color: "#0f172a" }}>{previewOrder.recipient_name}</div>
                  <div style={{ fontFamily: "var(--font-mono)", color: "#475569" }}>{previewOrder.recipient_phone}</div>
                </div>

                <div>
                  <span style={{ color: "#64748b" }}>Tiền thu hộ (COD):</span>
                  <div style={{ fontWeight: "800", color: "#c2410c", fontFamily: "var(--font-mono)", fontSize: "14px" }}>
                    {formatVND(previewOrder.cod_amount)}
                  </div>
                </div>

                <div style={{ gridColumn: "1 / -1" }}>
                  <span style={{ color: "#64748b" }}>Địa chỉ giao:</span>
                  <div style={{ color: "#334155", fontWeight: "500" }}>{previewOrder.recipient_address}</div>
                </div>
              </div>

              {/* Embedded Label Preview */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <span style={{ fontSize: "12px", fontWeight: "700", color: "#334155" }}>Xem trước nhãn tem in A6/nhiệt:</span>
                  <span style={{ fontSize: "11px", color: "#0f766e", fontFamily: "var(--font-mono)", fontWeight: "600" }}>
                    Tỉ Lệ Vàng 65% Lệch Phải
                  </span>
                </div>
                <div style={{ border: "1px solid #cbd5e1", borderRadius: "12px", overflow: "hidden", height: "290px", background: "#f1f5f9" }}>
                  <iframe
                    src={getSpxOrderLabelUrl(previewOrder.tracking_no)}
                    style={{ width: "100%", height: "100%", border: "none" }}
                    title={`Label ${previewOrder.tracking_no}`}
                  />
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="spx-modal-foot" style={{ justifyContent: "space-between" }}>
              <button
                type="button"
                onClick={() => handleTogglePrinted(previewOrder.tracking_no, previewOrder.is_printed)}
                className={previewOrder.is_printed ? "spx-badge-printed" : "spx-badge-unprinted"}
                style={{ cursor: "pointer" }}
              >
                {previewOrder.is_printed ? "🟢 Đã in (Bấm để đổi)" : "🔴 Chưa in (Bấm để đánh dấu đã in)"}
              </button>

              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => handleQuickBrowserPrint(previewOrder.tracking_no)}
                  className="spx-btn-date"
                  style={{ height: "36px", padding: "0 14px" }}
                >
                  📄 Mở PDF
                </button>

                <button
                  type="button"
                  onClick={() => {
                    handlePrintSingleRemote(previewOrder.tracking_no);
                    setPreviewOrder(null);
                  }}
                  className="spx-btn-print-action"
                  style={{ height: "36px", fontSize: "12px", padding: "0 16px" }}
                >
                  🖨️ In Máy TP732H (.158)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
