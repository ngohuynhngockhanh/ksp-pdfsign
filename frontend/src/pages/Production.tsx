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
  MobileCard,
  MobileCardActions,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  PageHeader,
  PageShell,
  PromptDialog,
  StatusBadge,
  TableSkeleton,
  useConfirm,
  useToast,
} from "../components/ui";
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
  const toast = useToast();
  const askConfirm = useConfirm();

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
  const [addNvlResults, setAddNvlResults] = useState<{ id: number; ma_hang: string; ten: string; dvt: string }[]>([]);
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
      const [prods, recs] = await Promise.all([api.invProductions("", dateRange), api.invRecipes()]);
      setList(Array.isArray(prods) ? prods : []);
      setRecipes(Array.isArray(recs) ? recs : []);
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
      .then((r) => setAvail(Array.isArray(r.rows) ? r.rows : []))
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
      toast.success(`Đã tạo mã thành phẩm ${it.ma_hang}.`);
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
        toast.success(`Đã lưu công thức "${name}".`);
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
      toast.success(`Đã lưu công thức "${name}" — lần sau chọn được ở "Đổi sang công thức khác".`);
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
          toast.success(`Đã ghi sổ lệnh sản xuất LSX#${prod.id}.`);
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
      } else {
        toast.success(`Đã lưu nháp lệnh sản xuất LSX#${prod.id}.`);
      }
      setCreating(false);
      resetCreateForm();
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function handleRecalcCost() {
    const ok = await askConfirm({
      title: "Tính lại giá xuất kho",
      message: "Tính lại giá xuất kho bình quân gia quyền cho toàn bộ sổ kho?",
      confirmLabel: "Tính lại ngay",
      tone: "warning",
    });
    if (!ok) return;
    setErr("");
    try {
      const r = await api.invRecalcCost();
      load();
      toast.success(`Đã tính lại ${r.pairs} cặp (mặt hàng, kho).`);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function handleDeleteDraft(p: InvProduction) {
    const ok = await askConfirm({
      title: "Xóa lệnh sản xuất nháp",
      message: `Xóa lệnh nháp ${p.so_ct || `LSX#${p.id}`}?`,
      confirmLabel: "Xóa lệnh nháp",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.invProductionDelete(p.id);
      toast.success(`Đã xóa lệnh nháp ${p.so_ct || `LSX#${p.id}`}.`);
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function handleCreateAndPost() {
    if (over.length > 0) {
      const ok = await askConfirm({
        title: "Thiếu tồn khả dụng",
        message: `Có ${over.length} mặt hàng không đủ tồn khả dụng. Bạn có chắc muốn tiếp tục ghi sổ sản xuất (cho phép duyệt âm kho)?`,
        confirmLabel: "Tiếp tục ghi sổ",
        tone: "warning",
      });
      if (!ok) return;
    }
    await saveOrder(true);
  }

  function openView(prod: InvProduction) {
    setErr("");
    setView(prod);
    setParam("lsx", String(prod.id));
    if (prod.status === "draft") {
      api
        .invAvailability(prod.ngay)
        .then((r) => setViewAvail(Array.isArray(r.rows) ? r.rows : []))
        .catch(() => {});
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
    if (!view) return;
    const ok = await askConfirm({
      title: "Hủy ghi sổ lệnh sản xuất",
      message: `Hủy ghi sổ LSX#${view.id} để sửa? Tồn kho sẽ được tính lại.`,
      confirmLabel: "Hủy ghi sổ",
      tone: "danger",
    });
    if (!ok) return;
    setViewBusy(true);
    setErr("");
    try {
      const updated = await api.invProductionVoid(view.id);
      setView(updated);
      api
        .invAvailability(updated.ngay)
        .then((r) => setViewAvail(Array.isArray(r.rows) ? r.rows : []))
        .catch(() => {});
      toast.info(`Đã hủy ghi sổ LSX#${view.id}.`);
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
        lot_number: l.lot_number || (l.chieu === "ra" ? view.lot_number || "" : ""),
        serial_numbers: l.serial_numbers || (l.chieu === "ra" ? view.serial_numbers || "" : ""),
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
      if (updated) {
        setView(updated);
        toast.success("Đã lưu lệnh sản xuất.");
      }
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
        toast.success(`Đã ghi sổ lệnh sản xuất ${posted.so_ct || `LSX#${posted.id}`}.`);
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
      toast.success("Đã ghi sổ lệnh sản xuất (có duyệt âm kho).");
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setViewBusy(false);
    }
  }

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
                    item_id: it.id,
                    ma_hang: it.ma_hang,
                    ten: it.ten,
                    dvt: it.dvt,
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
      return;
    }
    let warehouseId = whs.find((w) => w.code === "HH")?.id ?? 1;
    try {
      const c = await api.invItemCost(it.id, view.ngay);
      if (c.warehouse_id != null) warehouseId = c.warehouse_id;
    } catch {
      /* ignore */
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

  async function confirmRemoveViewLine(l: InvProductionLine) {
    const ok = await askConfirm({
      title: "Xóa dòng vật tư",
      message: `Xóa dòng "${l.ma_hang} · ${l.ten}" khỏi lệnh sản xuất?`,
      confirmLabel: "Xóa dòng",
      tone: "danger",
    });
    if (!ok) return;
    setView((v) => (v ? { ...v, lines: v.lines.filter((x) => x.id !== l.id) } : v));
  }

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
      toast.success("AI đã sinh mô tả lệnh sản xuất.");
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

  const vConsumes = view ? view.lines.filter((l) => l.chieu === "vao") : [];
  const vOutputs = view ? view.lines.filter((l) => l.chieu === "ra") : [];
  const nvlCost = vConsumes.reduce((s, l) => s + l.gia_tri, 0);
  const tongGiaThanh = nvlCost + (view?.cp_nhan_cong || 0) + (view?.cp_sxc || 0);
  const outQty = vOutputs.reduce((s, l) => s + l.so_luong, 0);
  const giaThanhDv = outQty ? tongGiaThanh / outQty : 0;
  const giaBan = view?.gia_ban_du_kien || 0;
  const tiSuat = giaBan ? ((giaBan - giaThanhDv) / giaBan) * 100 : null;
  const hasDinhMuc = vConsumes.some((l) => l.so_luong_dinh_muc != null);
  const nvlThieuGia = view?.status === "posted" && vConsumes.some((l) => l.gia_tri === 0);
  const sameItemRecipes = recipes.filter((r) => r.output_item_id === vOutputs[0]?.item_id);
  const viewRecipeOptions = sameItemRecipes.length > 0 ? sameItemRecipes : recipes;
  const activeFilterCount = dateRange.tu || dateRange.den ? 1 : 0;

  return (
    <PageShell data-page="production">
      <PageHeader
        variant="compact"
        icon="factory"
        title="Sản xuất"
        subtitle="Gom nguyên vật liệu và hàng hóa để sản xuất thành phẩm theo giá vốn bình quân gia quyền."
        actions={
          <>
            <AppButton
              variant="secondary"
              leftIcon="refresh"
              title="Chạy lại bình quân gia quyền, khắc phục phiếu treo giá vốn"
              onClick={handleRecalcCost}
            >
              Tính lại giá xuất kho
            </AppButton>
            <AppButton variant="primary" leftIcon="plus" onClick={() => setCreating(true)}>
              Tạo lệnh sản xuất
            </AppButton>
          </>
        }
      />

      <FilterBar
        collapsibleMobile
        activeCount={activeFilterCount}
        onReset={() => setDateRange({ tu: "", den: "" })}
        filters={<DateFilter value={dateRange} onChange={setDateRange} />}
        actions={
          <>
            <StatusBadge tone="brand" size="sm">
              {list.length} lệnh
            </StatusBadge>
            <AppButton
              variant="ghost"
              size="sm"
              leftIcon="file-spreadsheet"
              onClick={() =>
                openExternalSafe(api.invExportUrl("productions", "xlsx", { tu: dateRange.tu, den: dateRange.den }))
              }
            >
              Xuất Excel
            </AppButton>
          </>
        }
      />

      {err && (
        <InlineAlert tone="danger" onDismiss={() => setErr("")}>
          {err}
        </InlineAlert>
      )}

      {!listLoaded ? (
        <TableSkeleton rows={6} cols={8} />
      ) : (
        <DataView
          mobileMode="card"
          empty={
            list.length === 0 ? (
              <EmptyState
                icon="factory"
                title="Chưa có lệnh sản xuất nào"
                description='Bấm "Tạo lệnh sản xuất" để lập lệnh lắp ráp hoặc sản xuất thành phẩm mới.'
                action={
                  <AppButton variant="primary" leftIcon="plus" onClick={() => setCreating(true)}>
                    Tạo lệnh sản xuất
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
                    <th>Số CT</th>
                    <th>Ngày</th>
                    <th>Thành phẩm</th>
                    <th>Số Lô / Serial</th>
                    <th>Tiêu hao</th>
                    <th className="num">Giá thành</th>
                    <th>Trạng thái</th>
                    <th className="ui-col-chk"></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => {
                    const outs = p.lines.filter((l) => l.chieu === "ra");
                    const ins = p.lines.filter((l) => l.chieu === "vao");
                    const outQ = outs.reduce((s, l) => s + l.so_luong, 0);
                    const cost = outs.reduce((s, l) => s + l.gia_tri, 0);
                    const posted = p.status === "posted";
                    const total = posted ? p.tong_gia_thanh || cost : p.tong_gia_thanh_uoc;
                    const dv = posted ? (outQ ? total / outQ : 0) : p.gia_thanh_dv_uoc;
                    return (
                      <tr
                        key={p.id}
                        className="ui-clickable"
                        title="Xem/sửa lệnh sản xuất"
                        onClick={() => openView(p)}
                      >
                        <td className="nowrap">
                          <strong>{p.so_ct || `LSX#${p.id}`}</strong>
                          {p.sale_id != null && (
                            <div className="ui-mt-2">
                              <StatusBadge tone="neutral" size="sm" icon="receipt">
                                HĐ bán #{p.sale_id}
                              </StatusBadge>
                            </div>
                          )}
                        </td>
                        <td className="nowrap">{p.ngay}</td>
                        <td>{outs.map((l) => `${l.ma_hang || l.ten}×${l.so_luong}`).join(", ")}</td>
                        <td className="nowrap">
                          <div className="ui-row">
                            {p.lot_number && (
                              <StatusBadge tone="neutral" size="sm" title={`Số lô: ${p.lot_number}`}>
                                Lô: {p.lot_number}
                              </StatusBadge>
                            )}
                            {p.serial_numbers && (
                              <StatusBadge tone="neutral" size="sm" title={`Serial: ${p.serial_numbers}`}>
                                SN: {p.serial_numbers}
                              </StatusBadge>
                            )}
                            {!p.lot_number && !p.serial_numbers && <span className="muted">—</span>}
                          </div>
                        </td>
                        <td className="muted">{ins.map((l) => `${l.ma_hang}×${l.so_luong}`).join(", ")}</td>
                        <td className="num nowrap">
                          {posted ? vnd(total) : <span className="muted">~{vnd(total)}</span>}
                          {outQ > 1 && dv > 0 && (
                            <div className="muted">
                              {posted ? "" : "~"}
                              {vnd(dv)}/đv
                            </div>
                          )}
                        </td>
                        <td>
                          <StatusBadge tone={posted ? "success" : "warning"} size="sm">
                            {posted ? "Đã ghi sổ" : "Nháp"}
                          </StatusBadge>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {!posted && (
                            <AppButton
                              variant="ghost"
                              size="sm"
                              iconOnly
                              leftIcon="trash"
                              aria-label={`Xóa lệnh nháp ${p.so_ct || `LSX#${p.id}`}`}
                              title="Xóa lệnh nháp"
                              onClick={() => handleDeleteDraft(p)}
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
              {list.map((p) => {
                const outs = p.lines.filter((l) => l.chieu === "ra");
                const ins = p.lines.filter((l) => l.chieu === "vao");
                const outQ = outs.reduce((s, l) => s + l.so_luong, 0);
                const cost = outs.reduce((s, l) => s + l.gia_tri, 0);
                const posted = p.status === "posted";
                const total = posted ? p.tong_gia_thanh || cost : p.tong_gia_thanh_uoc;
                const dv = posted ? (outQ ? total / outQ : 0) : p.gia_thanh_dv_uoc;
                return (
                  <MobileCard key={p.id}>
                    <MobileCardHeader
                      title={p.so_ct || `LSX#${p.id}`}
                      subtitle={p.ngay}
                      badge={
                        <StatusBadge tone={posted ? "success" : "warning"} size="sm">
                          {posted ? "Đã ghi sổ" : "Nháp"}
                        </StatusBadge>
                      }
                    />
                    <MobileCardGrid>
                      <MobileCardRow
                        label="Thành phẩm"
                        value={outs.map((l) => `${l.ma_hang || l.ten}×${l.so_luong}`).join(", ") || "—"}
                        fullWidth
                      />
                      {ins.length > 0 && (
                        <MobileCardRow
                          label="Tiêu hao"
                          value={ins.map((l) => `${l.ma_hang}×${l.so_luong}`).join(", ")}
                          fullWidth
                        />
                      )}
                      <MobileCardRow
                        label="Giá thành"
                        value={`${posted ? vnd(total) : `~${vnd(total)}`} đ${outQ > 1 && dv > 0 ? ` (${posted ? "" : "~"}${vnd(dv)}/đv)` : ""}`}
                        mono
                        fullWidth
                      />
                    </MobileCardGrid>
                    {(p.sale_id != null || p.lot_number || p.serial_numbers) && (
                      <div className="ui-row">
                        {p.sale_id != null && (
                          <StatusBadge tone="neutral" size="sm" icon="receipt">
                            HĐ bán #{p.sale_id}
                          </StatusBadge>
                        )}
                        {p.lot_number && (
                          <StatusBadge tone="neutral" size="sm">
                            Lô: {p.lot_number}
                          </StatusBadge>
                        )}
                        {p.serial_numbers && (
                          <StatusBadge tone="neutral" size="sm">
                            SN: {p.serial_numbers}
                          </StatusBadge>
                        )}
                      </div>
                    )}
                    <div onClick={(e) => e.stopPropagation()}>
                      <MobileCardActions>
                        <AppButton variant="secondary" size="sm" leftIcon="eye" onClick={() => openView(p)}>
                          Xem / Sửa
                        </AppButton>
                        {!posted && (
                          <AppButton
                            variant="ghost"
                            size="sm"
                            iconOnly
                            leftIcon="trash"
                            aria-label={`Xóa lệnh nháp ${p.so_ct || `LSX#${p.id}`}`}
                            title="Xóa lệnh nháp"
                            onClick={() => handleDeleteDraft(p)}
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

      {/* Create Production Modal */}
      <AppModal
        open={creating}
        onClose={() => setCreating(false)}
        title="Lệnh sản xuất mới"
        size="full"
        footer={
          <>
            <AppButton
              variant="secondary"
              leftIcon="bookmark"
              disabled={outputs.length === 0 || consumes.length === 0}
              onClick={saveRecipe}
            >
              Lưu công thức
            </AppButton>
            <AppButton variant="secondary" onClick={() => setCreating(false)}>
              Hủy
            </AppButton>
            <AppButton
              variant="secondary"
              leftIcon="save"
              disabled={outputs.length === 0 || consumes.length === 0 || lines.some((l) => l.so_luong <= 0)}
              onClick={() => saveOrder(false)}
              title="Lưu lệnh sản xuất ở trạng thái nháp (chưa trừ tồn kho)"
            >
              Lưu nháp
            </AppButton>
            <AppButton
              variant="primary"
              leftIcon="check-circle"
              disabled={outputs.length === 0 || consumes.length === 0 || lines.some((l) => l.so_luong <= 0)}
              onClick={handleCreateAndPost}
            >
              Ghi sổ sản xuất
            </AppButton>
          </>
        }
      >
        <div className="ui-stack">
          <FormGrid cols={recipes.length > 0 ? 3 : 2}>
            <FormField label="Ngày" htmlFor="prod-create-date">
              <input
                id="prod-create-date"
                className="ui-input"
                type="date"
                value={ngay}
                onChange={(e) => setNgay(e.target.value)}
              />
            </FormField>
            <FormField label="Ghi chú" htmlFor="prod-create-note">
              <input
                id="prod-create-note"
                className="ui-input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </FormField>
            {recipes.length > 0 && (
              <FormField label="Áp công thức" htmlFor="prod-create-recipe">
                <select
                  id="prod-create-recipe"
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
              </FormField>
            )}
          </FormGrid>

          <FormGrid cols={3}>
            <FormField label="CP nhân công (622)" htmlFor="prod-create-nc">
              <input
                id="prod-create-nc"
                className="ui-input ui-num"
                type="number"
                min={0}
                value={cpNhanCong}
                onChange={(e) => setCpNhanCong(Number(e.target.value) || 0)}
              />
            </FormField>
            <FormField label="CP SX chung (627)" htmlFor="prod-create-sxc">
              <input
                id="prod-create-sxc"
                className="ui-input ui-num"
                type="number"
                min={0}
                value={cpSxc}
                onChange={(e) => setCpSxc(Number(e.target.value) || 0)}
              />
            </FormField>
            <FormField label="Giá bán dự kiến (/đvị TP)" htmlFor="prod-create-price">
              <input
                id="prod-create-price"
                className="ui-input ui-num"
                type="number"
                min={0}
                value={giaBanDuKien}
                onChange={(e) => setGiaBanDuKien(Number(e.target.value) || 0)}
              />
            </FormField>
          </FormGrid>

          <div>
            <h4 className="ui-subhead ui-mt-4">
              <AppIcon name="package" size={16} />
              <span>Thành phẩm (nhập kho TP)</span>
            </h4>
            {outputs.map((l) => (
              <div key={l.item_id} className="ui-row ui-mb-2">
                <b>{l.label}</b>
                <span>· SL:</span>
                <input
                  className="ui-input ui-input-qty"
                  type="number"
                  min={0}
                  value={l.so_luong}
                  onChange={(e) => updateOutputQty(Number(e.target.value) || 0)}
                />
                <AppButton
                  variant="ghost"
                  size="sm"
                  iconOnly
                  leftIcon="x"
                  aria-label="Xóa thành phẩm"
                  onClick={() => setLines(lines.filter((x) => x !== l))}
                />
              </div>
            ))}

            {outputs.length === 0 && (
              <div className="ui-stack--sm">
                <input
                  className="ui-input"
                  placeholder="Tìm mã/tên thành phẩm…"
                  value={outQ}
                  onChange={(e) => searchOutput(e.target.value)}
                />
                {outResults.slice(0, 5).map((it) => (
                  <div key={it.id}>
                    <AppButton variant="secondary" size="sm" onClick={() => addOutput(it)}>
                      {it.ma_hang} · {it.ten.slice(0, 50)}
                    </AppButton>
                  </div>
                ))}
                <div>
                  <AppButton variant="secondary" size="sm" leftIcon="plus" onClick={createOutputItem}>
                    Tạo mã thành phẩm mới
                  </AppButton>
                </div>
              </div>
            )}

            {outputs.length > 0 && (
              <FormGrid cols={4} className="ui-subpanel ui-subpanel--md ui-mt-2">
                <FormField label="Số Lô (Lot/Batch)" htmlFor="prod-lot">
                  <input
                    id="prod-lot"
                    className="ui-input"
                    placeholder="vd: LO-202608-01"
                    value={lotNumber}
                    onChange={(e) => setLotNumber(e.target.value)}
                  />
                </FormField>
                <FormField label="Số Serial" htmlFor="prod-serial">
                  <input
                    id="prod-serial"
                    className="ui-input"
                    placeholder="vd: SN001, SN002..."
                    value={serialNumbers}
                    onChange={(e) => setSerialNumbers(e.target.value)}
                  />
                </FormField>
                <FormField label="Ngày sản xuất (NSX)" htmlFor="prod-mfg">
                  <input
                    id="prod-mfg"
                    className="ui-input"
                    type="date"
                    value={mfgDate}
                    onChange={(e) => setMfgDate(e.target.value)}
                  />
                </FormField>
                <FormField label="Hạn dùng (HSD)" htmlFor="prod-exp">
                  <input
                    id="prod-exp"
                    className="ui-input"
                    type="date"
                    value={expDate}
                    onChange={(e) => setExpDate(e.target.value)}
                  />
                </FormField>
              </FormGrid>
            )}
          </div>

          <div>
            <h4 className="ui-subhead ui-mt-4">
              <AppIcon name="wrench" size={16} />
              <span>Vật tư tiêu hao</span>
            </h4>
            {consumes.length > 0 && (
              <DataView
                mobileMode="scroll"
                desktop={
                  <div className="ui-table-scroll-wrap ui-mb-2" tabIndex={0}>
                    <table className="ui-table">
                      <tbody>
                        {consumes.map((l) => (
                          <tr key={`${l.item_id}-${l.warehouse_id}`}>
                            <td>{l.label}</td>
                            <td className="num muted">
                              khả dụng {l.kha_dung} {l.dvt}
                            </td>
                            <td className="num">
                              <div className="ui-row-end">
                                <input
                                  className="ui-input ui-input-qty"
                                  type="number"
                                  min={0}
                                  value={l.so_luong}
                                  onChange={(e) => {
                                    const v = Number(e.target.value) || 0;
                                    setLines(lines.map((x) => (x === l ? { ...x, so_luong: v } : x)));
                                  }}
                                />
                                {l.so_luong > l.kha_dung && (
                                  <StatusBadge tone="danger" size="sm">
                                    Vượt
                                  </StatusBadge>
                                )}
                              </div>
                            </td>
                            <td className="num" title="Giá tạm tính khi NVL chưa có giá vốn">
                              <input
                                className="ui-input ui-input-price"
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
                            <td className="col-act">
                              <AppButton
                                variant="ghost"
                                size="sm"
                                iconOnly
                                leftIcon="x"
                                aria-label="Xóa vật tư"
                                onClick={() => setLines(lines.filter((x) => x !== l))}
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

            <input
              className="ui-input"
              placeholder="Tìm vật tư khả dụng để thêm…"
              value={pickQ}
              onChange={(e) => setPickQ(e.target.value)}
            />

            <DataView
              mobileMode="scroll"
              desktop={
                <div className="ui-table-scroll-wrap ui-scroll-sm ui-mt-2" tabIndex={0}>
                  <table className="ui-table">
                    <tbody>
                      {pickable.slice(0, 30).map((r) => (
                        <tr
                          key={`${r.item_id}-${r.warehouse_id}`}
                          className="ui-clickable"
                          onClick={() => addConsume(r)}
                        >
                          <td className="nowrap">{r.ma_hang}</td>
                          <td>{r.ten}</td>
                          <td>
                            <StatusBadge tone="neutral" size="sm">
                              {r.warehouse_code}
                            </StatusBadge>
                          </td>
                          <td className="num">
                            khả dụng <b>{r.kha_dung}</b> {r.dvt}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              }
            />
          </div>

          {over.length > 0 && (
            <InlineAlert
              tone="warning"
              title={`Cảnh báo thiếu hụt vật tư trước khi sản xuất (${over.length} mặt hàng thiếu)`}
            >
              <div className="ui-stack--sm ui-mt-2">
                <DataView
                  mobileMode="scroll"
                  desktop={
                    <div className="ui-table-scroll-wrap ui-scroll-xs" tabIndex={0}>
                      <table className="ui-table">
                        <thead>
                          <tr>
                            <th>Vật tư</th>
                            <th className="num">Nhu cầu</th>
                            <th className="num">Khả dụng</th>
                            <th className="num">Thiếu hụt</th>
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
                                <td className="num">
                                  {l.so_luong} {l.dvt}
                                </td>
                                <td className="num">
                                  {l.kha_dung} {l.dvt}
                                </td>
                                <td className="num ui-text-danger">
                                  -{deficit} {l.dvt}
                                </td>
                                <td>
                                  <StatusBadge tone={isRed ? "danger" : "warning"} size="sm" dot>
                                    {isRed ? "Hết hàng" : "Thiếu"}
                                  </StatusBadge>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  }
                />
                <div className="muted">
                  Bạn có thể lưu nháp lệnh sản xuất hoặc ghi sổ (sẽ yêu cầu xác nhận lý do duyệt âm kho).
                </div>
              </div>
            </InlineAlert>
          )}
        </div>
      </AppModal>

      {/* View / Edit Production Modal */}
      <AppModal
        open={!!view}
        onClose={closeView}
        title={
          view ? (
            <span className="ui-row">
              <span>Lệnh sản xuất {view.so_ct || `LSX#${view.id}`}</span>
              <StatusBadge tone={view.status === "posted" ? "success" : "warning"} size="sm">
                {view.status === "posted" ? "Đã ghi sổ" : "Nháp"}
              </StatusBadge>
            </span>
          ) : (
            ""
          )
        }
        subtitle={
          view
            ? view.sale_id != null
              ? `Sinh từ HĐ bán #${view.sale_id}${view.note ? ` · ${view.note}` : ""}`
              : view.note || undefined
            : undefined
        }
        size="full"
        footer={
          view && (
            <>
              <AppButton variant="secondary" onClick={closeView}>
                Đóng
              </AppButton>
              {view.status === "draft" && (
                <>
                  <AppButton variant="secondary" leftIcon="save" disabled={viewBusy} onClick={doViewSave}>
                    Lưu
                  </AppButton>
                  <AppButton
                    variant="primary"
                    leftIcon="check-circle"
                    loading={viewBusy}
                    title={
                      view.lines
                        .filter((l) => l.chieu === "vao")
                        .some((l) => l.so_luong > khaDungFor(l.item_id, l.warehouse_id))
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
          )
        }
      >
        {view && (
          <div className="ui-stack">
            {err && (
              <InlineAlert tone="danger" onDismiss={() => setErr("")}>
                {err}
              </InlineAlert>
            )}

            <div className="ui-stack--xs">
              <div className="ui-row">
                <label className="ui-field-label" htmlFor="prod-view-desc">
                  Mô tả
                </label>
                <AppButton
                  variant="secondary"
                  size="sm"
                  leftIcon="sparkles"
                  loading={aiBusy}
                  onClick={aiDescribeView}
                  title="AI nhìn trọn bộ NVL để sinh mô tả"
                >
                  {aiBusy ? "Đang sinh…" : "AI sinh mô tả"}
                </AppButton>
              </div>
              <textarea
                id="prod-view-desc"
                className="ui-textarea ui-textarea-sm"
                placeholder="Mô tả lệnh sản xuất / công dụng bộ NVL… (bấm AI sinh mô tả để gợi ý)"
                value={view.description}
                disabled={view.status !== "draft"}
                onChange={(e) => setView({ ...view, description: e.target.value })}
              />
            </div>

            {view.status === "posted" && (
              <InlineAlert
                tone="warning"
                title="Đã ghi sổ"
                action={
                  <AppButton variant="danger" size="sm" leftIcon="rotate-ccw" disabled={viewBusy} onClick={viewVoid}>
                    Hủy ghi sổ để sửa
                  </AppButton>
                }
              >
                Số lượng đang bị khóa. Bấm <b>Hủy ghi sổ để sửa</b> nếu cần điều chỉnh.
              </InlineAlert>
            )}

            <FormGrid cols={2}>
              <FormField label="Ngày" htmlFor="prod-view-date">
                <input
                  id="prod-view-date"
                  className="ui-input"
                  type="date"
                  value={view.ngay}
                  disabled={view.status !== "draft"}
                  onChange={(e) => setView({ ...view, ngay: e.target.value })}
                />
              </FormField>
              <FormField label="Ghi chú" htmlFor="prod-view-note">
                <input
                  id="prod-view-note"
                  className="ui-input"
                  value={view.note}
                  disabled={view.status !== "draft"}
                  onChange={(e) => setView({ ...view, note: e.target.value })}
                />
              </FormField>
            </FormGrid>

            <FormGrid cols={3}>
              <FormField label="CP nhân công (622)" htmlFor="prod-view-nc">
                <input
                  id="prod-view-nc"
                  className="ui-input ui-num"
                  type="number"
                  min={0}
                  value={view.cp_nhan_cong}
                  disabled={view.status !== "draft"}
                  onChange={(e) => setView({ ...view, cp_nhan_cong: Number(e.target.value) || 0 })}
                />
              </FormField>
              <FormField label="CP SX chung (627)" htmlFor="prod-view-sxc">
                <input
                  id="prod-view-sxc"
                  className="ui-input ui-num"
                  type="number"
                  min={0}
                  value={view.cp_sxc}
                  disabled={view.status !== "draft"}
                  onChange={(e) => setView({ ...view, cp_sxc: Number(e.target.value) || 0 })}
                />
              </FormField>
              <FormField label="Giá bán dự kiến (/đvị)" htmlFor="prod-view-price">
                <input
                  id="prod-view-price"
                  className="ui-input ui-num"
                  type="number"
                  min={0}
                  value={view.gia_ban_du_kien}
                  disabled={view.status !== "draft"}
                  onChange={(e) => setView({ ...view, gia_ban_du_kien: Number(e.target.value) || 0 })}
                />
              </FormField>
            </FormGrid>

            <div>
              <h4 className="ui-subhead ui-mt-4">
                <AppIcon name="package" size={16} />
                <span>Thành phẩm (nhập kho — TK 155)</span>
              </h4>
              <DataView
                mobileMode="scroll"
                desktop={
                  <div className="ui-table-scroll-wrap" tabIndex={0}>
                    <table className="ui-table">
                      <thead>
                        <tr>
                          <th>Thành phẩm</th>
                          <th className="num">SL</th>
                          <th className="num">Giá thành</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vOutputs.map((l) => (
                          <tr key={l.id}>
                            <td>{l.ma_hang || l.ten}</td>
                            <td className="num">
                              {view.status === "draft" ? (
                                <input
                                  className="ui-input ui-input-qty"
                                  type="number"
                                  value={l.so_luong}
                                  onChange={(e) => patchViewLine(l.id, { so_luong: Number(e.target.value) || 0 })}
                                />
                              ) : (
                                l.so_luong
                              )}
                            </td>
                            <td className="num muted">{vnd(l.gia_tri)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                }
              />

              <FormGrid cols={4} className="ui-subpanel ui-subpanel--md ui-mt-2">
                <FormField label="Số Lô (Lot/Batch)" htmlFor="prod-view-lot">
                  <input
                    id="prod-view-lot"
                    className="ui-input"
                    value={view.lot_number || ""}
                    disabled={view.status !== "draft"}
                    placeholder="—"
                    onChange={(e) => setView({ ...view, lot_number: e.target.value })}
                  />
                </FormField>
                <FormField label="Số Serial" htmlFor="prod-view-serial">
                  <input
                    id="prod-view-serial"
                    className="ui-input"
                    value={view.serial_numbers || ""}
                    disabled={view.status !== "draft"}
                    placeholder="—"
                    onChange={(e) => setView({ ...view, serial_numbers: e.target.value })}
                  />
                </FormField>
                <FormField label="Ngày sản xuất" htmlFor="prod-view-mfg">
                  <input
                    id="prod-view-mfg"
                    className="ui-input"
                    type="date"
                    value={view.mfg_date || ""}
                    disabled={view.status !== "draft"}
                    onChange={(e) => setView({ ...view, mfg_date: e.target.value })}
                  />
                </FormField>
                <FormField label="Hạn dùng" htmlFor="prod-view-exp">
                  <input
                    id="prod-view-exp"
                    className="ui-input"
                    type="date"
                    value={view.exp_date || ""}
                    disabled={view.status !== "draft"}
                    onChange={(e) => setView({ ...view, exp_date: e.target.value })}
                  />
                </FormField>
              </FormGrid>
            </div>

            {view.status === "draft" && recipes.length > 0 && (
              <div className="ui-subpanel ui-subpanel--md ui-stack--sm">
                <div className="ui-row">
                  <FormField label="Đổi sang công thức khác (BOM thay thế)" htmlFor="prod-view-recipe">
                    <select
                      id="prod-view-recipe"
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
                  </FormField>
                  <AppButton variant="secondary" size="sm" leftIcon="bookmark" onClick={saveRecipeFromView}>
                    Lưu thành công thức mới
                  </AppButton>
                </div>
                <span className="muted">
                  Dùng khi BOM cũ hết NVL (vd đổi thẻ nhớ khác) — chọn BOM đã lưu sẵn, hoặc đổi tay từng dòng bên dưới
                  rồi lưu thành BOM mới để tái sử dụng.
                </span>
              </div>
            )}

            <div>
              <h4 className="ui-subhead ui-mt-4">
                <AppIcon name="wrench" size={16} />
                <span>Nguyên vật liệu tiêu hao (TK 621)</span>
                {hasDinhMuc && <span className="muted">— so định mức / thực tế / chênh lệch</span>}
              </h4>
              <DataView
                mobileMode="scroll"
                desktop={
                  <div className="ui-table-scroll-wrap" tabIndex={0}>
                    <table className="ui-table">
                      <thead>
                        <tr>
                          <th>Vật tư</th>
                          {hasDinhMuc && <th className="num">SL định mức</th>}
                          <th className="num">SL thực xuất</th>
                          {hasDinhMuc && <th className="num">Chênh lệch SL</th>}
                          {view.status === "draft" && <th className="num">Giá tạm</th>}
                          {hasDinhMuc && <th className="num">GT định mức</th>}
                          <th className="num">GT thực tế</th>
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
                                <div>
                                  {l.ma_hang} · {l.ten}
                                </div>
                                {l.note && (
                                  <div className="muted ui-row ui-mt-2">
                                    <AppIcon name="message-square" size={12} />
                                    <span>{l.note}</span>
                                  </div>
                                )}
                                {view.status === "draft" && (
                                  <div className="ui-stack--xs ui-mt-2">
                                    <div className="ui-row">
                                      <AppButton
                                        variant="secondary"
                                        size="sm"
                                        leftIcon="refresh"
                                        title="Đổi mã vật tư này (vd hết hàng, thay model khác)"
                                        onClick={() =>
                                          setSwapSearch(
                                            swapSearch?.lineId === l.id ? null : { lineId: l.id, q: "", results: [] },
                                          )
                                        }
                                      >
                                        Đổi mã
                                      </AppButton>
                                      <AppButton
                                        variant="ghost"
                                        size="sm"
                                        leftIcon="trash"
                                        title="Xóa dòng vật tư này khỏi LSX"
                                        onClick={() => confirmRemoveViewLine(l)}
                                      >
                                        Xóa
                                      </AppButton>
                                    </div>
                                    {swapSearch?.lineId === l.id && (
                                      <div className="ui-stack--xs">
                                        <input
                                          autoFocus
                                          className="ui-input ui-input-md"
                                          placeholder="Tìm mã/tên thay thế…"
                                          value={swapSearch.q}
                                          onChange={(e) => searchSwap(l.id, e.target.value)}
                                        />
                                        {swapSearch.results.slice(0, 6).map((it) => (
                                          <AppButton
                                            key={it.id}
                                            variant="secondary"
                                            size="sm"
                                            className="ui-wrap-btn"
                                            onClick={() => swapViewLine(l.id, it)}
                                          >
                                            <b>{it.ma_hang}</b> · {it.ten}
                                          </AppButton>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </td>
                              {hasDinhMuc && <td className="num muted">{dmSl != null ? dmSl : "—"}</td>}
                              <td className="num">
                                {view.status === "draft" ? (
                                  <div className="ui-stack--xs">
                                    <input
                                      className="ui-input ui-input-qty"
                                      type="number"
                                      value={l.so_luong}
                                      onChange={(e) => patchViewLine(l.id, { so_luong: Number(e.target.value) || 0 })}
                                    />
                                    <div className="muted ui-row-end">
                                      <span>khả dụng {kd}</span>
                                      {overkd && (
                                        <StatusBadge tone="danger" size="sm">
                                          Vượt
                                        </StatusBadge>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  l.so_luong
                                )}
                              </td>
                              {hasDinhMuc && (
                                <td className={clSl && clSl > 0 ? "num" : "num muted"}>
                                  {clSl != null ? (clSl > 0 ? `+${vnd(clSl)}` : vnd(clSl)) : "—"}
                                </td>
                              )}
                              {view.status === "draft" && (
                                <td className="num">
                                  <input
                                    className="ui-input ui-input-price"
                                    type="number"
                                    min={0}
                                    placeholder="giá tạm"
                                    value={l.don_gia_tam || 0}
                                    onChange={(e) => patchViewLine(l.id, { don_gia_tam: Number(e.target.value) || 0 })}
                                  />
                                </td>
                              )}
                              {hasDinhMuc && (
                                <td className="num muted">
                                  {l.gia_tri_dinh_muc != null ? vnd(l.gia_tri_dinh_muc) : "—"}
                                </td>
                              )}
                              <td className="num muted">
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
                <div className="ui-stack--sm ui-mt-2">
                  <FormField
                    label='Thêm vật tư vào LSX (vd thiếu "hộp nhôm" chưa có trong BOM)'
                    htmlFor="prod-view-add-nvl"
                  >
                    <input
                      id="prod-view-add-nvl"
                      className="ui-input"
                      placeholder="Tìm mã/tên vật tư…"
                      value={addNvlQ}
                      onChange={(e) => searchAddNvl(e.target.value)}
                    />
                  </FormField>
                  {addNvlResults.length > 0 && (
                    <div className="ui-stack--xs">
                      {addNvlResults.slice(0, 8).map((it) => (
                        <AppButton
                          key={it.id}
                          variant="secondary"
                          size="sm"
                          className="ui-wrap-btn"
                          onClick={() => addViewConsume(it)}
                        >
                          <b>{it.ma_hang}</b> · {it.ten}
                        </AppButton>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {view.status === "draft" &&
              vConsumes.some((l) => l.so_luong > khaDungFor(l.item_id, l.warehouse_id)) && (
                <InlineAlert
                  tone="warning"
                  title={`Một số nguyên vật liệu vượt tồn khả dụng tại ngày ${view.ngay}`}
                >
                  <div className="ui-mt-2">
                    <DataView
                      mobileMode="scroll"
                      desktop={
                        <div className="ui-table-scroll-wrap ui-scroll-xs" tabIndex={0}>
                          <table className="ui-table">
                            <thead>
                              <tr>
                                <th>Vật tư</th>
                                <th className="num">Nhu cầu</th>
                                <th className="num">Khả dụng</th>
                                <th className="num">Thiếu hụt</th>
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
                                      <td>
                                        {l.ma_hang} · {l.ten}
                                      </td>
                                      <td className="num">{l.so_luong}</td>
                                      <td className="num">{kd}</td>
                                      <td className="num ui-text-danger">-{deficit}</td>
                                    </tr>
                                  );
                                })}
                            </tbody>
                          </table>
                        </div>
                      }
                    />
                  </div>
                </InlineAlert>
              )}

            <div className="ui-subpanel ui-subpanel--md ui-stack--sm">
              {view.status === "draft" ? (
                <>
                  <div className="ui-row-between">
                    <span>Giá thành ước tính (621+622+627):</span>
                    <b className="num">~{vnd(view.tong_gia_thanh_uoc)} đ</b>
                  </div>
                  <div className="ui-row-between">
                    <span>Giá thành đơn vị ước tính:</span>
                    <b className="num">~{vnd(view.gia_thanh_dv_uoc)} đ</b>
                  </div>
                  {giaBan > 0 && view.gia_thanh_dv_uoc > 0 && (
                    <div className="ui-row-between">
                      <span>Tỉ suất LN ước tính:</span>
                      <b className="num">{(((giaBan - view.gia_thanh_dv_uoc) / giaBan) * 100).toFixed(1)}%</b>
                    </div>
                  )}
                  <div className="muted">
                    Ước tính theo giá vốn BQ hiện tại; khi <b>ghi sổ</b> dùng bình quân tại ngày SX. Nhập{" "}
                    <b>giá tạm tính</b> cho NVL chưa có giá vốn để không bị 0đ.
                  </div>
                </>
              ) : (
                <>
                  <div className="ui-row-between">
                    <span>Chi phí NVL trực tiếp (621):</span>
                    <b className="num">{vnd(nvlCost)} đ</b>
                  </div>
                  <div className="ui-row-between">
                    <span>Nhân công trực tiếp (622):</span>
                    <b className="num">{vnd(view.cp_nhan_cong)} đ</b>
                  </div>
                  <div className="ui-row-between">
                    <span>Chi phí SX chung (627):</span>
                    <b className="num">{vnd(view.cp_sxc)} đ</b>
                  </div>
                  <div className="ui-row-between">
                    <span>Tổng giá thành (154 → 155):</span>
                    <b className="num">{vnd(tongGiaThanh)} đ</b>
                  </div>
                  <div className="ui-row-between">
                    <span>Giá thành đơn vị:</span>
                    <b className="num">{vnd(giaThanhDv)} đ</b>
                  </div>
                  {giaBan > 0 && (
                    <>
                      <div className="ui-row-between">
                        <span>Giá bán dự kiến:</span>
                        <b className="num">{vnd(giaBan)} đ</b>
                      </div>
                      <div className="ui-row-between">
                        <span>Tỉ suất lợi nhuận:</span>
                        {tiSuat != null && tiSuat < 0 ? (
                          <StatusBadge tone="danger" size="sm">
                            {tiSuat.toFixed(1)}%
                          </StatusBadge>
                        ) : (
                          <b className="num">{tiSuat != null ? `${tiSuat.toFixed(1)}%` : "—"}</b>
                        )}
                      </div>
                    </>
                  )}
                </>
              )}

              {nvlThieuGia && (
                <InlineAlert tone="danger">
                  Có NVL chưa có giá vốn (giá trị = 0) nên giá thành có thể thiếu. Dùng giá tạm tính hoặc bấm &ldquo;Tính
                  lại giá xuất kho&rdquo;.
                </InlineAlert>
              )}
            </div>
          </div>
        )}
      </AppModal>

      {/* New Output Item Modal */}
      <AppModal
        open={!!newOutputModal}
        onClose={() => setNewOutputModal(null)}
        title="Tạo mã thành phẩm mới"
        size="sm"
        footer={
          <>
            <AppButton variant="secondary" onClick={() => setNewOutputModal(null)}>
              Hủy
            </AppButton>
            <AppButton
              variant="primary"
              leftIcon="plus"
              disabled={!newOutputModal?.ma.trim() || !newOutputModal?.ten.trim()}
              onClick={confirmCreateOutputItem}
            >
              Tạo thành phẩm
            </AppButton>
          </>
        }
      >
        {newOutputModal && (
          <div className="ui-stack">
            <FormField label="Mã thành phẩm mới (vd TP0027)" htmlFor="new-out-ma" required>
              <input
                id="new-out-ma"
                autoFocus
                className="ui-input"
                placeholder="vd: TP0027"
                value={newOutputModal.ma}
                onChange={(e) => setNewOutputModal({ ...newOutputModal, ma: e.target.value })}
              />
            </FormField>
            <FormField label="Tên thành phẩm" htmlFor="new-out-ten" required>
              <input
                id="new-out-ten"
                className="ui-input"
                placeholder="Tên thành phẩm…"
                value={newOutputModal.ten}
                onChange={(e) => setNewOutputModal({ ...newOutputModal, ten: e.target.value })}
              />
            </FormField>
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
    </PageShell>
  );
}
