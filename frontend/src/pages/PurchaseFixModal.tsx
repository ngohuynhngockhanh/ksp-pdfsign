import { useEffect, useState } from "react";
import { api, InvPurchase, InvPurchaseLine } from "../api";

function vnd(n: number): string {
  return Math.round(n).toLocaleString("vi-VN");
}
function num(s: string): number {
  const t = s.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const n = parseFloat(t);
  return isNaN(n) ? 0 : n;
}

/** Modal sửa hóa đơn MUA ngay tại chỗ (dùng trong Tồn kho — không rời trang).
 * Chủ yếu để chữa lỗi parse PDF: đơn giá/số lượng/thành tiền sai. */
export function PurchaseFixModal({
  purchaseId,
  onClose,
  onChanged,
}: {
  purchaseId: number;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [cur, setCur] = useState<InvPurchase | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.invPurchase(purchaseId).then(setCur).catch((e) => setErr((e as Error).message));
  }, [purchaseId]);

  const isDraft = cur?.status === "draft";

  function setLine(idx: number, patch: Partial<InvPurchaseLine>) {
    if (!cur) return;
    const lines = cur.lines.map((ln, i) => {
      if (i !== idx) return ln;
      const next = { ...ln, ...patch };
      if ("so_luong" in patch || "don_gia" in patch) {
        next.thanh_tien = Math.round(next.so_luong * next.don_gia);
      }
      return next;
    });
    setCur({ ...cur, lines });
  }

  function recomputeAll() {
    if (!cur) return;
    setCur({
      ...cur,
      lines: cur.lines.map((ln) => ({ ...ln, thanh_tien: Math.round(ln.so_luong * ln.don_gia) })),
    });
  }

  async function saveDraft(): Promise<InvPurchase | null> {
    if (!cur) return null;
    setBusy(true);
    setErr("");
    try {
      const body = {
        so_hd: cur.so_hd, ky_hieu: cur.ky_hieu, mst_ban: cur.mst_ban,
        ten_ban: cur.ten_ban, ngay: cur.ngay, loai: cur.loai,
        lines: cur.lines.map((ln) => ({
          stt: ln.stt, ten_raw: ln.ten_raw, dvt: ln.dvt, so_luong: ln.so_luong,
          don_gia: ln.don_gia, thanh_tien: ln.thanh_tien, thue_suat: ln.thue_suat,
          item_id: ln.item_id, warehouse_id: ln.warehouse_id, match_kind: ln.match_kind,
        })),
      };
      const saved = await api.invPurchaseSave(cur.id, body);
      setCur(saved);
      onChanged?.();
      return saved;
    } catch (e) {
      setErr((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<InvPurchase>, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    setErr("");
    try {
      setCur(await fn());
      onChanged?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function postCur() {
    const saved = await saveDraft();
    if (saved) await act(() => api.invPurchasePost(saved.id));
  }

  const lineFlag = (ln: InvPurchaseLine) =>
    ln.thanh_tien > 0 && Math.abs(ln.so_luong * ln.don_gia - ln.thanh_tien) > 1;
  const anyFlag = cur?.lines.some(lineFlag) ?? false;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal review-2col" style={{ maxWidth: 1180 }} onClick={(e) => e.stopPropagation()}>
        <div className="review-form">
          {!cur ? (
            <div style={{ padding: 24 }}>{err ? <div className="error">{err}</div> : "Đang tải hóa đơn…"}</div>
          ) : (
            <>
              <h3>
                Sửa HĐ mua #{cur.id} · {cur.so_hd || "?"}{" "}
                <span className={`chip sm ${cur.status === "posted" ? "green" : cur.status === "void" ? "gray" : "amber"}`}>
                  {cur.status === "posted" ? "Đã ghi sổ" : cur.status === "void" ? "Đã hủy" : "Nháp"}
                </span>{" "}
                <span className="chip gray sm">{cur.source}</span>
              </h3>
              {err && <div className="error" style={{ marginBottom: 8 }}>{err}</div>}

              {cur.status === "posted" && (
                <div className="warn-banner" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span>🔒 <b>Đã ghi sổ</b> nên ô bị khóa. Bấm <b>Hủy ghi sổ</b> để sửa lại đơn giá/số lượng.</span>
                  <button
                    className="btn-sm danger"
                    disabled={busy}
                    onClick={() => act(() => api.invPurchaseVoid(cur.id), "Hủy ghi sổ hóa đơn này để sửa? Tồn kho sẽ tính lại.")}
                  >
                    ↩️ Hủy ghi sổ để sửa
                  </button>
                </div>
              )}

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0" }}>
                <label>
                  Ngày
                  <input value={cur.ngay} disabled={!isDraft} onChange={(e) => setCur({ ...cur, ngay: e.target.value })} />
                </label>
                <label style={{ flex: 1 }}>
                  Nhà cung cấp
                  <input value={cur.ten_ban} disabled={!isDraft} onChange={(e) => setCur({ ...cur, ten_ban: e.target.value })} />
                </label>
                <div className="muted" style={{ alignSelf: "flex-end" }}>
                  Tổng trước thuế HĐ: <b>{vnd(cur.tong_truoc_thue)}đ</b>
                </div>
              </div>

              <div className="table-wrap" style={{ maxHeight: "48vh", overflow: "auto" }}>
                <table className="dt">
                  <thead>
                    <tr>
                      <th>Tên hàng</th>
                      <th style={{ textAlign: "right" }}>SL</th>
                      <th style={{ textAlign: "right" }}>Đơn giá</th>
                      <th style={{ textAlign: "right" }}>Thành tiền (SL×ĐG)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cur.lines.map((ln, idx) => (
                      <tr key={ln.id ?? idx} className={lineFlag(ln) ? "row-treo" : ""}>
                        <td style={{ minWidth: 200, whiteSpace: "normal", wordBreak: "break-word" }}>
                          <span className="chip green sm">{ln.item_ma_hang || "?"}</span> {ln.ten_raw}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {isDraft ? (
                            <input
                              style={{ width: 70, textAlign: "right" }}
                              defaultValue={ln.so_luong}
                              onChange={(e) => setLine(idx, { so_luong: num(e.target.value) })}
                            />
                          ) : (
                            ln.so_luong
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {isDraft ? (
                            <input
                              style={{ width: 110, textAlign: "right" }}
                              defaultValue={ln.don_gia}
                              onChange={(e) => setLine(idx, { don_gia: num(e.target.value) })}
                            />
                          ) : (
                            vnd(ln.don_gia)
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {vnd(ln.so_luong * ln.don_gia)}
                          {lineFlag(ln) && (
                            <div className="chip red sm" title="Thành tiền lưu trên hóa đơn khác SL×ĐG (lỗi parse PDF)">
                              HĐ ghi {vnd(ln.thanh_tien)}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {anyFlag && isDraft && (
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  ⚠️ Có dòng thành tiền lệch SL×ĐG (lỗi parse PDF) — bấm <b>🔧 Tính lại thành tiền</b>.
                </div>
              )}

              <div className="modal-actions">
                <button onClick={onClose}>Đóng</button>
                {isDraft && (
                  <>
                    <button className="btn-sm" disabled={busy} title="Đặt lại Thành tiền = SL×ĐG cho mọi dòng" onClick={recomputeAll}>
                      🔧 Tính lại thành tiền
                    </button>
                    <button disabled={busy} onClick={saveDraft}>💾 Lưu nháp</button>
                    <button className="primary" disabled={busy} onClick={postCur}>
                      ✅ Ghi sổ lại
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
        <div className="review-file">
          {cur?.doc_url ? (
            <iframe title="file gốc" src={cur.doc_url} />
          ) : (
            <div className="no-file">Không có file gốc</div>
          )}
        </div>
      </div>
    </div>
  );
}
