import { useEffect, useState } from "react";
import { api, InvProduction, InvProductionLine, InvRecipe, InvWarehouse, StockRow } from "../api";

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
}

export function Production() {
  const [list, setList] = useState<InvProduction[]>([]);
  const [recipes, setRecipes] = useState<InvRecipe[]>([]);
  const [whs, setWhs] = useState<InvWarehouse[]>([]);
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [ngay, setNgay] = useState(today());
  const [note, setNote] = useState("");
  const [avail, setAvail] = useState<StockRow[]>([]);
  const [pickQ, setPickQ] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [outQ, setOutQ] = useState("");
  const [outResults, setOutResults] = useState<{ id: number; ma_hang: string; ten: string; dvt: string }[]>([]);
  const [view, setView] = useState<InvProduction | null>(null);
  const [viewAvail, setViewAvail] = useState<StockRow[]>([]);
  const [viewBusy, setViewBusy] = useState(false);

  async function load() {
    try {
      setList(await api.invProductions());
      setRecipes(await api.invRecipes());
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    load();
    api.invWarehouses().then(setWhs).catch(() => {});
  }, []);
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
        so_luong: ln.so_luong,
      };
    });
    const out: DraftLine = {
      chieu: "ra",
      item_id: r.output_item_id,
      warehouse_id: tpWh?.id ?? 0,
      label: r.output_ten,
      dvt: "",
      kha_dung: 0,
      so_luong: r.output_qty,
    };
    setLines([...consume, out]);
  }

  async function saveRecipe() {
    const out = lines.find((l) => l.chieu === "ra");
    if (!out) return;
    const name = window.prompt("Tên công thức:", out.label);
    if (!name) return;
    try {
      await api.invRecipeCreate({
        name,
        output_item_id: out.item_id,
        output_qty: out.so_luong,
        lines: lines
          .filter((l) => l.chieu === "vao")
          .map((l) => ({ item_id: l.item_id, warehouse_id: l.warehouse_id, so_luong: l.so_luong })),
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
        lines: lines.map((l) => ({
          chieu: l.chieu,
          item_id: l.item_id,
          warehouse_id: l.warehouse_id,
          so_luong: l.so_luong,
        })),
      });
      await api.invProductionPost(prod.id);
      setCreating(false);
      setLines([]);
      setNote("");
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  function openView(prod: InvProduction) {
    setErr("");
    setView(prod);
    if (prod.status === "draft") {
      api.invAvailability(prod.ngay).then((r) => setViewAvail(r.rows)).catch(() => {});
    }
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
      ngay: view.ngay, note: view.note,
      lines: view.lines.map((l) => ({
        chieu: l.chieu, item_id: l.item_id, warehouse_id: l.warehouse_id, so_luong: l.so_luong,
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
  const consumes = lines.filter((l) => l.chieu === "vao");
  const outputs = lines.filter((l) => l.chieu === "ra");
  const over = consumes.filter((l) => l.so_luong > l.kha_dung);

  return (
    <div className="docs-page">
      <div className="docs-toolbar">
        <h3>
          Sản xuất <span className="count">{list.length}</span>
        </h3>
        <div className="tb-group">
          <button className="btn-sm" onClick={() => setCreating(true)}>
            ＋ Tạo lệnh sản xuất
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
              <th>#</th>
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
              const cost = outs.reduce((s, l) => s + l.gia_tri, 0);
              return (
                <tr key={p.id} style={{ cursor: "pointer" }} title="Xem/sửa lệnh sản xuất" onClick={() => openView(p)}>
                  <td className="muted">
                    LSX#{p.id}
                    {p.sale_id != null && (
                      <div className="chip gray sm" style={{ marginTop: 2 }}>
                        🧾 HĐ bán #{p.sale_id}
                      </div>
                    )}
                  </td>
                  <td className="nowrap">{p.ngay}</td>
                  <td>{outs.map((l) => `${l.ma_hang || l.ten}×${l.so_luong}`).join(", ")}</td>
                  <td className="muted">{ins.map((l) => `${l.ma_hang}×${l.so_luong}`).join(", ")}</td>
                  <td style={{ textAlign: "right" }}>{vnd(cost)}</td>
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
                    value=""
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
        <div className="modal-backdrop" onClick={() => setView(null)}>
          <div className="modal" style={{ maxWidth: 780 }} onClick={(e) => e.stopPropagation()}>
            <h3>
              Lệnh sản xuất LSX#{view.id}{" "}
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

            <h4>Thành phẩm (ra)</h4>
            <div className="table-wrap">
              <table className="dt">
                <tbody>
                  {view.lines.filter((l) => l.chieu === "ra").map((l) => (
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

            <h4>Tiêu hao (vào)</h4>
            <div className="table-wrap">
              <table className="dt">
                <tbody>
                  {view.lines.filter((l) => l.chieu === "vao").map((l) => {
                    const kd = view.status === "draft" ? khaDungFor(l.item_id, l.warehouse_id) : null;
                    const over = kd !== null && l.so_luong > kd;
                    return (
                      <tr key={l.id} className={over ? "row-treo" : ""}>
                        <td>{l.ma_hang} · {l.ten}</td>
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
                        <td style={{ textAlign: "right" }} className="muted">
                          {vnd(l.gia_tri)}
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
                    disabled={
                      viewBusy ||
                      view.lines
                        .filter((l) => l.chieu === "vao")
                        .some((l) => l.so_luong > khaDungFor(l.item_id, l.warehouse_id))
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
    </div>
  );
}
