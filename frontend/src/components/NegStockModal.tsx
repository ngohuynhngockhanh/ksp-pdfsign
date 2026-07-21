import { useState } from "react";
import { NegStockViolation } from "../api";

/**
 * Modal duyet ghi so CHAP NHAN am kho (thay confirm/alert mac dinh).
 * User phai nhap ly do (thua nhan sai, se nhap bu) truoc khi ghi so.
 */
export function NegStockModal({
  violations,
  busy,
  onConfirm,
  onCancel,
}: {
  violations: NegStockViolation[];
  busy: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const canConfirm = reason.trim().length >= 3 && !busy;
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <h3>⚠️ Sẽ âm kho — xác nhận ghi sổ?</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Các mặt hàng dưới đây sẽ bị âm kho tại ngày chứng từ (bán/xuất thứ chưa có đầu vào — rủi
          ro thuế). Chỉ ghi sổ khi bạn <b>thừa nhận sai sót và sẽ nhập bù</b>.
        </p>
        <div className="table-wrap" style={{ maxHeight: 220, overflowY: "auto" }}>
          <table className="dt">
            <thead>
              <tr>
                <th>Mã / Tên</th>
                <th>Ngày</th>
                <th style={{ textAlign: "right" }}>Thiếu</th>
              </tr>
            </thead>
            <tbody>
              {violations.map((v, i) => (
                <tr key={i} className="row-treo">
                  <td>
                    <b>{v.ma_hang || ""}</b> {v.ten || ""}
                  </td>
                  <td>{v.ngay || ""}</td>
                  <td style={{ textAlign: "right", color: "#c0392b", fontWeight: 600 }}>
                    {v.thieu ?? "?"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label style={{ display: "block", marginTop: 10 }}>
          Lý do chấp nhận âm kho (bắt buộc — sẽ lưu vào chứng từ + nhật ký):
          <textarea
            autoFocus
            style={{ width: "100%", minHeight: 60, resize: "vertical", marginTop: 4 }}
            placeholder="Vd: đã nhập lại hàng, sẽ bù chứng từ nhập trước ngày này…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <div className="modal-actions">
          <button onClick={onCancel} disabled={busy}>
            Hủy
          </button>
          <button
            className="danger"
            disabled={!canConfirm}
            title={canConfirm ? "" : "Nhập lý do (tối thiểu 3 ký tự)"}
            onClick={() => onConfirm(reason.trim())}
          >
            ⚠️ Ghi sổ dù âm kho
          </button>
        </div>
      </div>
    </div>
  );
}
