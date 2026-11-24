import type React from "react";
import type {
  PieceworkContractorItem,
  PieceworkContractorTaxSummary,
} from "../../api";
import {
  AppButton,
  AppIcon,
  AppModal,
  DataView,
  FormField,
  FormGrid,
  InlineAlert,
  KpiStrip,
  MobileCard,
  MobileCardGrid,
  MobileCardHeader,
  MobileCardRow,
  StatusBadge,
} from "../../components/ui";
import { safeHttpUrl } from "../../utils/url";
import { formatVnd, type ContractorFormState } from "./helpers";

export interface ContractorFormModalProps {
  open: boolean;
  editingContractor: PieceworkContractorItem | null;
  form: ContractorFormState;
  onChange: (next: ContractorFormState) => void;
  onOpenSmartPaste: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

export function ContractorFormModal({
  open,
  editingContractor,
  form,
  onChange,
  onOpenSmartPaste,
  onSubmit,
  onClose,
}: ContractorFormModalProps) {
  return (
    <AppModal
      open={open}
      onClose={onClose}
      size="md"
      title={
        editingContractor
          ? "Chỉnh Sửa Hồ Sơ Nhà Cung Cấp / Thợ"
          : "Thêm Nhà Cung Cấp / Thợ Mới Vào Danh Bạ"
      }
      subtitle="Lưu trữ định danh CCCD & MST cá nhân để tạo HĐ khoán nhanh và hỗ trợ quyết toán thuế"
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose}>
            Hủy
          </AppButton>
          <AppButton type="submit" form="piecework-contractor-form" variant="primary" leftIcon="save">
            {editingContractor ? "Lưu Cập Nhật" : "Lưu Vào Danh Bạ"}
          </AppButton>
        </>
      }
    >
      <form id="piecework-contractor-form" className="ui-stack" onSubmit={onSubmit}>
        <InlineAlert
          tone="info"
          action={
            <AppButton variant="gold" size="sm" leftIcon="zap" onClick={onOpenSmartPaste}>
              Dán nhanh tự điền form
            </AppButton>
          }
        >
          Có tin nhắn Zalo hoặc mã QR CCCD của thợ?
        </InlineAlert>

        <FormGrid cols={2}>
          <FormField label="Mã nhà cung cấp (Tùy chọn)">
            <input
              type="text"
              className="ui-input"
              placeholder="VD: CTV-HAI-4512 (để trống tự sinh)"
              value={form.code}
              onChange={(e) => onChange({ ...form, code: e.target.value })}
            />
          </FormField>

          <FormField label="Họ và tên thợ / Người nhận khoán" required>
            <input
              type="text"
              required
              className="ui-input"
              placeholder="VD: Lê Văn Hải"
              value={form.name}
              onChange={(e) => onChange({ ...form, name: e.target.value })}
            />
          </FormField>

          <FormField label="Số CCCD gắn chip (12 số)" required>
            <input
              type="text"
              required
              className="ui-input"
              placeholder="VD: 038092004512"
              value={form.id_card}
              onChange={(e) => onChange({ ...form, id_card: e.target.value })}
            />
          </FormField>

          <FormField label="Ngày cấp CCCD">
            <input
              type="date"
              className="ui-input"
              value={form.id_card_date}
              onChange={(e) => onChange({ ...form, id_card_date: e.target.value })}
            />
          </FormField>

          <FormField label="Nơi cấp CCCD">
            <input
              type="text"
              className="ui-input"
              value={form.id_card_place}
              onChange={(e) => onChange({ ...form, id_card_place: e.target.value })}
            />
          </FormField>

          <FormField label="Mã số thuế cá nhân (MST làm hoàn thuế)">
            <input
              type="text"
              className="ui-input"
              placeholder="VD: 8492004512"
              value={form.tax_code}
              onChange={(e) => onChange({ ...form, tax_code: e.target.value })}
            />
          </FormField>

          <FormField label="Số điện thoại">
            <input
              type="text"
              className="ui-input"
              placeholder="VD: 0961 197 999"
              value={form.phone}
              onChange={(e) => onChange({ ...form, phone: e.target.value })}
            />
          </FormField>

          <FormField label="Số tài khoản ngân hàng chính chủ">
            <input
              type="text"
              className="ui-input"
              placeholder="VD: 19034567891011"
              value={form.bank_account}
              onChange={(e) => onChange({ ...form, bank_account: e.target.value })}
            />
          </FormField>

          <FormField label="Tên ngân hàng thụ hưởng">
            <input
              type="text"
              className="ui-input"
              placeholder="VD: Techcombank"
              value={form.bank_name}
              onChange={(e) => onChange({ ...form, bank_name: e.target.value })}
            />
          </FormField>

