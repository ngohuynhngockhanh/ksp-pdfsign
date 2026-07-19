import { useEffect, useState } from "react";
import { api, InvItem, InvRecipe, InvWarehouse } from "../api";

interface EditLine {
  item_id: number;
  ma_hang: string;
  ten: string;
  dvt: string;
  warehouse_id: number;
  so_luong: number;
}
interface EditState {
  id: number | null; // null = tao moi
  name: string;
  output_item_id: number | null;
  outputLabel: string;
  output_qty: number;
  lines: EditLine[];
}

const EMPTY_EDIT: EditState = {
  id: null, name: "", output_item_id: null, outputLabel: "", output_qty: 1, lines: [],
};

export function Recipes() {
  const [list, setList] = useState<InvRecipe[]>([]);
  const [whs, setWhs] = useState<InvWarehouse[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [outQ, setOutQ] = useState("");
  const [outResults, setOutResults] = useState<InvItem[]>([]);
  const [lineQ, setLineQ] = useState("");
  const [lineResults, setLineResults] = useState<InvItem[]>([]);

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
    setOutQ("");
    setOutResults([]);
    setLineQ("");
    setLineResults([]);
    setEdit({ ...EMPTY_EDIT });
  }
  function openEdit(r: InvRecipe) {
    setErr("");
    setOutQ("");
    setOutResults([]);
    setLineQ("");
    setLineResults([]);
    setEdit({
      id: r.id,
      name: r.name,
      output_item_id: r.output_item_id,
      outputLabel: `${r.output_ten}`,
      output_qty: r.output_qty,
      lines: r.lines.map((l) => ({ ...l })),
    });
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
  function pickOutput(it: InvItem) {
    if (!edit) return;
    setEdit({ ...edit, output_item_id: it.id, outputLabel: `${it.ma_hang} · ${it.ten}` });
    setOutQ("");
    setOutResults([]);
  }

  async function searchLine(q: string) {
    setLineQ(q);
    if (q.trim().length >= 2) {
      try {
        setLineResults(await api.invItems(q));
      } catch {
        /* ignore */
      }
    } else setLineResults([]);
  }
  function addLine(it: InvItem) {
    if (!edit) return;
    if (edit.lines.some((l) => l.item_id === it.id)) return;
    setEdit({
      ...edit,
      lines: [
        ...edit.lines,
        { item_id: it.id, ma_hang: it.ma_hang, ten: it.ten, dvt: it.dvt, warehouse_id: whs[0]?.id ?? 0, so_luong: 1 },
      ],
    });
    setLineQ("");
    setLineResults([]);
  }
  function patchLine(itemId: number, patch: Partial<EditLine>) {
    if (!edit) return;
    setEdit({ ...edit, lines: edit.lines.map((l) => (l.item_id === itemId ? { ...l, ...patch } : l)) });
  }
  function removeLine(itemId: number) {
    if (!edit) return;
    setEdit({ ...edit, lines: edit.lines.filter((l) => l.item_id !== itemId) });
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
        lines: edit.lines.map((l) => ({ item_id: l.item_id, warehouse_id: l.warehouse_id, so_luong: l.so_luong })),
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
                <td onClick={(e) => e.stopPropagation()}>
                  <button className="btn-sm ghost" onClick={() => removeRecipe(r.id)}>
                    🗑
                  </button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={4}>
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
          <div className="modal" style={{ maxWidth: 780 }} onClick={(e) => e.stopPropagation()}>
            <h3>{edit.id == null ? "Công thức mới" : `Sửa công thức #${edit.id}`}</h3>
            {err && <div className="error" style={{ marginBottom: 8 }}>{err}</div>}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0" }}>
              <label style={{ flex: 1 }}>
                Tên công thức
                <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </label>
            </div>

            <h4>Thành phẩm</h4>
            {edit.output_item_id != null ? (
              <div>
                <b>{edit.outputLabel}</b> · SL:{" "}
                <input
                  style={{ width: 80, textAlign: "right" }}
                  type="number"
                  min={0}
                  value={edit.output_qty}
                  onChange={(e) => setEdit({ ...edit, output_qty: Number(e.target.value) || 0 })}
                />{" "}
                <button
                  className="btn-sm ghost"
                  onClick={() => setEdit({ ...edit, output_item_id: null, outputLabel: "" })}
                >
                  Đổi
                </button>
              </div>
            ) : (
              <div>
                <input
                  className="search"
                  placeholder="🔍 tìm mã/tên thành phẩm…"
                  value={outQ}
                  onChange={(e) => searchOutput(e.target.value)}
                />
                {outResults.slice(0, 8).map((it) => (
                  <div key={it.id}>
                    <button className="btn-sm ghost" onClick={() => pickOutput(it)}>
                      {it.ma_hang} · {it.ten.slice(0, 50)}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <h4>Vật tư định mức</h4>
            {edit.lines.length > 0 && (
              <div className="table-wrap">
                <table className="dt">
                  <tbody>
                    {edit.lines.map((l) => (
                      <tr key={l.item_id}>
                        <td>
                          {l.ma_hang} · {l.ten}
                        </td>
                        <td>
                          <select
                            value={l.warehouse_id}
                            onChange={(e) => patchLine(l.item_id, { warehouse_id: Number(e.target.value) })}
                          >
                            {whs.map((w) => (
                              <option key={w.id} value={w.id}>
                                {w.code}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <input
                            style={{ width: 80, textAlign: "right" }}
                            type="number"
                            min={0}
                            value={l.so_luong}
                            onChange={(e) => patchLine(l.item_id, { so_luong: Number(e.target.value) || 0 })}
                          />{" "}
                          {l.dvt}
                        </td>
                        <td>
                          <button className="btn-sm ghost" onClick={() => removeLine(l.item_id)}>
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
              placeholder="🔍 Tìm vật tư để thêm vào định mức…"
              value={lineQ}
              onChange={(e) => searchLine(e.target.value)}
            />
            {lineResults.slice(0, 8).map((it) => (
              <div key={it.id}>
                <button className="btn-sm ghost" onClick={() => addLine(it)}>
                  {it.ma_hang} · {it.ten.slice(0, 50)}
                </button>
              </div>
            ))}

            <div className="modal-actions">
              <button onClick={() => setEdit(null)}>Hủy</button>
              <button
                className="primary"
                disabled={busy || !edit.name.trim() || edit.output_item_id == null || edit.lines.length === 0}
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
