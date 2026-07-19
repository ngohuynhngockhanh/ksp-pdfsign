import { useEffect, useState } from "react";
import { api, Customer, InvIssue, InvIssueLine, StockRow } from "../api";

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

export function StockIssue() {
  const [list, setList] = useState<InvIssue[]>([]);
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [ngay, setNgay] = useState(today());
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<number | 0>(0);
  const [note, setNote] = useState("");
  const [avail, setAvail] = useState<StockRow[]>([]);
  const [pickQ, setPickQ] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [view, setView] = useState<InvIssue | null>(null);
  const [viewAvail, setViewAvail] = useState<StockRow[]>([]);
  const [viewBusy, setViewBusy] = useState(false);

  async function load() {
    try {
      setList(await api.invIssues());
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    load();
    api.listCustomers().then(setCustomers).catch(() => {});
  }, []);

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
      const iss = await api.invIssueCreate({
        ngay,
        customer_id: customerId || null,
        note,
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
          <button className="btn-sm" onClick={() => setCreating(true)}>
            ＋ Tạo phiếu xuất
          </button>
        </div>
      </div>
      {err && <div className="error">{err}</div>}

      <div className="table-wrap">
        <table className="dt">
          <thead>
            <tr>
              <th>#</th>
              <th>Ngày</th>
              <th>Khách hàng</th>
              <th>Ghi chú</th>
              <th style={{ textAlign: "right" }}>Giá vốn</th>
              <th>Trạng thái</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((i) => {
              const [color, label] = STATUS_CHIP[i.status] ?? ["gray", i.status];
              const giaVon = i.lines.reduce((s, l) => s + l.gia_von, 0);
              return (
                <tr key={i.id} style={{ cursor: "pointer" }} title="Xem/sửa phiếu xuất" onClick={() => openView(i)}>
                  <td className="muted">PX#{i.id}</td>
                  <td className="nowrap">{i.ngay}</td>
                  <td>{i.customer_name}</td>
                  <td className="muted">
                    {i.lines.map((l) => `${l.ma_hang}×${l.so_luong}`).join(", ")}
                    {i.note ? ` — ${i.note}` : ""}
                  </td>
                  <td style={{ textAlign: "right" }}>{vnd(giaVon)}</td>
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
                <td colSpan={7}>
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

            {lines.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 10 }}>
                <table className="dt">
                  <thead>
                    <tr>
                      <th>Mặt hàng</th>
                      <th>Kho</th>
                      <th style={{ textAlign: "right" }}>Khả dụng</th>
                      <th style={{ textAlign: "right" }}>SL xuất</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, idx) => (
                      <tr key={`${l.item_id}-${l.warehouse_id}`}>
                        <td>{l.label}</td>
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
              Phiếu xuất PX#{view.id}{" "}
              <span className={`chip sm ${(STATUS_CHIP[view.status] ?? ["gray"])[0]}`}>
                {(STATUS_CHIP[view.status] ?? ["", view.status])[1]}
              </span>
            </h3>
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
                          {vnd(l.gia_von)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
