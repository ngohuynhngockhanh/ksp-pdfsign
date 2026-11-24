import {
  AppButton,
  FormField,
  FormGrid,
  SectionCard,
  SplitWorkspace,
} from "../../components/ui";
import type { CrFormState } from "./types";

interface CrGeneratorTabProps {
  crForm: CrFormState;
  generatingPdf: boolean;
  onChange: (next: CrFormState) => void;
  onDownloadPdf: () => void;
  onDownloadDocx: () => void;
}

export function CrGeneratorTab({
  crForm,
  generatingPdf,
  onChange,
  onDownloadPdf,
  onDownloadDocx,
}: CrGeneratorTabProps) {
  return (
    <SplitWorkspace
      variant="preview-right"
      mobileTabs={["Cấu hình biểu mẫu", "Xem trước bản công bố"]}
      primary={
        <SectionCard
          title="Cấu Hình Bản Công Bố Hợp Quy (Mẫu 02 - TT 28/2012/TT-BKHCN)"
          subtitle="Điền thông tin doanh nghiệp và kết quả đo kiểm để kết xuất đồng bộ bản PDF và Word (DOCX)."
          icon="file-signature"
        >
          <div className="ui-stack">
            <FormField label="Tên Doanh Nghiệp" htmlFor="cr-company-name">
              <input
                id="cr-company-name"
                type="text"
                className="ui-input"
                value={crForm.company_name}
                onChange={(e) => onChange({ ...crForm, company_name: e.target.value })}
              />
            </FormField>

            <FormGrid cols={2}>
              <FormField label="Mã Số Thuế (MST)" htmlFor="cr-tax-code">
                <input
                  id="cr-tax-code"
                  type="text"
                  className="ui-input ui-mono ui-wrap"
                  value={crForm.tax_code}
                  onChange={(e) => onChange({ ...crForm, tax_code: e.target.value })}
                />
              </FormField>
              <FormField label="Người Đại Diện" htmlFor="cr-rep-name">
                <input
                  id="cr-rep-name"
                  type="text"
                  className="ui-input"
                  value={crForm.representative_name}
                  onChange={(e) => onChange({ ...crForm, representative_name: e.target.value })}
                />
              </FormField>
            </FormGrid>

            <FormGrid cols={2}>
              <FormField label="Tên Sản Phẩm / Thiết Bị" htmlFor="cr-product-name">
                <input
                  id="cr-product-name"
                  type="text"
                  className="ui-input"
                  value={crForm.product_name}
                  onChange={(e) => onChange({ ...crForm, product_name: e.target.value })}
                />
              </FormField>
              <FormField label="Model / Ký Hiệu" htmlFor="cr-model-name">
                <input
                  id="cr-model-name"
                  type="text"
                  className="ui-input ui-mono ui-wrap"
                  value={crForm.model_name}
                  onChange={(e) => onChange({ ...crForm, model_name: e.target.value })}
                />
              </FormField>
            </FormGrid>

            <FormField
              label="Quy Chuẩn Kỹ Thuật Áp Dụng"
              htmlFor="cr-standards"
              hint="Phân cách các mã QCVN bằng dấu phẩy."
            >
              <input
                id="cr-standards"
                type="text"
                className="ui-input ui-mono ui-wrap"
                value={crForm.applicable_standards.join(", ")}
                onChange={(e) =>
                  onChange({
                    ...crForm,
                    applicable_standards: e.target.value.split(",").map((s) => s.trim()),
                  })
                }
              />
            </FormField>

            <FormGrid cols={2}>
              <FormField label="Số Phiếu Kết Quả Thử Nghiệm" htmlFor="cr-report-no">
                <input
                  id="cr-report-no"
                  type="text"
                  className="ui-input ui-mono ui-wrap"
                  value={crForm.test_report_number}
                  onChange={(e) => onChange({ ...crForm, test_report_number: e.target.value })}
                />
              </FormField>
              <FormField label="Phòng Lab Thử Nghiệm" htmlFor="cr-lab-name">
                <input
                  id="cr-lab-name"
                  type="text"
                  className="ui-input"
                  value={crForm.test_lab_name}
                  onChange={(e) => onChange({ ...crForm, test_lab_name: e.target.value })}
                />
              </FormField>
            </FormGrid>

            <div className="ui-row">
              <AppButton
                variant="primary"
                leftIcon="file-down"
                loading={generatingPdf}
                onClick={onDownloadPdf}
              >
                {generatingPdf ? "Đang tạo PDF..." : "Tải Bản Công Bố PDF"}
              </AppButton>
              <AppButton variant="secondary" leftIcon="file-text" onClick={onDownloadDocx}>
                Tải File Word (DOCX)
              </AppButton>
            </div>
          </div>
        </SectionCard>
      }
      secondary={
        <SectionCard title="Xem trước bản công bố" icon="eye">
          <div className="std-cr-paper">
            <div className="std-cr-head">
              <div className="std-cr-head-main">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
              <div className="std-cr-head-sub">Độc lập - Tự do - Hạnh phúc</div>
              <div className="std-cr-rule" aria-hidden="true" />
            </div>

            <div>
              <div className="std-cr-title">BẢN CÔNG BỐ HỢP QUY</div>
              <div className="std-cr-note">
                (Theo Thông tư số 28/2012/TT-BKHCN và TT 02/2017/TT-BKHCN)
              </div>
            </div>

            <div className="ui-stack">
              <div>
                <strong>1. Đơn vị công bố:</strong> {crForm.company_name} (MST:{" "}
                <strong className="ui-mono ui-wrap">{crForm.tax_code}</strong>)
              </div>
              <div>
                <strong>2. Sản phẩm hàng hóa:</strong> {crForm.product_name} — Model:{" "}
                <strong className="ui-mono ui-wrap">{crForm.model_name}</strong>
              </div>
              <div>
                <strong>3. Phù hợp các Quy chuẩn:</strong>{" "}
                <span className="ui-mono ui-wrap">{crForm.applicable_standards.join(", ")}</span>
              </div>
              <div>
                <strong>4. Căn cứ:</strong> Phiếu kết quả số{" "}
                <span className="ui-mono ui-wrap">{crForm.test_report_number}</span> do{" "}
                {crForm.test_lab_name} cấp.
              </div>
              <div>
                <strong>5. Cam kết:</strong> Doanh nghiệp cam kết chịu trách nhiệm trước pháp luật
                về chất lượng sản phẩm.
              </div>
            </div>

            <div className="std-cr-sign">
              <em>Ngày ... tháng ... năm ...</em>
              <strong>ĐẠI DIỆN HỢP PHÁP</strong>
              <div className="std-cr-stamp">[KÝ SỐ ĐIỆN TỬ]</div>
              <strong>{crForm.representative_name}</strong>
            </div>
          </div>
        </SectionCard>
      }
    />
  );
}
