import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  api,
  Customer,
  InvIssue,
  InvIssueLine,
  MUC_DICH_XUAT,
  MucDichXuat,
  NegStockError,
  NegStockViolation,
  StockRow,
} from "../api";
import { DateFilter, DateRange } from "../components/DateFilter";
import { NegStockModal } from "../components/NegStockModal";
import {
  AppButton,
  AppModal,
  DataView,
  EmptyState,
  FilterBar,
  FormField,
  FormGrid,
  InlineAlert,
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
import { openExternalSafe } from "../utils/url";
import { getParam, setParam } from "../util";

function vnd(n: number): string {
  return Math.round(n).toLocaleString("vi-VN");
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface DraftLine {
  item_id: number;
  warehouse_id: number;
  warehouse_code: string;
  label: string;
  dvt: string;
  kha_dung: number;
  so_luong: number;
  don_gia_ban: number;
}

const STATUS_META: Record<string, { tone: StatusBadgeTone; label: string }> = {
  draft: { tone: "warning", label: "Nháp" },
  posted: { tone: "success", label: "Đã ghi sổ" },
};

// Định mức nhân công trung bình để ước lượng lợi nhuận (đồng / 1 sản phẩm)
const NHAN_CONG_PER_SP = 300_000;

function lineCode(line: InvIssueLine): string {
  return line.ma_hang || (line as unknown as { item_code?: string }).item_code || "";
}

function lineName(line: InvIssueLine): string {
  return line.ten || (line as unknown as { item_name?: string }).item_name || "";
}

export function StockIssue() {
  const askConfirm = useConfirm();
  const toast = useToast();

  const [list, setList] = useState<InvIssue[]>([]);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [statusF, setStatusF] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>({ tu: "", den: "" });
  const [creating, setCreating] = useState(false);
  const [ngay, setNgay] = useState(today());
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<number | 0>(0);
  const [note, setNote] = useState("");
  const [mucDich, setMucDich] = useState<MucDichXuat>("ban");
  const [lyDo, setLyDo] = useState("");
  const [nguoiNhan, setNguoiNhan] = useState("");
  const [boPhan, setBoPhan] = useState("");
  const [avail, setAvail] = useState<StockRow[]>([]);
  const [pickQ, setPickQ] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [view, setView] = useState<InvIssue | null>(null);
  const [viewAvail, setViewAvail] = useState<StockRow[]>([]);
  const [viewBusy, setViewBusy] = useState(false);
  const [negModal, setNegModal] = useState<{
    violations: NegStockViolation[];
    issueId: number;
    fromCreate?: boolean;
  } | null>(null);
  const [listLoaded, setListLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const autoPxRef = useRef(false);

  const createDateId = useId();
  const createCustId = useId();
  const createNoteId = useId();
  const createPurposeId = useId();
  const createReasonId = useId();
  const createReceiverId = useId();
  const createDeptId = useId();
  const viewDateId = useId();
  const viewNoteId = useId();

  async function load() {
    setLoading(true);
    try {
      setList(await api.invIssues("", dateRange));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
      setListLoaded(true);
    }
  }

  useEffect(() => {
    api.listCustomers().then(setCustomers).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange.tu, dateRange.den]);

  useEffect(() => {
    if (!listLoaded || autoPxRef.current) return;
    autoPxRef.current = true;
    const px = getParam("px");
    if (px) {
      const iss = list.find((i) => i.id === Number(px));
      if (iss) openView(iss);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listLoaded]);

  useEffect(() => {
    if (!creating) return;
    api
      .invAvailability(ngay)
      .then((r) => setAvail(r.rows))
      .catch((e) => setErr((e as Error).message));
  }, [creating, ngay]);

  function addLine(r: StockRow) {
    const key = (l: DraftLine) => `${l.item_id}-${l.warehouse_id}`;
    if (lines.some((l) => key(l) === `${r.item_id}-${r.warehouse_id}`)) return;
    setLines([
      ...lines,
      {
        item_id: r.item_id,
        warehouse_id: r.warehouse_id,
        warehouse_code: r.warehouse_code,
        label: `${r.ma_hang} · ${r.ten}`,
        dvt: r.dvt,
        kha_dung: r.kha_dung ?? 0,
        so_luong: 1,
        don_gia_ban: 0,
      },
    ]);
  }

  function resetCreate() {
    setCreating(false);
    setLines([]);
    setNote("");
    setLyDo("");
    setNguoiNhan("");
    setBoPhan("");
  }

  async function save() {
    setErr("");
    setViewBusy(true);
    let issId: number | null = null;
    try {
      const dk = MUC_DICH_XUAT[mucDich];
      const iss = await api.invIssueCreate({
        ngay,
        customer_id: customerId || null,
        note,
        muc_dich: mucDich,
        ly_do: lyDo,
        nguoi_nhan: nguoiNhan,
        bo_phan: boPhan,
        tk_no: dk.no,
        tk_co: dk.co,
        lines: lines.map((l) => ({
          item_id: l.item_id,
          warehouse_id: l.warehouse_id,
          so_luong: l.so_luong,
          don_gia_ban: l.don_gia_ban,
        })),
      });
      issId = iss.id;
      await api.invIssuePost(iss.id);
      resetCreate();
      toast.success(`Đã tạo và ghi sổ phiếu xuất ${iss.so_ct || `PX#${iss.id}`}.`);
      load();
    } catch (e) {
      if (e instanceof NegStockError && issId != null) {
        setNegModal({ violations: e.violations, issueId: issId, fromCreate: true });
      } else {
        setErr((e as Error).message);
      }
    } finally {
      setViewBusy(false);
    }
  }

  async function quickPostIssue(iss: InvIssue) {
    setViewBusy(true);
    setErr("");
    try {
      await api.invIssuePost(iss.id);
      toast.success(`Đã ghi sổ phiếu xuất ${iss.so_ct || `PX#${iss.id}`}.`);
      load();
    } catch (e) {
      if (e instanceof NegStockError) {
        setNegModal({ violations: e.violations, issueId: iss.id });
      } else {
        setErr((e as Error).message);
      }
    } finally {
      setViewBusy(false);
    }
  }

  async function removeDraftIssue(iss: InvIssue) {
    const ok = await askConfirm({
      title: `Xóa phiếu nháp ${iss.so_ct || `PX#${iss.id}`}?`,
      message: "Phiếu xuất ở trạng thái nháp sẽ bị xóa vĩnh viễn.",
      confirmLabel: "Xóa phiếu nháp",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.invIssueDelete(iss.id);
      toast.success(`Đã xóa phiếu nháp ${iss.so_ct || `PX#${iss.id}`}.`);
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function openView(iss: InvIssue) {
    setErr("");
    setView(iss);
    setParam("px", String(iss.id));
    if (iss.status === "draft") {
      api
        .invAvailability(iss.ngay)
        .then((r) => setViewAvail(r.rows))
        .catch(() => {});
    }
  }

  function closeView() {
    setView(null);
    setParam("px", null);
  }

  function patchViewLine(lineId: number, patch: Partial<InvIssueLine>) {
    setView((v) =>
      v ? { ...v, lines: v.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)) } : v,
    );
  }

  function khaDungFor(itemId: number, warehouseId: number): number {
    return (
      viewAvail.find((r) => r.item_id === itemId && r.warehouse_id === warehouseId)?.kha_dung ?? 0
    );
  }

  async function viewVoid() {
    if (!view) return;
    const ok = await askConfirm({
      title: `Hủy ghi sổ phiếu ${view.so_ct || `PX#${view.id}`}?`,
      message: "Hủy ghi sổ phiếu xuất này để chỉnh sửa? Tồn kho sẽ được tính lại tự động.",
      confirmLabel: "Hủy ghi sổ để sửa",
      tone: "warning",
    });
    if (!ok) return;
    setViewBusy(true);
    setErr("");
    try {
      const updated = await api.invIssueVoid(view.id);
      setView(updated);
      api
        .invAvailability(updated.ngay)
        .then((r) => setViewAvail(r.rows))
        .catch(() => {});
      toast.info(`Đã hủy ghi sổ phiếu ${updated.so_ct || `PX#${updated.id}`}.`);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setViewBusy(false);
    }
  }

  async function viewSave(): Promise<InvIssue | null> {
    if (!view) return null;
    return api.invIssueSave(view.id, {
      ngay: view.ngay,
      customer_id: view.customer_id,
      note: view.note,
      muc_dich: view.muc_dich,
      ly_do: view.ly_do,
      nguoi_nhan: view.nguoi_nhan,
      bo_phan: view.bo_phan,
      tk_no: view.tk_no,
      tk_co: view.tk_co,
      lines: view.lines.map((l) => ({
        item_id: l.item_id,
        warehouse_id: l.warehouse_id,
        so_luong: l.so_luong,
        don_gia_ban: l.don_gia_ban,
      })),
    });
  }

  async function doViewSave() {
    setViewBusy(true);
    setErr("");
    try {
      const updated = await viewSave();
      if (updated) setView(updated);
      toast.success("Đã lưu thay đổi phiếu xuất.");
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setViewBusy(false);
    }
  }

  async function doViewPost() {
    setViewBusy(true);
    setErr("");
    try {
      const saved = await viewSave();
      if (saved) {
        const posted = await api.invIssuePost(saved.id);
        setView(posted);
        toast.success(`Đã ghi sổ phiếu xuất ${posted.so_ct || `PX#${posted.id}`}.`);
        load();
      }
    } catch (e) {
      if (e instanceof NegStockError && view) {
        setNegModal({ violations: e.violations, issueId: view.id });
      } else {
        setErr((e as Error).message);
      }
    } finally {
      setViewBusy(false);
    }
  }

  async function confirmNegPost(reason: string) {
    if (!negModal) return;
    setViewBusy(true);
    setErr("");
    try {
      const posted = await api.invIssuePost(negModal.issueId, reason);
      if (negModal.fromCreate) {
        resetCreate();
      } else if (view && view.id === negModal.issueId) {
        setView(posted);
      }
      setNegModal(null);
      toast.warning(`Đã ghi sổ chấp nhận âm kho cho phiếu #${posted.id}.`);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setViewBusy(false);
    }
  }

  const shown = useMemo(() => {
    const qLower = search.trim().toLowerCase();
    return list.filter((i) => {
      if (statusF && i.status !== statusF) return false;
      if (!qLower) return true;
      return (
        (i.so_ct || `px#${i.id}`).toLowerCase().includes(qLower) ||
        (i.customer_name || "").toLowerCase().includes(qLower) ||
        (i.note || "").toLowerCase().includes(qLower) ||
        (i.lines || []).some((l) => lineCode(l).toLowerCase().includes(qLower))
      );
    });
  }, [list, search, statusF]);

  const activeFilters =
    (statusF ? 1 : 0) + (dateRange.tu || dateRange.den ? 1 : 0) + (search.trim() ? 1 : 0);

  const q = pickQ.trim().toLowerCase();
  const pickable = avail.filter(
    (r) =>
      (r.kha_dung ?? 0) > 0 &&
      (!q || r.ten.toLowerCase().includes(q) || r.ma_hang.toLowerCase().includes(q)),
  );
  const over = lines.filter((l) => l.so_luong > l.kha_dung);

  return (
    <PageShell data-page="stockissue" className="inv-page">
      <PageHeader
        variant="compact"
        icon="truck"
        title="Xuất kho"
        subtitle={`Quản lý phiếu xuất kho và hạch toán giá vốn bình quân (${shown.length} phiếu).`}
        actions={
          <>
            <AppButton
              variant="secondary"
              leftIcon="download"
              onClick={() =>
                openExternalSafe(
                  api.invExportUrl("issues", "xlsx", { tu: dateRange.tu, den: dateRange.den }),
                )
              }
            >
              Excel
            </AppButton>
            <AppButton variant="primary" leftIcon="plus" onClick={() => setCreating(true)}>
              Tạo phiếu xuất
            </AppButton>
          </>
        }
      />

      {err && !view && !creating && <InlineAlert tone="danger">{err}</InlineAlert>}

      <FilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Tìm số CT, khách hàng, mã hàng, ghi chú…",
        }}
        filters={
          <>
            <DateFilter value={dateRange} onChange={setDateRange} />
            <select
              className="ui-select"
              aria-label="Lọc trạng thái phiếu xuất"
              value={statusF}
              onChange={(e) => setStatusF(e.target.value)}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="draft">Nháp</option>
              <option value="posted">Đã ghi sổ</option>
            </select>
          </>
        }
        activeCount={activeFilters}
        onReset={() => {
          setSearch("");
          setStatusF("");
          setDateRange({ tu: "", den: "" });
        }}
        collapsibleMobile
      />

      {loading && !listLoaded ? (
        <TableSkeleton rows={6} cols={9} />
      ) : (
        <DataView
          mobileMode="card"
          empty={
            shown.length === 0 ? (
              <EmptyState
                icon="truck"
                title={activeFilters > 0 ? "Không có phiếu xuất khớp bộ lọc" : "Chưa có phiếu xuất nào"}
                description={
                  activeFilters > 0
                    ? "Thử đổi khoảng thời gian hoặc xóa bộ lọc."
                    : "Bấm Tạo phiếu xuất để lập chứng từ xuất kho mới."
                }
                action={
                  activeFilters > 0 ? (
                    <AppButton
                      variant="secondary"
                      leftIcon="rotate-ccw"
                      onClick={() => {
                        setSearch("");
                        setStatusF("");
                        setDateRange({ tu: "", den: "" });
                      }}
                    >
                      Xóa lọc
                    </AppButton>
                  ) : (
                    <AppButton variant="primary" leftIcon="plus" onClick={() => setCreating(true)}>
                      Tạo phiếu xuất
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
                    <th>Số CT</th>
                    <th>Ngày</th>
                    <th>Khách hàng</th>
                    <th>Mục đích</th>
                    <th>Định khoản</th>
                    <th>Ghi chú</th>
                    <th className="ui-text-right">Giá vốn</th>
                    <th>Trạng thái</th>
                    <th className="ui-col-chk"></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((i) => {
                    const meta = STATUS_META[i.status] ?? { tone: "neutral" as const, label: i.status };
                    const posted = i.status === "posted";
                    const giaVon = posted
                      ? (i.lines || []).reduce((s, l) => s + (l.gia_von ?? 0), 0)
                      : (i.tong_gia_von_uoc ?? 0);
                    const dk = MUC_DICH_XUAT[i.muc_dich];
                    return (
                      <tr
                        key={i.id}
                        className="ui-clickable"
                        title="Xem/sửa phiếu xuất"
                        onClick={() => openView(i)}
                      >
                        <td className="muted ui-nowrap">{i.so_ct || `PX#${i.id}`}</td>
                        <td className="ui-nowrap num">{i.ngay}</td>
                        <td>{i.customer_name || "—"}</td>
                        <td className="muted ui-nowrap">{dk?.label ?? i.muc_dich ?? "—"}</td>
                        <td className="ui-nowrap">
                          {i.tk_no && (
                            <StatusBadge tone="neutral" size="sm" className="ui-mr-xs">
                              Nợ {i.tk_no}
                            </StatusBadge>
                          )}
                          {i.tk_co && (
                            <StatusBadge tone="neutral" size="sm">
                              Có {i.tk_co}
                            </StatusBadge>
                          )}
                        </td>
                        <td className="muted">
                          {(i.lines || []).map((l) => `${lineCode(l)}×${l.so_luong}`).join(", ")}
                          {i.note ? ` — ${i.note}` : ""}
                        </td>
                        <td className="ui-text-right ui-nowrap num">
                          {posted ? vnd(giaVon) : <span className="muted">~{vnd(giaVon)}</span>}
                        </td>
                        <td>
                          <StatusBadge tone={meta.tone} size="sm" dot>
                            {meta.label}
                          </StatusBadge>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {i.status !== "posted" && (
                            <div className="ui-row">
                              <AppButton
                                variant="primary"
                                size="sm"
                                leftIcon="check"
                                disabled={viewBusy}
                                onClick={() => void quickPostIssue(i)}
                              >
                                Ghi sổ
                              </AppButton>
                              <AppButton
                                variant="ghost"
                                size="sm"
                                iconOnly
                                leftIcon="trash"
                                aria-label={`Xóa phiếu xuất ${i.so_ct || i.id}`}
                                onClick={() => void removeDraftIssue(i)}
                              />
                            </div>
                          )}
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
              {shown.map((i) => {
                const meta = STATUS_META[i.status] ?? { tone: "neutral" as const, label: i.status };
                const posted = i.status === "posted";
                const giaVon = posted
                  ? (i.lines || []).reduce((s, l) => s + (l.gia_von ?? 0), 0)
                  : (i.tong_gia_von_uoc ?? 0);
                const dk = MUC_DICH_XUAT[i.muc_dich];
                return (
                  <MobileCard key={i.id} onClick={() => openView(i)}>
                    <MobileCardHeader
                      title={`${i.so_ct || `PX#${i.id}`} · ${i.customer_name || dk?.label || i.muc_dich || "Phiếu xuất"}`}
                      subtitle={i.ngay}
                      badge={
                        <StatusBadge tone={meta.tone} size="sm" dot>
                          {meta.label}
                        </StatusBadge>
                      }
                    />
                    <MobileCardGrid>
                      <MobileCardRow
                        label="Giá vốn"
                        value={posted ? `${vnd(giaVon)} đ` : `~${vnd(giaVon)} đ`}
                        mono
                      />
                      <MobileCardRow
                        label="Định khoản"
                        value={i.tk_no || i.tk_co ? `Nợ ${i.tk_no || "—"} / Có ${i.tk_co || "—"}` : "—"}
                      />
                      <MobileCardRow
                        label="Chi tiết"
                        value={
                          [
                            (i.lines || []).map((l) => `${lineCode(l)}×${l.so_luong}`).join(", "),
                            i.note,
                          ]
                            .filter(Boolean)
                            .join(" — ") || "—"
                        }
                        fullWidth
                      />
                    </MobileCardGrid>
                    <MobileCardActions>
                      <AppButton
                        variant="secondary"
                        size="sm"
                        leftIcon="eye"
                        onClick={(e) => {
                          e.stopPropagation();
                          openView(i);
                        }}
                      >
                        Xem / sửa
                      </AppButton>
                      {i.status !== "posted" && (
                        <>
                          <AppButton
                            variant="primary"
                            size="sm"
                            leftIcon="check"
                            disabled={viewBusy}
                            onClick={(e) => {
                              e.stopPropagation();
                              void quickPostIssue(i);
                            }}
                          >
                            Ghi sổ
                          </AppButton>
                          <AppButton
                            variant="ghost"
                            size="sm"
                            iconOnly
                            leftIcon="trash"
                            aria-label={`Xóa phiếu xuất ${i.so_ct || i.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void removeDraftIssue(i);
                            }}
                          />
                        </>
                      )}
                    </MobileCardActions>
                  </MobileCard>
                );
              })}
            </div>
          }
        />
      )}

      <AppModal
        open={creating}
        onClose={() => setCreating(false)}
        title="Tạo phiếu xuất kho"
        subtitle="Chỉ chọn được hàng đủ tồn tại ngày xuất (đã trừ các phiếu xuất tương lai)."
        size="lg"
        footer={
          <>
            <AppButton variant="secondary" onClick={() => setCreating(false)}>
              Hủy
            </AppButton>
            <AppButton
              variant="primary"
              leftIcon="check-circle"
              loading={viewBusy}
              disabled={lines.length === 0 || lines.some((l) => l.so_luong <= 0)}
              title={
                over.length > 0
                  ? "Có dòng vượt khả dụng — khi ghi sổ sẽ hỏi lý do duyệt âm kho"
                  : ""
              }
              onClick={save}
            >
              Ghi sổ phiếu xuất ({lines.length} dòng)
            </AppButton>
          </>
        }
      >
        <div className="ui-stack">
          {err && <InlineAlert tone="danger">{err}</InlineAlert>}

          <FormGrid cols={3}>
            <FormField label="Ngày xuất" htmlFor={createDateId}>
              <input
                id={createDateId}
                className="ui-input"
                type="date"
                value={ngay}
                onChange={(e) => setNgay(e.target.value)}
              />
            </FormField>
            <FormField label="Khách hàng" htmlFor={createCustId}>
              <select
                id={createCustId}
                className="ui-select"
                value={customerId}
                onChange={(e) => setCustomerId(Number(e.target.value))}
              >
                <option value={0}>— không chọn —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Ghi chú" htmlFor={createNoteId}>
              <input
                id={createNoteId}
                className="ui-input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </FormField>
            <FormField label="Mục đích xuất" htmlFor={createPurposeId}>
              <select
                id={createPurposeId}
                className="ui-select"
                value={mucDich}
                onChange={(e) => setMucDich(e.target.value as MucDichXuat)}
              >
                {(Object.keys(MUC_DICH_XUAT) as MucDichXuat[]).map((k) => (
                  <option key={k} value={k}>
                    {MUC_DICH_XUAT[k].label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Lý do xuất" htmlFor={createReasonId}>
              <input
                id={createReasonId}
                className="ui-input"
                value={lyDo}
                onChange={(e) => setLyDo(e.target.value)}
              />
            </FormField>
            <FormField label="Người nhận" htmlFor={createReceiverId}>
              <input
                id={createReceiverId}
                className="ui-input"
                value={nguoiNhan}
                onChange={(e) => setNguoiNhan(e.target.value)}
              />
            </FormField>
            <FormField label="Bộ phận" htmlFor={createDeptId}>
              <input
                id={createDeptId}
                className="ui-input"
                value={boPhan}
                onChange={(e) => setBoPhan(e.target.value)}
              />
            </FormField>
          </FormGrid>

          <div className="ui-row ui-muted">
            <span>Định khoản gợi ý:</span>
            <StatusBadge tone="neutral" size="sm">
              Nợ {MUC_DICH_XUAT[mucDich].no}
            </StatusBadge>
            <StatusBadge tone="neutral" size="sm">
              Có {MUC_DICH_XUAT[mucDich].co}
            </StatusBadge>
          </div>

          {lines.length > 0 && (
            <DataView
              mobileMode="scroll"
              desktop={
                <div className="table-wrap">
                  <table className="dt">
                    <thead>
                      <tr>
                        <th>Mặt hàng</th>
                        <th>Kho</th>
                        <th>ĐVT</th>
                        <th className="ui-text-right">Khả dụng</th>
                        <th className="ui-text-right">SL xuất</th>
                        <th className="ui-text-right">Giá bán</th>
                        <th className="ui-text-right">Thành tiền</th>
                        <th className="ui-col-chk"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, idx) => (
                        <tr key={`${l.item_id}-${l.warehouse_id}`}>
                          <td>{l.label}</td>
                          <td>
                            <StatusBadge tone="neutral" size="sm">
                              {l.warehouse_code}
                            </StatusBadge>
                          </td>
                          <td className="muted">{l.dvt}</td>
                          <td className="ui-text-right num">{l.kha_dung}</td>
                          <td className="ui-text-right">
                            <input
                              className="ui-input ui-input-qty"
                              type="number"
                              min={0}
                              max={l.kha_dung}
                              value={l.so_luong}
                              onChange={(e) => {
                                const v = Number(e.target.value) || 0;
                                setLines(lines.map((x, i) => (i === idx ? { ...x, so_luong: v } : x)));
                              }}
                            />
                            {l.so_luong > l.kha_dung && (
                              <div>
                                <StatusBadge tone="danger" size="sm">
                                  vượt khả dụng
                                </StatusBadge>
                              </div>
                            )}
                          </td>
                          <td className="ui-text-right">
                            <input
                              className="ui-input ui-input-price"
                              type="number"
                              min={0}
                              value={l.don_gia_ban}
                              onChange={(e) => {
                                const v = Number(e.target.value) || 0;
                                setLines(
                                  lines.map((x, i) => (i === idx ? { ...x, don_gia_ban: v } : x)),
                                );
                              }}
                            />
                          </td>
                          <td className="ui-text-right muted num">
                            {vnd(l.so_luong * l.don_gia_ban)}
                          </td>
                          <td>
                            <AppButton
                              variant="ghost"
                              size="sm"
                              iconOnly
                              leftIcon="x"
                              aria-label="Bỏ dòng hàng"
                              onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              }
            />
          )}

          <div className="ui-stack--sm">
            <input
              className="ui-input"
              placeholder="Tìm hàng khả dụng theo mã hoặc tên để thêm vào phiếu…"
              value={pickQ}
              onChange={(e) => setPickQ(e.target.value)}
            />
            <DataView
              mobileMode="scroll"
              desktop={
                <div className="table-wrap ui-scroll-sm">
                  <table className="dt">
                    <tbody>
                      {pickable.slice(0, 30).map((r) => (
                        <tr
                          key={`${r.item_id}-${r.warehouse_id}`}
                          className="ui-clickable"
                          onClick={() => addLine(r)}
                        >
                          <td className="ui-nowrap ui-text-strong">{r.ma_hang}</td>
                          <td>{r.ten}</td>
                          <td>
                            <StatusBadge tone="neutral" size="sm">
                              {r.warehouse_code}
                            </StatusBadge>
                          </td>
                          <td className="ui-text-right num">
                            khả dụng <b>{r.kha_dung}</b> {r.dvt}
                          </td>
                          <td className="ui-text-right muted num">
                            BQ {vnd(r.don_gia_bq)} đ
                          </td>
                        </tr>
                      ))}
                      {pickable.length === 0 && (
                        <tr>
                          <td className="muted">Không có hàng khả dụng tại ngày {ngay}.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              }
            />
          </div>
        </div>
      </AppModal>

      <AppModal
        open={!!view}
        onClose={closeView}
        size="lg"
        title={
          view ? (
            <span className="ui-inline ui-inline--md ui-inline--wrap">
              <span>Phiếu xuất {view.so_ct || `PX#${view.id}`}</span>
              <StatusBadge
                tone={(STATUS_META[view.status] ?? { tone: "neutral" as const }).tone}
                size="sm"
                dot
              >
                {(STATUS_META[view.status] ?? { label: view.status }).label}
              </StatusBadge>
            </span>
          ) : (
            "Chi tiết phiếu xuất"
          )
        }
        footer={
          view ? (
            <>
              <AppButton variant="secondary" onClick={closeView}>
                Đóng
              </AppButton>
              {view.status === "draft" && (
                <>
                  <AppButton
                    variant="secondary"
                    leftIcon="save"
                    disabled={viewBusy}
                    onClick={doViewSave}
                  >
                    Lưu
                  </AppButton>
                  <AppButton
                    variant="primary"
                    leftIcon="check-circle"
                    loading={viewBusy}
                    title={
                      view.lines.some((l) => l.so_luong > khaDungFor(l.item_id, l.warehouse_id))
                        ? "Có dòng vượt khả dụng — nếu ghi sổ sẽ hỏi lý do duyệt âm kho"
                        : ""
                    }
                    onClick={doViewPost}
                  >
                    Ghi sổ lại
                  </AppButton>
                </>
              )}
            </>
          ) : undefined
        }
      >
        {view && (
          <div className="ui-stack">
            <div className="ui-row ui-muted">
              <span>
                Mục đích: <b>{MUC_DICH_XUAT[view.muc_dich]?.label ?? view.muc_dich}</b>
              </span>
              <StatusBadge tone="neutral" size="sm">
                Nợ {view.tk_no}
              </StatusBadge>
              <StatusBadge tone="neutral" size="sm">
                Có {view.tk_co}
              </StatusBadge>
              {view.nguoi_nhan && <span>Người nhận: {view.nguoi_nhan}</span>}
              {view.bo_phan && <span>Bộ phận: {view.bo_phan}</span>}
              {view.ly_do && <span>Lý do: {view.ly_do}</span>}
            </div>

            {err && <InlineAlert tone="danger">{err}</InlineAlert>}

            {view.status === "posted" && (
              <InlineAlert
                tone="warning"
                title="Phiếu xuất đã ghi sổ"
                action={
                  <AppButton
                    variant="danger"
                    size="sm"
                    leftIcon="rotate-ccw"
                    loading={viewBusy}
                    onClick={viewVoid}
                  >
                    Hủy ghi sổ để sửa
                  </AppButton>
                }
              >
                Số lượng đang bị khóa. Bấm <b>Hủy ghi sổ để sửa</b> để điều chỉnh lại phiếu xuất.
              </InlineAlert>
            )}

            <FormGrid cols={2}>
              <FormField label="Ngày chứng từ" htmlFor={viewDateId}>
                <input
                  id={viewDateId}
                  className="ui-input"
                  type="date"
                  value={view.ngay}
                  disabled={view.status !== "draft"}
                  onChange={(e) => setView({ ...view, ngay: e.target.value })}
                />
              </FormField>
              <FormField label="Ghi chú" htmlFor={viewNoteId}>
                <input
                  id={viewNoteId}
                  className="ui-input"
                  value={view.note}
                  disabled={view.status !== "draft"}
                  onChange={(e) => setView({ ...view, note: e.target.value })}
                />
              </FormField>
            </FormGrid>

            <DataView
              mobileMode="scroll"
              desktop={
                <div className="table-wrap">
                  <table className="dt">
                    <thead>
                      <tr>
                        <th>Mặt hàng</th>
                        <th className="ui-text-right">SL</th>
                        <th className="ui-text-right">Giá bán</th>
                        <th className="ui-text-right">Thành tiền</th>
                        <th className="ui-text-right">Giá vốn</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.lines.map((l) => {
                        const kd =
                          view.status === "draft" ? khaDungFor(l.item_id, l.warehouse_id) : null;
                        const isOver = kd !== null && l.so_luong > kd;
                        return (
                          <tr key={l.id} className={isOver ? "row-treo" : ""}>
                            <td>
                              {lineCode(l)} · {lineName(l)}
                            </td>
                            <td className="ui-text-right num">
                              {view.status === "draft" ? (
                                <>
                                  <input
                                    className="ui-input ui-input-qty"
                                    type="number"
                                    value={l.so_luong}
                                    onChange={(e) =>
                                      patchViewLine(l.id, { so_luong: Number(e.target.value) || 0 })
                                    }
                                  />
                                  <div className="ui-muted">
                                    khả dụng {kd}
                                    {isOver && (
                                      <StatusBadge
                                        tone="danger"
                                        size="sm"
                                        className="ui-ml-sm"
                                      >
                                        vượt
                                      </StatusBadge>
                                    )}
                                  </div>
                                </>
                              ) : (
                                l.so_luong
                              )}
                            </td>
                            <td className="ui-text-right num">
                              {view.status === "draft" ? (
                                <input
                                  className="ui-input ui-input-price"
                                  type="number"
                                  value={l.don_gia_ban}
                                  onChange={(e) =>
                                    patchViewLine(l.id, {
                                      don_gia_ban: Number(e.target.value) || 0,
                                    })
                                  }
                                />
                              ) : (
                                vnd(l.don_gia_ban)
                              )}
                            </td>
                            <td className="ui-text-right muted num">
                              {vnd(l.so_luong * l.don_gia_ban)}
                            </td>
                            <td className="ui-text-right muted num">
                              {view.status === "posted" ? vnd(l.gia_von) : `~${vnd(l.gia_von_uoc)}`}
                              {l.don_gia_von_uoc > 0 && (
                                <div className="ui-muted">
                                  {view.status === "posted" && l.so_luong
                                    ? vnd(l.gia_von / l.so_luong)
                                    : `~${vnd(l.don_gia_von_uoc)}`}
                                  /đv
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={3} className="ui-text-right">
                          <b>Cộng</b>
                        </td>
                        <td className="ui-text-right num">
                          <b>{vnd(view.lines.reduce((s, l) => s + l.so_luong * l.don_gia_ban, 0))}</b>
                        </td>
                        <td className="ui-text-right num">
                          <b>
                            {view.status === "posted"
                              ? vnd(view.lines.reduce((s, l) => s + l.gia_von, 0))
                              : `~${vnd(view.lines.reduce((s, l) => s + l.gia_von_uoc, 0))}`}
                          </b>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              }
            />

            {(() => {
              const posted = view.status === "posted";
              const tongBan = view.lines.reduce((s, l) => s + l.so_luong * l.don_gia_ban, 0);
              const tongVon = posted
                ? view.lines.reduce((s, l) => s + l.gia_von, 0)
                : view.lines.reduce((s, l) => s + l.gia_von_uoc, 0);
              const slTP = view.lines
                .filter((l) => l.warehouse_code === "TP")
                .reduce((s, l) => s + l.so_luong, 0);
              const nhanCong = NHAN_CONG_PER_SP * slTP;
              const lnChuaNc = tongBan - tongVon;
              const lnGomNc = lnChuaNc - nhanCong;
              const p = posted ? "" : "~";
              if (tongBan <= 0) {
                return (
                  <p className="ui-muted">
                    Nhập <b>giá bán</b> cho các dòng để xem lợi nhuận tạm tính.
                  </p>
                );
              }
              if (nhanCong <= 0) {
                return (
                  <InlineAlert tone={lnChuaNc < 0 ? "danger" : "info"}>
                    <div className="ui-stack--xs ui-w-full">
                      <div className="ui-row-between">
                        <span>Lợi nhuận tạm tính (thương mại — không tính nhân công):</span>
                        {lnChuaNc < 0 ? (
                          <StatusBadge tone="danger" size="sm">
                            {p}
                            {vnd(lnChuaNc)} đ ({((lnChuaNc / tongBan) * 100).toFixed(1)}%)
                          </StatusBadge>
                        ) : (
                          <b className="num">
                            {p}
                            {vnd(lnChuaNc)} đ ({((lnChuaNc / tongBan) * 100).toFixed(1)}%)
                          </b>
                        )}
                      </div>
                      <div className="ui-muted">
                        Giá vốn {posted ? "theo sổ kho" : "ước tính theo giá BQ hiện tại"}. Hàng mua
                        đi bán lại xuất thẳng — nhân công chỉ tính khi xuất thành phẩm sản xuất (kho
                        TP).
                      </div>
                    </div>
                  </InlineAlert>
                );
              }
              return (
                <InlineAlert tone={lnGomNc < 0 ? "danger" : "warning"}>
                  <div className="ui-stack--xs ui-w-full">
                    <div className="ui-row-between">
                      <span>Lợi nhuận tạm tính (chưa gồm nhân công):</span>
                      {lnChuaNc < 0 ? (
                        <StatusBadge tone="danger" size="sm">
                          {p}
                          {vnd(lnChuaNc)} đ ({((lnChuaNc / tongBan) * 100).toFixed(1)}%)
                        </StatusBadge>
                      ) : (
                        <b className="num">
                          {p}
                          {vnd(lnChuaNc)} đ ({((lnChuaNc / tongBan) * 100).toFixed(1)}%)
                        </b>
                      )}
                    </div>
                    <div className="ui-row-between">
                      <span>
                        Nhân công tạm tính ({vnd(NHAN_CONG_PER_SP)} đ × {slTP} thành phẩm SX):
                      </span>
                      <b className="num">{vnd(nhanCong)} đ</b>
                    </div>
                    <div className="ui-row-between">
                      <span>Lợi nhuận tạm tính (đã gồm nhân công):</span>
                      {lnGomNc < 0 ? (
                        <StatusBadge tone="danger" size="sm">
                          {p}
                          {vnd(lnGomNc)} đ ({((lnGomNc / tongBan) * 100).toFixed(1)}%)
                        </StatusBadge>
                      ) : (
                        <b className="num">
                          {p}
                          {vnd(lnGomNc)} đ ({((lnGomNc / tongBan) * 100).toFixed(1)}%)
                        </b>
                      )}
                    </div>
                    <div className="ui-muted">
                      Giá vốn {posted ? "theo sổ kho" : "ước tính theo giá BQ hiện tại"}; nhân công
                      ước lượng {vnd(NHAN_CONG_PER_SP)} đ/thành phẩm SX (chỉ tính dòng xuất từ kho
                      TP).
                    </div>
                  </div>
                </InlineAlert>
              );
            })()}
          </div>
        )}
      </AppModal>

      {negModal && (
        <NegStockModal
          violations={negModal.violations}
          busy={viewBusy}
          onConfirm={confirmNegPost}
          onCancel={() => setNegModal(null)}
        />
      )}
    </PageShell>
  );
}
