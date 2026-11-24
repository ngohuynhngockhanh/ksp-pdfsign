import type { FormEvent } from "react";
import type { TaxDefenseDossier } from "../../api";
import {
  AppButton,
  EmptyState,
  FormField,
  InlineAlert,
  SectionCard,
} from "../../components/ui";

interface DossierTabProps {
  dossier: TaxDefenseDossier | null;
  copySuccess: boolean;
  onCopy: () => void;
}

export function DossierTab({ dossier, copySuccess, onCopy }: DossierTabProps) {
  return (
    <SectionCard
      title={dossier?.title || "Bản Thuyết Minh Giải Trình Thuế 2022 - 2025"}
      subtitle="Sẵn sàng copy vào văn bản giải trình chính thức gửi Cơ quan Thuế"
      icon="file-text"
      actions={
        <AppButton
          variant="primary"
          leftIcon={copySuccess ? "check" : "copy"}
          onClick={onCopy}
        >
          {copySuccess ? "Đã chép toàn văn!" : "Sao Chép Toàn Văn"}
        </AppButton>
      }
    >
      {dossier?.markdown_content ? (
        <div className="ui-pre ui-pre--sans ui-scroll-lg td-dossier-body">{dossier.markdown_content}</div>
      ) : (
        <EmptyState
          compact
          icon="file-text"
          title="Chưa có nội dung bản thuyết minh"
          description="Tải lại trang hoặc kiểm tra kết nối máy chủ để tổng hợp bản thuyết minh giải trình pháp lý."
        />
      )}
    </SectionCard>
  );
}

interface ImportTabProps {
  importYear: string;
  onImportYearChange: (year: string) => void;
  importFile: File | null;
  onImportFileChange: (file: File | null) => void;
  importing: boolean;
  importResult: { success: boolean; imported: number; skipped: number; year: string } | null;
  onSubmit: (e: FormEvent) => void;
}

export function ImportTab({
  importYear,
  onImportYearChange,
  importFile,
  onImportFileChange,
  importing,
  importResult,
  onSubmit,
}: ImportTabProps) {
  return (
    <div className="td-import-card">
      <SectionCard
        title="Nạp Bảng Kê Mua Vào Lịch Sử (2022 – 2024)"
        subtitle="Nhập bảng kê Mẫu 01-2/GTGT từ phần mềm kế toán cũ (MISA, Fast) để bổ sung cơ sở dữ liệu chi phí giải trình"
        icon="upload"
      >
        <div className="ui-stack--lg">
          <form onSubmit={onSubmit} className="ui-stack--lg">
            <FormField label="Chọn Năm Tài Chính" htmlFor="td-import-year" required>
              <select
                id="td-import-year"
                className="ui-select"
                value={importYear}
                onChange={(e) => onImportYearChange(e.target.value)}
              >
                <option value="2022">Năm 2022</option>
                <option value="2023">Năm 2023</option>
                <option value="2024">Năm 2024</option>
                <option value="2025">Năm 2025 (8 tháng đầu)</option>
              </select>
            </FormField>

            <FormField
              label="File Excel Bảng Kê (.xlsx, .xls)"
              htmlFor="td-import-file"
              required
              hint="Hệ thống tự động nhận diện các cột: Ký hiệu, Số HĐ, Ngày lập, Tên người bán, MST, Tiền hàng chưa thuế, Tiền thuế GTGT."
            >
              <input
                id="td-import-file"
                className="ui-input td-file-input"
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => onImportFileChange(e.target.files?.[0] || null)}
              />
            </FormField>

            <AppButton
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              leftIcon="upload"
              loading={importing}
              disabled={importing || !importFile}
            >
              {importing ? "Đang nạp dữ liệu..." : "Bắt Đầu Nạp Bảng Kê"}
            </AppButton>
          </form>

          {importResult && (
            <InlineAlert
              tone="success"
              title={`Nạp thành công bảng kê năm ${importResult.year}`}
            >
              Đã thêm mới: <strong>{importResult.imported}</strong> hóa đơn · Bỏ qua (trùng):{" "}
              <strong>{importResult.skipped}</strong> hóa đơn
            </InlineAlert>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
