import { useEffect, useRef, useState } from "react";
import { api, InvItem, InvSale, InvSaleLine, InvWarehouse } from "../api";

function vnd(n: number): string {
  return Math.round(n).toLocaleString("vi-VN");
}
function qty(n: number): string {
  return Number(n.toFixed(4)).toLocaleString("vi-VN");
}

const STATUS_CHIP: Record<string, [string, string]> = {
  draft: ["amber", "Nháp"],
  reviewed: ["green", "Đã duyệt"],
  void: ["gray", "Hủy"],
};
const SOURCE_LABEL: Record<string, string> = {
  xml: "XML", pdf: "PDF", scan_ai: "AI", manual: "Tay",
};
const CLASS_CHIP: Record<string, [string, string]> = {
  inut: ["indigo", "iNut"],
  camera: ["amber", "Camera"],
  bo: ["red", "Bộ lắp đặt"],
  phan_mem: ["gray", "Phần mềm"],
  other: ["gray", "Khác"],
};

type BomRow = {
  item_id: number | null;
  ma_hang: string;
  ten: string;
  dvt: string;
  warehouse_id: number;
  so_luong: number;
  don_gia_bq: number; // gia von binh quan CHUA thue (tu kho)
  thue_suat_est: number; // % uoc luong tu lan mua gan nhat
  kha_dung: number; // kha dung tai ngay HD (kiem tra thoi gian nhap)
  note: string;
  q: string;
  results: InvItem[];
};
type BomState = {
  lineId: number;
  lineName: string;
  ngay: string; // ngay HD ban (= ngay san xuat du kien)
  giaBan: number; // gia ban dong nay tren HD (chua thue)
  outputItemId: number | null; // mat hang thanh pham DA khop (vd TP0022); null = tao moi
  outputLabel: string; // hien thi khi da co san mat hang
  outputMaHang: string; // ma moi khi outputItemId = null
  saveRecipe: boolean;
  recipeName: string;
  rows: BomRow[];
  aiNote: string;
  aiBusy: boolean;
  context: string; // ngu canh/huong dan them cho AI cua tung keo
  test: { level: "ok" | "warn" | "error"; messages: string[] } | null;
};

const NEW_BOM_ROW: Omit<BomRow, "warehouse_id"> = {
  item_id: null, ma_hang: "", ten: "", dvt: "", so_luong: 1,
  don_gia_bq: 0, thue_suat_est: 8, kha_dung: 0, note: "", q: "", results: [],
};

