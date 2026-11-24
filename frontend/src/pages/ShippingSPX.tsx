import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  type SpxOrder,
  fetchSpxOrders,
  quickPrintSpxOrder,
  printCustomShippingLabel,
  syncSpxOrders,
  batchPrintSpxOrders,
  markSpxOrderPrinted,
  cancelSpxOrder,
  getSpxOrderLabelUrl,
  printSpxOrderRemote,
} from "../api";
import {
  AppButton,
  AppIcon,
  AppModal,
  DataView,
  EmptyState,
  FilterBar,
  FormField,
  FormGrid,
  InlineAlert,
  KpiStrip,
  MobileCard,
  MobileCardActions,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  PageHeader,
  PageShell,
  SectionCard,
  StatusBadge,
  TableSkeleton,
  useConfirm,
  useToast,
} from "../components/ui";
import { openExternalSafe } from "../utils/url";

// ─── Web Audio API Sound Generator (Zero External Dependency) ───────────────
function playScannerBeep(type: "success" | "error" = "success", enabled: boolean = true) {
  if (!enabled) return;
  try {
    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
  const toast = useToast();
  const confirmDialog = useConfirm();

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

  // Custom Label Modal State (Don ngoai san / chanh xe)
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customForm, setCustomForm] = useState({
    code: "",
    recipient_name: "",
    recipient_phone: "",
    recipient_address: "",
    item_desc: "",
    note: "Cho xem hàng, không cho thử",
  });
  const [customPrinting, setCustomPrinting] = useState(false);

  // Preview Modal State
  const [previewOrder, setPreviewOrder] = useState<SpxOrder | null>(null);

  // Filter State
  const [isPrintedFilter, setIsPrintedFilter] = useState<"all" | "unprinted" | "printed">("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");

  // Orders & Stats State
  const [orders, setOrders] = useState<SpxOrder[]>([]);
  const [totalOrders, setTotalOrders] = useState(0);
  const [unprintedCount, setUnprintedCount] = useState(0);
  const [printedCount, setPrintedCount] = useState(0);
  const [loadingOrders, setLoadingOrders] = useState(true);

  // Batch Print State
  const [batchPrinting, setBatchPrinting] = useState(false);
  const [selectedTrackingNos, setSelectedTrackingNos] = useState<string[]>([]);

  // Printing state per row
  const [printingRowNo, setPrintingRowNo] = useState<string | null>(null);

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

  const loadOrders = useCallback(
    async (overrideSearch?: string) => {
      try {
        setLoadingOrders(true);
        const isPrintedParam =
          isPrintedFilter === "unprinted" ? false : isPrintedFilter === "printed" ? true : undefined;
        const activeSearch = overrideSearch !== undefined ? overrideSearch : searchTerm;

        const res = await fetchSpxOrders({
          is_printed: isPrintedParam,
          from_date: fromDate || undefined,
          to_date: toDate || undefined,
          search: activeSearch.trim() || undefined,
          limit: 100,
        });

        setOrders(res.items);
        setTotalOrders(res.total);
        setUnprintedCount(res.unprinted_count ?? res.items.filter((i) => !i.is_printed).length);
        setPrintedCount(res.printed_count ?? res.items.filter((i) => i.is_printed).length);
      } catch (err: unknown) {
        console.error("Lỗi tải danh sách vận đơn SPX:", err);
        toast.error(err instanceof Error ? err.message : "Lỗi tải danh sách vận đơn SPX");
      } finally {
        setLoadingOrders(false);
      }
    },
    [isPrintedFilter, fromDate, toDate, searchTerm, toast],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadOrders();
    }, searchTerm ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [loadOrders, searchTerm]);

  useEffect(() => {
    quickInputRef.current?.focus();
  }, []);

  const handlePrintCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customForm.code.trim() || !customForm.recipient_name.trim() || !customForm.recipient_phone.trim()) {
      toast.warning("Vui lòng điền đầy đủ Mã kiện/Nội dung, Tên người nhận và Số điện thoại.");
      return;
    }
    setCustomPrinting(true);
    try {
      const res = await printCustomShippingLabel({
        code: customForm.code.trim(),
        recipient_name: customForm.recipient_name.trim(),
        recipient_phone: customForm.recipient_phone.trim(),
        recipient_address: customForm.recipient_address.trim(),
        item_desc: customForm.item_desc.trim() || customForm.code.trim(),
        note: customForm.note.trim(),
        printer_name: "TP732H",
        host: "192.168.1.10",
        print_remote: true,
      });
      playScannerBeep("success", soundEnabled);
      toast.success(res.message || "Đã gửi in tem ngoài sàn thành công.");
      setShowCustomModal(false);
      setCustomForm({
        code: "",
        recipient_name: "",
        recipient_phone: "",
        recipient_address: "",
        item_desc: "",
        note: "Cho xem hàng, không cho thử",
      });
      loadOrders();
    } catch (err: unknown) {
      playScannerBeep("error", soundEnabled);
      toast.error(err instanceof Error ? err.message : "Lỗi khi in tem ngoài sàn");
    } finally {
      setCustomPrinting(false);
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
        text: res.message || `Đã in thành công đơn ${res.tracking_no}!`,
      });
      setQuickCode("");
      loadOrders();
    } catch (err: unknown) {
      playScannerBeep("error", soundEnabled);
      setQuickMsg({
        type: "error",
        text: err instanceof Error ? err.message : "Lỗi khi thực hiện in nhanh đơn SPX",
      });
    } finally {
      setQuickPrinting(false);
      window.setTimeout(() => {
        quickInputRef.current?.focus();
      }, 50);
    }
  };

  const handleQuickPrint = async (e?: React.FormEvent, printRemote: boolean = true) => {
    if (e) e.preventDefault();
    await executePrint(quickCode, printRemote);
  };

  const handleQuickBrowserPrint = (code: string) => {
    const cleanCode = code.trim();
    if (!cleanCode) return;
    const url = getSpxOrderLabelUrl(cleanCode);
    openExternalSafe(url);
  };

  const handleSyncSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!syncRawText.trim()) return;

    try {
      setSyncing(true);
      const res = await syncSpxOrders({ raw_text: syncRawText });
      playScannerBeep("success", soundEnabled);
      toast.success(res.message);
      setShowSyncModal(false);
      setSyncRawText("");
      loadOrders();
    } catch (err: unknown) {
      playScannerBeep("error", soundEnabled);
      toast.error(err instanceof Error ? err.message : "Không thể đồng bộ danh sách đơn");
    } finally {
      setSyncing(false);
    }
  };

  const handleBatchPrint = async () => {
    const targetCount = selectedTrackingNos.length > 0 ? selectedTrackingNos.length : unprintedCount;
    if (targetCount === 0) {
      toast.info("Không có đơn hàng nào chưa in để in hàng loạt.");
      return;
    }

    const confirmMsg =
      selectedTrackingNos.length > 0
        ? `Bạn có chắc chắn muốn in ${selectedTrackingNos.length} đơn đã chọn sang máy in TP732H (.10)?`
        : `Bạn có chắc chắn muốn in toàn bộ ${unprintedCount} đơn chưa in sang máy in TP732H (.10)?`;

    const accepted = await confirmDialog({
      title: "Xác nhận in hàng loạt",
      message: confirmMsg,
      confirmLabel: "In ngay",
      cancelLabel: "Hủy",
      tone: "primary",
    });
    if (!accepted) return;

    try {
      setBatchPrinting(true);
      const res = await batchPrintSpxOrders({
        tracking_numbers: selectedTrackingNos.length > 0 ? selectedTrackingNos : undefined,
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
        printer_name: "TP732H",
        host: "192.168.1.10",
      });

      playScannerBeep("success", soundEnabled);
      toast.success(res.message);
      setSelectedTrackingNos([]);
      loadOrders();
    } catch (err: unknown) {
      playScannerBeep("error", soundEnabled);
      toast.error(err instanceof Error ? err.message : "Lỗi in hàng loạt");
    } finally {
      setBatchPrinting(false);
    }
  };

  const handlePrintSingleRemote = async (trackingNo: string) => {
    try {
      setPrintingRowNo(trackingNo);
      const res = await printSpxOrderRemote(trackingNo, "192.168.1.10", "TP732H");
      playScannerBeep("success", soundEnabled);
      toast.success(res.message);
      loadOrders();
    } catch (err: unknown) {
      playScannerBeep("error", soundEnabled);
      toast.error(err instanceof Error ? err.message : "Không thể in đơn này");
    } finally {
      setPrintingRowNo(null);
    }
  };

  const handleTogglePrinted = async (trackingNo: string, currentStatus: boolean) => {
    try {
      await markSpxOrderPrinted(trackingNo, !currentStatus);
      setPreviewOrder((prev) =>
        prev && prev.tracking_no === trackingNo ? { ...prev, is_printed: !currentStatus } : prev,
      );
      toast.success(
        !currentStatus
          ? `Đã đánh dấu đơn ${trackingNo} là Đã in.`
          : `Đã chuyển đơn ${trackingNo} về Chưa in.`,
      );
      loadOrders();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Không thể đổi trạng thái in");
    }
  };

  const handleCancelOrder = async (trackingNo: string) => {
    const accepted = await confirmDialog({
      title: "Xác nhận hủy vận đơn",
      message: `Bạn có chắc chắn muốn hủy vận đơn ${trackingNo}?`,
      confirmLabel: "Hủy đơn",
      cancelLabel: "Giữ lại",
      tone: "danger",
    });
    if (!accepted) return;

    try {
      await cancelSpxOrder(trackingNo);
      toast.success(`Đã hủy vận đơn ${trackingNo}.`);
      loadOrders();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Không thể hủy đơn");
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

  const activeFilterCount =
    (isPrintedFilter !== "all" ? 1 : 0) +
    (fromDate ? 1 : 0) +
    (toDate ? 1 : 0) +
    (searchTerm.trim() ? 1 : 0);

  const resetFilters = () => {
    setIsPrintedFilter("all");
    setFromDate("");
    setToDate("");
    setSearchTerm("");
  };

  return (
    <PageShell className="spx-page" data-page="shipping-spx">
      <PageHeader
        variant="compact"
        icon="truck"
        title="Đồng Bộ & In Vận Đơn SPX"
        badges={
          <>
            <StatusBadge tone="brand" size="sm">
              SPX Express
            </StatusBadge>
            <StatusBadge tone="success" dot size="sm">
              Máy TP732H (192.168.1.10)
            </StatusBadge>
          </>
        }
        actions={
          <>
            <AppButton
              variant="ghost"
              size="sm"
              leftIcon={soundEnabled ? "bell" : "ban"}
              onClick={toggleSound}
              aria-pressed={soundEnabled}
              title="Bật/Tắt âm thanh Bíp khi quét mã"
            >
              {soundEnabled ? "Bíp: Bật" : "Bíp: Tắt"}
            </AppButton>

            <AppButton
              variant="secondary"
              size="sm"
              leftIcon="download"
              onClick={() => setShowSyncModal(true)}
            >
              Nhập / Đồng Bộ Đơn
            </AppButton>

            <AppButton
              variant="primary"
              size="sm"
              leftIcon="tag"
              onClick={() => setShowCustomModal(true)}
              title="Tạo và in tem giao hàng ngoài sàn / chành xe sang máy in TP732H"
            >
              In Tem Ngoài Sàn
            </AppButton>
          </>
        }
      />

      {/* Quick Print Barcode Scanner Section */}
      <SectionCard
        className="spx-card"
        tone="subtle"
        padding="compact"
        icon="scan-line"
        title="In Siêu Tốc Theo Mã Vận Đơn"
        actions={
          <>
            <StatusBadge tone="info" size="sm">
              Tỉ Lệ Vàng 65% Lệch Phải
            </StatusBadge>
            <label className="ui-check-label">
              <input
                type="checkbox"
                aria-label="Tự động in ngay khi quét"
                checked={autoPrintOnScan}
                onChange={toggleAutoPrint}
              />
              <StatusBadge tone={autoPrintOnScan ? "brand" : "neutral"} size="sm">
                Tự động in ngay khi quét
              </StatusBadge>
            </label>
          </>
        }
      >
        <form onSubmit={(e) => handleQuickPrint(e, true)} className="ui-row">
          <div className="ui-search-wrap">
            <AppIcon name="barcode" size={18} className="ui-search-icon" />
            <input
              ref={quickInputRef}
              type="text"
              value={quickCode}
              onChange={(e) => setQuickCode(e.target.value)}
              placeholder="Nhập hoặc dùng máy quét Barcode quét mã SPXVN... hoặc VN..."
              className="ui-input ui-search-input spx-scanner-input"
              autoFocus
            />
            {quickCode && (
              <AppButton
                variant="ghost"
                size="sm"
                iconOnly
                leftIcon="x"
                aria-label="Xóa mã vận đơn"
                className="ui-search-clear"
                onClick={() => {
                  setQuickCode("");
                  quickInputRef.current?.focus();
                }}
              />
            )}
          </div>

          <div className="spx-scanner-actions">
            <AppButton
              type="submit"
              variant="primary"
              leftIcon="printer"
              loading={quickPrinting}
              disabled={!quickCode.trim()}
            >
              {quickPrinting ? "Đang In..." : "In Máy TP732H (.10)"}
            </AppButton>

            <AppButton
              variant="secondary"
              leftIcon="file-text"
              disabled={!quickCode.trim()}
              onClick={() => handleQuickBrowserPrint(quickCode)}
              title="Xem và in qua trình duyệt"
            >
              Xem PDF
            </AppButton>
          </div>
        </form>

        {quickMsg && (
          <InlineAlert
            tone={quickMsg.type === "success" ? "success" : "danger"}
            onDismiss={() => setQuickMsg(null)}
            className="ui-mt-3"
          >
            {quickMsg.text}
          </InlineAlert>
        )}
      </SectionCard>

      {/* Unified KPI Strip */}
      <KpiStrip
        columns={3}
        items={[
          {
            label: "Tổng Vận Đơn",
            value: totalOrders,
            sub: "đơn trong bộ lọc",
            icon: "package",
            tone: "brand",
            active: isPrintedFilter === "all",
            onClick: () => setIsPrintedFilter("all"),
          },
          {
            label: (
              <StatusBadge tone="danger" dot size="sm">
                Chưa In Tem
              </StatusBadge>
            ),
            value: unprintedCount,
            sub: "cần in tem nhãn",
            icon: "printer",
            tone: "danger",
            active: isPrintedFilter === "unprinted",
            onClick: () => setIsPrintedFilter("unprinted"),
          },
          {
            label: (
              <StatusBadge tone="success" dot size="sm">
                Đã In Tem
              </StatusBadge>
            ),
            value: printedCount,
            sub: "đã xuất tem nhiệt",
            icon: "check-circle",
            tone: "success",
            active: isPrintedFilter === "printed",
            onClick: () => setIsPrintedFilter("printed"),
          },
        ]}
      />

      {/* FilterBar & Batch Print */}
      <FilterBar
        collapsibleMobile
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: "Mã vận đơn, tên người nhận, SĐT...",
          ariaLabel: "Tìm kiếm mã vận đơn hoặc khách hàng",
        }}
        activeCount={activeFilterCount}
        onReset={resetFilters}
        filters={
          <>
            <div className="ui-inline ui-inline--wrap">
              <AppButton variant="ghost" size="sm" onClick={() => handleQuickDate("today")}>
                Hôm nay
              </AppButton>
              <AppButton variant="ghost" size="sm" onClick={() => handleQuickDate("yesterday")}>
                Hôm qua
              </AppButton>
              <AppButton variant="ghost" size="sm" onClick={() => handleQuickDate("7days")}>
                7 ngày qua
              </AppButton>
              <AppButton variant="ghost" size="sm" onClick={() => handleQuickDate("all")}>
                Tất cả
              </AppButton>
            </div>

            <input
              type="datetime-local"
              aria-label="Từ ngày giờ"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="ui-input spx-date-input"
            />

            <input
              type="datetime-local"
              aria-label="Đến ngày giờ"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="ui-input spx-date-input"
            />

            <select
              aria-label="Lọc theo trạng thái in"
              value={isPrintedFilter}
              onChange={(e) => setIsPrintedFilter(e.target.value as "all" | "unprinted" | "printed")}
              className="ui-select"
            >
              <option value="all">Tất cả ({totalOrders})</option>
              <option value="unprinted">Chưa in ({unprintedCount})</option>
              <option value="printed">Đã in ({printedCount})</option>
            </select>
          </>
        }
        actions={
          <AppButton
            variant="primary"
            size="sm"
            leftIcon="zap"
            loading={batchPrinting}
            disabled={selectedTrackingNos.length === 0 && unprintedCount === 0}
            onClick={handleBatchPrint}
          >
            {batchPrinting
              ? "Đang In Hàng Loạt..."
              : `In Hàng Loạt (${
                  selectedTrackingNos.length > 0
                    ? `${selectedTrackingNos.length} đã chọn`
                    : `${unprintedCount} chưa in`
                })`}
          </AppButton>
        }
      />

      {/* Orders Table & Mobile Cards */}
      <SectionCard
        className="spx-card"
        padding="flush"
        icon="clipboard-list"
        title={`Danh sách Vận Đơn (${orders.length} hiển thị / ${totalOrders} tổng)`}
        actions={
          <>
            <label className="ui-check-label ui-text-xs">
              <input
                type="checkbox"
                checked={orders.length > 0 && selectedTrackingNos.length === orders.length}
                onChange={toggleSelectAll}
                aria-label="Chọn tất cả vận đơn"
              />
              <span>Chọn tất cả</span>
            </label>
            <AppButton
              variant="ghost"
              size="sm"
              leftIcon="refresh"
              loading={loadingOrders}
              onClick={() => loadOrders()}
            >
              Tải lại
            </AppButton>
          </>
        }
      >
        {loadingOrders ? (
          <TableSkeleton rows={6} cols={7} />
        ) : orders.length === 0 ? (
          <EmptyState
            icon="package"
            title="Không tìm thấy vận đơn nào phù hợp"
            description='Hãy bấm "Nhập / Đồng Bộ Đơn" để dán danh sách mã vận đơn từ SPX Portal.'
            action={
              <AppButton
                variant="primary"
                leftIcon="download"
                onClick={() => setShowSyncModal(true)}
              >
                Đồng bộ đơn từ SPX
              </AppButton>
            }
          />
        ) : (
          <DataView
            mobileMode="card"
            desktop={
              <div className="ui-table-scroll-wrap" tabIndex={0}>
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th className="chk">
                        <input
                          type="checkbox"
                          checked={orders.length > 0 && selectedTrackingNos.length === orders.length}
                          onChange={toggleSelectAll}
                          aria-label="Chọn tất cả bảng vận đơn"
                        />
                      </th>
                      <th>Mã Vận Đơn</th>
                      <th>Người Nhận & SĐT</th>
                      <th>Địa Chỉ Giao Hàng</th>
                      <th className="col-num">Tiền Thu Hộ (COD)</th>
                      <th>Thời Gian Tạo</th>
                      <th>Trạng Thái In</th>
                      <th className="col-act">Thao Tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => {
                      const isSelected = selectedTrackingNos.includes(o.tracking_no);
                      const isPrinting = printingRowNo === o.tracking_no;
                      const rowCls = isSelected
                        ? "ui-row-selected"
                        : !o.is_printed
                          ? "ui-row-danger"
                          : "";

                      return (
                        <tr key={o.id} className={rowCls || undefined}>
                          <td className="chk">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectRow(o.tracking_no)}
                              aria-label={`Chọn đơn ${o.tracking_no}`}
                            />
                          </td>

                          <td>
                            <AppButton
                              variant="ghost"
                              size="sm"
                              rightIcon="eye"
                              className="spx-tracking-link"
                              onClick={() => setPreviewOrder(o)}
                              title="Bấm để xem chi tiết & xem trước tem nhãn"
                            >
                              {o.tracking_no}
                            </AppButton>
                            {o.order_code && o.order_code !== o.tracking_no && (
                              <div className="ui-mono ui-muted">Đơn: {o.order_code}</div>
                            )}
                          </td>

                          <td>
                            <div className="ui-text-semibold">{o.recipient_name || "Khách hàng"}</div>
                            <div className="ui-mono ui-muted">{o.recipient_phone || "—"}</div>
                          </td>

                          <td className="spx-addr-cell" title={o.recipient_address}>
                            <div className="spx-addr-cell">{o.recipient_address || "Theo đơn hàng SPX"}</div>
                            <div className="muted">
                              {[o.ward, o.district, o.province].filter(Boolean).join(", ")}
                            </div>
                          </td>

                          <td className="col-num">
                            {o.cod_amount > 0 ? (
                              <span className="ui-mono ui-text-danger">{formatVND(o.cod_amount)}</span>
                            ) : (
                              <span className="muted">0 ₫</span>
                            )}
                          </td>

                          <td className="ui-mono ui-muted">
                            {o.created_at ? o.created_at.slice(0, 16).replace("T", " ") : "—"}
                          </td>

                          <td>
                            <AppButton
                              variant="ghost"
                              size="sm"
                              className="spx-status-btn"
                              onClick={() => handleTogglePrinted(o.tracking_no, o.is_printed)}
                              title={
                                o.is_printed
                                  ? "Bấm để chuyển về Chưa in"
                                  : "Bấm để đánh dấu Đã in"
                              }
                            >
                              <StatusBadge tone={o.is_printed ? "success" : "danger"} dot size="sm">
                                {o.is_printed ? "Đã In" : "Chưa In"}
                                {o.is_printed && o.printed_at
                                  ? ` (${o.printed_at.slice(11, 16)} ${o.printed_at.slice(8, 10)}/${o.printed_at.slice(5, 7)})`
                                  : ""}
                              </StatusBadge>
                            </AppButton>
                          </td>

                          <td className="col-act">
                            <div className="ui-inline">
                              <AppButton
                                variant="primary"
                                size="sm"
                                leftIcon="printer"
                                loading={isPrinting}
                                onClick={() => handlePrintSingleRemote(o.tracking_no)}
                                title="In ngay ra máy in TP732H tại 192.168.1.10"
                              >
                                In .10
                              </AppButton>

                              <AppButton
                                variant="secondary"
                                size="sm"
                                leftIcon="file-text"
                                onClick={() => handleQuickBrowserPrint(o.tracking_no)}
                                title="Xem và in qua trình duyệt"
                              >
                                PDF
                              </AppButton>

                              <AppButton
                                variant="ghost"
                                size="sm"
                                iconOnly
                                leftIcon="trash"
                                onClick={() => handleCancelOrder(o.tracking_no)}
                                aria-label={`Hủy đơn ${o.tracking_no}`}
                                title="Hủy đơn"
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            }
            mobileCards={
              <div className="ui-mobile-card-list">
                {orders.map((o) => {
                  const isSelected = selectedTrackingNos.includes(o.tracking_no);
                  const isPrinting = printingRowNo === o.tracking_no;
                  return (
                    <MobileCard key={o.id} active={isSelected}>
                      <MobileCardHeader
                        title={
                          <label className="ui-check-label ui-text-xs">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectRow(o.tracking_no)}
                              aria-label={`Chọn đơn ${o.tracking_no}`}
                            />
                            <AppButton
                              variant="ghost"
                              size="sm"
                              rightIcon="eye"
                              className="spx-tracking-link"
                              onClick={() => setPreviewOrder(o)}
                            >
                              {o.tracking_no}
                            </AppButton>
                          </label>
                        }
                        badge={
                          <AppButton
                            variant="ghost"
                            size="sm"
                            className="spx-status-btn"
                            onClick={() => handleTogglePrinted(o.tracking_no, o.is_printed)}
                          >
                            <StatusBadge tone={o.is_printed ? "success" : "danger"} dot size="sm">
                              {o.is_printed ? "Đã In" : "Chưa In"}
                            </StatusBadge>
                          </AppButton>
                        }
                      />

                      <MobileCardGrid cols={2}>
                        <MobileCardRow label="Người nhận" value={o.recipient_name || "Khách hàng"} />
                        <MobileCardRow label="SĐT" value={o.recipient_phone || "—"} mono />
                        <MobileCardRow
                          label="Tiền thu hộ (COD)"
                          value={o.cod_amount > 0 ? formatVND(o.cod_amount) : "0 ₫"}
                          mono
                        />
                        <MobileCardRow
                          label="Thời gian tạo"
                          value={o.created_at ? o.created_at.slice(0, 16).replace("T", " ") : "—"}
                          mono
                        />
                        {o.recipient_address && (
                          <MobileCardRow
                            label="Địa chỉ giao"
                            value={o.recipient_address}
                            fullWidth
                          />
                        )}
                      </MobileCardGrid>

                      <MobileCardActions>
                        <AppButton
                          variant="primary"
                          size="sm"
                          leftIcon="printer"
                          loading={isPrinting}
                          onClick={() => handlePrintSingleRemote(o.tracking_no)}
                        >
                          In .10
                        </AppButton>
                        <AppButton
                          variant="secondary"
                          size="sm"
                          leftIcon="file-text"
                          onClick={() => handleQuickBrowserPrint(o.tracking_no)}
                        >
                          PDF
                        </AppButton>
                        <AppButton
                          variant="ghost"
                          size="sm"
                          leftIcon="eye"
                          onClick={() => setPreviewOrder(o)}
                        >
                          Chi tiết
                        </AppButton>
                        <AppButton
                          variant="ghost"
                          size="sm"
                          iconOnly
                          leftIcon="trash"
                          onClick={() => handleCancelOrder(o.tracking_no)}
                          aria-label={`Hủy đơn ${o.tracking_no}`}
                        />
                      </MobileCardActions>
                    </MobileCard>
                  );
                })}
              </div>
            }
          />
        )}
      </SectionCard>

      {/* Modal: Sync Bulk Tracking Numbers */}
      <AppModal
        open={showSyncModal}
        onClose={() => setShowSyncModal(false)}
        title="Đồng Bộ & Nhập Mã Đơn SPX"
        size="md"
        className="spx-modal-card"
        footer={
          <>
            <AppButton variant="secondary" onClick={() => setShowSyncModal(false)}>
              Hủy
            </AppButton>
            <AppButton
              type="submit"
              form="spx-sync-modal-form"
              variant="primary"
              leftIcon="download"
              loading={syncing}
              disabled={!syncRawText.trim()}
            >
              {syncing ? "Đang Đồng Bộ..." : "Đồng Bộ Ngay"}
            </AppButton>
          </>
        }
      >
        <form id="spx-sync-modal-form" onSubmit={handleSyncSubmit} className="ui-stack">
          <FormField
            label="Dán danh sách Mã vận đơn / Mã đơn SPX"
            htmlFor="spx-sync-textarea"
            required
            hint="Hệ thống tự động phát hiện mã SPXVN... hoặc VN... và đưa vào danh sách chờ in tem."
          >
            <textarea
              id="spx-sync-textarea"
              rows={5}
              value={syncRawText}
              onChange={(e) => setSyncRawText(e.target.value)}
              placeholder={`Dán danh sách mã vận đơn (mỗi dòng 1 mã hoặc cách nhau bằng dấu phẩy):\nSPXVN069813371898\nVN2615337004838260\nSPXVN0123456789`}
              className="ui-textarea ui-mono"
              required
            />
          </FormField>
        </form>
      </AppModal>

      {/* Modal: Label Preview (PDF iframe unsandboxed) */}
      <AppModal
        open={Boolean(previewOrder)}
        onClose={() => setPreviewOrder(null)}
        title="Chi Tiết Vận Đơn & Nhãn In SPX"
        subtitle={
          previewOrder ? <span className="ui-mono ui-muted">{previewOrder.tracking_no}</span> : undefined
        }
        size="lg"
        className="spx-modal-card"
        footer={
          previewOrder ? (
            <div className="spx-preview-footer">
              <AppButton
                variant="ghost"
                size="sm"
                className="spx-status-btn"
                onClick={() => handleTogglePrinted(previewOrder.tracking_no, previewOrder.is_printed)}
              >
                <StatusBadge tone={previewOrder.is_printed ? "success" : "danger"} dot>
                  {previewOrder.is_printed
                    ? "Đã in (Bấm để đổi)"
                    : "Chưa in (Bấm để đánh dấu đã in)"}
                </StatusBadge>
              </AppButton>

              <div className="spx-preview-footer-actions">
                <AppButton
                  variant="secondary"
                  leftIcon="file-text"
                  onClick={() => handleQuickBrowserPrint(previewOrder.tracking_no)}
                >
                  Mở PDF
                </AppButton>
                <AppButton
                  variant="primary"
                  leftIcon="printer"
                  onClick={() => {
                    handlePrintSingleRemote(previewOrder.tracking_no);
                    setPreviewOrder(null);
                  }}
                >
                  In Máy TP732H (.10)
                </AppButton>
              </div>
            </div>
          ) : undefined
        }
      >
        {previewOrder && (
          <div className="ui-stack">
            <div className="ui-subpanel ui-subpanel--md">
              <FormGrid cols={2}>
                <div>
                  <div className="muted">Người nhận</div>
                  <div className="ui-text-semibold">{previewOrder.recipient_name}</div>
                  <div className="ui-mono ui-muted">{previewOrder.recipient_phone}</div>
                </div>

                <div>
                  <div className="muted">Tiền thu hộ (COD)</div>
                  <div className="ui-mono ui-text-danger">{formatVND(previewOrder.cod_amount)}</div>
                </div>
              </FormGrid>

              <div className="ui-divider-top ui-mt-2">
                <div className="muted">Địa chỉ giao</div>
                <div className="ui-text-semibold">{previewOrder.recipient_address}</div>
              </div>
            </div>

            <div>
              <div className="ui-row-between ui-mb-2">
                <span className="ui-text-xs ui-text-strong">Xem trước nhãn tem in A6/nhiệt:</span>
                <StatusBadge tone="brand" size="sm">
                  Tỉ Lệ Vàng 65% Lệch Phải
                </StatusBadge>
              </div>
              <div className="ui-iframe-box ui-iframe-box--sm">
                <iframe
                  src={getSpxOrderLabelUrl(previewOrder.tracking_no)}
                  className="ui-iframe"
                  title={`Label ${previewOrder.tracking_no}`}
                />
              </div>
            </div>
          </div>
        )}
      </AppModal>

      {/* Modal: Custom Shipping Label */}
      <AppModal
        open={showCustomModal}
        onClose={() => setShowCustomModal(false)}
        title="In Tem Giao Hàng Ngoài Sàn"
        subtitle="In trực tiếp tem nhiệt 100x50mm (tỉ lệ vàng 65%) sang máy in TP732H"
        size="md"
        className="spx-modal-card"
        footer={
          <>
            <AppButton variant="secondary" onClick={() => setShowCustomModal(false)}>
              Đóng
            </AppButton>
            <AppButton
              type="submit"
              form="spx-custom-label-form"
              variant="primary"
              leftIcon="printer"
              loading={customPrinting}
            >
              {customPrinting ? "Đang gửi in..." : "In Máy TP732H (.10)"}
            </AppButton>
          </>
        }
      >
        <form id="spx-custom-label-form" onSubmit={handlePrintCustom} className="ui-stack">
          <FormGrid cols={2}>
            <FormField label="Mã kiện / Mã đơn" htmlFor="spx-custom-code" required>
              <input
                id="spx-custom-code"
                type="text"
                required
                value={customForm.code}
                onChange={(e) => setCustomForm({ ...customForm, code: e.target.value })}
                placeholder="VD: THI 058 601 1011"
                className="ui-input"
              />
            </FormField>

            <FormField label="Số điện thoại nhận" htmlFor="spx-custom-phone" required>
              <input
                id="spx-custom-phone"
                type="text"
                required
                value={customForm.recipient_phone}
                onChange={(e) => setCustomForm({ ...customForm, recipient_phone: e.target.value })}
                placeholder="VD: 0902644315"
                className="ui-input"
              />
            </FormField>

            <FormField label="Tên người nhận" htmlFor="spx-custom-name" required fullWidth>
              <input
                id="spx-custom-name"
                type="text"
                required
                value={customForm.recipient_name}
                onChange={(e) => setCustomForm({ ...customForm, recipient_name: e.target.value })}
                placeholder="VD: Thiết bị điện Cao Thắng"
                className="ui-input"
              />
            </FormField>

            <FormField label="Địa chỉ nhận hàng" htmlFor="spx-custom-address" required fullWidth>
              <input
                id="spx-custom-address"
                type="text"
                required
                value={customForm.recipient_address}
                onChange={(e) => setCustomForm({ ...customForm, recipient_address: e.target.value })}
                placeholder="VD: 48 Đặng Ngọc Chinh, Phường 3, TP Tây Ninh"
                className="ui-input"
              />
            </FormField>

            <FormField label="Nội dung hàng hóa" htmlFor="spx-custom-desc">
              <input
                id="spx-custom-desc"
                type="text"
                value={customForm.item_desc}
                onChange={(e) => setCustomForm({ ...customForm, item_desc: e.target.value })}
                placeholder="Mặc định lấy theo mã đơn"
                className="ui-input"
              />
            </FormField>

            <FormField label="Chỉ dẫn giao hàng" htmlFor="spx-custom-note">
              <input
                id="spx-custom-note"
                type="text"
                value={customForm.note}
                onChange={(e) => setCustomForm({ ...customForm, note: e.target.value })}
                placeholder="VD: Cho xem hàng, không cho thử"
                className="ui-input"
              />
            </FormField>
          </FormGrid>
        </form>
      </AppModal>
    </PageShell>
  );
}
