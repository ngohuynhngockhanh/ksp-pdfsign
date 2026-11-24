import { useEffect, useId, useMemo, useState } from "react";
import { api, InvItem, InvRecipe, InvWarehouse } from "../api";
import {
  AppButton,
  AppModal,
  DataView,
  EmptyState,
  FilterBar,
  FormField,
  FormGrid,
  InlineAlert,
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
} from "../components/ui";

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
  don_gia_bq?: number;
  q: string;
  results: InvItem[];
}

interface EditState {
  id: number | null;
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
  return {
    item_id: null,
    ma_hang: "",
    ten: "",
    dvt: "",
    warehouse_id: defaultWh,
    so_luong: 1,
    q: "",
    results: [],
  };
}

export function Recipes() {
  const askConfirm = useConfirm();
  const toast = useToast();

  const [list, setList] = useState<InvRecipe[]>([]);
  const [whs, setWhs] = useState<InvWarehouse[]>([]);
  const [search, setSearch] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);

  const nameId = useId();
  const outputSearchId = useId();
  const outputQtyId = useId();
  const descId = useId();

  async function load() {
    setLoading(true);
    try {
      setList(await api.invRecipes());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    api.invWarehouses().then(setWhs).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.output_ten.toLowerCase().includes(q) ||
        r.lines.some(
          (l) =>
            l.ma_hang.toLowerCase().includes(q) ||
            (l.ten || "").toLowerCase().includes(q),
        ),
    );
  }, [list, search]);

  function openNew() {
    setErr("");
    setEdit({
      id: null,
      name: "",
      output_item_id: null,
      outputLabel: "",
      outputQ: "",
      outputResults: [],
      output_qty: 1,
      description: "",
      rows: [],
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
    } else {
      setEdit((e) => (e ? { ...e, outputResults: [] } : e));
    }
  }

  function pickOutput(it: InvItem) {
    if (!edit) return;
    setEdit({
      ...edit,
      output_item_id: it.id,
      outputLabel: `${it.ma_hang} · ${it.ten}`,
      outputQ: "",
      outputResults: [],
    });
  }

  function addRow() {
    if (!edit) return;
    setEdit({ ...edit, rows: [...edit.rows, newRow(whs[0]?.id ?? 0)] });
  }

  function setRow(i: number, patch: Partial<EditRow>) {
    setEdit((e) =>
      e ? { ...e, rows: e.rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) } : e,
    );
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
    } else {
      setRow(i, { results: [] });
    }
  }

  function pickRow(i: number, it: InvItem) {
    setRow(i, {
      item_id: it.id,
      ma_hang: it.ma_hang,
      ten: it.ten,
      dvt: it.dvt,
      q: "",
      results: [],
    });
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
      const isCreate = edit.id == null;
      if (edit.id == null) await api.invRecipeCreate(body);
      else await api.invRecipeUpdate(edit.id, body);
      setEdit(null);
      toast.success(isCreate ? "Đã tạo công thức sản xuất mới." : "Đã cập nhật công thức.");
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeRecipe(r: InvRecipe) {
    const ok = await askConfirm({
      title: `Xóa công thức "${r.name}"?`,
      message:
        "Công thức sẽ bị xóa khỏi danh mục định mức. Các lệnh sản xuất đã tạo trước đây không bị ảnh hưởng.",
      confirmLabel: "Xóa công thức",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.invRecipeDelete(r.id);
      toast.success(`Đã xóa công thức "${r.name}".`);
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
      toast.success("AI đã gợi ý mô tả bộ nguyên vật liệu.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  }

  const totalEditCost = edit
    ? edit.rows.reduce((s, r) => s + (r.don_gia_bq ?? 0) * r.so_luong, 0)
    : 0;

  return (
    <PageShell data-page="recipes" className="inv-page">
      <PageHeader
        variant="compact"
        icon="layers"
        title="Công thức sản xuất"
        subtitle={`Định mức nguyên vật liệu (BOM) áp nhanh cho lệnh sản xuất (${list.length} công thức).`}
        actions={
          <AppButton variant="primary" leftIcon="plus" onClick={openNew}>
            Tạo công thức mới
          </AppButton>
        }
      />

      {err && !edit && <InlineAlert tone="danger">{err}</InlineAlert>}

      <FilterBar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Tìm tên công thức, thành phẩm, mã vật tư…",
        }}
        activeCount={search.trim() ? 1 : 0}
        onReset={() => setSearch("")}
        collapsibleMobile={false}
      />

      {loading ? (
        <TableSkeleton rows={5} cols={5} />
      ) : (
        <DataView
          mobileMode="card"
          empty={
            filtered.length === 0 ? (
              <EmptyState
                icon="layers"
                title={search.trim() ? "Không tìm thấy công thức phù hợp" : "Chưa có công thức nào"}
                description={
                  search.trim()
                    ? "Thử từ khóa khác hoặc xóa bộ lọc để xem toàn bộ công thức sản xuất."
                    : "Tạo bộ định mức nguyên vật liệu (BOM) để áp nhanh khi lập lệnh sản xuất."
                }
                action={
                  search.trim() ? (
                    <AppButton variant="secondary" leftIcon="rotate-ccw" onClick={() => setSearch("")}>
                      Xóa lọc
                    </AppButton>
                  ) : (
                    <AppButton variant="primary" leftIcon="plus" onClick={openNew}>
                      Tạo công thức mới
                    </AppButton>
                  )
                }
              />
            ) : undefined
          }
          desktop={
            <div className="table-wrap">
              <table className="dt">
                <thead>
                  <tr>
                    <th>Tên công thức</th>
                    <th>Thành phẩm</th>
                    <th>Vật tư định mức</th>
                    <th className="ui-text-right">Giá SX (ước tính)</th>
                    <th className="ui-col-chk"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr
                      key={r.id}
                      className="ui-clickable"
                      title="Xem/sửa công thức"
                      onClick={() => openEdit(r)}
                    >
                      <td className="ui-text-strong">{r.name}</td>
                      <td>
                        {r.output_ten} × <b className="num">{r.output_qty}</b>
                      </td>
                      <td className="muted">
                        {r.lines.map((l) => `${l.ma_hang}×${l.so_luong}`).join(", ")}
                      </td>
                      <td className="ui-text-right ui-nowrap num">
                        <div>
                          <b>{vnd(r.tong_gia_tri)}</b>
                        </div>
                        {r.output_qty > 1 && (
                          <div className="ui-muted">{vnd(r.gia_thanh_dv)}/đv</div>
                        )}
                        {r.thieu_gia && (
                          <StatusBadge
                            tone="warning"
                            size="sm"
                            icon="alert-triangle"
                            title="Có NVL chưa có giá vốn — ước tính thiếu"
                          >
                            thiếu giá
                          </StatusBadge>
                        )}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <AppButton
                          variant="ghost"
                          size="sm"
                          iconOnly
                          leftIcon="trash"
                          aria-label={`Xóa công thức ${r.name}`}
                          onClick={() => void removeRecipe(r)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          }
          mobileCards={
            <div className="ui-mobile-card-list">
              {filtered.map((r) => (
                <MobileCard key={r.id} onClick={() => openEdit(r)}>
                  <MobileCardHeader
                    title={r.name}
                    subtitle={`TP: ${r.output_ten} × ${r.output_qty}`}
                    badge={
                      r.thieu_gia ? (
                        <StatusBadge tone="warning" size="sm" icon="alert-triangle">
                          Thiếu giá
                        </StatusBadge>
                      ) : undefined
                    }
                  />
                  <MobileCardGrid>
                    <MobileCardRow
                      label="Giá SX ước tính"
                      value={`${vnd(r.tong_gia_tri)} đ`}
                      mono
                    />
                    {r.output_qty > 1 && (
                      <MobileCardRow
                        label="Đơn giá / ĐV"
                        value={`${vnd(r.gia_thanh_dv)} đ`}
                        mono
                      />
                    )}
                    <MobileCardRow
                      label="Vật tư định mức"
                      value={r.lines.map((l) => `${l.ma_hang}×${l.so_luong}`).join(", ") || "—"}
                      fullWidth
                    />
                  </MobileCardGrid>
                  <MobileCardActions>
                    <AppButton
                      variant="secondary"
                      size="sm"
                      leftIcon="edit"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(r);
                      }}
                    >
                      Sửa công thức
                    </AppButton>
                    <AppButton
                      variant="ghost"
                      size="sm"
                      iconOnly
                      leftIcon="trash"
                      aria-label={`Xóa công thức ${r.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeRecipe(r);
                      }}
                    />
                  </MobileCardActions>
                </MobileCard>
              ))}
            </div>
          }
        />
      )}

      <AppModal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit ? (edit.id == null ? "Công thức mới" : `Sửa công thức #${edit.id}`) : "Công thức"}
        size="lg"
        footer={
          edit ? (
            <>
              <AppButton variant="secondary" onClick={() => setEdit(null)}>
                Hủy
              </AppButton>
              <AppButton
                variant="primary"
                leftIcon="save"
                loading={busy}
                disabled={
                  !edit.name.trim() ||
                  edit.output_item_id == null ||
                  edit.rows.filter((r) => r.item_id != null).length === 0
                }
                onClick={save}
              >
                Lưu công thức
              </AppButton>
            </>
          ) : undefined
        }
      >
        {edit && (
          <div className="ui-stack">
            {err && <InlineAlert tone="danger">{err}</InlineAlert>}

            <FormGrid cols={3}>
              <FormField label="Tên công thức" htmlFor={nameId} required>
                <input
                  id={nameId}
                  className="ui-input"
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
              </FormField>

              <FormField label="Thành phẩm" htmlFor={outputSearchId} required>
                {edit.output_item_id != null ? (
                  <div className="ui-row">
                    <StatusBadge tone="success" size="sm">
                      {edit.outputLabel.split(" · ")[0]}
                    </StatusBadge>
                    <span>{edit.outputLabel.split(" · ").slice(1).join(" · ")}</span>
                    <AppButton
                      variant="ghost"
                      size="sm"
                      iconOnly
                      leftIcon="x"
                      aria-label="Chọn lại thành phẩm"
                      onClick={() => setEdit({ ...edit, output_item_id: null, outputLabel: "" })}
                    />
                  </div>
                ) : (
                  <div>
                    <input
                      id={outputSearchId}
                      className="ui-input"
                      placeholder="Tìm mã/tên thành phẩm…"
                      value={edit.outputQ}
                      onChange={(e) => void searchOutput(e.target.value)}
                    />
                    {edit.outputResults.length > 0 && (
                      <div className="ui-stack--xs ui-mt-1">
                        {edit.outputResults.slice(0, 5).map((it) => (
                          <AppButton
                            key={it.id}
                            variant="ghost"
                            size="sm"
                            className="ui-wrap-btn"
                            onClick={() => pickOutput(it)}
                          >
                            <b>{it.ma_hang}</b> · {it.ten}
                          </AppButton>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </FormField>

              <FormField label="SL thành phẩm" htmlFor={outputQtyId}>
                <input
                  id={outputQtyId}
                  className="ui-input ui-text-right"
                  type="number"
                  min={0}
                  value={edit.output_qty}
                  onChange={(e) => setEdit({ ...edit, output_qty: Number(e.target.value) || 0 })}
                />
              </FormField>
            </FormGrid>

            <div className="ui-row-between">
              <strong className="ui-text-strong">Danh sách nguyên vật liệu định mức</strong>
              <AppButton variant="secondary" size="sm" leftIcon="plus" onClick={addRow}>
                Thêm dòng vật tư
              </AppButton>
            </div>

            <DataView
              mobileMode="scroll"
              desktop={
                <div className="table-wrap ui-scroll-md">
                  <table className="dt">
                    <thead>
                      <tr>
                        <th>Vật tư (mã kho)</th>
                        <th>ĐVT</th>
                        <th>Kho</th>
                        <th className="ui-text-right">SL</th>
                        <th className="ui-text-right">Đơn giá BQ</th>
                        <th className="ui-text-right">Giá trị</th>
                        <th className="ui-col-chk"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {edit.rows.map((r, i) => (
                        <tr key={i}>
                          <td className="ui-col-wide">
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
                                  aria-label="Đổi vật tư"
                                  onClick={() =>
                                    setRow(i, { item_id: null, ma_hang: "", ten: "", dvt: "" })
                                  }
                                />
                              </span>
                            ) : (
                              <div>
                                <input
                                  className="ui-input ui-input-md"
                                  placeholder="Tìm mã/tên kho…"
                                  value={r.q}
                                  onChange={(e) => void searchRow(i, e.target.value)}
                                />
                                {r.results.length > 0 && (
                                  <div className="ui-stack--xs ui-mt-1">
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
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="muted">{r.dvt}</td>
                          <td>
                            <select
                              className="ui-select"
                              aria-label="Kho xuất vật tư"
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
                          <td className="ui-text-right">
                            <input
                              className="ui-input ui-input-qty"
                              type="number"
                              value={r.so_luong}
                              onChange={(e) => setRow(i, { so_luong: Number(e.target.value) })}
                            />
                          </td>
                          <td className="ui-text-right muted num">
                            {r.don_gia_bq != null ? vnd(r.don_gia_bq) : "—"}
                          </td>
                          <td className="ui-text-right muted num">
                            {r.don_gia_bq != null ? vnd(r.don_gia_bq * r.so_luong) : "—"}
                          </td>
                          <td>
                            <AppButton
                              variant="ghost"
                              size="sm"
                              iconOnly
                              leftIcon="trash"
                              aria-label="Xóa dòng vật tư"
                              onClick={() => delRow(i)}
                            />
                          </td>
                        </tr>
                      ))}
                      {!edit.rows.length && (
                        <tr>
                          <td colSpan={7}>
                            <EmptyState
                              icon="package"
                              compact
                              title="Chưa có vật tư nào"
                              description="Bấm Thêm dòng vật tư để chọn nguyên vật liệu cấu thành thành phẩm."
                            />
                          </td>
                        </tr>
                      )}
                    </tbody>
                    {edit.rows.some((r) => r.don_gia_bq != null) && (
                      <tfoot>
                        <tr>
                          <td colSpan={5} className="ui-text-right">
                            <b>Giá thành ước tính</b>
                          </td>
                          <td className="ui-text-right num">
                            <b>{vnd(totalEditCost)}</b>
                            {edit.output_qty > 1 && (
                              <div className="ui-muted">
                                {vnd(totalEditCost / (edit.output_qty || 1))}/đv
                              </div>
                            )}
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              }
            />

            <p className="ui-muted">
              Giá thành ước tính theo <b>giá vốn bình quân hiện tại</b> của NVL — khác giá thành
              thực tế khi ghi sổ Lệnh sản xuất (tính bình quân tại ngày SX). Số liệu cập nhật sau
              khi Lưu &amp; tải lại.
            </p>

            <div className="ui-stack--sm">
              <div className="ui-row-between">
                <label className="ui-field-label" htmlFor={descId}>
                  Mô tả (giải thích vì sao dùng bộ NVL này)
                </label>
                <AppButton
                  variant="secondary"
                  size="sm"
                  leftIcon="sparkles"
                  loading={aiBusy}
                  onClick={aiDescribe}
                  title="AI nhìn trọn bộ NVL để sinh mô tả"
                >
                  {aiBusy ? "Đang sinh…" : "AI sinh mô tả"}
                </AppButton>
              </div>
              <textarea
                id={descId}
                className="ui-textarea ui-textarea-sm"
                placeholder="Mô tả công dụng bộ nguyên vật liệu… (có thể bấm AI sinh mô tả để gợi ý)"
                value={edit.description}
                onChange={(e) => setEdit({ ...edit, description: e.target.value })}
              />
            </div>
          </div>
        )}
      </AppModal>
    </PageShell>
  );
}
