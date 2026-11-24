import { useEffect, useRef, useState } from "react";
import { api, InvItem, InvSale, InvSaleLine, InvSaleSummary, InvWarehouse } from "../api";
import { DateFilter, DateRange } from "../components/DateFilter";
import {
  ActionBar,
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
  StatusBadge,
  TableSkeleton,
  useConfirm,
  useToast,
  type IconName,
  type StatusBadgeTone,
} from "../components/ui";
import { openExternalSafe, safeHttpUrl } from "../utils/url";
import { getParam, setParam } from "../util";

function vnd(n: number): string {
  return Math.round(n).toLocaleString("vi-VN");
}

function qty(n: number): string {
  return Number(n.toFixed(4)).toLocaleString("vi-VN");
}

const STATUS_META: Record<string, [StatusBadgeTone, string]> = {
  draft: ["warning", "Nháp"],
  reviewed: ["success", "Đã duyệt"],
  void: ["neutral", "Hủy"],
};

const SOURCE_LABEL: Record<string, string> = {
  xml: "XML",
  pdf: "PDF",
  scan_ai: "AI",
  manual: "Tay",
};

const CLASS_META: Record<string, [StatusBadgeTone, string]> = {
  inut: ["brand", "iNut"],
  camera: ["warning", "Camera"],
  bo: ["danger", "Bộ lắp đặt"],
  phan_mem: ["info", "Phần mềm"],
  other: ["neutral", "Khác"],
};

const FULFIL_META: Record<string, [StatusBadgeTone, IconName, string]> = {
  du: ["success", "check-circle", "Đã xuất đủ"],
  mot_phan: ["warning", "clock", "Một phần"],
  chua: ["danger", "alert-circle", "Chưa xuất"],
  na: ["neutral", "minus", "DV/PM"],
};

type BomRow = {
  item_id: number | null;
  ma_hang: string;
  ten: string;
  dvt: string;
  warehouse_id: number;
  so_luong: number;
  don_gia_bq: number;
  thue_suat_est: number;
  kha_dung: number;
  note: string;
  q: string;
  results: InvItem[];
};

type BomState = {
  lineId: number;
  lineName: string;
  ngay: string;
  giaBan: number;
  outputItemId: number | null;
  outputLabel: string;
  outputMaHang: string;
  saveRecipe: boolean;
  recipeName: string;
  rows: BomRow[];
  aiNote: string;
  aiBusy: boolean;
  context: string;
  test: { level: "ok" | "warn" | "error"; messages: string[] } | null;
  draftSavedAt: number | null;
};

type BomDraft = {
  rows: Array<Omit<BomRow, "results" | "q">>;
  outputItemId: number | null;
  outputLabel: string;
  outputMaHang: string;
  saveRecipe: boolean;
  recipeName: string;
  context: string;
  savedAt: number;
};

function bomDraftKey(saleId: number, lineId: number): string {
  return `ghepbo:${saleId}:${lineId}`;
}

const NEW_BOM_ROW: Omit<BomRow, "warehouse_id"> = {
  item_id: null,
  ma_hang: "",
  ten: "",
  dvt: "",
  so_luong: 1,
  don_gia_bq: 0,
  thue_suat_est: 8,
  kha_dung: 0,
  note: "",
  q: "",
  results: [],
};

function validateBom(rows: BomRow[]): { level: "ok" | "warn" | "error"; messages: string[] } {
  if (!rows.length) {
    return { level: "error", messages: ["Chưa có linh kiện nào — bấm AI gợi ý hoặc Thêm dòng."] };
  }
  const messages: string[] = [];
  let level: "ok" | "warn" | "error" = "ok";
  rows.forEach((r, i) => {
    const label = r.ten || r.q || `Dòng ${i + 1}`;
    if (!r.item_id) {
      messages.push(`"${label}": CHƯA gán mã trong kho — dòng này sẽ KHÔNG được tính, thiếu linh kiện thật khi ghi sổ.`);
      level = "error";
    } else if (!r.so_luong || r.so_luong <= 0) {
      messages.push(`"${label}": số lượng phải > 0.`);
      level = "error";
    } else if (r.kha_dung < r.so_luong) {
      messages.push(
        `"${label}": thiếu tại ngày HĐ (cần ${qty(r.so_luong)}, khả dụng ${qty(r.kha_dung)}) — kiểm tra lại ngày nhập hàng.`,
      );
      if (level === "ok") level = "warn";
    }
  });
  const byItem = new Map<number, number>();
  rows.forEach((r) => {
    if (r.item_id) byItem.set(r.item_id, (byItem.get(r.item_id) ?? 0) + 1);
  });
  for (const [itemId, count] of byItem) {
    if (count > 1) {
      const ma = rows.find((r) => r.item_id === itemId)?.ma_hang ?? itemId;
      messages.push(
        `Mã "${ma}" xuất hiện ${count} dòng riêng — có thể do AI trả trùng, cân nhắc gộp số lượng lại thành 1 dòng.`,
      );
      if (level === "ok") level = "warn";
    }
  }
  if (!messages.length) messages.push("Đủ linh kiện, đủ tồn tại ngày HĐ — có thể tạo lệnh.");
  return { level, messages };
}

function bomTotals(rows: BomRow[], giaBan: number) {
  const matched = rows.filter((r) => r.item_id);
  const costPretax = matched.reduce((s, r) => s + r.so_luong * r.don_gia_bq, 0);
  const costWithTax = matched.reduce((s, r) => s + r.so_luong * r.don_gia_bq * (1 + r.thue_suat_est / 100), 0);
  const priceLow = costPretax > 0 ? costPretax / 0.85 : 0;
  const priceHigh = costPretax > 0 ? costPretax / 0.8 : 0;
  const marginPct = giaBan > 0 ? ((giaBan - costPretax) / giaBan) * 100 : null;
  return { costPretax, costWithTax, priceLow, priceHigh, marginPct };
}

const _thisYear = new Date().getFullYear();

