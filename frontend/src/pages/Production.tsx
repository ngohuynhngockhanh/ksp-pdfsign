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
  don_gia_tam?: number; // gia tam tinh cho NVL chua co gia von (dong 'vao')
}

export function Production() {
  const [list, setList] = useState<InvProduction[]>([]);
  const [recipes, setRecipes] = useState<InvRecipe[]>([]);
  const [whs, setWhs] = useState<InvWarehouse[]>([]);
  const [err, setErr] = useState("");
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
    setRecipeId(r.id);
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
      ngay: view.ngay, note: view.note, description: view.description,
      recipe_id: view.recipe_id,
      cp_nhan_cong: view.cp_nhan_cong, cp_sxc: view.cp_sxc,
      gia_ban_du_kien: view.gia_ban_du_kien,
      lines: view.lines.map((l) => ({
        chieu: l.chieu, item_id: l.item_id, warehouse_id: l.warehouse_id,
        so_luong: l.so_luong, don_gia_tam: l.don_gia_tam || 0,
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

  return (
    <div className="docs-page">
      <div className="docs-toolbar">
        <h3>
          Sản xuất <span className="count">{list.length}</span>
        </h3>
        <div className="tb-group">
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
              const cost = outs.reduce((s, l) => s + l.gia_tri, 0);
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
        <div className="modal-backdrop" onClick={() => setView(null)}>
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
                        <td>{l.ma_hang} · {l.ten}</td>
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
                          {view.status === "posted" ? vnd(l.gia_tri) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Tong hop gia thanh */}
            <div className="warn-banner" style={{ marginTop: 10 }}>
              {view.status === "draft" ? (
                <div className="muted">
                  Giá thành NVL sẽ được tính khi <b>ghi sổ</b> (bình quân gia quyền tại ngày SX). Nhập
                  <b> giá tạm tính</b> cho NVL chưa có giá vốn để không bị 0đ.
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