          <FormField label="Kỹ năng / Hạng mục khoán chính">
            <input
              type="text"
              className="ui-input"
              placeholder="VD: Lắp đặt Kiosk, thi công điện mạng..."
              value={form.skills}
              onChange={(e) => onChange({ ...form, skills: e.target.value })}
            />
          </FormField>

          <FormField label="Địa chỉ thường trú (Theo CCCD)" fullWidth>
            <input
              type="text"
              className="ui-input"
              placeholder="VD: Tổ 2, Phường Đông Sơn, TP. Thanh Hóa, Tỉnh Thanh Hóa"
              value={form.address}
              onChange={(e) => onChange({ ...form, address: e.target.value })}
            />
          </FormField>
        </FormGrid>
      </form>
    </AppModal>
  );
}

export interface SmartPasteModalProps {
  open: boolean;
  text: string;
  onChangeText: (value: string) => void;
  onApply: () => void;
  onClose: () => void;
}

export function SmartPasteModal({
  open,
  text,
  onChangeText,
  onApply,
  onClose,
}: SmartPasteModalProps) {
  return (
    <AppModal
      open={open}
      onClose={onClose}
      size="md"
      title="Dán Nhanh & Trích Xuất Thông Tin Thợ"
      subtitle="Tự động nhận diện Họ tên, CCCD 12 số, Ngày cấp, Nơi cấp, MST, SĐT, STK ngân hàng, Địa chỉ"
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose}>
            Hủy
          </AppButton>
          <AppButton
            variant="gold"
            leftIcon="zap"
            onClick={onApply}
            disabled={!text.trim()}
          >
            Trích Xuất & Điền Tự Động
          </AppButton>
        </>
      }
    >
      <div className="ui-stack">
        <div>
          <StatusBadge tone="brand" icon="sparkles">
            AI / Heuristic Extraction
          </StatusBadge>
        </div>

        <FormField
          label="Dán toàn bộ tin nhắn Zalo, SMS hoặc chuỗi quét mã QR CCCD của thợ"
          hint="Hệ thống áp dụng thuật toán bóc tách regex thông minh, chống sai số tài khoản và định dạng CCCD chuẩn Bộ Công an."
        >
          <textarea
            rows={7}
            className="ui-textarea"
            placeholder={`Ví dụ tin nhắn Zalo:\nNguyễn Văn An, cccd 038092004512 cấp ngày 15/04/2022 tại Cục Cảnh sát QLHC về TTXH, mst 8492004512, sđt 0912 345 678, stk 19034567891011 techcombank, đ/c Tổ 2, Phường Đông Sơn, Thanh Hóa\n\nHoặc chuỗi QR CCCD:\n038092004512||Nguyễn Văn An|15041992|Nam|Tổ 2, Đông Sơn, Thanh Hóa|15042022`}
            value={text}
            onChange={(e) => onChangeText(e.target.value)}
          />
        </FormField>
      </div>
    </AppModal>
  );
}

