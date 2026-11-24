import { useEffect, useRef, useState } from "react";
import {
  api,
  CustomsParseInfo,
  InvCustomsCost,
  InvCustomsDecl,
  InvCustomsLine,
  InvItem,
  InvWarehouse,
} from "../api";
import { DateFilter, DateRange } from "../components/DateFilter";
import { CustomsDriveDossiers } from "../components/CustomsDriveDossiers";
import { CustomsCheckManager } from "../components/CustomsCheckManager";
import {
  AppButton,
  AppIcon,
  AppModal,
  DataView,
  EmptyState,
  FilterBar,
  FormGrid,
  InlineAlert,
  MobileCard,
  MobileCardActions,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  PageHeader,
  PageShell,
  PromptDialog,
  ResponsiveTabs,
  StatusBadge,
  TableSkeleton,
  useConfirm,
  useToast,
  type IconName,
  type StatusBadgeTone,
} from "../components/ui";
import { openExternalSafe } from "../utils/url";
import { getParam, setParam } from "../util";

function vnd(n: number): string {
  return Math.round(n).toLocaleString("vi-VN");
}

function fmtCur(n: number): string {
  return n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}

// Doc so kieu VN: '652.777,77' (phay=thap phan), '1.500.000', '652,777.77'
function vnNum(s: string): number {
  const t = (s || "").trim().replace(/\s/g, "");
  if (!t) return 0;
  let x = t;
  const hasDot = x.includes(".");
  const hasComma = x.includes(",");
  if (hasDot && hasComma) {
    x =
      x.lastIndexOf(",") > x.lastIndexOf(".")
        ? x.replace(/\./g, "").replace(",", ".")
        : x.replace(/,/g, "");
  } else if (hasComma) {
    const p = x.split(",");
    x = p.length === 2 ? x.replace(",", ".") : x.replace(/,/g, "");
  } else if (hasDot) {
    const p = x.split(".");
    if (p.length > 2 || (p.length === 2 && p[1].length === 3)) x = x.replace(/\./g, "");
  }
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

const STATUS_META: Record<string, [StatusBadgeTone, string]> = {
  draft: ["warning", "Nháp"],
  posted: ["success", "Đã ghi sổ"],
  void: ["neutral", "Đã hủy"],
};

const LOAI_HINH_META: Record<string, [StatusBadgeTone, string]> = {
  A11: ["info", "A11 · KD"],
  A12: ["brand", "A12 · SX"],
};

function loaiHinhMeta(code: string): [StatusBadgeTone, string] {
  return LOAI_HINH_META[code] ?? ["neutral", code || "—"];
}

function phanLuongMeta(pl: string): [StatusBadgeTone, string] {
  if (pl === "1") return ["success", "Xanh"];
  if (pl === "2") return ["warning", "Vàng"];
  if (pl === "3") return ["danger", "Đỏ"];
  return ["neutral", pl || "—"];
}

const COST_LOAI_LABEL: Record<string, string> = {
  le_phi_hq: "Lệ phí HQ",
  phi_ngan_hang: "Phí ngân hàng",
  phi_ship: "Phí vận chuyển",
  phi_khac: "Phí khác",
};

function matchMeta(kind: string): [StatusBadgeTone, IconName, string] {
  if (kind === "exact") return ["success", "check", "khớp"];
  if (kind === "fuzzy") return ["warning", "sparkles", "gợi ý"];
  if (kind === "learned") return ["brand", "cpu", "đã học"];
  return ["info", "check", "đã chọn"];
}

function parseInfoMsg(p: CustomsParseInfo): string {
  if (p.kind === "giay_nop_tien") {
    const added = p.khoan_nop.filter((k) => k.phan_loai !== "vat").length;
    const vatSum = p.vat_paid.reduce((s, k) => s + k.so_tien, 0);
    return (
      `Đã khớp tờ khai, thêm ${added} khoản lệ phí` +
      (vatSum > 0 ? `; VAT ${vnd(vatSum)}đ đã nộp (không tính vào giá vốn)` : "")
    );
  }
  const mt = p.mt103;
  return `Đã nhận chứng từ thanh toán ${mt.nguyen_te} ${fmtCur(mt.so_tien_nt)} — nhập số PHÍ ngân hàng thực tế vào dòng phí vừa tạo`;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="ui-meta-label">{label}</div>
      <div className="ui-meta-value">{value || "—"}</div>
    </div>
  );
}

