import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  InvItem,
  InvWarehouse,
  ItemFlow,
  OpeningImportResult,
  StockCardRow,
  StockRow,
} from "../api";
import { PurchaseFixModal } from "../components/PurchaseFixModal";
import {
  AppButton,
  AppIcon,
  AppModal,
  DataView,
  EmptyState,
  FilterBar,
  FormField,
  InlineAlert,
  type KpiItem,
  KpiStrip,
  MobileCard,
  MobileCardActions,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  PageHeader,
  PageShell,
  StatusBadge,
  type StatusBadgeTone,
  TableSkeleton,
  useConfirm,
  useToast,
} from "../components/ui";
import { getParam, setParam } from "../util";

// Prefix cảnh báo được backend lưu trên item.note từ lần import đầu kỳ
const NOTE_WARN_PREFIX = "\u26A0\uFE0F";
const NOTE_WARN_STRIP_RE = /^\u26A0\uFE0F?\s*/;

function vnd(n: number): string {
  return Math.round(n).toLocaleString("vi-VN");
}

function qty(n: number): string {
  return Number(n.toFixed(4)).toLocaleString("vi-VN");
}

function loaiTone(loai: string): StatusBadgeTone {
  if (loai === "nhap" || loai === "sx_in") return "success";
  if (loai === "xuat" || loai === "sx_out") return "danger";
  if (loai === "dieu_chinh") return "warning";
  return "neutral";
}

function statusTone(status: string): StatusBadgeTone {
  if (status === "posted") return "success";
  if (status === "void") return "neutral";
  return "warning";
}

type SortKey =
  | "ma_hang"
  | "ten"
  | "dvt"
  | "warehouse_code"
  | "ton"
  | "don_gia_bq"
  | "gia_tri"
  | "nhap_cuoi";

type StockFilter = "all" | "in_stock" | "neg" | "treo";