export function TaxSummaryModal({
  data,
  onClose,
}: {
  data: PieceworkContractorTaxSummary | null;
  onClose: () => void;
}) {
  return (
    <AppModal
      open={Boolean(data)}
      onClose={onClose}
      size="lg"
      title={data ? `Bảng Kê Chi Trả Thù Lao & Khấu Trừ Thuế TNCN — Năm ${data.year}` : ""}
      subtitle={
        data ? (
          <>
            Thợ: <b>{data.contractor.name}</b> · CCCD: <b>{data.contractor.id_card}</b> · MST:{" "}
            <b>{data.contractor.tax_code || "Chưa có"}</b>
          </>
        ) : undefined
      }
      footer={
        <>
          <AppButton variant="secondary" onClick={onClose}>
            Đóng
          </AppButton>
          <AppButton variant="primary" leftIcon="printer" onClick={() => window.print()}>
            In Bảng Kê Thuế
          </AppButton>
        </>
      }
    >
      {data && (
        <div className="ui-stack">
          <div>
            <StatusBadge tone="success" icon="scale">
              Hỗ Trợ Hoàn Thuế TNCN (NĐ 253/2026/NĐ-CP)
            </StatusBadge>
          </div>

          <KpiStrip
            columns={3}
            items={[
              {
                label: "Tổng thù lao (Gross)",
                value: formatVnd(data.summary.total_gross_income),
                sub: `${data.summary.total_contracts} hợp đồng khoán`,
                tone: "brand",
                icon: "wallet",
              },
              {
                label: "Thuế TNCN đã khấu trừ (10%)",
                value: formatVnd(data.summary.total_tax_withheld),
                sub: "Đã nộp vào NSNN",
                tone: "danger",
                icon: "scale",
              },
              {
                label: "Thực nhận chuyển khoản (Net)",
                value: formatVnd(data.summary.total_net_paid),
                sub: "TK Techcombank 79713",
                tone: "success",
                icon: "banknote",
              },
            ]}
          />

          <DataView
            mobileMode="card"
            desktop={
              <div className="ui-table-scroll-wrap" tabIndex={0}>
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th>STT</th>
                      <th>Số HĐ / Ngày</th>
                      <th>Hạng mục công việc</th>
                      <th className="col-num">Tổng tiền (Gross)</th>
                      <th className="col-num">Thuế TNCN (10%)</th>
                      <th className="col-num">Thực nhận (Net)</th>
                      <th className="col-act">File PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.contracts.map((it) => {
                      const safePdfHref = safeHttpUrl(it.pdf_url);
                      return (
                        <tr key={it.contract_code}>
                          <td className="num">{it.stt}</td>
                          <td>
                            <div className="ui-mono ui-text-brand ui-wrap">{it.contract_code}</div>
                            <div className="pw-sub">{it.contract_date}</div>
                          </td>
                          <td>
                            <div className="ui-text-strong ui-wrap">{it.project_name}</div>
                            <div className="pw-sub">{it.contract_type_label}</div>
                          </td>
                          <td className="col-num">
                            <span className="pw-num">{formatVnd(it.gross_amount)}</span>
                          </td>
                          <td className="col-num">
                            <span className={it.tax_withheld > 0 ? "ui-text-xs ui-text-danger" : "ui-text-xs ui-text-success"}>
                              {it.tax_withheld > 0 ? `-${formatVnd(it.tax_withheld)}` : "Miễn khấu trừ"}
                            </span>
                          </td>
                          <td className="col-num">
                            <span className="ui-text-xs ui-text-success">{formatVnd(it.net_paid)}</span>
                          </td>
                          <td className="col-act">
                            {safePdfHref ? (
                              <a
                                href={safePdfHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ui-btn ui-btn--secondary ui-btn--sm"
                              >
                                <AppIcon name="file-text" size={14} />
                                <span>PDF Đã Ký</span>
                              </a>
                            ) : (
                              <span className="pw-sub">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            }
            mobileCards={
              <div className="ui-mobile-card-list">
                {data.contracts.map((it) => {
                  const safePdfHref = safeHttpUrl(it.pdf_url);
                  return (
                    <MobileCard key={it.contract_code}>
                      <MobileCardHeader
                        title={`#${it.stt} · ${it.contract_code}`}
                        subtitle={`${it.contract_date} · ${it.contract_type_label}`}
                        badge={
                          safePdfHref ? (
                            <a
                              href={safePdfHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ui-btn ui-btn--secondary ui-btn--sm"
                            >
                              <AppIcon name="file-text" size={14} />
                              <span>PDF</span>
                            </a>
                          ) : undefined
                        }
                      />
                      <div className="ui-text-strong ui-wrap">{it.project_name}</div>
                      <MobileCardGrid cols={2}>
                        <MobileCardRow label="Tổng tiền (Gross)" value={formatVnd(it.gross_amount)} mono />
                        <MobileCardRow
                          label="Thuế TNCN (10%)"
                          value={
                            <span className={it.tax_withheld > 0 ? "ui-text-xs ui-text-danger" : "ui-text-xs ui-text-success"}>
                              {it.tax_withheld > 0 ? `-${formatVnd(it.tax_withheld)}` : "Miễn khấu trừ"}
                            </span>
                          }
                        />
                        <MobileCardRow
                          label="Thực nhận (Net)"
                          value={<span className="ui-text-xs ui-text-success">{formatVnd(it.net_paid)}</span>}
                          fullWidth
                          mono
                        />
                      </MobileCardGrid>
                    </MobileCard>
                  );
                })}
              </div>
            }
          />

          <InlineAlert tone="info" title="Hướng dẫn làm thủ tục Hoàn Thuế Thu Nhập Cá Nhân">
            <div>{data.tax_refund_guidance}</div>
            <div className="pw-sub">
              Đơn vị chi trả: <b>{data.payer.company_name}</b> (MST: {data.payer.tax_code}) cam kết
              đã kê khai thuế theo đúng quy định.
            </div>
          </InlineAlert>
        </div>
      )}
    </AppModal>
  );
}
