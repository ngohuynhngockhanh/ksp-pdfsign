import { useEffect, useRef, useState } from "react";
import {
  api,
  CustomsParseInfo,
  InvCustomsCost,
  InvCustomsDecl,
  InvCustomsLine,
  InvItem,
  InvWarehouse,
} from "../api";
import { DateFilter, DateRange } from "../components/DateFilter";
import { getParam, setParam } from "../util";

function vnd(n: number): string {
  return Math.round(n).toLocaleString("vi-VN");
}

function fmtCur(n: number): string {
  return n.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
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
  draft: ["amber", "Nháp"],
  posted: ["green", "Đã ghi sổ"],
  void: ["gray", "Đã hủy"],
};

const LOAI_HINH_CHIP: Record<string, [string, string]> = {
  A11: ["blue", "A11 · KD"],
  A12: ["purple", "A12 · SX"],
};

function loaiHinhChip(code: string): [string, string] {
  return LOAI_HINH_CHIP[code] ?? ["gray", code || "—"];
}

function phanLuongChip(pl: string): [string, string] {
  if (pl === "1") return ["green", "🟢 Xanh"];
  if (pl === "2") return ["amber", "🟡 Vàng"];
  if (pl === "3") return ["red", "🔴 Đỏ"];
  return ["gray", pl || "—"];
}

const COST_LOAI_LABEL: Record<string, string> = {
  le_phi_hq: "Lệ phí HQ",
  phi_ngan_hang: "Phí ngân hàng",
  phi_ship: "Phí vận chuyển",
  phi_khac: "Phí khác",
};

function matchLabel(kind: string): string {
  if (kind === "exact") return "✔ khớp";
  if (kind === "fuzzy") return "~ gợi ý";
  if (kind === "learned") return "🧠 đã học";
  return "✔ đã chọn";
}

function parseInfoMsg(p: CustomsParseInfo): string {
  if (p.kind === "giay_nop_tien") {
    const added = p.khoan_nop.filter((k) => k.phan_loai !== "vat").length;
    const vatSum = p.vat_paid.reduce((s, k) => s + k.so_tien, 0);
    return (
      `✓ Khớp tờ khai, đã thêm ${added} khoản lệ phí` +
      (vatSum > 0 ? `; VAT ${vnd(vatSum)}đ đã nộp (không tính vào giá vốn)` : "")
    );
  }
  const mt = p.mt103;
  return `Đã nhận chứng từ thanh toán ${mt.nguyen_te} ${fmtCur(mt.so_tien_nt)} — nhập số PHÍ ngân hàng thực tế vào dòng phí vừa tạo`;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: "0.72rem" }}>{label}</div>
      <div>{value || "—"}</div>
    </div>
  );
}

