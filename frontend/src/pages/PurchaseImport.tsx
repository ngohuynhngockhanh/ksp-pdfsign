import { useEffect, useRef, useState } from "react";
import { api, BangKeResult, InvItem, InvPurchase, InvPurchaseLine, InvWarehouse } from "../api";
import { DateFilter, DateRange } from "../components/DateFilter";
import { getParam, setParam } from "../util";

function vnd(n: number): string {
  return Math.round(n).toLocaleString("vi-VN");
}

// Doc so kieu VN: '652.777,77' (phay=thap phan), '1.500.000', '652,777.77'
function vnNum(s: string): number {
  const t = (s || "").trim().replace(/\s/g, "");
  if (!t) return 0;
  let x = t;
  const hasDot = x.includes("."), hasComma = x.includes(",");
  if (hasDot && hasComma) {
    x = x.lastIndexOf(",") > x.lastIndexOf(".")
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

const STATUS_CHIP: Record<string, [string, string]> = {
  draft: ["amber", "Nháp — chờ duyệt"],
  posted: ["green", "Đã ghi sổ"],
  void: ["gray", "Đã hủy"],
};

const SOURCE_LABEL: Record<string, string> = {
  xml: "XML",
  pdf: "PDF",
  scan_ai: "Scan + AI",
  manual: "Nhập tay",
};

export function PurchaseImport({
  openId,
  onConsumed,
}: { openId?: number | null; onConsumed?: () => void } = {}) {
  const [list, setList] = useState<InvPurchase[]>([]);
  const [statusF, setStatusF] = useState("");
  const [vatF, setVatF] = useState(""); // "" = tat ca; "0"|"5"|"8"|"10" = HD co dong thue suat do
  const [dateRange, setDateRange] = useState<DateRange>({ tu: "", den: "" });
  const [cur, setCur] = useState<InvPurchase | null>(null);
  const [whs, setWhs] = useState<InvWarehouse[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const bangKeRef = useRef<HTMLInputElement>(null);
  const [itemQuery, setItemQuery] = useState<{ line: number; q: string; results: InvItem[] } | null>(null);
  const [urlValue, setUrlValue] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  const [bangKeBusy, setBangKeBusy] = useState(false);
  const [bangKe, setBangKe] = useState<BangKeResult | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [listLoaded, setListLoaded] = useState(false);
  const autoHdRef = useRef(false);

  function toggleSel(id: number) {
    setSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  const dupIds = list.filter((p) => p.dup_of != null && p.status !== "posted").map((p) => p.id);
  // Loc VAT o server (list khong tra lines) — `shown` giu ten de render
  const shown = list;

  // Xuat: uu tien HD dang chon; khong chon gi -> theo bo loc hien tai (trang thai + ngay)
  function exportParams() {
    return sel.size > 0
      ? { ids: [...sel].join(",") }
      : { status_f: statusF, tu: dateRange.tu, den: dateRange.den };
  }

  async function bulkDelete(ids: number[], label: string) {
    if (ids.length === 0) return;
    if (!window.confirm(`Xóa ${ids.length} hóa đơn ${label}? (hóa đơn đã ghi sổ sẽ bị bỏ qua)`)) return;
    setBusy(true);
    setErr("");
    try {
      const r = await api.invPurchaseBulkDelete(ids);
      setUploadMsg([`🗑 Đã xóa ${r.deleted} hóa đơn${r.skipped ? `, bỏ qua ${r.skipped} đã ghi sổ` : ""}`]);
      setSel(new Set());
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function bulkPost() {
    const ids = [...sel];
    if (ids.length === 0) return;
    if (!window.confirm(`Ghi sổ ${ids.length} hóa đơn đã chọn?`)) return;
    setBusy(true);
    setErr("");
    try {
      const r = await api.invPurchaseBulkPost(ids);
      const fail = r.results.filter((x) => !x.ok);
      setUploadMsg([
        `✅ Ghi sổ ${r.ok}/${r.total} hóa đơn.`,
        ...fail.map((x) => `❌ ${x.ten || "#" + x.id}: ${x.error}`),
      ]);
      setSel(new Set());
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function load() {
    try {
      setList(await api.invPurchases(statusF, { ...dateRange, vat: vatF }));
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
  }, [statusF, dateRange.tu, dateRange.den, vatF]);
  // Nhay tu Tho kho (Ton kho) sang -> tu mo hoa don can sua
  useEffect(() => {
    if (openId) {
      open(openId);
      onConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);
  // F5 giu context: sau khi list load lan dau, tu mo lai modal chi tiet theo ?hd=
  useEffect(() => {
    if (!listLoaded || autoHdRef.current) return;
    autoHdRef.current = true;
    const hd = getParam("hd");
    if (hd) open(Number(hd));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listLoaded]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setErr("");
    try {
      const r = await api.invPurchaseUpload(Array.from(files));
      setUploadMsg(
        r.results.map((x) =>
          x.ok
            ? `✅ ${x.filename}: đã tạo bản nháp #${x.purchase_id}${x.dup_of ? ` — ⚠️ TRÙNG với HĐ #${x.dup_of}` : ""}`
            : `❌ ${x.filename}: ${x.error}`,
        ),
      );
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function importFromUrl() {
    const url = urlValue.trim();
    if (!url) return;
    setUrlBusy(true);
    setErr("");
    try {
      const r = await api.invPurchaseImportUrl(url);
      setUploadMsg(
        r.results.map((x) =>
          x.ok
            ? `✅ ${x.filename}: đã tạo bản nháp #${x.purchase_id}${x.dup_of ? ` — ⚠️ TRÙNG với HĐ #${x.dup_of}` : ""}`
            : `❌ ${x.filename}: ${x.error}`,
        ),
      );
      setUrlValue("");
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUrlBusy(false);
    }
  }

  async function uploadBangKe(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBangKeBusy(true);
    setErr("");
    try {
      setBangKe(await api.invPurchaseBangKe(files[0]));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBangKeBusy(false);
      if (bangKeRef.current) bangKeRef.current.value = "";
    }
  }

  async function open(id: number) {
    try {
      setCur(await api.invPurchase(id));
      setItemQuery(null);
      setParam("hd", String(id));
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  function closeCur() {
    setCur(null);
    setParam("hd", null);
  }

  function setLine(idx: number, patch: Partial<InvPurchaseLine>) {
    if (!cur) return;
    const lines = cur.lines.map((ln, i) => {
      if (i !== idx) return ln;
      const next = { ...ln, ...patch };
      // Sua SL hoac don gia -> tu tinh lai thanh tien = SL x DG (sua loi parse PDF nhet don gia vao thanh tien)
      if ("so_luong" in patch || "don_gia" in patch) {
        next.thanh_tien = Math.round(next.so_luong * next.don_gia);
      }
      return next;
    });
    setCur({ ...cur, lines });
  }

  async function saveDraft(): Promise<InvPurchase | null> {
    if (!cur) return null;
    try {
      const saved = await api.invPurchaseSave(cur.id, {
        so_hd: cur.so_hd,
        ky_hieu: cur.ky_hieu,
        mst_ban: cur.mst_ban,
        ten_ban: cur.ten_ban,
        ngay: cur.ngay,
        lines: cur.lines.map((ln) => ({
          stt: ln.stt,
          ten_raw: ln.ten_raw,
          dvt: ln.dvt,
          so_luong: ln.so_luong,
          don_gia: ln.don_gia,
          thanh_tien: ln.thanh_tien,
          thue_suat: ln.thue_suat,
          item_id: ln.item_id,
          warehouse_id: ln.warehouse_id,
          match_kind: ln.item_id ? "manual" : "none",
        })),
      });
      setCur(saved);
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
      setCur(await api.invPurchasePost(saved.id));
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function createItemFromLine(idx: number) {
    if (!cur) return;
    const ln = cur.lines[idx];
    let suggested = "";
    try {
      suggested = (await api.invSuggestItemCode()).code;
    } catch {
      /* ignore */
    }
    const ma = window.prompt("Mã hàng mới cho: " + ln.ten_raw, suggested);
    if (!ma) return;
    try {
      const it = await api.invCreateItem({ ma_hang: ma, ten: ln.ten_raw, dvt: ln.dvt });
      setLine(idx, { item_id: it.id, item_ma_hang: it.ma_hang, item_ten: it.ten, match_kind: "new" });
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

  const isDichVu = cur?.loai === "dich_vu";
  // HD dich vu khong nhap kho -> khong can khop mat hang
  const unmatched = cur && !isDichVu ? cur.lines.filter((ln) => !ln.item_id).length : 0;

  async function toggleLoai() {
    if (!cur) return;
    const next = cur.loai === "dich_vu" ? "hang_hoa" : "dich_vu";
    try {
      setCur(await api.invPurchaseSave(cur.id, { loai: next }));
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="docs-page">
      <div className="docs-toolbar">
        <h3>
          Nhập hàng (HĐ mua vào) <span className="count">{list.length}</span>
        </h3>
        <div className="tb-group">
          <select className="tb-select" value={statusF} onChange={(e) => setStatusF(e.target.value)}>
            <option value="">Tất cả trạng thái</option>
            <option value="draft">Nháp chờ duyệt</option>
            <option value="posted">Đã ghi sổ</option>
          </select>
          <DateFilter value={dateRange} onChange={setDateRange} />
          <select className="tb-select" value={vatF} onChange={(e) => setVatF(e.target.value)} title="Lọc theo thuế suất dòng hàng">
            <option value="">VAT: tất cả</option>
            <option value="0">VAT 0% / KCT</option>
            <option value="5">VAT 5%</option>
            <option value="8">VAT 8%</option>
            <option value="10">VAT 10%</option>
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
            {busy ? "Đang xử lý…" : "📤 Tải hóa đơn (PDF/XML/ZIP)"}
          </button>
          <button
            className="btn-sm ghost"
            title="Đồng bộ file gốc HĐ mua lên NAS (chỉ file mới/đã đổi — theo checksum)"
            onClick={async () => {
              try {
                const r = await api.invPurchaseSyncNas();
                window.alert(`NAS: ${r.synced} đồng bộ mới, ${r.skipped} bỏ qua (đã có), ${r.failed} lỗi.`);
              } catch (e) {
                window.alert((e as Error).message);
              }
            }}
          >
            💾 Sync NAS
          </button>
          <input
            className="tb-select"
            placeholder="🔗 Dán link (Drive/PDF/XML/ZIP)…"
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            style={{ minWidth: 260 }}
          />
          <button className="btn-sm" disabled={urlBusy || !urlValue.trim()} onClick={importFromUrl}>
            {urlBusy ? "Đang tải…" : "Tải từ link"}
          </button>
          <input
            ref={bangKeRef}
            type="file"
            accept=".xlsx"
            style={{ display: "none" }}
            onChange={(e) => uploadBangKe(e.target.files)}
          />
          <button className="btn-sm" disabled={bangKeBusy} onClick={() => bangKeRef.current?.click()}>
            {bangKeBusy ? "Đang đối chiếu…" : "📊 Đối chiếu bảng kê thuế"}
          </button>
        </div>
      </div>
      {err && <div className="error">{err}</div>}
      {uploadMsg.length > 0 && (
        <div className="warn-banner">
          {uploadMsg.map((m, i) => (
            <div key={i}>{m}</div>
          ))}
        </div>
      )}
      <div className="tb-group" style={{ margin: "6px 0", flexWrap: "wrap", gap: 8 }}>
        <span className="muted">
          {sel.size > 0 ? `Đã chọn ${sel.size}` : `${shown.length} hóa đơn`}
          {vatF !== "" && <span className="chip amber sm" style={{ marginLeft: 6 }}>lọc VAT {vatF}%</span>}
        </span>
        {sel.size > 0 && (
          <>
            <button className="btn-sm" disabled={busy} onClick={bulkPost}>
              ✅ Ghi sổ đã chọn ({sel.size})
            </button>
            <button className="btn-sm danger" disabled={busy} onClick={() => bulkDelete([...sel], "đã chọn")}>
              🗑 Xóa đã chọn ({sel.size})
            </button>
            <button className="btn-sm" onClick={() => setSel(new Set())}>Bỏ chọn</button>
          </>
        )}
        {dupIds.length > 0 && (
          <button className="btn-sm danger" disabled={busy} onClick={() => bulkDelete(dupIds, "TRÙNG")}>
            🧹 Xóa hết trùng ({dupIds.length})
          </button>
        )}
        <button
          className="btn-sm ghost"
          onClick={() =>
            window.open(
              api.invExportUrl("purchase", "zip", exportParams()),
              "_blank",
            )
          }
        >
          ⬇ ZIP gốc
        </button>
        <button
          className="btn-sm ghost"
          onClick={() =>
            window.open(
              api.invExportUrl("purchase", "xlsx", exportParams()),
              "_blank",
            )
          }
        >
          ⬇ Excel
        </button>
      </div>

      <div className="table-wrap">
        <table className="dt">
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={shown.length > 0 && sel.size === shown.length}
                  onChange={(e) => setSel(e.target.checked ? new Set(shown.map((p) => p.id)) : new Set())}
                />
              </th>
              <th>#</th>
              <th>Ngày HĐ</th>
              <th>Số HĐ</th>
              <th>Bên bán</th>
              <th style={{ textAlign: "right" }}>Tổng tiền</th>
              <th>Nguồn</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const [color, label] = STATUS_CHIP[p.status] ?? ["gray", p.status];
              return (
                <tr key={p.id} style={{ cursor: "pointer" }} onClick={() => open(p.id)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      style={{ width: "auto" }}
                      checked={sel.has(p.id)}
                      onChange={() => toggleSel(p.id)}
                    />
                  </td>
                  <td className="muted">#{p.id}</td>
                  <td className="nowrap">{p.ngay || <span className="chip red sm">thiếu ngày</span>}</td>
                  <td>{p.so_hd}</td>
                  <td>
                    {p.ten_ban}
                    {p.loai === "dich_vu" && <span className="chip indigo sm"> 🧾 Dịch vụ</span>}
                    {p.dup_of && <span className="chip red sm"> trùng #{p.dup_of}</span>}
                    {p.warnings.length > 0 && (
                      <span className="chip amber sm"> ⚠️ {p.warnings.length}</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>{vnd(p.tong_tien)}</td>
                  <td>
                    <span className="chip gray sm">{SOURCE_LABEL[p.source] ?? p.source}</span>
                  </td>
                  <td>
                    <span className={`chip sm ${color}`}>{label}</span>
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <div className="empty">
                    <div className="empty-ic">🧾</div>
                    <div>Chưa có hóa đơn mua vào nào. Bấm "Tải hóa đơn" để bắt đầu.</div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {cur && (
        <div className="modal-backdrop" onClick={closeCur}>
          <div className="modal" style={{ maxWidth: 1360 }} onClick={(e) => e.stopPropagation()}>
            <h3>
              Hóa đơn mua #{cur.id}{" "}
              <span className={`chip sm ${(STATUS_CHIP[cur.status] ?? ["gray"])[0]}`}>
                {(STATUS_CHIP[cur.status] ?? ["", cur.status])[1]}
              </span>{" "}
              <span className="chip gray sm">{SOURCE_LABEL[cur.source] ?? cur.source}</span>{" "}
              <span className={`chip sm ${isDichVu ? "indigo" : "green"}`}>
                {isDichVu ? "🧾 Dịch vụ / chi phí" : "📦 Hàng hóa (nhập kho)"}
              </span>
              {cur.status === "draft" && (
                <button className="btn-sm" style={{ marginLeft: 6 }} onClick={toggleLoai}>
                  ⇄ Đổi thành {isDichVu ? "hàng hóa" : "dịch vụ"}
                </button>
              )}
              {cur.doc_url && (
                <a className="btn-sm" style={{ marginLeft: 8 }} href={cur.doc_url} target="_blank" rel="noreferrer">
                  📄 File gốc
                </a>
              )}
            </h3>
            {cur.status === "posted" && (
              <div className="warn-banner" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span>
                  🔒 <b>Hóa đơn đã ghi sổ</b> nên các ô đang bị khóa. Muốn sửa lại đơn giá/số lượng, bấm{" "}
                  <b>Hủy ghi sổ</b> → sửa → Ghi sổ lại (tồn kho tự tính lại).
                </span>
                <button
                  className="btn-sm danger"
                  disabled={busy}
                  onClick={async () => {
                    if (!window.confirm("Hủy ghi sổ hóa đơn này để sửa? Tồn kho sẽ được tính lại.")) return;
                    setBusy(true);
                    setErr("");
                    try {
                      setCur(await api.invPurchaseVoid(cur.id));
                    } catch (e) {
                      setErr((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  ↩️ Hủy ghi sổ để sửa
                </button>
              </div>
            )}
            {isDichVu && (
              <p className="muted" style={{ margin: "4px 0" }}>
                Hóa đơn dịch vụ/chi phí: ghi sổ chỉ để lưu vết + đối chiếu bảng kê thuế,{" "}
                <b>không nhập kho</b>, không cần khớp mặt hàng.
              </p>
            )}
            <div className="review-2col">
              <div className="review-form">
            {cur.warnings.length > 0 && (
              <div className="warn-banner">
                {cur.warnings.map((w, i) => (
                  <div key={i}>⚠️ {w.msg}</div>
                ))}
              </div>
            )}
            <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
              <label>
                Ngày (YYYY-MM-DD)
                <input
                  type="date"
                  value={cur.ngay}
                  disabled={cur.status !== "draft"}
                  onChange={(e) => setCur({ ...cur, ngay: e.target.value })}
                />
              </label>
              <label>
                Số HĐ
                <input value={cur.so_hd} disabled={cur.status !== "draft"} onChange={(e) => setCur({ ...cur, so_hd: e.target.value })} />
              </label>
              <label>
                Ký hiệu
                <input value={cur.ky_hieu} disabled={cur.status !== "draft"} onChange={(e) => setCur({ ...cur, ky_hieu: e.target.value })} />
              </label>
              <label>
                MST bên bán
                <input value={cur.mst_ban} disabled={cur.status !== "draft"} onChange={(e) => setCur({ ...cur, mst_ban: e.target.value })} />
              </label>
              <label>
                Tên bên bán
                <input value={cur.ten_ban} disabled={cur.status !== "draft"} onChange={(e) => setCur({ ...cur, ten_ban: e.target.value })} />
              </label>
            </div>

            <div className="table-wrap" style={{ marginTop: 10, maxHeight: "45vh", overflow: "auto" }}>
              <table className="dt">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Tên trên hóa đơn</th>
                    <th style={{ width: 70 }}>ĐVT</th>
                    <th style={{ textAlign: "right" }}>SL</th>
                    <th style={{ textAlign: "right" }}>Đơn giá</th>
                    <th style={{ textAlign: "right" }}>Thành tiền</th>
                    <th style={{ textAlign: "right", width: 70 }}>VAT %</th>
                    <th>Kho</th>
                    <th style={{ minWidth: 240 }}>Mặt hàng tồn kho</th>
                    <th style={{ width: 28 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {cur.lines.map((ln, idx) => (
                    <tr key={ln.id ?? idx}>
                      <td className="muted">{ln.stt}</td>
                      <td>
                        {cur.status === "draft" ? (
                          <input value={ln.ten_raw} onChange={(e) => setLine(idx, { ten_raw: e.target.value })} />
                        ) : (
                          ln.ten_raw
                        )}
                        {ln.warnings.map((w, i) => (
                          <div key={i} className="chip red sm">
                            {w.msg}
                          </div>
                        ))}
                      </td>
                      <td style={{ width: 70 }}>
                        {cur.status === "draft" ? (
                          <input
                            style={{ width: 66 }}
                            placeholder="Cái…"
                            value={ln.dvt}
                            onChange={(e) => setLine(idx, { dvt: e.target.value })}
                          />
                        ) : (
                          ln.dvt || <span className="chip red sm">?</span>
                        )}
                      </td>
                      <td style={{ textAlign: "right", width: 70 }}>
                        {cur.status === "draft" ? (
                          <input
                            style={{ width: 70, textAlign: "right" }}
                            value={ln.so_luong}
                            onChange={(e) => setLine(idx, { so_luong: vnNum(e.target.value) })}
                          />
                        ) : (
                          ln.so_luong
                        )}
                      </td>
                      <td style={{ textAlign: "right", width: 110 }}>
                        {cur.status === "draft" ? (
                          <input
                            style={{ width: 110, textAlign: "right" }}
                            value={ln.don_gia}
                            onChange={(e) => setLine(idx, { don_gia: vnNum(e.target.value) })}
                          />
                        ) : (
                          vnd(ln.don_gia)
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {vnd(ln.so_luong * ln.don_gia)}
                        {ln.thanh_tien > 0 &&
                          Math.abs(ln.so_luong * ln.don_gia - ln.thanh_tien) > 1 && (
                            <div className="chip red sm" title="SL×ĐG khác thành tiền trên hóa đơn — sửa lại SL hoặc đơn giá">
                              HĐ ghi {vnd(ln.thanh_tien)}
                            </div>
                          )}
                      </td>
                      <td style={{ textAlign: "right", width: 70 }}>
                        {cur.status === "draft" ? (
                          <input
                            style={{ width: 60, textAlign: "right" }}
                            value={ln.thue_suat}
                            onChange={(e) => setLine(idx, { thue_suat: vnNum(e.target.value) })}
                          />
                        ) : (
                          `${ln.thue_suat}%`
                        )}
                      </td>
                      <td>
                        <select
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
                      <td>
                        {ln.item_id ? (
                          <span>
                            <span className={`chip sm ${ln.match_kind === "exact" ? "green" : "indigo"}`}>
                              {ln.match_kind === "exact"
                                ? "✔ khớp"
                                : ln.match_kind === "fuzzy"
                                ? "~ gợi ý"
                                : ln.match_kind === "learned"
                                ? "🧠 đã học"
                                : "✔ đã chọn"}
                            </span>{" "}
                            {ln.item_ma_hang || `#${ln.item_id}`}
                            {cur.status === "draft" && (
                              <button className="btn-sm ghost" onClick={() => setLine(idx, { item_id: null, item_ma_hang: "", match_kind: "none" })}>
                                ✕
                              </button>
                            )}
                          </span>
                        ) : cur.status === "draft" ? (
                          <div>
                            <input
                              placeholder="tìm mã/tên…"
                              value={itemQuery?.line === idx ? itemQuery.q : ""}
                              onChange={(e) => searchItems(idx, e.target.value)}
                            />
                            {itemQuery?.line === idx &&
                              itemQuery.results.slice(0, 5).map((it) => (
                                <div key={it.id}>
                                  <button
                                    className="btn-sm ghost"
                                    onClick={() => {
                                      setLine(idx, { item_id: it.id, item_ma_hang: it.ma_hang, item_ten: it.ten, match_kind: "manual" });
                                      setItemQuery(null);
                                    }}
                                  >
                                    {it.ma_hang} · {it.ten.slice(0, 45)}
                                  </button>
                                </div>
                              ))}
            {ln.suggestions.length > 0 && (
                              <div className="muted" style={{ margin: "3px 0 1px", fontSize: "0.75rem" }}>
                                Gợi ý khớp:
                              </div>
                            )}
                            {ln.suggestions.map((s) => (
                              <div key={s.item_id} style={{ marginBottom: 3 }}>
                                <button
                                  className="btn-sm ghost"
                                  style={{ textAlign: "left", whiteSpace: "normal", height: "auto" }}
                                  title={s.reason || ""}
                                  onClick={() => setLine(idx, { item_id: s.item_id, item_ma_hang: s.ma_hang, item_ten: s.ten, match_kind: "manual" })}
                                >
                                  {s.reason && (
                                    <span
                                      className={"chip sm " + ((s.score ?? 0) >= 0.99 ? "green" : (s.score ?? 0) >= 0.7 ? "amber" : "gray")}
                                      style={{ marginRight: 5 }}
                                    >
                                      {s.reason}
                                    </span>
                                  )}
                                  <b>{s.ma_hang}</b> · {s.ten}
                                </button>
                              </div>
                            ))}
                            <button className="btn-sm" onClick={() => createItemFromLine(idx)}>
                              ＋ Tạo mã mới
                            </button>
                          </div>
                        ) : (
                          <span className="chip red sm">chưa khớp</span>
                        )}
                      </td>
                      <td>
                        {cur.status === "draft" && (
                          <button
                            className="btn-sm ghost"
                            title="Bỏ dòng này (vd phí vận chuyển — không nhập kho)"
                            onClick={() => setCur({ ...cur, lines: cur.lines.filter((_, i) => i !== idx) })}
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 24,
                marginTop: 8,
                fontSize: "0.9rem",
              }}
            >
              <span>
                Cộng trước thuế: <b>{vnd(cur.tong_truoc_thue)}đ</b>
              </span>
              <span>
                Tiền thuế: <b>{vnd(cur.tong_thue)}đ</b>
              </span>
              <span style={{ fontSize: "1.05rem" }}>
                Tổng thanh toán: <b style={{ color: "var(--primary)" }}>{vnd(cur.tong_tien)}đ</b>
              </span>
            </div>

              </div>
              <div className="review-file">
                {cur.source === "tax_gdt" ? (
                  <>
                    <div className="tb-group" style={{ marginBottom: 6 }}>
                      <a
                        className="btn-sm ghost"
                        href={`/api/inv/purchase/${cur.id}/html`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        🔍 Mở HTML
                      </a>
                      <a className="btn-sm" href={`/api/inv/purchase/${cur.id}/pdf`} target="_blank" rel="noreferrer">
                        ⬇️ Tải PDF (để share)
                      </a>
                    </div>
                    <iframe src={`/api/inv/purchase/${cur.id}/html`} title="Bản thể hiện hóa đơn (cổng thuế)" />
                  </>
                ) : cur.doc_url ? (
                  <iframe
                    src={cur.doc_url + "#toolbar=0&navpanes=0&scrollbar=0&view=FitH"}
                    title="Hóa đơn gốc"
                  />
                ) : (
                  <div className="no-file">
                    Hóa đơn nhập tay — không có file gốc để đối chiếu.
                  </div>
                )}
              </div>
            </div>

            <div className="modal-actions">
              {cur.status === "draft" && (
                <>
                  <button className="btn-sm danger" onClick={async () => {
                    if (!window.confirm("Xóa bản nháp này?")) return;
                    await api.invPurchaseDelete(cur.id);
                    closeCur();
                    load();
                  }}>
                    Xóa nháp
                  </button>
                  <button
                    className="btn-sm"
                    title="Sửa lỗi parse PDF: đặt lại Thành tiền = Số lượng × Đơn giá cho MỌI dòng"
                    onClick={() => {
                      setCur({
                        ...cur,
                        lines: cur.lines.map((ln) => ({ ...ln, thanh_tien: Math.round(ln.so_luong * ln.don_gia) })),
                      });
                    }}
                  >
                    🔧 Tính lại thành tiền
                  </button>
                  <button
                    title="Lưu dòng rồi tính lại TỔNG hóa đơn = Σ thành tiền + Σ thuế (sửa header bị parse sai)"
                    onClick={async () => {
                      if (!cur) return;
                      setErr("");
                      try {
                        await saveDraft();
                        setCur(await api.invPurchaseRecalcTotals(cur.id));
                        load();
                      } catch (e) {
                        setErr((e as Error).message);
                      }
                    }}
                  >
                    Σ Tính lại tổng
                  </button>
                  <button onClick={saveDraft}>💾 Lưu nháp</button>
                  <button
                    className="primary"
                    disabled={unmatched > 0 || !cur.ngay}
                    title={unmatched > 0 ? `Còn ${unmatched} dòng chưa khớp mặt hàng` : !cur.ngay ? "Thiếu ngày hóa đơn" : ""}
                    onClick={postCur}
                  >
                    {isDichVu ? "✅ Ghi sổ (dịch vụ, không nhập kho)" : `✅ Ghi sổ (${cur.lines.length} dòng)`}
                  </button>
                </>
              )}
              {cur.status === "posted" && (
                <button
                  className="btn-sm danger"
                  onClick={async () => {
                    if (!window.confirm("Hủy ghi sổ hóa đơn này? Tồn kho sẽ được tính lại.")) return;
                    try {
                      setCur(await api.invPurchaseVoid(cur.id));
                      load();
                    } catch (e) {
                      setErr((e as Error).message);
                    }
                  }}
                >
                  ↩️ Hủy ghi sổ
                </button>
              )}
              <button onClick={closeCur}>Đóng</button>
            </div>
          </div>
        </div>
      )}

      {bangKe && (
        <div className="modal-backdrop" onClick={() => setBangKe(null)}>
          <div className="modal" style={{ maxWidth: 1000 }} onClick={(e) => e.stopPropagation()}>
            <h3>Đối chiếu bảng kê thuế</h3>

            <h4>
              <span className="chip green sm">✓ Khớp</span> <span className="count">{bangKe.khop.length}</span>
            </h4>
            {bangKe.khop.length > 0 && (
              <div className="table-wrap" style={{ maxHeight: "20vh", overflow: "auto" }}>
                <table className="dt">
                  <thead>
                    <tr>
                      <th>Số HĐ</th>
                      <th>Ngày</th>
                      <th>Bên bán</th>
                      <th style={{ textAlign: "right" }}>Giá trị</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bangKe.khop.map((r, i) => (
                      <tr key={i}>
                        <td>{r.so_hd}</td>
                        <td>{r.ngay}</td>
                        <td>{r.ten_ban}</td>
                        <td style={{ textAlign: "right" }}>{vnd(r.gia_tri)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h4>
              <span className="chip amber sm">⚠ Lệch tiền</span>{" "}
              <span className="count">{bangKe.lech_tien.length}</span>
            </h4>
            {bangKe.lech_tien.length > 0 && (
              <div className="table-wrap" style={{ maxHeight: "20vh", overflow: "auto" }}>
                <table className="dt">
                  <thead>
                    <tr>
                      <th>Số HĐ</th>
                      <th>Ngày</th>
                      <th>Bên bán</th>
                      <th style={{ textAlign: "right" }}>Bảng kê</th>
                      <th style={{ textAlign: "right" }}>Đã import</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bangKe.lech_tien.map((r, i) => (
                      <tr key={i}>
                        <td>{r.so_hd}</td>
                        <td>{r.ngay}</td>
                        <td>{r.ten_ban}</td>
                        <td style={{ textAlign: "right" }}>{vnd(r.gia_tri)}</td>
                        <td style={{ textAlign: "right" }}>{vnd(r.purchase_gia_tri ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h4>
              <span className="chip red sm">✗ Thiếu file</span>{" "}
              <span className="count">{bangKe.thieu_file.length}</span>
            </h4>
            <p className="muted">Có trong bảng kê thuế nhưng chưa import file hóa đơn — cần xin lại file từ nhà cung cấp.</p>
            {bangKe.thieu_file.length > 0 && (
              <div className="table-wrap" style={{ maxHeight: "20vh", overflow: "auto" }}>
                <table className="dt">
                  <thead>
                    <tr>
                      <th>Số HĐ</th>
                      <th>Ngày</th>
                      <th>Bên bán</th>
                      <th style={{ textAlign: "right" }}>Giá trị</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bangKe.thieu_file.map((r, i) => (
                      <tr key={i}>
                        <td>{r.so_hd}</td>
                        <td>{r.ngay}</td>
                        <td>{r.ten_ban}</td>
                        <td style={{ textAlign: "right" }}>{vnd(r.gia_tri)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h4>
              <span className="chip gray sm">？Ngoài bảng kê</span>{" "}
              <span className="count">{bangKe.ngoai_bang_ke.length}</span>
            </h4>
            {bangKe.ngoai_bang_ke.length > 0 && (
              <div className="table-wrap" style={{ maxHeight: "20vh", overflow: "auto" }}>
                <table className="dt">
                  <thead>
                    <tr>
                      <th>Số HĐ</th>
                      <th>Ngày</th>
                      <th>Bên bán</th>
                      <th style={{ textAlign: "right" }}>Giá trị</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bangKe.ngoai_bang_ke.map((r, i) => (
                      <tr key={i}>
                        <td>{r.so_hd}</td>
                        <td>{r.ngay}</td>
                        <td>{r.ten_ban}</td>
                        <td style={{ textAlign: "right" }}>{vnd(r.gia_tri)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="modal-actions">
              <button onClick={() => setBangKe(null)}>Đóng</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
