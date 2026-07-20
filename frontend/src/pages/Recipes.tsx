import { useEffect, useState } from "react";
import { api, InvItem, InvRecipe, InvWarehouse } from "../api";

function vnd(n: number): string {
  return Math.round(n).toLocaleString("vi-VN");
}

interface EditRow {
  item_id: number | null;
  ma_hang: string;
  ten: string;
  dvt: string;
  warehouse_id: number;
  so_luong: number;
  don_gia_bq?: number; // gia von BQ hien tai (tu server)
  q: string;
  results: InvItem[];
}
interface EditState {
  id: number | null; // null = tao moi
  name: string;
  output_item_id: number | null;
  outputLabel: string;
  outputQ: string;
  outputResults: InvItem[];
  output_qty: number;
  description: string;
  rows: EditRow[];
}

function newRow(defaultWh: number): EditRow {
  return { item_id: null, ma_hang: "", ten: "", dvt: "", warehouse_id: defaultWh, so_luong: 1, q: "", results: [] };
}

export function Recipes() {
  const [list, setList] = useState<InvRecipe[]>([]);
  const [whs, setWhs] = useState<InvWarehouse[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);

  async function load() {
    try {
      setList(await api.invRecipes());
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    load();
    api.invWarehouses().then(setWhs).catch(() => {});
  }, []);

  function openNew() {
    setErr("");
    setEdit({
      id: null, name: "", output_item_id: null, outputLabel: "", outputQ: "", outputResults: [],
      output_qty: 1, description: "", rows: [],
    });
  }
  function openEdit(r: InvRecipe) {
    setErr("");
    setEdit({
      id: r.id,
      name: r.name,
      output_item_id: r.output_item_id,
      outputLabel: r.output_ten,
      outputQ: "",
      outputResults: [],
      output_qty: r.output_qty,
      description: r.description || "",
      rows: r.lines.map((l) => ({ ...l, item_id: l.item_id, q: "", results: [] })),
    });
  }

  async function searchOutput(q: string) {
    if (!edit) return;
    setEdit({ ...edit, outputQ: q });
    if (q.trim().length >= 2) {
      try {
        const results = await api.invItems(q);
        setEdit((e) => (e ? { ...e, outputResults: results } : e));
      } catch {
        /* ignore */
      }
    } else setEdit((e) => (e ? { ...e, outputResults: [] } : e));
  }
  function pickOutput(it: InvItem) {
    if (!edit) return;
    setEdit({ ...edit, output_item_id: it.id, outputLabel: `${it.ma_hang} · ${it.ten}`, outputQ: "", outputResults: [] });
  }

  function addRow() {
    if (!edit) return;
    setEdit({ ...edit, rows: [...edit.rows, newRow(whs[0]?.id ?? 0)] });
  }
  function setRow(i: number, patch: Partial<EditRow>) {
    setEdit((e) => (e ? { ...e, rows: e.rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) } : e));
  }
  function delRow(i: number) {
    setEdit((e) => (e ? { ...e, rows: e.rows.filter((_, idx) => idx !== i) } : e));
  }
  async function searchRow(i: number, q: string) {
    setRow(i, { q });
    if (q.trim().length >= 2) {
      try {
        const results = await api.invItems(q);
        setRow(i, { results });
      } catch {
        /* ignore */
      }
    } else setRow(i, { results: [] });
  }
  function pickRow(i: number, it: InvItem) {
    setRow(i, { item_id: it.id, ma_hang: it.ma_hang, ten: it.ten, dvt: it.dvt, q: "", results: [] });
  }

  async function save() {
    if (!edit || !edit.name.trim() || edit.output_item_id == null) return;
    setBusy(true);
    setErr("");
    try {
      const body = {
        name: edit.name.trim(),
        output_item_id: edit.output_item_id,
        output_qty: edit.output_qty,
        description: edit.description.trim(),
        lines: edit.rows
          .filter((r) => r.item_id != null)
          .map((r) => ({ item_id: r.item_id, warehouse_id: r.warehouse_id, so_luong: r.so_luong })),
      };
      if (edit.id == null) await api.invRecipeCreate(body);
      else await api.invRecipeUpdate(edit.id, body);
      setEdit(null);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeRecipe(id: number) {
    if (!window.confirm("Xóa công thức này?")) return;
    try {
      await api.invRecipeDelete(id);
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function aiDescribe() {
    if (!edit) return;
    const lines = edit.rows
      .filter((r) => r.item_id != null && r.ten)
      .map((r) => ({ ten: r.ten, so_luong: r.so_luong, dvt: r.dvt }));
    if (!lines.length) {
      setErr("Cần ít nhất 1 vật tư để AI sinh mô tả.");
      return;
    }
    setAiBusy(true);
    setErr("");
    try {
      const res = await api.invDescribeBom({
        output_ten: edit.outputLabel.split(" · ").slice(1).join(" · ") || edit.outputLabel,
        output_qty: edit.output_qty,
        lines,
      });
      setEdit((e) => (e ? { ...e, description: res.description } : e));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div className="docs-page">
      <div className="docs-toolbar">
        <h3>
          Công thức sản xuất <span className="count">{list.length}</span>
        </h3>
        <div className="tb-group">
          <button className="btn-sm" onClick={openNew}>
            ＋ Tạo công thức mới
          </button>
        </div>
      </div>
      {err && !edit && <div className="error">{err}</div>}
      <p className="muted">
        Định mức nguyên vật liệu (BOM) dùng để áp nhanh khi tạo lệnh sản xuất. Sửa ở đây không ảnh
        hưởng các lệnh sản xuất đã tạo trước đó (chỉ là bản lưu số lượng snapshot).
      </p>

      <div className="table-wrap">
        <table className="dt">
          <thead>
            <tr>
              <th>Tên công thức</th>
              <th>Thành phẩm</th>
              <th>Vật tư định mức</th>
              <th style={{ textAlign: "right" }}>Giá SX (ước tính)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} style={{ cursor: "pointer" }} title="Xem/sửa công thức" onClick={() => openEdit(r)}>
                <td>{r.name}</td>
                <td>
                  {r.output_ten} × {r.output_qty}
                </td>
                <td className="muted">{r.lines.map((l) => `${l.ma_hang}×${l.so_luong}`).join(", ")}</td>
                <td style={{ textAlign: "right" }} className="nowrap">
                  <b>{vnd(r.tong_gia_tri)}</b>
                  {r.output_qty > 1 && (
                    <div className="muted" style={{ fontSize: 11 }}>{vnd(r.gia_thanh_dv)}/đv</div>
                  )}
                  {r.thieu_gia && <div className="chip amber sm" title="Có NVL chưa có giá vốn — ước tính thiếu">⚠ thiếu giá</div>}
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <button className="btn-sm ghost" onClick={() => removeRecipe(r.id)}>
                    🗑
                  </button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <div className="empty">
                    <div className="empty-ic">🧩</div>
                    <div>Chưa có công thức nào.</div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {edit && (
        <div className="modal-backdrop" onClick={() => setEdit(null)}>
          <div className="modal" style={{ maxWidth: 900 }} onClick={(e) => e.stopPropagation()}>
            <h3>🧩 {edit.id == null ? "Công thức mới" : `Sửa công thức #${edit.id}`}</h3>
            {err && <div className="error" style={{ marginBottom: 8 }}>{err}</div>}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "6px 0" }}>
              <label style={{ flex: 1, minWidth: 200 }}>
                Tên công thức
                <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </label>
              <button className="btn-sm ghost" onClick={addRow}>
                + Thêm dòng
              </button>
              {edit.output_item_id != null ? (
                <span style={{ marginLeft: "auto" }} className="muted">
                  Thành phẩm: <span className="chip green sm">{edit.outputLabel.split(" · ")[0]}</span>{" "}
                  {edit.outputLabel.split(" · ").slice(1).join(" · ")}{" "}
                  <button
                    className="btn-sm ghost"
                    onClick={() => setEdit({ ...edit, output_item_id: null, outputLabel: "" })}
                  >
                    ✕
                  </button>
                </span>
              ) : (
                <div style={{ marginLeft: "auto", position: "relative" }}>
                  <input
                    style={{ width: 220 }}
                    placeholder="🔍 tìm mã/tên thành phẩm…"
                    value={edit.outputQ}
                    onChange={(e) => searchOutput(e.target.value)}
                  />
                  {edit.outputResults.slice(0, 5).map((it) => (
                    <div key={it.id}>
                      <button className="btn-sm ghost" onClick={() => pickOutput(it)}>
                        <b>{it.ma_hang}</b> · {it.ten}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <label>
                SL thành phẩm
                <input
                  style={{ width: 70, textAlign: "right" }}
                  type="number"
                  min={0}
                  value={edit.output_qty}
                  onChange={(e) => setEdit({ ...edit, output_qty: Number(e.target.value) || 0 })}
                />
              </label>
            </div>

            <div className="table-wrap" style={{ maxHeight: "42vh", overflow: "auto" }}>
              <table className="dt">
                <thead>
                  <tr>
                    <th>Vật tư (mã kho)</th>
                    <th>ĐVT</th>
                    <th>Kho</th>
                    <th style={{ textAlign: "right" }}>SL</th>
                    <th style={{ textAlign: "right" }}>Đơn giá BQ</th>
                    <th style={{ textAlign: "right" }}>Giá trị</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {edit.rows.map((r, i) => (
                    <tr key={i}>
                      <td style={{ minWidth: 220, maxWidth: 320, whiteSpace: "normal", wordBreak: "break-word" }}>
                        {r.item_id ? (
                          <span>
                            <span className="chip green sm">{r.ma_hang}</span> {r.ten}{" "}
                            <button
                              className="btn-sm ghost"
                              onClick={() => setRow(i, { item_id: null, ma_hang: "", ten: "", dvt: "" })}
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
                          style={{ width: 70, textAlign: "right" }}
                          type="number"
                          value={r.so_luong}
                          onChange={(e) => setRow(i, { so_luong: Number(e.target.value) })}
                        />
                      </td>
                      <td style={{ textAlign: "right" }} className="muted">
                        {r.don_gia_bq != null ? vnd(r.don_gia_bq) : "—"}
                      </td>
                      <td style={{ textAlign: "right" }} className="muted">
                        {r.don_gia_bq != null ? vnd(r.don_gia_bq * r.so_luong) : "—"}
                      </td>
                      <td>
                        <button className="btn-sm ghost" onClick={() => delRow(i)}>
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!edit.rows.length && (
                    <tr>
                      <td colSpan={7}>
                        <div className="muted" style={{ padding: 12 }}>
                          Chưa có vật tư — bấm + Thêm dòng.
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
                {edit.rows.some((r) => r.don_gia_bq != null) && (
                  <tfoot>
                    <tr>
                      <td colSpan={5} style={{ textAlign: "right" }}>
                        <b>Giá thành ước tính</b>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <b>{vnd(edit.rows.reduce((s, r) => s + (r.don_gia_bq ?? 0) * r.so_luong, 0))}</b>
                        {edit.output_qty > 1 && (
                          <div className="muted" style={{ fontSize: 11 }}>
                            {vnd(edit.rows.reduce((s, r) => s + (r.don_gia_bq ?? 0) * r.so_luong, 0) / (edit.output_qty || 1))}/đv
                          </div>
                        )}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: "4px 0" }}>
              Giá thành ước tính theo <b>giá vốn bình quân hiện tại</b> của NVL — khác giá thành thực tế khi
              ghi sổ Lệnh sản xuất (tính bình quân tại ngày SX). Số liệu cập nhật sau khi Lưu &amp; tải lại.
            </p>

            <div style={{ margin: "10px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <label style={{ margin: 0 }}>Mô tả (giải thích vì sao dùng bộ NVL này)</label>
                <button className="btn-sm ghost" disabled={aiBusy} onClick={aiDescribe} title="AI nhìn trọn bộ NVL để sinh mô tả">
                  {aiBusy ? "⏳ Đang sinh…" : "✨ AI sinh mô tả"}
                </button>
              </div>
              <textarea
                style={{ width: "100%", minHeight: 70, resize: "vertical" }}
                placeholder="Mô tả công dụng bộ nguyên vật liệu… (có thể bấm ✨ để AI gợi ý)"
                value={edit.description}
                onChange={(e) => setEdit({ ...edit, description: e.target.value })}
              />
            </div>

            <div className="modal-actions">
              <button onClick={() => setEdit(null)}>Hủy</button>
              <button
                className="primary"
                disabled={
                  busy ||
                  !edit.name.trim() ||
                  edit.output_item_id == null ||
                  edit.rows.filter((r) => r.item_id != null).length === 0
                }
                onClick={save}
              >
                💾 Lưu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