export function CustomsDecl() {
  const [list, setList] = useState<InvCustomsDecl[]>([]);
  const [statusF, setStatusF] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>({ tu: "", den: "" });
  const [cur, setCur] = useState<InvCustomsDecl | null>(null);
  const [whs, setWhs] = useState<InvWarehouse[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachRef = useRef<HTMLInputElement>(null);
  const [attachBusy, setAttachBusy] = useState(false);
  const [parseInfo, setParseInfo] = useState<CustomsParseInfo | null>(null);
  const [itemQuery, setItemQuery] = useState<{ line: number; q: string; results: InvItem[] } | null>(null);
  const [listLoaded, setListLoaded] = useState(false);
  const autoTkRef = useRef(false);

  async function load() {
    try {
      setList(await api.invCustomsList({ statusF, tu: dateRange.tu, den: dateRange.den }));
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
  }, [statusF, dateRange.tu, dateRange.den]);
  // F5 giu context: sau khi list load lan dau, tu mo lai modal chi tiet theo ?tk=
  useEffect(() => {
    if (!listLoaded || autoTkRef.current) return;
    autoTkRef.current = true;
    const tk = getParam("tk");
    if (tk) open(Number(tk));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listLoaded]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setErr("");
    try {
      const r = await api.invCustomsUpload(Array.from(files));
      setUploadMsg(
        r.results.map((x) =>
          x.ok
            ? `✅ ${x.filename}: đã tạo bản nháp #${x.customs_id} (${x.so_to_khai})`
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

  async function open(id: number) {
    try {
      setCur(await api.invCustomsGet(id));
      setItemQuery(null);
      setParseInfo(null);
      setParam("tk", String(id));
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  function closeCur() {
    setCur(null);
    setParseInfo(null);
    setParam("tk", null);
  }

  async function delOne(id: number) {
    if (!window.confirm("Xóa bản nháp này?")) return;
    setBusy(true);
    setErr("");
    try {
      await api.invCustomsDelete(id);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function setLine(idx: number, patch: Partial<InvCustomsLine>) {
    if (!cur) return;
    setCur({ ...cur, lines: cur.lines.map((ln, i) => (i === idx ? { ...ln, ...patch } : ln)) });
  }
  function setCost(idx: number, patch: Partial<InvCustomsCost>) {
    if (!cur) return;
    setCur({ ...cur, costs: cur.costs.map((c, i) => (i === idx ? { ...c, ...patch } : c)) });
  }
  function addCostRow() {
    if (!cur) return;
    setCur({
      ...cur,
      costs: [...cur.costs, { id: -Date.now(), loai: "phi_khac", ten: "", so_tien: 0, ghi_chu: "", doc_url: "" }],
    });
  }
  function removeCost(idx: number) {
    if (!cur) return;
    setCur({ ...cur, costs: cur.costs.filter((_, i) => i !== idx) });
  }

  async function saveDraft(): Promise<InvCustomsDecl | null> {
    if (!cur) return null;
    try {
      const saved = await api.invCustomsSave(cur.id, {
        note: cur.note,
        lines: cur.lines.map((ln) => ({
          id: ln.id,
          item_id: ln.item_id,
          warehouse_id: ln.warehouse_id,
          so_luong: ln.so_luong,
        })),
        costs: cur.costs
          .filter((c) => !c.doc_url)
          .map((c) => ({ loai: c.loai, ten: c.ten, so_tien: c.so_tien, ghi_chu: c.ghi_chu })),
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
      setCur(await api.invCustomsPost(saved.id));
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function voidCur() {
    if (!cur) return;
    if (!window.confirm("Hủy ghi sổ tờ khai này để sửa? Tồn kho sẽ được tính lại.")) return;
    setBusy(true);
    setErr("");
    try {
      setCur(await api.invCustomsVoid(cur.id));
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteCur() {
    if (!cur) return;
    if (!window.confirm("Xóa bản nháp này?")) return;
    try {
      await api.invCustomsDelete(cur.id);
      closeCur();
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function attach(files: FileList | null) {
    if (!files || files.length === 0 || !cur) return;
    setAttachBusy(true);
    setErr("");
    setParseInfo(null);
    try {
      const r = await api.invCustomsAttach(cur.id, files[0]);
      setCur(r.decl);
      setParseInfo(r.parse_info);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAttachBusy(false);
      if (attachRef.current) attachRef.current.value = "";
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
    const ma = window.prompt("Mã hàng mới cho: " + ln.mo_ta, suggested);
    if (!ma) return;
    try {
      const it = await api.invCreateItem({ ma_hang: ma, ten: ln.mo_ta, dvt: ln.dvt });
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

  const unmatched = cur ? cur.lines.filter((ln) => !ln.item_id).length : 0;
  const tongGiaVon = cur ? cur.tri_gia_tinh_thue + cur.tong_thue_nk + cur.tong_costs : 0;

  return (
    <div className="docs-page">
      <div className="docs-toolbar">
        <h3>
          🛃 Tờ khai nhập khẩu <span className="count">{list.length}</span>
        </h3>
        <div className="tb-group">
          <select className="tb-select" value={statusF} onChange={(e) => setStatusF(e.target.value)}>
            <option value="">Tất cả trạng thái</option>
            <option value="draft">Nháp</option>
            <option value="posted">Đã ghi sổ</option>
          </select>
          <DateFilter value={dateRange} onChange={setDateRange} />
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx"
            multiple
            style={{ display: "none" }}
            onChange={(e) => upload(e.target.files)}
          />
          <button className="btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? "Đang xử lý…" : "📤 Tải tờ khai (Excel)"}
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

      <div className="table-wrap">
        <table className="dt">
          <thead>
            <tr>
              <th>Số TK</th>
              <th>Ngày ĐK</th>
              <th>Loại hình</th>
              <th>Phân luồng</th>
              <th>Người XK</th>
              <th style={{ textAlign: "right" }}>Trị giá</th>
              <th style={{ textAlign: "right" }}>Thuế NK</th>
              <th style={{ textAlign: "right" }}>VAT</th>
              <th>Trạng thái</th>
              <th style={{ width: 28 }}></th>
            </tr>
          </thead>
          <tbody>
            {list.map((d) => {
              const [lhColor, lhLabel] = loaiHinhChip(d.ma_loai_hinh);
              const [plColor, plLabel] = phanLuongChip(d.phan_luong);
              const [stColor, stLabel] = STATUS_CHIP[d.status] ?? ["gray", d.status];
              return (
                <tr key={d.id} style={{ cursor: "pointer" }} onClick={() => open(d.id)}>
                  <td>{d.so_to_khai}</td>
                  <td className="nowrap">{d.ngay_dang_ky}</td>
                  <td>
                    <span className={`chip sm ${lhColor}`}>{lhLabel}</span>
                  </td>
                  <td>
                    <span className={`chip sm ${plColor}`}>{plLabel}</span>
                  </td>
                  <td>
                    {d.nguoi_xk}
                    {d.nuoc_xk ? ` (${d.nuoc_xk})` : ""}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div>
                      {fmtCur(d.tri_gia_nt)} {d.nguyen_te}
                    </div>
                    <div className="muted" style={{ fontSize: "0.78rem" }}>{vnd(d.tri_gia_tinh_thue)}đ</div>
                  </td>
                  <td style={{ textAlign: "right" }}>{vnd(d.tong_thue_nk)}đ</td>
                  <td style={{ textAlign: "right" }}>{vnd(d.tong_thue_vat)}đ</td>
                  <td>
                    <span className={`chip sm ${stColor}`}>{stLabel}</span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {d.status === "draft" && (
                      <button className="btn-sm ghost" title="Xóa bản nháp" onClick={() => delOne(d.id)}>
                        🗑
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr>
                <td colSpan={10}>
                  <div className="empty">
                    <div className="empty-ic">🛃</div>
                    <div>Chưa có tờ khai nhập khẩu nào. Bấm "Tải tờ khai" để bắt đầu.</div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {cur && (
        <div className="modal-backdrop" onClick={closeCur}>
          <div className="modal" style={{ maxWidth: 1000 }} onClick={(e) => e.stopPropagation()}>
            <h3>
              Tờ khai {cur.so_to_khai}{" "}
              <span className={`chip sm ${loaiHinhChip(cur.ma_loai_hinh)[0]}`}>
                {loaiHinhChip(cur.ma_loai_hinh)[1]}
              </span>{" "}
              <span className={`chip sm ${phanLuongChip(cur.phan_luong)[0]}`}>
                {phanLuongChip(cur.phan_luong)[1]}
              </span>{" "}
              <span className={`chip sm ${(STATUS_CHIP[cur.status] ?? ["gray"])[0]}`}>
                {(STATUS_CHIP[cur.status] ?? ["", cur.status])[1]}
              </span>
              {cur.doc_url && (
                <a
                  className="btn-sm"
                  style={{ marginLeft: 8 }}
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    window.open(cur.doc_url, "_blank");
                  }}
                >
                  📄 File tờ khai gốc
                </a>
              )}
            </h3>
            {cur.status === "posted" && (
              <div className="warn-banner" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span>
                  🔒 <b>Tờ khai đã ghi sổ</b> nên các ô đang bị khóa. Muốn sửa lại, bấm <b>Hủy ghi sổ</b> → sửa →
                  Ghi sổ lại (tồn kho tự tính lại).
                </span>
                <button className="btn-sm danger" disabled={busy} onClick={voidCur}>
                  ↩️ Hủy ghi sổ để sửa
                </button>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px 16px", margin: "8px 0" }}>
              <Info label="Ngày đăng ký" value={cur.ngay_dang_ky} />
              <Info label="Cơ quan HQ" value={cur.co_quan_hq} />
              <Info label="Người XK" value={cur.nguoi_xk + (cur.nuoc_xk ? ` (${cur.nuoc_xk})` : "")} />
              <Info label="Số vận đơn" value={cur.so_van_don} />
              <Info label="Số HĐ" value={cur.so_hoa_don + (cur.ngay_hoa_don ? ` · ${cur.ngay_hoa_don}` : "")} />
              <Info label="PTTT" value={cur.phuong_thuc_tt} />
              <Info label="Incoterm" value={cur.incoterm} />
              <Info label="Nguyên tệ" value={cur.nguyen_te} />
              <Info label="Trị giá NT" value={`${fmtCur(cur.tri_gia_nt)} ${cur.nguyen_te}`} />
              <Info label="Phí ship NT" value={`${fmtCur(cur.phi_ship_nt)} ${cur.nguyen_te}`} />
              <Info label="Tỉ giá" value={fmtCur(cur.ti_gia)} />
              <Info label="Trị giá tính thuế" value={`${vnd(cur.tri_gia_tinh_thue)}đ`} />
            </div>

            <div className="table-wrap" style={{ marginTop: 10, maxHeight: "36vh", overflow: "auto" }}>
              <table className="dt">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Mã HS</th>
                    <th>Mô tả</th>
                    <th>SL</th>
                    <th style={{ textAlign: "right" }}>Trị giá tính thuế</th>
                    <th style={{ textAlign: "right" }}>Thuế NK</th>
                    <th style={{ textAlign: "right" }}>VAT</th>
                    <th>Kho</th>
                    <th style={{ minWidth: 220 }}>Mặt hàng tồn kho</th>
                    <th style={{ textAlign: "right" }}>Giá vốn</th>
                  </tr>
                </thead>
                <tbody>
                  {cur.lines.map((ln, idx) => (
                    <tr key={ln.id}>
                      <td className="muted">{ln.stt}</td>
                      <td>{ln.ma_hs}</td>
                      <td>{ln.mo_ta}</td>
                      <td className="nowrap">
                        {ln.so_luong} {ln.dvt}
                      </td>
                      <td style={{ textAlign: "right" }}>{vnd(ln.tri_gia_tinh_thue)}đ</td>
                      <td style={{ textAlign: "right" }}>
                        {ln.thue_suat_nk}% · {vnd(ln.tien_thue_nk)}đ
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {ln.thue_suat_vat}% · {vnd(ln.tien_thue_vat)}đ
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
                              {matchLabel(ln.match_kind)}
                            </span>{" "}
                            {ln.item_ma_hang || `#${ln.item_id}`}
                            {cur.status === "draft" && (
                              <button
                                className="btn-sm ghost"
                                onClick={() => setLine(idx, { item_id: null, item_ma_hang: "", match_kind: "none" })}
                              >
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
                      <td style={{ textAlign: "right" }}>{cur.status === "posted" ? `${vnd(ln.gia_von)}đ` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h4 style={{ marginTop: 14, marginBottom: 6 }}>💰 Chi phí tính vào giá vốn</h4>
            <div className="table-wrap">
              <table className="dt">
                <thead>
                  <tr>
                    <th>Loại</th>
                    <th>Tên</th>
                    <th style={{ textAlign: "right" }}>Số tiền</th>
                    <th>Ghi chú</th>
                    <th style={{ width: 70 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {cur.costs.map((c, idx) => {
                    const editable = cur.status === "draft" && !c.doc_url;
                    return (
                      <tr key={c.id}>
                        <td>
                          {editable ? (
                            <select value={c.loai} onChange={(e) => setCost(idx, { loai: e.target.value })}>
                              <option value="le_phi_hq">Lệ phí HQ</option>
                              <option value="phi_ngan_hang">Phí ngân hàng</option>
                              <option value="phi_ship">Phí vận chuyển</option>
                              <option value="phi_khac">Phí khác</option>
                            </select>
                          ) : (
                            COST_LOAI_LABEL[c.loai] ?? c.loai
                          )}
                        </td>
                        <td>
                          {editable ? (
                            <input value={c.ten} onChange={(e) => setCost(idx, { ten: e.target.value })} />
                          ) : (
                            c.ten
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {editable ? (
                            <input
                              style={{ width: 110, textAlign: "right" }}
                              value={c.so_tien}
                              onChange={(e) => setCost(idx, { so_tien: vnNum(e.target.value) })}
                            />
                          ) : (
                            `${vnd(c.so_tien)}đ`
                          )}
                        </td>
                        <td>
                          {editable ? (
                            <input value={c.ghi_chu} onChange={(e) => setCost(idx, { ghi_chu: e.target.value })} />
                          ) : (
                            c.ghi_chu
                          )}
                        </td>
                        <td>
                          {c.doc_url && (
                            <a
                              className="btn-sm ghost"
                              href="#"
                              title="Tải chứng từ"
                              onClick={(e) => {
                                e.preventDefault();
                                window.open(c.doc_url, "_blank");
                              }}
                            >
                              📎
                            </a>
                          )}
                          {editable && (
                            <button className="btn-sm ghost" onClick={() => removeCost(idx)}>
                              🗑
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {cur.costs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted">
                        Chưa có chi phí nào.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {cur.status === "draft" && (
              <div className="tb-group" style={{ margin: "6px 0" }}>
                <button className="btn-sm" onClick={addCostRow}>
                  ＋ Thêm phí
                </button>
                <input
                  ref={attachRef}
                  type="file"
                  accept=".pdf"
                  style={{ display: "none" }}
                  onChange={(e) => attach(e.target.files)}
                />
                <button className="btn-sm" disabled={attachBusy} onClick={() => attachRef.current?.click()}>
                  {attachBusy ? "Đang xử lý…" : "📎 Đính kèm chứng từ (PDF)"}
                </button>
              </div>
            )}
            {parseInfo && <div className="warn-banner">{parseInfoMsg(parseInfo)}</div>}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 24, marginTop: 8, fontSize: "0.9rem", flexWrap: "wrap" }}>
              <span>
                Trị giá tính thuế: <b>{vnd(cur.tri_gia_tinh_thue)}đ</b>
              </span>
              <span>
                Thuế NK: <b>{vnd(cur.tong_thue_nk)}đ</b>
              </span>
              <span>
                Σ Chi phí: <b>{vnd(cur.tong_costs)}đ</b>
              </span>
              <span style={{ fontSize: "1.05rem" }}>
                Tổng giá vốn: <b style={{ color: "var(--primary)" }}>{vnd(tongGiaVon)}đ</b>
              </span>
            </div>
            <div className="muted" style={{ textAlign: "right", fontSize: "0.8rem" }}>
              VAT hàng NK (khấu trừ, không vào giá vốn): {vnd(cur.tong_thue_vat)}đ
            </div>

            <div className="modal-actions">
              {cur.status === "draft" && (
                <>
                  <button className="btn-sm danger" onClick={deleteCur}>
                    Xóa nháp
                  </button>
                  <button onClick={saveDraft}>💾 Lưu</button>
                  <button
                    className="primary"
                    disabled={unmatched > 0}
                    title={unmatched > 0 ? `Còn ${unmatched} dòng chưa khớp mặt hàng` : ""}
                    onClick={postCur}
                  >
                    ✅ Ghi sổ
                  </button>
                </>
              )}
              {cur.status === "posted" && (
                <button className="btn-sm danger" onClick={voidCur}>
                  ↩️ Hủy ghi sổ
                </button>
              )}
              <button onClick={closeCur}>Đóng</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