type CustomsTab = "all" | "declarations" | "dossiers" | "monitor";

export function CustomsDecl() {
  const toast = useToast();
  const askConfirm = useConfirm();

  const [activeTab, setActiveTab] = useState<CustomsTab>("all");
  const [list, setList] = useState<InvCustomsDecl[]>([]);
  const [statusF, setStatusF] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>({ tu: "", den: "" });
  const [cur, setCur] = useState<InvCustomsDecl | null>(null);
  const [whs, setWhs] = useState<InvWarehouse[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<Array<{ ok: boolean; text: string }>>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);
  const [attachBusy, setAttachBusy] = useState(false);
  const [parseInfo, setParseInfo] = useState<CustomsParseInfo | null>(null);
  const [itemQuery, setItemQuery] = useState<{ line: number; q: string; results: InvItem[] } | null>(null);
  const [listLoaded, setListLoaded] = useState(false);
  const autoTkRef = useRef(false);

  async function load() {
    try {
      const data = await api.invCustomsList({ statusF, tu: dateRange.tu, den: dateRange.den });
      setList(Array.isArray(data) ? data : []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setListLoaded(true);
    }
  }

  useEffect(() => {
    api
      .invWarehouses()
      .then((rows) => setWhs(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusF, dateRange.tu, dateRange.den]);

  // F5 giu context: sau khi list load lan dau, tu mo lai modal chi tiet theo ?tk=
  useEffect(() => {
    if (!listLoaded || autoTkRef.current) return;
    autoTkRef.current = true;
    const tk = getParam("tk");
    if (tk) open(Number(tk));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listLoaded]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setErr("");
    try {
      const r = await api.invCustomsUpload(Array.from(files));
      const items = r.results.map((x) =>
        x.ok
          ? { ok: true, text: `${x.filename}: đã tạo bản nháp #${x.customs_id} (${x.so_to_khai})` }
          : { ok: false, text: `${x.filename}: ${x.error}` },
      );
      setUploadMsg(items);
      const okCount = items.filter((x) => x.ok).length;
      if (okCount > 0) toast.success(`Đã nạp ${okCount} tờ khai nhập khẩu.`);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function open(id: number) {
    try {
      setCur(await api.invCustomsGet(id));
      setItemQuery(null);
      setParseInfo(null);
      setParam("tk", String(id));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function closeCur() {
    setCur(null);
    setParseInfo(null);
    setParam("tk", null);
  }

  async function delOne(id: number) {
    const ok = await askConfirm({
      title: "Xóa bản nháp tờ khai",
      message: "Xác nhận xóa bản nháp tờ khai này?",
      confirmLabel: "Xóa bản nháp",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setErr("");
    try {
      await api.invCustomsDelete(id);
      toast.success("Đã xóa bản nháp tờ khai.");
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function setLine(idx: number, patch: Partial<InvCustomsLine>) {
    if (!cur) return;
    setCur({ ...cur, lines: cur.lines.map((ln, i) => (i === idx ? { ...ln, ...patch } : ln)) });
  }

  function setCost(idx: number, patch: Partial<InvCustomsCost>) {
    if (!cur) return;
    setCur({ ...cur, costs: cur.costs.map((c, i) => (i === idx ? { ...c, ...patch } : c)) });
  }

  function addCostRow() {
    if (!cur) return;
    setCur({
      ...cur,
      costs: [...cur.costs, { id: -Date.now(), loai: "phi_khac", ten: "", so_tien: 0, ghi_chu: "", doc_url: "" }],
    });
  }

  function removeCost(idx: number) {
    if (!cur) return;
    setCur({ ...cur, costs: cur.costs.filter((_, i) => i !== idx) });
  }

  async function saveDraft(): Promise<InvCustomsDecl | null> {
    if (!cur) return null;
    try {
      const saved = await api.invCustomsSave(cur.id, {
        note: cur.note,
        lines: cur.lines.map((ln) => ({
          id: ln.id,
          item_id: ln.item_id,
          warehouse_id: ln.warehouse_id,
          so_luong: ln.so_luong,
        })),
        costs: cur.costs
          .filter((c) => !c.doc_url)
          .map((c) => ({ loai: c.loai, ten: c.ten, so_tien: c.so_tien, ghi_chu: c.ghi_chu })),
      });
      setCur(saved);
      toast.success("Đã lưu bản nháp tờ khai.");
      return saved;
    } catch (e) {
      setErr((e as Error).message);
      return null;
    }
  }

  async function postCur() {
    const saved = await saveDraft();
    if (!saved) return;
    try {
      setCur(await api.invCustomsPost(saved.id));
      toast.success("Đã ghi sổ tờ khai nhập khẩu.");
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function voidCur() {
    if (!cur) return;
    const ok = await askConfirm({
      title: "Hủy ghi sổ tờ khai",
      message: "Hủy ghi sổ tờ khai này để sửa? Tồn kho sẽ được tính lại.",
      confirmLabel: "Hủy ghi sổ",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setErr("");
    try {
      setCur(await api.invCustomsVoid(cur.id));
      toast.info("Đã hủy ghi sổ tờ khai — bạn có thể chỉnh sửa và ghi sổ lại.");
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteCur() {
    if (!cur) return;
    const ok = await askConfirm({
      title: "Xóa bản nháp tờ khai",
      message: "Xác nhận xóa bản nháp tờ khai này?",
      confirmLabel: "Xóa nháp",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.invCustomsDelete(cur.id);
      closeCur();
      toast.success("Đã xóa bản nháp tờ khai.");
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function attach(files: FileList | null) {
    if (!files || files.length === 0 || !cur) return;
    setAttachBusy(true);
    setErr("");
    setParseInfo(null);
    try {
      const r = await api.invCustomsAttach(cur.id, files[0]);
      setCur(r.decl);
      setParseInfo(r.parse_info);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAttachBusy(false);
      if (attachRef.current) attachRef.current.value = "";
    }
  }

  const [createItemPrompt, setCreateItemPrompt] = useState<{ idx: number; label: string; suggested: string } | null>(
    null,
  );

  async function createItemFromLine(idx: number) {
    if (!cur) return;
    const ln = cur.lines[idx];
    let suggested = "";
    try {
      suggested = (await api.invSuggestItemCode()).code;
    } catch {
      /* ignore */
    }
    setCreateItemPrompt({ idx, label: ln.mo_ta, suggested });
  }

  async function confirmCreateItem(ma: string) {
    if (!createItemPrompt || !cur) return;
    const { idx } = createItemPrompt;
    const ln = cur.lines[idx];
    setCreateItemPrompt(null);
    if (!ma.trim() || !ln) return;
    try {
      const it = await api.invCreateItem({ ma_hang: ma.trim(), ten: ln.mo_ta, dvt: ln.dvt });
      setLine(idx, { item_id: it.id, item_ma_hang: it.ma_hang, item_ten: it.ten, match_kind: "new" });
      toast.success(`Đã tạo mã hàng mới ${it.ma_hang}.`);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function searchItems(idx: number, q: string) {
    setItemQuery({ line: idx, q, results: itemQuery?.results ?? [] });
    if (q.trim().length >= 2) {
      try {
        const results = await api.invItems(q);
        setItemQuery((prev) => (prev && prev.line === idx ? { ...prev, results } : prev));
      } catch {
        /* ignore */
      }
    }
  }

  const unmatched = cur ? cur.lines.filter((ln) => !ln.item_id).length : 0;
  const tongGiaVon = cur ? cur.tri_gia_tinh_thue + cur.tong_thue_nk + cur.tong_costs : 0;
  const activeFilterCount = (statusF ? 1 : 0) + (dateRange.tu || dateRange.den ? 1 : 0);

  return (
    <PageShell data-page="customs">
      <PageHeader
        variant="compact"
        icon="globe"
        title="Tờ khai nhập khẩu"
        subtitle="Quản lý tờ khai hải quan nhập khẩu, bộ hồ sơ Drive và theo dõi phân luồng tự động."
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              multiple
              className="ui-hidden"
              onChange={(e) => upload(e.target.files)}
            />
            <AppButton
              variant="primary"
              leftIcon="upload"
              loading={busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? "Đang xử lý…" : "Tải tờ khai (Excel)"}
            </AppButton>
          </>
        }
      />

      <ResponsiveTabs<CustomsTab>
        variant="segmented"
        active={activeTab}
        onChange={setActiveTab}
        ariaLabel="Phân khu tờ khai nhập khẩu"
        tabs={[
          { id: "all", label: "Tổng hợp", icon: "layers" },
          { id: "declarations", label: "Tờ khai nhập khẩu", icon: "file-text", badge: list.length },
          { id: "dossiers", label: "Bộ hồ sơ Drive", icon: "folder-open" },
          { id: "monitor", label: "Theo dõi Vàng/Đỏ", icon: "clock" },
        ]}
      />

      {(activeTab === "all" || activeTab === "declarations") && (
        <div className="ui-stack">
          <FilterBar
              collapsibleMobile
              activeCount={activeFilterCount}
              onReset={() => {
                setStatusF("");
                setDateRange({ tu: "", den: "" });
              }}
              filters={
                <>
                  <select
                    aria-label="Trạng thái tờ khai"
                    className="ui-select"
                    value={statusF}
                    onChange={(e) => setStatusF(e.target.value)}
                  >
                    <option value="">Tất cả trạng thái</option>
                    <option value="draft">Nháp</option>
                    <option value="posted">Đã ghi sổ</option>
                  </select>
                  <DateFilter value={dateRange} onChange={setDateRange} />
                </>
              }
            />

            {err && (
              <InlineAlert tone="danger" onDismiss={() => setErr("")}>
                {err}
              </InlineAlert>
            )}

            {uploadMsg.length > 0 && (
              <InlineAlert tone="info" title="Kết quả tải tờ khai" onDismiss={() => setUploadMsg([])}>
                <div className="ui-stack--xs">
                  {uploadMsg.map((m, i) => (
                    <div key={i} className="ui-row">
                      <AppIcon name={m.ok ? "check-circle" : "alert-circle"} size={14} />
                      <span>{m.text}</span>
                    </div>
                  ))}
                </div>
              </InlineAlert>
            )}

            {!listLoaded ? (
              <TableSkeleton rows={5} cols={9} />
            ) : (
              <DataView
                mobileMode="card"
                empty={
                  list.length === 0 ? (
                    <EmptyState
                      compact
                      icon="globe"
                      title="Chưa có tờ khai nhập khẩu nào"
                      description='Bấm "Tải tờ khai (Excel)" để bắt đầu nhập dữ liệu.'
                      action={
                        <AppButton
                          variant="primary"
                          size="sm"
                          leftIcon="upload"
                          onClick={() => fileRef.current?.click()}
                        >
                          Tải tờ khai (Excel)
                        </AppButton>
                      }
                    />
                  ) : undefined
                }
                desktop={
                  <div className="ui-table-scroll-wrap" tabIndex={0}>
                    <table className="ui-table">
                      <thead>
                        <tr>
                          <th>Số TK</th>
                          <th>Ngày ĐK</th>
                          <th>Loại hình</th>
                          <th>Phân luồng</th>
                          <th>Người XK</th>
                          <th className="num">Trị giá</th>
                          <th className="num">Thuế NK</th>
                          <th className="num">VAT</th>
                          <th>Trạng thái</th>
                          <th className="ui-col-chk"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((d) => {
                          const [lhTone, lhLabel] = loaiHinhMeta(d.ma_loai_hinh);
                          const [plTone, plLabel] = phanLuongMeta(d.phan_luong);
                          const [stTone, stLabel] = STATUS_META[d.status] ?? ["neutral", d.status];
                          return (
                            <tr key={d.id} className="ui-clickable" onClick={() => open(d.id)}>
                              <td className="num">
                                <strong>{d.so_to_khai}</strong>
                              </td>
                              <td className="nowrap">{d.ngay_dang_ky}</td>
                              <td>
                                <StatusBadge tone={lhTone} size="sm">
                                  {lhLabel}
                                </StatusBadge>
                              </td>
                              <td>
                                <StatusBadge tone={plTone} size="sm" dot>
                                  {plLabel}
                                </StatusBadge>
                              </td>
                              <td>
                                {d.nguoi_xk}
                                {d.nuoc_xk ? ` (${d.nuoc_xk})` : ""}
                              </td>
                              <td className="num">
                                <div>
                                  {fmtCur(d.tri_gia_nt)} {d.nguyen_te}
                                </div>
                                <div className="muted">{vnd(d.tri_gia_tinh_thue)}đ</div>
                              </td>
                              <td className="num">{vnd(d.tong_thue_nk)}đ</td>
                              <td className="num">{vnd(d.tong_thue_vat)}đ</td>
                              <td>
                                <StatusBadge tone={stTone} size="sm">
                                  {stLabel}
                                </StatusBadge>
                              </td>
                              <td onClick={(e) => e.stopPropagation()}>
                                {d.status === "draft" && (
                                  <AppButton
                                    variant="ghost"
                                    size="sm"
                                    iconOnly
                                    leftIcon="trash"
                                    aria-label={`Xóa tờ khai ${d.so_to_khai}`}
                                    title="Xóa bản nháp"
                                    onClick={() => delOne(d.id)}
                                  />
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
                    {list.map((d) => {
                      const [lhTone, lhLabel] = loaiHinhMeta(d.ma_loai_hinh);
                      const [plTone, plLabel] = phanLuongMeta(d.phan_luong);
                      const [stTone, stLabel] = STATUS_META[d.status] ?? ["neutral", d.status];
                      return (
                        <MobileCard key={d.id}>
                          <MobileCardHeader
                            title={d.so_to_khai}
                            subtitle={`${d.ngay_dang_ky}${d.nguoi_xk ? ` · ${d.nguoi_xk}` : ""}${d.nuoc_xk ? ` (${d.nuoc_xk})` : ""}`}
                            badge={
                              <StatusBadge tone={stTone} size="sm">
                                {stLabel}
                              </StatusBadge>
                            }
                          />
                          <div className="ui-row">
                            <StatusBadge tone={lhTone} size="sm">
                              {lhLabel}
                            </StatusBadge>
                            <StatusBadge tone={plTone} size="sm" dot>
                              {plLabel}
                            </StatusBadge>
                          </div>
                          <MobileCardGrid>
                            <MobileCardRow label="Trị giá tính thuế" value={`${vnd(d.tri_gia_tinh_thue)}đ`} mono />
                            <MobileCardRow label="VAT" value={`${vnd(d.tong_thue_vat)}đ`} mono />
                          </MobileCardGrid>
                          <div onClick={(e) => e.stopPropagation()}>
                            <MobileCardActions>
                              <AppButton variant="secondary" size="sm" leftIcon="eye" onClick={() => open(d.id)}>
                                Mở tờ khai
                              </AppButton>
                              {d.status === "draft" && (
                                <AppButton
                                  variant="ghost"
                                  size="sm"
                                  iconOnly
                                  leftIcon="trash"
                                  aria-label={`Xóa tờ khai ${d.so_to_khai}`}
                                  onClick={() => delOne(d.id)}
                                />
                              )}
                            </MobileCardActions>
                          </div>
                        </MobileCard>
                      );
                    })}
                  </div>
                }
              />
            )}
        </div>
      )}

      {(activeTab === "all" || activeTab === "dossiers") && <CustomsDriveDossiers />}

      {(activeTab === "all" || activeTab === "monitor") && <CustomsCheckManager />}

      <AppModal
        open={!!cur}
        onClose={closeCur}
        size="full"
        title={
          cur ? (
            <span className="ui-row">
              <span>Tờ khai {cur.so_to_khai}</span>
              <StatusBadge tone={loaiHinhMeta(cur.ma_loai_hinh)[0]} size="sm">
                {loaiHinhMeta(cur.ma_loai_hinh)[1]}
              </StatusBadge>
              <StatusBadge tone={phanLuongMeta(cur.phan_luong)[0]} size="sm" dot>
                {phanLuongMeta(cur.phan_luong)[1]}
              </StatusBadge>
              <StatusBadge tone={(STATUS_META[cur.status] ?? ["neutral", cur.status])[0]} size="sm">
                {(STATUS_META[cur.status] ?? ["neutral", cur.status])[1]}
              </StatusBadge>
            </span>
          ) : (
            "Chi tiết tờ khai"
          )
        }
        footer={
          cur ? (
            <>
              {cur.status === "draft" && (
                <>
                  <AppButton variant="danger" size="sm" leftIcon="trash" onClick={deleteCur}>
                    Xóa nháp
                  </AppButton>
                  <AppButton variant="secondary" leftIcon="save" onClick={saveDraft}>
                    Lưu
                  </AppButton>
                  <AppButton
                    variant="primary"
                    leftIcon="check-circle"
                    disabled={unmatched > 0}
                    title={unmatched > 0 ? `Còn ${unmatched} dòng chưa khớp mặt hàng` : ""}
                    onClick={postCur}
                  >
                    Ghi sổ
                  </AppButton>
                </>
              )}
              {cur.status === "posted" && (
                <AppButton variant="danger" leftIcon="rotate-ccw" disabled={busy} onClick={voidCur}>
                  Hủy ghi sổ
                </AppButton>
              )}
              <AppButton variant="secondary" onClick={closeCur}>
                Đóng
              </AppButton>
            </>
          ) : undefined
        }
      >
        {cur && (
          <div className="ui-stack">
            {cur.doc_url && (
              <div>
                <AppButton
                  variant="secondary"
                  size="sm"
                  leftIcon="file-text"
                  onClick={() => openExternalSafe(cur.doc_url)}
                >
                  File tờ khai gốc
                </AppButton>
              </div>
            )}

            {cur.status === "posted" && (
              <InlineAlert
                tone="warning"
                title="Tờ khai đã ghi sổ"
                action={
                  <AppButton variant="danger" size="sm" leftIcon="rotate-ccw" disabled={busy} onClick={voidCur}>
                    Hủy ghi sổ để sửa
                  </AppButton>
                }
              >
                Các ô đang bị khóa. Muốn sửa lại, bấm <b>Hủy ghi sổ</b>, chỉnh sửa rồi Ghi sổ lại (tồn kho tự tính lại).
              </InlineAlert>
            )}

            <FormGrid cols={4} className="ui-subpanel ui-subpanel--md">
              <Info label="Ngày đăng ký" value={cur.ngay_dang_ky} />
              <Info label="Cơ quan HQ" value={cur.co_quan_hq} />
              <Info label="Người XK" value={cur.nguoi_xk + (cur.nuoc_xk ? ` (${cur.nuoc_xk})` : "")} />
              <Info label="Số vận đơn" value={cur.so_van_don} />
              <Info label="Số HĐ" value={cur.so_hoa_don + (cur.ngay_hoa_don ? ` · ${cur.ngay_hoa_don}` : "")} />
              <Info label="PTTT" value={cur.phuong_thuc_tt} />
              <Info label="Incoterm" value={cur.incoterm} />
              <Info label="Nguyên tệ" value={cur.nguyen_te} />
              <Info label="Trị giá NT" value={`${fmtCur(cur.tri_gia_nt)} ${cur.nguyen_te}`} />
              <Info label="Phí ship NT" value={`${fmtCur(cur.phi_ship_nt)} ${cur.nguyen_te}`} />
              <Info label="Tỉ giá" value={fmtCur(cur.ti_gia)} />
              <Info label="Trị giá tính thuế" value={`${vnd(cur.tri_gia_tinh_thue)}đ`} />
            </FormGrid>

            <DataView
              mobileMode="scroll"
              desktop={
                <div className="ui-table-scroll-wrap ui-scroll-md" tabIndex={0}>
                  <table className="ui-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Mã HS</th>
                        <th>Mô tả</th>
                        <th>SL</th>
                        <th className="num">Trị giá tính thuế</th>
                        <th className="num">Thuế NK</th>
                        <th className="num">VAT</th>
                        <th>Kho</th>
                        <th className="ui-col-wide ui-wrap">Mặt hàng tồn kho</th>
                        <th className="num">Giá vốn</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cur.lines.map((ln, idx) => {
                        const [mTone, mIcon, mLabel] = matchMeta(ln.match_kind);
                        return (
                          <tr key={ln.id}>
                            <td className="muted">{ln.stt}</td>
                            <td>{ln.ma_hs}</td>
                            <td>{ln.mo_ta}</td>
                            <td className="nowrap">
                              {ln.so_luong} {ln.dvt}
                            </td>
                            <td className="num">{vnd(ln.tri_gia_tinh_thue)}đ</td>
                            <td className="num">
                              {ln.thue_suat_nk}% · {vnd(ln.tien_thue_nk)}đ
                            </td>
                            <td className="num">
                              {ln.thue_suat_vat}% · {vnd(ln.tien_thue_vat)}đ
                            </td>
                            <td>
                              <select
                                className="ui-select"
                                value={ln.warehouse_id ?? ""}
                                disabled={cur.status !== "draft"}
                                onChange={(e) => setLine(idx, { warehouse_id: Number(e.target.value) || null })}
                              >
                                <option value="">—</option>
                                {whs.map((w) => (
                                  <option key={w.id} value={w.id}>
                                    {w.code}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="ui-col-wide ui-wrap">
                              {ln.item_id ? (
                                <span className="ui-row">
                                  <StatusBadge tone={mTone} size="sm" icon={mIcon}>
                                    {mLabel}
                                  </StatusBadge>
                                  <span>{ln.item_ma_hang || `#${ln.item_id}`}</span>
                                  {cur.status === "draft" && (
                                    <AppButton
                                      variant="ghost"
                                      size="sm"
                                      iconOnly
                                      leftIcon="x"
                                      aria-label="Bỏ khớp mặt hàng"
                                      onClick={() =>
                                        setLine(idx, { item_id: null, item_ma_hang: "", match_kind: "none" })
                                      }
                                    />
                                  )}
                                </span>
                              ) : cur.status === "draft" ? (
                                <div className="ui-stack--xs">
                                  <input
                                    className="ui-input"
                                    placeholder="Tìm mã/tên…"
                                    value={itemQuery?.line === idx ? itemQuery.q : ""}
                                    onChange={(e) => searchItems(idx, e.target.value)}
                                  />
                                  {itemQuery?.line === idx &&
                                    itemQuery.results.slice(0, 5).map((it) => (
                                      <AppButton
                                        key={it.id}
                                        variant="ghost"
                                        size="sm"
                                        className="ui-wrap-btn"
                                        onClick={() => {
                                          setLine(idx, {
                                            item_id: it.id,
                                            item_ma_hang: it.ma_hang,
                                            item_ten: it.ten,
                                            match_kind: "manual",
                                          });
                                          setItemQuery(null);
                                        }}
                                      >
                                        {it.ma_hang} · {it.ten.slice(0, 45)}
                                      </AppButton>
                                    ))}
                                  {ln.suggestions.length > 0 && <div className="muted">Gợi ý khớp:</div>}
                                  {ln.suggestions.map((s) => (
                                    <AppButton
                                      key={s.item_id}
                                      variant="ghost"
                                      size="sm"
                                      className="ui-wrap-btn"
                                      title={s.reason || ""}
                                      onClick={() =>
                                        setLine(idx, {
                                          item_id: s.item_id,
                                          item_ma_hang: s.ma_hang,
                                          item_ten: s.ten,
                                          match_kind: "manual",
                                        })
                                      }
                                    >
                                      {s.reason && (
                                        <StatusBadge
                                          tone={
                                            (s.score ?? 0) >= 0.99
                                              ? "success"
                                              : (s.score ?? 0) >= 0.7
                                                ? "warning"
                                                : "neutral"
                                          }
                                          size="sm"
                                        >
                                          {s.reason}
                                        </StatusBadge>
                                      )}
                                      <span>
                                        <b>{s.ma_hang}</b> · {s.ten}
                                      </span>
                                    </AppButton>
                                  ))}
                                  <div>
                                    <AppButton
                                      variant="secondary"
                                      size="sm"
                                      leftIcon="plus"
                                      onClick={() => createItemFromLine(idx)}
                                    >
                                      Tạo mã mới
                                    </AppButton>
                                  </div>
                                </div>
                              ) : (
                                <StatusBadge tone="danger" size="sm">
                                  Chưa khớp
                                </StatusBadge>
                              )}
                            </td>
                            <td className="num">{cur.status === "posted" ? `${vnd(ln.gia_von)}đ` : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              }
            />

            <div>
              <h4 className="ui-subhead ui-mt-4">
                <AppIcon name="coins" size={16} />
                <span>Chi phí tính vào giá vốn</span>
              </h4>
              <DataView
                mobileMode="scroll"
                desktop={
                  <div className="ui-table-scroll-wrap" tabIndex={0}>
                    <table className="ui-table">
                      <thead>
                        <tr>
                          <th>Loại</th>
                          <th>Tên</th>
                          <th className="num">Số tiền</th>
                          <th>Ghi chú</th>
                          <th className="ui-col-narrow ui-text-right"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {cur.costs.map((c, idx) => {
                          const editable = cur.status === "draft" && !c.doc_url;
                          return (
                            <tr key={c.id}>
                              <td>
                                {editable ? (
                                  <select
                                    className="ui-select"
                                    value={c.loai}
                                    onChange={(e) => setCost(idx, { loai: e.target.value })}
                                  >
                                    <option value="le_phi_hq">Lệ phí HQ</option>
                                    <option value="phi_ngan_hang">Phí ngân hàng</option>
                                    <option value="phi_ship">Phí vận chuyển</option>
                                    <option value="phi_khac">Phí khác</option>
                                  </select>
                                ) : (
                                  COST_LOAI_LABEL[c.loai] ?? c.loai
                                )}
                              </td>
                              <td>
                                {editable ? (
                                  <input
                                    className="ui-input"
                                    value={c.ten}
                                    onChange={(e) => setCost(idx, { ten: e.target.value })}
                                  />
                                ) : (
                                  c.ten
                                )}
                              </td>
                              <td className="num">
                                {editable ? (
                                  <input
                                    className="ui-input ui-input-price"
                                    value={c.so_tien}
                                    onChange={(e) => setCost(idx, { so_tien: vnNum(e.target.value) })}
                                  />
                                ) : (
                                  `${vnd(c.so_tien)}đ`
                                )}
                              </td>
                              <td>
                                {editable ? (
                                  <input
                                    className="ui-input"
                                    value={c.ghi_chu}
                                    onChange={(e) => setCost(idx, { ghi_chu: e.target.value })}
                                  />
                                ) : (
                                  c.ghi_chu
                                )}
                              </td>
                              <td className="col-act">
                                <div className="ui-row-end">
                                  {c.doc_url && (
                                    <AppButton
                                      variant="ghost"
                                      size="sm"
                                      iconOnly
                                      leftIcon="paperclip"
                                      title="Tải chứng từ"
                                      aria-label="Tải chứng từ"
                                      onClick={() => openExternalSafe(c.doc_url)}
                                    />
                                  )}
                                  {editable && (
                                    <AppButton
                                      variant="ghost"
                                      size="sm"
                                      iconOnly
                                      leftIcon="trash"
                                      aria-label="Xóa chi phí"
                                      onClick={() => removeCost(idx)}
                                    />
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {cur.costs.length === 0 && (
                          <tr>
                            <td colSpan={5} className="muted">
                              Chưa có chi phí nào.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                }
              />

              {cur.status === "draft" && (
                <div className="ui-row ui-mt-2">
                  <AppButton variant="secondary" size="sm" leftIcon="plus" onClick={addCostRow}>
                    Thêm phí
                  </AppButton>
                  <input
                    ref={attachRef}
                    type="file"
                    accept=".pdf"
                    className="ui-hidden"
                    onChange={(e) => attach(e.target.files)}
                  />
                  <AppButton
                    variant="secondary"
                    size="sm"
                    leftIcon="paperclip"
                    loading={attachBusy}
                    onClick={() => attachRef.current?.click()}
                  >
                    {attachBusy ? "Đang xử lý…" : "Đính kèm chứng từ (PDF)"}
                  </AppButton>
                </div>
              )}
            </div>

            {parseInfo && <InlineAlert tone="info">{parseInfoMsg(parseInfo)}</InlineAlert>}

            <div>
              <div className="ui-totals-bar ui-mt-3">
                <span>
                  Trị giá tính thuế: <b className="num">{vnd(cur.tri_gia_tinh_thue)}đ</b>
                </span>
                <span>
                  Thuế NK: <b className="num">{vnd(cur.tong_thue_nk)}đ</b>
                </span>
                <span>
                  Chi phí: <b className="num">{vnd(cur.tong_costs)}đ</b>
                </span>
                <span className="ui-totals-grand num">Tổng giá vốn: {vnd(tongGiaVon)}đ</span>
              </div>
              <div className="muted ui-text-right ui-mt-1">
                VAT hàng NK (khấu trừ, không vào giá vốn): {vnd(cur.tong_thue_vat)}đ
              </div>
            </div>
          </div>
        )}
      </AppModal>

      <PromptDialog
        open={!!createItemPrompt}
        title="Tạo mã hàng mới"
        label={createItemPrompt ? `Mã hàng mới cho: ${createItemPrompt.label}` : "Mã hàng mới"}
        defaultValue={createItemPrompt?.suggested || ""}
        onConfirm={confirmCreateItem}
        onCancel={() => setCreateItemPrompt(null)}
      />
    </PageShell>
  );
}
