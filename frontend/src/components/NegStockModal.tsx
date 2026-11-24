import { useId, useRef, useState } from "react";
import { NegStockViolation } from "../api";
import { AppButton, AppModal, FormField, InlineAlert } from "./ui";

type ViolationDisplay = NegStockViolation & {
  item_code?: string;
  item_name?: string;
};

/**
 * Modal duyệt ghi sổ CHẤP NHẬN âm kho (thay confirm/alert mặc định).
 * User phải nhập lý do (thừa nhận sai sót, sẽ nhập bù) trước khi ghi sổ.
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
  const reasonId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const canConfirm = reason.trim().length >= 3 && !busy;

  return (
    <AppModal
      open
      onClose={onCancel}
      dismissible={!busy}
      size="md"
      title="Sẽ âm kho — xác nhận ghi sổ?"
      initialFocusRef={textareaRef}
      footer={
        <>
          <AppButton variant="secondary" onClick={onCancel} disabled={busy}>
            Hủy
          </AppButton>
          <AppButton
            variant="danger"
            leftIcon="alert-triangle"
            disabled={!canConfirm}
            loading={busy}
            title={canConfirm ? "" : "Nhập lý do (tối thiểu 3 ký tự)"}
            onClick={() => onConfirm(reason.trim())}
          >
            Ghi sổ dù âm kho
          </AppButton>
        </>
      }
    >
      <div className="ui-stack">
        <InlineAlert tone="warning" title="Xuất vượt tồn kho (rủi ro thuế)">
          Các mặt hàng dưới đây sẽ bị âm kho tại ngày chứng từ (bán/xuất thứ chưa có đầu vào — rủi
          ro thuế). Chỉ ghi sổ khi bạn <b>thừa nhận sai sót và sẽ nhập bù</b>.
        </InlineAlert>

        <div className="table-wrap ui-scroll-sm">
          <table className="dt">
            <thead>
              <tr>
                <th>Mã / Tên</th>
                <th>Ngày</th>
                <th className="ui-text-right">Thiếu</th>
              </tr>
            </thead>
            <tbody>
              {violations.map((raw, i) => {
                const v = raw as ViolationDisplay;
                const code = v.ma_hang || v.item_code || "";
                const name = v.ten || v.item_name || "";
                return (
                  <tr key={i} className="row-treo">
                    <td>
                      <b>{code}</b> {name}
                    </td>
                    <td className="ui-nowrap">{v.ngay || ""}</td>
                    <td className="ui-text-right ui-text-danger ui-text-strong num">
                      {v.thieu ?? "?"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <FormField
          label="Lý do chấp nhận âm kho (bắt buộc — sẽ lưu vào chứng từ + nhật ký)"
          htmlFor={reasonId}
          required
          hint="Tối thiểu 3 ký tự để kích hoạt nút ghi sổ."
        >
          <textarea
            id={reasonId}
            ref={textareaRef}
            className="ui-textarea ui-textarea-sm"
            placeholder="Vd: đã nhập lại hàng, sẽ bù chứng từ nhập trước ngày này…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </FormField>
      </div>
    </AppModal>
  );
}