export function Inventory(_props: { onOpenPurchase?: (id: number) => void }) {
  const askConfirm = useConfirm();
  const toast = useToast();

  const [fixId, setFixId] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("ma_hang");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [whs, setWhs] = useState<InvWarehouse[]>([]);
  const [whId, setWhId] = useState<number | 0>(0);
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [rows, setRows] = useState<StockRow[]>([]);
  const [allRowsSnapshot, setAllRowsSnapshot] = useState<StockRow[]>([]);
  const [tong, setTong] = useState(0);
  const [allTongSnapshot, setAllTongSnapshot] = useState(0);
  const [search, setSearch] = useState("");
  const [err, setErr] = useState("");
  const [card, setCard] = useState<{ row: StockRow; moves: StockCardRow[] } | null>(null);
  const [flow, setFlow] = useState<ItemFlow | null>(null);
  const [preview, setPreview] = useState<OpeningImportResult | null>(null);
  const [reviewItems, setReviewItems] = useState<InvItem[]>([]);
  const [dvtInputs, setDvtInputs] = useState<Record<number, string>>({});
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingFile = useRef<File | null>(null);

  // Gộp mã hàng
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mSrc, setMSrc] = useState<InvItem | null>(null);
  const [mTgt, setMTgt] = useState<InvItem | null>(null);
  const [mQuery, setMQuery] = useState<{
    which: "src" | "tgt";
    q: string;
    results: InvItem[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [listLoaded, setListLoaded] = useState(false);
  const autoFlowRef = useRef(false);

  async function searchMerge(which: "src" | "tgt", q: string) {
    setMQuery({ which, q, results: mQuery?.which === which ? mQuery.results : [] });
    if (q.trim().length >= 1) {
      try {
        const r = await api.invItems(q);
        setMQuery((prev) => (prev && prev.which === which ? { ...prev, results: r } : prev));
      } catch {
        /* ignore */
      }
    }
  }

  async function doMerge() {
    if (!mSrc || !mTgt || mSrc.id === mTgt.id) return;
    const ok = await askConfirm({
      title: `Gộp ${mSrc.ma_hang} vào ${mTgt.ma_hang}?`,
      message: `Gộp "${mSrc.ma_hang} · ${mSrc.ten}" vào "${mTgt.ma_hang} · ${mTgt.ten}". Mã ${mSrc.ma_hang} sẽ biến mất, toàn bộ tồn và chứng từ dồn về ${mTgt.ma_hang}, tính lại giá bình quân. Thao tác không thể hoàn tác.`,
      confirmLabel: `Gộp vào ${mTgt.ma_hang}`,
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.invMergeItems(mSrc.id, mTgt.id);
      const srcCode = mSrc.ma_hang;
      const tgtCode = mTgt.ma_hang;
      setMergeOpen(false);
      setMSrc(null);
      setMTgt(null);
      setMQuery(null);
      toast.success(`Đã gộp ${srcCode} vào ${tgtCode}.`);
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const r = await api.invStock({ warehouseId: whId || undefined, allItems: true });
      setRows(r.rows);
      setTong(r.tong_gia_tri);
      if (!whId) {
        setAllRowsSnapshot(r.rows);
        setAllTongSnapshot(r.tong_gia_tri);
      }
      const items = await api.invItems();
      setReviewItems(items.filter((i) => i.note.startsWith(NOTE_WARN_PREFIX)));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
      setListLoaded(true);
    }
  }

  useEffect(() => {
    api.invWarehouses().then(setWhs).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whId]);

  useEffect(() => {
    if (!listLoaded || autoFlowRef.current) return;
    autoFlowRef.current = true;
    const fl = getParam("flow");
    if (fl) {
      const row = rows.find((r) => r.item_id === Number(fl));
      if (row) openFlow(row);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listLoaded]);

  async function openCard(row: StockRow) {
    try {
      const moves = await api.invStockCard(row.item_id, row.warehouse_id);
      setCard({ row, moves });
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function openFlow(row: StockRow) {
    try {
      setFlow(await api.invItemFlow(row.item_id));
      setParam("flow", String(row.item_id));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function closeFlow() {
    setFlow(null);
    setParam("flow", null);
  }

  async function pickFile(f: File | null) {
    if (!f) return;
    pendingFile.current = f;
    setErr("");
    setImporting(true);
    try {
      setPreview(await api.invOpeningImport(f, true));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function confirmImport() {
    const f = pendingFile.current;
    if (!f) return;
    setImporting(true);
    try {
      const r = await api.invOpeningImport(f, false);
      setPreview(null);
      pendingFile.current = null;
      toast.success(
        `Đã import tồn đầu kỳ: ${r.applied?.moves ?? 0} dòng tồn · ${vnd(r.tong.tong_gia_tri)} đ`,
      );
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (q && !r.ten.toLowerCase().includes(q) && !r.ma_hang.toLowerCase().includes(q)) {
        return false;
      }
      if (stockFilter === "in_stock") return Math.abs(r.ton) >= 1e-6;
      if (stockFilter === "neg") return r.ton < -1e-6;
      if (stockFilter === "treo") return Math.abs(r.ton) < 1e-6 && Math.abs(r.gia_tri) >= 0.5;
      return true;
    });

    return [...filtered].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      let av: string | number = "";
      let bv: string | number = "";
      switch (sortKey) {
        case "ma_hang":
          av = a.ma_hang;
          bv = b.ma_hang;
          break;
        case "ten":
          av = a.ten;
          bv = b.ten;
          break;
        case "dvt":
          av = a.dvt;
          bv = b.dvt;
          break;
        case "warehouse_code":
          av = a.warehouse_code;
          bv = b.warehouse_code;
          break;
        case "ton":
          av = a.ton;
          bv = b.ton;
          break;
        case "don_gia_bq":
          av = a.don_gia_bq;
          bv = b.don_gia_bq;
          break;
        case "gia_tri":
          av = a.gia_tri;
          bv = b.gia_tri;
          break;
        case "nhap_cuoi":
          av = a.nhap_cuoi;
          bv = b.nhap_cuoi;
          break;
      }
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), "vi") * dir;
    });
  }, [rows, search, stockFilter, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  function renderSortHeader(k: SortKey, label: string) {
    const active = sortKey === k;
    return (
      <AppButton
        variant="ghost"
        size="sm"
        className="inv-sort-btn"
        onClick={() => toggleSort(k)}
      >
        <span>{label}</span>
        {active && (
          <AppIcon name={sortDir === "asc" ? "arrow-up" : "arrow-down"} size={12} />
        )}
      </AppButton>
    );
  }

  const statBaseRows = allRowsSnapshot.length > 0 ? allRowsSnapshot : rows;
  const totalValueAll = allRowsSnapshot.length > 0 ? allTongSnapshot : tong;
  const negCountAll = statBaseRows.filter((r) => r.ton < -1e-6).length;
  const inStockCountAll = statBaseRows.filter((r) => Math.abs(r.ton) >= 1e-6).length;

  const kpiItems = useMemo<KpiItem[]>(() => {
    const byWh = new Map<string, { giaTri: number; inStock: number; neg: number; total: number }>();
    for (const r of statBaseRows) {
      const code = r.warehouse_code || "?";
      const prev = byWh.get(code) ?? { giaTri: 0, inStock: 0, neg: 0, total: 0 };
      prev.total += 1;
      prev.giaTri += r.gia_tri || 0;
      if (Math.abs(r.ton) >= 1e-6) prev.inStock += 1;
      if (r.ton < -1e-6) prev.neg += 1;
      byWh.set(code, prev);
    }

    const preferredOrder = ["HH", "NVL", "TP"];
    const sortedWhs = [...whs].sort((a, b) => {
      const ia = preferredOrder.indexOf(a.code);
      const ib = preferredOrder.indexOf(b.code);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    const items: KpiItem[] = [
      {
        label: "Tổng tồn kho",
        value: `${vnd(totalValueAll)} đ`,
        sub: `${inStockCountAll}/${statBaseRows.length} mã còn tồn`,
        delta: negCountAll > 0 ? `${negCountAll} âm kho` : undefined,
        tone: negCountAll > 0 ? "danger" : "brand",
        icon: "warehouse",
        active: whId === 0,
        onClick: () => setWhId(0),
      },
    ];

    for (const w of sortedWhs.slice(0, 3)) {
      const st = byWh.get(w.code) ?? { giaTri: 0, inStock: 0, neg: 0, total: 0 };
      const tone =
        st.neg > 0
          ? "danger"
          : w.code === "TP"
            ? "success"
            : w.code === "NVL"
              ? "info"
              : "brand";
      items.push({
        label: `${w.name} (${w.code})`,
        value: `${vnd(st.giaTri)} đ`,
        sub: `${st.inStock} mã còn tồn`,
        delta: st.neg > 0 ? `${st.neg} âm kho` : undefined,
        tone,
        icon: w.code === "TP" ? "factory" : w.code === "NVL" ? "layers" : "package",
        active: whId === w.id,
        onClick: () => setWhId((cur) => (cur === w.id ? 0 : w.id)),
      });
    }

    return items;
  }, [statBaseRows, totalValueAll, inStockCountAll, negCountAll, whs, whId]);

  const activeFilters =
    (whId ? 1 : 0) + (stockFilter !== "all" ? 1 : 0) + (search.trim() ? 1 : 0);

  return (
    <PageShell data-page="inventory" className="inv-page">
      <PageHeader
        variant="compact"
        icon="warehouse"
        title="Tồn kho"
        subtitle="Số lượng tồn, giá vốn bình quân, thẻ kho và dòng chảy chứng từ theo từng kho."
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              className="ui-hidden"
              onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
            />
            <AppButton
              variant="secondary"
              leftIcon="layers"
              onClick={() => setMergeOpen(true)}
            >
              Gộp mã hàng
            </AppButton>
            <AppButton
              variant="primary"
              leftIcon="upload"
              loading={importing}
              onClick={() => fileRef.current?.click()}
            >
              {importing ? "Đang đọc…" : "Nhập tồn đầu kỳ"}
            </AppButton>
          </>
        }
      />

      <KpiStrip
        items={kpiItems}
        columns={kpiItems.length >= 4 ? 4 : (Math.max(2, kpiItems.length) as 2 | 3 | 4)}
        loading={loading && !listLoaded}
      />

      {err && <InlineAlert tone="danger">{err}</InlineAlert>}

      {reviewItems.length > 0 && (
        <InlineAlert
          tone="warning"
          title={`${reviewItems.length} mặt hàng cần xử lý tay (ghi chú từ lần import)`}
        >
          <ul className="ui-bullet-list">
            {reviewItems.map((i) => {
              const thieuDvt = i.note.includes("thiếu ĐVT");
              return (
                <li key={i.id}>
                  <b>{i.ma_hang}</b> · {i.ten.slice(0, 50)} —{" "}
                  {i.note.replace(NOTE_WARN_STRIP_RE, "")}
                  {thieuDvt && (
                    <span className="ui-inline ui-inline--md ui-inline--wrap ui-mt-1">
                      <input
                        className="ui-input ui-input-sm"
                        placeholder="Cái / Bộ…"
                        list="dvt-goi-y"
                        value={dvtInputs[i.id] ?? ""}
                        onChange={(e) => setDvtInputs({ ...dvtInputs, [i.id]: e.target.value })}
                      />
                      <AppButton
                        variant="secondary"
                        size="sm"
                        leftIcon="save"
                        disabled={!(dvtInputs[i.id] ?? "").trim()}
                        onClick={async () => {
                          const dvt = (dvtInputs[i.id] ?? "").trim();
                          if (!dvt) return;
                          const rest = i.note
                            .replace(NOTE_WARN_STRIP_RE, "")
                            .split("; ")
                            .filter((p) => p !== "thiếu ĐVT");
                          try {
                            await api.invUpdateItem(i.id, {
                              dvt,
                              note: rest.length ? `${NOTE_WARN_PREFIX} ${rest.join("; ")}` : "",
                            });
                            toast.success(`Đã cập nhật ĐVT cho ${i.ma_hang}.`);
                            load();
                          } catch (e) {
                            setErr((e as Error).message);
                          }
                        }}
                      >
                        Lưu ĐVT
                      </AppButton>
                    </span>
                  )}{" "}
                  <AppButton
                    variant="ghost"
                    size="sm"
                    leftIcon="check"
                    title="Đã xử lý xong — xóa ghi chú"
                    onClick={async () => {
                      const ok = await askConfirm({
                        title: `Xác nhận đã xử lý ${i.ma_hang}?`,
                        message: "Ghi chú cảnh báo của mặt hàng này sẽ được xóa khỏi danh sách.",
                        confirmLabel: "Đã xử lý",
                        tone: "primary",
                      });
                      if (!ok) return;
                      try {
                        await api.invUpdateItem(i.id, { note: "" });
                        toast.success(`Đã xóa ghi chú cảnh báo của ${i.ma_hang}.`);
                        load();
                      } catch (e) {
                        setErr((e as Error).message);
                      }
                    }}
                  >
                    Đã xử lý
                  </AppButton>
                </li>
              );
            })}
          </ul>
          <datalist id="dvt-goi-y">
            {["Cái", "Bộ", "Chiếc", "Cuộn", "Sợi", "Mét", "Gói", "Hộp", "Thẻ", "Con"].map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </InlineAlert>
      )}

      <FilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Tìm mã hàng hoặc tên mặt hàng…",
        }}
        filters={
          <>
            <select
              className="ui-select"
              aria-label="Lọc theo kho"
              value={whId}
              onChange={(e) => setWhId(Number(e.target.value))}
            >
              <option value={0}>Tất cả kho</option>
              {whs.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <select
              className="ui-select"
              aria-label="Lọc tình trạng tồn"
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value as StockFilter)}
            >
              <option value="all">Tất cả tình trạng</option>
              <option value="in_stock">Còn tồn</option>
              <option value="neg">Âm kho</option>
              <option value="treo">Treo giá trị (tồn = 0)</option>
            </select>
          </>
        }
        activeCount={activeFilters}
        onReset={() => {
          setSearch("");
          setWhId(0);
          setStockFilter("all");
        }}
        collapsibleMobile
      />

      {loading && !listLoaded ? (
        <TableSkeleton rows={6} cols={8} />
      ) : (
        <DataView
          mobileMode="card"
          empty={
            shown.length === 0 ? (
              <EmptyState
                icon="package"
                title={activeFilters > 0 ? "Không tìm thấy mặt hàng phù hợp" : "Chưa có tồn kho"}
                description={
                  activeFilters > 0
                    ? "Thử đổi kho, trạng thái tồn hoặc xóa từ khóa tìm kiếm."
                    : "Bấm Nhập tồn đầu kỳ để import bảng tổng hợp tồn kho Excel từ kế toán."
                }
                action={
                  activeFilters > 0 ? (
                    <AppButton
                      variant="secondary"
                      leftIcon="rotate-ccw"
                      onClick={() => {
                        setSearch("");
                        setWhId(0);
                        setStockFilter("all");
                      }}
                    >
                      Xóa lọc
                    </AppButton>
                  ) : (
                    <AppButton
                      variant="primary"
                      leftIcon="upload"
                      onClick={() => fileRef.current?.click()}
                    >
                      Nhập tồn đầu kỳ (Excel)
                    </AppButton>
                  )
                }
              />
            ) : undefined
          }
          desktop={
            <div className="table-wrap">
              <table className="dt">
                <thead>
                  <tr>
                    <th>{renderSortHeader("ma_hang", "Mã")}</th>
                    <th>{renderSortHeader("ten", "Tên hàng")}</th>
                    <th>{renderSortHeader("dvt", "ĐVT")}</th>
                    <th>{renderSortHeader("warehouse_code", "Kho")}</th>
                    <th className="ui-text-right">{renderSortHeader("ton", "Tồn")}</th>
                    <th className="ui-text-right col-hide-sm">
                      {renderSortHeader("don_gia_bq", "Giá BQ")}
                    </th>
                    <th className="ui-text-right">{renderSortHeader("gia_tri", "Giá trị")}</th>
                    <th className="col-hide-sm">
                      {renderSortHeader("nhap_cuoi", "Nhập gần nhất")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const amKho = r.ton < -1e-6;
                    const zeroTon = Math.abs(r.ton) < 1e-6;
                    const treo = zeroTon && Math.abs(r.gia_tri) >= 0.5;
                    const rowCls = [
                      "ui-clickable",
                      amKho ? "row-neg" : treo ? "row-treo" : zeroTon ? "row-zero" : "",
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <tr
                        key={`${r.item_id}-${r.warehouse_id}`}
                        className={rowCls}
                        title={
                          amKho
                            ? "ÂM KHO — đã xuất/bán vượt tồn, cần nhập bù chứng từ trước ngày này"
                            : treo
                              ? "Tồn = 0 nhưng còn treo giá trị — cần rà soát"
                              : "Xem thẻ kho"
                        }
                        onClick={() => void openCard(r)}
                      >
                        <td className="ui-nowrap">
                          <span className="ui-row">
                            <span className="ui-text-strong">{r.ma_hang}</span>
                            <AppButton
                              variant="ghost"
                              size="sm"
                              iconOnly
                              leftIcon="book-open"
                              title="Thẻ kho (lịch sử nhập/xuất)"
                              aria-label={`Thẻ kho ${r.ma_hang}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                void openCard(r);
                              }}
                            />
                            <AppButton
                              variant="ghost"
                              size="sm"
                              iconOnly
                              leftIcon="activity"
                              title="Dòng chảy (vào từ đâu -> chảy vào gì -> kẹt ở đâu)"
                              aria-label={`Dòng chảy ${r.ma_hang}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                void openFlow(r);
                              }}
                            />
                          </span>
                        </td>
                        <td>
                          {r.ten}
                          {amKho && (
                            <StatusBadge
                              tone="danger"
                              size="sm"
                              icon="alert-triangle"
                              className="ui-ml-sm"
                            >
                              ÂM KHO
                            </StatusBadge>
                          )}
                          {treo && (
                            <StatusBadge
                              tone="warning"
                              size="sm"
                              className="ui-ml-sm"
                            >
                              treo giá trị
                            </StatusBadge>
                          )}
                        </td>
                        <td className="muted">{r.dvt}</td>
                        <td>
                          <StatusBadge tone="neutral" size="sm">
                            {r.warehouse_code}
                          </StatusBadge>
                        </td>
                        <td className="ui-text-right num">
                          {zeroTon ? <span className="muted">—</span> : <b>{qty(r.ton)}</b>}
                        </td>
                        <td className="ui-text-right muted col-hide-sm num">
                          {zeroTon ? "—" : vnd(r.don_gia_bq)}
                        </td>
                        <td className="ui-text-right num">
                          {zeroTon && !treo ? <span className="muted">—</span> : vnd(r.gia_tri)}
                        </td>
                        <td className="muted ui-nowrap col-hide-sm num">
                          {r.nhap_cuoi || "—"}
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
              {shown.map((r) => {
                const amKho = r.ton < -1e-6;
                const zeroTon = Math.abs(r.ton) < 1e-6;
                const treo = zeroTon && Math.abs(r.gia_tri) >= 0.5;
                return (
                  <MobileCard
                    key={`${r.item_id}-${r.warehouse_id}`}
                    className={amKho ? "inv-card-neg" : treo ? "inv-card-warn" : ""}
                  >
                    <MobileCardHeader
                      title={`${r.ma_hang} · ${r.ten}`}
                      badge={
                        <StatusBadge tone="neutral" size="sm">
                          {r.warehouse_code}
                        </StatusBadge>
                      }
                    />
                    <MobileCardGrid>
                      <MobileCardRow
                        label="Tồn hiện tại"
                        value={zeroTon ? "—" : `${qty(r.ton)} ${r.dvt}`}
                        mono
                      />
                      <MobileCardRow
                        label="Giá trị"
                        value={zeroTon && !treo ? "—" : `${vnd(r.gia_tri)} đ`}
                        mono
                      />
                    </MobileCardGrid>
                    {(amKho || treo) && (
                      <div className="ui-row">
                        {amKho && (
                          <StatusBadge tone="danger" size="sm" icon="alert-triangle">
                            ÂM KHO
                          </StatusBadge>
                        )}
                        {treo && (
                          <StatusBadge tone="warning" size="sm">
                            Treo giá trị
                          </StatusBadge>
                        )}
                      </div>
                    )}
                    <MobileCardActions>
                      <AppButton
                        variant="secondary"
                        size="sm"
                        leftIcon="book-open"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openCard(r);
                        }}
                      >
                        Thẻ kho
                      </AppButton>
                      <AppButton
                        variant="secondary"
                        size="sm"
                        leftIcon="activity"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openFlow(r);
                        }}
                      >
                        Dòng chảy
                      </AppButton>
                    </MobileCardActions>
                  </MobileCard>
                );
              })}
            </div>
          }
        />
      )}

      {/* Modal Gộp mã hàng */}
      <AppModal
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        title="Gộp mã hàng (dồn về 1 mã, tính lại giá bình quân)"
        subtitle="Chọn mã nguồn (sẽ biến mất) và mã đích (giữ lại)."
        size="md"
        footer={
          <>
            <AppButton variant="secondary" onClick={() => setMergeOpen(false)}>
              Hủy
            </AppButton>
            <AppButton
              variant="primary"
              leftIcon="layers"
              disabled={!mSrc || !mTgt || mSrc.id === mTgt.id}
              onClick={doMerge}
            >
              Gộp {mSrc?.ma_hang ?? "?"} → {mTgt?.ma_hang ?? "?"}
            </AppButton>
          </>
        }
      >
        <div className="ui-stack">
          <p className="ui-muted">
            Dùng khi 2 mã thực ra là cùng một mặt hàng (vd <b>HH9013</b> tự sinh trùng với{" "}
            <b>HH0013</b> có sẵn).
          </p>

          {[
            {
              key: "src" as const,
              label: "1. Mã NGUỒN — sẽ biến mất",
              val: mSrc,
              set: setMSrc,
              tone: "danger" as StatusBadgeTone,
            },
            {
              key: "tgt" as const,
              label: "2. Mã ĐÍCH — giữ lại",
              val: mTgt,
              set: setMTgt,
              tone: "success" as StatusBadgeTone,
            },
          ].map((f) => (
            <FormField key={f.key} label={f.label}>
              {f.val ? (
                <div className="ui-row">
                  <StatusBadge tone={f.tone} size="sm">
                    {f.val.ma_hang}
                  </StatusBadge>
                  <span>{f.val.ten}</span>
                  <AppButton
                    variant="ghost"
                    size="sm"
                    leftIcon="x"
                    onClick={() => f.set(null)}
                  >
                    Đổi
                  </AppButton>
                </div>
              ) : (
                <div>
                  <input
                    className="ui-input"
                    placeholder="Gõ mã hoặc tên để tìm…"
                    value={mQuery?.which === f.key ? mQuery.q : ""}
                    onChange={(e) => void searchMerge(f.key, e.target.value)}
                  />
                  {mQuery?.which === f.key && mQuery.results.length > 0 && (
                    <div className="ui-stack--xs ui-mt-1">
                      {mQuery.results.slice(0, 6).map((it) => (
                        <AppButton
                          key={it.id}
                          variant="ghost"
                          size="sm"
                          className="ui-wrap-btn"
                          onClick={() => {
                            f.set(it);
                            setMQuery(null);
                          }}
                        >
                          <b>{it.ma_hang}</b> · {it.ten.slice(0, 46)}
                        </AppButton>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </FormField>
          ))}

          {mSrc && mTgt && mSrc.id === mTgt.id && (
            <InlineAlert tone="danger">
              Hai mã đang trùng nhau — vui lòng chọn 2 mã khác nhau.
            </InlineAlert>
          )}
        </div>
      </AppModal>

      {/* Modal Thẻ kho */}
      <AppModal
        open={!!card}
        onClose={() => setCard(null)}
        size="lg"
        title={
          card ? (
            <span className="ui-inline ui-inline--md ui-inline--wrap">
              <span>
                Thẻ kho: {card.row.ma_hang} · {card.row.ten}
              </span>
              <StatusBadge tone="neutral" size="sm">
                {card.row.warehouse_code}
              </StatusBadge>
            </span>
          ) : (
            "Thẻ kho"
          )
        }
        footer={
          <AppButton variant="secondary" onClick={() => setCard(null)}>
            Đóng
          </AppButton>
        }
      >
        {card && (
          <DataView
            mobileMode="scroll"
            desktop={
              <div className="table-wrap ui-scroll-lg">
                <table className="dt">
                  <thead>
                    <tr>
                      <th>Ngày</th>
                      <th>Loại</th>
                      <th>Số Lô / Serial</th>
                      <th className="ui-text-right">Nhập</th>
                      <th className="ui-text-right">Xuất</th>
                      <th className="ui-text-right">Đơn giá</th>
                      <th className="ui-text-right">Giá trị</th>
                      <th className="ui-text-right">Tồn</th>
                      <th>Chứng từ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {card.moves.map((m) => (
                      <tr key={m.id}>
                        <td className="ui-nowrap num">{m.ngay}</td>
                        <td>
                          <StatusBadge tone={m.xuat ? "warning" : "success"} size="sm">
                            {m.loai_label}
                          </StatusBadge>
                        </td>
                        <td className="ui-nowrap">
                          {m.lot_number && (
                            <StatusBadge
                              tone="neutral"
                              size="sm"
                              className="ui-mr-xs"
                              title={`Số lô: ${m.lot_number}`}
                            >
                              Lô: {m.lot_number}
                            </StatusBadge>
                          )}
                          {m.serial_numbers && (
                            <StatusBadge
                              tone="neutral"
                              size="sm"
                              title={`Serial: ${m.serial_numbers}`}
                            >
                              SN: {m.serial_numbers}
                            </StatusBadge>
                          )}
                          {!m.lot_number && !m.serial_numbers && <span className="muted">—</span>}
                        </td>
                        <td className="ui-text-right num">{m.nhap ? qty(m.nhap) : ""}</td>
                        <td className="ui-text-right num">{m.xuat ? qty(m.xuat) : ""}</td>
                        <td className="ui-text-right muted num">{vnd(m.don_gia)}</td>
                        <td className="ui-text-right num">{vnd(m.gia_tri)}</td>
                        <td className="ui-text-right num">
                          <b>{qty(m.ton)}</b>
                        </td>
                        <td className="ui-nowrap">
                          {m.ref_type === "purchase" && m.ref_id ? (
                            <span className="ui-row">
                              <AppButton
                                variant="secondary"
                                size="sm"
                                leftIcon="edit"
                                title="Sửa lại đơn giá/số lượng hóa đơn này ngay tại đây"
                                onClick={() => setFixId(m.ref_id as number)}
                              >
                                Sửa HĐ #{m.ref_id}
                              </AppButton>
                              <a
                                className="ui-btn ui-btn--ghost ui-btn--sm ui-btn--icon-only"
                                href={`/api/inv/purchase/${m.ref_id}/file`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Mở file hóa đơn gốc"
                                aria-label={`Mở file hóa đơn #${m.ref_id}`}
                              >
                                <AppIcon name="external-link" size={14} />
                              </a>
                            </span>
                          ) : m.ref_type === "production" && m.ref_id ? (
                            <span className="muted">LSX #{m.ref_id}</span>
                          ) : m.ref_type === "issue" && m.ref_id ? (
                            <span className="muted">PX #{m.ref_id}</span>
                          ) : (
                            <span className="muted">{m.ref_type || "—"}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            }
          />
        )}
      </AppModal>

      {/* Modal Dòng chảy */}
      <AppModal
        open={!!flow}
        onClose={closeFlow}
        size="lg"
        title={flow ? `Dòng chảy — ${flow.item.ma_hang} · ${flow.item.ten}` : "Dòng chảy"}
        footer={
          <AppButton variant="secondary" onClick={closeFlow}>
            Đóng
          </AppButton>
        }
      >
        {flow && (
          <div className="ui-stack">
            <div className="ui-row">
              {flow.ton.length === 0 ? (
                <span className="muted">Không còn tồn ở kho nào</span>
              ) : (
                flow.ton.map((t) => (
                  <StatusBadge key={t.warehouse_code} tone="neutral" size="sm">
                    {t.warehouse_code} · {qty(t.ton)} · {vnd(t.gia_tri)} đ
                  </StatusBadge>
                ))
              )}
            </div>

            <DataView
              mobileMode="scroll"
              desktop={
                <div className="table-wrap ui-scroll-md">
                  <table className="dt">
                    <thead>
                      <tr>
                        <th>Ngày</th>
                        <th>Loại</th>
                        <th>Chứng từ</th>
                        <th>Số Lô / Serial</th>
                        <th>Đích đến</th>
                        <th className="ui-text-right">±SL</th>
                        <th className="ui-text-right">Giá trị</th>
                        <th className="ui-text-right">Số dư</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flow.steps.map((s, i) => {
                        const extra = s as { lot_number?: string; serial_numbers?: string };
                        return (
                          <tr key={i}>
                            <td className="ui-nowrap num">{s.ngay}</td>
                            <td className="ui-nowrap">
                              <StatusBadge
                                tone={loaiTone(s.loai)}
                                size="sm"
                                className="ui-mr-xs"
                              >
                                {s.loai_label}
                              </StatusBadge>
                              <StatusBadge tone="neutral" size="sm">
                                {s.warehouse_code}
                              </StatusBadge>
                            </td>
                            <td>
                              {s.doc ? (
                                <span>
                                  {s.doc.label}{" "}
                                  {s.doc.status && (
                                    <StatusBadge tone={statusTone(s.doc.status)} size="sm">
                                      {s.doc.status}
                                    </StatusBadge>
                                  )}
                                </span>
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                            <td className="ui-nowrap">
                              {extra.lot_number && (
                                <StatusBadge
                                  tone="neutral"
                                  size="sm"
                                  className="ui-mr-xs"
                                >
                                  Lô: {extra.lot_number}
                                </StatusBadge>
                              )}
                              {extra.serial_numbers && (
                                <StatusBadge tone="neutral" size="sm">
                                  SN: {extra.serial_numbers}
                                </StatusBadge>
                              )}
                              {!extra.lot_number && !extra.serial_numbers && (
                                <span className="muted">—</span>
                              )}
                            </td>
                            <td className="muted">
                              {s.flow_to && s.flow_to.length > 0
                                ? "→ " +
                                  s.flow_to
                                    .map((f) => `${f.ma_hang} · ${f.ten} ×${qty(f.so_luong)}`)
                                    .join(", ")
                                : "—"}
                            </td>
                            <td className="ui-text-right num">
                              {s.so_luong > 0 ? "+" : ""}
                              {qty(s.so_luong)}
                            </td>
                            <td className="ui-text-right muted num">{vnd(s.gia_tri)}</td>
                            <td className="ui-text-right num">
                              <b>{qty(s.so_du)}</b>
                            </td>
                          </tr>
                        );
                      })}
                      {flow.steps.length === 0 && (
                        <tr>
                          <td colSpan={8}>
                            <span className="muted">Chưa có phát sinh</span>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              }
            />

            <h4 className="ui-subhead ui-mt-4">
              <AppIcon name="alert-triangle" size={16} />
              <span>Đang kẹt ở chứng từ nháp</span>
            </h4>
            {flow.stuck.length === 0 ? (
              <InlineAlert tone="success">Không có số lượng nào bị kẹt ở chứng từ nháp.</InlineAlert>
            ) : (
              <DataView
                mobileMode="scroll"
                desktop={
                  <div className="table-wrap">
                    <table className="dt">
                      <thead>
                        <tr>
                          <th>Loại</th>
                          <th>Chứng từ</th>
                          <th>Ngày</th>
                          <th>Kho</th>
                          <th className="ui-text-right">SL giữ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {flow.stuck.map((s, i) => (
                          <tr key={i}>
                            <td>{s.kind === "issue" ? "Phiếu xuất" : "Lệnh SX"}</td>
                            <td>{s.label}</td>
                            <td className="ui-nowrap num">{s.ngay}</td>
                            <td>
                              <StatusBadge tone="neutral" size="sm">
                                {s.warehouse_code}
                              </StatusBadge>
                            </td>
                            <td className="ui-text-right num">{qty(s.so_luong)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                }
              />
            )}
          </div>
        )}
      </AppModal>

      {/* Modal Xem trước import tồn đầu kỳ */}
      <AppModal
        open={!!preview}
        onClose={() => setPreview(null)}
        title="Xem trước import tồn đầu kỳ (31/12/2025)"
        size="lg"
        footer={
          preview ? (
            <>
              <AppButton variant="secondary" onClick={() => setPreview(null)}>
                Hủy
              </AppButton>
              <AppButton
                variant="primary"
                leftIcon="check-circle"
                loading={importing}
                onClick={confirmImport}
              >
                {importing ? "Đang import…" : `Import ${preview.preview.length} dòng tồn`}
              </AppButton>
            </>
          ) : undefined
        }
      >
        {preview && (
          <div className="ui-stack">
            <p className="ui-muted">
              <b className="num">{preview.tong.so_dong}</b> dòng ·{" "}
              <b className="num">{preview.tong.so_ma}</b> mã hàng ·{" "}
              <b className="num">{preview.tong.so_ma_ton}</b> mã còn tồn · tổng giá trị{" "}
              <b className="num">{vnd(preview.tong.tong_gia_tri)} đ</b>
            </p>
            {preview.warnings.length > 0 && (
              <InlineAlert
                tone="warning"
                title={`${preview.warnings.length} cảnh báo — đọc kỹ trước khi import`}
              >
                <div className="ui-scroll-xs">
                  <ul className="ui-bullet-list">
                    {preview.warnings.map((w, i) => (
                      <li key={i}>{w.msg}</li>
                    ))}
                  </ul>
                </div>
              </InlineAlert>
            )}
            <DataView
              mobileMode="scroll"
              desktop={
                <div className="table-wrap ui-scroll-md">
                  <table className="dt">
                    <thead>
                      <tr>
                        <th>Mã</th>
                        <th>Tên</th>
                        <th>Kho</th>
                        <th className="ui-text-right">SL</th>
                        <th className="ui-text-right">Đơn giá</th>
                        <th className="ui-text-right">Giá trị</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.preview.map((p, i) => (
                        <tr key={i}>
                          <td className="ui-nowrap ui-text-strong">{p.ma_hang}</td>
                          <td>{p.ten}</td>
                          <td>
                            <StatusBadge tone="neutral" size="sm">
                              {p.kho}
                            </StatusBadge>
                          </td>
                          <td className="ui-text-right num">{qty(p.so_luong)}</td>
                          <td className="ui-text-right muted num">{vnd(p.don_gia)}</td>
                          <td className="ui-text-right num">{vnd(p.gia_tri)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              }
            />
          </div>
        )}
      </AppModal>

      {fixId != null && (
        <PurchaseFixModal
          purchaseId={fixId}
          onClose={() => setFixId(null)}
          onChanged={() => {
            load();
            if (card) void openCard(card.row);
          }}
        />
      )}
    </PageShell>
  );
}
