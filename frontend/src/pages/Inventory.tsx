import { useEffect, useRef, useState } from "react";
import { api, InvItem, InvWarehouse, ItemFlow, OpeningImportResult, StockCardRow, StockRow } from "../api";
import { PurchaseFixModal } from "./PurchaseFixModal";

function vnd(n: number): string {
  return Math.round(n).toLocaleString("vi-VN");
}
function qty(n: number): string {
  return Number(n.toFixed(4)).toLocaleString("vi-VN");
}
// Mau chip theo loai dong so (dau_ky xam, nhap/sx_in xanh, xuat/sx_out do, dieu_chinh vang)
function loaiChipClass(loai: string): string {
  if (loai === "nhap" || loai === "sx_in") return "green";
  if (loai === "xuat" || loai === "sx_out") return "red";
  if (loai === "dieu_chinh") return "amber";
  return "gray";
}
function statusChipClass(status: string): string {
  if (status === "posted") return "green";
  if (status === "void") return "gray";
  return "amber";
}

type SortKey = "ma_hang" | "ten" | "dvt" | "warehouse_code" | "ton" | "don_gia_bq" | "gia_tri" | "nhap_cuoi";

export function Inventory(_props: { onOpenPurchase?: (id: number) => void }) {
  const [fixId, setFixId] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("ma_hang");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [whs, setWhs] = useState<InvWarehouse[]>([]);
  const [whId, setWhId] = useState<number | 0>(0);
  const [rows, setRows] = useState<StockRow[]>([]);
  const [tong, setTong] = useState(0);
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
  // Gop ma hang
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mSrc, setMSrc] = useState<InvItem | null>(null);
  const [mTgt, setMTgt] = useState<InvItem | null>(null);
  const [mQuery, setMQuery] = useState<{ which: "src" | "tgt"; q: string; results: InvItem[] } | null>(null);

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
    if (!window.confirm(`Gộp "${mSrc.ma_hang} · ${mSrc.ten}" VÀO "${mTgt.ma_hang} · ${mTgt.ten}"?\n\nMã ${mSrc.ma_hang} sẽ biến mất, toàn bộ tồn/chứng từ dồn về ${mTgt.ma_hang}, tính lại giá bình quân. Không thể hoàn tác.`)) return;
    try {
      await api.invMergeItems(mSrc.id, mTgt.id);
      setMergeOpen(false);
      setMSrc(null);
      setMTgt(null);
      setMQuery(null);
      window.alert(`Đã gộp ${mSrc.ma_hang} vào ${mTgt.ma_hang}.`);
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function load() {
    setErr("");
    try {
      const r = await api.invStock({ warehouseId: whId || undefined, allItems: true });
      setRows(r.rows);
      setTong(r.tong_gia_tri);
      const items = await api.invItems();
      setReviewItems(items.filter((i) => i.note.startsWith("⚠️")));
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
  }, [whId]);

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
    } catch (e) {
      setErr((e as Error).message);
    }
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
      window.alert(
        `Đã import tồn đầu kỳ: ${r.applied?.moves ?? 0} dòng tồn · ${vnd(r.tong.tong_gia_tri)} đ`,
      );
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  const q = search.trim().toLowerCase();
  const filtered = q
    ? rows.filter(
        (r) => r.ten.toLowerCase().includes(q) || r.ma_hang.toLowerCase().includes(q),
      )
    : rows;
  const shown = [...filtered].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    let av: string | number = "";
    let bv: string | number = "";
    switch (sortKey) {
      case "ma_hang": av = a.ma_hang; bv = b.ma_hang; break;
      case "ten": av = a.ten; bv = b.ten; break;
      case "dvt": av = a.dvt; bv = b.dvt; break;
      case "warehouse_code": av = a.warehouse_code; bv = b.warehouse_code; break;
      case "ton": av = a.ton; bv = b.ton; break;
      case "don_gia_bq": av = a.don_gia_bq; bv = b.don_gia_bq; break;
      case "gia_tri": av = a.gia_tri; bv = b.gia_tri; break;
      case "nhap_cuoi": av = a.nhap_cuoi; bv = b.nhap_cuoi; break;
    }
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv), "vi") * dir;
  });
  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  }
  const sortArrow = (k: SortKey) => (sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "");
  const whName = (id: number) => whs.find((w) => w.id === id)?.code ?? "?";

  return (
    <div className="docs-page">
      <div className="docs-toolbar">
        <h3>
          Tồn kho <span className="count">{shown.length}</span>
          <span className="muted" style={{ marginLeft: 10, fontWeight: 400 }}>
            {shown.filter((r) => Math.abs(r.ton) >= 1e-6).length} còn tồn
          </span>
          <span className="muted" style={{ marginLeft: 12, fontWeight: 400 }}>
            Tổng giá trị: <b>{vnd(tong)} đ</b>
          </span>
        </h3>
        <div className="tb-group">
          <input
            className="search"
            placeholder="🔍 Tìm mã / tên hàng…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="tb-select" value={whId} onChange={(e) => setWhId(Number(e.target.value))}>
            <option value={0}>Tất cả kho</option>
            {whs.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx"
            style={{ display: "none" }}
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          <button className="btn-sm" disabled={importing} onClick={() => fileRef.current?.click()}>
            {importing ? "Đang đọc…" : "📥 Nhập tồn đầu kỳ (Excel)"}
          </button>
          <button className="btn-sm" onClick={() => setMergeOpen(true)}>
            🔀 Gộp mã hàng
          </button>
        </div>
      </div>
      {err && <div className="error">{err}</div>}
      {reviewItems.length > 0 && (
        <div className="warn-banner">
          <b>⚠️ {reviewItems.length} mặt hàng cần xử lý tay (ghi chú từ lần import):</b>
          <ul style={{ margin: "6px 0 0 18px" }}>
            {reviewItems.map((i) => {
              const thieuDvt = i.note.includes("thiếu ĐVT");
              return (
                <li key={i.id} style={{ marginBottom: 4 }}>
                  <b>{i.ma_hang}</b> · {i.ten.slice(0, 50)} — {i.note.replace("⚠️ ", "")}{" "}
                  {thieuDvt && (
                    <span style={{ whiteSpace: "nowrap" }}>
                      <input
                        style={{ width: 90, padding: "2px 6px" }}
                        placeholder="Cái / Bộ…"
                        list="dvt-goi-y"
                        value={dvtInputs[i.id] ?? ""}
                        onChange={(e) => setDvtInputs({ ...dvtInputs, [i.id]: e.target.value })}
                      />{" "}
                      <button
                        className="btn-sm"
                        disabled={!(dvtInputs[i.id] ?? "").trim()}
                        onClick={async () => {
                          const dvt = (dvtInputs[i.id] ?? "").trim();
                          if (!dvt) return;
                          // Xoa phan 'thiếu ĐVT' khoi ghi chu, giu canh bao khac neu co
                          const rest = i.note
                            .replace("⚠️ ", "")
                            .split("; ")
                            .filter((p) => p !== "thiếu ĐVT");
                          try {
                            await api.invUpdateItem(i.id, {
                              dvt,
                              note: rest.length ? "⚠️ " + rest.join("; ") : "",
                            });
                            load();
                          } catch (e) {
                            setErr((e as Error).message);
                          }
                        }}
                      >
                        💾 Lưu ĐVT
                      </button>
                    </span>
                  )}{" "}
                  <button
                    className="btn-sm ghost"
                    title="Đã xử lý xong — xóa ghi chú"
                    onClick={async () => {
                      if (!window.confirm(`Xác nhận đã xử lý xong ${i.ma_hang}? Ghi chú sẽ được xóa.`)) return;
                      try {
                        await api.invUpdateItem(i.id, { note: "" });
                        load();
                      } catch (e) {
                        setErr((e as Error).message);
                      }
                    }}
                  >
                    ✓ đã xử lý
                  </button>
                </li>
              );
            })}
          </ul>
          <datalist id="dvt-goi-y">
            {["Cái", "Bộ", "Chiếc", "Cuộn", "Sợi", "Mét", "Gói", "Hộp", "Thẻ", "Con"].map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </div>
      )}

      <div className="table-wrap">
        <table className="dt">
          <thead>
            <tr>
              <th style={{ cursor: "pointer" }} onClick={() => toggleSort("ma_hang")}>Mã{sortArrow("ma_hang")}</th>
              <th style={{ cursor: "pointer" }} onClick={() => toggleSort("ten")}>Tên hàng{sortArrow("ten")}</th>
              <th style={{ cursor: "pointer" }} onClick={() => toggleSort("dvt")}>ĐVT{sortArrow("dvt")}</th>
              <th style={{ cursor: "pointer" }} onClick={() => toggleSort("warehouse_code")}>Kho{sortArrow("warehouse_code")}</th>
              <th style={{ textAlign: "right", cursor: "pointer" }} onClick={() => toggleSort("ton")}>Tồn{sortArrow("ton")}</th>
              <th style={{ textAlign: "right", cursor: "pointer" }} className="col-hide-sm" onClick={() => toggleSort("don_gia_bq")}>
                Giá BQ{sortArrow("don_gia_bq")}
              </th>
              <th style={{ textAlign: "right", cursor: "pointer" }} onClick={() => toggleSort("gia_tri")}>Giá trị{sortArrow("gia_tri")}</th>
              <th style={{ cursor: "pointer" }} className="col-hide-sm" onClick={() => toggleSort("nhap_cuoi")}>Nhập gần nhất{sortArrow("nhap_cuoi")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const zeroTon = Math.abs(r.ton) < 1e-6;
              const treo = zeroTon && Math.abs(r.gia_tri) >= 0.5;
              const rowCls = treo ? "row-treo" : zeroTon ? "row-zero" : "";
              return (
                <tr
                  key={`${r.item_id}-${r.warehouse_id}`}
                  className={rowCls}
                  style={{ cursor: "pointer" }}
                  title={treo ? "⚠️ Tồn = 0 nhưng còn treo giá trị — cần soát" : "Xem thẻ kho"}
                  onClick={() => openCard(r)}
                >
                  <td className="nowrap">
                    {r.ma_hang}{" "}
                    <button
                      className="btn-sm ghost"
                      title="Dòng chảy"
                      onClick={(e) => {
                        e.stopPropagation();
                        openFlow(r);
                      }}
                    >
                      🔀
                    </button>
                  </td>
                  <td>
                    {r.ten}
                    {treo && <span className="chip amber sm" style={{ marginLeft: 6 }}>treo giá trị</span>}
                  </td>
                  <td className="muted">{r.dvt}</td>
                  <td>
                    <span className="chip gray sm">{r.warehouse_code}</span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {zeroTon ? <span className="muted">—</span> : <b>{qty(r.ton)}</b>}
                  </td>
                  <td style={{ textAlign: "right" }} className="muted col-hide-sm">
                    {zeroTon ? "—" : vnd(r.don_gia_bq)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {zeroTon && !treo ? <span className="muted">—</span> : vnd(r.gia_tri)}
                  </td>
                  <td className="muted nowrap col-hide-sm">{r.nhap_cuoi || "—"}</td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <div className="empty">
                    <div className="empty-ic">📦</div>
                    <div>
                      Chưa có tồn kho. Bấm <b>Nhập tồn đầu kỳ (Excel)</b> để import file tổng hợp
                      tồn kho từ kế toán.
                    </div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {mergeOpen && (
        <div className="modal-backdrop" onClick={() => setMergeOpen(false)}>
          <div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
            <h3>🔀 Gộp mã hàng (dồn về 1 mã, tính lại giá bình quân)</h3>
            <p className="muted">
              Dùng khi 2 mã thật ra là cùng một mặt hàng (vd <b>HH9013</b> tự sinh trùng với{" "}
              <b>HH0013</b> có sẵn). Chọn mã <b>nguồn</b> (sẽ biến mất) và mã <b>đích</b> (giữ lại).
            </p>

            {[
              { key: "src" as const, label: "① Mã NGUỒN — sẽ biến mất", val: mSrc, set: setMSrc, color: "red" },
              { key: "tgt" as const, label: "② Mã ĐÍCH — giữ lại", val: mTgt, set: setMTgt, color: "green" },
            ].map((f) => (
              <div key={f.key} style={{ marginTop: 10 }}>
                <label>{f.label}</label>
                {f.val ? (
                  <div>
                    <span className={`chip sm ${f.color}`}>{f.val.ma_hang}</span> {f.val.ten}{" "}
                    <button className="btn-sm ghost" onClick={() => f.set(null)}>
                      ✕ đổi
                    </button>
                  </div>
                ) : (
                  <div>
                    <input
                      placeholder="gõ mã hoặc tên để tìm…"
                      value={mQuery?.which === f.key ? mQuery.q : ""}
                      onChange={(e) => searchMerge(f.key, e.target.value)}
                    />
                    {mQuery?.which === f.key &&
                      mQuery.results.slice(0, 6).map((it) => (
                        <div key={it.id}>
                          <button
                            className="btn-sm ghost"
                            onClick={() => {
                              f.set(it);
                              setMQuery(null);
                            }}
                          >
                            <b>{it.ma_hang}</b> · {it.ten.slice(0, 46)}
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ))}

            {mSrc && mTgt && mSrc.id === mTgt.id && (
              <div className="error" style={{ marginTop: 10 }}>
                Hai mã đang trùng nhau — chọn 2 mã khác nhau.
              </div>
            )}
            <div className="modal-actions">
              <button onClick={() => setMergeOpen(false)}>Hủy</button>
              <button
                className="primary"
                disabled={!mSrc || !mTgt || mSrc.id === mTgt.id}
                onClick={doMerge}
              >
                🔀 Gộp {mSrc?.ma_hang ?? "?"} → {mTgt?.ma_hang ?? "?"}
              </button>
            </div>
          </div>
        </div>
      )}

      {card && (
        <div className="modal-backdrop" onClick={() => setCard(null)}>
          <div className="modal" style={{ maxWidth: 860 }} onClick={(e) => e.stopPropagation()}>
            <h3>
              Thẻ kho: {card.row.ma_hang} · {card.row.ten}{" "}
              <span className="chip gray sm">{card.row.warehouse_code}</span>
            </h3>
            <div className="table-wrap" style={{ maxHeight: "60vh", overflow: "auto" }}>
              <table className="dt">
                <thead>
                  <tr>
                    <th>Ngày</th>
                    <th>Loại</th>
                    <th style={{ textAlign: "right" }}>Nhập</th>
                    <th style={{ textAlign: "right" }}>Xuất</th>
                    <th style={{ textAlign: "right" }}>Đơn giá</th>
                    <th style={{ textAlign: "right" }}>Giá trị</th>
                    <th style={{ textAlign: "right" }}>Tồn</th>
                    <th>Chứng từ</th>
                  </tr>
                </thead>
                <tbody>
                  {card.moves.map((m) => (
                    <tr key={m.id}>
                      <td className="nowrap">{m.ngay}</td>
                      <td>
                        <span className={"chip sm " + (m.xuat ? "amber" : "green")}>
                          {m.loai_label}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>{m.nhap ? qty(m.nhap) : ""}</td>
                      <td style={{ textAlign: "right" }}>{m.xuat ? qty(m.xuat) : ""}</td>
                      <td style={{ textAlign: "right" }} className="muted">
                        {vnd(m.don_gia)}
                      </td>
                      <td style={{ textAlign: "right" }}>{vnd(m.gia_tri)}</td>
                      <td style={{ textAlign: "right" }}>
                        <b>{qty(m.ton)}</b>
                      </td>
                      <td className="nowrap">
                        {m.ref_type === "purchase" && m.ref_id ? (
                          <span className="nowrap">
                            <button
                              className="btn-sm"
                              title="Sửa lại đơn giá/số lượng hóa đơn này ngay tại đây"
                              onClick={() => setFixId(m.ref_id as number)}
                            >
                              ✏️ Sửa HĐ #{m.ref_id}
                            </button>{" "}
                            <a
                              href={`/api/inv/purchase/${m.ref_id}/file`}
                              target="_blank"
                              rel="noreferrer"
                              title="Mở file hóa đơn gốc"
                            >
                              ↗
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
            <div className="modal-actions">
              <button onClick={() => setCard(null)}>Đóng</button>
            </div>
          </div>
        </div>
      )}

      {flow && (
        <div className="modal-backdrop" onClick={() => setFlow(null)}>
          <div className="modal" style={{ maxWidth: 980 }} onClick={(e) => e.stopPropagation()}>
            <h3>
              🔀 Dòng chảy — {flow.item.ma_hang} · {flow.item.ten}
            </h3>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              {flow.ton.length === 0 ? (
                <span className="muted">Không còn tồn ở kho nào</span>
              ) : (
                flow.ton.map((t) => (
                  <span key={t.warehouse_code} className="chip gray sm">
                    {t.warehouse_code} · {qty(t.ton)} · {vnd(t.gia_tri)} đ
                  </span>
                ))
              )}
            </div>
            <div className="table-wrap" style={{ maxHeight: "50vh", overflow: "auto" }}>
              <table className="dt">
                <thead>
                  <tr>
                    <th>Ngày</th>
                    <th>Loại</th>
                    <th>Chứng từ</th>
                    <th>Đích đến</th>
                    <th style={{ textAlign: "right" }}>±SL</th>
                    <th style={{ textAlign: "right" }}>Giá trị</th>
                    <th style={{ textAlign: "right" }}>Số dư</th>
                  </tr>
                </thead>
                <tbody>
                  {flow.steps.map((s, i) => (
                    <tr key={i}>
                      <td className="nowrap">{s.ngay}</td>
                      <td className="nowrap">
                        <span className={`chip sm ${loaiChipClass(s.loai)}`}>{s.loai_label}</span>{" "}
                        <span className="chip gray sm">{s.warehouse_code}</span>
                      </td>
                      <td>
                        {s.doc ? (
                          <span>
                            {s.doc.label}{" "}
                            {s.doc.status && (
                              <span className={`chip sm ${statusChipClass(s.doc.status)}`}>
                                {s.doc.status}
                              </span>
                            )}
                          </span>
                        ) : (
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
                      <td style={{ textAlign: "right" }}>
                        {s.so_luong > 0 ? "+" : ""}
                        {qty(s.so_luong)}
                      </td>
                      <td style={{ textAlign: "right" }} className="muted">
                        {vnd(s.gia_tri)}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <b>{qty(s.so_du)}</b>
                      </td>
                    </tr>
                  ))}
                  {flow.steps.length === 0 && (
                    <tr>
                      <td colSpan={7}>
                        <span className="muted">Chưa có phát sinh</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <h4 style={{ marginTop: 14 }}>⚠ Đang kẹt ở chứng từ nháp</h4>
            {flow.stuck.length === 0 ? (
              <div className="muted">Không có gì kẹt ✅</div>
            ) : (
              <div className="table-wrap">
                <table className="dt">
                  <thead>
                    <tr>
                      <th>Loại</th>
                      <th>Chứng từ</th>
                      <th>Ngày</th>
                      <th>Kho</th>
                      <th style={{ textAlign: "right" }}>SL giữ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flow.stuck.map((s, i) => (
                      <tr key={i}>
                        <td>{s.kind === "issue" ? "Phiếu xuất" : "Lệnh SX"}</td>
                        <td>{s.label}</td>
                        <td className="nowrap">{s.ngay}</td>
                        <td>
                          <span className="chip gray sm">{s.warehouse_code}</span>
                        </td>
                        <td style={{ textAlign: "right" }}>{qty(s.so_luong)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="modal-actions">
              <button onClick={() => setFlow(null)}>Đóng</button>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <div className="modal" style={{ maxWidth: 900 }} onClick={(e) => e.stopPropagation()}>
            <h3>Xem trước import tồn đầu kỳ (31/12/2025)</h3>
            <p>
              {preview.tong.so_dong} dòng · {preview.tong.so_ma} mã hàng ·{" "}
              <b>{preview.tong.so_ma_ton}</b> mã còn tồn · tổng giá trị{" "}
              <b>{vnd(preview.tong.tong_gia_tri)} đ</b>
            </p>
            {preview.warnings.length > 0 && (
              <div className="warn-banner" style={{ maxHeight: 180, overflow: "auto" }}>
                <b>⚠️ {preview.warnings.length} cảnh báo — đọc kỹ trước khi import:</b>
                <ul style={{ margin: "6px 0 0 18px" }}>
                  {preview.warnings.map((w, i) => (
                    <li key={i}>{w.msg}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="table-wrap" style={{ maxHeight: "40vh", overflow: "auto" }}>
              <table className="dt">
                <thead>
                  <tr>
                    <th>Mã</th>
                    <th>Tên</th>
                    <th>Kho</th>
                    <th style={{ textAlign: "right" }}>SL</th>
                    <th style={{ textAlign: "right" }}>Đơn giá</th>
                    <th style={{ textAlign: "right" }}>Giá trị</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.preview.map((p, i) => (
                    <tr key={i}>
                      <td>{p.ma_hang}</td>
                      <td>{p.ten}</td>
                      <td>
                        <span className="chip gray sm">{p.kho}</span>
                      </td>
                      <td style={{ textAlign: "right" }}>{qty(p.so_luong)}</td>
                      <td style={{ textAlign: "right" }} className="muted">
                        {vnd(p.don_gia)}
                      </td>
                      <td style={{ textAlign: "right" }}>{vnd(p.gia_tri)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button onClick={() => setPreview(null)}>Hủy</button>
              <button className="primary" disabled={importing} onClick={confirmImport}>
                {importing ? "Đang import…" : `✅ Import ${preview.preview.length} dòng tồn`}
              </button>
            </div>
          </div>
        </div>
      )}

      {fixId != null && (
        <PurchaseFixModal
          purchaseId={fixId}
          onClose={() => setFixId(null)}
          onChanged={() => {
            load();
            if (card) openCard(card.row);
          }}
        />
      )}
    </div>
  );
}
