import type React from "react";
import type {
  PieceworkContractDetail,
  PieceworkContractorItem,
  PieceworkWorkItem,
} from "../../api";
import {
  AppButton,
  AppModal,
  FormField,
  FormGrid,
  InlineAlert,
  SectionCard,
} from "../../components/ui";
import type { ContractFormState } from "./helpers";

export interface CreateContractModalProps {
  open: boolean;
  formData: ContractFormState;
  contractors: PieceworkContractorItem[];
  onChange: (next: ContractFormState) => void;
  onSelectContractor: (contractorId: number | "") => void;
  onAddItem: () => void;
  onChangeItem: (index: number, field: keyof PieceworkWorkItem, val: string | number) => void;
  onRemoveItem: (index: number) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

export function CreateContractModal({
  open,
  formData,
  contractors,
  onChange,
  onSelectContractor,
  onAddItem,
  onChangeItem,
  onRemoveItem,
  onSubmit,
  onClose,
}: CreateContractModalProps) {
  const total = formData.items.reduce((sum, it) => sum + (it.thanh_tien || 0), 0);

  return (
    <AppModal
      open={open}
      onClose={onClose}
      size="md"
      title="Tạo Hợp Đồng Giao Khoán Mới"
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose}>
            Hủy
          </AppButton>
          <AppButton type="submit" form="piecework-create-contract-form" variant="primary" leftIcon="plus">
            Tạo Hợp Đồng
          </AppButton>
        </>
      }
    >
      <form id="piecework-create-contract-form" className="ui-stack" onSubmit={onSubmit}>
        {contractors.length > 0 && (
          <FormField label="Chọn nhanh từ danh bạ nhà cung cấp / thợ (tự điền 100%)">
            <select
              className="ui-select"
              value={formData.contractor_id ?? ""}
              onChange={(e) => onSelectContractor(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">-- Nhập thủ công hoặc chọn nhà cung cấp có sẵn --</option>
              {contractors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code}) — CCCD: {c.id_card}
                </option>
              ))}
            </select>
          </FormField>
        )}

        <FormGrid cols={2}>
          <FormField label="Mã hợp đồng">
            <input
              type="text"
              className="ui-input"
              placeholder="VD: 04/2026/HĐGK"
              value={formData.contract_code}
              onChange={(e) => onChange({ ...formData, contract_code: e.target.value })}
            />
          </FormField>

          <FormField label="Loại hợp đồng">
            <select
              className="ui-select"
              value={formData.contract_type}
              onChange={(e) => {
                const newType = e.target.value;
                const isMb = newType === "mua_ban_ca_nhan";
                const todayStr = new Date().toISOString().slice(0, 10).split("-").reverse().join("");
                onChange({
                  ...formData,
                  contract_type: newType,
                  contract_code: formData.contract_code
                    ? formData.contract_code
                    : isMb
                      ? `${todayStr}-01/HĐMB-INUT`
                      : `${todayStr}-01/HĐGK-INUT`,
                  title:
                    isMb && (!formData.title || formData.title.includes("giao khoán"))
                      ? `Hợp đồng mua bán cá nhân - ${formData.project_name || "Hàng hóa / Thiết bị"}`
                      : formData.title,
                });
              }}
            >
              <option value="thi_cong">Thi công lắp đặt thiết bị / Kiosk</option>
              <option value="mua_ban_ca_nhan">
                Hợp đồng mua bán cá nhân (Hàng hóa / Thiết bị / Dịch vụ)
              </option>
              <option value="boc_xep">Bốc xếp, vận chuyển nội bộ</option>
              <option value="gia_cong">Gia công, đóng gói sản phẩm</option>
              <option value="marketing">Truyền thông & Marketing / Sáng tạo nội dung</option>
            </select>
          </FormField>

          <FormField
            label={
              formData.contract_type === "mua_ban_ca_nhan"
                ? "Tên hàng hóa / Tài sản / Giao dịch"
                : "Tên công trình / Hạng mục"
            }
            required
            fullWidth
          >
            <input
              type="text"
              required
              className="ui-input"
              placeholder={
                formData.contract_type === "mua_ban_ca_nhan"
                  ? "VD: Mua bán bo mạch, thiết bị camera, chuyển giao phần mềm"
                  : "VD: Lắp đặt Kiosk AI tại Phường Đông Sơn"
              }
              value={formData.project_name}
              onChange={(e) => onChange({ ...formData, project_name: e.target.value })}
            />
          </FormField>

          <FormField label="Địa điểm thi công">
            <input
              type="text"
              className="ui-input"
              placeholder="VD: TP. Thanh Hóa"
              value={formData.location}
              onChange={(e) => onChange({ ...formData, location: e.target.value })}
            />
          </FormField>

          <FormField label="Ngày hợp đồng">
            <input
              type="date"
              className="ui-input"
              value={formData.contract_date}
              onChange={(e) => onChange({ ...formData, contract_date: e.target.value })}
            />
          </FormField>

          <FormField label="Họ và tên thợ / Người nhận khoán" required>
            <input
              type="text"
              required
              className="ui-input"
              placeholder="VD: Nguyễn Văn A"
              value={formData.worker_name}
              onChange={(e) => onChange({ ...formData, worker_name: e.target.value })}
            />
          </FormField>

          <FormField label="Số điện thoại">
            <input
              type="text"
              className="ui-input"
              placeholder="VD: 0912 345 678"
              value={formData.worker_phone}
              onChange={(e) => onChange({ ...formData, worker_phone: e.target.value })}
            />
          </FormField>

          <FormField label="Số CCCD gắn chip">
            <input
              type="text"
              className="ui-input"
              placeholder="VD: 038092004512"
              value={formData.worker_id_card}
              onChange={(e) => onChange({ ...formData, worker_id_card: e.target.value })}
            />
          </FormField>

          <FormField label="Mã số thuế cá nhân">
            <input
              type="text"
              className="ui-input"
              placeholder="VD: 8492004512"
              value={formData.worker_tax_code}
              onChange={(e) => onChange({ ...formData, worker_tax_code: e.target.value })}
            />
          </FormField>

          <FormField label="Hình thức chi trả thù lao (Chỉ Admin được chọn)" fullWidth>
            <select
              className="ui-select"
              value={formData.payment_method}
              onChange={(e) =>
                onChange({ ...formData, payment_method: e.target.value as "bank_transfer" | "cash" })
              }
            >
              <option value="bank_transfer">Chuyển khoản ngân hàng (Mặc định)</option>
              <option value="cash">Nhận tiền mặt tại chân công trình (Chỉ áp dụng &lt; 5 triệu đồng)</option>
            </select>
          </FormField>

          <FormField label="Số tài khoản ngân hàng chính chủ">
            <input
              type="text"
              className="ui-input"
              placeholder="VD: 19034567891011"
              value={formData.worker_bank_account}
              onChange={(e) => onChange({ ...formData, worker_bank_account: e.target.value })}
            />
          </FormField>

          <FormField label="Tên ngân hàng">
            <input
              type="text"
              className="ui-input"
              placeholder="VD: Techcombank"
              value={formData.worker_bank_name}
              onChange={(e) => onChange({ ...formData, worker_bank_name: e.target.value })}
            />
          </FormField>

          <FormField label="Địa chỉ thường trú" fullWidth>
            <input
              type="text"
              className="ui-input"
              placeholder="VD: Tổ 5, Quyết Tâm, TP. Sơn La"
              value={formData.worker_address}
              onChange={(e) => onChange({ ...formData, worker_address: e.target.value })}
            />
          </FormField>
        </FormGrid>

        <SectionCard
          title="Hạng mục công việc giao khoán"
          padding="compact"
          tone="subtle"
          actions={
            <AppButton variant="secondary" size="sm" leftIcon="plus" onClick={onAddItem}>
              Thêm dòng
            </AppButton>
          }
        >
          <div className="ui-stack--sm">
            {formData.items.map((it, idx) => (
              <div key={idx} className="pw-work-row">
                <input
                  type="text"
                  className="ui-input"
                  placeholder="Tên công việc..."
                  value={it.ten}
                  onChange={(e) => onChangeItem(idx, "ten", e.target.value)}
                />
                <input
                  type="number"
                  min="1"
                  className="ui-input"
                  placeholder="SL"
                  value={it.so_luong}
                  onChange={(e) => onChangeItem(idx, "so_luong", Number(e.target.value))}
                />
                <input
                  type="text"
                  className="ui-input"
                  placeholder="ĐVT"
                  value={it.dvt}
                  onChange={(e) => onChangeItem(idx, "dvt", e.target.value)}
                />
                <input
                  type="number"
                  className="ui-input ui-text-right"
                  placeholder="Đơn giá"
                  value={it.don_gia}
                  onChange={(e) => onChangeItem(idx, "don_gia", Number(e.target.value))}
                />
                <AppButton
                  variant="danger"
                  size="sm"
                  iconOnly
                  leftIcon="x"
                  aria-label="Xóa dòng hạng mục"
                  onClick={() => onRemoveItem(idx)}
                />
              </div>
            ))}

            <div className="ui-subpanel ui-subpanel--md ui-text-xs ui-row ui-row-between ui-text-strong ui-wrap">
              <span>Tổng giá trị khoán:</span>
              <span className="pw-num">{total.toLocaleString("vi-VN")} VNĐ</span>
            </div>

            {total < 5000000 ? (
              <InlineAlert tone="success">
                Dưới 5 triệu đồng: Tự động miễn trừ 10% thuế TNCN theo Nghị định 253/2026/NĐ-CP.
              </InlineAlert>
            ) : (
              <InlineAlert tone="danger">
                Từ 5 triệu đồng trở lên: Tự động tính khấu trừ 10% thuế TNCN (
                {Math.round(total * 0.1).toLocaleString("vi-VN")} đ) nộp NSNN.
              </InlineAlert>
            )}
          </div>
        </SectionCard>
      </form>
    </AppModal>
  );
}

