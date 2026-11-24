import { useEffect, useId, useState } from "react";
import { api, InvPurchase, InvPurchaseLine } from "../api";
import {
  AppButton,
  AppModal,
  DataView,
  EmptyState,
  FormField,
  FormGrid,
  InlineAlert,
  StatusBadge,
  TableSkeleton,
  useConfirm,
  useToast,
} from "./ui";

function vnd(n: number): string {
  return Math.round(n).toLocaleString("vi-VN");
}

function num(s: string): number {
  const t = s.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const n = parseFloat(t);
  return isNaN(n) ? 0 : n;
}

/**
 * Modal sửa hóa đơn MUA ngay tại chỗ (dùng trong Tồn kho — không rời trang).
 * Chủ yếu để chữa lỗi parse PDF: đơn giá/số lượng/thành tiền sai.
 */
export function PurchaseFixModal({
  purchaseId,
  onClose,
  onChanged,
}: {
  purchaseId: number;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const askConfirm = useConfirm();
  const toast = useToast();
  const [cur, setCur] = useState<InvPurchase | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ngayId = useId();
  const supplierId = useId();

  useEffect(() => {
    setCur(null);
    setErr("");
    api
      .invPurchase(purchaseId)
      .then(setCur)
      .catch((e) => setErr((e as Error).message));
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
      lines: cur.lines.map((ln) => ({
        ...ln,
        thanh_tien: Math.round(ln.so_luong * ln.don_gia),
      })),
    });
    toast.info("Đã tính lại Thành tiền = SL × Đơn giá cho tất cả dòng.");
  }

  async function saveDraft(silent = false): Promise<InvPurchase | null> {
    if (!cur) return null;
    setBusy(true);
    setErr("");
    try {
      const body = {
        so_hd: cur.so_hd,
        ky_hieu: cur.ky_hieu,
        mst_ban: cur.mst_ban,
        ten_ban: cur.ten_ban,
        ngay: cur.ngay,
        loai: cur.loai,
        lines: cur.lines.map((ln) => ({
          stt: ln.stt,
          ten_raw: ln.ten_raw,
          dvt: ln.dvt,
          so_luong: ln.so_luong,
          don_gia: ln.don_gia,
          thanh_tien: ln.thanh_tien,
          thue_suat: ln.thue_suat,
          item_id: ln.item_id,
          warehouse_id: ln.warehouse_id,
          match_kind: ln.match_kind,
        })),
      };
      const saved = await api.invPurchaseSave(cur.id, body);
      setCur(saved);
      onChanged?.();
      if (!silent) toast.success(`Đã lưu nháp HĐ #${saved.id}.`);
      return saved;
    } catch (e) {
      setErr((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function voidCur() {
    if (!cur) return;
    const ok = await askConfirm({
      title: `Hủy ghi sổ HĐ mua #${cur.id}?`,
      message: "Hủy ghi sổ hóa đơn này để sửa lại đơn giá/số lượng? Tồn kho sẽ tự động tính lại.",
      confirmLabel: "Hủy ghi sổ để sửa",
      tone: "warning",
    });
    if (!ok) return;
    setBusy(true);
    setErr("");
    try {
      setCur(await api.invPurchaseVoid(cur.id));
      onChanged?.();
      toast.info(`Đã hủy ghi sổ HĐ #${cur.id}. Bạn có thể chỉnh sửa ngay bây giờ.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function postCur() {
    const saved = await saveDraft(true);
    if (!saved) return;
    setBusy(true);
    setErr("");
    try {
      setCur(await api.invPurchasePost(saved.id));
      onChanged?.();
      toast.success(`Đã ghi sổ lại HĐ #${saved.id}.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const lineFlag = (ln: InvPurchaseLine) =>
    ln.thanh_tien > 0 && Math.abs(ln.so_luong * ln.don_gia - ln.thanh_tien) > 1;
  const anyFlag = cur?.lines.some(lineFlag) ?? false;

  const statusTone =
    cur?.status === "posted" ? "success" : cur?.status === "void" ? "neutral" : "warning";
  const statusLabel =
    cur?.status === "posted" ? "Đã ghi sổ" : cur?.status === "void" ? "Đã hủy" : "Nháp";

  return (
    <AppModal
      open
      onClose={onClose}
      size="full"
      title={
        cur ? (
          <span className="ui-inline ui-inline--md ui-inline--wrap">
            <span>
              Sửa HĐ mua #{cur.id} · {cur.so_hd || "?"}
            </span>
            <StatusBadge tone={statusTone} size="sm" dot>
              {statusLabel}
            </StatusBadge>
            <StatusBadge tone="neutral" size="sm">
              {cur.source}
            </StatusBadge>
          </span>
        ) : (
          "Sửa hóa đơn mua"
        )
      }
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose}>
            Đóng
          </AppButton>
          {cur && isDraft && (
            <>
              <AppButton
                variant="secondary"
                size="sm"
                leftIcon="calculator"
                disabled={busy}
                title="Đặt lại Thành tiền = SL×ĐG cho mọi dòng"
                onClick={recomputeAll}
              >
                Tính lại thành tiền
              </AppButton>
              <AppButton
                variant="secondary"
                leftIcon="save"
                disabled={busy}
                onClick={() => void saveDraft(false)}
              >
                Lưu nháp
              </AppButton>
              <AppButton
                variant="primary"
                leftIcon="check-circle"
                loading={busy}
                onClick={postCur}
              >
                Ghi sổ lại
              </AppButton>
            </>
          )}
        </>
      }
    >
      <div className="ui-review-split">
        <div className="ui-review-form">
          {!cur ? (
            err ? (
              <InlineAlert tone="danger">{err}</InlineAlert>
            ) : (
              <TableSkeleton rows={5} cols={4} />
            )
          ) : (
            <>
              {err && <InlineAlert tone="danger">{err}</InlineAlert>}

              {cur.status === "posted" && (
                <InlineAlert
                  tone="warning"
                  title="Hóa đơn đã ghi sổ"
                  action={
                    <AppButton
                      variant="danger"
                      size="sm"
                      leftIcon="rotate-ccw"
                      loading={busy}
                      onClick={voidCur}
                    >
                      Hủy ghi sổ để sửa
                    </AppButton>
                  }
                >
                  Các ô dữ liệu đang bị khóa. Bấm <b>Hủy ghi sổ để sửa</b> để chỉnh lại đơn giá/số
                  lượng.
                </InlineAlert>
              )}

              <FormGrid cols={2}>
                <FormField label="Ngày hóa đơn" htmlFor={ngayId}>
                  <input
                    id={ngayId}
                    className="ui-input"
                    value={cur.ngay}
                    disabled={!isDraft}
                    onChange={(e) => setCur({ ...cur, ngay: e.target.value })}
                  />
                </FormField>
                <FormField label="Nhà cung cấp" htmlFor={supplierId}>
                  <input
                    id={supplierId}
                    className="ui-input"
                    value={cur.ten_ban}
                    disabled={!isDraft}
                    onChange={(e) => setCur({ ...cur, ten_ban: e.target.value })}
                  />
                </FormField>
              </FormGrid>

              <div className="ui-muted">
                Tổng trước thuế HĐ: <b className="num">{vnd(cur.tong_truoc_thue)} đ</b>
              </div>

              <DataView
                mobileMode="scroll"
                desktop={
                  <div className="table-wrap ui-scroll-md">
                    <table className="dt">
                      <thead>
                        <tr>
                          <th>Tên hàng</th>
                          <th className="ui-text-right">SL</th>
                          <th className="ui-text-right">Đơn giá</th>
                          <th className="ui-text-right">Thành tiền (SL×ĐG)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cur.lines.map((ln, idx) => (
                          <tr key={ln.id ?? idx} className={lineFlag(ln) ? "row-treo" : ""}>
                            <td className="ui-col-wide">
                              <StatusBadge tone="success" size="sm" className="ui-mr-xs">
                                {ln.item_ma_hang || "?"}
                              </StatusBadge>
                              {ln.ten_raw}
                            </td>
                            <td className="ui-text-right num">
                              {isDraft ? (
                                <input
                                  className="ui-input ui-input-qty"
                                  defaultValue={ln.so_luong}
                                  onChange={(e) => setLine(idx, { so_luong: num(e.target.value) })}
                                />
                              ) : (
                                ln.so_luong
                              )}
                            </td>
                            <td className="ui-text-right num">
                              {isDraft ? (
                                <input
                                  className="ui-input ui-input-price"
                                  defaultValue={ln.don_gia}
                                  onChange={(e) => setLine(idx, { don_gia: num(e.target.value) })}
                                />
                              ) : (
                                vnd(ln.don_gia)
                              )}
                            </td>
                            <td className="ui-text-right num">
                              <div>{vnd(ln.so_luong * ln.don_gia)}</div>
                              {lineFlag(ln) && (
                                <StatusBadge
                                  tone="danger"
                                  size="sm"
                                  title="Thành tiền lưu trên hóa đơn khác SL×ĐG (lỗi parse PDF)"
                                >
                                  HĐ ghi {vnd(ln.thanh_tien)}
                                </StatusBadge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                }
              />

              {anyFlag && isDraft && (
                <InlineAlert tone="warning">
                  Có dòng thành tiền lệch SL×ĐG (lỗi parse PDF) — bấm <b>Tính lại thành tiền</b>{" "}
                  trước khi ghi sổ.
                </InlineAlert>
              )}
            </>
          )}
        </div>
        <div className="ui-review-file">
          {cur?.doc_url ? (
            <iframe title="File gốc hóa đơn" src={cur.doc_url} />
          ) : (
            <div className="no-file">
              <EmptyState
                icon="file-text"
                compact
                title="Không có file gốc"
                description="Hóa đơn này chưa đính kèm tệp PDF gốc."
              />
            </div>
          )}
        </div>
      </div>
    </AppModal>
  );
}