function validateBom(rows: BomRow[]): { level: "ok" | "warn" | "error"; messages: string[] } {
  if (!rows.length) return { level: "error", messages: ["Chưa có linh kiện nào — bấm 🤖 AI gợi ý hoặc + Thêm dòng."] };
  const messages: string[] = [];
  let level: "ok" | "warn" | "error" = "ok";
  rows.forEach((r, i) => {
    const label = r.ten || r.q || `Dòng ${i + 1}`;
    if (!r.item_id) {
      messages.push(`❌ "${label}": CHƯA gán mã trong kho — dòng này sẽ KHÔNG được tính, thiếu linh kiện thật khi ghi sổ.`);
      level = "error";
    } else if (!r.so_luong || r.so_luong <= 0) {
      messages.push(`❌ "${label}": số lượng phải > 0.`);
      level = "error";
    } else if (r.kha_dung < r.so_luong) {
      messages.push(`⚠️ "${label}": thiếu tại ngày HĐ (cần ${qty(r.so_luong)}, khả dụng ${qty(r.kha_dung)}) — kiểm tra lại ngày nhập hàng.`);
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
      messages.push(`⚠️ Mã "${ma}" xuất hiện ${count} dòng riêng — có thể do AI trả trùng, cân nhắc gộp số lượng lại thành 1 dòng.`);
      if (level === "ok") level = "warn";
    }
  }
  if (!messages.length) messages.push("✅ Đủ linh kiện, đủ tồn tại ngày HĐ — có thể tạo lệnh.");
  return { level, messages };
}

function bomTotals(rows: BomRow[], giaBan: number) {
  const matched = rows.filter((r) => r.item_id);
  const costPretax = matched.reduce((s, r) => s + r.so_luong * r.don_gia_bq, 0);
  const costWithTax = matched.reduce((s, r) => s + r.so_luong * r.don_gia_bq * (1 + r.thue_suat_est / 100), 0);
  const priceLow = costPretax > 0 ? costPretax / 0.85 : 0; // bien 15%
  const priceHigh = costPretax > 0 ? costPretax / 0.8 : 0; // bien 20%
  const marginPct = giaBan > 0 ? ((giaBan - costPretax) / giaBan) * 100 : null;
  return { costPretax, costWithTax, priceLow, priceHigh, marginPct };
}

export function SalesInvoice() {
  const [list, setList] = useState<InvSale[]>([]);
  const [statusF, setStatusF] = useState("");
  const [cur, setCur] = useState<InvSale | null>(null);
  const [whs, setWhs] = useState<InvWarehouse[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState("");
  // tim mat hang cho 1 dong
  const [lineSearch, setLineSearch] = useState<{ lineId: number; q: string; results: InvItem[] } | null>(null);
  const [bom, setBom] = useState<BomState | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const whByCode = (code: string) => whs.find((w) => w.code === code)?.id ?? whs[0]?.id ?? 0;

  async function load() {
    setErr("");
    try {
      setList(await api.invSales(statusF));
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    api.invWarehouses().then(setWhs).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusF]);

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
      load();
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
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function patchLine(lineId: number, patch: Partial<InvSaleLine>) {
    setCur((c) =>
      c
        ? {
            ...c,
            lines: c.lines.map((l) => {
              if (l.id !== lineId) return l;
              const next = { ...l, ...patch };
              // Sua SL hoac don gia -> tu tinh lai thanh tien (sua loi parse PDF nhet don gia vao thanh tien)
              if ("so_luong" in patch || "don_gia_ban" in patch) {
                next.thanh_tien = Math.round(next.so_luong * next.don_gia_ban);
                next.lech_dong = false; // vua dong bo thanh_tien = SL*DG nen het lech
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
        so_hd: cur.so_hd, ky_hieu: cur.ky_hieu, mst_mua: cur.mst_mua,
        ten_mua: cur.ten_mua, ngay: cur.ngay,
        status: markReviewed ? "reviewed" : undefined,
        lines: cur.lines.map((l) => ({
          stt: l.stt, ten_raw: l.ten_raw, dvt: l.dvt, so_luong: l.so_luong,
          don_gia_ban: l.don_gia_ban, thanh_tien: l.thanh_tien, thue_suat: l.thue_suat,
          thue_kct: l.thue_kct, item_id: l.item_id, warehouse_id: l.warehouse_id,
          match_kind: l.match_kind, line_class: l.line_class, fulfil_kind: l.fulfil_kind,
        })),
      };
      const updated = await api.invSaleSave(cur.id, body);
      setCur(updated);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function genDocs() {
    if (!cur) return;
    if (
      !window.confirm(
        "Sinh phiếu xuất kho + lệnh sản xuất dạng NHÁP từ hóa đơn này?\n\n" +
          "Chưa trừ kho — anh vào tab Xuất kho / Sản xuất kiểm tra rồi tự ghi sổ (hệ thống sẽ chặn âm kho khi ghi).",
      )
    )
      return;
    setBusy(true);
    try {
      const r = await api.invSaleGenerate(cur.id);
      const msg =
        `Đã tạo ${r.issues.length} phiếu xuất + ${r.productions.length} lệnh sản xuất (nháp).\n` +
        (r.warnings.length ? `\n⚠️ Cần lưu ý:\n- ${r.warnings.join("\n- ")}` : "\nKhông có cảnh báo.");
      window.alert(msg);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openBom(l: InvSaleLine) {
    if (!cur) return;
    setErr("");
    // Da khop mat hang thanh pham (vd iNut TP0022) -> dung luon ma do lam dau ra,
    // KHONG tao ma moi. Chua khop (bo lap dat bespoke) -> goi y ma moi.
    let ma = "";
    if (!l.item_id) {
      try {
        ma = (await api.invSuggestItemCode()).code;
      } catch {
        /* ignore */
      }
    }
    setBom({
      lineId: l.id, lineName: l.ten_raw, ngay: cur.ngay,
      giaBan: l.don_gia_ban || (l.so_luong ? l.thanh_tien / l.so_luong : 0),
      outputItemId: l.item_id ?? null,
      outputLabel: l.item_id ? `${l.item_ma_hang} · ${l.item_ten}` : "",
      outputMaHang: ma, saveRecipe: true, recipeName: l.ten_raw,
      rows: [], aiNote: "", aiBusy: false, context: "", test: null,
    });
  }
  function setRow(i: number, patch: Partial<BomRow>) {
    setBom((b) => (b ? { ...b, rows: b.rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)), test: null } : b));
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
  async function pickRow(i: number, it: InvItem) {
    setRow(i, { item_id: it.id, ma_hang: it.ma_hang, ten: it.ten, dvt: it.dvt, results: [], q: "" });
    try {
      const c = await api.invItemCost(it.id, bom?.ngay ?? "");
      setRow(i, { don_gia_bq: c.don_gia_bq, thue_suat_est: c.thue_suat_est, kha_dung: c.kha_dung_tai_ngay });
    } catch {
      /* ignore — gia von/kha dung se hien 0, van sua tay duoc */
    }
  }
  type BomComponent = Awaited<ReturnType<typeof api.invSaleSuggestBom>>["components"][number];
  function mapAiComponents(components: BomComponent[]): BomRow[] {
    return components.map((c) => ({
      item_id: c.match?.item_id ?? null,
      ma_hang: c.match?.ma_hang ?? "",
      ten: c.match?.ten ?? c.ten,
      dvt: c.dvt || c.match?.dvt || "",
      warehouse_id: whByCode("HH"),
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
      note + (unmatchedCount ? ` (⚠️ ${unmatchedCount} linh kiện AI gợi ý CHƯA có mã trong kho — cần tạo mới hoặc chọn tay)` : "")
    );
  }
  /** Gop cac dong TRUNG MA (cung item_id) thanh 1 dong duy nhat (cong don so luong, noi ly do).
   * Day la CHAN THAT SU o code — khong phu thuoc AI co "nghe loi" khong lap lai hay khong.
   * Dong chua khop ma (item_id=null) giu nguyen, xep sau cung de nguoi dung tu xu ly tay. */
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
  async function aiSuggestBom() {
    if (!cur || !bom) return;
    if (
      bom.rows.some((r) => r.item_id || r.q) &&
      !window.confirm(`Đã có ${bom.rows.length} dòng — AI gợi ý mới sẽ THAY THẾ toàn bộ. Tiếp tục?`)
    )
      return;
    setBom({ ...bom, aiBusy: true });
    try {
      const r = await api.invSaleSuggestBom(cur.id, bom.lineId, bom.context);
      const { rows, mergedCount } = mergeBomRows(mapAiComponents(r.components));
      const dupNote = mergedCount ? ` (🔗 đã tự gộp ${mergedCount} dòng trùng mã)` : "";
      setBom((b) =>
        b ? { ...b, rows, aiNote: unmatchedNote(r.note || "", r.totals.unmatched_count) + dupNote, aiBusy: false, test: null } : b,
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
      const r = await api.invSaleSuggestBom(cur.id, bom.lineId, bom.context, existing);
      const added = mapAiComponents(r.components);
      const { rows: merged, mergedCount } = mergeBomRows([...bom.rows, ...added]);
      const dupNote = mergedCount ? ` (🔗 đã tự gộp ${mergedCount} dòng trùng mã với phần đã có)` : "";
      const note = added.length
        ? unmatchedNote(r.note || "", r.totals.unmatched_count) + dupNote
        : "🤖 AI thấy các linh kiện hiện tại đã đủ theo quy mô thực tế — không có gì cần bổ sung thêm.";
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
      setErr("Còn dòng chưa hợp lệ — bấm 🔍 Kiểm tra để xem chi tiết trước khi tạo lệnh.");
      return;
    }
    if (
      v.level === "warn" &&
      !window.confirm(
        "Một số linh kiện CHƯA đủ tồn tại ngày HĐ (xem mục 🔍 Kiểm tra). " +
          "Vẫn tạo lệnh nháp? (Anh có thể sửa ngày nhập hàng trước khi ghi sổ thật — hệ thống sẽ chặn nếu vẫn âm kho lúc ghi sổ.)",
      )
    )
      return;
    const comps = bom.rows.map((r) => ({
      item_id: r.item_id as number, warehouse_id: r.warehouse_id, so_luong: r.so_luong, note: r.note,
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
      const warnMsg = r.warnings?.length ? `\n\n⚠️ Cảnh báo từ hệ thống:\n- ${r.warnings.join("\n- ")}` : "";
      window.alert(
        `Đã tạo lệnh ghép bộ (nháp) LSX #${r.production_id}` +
          (r.recipe_id ? ` + lưu mẫu #${r.recipe_id}` : "") +
          `.\nVào tab Sản xuất kiểm tra & ghi sổ (hệ thống chặn âm kho).` + warnMsg,
      );
      setBom(null);
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
    if (!sel.size || !window.confirm(`Xóa ${sel.size} hóa đơn bán đã chọn?`)) return;
    try {
      await api.invSaleBulkDelete(Array.from(sel));
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

  const whName = (id: number | null) => whs.find((w) => w.id === id)?.code ?? "?";

  return (
    <div className="docs-page">
      <div className="docs-toolbar">
        <h3>
          Hóa đơn bán ra <span className="count">{list.length}</span>
        </h3>
        <div className="tb-group">
          <select className="tb-select" value={statusF} onChange={(e) => setStatusF(e.target.value)}>
            <option value="">Tất cả</option>
            <option value="draft">Nháp</option>
            <option value="reviewed">Đã duyệt</option>
            <option value="void">Hủy</option>
          </select>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.xml,.zip"
            multiple
            style={{ display: "none" }}
            onChange={(e) => upload(e.target.files)}
          />
          <button className="btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? "Đang xử lý…" : "📥 Nạp hóa đơn (XML/PDF/ZIP)"}
          </button>
          <button className="btn-sm" onClick={() => setUrlOpen(true)}>
            🔗 Từ link
          </button>
          {sel.size > 0 && (
            <button className="btn-sm ghost" onClick={bulkDelete}>
              🗑️ Xóa ({sel.size})
            </button>
          )}
        </div>
      </div>
      {err && <div className="error">{err}</div>}

      <div className="table-wrap">
        <table className="dt">
          <thead>
            <tr>
              <th style={{ width: 28 }}></th>
              <th>Số HĐ</th>
              <th>Ngày</th>
              <th>Khách mua</th>
              <th>Nguồn</th>
              <th style={{ textAlign: "right" }}>Tổng tiền</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => {
              const [color, label] = STATUS_CHIP[p.status] ?? ["gray", p.status];
              return (
                <tr key={p.id} style={{ cursor: "pointer" }} onClick={() => open(p.id)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} />
                  </td>
                  <td className="nowrap">
                    {p.ky_hieu} {p.so_hd || <span className="chip red sm">?</span>}
                  </td>
                  <td className="nowrap">{p.ngay || <span className="chip red sm">thiếu ngày</span>}</td>
                  <td>
                    {p.ten_mua}
                    {p.is_dieu_chinh && <span className="chip amber sm"> ↩︎ điều chỉnh</span>}
                    {p.dup_of && <span className="chip red sm"> trùng #{p.dup_of}</span>}
                    {p.warnings.length > 0 && <span className="chip amber sm"> ⚠️ {p.warnings.length}</span>}
                  </td>
                  <td>
                    <span className="chip gray sm">{SOURCE_LABEL[p.source] ?? p.source}</span>
                  </td>
                  <td style={{ textAlign: "right" }}>{vnd(p.tong_tien)}</td>
                  <td>
                    <span className={`chip sm ${color}`}>{label}</span>
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <div className="empty">
                    <div className="empty-ic">🧾</div>
                    <div>
                      Chưa có hóa đơn bán. Bấm <b>Nạp hóa đơn</b> để import file XML/PDF/ZIP xuất từ
                      ihoadon.vn.
                    </div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {urlOpen && (
        <div className="modal-backdrop" onClick={() => setUrlOpen(false)}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <h3>🔗 Import hóa đơn bán từ link</h3>
            <p className="muted">Link Google Drive (folder/file) hoặc link PDF/XML/ZIP trực tiếp.</p>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" style={{ width: "100%" }} />
            <div className="modal-actions">
              <button onClick={() => setUrlOpen(false)}>Hủy</button>
              <button className="primary" disabled={busy || !url.trim()} onClick={doImportUrl}>
                {busy ? "Đang tải…" : "Import"}
              </button>
            </div>
          </div>
        </div>
      )}

      {cur && (
        <div className="modal-backdrop" onClick={() => setCur(null)}>
          <div className="modal review-2col" style={{ maxWidth: 1180 }} onClick={(e) => e.stopPropagation()}>
            <div className="review-form">
              <h3>
                HĐ bán {cur.ky_hieu} {cur.so_hd}{" "}
                <span className={`chip sm ${(STATUS_CHIP[cur.status] ?? ["gray"])[0]}`}>
                  {(STATUS_CHIP[cur.status] ?? ["", cur.status])[1]}
                </span>
                {cur.is_dieu_chinh && <span className="chip amber sm"> ↩︎ điều chỉnh</span>}
              </h3>

              {cur.warnings.length > 0 && (
                <div className="warn-banner" style={{ maxHeight: 130, overflow: "auto" }}>
                  <ul style={{ margin: "4px 0 0 16px" }}>
                    {cur.warnings.map((w, i) => (
                      <li key={i}>{w.msg}</li>
                    ))}
                  </ul>
                </div>
              )}
              {cur.is_dieu_chinh && (
                <div className="warn-banner">
                  ↩︎ Hóa đơn điều chỉnh/thay thế — <b>bỏ qua đối chiếu kho</b>, chỉ lưu vết.
                  {cur.dc_ref && <div className="muted">{cur.dc_ref}</div>}
                </div>
              )}

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0" }}>
                <label>
                  Số HĐ
                  <input value={cur.so_hd} onChange={(e) => setCur({ ...cur, so_hd: e.target.value })} />
                </label>
                <label>
                  Ký hiệu
                  <input value={cur.ky_hieu} onChange={(e) => setCur({ ...cur, ky_hieu: e.target.value })} />
                </label>
                <label>
                  Ngày
                  <input value={cur.ngay} onChange={(e) => setCur({ ...cur, ngay: e.target.value })} placeholder="YYYY-MM-DD" />
                </label>
                <label style={{ flex: 2 }}>
                  Khách mua
                  <input value={cur.ten_mua} onChange={(e) => setCur({ ...cur, ten_mua: e.target.value })} />
                </label>
                <label>
                  MST mua
                  <input value={cur.mst_mua} onChange={(e) => setCur({ ...cur, mst_mua: e.target.value })} />
                </label>
              </div>

              <div className="table-wrap" style={{ maxHeight: "46vh", overflow: "auto" }}>
                <table className="dt">
                  <thead>
                    <tr>
                      <th>Tên hàng</th>
                      <th>Loại</th>
                      <th style={{ textAlign: "right" }}>SL</th>
                      <th style={{ textAlign: "right" }}>Đơn giá</th>
                      <th>Mặt hàng kho</th>
                      <th>Đề xuất</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cur.lines.map((l) => {
                      const [cc, clabel] = CLASS_CHIP[l.line_class] ?? ["gray", l.line_class];
                      const skipKho = cur.is_dieu_chinh || l.fulfil_kind === "doanh_thu";
                      const isDraft = cur.status === "draft";
                      return (
                        <tr key={l.id} className={l.warn_am_kho || l.lech_dong ? "row-treo" : ""}>
                          <td style={{ minWidth: 240 }}>
                            {l.ten_raw}
                            {l.thue_kct && <span className="chip gray sm"> KCT</span>}
                          </td>
                          <td>
                            <span className={`chip sm ${cc}`}>{clabel}</span>
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {isDraft ? (
                              <input
                                style={{ width: 64, textAlign: "right" }}
                                defaultValue={l.so_luong}
                                onChange={(e) => patchLine(l.id, { so_luong: Number(e.target.value) || 0 })}
                              />
                            ) : (
                              qty(l.so_luong)
                            )}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {isDraft ? (
                              <input
                                style={{ width: 100, textAlign: "right" }}
                                defaultValue={l.don_gia_ban}
                                onChange={(e) => patchLine(l.id, { don_gia_ban: Number(e.target.value) || 0 })}
                              />
                            ) : (
                              vnd(l.don_gia_ban)
                            )}
                            {l.lech_dong && (
                              <div className="chip red sm" title="SL×đơn giá khác thành tiền trên hóa đơn — nghi ngờ lỗi parse">
                                HĐ ghi {vnd(l.thanh_tien)}
                              </div>
                            )}
                          </td>
                          <td style={{ minWidth: 200 }}>
                            {skipKho ? (
                              <span className="muted">—</span>
                            ) : l.item_id ? (
                              <span>
                                <span className="chip green sm">{l.item_ma_hang}</span> {l.item_ten}{" "}
                                <button
                                  className="btn-sm ghost"
                                  onClick={() => patchLine(l.id, { item_id: null, match_kind: "none" })}
                                >
                                  ✕
                                </button>
                              </span>
                            ) : (
                              <div>
                                {l.suggestions.slice(0, 3).map((s) => (
                                  <button
                                    key={s.item_id}
                                    className="btn-sm ghost"
                                    title={s.reason}
                                    onClick={() =>
                                      patchLine(l.id, {
                                        item_id: s.item_id, item_ma_hang: s.ma_hang,
                                        item_ten: s.ten, match_kind: "manual",
                                      })
                                    }
                                  >
                                    {s.ma_hang} · {(s.reason ?? "").replace("Giống ", "")}
                                  </button>
                                ))}
                                <input
                                  style={{ width: 130, marginTop: 2 }}
                                  placeholder="tìm mã/tên…"
                                  value={lineSearch?.lineId === l.id ? lineSearch.q : ""}
                                  onChange={(e) => searchLine(l.id, e.target.value)}
                                />
                                {lineSearch?.lineId === l.id &&
                                  lineSearch.results.slice(0, 5).map((it) => (
                                    <div key={it.id}>
                                      <button
                                        className="btn-sm ghost"
                                        onClick={() => {
                                          patchLine(l.id, {
                                            item_id: it.id, item_ma_hang: it.ma_hang,
                                            item_ten: it.ten, match_kind: "manual",
                                          });
                                          setLineSearch(null);
                                        }}
                                      >
                                        <b>{it.ma_hang}</b> · {it.ten}
                                      </button>
                                    </div>
                                  ))}
                              </div>
                            )}
                          </td>
                          <td style={{ minWidth: 190 }}>
                            <div className={l.warn_am_kho ? "" : "muted"}>{l.de_xuat}</div>
                            {!skipKho && l.fulfil_kind === "sx" && (
                              <button className="btn-sm" style={{ marginTop: 4 }} onClick={() => openBom(l)}>
                                🧩 Tạo BOM / công thức
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="modal-actions">
                <button onClick={() => setCur(null)}>Đóng</button>
                <button disabled={busy} onClick={() => saveDraft(false)}>
                  💾 Lưu
                </button>
                {!cur.is_dieu_chinh && cur.status !== "reviewed" && (
                  <button
                    className="primary"
                    disabled={busy || cur.lines.some((l) => l.lech_dong)}
                    title={
                      cur.lines.some((l) => l.lech_dong)
                        ? "Còn dòng SL×đơn giá lệch thành tiền (nghi ngờ lỗi parse) — sửa lại trước khi duyệt"
                        : ""
                    }
                    onClick={() => saveDraft(true)}
                  >
                    ✅ Lưu & Đánh dấu đã duyệt
                  </button>
                )}
                {!cur.is_dieu_chinh && cur.status === "reviewed" && (
                  <button className="primary" disabled={busy} onClick={genDocs}>
                    🏭 Sinh chứng từ (nháp)
                  </button>
                )}
              </div>
            </div>
            <div className="review-file">
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
                  <table className="dt xi-lines">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Tên hàng hóa, dịch vụ</th>
                        <th>ĐVT</th>
                        <th style={{ textAlign: "right" }}>SL</th>
                        <th style={{ textAlign: "right" }}>Đơn giá</th>
                        <th style={{ textAlign: "right" }}>Thành tiền</th>
                        <th style={{ textAlign: "right" }}>Thuế</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cur.lines.map((l, i) => (
                        <tr key={l.id}>
                          <td className="muted">{i + 1}</td>
                          <td>{l.ten_raw}</td>
                          <td className="muted">{l.dvt}</td>
                          <td style={{ textAlign: "right" }}>{qty(l.so_luong)}</td>
                          <td style={{ textAlign: "right" }}>{vnd(l.don_gia_ban)}</td>
                          <td style={{ textAlign: "right" }}>{vnd(l.thanh_tien)}</td>
                          <td style={{ textAlign: "right" }} className="muted">
                            {l.thue_kct ? "KCT" : `${qty(l.thue_suat)}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="xi-totals">
                    <div>
                      <span className="muted">Cộng tiền hàng:</span> <b>{vnd(cur.tong_truoc_thue)} đ</b>
                    </div>
                    <div>
                      <span className="muted">Tiền thuế:</span> <b>{vnd(cur.tong_thue)} đ</b>
                    </div>
                    <div className="xi-grand">
                      <span className="muted">Tổng thanh toán:</span> <b>{vnd(cur.tong_tien)} đ</b>
                    </div>
                  </div>
                  {cur.doc_url && (
                    <a className="muted" href={cur.doc_url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                      Mở file XML gốc ↗
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
        </div>
      )}

      {bom && (
        <div className="modal-backdrop" onClick={() => setBom(null)}>
          <div className="modal" style={{ maxWidth: 1280 }} onClick={(e) => e.stopPropagation()}>
            <h3>🧩 Ghép bộ: {bom.lineName}</h3>
            {err && <div className="error" style={{ marginBottom: 8 }}>{err}</div>}
            <p className="muted">
              Bóc tách bộ thành linh kiện tiêu hao trong kho → tạo lệnh sản xuất (nháp). Giá vốn bộ =
              tổng giá vốn linh kiện thật (không ép theo biên). Ngày HĐ: <b>{bom.ngay || "?"}</b> · Giá bán dòng
              (chưa thuế): <b>{vnd(bom.giaBan)}đ</b>.
            </p>

            <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, marginBottom: 8 }}>
              <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>
                💬 Ngữ cảnh / hướng dẫn AI cho kèo này (tuỳ chọn — càng chi tiết AI càng đúng thực tế)
              </label>
              <textarea
                rows={2}
                style={{ width: "100%" }}
                placeholder="VD: khách yêu cầu đổi sang camera Hikvision; lắp ngoài trời nên cần vỏ chống nước; công trình đã có sẵn switch, không cần mua thêm; cắt bớt phần dây vì đi ngầm sẵn…"
                value={bom.context}
                onChange={(e) => setBom({ ...bom, context: e.target.value })}
              />
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "6px 0" }}>
              <button className="btn-sm" disabled={bom.aiBusy} onClick={aiSuggestBom}>
                {bom.aiBusy ? "🤖 AI đang nghĩ…" : bom.rows.length ? "🤖 AI gợi ý lại (thay hết)" : "🤖 AI gợi ý linh kiện"}
              </button>
              {bom.rows.length > 0 && (
                <button className="btn-sm ghost" disabled={bom.aiBusy} onClick={aiSuggestMore} title="AI xem lại quy mô thực tế + ngữ cảnh, chỉ thêm phần còn thiếu — KHÔNG xóa các dòng đã có">
                  {bom.aiBusy ? "🤖 AI đang nghĩ…" : "➕ AI gợi ý thêm"}
                </button>
              )}
              <button className="btn-sm ghost" onClick={addRow}>
                + Thêm dòng
              </button>
              <button className="btn-sm ghost" onClick={testBom}>
                🔍 Kiểm tra
              </button>
              {bom.outputItemId ? (
                <span style={{ marginLeft: "auto" }} className="muted">
                  Thành phẩm: <span className="chip green sm">{bom.outputLabel.split(" · ")[0]}</span>{" "}
                  {bom.outputLabel.split(" · ").slice(1).join(" · ")}
                </span>
              ) : (
                <label style={{ marginLeft: "auto" }}>
                  Mã TP mới:{" "}
                  <input
                    style={{ width: 110 }}
                    value={bom.outputMaHang}
                    onChange={(e) => setBom({ ...bom, outputMaHang: e.target.value })}
                  />
                </label>
              )}
            </div>
            {bom.aiNote && (
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                🤖 {bom.aiNote}
              </div>
            )}
            {bom.test && (
              <div
                className="warn-banner"
                style={{
                  background: bom.test.level === "ok" ? "#e8f7ee" : bom.test.level === "warn" ? undefined : "#fdecea",
                  marginBottom: 8,
                }}
              >
                <b>
                  {bom.test.level === "ok" ? "✅ Kiểm tra OK" : bom.test.level === "warn" ? "⚠️ Có cảnh báo" : "❌ Chưa hợp lệ"}
                </b>
                <ul style={{ margin: "4px 0 0 16px" }}>
                  {bom.test.messages.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="table-wrap" style={{ maxHeight: "42vh", overflow: "auto" }}>
              <table className="dt">
                <thead>
                  <tr>
                    <th>Linh kiện (mã kho)</th>
                    <th>ĐVT</th>
                    <th>Kho</th>
                    <th style={{ textAlign: "right" }}>SL</th>
                    <th style={{ textAlign: "right" }}>Giá vốn/đv (chưa thuế)</th>
                    <th style={{ textAlign: "right" }}>Thuế %</th>
                    <th style={{ textAlign: "right" }}>Thành tiền (có thuế)</th>
                    <th style={{ textAlign: "right" }}>Khả dụng tại ngày HĐ</th>
                    <th>Mô tả / lý do</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {bom.rows.map((r, i) => {
                    const thieu = r.item_id && r.kha_dung < r.so_luong;
                    const thanhTienTax = r.so_luong * r.don_gia_bq * (1 + r.thue_suat_est / 100);
                    return (
                      <tr key={i} className={thieu ? "row-treo" : ""}>
                        <td style={{ minWidth: 220, maxWidth: 320, whiteSpace: "normal", wordBreak: "break-word" }}>
                          {r.item_id ? (
                            <span>
                              <span className="chip green sm">{r.ma_hang}</span> {r.ten}{" "}
                              <button
                                className="btn-sm ghost"
                                onClick={() => setRow(i, { item_id: null, ma_hang: "", ten: "", dvt: "", don_gia_bq: 0, kha_dung: 0 })}
                              >
                                ✕
                              </button>
                            </span>
                          ) : (
                            <div>
                              <input
                                style={{ width: 160 }}
                                placeholder="tìm mã/tên kho…"
                                value={r.q}
                                onChange={(e) => searchRow(i, e.target.value)}
                              />
                              {r.results.slice(0, 5).map((it) => (
                                <div key={it.id}>
                                  <button className="btn-sm ghost" onClick={() => pickRow(i, it)}>
                                    <b>{it.ma_hang}</b> · {it.ten}
                                  </button>
                                </div>
                              ))}
                              {r.ten && (
                                <div className="muted" style={{ fontSize: 11 }}>
                                  🤖 AI đề xuất: <b>{r.ten}</b> — chưa có mã trong kho, tạo mới hoặc chọn mã tương tự ở trên.
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="muted">{r.dvt}</td>
                        <td>
                          <select value={r.warehouse_id} onChange={(e) => setRow(i, { warehouse_id: Number(e.target.value) })}>
                            {whs.map((w) => (
                              <option key={w.id} value={w.id}>
                                {w.code}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <input
                            style={{ width: 60, textAlign: "right" }}
                            type="number"
                            value={r.so_luong}
                            onChange={(e) => setRow(i, { so_luong: Number(e.target.value) })}
                          />
                        </td>
                        <td style={{ textAlign: "right" }} className="muted">
                          {vnd(r.don_gia_bq)}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <input
                            style={{ width: 48, textAlign: "right" }}
                            type="number"
                            value={r.thue_suat_est}
                            onChange={(e) => setRow(i, { thue_suat_est: Number(e.target.value) })}
                          />
                        </td>
                        <td style={{ textAlign: "right" }}>{vnd(thanhTienTax)}</td>
                        <td style={{ textAlign: "right" }} className={thieu ? "" : "muted"}>
                          {r.item_id ? qty(r.kha_dung) : "—"}
                          {thieu && <div style={{ fontSize: 11 }}>⚠️ thiếu {qty(r.so_luong - r.kha_dung)}</div>}
                        </td>
                        <td>
                          <input style={{ width: 160 }} value={r.note} onChange={(e) => setRow(i, { note: e.target.value })} />
                        </td>
                        <td>
                          <button className="btn-sm ghost" onClick={() => delRow(i)}>
                            🗑️
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!bom.rows.length && (
                    <tr>
                      <td colSpan={10}>
                        <div className="muted" style={{ padding: 12 }}>
                          Chưa có linh kiện — bấm 🤖 AI gợi ý hoặc + Thêm dòng.
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {bom.rows.length > 0 && (() => {
              const t = bomTotals(bom.rows, bom.giaBan);
              const marginOk = t.marginPct !== null && t.marginPct >= 15 && t.marginPct <= 20;
              return (
                <div className="xi-totals" style={{ marginTop: 8 }}>
                  <div>
                    <span className="muted">Tổng giá vốn (chưa thuế):</span> <b>{vnd(t.costPretax)}đ</b>
                  </div>
                  <div>
                    <span className="muted">Tổng giá vốn (có thuế):</span> <b>{vnd(t.costWithTax)}đ</b>
                  </div>
                  <div>
                    <span className="muted">Giá bán đề xuất (biên 15-20%):</span>{" "}
                    <b>{vnd(t.priceLow)}đ – {vnd(t.priceHigh)}đ</b>
                  </div>
                  <div className={marginOk ? "xi-grand" : ""} style={!marginOk && t.marginPct !== null ? { color: "#b3261e" } : undefined}>
                    <span className="muted">Biên lợi nhuận thực tế (giá bán {vnd(bom.giaBan)}đ):</span>{" "}
                    <b>{t.marginPct === null ? "—" : `${t.marginPct.toFixed(1)}%`}</b>
                    {t.marginPct !== null && !marginOk && " ⚠️ ngoài khoảng mục tiêu 15-20%"}
                  </div>
                </div>
              );
            })()}

            <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
              <input type="checkbox" checked={bom.saveRecipe} onChange={(e) => setBom({ ...bom, saveRecipe: e.target.checked })} />
              Lưu thành mẫu (dùng lại lần sau)
              {bom.saveRecipe && (
                <input
                  style={{ flex: 1 }}
                  value={bom.recipeName}
                  onChange={(e) => setBom({ ...bom, recipeName: e.target.value })}
                  placeholder="tên mẫu"
                />
              )}
            </label>
            <div className="modal-actions">
              <button onClick={() => setBom(null)}>Hủy</button>
              <button className="primary" disabled={busy} onClick={submitBom}>
                🏭 Tạo lệnh ghép bộ (nháp)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
