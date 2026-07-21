import { useEffect, useRef, useState } from "react";
import {
  api,
  InvProduction,
  InvProductionLine,
  InvRecipe,
  InvWarehouse,
  NegStockError,
  NegStockViolation,
  StockRow,
} from "../api";
import { DateFilter, DateRange } from "../components/DateFilter";
import { NegStockModal } from "../components/NegStockModal";
import { getParam, setParam } from "../util";

function vnd(n: number): string {
  return Math.round(n).toLocaleString("vi-VN");
}
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface DraftLine {
  chieu: "vao" | "ra";
  item_id: number;
  warehouse_id: number;
  label: string;
  dvt: string;
  kha_dung: number;
  so_luong: number;
  don_gia_tam?: number; // gia tam tinh cho NVL chua co gia von (dong 'vao')
}

export function Production() {
  const [list, setList] = useState<InvProduction[]>([]);
  const [recipes, setRecipes] = useState<InvRecipe[]>([]);
  const [whs, setWhs] = useState<InvWarehouse[]>([]);
  const [err, setErr] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>({ tu: "", den: "" });
  const [creating, setCreating] = useState(false);
  const [ngay, setNgay] = useState(today());
  const [note, setNote] = useState("");
  const [recipeId, setRecipeId] = useState<number | null>(null);
  const [cpNhanCong, setCpNhanCong] = useState(0);
  const [cpSxc, setCpSxc] = useState(0);
  const [giaBanDuKien, setGiaBanDuKien] = useState(0);
  const [aiBusy, setAiBusy] = useState(false);
  const [avail, setAvail] = useState<StockRow[]>([]);
  const [pickQ, setPickQ] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [outQ, setOutQ] = useState("");
  const [outResults, setOutResults] = useState<{ id: number; ma_hang: string; ten: string; dvt: string }[]>([]);
  const [view, setView] = useState<InvProduction | null>(null);
  const [viewAvail, setViewAvail] = useState<StockRow[]>([]);
  const [viewBusy, setViewBusy] = useState(false);
  const [negModal, setNegModal] = useState<{
    violations: NegStockViolation[];
    prodId: number;
  } | null>(null);
  const [swapSearch, setSwapSearch] = useState<{
    lineId: number;
    q: string;
    results: { id: number; ma_hang: string; ten: string; dvt: string }[];
  } | null>(null);
  const [addNvlQ, setAddNvlQ] = useState("");
  const [addNvlResults, setAddNvlResults] = useState<
    { id: number; ma_hang: string; ten: string; dvt: string }[]
  >([]);
  const [listLoaded, setListLoaded] = useState(false);
  const autoLsxRef = useRef(false);

  async function load() {
    try {
      setList(await api.invProductions("", dateRange));
      setRecipes(await api.invRecipes());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setListLoaded(true);
    }
  }
  useEffect(() => {
    api.invWarehouses().then(setWhs).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange.tu, dateRange.den]);
  // F5 giu context: sau khi list load lan dau, tu mo lai lenh theo ?lsx=<production_id>
  useEffect(() => {
    if (!listLoaded || autoLsxRef.current) return;
    autoLsxRef.current = true;
    const lsx = getParam("lsx");
    if (lsx) {
      const prod = list.find((p) => p.id === Number(lsx));
      if (prod) openView(prod);
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

  const tpWh = whs.find((w) => w.code === "TP");

  function addConsume(r: StockRow) {
    if (lines.some((l) => l.chieu === "vao" && l.item_id === r.item_id && l.warehouse_id === r.warehouse_id)) return;
    setLines([
      ...lines,
      {
        chieu: "vao",
        item_id: r.item_id,
        warehouse_id: r.warehouse_id,
        label: `${r.ma_hang} · ${r.ten}`,
        dvt: r.dvt,
        kha_dung: r.kha_dung ?? 0,
        so_luong: 1,
      },
    ]);
  }

  async function searchOutput(q: string) {
    setOutQ(q);
    if (q.trim().length >= 2) {
      try {
        setOutResults(await api.invItems(q));
      } catch {
        /* ignore */
      }
    } else setOutResults([]);
  }

  function addOutput(it: { id: number; ma_hang: string; ten: string; dvt: string }) {
    if (!tpWh) return;
    setLines([
      ...lines.filter((l) => l.chieu !== "ra"),
      {
        chieu: "ra",
        item_id: it.id,
        warehouse_id: tpWh.id,
        label: `${it.ma_hang} · ${it.ten}`,
        dvt: it.dvt,
        kha_dung: 0,
        so_luong: 1,
      },
    ]);
    setOutQ("");
    setOutResults([]);
  }

  async function createOutputItem() {
    const ma = window.prompt("Mã thành phẩm mới (vd TP0027):", "");
    if (!ma) return;
    const ten = window.prompt("Tên thành phẩm:", outQ);
    if (!ten) return;
    try {
      const it = await api.invCreateItem({ ma_hang: ma, ten, dvt: "Bộ" });
      addOutput(it);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function applyRecipe(r: InvRecipe) {
    // Cong thuc la dinh muc cho r.output_qty SP. Hoi so SP can SX roi nhan
    // vat tu theo he so (SX N cai -> tieu hao dinh muc x N).
    const base = r.output_qty || 1;
    const ans = window.prompt(`Sản xuất bao nhiêu "${r.output_ten}"?`, String(base));
    if (ans == null) return;
    const target = Number(ans) || base;
    const factor = target / base;
    const availMap = new Map(avail.map((a) => [`${a.item_id}-${a.warehouse_id}`, a]));
    const consume: DraftLine[] = r.lines.map((ln) => {
      const a = availMap.get(`${ln.item_id}-${ln.warehouse_id}`);
      return {
        chieu: "vao" as const,
        item_id: ln.item_id,
        warehouse_id: ln.warehouse_id,
        label: `${ln.ma_hang} · ${ln.ten}`,
        dvt: ln.dvt,
        kha_dung: a?.kha_dung ?? 0,
        so_luong: ln.so_luong * factor,
      };
    });
    const out: DraftLine = {
      chieu: "ra",
      item_id: r.output_item_id,
      warehouse_id: tpWh?.id ?? 0,
      label: r.output_ten,
      dvt: "",
      kha_dung: 0,
      so_luong: target,
    };
    setLines([...consume, out]);
    setRecipeId(r.id);
  }

  async function saveRecipe() {
    const out = lines.find((l) => l.chieu === "ra");
    if (!out) return;
    const name = window.prompt("Tên công thức:", out.label);
    if (!name) return;
    // Chuan hoa ve "dinh muc cho 1 san pham": chia vat tu cho SL thanh pham.
    const perSp = out.so_luong || 1;
    try {
      await api.invRecipeCreate({
        name,
        output_item_id: out.item_id,
        output_qty: 1,
        lines: lines
          .filter((l) => l.chieu === "vao")
          .map((l) => ({
            item_id: l.item_id,
            warehouse_id: l.warehouse_id,
            so_luong: l.so_luong / perSp,
          })),
      });
      setRecipes(await api.invRecipes());
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function save() {
    setErr("");
    try {
      const prod = await api.invProductionCreate({
        ngay,
        note,
        recipe_id: recipeId,
        cp_nhan_cong: cpNhanCong,
        cp_sxc: cpSxc,
        gia_ban_du_kien: giaBanDuKien,
        lines: lines.map((l) => ({
          chieu: l.chieu,
          item_id: l.item_id,
          warehouse_id: l.warehouse_id,
          so_luong: l.so_luong,
          don_gia_tam: l.don_gia_tam || 0,
        })),
      });
      await api.invProductionPost(prod.id);
      setCreating(false);
      setLines([]);
      setNote("");
      setRecipeId(null);
      setCpNhanCong(0);
      setCpSxc(0);
      setGiaBanDuKien(0);
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function openView(prod: InvProduction) {
    setErr("");
    setView(prod);
    setParam("lsx", String(prod.id));
    if (prod.status === "draft") {
      api.invAvailability(prod.ngay).then((r) => setViewAvail(r.rows)).catch(() => {});
    }
  }
  function closeView() {
    setView(null);
    setParam("lsx", null);
  }
  function patchViewLine(lineId: number, patch: Partial<InvProductionLine>) {
    setView((v) => (v ? { ...v, lines: v.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)) } : v));
  }
  function khaDungFor(itemId: number, warehouseId: number): number {
    return viewAvail.find((r) => r.item_id === itemId && r.warehouse_id === warehouseId)?.kha_dung ?? 0;
  }
  async function viewVoid() {
    if (!view || !window.confirm(`Hủy ghi sổ LSX#${view.id} để sửa? Tồn kho sẽ tính lại.`)) return;
    setViewBusy(true);
    setErr("");
    try {
      const updated = await api.invProductionVoid(view.id);
      setView(updated);
      api.invAvailability(updated.ngay).then((r) => setViewAvail(r.rows)).catch(() => {});
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setViewBusy(false);
    }
  }
  async function viewSave(): Promise<InvProduction | null> {
    if (!view) return null;
    return api.invProductionSave(view.id, {
      ngay: view.ngay, note: view.note, description: view.description,
      recipe_id: view.recipe_id,
      cp_nhan_cong: view.cp_nhan_cong, cp_sxc: view.cp_sxc,
      gia_ban_du_kien: view.gia_ban_du_kien,
      lines: view.lines.map((l) => ({
        chieu: l.chieu, item_id: l.item_id, warehouse_id: l.warehouse_id,
        so_luong: l.so_luong, don_gia_tam: l.don_gia_tam || 0,
        note: l.note || "", orig_item_id: l.orig_item_id,
      })),
    });
  }
  async function doViewSave() {
    setViewBusy(true);
    setErr("");
    try {
      const updated = await viewSave();
      if (updated) setView(updated);
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
        const posted = await api.invProductionPost(saved.id);
        setView(posted);
        load();
      }
    } catch (e) {
      if (e instanceof NegStockError && view) {
        setNegModal({ violations: e.violations, prodId: view.id });
      } else {
        setErr((e as Error).message);
      }
    } finally {
      setViewBusy(false);
    }
  }
  // User da nhap ly do -> ghi so LSX kem override_reason (chap nhan am kho NVL)
  async function confirmNegPost(reason: string) {
    if (!negModal) return;
    setViewBusy(true);
    setErr("");
    try {
      const posted = await api.invProductionPost(negModal.prodId, reason);
      setView(posted);
      setNegModal(null);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setViewBusy(false);
    }
  }

  // Doi mot dong NVL cu (vd het thẻ nhớ model cu) sang mot ma khac — giu nguyen SL.
  async function searchSwap(lineId: number, q: string) {
    setSwapSearch({ lineId, q, results: swapSearch?.lineId === lineId ? swapSearch.results : [] });
    if (q.trim().length >= 2) {
      try {
        setSwapSearch({ lineId, q, results: await api.invItems(q) });
      } catch {
        /* ignore */
      }
    }
  }
  function swapViewLine(lineId: number, it: { id: number; ma_hang: string; ten: string; dvt: string }) {
    setView((v) =>
      v
        ? {
            ...v,
            lines: v.lines.map((l) =>
              l.id === lineId
                ? {
                    ...l,
                    item_id: it.id, ma_hang: it.ma_hang, ten: it.ten, dvt: it.dvt,
                    orig_item_id: l.orig_item_id ?? l.item_id,
                    note: `Thay hàng do hết mã gốc — đổi sang ${it.ma_hang}`,
                  }
                : l,
            ),
          }
        : v,
    );
    setSwapSearch(null);
  }
  // Them 1 dong NVL MOI vao LSX dang nhap (vd BOM thieu "hop nhom" chua co san).
  async function searchAddNvl(q: string) {
    setAddNvlQ(q);
    if (q.trim().length >= 2) {
      try {
        setAddNvlResults(await api.invItems(q));
      } catch {
        /* ignore */
      }
    } else setAddNvlResults([]);
  }
  async function addViewConsume(it: { id: number; ma_hang: string; ten: string; dvt: string }) {
    if (!view) return;
    if (view.lines.some((l) => l.chieu === "vao" && l.item_id === it.id)) {
      setAddNvlQ("");
      setAddNvlResults([]);
      return; // da co dong nay roi, khong them trung
    }
    let warehouseId = whs.find((w) => w.code === "HH")?.id ?? 1;
    try {
      const c = await api.invItemCost(it.id, view.ngay);
      if (c.warehouse_id != null) warehouseId = c.warehouse_id;
    } catch {
      /* ignore — mac dinh kho HH, sua tay duoc sau */
    }
    setView((v) =>
      v
        ? {
            ...v,
            lines: [
              ...v.lines,
              {
                id: -2000 - v.lines.length,
                chieu: "vao",
                item_id: it.id,
                ma_hang: it.ma_hang,
                ten: it.ten,
                dvt: it.dvt,
                warehouse_id: warehouseId,
                so_luong: 1,
                don_gia_tam: 0,
                gia_tri: 0,
                gia_tri_uoc: 0,
                so_luong_dinh_muc: null,
                gia_tri_dinh_muc: null,
                note: "",
                orig_item_id: null,
              },
            ],
          }
        : v,
    );
    setAddNvlQ("");
    setAddNvlResults([]);
  }
  function removeViewLine(lineId: number) {
    setView((v) => (v ? { ...v, lines: v.lines.filter((l) => l.id !== lineId) } : v));
  }
  // Ap 1 cong thuc (BOM) KHAC len LSX dang nhap co san — giu nguyen SL thanh pham,
  // thay toan bo dong tieu hao theo cong thuc moi (dung khi BOM cu het NVL).
  function applyRecipeToView(r: InvRecipe) {
    if (!view) return;
    const out = vOutputs[0];
    const target = out?.so_luong || r.output_qty || 1;
    const base = r.output_qty || 1;
    const factor = target / base;
    const consume: InvProductionLine[] = r.lines.map((ln, i) => ({
      id: -1000 - i,
      chieu: "vao",
      item_id: ln.item_id,
      ma_hang: ln.ma_hang,
      ten: ln.ten,
      dvt: ln.dvt,
      warehouse_id: ln.warehouse_id,
      so_luong: ln.so_luong * factor,
      don_gia_tam: 0,
      gia_tri: 0,
      gia_tri_uoc: 0,
      so_luong_dinh_muc: null,
      gia_tri_dinh_muc: null,
      note: "",
      orig_item_id: null,
    }));
    setView((v) =>
      v ? { ...v, recipe_id: r.id, lines: [...consume, ...v.lines.filter((l) => l.chieu === "ra")] } : v,
    );
  }
  async function saveRecipeFromView() {
    if (!view) return;
    const out = vOutputs[0];
    if (!out) return;
    const name = window.prompt("Tên công thức (BOM) mới:", `${out.ma_hang || out.ten} (thay thế)`);
    if (!name) return;
    const perSp = out.so_luong || 1;
    try {
      await api.invRecipeCreate({
        name,
        output_item_id: out.item_id,
        output_qty: 1,
        lines: vConsumes.map((l) => ({
          item_id: l.item_id, warehouse_id: l.warehouse_id, so_luong: l.so_luong / perSp,
        })),
      });
      setRecipes(await api.invRecipes());
      window.alert(`Đã lưu công thức "${name}" — lần sau chọn được ở "Đổi sang công thức khác".`);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function aiDescribeView() {
    if (!view) return;
    setAiBusy(true);
    setErr("");
    try {
      const updated = await api.invProductionDescribe(view.id);
      setView(updated);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  }

  const q = pickQ.trim().toLowerCase();
  const pickable = avail.filter(
    (r) =>
      (r.kha_dung ?? 0) > 0 &&
      (!q || r.ten.toLowerCase().includes(q) || r.ma_hang.toLowerCase().includes(q)),
  );
  const consumes = lines.filter((l) => l.chieu === "vao");
  const outputs = lines.filter((l) => l.chieu === "ra");
  const over = consumes.filter((l) => l.so_luong > l.kha_dung);

  // Tinh toan gia thanh cho modal xem (LSX)
  const vConsumes = view ? view.lines.filter((l) => l.chieu === "vao") : [];
  const vOutputs = view ? view.lines.filter((l) => l.chieu === "ra") : [];
  const nvlCost = vConsumes.reduce((s, l) => s + l.gia_tri, 0);
  const tongGiaThanh = nvlCost + (view?.cp_nhan_cong || 0) + (view?.cp_sxc || 0);
  const outQty = vOutputs.reduce((s, l) => s + l.so_luong, 0);
  const giaThanhDv = outQty ? tongGiaThanh / outQty : 0;
  const giaBan = view?.gia_ban_du_kien || 0;
  const tiSuat = giaBan ? ((giaBan - giaThanhDv) / giaBan) * 100 : null;
  const hasDinhMuc = vConsumes.some((l) => l.so_luong_dinh_muc != null);
  const nvlThieuGia =
    view?.status === "posted" && vConsumes.some((l) => l.gia_tri === 0);
  // BOM khac cho CUNG thanh pham (uu tien), fallback toan bo neu chua co BOM nao khac gan the.
  const sameItemRecipes = recipes.filter((r) => r.output_item_id === vOutputs[0]?.item_id);
  const viewRecipeOptions = sameItemRecipes.length > 0 ? sameItemRecipes : recipes;

  return (
    <div className="docs-page">
      <div className="docs-toolbar">
        <h3>
          Sản xuất <span className="count">{list.length}</span>
        </h3>
        <div className="tb-group">
          <DateFilter value={dateRange} onChange={setDateRange} />
          <button
            className="btn-sm ghost"
            title="Chạy lại bình quân gia quyền, khắc phục phiếu treo giá vốn"
            onClick={async () => {
              if (!window.confirm("Tính lại giá xuất kho cho toàn bộ sổ kho?")) return;
              setErr("");
              try {
                const r = await api.invRecalcCost();
                load();
                window.alert(`Đã tính lại ${r.pairs} cặp (mặt hàng, kho).`);
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            🔄 Tính lại giá xuất kho
          </button>
          <button className="btn-sm" onClick={() => setCreating(true)}>
            ＋ Tạo lệnh sản xuất
          </button>
          <button
            className="btn-sm ghost"
            onClick={() =>
              window.open(
                api.invExportUrl("productions", "xlsx", { tu: dateRange.tu, den: dateRange.den }),
                "_blank",
              )
            }
          >
            ⬇ Excel
          </button>
        </div>
      </div>
      {err && <div className="error">{err}</div>}
      <p className="muted">
        Gom nguyên vật liệu / hàng hóa → sản xuất thành phẩm. Giá thành thành phẩm = tổng giá vốn
        vật tư tiêu hao (bình quân gia quyền tại ngày sản xuất).
      </p>

      <div className="table-wrap">
        <table className="dt">
          <thead>
            <tr>
              <th>Số CT</th>
              <th>Ngày</th>
              <th>Thành phẩm</th>
              <th>Tiêu hao</th>
              <th style={{ textAlign: "right" }}>Giá thành</th>
              <th>Trạng thái</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => {
              const outs = p.lines.filter((l) => l.chieu === "ra");
              const ins = p.lines.filter((l) => l.chieu === "vao");
              const outQ = outs.reduce((s, l) => s + l.so_luong, 0);
              const cost = outs.reduce((s, l) => s + l.gia_tri, 0);
              const posted = p.status === "posted";
              const total = posted ? (p.tong_gia_thanh || cost) : p.tong_gia_thanh_uoc;
              const dv = posted ? (outQ ? total / outQ : 0) : p.gia_thanh_dv_uoc;
              return (
                <tr key={p.id} style={{ cursor: "pointer" }} title="Xem/sửa lệnh sản xuất" onClick={() => openView(p)}>
                  <td className="muted nowrap">
                    {p.so_ct || `LSX#${p.id}`}
                    {p.sale_id != null && (
                      <div className="chip gray sm" style={{ marginTop: 2 }}>
                        🧾 HĐ bán #{p.sale_id}
                      </div>
                    )}
                  </td>
                  <td className="nowrap">{p.ngay}</td>
                  <td>{outs.map((l) => `${l.ma_hang || l.ten}×${l.so_luong}`).join(", ")}</td>
                  <td className="muted">{ins.map((l) => `${l.ma_hang}×${l.so_luong}`).join(", ")}</td>
                  <td style={{ textAlign: "right" }} className="nowrap">
                    {posted ? vnd(total) : <span className="muted">~{vnd(total)}</span>}
                    {outQ > 1 && dv > 0 && (
                      <div className="muted" style={{ fontSize: 11 }}>
                        {posted ? "" : "~"}{vnd(dv)}/đv
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`chip sm ${p.status === "posted" ? "green" : "amber"}`}>
                      {p.status === "posted" ? "Đã ghi sổ" : "Nháp"}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {p.status !== "posted" && (
                      <button
                        className="btn-sm ghost"
                        onClick={async () => {
                          if (!window.confirm(`Xóa lệnh nháp LSX#${p.id}?`)) return;
                          await api.invProductionDelete(p.id);
                          load();
                        }}
                      >
                        🗑
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <div className="empty">
                    <div className="empty-ic">🏭</div>
                    <div>Chưa có lệnh sản xuất nào.</div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {creating && (
        <div className="modal-backdrop" onClick={() => setCreating(false)}>
          <div className="modal" style={{ maxWidth: 1000 }} onClick={(e) => e.stopPropagation()}>
            <h3>Lệnh sản xuất mới</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <label>
                Ngày
                <input type="date" value={ngay} onChange={(e) => setNgay(e.target.value)} />
              </label>
              <label style={{ flex: 1 }}>
                Ghi chú
                <input value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              {recipes.length > 0 && (
                <label>
                  Áp công thức
                  <select
                    value={recipeId ?? ""}
                    onChange={(e) => {
                      const r = recipes.find((x) => x.id === Number(e.target.value));
                      if (r) applyRecipe(r);
                    }}
                  >
                    <option value="">— chọn —</option>
                    {recipes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
              <label>
                CP nhân công (622)
                <input
                  style={{ width: 120, textAlign: "right" }}
                  type="number"
                  min={0}
                  value={cpNhanCong}
                  onChange={(e) => setCpNhanCong(Number(e.target.value) || 0)}
                />
              </label>
              <label>
                CP SX chung (627)
                <input
                  style={{ width: 120, textAlign: "right" }}
                  type="number"
                  min={0}
                  value={cpSxc}
                  onChange={(e) => setCpSxc(Number(e.target.value) || 0)}
                />
              </label>
              <label>
                Giá bán dự kiến (/đvị TP)
                <input
                  style={{ width: 130, textAlign: "right" }}
                  type="number"
                  min={0}
                  value={giaBanDuKien}
                  onChange={(e) => setGiaBanDuKien(Number(e.target.value) || 0)}
                />
              </label>
            </div>

            <h4>Thành phẩm (nhập kho TP)</h4>
            {outputs.map((l) => (
              <div key={l.item_id}>
                <b>{l.label}</b> · SL:{" "}
                <input
                  style={{ width: 80, textAlign: "right" }}
                  type="number"
                  min={0}
                  value={l.so_luong}
                  onChange={(e) => {
                    const v = Number(e.target.value) || 0;
                    setLines(lines.map((x) => (x === l ? { ...x, so_luong: v } : x)));
                  }}
                />{" "}
                <button className="btn-sm ghost" onClick={() => setLines(lines.filter((x) => x !== l))}>
                  ✕
                </button>
              </div>
            ))}
            {outputs.length === 0 && (
              <div>
                <input
                  placeholder="🔍 tìm mã/tên thành phẩm…"
                  value={outQ}
                  onChange={(e) => searchOutput(e.target.value)}
                />
                {outResults.slice(0, 5).map((it) => (
                  <div key={it.id}>
                    <button className="btn-sm ghost" onClick={() => addOutput(it)}>
                      {it.ma_hang} · {it.ten.slice(0, 50)}
                    </button>
                  </div>
                ))}
                <button className="btn-sm" onClick={createOutputItem}>
                  ＋ Tạo mã thành phẩm mới
                </button>
              </div>
            )}

            <h4>Vật tư tiêu hao</h4>
            {consumes.length > 0 && (
              <div className="table-wrap">
                <table className="dt">
                  <tbody>
                    {consumes.map((l) => (
                      <tr key={`${l.item_id}-${l.warehouse_id}`}>
                        <td>{l.label}</td>
                        <td style={{ textAlign: "right" }} className="muted">
                          khả dụng {l.kha_dung} {l.dvt}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <input
                            style={{ width: 80, textAlign: "right" }}
                            type="number"
                            min={0}
                            value={l.so_luong}
                            onChange={(e) => {
                              const v = Number(e.target.value) || 0;
                              setLines(lines.map((x) => (x === l ? { ...x, so_luong: v } : x)));
                            }}
                          />
                          {l.so_luong > l.kha_dung && <span className="chip red sm"> vượt!</span>}
                        </td>
                        <td style={{ textAlign: "right" }} title="Giá tạm tính khi NVL chưa có giá vốn">
                          <input
                            style={{ width: 100, textAlign: "right" }}
                            type="number"
                            min={0}
                            placeholder="giá tạm"
                            value={l.don_gia_tam || 0}
                            onChange={(e) => {
                              const v = Number(e.target.value) || 0;
                              setLines(lines.map((x) => (x === l ? { ...x, don_gia_tam: v } : x)));
                            }}
                          />
                        </td>
                        <td>
                          <button className="btn-sm ghost" onClick={() => setLines(lines.filter((x) => x !== l))}>
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <input
              className="search"
              placeholder="🔍 Tìm vật tư khả dụng để thêm…"
              value={pickQ}
              onChange={(e) => setPickQ(e.target.value)}
            />
            <div className="table-wrap" style={{ maxHeight: "25vh", overflow: "auto", marginTop: 6 }}>
              <table className="dt">
                <tbody>
                  {pickable.slice(0, 30).map((r) => (
                    <tr
                      key={`${r.item_id}-${r.warehouse_id}`}
                      style={{ cursor: "pointer" }}
                      onClick={() => addConsume(r)}
                    >
                      <td className="nowrap">{r.ma_hang}</td>
                      <td>{r.ten}</td>
                      <td>
                        <span className="chip gray sm">{r.warehouse_code}</span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        khả dụng <b>{r.kha_dung}</b> {r.dvt}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="modal-actions">
              <button disabled={outputs.length === 0 || consumes.length === 0} onClick={saveRecipe}>
                💾 Lưu công thức
              </button>
              <button onClick={() => setCreating(false)}>Hủy</button>
              <button
                className="primary"
                disabled={
                  outputs.length === 0 ||
                  consumes.length === 0 ||
                  over.length > 0 ||
                  lines.some((l) => l.so_luong <= 0)
                }
                onClick={save}
              >
                ✅ Ghi sổ sản xuất
              </button>
            </div>
          </div>
        </div>
      )}

      {view && (
        <div className="modal-backdrop" onClick={closeView}>
          <div className="modal" style={{ maxWidth: 780 }} onClick={(e) => e.stopPropagation()}>
            <h3>
              Lệnh sản xuất {view.so_ct || `LSX#${view.id}`}{" "}
              <span className={`chip sm ${view.status === "posted" ? "green" : "amber"}`}>
                {view.status === "posted" ? "Đã ghi sổ" : "Nháp"}
              </span>
            </h3>
            {err && <div className="error" style={{ marginBottom: 8 }}>{err}</div>}
            {view.sale_id != null && (
              <p className="muted" style={{ margin: "4px 0" }}>
                🧾 Sinh từ HĐ bán #{view.sale_id}
              </p>
            )}
            {view.note && <p className="muted" style={{ margin: "4px 0" }}>{view.note}</p>}
            <div style={{ margin: "6px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <label style={{ margin: 0 }}>Mô tả</label>
                <button className="btn-sm ghost" disabled={aiBusy} onClick={aiDescribeView} title="AI nhìn trọn bộ NVL để sinh mô tả">
                  {aiBusy ? "⏳ Đang sinh…" : "✨ AI sinh mô tả"}
                </button>
              </div>
              <textarea
                style={{ width: "100%", minHeight: 56, resize: "vertical" }}
                placeholder="Mô tả lệnh sản xuất / công dụng bộ NVL… (bấm ✨ để AI gợi ý)"
                value={view.description}
                disabled={view.status !== "draft"}
                onChange={(e) => setView({ ...view, description: e.target.value })}
              />
            </div>
            {view.status === "posted" && (
              <div className="warn-banner" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span>🔒 <b>Đã ghi sổ</b> nên số lượng bị khóa. Bấm <b>Hủy ghi sổ</b> để sửa lại.</span>
                <button className="btn-sm danger" disabled={viewBusy} onClick={viewVoid}>
                  ↩️ Hủy ghi sổ để sửa
                </button>
              </div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0" }}>
              <label>
                Ngày
                <input
                  type="date"
                  value={view.ngay}
                  disabled={view.status !== "draft"}
                  onChange={(e) => setView({ ...view, ngay: e.target.value })}
                />
              </label>
              <label style={{ flex: 1 }}>
                Ghi chú
                <input
                  value={view.note}
                  disabled={view.status !== "draft"}
                  onChange={(e) => setView({ ...view, note: e.target.value })}
                />
              </label>
            </div>

            {/* Chi phi che bien: nhan cong (622) + SX chung (627) */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "6px 0" }}>
              <label>
                CP nhân công (622)
                <input
                  style={{ width: 120, textAlign: "right" }}
                  type="number"
                  min={0}
                  value={view.cp_nhan_cong}
                  disabled={view.status !== "draft"}
                  onChange={(e) => setView({ ...view, cp_nhan_cong: Number(e.target.value) || 0 })}
                />
              </label>
              <label>
                CP SX chung (627)
                <input
                  style={{ width: 120, textAlign: "right" }}
                  type="number"
                  min={0}
                  value={view.cp_sxc}
                  disabled={view.status !== "draft"}
                  onChange={(e) => setView({ ...view, cp_sxc: Number(e.target.value) || 0 })}
                />
              </label>
              <label>
                Giá bán dự kiến (/đvị)
                <input
                  style={{ width: 130, textAlign: "right" }}
                  type="number"
                  min={0}
                  value={view.gia_ban_du_kien}
                  disabled={view.status !== "draft"}
                  onChange={(e) => setView({ ...view, gia_ban_du_kien: Number(e.target.value) || 0 })}
                />
              </label>
            </div>

            <h4>Thành phẩm (nhập kho — TK 155)</h4>
            <div className="table-wrap">
              <table className="dt">
                <thead>
                  <tr>
                    <th>Thành phẩm</th>
                    <th style={{ textAlign: "right" }}>SL</th>
                    <th style={{ textAlign: "right" }}>Giá thành</th>
                  </tr>
                </thead>
                <tbody>
                  {vOutputs.map((l) => (
                    <tr key={l.id}>
                      <td>{l.ma_hang || l.ten}</td>
                      <td style={{ textAlign: "right" }}>
                        {view.status === "draft" ? (
                          <input
                            style={{ width: 70, textAlign: "right" }}
                            type="number"
                            value={l.so_luong}
                            onChange={(e) => patchViewLine(l.id, { so_luong: Number(e.target.value) || 0 })}
                          />
                        ) : (
                          l.so_luong
                        )}
                      </td>
                      <td style={{ textAlign: "right" }} className="muted">
                        {vnd(l.gia_tri)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {view.status === "draft" && recipes.length > 0 && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "6px 0" }}>
                <label>
                  🔁 Đổi sang công thức khác (BOM thay thế)
                  <select
                    value=""
                    onChange={(e) => {
                      const r = viewRecipeOptions.find((x) => x.id === Number(e.target.value));
                      if (r) applyRecipeToView(r);
                    }}
                  >
                    <option value="">— chọn —</option>
                    {viewRecipeOptions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="btn-sm ghost" onClick={saveRecipeFromView}>
                  💾 Lưu thành công thức mới
                </button>
                <span className="muted" style={{ fontSize: 11 }}>
                  Dùng khi BOM cũ hết NVL (vd đổi thẻ nhớ khác) — chọn BOM đã lưu sẵn, hoặc đổi tay từng
                  dòng bên dưới rồi lưu thành BOM mới để tái sử dụng.
                </span>
              </div>
            )}
            <h4>
              Nguyên vật liệu tiêu hao (TK 621)
              {hasDinhMuc && <span className="muted" style={{ fontWeight: 400 }}> — so định mức / thực tế / chênh lệch</span>}
            </h4>
            <div className="table-wrap">
              <table className="dt">
                <thead>
                  <tr>
                    <th>Vật tư</th>
                    {hasDinhMuc && <th style={{ textAlign: "right" }}>SL định mức</th>}
                    <th style={{ textAlign: "right" }}>SL thực xuất</th>
                    {hasDinhMuc && <th style={{ textAlign: "right" }}>Chênh lệch SL</th>}
                    {view.status === "draft" && <th style={{ textAlign: "right" }}>Giá tạm</th>}
                    {hasDinhMuc && <th style={{ textAlign: "right" }}>GT định mức</th>}
                    <th style={{ textAlign: "right" }}>GT thực tế</th>
                  </tr>
                </thead>
                <tbody>
                  {vConsumes.map((l) => {
                    const kd = view.status === "draft" ? khaDungFor(l.item_id, l.warehouse_id) : null;
                    const overkd = kd !== null && l.so_luong > kd;
                    const dmSl = l.so_luong_dinh_muc;
                    const clSl = dmSl != null ? l.so_luong - dmSl : null;
                    return (
                      <tr key={l.id} className={overkd ? "row-treo" : ""}>
                        <td>
                          {l.ma_hang} · {l.ten}
                          {l.note && (
                            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                              💬 {l.note}
                            </div>
                          )}
                          {view.status === "draft" && (
                            <div>
                              <button
                                className="btn-sm ghost"
                                style={{ fontSize: 11 }}
                                title="Đổi mã vật tư này (vd hết hàng, thay model khác)"
                                onClick={() =>
                                  setSwapSearch(
                                    swapSearch?.lineId === l.id ? null : { lineId: l.id, q: "", results: [] },
                                  )
                                }
                              >
                                🔄 đổi mã
                              </button>
                              <button
                                className="btn-sm ghost"
                                style={{ fontSize: 11 }}
                                title="Xoá dòng vật tư này khỏi LSX"
                                onClick={() => {
                                  if (window.confirm(`Xoá dòng "${l.ma_hang} · ${l.ten}" khỏi LSX?`)) {
                                    removeViewLine(l.id);
                                  }
                                }}
                              >
                                ✕ xoá
                              </button>
                              {swapSearch?.lineId === l.id && (
                                <div>
                                  <input
                                    autoFocus
                                    style={{ width: 160, marginTop: 2 }}
                                    placeholder="tìm mã/tên thay thế…"
                                    value={swapSearch.q}
                                    onChange={(e) => searchSwap(l.id, e.target.value)}
                                  />
                                  {swapSearch.results.slice(0, 6).map((it) => (
                                    <div key={it.id}>
                                      <button className="btn-sm ghost" onClick={() => swapViewLine(l.id, it)}>
                                        <b>{it.ma_hang}</b> · {it.ten}
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        {hasDinhMuc && (
                          <td style={{ textAlign: "right" }} className="muted">
                            {dmSl != null ? dmSl : "—"}
                          </td>
                        )}
                        <td style={{ textAlign: "right" }}>
                          {view.status === "draft" ? (
                            <>
                              <input
                                style={{ width: 70, textAlign: "right" }}
                                type="number"
                                value={l.so_luong}
                                onChange={(e) => patchViewLine(l.id, { so_luong: Number(e.target.value) || 0 })}
                              />
                              <div className="muted" style={{ fontSize: 11 }}>
                                khả dụng {kd}
                                {overkd && <span className="chip red sm"> vượt!</span>}
                              </div>
                            </>
                          ) : (
                            l.so_luong
                          )}
                        </td>
                        {hasDinhMuc && (
                          <td style={{ textAlign: "right" }} className={clSl && clSl > 0 ? "" : "muted"}>
                            {clSl != null ? (clSl > 0 ? `+${vnd(clSl)}` : vnd(clSl)) : "—"}
                          </td>
                        )}
                        {view.status === "draft" && (
                          <td style={{ textAlign: "right" }}>
                            <input
                              style={{ width: 90, textAlign: "right" }}
                              type="number"
                              min={0}
                              placeholder="giá tạm"
                              value={l.don_gia_tam || 0}
                              onChange={(e) => patchViewLine(l.id, { don_gia_tam: Number(e.target.value) || 0 })}
                            />
                          </td>
                        )}
                        {hasDinhMuc && (
                          <td style={{ textAlign: "right" }} className="muted">
                            {l.gia_tri_dinh_muc != null ? vnd(l.gia_tri_dinh_muc) : "—"}
                          </td>
                        )}
                        <td style={{ textAlign: "right" }} className="muted">
                          {view.status === "posted" ? vnd(l.gia_tri) : `~${vnd(l.gia_tri_uoc)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {view.status === "draft" && (
              <div style={{ margin: "6px 0" }}>
                <label>
                  ➕ Thêm vật tư vào LSX (vd thiếu "hộp nhôm" chưa có trong BOM)
                  <input
                    style={{ width: 220, marginLeft: 6 }}
                    placeholder="tìm mã/tên vật tư…"
                    value={addNvlQ}
                    onChange={(e) => searchAddNvl(e.target.value)}
                  />
                </label>
                {addNvlResults.length > 0 && (
                  <div>
                    {addNvlResults.slice(0, 8).map((it) => (
                      <div key={it.id}>
                        <button className="btn-sm ghost" onClick={() => addViewConsume(it)}>
                          <b>{it.ma_hang}</b> · {it.ten}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Tong hop gia thanh */}
            <div className="warn-banner" style={{ marginTop: 10 }}>
              {view.status === "draft" ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 16px" }}>
                  <span>Giá thành ước tính (621+622+627):</span>
                  <b style={{ textAlign: "right" }}>~{vnd(view.tong_gia_thanh_uoc)} đ</b>
                  <span>Giá thành đơn vị ước tính:</span>
                  <b style={{ textAlign: "right" }}>~{vnd(view.gia_thanh_dv_uoc)} đ</b>
                  {giaBan > 0 && view.gia_thanh_dv_uoc > 0 && (
                    <>
                      <span>Tỉ suất LN ước tính:</span>
                      <b style={{ textAlign: "right" }}>
                        {(((giaBan - view.gia_thanh_dv_uoc) / giaBan) * 100).toFixed(1)}%
                      </b>
                    </>
                  )}
                  <span style={{ gridColumn: "1 / -1" }} className="muted">
                    Ước tính theo giá vốn BQ hiện tại; khi <b>ghi sổ</b> dùng bình quân tại ngày SX. Nhập
                    <b> giá tạm tính</b> cho NVL chưa có giá vốn để không bị 0đ.
                  </span>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 16px" }}>
                  <span>Chi phí NVL trực tiếp (621):</span>
                  <b style={{ textAlign: "right" }}>{vnd(nvlCost)} đ</b>
                  <span>Nhân công trực tiếp (622):</span>
                  <b style={{ textAlign: "right" }}>{vnd(view.cp_nhan_cong)} đ</b>
                  <span>Chi phí SX chung (627):</span>
                  <b style={{ textAlign: "right" }}>{vnd(view.cp_sxc)} đ</b>
                  <span>Tổng giá thành (→ 154 → 155):</span>
                  <b style={{ textAlign: "right" }}>{vnd(tongGiaThanh)} đ</b>
                  <span>Giá thành đơn vị:</span>
                  <b style={{ textAlign: "right" }}>{vnd(giaThanhDv)} đ</b>
                  {giaBan > 0 && (
                    <>
                      <span>Giá bán dự kiến:</span>
                      <b style={{ textAlign: "right" }}>{vnd(giaBan)} đ</b>
                      <span>Tỉ suất lợi nhuận:</span>
                      <b style={{ textAlign: "right" }} className={tiSuat != null && tiSuat < 0 ? "chip red sm" : ""}>
                        {tiSuat != null ? `${tiSuat.toFixed(1)}%` : "—"}
                      </b>
                    </>
                  )}
                </div>
              )}
              {nvlThieuGia && (
                <div className="chip red sm" style={{ marginTop: 6 }}>
                  ⚠ Có NVL chưa có giá vốn (giá trị = 0) → giá thành có thể thiếu. Dùng giá tạm tính hoặc
                  bấm "Tính lại giá xuất kho".
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button onClick={closeView}>Đóng</button>
              {view.status === "draft" && (
                <>
                  <button disabled={viewBusy} onClick={doViewSave}>
                    💾 Lưu
                  </button>
                  <button
                    className="primary"
                    disabled={viewBusy}
                    title={
                      view.lines
                        .filter((l) => l.chieu === "vao")
                        .some((l) => l.so_luong > khaDungFor(l.item_id, l.warehouse_id))
                        ? "Có dòng vượt khả dụng — nếu ghi sổ sẽ hỏi lý do duyệt âm kho"
                        : ""
                    }
                    onClick={doViewPost}
                  >
                    ✅ Ghi sổ lại
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {negModal && (
        <NegStockModal
          violations={negModal.violations}
          busy={viewBusy}
          onConfirm={confirmNegPost}
          onCancel={() => setNegModal(null)}
        />
      )}
    </div>
  );
}
