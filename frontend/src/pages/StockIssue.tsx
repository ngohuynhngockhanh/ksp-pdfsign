import { useEffect, useState } from "react";
import {
  api,
  Customer,
  InvIssue,
  InvIssueLine,
  MUC_DICH_XUAT,
  MucDichXuat,
  StockRow,
} from "../api";
import { DateFilter, DateRange } from "../components/DateFilter";

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

const STATUS_CHIP: Record<string, [string, string]> = {
  draft: ["amber", "Nháp"],
  posted: ["green", "Đã ghi sổ"],
};

// Dinh muc nhan cong trung binh de uoc luong loi nhuan (dong / 1 san pham)
const NHAN_CONG_PER_SP = 300_000;

export function StockIssue() {
  const [list, setList] = useState<InvIssue[]>([]);
  const [err, setErr] = useState("");
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

  async function load() {
    try {
      setList(await api.invIssues("", dateRange));
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    api.listCustomers().then(setCustomers).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange.tu, dateRange.den]);

  // Doi ngay -> tai lai kha dung (chi hien thu co the xuat tai ngay do)
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

  async function save() {
    setErr("");
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
      await api.invIssuePost(iss.id);
      setCreating(false);
      setLines([]);
      setNote("");
      setLyDo("");
      setNguoiNhan("");
      setBoPhan("");
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function openView(iss: InvIssue) {
    setErr("");
    setView(iss);
    if (iss.status === "draft") {
      api.invAvailability(iss.ngay).then((r) => setViewAvail(r.rows)).catch(() => {});
    }
  }
  function patchViewLine(lineId: number, patch: Partial<InvIssueLine>) {
    setView((v) => (v ? { ...v, lines: v.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)) } : v));
  }
  function khaDungFor(itemId: number, warehouseId: number): number {
    return viewAvail.find((r) => r.item_id === itemId && r.warehouse_id === warehouseId)?.kha_dung ?? 0;
  }
  async function viewVoid() {
    if (!view || !window.confirm(`Hủy ghi sổ phiếu PX#${view.id} để sửa? Tồn kho sẽ tính lại.`)) return;
    setViewBusy(true);
    setErr("");
    try {
      const updated = await api.invIssueVoid(view.id);
      setView(updated);
      api.invAvailability(updated.ngay).then((r) => setViewAvail(r.rows)).catch(() => {});
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
      ngay: view.ngay, customer_id: view.customer_id, note: view.note,
      muc_dich: view.muc_dich, ly_do: view.ly_do,
      nguoi_nhan: view.nguoi_nhan, bo_phan: view.bo_phan,
      tk_no: view.tk_no, tk_co: view.tk_co,
      lines: view.lines.map((l) => ({
        item_id: l.item_id, warehouse_id: l.warehouse_id,
        so_luong: l.so_luong, don_gia_ban: l.don_gia_ban,
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
        const posted = await api.invIssuePost(saved.id);
        setView(posted);
        load();
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setViewBusy(false);
    }
  }

  const q = pickQ.trim().toLowerCase();
  const pickable = avail.filter(
    (r) =>
      (r.kha_dung ?? 0) > 0 &&
      (!q || r.ten.toLowerCase().includes(q) || r.ma_hang.toLowerCase().includes(q)),
  );
  const over = lines.filter((l) => l.so_luong > l.kha_dung);

  return (
    <div className="docs-page">
      <div className="docs-toolbar">
        <h3>
          Xuất kho <span className="count">{list.length}</span>
        </h3>
        <div className="tb-group">
          <DateFilter value={dateRange} onChange={setDateRange} />
          <button className="btn-sm" onClick={() => setCreating(true)}>
            ＋ Tạo phiếu xuất
          </button>
          <button
            className="btn-sm ghost"
            onClick={() =>
              window.open(
                api.invExportUrl("issues", "xlsx", { tu: dateRange.tu, den: dateRange.den }),
                "_blank",
              )
            }
          >
            ⬇ Excel
          </button>
        </div>
      </div>
      {err && <div className="error">{err}</div>}

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
              <th style={{ textAlign: "right" }}>Giá vốn</th>
              <th>Trạng thái</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((i) => {
              const [color, label] = STATUS_CHIP[i.status] ?? ["gray", i.status];
              const posted = i.status === "posted";
              const giaVon = posted
                ? i.lines.reduce((s, l) => s + l.gia_von, 0)
                : i.tong_gia_von_uoc;
              const dk = MUC_DICH_XUAT[i.muc_dich];
              return (
                <tr key={i.id} style={{ cursor: "pointer" }} title="Xem/sửa phiếu xuất" onClick={() => openView(i)}>
                  <td className="muted nowrap">{i.so_ct || `PX#${i.id}`}</td>
                  <td className="nowrap">{i.ngay}</td>
                  <td>{i.customer_name}</td>
                  <td className="muted nowrap">{dk?.label ?? i.muc_dich}</td>
                  <td className="nowrap">
                    <span className="chip gray sm">Nợ {i.tk_no}</span>{" "}
                    <span className="chip gray sm">Có {i.tk_co}</span>
                  </td>
                  <td className="muted">
                    {i.lines.map((l) => `${l.ma_hang}×${l.so_luong}`).join(", ")}
                    {i.note ? ` — ${i.note}` : ""}
                  </td>
                  <td style={{ textAlign: "right" }} className="nowrap">
                    {posted ? vnd(giaVon) : <span className="muted">~{vnd(giaVon)}</span>}
                  </td>
                  <td>
                    <span className={`chip sm ${color}`}>{label}</span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {i.status !== "posted" && (
                      <button
                        className="btn-sm ghost"
                        onClick={async () => {
                          if (!window.confirm(`Xóa phiếu nháp PX#${i.id}?`)) return;
                          await api.invIssueDelete(i.id);
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
                <td colSpan={9}>
                  <div className="empty">
                    <div className="empty-ic">📤</div>
                    <div>Chưa có phiếu xuất nào.</div>
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
            <h3>Tạo phiếu xuất kho</h3>
            <p className="muted">
              Chỉ chọn được hàng <b>đủ tồn tại ngày xuất</b> (đã trừ các phiếu xuất tương lai).
              Không thể bán thứ chưa có đầu vào — hệ thống chặn cứng.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <label>
                Ngày xuất
                <input type="date" value={ngay} onChange={(e) => setNgay(e.target.value)} />
              </label>
              <label>
                Khách hàng
                <select value={customerId} onChange={(e) => setCustomerId(Number(e.target.value))}>
                  <option value={0}>— không chọn —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ flex: 1 }}>
                Ghi chú
                <input value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6, alignItems: "flex-end" }}>
              <label>
                Mục đích xuất
                <select value={mucDich} onChange={(e) => setMucDich(e.target.value as MucDichXuat)}>
                  {(Object.keys(MUC_DICH_XUAT) as MucDichXuat[]).map((k) => (
                    <option key={k} value={k}>
                      {MUC_DICH_XUAT[k].label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Lý do xuất
                <input value={lyDo} onChange={(e) => setLyDo(e.target.value)} />
              </label>
              <label>
                Người nhận
                <input style={{ width: 130 }} value={nguoiNhan} onChange={(e) => setNguoiNhan(e.target.value)} />
              </label>
              <label>
                Bộ phận
                <input style={{ width: 120 }} value={boPhan} onChange={(e) => setBoPhan(e.target.value)} />
              </label>
              <div className="muted" style={{ marginLeft: "auto", fontSize: 13 }}>
                Định khoản gợi ý:{" "}
                <span className="chip gray sm">Nợ {MUC_DICH_XUAT[mucDich].no}</span>{" "}
                <span className="chip gray sm">Có {MUC_DICH_XUAT[mucDich].co}</span>
              </div>
            </div>

            {lines.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table className="dt">
                  <thead>
                    <tr>
                      <th>Mặt hàng</th>
                      <th>Kho</th>
                      <th>ĐVT</th>
                      <th style={{ textAlign: "right" }}>Khả dụng</th>
                      <th style={{ textAlign: "right" }}>SL xuất</th>
                      <th style={{ textAlign: "right" }}>Giá bán</th>
                      <th style={{ textAlign: "right" }}>Thành tiền</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, idx) => (
                      <tr key={`${l.item_id}-${l.warehouse_id}`}>
                        <td>{l.label}</td>
                        <td>
                          <span className="chip gray sm">{l.warehouse_code}</span>
                        </td>
                        <td className="muted">{l.dvt}</td>
                        <td style={{ textAlign: "right" }}>{l.kha_dung}</td>
                        <td style={{ textAlign: "right" }}>
                          <input
                            style={{ width: 90, textAlign: "right" }}
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
                            <div className="chip red sm">vượt khả dụng!</div>
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <input
                            style={{ width: 100, textAlign: "right" }}
                            type="number"
                            min={0}
                            value={l.don_gia_ban}
                            onChange={(e) => {
                              const v = Number(e.target.value) || 0;
                              setLines(lines.map((x, i) => (i === idx ? { ...x, don_gia_ban: v } : x)));
                            }}
                          />
                        </td>
                        <td style={{ textAlign: "right" }} className="muted">
                          {vnd(l.so_luong * l.don_gia_ban)}
                        </td>
                        <td>
                          <button className="btn-sm ghost" onClick={() => setLines(lines.filter((_, i) => i !== idx))}>
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ marginTop: 10 }}>
              <input
                className="search"
                placeholder="🔍 Tìm hàng khả dụng để thêm vào phiếu…"
                value={pickQ}
                onChange={(e) => setPickQ(e.target.value)}
              />
              <div className="table-wrap" style={{ maxHeight: "30vh", overflow: "auto", marginTop: 6 }}>
                <table className="dt">
                  <tbody>
                    {pickable.slice(0, 30).map((r) => (
                      <tr
                        key={`${r.item_id}-${r.warehouse_id}`}
                        style={{ cursor: "pointer" }}
                        onClick={() => addLine(r)}
                      >
                        <td className="nowrap">{r.ma_hang}</td>
                        <td>{r.ten}</td>
                        <td>
                          <span className="chip gray sm">{r.warehouse_code}</span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          khả dụng <b>{r.kha_dung}</b> {r.dvt}
                        </td>
                        <td style={{ textAlign: "right" }} className="muted">
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
            </div>

            <div className="modal-actions">
              <button onClick={() => setCreating(false)}>Hủy</button>
              <button
                className="primary"
                disabled={lines.length === 0 || over.length > 0 || lines.some((l) => l.so_luong <= 0)}
                onClick={save}
              >
                ✅ Ghi sổ phiếu xuất ({lines.length} dòng)
              </button>
            </div>
          </div>
        </div>
      )}

      {view && (
        <div className="modal-backdrop" onClick={() => setView(null)}>
          <div className="modal" style={{ maxWidth: 780 }} onClick={(e) => e.stopPropagation()}>
            <h3>
              Phiếu xuất {view.so_ct || `PX#${view.id}`}{" "}
              <span className={`chip sm ${(STATUS_CHIP[view.status] ?? ["gray"])[0]}`}>
                {(STATUS_CHIP[view.status] ?? ["", view.status])[1]}
              </span>
            </h3>
            <div className="muted" style={{ fontSize: 13, margin: "2px 0 6px" }}>
              Mục đích: <b>{MUC_DICH_XUAT[view.muc_dich]?.label ?? view.muc_dich}</b> ·
              Định khoản <span className="chip gray sm">Nợ {view.tk_no}</span>{" "}
              <span className="chip gray sm">Có {view.tk_co}</span>
              {view.nguoi_nhan ? ` · Người nhận: ${view.nguoi_nhan}` : ""}
              {view.bo_phan ? ` · Bộ phận: ${view.bo_phan}` : ""}
              {view.ly_do ? ` · Lý do: ${view.ly_do}` : ""}
            </div>
            {err && <div className="error" style={{ marginBottom: 8 }}>{err}</div>}
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
            <div className="table-wrap">
              <table className="dt">
                <thead>
                  <tr>
                    <th>Mặt hàng</th>
                    <th style={{ textAlign: "right" }}>SL</th>
                    <th style={{ textAlign: "right" }}>Giá bán</th>
                    <th style={{ textAlign: "right" }}>Thành tiền</th>
                    <th style={{ textAlign: "right" }}>Giá vốn</th>
                  </tr>
                </thead>
                <tbody>
                  {view.lines.map((l) => {
                    const kd = view.status === "draft" ? khaDungFor(l.item_id, l.warehouse_id) : null;
                    const over = kd !== null && l.so_luong > kd;
                    return (
                      <tr key={l.id} className={over ? "row-treo" : ""}>
                        <td>
                          {l.ma_hang} · {l.ten}
                        </td>
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
                                {over && <span className="chip red sm"> vượt!</span>}
                              </div>
                            </>
                          ) : (
                            l.so_luong
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {view.status === "draft" ? (
                            <input
                              style={{ width: 90, textAlign: "right" }}
                              type="number"
                              value={l.don_gia_ban}
                              onChange={(e) => patchViewLine(l.id, { don_gia_ban: Number(e.target.value) || 0 })}
                            />
                          ) : (
                            vnd(l.don_gia_ban)
                          )}
                        </td>
                        <td style={{ textAlign: "right" }} className="muted">
                          {vnd(l.so_luong * l.don_gia_ban)}
                        </td>
                        <td style={{ textAlign: "right" }} className="muted">
                          {view.status === "posted" ? vnd(l.gia_von) : `~${vnd(l.gia_von_uoc)}`}
                          {l.don_gia_von_uoc > 0 && (
                            <div style={{ fontSize: 11 }}>
                              {view.status === "posted" && l.so_luong
                                ? vnd(l.gia_von / l.so_luong)
                                : `~${vnd(l.don_gia_von_uoc)}`}/đv
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} style={{ textAlign: "right" }}>
                      <b>Cộng</b>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <b>{vnd(view.lines.reduce((s, l) => s + l.so_luong * l.don_gia_ban, 0))}</b>
                    </td>
                    <td style={{ textAlign: "right" }}>
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

            {/* Loi nhuan tam tinh — nhan cong CHI tinh cho thanh pham SX (kho TP);
                hang thuong mai (mua di ban lai, kho HH/NVL) xuat thang khong co NC */}
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
                  <p className="muted" style={{ fontSize: 12, margin: "6px 0" }}>
                    Nhập <b>giá bán</b> cho các dòng để xem lợi nhuận tạm tính.
                  </p>
                );
              }
              if (nhanCong <= 0) {
                // Xuat thuong mai thuan — khong co nhan cong
                return (
                  <div className="warn-banner" style={{ marginTop: 8 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "2px 16px" }}>
                      <span>Lợi nhuận tạm tính (thương mại — không tính nhân công):</span>
                      <b style={{ textAlign: "right" }} className={lnChuaNc < 0 ? "chip red sm" : ""}>
                        {p}{vnd(lnChuaNc)} đ ({((lnChuaNc / tongBan) * 100).toFixed(1)}%)
                      </b>
                    </div>
                    <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                      Giá vốn {posted ? "theo sổ kho" : "ước tính theo giá BQ hiện tại"}. Hàng mua đi
                      bán lại xuất thẳng — nhân công chỉ tính khi xuất thành phẩm sản xuất (kho TP).
                    </div>
                  </div>
                );
              }
              return (
                <div className="warn-banner" style={{ marginTop: 8 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "2px 16px" }}>
                    <span>Lợi nhuận tạm tính (chưa gồm nhân công):</span>
                    <b style={{ textAlign: "right" }} className={lnChuaNc < 0 ? "chip red sm" : ""}>
                      {p}{vnd(lnChuaNc)} đ{tongBan > 0 ? ` (${((lnChuaNc / tongBan) * 100).toFixed(1)}%)` : ""}
                    </b>
                    <span>
                      Nhân công tạm tính ({vnd(NHAN_CONG_PER_SP)} đ × {slTP} thành phẩm SX):
                    </span>
                    <b style={{ textAlign: "right" }}>{vnd(nhanCong)} đ</b>
                    <span>Lợi nhuận tạm tính (đã gồm nhân công):</span>
                    <b style={{ textAlign: "right" }} className={lnGomNc < 0 ? "chip red sm" : ""}>
                      {p}{vnd(lnGomNc)} đ{tongBan > 0 ? ` (${((lnGomNc / tongBan) * 100).toFixed(1)}%)` : ""}
                    </b>
                  </div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                    Giá vốn {posted ? "theo sổ kho" : "ước tính theo giá BQ hiện tại"}; nhân công ước
                    lượng {vnd(NHAN_CONG_PER_SP)}đ/thành phẩm SX (chỉ tính dòng xuất từ kho TP).
                  </div>
                </div>
              );
            })()}

            <div className="modal-actions">
              <button onClick={() => setView(null)}>Đóng</button>
              {view.status === "draft" && (
                <>
                  <button disabled={viewBusy} onClick={doViewSave}>
                    💾 Lưu
                  </button>
                  <button
                    className="primary"
                    disabled={viewBusy || view.lines.some((l) => l.so_luong > khaDungFor(l.item_id, l.warehouse_id))}
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
    </div>
  );
}
