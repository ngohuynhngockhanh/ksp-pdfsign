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
import { AppModal, DataView, FormGrid, PromptDialog } from "../components/ui";
import { getParam, setParam } from "../util";
import { openExternalSafe } from "../utils/url";

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
  const [lotNumber, setLotNumber] = useState("");
  const [serialNumbers, setSerialNumbers] = useState("");
  const [mfgDate, setMfgDate] = useState("");
  const [expDate, setExpDate] = useState("");
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
  const [newOutputModal, setNewOutputModal] = useState<{ ma: string; ten: string } | null>(null);
  const [recipePrompt, setRecipePrompt] = useState<{
    mode: "create" | "view";
    defaultValue: string;
    title: string;
  } | null>(null);
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
    const targetQty = 1;
    const matched = recipes.find((r) => r.output_item_id === it.id);
    if (matched) {
      setRecipeId(matched.id);
      const base = matched.output_qty || 1;
      const factor = targetQty / base;
      const availMap = new Map(avail.map((a) => [`${a.item_id}-${a.warehouse_id}`, a]));
      const consume: DraftLine[] = matched.lines.map((ln) => {
        const a = availMap.get(`${ln.item_id}-${ln.warehouse_id}`);
        return {
          chieu: "vao" as const,
          item_id: ln.item_id,
          warehouse_id: ln.warehouse_id,
          label: `${ln.ma_hang} · ${ln.ten}`,
          dvt: ln.dvt,
          kha_dung: a?.kha_dung ?? 0,
          so_luong: Number((ln.so_luong * factor).toFixed(4)),
        };
      });
      const out: DraftLine = {
        chieu: "ra",
        item_id: it.id,
        warehouse_id: tpWh.id,
        label: `${it.ma_hang} · ${it.ten}`,
        dvt: it.dvt,
        kha_dung: 0,
        so_luong: targetQty,
      };
      setLines([...consume, out]);
    } else {
      setLines([
        ...lines.filter((l) => l.chieu !== "ra"),
        {
          chieu: "ra",
          item_id: it.id,
          warehouse_id: tpWh.id,
          label: `${it.ma_hang} · ${it.ten}`,
          dvt: it.dvt,
          kha_dung: 0,
          so_luong: targetQty,
        },
      ]);
    }
    setOutQ("");
    setOutResults([]);
  }

  function updateOutputQty(newQty: number) {
    const out = lines.find((l) => l.chieu === "ra");
    if (!out) return;
    const matched = recipeId
      ? recipes.find((r) => r.id === recipeId)
      : recipes.find((r) => r.output_item_id === out.item_id);
    if (matched) {
      const base = matched.output_qty || 1;
      const factor = newQty / base;
      const availMap = new Map(avail.map((a) => [`${a.item_id}-${a.warehouse_id}`, a]));
      const consume: DraftLine[] = matched.lines.map((ln) => {
        const a = availMap.get(`${ln.item_id}-${ln.warehouse_id}`);
        return {
          chieu: "vao" as const,
          item_id: ln.item_id,
          warehouse_id: ln.warehouse_id,
          label: `${ln.ma_hang} · ${ln.ten}`,
          dvt: ln.dvt,
          kha_dung: a?.kha_dung ?? 0,
          so_luong: Number((ln.so_luong * factor).toFixed(4)),
        };
      });
      const updatedOut: DraftLine = { ...out, so_luong: newQty };
      setLines([...consume, updatedOut]);
    } else {
      setLines(lines.map((x) => (x === out ? { ...x, so_luong: newQty } : x)));
    }
  }

  function createOutputItem() {
    setNewOutputModal({ ma: "", ten: outQ });
  }

  async function confirmCreateOutputItem() {
    if (!newOutputModal) return;
    const ma = newOutputModal.ma.trim();
    const ten = newOutputModal.ten.trim();
    if (!ma || !ten) return;
    try {
      const it = await api.invCreateItem({ ma_hang: ma, ten, dvt: "Bộ" });
      addOutput(it);
      setNewOutputModal(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function applyRecipe(r: InvRecipe, explicitQty?: number) {
    const curOut = lines.find((l) => l.chieu === "ra");
    const target = explicitQty ?? (curOut?.so_luong || r.output_qty || 1);
    const base = r.output_qty || 1;
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
        so_luong: Number((ln.so_luong * factor).toFixed(4)),
      };
    });
    const out: DraftLine = {
      chieu: "ra",
      item_id: r.output_item_id,
      warehouse_id: tpWh?.id ?? 0,
      label: r.output_ten,
      dvt: curOut?.dvt || "",
      kha_dung: 0,
      so_luong: target,
    };
    setLines([...consume, out]);
    setRecipeId(r.id);
  }

  function saveRecipe() {
    const out = lines.find((l) => l.chieu === "ra");
    if (!out) return;
    setRecipePrompt({
      mode: "create",
      defaultValue: out.label,
      title: "Lưu công thức sản xuất",
    });
  }

  async function confirmSaveRecipe(rawName: string) {
    const name = rawName.trim();
    const mode = recipePrompt?.mode;
    setRecipePrompt(null);
    if (!name || !mode) return;
    if (mode === "create") {
      const out = lines.find((l) => l.chieu === "ra");
      if (!out) return;
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
      return;
    }
    if (!view) return;
    const out = vOutputs[0];
    if (!out) return;
    const perSp = out.so_luong || 1;
    try {
      await api.invRecipeCreate({
        name,
        output_item_id: out.item_id,
        output_qty: 1,
        lines: vConsumes.map((l) => ({
          item_id: l.item_id,
          warehouse_id: l.warehouse_id,
          so_luong: l.so_luong / perSp,
        })),
      });
      setRecipes(await api.invRecipes());
      window.alert(`Đã lưu công thức "${name}" — lần sau chọn được ở "Đổi sang công thức khác".`);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function resetCreateForm() {
    setLines([]);
    setNote("");
    setRecipeId(null);
    setCpNhanCong(0);
    setCpSxc(0);
    setGiaBanDuKien(0);
    setLotNumber("");
    setSerialNumbers("");
    setMfgDate("");
    setExpDate("");
  }

  async function saveOrder(shouldPost: boolean) {
    setErr("");
    try {
      const prod = await api.invProductionCreate({
        ngay,
        note,
        recipe_id: recipeId,
        cp_nhan_cong: cpNhanCong,
        cp_sxc: cpSxc,
        gia_ban_du_kien: giaBanDuKien,
        lot_number: lotNumber,
        serial_numbers: serialNumbers,
        mfg_date: mfgDate,
        exp_date: expDate,
        lines: lines.map((l) => ({
          chieu: l.chieu,
          item_id: l.item_id,
          warehouse_id: l.warehouse_id,
          so_luong: l.so_luong,
          don_gia_tam: l.don_gia_tam || 0,
          lot_number: l.chieu === "ra" ? lotNumber : "",
          serial_numbers: l.chieu === "ra" ? serialNumbers : "",
        })),
      });
      if (shouldPost) {
        try {
          await api.invProductionPost(prod.id);
        } catch (e) {
          if (e instanceof NegStockError) {
            setNegModal({ violations: e.violations, prodId: prod.id });
            setCreating(false);
            resetCreateForm();
            load();
            return;
          }
          throw e;
        }
      }
      setCreating(false);
      resetCreateForm();
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
      ngay: view.ngay,
      note: view.note,
      description: view.description,
      recipe_id: view.recipe_id,
      cp_nhan_cong: view.cp_nhan_cong,
      cp_sxc: view.cp_sxc,
      gia_ban_du_kien: view.gia_ban_du_kien,
      lot_number: view.lot_number || "",
      serial_numbers: view.serial_numbers || "",
      mfg_date: view.mfg_date || "",
      exp_date: view.exp_date || "",
      lines: view.lines.map((l) => ({
        chieu: l.chieu,
        item_id: l.item_id,
        warehouse_id: l.warehouse_id,
        so_luong: l.so_luong,
        don_gia_tam: l.don_gia_tam || 0,
        lot_number: l.lot_number || (l.chieu === "ra" ? (view.lot_number || "") : ""),
        serial_numbers: l.serial_numbers || (l.chieu === "ra" ? (view.serial_numbers || "") : ""),
        note: l.note || "",
        orig_item_id: l.orig_item_id,
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
  function saveRecipeFromView() {
    if (!view) return;
    const out = vOutputs[0];
    if (!out) return;
    setRecipePrompt({
      mode: "view",
      defaultValue: `${out.ma_hang || out.ten} (thay thế)`,
      title: "Lưu công thức (BOM) mới",
    });
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
              openExternalSafe(
                api.invExportUrl("productions", "xlsx", { tu: dateRange.tu, den: dateRange.den }),
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

      <DataView
        mobileMode="card"
        desktop={
          <div className="table-wrap">
            <table className="dt">
              <thead>
                <tr>
                  <th>Số CT</th>
                  <th>Ngày</th>
                  <th>Thành phẩm</th>
                  <th>Số Lô / Serial</th>
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
                      <td className="nowrap">
                        {p.lot_number && (
                          <span className="chip gray sm" style={{ marginRight: 4 }} title={`Số lô: ${p.lot_number}`}>
                            Lô: {p.lot_number}
                          </span>
                        )}
                        {p.serial_numbers && (
                          <span className="chip gray sm" title={`Serial: ${p.serial_numbers}`}>
                            SN: {p.serial_numbers}
                          </span>
                        )}
                        {!p.lot_number && !p.serial_numbers && <span className="muted">—</span>}
                      </td>
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
                            type="button"
                            className="ui-btn-icon"
                            title="Xóa lệnh nháp"
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
                    <td colSpan={8}>
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
        }
        mobileCards={
          list.length === 0 ? (
            <div className="empty">
              <div className="empty-ic">🏭</div>
              <div>Chưa có lệnh sản xuất nào.</div>
            </div>
          ) : (
            <div className="ui-mobile-card-list">
              {list.map((p) => {
                const outs = p.lines.filter((l) => l.chieu === "ra");
                const ins = p.lines.filter((l) => l.chieu === "vao");
                const outQ = outs.reduce((s, l) => s + l.so_luong, 0);
                const cost = outs.reduce((s, l) => s + l.gia_tri, 0);
                const posted = p.status === "posted";
                const total = posted ? (p.tong_gia_thanh || cost) : p.tong_gia_thanh_uoc;
                const dv = posted ? (outQ ? total / outQ : 0) : p.gia_thanh_dv_uoc;
                return (
                  <div key={p.id} className="ui-mobile-card" onClick={() => openView(p)}>
                    <div className="ui-mobile-card-head">
                      <div>
                        <div className="ui-mobile-card-title">{p.so_ct || `LSX#${p.id}`}</div>
                        <div className="ui-mobile-card-meta">{p.ngay}</div>
                      </div>
                      <span className={`chip sm ${posted ? "green" : "amber"}`}>
                        {posted ? "Đã ghi sổ" : "Nháp"}
                      </span>
                    </div>
                    <div className="ui-mobile-card-body">
                      <div>
                        <strong>Thành phẩm:</strong>{" "}
                        {outs.map((l) => `${l.ma_hang || l.ten}×${l.so_luong}`).join(", ") || "—"}
                      </div>
                      {ins.length > 0 && (
                        <div className="muted">
                          Tiêu hao: {ins.map((l) => `${l.ma_hang}×${l.so_luong}`).join(", ")}
                        </div>
                      )}
                      {(p.sale_id != null || p.lot_number || p.serial_numbers) && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                          {p.sale_id != null && <span className="chip gray sm">🧾 HĐ bán #{p.sale_id}</span>}
                          {p.lot_number && <span className="chip gray sm">Lô: {p.lot_number}</span>}
                          {p.serial_numbers && <span className="chip gray sm">SN: {p.serial_numbers}</span>}
                        </div>
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 6 }}>
                        <span className="muted">Giá thành</span>
                        <strong>
                          {posted ? vnd(total) : `~${vnd(total)}`} đ
                          {outQ > 1 && dv > 0 ? ` (${posted ? "" : "~"}${vnd(dv)}/đv)` : ""}
                        </strong>
                      </div>
                    </div>
                    <div className="ui-mobile-card-actions" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="ui-btn-chip" onClick={() => openView(p)}>
                        Xem / Sửa
                      </button>
                      {!posted && (
                        <button
                          type="button"
                          className="ui-btn-icon"
                          title="Xóa lệnh nháp"
                          onClick={async () => {
                            if (!window.confirm(`Xóa lệnh nháp LSX#${p.id}?`)) return;
                            await api.invProductionDelete(p.id);
                            load();
                          }}
                        >
                          🗑
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        }
      />

      <AppModal
        open={creating}
        onClose={() => setCreating(false)}
        title="Lệnh sản xuất mới"
        size="full"
        footer={
          <>
            <button type="button" disabled={outputs.length === 0 || consumes.length === 0} onClick={saveRecipe}>
              💾 Lưu công thức
            </button>
            <button type="button" onClick={() => setCreating(false)}>Hủy</button>
            <button
              type="button"
              disabled={outputs.length === 0 || consumes.length === 0 || lines.some((l) => l.so_luong <= 0)}
              onClick={() => saveOrder(false)}
              title="Lưu lệnh sản xuất ở trạng thái nháp (chưa trừ tồn kho)"
            >
              💾 Lưu nháp
            </button>
            <button
              type="button"
              className="primary"
              disabled={
                outputs.length === 0 ||
                consumes.length === 0 ||
                lines.some((l) => l.so_luong <= 0)
              }
              onClick={() => {
                if (over.length > 0) {
                  if (window.confirm(`Có ${over.length} mặt hàng không đủ tồn khả dụng.\n\nBạn có chắc muốn tiếp tục ghi sổ sản xuất (cho phép duyệt âm kho)?`)) {
                    saveOrder(true);
                  }
                } else {
                  saveOrder(true);
                }
              }}
            >
              ✅ Ghi sổ sản xuất
            </button>
          </>
        }
      >
        <FormGrid cols={recipes.length > 0 ? 3 : 2}>
          <label>
            Ngày
            <input className="ui-input" type="date" value={ngay} onChange={(e) => setNgay(e.target.value)} />
          </label>
          <label>
            Ghi chú
            <input className="ui-input" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {recipes.length > 0 && (
            <label>
              Áp công thức
              <select
                className="ui-select"
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
        </FormGrid>
        <FormGrid cols={3} style={{ marginTop: 8 }}>
          <label>
            CP nhân công (622)
            <input
              className="ui-input"
              style={{ textAlign: "right" }}
              type="number"
              min={0}
              value={cpNhanCong}
              onChange={(e) => setCpNhanCong(Number(e.target.value) || 0)}
            />
          </label>
          <label>
            CP SX chung (627)
            <input
              className="ui-input"
              style={{ textAlign: "right" }}
              type="number"
              min={0}
              value={cpSxc}
              onChange={(e) => setCpSxc(Number(e.target.value) || 0)}
            />
          </label>
          <label>
            Giá bán dự kiến (/đvị TP)
            <input
              className="ui-input"
              style={{ textAlign: "right" }}
              type="number"
              min={0}
              value={giaBanDuKien}
              onChange={(e) => setGiaBanDuKien(Number(e.target.value) || 0)}
            />
          </label>
        </FormGrid>

        <h4>Thành phẩm (nhập kho TP)</h4>
        {outputs.map((l) => (
          <div key={l.item_id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
            <b>{l.label}</b> · SL:{" "}
            <input
              className="ui-input"
              style={{ width: 96, textAlign: "right" }}
              type="number"
              min={0}
              value={l.so_luong}
              onChange={(e) => {
                const v = Number(e.target.value) || 0;
                updateOutputQty(v);
              }}
            />{" "}
            <button type="button" className="ui-btn-icon" onClick={() => setLines(lines.filter((x) => x !== l))}>
              ✕
            </button>
          </div>
        ))}
        {outputs.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              className="ui-input"
              placeholder="🔍 tìm mã/tên thành phẩm…"
              value={outQ}
              onChange={(e) => searchOutput(e.target.value)}
            />
            {outResults.slice(0, 5).map((it) => (
              <div key={it.id}>
                <button type="button" className="ui-btn-chip" onClick={() => addOutput(it)}>
                  {it.ma_hang} · {it.ten.slice(0, 50)}
                </button>
              </div>
            ))}
            <div>
              <button type="button" className="btn-sm" onClick={createOutputItem}>
                ＋ Tạo mã thành phẩm mới
              </button>
            </div>
          </div>
        )}

        {/* Batch/Lot and Serial Number Tracking (R3) */}
        {outputs.length > 0 && (
          <FormGrid
            cols={4}
            style={{
              marginTop: 8,
              padding: "10px 12px",
              background: "var(--surface-subtle)",
              border: "1px solid var(--border)",
              borderRadius: 10,
            }}
          >
            <label>
              Số Lô (Lot/Batch)
              <input
                className="ui-input"
                placeholder="vd: LO-202608-01"
                value={lotNumber}
                onChange={(e) => setLotNumber(e.target.value)}
              />
            </label>
            <label>
              Số Serial
              <input
                className="ui-input"
                placeholder="vd: SN001, SN002..."
                value={serialNumbers}
                onChange={(e) => setSerialNumbers(e.target.value)}
              />
            </label>
            <label>
              Ngày sản xuất (NSX)
              <input
                className="ui-input"
                type="date"
                value={mfgDate}
                onChange={(e) => setMfgDate(e.target.value)}
              />
            </label>
            <label>
              Hạn dùng (HSD)
              <input
                className="ui-input"
                type="date"
                value={expDate}
                onChange={(e) => setExpDate(e.target.value)}
              />
            </label>
          </FormGrid>
        )}

        <h4>Vật tư tiêu hao</h4>
        {consumes.length > 0 && (
          <DataView
            mobileMode="scroll"
            desktop={
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
                            className="ui-input"
                            style={{ width: 88, textAlign: "right" }}
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
                            className="ui-input"
                            style={{ width: 110, textAlign: "right" }}
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
                          <button type="button" className="ui-btn-icon" onClick={() => setLines(lines.filter((x) => x !== l))}>
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            }
          />
        )}
        <input
          className="search ui-input"
          placeholder="🔍 Tìm vật tư khả dụng để thêm…"
          value={pickQ}
          onChange={(e) => setPickQ(e.target.value)}
        />
        <DataView
          mobileMode="scroll"
          desktop={
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
          }
        />

        {/* Pre-Production Stock Shortage Summary Warning (R2/R4) */}
        {over.length > 0 && (
          <div className="warn-banner" style={{ marginTop: 10, borderRadius: 12, border: "1px solid var(--amber)", background: "var(--amber-soft)", padding: "10px 14px" }}>
            <div style={{ fontWeight: "bold", color: "var(--amber)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <span>⚠️ Cảnh báo thiếu hụt vật tư trước khi sản xuất ({over.length} mặt hàng thiếu)</span>
            </div>
            <DataView
              mobileMode="scroll"
              desktop={
                <div className="table-wrap" style={{ maxHeight: "140px", overflow: "auto" }}>
                  <table className="dt" style={{ fontSize: "12px", width: "100%" }}>
                    <thead>
                      <tr>
                        <th>Vật tư</th>
                        <th style={{ textAlign: "right" }}>Nhu cầu</th>
                        <th style={{ textAlign: "right" }}>Khả dụng</th>
                        <th style={{ textAlign: "right" }}>Thiếu hụt</th>
                        <th>Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {over.map((l) => {
                        const deficit = Number(Math.max(0, l.so_luong - l.kha_dung).toFixed(4));
                        const isRed = l.kha_dung <= 0;
                        return (
                          <tr key={`${l.item_id}-${l.warehouse_id}`}>
                            <td>{l.label}</td>
                            <td style={{ textAlign: "right" }}>{l.so_luong} {l.dvt}</td>
                            <td style={{ textAlign: "right" }}>{l.kha_dung} {l.dvt}</td>
                            <td style={{ textAlign: "right", color: "var(--red)", fontWeight: "bold" }}>-{deficit} {l.dvt}</td>
                            <td>
                              <span className={`chip sm ${isRed ? "red" : "amber"}`}>
                                {isRed ? "🔴 Hết hàng" : "🟡 Thiếu"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              }
            />
            <p className="muted" style={{ margin: "6px 0 0 0", fontSize: 12 }}>
              💡 Bạn có thể lưu nháp lệnh sản xuất hoặc ghi sổ (sẽ yêu cầu xác nhận lý do duyệt âm kho).
            </p>
          </div>
        )}
      </AppModal>

      <AppModal
        open={!!view}
        onClose={closeView}
        title={view ? `Lệnh sản xuất ${view.so_ct || `LSX#${view.id}`}` : ""}
        subtitle={view ? (view.status === "posted" ? "Trạng thái: Đã ghi sổ" : "Trạng thái: Nháp") : undefined}
        size="full"
        footer={
          view && (
            <>
              <button type="button" onClick={closeView}>Đóng</button>
              {view.status === "draft" && (
                <>
                  <button type="button" disabled={viewBusy} onClick={doViewSave}>
                    💾 Lưu
                  </button>
                  <button
                    type="button"
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
            </>
          )
        }
      >
        {view && (
          <>
            <div style={{ marginBottom: 8 }}>
              <span className={`chip sm ${view.status === "posted" ? "green" : "amber"}`}>
                {view.status === "posted" ? "Đã ghi sổ" : "Nháp"}
              </span>
            </div>
            {err && <div className="error" style={{ marginBottom: 8 }}>{err}</div>}
            {view.sale_id != null && (
              <p className="muted" style={{ margin: "4px 0" }}>
                🧾 Sinh từ HĐ bán #{view.sale_id}
              </p>
            )}
            {view.note && <p className="muted" style={{ margin: "4px 0" }}>{view.note}</p>}
            <div style={{ margin: "6px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                <label style={{ margin: 0 }}>Mô tả</label>
                <button type="button" className="ui-btn-chip" disabled={aiBusy} onClick={aiDescribeView} title="AI nhìn trọn bộ NVL để sinh mô tả">
                  {aiBusy ? "⏳ Đang sinh…" : "✨ AI sinh mô tả"}
                </button>
              </div>
              <textarea
                className="ui-textarea"
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
                <button type="button" className="btn-sm danger" disabled={viewBusy} onClick={viewVoid}>
                  ↩️ Hủy ghi sổ để sửa
                </button>
              </div>
            )}
            <FormGrid cols={2} style={{ margin: "8px 0" }}>
              <label>
                Ngày
                <input
                  className="ui-input"
                  type="date"
                  value={view.ngay}
                  disabled={view.status !== "draft"}
                  onChange={(e) => setView({ ...view, ngay: e.target.value })}
                />
              </label>
              <label>
                Ghi chú
                <input
                  className="ui-input"
                  value={view.note}
                  disabled={view.status !== "draft"}
                  onChange={(e) => setView({ ...view, note: e.target.value })}
                />
              </label>
            </FormGrid>

            {/* Chi phi che bien: nhan cong (622) + SX chung (627) */}
            <FormGrid cols={3} style={{ margin: "6px 0" }}>
              <label>
                CP nhân công (622)
                <input
                  className="ui-input"
                  style={{ textAlign: "right" }}
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
                  className="ui-input"
                  style={{ textAlign: "right" }}
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
                  className="ui-input"
                  style={{ textAlign: "right" }}
                  type="number"
                  min={0}
                  value={view.gia_ban_du_kien}
                  disabled={view.status !== "draft"}
                  onChange={(e) => setView({ ...view, gia_ban_du_kien: Number(e.target.value) || 0 })}
                />
              </label>
            </FormGrid>

            <h4>Thành phẩm (nhập kho — TK 155)</h4>
            <DataView
              mobileMode="scroll"
              desktop={
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
                                className="ui-input"
                                style={{ width: 80, textAlign: "right" }}
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
              }
            />

            {/* Batch / Serial / Mfg / Exp Tracking for Finished Goods in View Modal */}
            <FormGrid
              cols={4}
              style={{
                margin: "8px 0",
                padding: "10px 12px",
                background: "var(--surface-subtle)",
                border: "1px solid var(--border)",
                borderRadius: 10,
              }}
            >
              <label>
                Số Lô (Lot/Batch)
                <input
                  className="ui-input"
                  value={view.lot_number || ""}
                  disabled={view.status !== "draft"}
                  placeholder="—"
                  onChange={(e) => setView({ ...view, lot_number: e.target.value })}
                />
              </label>
              <label>
                Số Serial
                <input
                  className="ui-input"
                  value={view.serial_numbers || ""}
                  disabled={view.status !== "draft"}
                  placeholder="—"
                  onChange={(e) => setView({ ...view, serial_numbers: e.target.value })}
                />
              </label>
              <label>
                Ngày sản xuất
                <input
                  className="ui-input"
                  type="date"
                  value={view.mfg_date || ""}
                  disabled={view.status !== "draft"}
                  onChange={(e) => setView({ ...view, mfg_date: e.target.value })}
                />
              </label>
              <label>
                Hạn dùng
                <input
                  className="ui-input"
                  type="date"
                  value={view.exp_date || ""}
                  disabled={view.status !== "draft"}
                  onChange={(e) => setView({ ...view, exp_date: e.target.value })}
                />
              </label>
            </FormGrid>

            {view.status === "draft" && recipes.length > 0 && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "6px 0" }}>
                <label>
                  🔁 Đổi sang công thức khác (BOM thay thế)
                  <select
                    className="ui-select"
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
                <button type="button" className="ui-btn-chip" onClick={saveRecipeFromView}>
                  💾 Lưu thành công thức mới
                </button>
                <span className="muted" style={{ fontSize: 12 }}>
                  Dùng khi BOM cũ hết NVL (vd đổi thẻ nhớ khác) — chọn BOM đã lưu sẵn, hoặc đổi tay từng
                  dòng bên dưới rồi lưu thành BOM mới để tái sử dụng.
                </span>
              </div>
            )}
            <h4>
              Nguyên vật liệu tiêu hao (TK 621)
              {hasDinhMuc && <span className="muted" style={{ fontWeight: 400 }}> — so định mức / thực tế / chênh lệch</span>}
            </h4>
            <DataView
              mobileMode="scroll"
              desktop={
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
                                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                                  💬 {l.note}
                                </div>
                              )}
                              {view.status === "draft" && (
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                                  <button
                                    type="button"
                                    className="ui-btn-chip"
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
                                    type="button"
                                    className="ui-btn-chip"
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
                                    <div style={{ width: "100%", marginTop: 4 }}>
                                      <input
                                        autoFocus
                                        className="ui-input"
                                        style={{ width: 200 }}
                                        placeholder="tìm mã/tên thay thế…"
                                        value={swapSearch.q}
                                        onChange={(e) => searchSwap(l.id, e.target.value)}
                                      />
                                      {swapSearch.results.slice(0, 6).map((it) => (
                                        <div key={it.id} style={{ marginTop: 4 }}>
                                          <button type="button" className="ui-btn-chip" onClick={() => swapViewLine(l.id, it)}>
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
                                    className="ui-input"
                                    style={{ width: 80, textAlign: "right" }}
                                    type="number"
                                    value={l.so_luong}
                                    onChange={(e) => patchViewLine(l.id, { so_luong: Number(e.target.value) || 0 })}
                                  />
                                  <div className="muted" style={{ fontSize: 12 }}>
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
                                  className="ui-input"
                                  style={{ width: 100, textAlign: "right" }}
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
              }
            />
            {view.status === "draft" && (
              <div style={{ margin: "8px 0", display: "flex", flexDirection: "column", gap: 6 }}>
                <label>
                  ➕ Thêm vật tư vào LSX (vd thiếu "hộp nhôm" chưa có trong BOM)
                  <input
                    className="ui-input"
                    style={{ marginTop: 4 }}
                    placeholder="tìm mã/tên vật tư…"
                    value={addNvlQ}
                    onChange={(e) => searchAddNvl(e.target.value)}
                  />
                </label>
                {addNvlResults.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {addNvlResults.slice(0, 8).map((it) => (
                      <div key={it.id}>
                        <button type="button" className="ui-btn-chip" onClick={() => addViewConsume(it)}>
                          <b>{it.ma_hang}</b> · {it.ten}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Pre-Production Shortage Warning in Draft View Modal */}
            {view.status === "draft" && vConsumes.some((l) => l.so_luong > khaDungFor(l.item_id, l.warehouse_id)) && (
              <div className="warn-banner" style={{ marginTop: 10, borderRadius: 12, border: "1px solid var(--amber)", background: "var(--amber-soft)", padding: "10px 14px" }}>
                <div style={{ fontWeight: "bold", color: "var(--amber)", marginBottom: 6 }}>
                  ⚠️ Cảnh báo: Một số nguyên vật liệu vượt tồn khả dụng tại ngày {view.ngay}
                </div>
                <DataView
                  mobileMode="scroll"
                  desktop={
                    <div className="table-wrap" style={{ maxHeight: "120px", overflow: "auto" }}>
                      <table className="dt" style={{ fontSize: "12px", width: "100%" }}>
                        <thead>
                          <tr>
                            <th>Vật tư</th>
                            <th style={{ textAlign: "right" }}>Nhu cầu</th>
                            <th style={{ textAlign: "right" }}>Khả dụng</th>
                            <th style={{ textAlign: "right" }}>Thiếu hụt</th>
                          </tr>
                        </thead>
                        <tbody>
                          {vConsumes
                            .filter((l) => l.so_luong > khaDungFor(l.item_id, l.warehouse_id))
                            .map((l) => {
                              const kd = khaDungFor(l.item_id, l.warehouse_id);
                              const deficit = Number(Math.max(0, l.so_luong - kd).toFixed(4));
                              return (
                                <tr key={l.id}>
                                  <td>{l.ma_hang} · {l.ten}</td>
                                  <td style={{ textAlign: "right" }}>{l.so_luong}</td>
                                  <td style={{ textAlign: "right" }}>{kd}</td>
                                  <td style={{ textAlign: "right", color: "var(--red)", fontWeight: "bold" }}>-{deficit}</td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  }
                />
              </div>
            )}

            {/* Tong hop gia thanh */}
            <div className="warn-banner" style={{ marginTop: 10 }}>
              {view.status === "draft" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <span>Giá thành ước tính (621+622+627):</span>
                    <b>~{vnd(view.tong_gia_thanh_uoc)} đ</b>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <span>Giá thành đơn vị ước tính:</span>
                    <b>~{vnd(view.gia_thanh_dv_uoc)} đ</b>
                  </div>
                  {giaBan > 0 && view.gia_thanh_dv_uoc > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <span>Tỉ suất LN ước tính:</span>
                      <b>{(((giaBan - view.gia_thanh_dv_uoc) / giaBan) * 100).toFixed(1)}%</b>
                    </div>
                  )}
                  <div className="muted" style={{ fontSize: 12 }}>
                    Ước tính theo giá vốn BQ hiện tại; khi <b>ghi sổ</b> dùng bình quân tại ngày SX. Nhập
                    <b> giá tạm tính</b> cho NVL chưa có giá vốn để không bị 0đ.
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <span>Chi phí NVL trực tiếp (621):</span>
                    <b>{vnd(nvlCost)} đ</b>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <span>Nhân công trực tiếp (622):</span>
                    <b>{vnd(view.cp_nhan_cong)} đ</b>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <span>Chi phí SX chung (627):</span>
                    <b>{vnd(view.cp_sxc)} đ</b>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <span>Tổng giá thành (→ 154 → 155):</span>
                    <b>{vnd(tongGiaThanh)} đ</b>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <span>Giá thành đơn vị:</span>
                    <b>{vnd(giaThanhDv)} đ</b>
                  </div>
                  {giaBan > 0 && (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <span>Giá bán dự kiến:</span>
                        <b>{vnd(giaBan)} đ</b>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <span>Tỉ suất lợi nhuận:</span>
                        <b className={tiSuat != null && tiSuat < 0 ? "chip red sm" : ""}>
                          {tiSuat != null ? `${tiSuat.toFixed(1)}%` : "—"}
                        </b>
                      </div>
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
          </>
        )}
      </AppModal>

      <AppModal
        open={!!newOutputModal}
        onClose={() => setNewOutputModal(null)}
        title="Tạo mã thành phẩm mới"
        size="sm"
        footer={
          <>
            <button type="button" onClick={() => setNewOutputModal(null)}>Hủy</button>
            <button
              type="button"
              className="primary"
              disabled={!newOutputModal?.ma.trim() || !newOutputModal?.ten.trim()}
              onClick={confirmCreateOutputItem}
            >
              Tạo thành phẩm
            </button>
          </>
        }
      >
        {newOutputModal && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label>
              Mã thành phẩm mới (vd TP0027)
              <input
                autoFocus
                className="ui-input"
                placeholder="vd: TP0027"
                value={newOutputModal.ma}
                onChange={(e) => setNewOutputModal({ ...newOutputModal, ma: e.target.value })}
              />
            </label>
            <label>
              Tên thành phẩm
              <input
                className="ui-input"
                placeholder="Tên thành phẩm…"
                value={newOutputModal.ten}
                onChange={(e) => setNewOutputModal({ ...newOutputModal, ten: e.target.value })}
              />
            </label>
          </div>
        )}
      </AppModal>

      <PromptDialog
        open={!!recipePrompt}
        title={recipePrompt?.title || "Lưu công thức"}
        label="Tên công thức (BOM)"
        defaultValue={recipePrompt?.defaultValue || ""}
        placeholder="Nhập tên công thức…"
        onConfirm={confirmSaveRecipe}
        onCancel={() => setRecipePrompt(null)}
      />

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