export interface EditContractModalProps {
  contract: PieceworkContractDetail | null;
  onChange: (next: PieceworkContractDetail) => void;
  onAddItem: () => void;
  onChangeItem: (index: number, field: keyof PieceworkWorkItem, val: string | number) => void;
  onRemoveItem: (index: number) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

export function EditContractModal({
  contract,
  onChange,
  onAddItem,
  onChangeItem,
  onRemoveItem,
  onSubmit,
  onClose,
}: EditContractModalProps) {
  return (
    <AppModal
      open={Boolean(contract)}
      onClose={onClose}
      size="md"
      title="Chỉnh Sửa Hợp Đồng Giao Khoán"
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose}>
            Hủy
          </AppButton>
          <AppButton type="submit" form="piecework-edit-contract-form" variant="primary" leftIcon="save">
            Lưu Thay Đổi
          </AppButton>
        </>
      }
    >
      {contract && (
        <form id="piecework-edit-contract-form" className="ui-stack" onSubmit={onSubmit}>
          <FormGrid cols={2}>
            <FormField label="Mã hợp đồng">
              <input type="text" disabled className="ui-input" value={contract.contract_code} />
            </FormField>

            <FormField label="Loại hợp đồng">
              <select
                className="ui-select"
                value={contract.contract_type}
                onChange={(e) => onChange({ ...contract, contract_type: e.target.value })}
              >
                <option value="thi_cong">Thi công lắp đặt thiết bị / Kiosk</option>
                <option value="mua_ban_ca_nhan">
                  Hợp đồng mua bán cá nhân (Hàng hóa / Thiết bị / Dịch vụ)
                </option>
                <option value="boc_xep">Bốc xếp, vận chuyển nội bộ</option>
                <option value="gia_cong">Gia công, đóng gói sản phẩm</option>
                <option value="marketing">Truyền thông & Marketing / Sáng tạo nội dung</option>
              </select>
            </FormField>

            <FormField label="Tên công trình / Hạng mục" required fullWidth>
              <input
                type="text"
                required
                className="ui-input"
                value={contract.project_name}
                onChange={(e) => onChange({ ...contract, project_name: e.target.value })}
              />
            </FormField>

            <FormField label="Địa điểm thi công">
              <input
                type="text"
                className="ui-input"
                value={contract.location}
                onChange={(e) => onChange({ ...contract, location: e.target.value })}
              />
            </FormField>

            <FormField label="Ngày hợp đồng">
              <input
                type="date"
                className="ui-input"
                value={contract.contract_date}
                onChange={(e) => onChange({ ...contract, contract_date: e.target.value })}
              />
            </FormField>

            <FormField label="Họ và tên thợ / Người nhận khoán" required>
              <input
                type="text"
                required
                className="ui-input"
                value={contract.worker_name}
                onChange={(e) => onChange({ ...contract, worker_name: e.target.value })}
              />
            </FormField>

            <FormField label="Số điện thoại">
              <input
                type="text"
                className="ui-input"
                value={contract.worker_phone}
                onChange={(e) => onChange({ ...contract, worker_phone: e.target.value })}
              />
            </FormField>

            <FormField label="Số CCCD gắn chip">
              <input
                type="text"
                className="ui-input"
                value={contract.worker_id_card}
                onChange={(e) => onChange({ ...contract, worker_id_card: e.target.value })}
              />
            </FormField>

            <FormField label="Mã số thuế cá nhân">
              <input
                type="text"
                className="ui-input"
                value={contract.worker_tax_code}
                onChange={(e) => onChange({ ...contract, worker_tax_code: e.target.value })}
              />
            </FormField>

            <FormField label="Hình thức chi trả thù lao (Chỉ Admin được chọn)" fullWidth>
              <select
                className="ui-select"
                value={contract.payment_method || "bank_transfer"}
                onChange={(e) =>
                  onChange({
                    ...contract,
                    payment_method: e.target.value as "bank_transfer" | "cash",
                  })
                }
              >
                <option value="bank_transfer">Chuyển khoản ngân hàng (Mặc định)</option>
                <option value="cash">Nhận tiền mặt tại chân công trình (Chỉ áp dụng &lt; 5 triệu đồng)</option>
              </select>
            </FormField>

            <FormField label="Số tài khoản ngân hàng chính chủ">
              <input
                type="text"
                className="ui-input"
                value={contract.worker_bank_account}
                onChange={(e) => onChange({ ...contract, worker_bank_account: e.target.value })}
              />
            </FormField>

            <FormField label="Tên ngân hàng">
              <input
                type="text"
                className="ui-input"
                value={contract.worker_bank_name}
                onChange={(e) => onChange({ ...contract, worker_bank_name: e.target.value })}
              />
            </FormField>

            <FormField label="Địa chỉ thường trú" fullWidth>
              <input
                type="text"
                className="ui-input"
                value={contract.worker_address}
                onChange={(e) => onChange({ ...contract, worker_address: e.target.value })}
              />
            </FormField>
          </FormGrid>

          <SectionCard
            title="Hạng mục công việc giao khoán"
            padding="compact"
            tone="subtle"
            actions={
              <AppButton variant="secondary" size="sm" leftIcon="plus" onClick={onAddItem}>
                Thêm dòng
              </AppButton>
            }
          >
            <div className="ui-stack--sm">
              {contract.items.map((it, idx) => (
                <div key={idx} className="pw-work-row">
                  <input
                    type="text"
                    className="ui-input"
                    placeholder="Tên công việc..."
                    value={it.ten}
                    onChange={(e) => onChangeItem(idx, "ten", e.target.value)}
                  />
                  <input
                    type="number"
                    min="1"
                    className="ui-input"
                    placeholder="SL"
                    value={it.so_luong}
                    onChange={(e) => onChangeItem(idx, "so_luong", Number(e.target.value))}
                  />
                  <input
                    type="text"
                    className="ui-input"
                    placeholder="ĐVT"
                    value={it.dvt}
                    onChange={(e) => onChangeItem(idx, "dvt", e.target.value)}
                  />
                  <input
                    type="number"
                    className="ui-input ui-text-right"
                    placeholder="Đơn giá"
                    value={it.don_gia}
                    onChange={(e) => onChangeItem(idx, "don_gia", Number(e.target.value))}
                  />
                  <AppButton
                    variant="danger"
                    size="sm"
                    iconOnly
                    leftIcon="x"
                    aria-label="Xóa dòng hạng mục"
                    onClick={() => onRemoveItem(idx)}
                  />
                </div>
              ))}
            </div>
          </SectionCard>
        </form>
      )}
    </AppModal>
  );
}