export function SalesInvoice() {
  const toast = useToast();
  const askConfirm = useConfirm();

  const [list, setList] = useState<InvSale[]>([]);
  const [statusF, setStatusF] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>({
    tu: `${_thisYear}-01-01`,
    den: `${_thisYear}-12-31`,
  });
  const [summary, setSummary] = useState<InvSaleSummary | null>(null);
  const [cur, setCur] = useState<InvSale | null>(null);
  const [whs, setWhs] = useState<InvWarehouse[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [lineSearch, setLineSearch] = useState<{ lineId: number; q: string; results: InvItem[] } | null>(null);
  const [bom, setBom] = useState<BomState | null>(null);
  const [listLoaded, setListLoaded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const autoHdRef = useRef(false);
  const autoGhepboRef = useRef(false);
  const whByCode = (code: string) => whs.find((w) => w.code === code)?.id ?? whs[0]?.id ?? 0;

  async function load() {
    setErr("");
    try {
      const rows = await api.invSales(statusF, dateRange);
      setList(Array.isArray(rows) ? rows : []);
      api
        .invSaleSummary(statusF, dateRange)
        .then(setSummary)
        .catch(() => setSummary(null));
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

  // F5 giu context: sau khi list load lan dau, tu mo lai modal chi tiet theo ?hd=
  useEffect(() => {
    if (!listLoaded || autoHdRef.current) return;
    autoHdRef.current = true;
    const hd = getParam("hd");
    if (hd) open(Number(hd));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listLoaded]);

  // Sau khi cur (chi tiet HD) load xong, tu mo modal ghep bo theo ?ghepbo=<line_id>
  useEffect(() => {
    if (!cur || autoGhepboRef.current) return;
    const gb = getParam("ghepbo");
    if (!gb) {
      autoGhepboRef.current = true;
      return;
    }
    const line = cur.lines.find((l) => l.id === Number(gb));
    if (line) {
      autoGhepboRef.current = true;
      openBom(line);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur]);

  // Auto-save nhap ghep bo vao localStorage (debounce ~500ms)
  useEffect(() => {
    if (!bom || !cur) return;
    const key = bomDraftKey(cur.id, bom.lineId);
    const t = setTimeout(() => {
      const draft: BomDraft = {
        rows: bom.rows.map(({ results: _results, q: _q, ...rest }) => rest),
        outputItemId: bom.outputItemId,
        outputLabel: bom.outputLabel,
        outputMaHang: bom.outputMaHang,
        saveRecipe: bom.saveRecipe,
        recipeName: bom.recipeName,
        context: bom.context,
        savedAt: Date.now(),
      };
      try {
        localStorage.setItem(key, JSON.stringify(draft));
      } catch {
        /* ignore */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [bom, cur]);

  function exportParams() {
    return sel.size > 0
      ? { ids: [...sel].join(",") }
      : { status_f: statusF, tu: dateRange.tu, den: dateRange.den };
  }

  async function upload(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true);
    setErr("");
    try {
      const r = await api.invSaleUpload(Array.from(files));
      const ok = r.results.filter((x) => x.ok).length;
      const fail = r.results.filter((x) => !x.ok);
      if (fail.length) setErr(`${fail.length} file lỗi: ` + fail.map((f) => `${f.filename}: ${f.error}`).join("; "));
      else if (!ok) setErr("Không import được hóa đơn nào.");
      else toast.success(`Đã nạp ${ok} hóa đơn bán ra.`);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function doImportUrl() {
    if (!url.trim()) return;
    setBusy(true);
    try {
      await api.invSaleImportUrl(url.trim());
      setUrlOpen(false);
      setUrl("");
      toast.success("Đã import hóa đơn từ liên kết.");
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function syncIhoadon() {
    setBusy(true);
    setErr("");
    try {
      const r = await api.invSaleSyncIhoadon();
      await load();
      const warning = r.errors ? ` (${r.errors} hóa đơn lỗi hoặc chưa có XML)` : "";
      const msg = `Đồng bộ iHOADON từ 01/01/2026 xong: ${r.imported} mới, ${r.skipped} đã có. PDF/XML đã lưu vào CRM.${warning}`;
      if (r.errors) toast.warning(msg, 6500);
      else toast.success(msg, 6000);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function open(id: number) {
    try {
      setCur(await api.invSale(id));
      setLineSearch(null);
      setParam("hd", String(id));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function closeCur() {
    setCur(null);
    setParam("hd", null);
  }

  function patchLine(lineId: number, patch: Partial<InvSaleLine>) {
    setCur((c) =>
      c
        ? {
            ...c,
            lines: c.lines.map((l) => {
              if (l.id !== lineId) return l;
              const next = { ...l, ...patch };
              if ("so_luong" in patch || "don_gia_ban" in patch) {
                next.thanh_tien = Math.round(next.so_luong * next.don_gia_ban);
                next.lech_dong = false;
              }
              return next;
            }),
          }
        : c,
    );
  }

  async function saveDraft(markReviewed = false) {
    if (!cur) return;
    setBusy(true);
    try {
      const body = {
        so_hd: cur.so_hd,
        ky_hieu: cur.ky_hieu,
        mst_mua: cur.mst_mua,
        ten_mua: cur.ten_mua,
        ngay: cur.ngay,
        status: markReviewed ? "reviewed" : undefined,
        lines: cur.lines.map((l) => ({
          stt: l.stt,
          ten_raw: l.ten_raw,
          dvt: l.dvt,
          so_luong: l.so_luong,
          don_gia_ban: l.don_gia_ban,
          thanh_tien: l.thanh_tien,
          thue_suat: l.thue_suat,
          thue_kct: l.thue_kct,
          item_id: l.item_id,
          warehouse_id: l.warehouse_id,
          match_kind: l.match_kind,
          line_class: l.line_class,
          fulfil_kind: l.fulfil_kind,
        })),
      };
      const updated = await api.invSaleSave(cur.id, body);
      setCur(updated);
      toast.success(markReviewed ? "Đã lưu và đánh dấu hóa đơn đã duyệt." : "Đã lưu hóa đơn bán.");
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function genDocs() {
    if (!cur) return;
    const ok = await askConfirm({
      title: "Sinh chứng từ nháp",
      message:
        "Sinh phiếu xuất kho + lệnh sản xuất dạng NHÁP từ hóa đơn này? Chưa trừ kho — anh vào tab Xuất kho / Sản xuất kiểm tra rồi tự ghi sổ (hệ thống sẽ chặn âm kho khi ghi).",
      confirmLabel: "Sinh chứng từ (nháp)",
      tone: "primary",
    });
    if (!ok) return;
    setBusy(true);
    setErr("");
    try {
      const saveBody = {
        so_hd: cur.so_hd,
        ky_hieu: cur.ky_hieu,
        mst_mua: cur.mst_mua,
        ten_mua: cur.ten_mua,
        ngay: cur.ngay,
        lines: cur.lines.map((l) => ({
          stt: l.stt,
          ten_raw: l.ten_raw,
          dvt: l.dvt,
          so_luong: l.so_luong,
          don_gia_ban: l.don_gia_ban,
          thanh_tien: l.thanh_tien,
          thue_suat: l.thue_suat,
          thue_kct: l.thue_kct,
          item_id: l.item_id,
          warehouse_id: l.warehouse_id,
          match_kind: l.match_kind,
          line_class: l.line_class,
          fulfil_kind: l.fulfil_kind,
        })),
      };
      await api.invSaleSave(cur.id, saveBody);
      const r = await api.invSaleGenerate(cur.id);
      setCur(await api.invSale(cur.id));
      load();
      const baseMsg = `Đã tạo ${r.issues.length} phiếu xuất + ${r.productions.length} lệnh sản xuất (nháp).`;
      if (r.warnings.length) {
        toast.warning(`${baseMsg} Lưu ý: ${r.warnings.join("; ")}`, 7500);
      } else {
        toast.success(baseMsg, 5500);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openBom(l: InvSaleLine) {
    if (!cur) return;
    setErr("");
    let draft: BomDraft | null = null;
    try {
      const raw = localStorage.getItem(bomDraftKey(cur.id, l.id));
      if (raw) {
        const parsed = JSON.parse(raw) as BomDraft;
        if (!l.item_id || parsed.outputItemId === l.item_id) {
          draft = parsed;
        }
      }
    } catch {
      /* ignore */
    }
    let ma = "";
    if (!draft && !l.item_id) {
      try {
        ma = (await api.invSuggestItemCode()).code;
      } catch {
        /* ignore */
      }
    }
    setBom(
      draft
        ? {
            lineId: l.id,
            lineName: l.ten_raw,
            ngay: cur.ngay,
            giaBan: l.don_gia_ban || (l.so_luong ? l.thanh_tien / l.so_luong : 0),
            outputItemId: draft.outputItemId,
            outputLabel: draft.outputLabel,
            outputMaHang: draft.outputMaHang,
            saveRecipe: draft.saveRecipe,
            recipeName: draft.recipeName,
            rows: draft.rows.map((r) => ({ ...r, q: "", results: [] })),
            aiNote: "",
            aiBusy: false,
            context: draft.context,
            test: null,
            draftSavedAt: draft.savedAt,
          }
        : {
            lineId: l.id,
            lineName: l.ten_raw,
            ngay: cur.ngay,
            giaBan: l.don_gia_ban || (l.so_luong ? l.thanh_tien / l.so_luong : 0),
            outputItemId: l.item_id ?? null,
            outputLabel: l.item_id ? `${l.item_ma_hang} · ${l.item_ten}` : "",
            outputMaHang: ma,
            saveRecipe: true,
            recipeName: l.ten_raw,
            rows: [],
            aiNote: "",
            aiBusy: false,
            context: "",
            test: null,
            draftSavedAt: null,
          },
    );
    setParam("ghepbo", String(l.id));
  }

  function closeBom() {
    setBom(null);
    setParam("ghepbo", null);
  }

  function discardDraft() {
    if (!cur || !bom) return;
    try {
      localStorage.removeItem(bomDraftKey(cur.id, bom.lineId));
    } catch {
      /* ignore */
    }
    const l = cur.lines.find((x) => x.id === bom.lineId);
    if (l) openBom(l);
  }

  function setRow(i: number, patch: Partial<BomRow>) {
    setBom((b) =>
      b ? { ...b, rows: b.rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)), test: null } : b,
    );
  }

  function addRow() {
    setBom((b) =>
      b ? { ...b, rows: [...b.rows, { ...NEW_BOM_ROW, warehouse_id: whByCode("HH") }], test: null } : b,
    );
  }

  function delRow(i: number) {
    setBom((b) => (b ? { ...b, rows: b.rows.filter((_, idx) => idx !== i), test: null } : b));
  }

  async function searchRow(i: number, q: string) {
    setRow(i, { q });
    if (q.trim().length >= 1) {
      try {
        setRow(i, { results: await api.invItems(q) });
      } catch {
        /* ignore */
      }
    }
  }

  async function pickLineItem(lineId: number, it: { id: number; ma_hang: string; ten: string }) {
    let whId: number | undefined;
    try {
      const c = await api.invItemCost(it.id, cur?.ngay ?? "");
      if (c.warehouse_id != null) whId = c.warehouse_id;
    } catch {
      /* ignore */
    }
    try {
      if (cur) localStorage.removeItem(bomDraftKey(cur.id, lineId));
    } catch {
      /* ignore */
    }
    if (!cur) return;
    const nextLines = cur.lines.map((l) =>
      l.id === lineId
        ? {
            ...l,
            item_id: it.id,
            item_ma_hang: it.ma_hang,
            item_ten: it.ten,
            match_kind: "manual",
            ...(whId != null ? { warehouse_id: whId } : {}),
          }
        : l,
    );
    setCur({ ...cur, lines: nextLines });
    try {
      const updated = await api.invSaleSave(cur.id, {
        so_hd: cur.so_hd,
        ky_hieu: cur.ky_hieu,
        mst_mua: cur.mst_mua,
        ten_mua: cur.ten_mua,
        ngay: cur.ngay,
        lines: nextLines.map((l) => ({
          stt: l.stt,
          ten_raw: l.ten_raw,
          dvt: l.dvt,
          so_luong: l.so_luong,
          don_gia_ban: l.don_gia_ban,
          thanh_tien: l.thanh_tien,
          thue_suat: l.thue_suat,
          thue_kct: l.thue_kct,
          item_id: l.item_id,
          warehouse_id: l.warehouse_id,
          match_kind: l.match_kind,
          line_class: l.line_class,
          fulfil_kind: l.fulfil_kind,
        })),
      });
      setCur(updated);
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function rematchLine(l: InvSaleLine) {
    if (!cur) return;
    setBusy(true);
    try {
      const r = await api.invSaleRematch(cur.id, l.id);
      if (r.item_id) {
        if (r.changed) {
          toast.success(`Đã khớp lại: ${l.item_ma_hang || "(chưa có mã)"} → ${r.ma_hang} · ${r.ten}`);
        } else {
          toast.info(`Khớp lại vẫn ra mã hiện tại (${r.ma_hang}) — không đổi.`);
        }
      } else {
        toast.warning("Vẫn không tìm được mã khớp trong danh mục — kiểm tra hoặc chọn tay.");
      }
      setCur(await api.invSale(cur.id));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function pickRow(i: number, it: InvItem) {
    setRow(i, { item_id: it.id, ma_hang: it.ma_hang, ten: it.ten, dvt: it.dvt, results: [], q: "" });
    try {
      const c = await api.invItemCost(it.id, bom?.ngay ?? "");
      setRow(i, {
        don_gia_bq: c.don_gia_bq,
        thue_suat_est: c.thue_suat_est,
        kha_dung: c.kha_dung_tai_ngay,
        ...(c.warehouse_id != null ? { warehouse_id: c.warehouse_id } : {}),
      });
    } catch {
      /* ignore */
    }
  }

  type BomComponent = Awaited<ReturnType<typeof api.invSaleSuggestBom>>["components"][number];

  function mapAiComponents(components: BomComponent[]): BomRow[] {
    return components.map((c) => ({
      item_id: c.match?.item_id ?? null,
      ma_hang: c.match?.ma_hang ?? "",
      ten: c.match?.ten ?? c.ten,
      dvt: c.dvt || c.match?.dvt || "",
      warehouse_id: c.match?.warehouse_id ?? whByCode("HH"),
      so_luong: c.so_luong || 1,
      don_gia_bq: c.don_gia_bq || 0,
      thue_suat_est: c.thue_suat_est || 8,
      kha_dung: c.kha_dung_tai_ngay || 0,
      note: c.ly_do || "",
      q: "",
      results: [],
    }));
  }

  function unmatchedNote(note: string, unmatchedCount: number): string {
    return (
      note +
      (unmatchedCount
        ? ` (${unmatchedCount} linh kiện AI gợi ý CHƯA có mã trong kho — cần tạo mới hoặc chọn tay)`
        : "")
    );
  }

  function mergeBomRows(rows: BomRow[]): { rows: BomRow[]; mergedCount: number } {
    const order: number[] = [];
    const byItem = new Map<number, BomRow>();
    const noItem: BomRow[] = [];
    let mergedCount = 0;
    for (const r of rows) {
      if (!r.item_id) {
        noItem.push(r);
        continue;
      }
      const ex = byItem.get(r.item_id);
      if (ex) {
        ex.so_luong += r.so_luong;
        if (r.note && !ex.note.includes(r.note)) ex.note = ex.note ? `${ex.note}; ${r.note}` : r.note;
        mergedCount++;
      } else {
        byItem.set(r.item_id, { ...r });
        order.push(r.item_id);
      }
    }
    return { rows: [...order.map((id) => byItem.get(id) as BomRow), ...noItem], mergedCount };
  }

  async function suggestBomViaJob(
    saleId: number,
    lineId: number,
    context: string,
    existing?: { ten: string; so_luong: number; dvt?: string }[],
  ) {
    const { job_id } = await api.invSaleSuggestBomStart(saleId, lineId, context, existing);
    for (let i = 0; i < 72; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      const j = await api.invSaleSuggestBomJob(job_id);
      if (j.status === "done" && j.result) return j.result;
      if (j.status === "error") throw new Error(j.error || "AI lỗi");
    }
    throw new Error("AI xử lý quá lâu — thử lại sau");
  }

  async function aiSuggestBom() {
    if (!cur || !bom) return;
    if (bom.rows.some((r) => r.item_id || r.q)) {
      const ok = await askConfirm({
        title: "Thay thế danh sách linh kiện hiện tại",
        message: `Đã có ${bom.rows.length} dòng — AI gợi ý mới sẽ THAY THẾ toàn bộ. Tiếp tục?`,
        confirmLabel: "Thay thế bằng AI",
        tone: "warning",
      });
      if (!ok) return;
    }
    setBom({ ...bom, aiBusy: true });
    try {
      const r = await suggestBomViaJob(cur.id, bom.lineId, bom.context);
      const { rows, mergedCount } = mergeBomRows(mapAiComponents(r.components));
      const dupNote = mergedCount ? ` (đã tự gộp ${mergedCount} dòng trùng mã)` : "";
      setBom((b) =>
        b
          ? {
              ...b,
              rows,
              aiNote: unmatchedNote(r.note || "", r.totals.unmatched_count) + dupNote,
              aiBusy: false,
              test: null,
            }
          : b,
      );
    } catch (e) {
      setErr((e as Error).message);
      setBom((b) => (b ? { ...b, aiBusy: false } : b));
    }
  }

  async function aiSuggestMore() {
    if (!cur || !bom) return;
    setBom({ ...bom, aiBusy: true });
    try {
      const existing = bom.rows
        .filter((r) => r.item_id || r.ten)
        .map((r) => ({ ten: r.ten || r.ma_hang, so_luong: r.so_luong, dvt: r.dvt }));
      const r = await suggestBomViaJob(cur.id, bom.lineId, bom.context, existing);
      const added = mapAiComponents(r.components);
      const { rows: merged, mergedCount } = mergeBomRows([...bom.rows, ...added]);
      const dupNote = mergedCount ? ` (đã tự gộp ${mergedCount} dòng trùng mã với phần đã có)` : "";
      const note = added.length
        ? unmatchedNote(r.note || "", r.totals.unmatched_count) + dupNote
        : "AI thấy các linh kiện hiện tại đã đủ theo quy mô thực tế — không có gì cần bổ sung thêm.";
      setBom((b) => (b ? { ...b, rows: merged, aiNote: note, aiBusy: false, test: null } : b));
    } catch (e) {
      setErr((e as Error).message);
      setBom((b) => (b ? { ...b, aiBusy: false } : b));
    }
  }

  function testBom() {
    setBom((b) => (b ? { ...b, test: validateBom(b.rows) } : b));
  }

  async function submitBom() {
    if (!cur || !bom) return;
    setErr("");
    const v = validateBom(bom.rows);
    setBom({ ...bom, test: v });
    if (v.level === "error") {
      setErr("Còn dòng chưa hợp lệ — bấm Kiểm tra để xem chi tiết trước khi tạo lệnh.");
      return;
    }
    if (v.level === "warn") {
      const ok = await askConfirm({
        title: "Thiếu tồn linh kiện tại ngày HĐ",
        message:
          "Một số linh kiện CHƯA đủ tồn tại ngày HĐ (xem mục Kiểm tra). Vẫn tạo lệnh nháp? (Anh có thể sửa ngày nhập hàng trước khi ghi sổ thật — hệ thống sẽ chặn nếu vẫn âm kho lúc ghi sổ.)",
        confirmLabel: "Vẫn tạo lệnh nháp",
        tone: "warning",
      });
      if (!ok) return;
    }
    const comps = bom.rows.map((r) => ({
      item_id: r.item_id as number,
      warehouse_id: r.warehouse_id,
      so_luong: r.so_luong,
      note: r.note,
    }));
    setBusy(true);
    try {
      const r = await api.invSaleAssemble(cur.id, bom.lineId, {
        output_item_id: bom.outputItemId,
        output_ma_hang: bom.outputMaHang,
        output_warehouse_id: whByCode("TP"),
        components: comps,
        save_recipe: bom.saveRecipe,
        recipe_name: bom.recipeName,
      });
      const baseMsg =
        `Đã tạo lệnh ghép bộ (nháp) LSX #${r.production_id}` +
        (r.recipe_id ? ` + lưu mẫu #${r.recipe_id}` : "") +
        ". Vào tab Sản xuất kiểm tra & ghi sổ (hệ thống chặn âm kho).";
      if (r.warnings?.length) {
        toast.warning(`${baseMsg} Cảnh báo: ${r.warnings.join("; ")}`, 7500);
      } else {
        toast.success(baseMsg, 6000);
      }
      try {
        localStorage.removeItem(bomDraftKey(cur.id, bom.lineId));
      } catch {
        /* ignore */
      }
      closeBom();
      open(cur.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function searchLine(lineId: number, q: string) {
    setLineSearch({ lineId, q, results: lineSearch?.lineId === lineId ? lineSearch.results : [] });
    if (q.trim().length >= 1) {
      try {
        const r = await api.invItems(q);
        setLineSearch((prev) => (prev && prev.lineId === lineId ? { ...prev, results: r } : prev));
      } catch {
        /* ignore */
      }
    }
  }

  async function bulkDelete() {
    if (!sel.size) return;
    const ok = await askConfirm({
      title: "Xóa hóa đơn bán đã chọn",
      message: `Xác nhận xóa ${sel.size} hóa đơn bán đã chọn?`,
      confirmLabel: `Xóa (${sel.size})`,
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.invSaleBulkDelete(Array.from(sel));
      toast.success(`Đã xóa ${sel.size} hóa đơn bán.`);
      setSel(new Set());
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function toggle(id: number) {
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  const activeFilterCount = (statusF ? 1 : 0) + (dateRange.tu || dateRange.den ? 1 : 0);

  return (
    <PageShell data-page="sales-invoice">
      <PageHeader
        variant="compact"
        icon="receipt"
        title="Hóa đơn bán ra"
        subtitle="Quản lý hóa đơn bán, đối chiếu xuất kho và bóc tách BOM ghép bộ sản xuất."
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.xml,.zip,.xlsx"
              multiple
              className="ui-hidden"
              onChange={(e) => upload(e.target.files)}
            />
            <AppButton variant="secondary" leftIcon="link" onClick={() => setUrlOpen(true)}>
              Từ link
            </AppButton>
            <AppButton variant="secondary" leftIcon="refresh" loading={busy} onClick={syncIhoadon}>
              {busy ? "Đang đồng bộ…" : "Sync iHOADON"}
            </AppButton>
            <AppButton
              variant="primary"
              leftIcon="upload"
              loading={busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? "Đang xử lý…" : "Nạp hóa đơn"}
            </AppButton>
          </>
        }
      />

      {summary && typeof summary.ti_suat_ln === "number" && (
        <KpiStrip
          columns={4}
          items={[
            {
              label: "Số hóa đơn",
              value: summary.so_hd_count,
              sub: "Bỏ HĐ hủy / điều chỉnh",
              icon: "receipt",
              tone: "brand",
            },
            {
              label: "Doanh thu trước thuế",
              value: `${vnd(summary.doanh_thu_truoc_thue)} đ`,
              sub: `HH ${vnd(summary.dt_hang_hoa)} · PM ${vnd(summary.dt_phan_mem)}`,
              icon: "banknote",
              tone: "info",
            },
            {
              label: "Lợi nhuận sau NC",
              value: `${summary.co_uoc_tinh ? "~" : ""}${vnd(summary.ln_sau_nc)} đ`,
              sub: summary.co_uoc_tinh ? "Gồm HĐ ước tính giá vốn" : "Giá vốn đã ghi sổ đủ",
              icon: "trending-up",
              tone: summary.ln_sau_nc < 0 ? "danger" : "success",
            },
            {
              label: "Tỉ suất lợi nhuận",
              value: `${summary.co_uoc_tinh ? "~" : ""}${summary.ti_suat_ln.toFixed(1)}%`,
              sub: summary.co_uoc_tinh ? "Ước tính (~ còn HĐ chưa xuất hết)" : "Thực tế",
              icon: "percent",
              tone: summary.ti_suat_ln < 0 ? "danger" : summary.ti_suat_ln < 10 ? "warning" : "success",
            },
          ]}
        />
      )}

      <FilterBar
        collapsibleMobile
        activeCount={activeFilterCount}
        onReset={() => {
          setStatusF("");
          setDateRange({ tu: `${_thisYear}-01-01`, den: `${_thisYear}-12-31` });
        }}
        filters={
          <>
            <select
              aria-label="Trạng thái hóa đơn bán"
              className="ui-select"
              value={statusF}
              onChange={(e) => setStatusF(e.target.value)}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="draft">Nháp</option>
              <option value="reviewed">Đã duyệt</option>
              <option value="void">Hủy</option>
            </select>
            <DateFilter value={dateRange} onChange={setDateRange} initialMode="year" />
          </>
        }
        actions={
          <>
            <StatusBadge tone="brand" size="sm">
              {list.length} hóa đơn
            </StatusBadge>
            <AppButton
              variant="ghost"
              size="sm"
              leftIcon="download"
              onClick={() => openExternalSafe(api.invExportUrl("sale", "zip", exportParams()))}
            >
              ZIP gốc
            </AppButton>
            <AppButton
              variant="ghost"
              size="sm"
              leftIcon="file-spreadsheet"
              onClick={() => openExternalSafe(api.invExportUrl("sale", "xlsx", exportParams()))}
            >
              Excel
            </AppButton>
          </>
        }
      />

      {sel.size > 0 && (
        <ActionBar
          selectedCount={sel.size}
          selectedLabel={`Đã chọn ${sel.size} hóa đơn bán`}
          onClearSelection={() => setSel(new Set())}
          primaryActions={
            <AppButton variant="danger" size="sm" leftIcon="trash" onClick={bulkDelete}>
              Xóa ({sel.size})
            </AppButton>
          }
        />
      )}

      {err && (
        <InlineAlert tone="danger" onDismiss={() => setErr("")}>
          {err}
        </InlineAlert>
      )}

      {!listLoaded ? (
        <TableSkeleton rows={6} cols={9} />
      ) : (
        <DataView
          mobileMode="card"
          empty={
            list.length === 0 ? (
              <EmptyState
                icon="receipt"
                title="Chưa có hóa đơn bán"
                description='Bấm "Nạp hóa đơn" để import file XML/PDF/ZIP/Excel xuất từ iHOADON.'
                action={
                  <AppButton variant="primary" leftIcon="upload" onClick={() => fileRef.current?.click()}>
                    Nạp hóa đơn
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
                    <th className="ui-col-chk"></th>
                    <th>Số HĐ</th>
                    <th>Ngày</th>
                    <th>Khách mua</th>
                    <th>Nguồn</th>
                    <th className="num">Tổng tiền</th>
                    <th>Trạng thái</th>
                    <th>Xuất kho</th>
                    <th className="num">Lợi nhuận</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((p) => {
                    const [stTone, stLabel] = STATUS_META[p.status] ?? ["neutral", p.status];
                    const [fTone, fIcon, fLabel] = FULFIL_META[p.fulfil_status] ?? ["neutral", "minus", p.fulfil_status];
                    const fNotes = p.fulfil_note ?? [];
                    return (
                      <tr key={p.id} className="ui-clickable" onClick={() => open(p.id)}>
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={sel.has(p.id)}
                            aria-label={`Chọn hóa đơn ${p.so_hd || p.id}`}
                            onChange={() => toggle(p.id)}
                          />
                        </td>
                        <td className="nowrap">
                          {p.ky_hieu} {p.so_hd || <StatusBadge tone="danger" size="sm">?</StatusBadge>}
                        </td>
                        <td className="nowrap">
                          {p.ngay || <StatusBadge tone="danger" size="sm">Thiếu ngày</StatusBadge>}
                        </td>
                        <td>
                          <div className="ui-row">
                            <span>{p.ten_mua}</span>
                            {p.is_dieu_chinh && (
                              <StatusBadge tone="warning" size="sm" icon="rotate-ccw">
                                Điều chỉnh
                              </StatusBadge>
                            )}
                            {p.dup_of && (
                              <StatusBadge tone="danger" size="sm">
                                Trùng #{p.dup_of}
                              </StatusBadge>
                            )}
                            {p.warnings.length > 0 && (
                              <StatusBadge tone="warning" size="sm" icon="alert-triangle">
                                {p.warnings.length}
                              </StatusBadge>
                            )}
                          </div>
                        </td>
                        <td>
                          <StatusBadge tone="neutral" size="sm">
                            {SOURCE_LABEL[p.source] ?? p.source}
                          </StatusBadge>
                        </td>
                        <td className="num">{vnd(p.tong_tien)}</td>
                        <td>
                          <StatusBadge tone={stTone} size="sm">
                            {stLabel}
                          </StatusBadge>
                        </td>
                        <td title={fNotes.join("\n")}>
                          <StatusBadge tone={fTone} size="sm" icon={fIcon}>
                            {fLabel}
                          </StatusBadge>
                          {fNotes.length > 0 && (
                            <div className="muted ui-mt-1 ui-wrap">
                              {fNotes[0]}
                              {fNotes.length > 1 && ` (+${fNotes.length - 1})`}
                            </div>
                          )}
                        </td>
                        <td className="num nowrap">
                          {p.ln_truoc_nc == null ? (
                            <span className="muted">—</span>
                          ) : (
                            <>
                              {p.ln_truoc_nc < 0 ? (
                                <StatusBadge tone="danger" size="sm">
                                  {p.ln_uoc ? "~" : ""}
                                  {vnd(p.ln_truoc_nc)}
                                  {p.tong_truoc_thue > 0 &&
                                    ` (${((p.ln_truoc_nc / p.tong_truoc_thue) * 100).toFixed(1)}%)`}
                                </StatusBadge>
                              ) : (
                                <b>
                                  {p.ln_uoc ? "~" : ""}
                                  {vnd(p.ln_truoc_nc)}
                                  {p.tong_truoc_thue > 0 &&
                                    ` (${((p.ln_truoc_nc / p.tong_truoc_thue) * 100).toFixed(1)}%)`}
                                </b>
                              )}
                              {p.nhan_cong_uoc > 0 && p.ln_sau_nc != null && (
                                <div
                                  className="muted"
                                  title={`Nhân công ước lượng ${vnd(p.nhan_cong_uoc)}đ (300.000đ/thành phẩm SX)`}
                                >
                                  sau NC: {p.ln_uoc ? "~" : ""}
                                  {vnd(p.ln_sau_nc)}
                                </div>
                              )}
                            </>
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
                const [stTone, stLabel] = STATUS_META[p.status] ?? ["neutral", p.status];
                const [fTone, fIcon, fLabel] = FULFIL_META[p.fulfil_status] ?? ["neutral", "minus", p.fulfil_status];
                return (
                  <MobileCard key={p.id} active={sel.has(p.id)}>
                    <MobileCardHeader
                      title={
                        <label className="ui-check-label" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={sel.has(p.id)}
                            onChange={() => toggle(p.id)}
                            aria-label={`Chọn hóa đơn ${p.so_hd}`}
                          />
                          <span>
                            {p.ky_hieu} {p.so_hd || "?"}
                          </span>
                        </label>
                      }
                      subtitle={p.ten_mua || "Khách hàng"}
                      badge={
                        <StatusBadge tone={stTone} size="sm">
                          {stLabel}
                        </StatusBadge>
                      }
                    />
                    <MobileCardGrid>
                      <MobileCardRow label="Ngày" value={p.ngay || "Thiếu ngày"} />
                      <MobileCardRow label="Tổng tiền" value={`${vnd(p.tong_tien)} đ`} mono />
                      {p.ln_truoc_nc != null && (
                        <MobileCardRow
                          label="Lợi nhuận"
                          value={`${p.ln_uoc ? "~" : ""}${vnd(p.ln_truoc_nc)} đ`}
                          mono
                        />
                      )}
                    </MobileCardGrid>
                    <div className="ui-row">
                      <StatusBadge tone={fTone} size="sm" icon={fIcon}>
                        {fLabel}
                      </StatusBadge>
                      <StatusBadge tone="neutral" size="sm">
                        {SOURCE_LABEL[p.source] ?? p.source}
                      </StatusBadge>
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      <MobileCardActions>
                        <AppButton variant="secondary" size="sm" leftIcon="eye" onClick={() => open(p.id)}>
                          Mở chi tiết
                        </AppButton>
                      </MobileCardActions>
                    </div>
                  </MobileCard>
                );
              })}
            </div>
          }
        />
      )}

      {/* Import from URL Modal */}
      <AppModal
        open={urlOpen}
        onClose={() => setUrlOpen(false)}
        title="Import hóa đơn bán từ liên kết"
        subtitle="Link Google Drive (folder/file) hoặc link PDF/XML/ZIP trực tiếp."
        size="sm"
        footer={
          <>
            <AppButton variant="secondary" onClick={() => setUrlOpen(false)}>
              Hủy
            </AppButton>
            <AppButton
              variant="primary"
              leftIcon="download"
              loading={busy}
              disabled={busy || !url.trim()}
              onClick={doImportUrl}
            >
              {busy ? "Đang tải…" : "Import"}
            </AppButton>
          </>
        }
      >
        <FormField label="Đường dẫn tải hóa đơn" htmlFor="sale-import-url">
          <input
            id="sale-import-url"
            className="ui-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
          />
        </FormField>
      </AppModal>

      {/* Invoice Detail Modal */}
      <AppModal
        open={!!cur}
        onClose={closeCur}
        size="full"
        title={
          cur ? (
            <span className="ui-row">
              <span>
                HĐ bán {cur.ky_hieu} {cur.so_hd}
              </span>
              <StatusBadge tone={(STATUS_META[cur.status] ?? ["neutral", cur.status])[0]} size="sm">
                {(STATUS_META[cur.status] ?? ["neutral", cur.status])[1]}
              </StatusBadge>
              {cur.is_dieu_chinh && (
                <StatusBadge tone="warning" size="sm" icon="rotate-ccw">
                  Điều chỉnh
                </StatusBadge>
              )}
            </span>
          ) : (
            "Chi tiết hóa đơn bán"
          )
        }
        footer={
          cur ? (
            <>
              <AppButton variant="secondary" onClick={closeCur}>
                Đóng
              </AppButton>
              <AppButton variant="secondary" leftIcon="save" disabled={busy} onClick={() => saveDraft(false)}>
                Lưu
              </AppButton>
              {!cur.is_dieu_chinh && cur.status !== "reviewed" && (
                <AppButton
                  variant="primary"
                  leftIcon="check-circle"
                  disabled={busy || cur.lines.some((l) => l.lech_dong)}
                  title={
                    cur.lines.some((l) => l.lech_dong)
                      ? "Còn dòng SL×đơn giá lệch thành tiền (nghi ngờ lỗi parse) — sửa lại trước khi duyệt"
                      : ""
                  }
                  onClick={() => saveDraft(true)}
                >
                  Lưu &amp; Đánh dấu đã duyệt
                </AppButton>
              )}
              {!cur.is_dieu_chinh && cur.status === "reviewed" && (
                <AppButton variant="primary" leftIcon="factory" loading={busy} onClick={genDocs}>
                  Sinh chứng từ (nháp)
                </AppButton>
              )}
            </>
          ) : undefined
        }
      >
        {cur && (
          <div className="ui-review-split">
            <div className="ui-review-form ui-stack">
              {cur.warnings.length > 0 && (
                <InlineAlert tone="warning" title="Cảnh báo đối chiếu" className="ui-scroll-xs">
                  <ul className="ui-bullet-list">
                    {cur.warnings.map((w, i) => (
                      <li key={i}>{w.msg}</li>
                    ))}
                  </ul>
                </InlineAlert>
              )}

              {cur.is_dieu_chinh && (
                <InlineAlert tone="warning" title="Hóa đơn điều chỉnh / thay thế">
                  Bỏ qua đối chiếu kho, chỉ lưu vết.
                  {cur.dc_ref && <div className="muted">{cur.dc_ref}</div>}
                </InlineAlert>
              )}

              <FormGrid cols={3}>
                <FormField label="Số HĐ" htmlFor="sale-so-hd">
                  <input
                    id="sale-so-hd"
                    className="ui-input"
                    value={cur.so_hd}
                    onChange={(e) => setCur({ ...cur, so_hd: e.target.value })}
                  />
                </FormField>
                <FormField label="Ký hiệu" htmlFor="sale-ky-hieu">
                  <input
                    id="sale-ky-hieu"
                    className="ui-input"
                    value={cur.ky_hieu}
                    onChange={(e) => setCur({ ...cur, ky_hieu: e.target.value })}
                  />
                </FormField>
                <FormField label="Ngày" htmlFor="sale-ngay">
                  <input
                    id="sale-ngay"
                    className="ui-input"
                    value={cur.ngay}
                    onChange={(e) => setCur({ ...cur, ngay: e.target.value })}
                    placeholder="YYYY-MM-DD"
                  />
                </FormField>
                <FormField label="Khách mua" htmlFor="sale-ten-mua">
                  <input
                    id="sale-ten-mua"
                    className="ui-input"
                    value={cur.ten_mua}
                    onChange={(e) => setCur({ ...cur, ten_mua: e.target.value })}
                  />
                </FormField>
                <FormField label="MST mua" htmlFor="sale-mst-mua">
                  <input
                    id="sale-mst-mua"
                    className="ui-input"
                    value={cur.mst_mua}
                    onChange={(e) => setCur({ ...cur, mst_mua: e.target.value })}
                  />
                </FormField>
              </FormGrid>

              <DataView
                mobileMode="scroll"
                desktop={
                  <div className="ui-table-scroll-wrap ui-scroll-lg" tabIndex={0}>
                    <table className="ui-table">
                      <thead>
                        <tr>
                          <th>Tên hàng</th>
                          <th>Loại</th>
                          <th className="num">SL</th>
                          <th className="num">Đơn giá</th>
                          <th>Mặt hàng kho</th>
                          <th>Đề xuất</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cur.lines.map((l) => {
                          const [cTone, cLabel] = CLASS_META[l.line_class] ?? ["neutral", l.line_class];
                          const skipKho = cur.is_dieu_chinh || l.fulfil_kind === "doanh_thu";
                          const isDraft = cur.status === "draft";
                          return (
                            <tr key={l.id} className={l.warn_am_kho || l.lech_dong ? "row-treo" : ""}>
                              <td className="ui-col-wide">
                                <div className="ui-row">
                                  <span>{l.ten_raw}</span>
                                  {l.thue_kct && (
                                    <StatusBadge tone="neutral" size="sm">
                                      KCT
                                    </StatusBadge>
                                  )}
                                </div>
                              </td>
                              <td>
                                <StatusBadge tone={cTone} size="sm">
                                  {cLabel}
                                </StatusBadge>
                              </td>
                              <td className="num">
                                {isDraft ? (
                                  <input
                                    className="ui-input ui-input-xs"
                                    defaultValue={l.so_luong}
                                    onChange={(e) => patchLine(l.id, { so_luong: Number(e.target.value) || 0 })}
                                  />
                                ) : (
                                  qty(l.so_luong)
                                )}
                              </td>
                              <td className="num">
                                {isDraft ? (
                                  <input
                                    className="ui-input ui-input-price"
                                    defaultValue={l.don_gia_ban}
                                    onChange={(e) => patchLine(l.id, { don_gia_ban: Number(e.target.value) || 0 })}
                                  />
                                ) : (
                                  vnd(l.don_gia_ban)
                                )}
                                {l.lech_dong && (
                                  <div className="ui-mt-2">
                                    <StatusBadge
                                      tone="danger"
                                      size="sm"
                                      title="SL×đơn giá khác thành tiền trên hóa đơn — nghi ngờ lỗi parse"
                                    >
                                      HĐ ghi {vnd(l.thanh_tien)}
                                    </StatusBadge>
                                  </div>
                                )}
                              </td>
                              <td className="ui-col-wide">
                                {skipKho ? (
                                  <span className="muted">—</span>
                                ) : l.item_id ? (
                                  <span className="ui-row">
                                    <StatusBadge tone="success" size="sm">
                                      {l.item_ma_hang}
                                    </StatusBadge>
                                    <span>{l.item_ten}</span>
                                    <AppButton
                                      variant="ghost"
                                      size="sm"
                                      iconOnly
                                      leftIcon="x"
                                      aria-label="Bỏ khớp mặt hàng"
                                      onClick={() => patchLine(l.id, { item_id: null, match_kind: "none" })}
                                    />
                                  </span>
                                ) : (
                                  <div className="ui-stack--xs">
                                    {l.suggestions.slice(0, 3).map((s) => (
                                      <AppButton
                                        key={s.item_id}
                                        variant="ghost"
                                        size="sm"
                                        className="ui-wrap-btn"
                                        title={s.reason}
                                        onClick={() =>
                                          pickLineItem(l.id, { id: s.item_id, ma_hang: s.ma_hang, ten: s.ten })
                                        }
                                      >
                                        {s.ma_hang} · {(s.reason ?? "").replace("Giống ", "")}
                                      </AppButton>
                                    ))}
                                    <input
                                      className="ui-input ui-input-sm"
                                      placeholder="Tìm mã/tên…"
                                      value={lineSearch?.lineId === l.id ? lineSearch.q : ""}
                                      onChange={(e) => searchLine(l.id, e.target.value)}
                                    />
                                    {lineSearch?.lineId === l.id &&
                                      lineSearch.results.slice(0, 5).map((it) => (
                                        <AppButton
                                          key={it.id}
                                          variant="ghost"
                                          size="sm"
                                          className="ui-wrap-btn"
                                          onClick={() => {
                                            pickLineItem(l.id, it);
                                            setLineSearch(null);
                                          }}
                                        >
                                          <b>{it.ma_hang}</b> · {it.ten}
                                        </AppButton>
                                      ))}
                                  </div>
                                )}
                              </td>
                              <td className="ui-col-wide">
                                <div className={l.warn_am_kho ? "" : "muted"}>{l.de_xuat}</div>
                                <div className="ui-row ui-mt-2">
                                  {isDraft && l.warn_am_kho && (
                                    <AppButton
                                      variant="ghost"
                                      size="sm"
                                      leftIcon="refresh"
                                      disabled={busy}
                                      title="Khớp lại mã hàng theo danh mục mới nhất — dùng khi mã đúng được nhập kho SAU khi hóa đơn bán này đã tạo draft"
                                      onClick={() => rematchLine(l)}
                                    >
                                      Khớp lại
                                    </AppButton>
                                  )}
                                  {!skipKho && l.fulfil_kind === "sx" && (
                                    <AppButton
                                      variant="secondary"
                                      size="sm"
                                      leftIcon="layers"
                                      onClick={() => openBom(l)}
                                    >
                                      Tạo BOM / công thức
                                    </AppButton>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                }
              />
            </div>

            <div className="ui-review-file">
              {cur.source === "xml" ? (
                <div className="xml-invoice">
                  <div className="xi-head">
                    <div className="xi-title">HÓA ĐƠN GIÁ TRỊ GIA TĂNG</div>
                    <div className="muted">
                      Ký hiệu <b>{cur.ky_hieu || "—"}</b> · Số <b>{cur.so_hd || "—"}</b> · Ngày{" "}
                      <b>{cur.ngay || "—"}</b>
                    </div>
                  </div>
                  <div className="xi-party">
                    <div>
                      <span className="muted">Bên bán:</span>{" "}
                      <b>CÔNG TY CP ĐẦU TƯ VÀ PHÁT TRIỂN CÔNG NGHỆ INUT</b>
                      <div className="muted">MST 4401053694</div>
                    </div>
                    <div>
                      <span className="muted">Bên mua:</span> <b>{cur.ten_mua || "—"}</b>
                      <div className="muted">MST {cur.mst_mua || "—"}</div>
                    </div>
                  </div>
                  <DataView
                    mobileMode="scroll"
                    desktop={
                      <table className="ui-table xi-lines">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Tên hàng hóa, dịch vụ</th>
                            <th>ĐVT</th>
                            <th className="num">SL</th>
                            <th className="num">Đơn giá</th>
                            <th className="num">Thành tiền</th>
                            <th className="num">Thuế</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cur.lines.map((l, i) => (
                            <tr key={l.id}>
                              <td className="muted">{i + 1}</td>
                              <td>{l.ten_raw}</td>
                              <td className="muted">{l.dvt}</td>
                              <td className="num">{qty(l.so_luong)}</td>
                              <td className="num">{vnd(l.don_gia_ban)}</td>
                              <td className="num">{vnd(l.thanh_tien)}</td>
                              <td className="num muted">{l.thue_kct ? "KCT" : `${qty(l.thue_suat)}%`}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    }
                  />
                  <div className="xi-totals">
                    <div>
                      <span className="muted">Cộng tiền hàng:</span> <b className="num">{vnd(cur.tong_truoc_thue)} đ</b>
                    </div>
                    <div>
                      <span className="muted">Tiền thuế:</span> <b className="num">{vnd(cur.tong_thue)} đ</b>
                    </div>
                    <div className="xi-grand">
                      <span className="muted">Tổng thanh toán:</span> <b className="num">{vnd(cur.tong_tien)} đ</b>
                    </div>
                  </div>
                  {safeHttpUrl(cur.doc_url) && (
                    <a
                      className="ui-link ui-nowrap ui-mt-2"
                      href={safeHttpUrl(cur.doc_url)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span>Mở file XML gốc</span>
                      <AppIcon name="external-link" size={13} />
                    </a>
                  )}
                </div>
              ) : cur.doc_url ? (
                <iframe title="file gốc" src={cur.doc_url} />
              ) : (
                <div className="no-file">Không có file gốc</div>
              )}
            </div>
          </div>
        )}
      </AppModal>

      {/* BOM Assembly Modal */}
      <AppModal
        open={!!bom}
        onClose={closeBom}
        title={bom ? `Ghép bộ: ${bom.lineName}` : "Ghép bộ"}
        size="full"
        footer={
          bom ? (
            <>
              <AppButton variant="secondary" onClick={closeBom}>
                Hủy
              </AppButton>
              <AppButton variant="primary" leftIcon="factory" loading={busy} onClick={submitBom}>
                Tạo lệnh ghép bộ (nháp)
              </AppButton>
            </>
          ) : undefined
        }
      >
        {bom && (
          <div className="ui-stack">
            {err && (
              <InlineAlert tone="danger" onDismiss={() => setErr("")}>
                {err}
              </InlineAlert>
            )}

            <p className="muted">
              Bóc tách bộ thành linh kiện tiêu hao trong kho để tạo lệnh sản xuất (nháp). Giá vốn bộ = tổng giá vốn linh
              kiện thật (không ép theo biên). Ngày HĐ: <b>{bom.ngay || "?"}</b> · Giá bán dòng (chưa thuế):{" "}
              <b className="num">{vnd(bom.giaBan)}đ</b>.
            </p>

            {bom.draftSavedAt != null && (
              <InlineAlert
                tone="info"
                action={
                  <AppButton variant="ghost" size="sm" leftIcon="trash" onClick={discardDraft}>
                    Bỏ nháp
                  </AppButton>
                }
              >
                Đã khôi phục bản nháp lúc{" "}
                {new Date(bom.draftSavedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}.
              </InlineAlert>
            )}

            <div className="ui-subpanel ui-subpanel--md">
              <FormField
                label="Ngữ cảnh / hướng dẫn AI cho kèo này (tùy chọn — càng chi tiết AI càng đúng thực tế)"
                htmlFor="bom-ai-context"
              >
                <textarea
                  id="bom-ai-context"
                  className="ui-textarea"
                  rows={2}
                  placeholder="VD: khách yêu cầu đổi sang camera Hikvision; lắp ngoài trời nên cần vỏ chống nước; công trình đã có sẵn switch, không cần mua thêm; cắt bớt phần dây vì đi ngầm sẵn…"
                  value={bom.context}
                  onChange={(e) => setBom({ ...bom, context: e.target.value })}
                />
              </FormField>
            </div>

            <div className="ui-row">
              <AppButton
                variant="secondary"
                size="sm"
                leftIcon="bot"
                loading={bom.aiBusy}
                onClick={aiSuggestBom}
              >
                {bom.aiBusy ? "AI đang nghĩ…" : bom.rows.length ? "AI gợi ý lại (thay hết)" : "AI gợi ý linh kiện"}
              </AppButton>
              {bom.rows.length > 0 && (
                <AppButton
                  variant="ghost"
                  size="sm"
                  leftIcon="plus"
                  loading={bom.aiBusy}
                  onClick={aiSuggestMore}
                  title="AI xem lại quy mô thực tế + ngữ cảnh, chỉ thêm phần còn thiếu — KHÔNG xóa các dòng đã có"
                >
                  {bom.aiBusy ? "AI đang nghĩ…" : "AI gợi ý thêm"}
                </AppButton>
              )}
              <AppButton variant="ghost" size="sm" leftIcon="plus" onClick={addRow}>
                Thêm dòng
              </AppButton>
              <AppButton variant="ghost" size="sm" leftIcon="search" onClick={testBom}>
                Kiểm tra
              </AppButton>

              {bom.outputItemId ? (
                <span className="muted ui-ml-auto ui-row">
                  <span>Thành phẩm:</span>
                  <StatusBadge tone="success" size="sm">
                    {bom.outputLabel.split(" · ")[0]}
                  </StatusBadge>
                  <span>{bom.outputLabel.split(" · ").slice(1).join(" · ")}</span>
                </span>
              ) : (
                <div className="ui-row ui-ml-auto">
                  <label className="ui-field-label" htmlFor="bom-output-code">
                    Mã TP mới:
                  </label>
                  <input
                    id="bom-output-code"
                    className="ui-input ui-input-sm"
                    value={bom.outputMaHang}
                    onChange={(e) => setBom({ ...bom, outputMaHang: e.target.value })}
                  />
                </div>
              )}
            </div>

            {bom.aiNote && (
              <InlineAlert tone="info" title="Ghi chú từ AI">
                {bom.aiNote}
              </InlineAlert>
            )}

            {bom.test && (
              <InlineAlert
                tone={bom.test.level === "ok" ? "success" : bom.test.level === "warn" ? "warning" : "danger"}
                title={
                  bom.test.level === "ok"
                    ? "Kiểm tra hợp lệ"
                    : bom.test.level === "warn"
                      ? "Có cảnh báo tồn kho"
                      : "Chưa hợp lệ"
                }
              >
                <ul className="ui-bullet-list">
                  {bom.test.messages.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </InlineAlert>
            )}

            <DataView
              mobileMode="scroll"
              desktop={
                <div className="ui-table-scroll-wrap ui-scroll-lg" tabIndex={0}>
                  <table className="ui-table">
                    <thead>
                      <tr>
                        <th>Linh kiện (mã kho)</th>
                        <th>ĐVT</th>
                        <th>Kho</th>
                        <th className="num">SL</th>
                        <th className="num">Giá vốn/đv (chưa thuế)</th>
                        <th className="num">Thuế %</th>
                        <th className="num">Thành tiền (có thuế)</th>
                        <th className="num">Khả dụng tại ngày HĐ</th>
                        <th>Mô tả / lý do</th>
                        <th className="ui-col-chk"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {bom.rows.map((r, i) => {
                        const thieu = r.item_id && r.kha_dung < r.so_luong;
                        const thanhTienTax = r.so_luong * r.don_gia_bq * (1 + r.thue_suat_est / 100);
                        return (
                          <tr key={i} className={thieu ? "row-treo" : ""}>
                            <td className="ui-col-wide ui-wrap">
                              {r.item_id ? (
                                <span className="ui-row">
                                  <StatusBadge tone="success" size="sm">
                                    {r.ma_hang}
                                  </StatusBadge>
                                  <span>{r.ten}</span>
                                  <AppButton
                                    variant="ghost"
                                    size="sm"
                                    iconOnly
                                    leftIcon="x"
                                    aria-label="Bỏ chọn linh kiện"
                                    onClick={() =>
                                      setRow(i, {
                                        item_id: null,
                                        ma_hang: "",
                                        ten: "",
                                        dvt: "",
                                        don_gia_bq: 0,
                                        kha_dung: 0,
                                      })
                                    }
                                  />
                                </span>
                              ) : (
                                <div className="ui-stack--xs">
                                  <input
                                    className="ui-input ui-input-sm"
                                    placeholder="Tìm mã/tên kho…"
                                    value={r.q}
                                    onChange={(e) => searchRow(i, e.target.value)}
                                  />
                                  {r.results.slice(0, 5).map((it) => (
                                    <AppButton
                                      key={it.id}
                                      variant="ghost"
                                      size="sm"
                                      className="ui-wrap-btn"
                                      onClick={() => pickRow(i, it)}
                                    >
                                      <b>{it.ma_hang}</b> · {it.ten}
                                    </AppButton>
                                  ))}
                                  {r.ten && (
                                    <div className="muted">
                                      AI đề xuất: <b>{r.ten}</b> — chưa có mã trong kho, tạo mới hoặc chọn mã tương tự ở
                                      trên.
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="muted">{r.dvt}</td>
                            <td>
                              <select
                                className="ui-select"
                                value={r.warehouse_id}
                                onChange={(e) => setRow(i, { warehouse_id: Number(e.target.value) })}
                              >
                                {whs.map((w) => (
                                  <option key={w.id} value={w.id}>
                                    {w.code}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="num">
                              <input
                                className="ui-input ui-input-xs"
                                type="number"
                                value={r.so_luong}
                                onChange={(e) => setRow(i, { so_luong: Number(e.target.value) })}
                              />
                            </td>
                            <td className="num muted">{vnd(r.don_gia_bq)}</td>
                            <td className="num">
                              <input
                                className="ui-input ui-input-xs"
                                type="number"
                                value={r.thue_suat_est}
                                onChange={(e) => setRow(i, { thue_suat_est: Number(e.target.value) })}
                              />
                            </td>
                            <td className="num">{vnd(thanhTienTax)}</td>
                            <td className={thieu ? "num" : "num muted"}>
                              <div>{r.item_id ? qty(r.kha_dung) : "—"}</div>
                              {thieu && (
                                <StatusBadge tone="warning" size="sm" icon="alert-triangle">
                                  Thiếu {qty(r.so_luong - r.kha_dung)}
                                </StatusBadge>
                              )}
                            </td>
                            <td>
                              <input
                                className="ui-input ui-input-sm"
                                value={r.note}
                                onChange={(e) => setRow(i, { note: e.target.value })}
                              />
                            </td>
                            <td>
                              <AppButton
                                variant="ghost"
                                size="sm"
                                iconOnly
                                leftIcon="trash"
                                aria-label="Xóa dòng linh kiện"
                                onClick={() => delRow(i)}
                              />
                            </td>
                          </tr>
                        );
                      })}
                      {!bom.rows.length && (
                        <tr>
                          <td colSpan={10}>
                            <EmptyState
                              compact
                              icon="layers"
                              title="Chưa có linh kiện"
                              description='Bấm "AI gợi ý linh kiện" hoặc "Thêm dòng" để bắt đầu.'
                            />
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              }
            />

            {bom.rows.length > 0 &&
              (() => {
                const t = bomTotals(bom.rows, bom.giaBan);
                const marginOk = t.marginPct !== null && t.marginPct >= 15 && t.marginPct <= 20;
                return (
                  <div className="ui-subpanel ui-subpanel--md ui-stack--sm">
                    <div className="ui-row-between">
                      <span className="muted">Tổng giá vốn (chưa thuế):</span>
                      <b className="num">{vnd(t.costPretax)}đ</b>
                    </div>
                    <div className="ui-row-between">
                      <span className="muted">Tổng giá vốn (có thuế):</span>
                      <b className="num">{vnd(t.costWithTax)}đ</b>
                    </div>
                    <div className="ui-row-between">
                      <span className="muted">Giá bán đề xuất (biên 15-20%):</span>
                      <b className="num">
                        {vnd(t.priceLow)}đ – {vnd(t.priceHigh)}đ
                      </b>
                    </div>
                    <div className="ui-row-between">
                      <span className="muted">Biên lợi nhuận thực tế (giá bán {vnd(bom.giaBan)}đ):</span>
                      <span className={marginOk ? "ui-text-brand num" : t.marginPct !== null ? "ui-text-danger num" : "num"}>
                        {t.marginPct === null ? "—" : `${t.marginPct.toFixed(1)}%`}
                        {t.marginPct !== null && !marginOk && " (ngoài khoảng mục tiêu 15-20%)"}
                      </span>
                    </div>
                  </div>
                );
              })()}

            <div className="ui-row">
              <label className="ui-check-label">
                <input
                  type="checkbox"
                  checked={bom.saveRecipe}
                  onChange={(e) => setBom({ ...bom, saveRecipe: e.target.checked })}
                />
                <span>Lưu thành mẫu (dùng lại lần sau)</span>
              </label>
              {bom.saveRecipe && (
                <input
                  className="ui-input ui-grow"
                  value={bom.recipeName}
                  onChange={(e) => setBom({ ...bom, recipeName: e.target.value })}
                  placeholder="Tên mẫu công thức"
                />
              )}
            </div>
          </div>
        )}
      </AppModal>
    </PageShell>
  );
}
